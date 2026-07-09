#!/usr/bin/env node
// agent-dashboard collector
// - POST /ingest/claude : Claude Code hooks からのイベントを受信
// - GET  /stream        : SSE でブラウザにリアルタイム配信
// - GET  /              : ダッシュボード UI
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execFile } = require('child_process');

const PORT = process.env.PORT ? Number(process.env.PORT) : 4820;
// デフォルトはループバックのみ。Tailscale/LAN 経由で直接受けるなら BIND=0.0.0.0
const BIND = process.env.BIND || '127.0.0.1';
const MAX_EVENTS = 500;
const CONTEXT_WINDOW = process.env.CONTEXT_WINDOW ? Number(process.env.CONTEXT_WINDOW) : 1000000;

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
  if (ev === 'Notification') {
    const msg = String(h.message || '');
    // 60秒無操作の催促（Claude is waiting for your input）は手が止まっているわけでは
    // ないので待機側に寄せる。ツール許可要求など、それ以外は承認待ちのまま。
    if (/waiting for your input/i.test(msg))
      return { activity: 'idle', label: '応答待ち', detail: msg.slice(0, 120) };
    return { activity: 'waiting', label: '承認待ち', detail: msg.slice(0, 120) };
  }
  // SubagentStop は handler 側で稼働中の数を見てラベルを決める（ここでは扱わない）
  if (ev === 'Stop') return { activity: 'idle', label: '待機中', detail: '応答を完了しました' };
  if (ev === 'SessionEnd') return { activity: 'ended', label: '終了', detail: '' };
  return { activity: 'thinking', label: ev, detail: '' };
}

// トランスクリプト(JSONL)から使用トークンを読む。
// ctx = 直近assistant応答のコンテキスト量(input+cache), out = 出力トークン累計。
// ファイル全読み込みなので session ごとに 2 秒スロットルする。
const usageCache = new Map(); // sessionId -> { ts, tokens }
function readUsage(sessionId, transcriptPath) {
  if (!transcriptPath) return null;
  const cached = usageCache.get(sessionId);
  if (cached && Date.now() - cached.ts < 2000) return cached.tokens;
  let tokens = cached ? cached.tokens : null;
  try {
    const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
    let ctx = 0, out = 0, found = false;
    for (const line of lines) {
      if (!line.includes('"usage"')) continue;
      let u;
      try { u = JSON.parse(line)?.message?.usage; } catch { continue; }
      if (!u) continue;
      out += u.output_tokens || 0;
      ctx = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
      found = true;
    }
    if (found) tokens = { ctx, out, ctxMax: CONTEXT_WINDOW };
  } catch { /* リモート等でファイルが無ければ前回値を保持 */ }
  usageCache.set(sessionId, { ts: Date.now(), tokens });
  return tokens;
}

// セッションごとのサブエージェント追跡
const subagentsBySession = new Map(); // sessionId -> [{type, desc, status, ts}]
function trackSubagents(h) {
  const sid = h.session_id || 'unknown';
  const ev = h.hook_event_name;
  const tool = h.tool_name || '';
  let list = subagentsBySession.get(sid) || [];
  if (ev === 'PreToolUse' && (tool === 'Agent' || tool === 'Task')) {
    list.push({
      type: h.tool_input?.subagent_type || 'agent',
      desc: h.tool_input?.description || '',
      status: 'running',
      ts: Date.now(),
    });
    if (list.length > 16) list = list.slice(-16); // 直近16体まで保持
  } else if (ev === 'SubagentStop' || (ev === 'PostToolUse' && (tool === 'Agent' || tool === 'Task'))) {
    // 稼働中で最も古いものを完了扱い（個体識別ができないため FIFO）
    const running = list.find((s) => s.status === 'running');
    if (running) running.status = 'done';
  } else if (ev === 'SessionEnd' || ev === 'SessionStart') {
    list = [];
  }
  subagentsBySession.set(sid, list);
  return list;
}

// macOS 通知: セッションが稼働中から「待ち」(承認待ち/応答待ち/待機中) に遷移したら
// osascript で通知センターに出す。NOTIFY=0 で無効化。macOS 以外では何もしない。
// 待ち→待ちの揺れや初回イベント（起動直後のスナップショット的な受信）では鳴らさない。
const NOTIFY_ENABLED = process.platform === 'darwin' && process.env.NOTIFY !== '0';
const WAIT_ACTIVITIES = new Set(['waiting', 'idle']);
const APP_NOTIFIER = path.join(__dirname, 'AgentOps.app/Contents/MacOS/AgentOps');
function notifyWaiting(prev, session) {
  if (!NOTIFY_ENABLED) return;
  if (!WAIT_ACTIVITIES.has(session.activity)) return;
  if (!prev || WAIT_ACTIVITIES.has(prev.activity) || prev.activity === 'ended') return;
  const title = `AGENT OPS — ${session.project}`;
  const body = session.detail || session.label;
  // アプリバンドルがあればアプリ名義で送る（AppIcon 付き）。無ければ osascript に
  // フォールバック（送り主がスクリプトエディタになりアイコンは汎用）。
  if (fs.existsSync(APP_NOTIFIER)) {
    execFile(APP_NOTIFIER, ['--notify', title, session.label, body], () => {});
    return;
  }
  const q = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script =
    `display notification "${q(body)}" with title "${q(title)}"` +
    ` subtitle "${q(session.label)}" sound name "Glass"`;
  execFile('osascript', ['-e', script], () => {});
}

function ingest(source, sessionId, cwd, classified, host, tokens, subagents) {
  const now = Date.now();
  const event = {
    ts: now,
    source,
    session_id: sessionId,
    cwd: cwd || '',
    host: host || '',
    ...classified,
  };
  events.push(event);
  if (events.length > MAX_EVENTS) events.shift();

  const prev = sessions.get(sessionId);
  // cwd はセッション最初の値（＝起動ディレクトリ）に固定する。
  // Claude Code の hook は cd 後に移動先の cwd を送ってくるため、
  // 毎回上書きすると表示名が実行ディレクトリに引きずられてしまう。
  const baseCwd = (prev && prev.cwd) ? prev.cwd : (cwd || '');
  const project = baseCwd ? path.basename(baseCwd) : '(不明)';
  const session = {
    session_id: sessionId,
    source,
    project,
    cwd: baseCwd,
    host: host || '',
    activity: event.activity,
    label: event.label,
    detail: event.detail,
    started_at: prev ? prev.started_at : now,
    updated_at: now,
    event_count: (prev ? prev.event_count : 0) + 1,
    tokens: tokens || (prev ? prev.tokens : null),
    subagents: subagents || (prev ? prev.subagents : []),
  };
  sessions.set(sessionId, session);
  notifyWaiting(prev, session);

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
      const tokens = readUsage(h.session_id || 'unknown', h.transcript_path);
      const subs = trackSubagents(h);
      let classified = classifyClaude(h);
      // SubagentStop: 稼働中が残っていれば「作業中（残りN）」、無ければ主エージェント継続とみなす
      if (h.hook_event_name === 'SubagentStop') {
        const running = subs.filter((x) => x.status === 'running').length;
        classified = running > 0
          ? { activity: 'delegating', label: `サブエージェント作業中（残り${running}）`, detail: '' }
          : { activity: 'thinking', label: '考えている', detail: '' };
      }
      // 待機中(idle)は「考えている」で上書きしない。Stop 後に PostToolUse/SubagentStop の
      // 余波イベントが遅れて来ても待機状態を維持する。新ターン(UserPromptSubmit)なら遷移する。
      const prev = sessions.get(h.session_id || 'unknown');
      if (prev && prev.activity === 'idle' && classified.activity === 'thinking' &&
          h.hook_event_name !== 'UserPromptSubmit') {
        classified = { activity: 'idle', label: prev.label || '待機中', detail: prev.detail || '' };
      }
      ingest('claude', h.session_id || 'unknown', h.cwd, classified, req.headers['x-agent-host'], tokens, subs);
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
      }, h.host || req.headers['x-agent-host'], h.tokens || null, h.subagents || null);
      res.writeHead(200).end('ok');
    } catch (e) {
      res.writeHead(400).end('bad json');
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/clear') {
    events.length = 0;
    sessions.clear();
    broadcast({ type: 'clear' });
    res.writeHead(200).end('ok');
    return;
  }

  // セッションの作業ディレクトリをエディタで開く（EDITOR_APP で変更可、例: Zed）
  if (req.method === 'POST' && url.pathname === '/focus-session') {
    try {
      const { session_id } = JSON.parse(await readBody(req));
      const s = sessions.get(session_id);
      if (!s || !s.cwd) { res.writeHead(404).end('unknown session'); return; }
      if (s.host && s.host !== os.hostname().split('.')[0]) {
        res.writeHead(409).end('remote session');
        return;
      }
      // EDITOR_APP があれば最優先。なければ起動中のエディタを自動検出（Zed → VS Code）。
      // 複数ウィンドウが並んでいても、cwd を開いているウィンドウが前面化される。
      const dir = s.cwd.replace(/"/g, '');
      const openIn = (app) => exec(`open -a "${app}" "${dir}"`, () => {});
      if (process.env.EDITOR_APP) openIn(process.env.EDITOR_APP);
      else
        exec('pgrep -f "Zed.app/Contents/MacOS"', (err) => {
          if (!err) openIn('Zed');
          else openIn('Visual Studio Code');
        });
      res.writeHead(200).end('ok');
    } catch (e) {
      res.writeHead(400).end('bad json');
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/clear-session') {
    try {
      const { session_id } = JSON.parse(await readBody(req));
      sessions.delete(session_id);
      broadcast({ type: 'remove_session', session_id });
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
    // 古い残骸を起動時に見せない: セッションは直近2時間、Feed用イベントは直近1時間のみ
    const now = Date.now();
    res.write(
      `data: ${JSON.stringify({
        type: 'snapshot',
        sessions: [...sessions.values()].filter((s) => now - s.updated_at < 2 * 3600e3),
        events: events.slice(-80).filter((e) => now - e.ts < 3600e3),
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

  // アバター画像などの静的ファイル配信
  if (url.pathname.startsWith('/assets/')) {
    const fp = path.join(__dirname, path.normalize(url.pathname));
    if (!fp.startsWith(path.join(__dirname, 'assets'))) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
    fs.readFile(fp, (err, data) => {
      if (err) return res.writeHead(404).end('not found');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'max-age=60' }).end(data);
    });
    return;
  }

  res.writeHead(404).end('not found');
});

// Nagle アルゴリズムによる送信バッファリング（最大 ~40ms）を無効化
server.on('connection', (socket) => socket.setNoDelay(true));

// 15秒ごとの SSE ハートビート（プロキシ等による接続切断を防ぐ）
setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 15000);

server.listen(PORT, BIND, () => {
  console.log(`agent-dashboard collector: http://${BIND}:${PORT}`);
});
