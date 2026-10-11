// FlexSim-style library of generic 3D objects. Not 1:1 models – clean, recognisable stand-ins
// you can place from a layout file. Each builder returns
//   { group, entry?, exit?, slot?(i), workPoint?, setState?(s), animate?(dt, ctx), height }
// with points in the object's local space (flow runs along local +x).
import * as THREE from 'three';
import { createRobot, createForklift } from '../models.js';

const cache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!cache.has(key)) cache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.15, ...opts }));
  return cache.get(key);
}
const geoCache = new Map();
function geo(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}
export function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d)), material);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}
export function cyl(r, h, material, x = 0, y = 0, z = 0, seg = 16) {
  const m = new THREE.Mesh(geo(`c${r}|${h}|${seg}`, () => new THREE.CylinderGeometry(r, r, h, seg)), material);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}
const glowMat = (c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false });

const C = {
  frame: 0x5b6470,
  steel: 0xb9c0c8,
  top: 0xd5dade,
  blue: 0x2f6fd6,
  orange: 0xf08a24,
  yellow: 0xf2c230,
  green: 0x2e9e5b,
  red: 0xc9353c,
  dark: 0x2a2e34,
  white: 0xeef0f2,
  carton: 0xc79a62,
  wood: 0xb08355,
};

// Stack light (green = working, amber = blocked, off = starved, red = fault)
function lightTower(x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.add(cyl(0.025, 0.5, mat(C.dark), 0, 0.25, 0, 8));
  const lamps = {};
  [['red', 0xff3b30], ['amber', 0xffb020], ['green', 0x34c759]].forEach(([k, c], i) => {
    const m = new THREE.Mesh(geo('lamp', () => new THREE.CylinderGeometry(0.07, 0.07, 0.12, 14)), new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.4 }));
    m.position.y = 0.56 + (2 - i) * 0.13;
    m.userData.on = c;
    g.add(m);
    lamps[k] = m;
  });
  const set = (state) => {
    const on = { working: 'green', busy: 'green', blocked: 'amber', down: 'red' }[state];
    for (const [k, m] of Object.entries(lamps)) {
      m.material.color.setHex(k === on ? m.userData.on : 0x3a3d42);
      m.material.emissive = new THREE.Color(k === on ? m.userData.on : 0x000000);
      m.material.emissiveIntensity = k === on ? 1.2 : 0;
    }
  };
  set('idle');
  return { group: g, set };
}

// ---------------------------------------------------------------- operator
export function makeOperator(vest = 0xff7a1a) {
  const root = new THREE.Group();
  const pants = mat(0x2b3440);
  const skin = mat(0xc99a78, { roughness: 0.8 });
  const legs = [-0.1, 0.1].map((x) => {
    const g = new THREE.Group();
    g.position.set(x, 0.92, 0);
    g.add(box(0.15, 0.88, 0.18, pants, 0, -0.44, 0));
    g.add(box(0.16, 0.08, 0.26, mat(0x1d1f22), 0, -0.88, 0.04));
    root.add(g);
    return g;
  });
  root.add(box(0.42, 0.6, 0.24, mat(vest, { roughness: 0.7 }), 0, 1.22, 0));
  root.add(box(0.43, 0.06, 0.25, mat(0xd8dde2, { emissive: 0x666666 }), 0, 1.1, 0)); // reflective band
  const arms = [-0.27, 0.27].map((x) => {
    const g = new THREE.Group();
    g.position.set(x, 1.48, 0);
    g.add(box(0.11, 0.6, 0.11, mat(vest, { roughness: 0.7 }), 0, -0.3, 0));
    g.add(box(0.1, 0.1, 0.1, mat(0x3b82f6), 0, -0.63, 0)); // gloves
    root.add(g);
    return g;
  });
  const head = new THREE.Mesh(geo('head', () => new THREE.SphereGeometry(0.13, 16, 12)), skin);
  head.position.y = 1.66;
  root.add(head);
  const hat = new THREE.Mesh(geo('hat', () => new THREE.SphereGeometry(0.15, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2)), mat(0xf4f5f6, { roughness: 0.3 }));
  hat.position.y = 1.7;
  root.add(hat);
  let t = Math.random() * 10;
  // mode: 'idle' | 'work' | 'walk'
  root.userData.animate = (dt, mode) => {
    t += dt;
    const k = 1 - Math.exp(-10 * dt);
    const target = { l: [0, 0], a: [0, 0] };
    if (mode === 'walk') {
      const s = Math.sin(t * 7);
      target.l = [s * 0.5, -s * 0.5];
      target.a = [-s * 0.4, s * 0.4];
    } else if (mode === 'work') {
      target.a = [-1.0 + Math.sin(t * 5) * 0.25, -0.9 + Math.sin(t * 5 + 1.7) * 0.25];
    } else {
      target.a = [Math.sin(t * 1.3) * 0.04, -Math.sin(t * 1.3) * 0.04];
    }
    legs.forEach((g, i) => { g.rotation.x += (target.l[i] - g.rotation.x) * k; });
    arms.forEach((g, i) => { g.rotation.x += (target.a[i] - g.rotation.x) * k; });
  };
  return root;
}

// ---------------------------------------------------------------- flow objects
function source(p) {
  const g = new THREE.Group();
  const body = mat(C.green, { roughness: 0.5 });
  g.add(box(1.4, 1.5, 1.4, body, 0, 0.75, 0));
  g.add(box(1.5, 0.12, 1.5, mat(0x23784a), 0, 1.56, 0));
  g.add(box(0.05, 0.5, 0.8, mat(0x1e2023), 0.72, 1.0, 0)); // hatch
  // Out-feed table
  g.add(box(1.1, 0.06, 0.9, mat(C.top), 1.25, 0.86, 0));
  for (const z of [-0.38, 0.38]) g.add(box(0.06, 0.84, 0.06, mat(C.frame), 1.7, 0.42, z));
  // Arrow on top
  const arrow = new THREE.Mesh(geo('arrow', () => {
    const s = new THREE.Shape();
    s.moveTo(-0.4, -0.12); s.lineTo(0.1, -0.12); s.lineTo(0.1, -0.28); s.lineTo(0.45, 0); s.lineTo(0.1, 0.28); s.lineTo(0.1, 0.12); s.lineTo(-0.4, 0.12);
    return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
  }), glowMat(0xffffff));
  arrow.position.y = 1.63;
  g.add(arrow);
  return { group: g, exit: new THREE.Vector3(1.25, 0.9, 0), height: 1.7 };
}

function sink(p) {
  const g = new THREE.Group();
  const red = mat(C.red, { roughness: 0.5 });
  g.add(box(1.6, 0.12, 1.6, red, 0, 0.06, 0));
  for (const [x, z, w, d] of [[0, 0.76, 1.6, 0.08], [0, -0.76, 1.6, 0.08], [0.76, 0, 0.08, 1.6], [-0.76, 0, 0.08, 1.6]]) {
    g.add(box(w, 0.9, d, red, x, 0.5, z));
  }
  g.add(box(1.7, 0.08, 0.1, mat(0x8f2329), 0, 0.98, 0.8));
  g.add(box(1.7, 0.08, 0.1, mat(0x8f2329), 0, 0.98, -0.8));
  return { group: g, entry: new THREE.Vector3(0, 0.35, 0), height: 1.1 };
}

function queue(p, item) {
  const cap = Math.max(1, p.capacity ?? 6);
  const [iw, , id] = item.size;
  const sx = iw + 0.35;
  const sz = id + 0.35;
  const cols = Math.max(1, Math.ceil(Math.sqrt(cap * (sz / sx))));
  const rows = Math.ceil(cap / cols);
  const w = cols * sx + 0.4;
  const d = rows * sz + 0.4;
  const g = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: 0xe9d98a, transparent: true, opacity: 0.35, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.012;
  floor.receiveShadow = true;
  g.add(floor);
  // Yellow/black hatched border
  const n = Math.round((2 * (w + d)) / 0.5);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 2 * (w + d);
    let x, z, along;
    if (t < w) { x = -w / 2 + t; z = -d / 2; along = 'x'; }
    else if (t < w + d) { x = w / 2; z = -d / 2 + (t - w); along = 'z'; }
    else if (t < 2 * w + d) { x = w / 2 - (t - w - d); z = d / 2; along = 'x'; }
    else { x = -w / 2; z = d / 2 - (t - 2 * w - d); along = 'z'; }
    const s = box(along === 'x' ? 0.5 : 0.1, 0.02, along === 'x' ? 0.1 : 0.5, mat(i % 2 ? 0x111111 : C.yellow), x, 0.02, z);
    s.castShadow = false;
    g.add(s);
  }
  // Low pallet stands per slot
  const slots = [];
  for (let i = 0; i < cap; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = -w / 2 + 0.2 + sx / 2 + c * sx;
    const z = -d / 2 + 0.2 + sz / 2 + r * sz;
    g.add(box(iw + 0.15, 0.12, id + 0.15, mat(C.wood, { roughness: 0.9 }), x, 0.06, z));
    slots.push(new THREE.Vector3(x, 0.12, z));
  }
  return { group: g, entry: new THREE.Vector3(-w / 2, 0.15, 0), exit: new THREE.Vector3(w / 2, 0.15, 0), slot: (i) => slots[i % slots.length], height: 0.4, size: [w, d] };
}

function processor(p, item) {
  const style = p.style ?? 'bench';
  const w = p.width ?? Math.max(2.0, item.size[0] + 0.8);
  const d = p.depth ?? Math.max(1.0, item.size[2] + 0.5);
  const g = new THREE.Group();
  const frame = mat(C.frame, { metalness: 0.4 });
  let work;
  let tower;
  let robot = null;
  if (style === 'machine') {
    // Enclosed machine with a window – test rigs, ovens, presses
    const shell = mat(0xdfe3e8, { roughness: 0.45 });
    g.add(box(w + 0.6, 0.15, d + 0.6, mat(C.dark), 0, 0.075, 0));
    g.add(box(w + 0.6, 2.0, 0.1, shell, 0, 1.15, -d / 2 - 0.25));
    g.add(box(0.1, 2.0, d + 0.6, shell, -w / 2 - 0.25, 1.15, 0));
    g.add(box(0.1, 2.0, d + 0.6, shell, w / 2 + 0.25, 1.15, 0));
    g.add(box(w + 0.6, 0.15, d + 0.6, shell, 0, 2.2, 0));
    const glass = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 1.2, 0.04), new THREE.MeshStandardMaterial({ color: 0x9fc4dd, transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0.3, depthWrite: false }));
    glass.position.set(0, 1.4, d / 2 + 0.28);
    g.add(glass);
    g.add(box(w + 0.6, 0.65, 0.1, shell, 0, 0.47, d / 2 + 0.25));
    g.add(box(0.5, 0.35, 0.06, mat(0x1d2733, { roughness: 0.2 }), w / 2 - 0.1, 1.6, d / 2 + 0.31)); // HMI
    g.add(box(w, 0.06, d, mat(C.top), 0, 0.82, 0));
    work = new THREE.Vector3(0, 0.85, 0);
    tower = lightTower(w / 2 + 0.1, 2.28, -d / 2 - 0.1);
  } else {
    // Workbench (default) or robot cell
    g.add(box(w, 0.06, d, mat(C.top), 0, 0.9, 0));
    for (const x of [-w / 2 + 0.06, w / 2 - 0.06]) for (const z of [-d / 2 + 0.06, d / 2 - 0.06]) g.add(box(0.06, 0.87, 0.06, frame, x, 0.435, z));
    g.add(box(w - 0.1, 0.04, d - 0.1, mat(C.steel), 0, 0.25, 0));
    g.add(box(w * 0.5, 0.08, d * 0.6, mat(C.blue), 0, 0.97, 0)); // fixture
    work = new THREE.Vector3(0, 1.01, 0);
    if (style === 'cell') {
      robot = createRobot(0xf2c200, 0.75);
      robot.root.position.set(0, 0, -d / 2 - 0.9);
      robot.baseYaw = 0;
      robot.phase = Math.random() * 10;
      g.add(robot.root);
      // Safety fence: back and sides, open at the front
      const post = mat(C.yellow);
      const mesh = new THREE.MeshStandardMaterial({ color: 0x8a9096, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
      const fw = w + 2.4;
      const fd = d + 3.2;
      const fz = -0.5;
      const sides = [[0, fz - fd / 2, fw, 0], [-fw / 2, fz, fd, Math.PI / 2], [fw / 2, fz, fd, Math.PI / 2]];
      for (const [x, z, len, rot] of sides) {
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.8), mesh);
        panel.position.set(x, 1.05, z);
        panel.rotation.y = rot;
        g.add(panel);
        for (let k = 0; k <= Math.round(len / 1.5); k++) {
          const t = -len / 2 + (k * len) / Math.round(len / 1.5);
          const px = rot ? x : x + t;
          const pz = rot ? z + t : z;
          g.add(box(0.06, 2.0, 0.06, post, px, 1.0, pz));
        }
      }
      tower = lightTower(fw / 2, 2.0, fz - fd / 2);
    } else {
      // Tool board, monitor and light tower on the back of the bench
      g.add(box(w, 0.9, 0.04, mat(0x8a95a3), 0, 1.38, -d / 2 + 0.02));
      g.add(box(0.03, 0.5, 0.03, frame, w / 2 - 0.35, 1.2, -d / 2 + 0.15));
      g.add(box(0.48, 0.3, 0.04, mat(0x1d2733, { roughness: 0.2 }), w / 2 - 0.35, 1.5, -d / 2 + 0.17));
      tower = lightTower(-w / 2 + 0.12, 0.93, -d / 2 + 0.12);
    }
  }
  g.add(tower.group);
  // Operators stand at the front of the station, facing it
  const ops = [];
  const n = p.operators ?? (style === 'cell' ? 0 : 1);
  for (let i = 0; i < n; i++) {
    const op = makeOperator([0xff7a1a, 0xf2e21a, 0x9be22e][i % 3]);
    const x = n === 1 ? 0 : -w / 2 + 0.4 + (i * (w - 0.8)) / Math.max(1, n - 1);
    op.position.set(x, 0, d / 2 + 0.5 + (style === 'machine' ? 0.4 : 0));
    op.rotation.y = Math.PI;
    g.add(op);
    ops.push(op);
  }
  let phase = Math.random() * 10;
  return {
    group: g, entry: work, exit: work, workPoint: work, height: style === 'machine' ? 2.6 : 2.0,
    setState: tower.set,
    animate(dt, state) {
      const busy = state === 'busy';
      for (const op of ops) op.userData.animate(dt, busy ? 'work' : 'idle');
      if (robot) {
        if (busy) phase += dt;
        const k = 1 - Math.exp(-8 * dt);
        const tg = busy ? { y: Math.sin(phase * 1.3) * 0.6, s: 0.55 + Math.sin(phase * 2.1) * 0.2, e: 0.9 + Math.sin(phase * 2.7) * 0.3 } : { y: 0, s: 0.1, e: 0.6 };
        robot.turret.rotation.y += (tg.y - robot.turret.rotation.y) * k;
        robot.shoulder.rotation.x += (tg.s - robot.shoulder.rotation.x) * k;
        robot.elbow.rotation.x += (tg.e - robot.elbow.rotation.x) * k;
      }
    },
  };
}

function conveyor(p) {
  const L = p.length ?? 6;
  const W = p.width ?? 0.8;
  const H = p.height ?? 0.8;
  const g = new THREE.Group();
  const frame = mat(0x8d949c, { metalness: 0.5, roughness: 0.4 });
  for (const z of [-W / 2 - 0.04, W / 2 + 0.04]) g.add(box(L, 0.16, 0.06, frame, 0, H - 0.04, z));
  const n = Math.max(1, Math.floor(L / 0.25));
  const rollers = new THREE.InstancedMesh(
    geo(`roller${W}`, () => new THREE.CylinderGeometry(0.045, 0.045, W, 10).rotateX(Math.PI / 2)),
    mat(0xc8ced4, { metalness: 0.8, roughness: 0.3 }), n,
  );
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < n; i++) rollers.setMatrixAt(i, m4.makeTranslation(-L / 2 + 0.125 + i * 0.25, H - 0.05, 0));
  rollers.receiveShadow = true;
  g.add(rollers);
  const legs = Math.max(2, Math.ceil(L / 2) + 1);
  for (let i = 0; i < legs; i++) {
    const x = -L / 2 + 0.1 + (i * (L - 0.2)) / (legs - 1);
    for (const z of [-W / 2, W / 2]) g.add(box(0.06, H - 0.1, 0.06, mat(C.frame), x, (H - 0.1) / 2, z));
    g.add(box(0.05, 0.05, W, mat(C.frame), x, 0.25, 0));
  }
  g.add(box(0.3, 0.25, 0.25, mat(C.blue), L / 2 - 0.3, H - 0.3, W / 2 + 0.2)); // drive motor
  return {
    group: g, length: L, height: 0.9,
    entry: new THREE.Vector3(-L / 2 + 0.3, H, 0),
    exit: new THREE.Vector3(L / 2 - 0.3, H, 0),
    along: (s) => new THREE.Vector3(-L / 2 + 0.3 + s, H, 0),
    travel: L - 0.6,
  };
}

// ---------------------------------------------------------------- equipment & decor
function rack(p) {
  const bays = p.bays ?? 3;
  const levels = p.levels ?? 4;
  const bw = p.bayWidth ?? 2.4;
  const dep = p.depth ?? 1.1;
  const lh = p.levelHeight ?? 1.3;
  const g = new THREE.Group();
  const up = mat(C.blue, { metalness: 0.4 });
  const beam = mat(C.orange, { metalness: 0.3 });
  const W = bays * bw;
  const H = levels * lh + 0.3;
  for (let b = 0; b <= bays; b++) for (const z of [-dep / 2, dep / 2]) g.add(box(0.08, H, 0.08, up, -W / 2 + b * bw, H / 2, z));
  let seed = (p.seed ?? 3) * 97;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let l = 0; l < levels; l++) {
    const y = 0.15 + l * lh;
    for (const z of [-dep / 2, dep / 2]) g.add(box(W, 0.1, 0.06, beam, 0, y, z));
    for (let b = 0; b < bays; b++) {
      for (let k = 0; k < 2; k++) {
        if (rnd() > (p.fill ?? 0.75)) continue;
        const x = -W / 2 + b * bw + bw * (0.27 + k * 0.46);
        g.add(box(bw * 0.4, 0.12, dep * 0.9, mat(C.wood, { roughness: 0.9 }), x, y + 0.11, 0));
        const h = 0.5 + rnd() * 0.45;
        g.add(box(bw * 0.38, h, dep * 0.8, mat(C.carton, { roughness: 0.9 }), x, y + 0.17 + h / 2, 0));
      }
    }
  }
  return { group: g, height: H };
}

function cart(p) {
  const g = new THREE.Group();
  const frame = mat(0x9aa1a9, { metalness: 0.6 });
  const w = p.width ?? 1.2;
  const d = p.depth ?? 0.7;
  for (const y of [0.3, 0.85]) g.add(box(w, 0.04, d, mat(C.top), 0, y, 0));
  for (const x of [-w / 2 + 0.03, w / 2 - 0.03]) for (const z of [-d / 2 + 0.03, d / 2 - 0.03]) {
    g.add(box(0.04, 0.85, 0.04, frame, x, 0.47, z));
    const wheel = cyl(0.07, 0.05, mat(0x1d1f22), x, 0.07, z, 12);
    wheel.rotation.x = Math.PI / 2;
    g.add(wheel);
  }
  g.add(box(0.04, 0.5, d, frame, -w / 2 - 0.02, 1.1, 0)); // handle
  g.add(box(0.5, 0.3, 0.4, mat(C.carton), 0.2, 1.02, 0));
  g.add(box(0.4, 0.22, 0.35, mat(C.blue), -0.2, 0.43, 0));
  return { group: g, height: 1.4 };
}

function agv(p) {
  const g = new THREE.Group();
  g.add(box(1.6, 0.35, 1.0, mat(C.dark, { metalness: 0.3 }), 0, 0.25, 0));
  g.add(box(1.62, 0.07, 1.02, mat(C.yellow), 0, 0.3, 0));
  g.add(cyl(0.09, 0.12, mat(0x111111), 0.65, 0.48, 0));
  g.add(box(0.03, 0.06, 0.5, glowMat(0x2ee6d2), 0.81, 0.25, 0));
  const load = box(1.2, 0.6, 0.8, mat(C.carton), 0, 0.73, 0);
  g.add(load);
  return { group: g, height: 1.2, mover: true, load };
}

function forklift(p) {
  const g = createForklift();
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const wrap = new THREE.Group();
  wrap.add(g);
  return { group: wrap, height: 2.6, mover: true };
}

function robot(p) {
  const r = createRobot(0xf2c200, p.scale ?? 0.9);
  const g = new THREE.Group();
  g.add(r.root);
  let t = Math.random() * 10;
  return {
    group: g, height: 3,
    animate(dt) {
      t += dt;
      r.turret.rotation.y = Math.sin(t * 0.8) * 0.8;
      r.shoulder.rotation.x = 0.4 + Math.sin(t * 1.1) * 0.25;
      r.elbow.rotation.x = 0.9 + Math.sin(t * 1.4) * 0.3;
    },
  };
}

function operator(p) {
  const op = makeOperator(p.color ? new THREE.Color(p.color).getHex() : 0xff7a1a);
  const g = new THREE.Group();
  g.add(op);
  return { group: g, height: 1.9, mover: !!p.path, animate: (dt, _s, moving) => op.userData.animate(dt, moving ? 'walk' : p.task ?? 'idle') };
}

function table(p) {
  const w = p.width ?? 1.8;
  const d = p.depth ?? 0.8;
  const g = new THREE.Group();
  g.add(box(w, 0.05, d, mat(C.top), 0, 0.9, 0));
  for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) for (const z of [-d / 2 + 0.05, d / 2 - 0.05]) g.add(box(0.05, 0.88, 0.05, mat(C.frame), x, 0.44, z));
  g.add(box(0.4, 0.25, 0.3, mat(C.blue), -0.4, 1.05, 0));
  g.add(box(0.3, 0.15, 0.25, mat(C.carton), 0.4, 1.0, 0.1));
  return { group: g, height: 1.2 };
}

function fence(p) {
  const L = p.length ?? 6;
  const g = new THREE.Group();
  const n = Math.max(1, Math.round(L / 1.5));
  for (let i = 0; i <= n; i++) g.add(box(0.06, 2.0, 0.06, mat(C.yellow), -L / 2 + (i * L) / n, 1.0, 0));
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(L, 1.8), new THREE.MeshStandardMaterial({ color: 0x8a9096, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
  panel.position.y = 1.05;
  g.add(panel);
  return { group: g, height: 2.1 };
}

function pallet(p) {
  const g = new THREE.Group();
  g.add(box(1.2, 0.14, 1.0, mat(C.wood, { roughness: 0.9 }), 0, 0.07, 0));
  const layers = p.layers ?? 2;
  for (let l = 0; l < layers; l++) for (const x of [-0.3, 0.3]) for (const z of [-0.25, 0.25]) g.add(box(0.56, 0.4, 0.46, mat(C.carton, { roughness: 0.9 }), x, 0.35 + l * 0.42, z));
  return { group: g, height: 0.3 + layers * 0.42 };
}

function tank(p) {
  const r = p.radius ?? 0.9;
  const h = p.height ?? 2.6;
  const g = new THREE.Group();
  g.add(cyl(r, h, mat(p.color ? new THREE.Color(p.color).getHex() : 0x2a6fd8, { metalness: 0.5, roughness: 0.35 }), 0, h / 2 + 0.3, 0, 28));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    g.add(box(0.1, 0.3, 0.1, mat(C.frame), Math.cos(a) * r * 0.8, 0.15, Math.sin(a) * r * 0.8));
  }
  return { group: g, height: h + 0.4 };
}

function zone(p) {
  const w = p.w ?? 10;
  const d = p.d ?? 6;
  const g = new THREE.Group();
  const color = new THREE.Color(p.color ?? '#3b82f6');
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, depthWrite: false }));
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.006;
  g.add(fill);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2)), new THREE.LineBasicMaterial({ color }));
  edge.position.y = 0.012;
  g.add(edge);
  // Title painted on the floor in one corner
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#' + color.getHexString();
  ctx.font = '600 56px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText((p.label ?? 'Zone').toUpperCase(), 8, 50, 496);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const lw = Math.min(w * 0.6, 7);
  const label = new THREE.Mesh(new THREE.PlaneGeometry(lw, lw * (96 / 512)), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  label.rotation.x = -Math.PI / 2;
  label.position.set(-w / 2 + lw / 2 + 0.3, 0.015, -d / 2 + lw * 0.1 + 0.3);
  g.add(label);
  return { group: g, height: 0, flat: true };
}

// Registry: flow objects move items; the rest are equipment/decor
export const LIBRARY = {
  source: { name: 'Source', flow: true, build: source, icon: '▶' },
  queue: { name: 'Queue', flow: true, build: queue, icon: '▦' },
  processor: { name: 'Station', flow: true, build: processor, icon: '⚙' },
  conveyor: { name: 'Conveyor', flow: true, build: conveyor, icon: '═' },
  sink: { name: 'Sink', flow: true, build: sink, icon: '■' },
  operator: { name: 'Operator', build: operator, icon: '☺' },
  robot: { name: 'Robot', build: robot, icon: '⌇' },
  rack: { name: 'Rack', build: rack, icon: '▤' },
  cart: { name: 'Cart', build: cart, icon: '⊓' },
  agv: { name: 'AGV', build: agv, icon: '▭' },
  forklift: { name: 'Forklift', build: forklift, icon: '⊐' },
  table: { name: 'Table', build: table, icon: '⊤' },
  pallet: { name: 'Pallet', build: pallet, icon: '▣' },
  tank: { name: 'Tank', build: tank, icon: '◯' },
  fence: { name: 'Fence', build: fence, icon: '┆' },
  zone: { name: 'Zone', build: zone, icon: '⬚' },
};

// Editable properties per type: [key, label, kind, extra]
export const PROPS = {
  source: [['label', 'Name', 'text'], ['interarrival', 'Arrival every (s)', 'number'], ['itemColor', 'Item colour', 'color']],
  queue: [['label', 'Name', 'text'], ['capacity', 'Capacity', 'number']],
  processor: [['label', 'Name', 'text'], ['time', 'Cycle time (s)', 'number'], ['style', 'Style', 'select', ['bench', 'machine', 'cell']], ['operators', 'Operators', 'number'], ['failRate', 'Faults per hour', 'number']],
  conveyor: [['label', 'Name', 'text'], ['length', 'Length (m)', 'number'], ['speed', 'Speed (m/s)', 'number']],
  sink: [['label', 'Name', 'text']],
  rack: [['label', 'Name', 'text'], ['bays', 'Bays', 'number'], ['levels', 'Levels', 'number']],
  fence: [['length', 'Length (m)', 'number']],
  zone: [['label', 'Name', 'text'], ['w', 'Width (m)', 'number'], ['d', 'Depth (m)', 'number'], ['color', 'Colour', 'color']],
  operator: [['label', 'Name', 'text'], ['task', 'Pose', 'select', ['idle', 'work']]],
  tank: [['label', 'Name', 'text'], ['color', 'Colour', 'color']],
  pallet: [['layers', 'Layers', 'number']],
};
