// Procedural models for the motor plant: the product at every stage, the machines that make it,
// people, vehicles, racks and pallets. Everything is primitive geometry plus canvas textures.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat, glow, box, cyl, sphere, createRobot } from '../models.js';

export { mat, glow, box, cyl, sphere };

export const C = {
  abb: 0xff000f, // brand red
  steel: 0x8d949c,
  bright: 0xc9ced4,
  dark: 0x24272c,
  darker: 0x16181b,
  machine: 0xe6e8ea, // machine-tool white
  machineBlue: 0x2a5d9f,
  machineGrey: 0x5f6873,
  yellow: 0xf2c230,
  copper: 0xc8763a,
  resin: 0xb5661c,
  castIron: 0x55595e,
  primer: 0x8a9096,
  paintA: 0x24486f, // NEMA Super-E blue-grey
  paintB: 0x3b4148, // IEC dark grey
  cardboard: 0xb98d5c,
  wood: 0xa57a4c,
  green: 0x22c55e,
  amber: 0xf59e0b,
  red: 0xef4444,
  rack: 0x1f8a4c, // storage = green (plan legend)
  rackBeam: 0xf07a1a,
};

const geoCache = new Map();
const cached = (key, make) => {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
};
const mesh = (geo, material, shadows = true) => {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = shadows;
  m.receiveShadow = shadows;
  return m;
};
const at = (obj, x, y, z) => {
  obj.position.set(x, y, z);
  return obj;
};
const add = (parent, obj, x = 0, y = 0, z = 0) => {
  obj.position.set(x, y, z);
  parent.add(obj);
  return obj;
};

// Bake every mesh under `root` into one mesh with per-vertex colours (one draw call).
const vcMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.12 });
const _inv = new THREE.Matrix4();
const _rel = new THREE.Matrix4();
export function mergeColored(root, material = vcMat) {
  root.updateMatrixWorld(true);
  _inv.copy(root.matrixWorld).invert();
  const geos = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal') g.deleteAttribute(n);
    g.applyMatrix4(_rel.multiplyMatrices(_inv, o.matrixWorld));
    const c = (Array.isArray(o.material) ? o.material[0] : o.material).color ?? new THREE.Color(1, 1, 1);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(g);
  });
  const m = new THREE.Mesh(mergeGeometries(geos), material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
const tmpGroup = (...meshes) => {
  const g = new THREE.Group();
  meshes.forEach((m) => g.add(m));
  return g;
};
const mergedGeo = (key, ...parts) => cached(key, () => mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g))));

// Cylinder lying along x
function xcyl(r, len, material, seg = 20, shadows = true) {
  const m = mesh(cached(`xc${r}|${len}|${seg}`, () => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2)), material, shadows);
  return m;
}
// Hollow cylinder (tube) lying along x
function xtube(rOut, rIn, len, material, seg = 28) {
  return mesh(cached(`xt${rOut}|${rIn}|${len}|${seg}`, () => {
    const h = len / 2;
    const pts = [[rIn, -h], [rOut, -h], [rOut, h], [rIn, h], [rIn, -h]].map(([r, y]) => new THREE.Vector2(r, y));
    return new THREE.LatheGeometry(pts, seg).rotateZ(Math.PI / 2);
  }), material);
}
function xtorus(r, tube, material) {
  return mesh(cached(`xr${r}|${tube}`, () => new THREE.TorusGeometry(r, tube, 10, 28).rotateY(Math.PI / 2)), material);
}

// ---------------------------------------------------------------------------------------------
// Canvas textures
// ---------------------------------------------------------------------------------------------
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function abbMark(g, x, y, size) {
  g.save();
  g.fillStyle = '#ff000f';
  g.font = `900 ${size}px Inter, Arial, sans-serif`;
  g.textBaseline = 'middle';
  g.fillText('ABB', x, y);
  g.restore();
}

let _nameplate;
export function nameplateTexture() {
  _nameplate ??= canvasTex(256, 128, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#e9ecef');
    grad.addColorStop(1, '#b9bfc6');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    abbMark(g, 12, 24, 30);
    g.fillStyle = '#222';
    g.font = '600 15px Inter, Arial';
    g.fillText('BALDOR • RELIANCE', 84, 26);
    g.font = '500 12px Inter, Arial';
    const rows = ['HP 15   RPM 1770   V 460', 'FR 254T   SF 1.15   NEMA PREMIUM', 'EFF 92.4%   INS F   AMB 40°C'];
    rows.forEach((r, i) => g.fillText(r, 12, 60 + i * 20));
    g.strokeStyle = '#555';
    g.strokeRect(2, 2, w - 4, h - 4);
  });
  return _nameplate;
}

let _cartonMat;
export function cartonMaterial() {
  _cartonMat ??= new THREE.MeshStandardMaterial({ map: boxTexture(), roughness: 0.95 });
  return _cartonMat;
}
let _boxTex;
export function boxTexture() {
  _boxTex ??= canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#b98d5c';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1800; i++) {
      g.fillStyle = `rgba(80,50,20,${Math.random() * 0.06})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.fillStyle = '#fff';
    g.fillRect(18, 18, 132, 58);
    abbMark(g, 28, 48, 44);
    g.fillStyle = '#2b1d10';
    g.font = '700 18px Inter, Arial';
    g.fillText('Baldor-Reliance', 20, 110);
    g.font = '500 14px Inter, Arial';
    g.fillText('Super-E® Premium Efficiency', 20, 132);
    g.fillStyle = '#fff';
    g.fillRect(20, 170, 120, 60);
    g.fillStyle = '#000';
    for (let x = 26; x < 134; x += 3) if (Math.random() > 0.35) g.fillRect(x, 176, Math.random() > 0.5 ? 2 : 1, 40);
    g.fillStyle = '#e8e2d6';
    g.fillRect(0, h / 2 - 6, w, 12); // tape
  });
  return _boxTex;
}

export function signTexture(num, title, sub) {
  return canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = '#14171b';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ff000f';
    g.fillRect(0, 0, 210, h);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 130px Inter, Arial';
    g.fillText(String(num).padStart(2, '0'), 105, 136);
    g.textAlign = 'left';
    g.font = '600 74px Inter, Arial';
    g.fillText(title, 245, 98, 760);
    g.fillStyle = '#9aa3ad';
    g.font = '500 42px Inter, Arial';
    g.fillText(sub, 245, 186, 760);
  });
}

// Yellow plan-style zone label, as on the layout drawing
export function zoneLabelTexture(title, sub) {
  const lines = title.split('\n');
  return canvasTex(1024, sub ? 512 : 360, (g, w, h) => {
    g.fillStyle = '#ffe11a';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1b1b1b';
    g.lineWidth = 10;
    g.strokeRect(5, 5, w - 10, h - 10);
    g.fillStyle = '#141414';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '800 92px Inter, Arial';
    const top = sub ? 120 : h / 2 - (lines.length - 1) * 52;
    lines.forEach((l, i) => g.fillText(l, w / 2, top + i * 104, w - 60));
    if (sub) {
      g.fillRect(40, 300, w - 80, 6);
      g.font = '800 120px Inter, Arial';
      g.fillText(sub, w / 2, 410);
    }
  });
}

export function roomLabelTexture(text, color = '#e9ecef', bg = 'rgba(20,23,27,0.88)') {
  return canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(4, 4, w - 8, h - 8, 26);
    g.fill();
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '700 54px Inter, Arial';
    g.fillText(text, w / 2, h / 2 + 2, w - 40);
  });
}

let _hmi;
function hmiTexture() {
  _hmi ??= canvasTex(256, 160, (g, w, h) => {
    g.fillStyle = '#0d2236';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ff000f';
    g.fillRect(0, 0, w, 18);
    g.fillStyle = '#fff';
    g.font = '700 12px Inter, Arial';
    g.fillText('ABB Ability™  OPERATOR', 8, 13);
    g.strokeStyle = '#2ee6d2';
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x < w; x += 4) g.lineTo(x, 70 + Math.sin(x / 11) * 18 + Math.random() * 6);
    g.stroke();
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i === 2 ? '#f59e0b' : '#22c55e';
      g.fillRect(10 + i * 60, 110, 50, 34);
    }
  });
  return _hmi;
}

let _grating;
function meshGuardMaterial() {
  if (_grating) return _grating;
  const t = canvasTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#202326';
    g.lineWidth = 3;
    for (let i = 0; i <= w; i += 16) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, h);
      g.moveTo(0, i);
      g.lineTo(w, i);
      g.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  _grating = new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.6 });
  return _grating;
}

export const glassMat = new THREE.MeshStandardMaterial({
  color: 0xbfd6e6, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide,
});

// ---------------------------------------------------------------------------------------------
// The product: a TEFC induction motor (shaft along +x, feet on y = 0)
// ---------------------------------------------------------------------------------------------
export const MOTOR = {
  A: { L: 0.62, R: 0.22, paint: C.paintA, family: 'NEMA Super-E 254T', perPallet: 8 },
  B: { L: 0.95, R: 0.33, paint: C.paintB, family: 'IEC M3BP 315', perPallet: 4 },
};

function frameGeometry(L, R, withFeet = true) {
  return cached(`frame${L}|${R}|${withFeet}`, () => {
    const axis = R * 1.12;
    const parts = [];
    const body = new THREE.CylinderGeometry(R * 0.84, R * 0.84, L, 28).rotateZ(Math.PI / 2);
    body.translate(0, axis, 0);
    parts.push(body);
    const finH = R * 0.18;
    const n = 30;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      // no fins underneath, where the feet are
      if (Math.abs(Math.sin(a) + 1) < 0.25 && Math.cos(a) * Math.cos(a) < 0.3) continue;
      const fin = new THREE.BoxGeometry(L * 0.96, finH, 0.012);
      fin.translate(0, R * 0.84 + finH / 2 - 0.01, 0);
      fin.rotateX(a);
      fin.translate(0, axis, 0);
      parts.push(fin);
    }
    if (withFeet) {
      const footH = axis - R * 0.62;
      for (const x of [-L * 0.32, L * 0.32]) {
        const foot = new THREE.BoxGeometry(L * 0.2, footH, R * 1.9);
        foot.translate(x, footH / 2, 0);
        parts.push(foot);
      }
    }
    // end flanges
    for (const x of [-L / 2 + 0.02, L / 2 - 0.02]) {
      const ring = new THREE.CylinderGeometry(R * 1.0, R * 1.0, 0.04, 28).rotateZ(Math.PI / 2);
      ring.translate(x, axis, 0);
      parts.push(ring);
    }
    return mergeGeometries(parts.map((g) => g.toNonIndexed()));
  });
}

function fanGeometry(R) {
  return cached(`fan${R}`, () => {
    const parts = [new THREE.CylinderGeometry(R * 0.2, R * 0.2, 0.06, 12).rotateZ(Math.PI / 2)];
    for (let i = 0; i < 8; i++) {
      const b = new THREE.BoxGeometry(0.03, R * 0.65, R * 0.22);
      b.translate(0, R * 0.42, 0);
      b.rotateX((i / 8) * Math.PI * 2);
      parts.push(b);
    }
    return mergeGeometries(parts.map((g) => g.toNonIndexed()));
  });
}

let _grilleTex;
function grilleTexture() {
  _grilleTex ??= canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#1a1c1f';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#555b62';
    g.lineWidth = 5;
    for (let r = 10; r < 64; r += 11) {
      g.beginPath();
      g.arc(64, 64, r, 0, Math.PI * 2);
      g.stroke();
    }
  });
  return _grilleTex;
}

const primerMat = mat(C.primer, { roughness: 0.75, metalness: 0.25 });
const castMat = mat(C.castIron, { roughness: 0.85, metalness: 0.3 });
const steelMat = mat(0xb9c0c8, { roughness: 0.25, metalness: 0.9 });
const brightMat = mat(0xdfe3e7, { roughness: 0.12, metalness: 1.0 });
const copperMat = mat(C.copper, { roughness: 0.35, metalness: 0.8 });
const resinMat = mat(C.resin, { roughness: 0.18, metalness: 0.4 });
const curedMat = mat(0x7a3e10, { roughness: 0.25, metalness: 0.3 });
const lamMat = mat(0x4a5058, { roughness: 0.45, metalness: 0.7 });
const aluMat = mat(0xc4c9cf, { roughness: 0.35, metalness: 0.85 });
const cordMat = mat(0xf2efe6, { roughness: 0.9 });

export function createMotor(kind = 'A') {
  const spec = MOTOR[kind];
  const { L, R } = spec;
  const axis = R * 1.12;
  const group = new THREE.Group();
  const paint = mat(spec.paint, { roughness: 0.38, metalness: 0.35 });
  const frame = mesh(frameGeometry(L, R), primerMat);
  group.add(frame);
  const painted = [frame];

  const torusX = (r, t) => new THREE.TorusGeometry(r, t, 10, 28).rotateY(Math.PI / 2);
  const windings = mesh(mergedGeo(`wind${L}|${R}`, torusX(R * 0.55, R * 0.14).translate(-(L / 2 + 0.01), 0, 0), torusX(R * 0.55, R * 0.14).translate(L / 2 + 0.01, 0, 0)), copperMat);
  windings.position.y = axis;
  group.add(windings);

  const sLen = L + R * 1.2;
  const shaft = mesh(mergedGeo(`shaft${L}|${R}`,
    new THREE.CylinderGeometry(R * 0.15, R * 0.15, sLen, 14).rotateZ(Math.PI / 2).translate(sLen / 2 - L / 2 - 0.05, 0, 0),
    new THREE.BoxGeometry(R * 0.5, R * 0.06, R * 0.08).translate(L / 2 + R * 0.65, R * 0.15, 0)), steelMat);
  shaft.position.y = axis;
  group.add(shaft);

  const boltGeo = (n) => cached(`bolts${R}|${n}`, () => mergeGeometries([0, 1, 2, 3].slice(0, n).map((i) => {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    return new THREE.CylinderGeometry(0.018, 0.018, 0.07, 6).rotateZ(Math.PI / 2).translate(0, Math.sin(a) * R * 0.82, Math.cos(a) * R * 0.82).toNonIndexed();
  })));
  const brackets = [];
  for (const s of [-1, 1]) {
    const b = new THREE.Group();
    const shell = mesh(mergedGeo(`brk${R}|${s}`,
      new THREE.CylinderGeometry(R * 0.98, R * 0.98, 0.05, 28).rotateZ(Math.PI / 2),
      new THREE.CylinderGeometry(R * 0.36, R * 0.36, 0.09, 18).rotateZ(Math.PI / 2).translate(s * 0.04, 0, 0)), primerMat);
    b.add(shell);
    const bolts = mesh(boltGeo(4), steelMat, false);
    bolts.position.x = s * 0.02;
    b.add(bolts);
    b.position.set(s * (L / 2 + 0.025), axis, 0);
    group.add(b);
    painted.push(shell);
    brackets.push(b);
  }
  const missingBolts = () => { brackets[1].children[1].geometry = boltGeo(2); };

  const fan = mesh(fanGeometry(R), mat(0x2a2d31));
  fan.position.set(-L / 2 - 0.12, axis, 0);
  group.add(fan);

  const cover = new THREE.Group();
  const coverLen = R * 0.6;
  const shell = mesh(cached(`cov${R}`, () => new THREE.CylinderGeometry(R * 0.95, R * 0.92, coverLen, 28, 1, true).rotateZ(Math.PI / 2)), primerMat);
  shell.material = primerMat;
  cover.add(shell);
  const grille = mesh(cached(`gr${R}`, () => new THREE.CircleGeometry(R * 0.92, 28).rotateY(-Math.PI / 2)), new THREE.MeshStandardMaterial({ map: grilleTexture(), roughness: 0.7 }));
  grille.position.x = -coverLen / 2;
  cover.add(grille);
  cover.position.set(-L / 2 - 0.05 - coverLen / 2, axis, 0);
  group.add(cover);
  painted.push(shell);

  const cbox = new THREE.Group();
  add(cbox, box(R * 0.75, R * 0.5, R * 0.8, primerMat), 0, 0, 0);
  add(cbox, box(R * 0.82, R * 0.06, R * 0.86, primerMat), 0, R * 0.27, 0);
  add(cbox, xcyl(R * 0.1, R * 0.2, mat(0x1d1f22), 10), 0, -R * 0.05, 0).rotation.y = Math.PI / 2;
  cbox.children[2].position.z = R * 0.48;
  cbox.position.set(L * 0.12, axis + R * 0.86 + R * 0.24, 0);
  group.add(cbox);
  painted.push(cbox.children[0], cbox.children[1]);

  const eye = mesh(cached(`eye${R}`, () => new THREE.TorusGeometry(R * 0.13, R * 0.035, 8, 16)), steelMat);
  eye.position.set(-L * 0.1, axis + R * 1.04 + R * 0.12, 0);
  group.add(eye);

  const plate = mesh(cached(`np${L}`, () => new THREE.PlaneGeometry(L * 0.3, R * 0.32)), new THREE.MeshStandardMaterial({ map: nameplateTexture(), roughness: 0.35, metalness: 0.4 }), false);
  plate.position.set(-L * 0.05, axis + R * 0.1, R * 1.03);
  group.add(plate);

  // Shipping carton (hides the motor once packed)
  const cartonSize = [L + R * 1.0, axis + R * 1.5, R * 2.35];
  const carton = mesh(cached(`ct${kind}`, () => new THREE.BoxGeometry(...cartonSize)), cartonMaterial());
  carton.position.set(-R * 0.25, cartonSize[1] / 2, 0);
  group.add(carton);

  const parts = { frame, windings, shaft, brackets, fan, cover, cbox, eye, plate, carton };
  const api = {
    group, parts, kind, spec, axis, carton, cartonSize, missingBolts,
    stage: -1,
    // 0 frame+stator, 1 rotor, 2 brackets, 3 fan+cover, 4 conduit box, 5 painted, 6 nameplate, 7 boxed
    setStage(k) {
      api.stage = k;
      windings.visible = k >= 0 && k < 2;
      shaft.visible = k >= 1;
      brackets.forEach((b) => { b.visible = k >= 2; });
      fan.visible = k >= 3 && k < 3.5;
      cover.visible = k >= 3.5;
      cbox.visible = k >= 4;
      eye.visible = k >= 4;
      for (const m of painted) m.material = k >= 5 ? paint : primerMat;
      plate.visible = k >= 6;
      carton.visible = k >= 7;
      frame.visible = k < 7;
      [windings, shaft, fan, cover, cbox, eye, plate].forEach((o) => { if (k >= 7) o.visible = false; });
      brackets.forEach((b) => { if (k >= 7) b.visible = false; });
    },
    spin: 0,
  };
  api.setStage(0);
  return api;
}

// A packed carton on its own (for pallets in racks / staging)
export function createCarton(kind) {
  const p = cartonProto(kind);
  const g = new THREE.Group();
  const c = mesh(p.carton.geometry, cartonMaterial());
  c.position.copy(p.carton.position);
  g.add(c);
  return g;
}

// ---------------------------------------------------------------------------------------------
// Sub-assemblies that flow through the feeder lines
// ---------------------------------------------------------------------------------------------
const fixtureGeo = new Map();
function fixture(w = 0.9, d = 0.7) {
  const key = `${w}|${d}`;
  if (!fixtureGeo.has(key)) {
    const t = tmpGroup(at(box(w, 0.06, d, mat(0x3c4249)), 0, 0.03, 0));
    for (const x of [-w / 2 + 0.08, w / 2 - 0.08]) t.add(at(box(0.06, 0.12, d * 0.6, mat(C.yellow)), x, 0.1, 0));
    fixtureGeo.set(key, mergeColored(t).geometry);
  }
  const g = new THREE.Group();
  g.add(mesh(fixtureGeo.get(key), vcMat));
  return g;
}

// Stamped lamination set (stator ring + rotor stack)
export function createLaminations() {
  const g = fixture();
  const sheet = add(g, box(0.62, 0.012, 0.55, mat(0xaeb5bd, { metalness: 0.85, roughness: 0.3 })), 0, 0.07, 0);
  const stack = new THREE.Group();
  add(stack, xtube(0.24, 0.13, 0.3, lamMat), 0, 0, 0);
  add(stack, xcyl(0.12, 0.3, lamMat, 20), 0, 0, 0).position.z = 0;
  stack.children[1].position.set(0, 0, 0.42);
  stack.position.set(-0.1, 0.31, -0.1);
  stack.rotation.y = Math.PI / 2;
  g.add(stack);
  const welds = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    add(welds, box(0.31, 0.012, 0.012, glow(0xffe7b0), false), 0, Math.sin(a) * 0.243, Math.cos(a) * 0.243);
  }
  stack.add(welds);
  return {
    group: g,
    set(stage, p) {
      sheet.visible = stage <= 0;
      stack.visible = stage >= 1;
      stack.scale.x = stage === 1 ? Math.max(0.05, p) : 1;
      welds.visible = stage >= 2 && (stage > 2 || p > 0.4);
    },
  };
}

export function createShaft() {
  const g = fixture(1.1, 0.5);
  const bar = add(g, xcyl(0.05, 0.95, castMat, 14), 0, 0.2, 0);
  const turned = new THREE.Group();
  add(turned, xcyl(0.045, 0.5, steelMat, 14), 0.05, 0, 0);
  add(turned, xcyl(0.06, 0.2, steelMat, 14), -0.25, 0, 0);
  add(turned, xcyl(0.035, 0.25, steelMat, 14), 0.42, 0, 0);
  turned.position.y = 0.2;
  g.add(turned);
  const key = add(g, box(0.14, 0.012, 0.022, mat(0x333333)), 0.42, 0.235, 0);
  return {
    group: g,
    set(stage, p) {
      bar.visible = stage <= 0 || (stage === 1 && p < 0.5);
      turned.visible = !bar.visible;
      key.visible = stage >= 2 && (stage > 2 || p > 0.5);
      for (const c of turned.children) c.material = stage >= 3 && (stage > 3 || p > 0.6) ? brightMat : steelMat;
    },
  };
}

export function createRotor() {
  const g = fixture(1.1, 0.6);
  const core = add(g, xcyl(0.13, 0.32, lamMat, 22), 0, 0.26, 0);
  const rings = new THREE.Group();
  for (const s of [-1, 1]) add(rings, xtube(0.135, 0.06, 0.05, aluMat, 22), s * 0.18, 0, 0);
  rings.position.y = 0.26;
  g.add(rings);
  const shaft = add(g, xcyl(0.045, 0.95, steelMat, 14), 0.08, 0.26, 0);
  const marks = add(g, box(0.02, 0.03, 0.03, mat(0xff3b30)), 0.2, 0.39, 0);
  return {
    group: g,
    spinner: [core, rings, shaft],
    set(stage, p) {
      rings.visible = stage >= 1 || (stage === 0 && p > 0.6);
      shaft.visible = stage >= 2 || (stage === 1 && p > 0.5);
      if (stage >= 1) shaft.position.x = stage === 1 ? 0.08 + (1 - Math.min(1, (p - 0.5) * 2)) * 0.6 : 0.08;
      core.material = stage >= 3 || (stage === 2 && p > 0.5) ? mat(0x8f969e, { metalness: 0.9, roughness: 0.25 }) : lamMat;
      marks.visible = stage >= 3 && p > 0.6;
    },
  };
}

export function createFrameCasting() {
  const g = fixture(1.0, 0.7);
  const L = MOTOR.A.L;
  const R = MOTOR.A.R;
  const body = mesh(frameGeometry(L, R), castMat);
  body.position.y = 0.06;
  g.add(body);
  const bore = add(g, xtube(R * 0.84, R * 0.7, L + 0.005, brightMat), 0, 0.06 + R * 1.12, 0);
  return {
    group: g,
    set(stage, p) {
      bore.visible = stage >= 2 || (stage === 1 && p > 0.4);
      body.material = stage >= 3 && p > 0.5 ? mat(0x6c7178, { roughness: 0.4, metalness: 0.5 }) : castMat;
    },
  };
}

export function createBracketSet() {
  const g = fixture(0.9, 0.6);
  const parts = [];
  for (const s of [-1, 1]) {
    const b = add(g, xcyl(0.2, 0.05, castMat, 24), s * 0.18, 0.26, 0);
    b.rotation.z = Math.PI / 2;
    b.position.y = 0.09;
    parts.push(b);
    const hub = add(g, xcyl(0.08, 0.06, castMat, 16), s * 0.18, 0.13, 0);
    hub.rotation.z = Math.PI / 2;
    parts.push(hub);
  }
  return {
    group: g,
    set(stage, p) {
      const m = stage >= 1 && p > 0.4 ? steelMat : castMat;
      parts.forEach((x, i) => { if (i % 2 === 1 || stage >= 2) x.material = m; });
    },
  };
}

export function createStator() {
  const g = fixture(1.0, 0.75);
  const core = add(g, xtube(0.24, 0.14, 0.34, lamMat), 0, 0.32, 0);
  const coils = new THREE.Group();
  const coilArr = [];
  for (const s of [-1, 1]) {
    const t = xtorus(0.18, 0.045, copperMat);
    add(coils, t, s * 0.2, 0, 0);
    coilArr.push(t);
  }
  coils.position.y = 0.32;
  g.add(coils);
  const cords = new THREE.Group();
  for (const s of [-1, 1]) add(cords, xtorus(0.18, 0.05, cordMat), s * 0.205, 0, 0);
  cords.position.y = 0.32;
  cords.scale.set(1, 1.02, 1.02);
  g.add(cords);
  const leads = add(g, box(0.02, 0.25, 0.02, mat(0x111111)), 0.24, 0.55, 0.05);
  return {
    group: g,
    set(stage, p) {
      // 0 wind, 1 insert, 2 lace, 3 surge, 4 VPI, 5 cure, 6 inspect
      coils.visible = stage >= 1 || p > 0.6;
      coils.scale.setScalar(stage === 0 ? 0.6 : stage === 1 ? 0.6 + p * 0.4 : 1);
      cords.visible = stage >= 2 && (stage > 2 || p > 0.5);
      leads.visible = stage >= 2;
      const m = stage >= 5 ? (stage > 5 || p > 0.6 ? curedMat : resinMat) : stage === 4 && p > 0.55 ? resinMat : copperMat;
      coilArr.forEach((c) => { c.material = m; });
      cords.children.forEach((c) => { c.material = stage >= 4 && p > 0.55 ? resinMat : cordMat; });
      if (stage >= 5) cords.children.forEach((c) => { c.material = curedMat; });
      core.material = stage >= 4 && (stage > 4 || p > 0.55) ? mat(0x3a2d22, { roughness: 0.3, metalness: 0.5 }) : lamMat;
    },
  };
}

// An old motor in for repair (rewind service)
export function createServiceMotor() {
  const g = new THREE.Group();
  add(g, box(1.0, 0.12, 0.8, mat(C.wood, { roughness: 0.9 })), 0, 0.06, 0);
  const spec = { L: 0.85, R: 0.3 };
  const dirty = mat(0x5a4636, { roughness: 0.95, metalness: 0.1 });
  const frame = mesh(frameGeometry(spec.L, spec.R), dirty);
  frame.position.y = 0.12;
  g.add(frame);
  const coils = new THREE.Group();
  for (const s of [-1, 1]) add(coils, xtorus(spec.R * 0.55, spec.R * 0.15, mat(0x2e2219, { roughness: 0.9 })), s * (spec.L / 2 + 0.01), 0, 0);
  coils.position.y = 0.12 + spec.R * 1.12;
  g.add(coils);
  const tag = add(g, box(0.12, 0.16, 0.01, mat(0xffd21f)), 0.2, 0.12 + spec.R * 2.1, spec.R);
  return {
    group: g,
    set(stage, p) {
      // 0 inspect, 1 burnout, 2 strip, 3 rewind, 4 dip & bake, 5 test
      coils.visible = !(stage === 2 && p > 0.5) && stage !== 3 ? true : stage === 3 ? p > 0.15 : false;
      const c = stage >= 3 ? (stage >= 4 && p > 0.5 ? curedMat : copperMat) : stage === 1 && p > 0.5 ? mat(0x1b1714) : mat(0x2e2219, { roughness: 0.9 });
      coils.children.forEach((k) => { k.material = c; });
      coils.scale.setScalar(stage === 3 ? 0.3 + p * 0.7 : 1);
      frame.material = stage >= 2 && p > 0.6 ? mat(0x6f7378, { roughness: 0.6, metalness: 0.4 }) : stage >= 3 ? mat(0x6f7378, { roughness: 0.6, metalness: 0.4 }) : dirty;
      tag.visible = stage < 5;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------------------------
const SKIN = [0xc99a78, 0x8d5f3f, 0xe0b693, 0x6b4630, 0xd8a682];
export function createPerson({ shirt = 0x4b5563, vest = 0xf2e21a, pants = 0x2b3440, hat = 0xffffff, glasses = true } = {}) {
  const group = new THREE.Group();
  const skin = mat(SKIN[Math.floor(Math.random() * SKIN.length)], { roughness: 0.8 });
  const pantsM = mat(pants, { roughness: 0.85 });
  const shoes = mat(0x1a1a1a);
  // Each limb and the body are baked into single vertex-coloured meshes (5 draw calls per person)
  const legs = [];
  for (const z of [-0.1, 0.1]) {
    const hip = new THREE.Group();
    hip.position.set(0, 0.9, z);
    hip.add(mergeColored(tmpGroup(at(box(0.15, 0.82, 0.16, pantsM), 0, -0.41, 0), at(box(0.26, 0.08, 0.15, shoes), 0.05, -0.86, 0))));
    group.add(hip);
    legs.push(hip);
  }
  const torso = tmpGroup(at(box(0.24, 0.6, 0.42, mat(shirt, { roughness: 0.8 })), 0, 1.22, 0));
  if (vest) torso.add(at(box(0.26, 0.46, 0.44, mat(vest, { roughness: 0.7 })), 0, 1.24, 0));
  torso.add(at(box(0.1, 0.08, 0.1, skin), 0, 1.55, 0));
  torso.add(at(sphere(0.13, skin), 0, 1.7, 0));
  const helmet = at(sphere(0.145, mat(hat, { roughness: 0.35 })), 0, 1.76, 0);
  helmet.scale.set(1.05, 0.6, 1);
  torso.add(helmet);
  torso.add(at(box(0.18, 0.02, 0.26, mat(hat, { roughness: 0.35 })), 0.06, 1.75, 0));
  if (glasses) torso.add(at(box(0.02, 0.04, 0.2, mat(0x111111, { roughness: 0.1, metalness: 0.6 })), 0.125, 1.71, 0));
  const body = mergeColored(torso);
  group.add(body);
  const arms = [];
  for (const z of [-0.27, 0.27]) {
    const sh = new THREE.Group();
    sh.position.set(0, 1.47, z);
    sh.add(mergeColored(tmpGroup(at(box(0.12, 0.58, 0.11, mat(shirt, { roughness: 0.8 })), 0, -0.28, 0), at(sphere(0.06, skin), 0, -0.6, 0))));
    group.add(sh);
    arms.push(sh);
  }
  // Body faces +x
  return { group, legs, arms, body, phase: Math.random() * 10 };
}

// mode: 'walk' | 'work' | 'idle' | 'carry'
export function posePerson(p, mode, t) {
  const s = Math.sin(t);
  if (mode === 'walk' || mode === 'carry') {
    p.legs[0].rotation.z = s * 0.5;
    p.legs[1].rotation.z = -s * 0.5;
    if (mode === 'carry') {
      p.arms.forEach((a) => { a.rotation.z = 1.1; });
    } else {
      p.arms[0].rotation.z = -s * 0.45;
      p.arms[1].rotation.z = s * 0.45;
    }
    p.body.position.y = Math.abs(s) * 0.02;
  } else if (mode === 'work') {
    p.legs[0].rotation.z = p.legs[1].rotation.z = 0;
    p.arms[0].rotation.z = 1.0 + Math.sin(t * 1.7) * 0.35;
    p.arms[1].rotation.z = 0.8 + Math.sin(t * 2.3 + 1) * 0.4;
    p.arms[0].rotation.x = -0.15;
    p.arms[1].rotation.x = 0.15;
  } else {
    p.legs[0].rotation.z = p.legs[1].rotation.z = 0;
    p.arms[0].rotation.z = Math.sin(t * 0.5) * 0.05;
    p.arms[1].rotation.z = -Math.sin(t * 0.5) * 0.05;
    p.arms[0].rotation.x = p.arms[1].rotation.x = 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Machine building blocks
// ---------------------------------------------------------------------------------------------
export function stackLight(h = 0.6) {
  const g = new THREE.Group();
  add(g, cyl(0.025, 0.025, h, 8, mat(0x666c73)), 0, h / 2, 0);
  const lamps = {};
  [['red', 0xef4444], ['amber', 0xf59e0b], ['green', 0x22c55e]].forEach(([k, c], i) => {
    const off = new THREE.MeshStandardMaterial({ color: c, roughness: 0.3, transparent: true, opacity: 0.45 });
    const on = new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
    const m = add(g, cyl(0.07, 0.07, 0.12, 14, off, false), 0, h + 0.07 + (2 - i) * 0.125, 0);
    lamps[k] = { m, on, off };
  });
  add(g, cyl(0.072, 0.072, 0.03, 14, mat(0x222222)), 0, h + 0.44, 0);
  return {
    group: g,
    set(status, blink) {
      lamps.green.m.material = status === 'working' ? lamps.green.on : lamps.green.off;
      lamps.amber.m.material = status === 'blocked' || status === 'idle' || status === 'maint' ? lamps.amber.on : lamps.amber.off;
      lamps.red.m.material = status === 'down' && blink ? lamps.red.on : lamps.red.off;
      if (status === 'idle') lamps.amber.m.material = blink ? lamps.amber.on : lamps.amber.off;
    },
  };
}

export function hmi(parent, x, y, z, rotY = 0) {
  const g = new THREE.Group();
  add(g, box(0.06, 0.06, 0.5, mat(0x9aa1a9, { metalness: 0.6 })), 0, 0, -0.25);
  const head = add(g, box(0.36, 0.28, 0.06, mat(0x2b2f35)), 0, 0, 0.02);
  const scr = add(g, new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.2), new THREE.MeshBasicMaterial({ map: hmiTexture(), toneMapped: false })), 0, 0, 0.055);
  void head;
  void scr;
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  parent.add(g);
  return g;
}

// Enclosed machine tool: base, walls, roof, glass front, tunnel openings for the conveyor.
function enclosure(g, w, h, d, { color = C.machine, accent = C.abb, y0 = 0, tunnelY = 0.9, tunnelH = 0.8, tunnelW = 0.9, glass = true } = {}) {
  const body = mat(color, { roughness: 0.45, metalness: 0.2 });
  const acc = mat(accent, { roughness: 0.45 });
  const dark = mat(0x2b2f35, { roughness: 0.6 });
  add(g, box(w, 0.25, d, dark), 0, y0 + 0.125, 0);
  add(g, box(w, h, 0.06, body), 0, y0 + h / 2 + 0.25, -d / 2);
  add(g, box(w + 0.04, 0.08, d + 0.04, body), 0, y0 + h + 0.29, 0);
  const tb = tunnelY - tunnelH / 2;
  const tt = tunnelY + tunnelH / 2;
  for (const s of [-1, 1]) {
    const x = s * w / 2;
    // Side walls with a tunnel for the conveyor
    const sideW = d;
    if (tb > y0 + 0.25) add(g, box(0.06, tb - y0 - 0.25, sideW, body), x, (tb + y0 + 0.25) / 2, 0);
    add(g, box(0.06, y0 + h + 0.25 - tt, sideW, body), x, (tt + y0 + h + 0.25) / 2, 0);
    const jamb = (sideW - tunnelW) / 2;
    add(g, box(0.06, tunnelH, jamb, body), x, tunnelY, -d / 2 + jamb / 2);
    add(g, box(0.06, tunnelH, jamb, body), x, tunnelY, d / 2 - jamb / 2);
  }
  // Front: lower apron, accent stripe, glass, sliding door
  add(g, box(w, 0.7, 0.06, body), 0, y0 + 0.6, d / 2);
  add(g, box(w, 0.1, 0.07, acc), 0, y0 + 1.0, d / 2);
  if (glass) {
    const gl = add(g, new THREE.Mesh(cached(`gl${w}|${h}`, () => new THREE.PlaneGeometry(w * 0.48, h - 1.0)), glassMat), -w * 0.24, y0 + 0.25 + 0.95 + (h - 1.0) / 2 - 0.2, d / 2 + 0.01);
    void gl;
  }
  const door = new THREE.Group();
  add(door, box(w * 0.48, h - 0.9, 0.05, body), 0, 0, 0);
  add(door, new THREE.Mesh(cached(`dw${w}|${h}`, () => new THREE.PlaneGeometry(w * 0.3, (h - 0.9) * 0.55)), glassMat), 0, 0.15, 0.03);
  add(door, box(0.04, 0.4, 0.06, mat(0x222222)), -w * 0.2, 0, 0.05);
  door.position.set(w * 0.24, y0 + 0.25 + 0.95 + (h - 0.9) / 2 - 0.25, d / 2 + 0.05);
  g.add(door);
  return { door, doorX: w * 0.24, doorOpenX: -w * 0.22 };
}

export function machineCommon(g, { lightAt, hmiAt }) {
  const light = stackLight(0.5);
  light.group.position.set(...lightAt);
  g.add(light.group);
  if (hmiAt) hmi(g, ...hmiAt);
  return light;
}

function chipConveyor(g, x, z, len) {
  add(g, box(len, 0.4, 0.45, mat(0x3f454c)), x, 0.2, z);
  const ramp = add(g, box(0.9, 0.12, 0.45, mat(0x3f454c)), x + len / 2 + 0.35, 0.65, z);
  ramp.rotation.z = 0.6;
  add(g, box(0.7, 0.55, 0.6, mat(0x1d5fbf)), x + len / 2 + 1.0, 0.28, z);
}

function guardFence(g, x0, z0, x1, z1, h = 2.0) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, h - 0.15), meshGuardMaterial());
  panel.position.set((x0 + x1) / 2, h / 2 + 0.1, (z0 + z1) / 2);
  panel.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
  g.add(panel);
  const n = Math.max(1, Math.round(len / 1.4));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    add(g, box(0.06, h, 0.06, mat(C.yellow)), x0 + (x1 - x0) * t, h / 2, z0 + (z1 - z0) * t);
  }
  add(g, box(len, 0.05, 0.05, mat(C.yellow)), (x0 + x1) / 2, h, (z0 + z1) / 2).rotation.y = -Math.atan2(z1 - z0, x1 - x0);
}

function workbench(g, x, z, w = 1.6, d = 0.8, rotY = 0) {
  const b = new THREE.Group();
  add(b, box(w, 0.05, d, mat(0x8a6a48, { roughness: 0.8 })), 0, 0.9, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(b, box(0.05, 0.9, 0.05, mat(0x2a5d9f)), sx * (w / 2 - 0.05), 0.45, sz * (d / 2 - 0.05));
  add(b, box(w, 0.04, d, mat(0x2a5d9f)), 0, 0.2, 0);
  add(b, box(w, 0.6, 0.03, mat(0x9aa1a9)), 0, 1.25, -d / 2);
  for (let i = 0; i < 5; i++) add(b, box(0.03, 0.18, 0.03, mat([0xef4444, 0x2a5d9f, 0xf2c230][i % 3])), -w / 2 + 0.2 + i * 0.25, 1.15, -d / 2 + 0.04);
  add(b, box(w, 0.04, 0.06, glow(0xfff6e0)), 0, 1.6, -d / 2 + 0.15);
  b.position.set(x, 0, z);
  b.rotation.y = rotY;
  g.add(b);
  return b;
}

function balancerTool(g, x, z, top = 2.6) {
  const t = new THREE.Group();
  const cable = add(t, cyl(0.008, 0.008, 1, 4, mat(0x111111), false), 0, 0, 0);
  const tool = add(t, box(0.08, 0.25, 0.08, mat(0x2a5d9f)), 0, 0, 0);
  add(t, box(0.1, 0.12, 0.1, mat(0x333333)), 0, 0, 0);
  t.position.set(x, 0, z);
  g.add(t);
  add(g, box(0.15, 0.15, 0.15, mat(0x555b62)), x, top, z);
  return {
    set(y) {
      cable.scale.y = top - y;
      cable.position.y = (top + y) / 2;
      tool.position.y = y;
      t.children[2].position.y = y + 0.18;
    },
  };
}

// Robot borrowed from the Megafactory library (ABB-orange arm here), returns joint handles.
export function abbRobot(scale = 0.7, tool = 0x2b2f35) {
  const r = createRobot(0xf28c28, scale, tool);
  r.phase = Math.random() * 10;
  return r;
}
export function animateRobot(r, working, simDt, dt, amp = 1) {
  if (working) r.phase += simDt;
  const t = r.phase;
  const tgt = working
    ? { yaw: (r.baseYaw ?? 0) + Math.sin(t * 1.3) * 0.6 * amp, sh: 0.5 + Math.sin(t * 2.1) * 0.25 * amp, el: 0.9 + Math.sin(t * 2.7 + 1) * 0.3 * amp, wr: 0.5 + Math.sin(t * 3.3) * 0.3 }
    : { yaw: r.baseYaw ?? 0, sh: 0.05, el: 0.6, wr: 0.4 };
  const k = 1 - Math.exp(-8 * dt);
  r.turret.rotation.y += (tgt.yaw - r.turret.rotation.y) * k;
  r.shoulder.rotation.x += (tgt.sh - r.shoulder.rotation.x) * k;
  r.elbow.rotation.x += (tgt.el - r.elbow.rotation.x) * k;
  r.wrist.rotation.x += (tgt.wr - r.wrist.rotation.x) * k;
}

const lerpK = (dt, rate = 6) => 1 - Math.exp(-rate * dt);
const v = new THREE.Vector3();

// ---------------------------------------------------------------------------------------------
// Machines. Each returns { group, light, operators, update(ctx) }.
// Local frame: parts flow along +x through the origin at height ctx.y; +z is the front/aisle side.
// ctx: { working, status, occ, p, t, simDt, dt, y, fx, blink }
// ---------------------------------------------------------------------------------------------
export const MACHINES = {
  // ---- Lamination press line ----
  uncoiler(y) {
    const g = new THREE.Group();
    add(g, box(1.4, 0.4, 2.0, mat(C.machineBlue)), -1.4, 0.2, 0);
    add(g, box(0.25, 1.3, 0.25, mat(C.machineBlue)), -1.4, 1.0, -0.7);
    const coil = add(g, xtube(0.75, 0.3, 0.55, mat(0xaeb5bd, { metalness: 0.85, roughness: 0.3 }), 32), -1.4, 1.25, 0);
    coil.rotation.y = Math.PI / 2;
    add(g, box(1.2, 1.0, 1.2, mat(C.machine)), 0.4, 0.5, 0);
    const rolls = [];
    for (let i = 0; i < 5; i++) rolls.push(add(g, xcyl(0.06, 0.9, steelMat, 12), -0.05 + i * 0.22, y + (i % 2 ? 0.08 : -0.02), 0));
    rolls.forEach((r) => { r.rotation.y = Math.PI / 2; });
    add(g, box(2.2, 0.01, 0.55, mat(0xaeb5bd, { metalness: 0.85, roughness: 0.3 })), -0.5, y - 0.02, 0);
    const light = machineCommon(g, { lightAt: [0.9, 1.0, -0.5], hmiAt: [1.0, 1.4, 0.9] });
    return {
      group: g, light, ops: [[0.6, 1.4, -Math.PI / 2]],
      update(c) {
        if (c.working) {
          coil.rotation.x += c.simDt * 1.5;
          rolls.forEach((r) => { r.rotation.x += c.simDt * 8; });
        }
      },
    };
  },
  press(y) {
    const g = new THREE.Group();
    const blue = mat(C.machineBlue, { roughness: 0.4, metalness: 0.3 });
    add(g, box(3.0, 0.8, 2.4, mat(0x2b2f35)), 0, 0.4, 0);
    add(g, box(2.0, y - 0.8, 1.8, blue), 0, 0.8 + (y - 0.8) / 2, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, box(0.55, 4.2, 0.55, blue), sx * 1.15, 2.6, sz * 0.85);
    add(g, box(3.0, 1.2, 2.3, blue), 0, 5.0, 0);
    add(g, box(3.1, 0.12, 2.4, mat(C.abb)), 0, 4.45, 0);
    const fly = add(g, xcyl(0.75, 0.3, mat(0x3a3f45), 28), 1.7, 5.0, 0);
    fly.rotation.y = 0;
    const spokes = add(g, box(0.32, 1.4, 0.12, mat(C.yellow)), 1.7, 5.0, 0);
    const ram = add(g, box(1.8, 0.6, 1.5, mat(0x5f6873, { metalness: 0.5 })), 0, 0, 0);
    const die = add(g, box(1.4, 0.2, 1.1, mat(0x9aa1a9, { metalness: 0.7 })), 0, 0, 0);
    add(g, box(1.4, 0.15, 1.1, mat(0x9aa1a9, { metalness: 0.7 })), 0, y - 0.1, 0);
    guardFence(g, -1.8, 1.6, 1.8, 1.6, 2.2);
    add(g, box(0.4, 1.8, 0.6, mat(0x2b2f35)), -1.9, 0.9, -1.4);
    const light = machineCommon(g, { lightAt: [-1.3, 5.6, 1.0], hmiAt: [2.1, 1.5, 1.4, -0.4] });
    let ph = 0;
    return {
      group: g, light, ops: [[2.3, 2.0, -Math.PI / 2]],
      update(c) {
        if (c.working) ph += c.simDt * 6;
        const stroke = c.working ? (1 - Math.cos(ph)) / 2 : 0;
        ram.position.y = 3.6 - stroke * (3.6 - (y + 0.75));
        die.position.y = ram.position.y - 0.4;
        fly.rotation.x += c.dt * (c.working ? 6 : c.status === 'down' ? 0 : 1.5);
        spokes.rotation.x = fly.rotation.x;
        if (c.working && stroke > 0.97 && Math.random() < 0.5) c.fx.sparks.emit(g.localToWorld(v.set(0, y + 0.1, 0.6)), 4);
      },
    };
  },
  stacker(y) {
    const g = new THREE.Group();
    add(g, box(1.6, y, 1.4, mat(C.machine)), 0, y / 2, -1.2);
    const r = abbRobot(0.55, C.abb);
    r.root.position.set(0, 0, -1.25);
    r.baseYaw = 0;
    g.add(r.root);
    const laser = add(g, box(0.5, 1.6, 0.5, mat(0x2b2f35)), 1.0, 0.8 + y, -0.9);
    void laser;
    guardFence(g, -1.4, -2.2, 1.4, -2.2);
    guardFence(g, -1.4, -2.2, -1.4, 0.8);
    const light = machineCommon(g, { lightAt: [1.3, 1.7, -2.0], hmiAt: [1.4, 1.4, 1.1, -0.4] });
    return {
      group: g, light, ops: [[0.4, 1.5, -Math.PI / 2]],
      update(c) {
        animateRobot(r, c.working, c.simDt, c.dt);
        if (c.working && c.p > 0.4 && Math.random() < 0.6) c.fx.sparks.emit(g.localToWorld(v.set(-0.1, y + 0.35, 0)), 3);
      },
    };
  },

  // ---- Machining (rotor / shaft / frame / bracket lines) ----
  lathe(y, { color = C.machine, accent = C.abb, w = 2.6 } = {}) {
    const g = new THREE.Group();
    const enc = enclosure(g, w, 2.0, 1.7, { color, accent, tunnelY: y + 0.25 });
    const spindle = add(g, xcyl(0.22, 0.4, mat(0x3a3f45), 16), -w * 0.3, y + 0.3, -0.3);
    const chuck = add(g, xcyl(0.16, 0.12, steelMat, 6), -w * 0.3 + 0.24, y + 0.3, -0.3);
    const turret = add(g, box(0.35, 0.35, 0.35, mat(0x5f6873)), 0, y + 0.85, -0.2);
    chipConveyor(g, -0.2, -1.2, w - 0.6);
    const light = machineCommon(g, { lightAt: [w / 2 - 0.15, 2.4, -0.7], hmiAt: [w / 2 + 0.15, 1.5, 0.9, -0.5] });
    return {
      group: g, light, ops: [[w / 2 + 0.45, 1.3, -Math.PI / 2]],
      update(c) {
        const open = !c.working || c.p < 0.08 || c.p > 0.92;
        enc.door.position.x += ((open ? enc.doorOpenX : enc.doorX) - enc.door.position.x) * lerpK(c.dt, 5);
        if (c.working) {
          chuck.rotation.x += c.simDt * 30;
          spindle.rotation.x += c.simDt * 30;
          turret.position.x = Math.sin(c.t * 1.4) * w * 0.25;
          turret.position.y = y + 0.55 + Math.abs(Math.sin(c.t * 0.9)) * 0.2;
          if (Math.random() < 0.4) c.fx.mist.emit(g.localToWorld(v.set(turret.position.x, y + 0.35, -0.1)), 1);
        }
      },
    };
  },
  mill(y, opts = {}) {
    const g = new THREE.Group();
    const w = opts.w ?? 2.4;
    const enc = enclosure(g, w, 2.4, 1.9, { color: opts.color ?? C.machine, accent: opts.accent ?? C.abb, tunnelY: y + 0.25 });
    add(g, box(0.8, 2.0, 0.7, mat(0x5f6873)), 0, 1.4, -0.55);
    const head = add(g, box(0.45, 0.6, 0.45, mat(0x3a3f45)), 0, y + 1.0, -0.15);
    const tool = add(g, cyl(0.04, 0.04, 0.35, 8, brightMat), 0, y + 0.55, -0.15);
    add(g, box(0.6, 0.6, 0.6, mat(0x2b2f35)), -w / 2 - 0.45, 1.0, -0.5); // tool magazine
    chipConveyor(g, 0, -1.35, w - 0.8);
    const light = machineCommon(g, { lightAt: [w / 2 - 0.2, 2.8, -0.8], hmiAt: [w / 2 + 0.15, 1.5, 1.0, -0.5] });
    return {
      group: g, light, ops: [[w / 2 + 0.45, 1.3, -Math.PI / 2]],
      update(c) {
        const open = !c.working || c.p < 0.08 || c.p > 0.92;
        enc.door.position.x += ((open ? enc.doorOpenX : enc.doorX) - enc.door.position.x) * lerpK(c.dt, 5);
        if (c.working) {
          head.position.x = tool.position.x = Math.sin(c.t * 1.1) * 0.5;
          const dz = Math.sin(c.t * 1.7) * 0.15;
          head.position.y = y + 0.95 + dz;
          tool.position.y = y + 0.5 + dz;
          tool.rotation.y += c.simDt * 40;
          if (Math.random() < 0.4) c.fx.mist.emit(g.localToWorld(v.set(tool.position.x, y + 0.35, -0.1)), 1);
        }
      },
    };
  },
  saw(y) {
    const g = new THREE.Group();
    add(g, box(2.4, y, 0.9, mat(C.machineBlue)), 0, y / 2, -0.15);
    add(g, box(0.4, 1.4, 1.0, mat(C.yellow)), -0.2, y + 0.75, -0.2);
    const blade = add(g, box(0.03, 0.9, 0.95, mat(0x9aa1a9, { metalness: 0.8 })), 0.05, y + 0.6, -0.2);
    for (let i = 0; i < 6; i++) add(g, xcyl(0.12, 0.02, steelMat, 10), -1.6 - i * 0.1, 0, 0);
    add(g, box(2.0, 0.6, 0.6, mat(0x5f6873)), -2.3, 0.3, -0.1);
    for (let i = 0; i < 7; i++) add(g, xcyl(0.05, 2.0, castMat, 10), -2.3, 0.66 + Math.floor(i / 4) * 0.1, -0.25 + (i % 4) * 0.12);
    const light = machineCommon(g, { lightAt: [1.0, y + 0.4, -0.5], hmiAt: [1.0, 1.4, 0.8, -0.4] });
    return {
      group: g, light, ops: [[0.8, 1.3, -Math.PI / 2]],
      update(c) {
        blade.position.y = c.working ? y + 0.6 - Math.min(1, c.p * 1.4) * 0.45 : y + 0.6;
        if (c.working && c.p < 0.7 && Math.random() < 0.6) c.fx.sparks.emit(g.localToWorld(v.set(0.05, y + 0.2, 0)), 2);
      },
    };
  },
  grinder(y) {
    const g = new THREE.Group();
    const enc = enclosure(g, 2.8, 1.9, 1.7, { color: 0xd8dde2, accent: C.machineBlue, tunnelY: y + 0.25 });
    const wheel = add(g, xcyl(0.42, 0.12, mat(0x9b8a74, { roughness: 0.9 }), 26), 0, y + 0.35, -0.55);
    wheel.rotation.y = Math.PI / 2;
    add(g, box(0.6, 0.5, 0.5, mat(0x3a3f45)), 0, y + 0.35, -0.95);
    const light = machineCommon(g, { lightAt: [1.25, 2.3, -0.7], hmiAt: [1.55, 1.5, 0.9, -0.5] });
    return {
      group: g, light, ops: [[1.85, 1.3, -Math.PI / 2]],
      update(c) {
        const open = !c.working || c.p < 0.08 || c.p > 0.92;
        enc.door.position.x += ((open ? enc.doorOpenX : enc.doorX) - enc.door.position.x) * lerpK(c.dt, 5);
        if (c.working) {
          wheel.rotation.z += c.simDt * 25;
          wheel.position.x = Math.sin(c.t * 0.8) * 0.35;
          if (Math.random() < 0.7) c.fx.sparks.emit(g.localToWorld(v.set(wheel.position.x, y + 0.25, -0.15)), 3);
        }
      },
    };
  },
  diecast(y) {
    const g = new THREE.Group();
    const blue = mat(C.machineBlue, { roughness: 0.4, metalness: 0.3 });
    add(g, box(4.2, 0.9, 1.6, blue), -0.2, 0.45, -1.6);
    for (const sx of [-1.8, 1.0]) add(g, box(0.5, 1.8, 1.6, blue), sx, 1.8, -1.6);
    for (const dz of [-0.55, 0.55]) for (const dy of [1.2, 2.4]) add(g, xcyl(0.07, 2.8, brightMat, 10), -0.4, dy, -1.6 + dz);
    const platen = add(g, box(0.4, 1.6, 1.5, mat(0x5f6873)), 0.2, 1.8, -1.6);
    add(g, xcyl(0.18, 1.4, mat(0x3a3f45), 12), 2.0, 1.4, -1.6);
    // Holding furnace with molten aluminium
    add(g, cyl(0.7, 0.75, 1.0, 20, mat(0x6b5a4a, { roughness: 0.9 })), -2.9, 0.5, 0.2);
    const melt = add(g, cyl(0.55, 0.55, 0.04, 20, glow(0xff7a1a), false), -2.9, 1.01, 0.2);
    const r = abbRobot(0.5, 0x333333);
    r.root.position.set(-1.6, 0, 0.9);
    r.baseYaw = Math.PI / 2;
    g.add(r.root);
    guardFence(g, -3.8, 1.9, 2.4, 1.9, 2.0);
    const light = machineCommon(g, { lightAt: [2.2, 2.9, -2.2], hmiAt: [2.6, 1.5, 0.2, -0.6] });
    return {
      group: g, light, ops: [[2.9, 0.8, -Math.PI / 2]],
      update(c) {
        animateRobot(r, c.working, c.simDt, c.dt, 0.7);
        const closed = c.working && c.p > 0.2 && c.p < 0.8;
        platen.position.x += ((closed ? 0.75 : 0.0) - platen.position.x) * lerpK(c.dt, 4);
        melt.material.color.setHSL(0.07, 1, 0.5 + Math.sin(c.t * 3) * 0.05);
        if (c.working && Math.random() < 0.15) c.fx.smoke.emit(g.localToWorld(v.set(-2.9, 1.2, 0.2)), 1);
      },
    };
  },
  hpress(y) {
    // Hydraulic C-frame press (shaft press, bearing press)
    const g = new THREE.Group();
    const blue = mat(C.machineBlue, { roughness: 0.4, metalness: 0.3 });
    add(g, box(1.2, y - 0.05, 1.2, blue), 0, (y - 0.05) / 2, -0.25);
    add(g, box(1.2, 2.4, 0.4, blue), 0, y + 1.2, -0.75);
    add(g, box(1.2, 0.5, 1.2, blue), 0, y + 2.1, -0.25);
    add(g, cyl(0.25, 0.25, 0.7, 16, mat(0x3a3f45)), 0, y + 2.6, 0);
    const rod = add(g, cyl(0.07, 0.07, 1, 10, brightMat), 0, 0, 0);
    const ram = add(g, box(0.5, 0.25, 0.5, mat(0x5f6873)), 0, 0, 0);
    for (const s of [-1, 1]) add(g, box(0.08, 1.8, 0.08, mat(C.yellow)), s * 0.7, 1.0, 0.45);
    const light = machineCommon(g, { lightAt: [0.5, y + 2.4, -0.7], hmiAt: [0.9, 1.4, 0.6, -0.5] });
    return {
      group: g, light, ops: [[0.2, 1.1, -Math.PI / 2]],
      update(c) {
        const d = c.working ? Math.sin(Math.min(1, c.p) * Math.PI) : 0;
        ram.position.y = y + 1.75 - d * 0.95;
        const top = y + 2.3;
        rod.scale.y = top - ram.position.y;
        rod.position.y = (top + ram.position.y) / 2;
      },
    };
  },
  balancer(y) {
    const g = new THREE.Group();
    add(g, box(2.0, y, 1.0, mat(0xd8dde2)), 0, y / 2, -0.1);
    for (const x of [-0.45, 0.6]) add(g, box(0.15, 0.4, 0.3, mat(C.machineBlue)), x, y + 0.12, 0);
    const hood = new THREE.Group();
    add(hood, new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.6, 20, 1, true, 0, Math.PI), glassMat), 0, 0, 0).rotation.z = Math.PI / 2;
    hood.position.set(0, y + 0.25, 0);
    g.add(hood);
    add(g, box(0.6, 1.4, 0.5, mat(0x2b2f35)), 1.4, 0.7, -0.4);
    const strobe = add(g, box(0.12, 0.08, 0.12, glow(0xffffff), false), 0.2, y + 0.9, -0.4);
    const light = machineCommon(g, { lightAt: [1.4, 1.5, -0.4], hmiAt: [1.3, 1.6, 0.6, -0.4] });
    return {
      group: g, light, ops: [[0.6, 1.2, -Math.PI / 2]],
      update(c) {
        const closed = c.working && c.p > 0.15 && c.p < 0.85;
        hood.rotation.x += ((closed ? 0 : -1.6) - hood.rotation.x) * lerpK(c.dt, 5);
        strobe.visible = closed && Math.sin(c.t * 40) > 0;
        if (closed && c.occ?.part?.spinner) c.occ.part.spinner.forEach((s) => { s.rotation.x += c.simDt * 40; });
      },
    };
  },
  washer(y) {
    const g = new THREE.Group();
    const steel = mat(0xb4bac1, { metalness: 0.7, roughness: 0.35 });
    const len = 3.2;
    for (const z of [-0.8, 0.8]) add(g, box(len, 2.0, 0.06, steel), 0, 1.0, z);
    add(g, box(len, 0.06, 1.66, steel), 0, 2.0, 0);
    add(g, box(0.9, 1.4, 0.9, steel), 0.5, 2.7, -0.3);
    add(g, cyl(0.12, 0.12, 1.8, 10, steel), -1.0, 2.9, -0.3);
    for (const x of [-len / 2, len / 2]) add(g, new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), new THREE.MeshStandardMaterial({ color: 0x5b6670, transparent: true, opacity: 0.6, side: THREE.DoubleSide })), x, 1.5, 0).rotation.y = Math.PI / 2;
    const nozzles = [];
    for (let i = 0; i < 4; i++) for (const z of [-0.7, 0.7]) nozzles.push(new THREE.Vector3(-1.2 + i * 0.8, y + 0.9, z));
    const light = machineCommon(g, { lightAt: [1.5, 2.1, 0.7], hmiAt: [1.9, 1.4, 0.9, -0.5] });
    return {
      group: g, light, ops: [],
      update(c) {
        if (c.working) {
          for (let i = 0; i < 3; i++) {
            const n = nozzles[Math.floor(Math.random() * nozzles.length)];
            g.localToWorld(v.copy(n));
            c.fx.water.emitDir(v, g.localToWorld(new THREE.Vector3(n.x, y, 0)).sub(v).normalize().multiplyScalar(4), 2, 0.6);
          }
          if (Math.random() < 0.3) c.fx.mist.emit(g.localToWorld(v.set(0, 1.4, 0)), 1);
        }
      },
    };
  },
  robotload(y) {
    const g = new THREE.Group();
    const r = abbRobot(0.6, C.abb);
    r.root.position.set(0, 0, -1.6);
    r.baseYaw = 0;
    g.add(r.root);
    // Casting bins
    for (let i = 0; i < 2; i++) {
      add(g, box(1.0, 0.7, 1.0, mat(0x5f6873)), -2.0 + i * 1.1, 0.35, -1.6);
      for (let k = 0; k < 3; k++) add(g, box(0.5, 0.3, 0.4, castMat), -2.2 + i * 1.1 + (k % 2) * 0.4, 0.85, -1.75 + k * 0.15);
    }
    guardFence(g, -2.7, -2.6, 1.4, -2.6);
    guardFence(g, 1.4, -2.6, 1.4, -0.6);
    const light = machineCommon(g, { lightAt: [1.4, 2.1, -2.6] });
    return { group: g, light, ops: [], update(c) { animateRobot(r, c.working, c.simDt, c.dt); } };
  },
  cmm(y) {
    const g = new THREE.Group();
    add(g, box(2.0, y, 1.6, mat(0x2b2f35)), 0, y / 2, -0.2);
    add(g, box(1.9, 0.08, 1.5, mat(0x3b3f45, { roughness: 0.2 })), 0, y + 0.02, -0.2);
    const bridge = new THREE.Group();
    for (const z of [-0.9, 0.5]) add(bridge, box(0.12, 1.1, 0.12, mat(0xe6e8ea)), 0, y + 0.55, z);
    add(bridge, box(0.18, 0.18, 1.6, mat(0xe6e8ea)), 0, y + 1.1, -0.2);
    const probe = add(bridge, box(0.1, 0.6, 0.1, mat(0x9aa1a9)), 0, y + 0.75, -0.2);
    g.add(bridge);
    add(g, box(0.9, 1.1, 0.6, mat(0xd8dde2)), 1.6, 0.55, 0.6);
    add(g, new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.35), new THREE.MeshBasicMaterial({ map: hmiTexture(), toneMapped: false })), 1.6, 1.4, 0.75);
    const light = machineCommon(g, { lightAt: [-0.9, y + 1.3, -0.9] });
    return {
      group: g, light, ops: [[1.6, 1.2, -Math.PI / 2]],
      update(c) {
        if (c.working) {
          bridge.position.x = Math.sin(c.t * 0.9) * 0.4;
          probe.position.z = -0.2 + Math.sin(c.t * 1.6) * 0.3;
          probe.position.y = y + 0.75 - Math.abs(Math.sin(c.t * 2.2)) * 0.25;
        }
      },
    };
  },

  // ---- Stator line (secondary processes) ----
  winder(y) {
    const g = new THREE.Group();
    add(g, box(2.4, y, 1.2, mat(C.machine)), 0, y / 2, -1.0);
    const flyers = [];
    for (const x of [-0.6, 0.6]) {
      const head = new THREE.Group();
      add(head, box(0.4, 0.4, 0.4, mat(0x3a3f45)), 0, 0, 0);
      const arm = add(head, box(0.06, 0.6, 0.06, mat(C.abb)), 0, 0.3, 0);
      void arm;
      head.position.set(x, y + 0.9, -1.0);
      g.add(head);
      flyers.push(head);
      add(g, box(0.1, 0.8, 0.1, mat(0x9aa1a9)), x, y + 0.4, -1.3);
    }
    // Magnet-wire drums
    for (let i = 0; i < 3; i++) {
      add(g, cyl(0.25, 0.25, 0.45, 18, copperMat), -1.0 + i * 1.0, 0.25, -2.1);
      add(g, cyl(0.28, 0.28, 0.03, 18, mat(0x2b2f35)), -1.0 + i * 1.0, 0.48, -2.1);
    }
    const wires = [];
    for (let i = 0; i < 2; i++) {
      const w = add(g, cyl(0.004, 0.004, 1, 4, copperMat, false), 0, 0, 0);
      wires.push(w);
    }
    guardFence(g, -1.5, -2.6, 1.5, -2.6, 2.0);
    const light = machineCommon(g, { lightAt: [1.25, y + 1.0, -1.5], hmiAt: [1.4, 1.5, 0.6, -0.5] });
    return {
      group: g, light, ops: [[1.2, 1.3, -Math.PI / 2]],
      update(c) {
        flyers.forEach((f, i) => {
          if (c.working) f.rotation.x += c.simDt * 18 * (i ? 1 : -1);
          const w = wires[i];
          const from = new THREE.Vector3(-1.0 + i * 2.0, 0.5, -2.1);
          const to = new THREE.Vector3(f.position.x, f.position.y + 0.2, f.position.z);
          w.position.copy(from).add(to).multiplyScalar(0.5);
          w.scale.y = from.distanceTo(to);
          w.lookAt(g.localToWorld(to.clone()));
          w.rotateX(Math.PI / 2);
        });
      },
    };
  },
  inserter(y) {
    const g = new THREE.Group();
    add(g, box(1.6, y, 1.4, mat(C.machine)), 0, y / 2, -0.9);
    add(g, box(1.6, 2.6, 0.4, mat(C.machine)), 0, y + 1.3, -1.5);
    add(g, box(1.6, 0.1, 0.42, mat(C.abb)), 0, y + 2.0, -1.5);
    const head = add(g, cyl(0.2, 0.2, 0.9, 16, mat(0x3a3f45)), 0, 0, -0.55);
    const blades = add(g, cyl(0.12, 0.12, 0.5, 12, brightMat), 0, 0, -0.55);
    const light = machineCommon(g, { lightAt: [0.6, y + 2.8, -1.5], hmiAt: [1.1, 1.5, 0.5, -0.5] });
    return {
      group: g, light, ops: [[0.9, 1.1, -Math.PI / 2]],
      update(c) {
        const d = c.working ? Math.sin(Math.min(1, c.p) * Math.PI) : 0;
        head.position.y = y + 2.0 - d * 0.6;
        blades.position.y = head.position.y - 0.6;
        head.rotation.y += c.working ? c.simDt * 2 : 0;
      },
    };
  },
  lacer(y) {
    const g = new THREE.Group();
    workbench(g, 0, -1.1, 2.0, 0.8);
    const fixtureRing = add(g, xtorus(0.32, 0.03, mat(C.yellow)), 0.6, 1.25, -1.1);
    const tool = balancerTool(g, 0.2, -0.4, 2.7);
    const light = machineCommon(g, { lightAt: [-1.0, 1.0, -1.4] });
    return {
      group: g, light, ops: [[0.1, -0.1, -Math.PI / 2 - 0.3], [-0.6, 1.2, -Math.PI / 2]],
      update(c) {
        if (c.working) fixtureRing.rotation.x += c.simDt * 2;
        tool.set(c.working ? 1.3 + Math.sin(c.t * 2.5) * 0.2 : 1.8);
      },
    };
  },
  surge(y) {
    const g = new THREE.Group();
    add(g, box(1.2, 1.8, 0.7, mat(0x2b2f35)), -0.2, 0.9, -1.2);
    const scr = add(g, new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshBasicMaterial({ color: 0x0b2a2a, toneMapped: false })), -0.2, 1.35, -0.84);
    const trace = add(g, box(0.7, 0.02, 0.01, glow(0x2ee6d2), false), -0.2, 1.35, -0.83);
    const clamps = [];
    for (const s of [-1, 1]) clamps.push(add(g, box(0.05, 0.3, 0.05, mat(0xef4444)), s * 0.3, y + 0.7, 0));
    add(g, box(0.4, 0.04, 0.04, mat(0xf2c230)), 0, y + 1.6, 0);
    const light = machineCommon(g, { lightAt: [0.5, 1.9, -1.2] });
    return {
      group: g, light, ops: [[0.8, 1.0, -Math.PI / 2]],
      update(c) {
        scr.material.color.setHex(c.working ? 0x0c3434 : 0x0b1a1a);
        trace.scale.y = c.working ? 1 + Math.abs(Math.sin(c.t * 25)) * 12 : 1;
        clamps.forEach((k) => { k.position.y += ((c.working ? y + 0.45 : y + 0.8) - k.position.y) * lerpK(c.dt, 8); });
      },
    };
  },
  vpi(y) {
    const g = new THREE.Group();
    const steel = mat(0xb4bac1, { metalness: 0.7, roughness: 0.35 });
    add(g, cyl(1.0, 1.0, 1.9, 28, steel), 0, 0.95, -1.9);
    const lid = new THREE.Group();
    add(lid, cyl(1.05, 1.05, 0.15, 28, steel), 0, 0, 0);
    add(lid, sphere(0.25, mat(0x3a3f45)), 0, 0.1, 0);
    lid.position.set(0, 1.97, -1.9);
    g.add(lid);
    for (let i = 0; i < 3; i++) add(g, cyl(0.12, 0.12, 0.6, 12, glow(0xff9f1a)), -0.45 + i * 0.45, 0.6, -0.89).rotation.x = Math.PI / 2;
    add(g, cyl(0.45, 0.45, 1.6, 20, mat(0x6b7178)), 1.7, 0.8, -2.3); // resin storage
    add(g, cyl(0.06, 0.06, 1.8, 8, steel), 1.0, 1.6, -2.1).rotation.z = Math.PI / 2;
    add(g, box(0.8, 1.6, 0.6, mat(0x2b2f35)), -1.7, 0.8, -2.0);
    // Overhead hoist that dips the stator
    for (const z of [-2.7, 0.6]) add(g, box(0.15, 4.2, 0.15, mat(C.yellow)), -1.3, 2.1, z);
    add(g, box(0.25, 0.25, 3.6, mat(C.yellow)), -1.3, 4.2, -1.05);
    const hoist = add(g, box(0.5, 0.4, 0.5, mat(C.machineBlue)), -1.3, 4.0, 0);
    const cable = add(g, cyl(0.02, 0.02, 1, 6, mat(0x111111), false), 0, 0, 0);
    const basket = add(g, box(0.7, 0.05, 0.6, mat(0x3a3f45)), 0, 0, 0);
    const light = machineCommon(g, { lightAt: [1.1, 2.0, -1.2], hmiAt: [-1.7, 1.7, -1.5, 0] });
    return {
      group: g, light, ops: [[1.4, 0.8, -Math.PI / 2]],
      hidesPart: (p) => p > 0.18 && p < 0.82,
      update(c) {
        // 0-0.18 hoist over tank, 0.18-0.82 under resin + vacuum/pressure, then back
        const p = c.working ? c.p : 0;
        const inTank = p > 0.18 && p < 0.82;
        lid.position.y += ((inTank || p === 0 ? 1.97 : 2.9) - lid.position.y) * lerpK(c.dt, 4);
        lid.position.x += ((p > 0.1 && p < 0.9 && !inTank ? 1.2 : 0) - lid.position.x) * lerpK(c.dt, 4);
        const hz = p < 0.1 || p > 0.9 ? 0 : -1.9;
        hoist.position.z += (hz - hoist.position.z) * lerpK(c.dt, 4);
        hoist.position.x = 0;
        const by = inTank ? 1.0 : y + 0.5;
        basket.position.set(0, basket.position.y + (by - basket.position.y) * lerpK(c.dt, 4), hoist.position.z);
        cable.scale.y = 3.8 - basket.position.y;
        cable.position.set(0, (3.8 + basket.position.y) / 2, hoist.position.z);
        basket.visible = cable.visible = c.working;
      },
    };
  },
  oven(y, { len = 4.4, label = 0xff7a1a } = {}) {
    const g = new THREE.Group();
    const skin = mat(0xc9ced4, { metalness: 0.5, roughness: 0.4 });
    for (const z of [-1.2, 1.2]) add(g, box(len, 2.6, 0.1, skin), 0, 1.3, z);
    add(g, box(len, 0.15, 2.5, skin), 0, 2.6, 0);
    add(g, box(1.2, 1.0, 1.0, skin), -len / 2 + 0.8, 3.1, 0);
    add(g, cyl(0.18, 0.18, 2.0, 12, mat(0x6b7178)), len / 2 - 0.6, 3.6, -0.6);
    const doors = [];
    for (const s of [-1, 1]) {
      const d = add(g, box(0.08, 1.4, 2.3, skin), s * len / 2, 0, 0);
      doors.push(d);
    }
    const glowM = new THREE.MeshBasicMaterial({ color: label, toneMapped: false, transparent: true, opacity: 0.5 });
    const inner = add(g, box(len - 0.3, 0.05, 2.2, glowM, false), 0, 2.45, 0);
    for (const z of [-1.26, 1.26]) add(g, box(len * 0.8, 0.12, 0.02, mat(C.abb)), 0, 2.2, z);
    const light = machineCommon(g, { lightAt: [len / 2 - 0.3, 2.7, 1.1], hmiAt: [len / 2 + 0.2, 1.5, 1.4, -0.5] });
    return {
      group: g, light, ops: [],
      hidesPart: () => false,
      update(c) {
        const closed = c.working && c.p > 0.12 && c.p < 0.88;
        doors.forEach((d) => { d.position.y += ((closed ? y + 0.55 : y + 1.9) - d.position.y) * lerpK(c.dt, 5); });
        glowM.opacity = closed ? 0.75 + Math.sin(c.t * 4) * 0.1 : 0.25;
        if (closed && Math.random() < 0.2) c.fx.smoke.emit(g.localToWorld(v.set(len / 2 - 0.6, 4.6, -0.6)), 1);
      },
    };
  },
  coolinspect(y) {
    const g = new THREE.Group();
    const fans = [];
    for (const z of [-1.2, 1.2]) {
      add(g, box(1.0, 1.2, 0.3, mat(0x3a3f45)), 0, y + 0.3, z);
      const f = add(g, cyl(0.4, 0.4, 0.04, 6, mat(0x9aa1a9)), 0, y + 0.3, z * 0.85);
      f.rotation.x = Math.PI / 2;
      fans.push(f);
    }
    add(g, box(0.06, 2.4, 0.06, mat(C.yellow)), 0.8, 1.2, -1.3);
    add(g, box(0.06, 0.06, 1.2, mat(C.yellow)), 0.8, 2.4, -0.7);
    const lamp = add(g, cyl(0.15, 0.2, 0.15, 12, glow(0xffffff), false), 0.8, 2.2, -0.1);
    const light = machineCommon(g, { lightAt: [-0.6, y + 1.0, -1.3] });
    return {
      group: g, light, ops: [[0.6, 1.3, -Math.PI / 2]],
      update(c) {
        fans.forEach((f) => { f.rotation.y += c.dt * (c.working ? 18 : 2); });
        lamp.visible = c.working;
      },
    };
  },

  // ---- Final assembly ----
  induction(y) {
    const g = new THREE.Group();
    workbench(g, -0.4, -1.3, 1.6, 0.8);
    add(g, box(0.9, 1.4, 0.7, mat(0xd8dde2)), 1.2, 0.7, -1.3);
    const coilM = new THREE.MeshStandardMaterial({ color: 0xc8763a, emissive: 0x000000, metalness: 0.7, roughness: 0.3 });
    const coil = add(g, xtorus(0.32, 0.04, coilM), 0, 0, 0);
    const arm = add(g, box(0.08, 0.08, 1.2, mat(0x9aa1a9)), 0, 0, -0.6);
    const light = machineCommon(g, { lightAt: [1.4, 1.6, -1.5], hmiAt: [1.2, 1.6, -0.9, 0] });
    const lift = balancerTool(g, -0.7, -0.3, 2.8);
    return {
      group: g, light, ops: [[-0.8, 0.9, -Math.PI / 2], [0.5, -1.0, Math.PI / 2 + 0.4]],
      update(c) {
        const s = c.occ?.part?.spec;
        const cy = y + (s ? s.R * 1.12 : 0.3);
        const heat = c.working && c.p < 0.55;
        coil.position.y += ((heat ? cy : cy + 0.9) - coil.position.y) * lerpK(c.dt, 5);
        arm.position.y = coil.position.y;
        coilM.emissive.setHex(heat ? 0xff5a00 : 0x000000);
        coilM.emissiveIntensity = heat ? 0.6 + Math.sin(c.t * 10) * 0.3 : 0;
        lift.set(c.working ? y + 0.8 + Math.sin(c.p * Math.PI) * 0.4 : 2.0);
      },
    };
  },
  rotorinsert(y) {
    const g = new THREE.Group();
    add(g, box(0.6, 0.12, 0.6, mat(0x2b2f35)), 1.2, 0.06, -1.0);
    add(g, cyl(0.1, 0.1, 2.8, 12, mat(0x9aa1a9, { metalness: 0.6 })), 1.2, 1.4, -1.0);
    const arm1 = new THREE.Group();
    arm1.position.set(1.2, 2.7, -1.0);
    add(arm1, box(1.4, 0.12, 0.12, mat(C.abb)), -0.7, 0, 0);
    g.add(arm1);
    const drop = add(arm1, box(0.05, 1.2, 0.05, mat(0x9aa1a9)), -1.4, -0.6, 0);
    const grip = add(arm1, box(0.3, 0.15, 0.3, mat(0x3a3f45)), -1.4, -1.25, 0);
    void drop;
    void grip;
    // Rotor rack beside the station
    add(g, box(1.2, 0.8, 0.6, mat(C.rack)), -1.4, 0.4, -1.4);
    for (let i = 0; i < 4; i++) add(g, xcyl(0.11, 0.3, lamMat, 14), -1.8 + i * 0.27, 0.92, -1.4);
    const light = machineCommon(g, { lightAt: [-0.6, 1.6, -1.6] });
    return {
      group: g, light, ops: [[0.4, 1.0, -Math.PI / 2], [-1.0, -0.9, Math.PI / 2]],
      update(c) {
        const tgt = c.working ? Math.PI / 2 * (1 - Math.min(1, c.p * 1.5)) * 0.7 - 0.2 : 0.6;
        arm1.rotation.y += (tgt - arm1.rotation.y) * lerpK(c.dt, 4);
      },
    };
  },
  fanbench(y) {
    const g = new THREE.Group();
    workbench(g, 0, -1.3, 2.0, 0.8);
    for (let i = 0; i < 3; i++) add(g, box(0.5, 0.5, 0.5, mat(0x3a3f45)), -0.6 + i * 0.6, 1.17, -1.3);
    const t1 = balancerTool(g, -0.3, -0.25, 2.7);
    const light = machineCommon(g, { lightAt: [1.1, 1.6, -1.6] });
    return {
      group: g, light, ops: [[-0.9, 0.9, -Math.PI / 2], [0.4, -1.0, Math.PI / 2]],
      update(c) { t1.set(c.working ? y + 0.6 + Math.sin(c.t * 3) * 0.15 : 1.9); },
    };
  },
  conduit(y) {
    const g = new THREE.Group();
    workbench(g, 0, -1.3, 2.0, 0.8);
    for (let i = 0; i < 6; i++) add(g, box(0.2, 0.12, 0.25, mat([0x3b4148, 0x24486f][i % 2])), -0.7 + i * 0.28, 0.99, -1.4);
    // Lead reels
    for (let i = 0; i < 3; i++) add(g, xcyl(0.2, 0.15, mat([0x111111, 0xef4444, 0xf2f2f2][i]), 14), -0.6 + i * 0.6, 1.8, -1.55).rotation.y = Math.PI / 2;
    const t1 = balancerTool(g, 0.2, -0.25, 2.7);
    const light = machineCommon(g, { lightAt: [1.1, 1.6, -1.6] });
    return {
      group: g, light, ops: [[-0.6, 0.9, -Math.PI / 2]],
      update(c) { t1.set(c.working ? y + 0.7 + Math.sin(c.t * 2.6) * 0.15 : 1.9); },
    };
  },
  runtest(y) {
    const g = new THREE.Group();
    // Dynamometer on a T-slot bed, coupled to the motor shaft
    add(g, box(2.6, 0.12, 1.2, mat(0x2b2f35, { metalness: 0.5 })), 0.2, y - 0.06, 0);
    const dyno = add(g, xcyl(0.3, 0.6, mat(C.machineBlue), 22), 1.25, y + 0.38, 0);
    add(g, box(0.5, 0.35, 0.7, mat(C.machineBlue)), 1.25, y + 0.12, 0);
    const coupling = add(g, xcyl(0.08, 0.25, mat(C.yellow), 10), 0.85, y + 0.3, 0);
    // Guard cage
    const cage = new THREE.Group();
    add(cage, new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.3, 1.4), glassMat), 0, 0, 0);
    cage.position.set(0.2, y + 0.65, 0);
    g.add(cage);
    // Test cabinets with live waveform
    add(g, box(1.6, 2.0, 0.7, mat(0xd8dde2)), -0.2, 1.0, -1.4);
    const scrM = new THREE.MeshBasicMaterial({ color: 0x0b1a2a, toneMapped: false });
    add(g, new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), scrM), -0.2, 1.5, -1.04);
    const bars = [];
    for (let i = 0; i < 8; i++) bars.push(add(g, box(0.07, 0.3, 0.01, glow(i < 5 ? 0x2ee6d2 : 0xf59e0b), false), -0.55 + i * 0.1, 1.42, -1.03));
    // Vibration sensor (AI) on the motor foot
    const sensor = add(g, cyl(0.04, 0.04, 0.08, 10, glow(0x2ee6d2), false), 0, y + 0.1, 0.35);
    const light = machineCommon(g, { lightAt: [0.6, 2.1, -1.4] });
    return {
      group: g, light, ops: [[-0.6, 1.0, -Math.PI / 2 - 0.4]],
      update(c) {
        const run = c.working && c.p > 0.1 && c.p < 0.92;
        cage.position.y += ((run ? y + 0.65 : y + 2.2) - cage.position.y) * lerpK(c.dt, 5);
        if (run) {
          dyno.rotation.x += c.simDt * 50;
          coupling.rotation.x += c.simDt * 50;
          if (c.occ?.part?.parts) {
            const sh = c.occ.part.parts.shaft;
            sh.rotation.x += c.simDt * 50;
            c.occ.part.parts.fan.rotation.x = sh.rotation.x;
            // tiny vibration
            c.occ.part.group.position.y += Math.sin(c.t * 90) * 0.002;
          }
        }
        bars.forEach((b, i) => { b.scale.y = run ? 0.4 + Math.abs(Math.sin(c.t * 8 + i)) * 1.6 : 0.3; });
        scrM.color.setHex(run ? 0x0d2c44 : 0x0b1a2a);
        sensor.visible = run;
      },
    };
  },
  vision(y) {
    const g = new THREE.Group();
    const frameM = mat(0x2b2f35, { metalness: 0.5 });
    for (const z of [-0.9, 0.9]) add(g, box(0.12, 2.6, 0.12, frameM), 0, 1.3, z);
    add(g, box(0.16, 0.16, 1.95, frameM), 0, 2.6, 0);
    const ring = add(g, mesh(new THREE.TorusGeometry(0.42, 0.04, 8, 28), glow(0xffffff), false), 0, 0, 0);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 2.45;
    const cams = [];
    const camM = mat(0x111111, { metalness: 0.4 });
    [[0, 2.42, 0, -Math.PI / 2], [0, 1.4, 0.82, 0], [0, 1.4, -0.82, Math.PI]].forEach(([x, yy, z, rx]) => {
      const cam = new THREE.Group();
      add(cam, box(0.18, 0.18, 0.25, camM), 0, 0, 0);
      add(cam, cyl(0.06, 0.06, 0.08, 12, mat(0x2e6bff, { roughness: 0.05, metalness: 0.9 })), 0, 0, -0.16).rotation.x = Math.PI / 2;
      cam.position.set(x, yy, z);
      cam.rotation.x = rx === -Math.PI / 2 ? -Math.PI / 2 : 0;
      if (rx === Math.PI) cam.rotation.y = Math.PI;
      g.add(cam);
      cams.push(cam);
    });
    const beam = add(g, new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.6, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide })), 0, 1.65, 0);
    add(g, box(0.9, 1.6, 0.5, mat(0xd8dde2)), 1.2, 0.8, -1.3);
    const light = machineCommon(g, { lightAt: [0, 2.75, 0.9] });
    return {
      group: g, light, ops: [],
      update(c) {
        const flash = c.working && Math.sin(c.t * 14) > 0.6;
        ring.material = flash ? glow(0xffffff) : glow(0x8fa0b0);
        beam.visible = c.working;
        beam.material.opacity = flash ? 0.22 : 0.08;
      },
    };
  },
  paint(y) {
    const g = new THREE.Group();
    const wall = mat(0xe6e8ea, { roughness: 0.6 });
    const len = 3.6;
    add(g, box(len, 3.0, 0.08, wall), 0, 1.5, -1.6);
    add(g, box(len, 0.08, 3.2, wall), 0, 3.0, 0);
    for (const x of [-len / 2, len / 2]) {
      add(g, box(0.08, 3.0 - y - 0.9, 3.2, wall), x, (3.0 + y + 0.9) / 2, 0);
      add(g, box(0.08, y - 0.3, 3.2, wall), x, (y - 0.3) / 2, 0);
    }
    // Filter wall
    add(g, box(len - 0.2, 2.2, 0.05, mat(0xf3eadb, { roughness: 1 })), 0, 1.6, -1.52);
    for (let i = 0; i < 3; i++) add(g, box(0.9, 0.9, 0.02, mat(0xcfc3ae)), -1.2 + i * 1.2, 1.6, -1.5);
    add(g, new THREE.Mesh(new THREE.PlaneGeometry(len, 2.1), glassMat), 0, 1.95, 1.6);
    add(g, box(len, 0.9, 0.08, wall), 0, 0.45, 1.6);
    for (let i = 0; i < 4; i++) add(g, box(0.7, 0.04, 0.3, glow(0xfff6e8), false), -1.3 + i * 0.87, 2.95, 0);
    const r = abbRobot(0.5, 0xffffff);
    r.root.position.set(0, 0, -0.95);
    g.add(r.root);
    r.root.traverse((o) => { if (o.isMesh && o.material.color && o.material.color.getHex() === 0xf28c28) o.material = mat(0xf4f4f0, { roughness: 0.9 }); });
    const light = machineCommon(g, { lightAt: [len / 2 - 0.3, 3.1, 1.4] });
    return {
      group: g, light, ops: [],
      update(c) {
        animateRobot(r, c.working, c.simDt, c.dt);
        if (c.working && c.p > 0.1 && c.p < 0.85) {
          r.tip.getWorldPosition(v);
          c.fx.paint.emit(v, 3);
          c.fx.paint.points.material.color.setHex(c.occ?.part?.spec?.paint ?? 0x24486f);
        }
      },
    };
  },
  pack(y) {
    const g = new THREE.Group();
    // Laser marker head on an arm + carton erector
    add(g, box(0.9, 1.6, 0.8, mat(0xd8dde2)), -0.6, 0.8, -1.4);
    const head = add(g, box(0.25, 0.3, 0.25, mat(0x2b2f35)), -0.6, y + 1.0, -0.6);
    add(g, box(0.06, 0.06, 0.8, mat(0x9aa1a9)), -0.6, y + 1.15, -1.0);
    const beam = add(g, box(0.01, 0.6, 0.01, glow(0x34ff6a), false), -0.6, y + 0.6, -0.4);
    add(g, box(1.2, 1.3, 1.0, mat(C.machineBlue)), 1.2, 0.65, -1.5);
    for (let i = 0; i < 6; i++) add(g, box(0.9, 0.04, 0.7, mat(C.cardboard, { roughness: 0.95 })), 1.2, 1.32 + i * 0.045, -1.5);
    const light = machineCommon(g, { lightAt: [1.7, 1.6, -1.1] });
    const lift = balancerTool(g, 0.6, -0.2, 2.7);
    return {
      group: g, light, ops: [[0.9, 1.0, -Math.PI / 2]],
      update(c) {
        beam.visible = c.working && c.p < 0.35;
        head.position.x = -0.6 + (c.working && c.p < 0.35 ? Math.sin(c.t * 12) * 0.08 : 0);
        lift.set(c.working && c.p > 0.5 ? y + 1.0 : 2.0);
      },
    };
  },

  // ---- Rewind service shop ----
  inspectbench(y) {
    const g = new THREE.Group();
    workbench(g, 0, -1.3, 2.2, 0.8);
    add(g, box(0.5, 0.35, 0.35, mat(0xf2c230)), -0.5, 1.1, -1.3); // megger
    add(g, box(0.4, 0.3, 0.05, glow(0x2ee6d2), false), 0.5, 1.25, -1.5);
    const light = machineCommon(g, { lightAt: [1.2, 1.6, -1.6] });
    return { group: g, light, ops: [[0.2, 0.9, -Math.PI / 2], [-0.8, -1.0, Math.PI / 2]], update() {} };
  },
  burnout(y) { return MACHINES.oven(y, { len: 3.2, label: 0xff3a00 }); },
  strip(y) {
    const g = new THREE.Group();
    add(g, box(1.2, y + 0.4, 1.2, mat(C.machineBlue)), 0, (y + 0.4) / 2, -1.2);
    const puller = add(g, box(0.25, 0.25, 1.0, mat(0x3a3f45)), 0, y + 0.4, -0.6);
    add(g, box(0.8, 0.6, 0.8, mat(0x5f6873)), -1.3, 0.3, -1.1);
    for (let i = 0; i < 4; i++) add(g, xtorus(0.12, 0.04, mat(0x2e2219)), -1.4 + (i % 2) * 0.2, 0.65 + Math.floor(i / 2) * 0.08, -1.1 + (i % 2) * 0.1);
    const light = machineCommon(g, { lightAt: [0.6, y + 0.9, -1.6] });
    return {
      group: g, light, ops: [[0.9, 1.0, -Math.PI / 2]],
      update(c) { puller.position.z = -0.6 - (c.working ? Math.abs(Math.sin(c.t * 2)) * 0.4 : 0); },
    };
  },
  rewind(y) {
    const g = new THREE.Group();
    add(g, box(3.0, 0.7, 0.9, mat(0x2b2f35)), 0, 0.35, -1.4);
    add(g, box(0.6, 1.0, 0.7, mat(C.machineBlue)), -1.1, 1.2, -1.4);
    const face = add(g, xcyl(0.35, 0.08, mat(0x5f6873), 16), -0.75, 1.2, -1.4);
    const stat = add(g, xtube(0.32, 0.2, 0.5, lamMat), -0.3, 1.2, -1.4);
    const coils = add(g, xtorus(0.26, 0.05, copperMat), 0.0, 1.2, -1.4);
    for (let i = 0; i < 3; i++) add(g, cyl(0.15, 0.15, 0.3, 14, copperMat), 0.8 + i * 0.4, 0.85, -1.4);
    const light = machineCommon(g, { lightAt: [1.4, 1.2, -1.75] });
    return {
      group: g, light, ops: [[-0.2, -0.5, -Math.PI / 2], [0.8, -0.4, -Math.PI / 2 - 0.4]],
      update(c) {
        if (c.working) [face, stat, coils].forEach((o) => { o.rotation.x += c.simDt * 2.5; });
        coils.visible = c.working;
      },
    };
  },
  dipbake(y) {
    const g = new THREE.Group();
    add(g, box(1.6, 1.0, 1.4, mat(0xb4bac1, { metalness: 0.6 })), -1.2, 0.5, -1.6);
    add(g, box(1.45, 0.02, 1.25, resinMat), -1.2, 1.0, -1.6);
    const o = MACHINES.oven(y, { len: 2.8, label: 0xff7a1a });
    o.group.position.x = 0.8;
    o.group.scale.set(1, 0.85, 0.8);
    g.add(o.group);
    return { group: g, light: o.light, ops: [[-1.2, -0.4, -Math.PI / 2]], update(c) { o.update(c); } };
  },
};

// ---------------------------------------------------------------------------------------------
// Logistics & storage
// ---------------------------------------------------------------------------------------------
export function createPallet(w = 1.2, d = 1.0) {
  const geo = cached(`pallet${w}|${d}`, () => {
    const parts = [];
    for (const z of [-d / 2 + 0.05, 0, d / 2 - 0.05]) parts.push(new THREE.BoxGeometry(w, 0.1, 0.1).translate(0, 0.05, z));
    for (let i = 0; i < 5; i++) parts.push(new THREE.BoxGeometry(0.12, 0.03, d).translate(-w / 2 + 0.06 + i * ((w - 0.12) / 4), 0.115, 0));
    return mergeGeometries(parts.map((p) => p.toNonIndexed()));
  });
  const g = new THREE.Group();
  g.add(mesh(geo, mat(C.wood, { roughness: 0.9 })));
  return g;
}

const cartonProtos = {};
function cartonProto(kind) {
  if (!cartonProtos[kind]) {
    cartonProtos[kind] = createMotor(kind);
    cartonProtos[kind].setStage(7);
  }
  return cartonProtos[kind];
}
// Pallet of packed motors: cartons stack 2x2 (A) or 1x2 (B) per layer, two layers.
export function createLoadedPallet(kind) {
  const spec = MOTOR[kind];
  const w = 1.2;
  const d = kind === 'A' ? 1.0 : 1.4;
  const g = createPallet(w, d);
  const proto = cartonProto(kind);
  const cs = proto.cartonSize;
  const perLayer = kind === 'A' ? 4 : 2;
  // All cartons on a pallet are one instanced mesh; the visible count is the instance count
  const cartons = new THREE.InstancedMesh(proto.carton.geometry, cartonMaterial(), spec.perPallet);
  cartons.castShadow = cartons.receiveShadow = true;
  const o = new THREE.Object3D();
  for (let i = 0; i < spec.perPallet; i++) {
    const layer = Math.floor(i / perLayer);
    const k = i % perLayer;
    o.rotation.set(0, Math.PI / 2, 0);
    if (kind === 'A') {
      o.position.set((k % 2 ? 0.3 : -0.3), 0.13 + cs[1] / 2 + layer * cs[1], (k < 2 ? -0.25 : 0.25));
      o.scale.set(0.95, 1, 0.82);
    } else {
      o.position.set(k ? 0.32 : -0.32, 0.13 + cs[1] / 2 + layer * cs[1], 0);
      o.scale.set(0.9, 1, 0.9);
    }
    o.updateMatrix();
    cartons.setMatrixAt(i, o.matrix);
  }
  cartons.count = 0;
  g.add(cartons);
  // Stretch wrap shows once full
  const wrapH = 0.13 + cs[1] * 2;
  const wrap = add(g, new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, wrapH - 0.12, d + 0.04), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, roughness: 0.1, depthWrite: false })), 0, 0.13 + (wrapH - 0.12) / 2, 0);
  wrap.visible = false;
  return {
    group: g, kind, count: 0, cap: spec.perPallet, height: wrapH,
    setCount(n) {
      this.count = n;
      cartons.count = n;
      wrap.visible = n >= this.cap;
    },
  };
}

// Selective pallet racking (orange beams, blue uprights): bays along +x, levels in y, depth z.
export function createRack(bays, levels, { bayW = 2.8, depth = 1.2, levelH = 1.7, upright = 0x2a5d9f, beam = 0xf07a1a } = {}) {
  const g = new THREE.Group();
  const up = mat(upright, { metalness: 0.4, roughness: 0.5 });
  const bm = mat(beam, { metalness: 0.3, roughness: 0.5 });
  const H = levels * levelH + 0.4;
  for (let i = 0; i <= bays; i++) {
    for (const z of [-depth / 2, depth / 2]) add(g, box(0.09, H, 0.09, up), i * bayW, H / 2, z);
    for (let k = 0; k < 4; k++) add(g, box(0.04, 0.04, depth, up, false), i * bayW, 0.4 + k * (H / 4), 0);
  }
  for (let l = 0; l < levels; l++) {
    const yy = l === 0 ? 0.12 : l * levelH;
    if (l > 0) for (const z of [-depth / 2, depth / 2]) add(g, box(bays * bayW, 0.12, 0.07, bm, false), bays * bayW / 2, yy, z);
  }
  return { group: g, slotPos: (bay, level) => new THREE.Vector3(bay * bayW + bayW / 2, level === 0 ? 0 : level * levelH + 0.06, 0), H };
}

// Shelving with small parts bins (line-side supermarket, tool crib)
export function createShelf(w = 2.4, h = 2.0, d = 0.6, color = C.rack, binColors = [0x2a5d9f, 0xf2c230, 0xef4444]) {
  const g = new THREE.Group();
  const frameM = mat(color, { metalness: 0.3, roughness: 0.5 });
  for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) add(g, box(0.05, h, 0.05, frameM), x, h / 2, z);
  const levels = 4;
  for (let l = 0; l < levels; l++) {
    const yy = 0.15 + l * (h - 0.2) / (levels - 1);
    add(g, box(w, 0.03, d, mat(0x9aa1a9, { metalness: 0.4 }), false), 0, yy, 0);
    const n = binColors.length ? Math.floor(w / 0.42) : 0;
    for (let i = 0; i < n; i++) {
      if (Math.random() < 0.15) continue;
      add(g, box(0.36, 0.22, d * 0.8, mat(binColors[(i + l) % binColors.length], { roughness: 0.6 })), -w / 2 + 0.24 + i * 0.42, yy + 0.13, 0);
    }
  }
  return g;
}

export function createAGV(color = 0xff000f) {
  const g = new THREE.Group();
  const s = new THREE.Group();
  add(s, box(1.6, 0.32, 1.0, mat(0x2b2f35, { metalness: 0.3 })), 0, 0.22, 0);
  add(s, box(1.62, 0.07, 1.02, mat(color)), 0, 0.33, 0);
  add(s, cyl(0.08, 0.08, 0.1, 12, mat(0x111111)), 0.7, 0.43, 0);
  add(s, box(1.3, 0.05, 0.85, mat(0x5f6873)), 0, 0.4, 0);
  g.add(mergeColored(s));
  add(g, box(0.03, 0.06, 0.7, glow(0x2ee6d2), false), 0.81, 0.24, 0);
  add(g, box(0.03, 0.06, 0.7, glow(0xff4d4d), false), -0.81, 0.24, 0);
  const c = new THREE.Group();
  for (let i = 0; i < 2; i++) for (let k = 0; k < 2; k++) add(c, box(0.55, 0.35, 0.38, mat([0x2a5d9f, C.rack][(i + k) % 2], { roughness: 0.6 })), -0.3 + i * 0.6, 0.6, -0.2 + k * 0.4);
  const cargo = mergeColored(c);
  g.add(cargo);
  return { group: g, cargo };
}

export function createForklift(color = 0xff000f) {
  const g = new THREE.Group();
  const s = new THREE.Group();
  const body = mat(color === 0xff000f ? 0xf28c28 : color, { roughness: 0.45 });
  const dark = mat(0x1d1f22);
  add(s, box(1.7, 0.9, 1.1, body), -0.2, 0.75, 0);
  add(s, box(0.6, 0.7, 1.0, dark), -0.85, 0.8, 0); // counterweight
  for (const sx of [-0.55, 0.45]) for (const sz of [-0.48, 0.48]) add(s, box(0.05, 1.3, 0.05, dark), sx, 1.85, sz);
  add(s, box(1.1, 0.06, 1.05, dark), -0.05, 2.5, 0);
  add(s, box(0.4, 0.5, 0.5, mat(0x111111)), -0.2, 1.4, 0);
  for (const x of [-0.65, 0.5]) for (const z of [-0.5, 0.5]) {
    const w = add(s, cyl(0.28, 0.28, 0.22, 14, dark), x, 0.28, z);
    w.rotation.x = Math.PI / 2;
  }
  for (const z of [-0.36, 0.36]) add(s, box(0.08, 2.6, 0.12, dark), 0.75, 1.35, z);
  g.add(mergeColored(s));
  add(g, cyl(0.07, 0.07, 0.1, 10, glow(0x3b82f6), false), -0.6, 2.58, 0); // blue spot
  const carriage = new THREE.Group();
  const cs = new THREE.Group();
  add(cs, box(0.08, 0.7, 1.0, dark), 0.82, 0.35, 0);
  for (const z of [-0.3, 0.3]) add(cs, box(1.1, 0.05, 0.12, mat(0x8d949c, { metalness: 0.7 })), 1.4, 0.03, z);
  carriage.add(mergeColored(cs));
  g.add(carriage);
  const driver = createPerson({ vest: 0xf2e21a });
  driver.group.position.set(-0.25, 0.55, 0);
  driver.group.scale.setScalar(0.95);
  posePerson(driver, 'work', 0);
  driver.legs.forEach((l) => { l.rotation.z = 1.4; });
  g.add(driver.group);
  return { group: g, carriage, forkTip: 1.4 };
}

export function createTugger() {
  const g = new THREE.Group();
  const s = new THREE.Group();
  add(s, box(1.5, 0.7, 0.95, mat(0xf2c230, { roughness: 0.45 })), 0, 0.55, 0);
  add(s, box(0.5, 1.1, 0.9, mat(0x2b2f35)), -0.45, 1.0, 0);
  for (const x of [-0.5, 0.5]) for (const z of [-0.45, 0.45]) add(s, cyl(0.22, 0.22, 0.18, 12, mat(0x1d1f22)), x, 0.22, z).rotation.x = Math.PI / 2;
  g.add(mergeColored(s));
  const d = createPerson({ vest: 0xf2e21a });
  d.group.position.set(-0.2, 0.4, 0);
  d.legs.forEach((l) => { l.rotation.z = 1.4; });
  g.add(d.group);
  return g;
}

export function createCart() {
  const g = new THREE.Group();
  const s = new THREE.Group();
  add(s, box(1.6, 0.08, 1.3, mat(0x5f6873, { metalness: 0.4 })), 0, 0.42, 0);
  for (const x of [-0.6, 0.6]) for (const z of [-0.5, 0.5]) add(s, cyl(0.14, 0.14, 0.1, 10, mat(0x1d1f22)), x, 0.15, z).rotation.x = Math.PI / 2;
  add(s, box(0.6, 0.04, 0.04, mat(0x1d1f22)), 1.0, 0.3, 0);
  g.add(mergeColored(s));
  return g;
}

export function createTruck() {
  const g = new THREE.Group();
  const trailer = new THREE.Group();
  const ts = new THREE.Group();
  add(ts, box(13.6, 2.8, 2.55, mat(0xf2f3f4, { roughness: 0.5 })), 0, 2.65, 0);
  add(ts, box(13.6, 0.35, 0.03, mat(C.abb)), 0, 1.6, 1.29);
  add(ts, box(13.6, 0.35, 0.03, mat(C.abb)), 0, 1.6, -1.29);
  for (const x of [4.8, 5.9]) for (const z of [-1.0, 1.0]) add(ts, cyl(0.5, 0.5, 0.35, 16, mat(0x151719)), x, 0.5, z).rotation.x = Math.PI / 2;
  trailer.add(mergeColored(ts));
  g.add(trailer);
  const cab = new THREE.Group();
  add(cab, box(2.2, 2.5, 2.5, mat(0xe6e8ea, { roughness: 0.35, metalness: 0.3 })), 0, 2.15, 0);
  add(cab, box(0.05, 0.9, 2.2, mat(0x0c1a26, { roughness: 0.05, metalness: 0.9 })), -1.12, 2.75, 0);
  add(cab, box(1.4, 0.9, 2.4, mat(0xe6e8ea, { roughness: 0.35, metalness: 0.3 })), -1.6, 1.3, 0);
  for (const x of [-1.6, 0.9]) for (const z of [-1.05, 1.05]) add(cab, cyl(0.5, 0.5, 0.35, 16, mat(0x151719)), x, 0.5, z).rotation.x = Math.PI / 2;
  const cabM = mergeColored(cab);
  cabM.position.x = -8.4;
  g.add(cabM);
  // Trailer rear is +x (backs into the dock)
  return g;
}

export function createCar(color) {
  const g = new THREE.Group();
  const body = mat(color, { roughness: 0.3, metalness: 0.5 });
  add(g, box(4.4, 0.7, 1.8, body), 0, 0.6, 0);
  add(g, box(2.4, 0.6, 1.6, body), -0.2, 1.2, 0);
  add(g, box(2.3, 0.5, 1.62, mat(0x0c1a26, { roughness: 0.05, metalness: 0.9 })), -0.2, 1.2, 0);
  for (const x of [-1.4, 1.4]) for (const z of [-0.85, 0.85]) add(g, cyl(0.33, 0.33, 0.2, 12, mat(0x151719)), x, 0.33, z).rotation.x = Math.PI / 2;
  return g;
}

// Merge every mesh under `root` into one mesh per material (for static decor).
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const byMat = new Map();
  const keep = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || o.userData.keep || o.material.transparent) {
      if (o.isMesh) keep.push(o);
      return;
    }
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    g.applyMatrix4(o.matrixWorld);
    const key = o.material;
    if (!byMat.has(key)) byMat.set(key, { geos: [], cast: false });
    const e = byMat.get(key);
    e.geos.push(g);
    e.cast ||= o.castShadow;
  });
  const out = new THREE.Group();
  for (const [m, e] of byMat) {
    const merged = mergeGeometries(e.geos);
    const ms = new THREE.Mesh(merged, m);
    ms.castShadow = e.cast;
    ms.receiveShadow = true;
    out.add(ms);
  }
  for (const k of keep) {
    k.updateMatrixWorld(true);
    k.matrixWorld.decompose(k.position, k.quaternion, k.scale);
    out.add(k);
  }
  return out;
}

export { at, add, xcyl, xtube, xtorus, workbench, guardFence, balancerTool, enclosure };
