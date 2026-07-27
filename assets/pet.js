// デスクトップ常駐ペット。オフィスも机も描かず、ロボット1体と吹き出しだけを透明背景に置く。
// 吹き出し = 稼働中セッション（承認待ちを最優先に段積み）。ロボットの状態は全体の要約。
//
// AgentOps.app の透明ウィンドウで表示する場合:
//   - マウスを受ける矩形（ロボット本体＋ホバー中の ✕）だけを Swift に通知。
//     それ以外は吹き出しの上を含めてクリックが背後のアプリへ抜ける
//   - ロボットをドラッグ → ウィンドウ移動 / ⌥ドラッグ → 拡大縮小（Swift 側で処理）
//   - クリック透過中は mouseover が届かないので、カーソル位置は Swift が __petCursor で流し込む
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const qs = new URLSearchParams(location.search);
if (qs.has('checker')) document.body.classList.add('checker'); // 透明領域の目視確認用

const MAX_BUBBLES = Math.max(1, Number(qs.get('max')) || 8); // 上限。実際の数は入るだけ（capacity）
const STALE_MS = 30 * 60 * 1000;      // これ以上更新のないセッションは黙らせる
const ACTIVE = new Set(['coding', 'reading', 'searching', 'running', 'delegating', 'planning', 'thinking']);
const ACT_TINT = {                     // 吹き出しの縁・プロジェクトタグ（濃いめ）
  coding: '#3fb877', reading: '#3f9ee0', searching: '#9a6fe0', running: '#ef8f4c',
  delegating: '#e86fa6', planning: '#d6b23f', thinking: '#8a97b8', waiting: '#e84c4c',
  idle: '#b0a084', ended: '#9aa0b4',
};
const ACT_INK = {                      // 白カード上の文字色（コントラスト確保）
  coding: '#2f9e66', reading: '#2e86c4', searching: '#8a5fd0', running: '#d97f2e',
  delegating: '#d8558c', planning: '#b8952a', thinking: '#5c6e94', waiting: '#d84a4a',
  idle: '#8a7a5e', ended: '#7a8096',
};

const stage = document.getElementById('stage');
const bubbles = document.getElementById('bubbles');
const moreEl = document.getElementById('more');
const zzzEl = document.getElementById('zzz');
const offEl = document.getElementById('off');

// ================= ロボット（three.js / 透明背景） =================
// WebGL が使えない環境（リモート描画など）ではロボットを諦め、吹き出しだけで動かす。
const scene = new THREE.Scene(); // background は未設定＝透明
let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
} catch (e) {
  console.warn('[pet] WebGL が使えないためロボットは表示しません', e);
  stage.style.height = '18px';
}
const has3D = !!renderer;

const camera = new THREE.PerspectiveCamera(26, 2, 0.1, 50);
camera.position.set(0, 1.05, 4.3);
camera.lookAt(0, 0.86, 0);

if (has3D) {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  stage.prepend(renderer.domElement);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.85;

  const resize = () => {
    const w = stage.clientWidth || 320;
    const h = stage.clientHeight || 176;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(stage);
  resize();
}

// 影を落とす床が無いのでライトは全て素直に（影は下の疑似シャドウで表現）
scene.add(new THREE.HemisphereLight('#cfe0ff', '#3a3f52', 1.0));
const key = new THREE.DirectionalLight('#fff4e0', 1.9);
key.position.set(2.4, 4.2, 3.2);
scene.add(key);
const rim = new THREE.DirectionalLight('#8fb6ff', 1.1);
rim.position.set(-3, 2.2, -2.6);
scene.add(rim);

// 足元の疑似シャドウ（放射グラデのスプライト。透明背景でも「接地」して見える）
const shadow = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d').createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,.5)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  const ctx = c.getContext('2d');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 1.5),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.002;
  scene.add(m);
  return m;
})();

// 承認待ちを足元のリングでも伝える
const ring = new THREE.Mesh(
  new THREE.RingGeometry(0.42, 0.62, 32),
  new THREE.MeshBasicMaterial({ color: '#ee5d5d', transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.02;
ring.visible = false;
scene.add(ring);

// ---------- モデル ----------
// worker-robot.glb はアニメ無しなので手続き的に動かす。
// ?robot=expressive で RobotExpressive（Idle/Wave などのクリップ入り）に切替。
const ROBOTS = {
  worker: { url: '/assets/models/worker-robot.glb', h: 1.6 },
  expressive: { url: '/assets/models/RobotExpressive.glb', h: 1.6 },
};
const pick = ROBOTS[qs.get('robot')] || ROBOTS.worker;

function normalize(obj, targetH) {
  const g = new THREE.Group();
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const s = targetH / (size.y || 1);
  obj.scale.setScalar(s);
  const b2 = new THREE.Box3().setFromObject(obj);
  const c = b2.getCenter(new THREE.Vector3());
  obj.position.sub(new THREE.Vector3(c.x, b2.min.y, c.z)); // 足元を原点へ
  g.add(obj);
  return g;
}

let robot = null, mixer = null, clips = {}, current = null;
const loader = new GLTFLoader();
try { loader.setMeshoptDecoder(MeshoptDecoder); } catch (e) { console.warn('[pet] meshopt設定失敗', e); }

function loadRobot(spec, fallback) {
  loader.load(spec.url, (gltf) => {
    robot = normalize(gltf.scene, spec.h);
    scene.add(robot);
    if (gltf.animations && gltf.animations.length) {
      mixer = new THREE.AnimationMixer(robot);
      for (const a of gltf.animations) clips[a.name] = mixer.clipAction(a);
      play('Idle');
    }
  }, undefined, (e) => {
    console.warn('[pet] モデル読込失敗', spec.url, e);
    if (fallback) loadRobot(fallback, null);
  });
}
if (has3D) loadRobot(pick, pick === ROBOTS.expressive ? null : ROBOTS.expressive);

function play(name) {
  const a = clips[name];
  if (!a || current === a) return;
  a.reset().fadeIn(0.25).play();
  if (current) current.fadeOut(0.25);
  current = a;
}

// ================= セッション =================
const sessions = new Map();

const fmtElapsed = (ms) => {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + '秒';
  if (s < 3600) return Math.floor(s / 60) + '分';
  return Math.floor(s / 3600) + '時間' + Math.floor((s % 3600) / 60) + '分';
};

// 表示対象を優先度順に並べる: 承認待ち → 稼働中 → その他。
// 同順位では「いま出ているもの」を優先する。更新時刻だけで選ぶと、席が足りないときに
// 数秒おきに顔ぶれが入れ替わって（そのたび登場アニメが走って）落ち着かないため。
const shownIds = new Set();
function visibleSessions() {
  const now = Date.now();
  const rank = (s) => (s.activity === 'waiting' ? 0 : ACTIVE.has(s.activity) ? 1 : 2);
  const sticky = (s) => (shownIds.has(s.session_id) ? 0 : 1);
  return [...sessions.values()]
    .filter((s) => s.activity !== 'ended' && now - s.updated_at < STALE_MS)
    .sort((a, b) => rank(a) - rank(b) || sticky(a) - sticky(b) || b.updated_at - a.updated_at);
}

const els = new Map(); // session_id -> element
let hoverId = null;    // ✕ を出している吹き出し（カーソルが乗っているもの）

// 吹き出しが実際に必要としている高さ（余白・行間込み）
function contentHeight() {
  const st = getComputedStyle(bubbles);
  const kids = [...bubbles.children].filter((el) => el.offsetHeight > 0); // hidden な #more は数えない
  return kids.reduce((a, el) => a + el.offsetHeight, 0)
    + (parseFloat(st.rowGap) || 0) * Math.max(0, kids.length - 1)
    + parseFloat(st.paddingTop) + parseFloat(st.paddingBottom);
}

function setMore(n) {
  moreEl.hidden = n <= 0;
  if (n > 0) moreEl.textContent = `ほか ${n} セッション`;
}

// 縦に入る吹き出しの数。実測して増減させる（毎フレーム出し入れして震えないよう状態として持つ）
let capacity = MAX_BUBBLES;
let relayout = false;

function render() {
  const list = visibleSessions();
  // 表示する顔ぶれは優先度順に選ぶが、並び順は開始時刻で固定する。
  // 更新のたびに入れ替わると（セッションは秒単位で状態が変わる）目が滑るため。
  // 承認待ちだけは一番下＝ロボットのすぐ上に置いて目立たせる。
  const show = list.slice(0, Math.max(1, Math.min(MAX_BUBBLES, capacity))).sort((a, b) =>
    (a.activity === 'waiting' ? 1 : 0) - (b.activity === 'waiting' ? 1 : 0) || a.started_at - b.started_at);
  const keep = new Set(show.map((s) => s.session_id));
  shownIds.clear();
  for (const id of keep) shownIds.add(id);

  for (const [id, el] of els) if (!keep.has(id)) { el.remove(); els.delete(id); }

  // 並びが変わったときだけ DOM を動かす。appendChild は要素の再挿入扱いになり
  // CSS アニメーションが再生されてしまうので、毎回並べ直してはいけない。
  const want = show.map(bubble);
  const cur = [...bubbles.querySelectorAll('.pbl')];
  if (cur.length !== want.length || want.some((el, i) => cur[i] !== el)) {
    for (const el of want) bubbles.appendChild(el);
  }

  if (hoverId) els.get(hoverId)?.classList.add('hot');   // 作り直された要素にホバー状態を戻す
  setMore(list.length - show.length);
  zzzEl.classList.toggle('on', list.length === 0);
  updateMood(list);
  reportRects();

  // 実際に入ったかを測って容量を調整し、変わったら次フレームで組み直す。
  // しっぽが padding にはみ出す都合で scrollHeight は当てにならないので実測する。
  if (relayout) return;
  const avail = bubbles.clientHeight;
  const used = contentHeight();
  const gap = parseFloat(getComputedStyle(bubbles).rowGap) || 0;
  const tallest = want.length ? Math.max(...want.map((el) => el.offsetHeight)) : 0;
  let next = capacity;
  if (used > avail && show.length > 1) next = show.length - 1;                     // はみ出した → 減らす
  else if (capacity < MAX_BUBBLES && list.length > show.length
           && used + tallest + gap + 4 <= avail) next = capacity + 1;              // 明らかに1つ入る → 戻す
                                                                                   // (+4 は増減を往復させない余白)
  if (next === capacity) return;
  capacity = next;
  relayout = true;
  requestAnimationFrame(() => { relayout = false; render(); });
}

function bubble(s) {
  let el = els.get(s.session_id);
  if (!el) {
    el = document.createElement('div');
    el.className = 'pbl';
    el.innerHTML =
      '<div class="pbl-top"><span class="pbl-proj"></span><span class="pbl-ago"></span></div>' +
      '<div class="pbl-status"><span class="pbl-dot"></span><span class="pbl-label"></span></div>' +
      '<div class="pbl-detail"></div>' +
      '<div class="pbl-bar"><i></i></div>' +
      '<button class="pbl-x" title="この吹き出しを消す">✕</button>';
    // 吹き出し本体は「見るだけ」。反応するのはホバー中に出る ✕ だけ。
    // （エディタ前面化はダッシュボード側のビューに任せる）
    el.querySelector('.pbl-x').addEventListener('click', (ev) => {
      ev.stopPropagation();
      sessions.delete(s.session_id);   // SSE の応答を待たずに消す（見た目の反応を優先）
      hoverId = null;
      render();
      fetch('/clear-session', { method: 'POST', body: JSON.stringify({ session_id: s.session_id }) })
        .catch(() => {});
    });
    el.classList.add('new');
    setTimeout(() => el.classList.remove('new'), 400);
    els.set(s.session_id, el);
  }
  const tint = ACT_TINT[s.activity] || ACT_TINT.thinking;
  const ink = ACT_INK[s.activity] || ACT_INK.thinking;
  el.style.setProperty('--c', tint);
  el.style.setProperty('--ink', ink);
  el.classList.toggle('wait', s.activity === 'waiting');
  el.querySelector('.pbl-proj').textContent = s.project || '';
  el.querySelector('.pbl-label').textContent = s.label || '';
  el.querySelector('.pbl-detail').textContent = s.detail || '';
  el.querySelector('.pbl-ago').textContent = fmtElapsed(Date.now() - s.updated_at);

  const tok = s.tokens;
  const pct = tok && tok.ctx > 0 ? Math.min(100, Math.round((tok.ctx / tok.ctxMax) * 100)) : null;
  const bar = el.querySelector('.pbl-bar');
  if (pct == null) bar.style.display = 'none';
  else {
    bar.style.display = '';
    const fill = bar.querySelector('i');
    fill.style.width = pct + '%';
    fill.style.background = pct < 70 ? '#58c98d' : pct < 90 ? '#e5c04e' : '#ee5d5d';
  }
  return el;
}

// ロボットの「気分」＝全セッションの要約
let mood = 'sleep';
function updateMood(list) {
  const next = list.some((s) => s.activity === 'waiting') ? 'waiting'
    : list.some((s) => ACTIVE.has(s.activity)) ? 'active'
    : list.length ? 'idle' : 'sleep';
  if (next === mood) return;
  mood = next;
  ring.visible = mood === 'waiting';
  play(mood === 'waiting' ? 'Wave' : mood === 'active' ? 'Walking' : mood === 'idle' ? 'Idle' : 'Sitting');
}

// ================= メインループ =================
const t0 = performance.now();
const clock = new THREE.Clock();
function tick() {
  if (!has3D) return;
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = performance.now() - t0;
  if (mixer) mixer.update(dt);

  if (robot && !mixer) {
    // アニメ無しモデル向けの手続き的モーション（呼吸・揺れ・承認待ちの跳ね）
    const speed = mood === 'waiting' ? 260 : mood === 'active' ? 480 : 1100;
    const amp = mood === 'waiting' ? 0.09 : mood === 'active' ? 0.045 : 0.018;
    robot.position.y = Math.abs(Math.sin(t / speed)) * amp;
    robot.rotation.y = Math.sin(t / (mood === 'waiting' ? 420 : 2600)) * (mood === 'waiting' ? 0.28 : 0.12);
    robot.rotation.z = Math.sin(t / 1500) * 0.02;
    robot.rotation.x = mood === 'sleep' ? 0.07 : 0;                    // 眠いときは少し前かがみ
    const sc = 1 - robot.position.y * 0.12;                            // 跳ねに合わせて影を縮める
    shadow.scale.set(sc, sc, 1);
    shadow.material.opacity = 0.55 + (1 - sc) * 0.5;
  }
  if (ring.visible) {
    const p = 1 + Math.sin(t / 180) * 0.2;
    ring.scale.set(p, p, 1);
    ring.material.opacity = 0.5 + Math.sin(t / 180) * 0.35;
  }
  renderer.render(scene, camera);
}
tick();

// ================= AgentOps.app 連携 =================
// 1) 占有領域を通知 → 透明な部分のクリックは背後のアプリへ抜ける
// 2) ロボットのドラッグ開始を通知 → Swift がウィンドウを動かす
const bridge = window.webkit?.messageHandlers;
let lastRects = '';
function reportRects() {
  if (!bridge?.petRects) return;
  // マウスを受けるのはロボット本体と、ホバー中の吹き出しの ✕ だけ。
  // それ以外（吹き出しの本文を含む）はクリックが背後のアプリへ抜ける。
  // ロボットの範囲はウィンドウの大きさが変わっても比率で追従させる。
  const st = stage.getBoundingClientRect();
  const rw = st.width * 0.4;
  const ry = st.top + st.height * 0.1;
  const rects = [new DOMRect(st.left + st.width / 2 - rw / 2, ry, rw, st.bottom - ry)];
  const hotX = hoverId && els.get(hoverId)?.querySelector('.pbl-x');
  if (hotX) rects.push(hotX.getBoundingClientRect());
  const payload = rects.map((r) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }));
  const json = JSON.stringify(payload);
  if (json === lastRects) return;
  lastRects = json;
  bridge.petRects.postMessage(payload);
}
setInterval(reportRects, 400); // レイアウトはアニメーションでも変わるので定期送信（差分があるときだけ）

// ---- ホバー ----
// 吹き出しはクリック透過なので、本物の mouseover は届かない。
// Swift 側がカーソル位置（ページ座標）を流し込んでくるので、それで当たりを取る。
// ブラウザで直接開いたときは普通の mousemove から同じ関数を呼ぶ。
function petCursor(x, y) {
  let hit = null;
  if (x >= 0) {
    for (const [id, el] of els) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { hit = id; break; }
    }
  }
  if (hit === hoverId) return;
  if (hoverId) els.get(hoverId)?.classList.remove('hot');
  hoverId = hit;
  if (hoverId) els.get(hoverId)?.classList.add('hot');
  reportRects();   // ✕ が出た/消えたぶん、当たり判定を送り直す
}
window.__petCursor = petCursor;
addEventListener('mousemove', (e) => petCursor(e.clientX, e.clientY));
addEventListener('mouseout', () => petCursor(-1, -1));

// ウィンドウの大きさが変わったら、入る吹き出しの数と占有領域を測り直す
addEventListener('resize', () => { capacity = MAX_BUBBLES; lastRects = ''; render(); });

stage.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  stage.classList.add('dragging');
  bridge?.petDrag?.postMessage('start');
});
addEventListener('mouseup', () => stage.classList.remove('dragging'));
addEventListener('blur', () => stage.classList.remove('dragging'));

// ================= SSE =================
const es = new EventSource('/stream');
es.onopen = () => { offEl.hidden = true; };
es.onerror = () => { offEl.hidden = false; };
es.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.type === 'snapshot') { sessions.clear(); msg.sessions.forEach((s) => sessions.set(s.session_id, s)); }
  else if (msg.type === 'update') sessions.set(msg.session.session_id, msg.session);
  else if (msg.type === 'clear') sessions.clear();
  else if (msg.type === 'remove_session') sessions.delete(msg.session_id);
  else return;
  render();
};

// 経過時間の更新と、古くなったセッションの引っ込め
setInterval(render, 1000);
render();
