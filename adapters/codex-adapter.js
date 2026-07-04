#!/usr/bin/env node
// Codex アダプタ
// ~/.codex/state_5.sqlite の threads テーブルをポーリングして各セッションを見つけ、
// 各セッションの rollout(JSONL) の末尾を読んで現在のアクティビティを判定し、
// コレクタの /ingest/generic に共通形式で送る。
//
// 依存ゼロ（sqlite3 CLI を子プロセスで呼ぶ）。
//   node adapters/codex-adapter.js
// 環境変数:
//   AGENT_DASH_URL  送信先 (既定 http://127.0.0.1:4820)
//   CODEX_DB        state DB (既定 ~/.codex/state_5.sqlite)
//   POLL_MS         ポーリング間隔 (既定 2000)
//   ACTIVE_WINDOW_MIN  この分数より古い更新のスレッドは無視 (既定 30)
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DASH = process.env.AGENT_DASH_URL || 'http://127.0.0.1:4820';
const DB = process.env.CODEX_DB || path.join(os.homedir(), '.codex', 'state_5.sqlite');
const POLL_MS = process.env.POLL_MS ? Number(process.env.POLL_MS) : 2000;
const ACTIVE_WINDOW = (process.env.ACTIVE_WINDOW_MIN ? Number(process.env.ACTIVE_WINDOW_MIN) : 30) * 60;
const HOST = os.hostname().split('.')[0];

// rollout の event_msg.payload.type / response_item.payload.type → アクティビティ
// ※ message/task_* 系は実データで確認済み。ツール系は Codex の標準イベント名に基づく。
const MAP = {
  task_started: ['thinking', '考えている'],
  task_complete: ['idle', '待機中'],
  turn_complete: ['idle', '待機中'],
  user_message: ['thinking', '考えている'],
  agent_message: ['thinking', '応答を書いている'],
  agent_reasoning: ['thinking', '考えている'],
  agent_reasoning_delta: ['thinking', '考えている'],
  exec_command_begin: ['running', 'コマンドを実行中'],
  exec_command_end: ['thinking', '考えている'],
  patch_apply_begin: ['coding', 'コードを編集中'],
  patch_apply_end: ['thinking', '考えている'],
  web_search_begin: ['searching', 'Webを検索中'],
  web_search: ['searching', 'Webを検索中'],
  mcp_tool_call_begin: ['running', 'ツールを実行中'],
  mcp_tool_call_end: ['thinking', '考えている'],
  // response_item.payload.type
  function_call: ['running', 'ツールを実行中'],
  local_shell_call: ['running', 'コマンドを実行中'],
  custom_tool_call: ['running', 'ツールを実行中'],
  reasoning: ['thinking', '考えている'],
  message: ['thinking', '応答を書いている'],
};

function sql(query) {
  return new Promise((resolve) => {
    execFile('sqlite3', ['-json', DB, query], { maxBuffer: 8 << 20 }, (err, stdout) => {
      if (err) return resolve([]);
      try { resolve(JSON.parse(stdout || '[]')); } catch { resolve([]); }
    });
  });
}

// rollout の末尾を読んで、最後に意味のあるアクティビティを取り出す
function activityFromRollout(rolloutPath) {
  let raw = '';
  try {
    const fd = fs.openSync(rolloutPath, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 16384); // 末尾16KBだけ読む
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    raw = buf.toString('utf8');
  } catch { return null; }

  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || line[0] !== '{') continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    const pt = d.payload && d.payload.type;
    if (!pt || !MAP[pt]) continue;
    const [activity, label] = MAP[pt];
    return { activity, label, detail: detailOf(d.payload) };
  }
  return null;
}

function detailOf(p) {
  if (!p) return '';
  if (Array.isArray(p.command)) return p.command.join(' ').slice(0, 120);
  if (typeof p.command === 'string') return p.command.slice(0, 120);
  if (p.query) return `"${p.query}"`;
  if (p.path) return String(p.path).replace(os.homedir(), '~');
  if (p.tool) return String(p.tool);
  if (p.message && typeof p.message === 'string') return p.message.slice(0, 100);
  return '';
}

function post(body) {
  const data = Buffer.from(JSON.stringify(body));
  const u = new URL(DASH + '/ingest/generic');
  const req = require('http').request(
    { hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } },
    (res) => res.resume()
  );
  req.on('error', () => {});
  req.end(data);
}

const lastSig = new Map(); // 変化していないスレッドは再送しない（updated_at の空更新を防ぐ）

async function poll() {
  const nowSec = Math.floor(Date.now() / 1000);
  const rows = await sql(
    `SELECT id, cwd, title, first_user_message, tokens_used, updated_at, rollout_path
     FROM threads WHERE archived=0 ORDER BY updated_at DESC LIMIT 40;`
  );
  for (const t of rows) {
    if (nowSec - t.updated_at > ACTIVE_WINDOW) continue; // 古すぎるものは無視
    let rolloutSize = 0;
    try { rolloutSize = fs.statSync(t.rollout_path).size; } catch {}
    const sig = `${t.updated_at}:${rolloutSize}`;
    if (lastSig.get(t.id) === sig) continue; // 変化なしなら送らない
    lastSig.set(t.id, sig);

    const act = activityFromRollout(t.rollout_path) || { activity: 'idle', label: '待機中', detail: '' };
    post({
      source: 'codex',
      session_id: t.id,
      cwd: t.cwd,
      host: HOST,
      activity: act.activity,
      label: act.label,
      detail: act.detail || t.title || t.first_user_message || '',
      tokens: t.tokens_used > 0 ? { ctx: 0, out: t.tokens_used, ctxMax: 1000000 } : null,
    });
  }
}

console.log(`codex-adapter → ${DASH}  (DB: ${DB}, ${POLL_MS}ms間隔)`);
poll();
setInterval(poll, POLL_MS);
