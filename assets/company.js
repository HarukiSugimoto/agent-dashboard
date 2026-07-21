// バーチャルオフィス「AI カンパニー」 (three.js / 夜 / 正面パース)
// 1 セッション = 1 社員ロボット = 1 個室。状態はカード型吹き出しと頭上アイコンで伝える。
// モデルは assets/models/ のカタログ品(GLB/FBX)を読み込んで使用。
// 照明は夜: 各個室の暖色灯 + 発光スクリーン/サイネージ + 弱い月光。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';

const wrap = document.getElementById('companyWrap');
const INIT_UNTIL = performance.now() + 2500;

// ---------- シーン ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0e1322');
scene.fog = new THREE.Fog('#0e1322', 30, 62);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
wrap.prepend(renderer.domElement);

// 夜なので環境光(IBL)は弱めに。反射の質感づけ程度に使う
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.4;

// ---------- 正面パースカメラ（引き気味の俯瞰。オフィス全体が収まる） ----------
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
const CAM_POS = new THREE.Vector3(0, 11.5, 17.5);
const CAM_TGT = new THREE.Vector3(0, 0.6, -3.2);
camera.position.copy(CAM_POS);
camera.lookAt(CAM_TGT);

// 水平FOVを固定 → ウィンドウが縦長でも横（左右の窓・草木）が切れない
const H_FOV = 62 * Math.PI / 180;
const headerEl = document.querySelector('header');
function resize() {
  wrap.style.top = headerEl.offsetHeight + 14 + 'px';
  const w = wrap.clientWidth || innerWidth;
  const h = wrap.clientHeight || innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(H_FOV / 2) / camera.aspect));
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(wrap);
resize();

// ---------- 夜のライティング（灯りの点いた夜オフィス: 暗すぎず視認性優先） ----------
scene.add(new THREE.HemisphereLight('#8a94c0', '#2a2c3a', 0.7));
scene.add(new THREE.AmbientLight('#6a72a0', 0.35));
// 天井の暖色フィル（室内全体を灯す）
for (const fx of [-5, 5]) { const p = new THREE.PointLight('#ffe0b8', 1.3, 26, 1.6); p.position.set(fx, 5.2, -1); scene.add(p); }
const moon = new THREE.DirectionalLight('#b9c6f0', 0.7);
moon.position.set(6, 16, 8);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
moon.shadow.bias = -0.0004;
moon.shadow.normalBias = 0.02;
Object.assign(moon.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 48 });
scene.add(moon);

// ---------- ヘルパー ----------
const pbr = (c, opts = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0.0, ...opts });
function box(parent, w, h, d, m, x, y, z, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof m === 'string' ? pbr(m) : m);
  mesh.position.set(x, y, z);
  mesh.castShadow = opts.noCast !== true;
  mesh.receiveShadow = true;
  if (opts.ry) mesh.rotation.y = opts.ry;
  parent.add(mesh);
  return mesh;
}
const trunc = (s, n) => { s = s || ''; return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const lerpAngle = (a, b, k) => { const d = (b - a + Math.PI * 3) % (Math.PI * 2) - Math.PI; return a + d * k; };

// モデルを目標の高さに正規化し、床(y=0)に接地・水平中心に揃えたグループを返す
function normalize(obj, targetH) {
  const box0 = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3(); box0.getSize(size);
  const s = targetH / (size.y || 1);
  obj.scale.setScalar(s);
  obj.updateMatrixWorld(true);
  const box1 = new THREE.Box3().setFromObject(obj);
  const c = new THREE.Vector3(); box1.getCenter(c);
  obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= box1.min.y;
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const g = new THREE.Group(); g.add(obj);
  return g;
}

// ---------- 色 ----------
const ACT_COLOR = {
  coding: '#3fb877', reading: '#3f9ee0', searching: '#9a6fe0', running: '#ef8f4c',
  delegating: '#e86fa6', planning: '#d6b23f', thinking: '#8a97b8', waiting: '#e84c4c',
  idle: '#b0a084', ended: '#9aa0b4',
};
const ACT_INK = {
  coding: '#2f9e66', reading: '#2e86c4', searching: '#8a5fd0', running: '#d97f2e',
  delegating: '#d8558c', planning: '#b8952a', thinking: '#5c6e94', waiting: '#d84a4a',
  idle: '#8a7a5e', ended: '#7a8096',
};
const ROOM_TINT = ['#4db38a', '#6f8ce0', '#e89a5c', '#5cb0d8', '#e07aa8', '#d6b84e', '#8f7ad8', '#61c090'];
const ACTIVE = new Set(['coding', 'reading', 'searching', 'running', 'delegating', 'planning', 'thinking']);
const hash = (s) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0);

// ---------- 部屋の外殻 ----------
const room = new THREE.Group();
scene.add(room);

// 床
const floorTex = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 512;
  const c = cv.getContext('2d');
  c.fillStyle = '#2b3040'; c.fillRect(0, 0, 512, 512);
  c.strokeStyle = '#232838'; c.lineWidth = 5;
  for (let i = 0; i <= 512; i += 128) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 512); c.stroke(); c.beginPath(); c.moveTo(0, i); c.lineTo(512, i); c.stroke(); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 5);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
})();
const floor = new THREE.Mesh(new THREE.PlaneGeometry(22, 18), pbr('#2b3040', { roughness: 0.7, metalness: 0.1, map: floorTex }));
floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, 0.5); floor.receiveShadow = true;
room.add(floor);
// 中央通路
const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 13), pbr('#39415c', { roughness: 0.95 }));
rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.01, 2.2); rug.receiveShadow = true;
room.add(rug);

// 外壁（奥 + 左右）夜色
box(room, 22, 6, 0.3, '#20263a', 0, 3, -8.4);
box(room, 0.3, 6, 18, '#1c2236', -10.9, 3, 0.5);
box(room, 0.3, 6, 18, '#1c2236', 10.9, 3, 0.5);

// 窓 = 夜景（発光パネル + 窓枠 + ビルの灯り）
function nightWindow(parent, w, h, x, y, z, ry) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; parent.add(g);
  box(g, w, h, 0.08, new THREE.MeshStandardMaterial({ color: '#16203e', emissive: '#22335f', emissiveIntensity: 0.9, roughness: 1 }), 0, 0, 0, { noCast: true });
  // ビルの窓明かり
  for (let i = 0; i < 26; i++) {
    const lx = (Math.random() - 0.5) * (w - 0.3);
    const ly = (Math.random() - 0.5) * (h - 0.3);
    const on = Math.random() > 0.35;
    box(g, 0.09, 0.13, 0.02, new THREE.MeshStandardMaterial({ color: '#000', emissive: on ? '#ffd88a' : '#3a4a70', emissiveIntensity: on ? 1.4 : 0.5, roughness: 1 }), lx, ly, 0.05, { noCast: true });
  }
  box(g, w + 0.2, 0.12, 0.12, '#2a3350', 0, h / 2 + 0.06, 0.02);
  box(g, w + 0.2, 0.12, 0.12, '#2a3350', 0, -h / 2 - 0.06, 0.02);
}
for (const wx of [-6.2, 6.2]) nightWindow(room, 3.4, 2.6, wx, 3.4, -8.24, 0);
for (const wz of [3.2, 6.4]) { nightWindow(room, 3.0, 2.4, -10.74, 3.2, wz, Math.PI / 2); nightWindow(room, 3.0, 2.4, 10.74, 3.2, wz, -Math.PI / 2); }

// ---------- サイネージ ----------
box(room, 8.4, 2.7, 0.16, '#0b0f1c', 0, 3.5, -8.24);
// サイネージ縁の間接光（おしゃれ用のグロー帯）
box(room, 8.7, 0.1, 0.12, new THREE.MeshStandardMaterial({ color: '#4de3a8', emissive: '#4de3a8', emissiveIntensity: 1.2, roughness: 0.5 }), 0, 4.95, -8.18, { noCast: true });
box(room, 8.7, 0.1, 0.12, new THREE.MeshStandardMaterial({ color: '#4de3a8', emissive: '#4de3a8', emissiveIntensity: 1.2, roughness: 0.5 }), 0, 2.05, -8.18, { noCast: true });
// サイネージ本文は HTML オーバーレイ(#companySign)でくっきり表示。板の矩形を毎フレーム投影して重ねる。
const SIGN = { c: new THREE.Vector3(0, 3.5, -8.16), hw: 4.0, hh: 1.275 };
const signEl = document.getElementById('companySign');
const signStatsEl = signEl && signEl.querySelector('.sign-stats');
let signKey = '';
function drawSignage() {
  if (!signStatsEl) return;
  let act = 0, wait = 0, total = 0;
  for (const ch of chars.values()) { if (ch.leaving) continue; total++; if (ACTIVE.has(ch.activity)) act++; if (ch.activity === 'waiting') wait++; }
  const key = `${act}|${wait}|${total}`;
  if (key === signKey) return;
  signKey = key;
  signStatsEl.innerHTML = `<span class="s-run">稼働 ${act}</span><span class="s-wait">待ち ${wait}</span><span class="s-seat">在席 ${total}</span>`;
}
// 板の矩形を画面に投影して DOM の位置・サイズ・文字サイズを合わせる
const _s0 = new THREE.Vector3(), _sR = new THREE.Vector3(), _sT = new THREE.Vector3();
function positionSign() {
  if (!signEl) return;
  const rect = renderer.domElement.getBoundingClientRect();
  _s0.copy(SIGN.c).project(camera);
  if (_s0.z > 1) { signEl.style.display = 'none'; return; }
  signEl.style.display = '';
  _sR.set(SIGN.c.x + SIGN.hw, SIGN.c.y, SIGN.c.z).project(camera);
  _sT.set(SIGN.c.x, SIGN.c.y + SIGN.hh, SIGN.c.z).project(camera);
  const cx = rect.left + (_s0.x * 0.5 + 0.5) * rect.width;
  const cy = rect.top + (-_s0.y * 0.5 + 0.5) * rect.height;
  const halfW = Math.abs((_sR.x - _s0.x) * 0.5) * rect.width;
  const halfH = Math.abs((_sT.y - _s0.y) * 0.5) * rect.height;
  signEl.style.left = (cx - halfW) + 'px';
  signEl.style.top = (cy - halfH) + 'px';
  signEl.style.width = (halfW * 2) + 'px';
  signEl.style.height = (halfH * 2) + 'px';
  signEl.style.fontSize = (halfW * 2 / 15) + 'px';
}

// ================= モデル読込 =================
const FORCE_FALLBACK = new URLSearchParams(location.search).has('fallback');
const MODELS = {
  worker: FORCE_FALLBACK ? { url: '/assets/models/RobotExpressive.glb', h: 1.6 } : { url: '/assets/models/worker-robot.glb', h: 1.55 },
  workerFallback: { url: '/assets/models/RobotExpressive.glb', h: 1.6 },
  reception: { url: '/assets/models/reception-desk.glb', h: 2.0 },
  desk: { url: '/assets/models/standing-desk.glb', h: 1.15 },
  plant: { url: '/assets/models/house-plant.glb', h: 1.5 },
  pot: { url: '/assets/models/flower-pot.glb', h: 0.42 },
};
const proto = {};
const gltfLoader = new GLTFLoader();
try { gltfLoader.setMeshoptDecoder(MeshoptDecoder); } catch (e) { console.warn('[company] meshopt設定失敗', e); }
const fbxLoader = new FBXLoader();
const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + label)), ms))]);
const loadGLTF = (u) => new Promise((res, rej) => gltfLoader.load(u, (g) => res(g), undefined, rej));
const loadFBX = (u) => new Promise((res, rej) => fbxLoader.load(u, (o) => res(o), undefined, rej));

let ready = false;
const pending = [];
// 読み込み状況を画面に出す（デバッグ用オーバーレイ。?debug で表示）
const dbg = new URLSearchParams(location.search).has('debug') ? (() => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9;font:12px monospace;color:#8fe;background:rgba(0,0,0,.5);padding:6px 9px;border-radius:6px;white-space:pre';
  document.body.appendChild(d); return d;
})() : null;
const status = {};
function showStatus() { if (dbg) dbg.textContent = Object.entries(status).map(([k, v]) => `${k}: ${v}`).join('\n'); }
async function loadOne(key, spec) {
  status[key] = '…'; showStatus();
  const t0 = performance.now();
  try {
    const p = spec.fbx ? loadFBX(spec.url) : loadGLTF(spec.url).then((g) => g.scene);
    const obj = await withTimeout(p, 10000, key);
    proto[key] = { norm: normalize(obj, spec.h), anims: spec.fbx ? obj.animations : null };
    status[key] = `OK ${Math.round(performance.now() - t0)}ms`;
  } catch (e) { console.warn('[company] load失敗', key, spec.url, e); proto[key] = null; status[key] = 'FAIL ' + (e?.message || e); }
  showStatus();
}
const instance = (key) => proto[key] ? skClone(proto[key].norm) : new THREE.Group();
// 構成の初期化・モデル読込は、必要な定義がすべて出そろう末尾(initCompany)で実行する。

// ================= レイアウト（リファレンス準拠） =================
// 奥中央=サイネージ / その真下=秘書デスク / 秘書の左右=オープン机 /
// さらに手前=区切られた個室 / 中央手前=ラウンジ。
const rooms = []; // ワークステーション記述子（オープン机 と 個室 の両方をここに積む）
const ROOM_W = 3.2, ROOM_D = 3.0, WALL_H = 1.6;

// L字パーティション（奥壁＋外側の側壁）。直角の角は45°に面取り。side:-1=左列,+1=右列。
function lPartition(g, tint, side) {
  const wallM = pbr('#333c56', { roughness: 0.9 });
  const accent = new THREE.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: 0.5, roughness: 0.5 });
  const hw = ROOM_W / 2, hd = ROOM_D / 2, ch = 0.85;
  const backLen = ROOM_W - ch, backCx = -side * ch / 2;
  box(g, backLen, WALL_H, 0.12, wallM, backCx, WALL_H / 2, -hd);                          // 奥壁
  box(g, backLen, 0.1, 0.14, accent, backCx, WALL_H - 0.1, -hd + 0.02, { noCast: true });
  const sideLen = ROOM_D - ch;
  box(g, 0.12, WALL_H, sideLen, wallM, side * hw, WALL_H / 2, ch / 2);                     // 外側の側壁
  box(g, 0.14, 0.1, sideLen, accent, side * hw, WALL_H - 0.1, ch / 2, { noCast: true });
  const cham = box(g, ch * Math.SQRT2 + 0.1, WALL_H, 0.12, wallM, side * (hw - ch / 2), WALL_H / 2, -hd + ch / 2); // 面取り
  cham.rotation.y = -side * Math.PI / 4;
  const chamA = box(g, ch * Math.SQRT2 + 0.1, 0.1, 0.14, accent, side * (hw - ch / 2), WALL_H - 0.1, -hd + ch / 2, { noCast: true });
  chamA.rotation.y = -side * Math.PI / 4;
}

// 1席ぶんの机＋モニタ（＋個室なら壁）。ロボは机の奥側に立ちカメラを向く。
// 机はまず procedural プレースホルダで置き、standing-desk モデルが届いたら差し替える。
function buildStation(cx, cz, walls, i) {
  const g = new THREE.Group(); g.position.set(cx, 0, cz); room.add(g);
  const tint = ROOM_TINT[i % ROOM_TINT.length];
  // procedural 机（プレースホルダ）
  const deskPh = new THREE.Group(); deskPh.position.set(0, 0, 0.35); g.add(deskPh);
  box(deskPh, 1.5, 0.08, 0.8, pbr('#c39a68', { roughness: 0.5 }), 0, 0.74, 0, { noCast: true });
  for (const [lx, lz] of [[-0.65, -0.3], [0.65, -0.3], [-0.65, 0.3], [0.65, 0.3]]) box(deskPh, 0.07, 0.72, 0.07, '#7a5836', lx, 0.37, lz);
  // モニタ（画面はカメラを向く＝発光が見える）
  const screenMat = new THREE.MeshStandardMaterial({ color: '#0f1830', emissive: '#7ec8ff', emissiveIntensity: 0.6, roughness: 0.3 });
  box(g, 0.9, 0.56, 0.05, pbr('#20242e', { metalness: 0.3, roughness: 0.4 }), 0, 1.48, 0.6);
  box(g, 0.78, 0.44, 0.02, screenMat, 0, 1.48, 0.63, { noCast: true });
  const progBg = box(g, 0.58, 0.09, 0.014, '#10202e', 0, 1.32, 0.645, { noCast: true });
  const fillGeom = new THREE.BoxGeometry(0.56, 0.06, 0.012); fillGeom.translate(0.28, 0, 0);
  const progFill = new THREE.Mesh(fillGeom, new THREE.MeshStandardMaterial({ color: '#58c98d', emissive: '#58c98d', emissiveIntensity: 1 }));
  progFill.position.set(-0.28, 1.32, 0.65); g.add(progFill);
  progBg.visible = progFill.visible = false;
  if (walls) lPartition(g, tint, cx < 0 ? 1 : -1); // 個室: L字＋角を面取り（左右反転: 壁は内側）
  else box(g, ROOM_W, 0.85, 0.12, pbr('#333c56', { roughness: 0.9 }), 0, 0.42, -ROOM_D / 2 + 0.35, { noCast: true }); // オープン机: 低い袖パネル
  const lamp = new THREE.PointLight('#ffcaa0', 0.9, 5, 2.2); lamp.position.set(0, 2.1, 0); g.add(lamp);
  const bulb = box(g, 0.4, 0.06, 0.4, new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#ffcf9a', emissiveIntensity: 0.3, roughness: 1 }), 0, 2.15, 0, { noCast: true });
  // ロボは机の後ろ（着席位置）。高い俯瞰カメラなので机ごしに上半身が見える
  const r = { g, deskPh, hasModelDesk: false, hasPot: false, pos: new THREE.Vector3(cx, 0, cz - 0.35), screenMat, progBg, progFill, lamp, bulb };
  rooms.push(r);
  fitDesk(r); fitPot(r); // 後から追加された席にも（モデル読込済みなら）机・鉢を入れる
}
// 1席ぶんに机モデル/鉢を差し込む（読込済みなら）
function fitDesk(r) { if (r.hasModelDesk || !proto.desk) return; r.hasModelDesk = true; r.deskPh.visible = false; const d = instance('desk'); d.position.set(0, 0, 0.35); r.g.add(d); }
function fitPot(r) { if (r.hasPot || !proto.pot) return; r.hasPot = true; const p = instance('pot'); p.position.set(0.62, 1.02, 0.5); r.g.add(p); }
function populateDesks() { for (const r of rooms) fitDesk(r); }
function populatePots() { for (const r of rooms) fitPot(r); }

// 席の位置生成。0..3=基本の4席（秘書の左右×上下）。5席目以降は外側の列→さらに奥へ自動拡張。
function slotAt(i) {
  const band = i % 2;                 // 0=上段(オープン机) 1=下段(L字個室)
  const pair = Math.floor(i / 2);
  const side = pair % 2 === 0 ? -1 : 1;
  const col = Math.floor(pair / 2);   // 0,1,2... 外側へ
  const x = side * (6.4 + col * 3.3);
  const z = (band === 0 ? -5.0 : 0.8) - Math.floor(col / 2) * 0.0; // 列が増えても同深度
  return { x, z, walls: band === 1 };
}
function ensureStations(n) {
  while (rooms.length < n) { const s = slotAt(rooms.length); buildStation(s.x, s.z, s.walls, rooms.length); }
}

function buildRooms() {
  ensureStations(4); // 基本の4席（左右×上下）。セッションが増えたら roomSeat が自動追加。
  buildLounge();
}

// 中央手前のラウンジ（procedural: ラグ + ソファ2 + 丸テーブル + ペンダント照明）
function buildLounge() {
  const g = new THREE.Group(); g.position.set(0, 0, 2.6); room.add(g);
  // 円形ラグ
  const rugMesh = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 0.03, 40), pbr('#334063', { roughness: 0.98 }));
  rugMesh.position.y = 0.02; rugMesh.receiveShadow = true; g.add(rugMesh);
  const sofaM = pbr('#3f5586', { roughness: 0.72 });
  const sofa = (sx, sz, ry) => {
    const s = new THREE.Group(); s.position.set(sx, 0, sz); s.rotation.y = ry; g.add(s);
    box(s, 1.7, 0.35, 0.7, sofaM, 0, 0.35, 0); box(s, 1.7, 0.5, 0.2, sofaM, 0, 0.6, -0.28);
    box(s, 0.2, 0.45, 0.7, sofaM, -0.78, 0.6, 0); box(s, 0.2, 0.45, 0.7, sofaM, 0.78, 0.6, 0);
    // クッション
    box(s, 0.55, 0.14, 0.5, pbr('#e0a86a', { roughness: 0.7 }), -0.42, 0.5, 0.02, { noCast: true });
    box(s, 0.55, 0.14, 0.5, pbr('#8fb0e0', { roughness: 0.7 }), 0.42, 0.5, 0.02, { noCast: true });
  };
  sofa(0, -1.15, 0); sofa(0, 1.15, Math.PI);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.08, 24), pbr('#c69a63', { roughness: 0.35, metalness: 0.1 }));
  top.position.y = 0.5; top.castShadow = true; top.receiveShadow = true; g.add(top);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.5, 12), pbr('#8a6a44'));
  leg.position.y = 0.25; g.add(leg);
  // ペンダント照明（2灯・暖色グロー）
  for (const px of [-1.0, 1.0]) {
    box(g, 0.02, 1.2, 0.02, '#2a3350', px, 3.4, 0, { noCast: true });
    const shadeMat = new THREE.MeshStandardMaterial({ color: '#3a3020', emissive: '#ffcf9a', emissiveIntensity: 0.9, roughness: 0.6 });
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.3, 16, 1, true), shadeMat);
    shade.position.set(px, 2.75, 0); shade.rotation.x = Math.PI; g.add(shade);
    const pl = new THREE.PointLight('#ffcf9a', 1.1, 6, 2); pl.position.set(px, 2.6, 0); g.add(pl);
  }
}

// 秘書デスク（受付）: 奥中央、サイネージの真下。まず procedural を置き、reception モデルで差し替え。
let receptionGroup = null, receptionPh = null;
function buildReception() {
  const g = new THREE.Group(); g.position.set(0, 0, -5.6); room.add(g);
  receptionGroup = g;
  receptionPh = new THREE.Group(); g.add(receptionPh); // procedural 代替（曲面カウンター風）
  const m = pbr('#e8eef6', { roughness: 0.5 });
  box(receptionPh, 2.8, 1.05, 0.4, m, 0, 0.52, 0.7); box(receptionPh, 0.4, 1.05, 1.4, m, -1.4, 0.52, 0.1); box(receptionPh, 0.4, 1.05, 1.4, m, 1.4, 0.52, 0.1);
  box(receptionPh, 3.0, 0.08, 0.5, pbr('#c69a63', { roughness: 0.4 }), 0, 1.08, 0.7, { noCast: true });
  const lamp = new THREE.PointLight('#ffd0a0', 1.8, 8, 2); lamp.position.set(0, 2.4, 0.6); g.add(lamp);
}
function swapReception() {
  if (!receptionGroup || !proto.reception) return;
  if (receptionPh) receptionPh.visible = false;
  receptionGroup.add(instance('reception'));
}
// 角の観葉（house-plant モデルが届いたら置く）
let plantsPlaced = false;
function placePlants() {
  if (plantsPlaced || !proto.plant) return;
  plantsPlaced = true;
  // 左右対称にせず、まばらに散らす（数・位置・サイズをランダム寄りに）
  const spots = [
    [-10.2, -6.6], [9.9, 5.2], [-10.4, 1.8], [7.4, -7.4],
    [-6.9, 7.6], [10.3, -2.3], [-2.6, 7.8], [3.1, -7.6], [10.1, 7.0],
  ];
  for (const [px, pz] of spots) {
    const p = instance('plant');
    p.scale.multiplyScalar(0.7 + Math.random() * 0.7);
    p.rotation.y = Math.random() * Math.PI * 2;
    p.position.set(px + (Math.random() - 0.5) * 0.6, 0, pz + (Math.random() - 0.5) * 0.6);
    room.add(p);
  }
}

// 秘書ロボット（受付の奥。飾り）
let secretaryBuilt = false;
function buildSecretary() {
  if (secretaryBuilt || !proto.worker) return;
  secretaryBuilt = true;
  const s = instance('worker');
  s.traverse((o) => { if (o.isMesh && o.material) { o.material = o.material.clone(); o.material.color.lerp(new THREE.Color('#8fb6e8'), 0.25); } });
  s.scale.multiplyScalar(1.7); // 秘書はさらに大きく
  s.position.set(0, 0, -6.6); s.rotation.y = 0;
  scene.add(s);
}

// 頭上アイコンは廃止（状態は吹き出しで表現。紛らわしい丸を削除）。

// ---------- 吹き出し = HTML オーバーレイ（ベクター文字でくっきり） ----------
// 3D空間のロボ頭上の位置を毎フレーム画面座標へ投影し、DOMカードを重ねる。
const labelLayer = document.getElementById('companyLabels');
const LABEL_Y = 2.45; // 頭上の高さ（ワールド）
let focusedLabelId = null; // クリックで前面に出す吹き出し
function updateLabel(ch) {
  if (!ch.mesh) return;
  let el = ch.labelEl;
  if (!el) {
    el = document.createElement('div');
    el.className = 'clbl';
    el.innerHTML = '<div class="clbl-in"><span class="clbl-tag"></span>' +
      '<div class="clbl-status"><span class="clbl-dot"></span><span class="clbl-label"></span></div>' +
      '<div class="clbl-bar"><i></i></div></div>';
    labelLayer.appendChild(el);
    ch.labelEl = el;
    // 吹き出しクリック → 前面に出す＋詳細パネルを開く
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      focusedLabelId = ch.id;
      window.showSessionPanel?.(ch.id);
    });
    ch._els = {
      tag: el.querySelector('.clbl-tag'), dot: el.querySelector('.clbl-dot'),
      label: el.querySelector('.clbl-label'),
      bar: el.querySelector('.clbl-bar'), fill: el.querySelector('.clbl-bar i'),
    };
  }
  const tok = ch.tokens;
  const pct = tok && tok.ctx > 0 ? Math.min(100, Math.round((tok.ctx / tok.ctxMax) * 100)) : null;
  const key = `${ch.project}|${ch.label}|${ch.activity}|${pct}`;
  if (ch.labelKey === key) return;
  ch.labelKey = key;
  const ink = ACT_INK[ch.activity] || '#5c6e94';
  const e = ch._els;
  e.tag.textContent = ch.project || ''; e.tag.style.background = ch.color;
  e.dot.style.background = ink;
  e.label.textContent = ch.label || ''; e.label.style.color = ink;
  if (pct != null) { e.bar.style.display = ''; e.fill.style.width = pct + '%'; e.fill.style.background = pct < 70 ? '#58c98d' : pct < 90 ? '#e5c04e' : '#ee5d5d'; }
  else e.bar.style.display = 'none';
  el.classList.toggle('wait', ch.activity === 'waiting');
}
function removeLabel(ch) { if (ch.labelEl) { ch.labelEl.remove(); ch.labelEl = null; } }
function refreshBubbles() { for (const ch of chars.values()) updateLabel(ch); }
// 毎フレーム、ラベルをロボ頭上の画面座標へ移動
const _lp = new THREE.Vector3();
function positionLabels() {
  const rect = renderer.domElement.getBoundingClientRect();
  for (const ch of chars.values()) {
    const el = ch.labelEl;
    if (!el) continue;
    if (!ch.mesh) { el.style.display = 'none'; continue; }
    _lp.set(ch.mesh.position.x, ch.mesh.position.y + LABEL_Y, ch.mesh.position.z).project(camera);
    if (_lp.z > 1) { el.style.display = 'none'; continue; }
    el.style.display = '';
    const x = rect.left + (_lp.x * 0.5 + 0.5) * rect.width;
    const y = rect.top + (-_lp.y * 0.5 + 0.5) * rect.height;
    el.style.transform = `translate(${x}px,${y}px)`;
    // 手前を上に。クリックで選ばれた吹き出しは最前面へ。
    el.style.zIndex = ch.id === focusedLabelId ? '9000' : String(3000 - Math.round(_lp.z * 1000));
  }
}

// ---------- サブエージェント（子分の小球） ----------
const SAT_MAT = new THREE.MeshStandardMaterial({ color: '#ef8ab5', emissive: '#ef8ab5', emissiveIntensity: 0.5, roughness: 0.5 });
function syncSatellites(ch, n) {
  if (!ch.mesh) { ch.satN = n; return; }
  ch.sats = ch.sats || [];
  while (ch.sats.length < n) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 12), SAT_MAT); s.castShadow = true; ch.mesh.add(s); ch.sats.push(s); }
  while (ch.sats.length > n) ch.mesh.remove(ch.sats.pop());
}

// ================= セッション管理 =================
const chars = new Map();
const roomOf = new Map();
function roomSeat(id) {
  if (roomOf.has(id)) return roomOf.get(id);
  const used = new Set(roomOf.values());
  let idx = rooms.findIndex((_, i) => !used.has(i));
  if (idx === -1) { ensureStations(rooms.length + 1); idx = rooms.length - 1; } // 席が足りなければ自動で増設
  roomOf.set(id, idx);
  return idx;
}

function buildCharMesh(ch) {
  const mesh = instance('worker');
  // 個体差: worker モデルのマテリアルをほんのり部屋色に寄せる
  mesh.traverse((o) => { if (o.isMesh && o.material) { o.material = o.material.clone(); o.material.color.lerp(new THREE.Color(ch.color), 0.18); } });
  const r = rooms[roomSeat(ch.id)];
  mesh.position.set(r.pos.x, 0, r.pos.z);
  mesh.rotation.y = 0; // カメラ向き
  mesh.userData.sid = ch.id;
  scene.add(mesh);
  ch.mesh = mesh;
  // FBX にアニメがあれば idle を回す
  if (proto.worker && proto.worker.anims && proto.worker.anims.length) {
    ch.mixer = new THREE.AnimationMixer(mesh);
    ch.mixer.clipAction(proto.worker.anims[0]).play();
  }
  // 承認待ちリング
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.62, 28), new THREE.MeshBasicMaterial({ color: '#ee5d5d', transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; ring.visible = ch.activity === 'waiting';
  mesh.add(ring); ch.ring = ring;
  syncSatellites(ch, ch.satN || 0);
  refreshBubbles();
}

function upsert(s) {
  let ch = chars.get(s.session_id);
  if (!ch) {
    const h = hash(s.session_id);
    ch = { id: s.session_id, color: ROOM_TINT[h % ROOM_TINT.length], seed: h % 10, mesh: null, satN: 0 };
    chars.set(s.session_id, ch);
  }
  ch.activity = s.activity;
  ch.project = s.project;
  ch.label = s.label;
  ch.detail = s.detail || '';
  ch.tokens = s.tokens;
  ch.leaving = s.activity === 'ended';
  const runningSubs = (s.subagents || []).filter((x) => x.status === 'running').length;

  if (!ch.mesh) {
    ch.satN = runningSubs;
    if (ready) buildCharMesh(ch); else if (!pending.includes(ch)) pending.push(ch);
  } else {
    if (ch.ring) ch.ring.visible = s.activity === 'waiting';
    syncSatellites(ch, runningSubs);
  }
  refreshBubbles();
  drawSignage();
}

function remove(id) {
  const ch = chars.get(id);
  if (ch) { if (ch.mixer) ch.mixer.stopAllAction(); if (ch.mesh) scene.remove(ch.mesh); removeLabel(ch); }
  chars.delete(id);
  roomOf.delete(id);
  drawSignage();
}
function reset() { for (const id of [...chars.keys()]) remove(id); }

// ================= メインループ =================
const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  if (!wrap.clientWidth) return;
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = performance.now();

  // 個室ごとの灯り・画面表現
  const occ = new Map();
  for (const [id, ri] of roomOf) { const c = chars.get(id); if (c) occ.set(ri, c); }
  rooms.forEach((r, i) => {
    const c = occ.get(i);
    const active = c && !c.leaving;
    const running = active && c.activity === 'running';
    r.progBg.visible = r.progFill.visible = running;
    if (running) r.progFill.scale.x = Math.max(0.05, (t / 1600) % 1);
    let scr = 0.25, lampT = 0.9;
    if (active) {
      lampT = 3.2;
      scr = c.activity === 'coding' ? 0.9 + Math.sin(t / 150 + i) * 0.2 : ACTIVE.has(c.activity) ? 0.7 : 0.45;
    }
    r.screenMat.emissiveIntensity += (scr - r.screenMat.emissiveIntensity) * 0.1;
    r.lamp.intensity += (lampT - r.lamp.intensity) * 0.1;
    r.bulb.material.emissiveIntensity = 0.2 + r.lamp.intensity / 4;
  });

  for (const ch of [...chars.values()]) {
    if (ch.mixer) ch.mixer.update(dt);
    if (!ch.mesh) continue;
    if (ch.leaving) { remove(ch.id); continue; }
    // 軽い上下の呼吸
    ch.mesh.position.y = ACTIVE.has(ch.activity) ? Math.abs(Math.sin(t / 600 + ch.seed)) * 0.04 : 0;
    if (ch.ring && ch.ring.visible) {
      const p = 1 + Math.sin(t / 180) * 0.2;
      ch.ring.scale.set(p, p, 1); ch.ring.material.opacity = 0.5 + Math.sin(t / 180) * 0.35;
    }
    if (ch.sats && ch.sats.length) {
      const R = 0.6, n = ch.sats.length;
      ch.sats.forEach((s, i) => { const a = t / 620 + (i / n) * Math.PI * 2; s.position.set(Math.cos(a) * R, 1.9 + Math.sin(t / 300 + i) * 0.07, Math.sin(a) * R); });
    }
  }

  renderer.render(scene, camera);
  positionLabels();
  positionSign();
}
// 構成は即座に(procedural)建てる。モデル読込は待たない＝1つ固まっても構成は必ず出る。
// ユーザー提供のGLB/FBXは届いた順に差し込む（プログレッシブ・エンハンスメント）。
buildRooms();
buildReception();
drawSignage();
tick();
// ベストエフォートでモデルを差し込む（失敗/遅延しても構成は保たれる）。
loadOne('desk', MODELS.desk).then(() => { if (proto.desk) populateDesks(); });
loadOne('pot', MODELS.pot).then(() => { if (proto.pot) populatePots(); });
loadOne('reception', MODELS.reception).then(() => { if (proto.reception) swapReception(); });
loadOne('plant', MODELS.plant).then(() => { if (proto.plant) placePlants(); });
(async () => {
  await loadOne('worker', MODELS.worker);
  if (!proto.worker) { await loadOne('workerFallback', MODELS.workerFallback); proto.worker = proto.workerFallback; }
  buildSecretary();
  ready = true; // worker が用意できてから着席開始（空ロボの生成を防ぐ）
  for (const ch of chars.values()) if (!ch.mesh) buildCharMesh(ch);
  pending.length = 0;
})();

document.fonts?.ready.then(() => { signKey = ''; drawSignage(); refreshBubbles(); });

// ---------- クリック / ホバー ----------
const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2();
function pick(e) {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const meshes = [...chars.values()].filter((c) => c.mesh).map((c) => c.mesh);
  const hits = ray.intersectObjects(meshes, true);
  if (!hits.length) return null;
  let o = hits[0].object;
  while (o && o.userData.sid === undefined) o = o.parent;
  return o ? chars.get(o.userData.sid) : null;
}
renderer.domElement.addEventListener('click', (e) => { const ch = pick(e); if (ch) { focusedLabelId = ch.id; window.showSessionPanel?.(ch.id); } else window.hideSessionPanel?.(); });
renderer.domElement.addEventListener('dblclick', (e) => { const ch = pick(e); if (ch) fetch('/focus-session', { method: 'POST', body: JSON.stringify({ session_id: ch.id }) }); });
let hoverT = 0;
renderer.domElement.addEventListener('mousemove', (e) => { const now = performance.now(); if (now - hoverT < 80) return; hoverT = now; renderer.domElement.style.cursor = pick(e) ? 'pointer' : 'default'; });

window.Company = { upsert, remove, reset };
window.dispatchEvent(new Event('company-ready'));
