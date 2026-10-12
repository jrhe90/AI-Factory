// Auto-build: fills the drawn zones with a working factory. Rule-based, not AI: each zone
// kind has a template (lines of stations, storage, docks); the generator wires the zones
// into one flow (receiving -> feeder lines -> assembly -> finished goods -> shipping), staffs
// the manual stations and lays an AGV loop with a spur to every pick-up and drop-off point.
import { buildObject, CATALOG_BY_TYPE } from '../library/catalog.js';
import { newId } from './project.js';

const S = (type, name, props = {}) => ({ type, name, props });

// Process zones become parallel lines along the zone's long side
const LINE_TEMPLATES = {
  assembly: {
    label: 'Assembly line', tag: 'letter', pitch: 8.2, inBuffer: S('buffer', 'Kitting buffer', { capacity: 8 }), colors: ['#7c5cff', '#22c55e', '#ec4899', '#14b8a6'],
    stations: [
      S('induction-heater', 'Stator shrink-fit', { cycleTime: 95 }),
      S('lift-assist', 'Rotor insertion', { cycleTime: 90 }),
      S('hydraulic-press', 'Bearings & brackets', { cycleTime: 100, mtbf: 5, mttr: 15 }),
      S('assembly-bench', 'Fan & cover', { cycleTime: 95 }),
      S('wiring-bench', 'Conduit box & leads', { cycleTime: 100 }),
      S('robot-cell', 'Robot screwdriving', { cycleTime: 80 }),
      S('test-stand', 'Run test', { cycleTime: 112 }),
      S('paint-booth', 'Paint', { cycleTime: 90 }),
      S('vision-qc', 'Vision QC', { cycleTime: 40 }),
      S('pack-station', 'Pack & label', { cycleTime: 80 }),
    ],
  },
  production: {
    label: 'Machining line', tag: 'number', pitch: 5.5, inBuffer: S('buffer', 'Castings buffer', { capacity: 6 }), colors: ['#3b82f6', '#0ea5e9', '#6366f1'],
    stations: [
      S('saw', 'Bar saw', { cycleTime: 60 }),
      S('cnc-lathe', 'CNC turning', { cycleTime: 100 }),
      S('machining-centre', 'Bore & drill', { cycleTime: 110, mtbf: 6, mttr: 20 }),
      S('grinder', 'Bearing-seat grind', { cycleTime: 95 }),
      S('washer', 'Parts washer', { cycleTime: 70 }),
    ],
    end: S('buffer', 'Machined frames', { capacity: 8 }),
  },
  secondary: {
    label: 'Stator line', tag: 'number', pitch: 5.2, colors: ['#f28c28', '#eab308', '#f97316'],
    stations: [
      S('coil-winder', 'Coil winding', { cycleTime: 105 }),
      S('enclosed-machine', 'Coil insertion', { cycleTime: 100 }),
      S('vpi-tank', 'VPI impregnation', { cycleTime: 115, mtbf: 8, mttr: 30 }),
      S('oven', 'Cure oven', { cycleTime: 110 }),
    ],
    end: S('buffer', 'Wound stators', { capacity: 8 }),
  },
};
const MANUAL = new Set(['bench', 'assembly-bench', 'wiring-bench', 'lift-assist', 'inspection-bench', 'pack-station']);
const NAMES = ['Ana', 'Ben', 'Chen', 'Dee', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jo', 'Kai', 'Lena', 'Mo', 'Nia', 'Omar', 'Pia', 'Raj', 'Sam', 'Tess', 'Uma', 'Vic', 'Wen', 'Yara', 'Zed'];

const bbox = (pts) => {
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
};
const r1 = (v) => Math.round(v * 10) / 10;

// Footprint along the flow axis (local x) and across it (local z)
const sizeCache = new Map();
function size(type, props = {}) {
  const key = type + JSON.stringify(props);
  if (!sizeCache.has(key)) {
    const b = buildObject(type, props);
    const f = b?.footprint ?? { min: [-1, -1], max: [1, 1] };
    const pt = (q) => (q ? [q.x, q.z] : [0, 0]);
    sizeCache.set(key, { len: f.max[0] - f.min[0], dep: f.max[1] - f.min[1], fp: f, entry: pt(b?.entry), exit: pt(b?.exit) });
  }
  return sizeCache.get(key);
}
// Largest bay count whose rack/ASRS fits in `room` metres
function fitBays(type, base, room, maxBays) {
  for (let b = maxBays; b >= 2; b--) if (size(type, { ...base, bays: b }).len <= room) return b;
  return 2;
}

// A zone's local frame: u runs along the long side, w across it
function frame(z) {
  const b = bbox(z.points);
  const W = b.x1 - b.x0;
  const D = b.z1 - b.z0;
  const horiz = W >= D;
  return {
    ...b, horiz, L: horiz ? W : D, Dw: horiz ? D : W, cx: (b.x0 + b.x1) / 2, cz: (b.z0 + b.z1) / 2,
    at: (u, w) => (horiz ? [b.x0 + u, b.z0 + w] : [b.x0 + w, b.z0 + u]),
    rot: horiz ? 0 : 270, // flow runs along +u
  };
}

// Rotation that turns an object's end (local +x) or front (local +z) towards a point
function faceRot(f, side, to) {
  if (f.horiz) {
    if (side === 'end') return to[0] >= f.cx ? 0 : 180;
    return to[1] >= f.cz ? 0 : 180;
  }
  if (side === 'end') return to[1] >= f.cz ? 270 : 90;
  return to[0] >= f.cx ? 90 : 270;
}

// local (lx, lz) of an object at (x, z, rot) -> world
function local(o, lx, lz) {
  const r = ((o.rot ?? 0) * Math.PI) / 180;
  return [o.x + lx * Math.cos(r) + lz * Math.sin(r), o.z - lx * Math.sin(r) + lz * Math.cos(r)];
}

export function autoBuild(project) {
  const p = project;
  const created = [];
  const order = []; // reveal order: [id, group]
  const counts = { lines: 0, stations: 0, operators: 0, vehicles: 0, storage: 0, links: 0, routes: 0 };
  const zones = p.zones.map((z) => ({ z, f: frame(z) }));
  if (!zones.length) return null;

  // Building outline: the drawn walls, else the zones plus a margin
  const all = bbox([...p.zones.flatMap((z) => z.points), ...p.walls.flatMap((w) => w.points)]);
  const pad = p.walls.length ? 0 : 1.2;
  const bld = { x0: all.x0 - pad, x1: all.x1 + pad, z0: all.z0 - pad, z1: all.z1 + pad };
  const mid = [(bld.x0 + bld.x1) / 2, (bld.z0 + bld.z1) / 2];
  if (!p.walls.length) {
    p.walls.push({ id: newId(p, 'wall'), points: [[bld.x0, bld.z0], [bld.x1, bld.z0], [bld.x1, bld.z1], [bld.x0, bld.z1], [bld.x0, bld.z0]], height: 4, thickness: 0.25 });
  }

  let group = 0;
  const add = (type, name, x, z, rot = 0, props = {}, lineId = '') => {
    const def = CATALOG_BY_TYPE[type];
    const id = newId(p, 'object', type);
    p.objects.push({ id, type, name, x: r1(x), z: r1(z), rot, lineId, props: { ...def.defaults, ...props } });
    created.push(id);
    order.push([id, group]);
    return p.objects[p.objects.length - 1];
  };
  const link = (from, to, kind) => {
    p.links.push({ id: newId(p, 'link'), from: from.id, to: to.id, kind });
    counts.links++;
  };
  const staff = (st) => {
    const need = st.props.operators ?? 0;
    if (!MANUAL.has(st.type) || !need) return;
    for (let i = 0; i < need; i++) {
      const [x, z] = local(st, need > 1 ? (i - (need - 1) / 2) * 1.2 : 0, 2.3);
      add('operator', NAMES[counts.operators % NAMES.length], x, z, ((st.rot ?? 0) + 90) % 360, { stationId: st.id });
      counts.operators++;
    }
  };

  // Which building edge a zone sits against (for dock doors)
  const outerEdge = (f) => {
    const d = [['w', f.x0 - bld.x0], ['e', bld.x1 - f.x1], ['n', f.z0 - bld.z0], ['s', bld.z1 - f.z1]];
    d.sort((a, b) => a[1] - b[1]);
    return d[0][0];
  };
  // Dock at an outer edge: the truck sits outside (dock local -x points out of the building)
  const DOCK_ROT = { w: 0, e: 180, n: 270, s: 90 };
  const dockAt = (f, edge, t) => {
    if (edge === 'w') return [bld.x0, f.z0 + (f.z1 - f.z0) * t];
    if (edge === 'e') return [bld.x1, f.z0 + (f.z1 - f.z0) * t];
    if (edge === 'n') return [f.x0 + (f.x1 - f.x0) * t, bld.z0];
    return [f.x0 + (f.x1 - f.x0) * t, bld.z1];
  };

  // ---------------------------------------------------------------- raw material stores
  const rawStores = []; // { node, at:[x,z], used }
  for (const { z, f } of zones.filter((q) => q.z.kind === 'warehouse' || q.z.kind === 'dock')) {
    group++;
    const edge = outerEdge(f);
    const docks = z.kind === 'dock' ? Math.max(1, Math.min(2, Math.floor((edge === 'w' || edge === 'e' ? f.z1 - f.z0 : f.x1 - f.x0) / 14))) : 1;
    const dockObjs = [];
    for (let i = 0; i < docks; i++) {
      const [x, zz] = dockAt(f, edge, (i + 1) / (docks + 1));
      dockObjs.push(add('receiving-dock', `Receiving door ${rawStores.length + i + 1}`, x, zz, DOCK_ROT[edge], { interval: z.kind === 'dock' ? 120 : 90, itemColor: z.kind === 'dock' ? '#c8763a' : '#9aa3ad' }));
    }
    // Storage rows along the zone's long side, away from the dock wall
    const asrs = z.kind === 'warehouse';
    const type = asrs ? 'asrs' : 'pallet-rack';
    const room = f.L - 6;
    const bays = asrs ? fitBays('asrs', { levels: 7 }, room, 12) : fitBays('pallet-rack', { levels: 3 }, room, 6);
    const props = asrs ? { bays, levels: 7, capacity: 60, handling: 25 } : { bays, levels: 3, capacity: 30, handling: 15 };
    const sz = size(type, props);
    const pitch = sz.dep + 4.5;
    const rows = Math.max(1, Math.min(2, Math.floor((f.Dw - 2) / pitch)));
    const stores = [];
    // ASRS pick-up is at its end, rack pick-up at its face: turn either towards the plant
    const rot = faceRot(f, asrs ? 'end' : 'front', mid);
    for (let i = 0; i < rows; i++) {
      const w = f.Dw / 2 + (i - (rows - 1) / 2) * pitch;
      const [x, zz] = f.at(f.L / 2, w);
      const o = add(type, asrs ? `${z.name} ASRS ${i + 1}` : `Raw material rack ${i + 1}`, x, zz, rot, props);
      stores.push(o);
      counts.storage++;
    }
    for (const d of dockObjs) for (const st of stores) link(d, st, 'manual');
    for (const s of stores) rawStores.push({ node: s, used: 0, kind: z.kind });
    // A few pallets by the doors
    for (const d of dockObjs) {
      const [x, zz] = local(d, 3.2, 3.2);
      add('pallet', 'Pallets', x, zz, 0, { layers: 2 });
    }
  }

  // ---------------------------------------------------------------- process lines
  const feeders = []; // last node of each feeder line
  const assemblyLines = []; // { first, last }
  const lineCount = { assembly: 0, production: 0, secondary: 0 };
  const procOrder = ['secondary', 'production', 'assembly'];
  for (const kind of procOrder) {
    for (const { z, f } of zones.filter((q) => q.z.kind === kind)) {
      const tpl = LINE_TEMPLATES[kind];
      const steps = [...(tpl.inBuffer ? [tpl.inBuffer] : []), ...tpl.stations, ...(tpl.end ? [tpl.end] : [])];
      const margin = 1.5;
      const usable = f.L - 2 * margin;
      let n = Math.min(steps.length, Math.floor(usable / tpl.pitch));
      if (n < 2) continue;
      let chosen = steps;
      if (n < steps.length) {
        // keep the first steps and the last one (the line has to finish)
        chosen = [...steps.slice(0, n - 1), steps[steps.length - 1]];
      }
      n = chosen.length;
      const nLines = Math.max(1, Math.min(4, Math.floor((f.Dw - 8) / 8.5) + 1));
      const spacing = usable / n;
      for (let j = 0; j < nLines; j++) {
        group++;
        lineCount[kind]++;
        counts.lines++;
        const lineId = newId(p, 'line');
        const tag = tpl.tag === 'letter' ? String.fromCharCode(64 + lineCount[kind]) : String(lineCount[kind]);
        p.lines.push({ id: lineId, name: `${tpl.label} ${tag}`, color: tpl.colors[(lineCount[kind] - 1) % tpl.colors.length] });
        const w = f.Dw * (j + 0.5) / nLines - (nLines > 1 ? 1 : 0);
        const nodes = chosen.map((s, i) => {
          const [x, zz] = f.at(margin + spacing * (i + 0.5), w);
          const o = add(s.type, `${s.name} ${tag}`, x, zz, f.rot, s.props, lineId);
          if (CATALOG_BY_TYPE[s.type].role === 'station') counts.stations++;
          return o;
        });
        for (let i = 1; i < nodes.length; i++) link(nodes[i - 1], nodes[i], 'conveyor');
        nodes.forEach(staff);
        const line = { first: nodes[0], last: nodes[nodes.length - 1], kind, zone: z };
        if (kind === 'assembly') assemblyLines.push(line);
        else feeders.push(line);
      }
    }
  }

  // ---------------------------------------------------------------- finished goods and shipping
  const fgStores = [];
  for (const { z, f } of zones.filter((q) => q.z.kind === 'storage')) {
    group++;
    const edge = outerEdge(f);
    // the door goes at the end of the zone nearer the plant, racks fill the rest
    const towards = f.horiz ? mid[0] >= f.cx : mid[1] >= f.cz;
    const dockT = towards ? 0.85 : 0.15;
    const avail = f.L * 0.85 - 6;
    const bays = fitBays('pallet-rack', { levels: 4 }, Math.min(avail - 2, 22), 7);
    const props = { bays, levels: 4, capacity: 40, handling: 15 };
    const sz = size('pallet-rack', props);
    const pitch = sz.dep + 4;
    const rows = Math.max(1, Math.min(4, Math.floor((f.Dw - 9) / pitch)));
    const uc = towards ? 1 + avail / 2 : f.L - 1 - avail / 2;
    const rot = faceRot(f, 'front', mid);
    // rows start at the side facing into the building; the dock side is left for staging
    const inward = (edge === 's' || edge === 'e') ? 1 : -1;
    const racks = [];
    for (let i = 0; i < rows; i++) {
      const w = inward > 0 ? 3 + sz.dep / 2 + i * pitch : f.Dw - 3 - sz.dep / 2 - i * pitch;
      const [x, zz] = f.at(uc, w);
      racks.push(add('pallet-rack', `${z.name} rack ${racks.length + 1}`, x, zz, rot, { ...props, seed: racks.length + 3 }));
      counts.storage++;
    }
    const [dx, dz] = dockAt(f, edge, dockT);
    const dock = add('shipping-dock', `Shipping door ${fgStores.length + 1}`, dx, dz, DOCK_ROT[edge]);
    // staging pallets either side of the door
    for (let i = 0; i < 4; i++) {
      const [x, zz] = local(dock, 4 + (i % 2) * 1.4, i > 1 ? 4 : -4);
      add('pallet', 'Pallets', x, zz, 0, { layers: 2 + (i % 2) });
    }
    // the rack row nearest the production area takes finished goods; it ships by vehicle
    const flow = racks[0];
    if (flow) {
      link(flow, dock, 'transport');
      fgStores.push({ node: flow, used: 0 });
    }
  }

  // ---------------------------------------------------------------- welfare, offices, utilities (set dressing)
  for (const { z, f } of zones.filter((q) => ['break', 'welfare', 'office'].includes(q.z.kind))) {
    group++;
    const cols = Math.max(1, Math.min(4, Math.floor((f.x1 - f.x0 - 3) / 4)));
    const rows = Math.max(1, Math.min(3, Math.floor((f.z1 - f.z0 - 3) / 4)));
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      add('table', z.kind === 'office' ? 'Desk' : 'Table', f.x0 + (f.x1 - f.x0) * (i + 0.5) / cols, f.z0 + (f.z1 - f.z0) * (j + 0.5) / rows, 0);
    }
  }
  for (const { f } of zones.filter((q) => q.z.kind === 'utility')) {
    group++;
    for (let i = 0; i < 3; i++) add('tank', 'Tank', f.cx + (i - 1) * 4, f.cz, 0);
  }

  // ---------------------------------------------------------------- wire the flow
  const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  // nearest store, with a penalty per line already served so the work spreads out
  const pick = (list, target, penalty) => {
    if (!list.length) return null;
    let best = null;
    let bs = Infinity;
    for (const s of list) {
      const score = d2(s.node, target) + s.used * penalty;
      if (score < bs) {
        bs = score;
        best = s;
      }
    }
    best.used++;
    return best.node;
  };
  // feeders draw from the nearest raw store
  for (const fl of feeders) {
    const src = pick(rawStores, fl.first, 40);
    if (src) link(src, fl.first, 'transport');
  }
  // feeders deliver to assembly lines round-robin (machining and stator lines spread evenly)
  const feedersByKind = [...feeders.filter((q) => q.kind === 'production'), ...feeders.filter((q) => q.kind === 'secondary')];
  if (assemblyLines.length) {
    feedersByKind.forEach((fl, i) => {
      const al = assemblyLines[i % assemblyLines.length];
      link(fl.last, al.first, 'transport');
    });
    // assembly lines with no feeder draw straight from raw stores
    for (const al of assemblyLines) {
      if (p.links.some((l) => l.to === al.first.id)) continue;
      const src = pick(rawStores, al.first, 40);
      if (src) link(src, al.first, 'transport');
    }
  }
  // finished goods
  const outLines = assemblyLines.length ? assemblyLines : feeders;
  for (const al of outLines) {
    const fg = pick(fgStores, al.last, 1000);
    if (fg) link(al.last, fg, 'transport');
    else {
      const [x, zz] = local(al.last, 5, 0);
      const sink = add('sink', 'Finished goods', x, zz, al.last.rot);
      link(al.last, sink, 'conveyor');
    }
  }

  // ---------------------------------------------------------------- AGV network
  group++;
  const procZones = zones.filter((q) => q.z.kind === 'assembly' || q.z.kind === 'secondary');
  const core = (procZones.length ? procZones : zones.filter((q) => ['production', 'assembly', 'secondary'].includes(q.z.kind))).map((q) => q.f);
  const segs = [];
  if (core.length) {
    const off = 1.8;
    const R = { x0: Math.min(...core.map((c) => c.x0)) - off, x1: Math.max(...core.map((c) => c.x1)) + off, z0: Math.min(...core.map((c) => c.z0)) - off, z1: Math.max(...core.map((c) => c.z1)) + off };
    const ring = [[R.x0, R.z0], [R.x1, R.z0], [R.x1, R.z1], [R.x0, R.z1], [R.x0, R.z0]];
    p.routes.push({ id: newId(p, 'route'), name: 'Main loop', points: ring.map(([x, z]) => [r1(x), r1(z)]), oneWay: false, color: '#06b6d4' });
    for (let i = 1; i < ring.length; i++) segs.push([ring[i - 1], ring[i]]);
    // Main aisle: the loop's side with more room, run the full width of the building
    const roomS = bld.z1 - R.z1;
    const roomN = R.z0 - bld.z0;
    const zA = roomS >= roomN ? R.z1 : R.z0;
    const main = [[bld.x0 + 3, zA], [bld.x1 - 3, zA]];
    p.routes.push({ id: newId(p, 'route'), name: 'Main aisle', points: main.map(([x, z]) => [r1(x), r1(z)]), oneWay: false, color: '#06b6d4' });
    segs.push(main);
    p.aisles.push({ id: newId(p, 'aisle'), points: main.map(([x, z]) => [r1(x), r1(z)]), width: 4.2 });
    p.aisles.push({ id: newId(p, 'aisle'), points: [[R.x0, roomS >= roomN ? R.z0 : R.z1], [R.x1, roomS >= roomN ? R.z0 : R.z1]].map(([x, z]) => [r1(x), r1(z)]), width: 2.6 });
    // Cross aisles through gaps between neighbouring process zones
    const xs = core.slice().sort((a, b) => a.x0 - b.x0);
    for (let i = 1; i < xs.length; i++) {
      const gap = xs[i].x0 - xs[i - 1].x1;
      if (gap >= 2) {
        const x = (xs[i].x0 + xs[i - 1].x1) / 2;
        const cross = [[x, R.z0], [x, R.z1]];
        p.routes.push({ id: newId(p, 'route'), name: 'Cross aisle', points: cross.map(([a, b]) => [r1(a), r1(b)]), oneWay: false, color: '#06b6d4' });
        segs.push(cross);
      }
    }
    // Spurs: from the nearest trunk segment straight to every vehicle pick-up / drop-off
    const ends = [];
    const objById = new Map(p.objects.map((o) => [o.id, o]));
    // the object's own entry/exit point, pushed 0.6 m clear of the object
    const endPoint = (o, which) => {
      const s = size(o.type, o.props);
      const [px, pz] = s[which];
      const cx = (s.fp.min[0] + s.fp.max[0]) / 2;
      const cz = (s.fp.min[1] + s.fp.max[1]) / 2;
      const len = Math.hypot(px - cx, pz - cz) || 1;
      return local(o, px + ((px - cx) / len) * 0.6, pz + ((pz - cz) / len) * 0.6);
    };
    for (const l of p.links) {
      if (l.kind !== 'transport') continue;
      ends.push(endPoint(objById.get(l.from), 'exit'), endPoint(objById.get(l.to), 'entry'));
    }
    const seen = new Set();
    let spurN = 0;
    for (const e of ends) {
      const key = `${Math.round(e[0])}|${Math.round(e[1])}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let best = null;
      let bd = Infinity;
      for (const [a, b] of segs) {
        const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1;
        const t = Math.max(0, Math.min(1, ((e[0] - a[0]) * (b[0] - a[0]) + (e[1] - a[1]) * (b[1] - a[1])) / L2));
        const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const d = Math.hypot(q[0] - e[0], q[1] - e[1]);
        if (d < bd) {
          bd = d;
          best = q;
        }
      }
      if (!best || bd < 1.5) continue;
      p.routes.push({ id: newId(p, 'route'), name: `Spur ${++spurN}`, points: [[r1(best[0]), r1(best[1])], [r1(e[0]), r1(e[1])]], oneWay: false, color: '#06b6d4' });
    }
    counts.routes = p.routes.length;

    // Vehicles parked along the main aisle
    group++;
    const transports = p.links.filter((l) => l.kind === 'transport').length;
    const agvs = Math.max(2, Math.min(8, Math.ceil(transports * 0.7)));
    const span = main[1][0] - main[0][0];
    for (let i = 0; i < agvs; i++) {
      add('agv', `AGV ${i + 1}`, main[0][0] + span * (0.25 + (0.5 * i) / Math.max(1, agvs - 1)), zA, 0, { speed: 2.2 });
      counts.vehicles++;
    }
    for (let i = 0; i < 2; i++) {
      add('forklift', `Forklift ${i + 1}`, main[0][0] + span * (i ? 0.88 : 0.1), zA, 0, { speed: 2.8 });
      counts.vehicles++;
    }
  }

  return { created, order, counts };
}
