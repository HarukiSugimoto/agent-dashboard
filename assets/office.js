// 3D バーチャルオフィス「ミッドナイトロフト」 (three.js / ローポリ)
// 夜のオフィス。セッション = キャラクター。使用中の机だけランプが灯る。
import * as THREE from 'three';

const wrap = document.getElementById('officeWrap');

// ---------- シーン・カメラ ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color('#1c2238');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
wrap.prepend(renderer.domElement);

const camera = new THREE.OrthographicCamera();
camera.position.set(13, 13, 13);
camera.lookAt(0, 0, 0);

// ---------- 夜のライティング ----------
scene.add(new THREE.AmbientLight('#9aa4d4', 1.05));            // 夜色だが視認性優先のベース光
const moon = new THREE.DirectionalLight('#bcc8f0', 0.8);       // 月光（影用）
moon.position.set(8, 16, 6);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
Object.assign(moon.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14 });
scene.add(moon);
const warmFill = new THREE.PointLight('#ffb970', 8, 26, 1.5);  // 部屋中央の暖色間接光
warmFill.position.set(0, 3.6, 0);
scene.add(warmFill);

// 画面全体を背景として使う（ヘッダーの下から下端まで）
const headerEl = document.querySelector('header');
function resize() {
  wrap.style.top = headerEl.offsetHeight + 14 + 'px';
  const w = wrap.clientWidth || innerWidth;
  const h = wrap.clientHeight || innerHeight;
  renderer.setSize(w, h);
  const viewH = 7.6, aspect = w / h;
  camera.left = -viewH * aspect; camera.right = viewH * aspect;
  camera.top = viewH; camera.bottom = -viewH;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(wrap);
resize();

// ---------- 部品ヘルパー ----------
const mat = (c, opts = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, ...opts });
const glow = (c, i = 1) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i, roughness: 0.6 });
function box(parent, w, h, d, m, x, y, z, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof m === 'string' ? mat(m) : m);
  mesh.position.set(x, y, z);
  mesh.castShadow = opts.noCast !== true;
  mesh.receiveShadow = true;
  if (opts.ry) mesh.rotation.y = opts.ry;
  parent.add(mesh);
  return mesh;
}

// ---------- 部屋 ----------
const room = new THREE.Group();
scene.add(room);

// 床（夜色のベース + 木のワークエリア + 藍のライブラリラグ）
box(room, 16.6, 0.3, 12.6, '#454c68', 0, -0.15, 0, { noCast: true });
box(room, 9.6, 0.06, 7.2, '#a5814f', -3, 0.03, -0.4, { noCast: true });
box(room, 5.2, 0.06, 5.0, '#4c688f', 5.5, 0.03, 2.9, { noCast: true });

// 壁
box(room, 16.6, 2.6, 0.3, '#575f85', 0, 1.3, -6.35);
box(room, 0.3, 2.6, 12.6, '#505878', -8.35, 1.3, 0);

// 窓 = 星空
for (const wx of [-4.5, 0.5, 5.5]) {
  box(room, 2.2, 1.3, 0.1, glow('#141c3a', 0.5), wx, 1.55, -6.22, { noCast: true });
  for (let i = 0; i < 6; i++) {
    const sx = wx - 0.9 + ((i * 37) % 18) / 10;
    const sy = 1.15 + ((i * 53) % 11) / 10;
    box(room, 0.045, 0.045, 0.02, glow('#fff6d8', 1.6), sx, sy, -6.16, { noCast: true });
  }
}
box(room, 0.1, 1.3, 2.2, glow('#141c3a', 0.5), -8.22, 1.55, 2.5, { noCast: true });
box(room, 0.02, 0.05, 0.05, glow('#fff6d8', 1.6), -8.16, 1.8, 2.2, { noCast: true });
box(room, 0.02, 0.05, 0.05, glow('#fff6d8', 1.6), -8.16, 1.3, 3.0, { noCast: true });

// ストリングライト（奥の壁にゆるく垂れる電飾）
const STRING_COLORS = ['#ffd9a0', '#f8a8c8', '#a8d8f8', '#c8f0b0'];
const stringBulbs = [];
for (let i = 0; i < 14; i++) {
  const x = -7.4 + i * 1.08;
  const y = 2.35 - Math.sin((i / 13) * Math.PI) * 0.28;
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), glow(STRING_COLORS[i % 4], 1.4));
  b.position.set(x, y, -6.14);
  room.add(b);
  stringBulbs.push(b);
}

// ホワイトボード
box(room, 2.6, 1.4, 0.08, '#d8dce8', -2, 1.5, -6.18);
box(room, 1.6, 0.08, 0.02, '#5aa2d0', -2.3, 1.75, -6.13, { noCast: true });
box(room, 1.2, 0.08, 0.02, '#e07979', -2.4, 1.45, -6.13, { noCast: true });
box(room, 1.8, 0.08, 0.02, '#68b877', -2.2, 1.15, -6.13, { noCast: true });

// --- 机 ×6（モニタ・キーボード・椅子・デスクランプ） ---
const DESKS = [];
const lamps = [];
for (const dz of [-2.4, 1.0]) {
  for (const dx of [-6.0, -3.2, -0.4]) {
    const g = new THREE.Group();
    g.position.set(dx, 0, dz);
    box(g, 1.7, 0.12, 0.95, '#a87d4e', 0, 0.78, 0);
    for (const [lx, lz] of [[-0.75, -0.35], [0.75, -0.35], [-0.75, 0.35], [0.75, 0.35]])
      box(g, 0.09, 0.75, 0.09, '#7a5836', lx, 0.375, lz);
    box(g, 0.72, 0.46, 0.06, '#2c3244', 0, 1.28, -0.18);                    // モニタ
    const screen = box(g, 0.62, 0.36, 0.02, glow('#9fdcff', 0.8), 0, 1.28, -0.14, { noCast: true });
    box(g, 0.1, 0.18, 0.08, '#2c3244', 0, 0.93, -0.2);
    box(g, 0.55, 0.04, 0.22, '#3a415c', 0, 0.86, 0.18);                     // キーボード
    box(g, 0.5, 0.09, 0.5, '#5c6788', 0, 0.42, 0.85);                       // 椅子
    box(g, 0.5, 0.55, 0.09, '#5c6788', 0, 0.75, 1.08);
    // デスクランプ（使用中だけ点灯）
    box(g, 0.07, 0.5, 0.07, '#2c3244', 0.68, 1.09, 0.05);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.2, 10), mat('#2c3244'));
    shade.position.set(0.6, 1.36, 0.02); shade.rotation.z = 0.7; shade.castShadow = true;
    g.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), glow('#ffd9a0', 0));
    bulb.position.set(0.52, 1.28, 0);
    g.add(bulb);
    const light = new THREE.PointLight('#ffc98a', 0, 4.2, 1.7);
    light.position.set(0.5, 1.35, 0.1);
    g.add(light);
    room.add(g);
    DESKS.push({ x: dx, z: dz + 0.85 });
    lamps.push({ light, bulb, screen });
  }
}

// --- サーバーラック（LED 明滅） ---
const leds = [];
{
  const g = new THREE.Group(); g.position.set(-7.3, 0, -5.3); room.add(g);
  box(g, 1.1, 2.0, 0.85, '#3a415c', 0, 1.0, 0);
  for (let i = 0; i < 4; i++) {
    box(g, 0.8, 0.16, 0.05, '#2c3244', 0, 0.5 + i * 0.42, 0.45, { noCast: true });
    leds.push(box(g, 0.08, 0.08, 0.03, glow('#7ef2a0', 1), 0.32, 0.52 + i * 0.42, 0.47, { noCast: true }));
  }
}

// --- 休憩コーナー（暖色スポットライト付き） ---
{
  const g = new THREE.Group(); g.position.set(6.4, 0, -5.4); room.add(g);
  box(g, 2.4, 0.85, 0.85, '#8a7a5e', 0.4, 0.425, 0);
  box(g, 0.5, 0.65, 0.5, '#454c66', 0.9, 1.18, 0);
  box(g, 0.16, 0.14, 0.16, '#e8e0d2', 0.9, 0.92, 0.28, { noCast: true });
  box(g, 1.0, 1.9, 0.75, '#8a4a52', -1.3, 0.95, 0);                          // 自販機
  box(g, 0.7, 0.9, 0.05, glow('#f8c0b0', 0.6), -1.3, 1.25, 0.39, { noCast: true });
  const spot = new THREE.PointLight('#ffbf80', 5, 5.5, 1.7);                  // 暖色スポット
  spot.position.set(0.4, 2.6, 0.4);
  g.add(spot);
}

// --- ライブラリ: 本棚 ×2 + ソファ ---
const BOOKS = ['#c96a6a', '#5a8ec0', '#5da46c', '#c9a84e', '#8a64b8'];
for (const sz of [0.8, 3.2]) {
  const g = new THREE.Group(); g.position.set(7.9, 0, sz); g.rotation.y = -Math.PI / 2; room.add(g);
  box(g, 2.0, 1.9, 0.45, '#7a5836', 0, 0.95, 0);
  for (let row = 0; row < 3; row++)
    for (let i = 0; i < 6; i++)
      box(g, 0.22, 0.42, 0.08, BOOKS[(row + i) % 5], -0.75 + i * 0.3, 0.42 + row * 0.55, 0.24, { noCast: true });
}
{
  const g = new THREE.Group(); g.position.set(4.6, 0, 4.4); room.add(g);
  box(g, 2.2, 0.42, 0.95, '#b06888', 0, 0.21, 0);
  box(g, 2.2, 0.6, 0.25, '#9c5a78', 0, 0.6, -0.35);
  box(g, 0.28, 0.62, 0.95, '#9c5a78', -1.05, 0.31, 0);
  box(g, 0.28, 0.62, 0.95, '#9c5a78', 1.05, 0.31, 0);
  const read = new THREE.PointLight('#ffcf9a', 2.5, 4, 1.7);                  // 読書灯
  read.position.set(1.6, 2.2, -0.4);
  g.add(read);
}

// --- 観葉植物 ×4 ---
for (const [px, pz] of [[-7.6, 5.4], [1.6, -5.6], [7.6, -1.6], [-1.8, 5.5]]) {
  const g = new THREE.Group(); g.position.set(px, 0, pz); room.add(g);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.4, 8), mat('#8a5a3e'));
  pot.position.y = 0.2; pot.castShadow = true; g.add(pot);
  const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), mat('#3d7050'));
  leaf.position.y = 0.75; leaf.castShadow = true; g.add(leaf);
  const leaf2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), mat('#325c42'));
  leaf2.position.y = 1.1; leaf2.castShadow = true; g.add(leaf2);
}

// --- ドア（左寄せ: 承認待ちリング等と被らないように） ---
box(room, 0.14, 2.1, 0.9, '#7a5836', -6.5, 1.05, 6.1);
box(room, 0.14, 2.1, 0.9, '#7a5836', -4.5, 1.05, 6.1);
box(room, 2.14, 0.18, 0.9, '#7a5836', -5.5, 2.16, 6.1);

// ---------- 行き先 ----------
const DOOR = { x: -5.5, z: 5.8 };
const SPOTS = {
  searching: { x: 6.6, z: 2.0 },
  reading:   { x: 4.6, z: 3.3 },
  running:   { x: -6.2, z: -4.3 },
  planning:  { x: -2.0, z: -4.8 },
  delegating:{ x: 2.4, z: 3.6 },
  waiting:   { x: 1.2, z: 4.8 },
  idle:      { x: 5.8, z: -3.9 },
  ended:     DOOR,
};

// ---------- キャラクター ----------
const SKIN = '#f2cba4';
const HAIR = ['#4a3628', '#7a5230', '#d8b06a', '#4a5478', '#98564a', '#3d5c4a'];
const SHIRT = ['#e07979', '#5aa2d0', '#68b877', '#e5c04e', '#9a6fd0', '#ef9d5f'];
const hash = (s) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0);

function buildChar(h) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.3, 4, 10), mat(SHIRT[(h >> 3) % SHIRT.length]));
  body.position.y = 0.48; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 14, 12), mat(SKIN));
  head.position.y = 0.98; head.castShadow = true; g.add(head);
  const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.245, 14, 12), mat(HAIR[h % HAIR.length]));
  hairM.position.y = 1.04; hairM.scale.set(1, 0.72, 1); hairM.castShadow = true; g.add(hairM);
  for (const ex of [-0.085, 0.085]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 6), mat('#2a2a33'));
    eye.position.set(ex, 0.99, 0.2); g.add(eye);
  }
  g.scale.setScalar(1.18);
  scene.add(g);
  return g;
}

// ---------- 3D 吹き出し（コンパクト一行: 名前 + 状態） ----------
const ACT_COLOR = {
  coding: '#7ee2a8', reading: '#8fd0f8', searching: '#c9a7f0', running: '#f8b57e',
  delegating: '#f8a8c8', planning: '#f2d878', thinking: '#aab8d8', waiting: '#ff9090',
  idle: '#d8c8b0', ended: '#8a90a8',
};

function makeBubbleTexture(project, label, activity) {
  const SS = 3; // スーパーサンプリング（高解像度で描いて縮小 → くっきり）
  const H = 56, r = 24;
  const measure = document.createElement('canvas').getContext('2d');
  const nameFont = '700 26px "Zen Maru Gothic", sans-serif';
  const stFont = '700 21px "Zen Maru Gothic", sans-serif';
  const name = project.length > 16 ? project.slice(0, 15) + '…' : project;
  measure.font = nameFont; const w1 = measure.measureText(name).width;
  measure.font = stFont; const w2 = measure.measureText(label).width;
  const W = Math.ceil(w1 + w2 + 46);

  const cv = document.createElement('canvas');
  cv.width = W * SS; cv.height = H * SS;
  const c = cv.getContext('2d');
  c.scale(SS, SS);
  const waiting = activity === 'waiting';
  c.fillStyle = waiting ? 'rgba(120,28,28,.92)' : 'rgba(16,20,38,.82)';
  c.beginPath(); c.roundRect(2, 2, W - 4, H - 4, r); c.fill();
  if (waiting) { c.strokeStyle = '#ff9090'; c.lineWidth = 3; c.stroke(); }
  c.textBaseline = 'middle';
  c.fillStyle = '#f4efe2';
  c.font = nameFont;
  c.fillText(name, 18, H / 2 + 1);
  c.fillStyle = ACT_COLOR[activity] || '#aab8d8';
  c.font = stFont;
  c.fillText(label, 18 + w1 + 12, H / 2 + 2);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return { tex, aspect: W / H };
}

function setBubble(ch) {
  const key = `${ch.project}|${ch.label}|${ch.activity}`;
  if (ch.bubbleKey === key) return;
  ch.bubbleKey = key;
  const { tex, aspect } = makeBubbleTexture(ch.project || '', ch.label || '', ch.activity);
  if (!ch.bubble) {
    ch.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    ch.bubble.position.y = 2.0;
    ch.mesh.add(ch.bubble);
  } else {
    ch.bubble.material.map.dispose();
    ch.bubble.material.map = tex;
    ch.bubble.material.needsUpdate = true;
  }
  const h = 1.0;
  ch.bubble.scale.set(h * aspect, h, 1);
}

// ---------- セッション管理 ----------
const ACTIVE = new Set(['coding', 'reading', 'searching', 'running', 'delegating', 'planning', 'thinking']);
const chars = new Map();
const seatOf = new Map();

function deskSeat(id) {
  if (seatOf.has(id)) return seatOf.get(id);
  const used = new Set(seatOf.values());
  let idx = DESKS.findIndex((_, i) => !used.has(i));
  if (idx === -1) idx = hash(id) % DESKS.length;
  seatOf.set(id, idx);
  return idx;
}

function targetFor(s) {
  if (s.activity === 'coding') { const d = DESKS[deskSeat(s.session_id)]; return { x: d.x, z: d.z }; }
  if (s.activity === 'thinking') return null;
  const base = SPOTS[s.activity];
  if (!base) return null;
  if (s.activity !== 'ended') seatOf.delete(s.session_id);
  const j = (hash(s.session_id) % 5 - 2) * 0.45;
  return { x: base.x + j, z: base.z };
}

function upsert(s) {
  let ch = chars.get(s.session_id);
  if (!ch) {
    const h = hash(s.session_id);
    ch = { id: s.session_id, mesh: buildChar(h), x: DOOR.x, z: DOOR.z, tx: DOOR.x, ty: DOOR.z, seed: h % 10, leaving: false };
    ch.mesh.position.set(DOOR.x, 0, DOOR.z);
    ch.mesh.userData.sid = s.session_id;
    // 承認待ちリング（足元で脈打つ）
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.5, 24),
      new THREE.MeshBasicMaterial({ color: '#ff8a70', transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    ring.visible = false;
    ch.mesh.add(ring);
    ch.ring = ring;
    chars.set(s.session_id, ch);
  }
  ch.activity = s.activity;
  ch.project = s.project;
  ch.label = s.label;
  ch.detail = s.detail || '';
  ch.host = s.host || '';
  ch.updated = s.updated_at || Date.now();
  ch.leaving = s.activity === 'ended';
  ch.ring.visible = s.activity === 'waiting';
  syncSatellites(ch, (s.subagents || []).filter((x) => x.status === 'running').length);
  setBubble(ch);
  const t = targetFor(s);
  if (t) { ch.tx = t.x; ch.ty = t.z; }
}

function remove(id) {
  const ch = chars.get(id);
  if (ch) scene.remove(ch.mesh);
  chars.delete(id);
  seatOf.delete(id);
}
function reset() { for (const id of [...chars.keys()]) remove(id); }

// 稼働中サブエージェントの数だけ、親キャラの周りを回る小さな子分を用意する
const SAT_MAT = new THREE.MeshStandardMaterial({ color: '#f8a8c8', emissive: '#f8a8c8', emissiveIntensity: 0.5, roughness: 0.6 });
function syncSatellites(ch, n) {
  ch.sats = ch.sats || [];
  while (ch.sats.length < n) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 10), SAT_MAT);
    s.castShadow = true;
    ch.mesh.add(s);
    ch.sats.push(s);
  }
  while (ch.sats.length > n) ch.mesh.remove(ch.sats.pop());
}

// ---------- メインループ ----------
const clock = new THREE.Clock();
const SPEED = 2.2;
function tick() {
  requestAnimationFrame(tick);
  if (!wrap.clientWidth) return; // オフィステーマ以外（親が display:none）では描画しない
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = performance.now();

  // 使用中の机だけランプ点灯（モニタも明るく）
  const used = new Set(seatOf.values());
  lamps.forEach((l, i) => {
    const on = used.has(i);
    l.light.intensity += ((on ? 6 : 0) - l.light.intensity) * 0.12; // ふわっと点灯/消灯
    l.bulb.material.emissiveIntensity = l.light.intensity / 4;
    l.screen.material.emissiveIntensity = on ? 1.1 : 0.35;
  });
  // サーバーLED明滅・電飾ゆらぎ
  leds.forEach((m, i) => { m.material.emissiveIntensity = 0.9 + Math.sin(t / 380 + i * 1.7) * 0.7; });
  stringBulbs.forEach((m, i) => { m.material.emissiveIntensity = 1.25 + Math.sin(t / 900 + i) * 0.35; });
  // 承認待ちリングの脈動
  for (const ch of chars.values()) {
    if (ch.ring.visible) {
      const p = 1 + Math.sin(t / 180) * 0.22;
      ch.ring.scale.set(p, p, 1);
      ch.ring.material.opacity = 0.55 + Math.sin(t / 180) * 0.35;
    }
  }

  for (const ch of [...chars.values()]) {
    const dx = ch.tx - ch.x, dz = ch.ty - ch.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.08) {
      ch.x += (dx / d) * SPEED * dt;
      ch.z += (dz / d) * SPEED * dt;
      ch.mesh.rotation.y = Math.atan2(dx, dz);
      ch.mesh.position.y = Math.abs(Math.sin(t / 110)) * 0.09;
    } else if (ch.leaving) { remove(ch.id); continue; }
    else {
      ch.mesh.position.y = ACTIVE.has(ch.activity) ? Math.sin(t / 300 + ch.seed) * 0.03 + 0.03 : 0;
      if (ch.activity === 'coding') ch.mesh.rotation.y = Math.PI;
    }
    ch.mesh.position.x = ch.x;
    ch.mesh.position.z = ch.z;
    // 子分（サブエージェント）を頭の周りで公転させる
    if (ch.sats && ch.sats.length) {
      const R = 0.5, n = ch.sats.length;
      ch.sats.forEach((s, i) => {
        const a = t / 620 + (i / n) * Math.PI * 2;
        s.position.set(Math.cos(a) * R, 1.35 + Math.sin(t / 300 + i) * 0.06, Math.sin(a) * R);
      });
    }
  }
  renderer.render(scene, camera);
}
tick();

// ---------- クリック / ホバー（アバター選択） ----------
// 詳細パネル自体は index.html 側の共通実装（管制室と共用）を呼ぶ
const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function pick(e) {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hits = ray.intersectObjects([...chars.values()].map((c) => c.mesh), true);
  if (!hits.length) return null;
  let o = hits[0].object;
  while (o && !o.userData.sid) o = o.parent;
  return o ? chars.get(o.userData.sid) : null;
}

renderer.domElement.addEventListener('click', (e) => {
  const ch = pick(e);
  if (ch) window.showSessionPanel?.(ch.id); else window.hideSessionPanel?.();
});
// ダブルクリックで即エディタへジャンプ
renderer.domElement.addEventListener('dblclick', (e) => {
  const ch = pick(e);
  if (ch) fetch('/focus-session', { method: 'POST', body: JSON.stringify({ session_id: ch.id }) });
});
let hoverT = 0;
renderer.domElement.addEventListener('mousemove', (e) => {
  const now = performance.now();
  if (now - hoverT < 80) return;
  hoverT = now;
  renderer.domElement.style.cursor = pick(e) ? 'pointer' : 'default';
});

window.Office = { upsert, remove, reset };
window.dispatchEvent(new Event('office-ready'));
