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
};

// Pack dimensions (metres) – roughly a Megapack-class enclosure.
export const PACK = {
  L: 8.8, // length
  W: 1.65, // depth
  BASE: 0.25, // skid height
  BODY: 2.0, // module bay height
  BAYS: 6,
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
export function createRoof() {
  const g = new THREE.Group();
  const shell = box(PACK.L, PACK.ROOF_H, PACK.W, mat(COLORS.white, { roughness: 0.45 }));
  shell.position.y = PACK.ROOF_H / 2;
  g.add(shell);
  for (let i = 0; i < 4; i++) {
    const x = -PACK.L / 2 + (PACK.L * (i + 0.5)) / 4;
    const fan = cyl(0.36, 0.36, 0.06, 24, mat(COLORS.dark));
    fan.position.set(x, PACK.ROOF_H + 0.03, 0);
    g.add(fan);
    const hub = cyl(0.1, 0.1, 0.08, 12, mat(COLORS.steel, { metalness: 0.7, roughness: 0.3 }));
    hub.position.set(x, PACK.ROOF_H + 0.05, 0);
    g.add(hub);
  }
  // Inverter / power-conversion bulge at one end
  const inv = box(1.1, 0.12, PACK.W - 0.2, mat(COLORS.offWhite));
  inv.position.set(PACK.L / 2 - 0.7, PACK.ROOF_H + 0.06, 0);
  g.add(inv);
  return g;
}

// ---------- the product: a utility-scale battery pack ----------
export function createMegapack() {
  const group = new THREE.Group();
  const { L, W, BASE, BODY, BAYS, LEVELS } = PACK;
  const bayW = L / BAYS;

  const skid = box(L + 0.2, BASE, W + 0.12, mat(COLORS.darker, { roughness: 0.8 }));
  skid.position.y = BASE / 2;
  group.add(skid);

  // Powder-coated frame (built on the Body-in-White line, painted in the Powder Coat shop)
  const frame = createFrame(FRAME_MATS.coated);
  frame.position.y = BASE;
  group.add(frame);

  // Battery modules
  const modules = [];
  const modMat = mat(COLORS.module, { metalness: 0.5, roughness: 0.45 });
  for (let level = 0; level < LEVELS; level++) {
    for (let bay = 0; bay < BAYS; bay++) {
      const m = box(bayW - 0.16, 0.56, W - 0.26, modMat);
      m.position.set(-L / 2 + bayW * (bay + 0.5), BASE + 0.36 + level * 0.65, 0);
      for (const sz of [-1, 1]) {
        const led = box(0.32, 0.05, 0.02, glow(COLORS.teal), false);
        led.position.set(-0.3, 0.18, sz * ((W - 0.26) / 2 + 0.01));
        m.add(led);
      }
      m.visible = false;
      modules.push(m);
      group.add(m);
    }
  }

  // Copper busbars (one per level per side)
  const busbars = [];
  const copper = mat(COLORS.copper, { metalness: 0.85, roughness: 0.3 });
  for (let level = 0; level < LEVELS; level++) {
    for (const sz of [-1, 1]) {
      const b = box(L - 0.5, 0.06, 0.03, copper);
      b.position.set(0, BASE + 0.58 + level * 0.65, sz * ((W - 0.26) / 2 + 0.03));
      b.visible = false;
      busbars.push(b);
      group.add(b);
    }
  }

  // Thermal roof
  const roof = createRoof();
  roof.position.y = PACK.FRAME_TOP;
  roof.visible = false;
  group.add(roof);

  // Enclosure doors + end caps
  const doors = [];
  const doorMat = mat(COLORS.white, { roughness: 0.5 });
  const handleMat = mat(COLORS.dark);
  for (let bay = 0; bay < BAYS; bay++) {
    for (const sz of [-1, 1]) {
      const d = box(bayW - 0.05, BODY - 0.04, 0.05, doorMat);
      d.position.set(-L / 2 + bayW * (bay + 0.5), BASE + BODY / 2, sz * (W / 2 + 0.03));
      const h = box(0.04, 0.32, 0.04, handleMat, false);
      h.position.set(bayW / 2 - 0.15, 0, sz * 0.04);
      d.add(h);
      d.visible = false;
      doors.push(d);
      group.add(d);
    }
  }
  for (const sx of [-1, 1]) {
    const cap = box(0.05, BODY - 0.04, W, doorMat);
    cap.position.set(sx * (L / 2 + 0.03), BASE + BODY / 2, 0);
    cap.visible = false;
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

  return { group, frame, modules, busbars, roof, doors, coolantLight, statusLight };
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
// The hanger (beam + rods) sits in `drop`, which lowers on a cable to pick a frame off the floor.
export function createCarrier() {
  const group = new THREE.Group();
  const trolley = box(1.4, 0.32, 0.5, mat(COLORS.dark, { metalness: 0.5 }));
  trolley.position.y = 0.05;
  group.add(trolley);
  const drop = new THREE.Group();
  group.add(drop);
  const beam = box(PACK.L * 0.8, 0.14, 0.3, mat(COLORS.yellow));
  beam.position.y = -HANG + 0.07;
  drop.add(beam);
  for (const x of [-3.2, 3.2]) {
    const rod = cyl(0.035, 0.035, HANG, 6, mat(0x111111), false);
    rod.position.set(x, -HANG / 2, 0);
    drop.add(rod);
  }
  const cable = cyl(0.04, 0.04, 1, 6, mat(0x111111), false);
  cable.visible = false;
  group.add(cable);
  return { group, drop, cable };
}

// ---------- battery module tray (output of the module line) ----------
export const TRAY = { L: 2.4, W: 1.6, BLOCKS: 6, CELLS: 24 };
const cellGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.32, 10);
const cellMat = new THREE.MeshStandardMaterial({ color: 0x1f5e57, roughness: 0.45, metalness: 0.3 });
const blockCentres = [];
for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) blockCentres.push([-0.78 + i * 0.78, -0.38 + j * 0.76]);

export function createModuleTray() {
  const group = new THREE.Group();
  const plate = box(TRAY.L, 0.08, TRAY.W, mat(COLORS.steel, { metalness: 0.6, roughness: 0.4 }));
  plate.position.y = 0.04;
  group.add(plate);

  // Cells – one instanced mesh, revealed progressively via .count
  const cells = new THREE.InstancedMesh(cellGeo, cellMat, TRAY.BLOCKS * TRAY.CELLS);
  cells.castShadow = true;
  cells.frustumCulled = false;
  const m4 = new THREE.Matrix4();
  let n = 0;
  for (const [bx, bz] of blockCentres) {
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 6; c++) {
        cells.setMatrixAt(n++, m4.makeTranslation(bx - 0.27 + c * 0.108, 0.24, bz - 0.17 + r * 0.113));
      }
    }
  }
  cells.count = 0;
  group.add(cells);

  const welds = [];
  const potting = [];
  const lids = [];
  for (const [bx, bz] of blockCentres) {
    const w = box(0.66, 0.02, 0.5, mat(COLORS.copper, { metalness: 0.85, roughness: 0.3 }), false);
    w.position.set(bx, 0.41, bz);
    w.visible = false;
    welds.push(w);
    group.add(w);
    const p = box(0.7, 0.05, 0.56, mat(0x6b5a3a, { roughness: 0.9 }), false);
    p.position.set(bx, 0.44, bz);
    p.visible = false;
    potting.push(p);
    group.add(p);
    const lid = box(0.74, 0.44, 0.7, mat(COLORS.module, { metalness: 0.5, roughness: 0.45 }));
    lid.position.set(bx, 0.3, bz);
    const led = box(0.3, 0.04, 0.02, glow(COLORS.teal), false);
    led.position.set(0, 0.12, 0.36);
    lid.add(led);
    lid.visible = false;
    lids.push(lid);
    group.add(lid);
  }
  const statusLight = box(0.04, 0.08, 0.2, new THREE.MeshBasicMaterial({ color: COLORS.amber, toneMapped: false }), false);
  statusLight.position.set(TRAY.L / 2 + 0.02, 0.06, 0);
  statusLight.visible = false;
  group.add(statusLight);
  return { group, cells, welds, potting, lids, statusLight };
}

// ---------- 6-axis-style industrial robot ----------
export function createRobot(color = COLORS.red, scale = 1) {
  const root = new THREE.Group();
  root.scale.setScalar(scale);
  const body = mat(color, { roughness: 0.4, metalness: 0.2 });
  const dark = mat(COLORS.dark, { roughness: 0.5, metalness: 0.4 });

  const base = cyl(0.5, 0.6, 0.5, 24, dark);
  base.position.y = 0.25;
  root.add(base);

  const turret = new THREE.Group();
  turret.position.y = 0.5;
  root.add(turret);
  const turretMesh = cyl(0.38, 0.42, 0.45, 20, body);
  turretMesh.position.y = 0.22;
  turret.add(turretMesh);

  const shoulder = new THREE.Group();
  shoulder.position.y = 0.5;
  turret.add(shoulder);
  const sj = sphere(0.3, dark);
  shoulder.add(sj);
  const upper = box(0.3, 1.8, 0.3, body);
  upper.position.y = 0.9;
  shoulder.add(upper);

  const elbow = new THREE.Group();
  elbow.position.y = 1.8;
  shoulder.add(elbow);
  elbow.add(sphere(0.22, dark));
  const fore = box(0.22, 1.5, 0.22, body);
  fore.position.y = 0.75;
  elbow.add(fore);

  const wrist = new THREE.Group();
  wrist.position.y = 1.5;
  elbow.add(wrist);
  wrist.add(sphere(0.14, dark));
  const tool = box(0.18, 0.32, 0.18, dark);
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
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#4a4e54';
  g.fillRect(0, 0, 512, 512);
  // subtle concrete noise
  const img = g.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 10;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}
