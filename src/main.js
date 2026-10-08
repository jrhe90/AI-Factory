import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  COLORS, PACK, TRUCK_BED, FRAME_H, FRAME_MATS, HANG, TRAY, mat, glow, box, cyl,
  createMegapack, createRoof, createRobot, createTruck, createAGV, createWorker,
  createFrame, setFrameMaterial, createCarrier, createModuleTray,
  makeSignTexture, makeWallTexture, makeFloorTexture,
} from './models.js';

// =====================================================================
// Plant layout & timing
// =====================================================================
// Simulation time is in "sim seconds"; one sim second = FACTORY_MIN factory minutes.
// The pack line's End-of-Line test (~10 s + ~3.5 s transfer) paces the plant at
// roughly 1.1 packs/hour, i.e. a ~40 GWh/year run-rate. The feeder lines
// (Body in White, Powder Coat, Battery Modules) are sized to run slightly faster,
// so they fill their buffers and then block, as real feeder lines do.
const FACTORY_MIN = 4;
const MWH_PER_UNIT = 3.9;
const TRAYS_PER_PACK = 3; // 3 trays × 6 modules = 18 modules per pack

// Pack line (front of plant, flows +x)
const CONV_Y = 0.8;
const PICK_X = 57;
const TRUCK_Z = 16;
// Battery module line (flows -x, ends at the rack warehouse)
const MOD_Y = 0.9;
const MOD_Z = -17;
// Body in White (back of plant, flows -x) hands frames up to the overhead paint conveyor
const BIW_Y = 0.7;
const BIW_Z = -27;
const PC_RAIL_Y = 4.5;
const PC_START_X = 36;
// The overhead powder-coat conveyor ends right above Chassis Load on the pack line.
const PC_POINTS = [
  [PC_START_X, PC_RAIL_Y, BIW_Z], [-18, PC_RAIL_Y, BIW_Z], [-32, 11, BIW_Z], [-32, 11, -9],
  [-72, 11, -9], [-72, 7.6, 0], [-56, 5.8, 0],
];
const PC_END_Y = 5.8;
const FRAME_DROP = PC_END_Y - HANG - FRAME_H - CONV_Y - PACK.BASE; // hanger → skid
const LOAD_LIFT = PC_RAIL_Y - HANG - FRAME_H - BIW_Y; // BIW conveyor → hanger

const STATUS_COLOR = { working: COLORS.green, idle: 0x6b7280, blocked: COLORS.amber, down: COLORS.red };
const STATUS_LABEL = { working: 'Working', idle: 'Starved', blocked: 'Blocked', down: 'Fault' };

// Station visual styles
const STYLE = {
  gantry: { halfZ: 4.2, height: 7.6, signW: 5.6, signH: 1.4, zoneX: 6, zoneZ: 4.4, robotZ: 3.3, robotScale: 1 },
  mini: { halfZ: 2.5, height: 3.4, signW: 3.2, signH: 0.8, zoneX: 4.2, zoneZ: 2.9, robotZ: 2.1, robotScale: 0.6 },
  tunnel: { halfZ: 2.3, height: 5.4, signW: 4.2, signH: 1.05, zoneX: 6, zoneZ: 2.8, robotZ: 1.75, robotScale: 0.75 },
  open: { halfZ: 2.6, height: 6.2, signW: 4.2, signH: 1.05, zoneX: 5, zoneZ: 2.8, robotZ: 2.6, robotScale: 1 },
};

// =====================================================================
// Renderer, scene, camera
// =====================================================================
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14171b);
scene.fog = new THREE.Fog(0x14171b, 160, 380);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.5, 900);
camera.position.set(-34, 64, 96);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(6, 0, -8);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2.05;
controls.minDistance = 4;
controls.maxDistance = 300;

scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2d33, 0.55));
const sun = new THREE.DirectionalLight(0xffffff, 1.7);
sun.position.set(40, 90, 45);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 70, bottom: -70, near: 10, far: 260 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun);

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const v3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);

// Polyline with rounded corners, parameterised by arc length.
function roundedPath(points, radius) {
  const pts = points.map(v3);
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

// =====================================================================
// Shared buffers between lines
// =====================================================================
const moduleStock = { count: 30, cap: 56, crates: [] };

// =====================================================================
// Factory building
// =====================================================================
function buildFactory() {
  const floorTex = makeFloorTexture();
  floorTex.repeat.set(36, 18);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 120),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85, metalness: 0.05 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const paint = mat(COLORS.yellow, { roughness: 0.7 });
  const stripe = (x, z, w, d) => {
    const s = box(w, 0.02, d, paint, false);
    s.position.set(x, 0.01, z);
    s.receiveShadow = true;
    scene.add(s);
  };
  stripe(0, -4.6, 132, 0.18);
  stripe(0, 4.6, 104, 0.18);
  stripe(6, MOD_Z + 3.4, 74, 0.14);
  stripe(66, BIW_Z + 4.6, 64, 0.14);
  // Drive-through truck lane
  stripe(0, TRUCK_Z - 2.3, 192, 0.18);
  stripe(0, TRUCK_Z + 2.3, 192, 0.18);

  // Perimeter columns and eave beams (roof left open so the lines stay visible)
  const steel = mat(0x50565e, { metalness: 0.6, roughness: 0.45 });
  for (let x = -96; x <= 96; x += 16) {
    for (const z of [-34, 34]) {
      const c = box(0.7, 18, 0.7, steel);
      c.position.set(x, 9, z);
      scene.add(c);
    }
  }
  for (const z of [-34, 34]) {
    const b = box(192, 0.8, 0.5, steel, false);
    b.position.set(0, 18, z);
    scene.add(b);
  }

  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(192, 18),
    new THREE.MeshStandardMaterial({ color: 0xbfc4ca, roughness: 0.9 }),
  );
  wall.position.set(0, 9, -34.4);
  wall.receiveShadow = true;
  scene.add(wall);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(64, 8),
    new THREE.MeshStandardMaterial({ map: makeWallTexture(), roughness: 0.8 }),
  );
  sign.position.set(0, 12.5, -34.3);
  scene.add(sign);

  buildConveyor(-64, 63, 0, CONV_Y, 2.3, 0.5);
  buildConveyor(-29, 41, MOD_Z, MOD_Y, 1.8, 0.4);
  buildConveyor(31, 99, BIW_Z, BIW_Y, 2.3, 0.6);
  buildWarehouse();
  buildPaintRail();
  buildFeederDecor();
}

function buildConveyor(x0, x1, z, topY, width, pitch) {
  const len = x1 - x0;
  const cx = (x0 + x1) / 2;
  const bodyH = topY - 0.25;
  const body = box(len, bodyH, width, mat(COLORS.dark, { metalness: 0.4, roughness: 0.5 }));
  body.position.set(cx, bodyH / 2 + 0.05, z);
  scene.add(body);
  for (const side of [-1, 1]) {
    const rail = box(len, 0.14, 0.1, mat(COLORS.steel, { metalness: 0.7, roughness: 0.35 }));
    rail.position.set(cx, topY - 0.04, z + side * (width / 2 + 0.05));
    scene.add(rail);
  }
  const rollerGeo = new THREE.CylinderGeometry(0.08, 0.08, width - 0.1, 10);
  rollerGeo.rotateX(Math.PI / 2);
  const count = Math.floor(len / pitch);
  const rollers = new THREE.InstancedMesh(rollerGeo, mat(0x9aa1a9, { metalness: 0.8, roughness: 0.3 }), count);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < count; i++) rollers.setMatrixAt(i, m4.makeTranslation(x0 + pitch / 2 + i * pitch, topY - 0.08, z));
  rollers.receiveShadow = true;
  scene.add(rollers);
}

function buildWarehouse() {
  // Module storage racks: every crate slot is one module tray in stock.
  const upright = mat(0x2f6fd6, { metalness: 0.5, roughness: 0.5 });
  const beam = mat(0xf07a1a, { metalness: 0.4, roughness: 0.5 });
  const crateMat = mat(COLORS.module, { metalness: 0.5, roughness: 0.45 });
  for (let bay = 0; bay < 7; bay++) {
    const x = -78 + bay * 4.2;
    for (const dx of [-2, 2]) {
      for (const dz of [-0.7, 0.7]) {
        const u = box(0.12, 6.4, 0.12, upright);
        u.position.set(x + dx, 3.2, -22 + dz);
        scene.add(u);
      }
    }
    for (let level = 0; level < 4; level++) {
      const y = 0.3 + level * 1.6;
      for (const dz of [-0.7, 0.7]) {
        const b = box(4.1, 0.12, 0.1, beam, false);
        b.position.set(x, y, -22 + dz);
        scene.add(b);
      }
      for (let k = 0; k < 2; k++) {
        const c = box(1.6, 0.9, 1.2, crateMat);
        c.position.set(x - 0.95 + k * 1.9, y + 0.52, -22);
        scene.add(c);
        moduleStock.crates.push({ mesh: c, order: level * 100 + bay * 2 + k });
      }
    }
  }
  // Fill bottom levels first
  moduleStock.crates.sort((a, b) => a.order - b.order);
  moduleStock.crates = moduleStock.crates.map((c) => c.mesh);
}

let pcPath;
function buildPaintRail() {
  pcPath = roundedPath(PC_POINTS, 3.5);
  const rail = new THREE.Mesh(
    new THREE.TubeGeometry(pcPath, 600, 0.11, 6, false),
    mat(0x3a3f46, { metalness: 0.7, roughness: 0.35 }),
  );
  rail.position.y = 0.22;
  rail.castShadow = true;
  scene.add(rail);
  // Hanger rods from the roof structure every ~7 m
  const L = pcPath.getLength();
  const rodMat = mat(0x4a5058, { metalness: 0.6, roughness: 0.4 });
  for (let s = 2; s < L; s += 7) {
    const p = pcPath.getPoint(s / L);
    const h = 18 - p.y;
    const rod = cyl(0.05, 0.05, h, 6, rodMat, false);
    rod.position.set(p.x, p.y + h / 2 + 0.2, p.z);
    scene.add(rod);
  }
}

function buildFeederDecor() {
  // Steel coils + blank stack feeding Body in White
  const coilMat = mat(0x9aa2ab, { metalness: 0.85, roughness: 0.3 });
  for (let i = 0; i < 3; i++) {
    const coil = cyl(1.0, 1.0, 1.2, 28, coilMat);
    coil.rotation.x = Math.PI / 2;
    coil.position.set(86 + i * 2.8, 1.0, BIW_Z - 6.2);
    scene.add(coil);
    const core = cyl(0.35, 0.35, 1.22, 16, mat(COLORS.darker));
    core.rotation.x = Math.PI / 2;
    core.position.copy(coil.position);
    scene.add(core);
  }
  // Pallets of cells feeding the module line
  const boxMat = mat(0xb08a5a, { roughness: 0.9 });
  for (let i = 0; i < 6; i++) {
    for (let k = 0; k < 3; k++) {
      const b = box(1.1, 0.6, 1.1, boxMat);
      b.position.set(42.6 + (i % 3) * 1.3, 0.3 + k * 0.62, MOD_Z - 0.7 + Math.floor(i / 3) * 1.4);
      scene.add(b);
    }
  }
  // Powder hoppers next to the booth
  for (let i = 0; i < 2; i++) {
    const hop = cyl(0.8, 0.35, 2.4, 20, mat(COLORS.white, { roughness: 0.4 }));
    hop.position.set(8 + i * 2.2, 2.2, BIW_Z - 4.6);
    scene.add(hop);
    const leg = box(1.4, 1.0, 1.4, mat(COLORS.dark));
    leg.position.set(8 + i * 2.2, 0.5, BIW_Z - 4.6);
    scene.add(leg);
  }
}

buildFactory();

// =====================================================================
// Particles (welding sparks, powder cloud, wash mist)
// =====================================================================
class Particles {
  constructor({ count, color, size, gravity, speed, up, life, opacity = 1, additive = true }) {
    Object.assign(this, { count, gravity, speed, up, life });
    this.pos = new Float32Array(count * 3).fill(-100);
    this.vel = new Float32Array(count * 3);
    this.age = new Float32Array(count);
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      color, size, transparent: true, opacity, depthWrite: false, toneMapped: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  emit(p, n) {
    for (let i = 0; i < n; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % this.count;
      this.pos.set([p.x, p.y, p.z], k * 3);
      this.vel[k * 3] = (Math.random() - 0.5) * this.speed;
      this.vel[k * 3 + 1] = Math.random() * this.up;
      this.vel[k * 3 + 2] = (Math.random() - 0.5) * this.speed;
      this.age[k] = this.life * (0.6 + Math.random() * 0.6);
    }
  }
  update(dt) {
    const { pos, vel, age } = this;
    for (let k = 0; k < this.count; k++) {
      if (age[k] <= 0) continue;
      age[k] -= dt;
      if (age[k] <= 0) {
        pos[k * 3 + 1] = -100;
        continue;
      }
      vel[k * 3 + 1] -= this.gravity * dt;
      pos[k * 3] += vel[k * 3] * dt;
      pos[k * 3 + 1] = Math.max(0.02, pos[k * 3 + 1] + vel[k * 3 + 1] * dt);
      pos[k * 3 + 2] += vel[k * 3 + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
const sparks = new Particles({ count: 900, color: 0xffb347, size: 0.12, gravity: 9.8, speed: 4, up: 3.2, life: 0.6 });
const powder = new Particles({ count: 700, color: 0xf4f6ff, size: 0.35, gravity: -0.15, speed: 1.4, up: 0.4, life: 1.4, opacity: 0.35, additive: false });
const mist = new Particles({ count: 500, color: 0x9cc8ff, size: 0.4, gravity: -0.6, speed: 0.9, up: 0.6, life: 1.6, opacity: 0.25, additive: false });
const tmpV = new THREE.Vector3();

// =====================================================================
// Line engine – shared by all four lines
// =====================================================================
// Units travel along a path by arc length `s`. Each station holds one unit; units keep a
// minimum spacing, so a slow or faulted station starves the stations after it and blocks
// the ones before it. Lines hand units to each other at their ends.
const lines = [];
const stations = [];
const pickables = [];

class Line {
  constructor(cfg) {
    const { stations: stationCfgs, ...rest } = cfg;
    Object.assign(this, rest);
    this.stationCfgs = stationCfgs;
    this.L = this.path.getLength();
    this.units = [];
    this.stations = [];
    this.produced = 0;
    this.serial = 0;
    lines.push(this);
  }
  canAccept() {
    return !this.units.some((u) => u.s < this.spacing - 1e-3);
  }
  spawn(from) {
    const u = this.makeUnit(from);
    Object.assign(u, {
      line: this, s: 0, next: 0, state: 'moving', t: 0, dur: 1, blocked: false,
      retest: false, consumed: false, id: `${this.prefix}-${String(++this.serial).padStart(4, '0')}`,
    });
    scene.add(u.group);
    this.units.push(u);
    this.place(u);
    return u;
  }
  remove(u) {
    this.units.splice(this.units.indexOf(u), 1);
  }
  step(dt) {
    // Front-to-back so spacing uses updated positions. A downstream line that continues
    // physically from our end counts as the unit "ahead" of our lead unit.
    const sorted = this.units.slice().sort((a, b) => b.s - a.s);
    let aheadS = this.downstreamAhead ? this.downstreamAhead() : Infinity;
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
            u.dur = st.cfg.cycle * THREE.MathUtils.randFloat(0.9, 1.1);
            st.occupant = u;
          } else {
            u.state = 'atEnd';
          }
        }
      } else if (u.state === 'processing') {
        processUnit(u, this.stations[u.next], dt);
      }
      if (u.state === 'atEnd' && this.onEnd && this.onEnd(u)) {
        this.remove(u);
        scene.remove(u.group);
        this.produced++;
        continue;
      }
      this.place(u);
      aheadS = u.s;
    }
    if (this.autoSpawn && this.canAccept()) this.spawn();
  }
}

function processUnit(u, st, dt) {
  if (st.down) return;
  const consume = st.cfg.consume;
  if (consume && !u.consumed) {
    if (consume.buffer.count < consume.n) {
      st.waiting = true; // starved of material
      return;
    }
    consume.buffer.count -= consume.n;
    u.consumed = true;
  }
  st.waiting = false;
  u.t += dt;
  st.workTime += dt;
  const p = clamp01(u.t / u.dur);
  st.line.progress(u, st, p);
  if (sim.faults && Math.random() < dt / 450) breakStation(st);
  if (p >= 1) finishStation(u, st);
}

function finishStation(u, st) {
  const isMainTest = st.cfg.id === 'eol';
  if (st.cfg.failRate) {
    if (isMainTest && !u.retest) sim.tested++;
    if (!u.retest && Math.random() < st.cfg.failRate) {
      u.retest = true;
      u.t = 0;
      u.dur = st.cfg.cycle * 0.6;
      u.statusLight.material.color.setHex(COLORS.red);
      toast(`${u.id} failed ${st.cfg.failText} — re-testing`);
      return;
    }
    if (isMainTest && !u.retest) sim.firstPass++;
  }
  st.processed++;
  st.occupant = null;
  u.next++;
  u.state = 'moving';
}

// =====================================================================
// Line definitions
// =====================================================================
const MAIN = new Line({
  id: 'pack', name: 'Pack line', prefix: 'MP', unitName: 'packs',
  path: new THREE.LineCurve3(new THREE.Vector3(-56, CONV_Y, 0), new THREE.Vector3(PICK_X, CONV_Y, 0)),
  speed: 4, spacing: 11, style: 'gantry', yaw: 0,
  stations: [
    { id: 'chassis', name: 'Chassis Load', at: -56, cycle: 5,
      desc: 'A powder-coated frame comes down off the overhead paint conveyor and is lowered onto a steel skid.' },
    { id: 'modules', name: 'Module Install', at: -42, cycle: 9, robots: [[-2.2, -1], [2.2, 1]],
      consume: { buffer: moduleStock, n: TRAYS_PER_PACK },
      desc: `AGVs bring module trays from the rack warehouse; twin robots insert 18 modules (${TRAYS_PER_PACK} trays) into the frame bays.` },
    { id: 'busbar', name: 'Busbar & HV Wiring', at: -28, cycle: 7, robots: [[-1.8, -1], [1.8, 1]], sparks: true,
      desc: 'Robots bolt and laser-weld copper busbars that link the modules into high-voltage strings.' },
    { id: 'thermal', name: 'Thermal & Inverter', at: -14, cycle: 8,
      desc: 'An overhead hoist sets the integrated thermal roof (chillers, fans) and power-conversion electronics.' },
    { id: 'enclosure', name: 'Enclosure & Doors', at: 0, cycle: 8, robots: [[-2.2, 1], [2.2, -1]], sparks: true,
      desc: 'Side doors and end caps are fitted and welded, sealing the enclosure against weather and dust.' },
    { id: 'coolant', name: 'Coolant Fill', at: 14, cycle: 6, robots: [[2.5, -1]],
      desc: 'The glycol coolant loop is vacuum-checked for leaks, then filled and bled.' },
    { id: 'eol', name: 'End-of-Line Test', at: 28, cycle: 10, failRate: 0.06, failText: 'insulation test',
      desc: 'Full functional test: insulation resistance, BMS comms and a charge/discharge pulse. Failures are re-tested.' },
    { id: 'qa', name: 'Final QA', at: 42, cycle: 5,
      desc: 'Visual and dimensional inspection, serial labelling and release to the shipping crane.' },
  ],
  sOf: (x) => x + 56,
  makeUnit() {
    const u = createMegapack();
    u.frameDrop = FRAME_DROP;
    u.frame.position.y = PACK.BASE + FRAME_DROP;
    return u;
  },
  place(u) {
    u.group.position.set(-56 + u.s, CONV_Y, 0);
  },
  progress: mainProgress,
});

const MODULE = new Line({
  id: 'module', name: 'Battery Modules', prefix: 'MT', unitName: 'trays',
  path: new THREE.LineCurve3(new THREE.Vector3(38, MOD_Y, MOD_Z), new THREE.Vector3(-26, MOD_Y, MOD_Z)),
  speed: 3, spacing: 3.2, style: 'mini', yaw: Math.PI, autoSpawn: true,
  stations: [
    { id: 'm-intake', name: 'Cell Intake & Test', at: 38, cycle: 2.4,
      desc: 'Cylindrical cells are de-palletised, scanned and OCV/IR tested; a module tray is indexed onto the line.' },
    { id: 'm-insert', name: 'Cell Insertion', at: 29, cycle: 2.8, robots: [[0, 1]],
      desc: 'A robot loads 144 tested cells into the tray’s six module carriers.' },
    { id: 'm-weld', name: 'Interconnect Weld', at: 20, cycle: 2.8, robots: [[0, -1]], sparks: true,
      desc: 'Laser welding joins every cell to the copper current-collector plates.' },
    { id: 'm-pot', name: 'Adhesive & Potting', at: 11, cycle: 2.4,
      desc: 'A dispensing head fills the gaps with thermally-conductive potting compound.' },
    { id: 'm-lid', name: 'Module Enclosure', at: 2, cycle: 2.4, robots: [[0, 1]],
      desc: 'Module lids and sense boards are placed and fastened.' },
    { id: 'm-test', name: 'Module EOL Test', at: -7, cycle: 2.6, failRate: 0.03, failText: 'module isolation test',
      desc: 'Voltage, isolation and BMS-board checks. Passing trays go to the rack warehouse.' },
  ],
  sOf: (x) => 38 - x,
  makeUnit: () => createModuleTray(),
  place(u) {
    u.group.position.set(38 - u.s, MOD_Y, MOD_Z);
  },
  onEnd() {
    if (moduleStock.count >= moduleStock.cap) return false;
    moduleStock.count++;
    return true;
  },
  progress: moduleProgress,
});

const BIW = new Line({
  id: 'biw', name: 'Body in White', prefix: 'BW', unitName: 'frames',
  path: new THREE.LineCurve3(new THREE.Vector3(94, BIW_Y, BIW_Z), new THREE.Vector3(PC_START_X, BIW_Y, BIW_Z)),
  speed: 4, spacing: 11.5, style: 'gantry', yaw: Math.PI, autoSpawn: true,
  stations: [
    { id: 'b-base', name: 'Base Frame Weld', at: 88, cycle: 6, robots: [[-2.2, -1], [2.2, 1]], sparks: true,
      desc: 'Roll-formed steel rails are clamped in a fixture and robot-welded into the base frame.' },
    { id: 'b-side', name: 'Side Post Weld', at: 76, cycle: 7, robots: [[-2.2, 1], [2.2, -1]], sparks: true,
      desc: 'Fourteen vertical posts are positioned and MIG-welded to the base.' },
    { id: 'b-roof', name: 'Roof Rail Weld', at: 64, cycle: 6, robots: [[-2.2, -1], [2.2, 1]], sparks: true,
      desc: 'Top rails and cross members close the frame into a rigid box.' },
    { id: 'b-cmm', name: 'Geometry Check', at: 52, cycle: 5,
      desc: 'A laser scanning arch measures the welded frame against CAD before it goes to paint.' },
  ],
  sOf: (x) => 94 - x,
  makeUnit() {
    const frame = createFrame(FRAME_MATS.bare);
    frame.userData.meshes.forEach((m) => { m.visible = false; });
    const group = new THREE.Group();
    group.add(frame);
    return { group, frame };
  },
  place(u) {
    u.group.position.set(94 - u.s, BIW_Y, BIW_Z);
  },
  progress: biwProgress,
});

const PC = new Line({
  id: 'paint', name: 'Powder Coat', prefix: 'FR', unitName: 'frames',
  path: roundedPath(PC_POINTS, 3.5),
  speed: 4, spacing: 11, yaw: Math.PI,
  stations: [
    { id: 'p-load', name: 'Load & Hang', at: 36, cycle: 5, style: 'open',
      desc: 'The welded frame is lifted off the BIW conveyor and hung on an overhead power-and-free carrier.' },
    { id: 'p-wash', name: 'Pre-treatment Wash', at: 23, cycle: 6, style: 'tunnel',
      desc: 'Alkaline degrease, rinse and zirconium conversion coat so the powder bonds to the steel.' },
    { id: 'p-booth', name: 'Powder Booth', at: 10, cycle: 7, style: 'tunnel', robots: [[-1.6, -1], [1.6, 1]],
      desc: 'Electrostatic spray robots coat the frame in white polyester powder.' },
    { id: 'p-oven', name: 'Cure Oven', at: -4, cycle: 8, style: 'tunnel', long: true,
      desc: 'The powder melts and cross-links at ~200 °C into a hard, weather-proof finish.' },
    { id: 'p-cool', name: 'Cool & Inspect', at: -16, cycle: 4, style: 'open',
      desc: 'Fans cool the frame; film thickness and gloss are checked before it rides the rail to the pack line.' },
  ],
  sOf: (x) => PC_START_X - x,
  makeUnit() {
    const c = createCarrier();
    const frame = createFrame(FRAME_MATS.bare);
    c.group.add(frame);
    return { group: c.group, drop: c.drop, cable: c.cable, frame, lift: -LOAD_LIFT };
  },
  place(u) {
    const p = this.path.getPoint(u.s / this.L);
    const t = this.path.getTangent(u.s / this.L);
    u.group.position.copy(p);
    u.group.rotation.y = Math.atan2(-t.z, t.x);
    u.frame.position.y = -HANG - FRAME_H + u.lift;
    u.drop.position.y = u.lift;
    u.cable.visible = u.lift < -0.01;
    if (u.cable.visible) {
      u.cable.scale.y = -u.lift;
      u.cable.position.y = u.lift / 2;
    }
  },
  progress: paintProgress,
});

// Hand-offs between lines
BIW.downstreamAhead = () => Math.min(Infinity, ...PC.units.map((u) => BIW.L + u.s));
BIW.onEnd = () => {
  if (!PC.canAccept()) return false;
  PC.spawn();
  return true;
};
PC.downstreamAhead = () => Math.min(Infinity, ...MAIN.units.map((u) => PC.L + u.s));
PC.onEnd = () => {
  if (!MAIN.canAccept()) return false;
  MAIN.spawn();
  return true;
};

// =====================================================================
// Per-station progress visuals
// =====================================================================
function revealCount(list, p) {
  const n = Math.floor(p * list.length + 1e-4);
  list.forEach((m, i) => { m.visible = i < n; });
}

function mainProgress(u, st, p) {
  const e = st.extras;
  switch (st.cfg.id) {
    case 'chassis':
      u.frameDrop = (1 - ease(clamp01(p / 0.85))) * FRAME_DROP;
      u.frame.position.y = PACK.BASE + u.frameDrop;
      break;
    case 'modules':
      revealCount(u.modules, p);
      break;
    case 'busbar':
      revealCount(u.busbars, p);
      break;
    case 'thermal':
      e.carrierY = THREE.MathUtils.lerp(6.2, CONV_Y + PACK.FRAME_TOP, ease(clamp01(p / 0.8)));
      if (p >= 0.85) {
        u.roof.visible = true;
        e.carrier.visible = false;
      }
      break;
    case 'enclosure':
      revealCount(u.doors, p);
      break;
    case 'coolant':
      e.hoseY = THREE.MathUtils.lerp(6.8, CONV_Y + PACK.HEIGHT, ease(clamp01(Math.min(p, 1 - p) * 5)));
      if (p > 0.3) u.coolantLight.visible = true;
      break;
    case 'eol':
      e.scanner.visible = p < 1;
      e.scanner.position.x = Math.sin(p * Math.PI * 3) * (PACK.L / 2);
      testLight(u, p);
      break;
  }
}

function testLight(u, p) {
  u.statusLight.visible = true;
  if (p >= 1) u.statusLight.material.color.setHex(COLORS.green);
  else if (!u.retest || p > 0.05) u.statusLight.material.color.setHex(Math.floor(p * 20) % 2 ? COLORS.amber : 0x3a2a00);
}

function moduleProgress(u, st, p) {
  const e = st.extras;
  switch (st.cfg.id) {
    case 'm-insert':
      u.cells.count = Math.floor(p * u.cells.instanceMatrix.count);
      break;
    case 'm-weld':
      revealCount(u.welds, p);
      break;
    case 'm-pot':
      revealCount(u.potting, p);
      e.nozzleX = Math.sin(p * Math.PI * 6) * (TRAY.L / 2 - 0.3);
      break;
    case 'm-lid':
      revealCount(u.lids, p);
      if (p >= 1) {
        // Everything under the lids is hidden now – skip drawing it
        u.cells.visible = false;
        u.welds.concat(u.potting).forEach((m) => { m.visible = false; });
      }
      break;
    case 'm-test':
      testLight(u, p);
      break;
  }
}

function biwProgress(u, st, p) {
  const parts = u.frame.userData;
  switch (st.cfg.id) {
    case 'b-base':
      revealCount(parts.base, p);
      break;
    case 'b-side':
      revealCount(parts.posts, p);
      break;
    case 'b-roof':
      revealCount(parts.top, p);
      break;
    case 'b-cmm':
      st.extras.scanner.visible = p < 1;
      st.extras.scanner.position.x = Math.sin(p * Math.PI * 2) * (PACK.L / 2);
      break;
  }
}

function paintProgress(u, st, p) {
  switch (st.cfg.id) {
    case 'p-load':
      u.lift = -LOAD_LIFT * (1 - ease(clamp01(p / 0.9)));
      break;
    case 'p-wash':
      if (p > 0.5) setFrameMaterial(u.frame, FRAME_MATS.pretreat);
      break;
    case 'p-booth':
      if (p > 0.35) setFrameMaterial(u.frame, FRAME_MATS.powder);
      break;
    case 'p-oven':
      setFrameMaterial(u.frame, p >= 1 ? FRAME_MATS.coated : FRAME_MATS.curing);
      break;
  }
}

// =====================================================================
// Stations
// =====================================================================
function signMesh(tex, w, h) {
  const g = new THREE.Group();
  for (const side of [1, -1]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    s.position.z = side * 0.02;
    if (side < 0) s.rotation.y = Math.PI;
    g.add(s);
  }
  const back = box(w + 0.1, h + 0.1, 0.03, mat(COLORS.darker), false);
  g.add(back);
  return g;
}

function buildStation(line, cfg, index) {
  const styleName = cfg.style ?? line.style;
  const sty = STYLE[styleName];
  const s = line.sOf(cfg.at);
  const p = line.path.getPoint(s / line.L);
  const st = {
    cfg, line, index, s, sty, styleName, status: 'idle', occupant: null, waiting: false,
    down: false, downLeft: 0, downtime: 0, workTime: 0, processed: 0,
    robots: [], extras: {}, group: new THREE.Group(),
  };
  st.group.position.set(p.x, 0, p.z);
  st.group.rotation.y = line.yaw;
  scene.add(st.group);

  const frameMat = mat(0x3a3f46, { metalness: 0.6, roughness: 0.4 });
  const tex = makeSignTexture(index + 1, cfg.name, line.name.toUpperCase());
  let beaconPos;
  if (styleName === 'gantry' || styleName === 'mini') {
    for (const z of [-sty.halfZ, sty.halfZ]) {
      const post = box(sty.halfZ > 3 ? 0.35 : 0.2, sty.height, sty.halfZ > 3 ? 0.35 : 0.2, frameMat);
      post.position.set(0, sty.height / 2, z);
      st.group.add(post);
    }
    const beam = box(sty.halfZ > 3 ? 0.5 : 0.28, sty.halfZ > 3 ? 0.55 : 0.3, sty.halfZ * 2 + 0.4, frameMat);
    beam.position.set(0, sty.height, 0);
    st.group.add(beam);
    const sign = signMesh(tex, sty.signW, sty.signH);
    sign.position.set(0, sty.height + sty.signH / 2 + 0.45, 0);
    st.group.add(sign);
    beaconPos = [0, sty.height + 0.5, sty.halfZ];
  } else if (styleName === 'open') {
    const post = box(0.3, sty.height, 0.3, frameMat);
    post.position.set(0, sty.height / 2, sty.halfZ + 0.4);
    st.group.add(post);
    const sign = signMesh(tex, sty.signW, sty.signH);
    sign.position.set(0, sty.height + sty.signH / 2, sty.halfZ + 0.4);
    st.group.add(sign);
    beaconPos = [0, sty.height + sty.signH + 0.35, sty.halfZ + 0.4];
  } else {
    // tunnel: sign sits on the roof
    const sign = signMesh(tex, sty.signW, sty.signH);
    sign.position.set(0, sty.height + sty.signH / 2 + 0.25, 0);
    st.group.add(sign);
    beaconPos = [cfg.long ? 6.5 : 4.5, sty.height + 0.35, sty.halfZ - 0.3];
  }
  st.beaconMat = new THREE.MeshBasicMaterial({ color: STATUS_COLOR.idle, toneMapped: false });
  const beacon = cyl(sty.halfZ > 3 ? 0.22 : 0.15, sty.halfZ > 3 ? 0.22 : 0.15, sty.halfZ > 3 ? 0.45 : 0.3, 16, st.beaconMat, false);
  beacon.position.set(...beaconPos);
  st.group.add(beacon);

  // Floor zone + pick volume
  const zx = cfg.long ? sty.zoneX + 1.5 : sty.zoneX;
  const pts = [[-zx, -sty.zoneZ], [zx, -sty.zoneZ], [zx, sty.zoneZ], [-zx, sty.zoneZ], [-zx, -sty.zoneZ]]
    .map(([x, z]) => new THREE.Vector3(x, 0.03, z));
  st.zoneMat = new THREE.LineBasicMaterial({ color: 0x8a929c, transparent: true, opacity: 0.5 });
  st.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), st.zoneMat));
  const pick = new THREE.Mesh(
    new THREE.BoxGeometry(zx * 2, sty.height + 2, sty.zoneZ * 2),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  pick.position.y = (sty.height + 2) / 2;
  pick.userData.station = st;
  st.group.add(pick);
  pickables.push(pick);

  for (const [dx, side] of cfg.robots ?? []) {
    const color = line === PC ? 0xd8dbe0 : index % 2 ? COLORS.red : 0xd8dbe0;
    const r = createRobot(color, sty.robotScale);
    r.root.position.set(dx, 0, side * -sty.robotZ);
    r.baseYaw = side < 0 ? Math.PI : 0;
    r.turret.rotation.y = r.baseYaw;
    r.phase = Math.random() * 10;
    st.group.add(r.root);
    st.robots.push(r);
  }

  buildStationExtras(st);
  line.stations.push(st);
  stations.push(st);
}

function hoistCable(group, x, z, topY) {
  const cable = cyl(0.03, 0.03, 1, 6, mat(0x111111), false);
  cable.position.set(x, topY, z);
  group.add(cable);
  return cable;
}
function setCable(cable, topY, bottomY) {
  const h = Math.max(0.01, topY - bottomY);
  cable.scale.y = h;
  cable.position.y = bottomY + h / 2;
}

function tunnel(group, len, sty, wallMat, roofMat) {
  for (const z of [-sty.halfZ, sty.halfZ]) {
    const w = box(len, sty.height, 0.12, wallMat);
    w.position.set(0, sty.height / 2, z);
    group.add(w);
  }
  const roof = box(len, 0.15, sty.halfZ * 2 + 0.12, roofMat);
  roof.position.set(0, sty.height, 0);
  group.add(roof);
}

function scannerArch(color, height, width, baseY) {
  const g = new THREE.Group();
  const m = glow(color);
  for (const z of [-width / 2, width / 2]) {
    const b = box(0.08, height, 0.08, m, false);
    b.position.set(0, baseY + height / 2, z);
    g.add(b);
  }
  const top = box(0.08, 0.08, width, m, false);
  top.position.set(0, baseY + height, 0);
  g.add(top);
  g.visible = false;
  return g;
}

function testCabinets(st, x0, z, scale = 1) {
  const g = st.group;
  st.extras.leds = [];
  for (let i = 0; i < 3; i++) {
    const cab = box(1.2 * scale, 2.2 * scale, 0.8 * scale, mat(0x2b2f35, { metalness: 0.4 }));
    cab.position.set(x0 + i * 1.4 * scale, 1.1 * scale, z);
    g.add(cab);
    for (let k = 0; k < 4; k++) {
      const led = box(0.12 * scale, 0.08 * scale, 0.02, new THREE.MeshBasicMaterial({ color: COLORS.green, toneMapped: false }), false);
      led.position.set(x0 + i * 1.4 * scale - 0.3 * scale + k * 0.2 * scale, 1.8 * scale, z + Math.sign(-z) * 0.41 * scale);
      g.add(led);
      st.extras.leds.push(led);
    }
  }
}

function buildStationExtras(st) {
  const g = st.group;
  const e = st.extras;
  const sty = st.sty;
  switch (st.cfg.id) {
    // ---------------- pack line ----------------
    case 'chassis': {
      const trolley = box(1.2, 0.5, 1.4, mat(COLORS.yellow));
      trolley.position.set(0, 7.1, 0);
      g.add(trolley);
      // Stack of empty skids
      for (let i = 0; i < 4; i++) {
        const s = box(PACK.L + 0.2, PACK.BASE, PACK.W + 0.12, mat(COLORS.darker, { roughness: 0.8 }));
        s.position.set(-1, 0.13 + i * 0.27, -7.4);
        g.add(s);
      }
      break;
    }
    case 'modules': {
      const table = box(3.2, 0.9, 1.6, mat(COLORS.steel, { metalness: 0.5 }));
      table.position.set(0, 0.45, -6.2);
      g.add(table);
      break;
    }
    case 'busbar': {
      const spool = cyl(0.7, 0.7, 0.6, 24, mat(COLORS.copper, { metalness: 0.85, roughness: 0.3 }));
      spool.rotation.x = Math.PI / 2;
      spool.position.set(4, 0.7, 6.5);
      g.add(spool);
      break;
    }
    case 'thermal': {
      const trolley = box(PACK.L * 0.6, 0.5, 1.4, mat(COLORS.yellow));
      trolley.position.set(0, 7.1, 0);
      g.add(trolley);
      e.carrier = createRoof();
      e.carrier.traverse((o) => { o.castShadow = true; });
      g.add(e.carrier);
      e.cables = [-3.2, 3.2].map((x) => hoistCable(g, x, 0, 6.85));
      e.carrierY = 6.2;
      for (let i = 0; i < 2; i++) {
        const r = createRoof();
        r.position.set(0, i * 0.5, 7.2);
        g.add(r);
      }
      break;
    }
    case 'enclosure': {
      for (let i = 0; i < 6; i++) {
        const p = box(1.4, 2.0, 0.05, mat(COLORS.white));
        p.position.set(-1.8 + i * 0.12, 1.0, 6.9 + i * 0.07);
        p.rotation.x = -0.08;
        g.add(p);
      }
      break;
    }
    case 'coolant': {
      const tank = cyl(1.1, 1.1, 3.2, 24, mat(0x2a6fd8, { metalness: 0.5, roughness: 0.35 }));
      tank.position.set(-3, 1.6, 7);
      g.add(tank);
      const pump = box(1.2, 1.0, 1.0, mat(COLORS.dark));
      pump.position.set(-1.2, 0.5, 7);
      g.add(pump);
      e.hose = cyl(0.07, 0.07, 1, 8, mat(0x1d4fa8), false);
      e.hose.position.set(PACK.L / 2 - 0.3, 5, 0.4);
      g.add(e.hose);
      e.hoseY = 6.8;
      break;
    }
    case 'eol':
      e.scanner = scannerArch(COLORS.teal, PACK.HEIGHT + 0.5, PACK.W + 0.8, CONV_Y);
      g.add(e.scanner);
      testCabinets(st, -2.4, -7);
      break;
    case 'qa': {
      e.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.25 });
      for (const z of [-2.2, 2.2]) {
        const p = box(0.25, 4.5, 0.25, mat(COLORS.dark));
        p.position.set(0, 2.25, z);
        g.add(p);
        const strip = box(0.06, 4.0, 0.06, e.ringMat, false);
        strip.position.set(0.16, 2.3, z);
        g.add(strip);
      }
      const top = box(0.25, 0.25, 4.65, mat(COLORS.dark));
      top.position.set(0, 4.5, 0);
      g.add(top);
      break;
    }

    // ---------------- battery module line ----------------
    case 'm-intake':
    case 'm-test': {
      e.head = box(1.6, 0.35, 1.2, mat(COLORS.dark, { metalness: 0.5 }));
      e.headTop = 2.6;
      e.head.position.y = e.headTop;
      g.add(e.head);
      e.headCable = hoistCable(g, 0, 0, sty.height);
      testCabinets(st, -1.4, sty.halfZ + 0.7, 0.6);
      break;
    }
    case 'm-pot': {
      const bridge = box(0.25, 0.25, sty.halfZ * 2, mat(COLORS.yellow));
      bridge.position.set(0, 2.2, 0);
      g.add(bridge);
      e.nozzle = new THREE.Group();
      const body = box(0.3, 0.6, 0.3, mat(COLORS.dark));
      body.position.y = 1.85;
      e.nozzle.add(body);
      const tip = cyl(0.04, 0.02, 0.35, 8, mat(COLORS.steel));
      tip.position.y = 1.4;
      e.nozzle.add(tip);
      g.add(e.nozzle);
      e.nozzleX = 0;
      const drum = cyl(0.45, 0.45, 1.0, 18, mat(0x2a6fd8, { metalness: 0.4 }));
      drum.position.set(0, 0.5, sty.halfZ + 0.6);
      g.add(drum);
      break;
    }

    // ---------------- body in white ----------------
    case 'b-base':
    case 'b-side':
    case 'b-roof': {
      // Weld fixture clamps along both sides of the conveyor
      for (const z of [-1.5, 1.5]) {
        for (const x of [-3.5, 0, 3.5]) {
          const c = box(0.3, 1.2, 0.25, mat(0x2f6fd6, { metalness: 0.4 }));
          c.position.set(x, BIW_Y + 0.6, z);
          g.add(c);
        }
      }
      break;
    }
    case 'b-cmm':
      e.scanner = scannerArch(0x5ab0ff, FRAME_H + 0.6, PACK.W + 1.0, BIW_Y);
      g.add(e.scanner);
      testCabinets(st, -2.4, 6.4);
      break;

    // ---------------- powder coat ----------------
    case 'p-load': {
      const table = box(PACK.L * 0.7, 0.3, 0.3, mat(COLORS.yellow));
      table.position.set(0, BIW_Y + 0.1, 1.35);
      g.add(table);
      break;
    }
    case 'p-wash':
      tunnel(g, 10, sty,
        new THREE.MeshStandardMaterial({ color: 0x8fb4d8, transparent: true, opacity: 0.28, roughness: 0.1, metalness: 0.2, depthWrite: false }),
        mat(0x5a6470, { metalness: 0.5 }));
      e.nozzles = [];
      for (const x of [-3, 0, 3]) for (const z of [-1.6, 1.6]) e.nozzles.push(new THREE.Vector3(x, 3.4, z));
      break;
    case 'p-booth':
      tunnel(g, 10, sty,
        new THREE.MeshStandardMaterial({ color: 0xe8ecef, transparent: true, opacity: 0.22, roughness: 0.2, depthWrite: false }),
        mat(0xc9ced4, { metalness: 0.3 }));
      break;
    case 'p-oven': {
      const wall = mat(0x6a7077, { metalness: 0.6, roughness: 0.45 });
      tunnel(g, 14, sty, wall, wall);
      // Glowing inspection windows and burner boxes
      e.glowMat = new THREE.MeshBasicMaterial({ color: 0xff6a1a, toneMapped: false });
      for (const z of [-sty.halfZ - 0.07, sty.halfZ + 0.07]) {
        for (const x of [-4.5, 0, 4.5]) {
          const w = box(2.6, 0.5, 0.02, e.glowMat, false);
          w.position.set(x, 3.2, z);
          g.add(w);
        }
      }
      for (const x of [-4, 4]) {
        const burner = box(2.2, 1.0, 1.6, mat(COLORS.dark));
        burner.position.set(x, sty.height + 0.5, -1.0);
        g.add(burner);
        const stack = cyl(0.25, 0.25, 2.6, 12, mat(COLORS.steel, { metalness: 0.7 }));
        stack.position.set(x, sty.height + 1.6, 0.9);
        g.add(stack);
      }
      break;
    }
    case 'p-cool': {
      e.fans = [];
      for (const z of [-2.2, 2.2]) {
        const post = box(0.2, 4.2, 0.2, mat(COLORS.dark));
        post.position.set(0, 2.1, z);
        g.add(post);
        const fan = new THREE.Group();
        fan.position.set(0, 3.1, z * 0.82);
        fan.rotation.x = Math.PI / 2;
        const ring = cyl(0.7, 0.7, 0.25, 20, mat(COLORS.dark));
        fan.add(ring);
        for (let k = 0; k < 3; k++) {
          const blade = box(1.1, 0.04, 0.22, mat(COLORS.steel));
          blade.rotation.y = (k * Math.PI) / 3;
          fan.add(blade);
        }
        g.add(fan);
        e.fans.push(fan);
      }
      e.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.25 });
      const strip = box(0.06, 0.06, 4.0, e.ringMat, false);
      strip.position.set(0, 4.25, 0);
      g.add(strip);
      break;
    }
  }
  // Chassis hook hangs from the gantry trolley
  if (st.cfg.id === 'chassis') {
    e.hook = box(1.0, 0.3, 0.6, mat(COLORS.yellow));
    e.hook.position.y = 6.6;
    g.add(e.hook);
    e.cable = hoistCable(g, 0, 0, 6.85);
  }
}

for (const line of lines) line.stationCfgs.forEach((cfg, i) => buildStation(line, cfg, i));

// =====================================================================
// Shipping crane + trucks
// =====================================================================
const crane = { state: 'idle', z: 0, hookY: 7.5, load: null, group: new THREE.Group() };
{
  const yellow = mat(COLORS.yellow, { metalness: 0.3, roughness: 0.5 });
  const steel = mat(0x3a3f46, { metalness: 0.6, roughness: 0.4 });
  for (const x of [PICK_X - 7.5, PICK_X + 7.5]) {
    for (const z of [-4, TRUCK_Z + 4]) {
      const col = box(0.6, 11, 0.6, steel);
      col.position.set(x, 5.5, z);
      scene.add(col);
    }
    const rail = box(0.6, 0.6, TRUCK_Z + 9, steel);
    rail.position.set(x, 11.2, TRUCK_Z / 2);
    scene.add(rail);
  }
  const bridge = box(16, 0.9, 1.2, yellow);
  bridge.position.set(PICK_X, 11.9, 0);
  crane.group.add(bridge);
  const trolley = box(2.4, 1.0, 1.8, mat(COLORS.dark));
  trolley.position.set(PICK_X, 11.0, 0);
  crane.group.add(trolley);
  crane.spreader = new THREE.Group();
  crane.spreader.add(box(PACK.L + 0.6, 0.3, 0.5, yellow));
  crane.slings = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const s = cyl(0.025, 0.025, 1, 6, mat(0x111111), false);
      s.position.set(sx * (PACK.L / 2 - 0.3), 0, sz * 0.7);
      crane.spreader.add(s);
      crane.slings.push(s);
    }
  }
  crane.spreader.position.x = PICK_X;
  crane.group.add(crane.spreader);
  crane.cables = [-0.6, 0.6].map((dx) => {
    const c = cyl(0.04, 0.04, 1, 6, mat(0x111111), false);
    c.position.x = PICK_X + dx;
    crane.group.add(c);
    return c;
  });
  scene.add(crane.group);
  const dock = box(16, 0.04, 4.6, mat(0x3b3f45, { roughness: 0.9 }), false);
  dock.position.set(PICK_X, 0.02, TRUCK_Z);
  dock.receiveShadow = true;
  scene.add(dock);
}

// Trucks drive through the building in a convoy: queue → dock under crane → depart.
const TRUCK_SPAWN_X = -125;
const TRUCK_GAP = 18;
const trucks = [];
function spawnTruck() {
  const t = { ...createTruck(), state: 'queue', x: TRUCK_SPAWN_X, load: null };
  t.group.position.set(t.x, 0, TRUCK_Z);
  scene.add(t.group);
  trucks.push(t);
}

// =====================================================================
// AGVs and workers (ambient life)
// =====================================================================
const agvCurve = new THREE.CatmullRomCurve3(
  [
    [-70, -12.5], [-58, -10], [-46, -8.4], [-38, -8.6], [-30, -11.5],
    [-34, -14.6], [-52, -16.5], [-66, -17], [-74, -15],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z)),
  true,
);
const agvLen = agvCurve.getLength();
const agvs = [0, 0.33, 0.66].map((u) => {
  const a = createAGV();
  scene.add(a.group);
  return { ...a, u };
});

const workers = [
  { z: -5.6, min: -60, max: -10, color: 0xff7a1a },
  { z: 5.6, min: -40, max: 10, color: 0xf2e21a },
  { z: -5.6, min: -5, max: 45, color: 0xff7a1a },
  { z: 5.6, min: 15, max: 50, color: 0x9be22e },
  { z: 10.5, min: 46, max: 68, color: 0xf2e21a },
  { z: -10, min: -76, max: -50, color: 0xff7a1a },
  { z: MOD_Z + 3.0, min: -8, max: 38, color: 0x9be22e },
  { z: BIW_Z + 4.0, min: 50, max: 92, color: 0xff7a1a },
  { z: BIW_Z + 4.0, min: -20, max: 34, color: 0xf2e21a },
].map((w) => {
  const group = createWorker(w.color);
  const x = THREE.MathUtils.randFloat(w.min, w.max);
  group.position.set(x, 0, w.z);
  scene.add(group);
  return { ...w, group, x, target: x, pause: Math.random() * 3, walk: 0 };
});

// =====================================================================
// Simulation state
// =====================================================================
const sim = {
  time: 0, speed: 1, paused: false, faults: true,
  shipped: 0, tested: 0, firstPass: 0, shipping: [], shipTimes: [],
};

function stepSim(dt) {
  sim.time += dt;
  // Downstream first, so hand-offs see this step's free space
  MAIN.step(dt);
  PC.step(dt);
  BIW.step(dt);
  MODULE.step(dt);

  for (const st of stations) {
    if (st.down) {
      st.downtime += dt;
      st.downLeft -= dt;
      if (st.downLeft <= 0) st.down = false;
    }
  }
  stepCrane(dt);
  stepTrucks(dt);
}

function breakStation(st, duration) {
  if (st.down) return;
  st.down = true;
  st.downLeft = duration ?? THREE.MathUtils.randFloat(10, 22);
  toast(`Fault at ${st.cfg.name} (${st.line.name}) — maintenance dispatched`, 'warn');
}

function stepCrane(dt) {
  const zSpeed = 8 * dt;
  const ySpeed = 4 * dt;
  const toward = (v, target, step) => (Math.abs(target - v) <= step ? target : v + Math.sign(target - v) * step);
  const lineHook = CONV_Y + PACK.HEIGHT + 0.15;
  const truckHook = TRUCK_BED + PACK.HEIGHT + 0.15;
  const high = 8;

  switch (crane.state) {
    case 'idle': {
      // Pick as soon as a pack is ready; the truck swap happens while we lift.
      const ready = MAIN.units.find((u) => u.state === 'atEnd');
      if (ready) {
        crane.target = ready;
        crane.state = 'lowerLine';
      } else {
        crane.hookY = toward(crane.hookY, high, ySpeed);
      }
      break;
    }
    case 'lowerLine':
      crane.z = toward(crane.z, 0, zSpeed);
      if (crane.z === 0) crane.hookY = toward(crane.hookY, lineHook, ySpeed);
      if (crane.z === 0 && crane.hookY === lineHook) {
        crane.load = crane.target;
        crane.load.state = 'lifted';
        MAIN.remove(crane.load);
        sim.shipping.push(crane.load);
        crane.state = 'lift';
      }
      break;
    case 'lift':
      crane.hookY = toward(crane.hookY, high, ySpeed);
      if (crane.hookY === high) crane.state = 'waitTruck';
      break;
    case 'waitTruck':
      crane.truck = trucks.find((t) => t.state === 'docked' && !t.load);
      if (crane.truck) crane.state = 'traverse';
      break;
    case 'traverse':
      crane.z = toward(crane.z, TRUCK_Z, zSpeed);
      if (crane.z === TRUCK_Z) crane.state = 'lowerTruck';
      break;
    case 'lowerTruck':
      crane.hookY = toward(crane.hookY, truckHook, ySpeed);
      if (crane.hookY === truckHook) {
        crane.truck.load = crane.load;
        crane.load.state = 'onTruck';
        crane.load = null;
        crane.state = 'raise';
      }
      break;
    case 'raise':
      crane.hookY = toward(crane.hookY, high, ySpeed);
      if (crane.hookY === high) {
        crane.truck.state = 'departing';
        crane.truck = null;
        crane.state = 'return';
      }
      break;
    case 'return':
      crane.z = toward(crane.z, 0, zSpeed);
      if (crane.z === 0) crane.state = 'idle';
      break;
  }

  if (crane.load) crane.load.group.position.set(PICK_X, crane.hookY - PACK.HEIGHT - 0.15, crane.z);
}

function stepTrucks(dt) {
  const last = trucks[trucks.length - 1];
  if (trucks.length < 4 && (!last || last.x > TRUCK_SPAWN_X + TRUCK_GAP)) spawnTruck();

  let ahead = null; // trucks array is ordered front (highest x) to back
  for (const t of trucks) {
    if (t.state === 'departing') {
      t.v = Math.min(16, (t.v ?? 0) + 10 * dt);
      t.x += t.v * dt;
    } else if (t.state === 'queue') {
      const limit = ahead ? ahead.x - TRUCK_GAP : Infinity;
      const goal = Math.min(PICK_X, limit);
      const v = Math.min(14, Math.max(1.5, (goal - t.x) * 2.5));
      t.x = Math.min(goal, t.x + v * dt);
      if (t.x >= PICK_X - 1e-3) {
        t.x = PICK_X;
        t.state = 'docked';
      }
    }
    t.group.position.x = t.x;
    if (t.load) t.load.group.position.set(t.x, TRUCK_BED, TRUCK_Z);
    ahead = t;
  }

  // Shipped: truck has left the building
  while (trucks.length && trucks[0].x > 200) {
    const t = trucks.shift();
    scene.remove(t.group);
    if (t.load) {
      scene.remove(t.load.group);
      sim.shipping.splice(sim.shipping.indexOf(t.load), 1);
      sim.shipped++;
      sim.shipTimes.push(sim.time);
      if (follow.unit === t.load) follow.unit = null;
    }
  }
}

// =====================================================================
// Per-frame visuals
// =====================================================================
function stationStatus(st) {
  if (st.down) return 'down';
  const occ = st.occupant;
  if (occ && occ.state === 'processing' && occ.next === st.index && occ.line.units.includes(occ)) {
    return st.waiting ? 'idle' : 'working';
  }
  const blocked = st.line.units.some(
    (u) => (u.state === 'moving' && u.blocked && u.next === st.index + 1 && u.s - st.s < st.line.spacing) ||
      (u.state === 'atEnd' && st.index === st.line.stations.length - 1 && u.s - st.s < st.line.spacing),
  );
  return blocked ? 'blocked' : 'idle';
}

function animateRobot(r, working, simDt, realDt) {
  if (working) r.phase += simDt;
  const t = r.phase;
  const tgt = working
    ? {
        yaw: r.baseYaw + Math.sin(t * 1.3) * 0.55,
        sh: 0.55 + Math.sin(t * 2.1) * 0.22,
        el: 0.85 + Math.sin(t * 2.7 + 1) * 0.3,
        wr: 0.5 + Math.sin(t * 3.3) * 0.3,
      }
    : { yaw: r.baseYaw, sh: 0.05, el: 0.6, wr: 0.4 };
  const k = 1 - Math.exp(-8 * realDt);
  r.turret.rotation.y += (tgt.yaw - r.turret.rotation.y) * k;
  r.shoulder.rotation.x += (tgt.sh - r.shoulder.rotation.x) * k;
  r.elbow.rotation.x += (tgt.el - r.elbow.rotation.x) * k;
  r.wrist.rotation.x += (tgt.wr - r.wrist.rotation.x) * k;
}

let blink = 0;
function updateVisuals(simDt, realDt) {
  blink += realDt;
  const relax = 1 - Math.exp(-3 * realDt);
  for (const st of stations) {
    st.status = stationStatus(st);
    const color = st.status === 'down' ? (Math.floor(blink * 4) % 2 ? COLORS.red : 0x330000) : STATUS_COLOR[st.status];
    st.beaconMat.color.setHex(color);
    st.zoneMat.color.setHex(st === selected ? 0xffffff : st.status === 'down' ? COLORS.red : 0x8a929c);
    st.zoneMat.opacity = st === selected ? 0.9 : 0.5;
    const working = st.status === 'working' && !sim.paused;
    for (const r of st.robots) {
      animateRobot(r, working, simDt, realDt);
      if (working && Math.random() < 0.6) {
        r.tip.getWorldPosition(tmpV);
        if (st.cfg.sparks) sparks.emit(tmpV, 3);
        else if (st.cfg.id === 'p-booth') powder.emit(tmpV, 4);
      }
    }

    const e = st.extras;
    const occ = st.status === 'working' || (st.down && st.occupant) ? st.occupant : null;
    switch (st.cfg.id) {
      case 'chassis': {
        const y = occ ? CONV_Y + PACK.BASE + occ.frameDrop + FRAME_H + 0.15 : 6.6;
        e.hook.position.y += (y - e.hook.position.y) * (occ ? 1 : relax);
        setCable(e.cable, 6.85, e.hook.position.y);
        break;
      }
      case 'thermal':
        if (!occ) {
          e.carrierY += (6.2 - e.carrierY) * relax;
          e.carrier.visible = true;
        }
        e.carrier.position.y = e.carrierY;
        for (const c of e.cables) setCable(c, 6.85, e.carrierY + PACK.ROOF_H);
        break;
      case 'coolant':
        if (!occ) e.hoseY += (6.8 - e.hoseY) * relax;
        setCable(e.hose, 7.3, e.hoseY);
        break;
      case 'eol':
      case 'b-cmm':
        if (!occ) e.scanner.visible = false;
        e.leds.forEach((l, i) => {
          const on = occ ? Math.sin(blink * 9 + i * 1.7) > 0 : i % 3 === 0;
          l.material.color.setHex(on ? (occ ? COLORS.amber : COLORS.green) : 0x1a1d21);
        });
        break;
      case 'qa':
      case 'p-cool':
        e.ringMat.opacity = occ ? 0.55 + Math.sin(blink * 10) * 0.4 : 0.2;
        if (e.fans) e.fans.forEach((f) => { f.rotation.y += realDt * (occ ? 14 : 3); });
        break;
      case 'm-intake':
      case 'm-test': {
        const y = occ ? MOD_Y + 0.75 + Math.abs(Math.sin(blink * 3)) * 0.25 : e.headTop;
        e.head.position.y += (y - e.head.position.y) * relax * 3;
        setCable(e.headCable, st.sty.height, e.head.position.y + 0.17);
        e.leds.forEach((l, i) => {
          const on = occ ? Math.sin(blink * 9 + i * 1.7) > 0 : i % 3 === 0;
          l.material.color.setHex(on ? (occ ? COLORS.amber : COLORS.green) : 0x1a1d21);
        });
        break;
      }
      case 'm-pot':
        if (!occ) e.nozzleX += (0 - e.nozzleX) * relax;
        e.nozzle.position.x = e.nozzleX;
        break;
      case 'p-wash':
        if (occ && !sim.paused && Math.random() < 0.7) {
          const n = e.nozzles[Math.floor(Math.random() * e.nozzles.length)];
          mist.emit(st.group.localToWorld(tmpV.copy(n)), 2);
        }
        break;
      case 'p-oven':
        e.glowMat.color.setHex(occ ? 0xff7a1a : 0x9a3a10);
        break;
    }
  }

  // Shipping crane geometry
  crane.group.position.z = crane.z;
  crane.spreader.position.y = crane.hookY;
  for (const c of crane.cables) setCable(c, 10.5, crane.hookY + 0.15);
  for (const s of crane.slings) {
    const len = crane.load ? 0.15 : 0.6;
    s.scale.y = len;
    s.position.y = -len / 2 - 0.15;
  }

  // Rack shows module trays in stock
  moduleStock.crates.forEach((c, i) => { c.visible = i < moduleStock.count; });

  if (!sim.paused) {
    for (const a of agvs) {
      a.u = (a.u + (2.6 * simDt) / agvLen) % 1;
      const p = agvCurve.getPointAt(a.u);
      const t = agvCurve.getTangentAt(a.u);
      a.group.position.copy(p);
      a.group.rotation.y = Math.atan2(-t.z, t.x);
      a.cargo.visible = a.u > 0.72 || a.u < 0.3;
    }
    for (const w of workers) {
      if (w.pause > 0) {
        w.pause -= simDt;
        w.walk = 0;
      } else {
        const d = w.target - w.x;
        const step = 1.3 * simDt;
        if (Math.abs(d) <= step) {
          w.x = w.target;
          w.pause = THREE.MathUtils.randFloat(1.5, 6);
          w.target = THREE.MathUtils.randFloat(w.min, w.max);
        } else {
          w.x += Math.sign(d) * step;
          w.group.rotation.y = d > 0 ? Math.PI / 2 : -Math.PI / 2;
          w.walk += simDt * 9;
        }
      }
      w.group.position.set(w.x, Math.abs(Math.sin(w.walk)) * 0.06, w.z);
    }
  }

  sparks.update(realDt);
  powder.update(realDt);
  mist.update(realDt);
}

// =====================================================================
// Camera modes
// =====================================================================
const follow = { active: false, unit: null };
const tween = { active: false };
const CAMERA_PRESETS = {
  overview: { pos: [-34, 64, 96], target: [6, 0, -8] },
  modules: { pos: [20, 9, -4], target: [6, 1, MOD_Z] },
  biw: { pos: [92, 13, -11], target: [72, 1.5, BIW_Z] },
  paint: { pos: [24, 15, -8], target: [6, 2.5, BIW_Z] },
  shipping: { pos: [34, 16, 40], target: [PICK_X, 3, 8] },
};

// Newest pack that has cleared chassis load (so there is something to look at)
function pickFollowUnit() {
  const onLine = MAIN.units.slice().sort((a, b) => a.s - b.s);
  return onLine.find((u) => u.next >= 1) ?? onLine[0] ?? null;
}

function flyTo(pos, target, duration = 1.4) {
  tween.active = true;
  tween.t = 0;
  tween.duration = duration;
  tween.fromPos = camera.position.clone();
  tween.fromTarget = controls.target.clone();
  tween.toPos = new THREE.Vector3(...pos);
  tween.toTarget = new THREE.Vector3(...target);
}

function updateCamera(realDt) {
  if (tween.active) {
    tween.t += realDt / tween.duration;
    const k = ease(clamp01(tween.t));
    camera.position.lerpVectors(tween.fromPos, tween.toPos, k);
    controls.target.lerpVectors(tween.fromTarget, tween.toTarget, k);
    if (tween.t >= 1) tween.active = false;
  } else if (follow.active) {
    if (!follow.unit) follow.unit = pickFollowUnit();
    if (follow.unit) {
      const p = follow.unit.group.position;
      const goal = new THREE.Vector3(p.x, p.y + 1.5, p.z);
      const delta = goal.sub(controls.target);
      const k = 1 - Math.exp(-3 * realDt);
      controls.target.addScaledVector(delta, k);
      camera.position.addScaledVector(delta, k);
    }
  }
  controls.update();
}

// =====================================================================
// UI
// =====================================================================
const $ = (id) => document.getElementById(id);
let selected = null;
let activeTab = MAIN;
let uiTimer = 0;

const tabs = $('line-tabs');
const stationList = $('station-list');
for (const line of lines) {
  const tab = document.createElement('button');
  tab.className = 'tab';
  tab.textContent = line.name;
  tab.addEventListener('click', () => showTab(line));
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
      <span class="st-main">
        <span class="st-name">${st.cfg.name}</span>
        <span class="st-bar"><span class="st-fill"></span></span>
      </span>
      <span class="st-status"><i class="dot"></i><span class="st-label">Starved</span></span>`;
    row.addEventListener('click', () => selectStation(st, true));
    line.list.appendChild(row);
    st.row = row;
  }
}

function showTab(line) {
  activeTab = line;
  for (const l of lines) {
    l.list.hidden = l !== line;
    l.tab.classList.toggle('active', l === line);
  }
  updateUI(true);
}
showTab(MAIN);

function selectStation(st, focus) {
  selected = st;
  $('info').hidden = !st;
  if (st) {
    if (st.line !== activeTab) showTab(st.line);
    if (focus) {
      follow.active = false;
      setActive('cam', null);
      const p = st.group.position;
      const k = st.styleName === 'mini' ? 0.6 : 1;
      flyTo([p.x - 9 * k, 9 * k, p.z + 15 * k], [p.x, st.styleName === 'tunnel' ? 3 : 1.5, p.z]);
    }
  }
  updateUI(true);
}

function setActive(group, value) {
  document.querySelectorAll(`[data-${group}]`).forEach((b) => b.classList.toggle('active', b.dataset[group] === value));
}

document.querySelectorAll('[data-speed]').forEach((b) =>
  b.addEventListener('click', () => {
    sim.speed = Number(b.dataset.speed);
    setActive('speed', b.dataset.speed);
  }),
);
document.querySelectorAll('[data-cam]').forEach((b) =>
  b.addEventListener('click', () => {
    const mode = b.dataset.cam;
    setActive('cam', mode);
    follow.active = mode === 'follow';
    follow.unit = null;
    if (mode === 'follow') {
      const u = pickFollowUnit();
      follow.unit = u;
      if (u) {
        const p = u.group.position;
        flyTo([p.x - 12, 8, p.z + 14], [p.x, p.y + 1.5, p.z], 1.0);
      }
    } else {
      const p = CAMERA_PRESETS[mode];
      flyTo(p.pos, p.target);
      const tabFor = { modules: MODULE, biw: BIW, paint: PC };
      if (tabFor[mode]) showTab(tabFor[mode]);
    }
  }),
);
$('play').addEventListener('click', togglePause);
function togglePause() {
  sim.paused = !sim.paused;
  $('play').textContent = sim.paused ? '▶ Resume' : '❚❚ Pause';
  $('play').classList.toggle('active', sim.paused);
}
$('faults').addEventListener('change', (e) => { sim.faults = e.target.checked; });
$('info-close').addEventListener('click', () => selectStation(null));
$('info-fault').addEventListener('click', () => {
  if (!selected) return;
  if (selected.down) {
    selected.down = false;
    toast(`${selected.cfg.name} back in service`);
  } else breakStation(selected, 25);
  updateUI(true);
});
$('panel-toggle').addEventListener('click', () => document.body.classList.toggle('stations-open'));
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target === document.body) {
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
  while ($('toasts').children.length > 3) $('toasts').lastChild.remove();
  setTimeout(() => el.classList.add('out'), 3500);
  setTimeout(() => el.remove(), 4000);
}

function fmtClock(simSec) {
  const mins = Math.floor(simSec * FACTORY_MIN) + 6 * 60; // shift starts 06:00
  const day = Math.floor(mins / 1440) + 1;
  const hh = String(Math.floor((mins % 1440) / 60)).padStart(2, '0');
  const mm = String(mins % 60).padStart(2, '0');
  return `Day ${day} · ${hh}:${mm}`;
}

function fmtEnergy(mwh) {
  return mwh >= 1000 ? `${(mwh / 1000).toFixed(2)} GWh` : `${mwh.toFixed(1)} MWh`;
}

function updateUI(force = false) {
  uiTimer += 1;
  if (!force && uiTimer % 10) return;
  const ts = sim.shipTimes.slice(-12);
  const rate = ts.length >= 2 ? (ts.length - 1) / (((ts[ts.length - 1] - ts[0]) * FACTORY_MIN) / 60) : 0;
  const wip = MAIN.units.length + sim.shipping.filter((u) => u.state === 'lifted').length;
  const framesReady = PC.units.filter((u) => u.next >= PC.stations.length).length;

  $('k-clock').textContent = fmtClock(sim.time);
  $('k-shipped').textContent = sim.shipped;
  $('k-energy').textContent = fmtEnergy(sim.shipped * MWH_PER_UNIT);
  $('k-rate').textContent = rate ? rate.toFixed(2) : '—';
  $('k-annual').textContent = rate ? `${((rate * 24 * 365 * MWH_PER_UNIT) / 1000).toFixed(0)} GWh/yr` : '—';
  $('k-wip').textContent = wip;
  $('k-fpy').textContent = sim.tested ? `${((sim.firstPass / sim.tested) * 100).toFixed(1)}%` : '—';
  $('k-modules').textContent = `${moduleStock.count} trays`;
  $('k-modules').dataset.low = moduleStock.count < TRAYS_PER_PACK * 2;
  $('k-frames').textContent = framesReady;

  let bottleneck = null;
  for (const st of stations) {
    const util = sim.time > 0 ? st.workTime / sim.time : 0;
    if (!bottleneck || util > bottleneck.util) bottleneck = { st, util };
    if (st.line !== activeTab) continue;
    const occ = st.status === 'working' || st.down ? st.occupant : null;
    const p = occ ? clamp01(occ.t / occ.dur) : 0;
    st.row.querySelector('.st-fill').style.width = `${(p * 100).toFixed(0)}%`;
    st.row.dataset.status = st.status;
    st.row.querySelector('.st-label').textContent = st.waiting && !st.down ? 'No parts' : STATUS_LABEL[st.status];
    st.row.classList.toggle('selected', st === selected);
  }
  $('k-bottleneck').textContent = sim.time > 20 ? bottleneck.st.cfg.name : '—';
  for (const line of lines) {
    const down = line.stations.some((s) => s.down);
    line.tab.dataset.alert = down;
  }
  $('line-output').textContent = activeTab === MAIN
    ? `${sim.shipped} packs shipped`
    : `${activeTab.produced} ${activeTab.unitName} out`;

  if (selected) {
    const st = selected;
    const occ = st.occupant;
    $('info-num').textContent = `${st.line.name} · Station ${String(st.index + 1).padStart(2, '0')}`;
    $('info-name').textContent = st.cfg.name;
    $('info-desc').textContent = st.cfg.desc;
    $('info-status').textContent = st.waiting && !st.down ? 'No parts' : STATUS_LABEL[st.status];
    $('info-status').dataset.status = st.status;
    $('info-cycle').textContent = `${Math.round(st.cfg.cycle * FACTORY_MIN)} min`;
    $('info-done').textContent = st.processed;
    $('info-util').textContent = sim.time > 0 ? `${((st.workTime / sim.time) * 100).toFixed(0)}%` : '—';
    $('info-down').textContent = `${Math.round(st.downtime * FACTORY_MIN)} min`;
    $('info-unit').textContent = occ ? `${occ.id} · ${Math.round(clamp01(occ.t / occ.dur) * 100)}%` : '—';
    $('info-fault').textContent = st.down ? 'Clear fault' : 'Inject fault';
  }
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
  const realDt = Math.min(clock.getDelta(), 0.1);
  let simDt = 0;
  if (!sim.paused) {
    simDt = realDt * sim.speed;
    const steps = Math.ceil(simDt / 0.05);
    for (let i = 0; i < steps; i++) stepSim(simDt / steps);
  }
  updateVisuals(simDt, realDt);
  updateCamera(realDt);
  updateUI();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// Pre-warm so every line is populated on first view (no faults while warming up)
sim.faults = false;
for (let i = 0; i < 3200; i++) stepSim(0.1);
sim.faults = $('faults').checked;
for (const st of stations) {
  st.workTime = 0;
  st.downtime = 0;
  st.processed = 0;
}
for (const line of lines) line.produced = 0;
Object.assign(sim, { time: 0, shipped: 0, tested: 0, firstPass: 0, shipTimes: [] });
updateUI(true);
frame();
document.body.classList.add('ready');
window.megafactory = { sim, lines, stations, moduleStock }; // handy for poking at from the console
