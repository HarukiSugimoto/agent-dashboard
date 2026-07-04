#!/usr/bin/env node
// agent-dashboard collector
// - POST /ingest/claude : Claude Code hooks からのイベントを受信
// - GET  /stream        : SSE でブラウザにリアルタイム配信
// - GET  /              : ダッシュボード UI
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 4820;
const MAX_EVENTS = 500;

const sessions = new Map(); // session_id -> session state
const events = [];          // 直近イベントのリングバッファ
const clients = new Set();  // SSE 接続

const LOG_PATH = path.join(__dirname, 'events.jsonl');

// ツール名 -> [activityキー, 日本語ラベル]
const TOOL_ACTIVITY = {
  Edit: ['coding', 'コードを編集中'],
  MultiEdit: ['coding', 'コードを編集中'],
  Write: ['coding', 'ファイルを書いている'],
  NotebookEdit: ['coding', 'ノートブックを編集中'],
  Read: ['reading', 'ファイルを読んでいる'],
  Grep: ['reading', 'コードを検索中'],
  Glob: ['reading', 'ファイルを探している'],
  Bash: ['running', 'コマンドを実行中'],
  BashOutput: ['running', 'コマンド出力を確認中'],
  WebSearch: ['searching', 'Webを検索中'],
  WebFetch: ['searching', 'Webページを取得中'],
  Agent: ['delegating', 'サブエージェントに委任中'],
  Task: ['delegating', 'サブエージェントに委任中'],
  Workflow: ['delegating', 'ワークフローを実行中'],
  Skill: ['running', 'スキルを実行中'],
  TodoWrite: ['planning', 'タスクを整理中'],
  TaskCreate: ['planning', 'タスクを整理中'],
  TaskUpdate: ['planning', 'タスクを整理中'],
  AskUserQuestion: ['waiting', 'ユーザーの回答を待っている'],
};

// tool_input から人間が読める詳細を1行取り出す
function extractDetail(tool, input) {
  if (!input) return '';
  const p = input.file_path || input.notebook_path;
  if (p) return p.replace(process.env.HOME, '~');
  if (input.description) return input.description;
  if (input.command) return input.command.slice(0, 120);
  if (input.query) return `"${input.query}"`;
  if (input.url) return input.url;
  if (input.pattern) return `pattern: ${input.pattern}`;
  if (input.prompt) return String(input.prompt).slice(0, 120);
  if (input.skill) return `/${input.skill}`;
  return '';
}

// Claude Code hook の JSON を共通イベント形式に変換
function classifyClaude(h) {
  const ev = h.hook_event_name;
  const tool = h.tool_name || '';
  if (ev === 'SessionStart') return { activity: 'thinking', label: 'セッション開始', detail: '' };
  if (ev === 'UserPromptSubmit')
    return { activity: 'thinking', label: '考えている', detail: String(h.prompt || '').slice(0, 120) };
  if (ev === 'PreToolUse') {
    const [activity, label] = TOOL_ACTIVITY[tool] || ['running', `${tool} を実行中`];
    return { activity, label, detail: extractDetail(tool, h.tool_input), tool };
  }
  if (ev === 'PostToolUse')
    return { activity: 'thinking', label: '考えている', detail: `${tool} 完了`, tool };
  if (ev === 'Stop') return { activity: 'idle', label: '待機中', detail: '応答を完了しました' };
  if (ev === 'SessionEnd') return { activity: 'ended', label: '終了', detail: '' };
  return { activity: 'thinking', label: ev, detail: '' };
}

function ingest(source, sessionId, cwd, classified) {
  const now = Date.now();
  const event = {
    ts: now,
    source,
    session_id: sessionId,
    cwd: cwd || '',
    ...classified,
  };
  events.push(event);
  if (events.length > MAX_EVENTS) events.shift();

  const project = cwd ? path.basename(cwd) : '(不明)';
  const prev = sessions.get(sessionId);
  const session = {
    session_id: sessionId,
    source,
    project,
    cwd: cwd || '',
    activity: event.activity,
    label: event.label,
    detail: event.detail,
    started_at: prev ? prev.started_at : now,
    updated_at: now,
    event_count: (prev ? prev.event_count : 0) + 1,
  };
  sessions.set(sessionId, session);

  fs.appendFile(LOG_PATH, JSON.stringify(event) + '\n', () => {});
  broadcast({ type: 'update', session, event });
}

function broadcast(msg) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of clients) res.write(data);
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'POST' && url.pathname === '/ingest/claude') {
    try {
      const h = JSON.parse(await readBody(req));
      ingest('claude', h.session_id || 'unknown', h.cwd, classifyClaude(h));
      res.writeHead(200).end('ok');
    } catch (e) {
      res.writeHead(400).end('bad json');
    }
    return;
  }

  // 汎用エンドポイント（Codex アダプタ等が共通形式で直接送る用）
  if (req.method === 'POST' && url.pathname === '/ingest/generic') {
    try {
      const h = JSON.parse(await readBody(req));
      ingest(h.source || 'unknown', h.session_id || 'unknown', h.cwd, {
        activity: h.activity || 'running',
        label: h.label || h.activity || '',
        detail: h.detail || '',
        tool: h.tool || '',
      });
      res.writeHead(200).end('ok');
    } catch (e) {
      res.writeHead(400).end('bad json');
    }
    return;
  }

  if (url.pathname === '/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(
      `data: ${JSON.stringify({
        type: 'snapshot',
        sessions: [...sessions.values()],
        events: events.slice(-100),
      })}\n\n`
    );
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (url.pathname === '/') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) return res.writeHead(500).end('index.html not found');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(data);
    });
    return;
  }

  res.writeHead(404).end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`agent-dashboard collector: http://localhost:${PORT}`);
});
