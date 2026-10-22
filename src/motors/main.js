// ABB / Baldor-Reliance style electric motor plant: real-time 3D simulation with an AI layer.
// Lines feed sub-assemblies (laminations, shafts, rotors, frames, brackets, stators) into stock
// buffers; two final-assembly lines consume them and palletise finished motors, which flow by
// forklift, tugger train and truck out of the building.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as M from './models.js';
import { buildPlant, buildWalkGraph, routeWalk, nearestNode, B, DOCKS } from './plant.js';
import { createFx } from './fx.js';
import { createAI } from './ai.js';

// =====================================================================
// Time & plan
// =====================================================================
export const FACTORY_SEC = 20; // factory seconds per simulated second
export const PLAN_RATE = 50; // motors per hour (both lines)
const SHIFT_START_H = 6;

// =====================================================================
// Renderer, scene, camera
// =====================================================================
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcad6e2);
scene.fog = new THREE.Fog(0xcad6e2, 380, 1100);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.3, 2000);
camera.position.set(-18, 105, 128);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 2);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2.05;
controls.minDistance = 3;
controls.maxDistance = 600;

scene.add(new THREE.HemisphereLight(0xf2f6ff, 0x7d838b, 0.8));
const sun = new THREE.DirectionalLight(0xfffaf2, 1.7);
sun.position.set(70, 160, 90);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 80, bottom: -80, near: 20, far: 450 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun);

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const rnd = THREE.MathUtils.randFloat;
const lerpAngle = (a, b, k) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};

function roundedPath(points, radius) {
  const pts = points.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const path = new THREE.CurvePath();
  let prev = pts[0];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const dirIn = p.clone().sub(pts[i - 1]).normalize();
    const dirOut = pts[i + 1].clone().sub(p).normalize();
    const a = p.clone().addScaledVector(dirIn, -radius);
    const b = p.clone().addScaledVector(dirOut, radius);
    path.add(new THREE.LineCurve3(prev, a));
    path.add(new THREE.QuadraticBezierCurve3(a, p, b));
    prev = b;
  }
  path.add(new THREE.LineCurve3(prev, pts[pts.length - 1]));
  return path;
}

// Closest arc length on a path to (x, z)
function sAt(path, x, z) {
  const L = path.getLength();
  let best = 0;
  let bd = Infinity;
  const p = new THREE.Vector3();
  for (let i = 0; i <= 2000; i++) {
    path.getPointAt(i / 2000, p);
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bd) {
      bd = d;
      best = (i / 2000) * L;
    }
  }
  return best;
}

// =====================================================================
// Plant, effects, state
// =====================================================================
const plant = buildPlant(scene);
const walkGraph = buildWalkGraph();
const fx = createFx(scene);

const sim = {
  time: 0, speed: 1, paused: false, faults: true,
  built: 0, builtA: 0, builtB: 0, shipped: 0, rejected: 0, inspected: 0, passed: 0,
  serviced: 0, doneTimes: [], palletsMade: 0, trucksOut: 0,
};

const stock = {
  lamS: { name: 'Stator cores', count: 12, cap: 24 },
  lamR: { name: 'Rotor cores', count: 12, cap: 24 },
  shafts: { name: 'Shafts', count: 12, cap: 24 },
  rotors: { name: 'Rotors', count: 14, cap: 24 },
  frames: { name: 'Frames', count: 14, cap: 24 },
  brackets: { name: 'End brackets', count: 14, cap: 24 },
  stators: { name: 'Wound stators', count: 14, cap: 24 },
};

// =====================================================================
// Line engine
// =====================================================================
const lines = [];
const stations = [];
const pickables = [];

class Line {
  constructor(cfg) {
    const { stations: stationCfgs, points, ...rest } = cfg;
    Object.assign(this, rest);
    this.path = roundedPath(points, cfg.radius ?? 2.5);
    this.points = points;
    this.L = this.path.getLength();
    this.stationCfgs = stationCfgs;
    this.units = [];
    this.stations = [];
    this.produced = 0;
    this.serial = 0;
    lines.push(this);
  }
  canAccept() {
    return !this.units.some((u) => u.s < this.spacing + 0.2);
  }
  spawn() {
    const u = this.makeUnit();
    Object.assign(u, {
      line: this, s: 0, next: 0, state: 'moving', t: 0, dur: 1, blocked: false, retest: false, consumed: false,
      id: `${this.prefix}-${String(++this.serial).padStart(5, '0')}`, born: sim.time,
    });
    scene.add(u.group);
    this.units.push(u);
    this.place(u);
    return u;
  }
  remove(u) {
    this.units.splice(this.units.indexOf(u), 1);
    scene.remove(u.group);
  }
  place(u) {
    const p = this.path.getPointAt(clamp01(u.s / this.L));
    const t = this.path.getTangentAt(clamp01(u.s / this.L));
    u.group.position.set(p.x, this.y, p.z);
    u.group.rotation.y = Math.atan2(-t.z, t.x);
  }
  step(dt) {
    const sorted = this.units.slice().sort((a, b) => b.s - a.s);
    let aheadS = Infinity;
    for (const u of sorted) {
      const limit = aheadS - this.spacing;
      if (u.state === 'moving') {
        const target = u.next < this.stations.length ? this.stations[u.next].s : this.L;
        const want = u.s + this.speed * dt;
        const ns = Math.min(want, target, limit);
        u.blocked = limit < Math.min(want, target) - 1e-6;
        u.s = Math.max(u.s, ns);
        if (u.s >= target - 1e-4) {
          u.s = target;
          u.blocked = false;
          if (u.next < this.stations.length) {
            const st = this.stations[u.next];
            u.state = 'processing';
            u.t = 0;
            u.consumed = false;
            u.dur = st.cfg.cycle * rnd(0.92, 1.08);
            st.occupant = u;
          } else u.state = 'atEnd';
        }
      } else if (u.state === 'processing') {
        processUnit(u, this.stations[u.next], dt);
      }
      if (u.state === 'atEnd' && this.onEnd(u)) {
        this.remove(u);
        this.produced++;
        continue;
      }
      if (u.state !== 'gone') this.place(u);
      aheadS = u.s;
    }
    if (this.autoSpawn && this.canAccept() && (!this.spawnGate || this.spawnGate())) this.spawn();
  }
}

function processUnit(u, st, dt) {
  if (st.down) return;
  if (st.cfg.consume && !u.consumed) {
    if (st.cfg.consume.some(([b, n]) => b.count < n)) {
      st.waiting = true;
      return;
    }
    for (const [b, n] of st.cfg.consume) b.count -= n;
    u.consumed = true;
  }
  st.waiting = false;
  u.t += dt;
  st.workTime += dt;
  ai.wear(st, dt);
  const p = clamp01(u.t / u.dur);
  st.line.progress?.(u, st, p);
  if (sim.faults && Math.random() < dt / 2400) breakStation(st, rnd(5, 11), jamText(st));
  if (p >= 1) finishStation(u, st);
}

function jamText(st) {
  const t = { pack: 'carton jam', paint: 'colour change purge', vision: 'camera trigger fault', runtest: 'test fixture interlock', winder: 'wire break', washer: 'part stuck in tunnel', robotload: 'part pick failure' };
  return t[st.cfg.kind] ?? 'part jam';
}

function finishStation(u, st) {
  if (st.cfg.testFail && !u.retest && Math.random() < st.cfg.testFail) {
    u.retest = true;
    u.t = 0;
    u.dur = st.cfg.cycle * 0.6;
    toast(`${u.id} ${st.cfg.testText ?? 'failed test'} — re-testing`);
    return;
  }
  st.processed++;
  st.occupant = null;
  ai.qualityHook(u, st);
  if (st.cfg.inspect) {
    const reject = ai.inspect(u, st);
    if (reject) {
      st.line.remove(u);
      u.state = 'gone';
      sim.rejected++;
      st.rework.count++;
      st.rework.update();
      return;
    }
  }
  u.next++;
  u.state = 'moving';
}

function breakStation(st, duration, cause) {
  if (st.down) return;
  st.down = true;
  st.downLeft = duration;
  st.downCause = cause;
  st.downKind = 'jam';
  toast(`⚠ ${st.cfg.name}: ${cause}`, 'warn');
}

// =====================================================================
// Station visuals
// =====================================================================
const OPERATOR_VESTS = [0xf2e21a, 0xff7a1a, 0x9be22e];
const operators = [];

function signMesh(tex, w, h) {
  const g = new THREE.Group();
  for (const side of [1, -1]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    s.position.z = side * 0.02;
    if (side < 0) s.rotation.y = Math.PI;
    g.add(s);
  }
  return g;
}

function buildStation(line, cfg, index) {
  const s = cfg.s ?? sAt(line.path, cfg.x, cfg.z ?? line.points[0][1]);
  const p = line.path.getPointAt(s / line.L);
  const t = line.path.getTangentAt(s / line.L);
  const group = new THREE.Group();
  group.position.set(p.x, 0, p.z);
  group.rotation.y = Math.atan2(-t.z, t.x);
  scene.add(group);
  const st = {
    cfg, line, index, s, group, status: 'idle', occupant: null, waiting: false,
    down: false, downLeft: 0, downCause: null, downKind: null, downtime: 0, unplanned: 0,
    workTime: 0, processed: 0, ema: { util: 0, blocked: 0, starved: 0 }, ops: [],
  };
  const mach = M.MACHINES[cfg.kind](line.y, cfg.opts);
  group.add(mach.group);
  st.machine = mach;
  freezeMachine(mach, line.y, group);
  // Operators
  (cfg.ops ?? mach.ops).forEach(([x, z, rot], i) => {
    const person = M.createPerson({ vest: OPERATOR_VESTS[(index + i) % 3], shirt: 0x4b5563 });
    person.group.position.set(x, 0, z);
    person.group.rotation.y = -rot;
    group.add(person.group);
    st.ops.push(person);
    operators.push({ person, st });
  });
  // Station sign on a post at the back
  const bbox = new THREE.Box3().setFromObject(mach.group);
  const size = bbox.getSize(new THREE.Vector3());
  const sign = signMesh(M.signTexture(index + 1, cfg.name, line.name.toUpperCase()), 2.6, 0.65);
  const signY = Math.max(3.0, size.y + 0.6);
  sign.position.set(0, signY, -0.3);
  group.add(sign);
  // Floor outline + pick volume
  group.updateMatrixWorld(true);
  const local = new THREE.Box3();
  mach.group.traverse((o) => {
    if (o.isMesh && o.geometry) {
      o.geometry.computeBoundingBox?.();
      const bb = o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().copy(group.matrixWorld).invert().multiply(o.matrixWorld));
      local.union(bb);
    }
  });
  local.expandByVector(new THREE.Vector3(0.3, 0, 0.3));
  local.min.z = Math.min(local.min.z, -1);
  local.max.z = Math.max(local.max.z, 1.4);
  const zx0 = local.min.x;
  const zx1 = local.max.x;
  const zz0 = local.min.z;
  const zz1 = local.max.z;
  st.zoneMat = new THREE.LineBasicMaterial({ color: 0x5a626b, transparent: true, opacity: 0.55 });
  const outline = [[zx0, zz0], [zx1, zz0], [zx1, zz1], [zx0, zz1], [zx0, zz0]].map(([x, z]) => new THREE.Vector3(x, 0.03, z));
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(outline), st.zoneMat));
  const pick = new THREE.Mesh(new THREE.BoxGeometry(zx1 - zx0, Math.max(3, size.y + 1), zz1 - zz0), new THREE.MeshBasicMaterial({ visible: false }));
  pick.position.set((zx0 + zx1) / 2, Math.max(3, size.y + 1) / 2, (zz0 + zz1) / 2);
  pick.userData.station = st;
  group.add(pick);
  pickables.push(pick);
  // AI alert halo on the floor
  const halo = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.25, 40), new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  halo.rotation.x = -Math.PI / 2;
  halo.position.set((zx0 + zx1) / 2, 0.05, (zz0 + zz1) / 2);
  halo.scale.setScalar(Math.max(zx1 - zx0, zz1 - zz0) / 2);
  group.add(halo);
  st.halo = halo;
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: alertTexture(), toneMapped: false, depthTest: false }));
  marker.scale.set(1.1, 1.1, 1);
  marker.position.set(0, signY + 1.2, 0);
  marker.visible = false;
  marker.renderOrder = 10;
  group.add(marker);
  st.marker = marker;
  st.center = new THREE.Vector3((zx0 + zx1) / 2, 0, zz1 + 0.6).applyMatrix4(group.matrixWorld);
  st.footW = zx1 - zx0;
  st.footD = zz1 - zz0;
  // Legend footprint (workstation / machine = blue)
  const c = new THREE.Vector3((zx0 + zx1) / 2, 0, (zz0 + zz1) / 2).applyMatrix4(group.matrixWorld);
  plant.footprint('work', c.x, c.z, zx1 - zx0, zz1 - zz0, group.rotation.y);
  if (cfg.inspect) {
    // Rework cart for rejected units
    const cart = M.createCart();
    cart.position.set(0, 0, 2.6);
    group.add(cart);
    const items = [];
    for (let i = 0; i < 6; i++) {
      const b = M.box(0.32, 0.25, 0.3, M.mat(0xef4444, { roughness: 0.6 }));
      b.position.set(-0.55 + (i % 3) * 0.5, 0.6, 2.6 + (i < 3 ? -0.3 : 0.3));
      b.visible = false;
      group.add(b);
      items.push(b);
    }
    const tag = M.box(0.5, 0.35, 0.02, M.glow(0xef4444), false);
    tag.position.set(0.9, 1.0, 2.0);
    group.add(tag);
    st.rework = { count: 0, update() { items.forEach((b, i) => { b.visible = i < Math.min(6, this.count); }); } };
  }
  line.stations.push(st);
  stations.push(st);
  ai.initStation(st);
  return st;
}

// Find which parts of a machine its animation touches (by running update() through a range of
// states), then merge every other mesh into one mesh per material. Cuts draw calls ~5x.
const fxStub = (() => {
  const e = { emit() {}, emitDir() {}, points: { material: { color: new THREE.Color() } } };
  return { sparks: e, mist: e, water: e, paint: e, smoke: e };
})();
function freezeMachine(mach, y, stationGroup) {
  const g = mach.group;
  const objs = [];
  g.traverse((o) => { if (o !== g) objs.push(o); });
  const snap = () => objs.map((o) => [o.position.x, o.position.y, o.position.z, o.rotation.x, o.rotation.y, o.rotation.z, o.scale.x, o.scale.y, o.scale.z, o.visible, o.material?.uuid]);
  const base = snap();
  const dynamic = new Set([mach.light.group]);
  let t = 0;
  for (const working of [true, false]) {
    for (const p of [0.02, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 0.98]) {
      t += 0.37;
      mach.update?.({ working, status: working ? 'working' : 'idle', occ: null, p, t, simDt: 0.3, dt: 0.3, y, fx: fxStub, blink: true });
      snap().forEach((row, i) => { if (row.some((v, k) => v !== base[i][k])) dynamic.add(objs[i]); });
    }
  }
  const isDynamic = (o) => {
    for (let n = o; n && n !== g; n = n.parent) if (dynamic.has(n)) return true;
    return false;
  };
  stationGroup.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const byMat = new Map();
  for (const o of objs) {
    if (!o.isMesh || isDynamic(o) || Array.isArray(o.material) || o.material.transparent || o.isInstancedMesh) continue;
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const n of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(n)) geo.deleteAttribute(n);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(geo);
    o.parent.remove(o);
  }
  for (const [m, geos] of byMat) {
    const merged = new THREE.Mesh(mergeGeometries(geos), m);
    merged.castShadow = merged.receiveShadow = true;
    g.add(merged);
  }
}

let _alertTex;
function alertTexture() {
  if (_alertTex) return _alertTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f59e0b';
  g.beginPath();
  g.moveTo(64, 8);
  g.lineTo(122, 116);
  g.lineTo(6, 116);
  g.closePath();
  g.fill();
  g.fillStyle = '#1b1b1b';
  g.font = '900 78px Inter, Arial';
  g.textAlign = 'center';
  g.fillText('!', 64, 104);
  _alertTex = new THREE.CanvasTexture(c);
  _alertTex.colorSpace = THREE.SRGBColorSpace;
  return _alertTex;
}

// Roller conveyor along every straight segment of a line
function buildConveyor(line, width = 0.9) {
  const pts = line.points;
  const frameM = M.mat(0x8d949c, { metalness: 0.5, roughness: 0.45 });
  const railM = M.mat(0xb4bac1, { metalness: 0.7, roughness: 0.35 });
  const rollerGeo = new THREE.CylinderGeometry(0.045, 0.045, width - 0.06, 8);
  rollerGeo.rotateX(Math.PI / 2);
  const mats = [];
  const g = new THREE.Group();
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const ang = Math.atan2(-(bz - az), bx - ax);
    const seg = new THREE.Group();
    seg.position.set((ax + bx) / 2, 0, (az + bz) / 2);
    seg.rotation.y = ang;
    const body = M.box(len, 0.12, width, frameM);
    body.position.y = line.y - 0.1;
    seg.add(body);
    for (const sz of [-1, 1]) {
      const r = M.box(len, 0.08, 0.05, railM, false);
      r.position.set(0, line.y + 0.02, sz * (width / 2 + 0.03));
      seg.add(r);
    }
    for (let x = -len / 2 + 0.4; x < len / 2; x += 1.6) for (const sz of [-1, 1]) {
      const leg = M.box(0.06, line.y - 0.16, 0.06, frameM);
      leg.position.set(x, (line.y - 0.16) / 2, sz * (width / 2 - 0.05));
      seg.add(leg);
    }
    const n = Math.floor(len / 0.22);
    seg.updateMatrixWorld(true);
    for (let k = 0; k < n; k++) {
      const m4 = new THREE.Matrix4().makeTranslation(-len / 2 + 0.11 + k * 0.22, line.y - 0.02, 0);
      mats.push(new THREE.Matrix4().multiplyMatrices(seg.matrixWorld, m4));
    }
    g.add(seg);
  }
  const rollers = new THREE.InstancedMesh(rollerGeo, M.mat(0xc0c6cc, { metalness: 0.8, roughness: 0.3 }), mats.length);
  mats.forEach((m, i) => rollers.setMatrixAt(i, m));
  rollers.receiveShadow = true;
  scene.add(M.mergeStatic(g));
  scene.add(rollers);
}

// Stock rack showing buffer contents (one mesh per unit in stock)
function stockRack(buffer, x, z, rotY, makeItem, { cols = 6, levels = 4, pitch = 0.55, levelH = 0.55 } = {}) {
  const g = new THREE.Group();
  const w = cols * pitch + 0.2;
  g.add(M.mergeStatic(M.createShelf(w, levels * levelH + 0.2, 0.7, M.C.rack, [])));
  // One instanced mesh per item part; the instance count is the stock level
  const proto = makeItem();
  proto.updateMatrixWorld(true);
  const items = [];
  proto.traverse((o) => {
    if (!o.isMesh) return;
    const im = new THREE.InstancedMesh(o.geometry, o.material, buffer.cap);
    im.castShadow = im.receiveShadow = true;
    const slot = new THREE.Matrix4();
    for (let i = 0; i < buffer.cap; i++) {
      const l = Math.floor(i / cols) % levels;
      const c = i % cols;
      slot.makeTranslation(-w / 2 + 0.1 + pitch / 2 + c * pitch, 0.18 + l * ((levels * levelH) / (levels - 1)) * 0.66, 0);
      im.setMatrixAt(i, slot.clone().multiply(o.matrixWorld));
    }
    im.count = 0;
    g.add(im);
    items.push(im);
  });
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  scene.add(g);
  plant.footprint('rack', x, z, rotY ? 0.9 : w, rotY ? w : 0.9);
  buffer.items = items;
  buffer.pos = new THREE.Vector3(x, 0, z);
  const lbl = plant.label(buffer.name.toUpperCase(), x, 3.2, z, { w: 3.6 });
  lbl.scale.multiplyScalar(0.9);
}

// =====================================================================
// Line definitions
// =====================================================================
const Y = { feed: 0.9, asm: 0.8, stator: 0.9, rewind: 0.75 };

function feederLine(cfg, makePart) {
  return new Line({
    spacing: 1.5, speed: 2.4, autoSpawn: true, radius: 2.5, ...cfg,
    makeUnit() {
      const part = makePart();
      part.set(0, 0);
      return { group: part.group, part };
    },
    progress(u, st, p) { u.part.set(st.index, p); },
  });
}

const PRESS = feederLine({
  id: 'press', name: 'Press shop', short: 'Press', prefix: 'LAM', unitName: 'lamination sets', y: Y.feed,
  points: [[-41.5, -31], [-26.5, -31]],
  stations: [
    { kind: 'uncoiler', name: 'Uncoil & Straighten', x: -40, cycle: 1.8, desc: 'Electrical-steel coil is uncoiled, flattened and fed into the press.' },
    { kind: 'press', name: 'Lamination Stamping', x: -34.5, cycle: 2.2, desc: 'A 250-ton progressive die punches stator and rotor laminations in one stroke.' },
    { kind: 'stacker', name: 'Stack & Laser Weld', x: -29, cycle: 2.0, desc: 'A robot stacks laminations to height and laser-welds the cores.' },
  ],
  onEnd() {
    // One stroke makes a stator and a rotor lamination stack; surplus goes to the scrap/regrind bin
    if (stock.lamS.count >= stock.lamS.cap && stock.lamR.count >= stock.lamR.cap) return false;
    stock.lamS.count = Math.min(stock.lamS.cap, stock.lamS.count + 1);
    stock.lamR.count = Math.min(stock.lamR.cap, stock.lamR.count + 1);
    return true;
  },
}, M.createLaminations);

const SHAFT = feederLine({
  id: 'shaft', name: 'East Line 2 · Shafts', short: 'Shafts', prefix: 'SFT', unitName: 'shafts', y: Y.feed,
  points: [[-18.5, -31], [17.5, -31]],
  stations: [
    { kind: 'saw', name: 'Bar Saw', x: -14, cycle: 1.8, desc: 'Steel bar stock is cut to length.' },
    { kind: 'lathe', name: 'CNC Turning', x: -5.5, cycle: 2.3, desc: 'Shaft diameters, shoulders and bearing seats are turned.' },
    { kind: 'mill', name: 'Keyway Milling', x: 2.5, cycle: 2.1, desc: 'The drive-end keyway is milled.' },
    { kind: 'grinder', name: 'Bearing Seat Grinding', x: 10.5, cycle: 2.2, desc: 'Bearing journals are ground to micron tolerance.' },
  ],
  onEnd() { return pushStock(stock.shafts); },
}, M.createShaft);

const ROTOR = feederLine({
  id: 'rotor', name: 'East Line 1 · Rotors', short: 'Rotors', prefix: 'ROT', unitName: 'rotors', y: Y.feed,
  points: [[-18.5, -37], [17.5, -37]],
  stations: [
    { kind: 'diecast', name: 'Rotor Die Casting', x: -13, cycle: 2.3, consume: [[stock.lamR, 1]], desc: 'Molten aluminium is shot into the rotor core to form the squirrel cage and end rings.' },
    { kind: 'hpress', name: 'Shaft Press', x: -5.5, cycle: 1.6, consume: [[stock.shafts, 1]], desc: 'The machined shaft is pressed into the rotor core.' },
    { kind: 'lathe', name: 'Rotor OD Turning', x: 2.5, cycle: 2.1, desc: 'The rotor outside diameter is turned for an even air gap.' },
    { kind: 'balancer', name: 'Dynamic Balancing', x: 10.5, cycle: 1.9, desc: 'Rotor is spun and balanced to ISO 21940 G2.5.' },
  ],
  onEnd() { return pushStock(stock.rotors); },
}, M.createRotor);

const FRAME = feederLine({
  id: 'frame', name: 'East Line 3 · Frames', short: 'Frames', prefix: 'FRM', unitName: 'frames', y: Y.feed,
  points: [[-18.5, -25.6], [17.5, -25.6]],
  stations: [
    { kind: 'robotload', name: 'Casting Load', x: -14, cycle: 1.5, desc: 'A robot picks cast-iron frames from the bins onto fixtures.' },
    { kind: 'mill', name: 'Bore & Face (HMC)', x: -5.5, cycle: 2.3, opts: { color: 0xd8dde2, accent: 0x2a5d9f, w: 2.8 }, desc: 'The stator bore and both end faces are machined in one clamping.' },
    { kind: 'mill', name: 'Drill & Tap', x: 2.5, cycle: 2.0, desc: 'Foot holes, bracket bolt holes and conduit-box threads are drilled and tapped.' },
    { kind: 'washer', name: 'Parts Washer', x: 10.5, cycle: 1.8, desc: 'Chips and coolant are washed off before assembly.' },
  ],
  onEnd() { return pushStock(stock.frames); },
}, M.createFrameCasting);

const BRACKET = feederLine({
  id: 'bracket', name: 'Bracket machining', short: 'Brackets', prefix: 'BRK', unitName: 'bracket sets', y: Y.feed,
  points: [[-67.5, -31], [-53, -31]],
  stations: [
    { kind: 'lathe', name: 'Bracket Turning', x: -64.5, cycle: 2.2, desc: 'Bearing housings and spigots of the end brackets are turned.' },
    { kind: 'mill', name: 'Bracket Drilling', x: -59.5, cycle: 2.1, desc: 'Bolt circles and grease paths are drilled.' },
    { kind: 'cmm', name: 'CMM Inspection', x: -55.3, cycle: 1.6, desc: 'A coordinate measuring machine checks bearing bore and concentricity.' },
  ],
  onEnd() { return pushStock(stock.brackets); },
}, M.createBracketSet);

const STATOR = feederLine({
  id: 'stator', name: 'Stator winding & VPI', short: 'Stators', prefix: 'STA', unitName: 'stators', y: Y.stator, radius: 3,
  points: [[-52.5, -13], [-26.5, -13], [-26.5, -2], [-52.5, -2]],
  stations: [
    { kind: 'winder', name: 'Coil Winding', x: -49, z: -13, cycle: 2.3, consume: [[stock.lamS, 1]], desc: 'Twin flyer winders wind copper magnet-wire coils.' },
    { kind: 'inserter', name: 'Coil Insertion', x: -43, z: -13, cycle: 2.0, desc: 'Coils and slot insulation are pushed into the stator slots.' },
    { kind: 'lacer', name: 'Lacing & Forming', x: -37.2, z: -13, cycle: 2.2, desc: 'End turns are formed and laced; leads are connected.' },
    { kind: 'surge', name: 'Surge & Hipot Test', x: -31.5, z: -13, cycle: 1.4, testFail: 0.02, testText: 'surge test mismatch', desc: 'Turn-to-turn insulation and ground-wall are tested at high voltage.' },
    { kind: 'vpi', name: 'VPI Impregnation', x: -32, z: -2, cycle: 2.3, desc: 'Vacuum Pressure Impregnation fills the windings with resin.' },
    { kind: 'oven', name: 'Cure Oven', x: -40, z: -2, cycle: 2.3, desc: 'Resin is cured at 160 °C.' },
    { kind: 'coolinspect', name: 'Cool & Inspect', x: -47.5, z: -2, cycle: 1.5, desc: 'Fans cool the stator; it is inspected before going to assembly.' },
  ],
  onEnd() { return pushStock(stock.stators); },
}, M.createStator);

function pushStock(b) {
  if (b.count >= b.cap) return false;
  b.count++;
  return true;
}

// Final assembly lines
const ASM_X = [-16, -5.5, 5, 15.5, 26, 36.5, 47, 57.5, 68];
const ASM_STEPS = [
  { kind: 'induction', name: 'Stator Insert (Shrink Fit)', consume: (k) => [[stock.stators, 1], [stock.frames, 1]], desc: 'The frame is induction-heated and the wound stator drops in; it locks as the frame cools.' },
  { kind: 'rotorinsert', name: 'Rotor Insertion', consume: () => [[stock.rotors, 1]], desc: 'A lift-assist arm threads the balanced rotor into the stator bore.' },
  { kind: 'hpress', name: 'Bearings & End Brackets', consume: () => [[stock.brackets, 1]], desc: 'Bearings are pressed on and both end brackets are bolted up and torqued.' },
  { kind: 'fanbench', name: 'Fan & Fan Cover', desc: 'Cooling fan is keyed to the shaft and the fan cover fitted.' },
  { kind: 'conduit', name: 'Conduit Box & Leads', desc: 'Leads are terminated in the conduit box; gasket and lid fitted.' },
  { kind: 'runtest', name: 'Run Test', testFail: 0.025, testText: 'failed no-load current test', desc: 'Motor is run on a dynamometer: no-load current, vibration, temperature and hipot.' },
  { kind: 'paint', name: 'Paint', desc: 'A robot sprays the finish coat.' },
  { kind: 'vision', name: 'Vision QC (AI)', inspect: true, desc: 'Cameras and a trained vision model check every motor for missing bolts, dents, gaskets and paint defects.' },
  { kind: 'pack', name: 'Nameplate & Pack', desc: 'Laser-marked nameplate is fitted; the motor is boxed and palletised.' },
];

function assemblyLine(kind, z, cycles, label) {
  const line = new Line({
    id: `asm${kind}`, name: `Line ${kind} · ${M.MOTOR[kind].family.split(' ')[0]}`, short: `Line ${kind}`, prefix: kind === 'A' ? 'SE' : 'M3',
    unitName: 'motors', y: Y.asm, spacing: kind === 'A' ? 1.5 : 1.9, speed: 2.2, autoSpawn: true, motorKind: kind, label,
    points: [[-19, z], [72.5, z]],
    stations: ASM_STEPS.map((s, i) => ({ ...s, x: ASM_X[i], cycle: cycles[i], consume: s.consume?.(kind) })),
    makeUnit() {
      const g = new THREE.Group();
      const fixture = M.box(kind === 'A' ? 0.95 : 1.35, 0.06, kind === 'A' ? 0.7 : 0.95, M.mat(0x3c4249, { metalness: 0.5, roughness: 0.5 }));
      fixture.position.y = 0.03;
      g.add(fixture);
      const motor = M.createMotor(kind);
      motor.group.position.y = 0.06;
      motor.setStage(0);
      motor.parts.windings.visible = false;
      g.add(motor.group);
      return { group: g, part: motor, defect: null };
    },
    progress(u, st, p) {
      const m = u.part;
      switch (st.index) {
        case 0: m.setStage(0); m.parts.windings.visible = p > 0.45; break;
        case 1: m.setStage(p > 0.5 ? 1 : 0); break;
        case 2: m.setStage(p > 0.5 ? 2 : 1); break;
        case 3: m.setStage(p > 0.7 ? 3.5 : p > 0.3 ? 3 : 2); break;
        case 4: m.setStage(p > 0.5 ? 4 : 3.5); break;
        case 6: m.setStage(p > 0.5 ? 5 : 4); break;
        case 8: m.setStage(p > 0.75 ? 7 : p > 0.2 ? 6 : 5); break;
        default: break;
      }
      ai.applyDefectVisual(u);
    },
    onEnd(u) {
      const lp = linePallets[kind];
      if (!lp.pallet || lp.pallet.count >= lp.pallet.cap || lp.claimed) return false;
      lp.pallet.setCount(lp.pallet.count + 1);
      sim.built++;
      if (kind === 'A') sim.builtA++;
      else sim.builtB++;
      sim.doneTimes.push(sim.time);
      if (sim.doneTimes.length > 60) sim.doneTimes.shift();
      if (lp.pallet.count >= lp.pallet.cap) sim.palletsMade++;
      return true;
    },
  });
  return line;
}
const ASM_A = assemblyLine('A', -13.5, [5.0, 4.6, 5.2, 4.8, 5.0, 5.5, 4.4, 2.6, 4.2], 'NEMA Super-E');
const ASM_B = assemblyLine('B', -3, [6.4, 6.0, 6.6, 6.2, 6.2, 7.0, 6.0, 3.0, 5.4], 'IEC M3BP');

// Rewind service shop: customer motors in for repair
const REWIND = new Line({
  id: 'rewind', name: 'Rewind service', short: 'Rewind', prefix: 'SRV', unitName: 'repairs', y: Y.rewind,
  spacing: 1.6, speed: 1.8, autoSpawn: true, radius: 2,
  points: [[26.5, 17], [58, 17]],
  spawnGate: () => Math.random() < 0.004,
  stations: [
    { kind: 'inspectbench', name: 'Incoming Inspection', x: 29, cycle: 8, desc: 'Customer motor is logged, megger-tested and torn down.' },
    { kind: 'burnout', name: 'Burnout Oven', x: 35.5, cycle: 14, desc: 'Old varnish is burned off at a controlled 370 °C so the core is not damaged.' },
    { kind: 'strip', name: 'Coil Stripping', x: 42, cycle: 9, desc: 'Old copper coils are pulled out and the slots cleaned.' },
    { kind: 'rewind', name: 'Rewinding', x: 48.5, cycle: 16, desc: 'New coils are wound to the original (or upgraded) winding data.' },
    { kind: 'dipbake', name: 'Dip & Bake', x: 55, cycle: 14, desc: 'The rewound stator is dipped in varnish and baked.' },
  ],
  makeUnit() {
    const part = M.createServiceMotor();
    part.set(0, 0);
    return { group: part.group, part };
  },
  progress(u, st, p) { u.part.set(st.index, p); },
  onEnd() {
    sim.serviced++;
    return true;
  },
});

// =====================================================================
// AI layer
// =====================================================================
const ai = createAI({
  scene, renderer, camera, sim, stations, lines, stock, plan: PLAN_RATE, FACTORY_SEC, bounds: B,
  toast: (m, k) => toast(m, k),
  dispatchTech: (st) => dispatchTech(st),
  focusStation: (st) => selectStation(st, true),
  snapshot: () => snapshot(),
  clockText: () => fmtClock(sim.time),
});

for (const line of lines) {
  line.stationCfgs.forEach((cfg, i) => buildStation(line, cfg, i));
  buildConveyor(line, line.motorKind === 'B' ? 1.1 : 0.9);
}

// Stock racks at the end of each feeder line
const ringItem = (r, c = 0x4a5058) => () => {
  const m = M.xtube(r, r * 0.55, 0.22, M.mat(c, { metalness: 0.7, roughness: 0.4 }));
  m.rotation.y = Math.PI / 2;
  return m;
};
stockRack(stock.lamS, -27.6, -27.2, 0, ringItem(0.22), { cols: 6 });
stockRack(stock.lamR, -34, -26.2, 0, () => M.xcyl(0.12, 0.25, M.mat(0x4a5058, { metalness: 0.7 }), 14), { cols: 6 });
stockRack(stock.shafts, 21, -31.2, Math.PI / 2, () => M.xcyl(0.05, 0.55, M.mat(0xdfe3e7, { metalness: 1, roughness: 0.15 }), 10), { cols: 6, pitch: 0.6 });
stockRack(stock.rotors, 21, -37.2, Math.PI / 2, () => M.xcyl(0.13, 0.3, M.mat(0x8f969e, { metalness: 0.9, roughness: 0.25 }), 14), { cols: 6, pitch: 0.6 });
stockRack(stock.frames, 21, -25.6, Math.PI / 2, () => M.xcyl(0.22, 0.45, M.mat(0x6c7178, { metalness: 0.5, roughness: 0.4 }), 16), { cols: 6, pitch: 0.6 });
stockRack(stock.brackets, -53.8, -26.5, 0, () => M.xcyl(0.18, 0.06, M.mat(0xb9c0c8, { metalness: 0.9, roughness: 0.25 }), 16), { cols: 6, pitch: 0.45 });
stockRack(stock.stators, -55.6, -2, Math.PI / 2, () => {
  const g = new THREE.Group();
  g.add(M.xtube(0.22, 0.14, 0.3, M.mat(0x3a2d22, { roughness: 0.3, metalness: 0.5 })));
  const t = M.xtorus(0.17, 0.04, M.mat(0x7a3e10, { roughness: 0.25, metalness: 0.3 }));
  t.position.x = 0.17;
  g.add(t);
  g.rotation.y = Math.PI / 2;
  return g;
}, { cols: 6, pitch: 0.6 });

// Line-side flow racks (green, as on the plan) between assembly stations
for (const z of [-17.1, -6.4]) {
  for (let i = 0; i < ASM_X.length - 1; i++) {
    if (i === 5 || i === 6) continue; // paint & vision have no line-side stock
    const sh = M.mergeStatic(M.createShelf(2.6, 1.7, 0.7, M.C.rack));
    sh.position.set((ASM_X[i] + ASM_X[i + 1]) / 2, 0, z);
    scene.add(sh);
    plant.footprint('rack', sh.position.x, z, 2.8, 0.9);
  }
}

// =====================================================================
// Logistics: line-end pallets, FG racking, tugger train, staging, trucks
// =====================================================================
class Vehicle {
  constructor(obj, { speed = 6, turn = 7, y = 0 } = {}) {
    this.obj = obj;
    this.speed = speed;
    this.turn = turn;
    this.y = y;
    this.tasks = [];
    this.x = 0;
    this.z = 0;
    this.heading = 0;
    scene.add(obj);
  }
  setPos(x, z, h = 0) {
    this.x = x;
    this.z = z;
    this.heading = h;
    this.sync();
    return this;
  }
  move(pts, { reverse = false, speed } = {}) {
    this.tasks.push({ type: 'move', pts: pts.map(([x, z]) => ({ x, z })), i: 0, reverse, speed });
    return this;
  }
  wait(dur, onUpdate, onDone) {
    this.tasks.push({ type: 'wait', dur, t: 0, onUpdate, onDone });
    return this;
  }
  call(fn) {
    this.tasks.push({ type: 'call', fn });
    return this;
  }
  get busy() { return this.tasks.length > 0; }
  step(dt) {
    let budget = dt;
    let guard = 0;
    this.moving = false;
    while (budget > 1e-6 && this.tasks.length && guard++ < 20) {
      const t = this.tasks[0];
      if (t.type === 'call') {
        this.tasks.shift();
        t.fn();
        continue;
      }
      if (t.type === 'wait') {
        t.t += budget;
        t.onUpdate?.(clamp01(t.t / t.dur));
        if (t.t >= t.dur) {
          budget = t.t - t.dur;
          this.tasks.shift();
          t.onDone?.();
        } else budget = 0;
        continue;
      }
      const target = t.pts[t.i];
      const dx = target.x - this.x;
      const dz = target.z - this.z;
      const dist = Math.hypot(dx, dz);
      const sp = t.speed ?? this.speed;
      if (dist > 1e-4) {
        let want = Math.atan2(-dz, dx);
        if (t.reverse) want += Math.PI;
        this.heading = lerpAngle(this.heading, want, 1 - Math.exp(-this.turn * dt));
        this.moving = true;
      }
      if (dist <= sp * budget) {
        this.x = target.x;
        this.z = target.z;
        budget -= dist / sp;
        t.i++;
        if (t.i >= t.pts.length) this.tasks.shift();
      } else {
        this.x += (dx / dist) * sp * budget;
        this.z += (dz / dist) * sp * budget;
        budget = 0;
      }
    }
    this.sync();
  }
  sync() {
    this.obj.position.set(this.x, this.y, this.z);
    this.obj.rotation.y = this.heading;
  }
}

const vehicles = [];
function forklift(color) {
  const f = M.createForklift(color);
  const v = new Vehicle(f.group, { speed: 9 });
  v.f = f;
  v.load = null;
  vehicles.push(v);
  return v;
}
function lift(v, from, to, dur = 0.7) {
  return v.wait(dur, (k) => { v.f.carriage.position.y = from + (to - from) * ease(k); });
}
function attach(v, pallet) {
  v.load = pallet;
  pallet.group.position.set(v.f.forkTip, 0.0, 0);
  pallet.group.rotation.set(0, Math.PI / 2, 0);
  v.f.carriage.add(pallet.group);
}
function detachTo(v, parent, pos, rotY = 0) {
  const p = v.load;
  v.load = null;
  parent.add(p.group);
  p.group.position.copy(pos);
  p.group.rotation.set(0, rotY, 0);
  return p;
}

// Line-end pallets (south of each line end, picked from the east corridor)
const CORRIDOR_X = 78.4;
const linePallets = {};
for (const [kind, line] of [['A', ASM_A], ['B', ASM_B]]) {
  const z = line.points[0][1] + 2.6;
  const lp = { kind, x: 74.8, z, pallet: null, claimed: false };
  lp.spawn = () => {
    lp.pallet = M.createLoadedPallet(kind);
    lp.pallet.group.position.set(lp.x, 0, lp.z);
    lp.pallet.group.rotation.y = Math.PI / 2;
    lp.pallet.setCount(0);
    scene.add(lp.pallet.group);
    lp.claimed = false;
  };
  lp.spawn();
  linePallets[kind] = lp;
  // roller transfer from line end to pallet
  const tr = M.box(2.4, 0.08, 0.8, M.mat(0x8d949c, { metalness: 0.5 }));
  tr.position.set(73.3, Y.asm, line.points[0][1] + 1.2);
  tr.rotation.y = Math.PI / 2 - 0.9;
  scene.add(tr);
  plant.footprint('fg', lp.x, lp.z, 1.6, 1.6);
}

// FG racking (two rows facing a central aisle)
const RACK_AISLE_X = 69.5;
const fgSlots = [];
for (const [rx, face] of [[65, -1], [74, 1]]) {
  const r = M.createRack(10, 3, { bayW: 2.8, depth: 1.4 });
  r.group.position.set(rx, 0, 12);
  r.group.rotation.y = -Math.PI / 2;
  scene.add(r.group);
  r.group.updateMatrixWorld(true);
  plant.footprint('rack', rx, 12 + 14, 1.6, 28);
  for (let b = 0; b < 10; b++) for (let l = 0; l < 3; l++) {
    const pos = r.group.localToWorld(r.slotPos(b, l));
    fgSlots.push({ pos, face, pallet: null, reserved: false, level: l, bay: b });
  }
}
fgSlots.sort((a, b) => a.level - b.level || a.bay - b.bay);
const fgPallets = () => fgSlots.filter((s) => s.pallet).length;

// Tugger train loop: east end loads at FG racking, west end unloads at staging
const TUG_POINTS = [[-50, 8], [74, 8], [76.5, 7], [74, 6], [-50, 6], [-52.5, 7], [-50, 8]];
const tugPath = roundedPath(TUG_POINTS, 1.0);
const tugL = tugPath.getLength();
const tugger = {
  group: M.createTugger(), s: 0, state: 'toSE', wait: 0, speed: 10,
  carts: [], sSE: sAt(tugPath, 73, 8), sSW: sAt(tugPath, -27, 6),
};
scene.add(tugger.group);
for (let i = 0; i < 5; i++) {
  const g = M.createCart();
  scene.add(g);
  tugger.carts.push({ group: g, pallet: null, reserved: false, i });
}
tugger.s = tugger.sSW;
tugger.state = 'unloading';
const cartOffset = (i) => 2.0 + i * 2.15;
function placeOnPath(obj, s) {
  const u = (((s % tugL) + tugL) % tugL) / tugL;
  const p = tugPath.getPointAt(u);
  const t = tugPath.getTangentAt(u);
  obj.position.set(p.x, 0, p.z);
  obj.rotation.y = Math.atan2(-t.z, t.x);
}
function cartWorld(c) {
  return c.group.position;
}

// Staging lanes (drive-in, filled back to front)
const STAGE_COLS = [-51, -45.5, -40, -34.5, -29, -23.5, -18, -12.5].filter((x) => !DOCKS.some((d) => Math.abs(d - x) < 1.6));
const STAGE_ROWS = [];
for (let z = 38.5; z >= 14; z -= 1.75) STAGE_ROWS.push(z);
const stageCols = STAGE_COLS.map((x) => ({ x, slots: STAGE_ROWS.map((z) => ({ x, z, pallet: null, reserved: false })) }));
const stagedCount = () => stageCols.reduce((n, c) => n + c.slots.filter((s) => s.pallet).length, 0);
for (const c of stageCols) plant.footprint('fg', c.x, (STAGE_ROWS[0] + STAGE_ROWS[STAGE_ROWS.length - 1]) / 2, 1.5, STAGE_ROWS[0] - STAGE_ROWS[STAGE_ROWS.length - 1] + 1.5);
function freeStageSlot() {
  // fill the emptiest column, deepest free slot first
  let best = null;
  for (const c of stageCols) {
    const occupied = c.slots.filter((s) => s.pallet || s.reserved).length;
    if (occupied >= c.slots.length) continue;
    const slot = c.slots[occupied];
    if (!best || occupied < best.occ) best = { slot, occ: occupied, col: c };
  }
  return best;
}
function frontStagePallet() {
  let best = null;
  for (const c of stageCols) {
    const filled = c.slots.filter((s) => s.pallet && !s.reserved);
    if (!filled.length) continue;
    const slot = filled[filled.length - 1];
    // only if nothing is reserved in front of it
    const idx = c.slots.indexOf(slot);
    if (c.slots.slice(idx + 1).some((s) => s.reserved)) continue;
    if (!best || filled.length > best.n) best = { slot, n: filled.length, col: c };
  }
  return best;
}

// Docks and trucks
const docks = DOCKS.map((x) => ({ x, truck: null }));
const trucks = [];
let nextTruckAt = 30;

const F1 = forklift(0xf28c28).setPos(CORRIDOR_X, 9.4, Math.PI / 2);
const F2 = forklift(0xf28c28).setPos(RACK_AISLE_X, 11, Math.PI / 2);
const F3 = forklift(0xf28c28).setPos(-27, 11.5, Math.PI / 2);
const F4 = forklift(0xf28c28).setPos(-40, 11.5, Math.PI / 2);

function f1Job() {
  const v = F1;
  if (v.busy) return;
  const fullLp = Object.values(linePallets).find((lp) => lp.pallet && lp.pallet.count >= lp.pallet.cap && !lp.claimed);
  const freeCart = tugger.state === 'loading' ? tugger.carts.find((c) => !c.pallet && !c.reserved) : null;
  if (fullLp) {
    const slot = freeCart ? null : fgSlots.find((s) => !s.pallet && !s.reserved);
    if (!freeCart && !slot) return;
    lp_pick(v, fullLp);
    if (freeCart) toCart(v, freeCart);
    else toSlot(v, slot);
    return;
  }
  // park
  if (Math.hypot(v.x - CORRIDOR_X, v.z - 9.4) > 0.5) v.move([[v.x, 11], [CORRIDOR_X, 11], [CORRIDOR_X, 9.4]]);
}
// F2 loads the tugger train from the FG racking
function f2Job() {
  const v = F2;
  if (v.busy) return;
  const freeCart = tugger.state === 'loading' ? tugger.carts.find((c) => !c.pallet && !c.reserved) : null;
  if (freeCart && fgPallets() > 0) {
    const slot = fgSlots.filter((s) => s.pallet && !s.reserved).sort((a, b) => a.level - b.level || Math.abs(a.pos.z - 11) - Math.abs(b.pos.z - 11))[0];
    if (!slot) return;
    slot.reserved = true;
    const fx0 = slot.face < 0 ? slot.pos.x + v.f.forkTip + 0.1 : slot.pos.x - v.f.forkTip - 0.1;
    const yy = slot.pos.y;
    v.move([[v.x, 11], [RACK_AISLE_X, 11], [RACK_AISLE_X, slot.pos.z]]);
    lift(v, 0.15, Math.max(0, yy - 0.04), 0.4 + yy * 0.2);
    v.move([[fx0, slot.pos.z]]);
    lift(v, Math.max(0, yy - 0.04), yy + 0.12, 0.3).call(() => {
      attach(v, slot.pallet);
      slot.pallet = null;
      slot.reserved = false;
    });
    v.move([[RACK_AISLE_X, slot.pos.z]], { reverse: true });
    lift(v, yy + 0.12, 0.15, 0.6 + yy * 0.2);
    toCart(v, freeCart);
    return;
  }
  if (Math.hypot(v.x - RACK_AISLE_X, v.z - 11) > 0.5) v.move([[v.x, 11], [RACK_AISLE_X, 11]]);
}
function lp_pick(v, lp) {
  lp.claimed = true;
  const px = lp.x + v.f.forkTip;
  v.move([[v.x, Math.max(v.z, 9.4)], [CORRIDOR_X, 9.4], [CORRIDOR_X, lp.z], [px, lp.z]]);
  lift(v, v.f.carriage.position.y, 0.0, 0.3);
  lift(v, 0, 0.15, 0.5).call(() => {
    attach(v, lp.pallet);
    lp.pallet = null;
    setTimeoutSim(1.2, () => lp.spawn());
  });
  v.move([[CORRIDOR_X, lp.z]], { reverse: true }).move([[CORRIDOR_X, 9.4]]);
}
function toSlot(v, slot) {
  slot.reserved = true;
  const fx0 = slot.face < 0 ? slot.pos.x + v.f.forkTip + 0.1 : slot.pos.x - v.f.forkTip - 0.1;
  const yy = slot.pos.y;
  v.move([[CORRIDOR_X, 11], [RACK_AISLE_X, 11], [RACK_AISLE_X, slot.pos.z]]);
  lift(v, 0.15, yy + 0.15, 0.4 + yy * 0.25);
  v.move([[fx0, slot.pos.z]]);
  lift(v, yy + 0.15, yy - 0.02, 0.3).call(() => {
    slot.pallet = detachTo(v, scene, new THREE.Vector3(slot.pos.x, yy, slot.pos.z), Math.PI / 2);
    slot.reserved = false;
  });
  v.move([[RACK_AISLE_X, slot.pos.z]], { reverse: true });
  lift(v, yy - 0.02, 0.15, 0.4 + yy * 0.25);
  v.move([[RACK_AISLE_X, 11]]);
}
function toCart(v, cart) {
  cart.reserved = true;
  v.call(() => {
    const p = cartWorld(cart);
    v.tasks.unshift(
      { type: 'move', pts: [{ x: v.x, z: 11 }, { x: p.x, z: 11 }, { x: p.x, z: p.z + v.f.forkTip + 0.15 }], i: 0 },
      { type: 'wait', dur: 0.4, t: 0, onUpdate: (k) => { v.f.carriage.position.y = 0.15 + 0.35 * k; } },
      { type: 'call', fn: () => {
        const pal = detachTo(v, cart.group, new THREE.Vector3(0, 0.46, 0), 0);
        cart.pallet = pal;
        cart.reserved = false;
      } },
      { type: 'move', pts: [{ x: p.x, z: 11 }], i: 0, reverse: true },
      { type: 'wait', dur: 0.4, t: 0, onUpdate: (k) => { v.f.carriage.position.y = 0.5 - 0.35 * k; } },
    );
  });
}

function f3Job(v = F3, home = -27) {
  if (v.busy) return false;
  if (tugger.state === 'unloading') {
    const cart = tugger.carts.find((c) => c.pallet && !c.reserved);
    const free = freeStageSlot();
    if (cart && free) {
      cart.reserved = true;
      free.slot.reserved = true;
      const p = cartWorld(cart).clone();
      v.move([[v.x, 11.5], [p.x, 11.5], [p.x, p.z + v.f.forkTip + 0.15]]);
      lift(v, v.f.carriage.position.y, 0.42, 0.4);
      lift(v, 0.42, 0.55, 0.3).call(() => {
        attach(v, cart.pallet);
        cart.pallet = null;
        cart.reserved = false;
      });
      v.move([[p.x, 11.5]], { reverse: true });
      v.move([[free.col.x, 11.5], [free.col.x, free.slot.z - v.f.forkTip - 0.1]]);
      lift(v, 0.55, 0.0, 0.4).call(() => {
        free.slot.pallet = detachTo(v, scene, new THREE.Vector3(free.slot.x, 0, free.slot.z), 0);
        free.slot.reserved = false;
      });
      v.move([[free.col.x, 11.5]], { reverse: true });
      return true;
    }
  }
  if (Math.hypot(v.x - home, v.z - 11.5) > 0.5) v.move([[v.x, 11.5], [home, 11.5]]);
  return false;
}

function f4Job() {
  const v = F4;
  if (v.busy) return;
  const dock = docks.find((d) => d.truck && d.truck.state === 'docked' && d.truck.loaded < d.truck.cap);
  if (dock) {
    const fp = frontStagePallet();
    if (fp) {
      const slot = fp.slot;
      slot.reserved = true;
      const truck = dock.truck;
      truck.pending++;
      v.move([[v.x, 11.5], [slot.x, 11.5], [slot.x, slot.z - v.f.forkTip - 0.1]]);
      lift(v, v.f.carriage.position.y, 0.0, 0.3);
      lift(v, 0, 0.15, 0.4).call(() => {
        attach(v, slot.pallet);
        slot.pallet = null;
        slot.reserved = false;
      });
      v.move([[slot.x, 11.5]], { reverse: true });
      v.move([[dock.x, 11.5], [dock.x, 41.6]]);
      lift(v, 0.15, 1.45, 0.5);
      v.move([[dock.x, 44.6]], { speed: 2 });
      lift(v, 1.45, 1.35, 0.25).call(() => {
        const pal = v.load;
        const k = truck.loaded;
        detachTo(v, truck.trailer, new THREE.Vector3(5.6 - Math.floor(k / 2) * 1.45, 1.35, (k % 2 ? 0.6 : -0.6)), 0);
        truck.motors += pal.count;
        truck.loaded++;
        truck.pending--;
      });
      v.move([[dock.x, 41.5]], { reverse: true });
      lift(v, 1.35, 0.15, 0.4);
      v.move([[dock.x, 11.5]]);
      return;
    }
  }
  // No truck to load: help unload the tugger train
  f3Job(v, -40);
}

function stepTugger(dt) {
  const t = tugger;
  if (t.state === 'loading') {
    t.wait += dt;
    const loaded = t.carts.filter((c) => c.pallet).length;
    const pending = t.carts.some((c) => c.reserved);
    if (!pending && (loaded === t.carts.length || (t.wait > 22 && loaded > 0))) {
      t.state = 'toSW';
      toast(`Tugger train departs with ${loaded} pallet${loaded > 1 ? 's' : ''} for shipping`);
    }
  } else if (t.state === 'unloading') {
    if (t.carts.every((c) => !c.pallet && !c.reserved)) t.state = 'toSE';
  } else {
    const goal = t.state === 'toSE' ? t.sSE : t.sSW;
    let d = goal - t.s;
    if (d < 0) d += tugL;
    const step = t.speed * dt;
    if (d <= step) {
      t.s = goal;
      t.state = t.state === 'toSE' ? 'loading' : 'unloading';
      t.wait = 0;
    } else t.s = (t.s + step) % tugL;
  }
  placeOnPath(t.group, t.s);
  t.carts.forEach((c) => placeOnPath(c.group, t.s - cartOffset(c.i)));
}

function stepTrucks(dt) {
  if (sim.time > nextTruckAt && stagedCount() >= 12 && trucks.length < 2) {
    const dock = docks.find((d) => !d.truck);
    if (dock) {
      const g = new THREE.Group();
      const body = M.createTruck();
      body.rotation.y = Math.PI; // cab faces +x of the vehicle frame
      g.add(body);
      const truck = { dock, state: 'arrive', loaded: 0, pending: 0, cap: 8, motors: 0, trailer: body.children[0], docked: 0 };
      truck.v = new Vehicle(g, { speed: 9, turn: 3 });
      const cz = B.z1 + 6.9;
      truck.v.setPos(-170, 86, 0)
        .move([[dock.x + 20, 86]])
        .move([[dock.x + 7, 73], [dock.x + 1, 62], [dock.x, 56], [dock.x, cz]], { reverse: true, speed: 4 })
        .call(() => {
          truck.state = 'docked';
          toast(`Truck docked at door ${docks.indexOf(dock) + 1} — loading`);
        });
      dock.truck = truck;
      trucks.push(truck);
      nextTruckAt = sim.time + rnd(40, 70);
    }
  }
  for (const tr of trucks) {
    tr.v.step(dt);
    if (tr.state === 'docked') {
      tr.docked += dt;
      if (tr.pending === 0 && (tr.loaded >= tr.cap || (tr.docked > 40 && tr.loaded > 0 && stagedCount() === 0))) {
        tr.state = 'leave';
        tr.v.move([[tr.dock.x, 70], [tr.dock.x + 6, 80], [tr.dock.x + 16, 86], [260, 86]], { speed: 9 }).call(() => {
          tr.state = 'gone';
          sim.shipped += tr.motors;
          sim.trucksOut++;
          toast(`🚚 Truck left with ${tr.loaded} pallets (${tr.motors} motors)`);
        });
        tr.dock.truck = null;
      }
    }
  }
  for (let i = trucks.length - 1; i >= 0; i--) {
    if (trucks[i].state === 'gone') {
      scene.remove(trucks[i].v.obj);
      trucks.splice(i, 1);
    }
  }
}

// Sim-time timers
const timers = [];
function setTimeoutSim(dt, fn) { timers.push({ at: sim.time + dt, fn }); }

// AGVs (line-side deliveries) and decor vehicles
const loops = [];
function loopVehicle(obj, pts, { speed = 3, y = 0, cargo = null, cargoFrom = 0, cargoTo = 0.5, pingpong = false } = {}) {
  const path = roundedPath(pingpong ? [...pts, ...pts.slice(0, -1).reverse()] : pts, 1.2);
  const L = path.getLength();
  const lp = { obj, path, L, s: Math.random() * L, speed, y, cargo, cargoFrom, cargoTo, pause: 0 };
  scene.add(obj);
  loops.push(lp);
  return lp;
}
const agv1 = M.createAGV();
loopVehicle(agv1.group, [[19.5, -24.2], [19.5, -20.6], [-19.6, -20.6], [-19.6, -11], [-19.6, 0.5]], { speed: 3, cargo: agv1.cargo, pingpong: true });
const agv2 = M.createAGV();
loopVehicle(agv2.group, [[-57.4, 1.0], [-57.4, 4.7], [-22.4, 4.7], [-22.4, -9.5]], { speed: 3, cargo: agv2.cargo, pingpong: true });
const agv3 = M.createAGV(0x2a5d9f);
loopVehicle(agv3.group, [[-60, -25.5], [-60, -21.4], [-22.4, -21.4], [-22.4, -14.5]], { speed: 3, cargo: agv3.cargo, pingpong: true });
const recv = M.createForklift();
const recvLoad = M.createPallet();
recvLoad.add(M.box(1.1, 0.9, 0.9, M.mat(0xb98d5c, { roughness: 0.85 })));
recvLoad.children[recvLoad.children.length - 1].position.y = 0.58;
recvLoad.position.set(recv.forkTip, 0.15, 0);
recvLoad.rotation.y = Math.PI / 2;
recv.carriage.add(recvLoad);
loopVehicle(recv.group, [[-79, 30], [-73, 30], [-73, 19], [-73.5, 15]], { speed: 3.5, cargo: recvLoad, pingpong: true, cargoFrom: 0, cargoTo: 0.5 });
const reach = M.createForklift(0x2a5d9f);
loopVehicle(reach.group, [[57, -38], [77, -38], [77, -30], [57, -30]], { speed: 3 });
const reach2 = M.createForklift();
loopVehicle(reach2.group, [[28, 33], [57, 33]], { speed: 2.6, pingpong: true });

function stepLoops(dt) {
  for (const lp of loops) {
    lp.s = (lp.s + lp.speed * dt) % lp.L;
    const u = lp.s / lp.L;
    const p = lp.path.getPointAt(u);
    const t = lp.path.getTangentAt(u);
    lp.obj.position.set(p.x, lp.y, p.z);
    lp.obj.rotation.y = Math.atan2(-t.z, t.x);
    if (lp.cargo) lp.cargo.visible = u >= lp.cargoFrom && u < lp.cargoTo;
  }
}

// =====================================================================
// People: walkers between areas, maintenance technicians, fixed workers
// =====================================================================
const walkers = [];
const POI_KEYS = Object.keys(walkGraph.poi);
function makeWalker(opts, at) {
  const p = M.createPerson(opts);
  scene.add(p.group);
  const w = { p, node: at, path: [], x: at.x, z: at.z, pause: rnd(0, 6), speed: rnd(1.1, 1.5), heading: 0, walk: 0 };
  p.group.position.set(at.x, 0, at.z);
  walkers.push(w);
  return w;
}
for (let i = 0; i < 18; i++) {
  const poi = walkGraph.poi[POI_KEYS[Math.floor(Math.random() * POI_KEYS.length)]];
  makeWalker({ vest: [0xf2e21a, 0xff7a1a, null, 0x9be22e][i % 4], shirt: [0x4b5563, 0x2b3440, 0xffffff, 0x3b5b8a][i % 4], hat: i % 5 === 0 ? 0x2a5d9f : 0xffffff }, poi);
}
function hourNow() { return ((sim.time * FACTORY_SEC) / 3600 + SHIFT_START_H) % 24; }
function pickPoi() {
  const h = hourNow();
  const brk = (h >= 9 && h < 9.25) || (h >= 12 && h < 12.5) || (h >= 15 && h < 15.25) || (h >= 21 && h < 21.5);
  const r = Math.random();
  if (brk && r < 0.6) return walkGraph.poi[r < 0.45 ? 'kitchen' : 'restroom'];
  if (Math.abs(h - 14) < 0.25 && r < 0.5) return walkGraph.poi[r < 0.25 ? 'entrance' : 'lockers'];
  return walkGraph.poi[POI_KEYS[Math.floor(Math.random() * POI_KEYS.length)]];
}
function stepWalker(w, dt) {
  if (w.pause > 0) {
    w.pause -= dt;
    M.posePerson(w.p, 'idle', sim.time);
    return;
  }
  if (!w.path.length) {
    const dest = w.target ? null : pickPoi();
    const route = routeWalk(walkGraph, w.node, dest ?? w.node);
    w.path = route.slice(1).map((n) => ({ x: n.x, z: n.z, n }));
    if (w.dest) w.path.push(w.dest);
    if (!w.path.length) {
      w.pause = rnd(2, 8);
      return;
    }
  }
  const t = w.path[0];
  const dx = t.x - w.x;
  const dz = t.z - w.z;
  const d = Math.hypot(dx, dz);
  const step = w.speed * dt;
  if (d <= step) {
    w.x = t.x;
    w.z = t.z;
    if (t.n) w.node = t.n;
    w.path.shift();
    if (!w.path.length) {
      w.pause = w.tech ? 0 : rnd(3, 14);
      w.onArrive?.();
    }
  } else {
    w.x += (dx / d) * step;
    w.z += (dz / d) * step;
    w.heading = lerpAngle(w.heading, Math.atan2(-dz, dx), 1 - Math.exp(-10 * dt));
  }
  w.walk += dt * 6.5;
  M.posePerson(w.p, w.carry ? 'carry' : 'walk', w.walk);
  w.p.group.position.set(w.x, 0, w.z);
  w.p.group.rotation.y = w.heading;
}

// Maintenance technicians (dispatched by the AI layer)
const techs = [];
for (let i = 0; i < 3; i++) {
  const home = walkGraph.poi.maint;
  const p = M.createPerson({ shirt: 0x1e3a8a, vest: null, hat: 0x2a5d9f, pants: 0x1e293b });
  // tool bag
  const bag = M.box(0.35, 0.25, 0.18, M.mat(0xff000f));
  bag.position.set(0, -0.62, 0.06);
  p.arms[1].add(bag);
  scene.add(p.group);
  const t = { p, node: home, path: [], x: home.x + i * 0.8 - 0.8, z: home.z, pause: 0, speed: 2.6, heading: 0, walk: 0, tech: true, busy: false, job: null };
  p.group.position.set(t.x, 0, t.z);
  techs.push(t);
}

function dispatchTech(st) {
  if (st.maintPending || st.down && st.downKind === 'maint') return false;
  const t = techs.find((k) => !k.busy);
  if (!t) {
    toast('All maintenance technicians are busy — job queued', 'warn');
    st.maintQueued = true;
    return false;
  }
  t.busy = true;
  t.job = st;
  st.maintPending = t;
  st.maintQueued = false;
  const target = nearestNode(walkGraph, st.center.x, st.center.z);
  const route = routeWalk(walkGraph, t.node, target);
  t.path = route.slice(1).map((n) => ({ x: n.x, z: n.z, n }));
  t.path.push({ x: st.center.x, z: st.center.z });
  t.pause = 0;
  t.onArrive = () => {
    if (st.down && st.downKind === 'fail') {
      // Breakdown: the repair clock starts now
      st.downCause = `Repair in progress — ${st.downCause.replace(/^Repair in progress — /, '')}`;
    } else {
      // Planned maintenance: short stop, health restored
      st.down = true;
      st.downKind = 'maint';
      st.downCause = `Planned maintenance — ${st.ai.mode ?? 'inspection'}`;
      st.downLeft = 12;
    }
    t.working = true;
    t.onArrive = null;
    const face = new THREE.Vector3().subVectors(st.group.position, new THREE.Vector3(t.x, 0, t.z));
    t.heading = Math.atan2(-face.z, face.x);
  };
  toast(`🔧 Technician dispatched to ${st.cfg.name} (${st.line.short})`);
  return true;
}
function stepTechs(dt) {
  for (const t of techs) {
    if (t.working) {
      M.posePerson(t.p, 'work', sim.time * 4);
      t.p.group.position.set(t.x, 0, t.z);
      t.p.group.rotation.y = t.heading;
      const st = t.job;
      if (!st.down) {
        t.working = false;
        t.busy = false;
        st.maintPending = null;
        t.job = null;
        // walk home
        const route = routeWalk(walkGraph, nearestNode(walkGraph, t.x, t.z), walkGraph.poi.maint);
        t.path = route.map((n) => ({ x: n.x, z: n.z, n }));
        const next = stations.find((s) => s.maintQueued);
        if (next) dispatchTech(next);
      }
      continue;
    }
    if (!t.path.length && !t.busy) {
      M.posePerson(t.p, 'idle', sim.time);
      t.p.group.position.set(t.x, 0, t.z);
      continue;
    }
    if (t.path.length) stepWalker(t, dt);
  }
}

// Fixed people (desks, sub-assembly benches)
const fixedPeople = plant.people.map((d) => {
  const p = M.createPerson({ shirt: d.shirt ?? 0x4b5563, vest: d.kind === 'desk' ? null : d.vest, hat: d.kind === 'desk' ? 0x2b1d14 : 0xffffff, glasses: d.kind !== 'desk' });
  if (d.kind === 'desk') {
    p.group.position.set(d.x, -0.35, d.z);
    p.legs.forEach((l) => { l.rotation.z = 1.4; });
  } else p.group.position.set(d.x, 0, d.z);
  p.group.rotation.y = d.rot;
  scene.add(p.group);
  return { p, kind: d.kind };
});

// =====================================================================
// Simulation step
// =====================================================================
function stepSim(dt) {
  sim.time += dt;
  for (const st of stations) {
    if (st.down) {
      st.downtime += dt;
      if (st.downKind === 'fail') st.unplanned += dt;
      if (st.downKind === 'jam') st.unplanned += dt;
      // A failure waits for a technician before the repair clock runs
      if (st.downKind === 'fail' && !st.maintPending) continue;
      if (st.downKind === 'fail' && st.maintPending && !st.maintPending.working) continue;
      st.downLeft -= dt;
      if (st.downLeft <= 0) {
        const kind = st.downKind;
        st.down = false;
        st.downKind = null;
        if (kind === 'maint' || kind === 'fail') ai.repaired(st, kind);
        else toast(`${st.cfg.name} back in service`);
      }
    }
  }
  for (const line of lines) line.step(dt);
  const k = 1 - Math.exp(-dt / 30);
  for (const st of stations) {
    st.status = stationStatus(st);
    st.ema.util += ((st.status === 'working' ? 1 : 0) - st.ema.util) * k;
    st.ema.blocked += ((st.status === 'blocked' ? 1 : 0) - st.ema.blocked) * k;
    st.ema.starved += ((st.status === 'idle' ? 1 : 0) - st.ema.starved) * k;
  }
  ai.step(dt);
  for (let i = timers.length - 1; i >= 0; i--) if (sim.time >= timers[i].at) {
    const t = timers[i];
    timers.splice(i, 1);
    t.fn();
  }
  f1Job();
  f2Job();
  f3Job();
  f4Job();
  for (const v of vehicles) v.step(dt);
  stepTugger(dt);
  stepTrucks(dt);
  stepLoops(dt);
  for (const w of walkers) stepWalker(w, dt);
  stepTechs(dt);
}

// Called by the AI layer when a predicted failure actually happens
export function failStation(st, cause) {
  st.down = true;
  st.downKind = 'fail';
  st.downCause = cause;
  st.downLeft = 40;
}
ai.setFailHandler((st, cause) => {
  failStation(st, cause);
  toast(`⛔ ${st.cfg.name} (${st.line.short}) broke down: ${cause}`, 'warn');
  if (ai.autopilot) dispatchTech(st);
  else if (!st.maintPending) setTimeoutSim(6, () => { if (st.down && !st.maintPending) dispatchTech(st); }); // reactive call-out
});

// =====================================================================
// Per-frame visuals
// =====================================================================
function stationStatus(st) {
  if (st.down) return st.downKind === 'maint' ? 'maint' : 'down';
  const occ = st.occupant;
  if (occ && occ.state === 'processing' && occ.next === st.index && st.line.units.includes(occ)) return st.waiting ? 'idle' : 'working';
  const blocked = st.line.units.some((u) => (u.state === 'moving' && u.blocked && u.next === st.index + 1 && u.s - st.s < st.line.spacing + 0.5)
    || (u.state === 'atEnd' && st.index === st.line.stations.length - 1 && u.s - st.s < st.line.spacing + 0.5));
  return blocked ? 'blocked' : 'idle';
}

let blinkT = 0;
const ctx = { fx };
function updateVisuals(simDt, dt) {
  blinkT += dt;
  const blink = Math.floor(blinkT * 3) % 2 === 0;
  for (const st of stations) {
    const working = st.status === 'working';
    const occ = st.occupant && st.line.units.includes(st.occupant) && st.occupant.next === st.index ? st.occupant : null;
    Object.assign(ctx, {
      working: working && !sim.paused, status: st.status, occ, p: occ ? clamp01(occ.t / occ.dur) : 0,
      t: sim.time, simDt, dt, y: st.line.y, blink,
    });
    st.machine.update?.(ctx);
    if (st.machine.hidesPart && occ) occ.group.visible = !st.machine.hidesPart(ctx.p);
    else if (occ) occ.group.visible = true;
    st.machine.light.set(st.status === 'maint' ? 'maint' : st.status, blink);
    st.zoneMat.color.setHex(st === selected ? 0x111111 : st.status === 'down' ? 0xef4444 : 0x5a626b);
    st.zoneMat.opacity = st === selected ? 1 : 0.55;
    for (const person of st.ops) {
      person.phase += simDt;
      M.posePerson(person, working ? 'work' : 'idle', person.phase * 3);
    }
    // AI alert halo / marker
    const alert = st.ai?.alert;
    const sev = st.down && st.downKind === 'fail' ? 2 : alert ? alert.sev : 0;
    st.halo.material.opacity = sev ? 0.35 + Math.sin(blinkT * 5) * 0.25 : 0;
    st.halo.material.color.setHex(sev === 2 ? 0xef4444 : 0xf59e0b);
    st.marker.visible = sev > 0 && showAlerts;
  }
  for (const f of fixedPeople) {
    if (f.kind === 'work') M.posePerson(f.p, 'work', sim.time * 3 + f.p.phase);
  }
  for (const b of Object.values(stock)) if (b.items) b.items.forEach((im) => { im.count = b.count; });
  plant.update(camera);
  fx.update(dt);
}

// =====================================================================
// Camera
// =====================================================================
const CAMS = {
  overview: { pos: [-18, 105, 128], target: [0, 0, 2], label: 'Overview' },
  plan: { pos: [0, 200, 1.0], target: [0, 0, 0.99], label: 'Plan' },
  assembly: { pos: [8, 20, 18], target: [22, 1, -8], label: 'Assembly' },
  stator: { pos: [-27, 15, 13], target: [-40, 1, -7], label: 'Stator & VPI' },
  east: { pos: [4, 17, -10], target: [0, 1, -31], label: 'East lines' },
  press: { pos: [-28, 10, -18], target: [-35, 2, -31], label: 'Press shop' },
  logistics: { pos: [52, 38, 58], target: [20, 0, 18], label: 'Logistics' },
  rewind: { pos: [35, 12, 3], target: [43, 1, 18], label: 'Rewinding' },
  shipping: { pos: [-22, 30, 82], target: [-34, 0, 32], label: 'Shipping' },
};
const follow = { active: false, unit: null };
const tween = { active: false };
const tour = { active: false, i: 0, t: 0 };
const TOUR = ['overview', 'assembly', 'stator', 'east', 'press', 'logistics', 'rewind', 'shipping', 'plan'];

function flyTo(pos, target, duration = 1.6) {
  Object.assign(tween, {
    active: true, t: 0, duration,
    fromPos: camera.position.clone(), fromTarget: controls.target.clone(),
    toPos: new THREE.Vector3(...pos), toTarget: new THREE.Vector3(...target),
  });
}
function updateCamera(dt) {
  if (tour.active && !tween.active) {
    tour.t += dt;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    if (tour.t > 9) {
      tour.t = 0;
      tour.i = (tour.i + 1) % TOUR.length;
      const p = CAMS[TOUR[tour.i]];
      flyTo(p.pos, p.target, 2.4);
      setActive('cam', 'tour');
    }
  } else controls.autoRotate = false;
  if (tween.active) {
    tween.t += dt / tween.duration;
    const k = ease(clamp01(tween.t));
    camera.position.lerpVectors(tween.fromPos, tween.toPos, k);
    controls.target.lerpVectors(tween.fromTarget, tween.toTarget, k);
    if (tween.t >= 1) tween.active = false;
  } else if (follow.active) {
    if (!follow.unit || !follow.unit.line.units.includes(follow.unit)) follow.unit = pickFollowUnit();
    if (follow.unit) {
      const p = follow.unit.group.getWorldPosition(new THREE.Vector3());
      const goal = new THREE.Vector3(p.x, p.y + 0.6, p.z);
      const delta = goal.sub(controls.target);
      const k = 1 - Math.exp(-3 * dt);
      controls.target.addScaledVector(delta, k);
      camera.position.addScaledVector(delta, k);
    }
  }
  controls.update();
}
function pickFollowUnit() {
  const us = ASM_A.units.filter((u) => u.next <= 2).sort((a, b) => b.s - a.s);
  return us[0] ?? ASM_A.units[0] ?? null;
}

// =====================================================================
// UI
// =====================================================================
const $ = (id) => document.getElementById(id);
let selected = null;
let activeLine = ASM_A;
let showAlerts = true;
const STATUS_LABEL = { working: 'Working', idle: 'Starved', blocked: 'Blocked', down: 'Fault', maint: 'Maintenance' };
let uiTick = 0;
const sparkCanvas = $('info-spark');

const tabs = $('line-tabs');
const stationList = $('station-list');
for (const line of lines) {
  const tab = document.createElement('button');
  tab.className = 'tab';
  tab.textContent = line.short;
  tab.addEventListener('click', () => showLine(line));
  tabs.appendChild(tab);
  line.tab = tab;
  line.list = document.createElement('div');
  line.list.hidden = true;
  stationList.appendChild(line.list);
  for (const st of line.stations) {
    const row = document.createElement('button');
    row.className = 'st-row';
    row.innerHTML = `
      <span class="st-num">${String(st.index + 1).padStart(2, '0')}</span>
      <span class="st-main"><span class="st-name">${st.cfg.name}</span><span class="st-bar"><span class="st-fill"></span></span></span>
      <span class="st-health" title="Machine health (AI)"></span>
      <span class="st-status"><i class="dot"></i><span class="st-label">Starved</span></span>`;
    row.addEventListener('click', () => selectStation(st, true));
    line.list.appendChild(row);
    st.row = row;
  }
}
function showLine(line) {
  activeLine = line;
  for (const l of lines) {
    l.list.hidden = l !== line;
    l.tab.classList.toggle('active', l === line);
  }
  updateUI(true);
}
showLine(ASM_A);

function selectStation(st, focus) {
  selected = st;
  $('info').hidden = !st;
  if (st) {
    if (st.line !== activeLine) showLine(st.line);
    showPanel('lines');
    if (focus) {
      follow.active = false;
      tour.active = false;
      setActive('cam', null);
      const p = st.center;
      const dir = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), st.group.rotation.y);
      flyTo([p.x + dir.x * 8 - 4, 6.5, p.z + dir.z * 8], [st.group.position.x, 1.2, st.group.position.z]);
    }
  }
  updateUI(true);
}
function setActive(group, value) {
  document.querySelectorAll(`[data-${group}]`).forEach((b) => b.classList.toggle('active', b.dataset[group] === value));
}
function showPanel(name) {
  document.querySelectorAll('[data-panel]').forEach((b) => b.classList.toggle('active', b.dataset.panel === name));
  document.querySelectorAll('.pane').forEach((p) => { p.hidden = p.id !== `pane-${name}`; });
  if (name === 'copilot') $('chat-input').focus({ preventScroll: true });
}
document.querySelectorAll('[data-panel]').forEach((b) => b.addEventListener('click', () => showPanel(b.dataset.panel)));

document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
  sim.speed = Number(b.dataset.speed);
  setActive('speed', b.dataset.speed);
}));
document.querySelectorAll('[data-cam]').forEach((b) => b.addEventListener('click', () => setCam(b.dataset.cam)));
function setCam(mode) {
  setActive('cam', mode);
  follow.active = mode === 'follow';
  tour.active = mode === 'tour';
  follow.unit = null;
  if (mode === 'follow') {
    const u = pickFollowUnit();
    follow.unit = u;
    if (u) {
      const p = u.group.position;
      flyTo([p.x - 3, 3.2, p.z + 5.5], [p.x, p.y + 0.6, p.z], 1.2);
    }
  } else if (mode === 'tour') {
    tour.i = 0;
    tour.t = 0;
    const p = CAMS.overview;
    flyTo(p.pos, p.target, 2);
  } else {
    const p = CAMS[mode];
    flyTo(p.pos, p.target);
    if (mode === 'plan') setLegend(true);
    const tabFor = { stator: STATOR, east: ROTOR, press: PRESS, rewind: REWIND, assembly: ASM_A };
    if (tabFor[mode]) showLine(tabFor[mode]);
  }
}
$('play').addEventListener('click', togglePause);
function togglePause() {
  sim.paused = !sim.paused;
  $('play').textContent = sim.paused ? '▶ Resume' : '❚❚ Pause';
  $('play').classList.toggle('active', sim.paused);
}
$('faults').addEventListener('change', (e) => { sim.faults = e.target.checked; });
$('autopilot').addEventListener('change', (e) => {
  ai.autopilot = e.target.checked;
  toast(ai.autopilot ? 'AI autopilot on — maintenance is scheduled automatically' : 'AI autopilot off — you approve each work order');
});
$('labels').addEventListener('change', (e) => {
  plant.labels.visible = e.target.checked;
  showAlerts = e.target.checked;
});
function setLegend(on) {
  plant.legend.visible = on;
  $('legend').checked = on;
  $('legend-key').hidden = !on;
}
$('legend').addEventListener('change', (e) => setLegend(e.target.checked));
$('heatmap').addEventListener('change', (e) => {
  ai.heatmap.setMode(e.target.value);
  $('heat-key').hidden = e.target.value === 'off';
  $('heat-key-title').textContent = { util: 'Utilisation', energy: 'Power draw', wip: 'Blocked / queue', health: 'Failure risk' }[e.target.value] ?? '';
});
$('feed-toggle').addEventListener('change', (e) => {
  ai.vision.setVisible(e.target.checked);
  document.body.classList.toggle('no-feed', !e.target.checked);
});
$('info-close').addEventListener('click', () => selectStation(null));
$('info-fault').addEventListener('click', () => {
  if (!selected) return;
  if (selected.down) {
    selected.down = false;
    selected.downKind = null;
    toast(`${selected.cfg.name} back in service`);
  } else breakStation(selected, 25, 'manual stop (injected)');
  updateUI(true);
});
$('info-maint').addEventListener('click', () => {
  if (selected) dispatchTech(selected);
  updateUI(true);
});
$('panel-toggle').addEventListener('click', () => document.body.classList.toggle('panel-open'));
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code === 'Space') {
    e.preventDefault();
    togglePause();
  }
});

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  downAt = [e.clientX, e.clientY];
  tween.active = false;
  if (tour.active) {
    tour.active = false;
    setActive('cam', null);
  }
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(pickables, false)[0];
  selectStation(hit ? hit.object.userData.station : null, !!hit);
});

function toast(msg, kind = 'info') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  $('toasts').prepend(el);
  while ($('toasts').children.length > 4) $('toasts').lastChild.remove();
  setTimeout(() => el.classList.add('out'), 4200);
  setTimeout(() => el.remove(), 4700);
  ai.log(msg, kind);
}

function fmtClock(simSec) {
  const mins = Math.floor((simSec * FACTORY_SEC) / 60) + SHIFT_START_H * 60;
  const day = Math.floor(mins / 1440) + 1;
  const hh = String(Math.floor((mins % 1440) / 60)).padStart(2, '0');
  const mm = String(mins % 60).padStart(2, '0');
  const shift = (mins % 1440) / 60 >= 6 && (mins % 1440) / 60 < 14 ? 'Shift 1' : (mins % 1440) / 60 >= 14 && (mins % 1440) / 60 < 22 ? 'Shift 2' : 'Shift 3';
  return `Day ${day} · ${hh}:${mm} · ${shift}`;
}
function rateNow() {
  const ts = sim.doneTimes.slice(-24);
  if (ts.length < 3) return 0;
  const hours = ((ts[ts.length - 1] - ts[0]) * FACTORY_SEC) / 3600;
  return hours > 0 ? (ts.length - 1) / hours : 0;
}
function oee() {
  const asm = [...ASM_A.stations, ...ASM_B.stations];
  const T = Math.max(1, sim.time);
  const avail = 1 - asm.reduce((a, s) => a + s.downtime, 0) / (T * asm.length);
  const hours = (T * FACTORY_SEC) / 3600;
  const perf = Math.min(1, sim.built / Math.max(1, hours * 52));
  const qual = sim.inspected ? sim.passed / sim.inspected : 1;
  return { avail, perf, qual, oee: avail * perf * qual };
}

export function snapshot() {
  const o = oee();
  return {
    clock: fmtClock(sim.time),
    plan_rate_per_h: PLAN_RATE,
    output_rate_per_h: Math.round(rateNow() * 10) / 10,
    motors_built: sim.built, line_A_built: sim.builtA, line_B_built: sim.builtB,
    shipped_motors: sim.shipped, trucks_out: sim.trucksOut, rework_rejects: sim.rejected,
    first_pass_yield: sim.inspected ? +(sim.passed / sim.inspected).toFixed(3) : null,
    oee: +o.oee.toFixed(3), availability: +o.avail.toFixed(3), performance: +o.perf.toFixed(3), quality: +o.qual.toFixed(3),
    plant_kw: Math.round(ai.energy.kw), kwh_per_motor: sim.built ? +(ai.energy.kwh / sim.built).toFixed(1) : null,
    stocks: Object.fromEntries(Object.entries(stock).map(([k, b]) => [b.name, `${b.count}/${b.cap}`])),
    fg_rack_pallets: fgPallets(), staged_pallets: stagedCount(), trucks_at_dock: trucks.filter((t) => t.state === 'docked').length,
    lines: lines.map((l) => ({
      line: l.name,
      stations: l.stations.map((s) => ({
        name: s.cfg.name, status: s.status, down_cause: s.down ? s.downCause : undefined,
        utilisation: +(s.ema.util).toFixed(2), blocked: +(s.ema.blocked).toFixed(2), starved: +(s.ema.starved).toFixed(2),
        health: s.ai?.tracked ? +s.ai.health.toFixed(2) : undefined,
        predicted_failure_h: s.ai?.alert ? +s.ai.alert.rulH.toFixed(1) : undefined,
        failure_mode: s.ai?.alert ? s.ai.mode : undefined,
        downtime_min: Math.round((s.downtime * FACTORY_SEC) / 60),
      })),
    })),
    open_ai_alerts: ai.alerts.map((a) => ({ station: a.st.cfg.name, line: a.st.line.short, mode: a.st.ai.mode, rul_h: +a.rulH.toFixed(1), severity: a.sev === 2 ? 'critical' : 'warning', scheduled: !!a.st.maintPending })),
    defects_by_type: ai.defectCounts(),
    maintenance: { avoided_downtime_min: Math.round(ai.stats.avoided * FACTORY_SEC / 60), unplanned_downtime_min: Math.round(stations.reduce((a, s) => a + s.unplanned, 0) * FACTORY_SEC / 60), work_orders: ai.stats.orders },
  };
}

function updateUI(force = false) {
  uiTick++;
  if (!force && uiTick % 10) return;
  const rate = rateNow();
  const o = oee();
  $('k-clock').textContent = fmtClock(sim.time);
  $('k-built').textContent = sim.built.toLocaleString();
  $('k-rate').textContent = rate ? `${rate.toFixed(0)}/h` : '—';
  $('k-rate').dataset.low = rate > 0 && rate < PLAN_RATE * 0.9;
  $('k-oee').textContent = sim.time > 30 ? `${(o.oee * 100).toFixed(0)}%` : '—';
  $('k-fpy').textContent = sim.inspected ? `${((sim.passed / sim.inspected) * 100).toFixed(1)}%` : '—';
  $('k-kw').textContent = `${Math.round(ai.energy.kw).toLocaleString()} kW`;
  $('k-kwh').textContent = sim.built ? `${(ai.energy.kwh / sim.built).toFixed(1)} kWh` : '—';
  $('k-shipped').textContent = sim.shipped.toLocaleString();
  $('k-fg').textContent = `${fgPallets()} rack · ${stagedCount()} staged`;
  const unpl = stations.reduce((a, s) => a + s.unplanned, 0);
  $('k-down').textContent = `${Math.round((unpl * FACTORY_SEC) / 60)} min`;
  $('k-avoided').textContent = `${Math.round((ai.stats.avoided * FACTORY_SEC) / 60)} min`;
  $('k-alerts').textContent = ai.alerts.length;
  $('k-alerts').dataset.low = ai.alerts.some((a) => a.sev === 2);
  $('ai-badge').textContent = ai.alerts.length || '';
  $('ai-badge').hidden = !ai.alerts.length;

  for (const st of activeLine.stations) {
    const occ = st.status === 'working' || st.down ? st.occupant : null;
    const p = occ ? clamp01(occ.t / occ.dur) : 0;
    st.row.querySelector('.st-fill').style.width = `${(p * 100).toFixed(0)}%`;
    st.row.dataset.status = st.status;
    st.row.querySelector('.st-label').textContent = st.waiting && !st.down ? 'No parts' : STATUS_LABEL[st.status];
    st.row.classList.toggle('selected', st === selected);
    const h = st.row.querySelector('.st-health');
    if (st.ai?.tracked) {
      h.textContent = `${Math.round(st.ai.health * 100)}`;
      h.dataset.level = st.ai.health < 0.25 ? 'crit' : st.ai.health < 0.45 ? 'warn' : 'ok';
    } else h.textContent = '';
  }
  for (const line of lines) line.tab.dataset.alert = line.stations.some((s) => s.down || s.ai?.alert);
  $('line-output').textContent = activeLine.motorKind
    ? `${activeLine.motorKind === 'A' ? sim.builtA : sim.builtB} motors built`
    : activeLine === REWIND ? `${sim.serviced} repairs done` : `${activeLine.produced} ${activeLine.unitName} made`;
  const stockHtml = Object.values(stock).map((b) => {
    const pct = b.count / b.cap;
    return `<div class="stock" data-low="${pct < 0.15}"><span>${b.name}</span><span class="bar"><i style="width:${(pct * 100).toFixed(0)}%"></i></span><b>${b.count}</b></div>`;
  }).join('');
  $('stocks').innerHTML = stockHtml;

  if (selected) {
    const st = selected;
    const occ = st.occupant;
    $('info-num').textContent = `${st.line.name} · Station ${String(st.index + 1).padStart(2, '0')}`;
    $('info-name').textContent = st.cfg.name;
    $('info-desc').textContent = st.cfg.desc;
    const label = st.down ? (st.downKind === 'maint' ? 'Maintenance' : st.downKind === 'fail' ? (st.maintPending ? 'Repair' : 'Breakdown') : 'Fault') : st.waiting ? 'No parts' : STATUS_LABEL[st.status];
    $('info-status').textContent = label;
    $('info-status').dataset.status = st.status;
    $('info-cause').textContent = st.down ? st.downCause : '';
    $('info-cycle').textContent = `${((st.cfg.cycle * FACTORY_SEC) / 60).toFixed(1)} min`;
    $('info-done').textContent = st.processed;
    $('info-util').textContent = `${(st.ema.util * 100).toFixed(0)}%`;
    $('info-down').textContent = `${Math.round((st.downtime * FACTORY_SEC) / 60)} min`;
    $('info-unit').textContent = occ && st.line.units.includes(occ) ? `${occ.id} · ${Math.round(clamp01(occ.t / occ.dur) * 100)}%` : '—';
    $('info-fault').textContent = st.down ? 'Clear fault' : 'Inject fault';
    const s = ai.sensors(st);
    $('info-ai').hidden = !st.ai?.tracked;
    if (st.ai?.tracked) {
      $('info-health').textContent = `${Math.round(s.health * 100)}%`;
      $('info-health').dataset.level = s.health < 0.25 ? 'crit' : s.health < 0.45 ? 'warn' : 'ok';
      $('info-vib').textContent = `${s.vib.toFixed(1)} mm/s`;
      $('info-temp').textContent = `${s.temp.toFixed(0)} °C`;
      $('info-kw').textContent = `${s.kw.toFixed(0)} kW`;
      $('info-rul').textContent = st.ai.alert ? `${st.ai.alert.rulH.toFixed(1)} h · ${st.ai.mode}` : 'No failure predicted';
      $('info-rul').dataset.level = st.ai.alert ? (st.ai.alert.sev === 2 ? 'crit' : 'warn') : 'ok';
      $('info-maint').disabled = !!st.maintPending || (st.down && st.downKind === 'maint');
      $('info-maint').textContent = st.maintPending ? 'Technician assigned' : 'Schedule maintenance';
      ai.drawSpark(sparkCanvas, st);
    }
  }
  ai.renderPanel();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// =====================================================================
// Main loop
// =====================================================================
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  let simDt = 0;
  if (!sim.paused) {
    simDt = dt * sim.speed;
    const steps = Math.ceil(simDt / 0.05);
    for (let i = 0; i < steps; i++) stepSim(simDt / steps);
  }
  updateVisuals(simDt, dt);
  updateCamera(dt);
  updateUI();
  ai.frame(dt, simDt);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  renderer.render(scene, camera);
  ai.vision.render();
  requestAnimationFrame(frame);
}

// Start the shift with finished goods already in racking and staging
function prefillPallet(kind) {
  const p = M.createLoadedPallet(kind);
  p.setCount(p.cap);
  return p;
}
fgSlots.filter((s) => s.level < 2 || s.bay % 3 === 0).slice(0, 26).forEach((slot, i) => {
  const p = prefillPallet(i % 3 === 0 ? 'A' : 'B');
  p.group.position.copy(slot.pos);
  p.group.rotation.y = Math.PI / 2;
  scene.add(p.group);
  slot.pallet = p;
});
for (let i = 0; i < 30; i++) {
  const free = freeStageSlot();
  if (!free) break;
  const p = prefillPallet(i % 2 ? 'A' : 'B');
  p.group.position.set(free.slot.x, 0, free.slot.z);
  scene.add(p.group);
  free.slot.pallet = p;
}

// Pre-warm so every line is populated on first view (no random faults while warming up)
sim.faults = false;
ai.warming = true;
for (let i = 0; i < 2400; i++) stepSim(0.1);
ai.warming = false;
sim.faults = $('faults').checked;
for (const st of stations) {
  Object.assign(st, { workTime: 0, downtime: 0, unplanned: 0, processed: 0 });
}
for (const line of lines) line.produced = 0;
Object.assign(sim, { time: 0, built: 0, builtA: 0, builtB: 0, shipped: 0, rejected: 0, inspected: 0, passed: 0, serviced: 0, doneTimes: [], palletsMade: 0, trucksOut: 0 });
timers.forEach((t) => { t.at -= 240; });
nextTruckAt = 20;
ai.resetAfterWarmup();
updateUI(true);
frame();
document.body.classList.add('ready');
setTimeout(() => toast('Welcome — this is a live digital twin. Click any station, or ask the AI Copilot.'), 600);
window.motorPlant = {
  sim, lines, stations, stock, ai, snapshot, setCam, tugger, trucks, fgSlots, techs, renderer, camera, controls,
  scene, plant, breakStation,
  advance(sec) { for (let i = 0; i < sec * 10; i++) stepSim(0.1); updateVisuals(0, 0.016); updateUI(true); },
  jump(name) {
    const p = CAMS[name];
    tween.active = false;
    camera.position.set(...p.pos);
    controls.target.set(...p.target);
    controls.update();
  },
};
