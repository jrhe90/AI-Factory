// Procedural 3D models for the Megafactory simulation.
// Everything is built from primitive geometry so the project has no asset dependencies.
import * as THREE from 'three';

export const COLORS = {
  red: 0xe82127,
  white: 0xeef0f2,
  offWhite: 0xd9dce0,
  steel: 0x6b727b,
  dark: 0x24272c,
  darker: 0x16181b,
  yellow: 0xf2c230,
  copper: 0xc8763a,
  module: 0x2e3238,
  teal: 0x2ee6d2,
  blue: 0x2f8cff,
  green: 0x22c55e,
  amber: 0xf59e0b,
  fanuc: 0xf2c200, // robot yellow
  weldRed: 0xc8102e, // weld cells, fixtures, welders
  hvOrange: 0xf2801f, // HV busbars and module covers
  conveyorBlue: 0x1f6fd1,
};

// Pack dimensions (metres) – roughly a Megapack-class enclosure.
export const PACK = {
  L: 8.8, // length
  W: 1.65, // depth
  BASE: 0.25, // skid height
  BODY: 2.0, // module bay height
  BAYS: 8,
  LEVELS: 3,
};
PACK.FRAME_TOP = PACK.BASE + PACK.BODY + 0.05;
PACK.ROOF_H = 0.36;
PACK.HEIGHT = PACK.FRAME_TOP + PACK.ROOF_H + 0.06;

// ---------- caches so hundreds of packs share geometry / materials ----------
const geoCache = new Map();
const matCache = new Map();

function cached(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}

export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.15, ...opts }));
  }
  return matCache.get(key);
}

export function glow(color) {
  const key = 'glow' + color;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  return matCache.get(key);
}

export function box(w, h, d, material, shadows = true) {
  const m = new THREE.Mesh(cached(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d)), material);
  m.castShadow = shadows;
  m.receiveShadow = shadows;
  return m;
}

export function cyl(rt, rb, h, seg, material, shadows = true) {
  const m = new THREE.Mesh(
    cached(`c${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)),
    material,
  );
  m.castShadow = shadows;
  m.receiveShadow = shadows;
  return m;
}

export function sphere(r, material) {
  const m = new THREE.Mesh(cached(`s${r}`, () => new THREE.SphereGeometry(r, 16, 12)), material);
  m.castShadow = true;
  return m;
}

// ---------- thermal roof (shared by packs and the roof hoist carrier) ----------
// Two rows of fans on top and a louvre band down each long side, as on Megapack 2 XL.
export function createRoof() {
  const g = new THREE.Group();
  const shell = box(PACK.L, PACK.ROOF_H, PACK.W, mat(COLORS.white, { roughness: 0.45 }));
  shell.position.y = PACK.ROOF_H / 2;
  g.add(shell);
  const fanMat = mat(COLORS.dark);
  const hubMat = mat(COLORS.steel, { metalness: 0.7, roughness: 0.3 });
  for (let i = 0; i < 5; i++) {
    for (const z of [-0.38, 0.38]) {
      const x = -PACK.L / 2 + 1.4 + i * ((PACK.L - 2.8) / 4);
      const fan = cyl(0.3, 0.3, 0.05, 20, fanMat);
      fan.position.set(x, PACK.ROOF_H + 0.025, z);
      g.add(fan);
      const hub = cyl(0.08, 0.08, 0.07, 10, hubMat);
      hub.position.set(x, PACK.ROOF_H + 0.04, z);
      g.add(hub);
    }
  }
  const louvre = mat(0x3a3e44, { roughness: 0.7 });
  for (const sz of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const l = box(PACK.L / 6 - 0.12, 0.22, 0.02, louvre, false);
      l.position.set(-PACK.L / 2 + (PACK.L / 6) * (i + 0.5), PACK.ROOF_H / 2, sz * (PACK.W / 2 + 0.005));
      g.add(l);
    }
  }
  return g;
}

// ---------- the product: a utility-scale battery pack ----------
// Inside: a central HV spine (orange busbars) with half-depth modules slid in from both sides.
const MOD_LEVELS = PACK.LEVELS;
export const MODULES_PER_PACK = PACK.BAYS * MOD_LEVELS * 2;
const modBodyGeo = new THREE.BoxGeometry(1, 1, 1);
const modBodyMat = new THREE.MeshStandardMaterial({ color: 0x2b2f35, metalness: 0.5, roughness: 0.45 });
const modFrontMat = new THREE.MeshStandardMaterial({ color: COLORS.hvOrange, roughness: 0.5, metalness: 0.1 });
const modLedMat = new THREE.MeshBasicMaterial({ color: 0x4bff7a, toneMapped: false });
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export function createMegapack() {
  const group = new THREE.Group();
  const { L, W, BASE, BODY, BAYS } = PACK;
  const bayW = L / BAYS;

  const skid = box(L + 0.2, BASE, W + 0.12, mat(COLORS.darker, { roughness: 0.8 }));
  skid.position.y = BASE / 2;
  group.add(skid);

  // Powder-coated frame (built on the Body-in-White line, painted in the Powder Coat shop)
  const frame = createFrame(FRAME_MATS.coated);
  frame.position.y = BASE;
  group.add(frame);

  // HV spine: vertical rails at each bay boundary + orange busbars on both faces
  const hv = [];
  const railMat = mat(0x8d949c, { metalness: 0.6, roughness: 0.4 });
  for (let i = 0; i <= BAYS; i++) {
    const r = box(0.08, BODY - 0.1, 0.1, railMat, false);
    r.position.set(-L / 2 + i * bayW, BASE + BODY / 2, 0);
    r.visible = false;
    hv.push(r);
    group.add(r);
  }
  const barMat = mat(COLORS.hvOrange, { roughness: 0.5 });
  for (let level = 0; level < MOD_LEVELS; level++) {
    for (const sz of [-1, 1]) {
      const b = box(L - 0.3, 0.07, 0.03, barMat, false);
      b.position.set(0, BASE + 0.5 + level * 0.65, sz * 0.07);
      b.visible = false;
      hv.push(b);
      group.add(b);
    }
  }

  // Modules: instanced bodies, orange covers and status LEDs; .count reveals them.
  const depth = W / 2 - 0.2;
  const slots = [];
  for (let level = 0; level < MOD_LEVELS; level++) {
    for (let bay = 0; bay < BAYS; bay++) {
      for (const side of [-1, 1]) {
        slots.push({ x: -L / 2 + bayW * (bay + 0.5), y: BASE + 0.36 + level * 0.65, side });
      }
    }
  }
  const body = new THREE.InstancedMesh(modBodyGeo, modBodyMat, slots.length);
  const front = new THREE.InstancedMesh(modBodyGeo, modFrontMat, slots.length);
  const led = new THREE.InstancedMesh(modBodyGeo, modLedMat, slots.length);
  for (const m of [body, front, led]) {
    m.count = 0;
    m.frustumCulled = false;
    group.add(m);
  }
  body.castShadow = front.castShadow = true;
  const modules = {
    body, front, led, total: slots.length,
    // Place module i, slid out from its final position by `out` (0 = seated)
    place(i, out = 0) {
      const s = slots[i];
      const zc = s.side * (0.12 + depth / 2 + out);
      _q.identity();
      _m4.compose(_p.set(s.x, s.y, zc), _q, _s.set(bayW - 0.14, 0.56, depth));
      body.setMatrixAt(i, _m4);
      _m4.compose(_p.set(s.x, s.y, zc + s.side * (depth / 2 + 0.01)), _q, _s.set(bayW - 0.18, 0.5, 0.02));
      front.setMatrixAt(i, _m4);
      _m4.compose(_p.set(s.x - bayW / 2 + 0.2, s.y + 0.18, zc + s.side * (depth / 2 + 0.025)), _q, _s.set(0.06, 0.06, 0.01));
      led.setMatrixAt(i, _m4);
      body.instanceMatrix.needsUpdate = front.instanceMatrix.needsUpdate = led.instanceMatrix.needsUpdate = true;
    },
    setCount(n) {
      body.count = front.count = led.count = n;
    },
  };
  slots.forEach((_, i) => modules.place(i));

  // Thermal roof
  const roof = createRoof();
  roof.position.y = PACK.FRAME_TOP;
  roof.visible = false;
  group.add(roof);

  // Doors hang on hinges so they can swing shut as they are fitted; end caps just appear.
  const doors = [];
  const doorMat = mat(COLORS.white, { roughness: 0.5 });
  const handleMat = mat(COLORS.dark);
  for (let bay = 0; bay < BAYS; bay++) {
    for (const sz of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.position.set(-L / 2 + bayW * bay + 0.025, BASE + BODY / 2, sz * (W / 2 + 0.03));
      const d = box(bayW - 0.05, BODY - 0.04, 0.05, doorMat);
      d.position.x = (bayW - 0.05) / 2;
      hinge.add(d);
      const h = box(0.04, 0.32, 0.05, handleMat, false);
      h.position.set(bayW - 0.2, 0, sz * 0.04);
      hinge.add(h);
      hinge.visible = false;
      hinge.userData.side = sz;
      doors.push(hinge);
      group.add(hinge);
    }
  }
  for (const sx of [-1, 1]) {
    const cap = box(0.05, BODY - 0.04, W, doorMat);
    cap.position.set(sx * (L / 2 + 0.03), BASE + BODY / 2, 0);
    cap.visible = false;
    cap.userData.side = 0;
    doors.push(cap);
    group.add(cap);
  }

  // Indicator lights on the +x end cap
  const coolantLight = box(0.05, 0.12, 0.22, glow(COLORS.blue), false);
  coolantLight.position.set(L / 2 + 0.07, BASE + BODY - 0.2, -0.35);
  coolantLight.visible = false;
  group.add(coolantLight);

  const statusMat = new THREE.MeshBasicMaterial({ color: COLORS.amber, toneMapped: false });
  const statusLight = box(0.05, 0.12, 0.22, statusMat, false);
  statusLight.position.set(L / 2 + 0.07, BASE + BODY - 0.2, 0.35);
  statusLight.visible = false;
  group.add(statusLight);

  return { group, frame, hv, modules, roof, doors, coolantLight, statusLight };
}

// Static stand-in for finished units staged in the outdoor yard
export function createYard(count, cols, origin) {
  const g = new THREE.Group();
  const H = PACK.HEIGHT;
  const bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(PACK.W, H, PACK.L), mat(COLORS.white, { roughness: 0.45 }), count);
  const fans = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 16), mat(COLORS.dark), count * 10);
  bodies.castShadow = bodies.receiveShadow = true;
  let f = 0;
  for (let i = 0; i < count; i++) {
    const x = origin[0] + (i % cols) * 4.2;
    const z = origin[1] + Math.floor(i / cols) * 12;
    bodies.setMatrixAt(i, _m4.makeTranslation(x, H / 2, z));
    for (let k = 0; k < 5; k++) {
      for (const dx of [-0.38, 0.38]) fans.setMatrixAt(f++, _m4.makeTranslation(x + dx, H + 0.02, z - 3 + k * 1.5));
    }
  }
  g.add(bodies, fans);
  return g;
}

// ---------- enclosure frame (Body in White) ----------
export const FRAME_H = PACK.BODY + 0.05;
export const FRAME_MATS = {
  bare: mat(0x8d949c, { metalness: 0.8, roughness: 0.32 }),
  pretreat: mat(0x5b636c, { metalness: 0.35, roughness: 0.75 }),
  powder: mat(0xf2f2ef, { roughness: 1, metalness: 0 }),
  curing: mat(0xf3e2d2, { roughness: 0.8, emissive: 0xff5a14, emissiveIntensity: 0.45 }),
  coated: mat(0xdfe2e6, { roughness: 0.55, metalness: 0.1 }),
};

// Frame parts are grouped so the BIW line can weld them on in stages.
export function createFrame(material = FRAME_MATS.bare) {
  const group = new THREE.Group();
  const { L, W, BODY, BAYS } = PACK;
  const bayW = L / BAYS;
  const base = [];
  const posts = [];
  const top = [];
  for (const sz of [-1, 1]) {
    const r = box(L, 0.12, 0.1, material);
    r.position.set(0, 0.06, sz * (W / 2 - 0.05));
    base.push(r);
  }
  for (const sx of [-1, 1]) {
    const c = box(0.1, 0.12, W - 0.2, material);
    c.position.set(sx * (L / 2 - 0.05), 0.06, 0);
    base.push(c);
  }
  for (let i = 0; i <= BAYS; i++) {
    const x = THREE.MathUtils.clamp(-L / 2 + i * bayW, -L / 2 + 0.05, L / 2 - 0.05);
    for (const sz of [-1, 1]) {
      const p = box(0.1, BODY, 0.1, material);
      p.position.set(x, BODY / 2, sz * (W / 2 - 0.05));
      posts.push(p);
    }
  }
  for (const sz of [-1, 1]) {
    const r = box(L, 0.1, 0.1, material);
    r.position.set(0, BODY, sz * (W / 2 - 0.05));
    top.push(r);
  }
  for (const sx of [-1, 1]) {
    const c = box(0.1, 0.1, W - 0.2, material);
    c.position.set(sx * (L / 2 - 0.05), BODY, 0);
    top.push(c);
  }
  const meshes = [...base, ...posts, ...top];
  meshes.forEach((m) => group.add(m));
  group.userData = { base, posts, top, meshes };
  return group;
}

export function setFrameMaterial(frame, material) {
  for (const m of frame.userData.meshes) m.material = material;
}

// ---------- power & free carrier for the overhead paint conveyor ----------
export const HANG = 0.6;
// Blue trolley on the rail; the spreader + chains sit in `drop`, which lowers on a cable to
// pick a frame off the floor.
export function createCarrier() {
  const group = new THREE.Group();
  const trolley = box(1.4, 0.32, 0.5, mat(COLORS.conveyorBlue, { metalness: 0.4, roughness: 0.4 }));
  trolley.position.y = 0.05;
  group.add(trolley);
  const drop = new THREE.Group();
  group.add(drop);
  const beam = box(PACK.L * 0.8, 0.16, 0.3, mat(0x7c848d, { metalness: 0.6, roughness: 0.4 }));
  beam.position.y = -0.1;
  drop.add(beam);
  for (const x of [-3.2, 3.2]) {
    const chain = cyl(0.03, 0.03, HANG - 0.1, 5, mat(0x222222, { metalness: 0.8 }), false);
    chain.position.set(x, -0.1 - (HANG - 0.1) / 2, 0);
    drop.add(chain);
  }
  const cable = cyl(0.04, 0.04, 1, 6, mat(0x111111), false);
  cable.visible = false;
  group.add(cable);
  return { group, drop, cable };
}

// ---------- battery module tray (output of the module line) ----------
// 12 modules per tray (4 × 3), each with 12 cells, a weld plate, potting, a lid and a BMS board.
export const TRAY = { L: 2.4, W: 1.6, MODULES: 12, CELLS_PER: 12 };
const blockCentres = [];
for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) blockCentres.push([-0.87 + i * 0.58, -0.5 + j * 0.5]);
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const cellGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.32, 10);
const trayMats = {
  cell: new THREE.MeshStandardMaterial({ color: 0x1f5e57, roughness: 0.45, metalness: 0.3 }),
  weld: new THREE.MeshStandardMaterial({ color: COLORS.copper, metalness: 0.85, roughness: 0.3 }),
  pot: new THREE.MeshStandardMaterial({ color: 0x6b5a3a, roughness: 0.9 }),
  lid: new THREE.MeshStandardMaterial({ color: 0x2b2f35, metalness: 0.4, roughness: 0.5 }),
  pcb: new THREE.MeshStandardMaterial({ color: 0x1f8a4c, roughness: 0.6 }),
};

function instancedLayer(geo, material, transforms) {
  const m = new THREE.InstancedMesh(geo, material, transforms.length);
  transforms.forEach(([x, y, z, sx, sy, sz], i) => {
    _m4.compose(_p.set(x, y, z), _q.identity(), _s.set(sx, sy, sz));
    m.setMatrixAt(i, _m4);
  });
  m.count = 0;
  m.frustumCulled = false;
  m.castShadow = true;
  return m;
}

export function createModuleTray() {
  const group = new THREE.Group();
  const plate = box(TRAY.L, 0.08, TRAY.W, mat(COLORS.steel, { metalness: 0.6, roughness: 0.4 }));
  plate.position.y = 0.04;
  group.add(plate);

  const cellT = [];
  for (const [bx, bz] of blockCentres) {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) cellT.push([bx - 0.18 + c * 0.12, 0.24, bz - 0.13 + r * 0.13, 1, 1, 1]);
  }
  const cells = instancedLayer(cellGeo, trayMats.cell, cellT);
  const welds = instancedLayer(unitBox, trayMats.weld, blockCentres.map(([x, z]) => [x, 0.41, z, 0.5, 0.02, 0.42]));
  const potting = instancedLayer(unitBox, trayMats.pot, blockCentres.map(([x, z]) => [x, 0.44, z, 0.52, 0.05, 0.44]));
  const lids = instancedLayer(unitBox, trayMats.lid, blockCentres.map(([x, z]) => [x, 0.3, z, 0.54, 0.44, 0.46]));
  const pcbs = instancedLayer(unitBox, trayMats.pcb, blockCentres.map(([x, z]) => [x, 0.53, z, 0.36, 0.02, 0.28]));
  group.add(cells, welds, potting, lids, pcbs);

  const statusLight = box(0.04, 0.08, 0.2, new THREE.MeshBasicMaterial({ color: COLORS.amber, toneMapped: false }), false);
  statusLight.position.set(TRAY.L / 2 + 0.02, 0.06, 0);
  statusLight.visible = false;
  group.add(statusLight);
  return { group, cells, welds, potting, lids, pcbs, statusLight };
}

// ---------- 6-axis-style industrial robot ----------
export function createRobot(color = COLORS.fanuc, scale = 1, toolColor = COLORS.dark) {
  const root = new THREE.Group();
  root.scale.setScalar(scale);
  const body = mat(color, { roughness: 0.4, metalness: 0.2 });
  const dark = mat(0x3a3d42, { roughness: 0.5, metalness: 0.4 });

  const base = cyl(0.5, 0.6, 0.5, 24, dark);
  base.position.y = 0.25;
  root.add(base);

  const turret = new THREE.Group();
  turret.position.y = 0.5;
  root.add(turret);
  const turretMesh = cyl(0.38, 0.42, 0.45, 20, body);
  turretMesh.position.y = 0.22;
  turret.add(turretMesh);
  const motor = cyl(0.16, 0.16, 0.22, 12, mat(COLORS.weldRed));
  motor.rotation.z = Math.PI / 2;
  motor.position.set(0.42, 0.5, 0);
  turret.add(motor);

  const shoulder = new THREE.Group();
  shoulder.position.y = 0.5;
  turret.add(shoulder);
  shoulder.add(sphere(0.3, body));
  const upper = box(0.3, 1.8, 0.3, body);
  upper.position.y = 0.9;
  shoulder.add(upper);
  // Dress pack (cable bundle) along the upper arm
  const dress = cyl(0.06, 0.06, 1.6, 6, mat(0x1b1d20), false);
  dress.position.set(0, 0.95, -0.22);
  shoulder.add(dress);

  const elbow = new THREE.Group();
  elbow.position.y = 1.8;
  shoulder.add(elbow);
  elbow.add(sphere(0.22, body));
  const fore = box(0.22, 1.5, 0.22, body);
  fore.position.y = 0.75;
  elbow.add(fore);

  const wrist = new THREE.Group();
  wrist.position.y = 1.5;
  elbow.add(wrist);
  wrist.add(sphere(0.14, dark));
  const tool = box(0.2, 0.32, 0.2, mat(toolColor));
  tool.position.y = 0.18;
  wrist.add(tool);
  for (const s of [-1, 1]) {
    const finger = box(0.05, 0.22, 0.12, mat(COLORS.steel, { metalness: 0.8, roughness: 0.3 }));
    finger.position.set(s * 0.07, 0.42, 0);
    wrist.add(finger);
  }
  const tip = new THREE.Object3D();
  tip.position.y = 0.55;
  wrist.add(tip);

  return { root, turret, shoulder, elbow, wrist, tip };
}

// ---------- lift-assist manipulator (operator-guided arm on a column) ----------
export function createLiftAssist() {
  const root = new THREE.Group();
  const grey = mat(0x9aa1a9, { metalness: 0.6, roughness: 0.4 });
  const base = box(0.8, 0.12, 0.8, mat(COLORS.dark));
  base.position.y = 0.06;
  root.add(base);
  const column = cyl(0.12, 0.12, 3.2, 12, grey);
  column.position.y = 1.6;
  root.add(column);
  const arm1 = new THREE.Group();
  arm1.position.y = 3.1;
  root.add(arm1);
  const l1 = box(1.5, 0.14, 0.14, grey);
  l1.position.x = 0.75;
  arm1.add(l1);
  const arm2 = new THREE.Group();
  arm2.position.x = 1.5;
  arm1.add(arm2);
  const l2 = box(1.3, 0.12, 0.12, grey);
  l2.position.x = 0.65;
  arm2.add(l2);
  const drop = cyl(0.05, 0.05, 1.4, 8, grey);
  drop.position.set(1.3, -0.7, 0);
  arm2.add(drop);
  const tool = box(0.5, 0.4, 0.35, mat(COLORS.hvOrange));
  tool.position.set(1.3, -1.55, 0);
  arm2.add(tool);
  return { root, arm1, arm2 };
}

// ---------- flatbed truck ----------
export const TRUCK_BED = 1.3;
export function createTruck() {
  const group = new THREE.Group();
  const trailerL = 11;
  const bed = box(trailerL, 0.3, 2.5, mat(COLORS.dark, { metalness: 0.4 }));
  bed.position.y = TRUCK_BED - 0.15;
  group.add(bed);
  const beam = box(trailerL, 0.4, 0.9, mat(COLORS.darker));
  beam.position.y = TRUCK_BED - 0.5;
  group.add(beam);

  const wheelMat = mat(0x111111, { roughness: 0.9 });
  const wheel = (x, z) => {
    const w = cyl(0.5, 0.5, 0.35, 18, wheelMat);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.5, z);
    group.add(w);
  };
  for (const x of [-4.2, -3.1, 4.6 + 1.6, 4.6 + 3.5]) for (const z of [-1.05, 1.05]) wheel(x, z);

  const cab = new THREE.Group();
  cab.position.x = trailerL / 2 + 2.0;
  group.add(cab);
  const cabBody = box(2.6, 2.4, 2.5, mat(COLORS.white, { roughness: 0.35, metalness: 0.3 }));
  cabBody.position.set(0.4, 2.2, 0);
  cab.add(cabBody);
  const hood = box(1.2, 1.2, 2.4, mat(COLORS.white, { roughness: 0.35, metalness: 0.3 }));
  hood.position.set(2.1, 1.6, 0);
  cab.add(hood);
  const glass = box(0.05, 0.9, 2.2, mat(0x0c1a26, { roughness: 0.05, metalness: 0.9 }), false);
  glass.position.set(1.72, 2.85, 0);
  cab.add(glass);
  const stripe = box(2.62, 0.18, 2.52, mat(COLORS.red), false);
  stripe.position.set(0.4, 1.55, 0);
  cab.add(stripe);
  const chassis = box(4.4, 0.4, 1.0, mat(COLORS.darker));
  chassis.position.set(0.6, 0.85, 0);
  cab.add(chassis);

  return { group, length: trailerL };
}

// ---------- AGV with module crates ----------
export function createAGV() {
  const group = new THREE.Group();
  const body = box(1.8, 0.35, 1.2, mat(COLORS.dark, { metalness: 0.3 }));
  body.position.y = 0.25;
  group.add(body);
  const stripe = box(1.82, 0.08, 1.22, mat(COLORS.yellow), false);
  stripe.position.y = 0.3;
  group.add(stripe);
  const lidar = cyl(0.1, 0.1, 0.12, 12, mat(COLORS.darker));
  lidar.position.set(0.75, 0.48, 0);
  group.add(lidar);
  const lamp = box(0.04, 0.06, 0.6, glow(COLORS.teal), false);
  lamp.position.set(0.91, 0.25, 0);
  group.add(lamp);

  const cargo = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const crate = box(1.5, 0.45, 0.95, mat(COLORS.module, { metalness: 0.5, roughness: 0.45 }));
    crate.position.y = 0.66 + i * 0.48;
    cargo.add(crate);
    const led = box(0.4, 0.05, 0.02, glow(COLORS.teal), false);
    led.position.set(-0.3, 0.66 + i * 0.48 + 0.12, 0.49);
    cargo.add(led);
  }
  group.add(cargo);
  return { group, cargo };
}

// ---------- factory worker ----------
export function createWorker(vestColor = 0xff7a1a) {
  const group = new THREE.Group();
  const legs = box(0.34, 0.8, 0.22, mat(0x2b3440));
  legs.position.y = 0.4;
  group.add(legs);
  const torso = box(0.46, 0.62, 0.28, mat(vestColor, { roughness: 0.7 }));
  torso.position.y = 1.12;
  group.add(torso);
  const head = sphere(0.14, mat(0xc99a78, { roughness: 0.8 }));
  head.position.y = 1.58;
  group.add(head);
  const helmet = sphere(0.155, mat(COLORS.white, { roughness: 0.3 }));
  helmet.scale.set(1, 0.65, 1);
  helmet.position.y = 1.65;
  group.add(helmet);
  return group;
}

// ---------- canvas textures ----------
export function makeSignTexture(num, title, line = 'STATION') {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#16181b';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#e82127';
  g.fillRect(0, 0, 220, c.height);
  g.fillStyle = '#ffffff';
  g.font = 'bold 140px Inter, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(num).padStart(2, '0'), 110, 136);
  g.textAlign = 'left';
  g.font = '600 76px Inter, system-ui, sans-serif';
  g.fillText(title, 260, 100, 740);
  g.fillStyle = '#9aa3ad';
  g.font = '500 44px Inter, system-ui, sans-serif';
  g.fillText(line, 260, 185);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function makeWallTexture() {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#c9cdd2';
  g.fillRect(0, 0, c.width, c.height);
  for (let x = 0; x < c.width; x += 32) {
    g.fillStyle = x % 64 ? '#c2c6cb' : '#cfd3d8';
    g.fillRect(x, 0, 32, c.height);
  }
  g.fillStyle = '#1b1d21';
  g.font = '800 150px Inter, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('M E G A F A C T O R Y', c.width / 2, c.height / 2 + 6);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeFloorTexture() {
  // Light, polished epoxy-sealed concrete with saw-cut joints
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#aab0b7';
  g.fillRect(0, 0, 512, 512);
  const img = g.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 7;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(80,86,94,0.35)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// Insulated-metal-panel wall: white with vertical ribs
export function makePanelTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#e9ecef';
  g.fillRect(0, 0, 256, 64);
  for (let x = 0; x < 256; x += 32) {
    g.fillStyle = '#d5d9de';
    g.fillRect(x, 0, 4, 64);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Column grid label (e.g. "G13")
export function makeLabelTexture(text) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f5f6';
  g.fillRect(0, 0, 128, 256);
  g.fillStyle = '#2a2d31';
  g.font = 'bold 84px Inter, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text[0], 64, 72);
  g.fillText(text.slice(1), 64, 180);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- finished pack as a single textured box (storage lot, trucks) ----------
// Cheap stand-in for a completed unit: one mesh, door seams and fans painted on.
let finishedMats = null;
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function finishedMaterials() {
  if (finishedMats) return finishedMats;
  const H = PACK.HEIGHT;
  const side = canvasTex(1024, 320, (g, w, h) => {
    g.fillStyle = '#f1f2f3';
    g.fillRect(0, 0, w, h);
    const skid = (PACK.BASE / H) * h;
    const band = ((PACK.ROOF_H + 0.06) / H) * h;
    g.fillStyle = '#26292e';
    g.fillRect(0, h - skid, w, skid);
    g.fillStyle = '#4a4f56';
    for (let i = 0; i < 6; i++) g.fillRect(i * (w / 6) + 10, 8, w / 6 - 20, band - 16);
    g.strokeStyle = '#c3c7cc';
    g.lineWidth = 3;
    for (let i = 1; i < 8; i++) {
      g.beginPath();
      g.moveTo((i * w) / 8, band);
      g.lineTo((i * w) / 8, h - skid);
      g.stroke();
    }
    g.fillStyle = '#2a2d31';
    for (let i = 0; i < 8; i++) g.fillRect(((i + 1) * w) / 8 - 22, h * 0.48, 8, 30);
  });
  const top = canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = '#eceeef';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#30343a';
    for (let i = 0; i < 5; i++) {
      for (const y of [0.3, 0.7]) {
        g.beginPath();
        g.arc(w * (0.16 + i * 0.17), h * y, h * 0.17, 0, Math.PI * 2);
        g.fill();
      }
    }
  });
  const end = mat(0xeef0f2, { roughness: 0.5 });
  finishedMats = [
    end, end,
    new THREE.MeshStandardMaterial({ map: top, roughness: 0.5 }),
    mat(COLORS.darker),
    new THREE.MeshStandardMaterial({ map: side, roughness: 0.5 }),
    new THREE.MeshStandardMaterial({ map: side, roughness: 0.5 }),
  ];
  return finishedMats;
}
export function createFinishedPack() {
  const group = new THREE.Group();
  const m = new THREE.Mesh(
    cached('finished', () => new THREE.BoxGeometry(PACK.L + 0.1, PACK.HEIGHT, PACK.W + 0.1)),
    finishedMaterials(),
  );
  m.position.y = PACK.HEIGHT / 2;
  m.castShadow = m.receiveShadow = true;
  group.add(m);
  return group;
}

// ---------- straddle carrier (red portal-frame carrier with 4 wheels) ----------
// Two of these work as a tandem pair, one at each end of a Megapack.
export const CARRIER = { len: 3.2, halfW: 1.85, height: 4.8 };
export function createStraddleCarrier() {
  const group = new THREE.Group();
  const red = mat(0xd3202c, { roughness: 0.45, metalness: 0.25 });
  const dark = mat(0x1d1f22, { roughness: 0.6 });
  const { len, halfW, height } = CARRIER;
  for (const x of [-len / 2 + 0.2, len / 2 - 0.2]) {
    for (const z of [-halfW, halfW]) {
      const leg = box(0.32, height - 0.6, 0.32, red);
      leg.position.set(x, 0.9 + (height - 0.6) / 2 - 0.3, z);
      group.add(leg);
      const wheel = cyl(0.45, 0.45, 0.32, 16, dark);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, 0.45, z);
      group.add(wheel);
      const hub = cyl(0.18, 0.18, 0.34, 10, mat(COLORS.yellow));
      hub.rotation.x = Math.PI / 2;
      hub.position.set(x, 0.45, z);
      group.add(hub);
    }
  }
  for (const z of [-halfW, halfW]) {
    for (const y of [height - 0.2, height - 1.5, height - 2.6]) {
      const rail = box(len, y === height - 0.2 ? 0.34 : 0.16, 0.26, red);
      rail.position.set(0, y, z);
      group.add(rail);
    }
  }
  for (const x of [-len / 2 + 0.2, len / 2 - 0.2]) {
    const cross = box(0.3, 0.34, halfW * 2 + 0.3, red);
    cross.position.set(x, height - 0.2, 0);
    group.add(cross);
  }
  // Operator controls and engine pod on one leg
  const pod = box(0.8, 1.0, 0.6, dark);
  pod.position.set(len / 2 - 0.2, 1.2, halfW + 0.45);
  group.add(pod);
  // Lifting beams (move up and down to grip the pack)
  const lift = new THREE.Group();
  for (const z of [-1.08, 1.08]) {
    const beam = box(len - 0.5, 0.18, 0.18, mat(0xb4bac1, { metalness: 0.7, roughness: 0.35 }));
    beam.position.z = z;
    lift.add(beam);
  }
  group.add(lift);
  return { group, lift };
}

// ---------- 53 ft box trailer parked at a dock door ----------
export function createBoxTrailer() {
  const g = new THREE.Group();
  const body = box(2.6, 2.9, 15.6, mat(0xf2f3f4, { roughness: 0.5 }));
  body.position.set(0, 2.75, 0);
  g.add(body);
  const reefer = box(2.2, 1.6, 0.6, mat(0xd9dcdf));
  reefer.position.set(0, 3.4, -8.05);
  g.add(reefer);
  const dark = mat(0x151719, { roughness: 0.8 });
  for (const z of [6.2, 5.0]) {
    for (const x of [-1.05, 1.05]) {
      const w = cyl(0.5, 0.5, 0.4, 14, dark);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, 0.5, z);
      g.add(w);
    }
  }
  const leg = box(0.15, 1.1, 0.15, dark);
  leg.position.set(0.9, 0.6, -5.5);
  g.add(leg);
  const leg2 = leg.clone();
  leg2.position.x = -0.9;
  g.add(leg2);
  return g;
}

// ---------- small yard vehicles (decor) ----------
export function createForklift() {
  const g = new THREE.Group();
  const orange = mat(0xf07a1a, { roughness: 0.5 });
  const dark = mat(0x1d1f22);
  const body = box(2.2, 1.1, 1.2, orange);
  body.position.y = 0.85;
  g.add(body);
  const cage = box(1.0, 1.1, 1.1, dark);
  cage.position.set(-0.2, 1.95, 0);
  g.add(cage);
  const mast = box(0.15, 2.6, 1.0, dark);
  mast.position.set(1.2, 1.4, 0);
  g.add(mast);
  for (const z of [-0.3, 0.3]) {
    const fork = box(1.1, 0.06, 0.12, mat(0x8d949c, { metalness: 0.7 }));
    fork.position.set(1.8, 0.15, z);
    g.add(fork);
  }
  for (const x of [-0.7, 0.7]) {
    for (const z of [-0.6, 0.6]) {
      const w = cyl(0.3, 0.3, 0.25, 12, dark);
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.3, z);
      g.add(w);
    }
  }
  return g;
}
export function createScissorLift() {
  const g = new THREE.Group();
  const yellow = mat(0xf2b31a, { roughness: 0.5 });
  const base = box(2.3, 0.6, 1.1, yellow);
  base.position.y = 0.45;
  g.add(base);
  const scissor = box(2.0, 0.6, 0.9, mat(0x2b2f35));
  scissor.position.y = 1.05;
  g.add(scissor);
  const deck = box(2.4, 0.12, 1.2, yellow);
  deck.position.y = 1.4;
  g.add(deck);
  for (const z of [-0.55, 0.55]) {
    const rail = box(2.4, 0.06, 0.06, yellow);
    rail.position.set(0, 2.45, z);
    g.add(rail);
  }
  for (const x of [-1.15, 1.15]) {
    for (const z of [-0.55, 0.55]) {
      const p = box(0.06, 1.05, 0.06, yellow);
      p.position.set(x, 1.95, z);
      g.add(p);
    }
  }
  return g;
}
