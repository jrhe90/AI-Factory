import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  COLORS, PACK, TRUCK_BED, FRAME_H, FRAME_MATS, HANG, TRAY, mat, glow, box, cyl,
  createMegapack, createRoof, createRobot, createTruck, createAGV, createWorker,
  createFrame, setFrameMaterial, createCarrier, createModuleTray, createLiftAssist, createFinishedPack, createStraddleCarrier,
  makeSignTexture, makeWallTexture, makeFloorTexture, makePanelTexture, makeLabelTexture,
} from './models.js';
import { buildSite, SITE } from './site.js';

// =====================================================================
// Plant layout & timing
// =====================================================================
// Simulation time is in "sim seconds"; one sim second = FACTORY_MIN factory minutes.
// The pack line's End-of-Line test (~10 s + ~3.5 s transfer) paces the plant at about
// one pack every 68 minutes, the rate Tesla quotes for the Lathrop Megafactory. The
// feeder lines (Body in White, Powder Coat, Battery Modules) are sized to run slightly
// faster, so they fill their buffers and then block, as real feeder lines do.
const FACTORY_MIN = 5;
const TARGET_TAKT = 68; // minutes per pack
const MWH_PER_UNIT = 3.9;
const TRAYS_PER_PACK = 4; // 4 trays × 12 modules = 48 modules per pack

// Pack line (front of plant, flows +x)
const CONV_Y = 0.35; // packs ride low floor rails, not a roller conveyor
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
const ZONE_COLOR = 0x5a626b;
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
renderer.toneMappingExposure = 0.88;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc9d3dd);
scene.fog = new THREE.Fog(0xc9d3dd, 320, 950);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.5, 1600);
camera.position.set(-34, 64, 96);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(6, 0, -8);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2.05;
controls.minDistance = 4;
controls.maxDistance = 520;

scene.add(new THREE.HemisphereLight(0xf2f6ff, 0x7d838b, 0.75));
const sun = new THREE.DirectionalLight(0xfffaf2, 1.8);
sun.position.set(80, 180, 90);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -210, right: 210, top: 150, bottom: -150, near: 20, far: 520 });
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
let site = null;
const roofGroup = new THREE.Group(); // hidden when the camera rises above the roof
const bridgeCranes = [];

function buildFactory() {
  const floorTex = makeFloorTexture();
  floorTex.repeat.set(24, 9);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(199, 70),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.35, metalness: 0.08 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const paint = mat(COLORS.yellow, { roughness: 0.7 });
  const stripe = (x, z, w, d, m = paint) => {
    const s = box(w, 0.02, d, m, false);
    s.position.set(x, 0.01, z);
    s.receiveShadow = true;
    scene.add(s);
  };
  stripe(-4, -5.0, 128, 0.16);
  stripe(-4, 5.0, 128, 0.16);
  stripe(6, MOD_Z + 3.4, 74, 0.14);
  stripe(66, BIW_Z + 5.6, 64, 0.14);
  // Carrier route from the pickup pad to the south door
  for (const dx of [-5.6, 5.6]) stripe(PICK_X + dx, (TRUCK_Z + SITE.wallZ) / 2 - 1, 0.16, SITE.wallZ - TRUCK_Z + 2);
  // Red/white hatched no-go zone in front of the shipping crane
  const hatch = mat(COLORS.weldRed, { roughness: 0.7 });
  for (let i = 0; i < 8; i++) stripe(PICK_X - 7 + i * 2, 6.6, 0.9, 1.6, i % 2 ? paint : hatch);

  buildBuilding();
  buildFloorRails();
  buildConveyor(-29, 41, MOD_Z, MOD_Y, 1.8, 0.4);
  buildConveyor(31, 98.6, BIW_Z, BIW_Y, 2.3, 0.6);
  buildWarehouse();
  buildPaintRail();
  buildFeederDecor();
  buildBridgeCranes();
  site = buildSite(scene);
}

function buildBuilding() {
  // White columns on a 16 m grid, each with a grid label like the ones in the plant
  const white = mat(0xf1f3f5, { roughness: 0.5 });
  const rows = [
    { z: -34, letter: 'A', ok: () => true },
    { z: -12, letter: 'F', ok: (x) => x >= -16 },
    { z: 10, letter: 'G', ok: (x) => Math.abs(x - PICK_X) > 9 },
    { z: 34, letter: 'K', ok: () => true },
  ];
  rows.forEach((row) => {
    for (let x = -96, n = 1; x <= 96; x += 16, n++) {
      if (!row.ok(x)) continue;
      const c = box(0.6, 18, 0.6, white);
      c.position.set(x, 9, row.z);
      scene.add(c);
      if (Math.abs(row.z) < 30) {
        const tex = makeLabelTexture(row.letter + n);
        for (const side of [1, -1]) {
          const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.0), new THREE.MeshBasicMaterial({ map: tex }));
          lbl.position.set(x, 4.2, row.z + side * 0.31);
          if (side < 0) lbl.rotation.y = Math.PI;
          scene.add(lbl);
        }
      }
    }
  });

  // Roof: deck (faces down, so it is invisible from above), steel joists, girders and LED high-bays
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(199, 70), mat(0xd9dde2, { roughness: 0.9 }));
  deck.rotation.x = Math.PI / 2;
  deck.position.y = 19.2;
  scene.add(deck);
  const joistGeo = new THREE.BoxGeometry(0.12, 0.7, 68);
  const joistCount = Math.floor(192 / 2.4) + 1;
  const joists = new THREE.InstancedMesh(joistGeo, mat(0x5b6168, { metalness: 0.6, roughness: 0.5 }), joistCount);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < joistCount; i++) joists.setMatrixAt(i, m4.makeTranslation(-96 + i * 2.4, 18.6, 0));
  roofGroup.add(joists);
  for (const z of [-34, -12, 10, 34]) {
    const g = box(192, 1.0, 0.35, mat(0x50565e, { metalness: 0.6, roughness: 0.45 }), false);
    g.position.set(0, 18, z);
    roofGroup.add(g);
  }
  const lampGeo = new THREE.BoxGeometry(0.7, 0.12, 0.7);
  const lampPos = [];
  for (let x = -93; x <= 93; x += 6) for (let z = -30; z <= 30; z += 6) lampPos.push([x, z]);
  const lamps = new THREE.InstancedMesh(lampGeo, glow(0xffffff), lampPos.length);
  lampPos.forEach(([x, z], i) => lamps.setMatrixAt(i, m4.makeTranslation(x, 17.6, z)));
  roofGroup.add(lamps);
  scene.add(roofGroup);

  // Walls face inwards only: from outside you look straight in, from inside they close the room.
  const panelTex = makePanelTexture();
  const wallMat = (len) => {
    const t = panelTex.clone();
    t.needsUpdate = true;
    t.repeat.set(len / 4, 1);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 });
  };
  const wall = (x, z, len, rotY) => {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(len, 19.2), wallMat(len));
    w.position.set(x, 9.6, z);
    w.rotation.y = rotY;
    w.receiveShadow = true;
    scene.add(w);
  };
  wall(0, -34.4, 199, 0);
  // South wall has the straddle-carrier door
  const d0 = SITE.doorX - SITE.doorHalf;
  const d1 = SITE.doorX + SITE.doorHalf;
  wall((-99.5 + d0) / 2, 34.4, d0 + 99.5, Math.PI);
  wall((d1 + 99.5) / 2, 34.4, 99.5 - d1, Math.PI);
  const over = new THREE.Mesh(new THREE.PlaneGeometry(d1 - d0, 12.7), wallMat(d1 - d0));
  over.position.set(SITE.doorX, 6.5 + 6.35, 34.4);
  over.rotation.y = Math.PI;
  scene.add(over);
  for (const [x, rot] of [[-99.5, Math.PI / 2], [99.5, -Math.PI / 2]]) wall(x, 0, 68.8, rot);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(64, 8),
    new THREE.MeshStandardMaterial({ map: makeWallTexture(), roughness: 0.8 }),
  );
  sign.position.set(0, 13, -34.3);
  scene.add(sign);
}

// Pack line: pairs of low floor rails per station, with red end stops
function buildFloorRails() {
  const railMat = mat(0x8d949c, { metalness: 0.6, roughness: 0.4 });
  const stop = mat(COLORS.weldRed);
  const segs = [-64, -49, -35, -21, -7, 7, 21, 35, 49, 63];
  for (let i = 0; i < segs.length - 1; i++) {
    const x0 = segs[i] + 0.3;
    const x1 = segs[i + 1] - 0.3;
    for (const z of [-0.62, 0.62]) {
      const r = box(x1 - x0, CONV_Y - 0.02, 0.28, railMat);
      r.position.set((x0 + x1) / 2, (CONV_Y - 0.02) / 2, z);
      scene.add(r);
      for (const x of [x0 + 0.15, x1 - 0.15]) {
        const s = box(0.3, CONV_Y + 0.02, 0.3, stop);
        s.position.set(x, (CONV_Y + 0.02) / 2, z);
        scene.add(s);
      }
    }
    // Drive chain channel between the rails
    const ch = box(x1 - x0, 0.06, 0.25, mat(0x3a3e44), false);
    ch.position.set((x0 + x1) / 2, 0.03, 0);
    scene.add(ch);
  }
}

function buildConveyor(x0, x1, z, topY, width, pitch) {
  const len = x1 - x0;
  const cx = (x0 + x1) / 2;
  const bodyH = topY - 0.25;
  const body = box(len, bodyH, width, mat(0x8d949c, { metalness: 0.5, roughness: 0.45 }));
  body.position.set(cx, bodyH / 2 + 0.05, z);
  scene.add(body);
  for (const side of [-1, 1]) {
    const rail = box(len, 0.14, 0.1, mat(0xb4bac1, { metalness: 0.7, roughness: 0.35 }));
    rail.position.set(cx, topY - 0.04, z + side * (width / 2 + 0.05));
    scene.add(rail);
  }
  const rollerGeo = new THREE.CylinderGeometry(0.08, 0.08, width - 0.1, 10);
  rollerGeo.rotateX(Math.PI / 2);
  const count = Math.floor(len / pitch);
  const rollers = new THREE.InstancedMesh(rollerGeo, mat(0xc0c6cc, { metalness: 0.8, roughness: 0.3 }), count);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < count; i++) rollers.setMatrixAt(i, m4.makeTranslation(x0 + pitch / 2 + i * pitch, topY - 0.08, z));
  rollers.receiveShadow = true;
  scene.add(rollers);
}

// Yellow overhead bridge cranes with blue hoists over the pack line and BIW
function buildBridgeCranes() {
  const yellow = mat(COLORS.yellow, { metalness: 0.3, roughness: 0.5 });
  const blue = mat(COLORS.conveyorBlue, { metalness: 0.4, roughness: 0.4 });
  const specs = [
    { z0: -8, z1: 8, xMin: -60, xMax: 40, y: 13.2 },
    { z0: -8, z1: 8, xMin: -50, xMax: 46, y: 13.2 },
    { z0: BIW_Z - 7, z1: BIW_Z + 7, xMin: 52, xMax: 92, y: 12 },
  ];
  for (const sp of [specs[0], specs[2]]) {
    for (const z of [sp.z0, sp.z1]) {
      const runway = box(sp.xMax - sp.xMin + 18, 0.5, 0.35, mat(0x5b6168, { metalness: 0.6 }), false);
      runway.position.set((sp.xMin + sp.xMax) / 2, sp.y + 0.6, z);
      scene.add(runway);
    }
  }
  for (const sp of specs) {
    const g = new THREE.Group();
    const span = sp.z1 - sp.z0;
    const bridge = box(0.7, 0.8, span + 0.6, yellow);
    bridge.position.set(0, sp.y, (sp.z0 + sp.z1) / 2);
    g.add(bridge);
    const hoist = new THREE.Group();
    const body = box(1.0, 0.7, 0.8, blue);
    hoist.add(body);
    const cable = cyl(0.03, 0.03, 1, 6, mat(0x111111), false);
    hoist.add(cable);
    const hook = box(0.35, 0.3, 0.25, mat(COLORS.yellow));
    hoist.add(hook);
    hoist.position.set(0, sp.y - 0.75, (sp.z0 + sp.z1) / 2);
    g.add(hoist);
    scene.add(g);
    bridgeCranes.push({
      sp, g, hoist, cable, hook,
      x: THREE.MathUtils.randFloat(sp.xMin, sp.xMax), tx: sp.xMin, hz: 0, thz: 0, drop: 2, tdrop: 2, wait: 0,
    });
  }
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
    new THREE.TubeGeometry(pcPath, 600, 0.14, 8, false),
    mat(COLORS.conveyorBlue, { metalness: 0.5, roughness: 0.4 }),
  );
  rail.position.y = 0.22;
  rail.castShadow = true;
  scene.add(rail);
  // Hanger rods from the roof structure every ~7 m
  const L = pcPath.getLength();
  const rodMat = mat(0x8d949c, { metalness: 0.6, roughness: 0.4 });
  for (let s = 2; s < L; s += 7) {
    const p = pcPath.getPoint(s / L);
    const h = 18.3 - p.y;
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
  emitDir(p, dir, n, spread = 0.6) {
    for (let i = 0; i < n; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % this.count;
      this.pos.set([p.x, p.y, p.z], k * 3);
      this.vel[k * 3] = dir.x + (Math.random() - 0.5) * spread;
      this.vel[k * 3 + 1] = dir.y + (Math.random() - 0.5) * spread;
      this.vel[k * 3 + 2] = dir.z + (Math.random() - 0.5) * spread;
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
const mist = new Particles({ count: 500, color: 0xe8f2ff, size: 0.55, gravity: -0.4, speed: 0.9, up: 0.6, life: 1.8, opacity: 0.22, additive: false });
const water = new Particles({ count: 1400, color: 0xd6ecff, size: 0.09, gravity: 9.8, speed: 0, up: 0, life: 0.5, opacity: 0.8, additive: false });
const tmpC = new THREE.Vector3();
const tmpD = new THREE.Vector3();
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
    { id: 'chassis', name: 'Chassis Load', at: -56, cycle: 5, crew: [[-2.5, 1]],
      desc: 'A powder-coated frame comes down off the overhead paint conveyor and is lowered onto a steel skid.' },
    { id: 'busbar', name: 'HV Busbar & Harness', at: -42, cycle: 7, crew: [[-1.5, 1], [1.5, -1]],
      desc: 'Technicians build the high-voltage spine down the centre of the frame: vertical rails and orange insulated busbars.' },
    { id: 'modules', name: 'Module Install', at: -28, cycle: 9, assists: [[-2.4, -1], [2.4, 1]], crew: [[-1.2, -1], [1.2, 1]],
      consume: { buffer: moduleStock, n: TRAYS_PER_PACK },
      desc: `AGVs bring module trays from the rack warehouse. Operators use lift-assist arms to slide 48 modules (${TRAYS_PER_PACK} trays) into the bays from both sides.` },
    { id: 'thermal', name: 'Thermal & Inverter', at: -14, cycle: 8, platform: true, crew: [[-2, 1, true], [2, -1, true]],
      desc: 'An overhead hoist sets the integrated thermal roof (chillers, fans) and power-conversion electronics.' },
    { id: 'enclosure', name: 'Enclosure & Doors', at: 0, cycle: 8, assists: [[-2.4, 1], [2.4, -1]], crew: [[-1.2, 1], [1.2, -1]],
      desc: 'Sixteen side doors are hung and swung shut, then the end caps go on, sealing the enclosure against weather and dust.' },
    { id: 'coolant', name: 'Coolant Fill', at: 14, cycle: 6, platform: true, crew: [[2.5, -1, true], [-1, 1]],
      desc: 'The glycol coolant loop is vacuum-checked for leaks, then filled and bled.' },
    { id: 'eol', name: 'End-of-Line Test', at: 28, cycle: 10, failRate: 0.06, failText: 'insulation test', crew: [[-3, 1]],
      desc: 'Full functional test: insulation resistance, BMS comms and a charge/discharge pulse. Failures are re-tested.' },
    { id: 'qa', name: 'Final QA', at: 42, cycle: 5, crew: [[-1.5, 1], [1.5, -1]],
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
  speed: 3.5, spacing: 3.0, style: 'mini', yaw: Math.PI, autoSpawn: true,
  stations: [
    { id: 'm-intake', name: 'Cell Intake & Test', at: 38, cycle: 2.0,
      desc: 'Cylindrical cells are de-palletised, scanned and OCV/IR tested; a module tray is indexed onto the line.' },
    { id: 'm-insert', name: 'Cell Insertion', at: 29, cycle: 2.2, robots: [[0, 1]],
      desc: 'A robot loads 144 tested cells into the tray’s twelve module carriers.' },
    { id: 'm-weld', name: 'Interconnect Weld', at: 20, cycle: 2.2, robots: [[0, -1]], sparks: true,
      desc: 'Laser welding joins every cell to the copper current-collector plates.' },
    { id: 'm-pot', name: 'Adhesive & Potting', at: 11, cycle: 2.0,
      desc: 'A dispensing head fills the gaps with thermally-conductive potting compound.' },
    { id: 'm-lid', name: 'Module Lid & BMS Board', at: 2, cycle: 2.2, robots: [[0, 1]], gripper: true,
      desc: 'A robot with a red gripper places module lids and the green battery-management boards on top.' },
    { id: 'm-test', name: 'Module EOL Test', at: -7, cycle: 2.2, failRate: 0.03, failText: 'module isolation test',
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
    case 'busbar':
      revealCount(u.hv, p);
      break;
    case 'modules': {
      // Modules slide in one after another, alternating sides
      const m = u.modules;
      const f = p * m.total;
      const n = Math.min(m.total, Math.floor(f) + 1);
      m.setCount(p >= 1 ? m.total : n);
      for (let i = Math.max(0, n - 2); i < n; i++) m.place(i, Math.max(0, 1 - ease(clamp01(f - i))) * 1.6);
      break;
    }
    case 'thermal':
      e.carrierY = THREE.MathUtils.lerp(6.2, CONV_Y + PACK.FRAME_TOP, ease(clamp01(p / 0.8)));
      if (p >= 0.85) {
        u.roof.visible = true;
        e.carrier.visible = false;
      }
      break;
    case 'enclosure': {
      // Each door appears open and swings shut on its hinge
      const f = p * u.doors.length;
      u.doors.forEach((d, i) => {
        const k = clamp01(f - i);
        d.visible = k > 0;
        if (d.userData.side) d.rotation.y = -d.userData.side * (1 - ease(k)) * 1.4;
      });
      break;
    }
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
      u.welds.count = Math.floor(p * TRAY.MODULES);
      break;
    case 'm-pot':
      u.potting.count = Math.floor(p * TRAY.MODULES);
      e.nozzleX = Math.sin(p * Math.PI * 6) * (TRAY.L / 2 - 0.3);
      break;
    case 'm-lid':
      u.lids.count = Math.floor(p * TRAY.MODULES);
      u.pcbs.count = Math.floor(clamp01(p * 1.15 - 0.15) * TRAY.MODULES);
      if (p >= 1) {
        // Everything under the lids is hidden now – skip drawing it
        u.cells.visible = u.welds.visible = u.potting.visible = false;
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

  const frameMat = mat(0x9aa1a9, { metalness: 0.6, roughness: 0.4 });
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
  st.zoneMat = new THREE.LineBasicMaterial({ color: ZONE_COLOR, transparent: true, opacity: 0.6 });
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
    // Yellow 6-axis robots; paint robots wear white covers; module-line gripper is red
    const color = line === PC ? 0xeef0f2 : COLORS.fanuc;
    const r = createRobot(color, sty.robotScale, cfg.gripper ? COLORS.weldRed : COLORS.dark);
    r.root.position.set(dx, 0, side * -sty.robotZ);
    r.baseYaw = side < 0 ? Math.PI : 0;
    r.turret.rotation.y = r.baseYaw;
    r.phase = Math.random() * 10;
    st.group.add(r.root);
    st.robots.push(r);
    if (cfg.sparks) {
      // Red welding power source next to each weld robot
      const welder = box(0.7 * sty.robotScale + 0.2, 0.9, 0.55, mat(COLORS.weldRed, { roughness: 0.5 }));
      welder.position.set(dx + (dx >= 0 ? 1.3 : -1.3) * sty.robotScale, 0.45, side * -(sty.robotZ + 0.6));
      st.group.add(welder);
    }
  }
  st.assists = [];
  for (const [dx, side] of cfg.assists ?? []) {
    const a = createLiftAssist();
    a.root.position.set(dx, 0, side * 3.4);
    a.baseYaw = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    a.arm1.rotation.y = a.baseYaw + 0.9;
    a.arm2.rotation.y = -1.6;
    a.phase = Math.random() * 10;
    st.group.add(a.root);
    st.assists.push(a);
  }
  if (cfg.platform) {
    // Elevated work platforms on both sides for top-of-pack access
    const deckY = CONV_Y + PACK.FRAME_TOP - 0.2;
    const steel = mat(0x8d949c, { metalness: 0.5, roughness: 0.5 });
    for (const side of [-1, 1]) {
      const deck = box(9, 0.12, 1.3, mat(0x6b7178, { metalness: 0.4, roughness: 0.6 }));
      deck.position.set(0, deckY, side * 2.05);
      st.group.add(deck);
      const rail = box(9, 0.06, 0.06, mat(COLORS.yellow));
      rail.position.set(0, deckY + 1.05, side * 2.65);
      st.group.add(rail);
      for (const x of [-4.4, -1.5, 1.5, 4.4]) {
        const leg = box(0.12, deckY, 0.12, steel);
        leg.position.set(x, deckY / 2, side * 2.6);
        st.group.add(leg);
        const post = box(0.05, 1.05, 0.05, mat(COLORS.yellow));
        post.position.set(x, deckY + 0.52, side * 2.65);
        st.group.add(post);
      }
    }
  }
  st.crew = [];
  for (const [dx, side, onPlatform] of cfg.crew ?? []) {
    const colors = [0xff7a1a, 0xf2e21a, 0x9be22e];
    const w = createWorker(colors[(index + st.crew.length) % 3]);
    const y = onPlatform ? CONV_Y + PACK.FRAME_TOP - 0.14 : 0;
    w.position.set(dx, y, side * (onPlatform ? 2.0 : 1.55));
    w.rotation.y = side > 0 ? Math.PI : 0;
    w.userData = { baseX: dx, y, phase: Math.random() * 10 };
    st.group.add(w);
    st.crew.push(w);
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

// Red translucent welding-curtain walls on aluminium posts (open at both ends for the conveyor)
const curtainMat = new THREE.MeshStandardMaterial({
  color: 0xd0142c, transparent: true, opacity: 0.55, roughness: 0.4, side: THREE.DoubleSide, depthWrite: false,
});
function weldCell(g, len, halfZ, h) {
  const post = mat(0xc0c6cc, { metalness: 0.7, roughness: 0.35 });
  for (const z of [-halfZ, halfZ]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(len, h), curtainMat);
    wall.position.set(0, h / 2 + 0.15, z);
    g.add(wall);
    for (let x = -len / 2; x <= len / 2 + 0.01; x += len / 5) {
      const p = box(0.08, h + 0.2, 0.08, post);
      p.position.set(x, (h + 0.2) / 2, z);
      g.add(p);
    }
    const top = box(len, 0.08, 0.08, post);
    top.position.set(0, h + 0.2, z);
    g.add(top);
  }
}

const guardPanelMat = new THREE.MeshStandardMaterial({
  color: 0xdfe8ef, transparent: true, opacity: 0.18, roughness: 0.1, side: THREE.DoubleSide, depthWrite: false,
});
function moduleGuard(g, halfX, halfZ, h) {
  const alu = mat(0xc4cad0, { metalness: 0.7, roughness: 0.35 });
  for (const x of [-halfX, halfX]) {
    for (const z of [-halfZ, halfZ]) {
      const p = box(0.07, h, 0.07, alu);
      p.position.set(x, h / 2, z);
      g.add(p);
    }
  }
  for (const z of [-halfZ, halfZ]) {
    for (const y of [0.15, h]) {
      const r = box(halfX * 2, 0.07, 0.07, alu, false);
      r.position.set(0, y, z);
      g.add(r);
    }
  }
  // Clear panel on the back side
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(halfX * 2, h - 0.2), guardPanelMat);
  panel.position.set(0, h / 2 + 0.05, halfZ);
  g.add(panel);
  // Yellow/black light-curtain posts at the cell entry
  for (const z of [-halfZ + 0.3, halfZ - 0.3]) {
    const lc = box(0.08, 1.6, 0.08, mat(COLORS.yellow), false);
    lc.position.set(halfX - 0.1, 0.9, z);
    g.add(lc);
    const band = box(0.09, 0.2, 0.09, mat(0x111111), false);
    band.position.set(halfX - 0.1, 1.55, z);
    g.add(band);
  }
}

function buildStationExtras(st) {
  const g = st.group;
  const e = st.extras;
  const sty = st.sty;
  if (st.line === MODULE) moduleGuard(g, 3.9, 2.35, 2.2);
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
      weldCell(g, 11, 5.0, 2.6);
      // Red fixture rails and pneumatic clamps holding the frame during welding
      const red = mat(COLORS.weldRed, { roughness: 0.5, metalness: 0.2 });
      for (const z of [-1.25, 1.25]) {
        const rail = box(9.6, 0.25, 0.3, red);
        rail.position.set(0, BIW_Y + 0.12, z);
        g.add(rail);
        for (const x of [-4, -2, 0, 2, 4]) {
          const c = box(0.22, 0.5, 0.22, red);
          c.position.set(x, BIW_Y + 0.5, z * 1.1);
          g.add(c);
          const cyl1 = cyl(0.06, 0.06, 0.4, 8, mat(0xc0c6cc, { metalness: 0.8 }));
          cyl1.position.set(x, BIW_Y + 0.95, z * 1.1);
          g.add(cyl1);
        }
      }
      // Fume extraction hood over the cell
      const hood = box(6, 0.5, 2.6, mat(0xb4bac1, { metalness: 0.6 }));
      hood.position.set(0, 6.4, 0);
      g.add(hood);
      const duct = cyl(0.35, 0.35, 1.0, 12, mat(0xb4bac1, { metalness: 0.6 }));
      duct.position.set(0, 7.1, 0);
      g.add(duct);
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
    case 'p-wash': {
      // Stainless tunnel with chamfered roof; the near wall is glass so the spray is visible
      const ss = mat(0xc9d0d7, { metalness: 0.85, roughness: 0.28 });
      const glass = new THREE.MeshStandardMaterial({ color: 0xbfd6e8, transparent: true, opacity: 0.18, roughness: 0.05, depthWrite: false });
      const h = sty.height;
      const wallH = h - 1.0;
      const back = box(10, wallH, 0.08, ss);
      back.position.set(0, wallH / 2, sty.halfZ);
      g.add(back);
      const front = new THREE.Mesh(new THREE.BoxGeometry(10, wallH, 0.05), glass);
      front.position.set(0, wallH / 2, -sty.halfZ);
      g.add(front);
      for (const side of [-1, 1]) {
        const ch = box(10, 1.45, 0.08, side > 0 ? ss : glass);
        ch.position.set(0, wallH + 0.5, side * (sty.halfZ - 0.5));
        ch.rotation.x = side * 0.78;
        g.add(ch);
      }
      const roof = box(10, 0.08, sty.halfZ * 2 - 2.0, ss);
      roof.position.set(0, h, 0);
      g.add(roof);
      // Vertical risers with orange nozzles on both inner walls
      e.nozzles = [];
      const riser = mat(0x2b2f35, { metalness: 0.5 });
      const nozzle = mat(COLORS.hvOrange);
      for (let x = -4.5; x <= 4.5; x += 0.9) {
        for (const side of [-1, 1]) {
          const z = side * (sty.halfZ - 0.25);
          const r = cyl(0.04, 0.04, wallH - 0.4, 6, riser, false);
          r.position.set(x, wallH / 2 + 0.1, z);
          g.add(r);
          for (let y = 0.8; y < wallH; y += 0.75) {
            const n = box(0.1, 0.08, 0.12, nozzle, false);
            n.position.set(x, y, z - side * 0.08);
            g.add(n);
            if ((x * 10 + y * 7) % 3 < 1.2) e.nozzles.push({ p: new THREE.Vector3(x, y, z - side * 0.12), side });
          }
        }
      }
      // Drain grating
      const grate = box(10, 0.05, sty.halfZ * 2 - 0.2, mat(0x5b6168, { metalness: 0.6 }), false);
      grate.position.set(0, 0.03, 0);
      g.add(grate);
      break;
    }
    case 'p-booth': {
      const wall = mat(0xc5cfc9, { roughness: 0.7 });
      const glass = new THREE.MeshStandardMaterial({ color: 0xdfe8e4, transparent: true, opacity: 0.16, roughness: 0.05, depthWrite: false });
      const back = box(10, sty.height, 0.1, wall);
      back.position.set(0, sty.height / 2, sty.halfZ);
      g.add(back);
      const front = new THREE.Mesh(new THREE.BoxGeometry(10, sty.height, 0.05), glass);
      front.position.set(0, sty.height / 2, -sty.halfZ);
      g.add(front);
      const roof = box(10, 0.12, sty.halfZ * 2, wall);
      roof.position.set(0, sty.height, 0);
      g.add(roof);
      // Tall light panels set into the back wall
      for (const x of [-3.6, -1.2, 1.2, 3.6]) {
        const lp = box(0.55, 2.6, 0.02, glow(0xf4f8ff), false);
        lp.position.set(x, 2.4, sty.halfZ - 0.06);
        g.add(lp);
      }
      break;
    }
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
  // Pickup pad where the crane sets finished packs down for the straddle carriers
  const pad = box(10.5, 0.04, 3.4, mat(0x3b3f45, { roughness: 0.9 }), false);
  pad.position.set(PICK_X, 0.02, TRUCK_Z);
  pad.receiveShadow = true;
  scene.add(pad);
}

// =====================================================================
// Outbound logistics: pickup pad → straddle carriers → storage lot → trucks
// =====================================================================
// The crane sets each finished pack on a pad inside the building. Tandem pairs of red
// straddle carriers take it out through the south door to the storage lot, and later load
// stored packs onto outbound trucks on the south road. A full lot backs up the pack line.
const PAD = { x: PICK_X, z: TRUCK_Z, unit: null, claimed: false };
const LANE_Z = 54; // carrier cross lane between the dock trailers and the lot
const AISLES = [19, 57, 95]; // carrier aisles through the lot (run north–south)
const SLOT_OFFSET = 9.5; // aisle centre → slot centre (a carried pack is 8.8 m long)
const ROW_Z0 = 59;
const ROW_PITCH = 3.6;
const ROWS = 10;
const BAY_X = 70; // trailer centre of the truck being loaded
const HOLD_X = 28; // the next truck waits here, clear of the carrier aisle
const TRUCK_START = -300;
const TRUCK_END = 300;
const BEAM_GRIP = 1.0; // lift-beam height above the pack's underside when gripping
const BEAM = { empty: 3.9, carry: BEAM_GRIP + 1.5, ground: BEAM_GRIP, truck: BEAM_GRIP + TRUCK_BED };
const CARRIER_SPEED = 15; // sim m/s (time is compressed: 1 s = 5 factory minutes)

const slots = [];
for (const ax of AISLES) {
  for (const side of [-1, 1]) {
    for (let r = 0; r < ROWS; r++) {
      slots.push({ x: ax + side * SLOT_OFFSET, z: ROW_Z0 + r * ROW_PITCH, aisle: ax, unit: null, reserved: false, at: 0 });
    }
  }
}
// Fill the slots closest to the door first
slots.sort((a, b) => Math.abs(a.x - SITE.doorX) + a.z * 0.6 - (Math.abs(b.x - SITE.doorX) + b.z * 0.6));
let yardSerial = 0;
function storeFinished(slot, id) {
  const group = createFinishedPack();
  group.position.set(slot.x, 0, slot.z);
  scene.add(group);
  slot.unit = { id, group };
  slot.at = sim.time - 100 + slot.z;
}

// Waypoints from a location out to the cross lane; routes are access(from) + reverse(access(to)).
function access(loc) {
  switch (loc.type) {
    case 'pad': return [[PAD.x, PAD.z], [PAD.x, LANE_Z]];
    case 'door': return [[SITE.doorX, SITE.wallZ + 6], [SITE.doorX, LANE_Z]];
    case 'slot': return [[loc.slot.x, loc.slot.z], [loc.slot.aisle, loc.slot.z], [loc.slot.aisle, LANE_Z]];
    case 'aisle': return [[loc.slot.aisle, loc.slot.z], [loc.slot.aisle, LANE_Z]];
    case 'truck': return [[BAY_X, SITE.roadZ], [SITE.doorX, SITE.roadZ], [SITE.doorX, LANE_Z]];
    case 'roadside': return [[SITE.doorX, SITE.roadZ], [SITE.doorX, LANE_Z]];
    default: return [[loc.p[0], loc.p[1]], [loc.p[0], LANE_Z]];
  }
}
function route(from, to) {
  const a = access(from);
  const b = access(to).reverse();
  // Same aisle: skip the trip up to the cross lane
  if (a.length > 1 && b.length > 1 && a[a.length - 2][0] === b[1][0]) return [...a.slice(0, -1), ...b.slice(1)];
  return [...a, ...b];
}

const carriers = [];
const CARRIER_STAND = [[118, 62], [118, 74], [118, 86]];
CARRIER_STAND.forEach((stand, i) => {
  const g = new THREE.Group();
  const frames = [-1, 1].map((s) => {
    const c = createStraddleCarrier();
    c.group.position.x = s * 2.85;
    c.group.rotation.y = s > 0 ? 0 : Math.PI;
    g.add(c.group);
    return c;
  });
  scene.add(g);
  carriers.push({
    id: `SC-${i * 2 + 1}/${i * 2 + 2}`, g, frames, x: stand[0], z: stand[1], beam: BEAM.empty,
    load: null, steps: [], stand, loc: { type: 'stand', p: stand }, task: 'Parked',
  });
});

function assignJob(c) {
  // 1) Store: a finished pack is waiting on the pad
  if (PAD.unit && !PAD.claimed) {
    const slot = slots.find((s) => !s.unit && !s.reserved);
    if (slot) {
      PAD.claimed = true;
      slot.reserved = true;
      c.task = 'To pad';
      c.steps = [
        { go: route(c.loc, { type: 'pad' }) },
        { beam: BEAM.ground },
        { fn: () => { c.load = PAD.unit; PAD.unit = null; c.task = `Storing ${c.load.id}`; } },
        { beam: BEAM.carry },
        { go: [[PAD.x, SITE.wallZ + 6]] },
        { fn: () => { PAD.claimed = false; } }, // pad is free once we are out of the door
        { go: route({ type: 'door' }, { type: 'slot', slot }) },
        { beam: BEAM.ground },
        { fn: () => { slot.unit = c.load; slot.at = sim.time; slot.reserved = false; c.load = null; } },
        { beam: BEAM.empty },
        { fn: () => { c.loc = { type: 'slot', slot }; c.task = 'Idle'; } },
      ];
      return;
    }
  }
  // 2) Load: a truck is waiting at the loading bay (first in, first out from the lot)
  const truck = trucks.find((t) => t.state === 'atBay' && !t.claimed);
  if (truck) {
    const slot = slots.filter((s) => s.unit && !s.reserved).sort((a, b) => a.at - b.at)[0];
    if (slot) {
      truck.claimed = true;
      slot.reserved = true;
      c.task = 'To lot';
      c.steps = [
        { go: route(c.loc, { type: 'slot', slot }) },
        { beam: BEAM.ground },
        { fn: () => { c.load = slot.unit; slot.unit = null; c.task = `Loading ${c.load.id}`; } },
        { beam: BEAM.carry },
        { go: [[slot.aisle, slot.z]] },
        { fn: () => { slot.reserved = false; } },
        { go: route({ type: 'aisle', slot }, { type: 'truck' }) },
        { beam: BEAM.truck },
        { fn: () => { truck.load = c.load; c.load = null; } },
        { beam: BEAM.empty },
        { go: [[SITE.doorX, SITE.roadZ]] }, // back off the trailer before it pulls away
        { fn: () => { truck.state = 'leave'; c.loc = { type: 'roadside' }; c.task = 'Idle'; } },
      ];
      return;
    }
  }
  // 3) Nothing to do: return to the stand
  if (c.loc.type !== 'stand') {
    c.task = 'Returning';
    c.steps = [
      { go: route(c.loc, { type: 'stand', p: c.stand }) },
      { fn: () => { c.loc = { type: 'stand', p: c.stand }; c.task = 'Parked'; } },
    ];
  }
}

function hasWork() {
  const free = slots.some((sl) => !sl.unit && !sl.reserved);
  const stocked = slots.some((sl) => sl.unit && !sl.reserved);
  return (PAD.unit && !PAD.claimed && free) || (stocked && trucks.some((t) => t.state === 'atBay' && !t.claimed));
}

function stepCarriers(dt) {
  for (const c of carriers) {
    // A carrier heading back to its stand can take new work once it is on the cross lane
    if (c.task === 'Returning' && Math.abs(c.z - LANE_Z) < 1e-3 && hasWork()) {
      c.steps = [];
      c.loc = { type: 'here', p: [c.x, c.z] };
    }
    if (!c.steps.length) assignJob(c);
    const s = c.steps[0];
    if (s) {
      if (s.go) {
        let budget = CARRIER_SPEED * dt;
        while (budget > 0 && s.go.length) {
          const [tx, tz] = s.go[0];
          const dx = tx - c.x;
          const dz = tz - c.z;
          const d = Math.hypot(dx, dz);
          if (d <= budget) {
            c.x = tx;
            c.z = tz;
            budget -= d;
            s.go.shift();
          } else {
            c.x += (dx / d) * budget;
            c.z += (dz / d) * budget;
            budget = 0;
          }
        }
        if (!s.go.length) c.steps.shift();
      } else if (s.beam !== undefined) {
        const step = 3.2 * dt;
        c.beam = Math.abs(s.beam - c.beam) <= step ? s.beam : c.beam + Math.sign(s.beam - c.beam) * step;
        if (c.beam === s.beam) c.steps.shift();
      } else if (s.fn) {
        c.steps.shift();
        s.fn();
      }
    }
    c.g.position.set(c.x, 0, c.z);
    for (const f of c.frames) f.lift.position.y = c.beam;
    if (c.load) c.load.group.position.set(c.x, c.beam - BEAM_GRIP, c.z);
  }
}

const trucks = [];
function stepTrucks(dt) {
  const last = trucks[trucks.length - 1];
  if (sim.time >= sim.nextTruck && trucks.length < 4 && (!last || last.x > TRUCK_START + 20)) {
    const t = { ...createTruck(), state: 'arrive', x: TRUCK_START, load: null, claimed: false, v: 0 };
    t.group.position.set(t.x, 0, SITE.roadZ);
    scene.add(t.group);
    trucks.push(t);
    // Logistics books trucks against stock: more when the lot is filling, fewer when it is low
    const stored = slots.filter((sl) => sl.unit).length;
    const [lo, hi] = stored > 40 ? [8, 12] : stored < 12 ? [17, 24] : [14, 20];
    sim.nextTruck = sim.time + THREE.MathUtils.randFloat(lo, hi);
  }
  const bayBusy = trucks.some((t) => t.state === 'atBay');
  let ahead = null; // trucks array is ordered front (highest x) to back
  for (const t of trucks) {
    if (t.state === 'leave') {
      t.v = Math.min(16, t.v + 8 * dt);
      t.x += t.v * dt;
    } else if (t.state === 'arrive') {
      let goal = bayBusy ? HOLD_X : BAY_X;
      if (ahead) goal = Math.min(goal, ahead.x - 18);
      const v = Math.min(14, Math.max(1.5, (goal - t.x) * 2));
      t.x = Math.min(goal, t.x + v * dt);
      if (!bayBusy && t.x >= BAY_X - 1e-3) {
        t.x = BAY_X;
        t.state = 'atBay';
      }
    }
    t.group.position.x = t.x;
    if (t.load) t.load.group.position.set(t.x, TRUCK_BED, SITE.roadZ);
    ahead = t;
  }
  // Shipped: truck has left the site
  while (trucks.length && trucks[0].x > TRUCK_END) {
    const t = trucks.shift();
    scene.remove(t.group);
    if (t.load) {
      scene.remove(t.load.group);
      sim.shipped++;
      sim.shipTimes.push(sim.time);
      if (follow.unit === t.load) follow.unit = null;
    }
  }
}

// =====================================================================
// AGVs and workers (ambient life)
// =====================================================================
const agvCurve = new THREE.CatmullRomCurve3(
  [
    [-70, -12.5], [-56, -10.5], [-40, -9.4], [-31, -7.9], [-24, -8.6], [-24.5, -12.4],
    [-36, -14.4], [-52, -16.5], [-66, -17], [-74, -15],
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
  { z: -5.8, min: -60, max: -10, color: 0xff7a1a },
  { z: 5.8, min: -40, max: 10, color: 0xf2e21a },
  { z: -5.8, min: -5, max: 45, color: 0xff7a1a },
  { z: 5.8, min: 15, max: 50, color: 0x9be22e },
  { z: 10.5, min: 46, max: 68, color: 0xf2e21a },
  { z: -10, min: -76, max: -50, color: 0xff7a1a },
  { z: MOD_Z + 3.0, min: -8, max: 38, color: 0x9be22e },
  { z: BIW_Z + 5.9, min: 50, max: 92, color: 0xff7a1a },
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
  shipped: 0, tested: 0, firstPass: 0, shipTimes: [], doneTimes: [], nextTruck: 2,
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
  stepCarriers(dt);
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
  const padHook = PACK.HEIGHT + 0.15;
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
        crane.state = 'lift';
      }
      break;
    case 'lift':
      crane.hookY = toward(crane.hookY, high, ySpeed);
      if (crane.hookY === high) crane.state = 'waitPad';
      break;
    case 'waitPad':
      // Hold the pack until the pickup pad is clear (a full storage lot backs up the line here)
      if (!PAD.unit && !PAD.claimed) crane.state = 'traverse';
      break;
    case 'traverse':
      crane.z = toward(crane.z, TRUCK_Z, zSpeed);
      if (crane.z === TRUCK_Z) crane.state = 'lowerPad';
      break;
    case 'lowerPad':
      crane.hookY = toward(crane.hookY, padHook, ySpeed);
      if (crane.hookY === padHook) {
        // Swap the detailed model for a single-mesh finished pack for the rest of its trip
        const fin = { id: crane.load.id, group: createFinishedPack() };
        fin.group.position.set(PAD.x, 0, PAD.z);
        scene.add(fin.group);
        scene.remove(crane.load.group);
        if (follow.unit === crane.load) follow.unit = fin;
        PAD.unit = fin;
        crane.load = null;
        sim.doneTimes.push(sim.time);
        crane.state = 'raise';
      }
      break;
    case 'raise':
      crane.hookY = toward(crane.hookY, high, ySpeed);
      if (crane.hookY === high) crane.state = 'return';
      break;
    case 'return':
      crane.z = toward(crane.z, 0, zSpeed);
      if (crane.z === 0) crane.state = 'idle';
      break;
  }

  if (crane.load) crane.load.group.position.set(PICK_X, crane.hookY - PACK.HEIGHT - 0.15, crane.z);
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
    st.zoneMat.color.setHex(st === selected ? 0x111111 : st.status === 'down' ? COLORS.red : ZONE_COLOR);
    st.zoneMat.opacity = st === selected ? 1 : 0.6;
    const working = st.status === 'working' && !sim.paused;
    for (const a of st.assists) {
      if (working) a.phase += simDt;
      const k = 1 - Math.exp(-4 * realDt);
      const t1 = working ? a.baseYaw + Math.sin(a.phase * 0.9) * 0.45 : a.baseYaw + 0.9;
      const t2 = working ? -0.4 + Math.sin(a.phase * 1.3 + 1) * 0.5 : -1.6;
      a.arm1.rotation.y += (t1 - a.arm1.rotation.y) * k;
      a.arm2.rotation.y += (t2 - a.arm2.rotation.y) * k;
    }
    for (const w of st.crew) {
      const d = w.userData;
      if (working) d.phase += simDt * 3;
      w.position.x = d.baseX + (working ? Math.sin(d.phase * 0.4) * 0.6 : 0);
      w.position.y = d.y + (working ? Math.abs(Math.sin(d.phase)) * 0.04 : 0);
      w.rotation.z = working ? Math.sin(d.phase * 0.7) * 0.06 : 0;
    }
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
        if (occ && !sim.paused) {
          for (let i = 0; i < 6; i++) {
            const n = e.nozzles[Math.floor(Math.random() * e.nozzles.length)];
            st.group.localToWorld(tmpV.copy(n.p));
            st.group.localToWorld(tmpC.set(n.p.x, n.p.y - 0.4, 0));
            tmpD.copy(tmpC).sub(tmpV).normalize().multiplyScalar(5.5);
            water.emitDir(tmpV, tmpD, 3, 0.8);
          }
          if (Math.random() < 0.5) mist.emit(st.group.localToWorld(tmpV.set(0, 1.5, 0)), 2);
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
      a.cargo.visible = a.u > 0.75 || a.u < 0.36;
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

  if (!sim.paused) {
    for (const b of bridgeCranes) {
      const toward = (v, t, step) => (Math.abs(t - v) <= step ? t : v + Math.sign(t - v) * step);
      if (b.wait > 0) {
        b.wait -= simDt;
        if (b.wait <= 0) {
          b.tx = THREE.MathUtils.randFloat(b.sp.xMin, b.sp.xMax);
          b.thz = THREE.MathUtils.randFloat(-0.35, 0.35) * (b.sp.z1 - b.sp.z0);
        }
        // Lower the hook while parked, raise it before moving off
        b.tdrop = b.wait > 1.5 ? 6 : 2;
      } else {
        b.tdrop = 2;
        if (b.drop <= 2.01) {
          b.x = toward(b.x, b.tx, 3 * simDt);
          b.hz = toward(b.hz, b.thz, 1.5 * simDt);
        }
        if (b.x === b.tx && b.hz === b.thz) b.wait = THREE.MathUtils.randFloat(4, 9);
      }
      b.drop = toward(b.drop, b.tdrop, 2 * simDt);
      b.g.position.x = b.x;
      b.hoist.position.z = (b.sp.z0 + b.sp.z1) / 2 + b.hz;
      b.cable.scale.y = b.drop;
      b.cable.position.y = -0.35 - b.drop / 2;
      b.hook.position.y = -0.35 - b.drop - 0.15;
    }
  }
  roofGroup.visible = camera.position.y < 18;
  if (!sim.paused) site.update(simDt);

  sparks.update(realDt);
  powder.update(realDt);
  mist.update(realDt);
  water.update(realDt);
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
  lot: { pos: [8, 34, 132], target: [57, 0, 70] },
  site: { pos: [-90, 250, 330], target: [0, 0, 10] },
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
  const ts = sim.doneTimes.slice(-12); // packs completed at the end of the line
  const rate = ts.length >= 2 ? (ts.length - 1) / (((ts[ts.length - 1] - ts[0]) * FACTORY_MIN) / 60) : 0;
  const wip = MAIN.units.length + (crane.load ? 1 : 0);
  const framesReady = PC.units.filter((u) => u.next >= PC.stations.length).length;

  $('k-clock').textContent = fmtClock(sim.time);
  $('k-shipped').textContent = sim.shipped;
  $('k-energy').textContent = fmtEnergy(sim.shipped * MWH_PER_UNIT);
  $('k-rate').textContent = rate ? `${Math.round(60 / rate)} min` : '—';
  $('k-rate').dataset.low = rate > 0 && 60 / rate > TARGET_TAKT * 1.05;
  $('k-annual').textContent = rate ? `${((rate * 24 * 365 * MWH_PER_UNIT) / 1000).toFixed(0)} GWh/yr` : '—';
  $('k-wip').textContent = wip;
  $('k-fpy').textContent = sim.tested ? `${((sim.firstPass / sim.tested) * 100).toFixed(1)}%` : '—';
  $('k-modules').textContent = `${moduleStock.count} trays`;
  $('k-modules').dataset.low = moduleStock.count < TRAYS_PER_PACK * 2;
  $('k-frames').textContent = framesReady;
  const stored = slots.filter((s) => s.unit).length;
  $('k-lot').textContent = `${stored} / ${slots.length}`;
  $('k-lot').dataset.low = stored >= slots.length - 4;
  const waiting = trucks.filter((t) => t.state !== 'leave').length;
  $('k-trucks').textContent = waiting ? `${waiting} at site` : 'none';

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

// Start the shift with part of the storage lot already full
slots.slice(0, 30).forEach((slot) => storeFinished(slot, `MP-Y${String(++yardSerial).padStart(3, '0')}`));

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
Object.assign(sim, { time: 0, shipped: 0, tested: 0, firstPass: 0, shipTimes: [], doneTimes: [], nextTruck: Math.max(0, sim.nextTruck - sim.time) });
slots.forEach((sl) => { sl.at -= 320; });
updateUI(true);
frame();
document.body.classList.add('ready');
window.megafactory = { sim, lines, stations, moduleStock }; // handy for poking at from the console
