// The reusable object library. Every entry wraps a procedural 3D model (shared with the
// Megafactory, Line Builder and Motor Plant demos) and says how it behaves in the simulation.
//
//   role: source | sink | buffer | station | storage | vehicle | operator | decor
//   build(props) -> { group, entry, exit, work, update?(ctx), height }
//     entry/exit/work are points in the object's local space; flow runs along local +x.
//     ctx = { state, dt, simDt, t, blink, progress }
import * as THREE from 'three';
import { LIBRARY as GENERIC } from '../../../src/builder/objects.js';
import {
  MACHINES, createPerson, posePerson, createForklift, createAGV, createTugger, createRack, createShelf,
  createTruck, createPallet, box, mat, cyl, glow,
} from '../../../src/motors/models.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const put = (m, x, y, z) => {
  m.position.set(x, y, z);
  return m;
};
const ITEM = { size: [0.5, 0.35, 0.4], color: 0x4f8bd6 };
const fxStub = (() => {
  const e = { emit() {}, emitDir() {}, points: { material: { color: new THREE.Color() } } };
  return { sparks: e, mist: e, water: e, paint: e, smoke: e };
})();
const LIGHT = { busy: 'working', idle: 'idle', blocked: 'blocked', down: 'down', off: 'idle' };
const VESTS = [0xf2e21a, 0xff7a1a, 0x9be22e];

// ------------------------------------------------------------------ wrappers
// A machine from the motor-plant library, with its operators
function machine(kind, opts) {
  return (p) => {
    const y = 0.9;
    const m = MACHINES[kind](y, opts);
    const g = new THREE.Group();
    g.add(m.group);
    const bb = new THREE.Box3().setFromObject(m.group);
    const ops = [];
    const want = Math.max(0, (p.operators ?? m.ops.length) - (p._placed ?? 0));
    for (let i = 0; i < want; i++) {
      const spot = m.ops[i] ?? [bb.min.x + 0.6 + i * 0.8, bb.max.z + 0.7, -Math.PI / 2];
      const person = createPerson({ vest: VESTS[i % 3] });
      person.group.position.set(spot[0], 0, spot[1]);
      person.group.rotation.y = -spot[2];
      g.add(person.group);
      ops.push(person);
    }
    const half = Math.max(1.2, Math.min(2.2, (bb.max.x - bb.min.x) / 2));
    let t = 0;
    return {
      group: g, entry: v(-half, y, 0), exit: v(half, y, 0), work: v(0, y, 0), height: bb.max.y,
      update(c) {
        const working = c.state === 'busy';
        if (working) t += c.simDt;
        m.update?.({ working, status: LIGHT[c.state] ?? 'idle', occ: null, p: c.progress ?? 0, t, simDt: c.simDt, dt: c.dt, y, fx: fxStub, blink: c.blink });
        m.light.set(LIGHT[c.state] ?? 'idle', c.blink);
        ops.forEach((o, i) => { o.phase += c.simDt; posePerson(o, c.state === 'off' ? 'idle' : working ? 'work' : 'idle', o.phase * 3 + i); o.group.visible = c.state !== 'off'; });
      },
    };
  };
}

// A generic object from the Line Builder library
function generic(type, extra = {}) {
  return (p) => {
    const q = { ...p, ...extra };
    if (type === 'processor') q.operators = Math.max(0, (extra.operators ?? p.operators ?? 1) - (p._placed ?? 0));
    const m = GENERIC[type].build(q, ITEM);
    return {
      group: m.group, entry: m.entry ?? v(0, 0.5, 0), exit: m.exit ?? v(0, 0.5, 0), work: m.workPoint ?? m.entry ?? v(0, 0.9, 0), height: m.height ?? 2,
      update(c) {
        const s = c.state === 'off' ? 'idle' : c.state;
        m.setState?.(s);
        m.animate?.(c.simDt, s, false);
      },
    };
  };
}

// Automated storage and retrieval system: two high-bay racks with a stacker crane in the aisle
function asrs(p) {
  const bays = Math.max(3, p.bays ?? 10);
  const levels = Math.max(3, p.levels ?? 8);
  const bayW = 1.4;
  const levelH = 1.1;
  const g = new THREE.Group();
  const L = bays * bayW;
  for (const z of [-1.5, 1.5]) {
    const r = createRack(bays, levels, { bayW, depth: 1.2, levelH, upright: 0x9aa3ad, beam: 0xf28c28 });
    r.group.position.set(-L / 2, 0, z);
    g.add(r.group);
    let seed = 7 + z * 13;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let b = 0; b < bays; b++) for (let l = 0; l < levels; l++) {
      if (rnd() < 0.25) continue;
      const pos = r.slotPos(b, l);
      const tote = box(1.0, 0.55, 0.9, mat([0x2a5d9f, 0x3b4148, 0xb98d5c][Math.floor(rnd() * 3)], { roughness: 0.6 }));
      tote.position.set(-L / 2 + pos.x, pos.y + 0.3, z);
      g.add(tote);
    }
  }
  const H = levels * levelH + 0.6;
  g.add(put(box(L + 2, 0.12, 0.25, mat(0x5f6873, { metalness: 0.6 })), 0, 0.06, 0));
  const rail = box(L + 2, 0.15, 0.2, mat(0x5f6873, { metalness: 0.6 }));
  rail.position.set(0, H, 0);
  g.add(rail);
  const crane = new THREE.Group();
  crane.add(put(box(0.5, H, 0.45, mat(0xf2c230, { roughness: 0.45 })), 0, H / 2, 0));
  crane.add(put(box(1.0, 0.5, 0.8, mat(0x2b2f35)), 0, 0.3, 0));
  const carriage = new THREE.Group();
  carriage.add(box(0.9, 0.25, 1.6, mat(0x5f6873, { metalness: 0.5 })));
  const load = box(0.9, 0.5, 0.8, mat(0xb98d5c, { roughness: 0.8 }));
  load.position.y = 0.4;
  carriage.add(load);
  crane.add(carriage);
  g.add(crane);
  // In/out conveyor at the front
  const io = box(2.2, 0.12, 0.9, mat(0x8d949c, { metalness: 0.5 }));
  io.position.set(L / 2 + 1.6, 0.8, 0);
  g.add(io);
  let t = Math.random() * 10;
  let tx = 0;
  let ty = 1;
  return {
    group: g, entry: v(L / 2 + 2.6, 0.9, 0), exit: v(L / 2 + 2.6, 0.9, 0), work: v(L / 2 + 1.6, 0.95, 0), height: H,
    update(c) {
      if (c.state === 'busy' || c.state === 'blocked') {
        t += c.simDt;
        if (t > 3) {
          t = 0;
          tx = (Math.random() - 0.5) * L * 0.9;
          ty = 0.4 + Math.random() * (H - 1.4);
          load.visible = !load.visible;
        }
      }
      const k = 1 - Math.exp(-2.5 * c.dt);
      crane.position.x += (tx - crane.position.x) * k;
      carriage.position.y += (ty - carriage.position.y) * k;
    },
  };
}

function dock(kind) {
  return () => {
    const g = new THREE.Group();
    const frame = mat(0x5f6873, { metalness: 0.4 });
    g.add(put(box(0.25, 4.2, 0.3, frame), 0, 2.1, -1.9));
    g.add(put(box(0.25, 4.2, 0.3, frame), 0, 2.1, 1.9));
    g.add(put(box(0.3, 0.3, 4.1, frame), 0, 4.2, 0));
    g.add(put(box(0.06, 1.0, 3.6, mat(0xd8dde2)), 0, 3.6, 0)); // rolled-up door
    g.add(put(box(2.0, 0.12, 3.2, mat(0x8d949c, { metalness: 0.5 })), 1.0, 0.06, 0)); // leveler
    for (const z of [-1.7, 1.7]) g.add(put(box(0.3, 0.6, 0.4, mat(0x111111)), -0.2, 1.0, z)); // bumpers
    g.add(put(box(0.4, 0.4, 0.05, glow(kind === 'source' ? 0x22c55e : 0xef4444), false), 0.2, 3.0, 2.05));
    const truck = createTruck();
    truck.rotation.y = Math.PI;
    truck.position.set(-7.1, 0, 0);
    g.add(truck);
    return { group: g, entry: v(1.4, 0.4, 0), exit: v(1.4, 0.4, 0), work: v(1.0, 0.4, 0), height: 4.4, update() {} };
  };
}

function shelving(p) {
  const s = createShelf(p.width ?? 2.4, p.height ?? 2.0, 0.6);
  return { group: s, entry: v(0, 0.9, 0.5), exit: v(0, 0.9, 0.5), work: v(0, 1.0, 0.5), height: p.height ?? 2 };
}

function palletRack(p) {
  const bays = p.bays ?? 4;
  const levels = p.levels ?? 3;
  const r = createRack(bays, levels, { bayW: 2.8, depth: 1.2, levelH: 1.7 });
  const g = new THREE.Group();
  r.group.position.x = -(bays * 2.8) / 2;
  g.add(r.group);
  let seed = (p.seed ?? 5) * 31;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let b = 0; b < bays; b++) for (let l = 0; l < levels; l++) for (const dx of [-0.65, 0.65]) {
    if (rnd() > (p.fill ?? 0.7)) continue;
    const pos = r.slotPos(b, l);
    const pal = createPallet(1.1, 1.0);
    pal.position.set(-(bays * 2.8) / 2 + pos.x + dx, pos.y, 0);
    g.add(pal);
    const h = 0.6 + rnd() * 0.6;
    g.add(put(box(1.0, h, 0.9, mat([0xb98d5c, 0x8a9096, 0x2a5d9f][Math.floor(rnd() * 3)], { roughness: 0.85 })), pal.position.x, pos.y + 0.14 + h / 2, 0));
  }
  return { group: g, entry: v(0, 0.3, 1.2), exit: v(0, 0.3, 1.2), work: v(0, 0.3, 1.0), height: levels * 1.7 + 0.4 };
}

function vehicle(make) {
  return () => {
    const o = make();
    const g = o.group ?? o;
    return { group: g, entry: v(0, 0.6, 0), exit: v(0, 0.6, 0), work: v(0, 0.65, 0), height: 2.6, cargo: o.cargo, carriage: o.carriage };
  };
}

function operator(p) {
  const person = createPerson({ vest: p.vest ? new THREE.Color(p.vest).getHex() : 0xf2e21a });
  const g = new THREE.Group();
  g.add(person.group);
  return {
    group: g, entry: v(0, 1, 0), exit: v(0, 1, 0), work: v(0.4, 1.0, 0), height: 1.9, person,
    update(c) {
      person.phase += c.simDt;
      posePerson(person, c.walking ? 'walk' : c.state === 'busy' ? 'work' : 'idle', c.walking ? c.t * 6.5 : person.phase * 3);
    },
  };
}

function column() {
  const g = new THREE.Group();
  g.add(put(box(0.4, 6, 0.4, mat(0x8796a8, { metalness: 0.3 })), 0, 3, 0));
  g.add(put(box(0.5, 1.2, 0.5, mat(0xf2c230)), 0, 0.6, 0));
  return { group: g, entry: v(0, 0, 0), exit: v(0, 0, 0), work: v(0, 0, 0), height: 6 };
}

// ------------------------------------------------------------------ catalog
const STATION_FIELDS = [
  ['cycleTime', 'Cycle time (s)', 'number', { min: 1, step: 1 }],
  ['operators', 'Operators needed', 'number', { min: 0, step: 1 }],
  ['mtbf', 'MTBF (hours, 0 = never)', 'number', { min: 0, step: 0.5 }],
  ['mttr', 'MTTR (minutes)', 'number', { min: 0, step: 1 }],
];
const station = (type, label, category, glyph, build, cycleTime, operators, desc) => ({
  type, label, category, glyph, role: 'station', build, desc,
  defaults: { cycleTime, operators, mtbf: 0, mttr: 15 },
  fields: STATION_FIELDS,
});

export const CATALOG = [
  // Flow
  { type: 'source', label: 'Source', category: 'Flow', glyph: 'IN', role: 'source', build: generic('source'), desc: 'Creates parts at a set interval.',
    defaults: { interval: 60 }, fields: [['interval', 'New part every (s)', 'number', { min: 1 }]] },
  { type: 'sink', label: 'Sink', category: 'Flow', glyph: 'OUT', role: 'sink', build: generic('sink'), desc: 'Finished parts leave here and are counted as output.', defaults: {}, fields: [] },
  { type: 'buffer', label: 'Buffer', category: 'Flow', glyph: 'BUF', role: 'buffer', build: (p) => generic('queue')(p), desc: 'Floor buffer / WIP lane between stations.',
    defaults: { capacity: 6 }, fields: [['capacity', 'Capacity (parts)', 'number', { min: 1 }]] },
  { type: 'receiving-dock', label: 'Receiving dock', category: 'Flow', glyph: 'RCV', role: 'source', build: dock('source'), clash: false, desc: 'Dock door with a truck; raw material arrives here.',
    defaults: { interval: 90 }, fields: [['interval', 'Delivery every (s)', 'number', { min: 1 }]] },
  { type: 'shipping-dock', label: 'Shipping dock', category: 'Flow', glyph: 'SHP', role: 'sink', build: dock('sink'), clash: false, desc: 'Dock door with a truck; finished goods are shipped here.', defaults: {}, fields: [] },

  // Workstations (human labour)
  station('bench', 'Manual workbench', 'Workstations', 'WB', generic('processor', { style: 'bench' }), 60, 1, 'Manual assembly bench with tool board and light tower.'),
  station('assembly-bench', 'Assembly bench + tools', 'Workstations', 'ASM', machine('fanbench'), 75, 2, 'Bench with balancer-hung torque tool.'),
  station('wiring-bench', 'Wiring bench', 'Workstations', 'WIR', machine('conduit'), 70, 1, 'Bench with wire reels for harness and lead work.'),
  station('lift-assist', 'Lift-assist station', 'Workstations', 'LFT', machine('rotorinsert'), 60, 2, 'Operator-guided lift arm for heavy parts.'),
  station('inspection-bench', 'Inspection bench', 'Workstations', 'QC', machine('inspectbench'), 45, 2, 'Manual inspection with test instruments.'),
  station('pack-station', 'Pack & label', 'Workstations', 'PCK', machine('pack'), 50, 1, 'Laser marking, carton erecting and packing.'),

  // Robots & automation
  station('robot-cell', 'Robot cell', 'Robots', 'RBT', generic('processor', { style: 'cell', operators: 0 }), 45, 0, 'Six-axis robot behind a safety fence.'),
  station('robot-load', 'Robot load cell', 'Robots', 'RLD', machine('robotload'), 30, 0, 'Robot picking parts from bins onto the line.'),
  station('robot-weld', 'Robot stack & weld', 'Robots', 'WLD', machine('stacker'), 40, 0, 'Robot stacking with laser welding.'),
  station('paint-booth', 'Robot paint booth', 'Robots', 'PNT', machine('paint'), 60, 0, 'Spray booth with a painting robot.'),
  station('vision-qc', 'Vision QC arch', 'Robots', 'VIS', machine('vision'), 20, 0, 'Camera arch for automated inspection.'),

  // Machines
  station('cnc-lathe', 'CNC lathe', 'Machines', 'LTH', machine('lathe'), 90, 1, 'Enclosed CNC turning centre with chip conveyor.'),
  station('machining-centre', 'Machining centre', 'Machines', 'VMC', machine('mill'), 120, 1, 'Enclosed CNC mill with tool magazine.'),
  station('press', 'Stamping press', 'Machines', 'PRS', machine('press'), 15, 1, 'Straight-side press with flywheel and guarding.'),
  station('hydraulic-press', 'Hydraulic press', 'Machines', 'HYD', machine('hpress'), 30, 1, 'C-frame hydraulic press-fit station.'),
  station('saw', 'Bar saw', 'Machines', 'SAW', machine('saw'), 40, 1, 'Bandsaw with bar stock.'),
  station('grinder', 'Grinder', 'Machines', 'GRD', machine('grinder'), 80, 1, 'Enclosed cylindrical grinder.'),
  station('die-casting', 'Die-casting cell', 'Machines', 'DCS', machine('diecast'), 90, 1, 'Die-casting machine with furnace and ladle robot.'),
  station('washer', 'Parts washer', 'Machines', 'WSH', machine('washer'), 60, 0, 'Tunnel washer with spray nozzles.'),
  station('oven', 'Cure oven', 'Machines', 'OVN', machine('oven'), 180, 0, 'Batch oven with lifting doors.'),
  station('test-stand', 'Run-test stand', 'Machines', 'TST', machine('runtest'), 120, 1, 'Dynamometer test bed with test cabinet.'),
  station('cmm', 'CMM', 'Machines', 'CMM', machine('cmm'), 90, 1, 'Coordinate measuring machine.'),
  station('coil-winder', 'Coil winder', 'Machines', 'WND', machine('winder'), 100, 1, 'Twin-flyer coil winding machine.'),
  station('vpi-tank', 'VPI tank', 'Machines', 'VPI', machine('vpi'), 240, 1, 'Vacuum pressure impregnation tank with hoist.'),
  station('induction-heater', 'Induction heater', 'Machines', 'IND', machine('induction'), 60, 2, 'Induction heating for shrink fits.'),
  station('enclosed-machine', 'Generic machine', 'Machines', 'MCH', generic('processor', { style: 'machine' }), 60, 1, 'Generic enclosed machine for anything not in the library.'),

  // Storage
  { type: 'pallet-rack', label: 'Pallet rack', category: 'Storage', glyph: 'RCK', role: 'storage', build: palletRack, desc: 'Selective pallet racking.',
    defaults: { bays: 4, levels: 3, capacity: 24, handling: 20 }, fields: [['bays', 'Bays', 'number', { min: 1 }], ['levels', 'Levels', 'number', { min: 1 }], ['capacity', 'Capacity (parts)', 'number', { min: 1 }], ['handling', 'Put/pick time (s)', 'number', { min: 0 }]] },
  { type: 'asrs', label: 'ASRS', category: 'Storage', glyph: 'AS/RS', role: 'storage', build: asrs, desc: 'High-bay automated storage with a stacker crane.',
    defaults: { bays: 10, levels: 8, capacity: 120, handling: 35 }, fields: [['bays', 'Bays', 'number', { min: 3 }], ['levels', 'Levels', 'number', { min: 3 }], ['capacity', 'Capacity (parts)', 'number', { min: 1 }], ['handling', 'Crane cycle (s)', 'number', { min: 1 }]] },
  { type: 'shelving', label: 'Shelving / kanban', category: 'Storage', glyph: 'SHF', role: 'storage', build: shelving, desc: 'Line-side shelving with bins.',
    defaults: { width: 2.4, height: 2.0, capacity: 12, handling: 5 }, fields: [['width', 'Width (m)', 'number', { min: 1, step: 0.2 }], ['capacity', 'Capacity (parts)', 'number', { min: 1 }]] },
  { type: 'pallet', label: 'Pallet stack', category: 'Storage', glyph: 'PAL', role: 'decor', build: generic('pallet'), desc: 'Loaded pallet (decor).', defaults: { layers: 2 }, fields: [['layers', 'Layers', 'number', { min: 1 }]] },
  { type: 'tank', label: 'Tank', category: 'Storage', glyph: 'TNK', role: 'decor', build: generic('tank'), desc: 'Liquid tank or silo.', defaults: {}, fields: [] },

  // Vehicles
  { type: 'agv', label: 'AGV', category: 'Vehicles', glyph: 'AGV', role: 'vehicle', build: vehicle(() => createAGV()), desc: 'Automated guided vehicle. Drives on routes and runs transport links.',
    defaults: { speed: 1.5 }, fields: [['speed', 'Speed (m/s)', 'number', { min: 0.2, step: 0.1 }]] },
  { type: 'forklift', label: 'Forklift', category: 'Vehicles', glyph: 'FLT', role: 'vehicle', build: vehicle(() => createForklift()), desc: 'Counterbalance forklift with driver.',
    defaults: { speed: 2.5 }, fields: [['speed', 'Speed (m/s)', 'number', { min: 0.2, step: 0.1 }]] },
  { type: 'tugger', label: 'Tugger', category: 'Vehicles', glyph: 'TUG', role: 'vehicle', build: vehicle(() => ({ group: createTugger() })), desc: 'Tugger for milk runs.',
    defaults: { speed: 2.0 }, fields: [['speed', 'Speed (m/s)', 'number', { min: 0.2, step: 0.1 }]] },

  // People
  { type: 'operator', label: 'Operator', category: 'People', glyph: 'OP', role: 'operator', build: operator, desc: 'A worker. Assign to a station; stations with too few operators stop.',
    defaults: { stationId: '' }, fields: [['stationId', 'Works at', 'station']] },

  // Site
  { type: 'fence', label: 'Safety fence', category: 'Site', glyph: 'FEN', role: 'decor', build: generic('fence'), desc: 'Mesh guard fence.', defaults: { length: 6 }, fields: [['length', 'Length (m)', 'number', { min: 1 }]] },
  { type: 'cart', label: 'Kit cart', category: 'Site', glyph: 'CRT', role: 'decor', build: generic('cart'), desc: 'Two-level kitting cart.', defaults: {}, fields: [] },
  { type: 'table', label: 'Table', category: 'Site', glyph: 'TBL', role: 'decor', build: generic('table'), desc: 'Work table.', defaults: {}, fields: [] },
  { type: 'column', label: 'Building column', category: 'Site', glyph: 'COL', role: 'decor', build: column, desc: 'Structural column with guard.', defaults: {}, fields: [] },
];

export const CATALOG_BY_TYPE = Object.fromEntries(CATALOG.map((c) => [c.type, c]));
export const CATEGORIES = [...new Set(CATALOG.map((c) => c.category))];
export const FLOW_ROLES = new Set(['source', 'sink', 'buffer', 'station', 'storage']);

// Build an object, measure its footprint (local, on the floor) once per type/props combination
const footprintCache = new Map();
export function buildObject(type, props) {
  const def = CATALOG_BY_TYPE[type];
  if (!def) return null;
  const built = def.build({ ...def.defaults, ...props });
  const key = type + JSON.stringify(props ?? {});
  if (!footprintCache.has(key)) {
    const bb = new THREE.Box3().setFromObject(built.group);
    footprintCache.set(key, bb.isEmpty() ? { min: [-0.5, -0.5], max: [0.5, 0.5] } : { min: [bb.min.x, bb.min.z], max: [bb.max.x, bb.max.z] });
  }
  built.footprint = footprintCache.get(key);
  built.group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = o.castShadow !== false;
      o.receiveShadow = true;
    }
  });
  return built;
}
export { cyl };
