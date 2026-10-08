import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  COLORS, PACK, TRUCK_BED, mat, glow, box, cyl,
  createMegapack, createRoof, createRobot, createTruck, createAGV, createWorker,
  makeSignTexture, makeWallTexture, makeFloorTexture,
} from './models.js';

// =====================================================================
// Line configuration
// =====================================================================
// Simulation time is in "sim seconds"; one sim second = FACTORY_MIN factory minutes.
// The bottleneck (EOL test, ~10 s + ~3.5 s transfer) paces the line at roughly
// 1.1 packs/hour, i.e. a ~40 GWh/year run-rate – the scale of a real Megafactory.
const FACTORY_MIN = 4;
const MWH_PER_UNIT = 3.9;
const CONV_Y = 0.8; // conveyor roller height
const CONV_SPEED = 4; // m per sim second
const SPACING = 11; // min centre-to-centre distance between packs on the line
const PICK_X = 57; // end-of-line pick position for the shipping crane
const TRUCK_Z = 16;
const CONV_START = -64;
const CONV_END = 63;

const STATIONS = [
  { id: 'chassis', name: 'Chassis Load', x: -56, cycle: 5, robots: [],
    desc: 'Steel skid and frame are lowered onto the line by an overhead hoist and indexed into position.' },
  { id: 'modules', name: 'Module Install', x: -42, cycle: 9, robots: [[-2.2, -1], [2.2, 1]],
    desc: 'AGVs deliver battery modules from storage; twin robots insert 18 modules into the frame bays.' },
  { id: 'busbar', name: 'Busbar & HV Wiring', x: -28, cycle: 7, robots: [[-1.8, -1], [1.8, 1]], sparks: true,
    desc: 'Robots bolt and laser-weld copper busbars that link the modules into high-voltage strings.' },
  { id: 'thermal', name: 'Thermal & Inverter', x: -14, cycle: 8, robots: [],
    desc: 'An overhead hoist sets the integrated thermal roof (chillers, fans) and power-conversion electronics.' },
  { id: 'enclosure', name: 'Enclosure & Doors', x: 0, cycle: 8, robots: [[-2.2, 1], [2.2, -1]], sparks: true,
    desc: 'Side doors and end caps are fitted and welded, sealing the enclosure against weather and dust.' },
  { id: 'coolant', name: 'Coolant Fill', x: 14, cycle: 6, robots: [[2.5, -1]],
    desc: 'The glycol coolant loop is vacuum-checked for leaks, then filled and bled.' },
  { id: 'eol', name: 'End-of-Line Test', x: 28, cycle: 10, robots: [],
    desc: 'Full functional test: insulation resistance, BMS comms and a charge/discharge pulse. Failures are re-tested.' },
  { id: 'qa', name: 'Final QA', x: 42, cycle: 5, robots: [],
    desc: 'Visual and dimensional inspection, serial labelling and release to the shipping crane.' },
];

const STATUS_COLOR = { working: COLORS.green, idle: 0x6b7280, blocked: COLORS.amber, down: COLORS.red };
const STATUS_LABEL = { working: 'Working', idle: 'Starved', blocked: 'Blocked', down: 'Fault' };

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
scene.fog = new THREE.Fog(0x14171b, 150, 360);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.5, 900);
camera.position.set(-38, 52, 82);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(2, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2.05;
controls.minDistance = 6;
controls.maxDistance = 280;

scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2d33, 0.55));
const sun = new THREE.DirectionalLight(0xffffff, 1.7);
sun.position.set(40, 90, 45);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -100, right: 100, top: 60, bottom: -60, near: 10, far: 250 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun);

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

  // Painted walkway lines along the line and around the truck bay
  const paint = mat(COLORS.yellow, { roughness: 0.7 });
  const stripe = (x, z, w, d) => {
    const s = box(w, 0.02, d, paint, false);
    s.position.set(x, 0.01, z);
    s.receiveShadow = true;
    scene.add(s);
  };
  stripe(0, -4.6, 132, 0.18);
  stripe(0, 4.6, 104, 0.18);
  // Drive-through truck lane
  stripe(0, TRUCK_Z - 2.3, 192, 0.18);
  stripe(0, TRUCK_Z + 2.3, 192, 0.18);

  // Perimeter columns and eave beams (roof left open so the line stays visible)
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

  // Back wall with signage
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
  sign.position.set(0, 11, -34.3);
  scene.add(sign);

  buildConveyor();
  buildWarehouse();
}

function buildConveyor() {
  const len = CONV_END - CONV_START;
  const cx = (CONV_START + CONV_END) / 2;
  const body = box(len, 0.55, 2.3, mat(COLORS.dark, { metalness: 0.4, roughness: 0.5 }));
  body.position.set(cx, 0.32, 0);
  scene.add(body);
  for (const z of [-1.2, 1.2]) {
    const rail = box(len, 0.14, 0.1, mat(COLORS.steel, { metalness: 0.7, roughness: 0.35 }));
    rail.position.set(cx, 0.76, z);
    scene.add(rail);
  }
  const rollerGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.2, 10);
  rollerGeo.rotateX(Math.PI / 2);
  const count = Math.floor(len / 0.5);
  const rollers = new THREE.InstancedMesh(rollerGeo, mat(0x9aa1a9, { metalness: 0.8, roughness: 0.3 }), count);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < count; i++) rollers.setMatrixAt(i, m4.makeTranslation(CONV_START + 0.25 + i * 0.5, CONV_Y - 0.08, 0));
  rollers.receiveShadow = true;
  scene.add(rollers);
}

function buildWarehouse() {
  // Module storage racks feeding the AGV loop
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
        if ((bay * 7 + level * 3 + k) % 5 === 0) continue;
        const c = box(1.6, 0.9, 1.2, crateMat);
        c.position.set(x - 0.95 + k * 1.9, y + 0.52, -22);
        scene.add(c);
      }
    }
  }
}

// =====================================================================
// Stations
// =====================================================================
const stations = [];
const pickables = [];

function buildStation(cfg, index) {
  const st = {
    cfg, index, status: 'idle', occupant: null,
    down: false, downLeft: 0, downtime: 0, workTime: 0, processed: 0,
    robots: [], extras: {}, group: new THREE.Group(),
  };
  st.group.position.x = cfg.x;
  scene.add(st.group);

  // Gantry with sign + status beacon
  const frameMat = mat(0x3a3f46, { metalness: 0.6, roughness: 0.4 });
  for (const z of [-4.2, 4.2]) {
    const post = box(0.35, 7.6, 0.35, frameMat);
    post.position.set(0, 3.8, z);
    st.group.add(post);
  }
  const beam = box(0.5, 0.55, 8.8, frameMat);
  beam.position.set(0, 7.6, 0);
  st.group.add(beam);
  const tex = makeSignTexture(index + 1, cfg.name);
  for (const side of [1, -1]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.4), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    s.position.set(0, 8.75, side * 0.02);
    if (side < 0) s.rotation.y = Math.PI;
    st.group.add(s);
  }
  const signBack = box(5.7, 1.5, 0.03, mat(COLORS.darker), false);
  signBack.position.set(0, 8.75, 0);
  st.group.add(signBack);

  st.beaconMat = new THREE.MeshBasicMaterial({ color: STATUS_COLOR.idle, toneMapped: false });
  const beacon = cyl(0.22, 0.22, 0.45, 16, st.beaconMat, false);
  beacon.position.set(0, 8.1, 4.2);
  st.group.add(beacon);

  // Floor zone outline
  const pts = [[-6, -4.4], [6, -4.4], [6, 4.4], [-6, 4.4], [-6, -4.4]].map(([x, z]) => new THREE.Vector3(x, 0.03, z));
  st.zoneMat = new THREE.LineBasicMaterial({ color: 0x8a929c, transparent: true, opacity: 0.5 });
  st.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), st.zoneMat));

  // Invisible pick volume for clicking
  const pick = new THREE.Mesh(new THREE.BoxGeometry(12, 9.5, 9), new THREE.MeshBasicMaterial({ visible: false }));
  pick.position.y = 4.75;
  pick.userData.station = st;
  st.group.add(pick);
  pickables.push(pick);

  // Robots
  for (const [dx, side] of cfg.robots) {
    const r = createRobot(index % 2 ? COLORS.red : 0xd8dbe0);
    r.root.position.set(dx, 0, side * -3.3);
    r.baseYaw = side < 0 ? Math.PI : 0; // face the conveyor
    r.turret.rotation.y = r.baseYaw;
    r.phase = Math.random() * 10;
    r.side = side;
    st.group.add(r.root);
    st.robots.push(r);
  }

  buildStationExtras(st);
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

function buildStationExtras(st) {
  const g = st.group;
  const e = st.extras;
  switch (st.cfg.id) {
    case 'chassis': {
      const trolley = box(1.2, 0.5, 1.4, mat(COLORS.yellow), true);
      trolley.position.set(0, 7.1, 0);
      g.add(trolley);
      e.hook = box(1.0, 0.3, 0.6, mat(COLORS.yellow));
      g.add(e.hook);
      e.cable = hoistCable(g, 0, 0, 6.85);
      // Stack of empty skids waiting to be loaded
      for (let i = 0; i < 4; i++) {
        const s = box(PACK.L + 0.2, PACK.BASE, PACK.W + 0.12, mat(COLORS.darker, { roughness: 0.8 }));
        s.position.set(-1, 0.13 + i * 0.27, -7.4);
        g.add(s);
      }
      break;
    }
    case 'modules': {
      // AGV drop-off table
      const table = box(3.2, 0.9, 1.6, mat(COLORS.steel, { metalness: 0.5 }));
      table.position.set(0, 0.45, -6.2);
      g.add(table);
      break;
    }
    case 'busbar': {
      const spool = cyl(0.7, 0.7, 0.6, 24, mat(COLORS.copper, { metalness: 0.85, roughness: 0.3 }));
      spool.rotation.x = Math.PI / 2;
      spool.position.set(4, 0.7, -6.5);
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
      // Rack of waiting roofs
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
      tank.position.set(-3, 1.6, -7);
      g.add(tank);
      const pump = box(1.2, 1.0, 1.0, mat(COLORS.dark));
      pump.position.set(-1.2, 0.5, -7);
      g.add(pump);
      e.hose = cyl(0.07, 0.07, 1, 8, mat(0x1d4fa8), false);
      e.hose.position.set(PACK.L / 2 - 0.3, 5, -0.4);
      g.add(e.hose);
      e.hoseY = 6.8;
      break;
    }
    case 'eol': {
      e.scanner = new THREE.Group();
      const ringMat = glow(COLORS.teal);
      const h = PACK.HEIGHT + 0.5;
      const w = PACK.W + 0.8;
      for (const z of [-w / 2, w / 2]) {
        const b = box(0.08, h, 0.08, ringMat, false);
        b.position.set(0, CONV_Y + h / 2, z);
        e.scanner.add(b);
      }
      const top = box(0.08, 0.08, w, ringMat, false);
      top.position.set(0, CONV_Y + h, 0);
      e.scanner.add(top);
      e.scanner.visible = false;
      g.add(e.scanner);
      // Test cabinets with blinking LEDs
      e.leds = [];
      for (let i = 0; i < 3; i++) {
        const cab = box(1.2, 2.2, 0.8, mat(0x2b2f35, { metalness: 0.4 }));
        cab.position.set(-2.4 + i * 1.4, 1.1, -7);
        g.add(cab);
        for (let k = 0; k < 4; k++) {
          const led = box(0.12, 0.08, 0.02, new THREE.MeshBasicMaterial({ color: COLORS.green, toneMapped: false }), false);
          led.position.set(-2.4 + i * 1.4 - 0.3 + k * 0.2, 1.8, -6.59);
          g.add(led);
          e.leds.push(led);
        }
      }
      break;
    }
    case 'qa': {
      e.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.25 });
      const arch = new THREE.Group();
      for (const z of [-2.2, 2.2]) {
        const p = box(0.25, 4.5, 0.25, mat(COLORS.dark));
        p.position.set(0, 2.25, z);
        arch.add(p);
        const strip = box(0.06, 4.0, 0.06, e.ringMat, false);
        strip.position.set(0.16, 2.3, z);
        arch.add(strip);
      }
      const top = box(0.25, 0.25, 4.65, mat(COLORS.dark));
      top.position.set(0, 4.5, 0);
      arch.add(top);
      g.add(arch);
      break;
    }
  }
}

buildFactory();
STATIONS.forEach(buildStation);

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
  const bar = box(PACK.L + 0.6, 0.3, 0.5, yellow);
  crane.spreader.add(bar);
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

  // Dock bumper / loading bay marking
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
    [-70, -12.5], [-58, -10], [-46, -8.4], [-38, -8.6], [-34, -11.5],
    [-38, -15.5], [-52, -16.5], [-66, -17], [-74, -15],
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
].map((w) => {
  const group = createWorker(w.color);
  const x = THREE.MathUtils.randFloat(w.min, w.max);
  group.position.set(x, 0, w.z);
  scene.add(group);
  return { ...w, group, x, target: x, pause: Math.random() * 3, walk: 0 };
});

// =====================================================================
// Sparks particle system
// =====================================================================
const SPARKS = 500;
const sparkPos = new Float32Array(SPARKS * 3).fill(-100);
const sparkVel = new Float32Array(SPARKS * 3);
const sparkLife = new Float32Array(SPARKS);
let sparkCursor = 0;
const sparkGeo = new THREE.BufferGeometry();
sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
const sparks = new THREE.Points(
  sparkGeo,
  new THREE.PointsMaterial({
    color: 0xffb347, size: 0.12, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }),
);
sparks.frustumCulled = false;
scene.add(sparks);
const tmpV = new THREE.Vector3();

function emitSparks(pos, n) {
  for (let i = 0; i < n; i++) {
    const k = sparkCursor;
    sparkCursor = (sparkCursor + 1) % SPARKS;
    sparkPos[k * 3] = pos.x;
    sparkPos[k * 3 + 1] = pos.y;
    sparkPos[k * 3 + 2] = pos.z;
    sparkVel[k * 3] = (Math.random() - 0.5) * 4;
    sparkVel[k * 3 + 1] = Math.random() * 3 + 0.5;
    sparkVel[k * 3 + 2] = (Math.random() - 0.5) * 4;
    sparkLife[k] = 0.4 + Math.random() * 0.5;
  }
}

function updateSparks(dt) {
  for (let k = 0; k < SPARKS; k++) {
    if (sparkLife[k] <= 0) continue;
    sparkLife[k] -= dt;
    if (sparkLife[k] <= 0) {
      sparkPos[k * 3 + 1] = -100;
      continue;
    }
    sparkVel[k * 3 + 1] -= 9.8 * dt;
    sparkPos[k * 3] += sparkVel[k * 3] * dt;
    sparkPos[k * 3 + 1] = Math.max(0.02, sparkPos[k * 3 + 1] + sparkVel[k * 3 + 1] * dt);
    sparkPos[k * 3 + 2] += sparkVel[k * 3 + 2] * dt;
  }
  sparkGeo.attributes.position.needsUpdate = true;
}

// =====================================================================
// Simulation state
// =====================================================================
const sim = {
  time: 0, speed: 1, paused: false, faults: true,
  serial: 0, shipped: 0, tested: 0, firstPass: 0, units: [], shipTimes: [],
};

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp01 = (t) => Math.min(1, Math.max(0, t));

function spawnUnit() {
  const pack = createMegapack();
  const unit = {
    ...pack,
    id: 'MP-' + String(++sim.serial).padStart(4, '0'),
    x: STATIONS[0].x, z: 0, y: CONV_Y + 5,
    next: 0, state: 'processing', t: 0, dur: cycleFor(STATIONS[0]),
    blocked: false, retest: false, born: sim.time,
  };
  unit.group.position.set(unit.x, unit.y, 0);
  scene.add(unit.group);
  sim.units.push(unit);
  stations[0].occupant = unit;
  return unit;
}

function cycleFor(cfg) {
  return cfg.cycle * THREE.MathUtils.randFloat(0.9, 1.1);
}

// Visual effect of each station's work on the pack, p in [0, 1]
function applyProgress(unit, st, p) {
  const e = st.extras;
  switch (st.cfg.id) {
    case 'chassis':
      unit.y = CONV_Y + (1 - ease(clamp01(p / 0.85))) * 5;
      break;
    case 'modules': {
      const n = Math.floor(p * unit.modules.length + 0.0001);
      unit.modules.forEach((m, i) => { m.visible = i < n; });
      break;
    }
    case 'busbar': {
      const n = Math.floor(p * unit.busbars.length + 0.0001);
      unit.busbars.forEach((b, i) => { b.visible = i < n; });
      break;
    }
    case 'thermal': {
      e.carrierY = THREE.MathUtils.lerp(6.2, CONV_Y + PACK.FRAME_TOP, ease(clamp01(p / 0.8)));
      if (p >= 0.85) {
        unit.roof.visible = true;
        e.carrier.visible = false;
      }
      break;
    }
    case 'enclosure': {
      const n = Math.floor(p * unit.doors.length + 0.0001);
      unit.doors.forEach((d, i) => { d.visible = i < n; });
      break;
    }
    case 'coolant':
      e.hoseY = THREE.MathUtils.lerp(6.8, CONV_Y + PACK.HEIGHT, ease(clamp01(Math.min(p, 1 - p) * 5)));
      if (p > 0.3) unit.coolantLight.visible = true;
      break;
    case 'eol':
      e.scanner.visible = p < 1;
      e.scanner.position.x = Math.sin(p * Math.PI * 3) * (PACK.L / 2);
      unit.statusLight.visible = true;
      if (p >= 1) unit.statusLight.material.color.setHex(COLORS.green);
      else unit.statusLight.material.color.setHex(Math.floor(p * 20) % 2 ? COLORS.amber : 0x3a2a00);
      break;
  }
}

function stepSim(dt) {
  sim.time += dt;

  // Spawn a new chassis whenever station 1 is clear
  const first = STATIONS[0].x;
  const lineUnits = sim.units.filter((u) => u.state === 'moving' || u.state === 'processing' || u.state === 'waitPick');
  if (!lineUnits.some((u) => u.x < first + SPACING - 0.001)) spawnUnit();

  // Advance units front-to-back so spacing constraints use updated positions
  lineUnits.sort((a, b) => b.x - a.x);
  let ahead = null;
  for (const u of lineUnits) {
    if (u.state === 'moving') {
      const target = u.next < STATIONS.length ? STATIONS[u.next].x : PICK_X;
      const limit = ahead ? ahead.x - SPACING : Infinity;
      const want = u.x + CONV_SPEED * dt;
      const nx = Math.min(want, target, limit);
      u.blocked = limit < Math.min(want, target) - 1e-6;
      u.x = Math.max(u.x, nx);
      if (u.x >= target - 1e-4) {
        u.x = target;
        u.blocked = false;
        if (u.next < STATIONS.length) {
          u.state = 'processing';
          u.t = 0;
          u.dur = cycleFor(STATIONS[u.next]);
          stations[u.next].occupant = u;
        } else {
          u.state = 'waitPick';
        }
      }
    } else if (u.state === 'processing') {
      const st = stations[u.next];
      if (!st.down) {
        u.t += dt;
        st.workTime += dt;
        const p = clamp01(u.t / u.dur);
        applyProgress(u, st, p);
        if (sim.faults && Math.random() < dt / 320) breakStation(st);
        if (p >= 1) finishStation(u, st);
      }
    }
    u.group.position.set(u.x, u.y, u.z);
    ahead = u;
  }

  // Station fault timers
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

function finishStation(u, st) {
  if (st.cfg.id === 'eol') {
    if (!u.retest) sim.tested++;
    if (!u.retest && Math.random() < 0.06) {
      // Failed – run a shorter re-test cycle after adjustment
      u.retest = true;
      u.t = 0;
      u.dur = st.cfg.cycle * 0.6;
      u.statusLight.material.color.setHex(COLORS.red);
      toast(`${u.id} failed insulation test — re-testing`);
      return;
    }
    if (!u.retest) sim.firstPass++;
  }
  st.processed++;
  st.occupant = null;
  u.next++;
  u.state = 'moving';
}

function breakStation(st, duration) {
  if (st.down) return;
  st.down = true;
  st.downLeft = duration ?? THREE.MathUtils.randFloat(10, 22);
  toast(`Fault at ${st.cfg.name} — maintenance dispatched`, 'warn');
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
      const ready = sim.units.find((u) => u.state === 'waitPick');
      // Pick as soon as a pack is ready; the truck swap happens while we lift.
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

  if (crane.load) {
    const u = crane.load;
    u.x = PICK_X;
    u.z = crane.z;
    u.y = crane.hookY - PACK.HEIGHT - 0.15;
    u.group.position.set(u.x, u.y, u.z);
  }
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
    if (t.load) {
      t.load.x = t.x;
      t.load.y = TRUCK_BED;
      t.load.z = TRUCK_Z;
      t.load.group.position.set(t.x, TRUCK_BED, TRUCK_Z);
    }
    ahead = t;
  }

  // Shipped: truck has left the building
  while (trucks.length && trucks[0].x > 200) {
    const t = trucks.shift();
    scene.remove(t.group);
    if (t.load) {
      scene.remove(t.load.group);
      sim.units.splice(sim.units.indexOf(t.load), 1);
      sim.shipped++;
      sim.shipTimes.push(sim.time);
      if (follow.unit === t.load) follow.unit = null;
    }
  }
}

// =====================================================================
// Per-frame visuals (robots, hoists, AGVs, workers, beacons)
// =====================================================================
function stationStatus(st) {
  if (st.down) return 'down';
  const occ = sim.units.find((u) => Math.abs(u.x - st.cfg.x) < 0.01 && u.state === 'processing' && u.next === st.index);
  if (occ) return 'working';
  const blocked = sim.units.find((u) => u.state === 'moving' && u.blocked && u.next === st.index + 1 && u.x - st.cfg.x < SPACING);
  return blocked ? 'blocked' : 'idle';
}

function animateRobot(r, working, simDt, realDt, emit) {
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
  if (working && emit && Math.random() < 0.6) {
    r.tip.getWorldPosition(tmpV);
    emitSparks(tmpV, 3);
  }
}

let blink = 0;
function updateVisuals(simDt, realDt) {
  blink += realDt;
  for (const st of stations) {
    st.status = stationStatus(st);
    const color = st.status === 'down' ? (Math.floor(blink * 4) % 2 ? COLORS.red : 0x330000) : STATUS_COLOR[st.status];
    st.beaconMat.color.setHex(color);
    st.zoneMat.color.setHex(st === selected ? 0xffffff : st.status === 'down' ? COLORS.red : 0x8a929c);
    st.zoneMat.opacity = st === selected ? 0.9 : 0.5;
    const working = st.status === 'working' && !sim.paused;
    for (const r of st.robots) animateRobot(r, working, simDt, realDt, st.cfg.sparks);

    const e = st.extras;
    const occ = st.status === 'working' || (st.down && st.occupant) ? st.occupant : null;
    switch (st.cfg.id) {
      case 'chassis': {
        const y = occ && occ.state === 'processing' ? occ.y + PACK.BASE + 0.15 : 6.2;
        e.hook.position.y += (y - e.hook.position.y) * (occ ? 1 : 1 - Math.exp(-3 * realDt));
        setCable(e.cable, 6.85, e.hook.position.y);
        break;
      }
      case 'thermal': {
        if (!occ) {
          e.carrierY += (6.2 - e.carrierY) * (1 - Math.exp(-3 * realDt));
          e.carrier.visible = true;
        }
        e.carrier.position.y = e.carrierY;
        for (const c of e.cables) setCable(c, 6.85, e.carrierY + PACK.ROOF_H);
        break;
      }
      case 'coolant': {
        if (!occ) e.hoseY += (6.8 - e.hoseY) * (1 - Math.exp(-3 * realDt));
        setCable(e.hose, 7.3, e.hoseY);
        break;
      }
      case 'eol': {
        if (!occ) e.scanner.visible = false;
        e.leds.forEach((l, i) => {
          const on = occ ? Math.sin(blink * 9 + i * 1.7) > 0 : i % 3 === 0;
          l.material.color.setHex(on ? (occ ? COLORS.amber : COLORS.green) : 0x1a1d21);
        });
        break;
      }
      case 'qa':
        e.ringMat.opacity = occ ? 0.55 + Math.sin(blink * 10) * 0.4 : 0.2;
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

  // AGVs
  if (!sim.paused) {
    for (const a of agvs) {
      a.u = (a.u + (2.6 * simDt) / agvLen) % 1;
      const p = agvCurve.getPointAt(a.u);
      const t = agvCurve.getTangentAt(a.u);
      a.group.position.copy(p);
      a.group.rotation.y = Math.atan2(-t.z, t.x);
      a.cargo.visible = a.u > 0.72 || a.u < 0.3;
    }
  }

  // Workers stroll between stations
  if (!sim.paused) {
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

  updateSparks(realDt);
}

// =====================================================================
// Camera modes
// =====================================================================
const follow = { active: false, unit: null };
const tween = { active: false };
const CAMERA_PRESETS = {
  overview: { pos: [-38, 52, 82], target: [2, 0, 0] },
  modules: { pos: [-58, 10, 12], target: [-45, 1.5, -6] },
  test: { pos: [18, 10, 18], target: [30, 2, 0] },
  shipping: { pos: [34, 16, 40], target: [PICK_X, 3, 8] },
};

// Newest pack that has cleared chassis load (so there is something to look at)
function pickFollowUnit() {
  const onLine = sim.units.filter((u) => u.state !== 'onTruck').sort((a, b) => a.x - b.x);
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
    if (!follow.unit) {
      // Follow the newest pack that is still on the line
      follow.unit = pickFollowUnit();
    }
    if (follow.unit) {
      const p = follow.unit.group.position;
      const goal = new THREE.Vector3(p.x, p.y + 1.5, p.z);
      const delta = goal.clone().sub(controls.target);
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

const stationList = $('station-list');
for (const st of stations) {
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
  stationList.appendChild(row);
  st.row = row;
}

function selectStation(st, focus) {
  selected = st;
  $('info').hidden = !st;
  if (st && focus) {
    follow.active = false;
    setActive('cam', null);
    flyTo([st.cfg.x - 9, 9, 15], [st.cfg.x, 2, 0]);
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
      if (u) flyTo([u.x - 12, 8, 14], [u.x, u.y + 1.5, u.z], 1.0);
    } else {
      const p = CAMERA_PRESETS[mode];
      flyTo(p.pos, p.target);
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

// Click-to-select stations in the 3D view
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

let toastTimer = 0;
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

let uiTimer = 0;
function updateUI(force = false) {
  uiTimer += 1;
  if (!force && uiTimer % 10) return;
  // Throughput from the interval between the last (up to) 12 shipments
  const ts = sim.shipTimes.slice(-12);
  const rate = ts.length >= 2 ? (ts.length - 1) / (((ts[ts.length - 1] - ts[0]) * FACTORY_MIN) / 60) : 0;
  const wip = sim.units.filter((u) => u.state !== 'onTruck').length;

  $('k-clock').textContent = fmtClock(sim.time);
  $('k-shipped').textContent = sim.shipped;
  $('k-energy').textContent = fmtEnergy(sim.shipped * MWH_PER_UNIT);
  $('k-rate').textContent = rate ? rate.toFixed(2) : '—';
  $('k-annual').textContent = rate ? `${((rate * 24 * 365 * MWH_PER_UNIT) / 1000).toFixed(0)} GWh/yr` : '—';
  $('k-wip').textContent = wip;
  $('k-fpy').textContent = sim.tested ? `${((sim.firstPass / sim.tested) * 100).toFixed(1)}%` : '—';

  let bottleneck = null;
  for (const st of stations) {
    const util = sim.time > 0 ? st.workTime / sim.time : 0;
    if (!bottleneck || util > bottleneck.util) bottleneck = { st, util };
    const occ = st.status === 'working' || st.down ? st.occupant : null;
    const p = occ ? clamp01(occ.t / occ.dur) : 0;
    st.row.querySelector('.st-fill').style.width = `${(p * 100).toFixed(0)}%`;
    st.row.dataset.status = st.status;
    st.row.querySelector('.st-label').textContent = STATUS_LABEL[st.status];
    st.row.classList.toggle('selected', st === selected);
  }
  $('k-bottleneck').textContent = sim.time > 20 ? bottleneck.st.cfg.name : '—';

  if (selected) {
    const st = selected;
    const occ = st.occupant;
    $('info-num').textContent = `Station ${String(st.index + 1).padStart(2, '0')}`;
    $('info-name').textContent = st.cfg.name;
    $('info-desc').textContent = st.cfg.desc;
    $('info-status').textContent = STATUS_LABEL[st.status];
    $('info-status').dataset.status = st.status;
    $('info-cycle').textContent = `${st.cfg.cycle * FACTORY_MIN} min`;
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

// Pre-warm so the line is populated on first view
for (let i = 0; i < 1100; i++) stepSim(0.1);
for (const st of stations) {
  st.down = false;
  st.workTime = 0;
  st.downtime = 0;
  st.processed = 0;
}
Object.assign(sim, { time: 0, shipped: 0, tested: 0, firstPass: 0, shipTimes: [] });
document.getElementById('toasts').innerHTML = '';
updateUI(true);
frame();
document.body.classList.add('ready');
window.megafactory = { sim, stations }; // handy for poking at from the console
