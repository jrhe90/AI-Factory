// The reference layout the user shared (secondary processes, assembly area, east lines,
// warehouses, welfare block), rebuilt as an editable, runnable Sim Factory project.
// The drawing is 2000 x 1183 px at ~8.2 cm/px, so the building is ~160 m x 85 m.
import { emptyProject, rectPoints } from '../model/project.js';
import { CATALOG_BY_TYPE } from '../library/catalog.js';

export function referenceProject() {
  const p = emptyProject('Reference motor plant');
  p.floor = {
    ...p.floor,
    source: { kind: 'image', name: 'reference-plan.webp', image: `${import.meta.env.BASE_URL}samples/reference-plan.webp`, width: 2000, height: 1183 },
    mpp: 0.082,
    center: [0, 4.22],
    opacity: 0.45,
  };

  // ---- walls (exterior + the two band partitions, with door gaps)
  let w = 0;
  const wall = (...pts) => p.walls.push({ id: `W${++w}`, points: pts, height: 3, thickness: 0.2 });
  wall([-80, -42], [80, -42], [80, 43], [-80, 43], [-80, -42]);
  for (const [a, b] of [[-80, -75], [-73, -62], [-58, -37], [-31, -24.5], [-20, -2], [2, 16.5], [21.5, 34], [38, 58], [74, 80]]) wall([a, -22.5], [b, -22.5]);
  for (const x of [-68.5, -52, -43.5, -24.5, -20, 22.5, 26.5, 46.7, 53.7]) wall([x, -42], [x, -22.5]);
  for (const [a, b] of [[-80, -76], [-72, -68], [-8, -1.6], [-0.4, 15.4], [16.6, 38], [42, 62], [78, 80]]) wall([a, 9.5], [b, 9.5]);
  for (const x of [-8, 24, 60]) wall([x, 9.5], [x, 43]);

  // ---- zones (as labelled on the drawing)
  let z = 0;
  const zone = (name, kind, color, x0, z0, x1, z1) => p.zones.push({ id: `Z${++z}`, name, kind, color, points: rectPoints(x0, z0, x1, z1) });
  zone('Secondary processes', 'secondary', '#f28c28', -54, -19.5, -24, 4.5);
  zone('Assembly process', 'assembly', '#2563eb', -21, -19.5, 76, 4.5);
  zone('East lines 1–3', 'production', '#3b82f6', -20, -41.5, 22.5, -23);
  zone('General warehouse', 'warehouse', '#16a34a', 53.7, -41.5, 79.5, -23);
  zone('Warehouse 2 & rewinding', 'warehouse', '#0ea5e9', 24, 10, 60, 42.5);
  zone('Finished goods staging', 'storage', '#ca8a04', -55, 10, -8, 42.5);
  zone('Receiving dock', 'dock', '#64748b', -80, 10, -68.5, 42.5);
  zone('Kitchen', 'break', '#14b8a6', -8, 27, 10, 42.5);
  zone('Office & QC lab', 'office', '#8b5cf6', -80, -41.5, -68.5, -23);
  zone('Transformer', 'utility', '#ef4444', -80, -19.5, -55, 4.5);

  p.aisles.push({ id: 'A1', points: [[-78, 7], [78, 7]], width: 4.5 }, { id: 'A2', points: [[-78, -21], [78, -21]], width: 2.4 });

  // ---- AGV route network: a loop round the assembly area plus spurs
  p.routes.push(
    { id: 'R1', name: 'Main loop', points: [[-58, 6.2], [77, 6.2], [77, -20.9], [-58, -20.9], [-58, 6.2]], oneWay: false, color: '#06b6d4' },
    { id: 'R2', name: 'Warehouse spur', points: [[68.5, -20.9], [68.5, -33]], oneWay: false, color: '#06b6d4' },
    { id: 'R3', name: 'East lines spur', points: [[19.5, -20.9], [19.5, -33.5]], oneWay: false, color: '#06b6d4' },
    { id: 'R4', name: 'Receiving spur', points: [[-58, 6.2], [-74, 6.2], [-74, 26]], oneWay: false, color: '#06b6d4' },
    { id: 'R5', name: 'Shipping spur', points: [[-37, 6.2], [-37, 36]], oneWay: false, color: '#06b6d4' },
    { id: 'R6', name: 'FG spur', points: [[71, 6.2], [71, 36]], oneWay: false, color: '#06b6d4' },
  );

  p.lines.push(
    { id: 'L1', name: 'East Line 1 · Machining', color: '#3b82f6' },
    { id: 'L2', name: 'Stator line', color: '#f28c28' },
    { id: 'L3', name: 'Assembly Line A', color: '#7c5cff' },
    { id: 'L4', name: 'Assembly Line B', color: '#22c55e' },
  );

  const counts = {};
  const obj = (type, name, x, zz, rot = 0, lineId = '', props = {}) => {
    const prefix = type.slice(0, 3).toUpperCase();
    counts[prefix] = (counts[prefix] ?? 0) + 1;
    const id = `${prefix}${counts[prefix]}`;
    p.objects.push({ id, type, name, x, z: zz, rot, lineId, props: { ...CATALOG_BY_TYPE[type].defaults, ...props } });
    return id;
  };
  let k = 0;
  const link = (from, to, kind = 'conveyor') => p.links.push({ id: `K${++k}`, from, to, kind });
  const chain = (ids, kind = 'conveyor') => ids.slice(1).forEach((id, i) => link(ids[i], id, kind));

  // General warehouse: castings arrive and are stored in the ASRS
  const castIn = obj('source', 'Castings delivery', 75, -36, 180, '', { interval: 140, itemColor: '#9aa3ad' });
  const asrs = obj('asrs', 'Castings ASRS', 60, -36, 0, '', { bays: 9, levels: 7, capacity: 80, handling: 25 });
  link(castIn, asrs, 'manual');

  // East Line 1: machining cell
  const el = [
    obj('cnc-lathe', 'CNC turning', -14, -36, 0, 'L1', { cycleTime: 110 }),
    obj('machining-centre', 'Bore & drill', -4, -36, 0, 'L1', { cycleTime: 120, mtbf: 6, mttr: 20 }),
    obj('washer', 'Parts washer', 6, -36, 0, 'L1', { cycleTime: 70 }),
    obj('buffer', 'Machined frames', 15, -36, 0, 'L1', { capacity: 8 }),
  ];
  chain(el);
  link(asrs, el[0], 'transport');

  // Receiving → raw material rack → stator line (secondary processes)
  const recv = obj('receiving-dock', 'Receiving dock', -80, 22, 0, '', { interval: 140, itemColor: '#c8763a' });
  const raw = obj('pallet-rack', 'Raw material rack', -71, 33, 180, '', { bays: 3, levels: 3, capacity: 30, handling: 15 });
  link(recv, raw, 'manual');
  const st = [
    obj('coil-winder', 'Coil winding', -49, -12, 0, 'L2', { cycleTime: 120 }),
    obj('enclosed-machine', 'Coil insertion', -42, -12, 0, 'L2', { cycleTime: 100 }),
    obj('vpi-tank', 'VPI impregnation', -35, -12, 0, 'L2', { cycleTime: 125, mtbf: 8, mttr: 30 }),
    obj('oven', 'Cure oven', -28, -12, 0, 'L2', { cycleTime: 130 }),
  ];
  chain(st);
  link(raw, st[0], 'transport');

  // Assembly Line A (machined frames) → FG / shipping
  const a = [
    obj('induction-heater', 'Stator shrink-fit', -14, -13.5, 0, 'L3', { cycleTime: 95 }),
    obj('lift-assist', 'Rotor insertion', -4, -13.5, 0, 'L3', { cycleTime: 90 }),
    obj('hydraulic-press', 'Bearings & brackets', 6, -13.5, 0, 'L3', { cycleTime: 100, mtbf: 5, mttr: 15 }),
    obj('assembly-bench', 'Fan & cover', 16, -13.5, 0, 'L3', { cycleTime: 95 }),
    obj('wiring-bench', 'Conduit box & leads', 26, -13.5, 0, 'L3', { cycleTime: 100 }),
    obj('test-stand', 'Run test', 36, -13.5, 0, 'L3', { cycleTime: 115 }),
    obj('paint-booth', 'Paint', 46, -13.5, 0, 'L3', { cycleTime: 90 }),
    obj('vision-qc', 'Vision QC', 56, -13.5, 0, 'L3', { cycleTime: 40 }),
    obj('pack-station', 'Pack & label', 66, -13.5, 0, 'L3', { cycleTime: 80 }),
  ];
  chain(a);
  link(el[3], a[0], 'transport');
  const shipA = obj('shipping-dock', 'Shipping dock 3', 71, 43, 90);
  link(a[a.length - 1], shipA, 'transport');

  // Assembly Line B (wound stators from the stator line)
  const b = [
    obj('assembly-bench', 'Stator & frame', -12, -3, 0, 'L4', { cycleTime: 110 }),
    obj('robot-cell', 'Robot screwdriving', 0, -3, 0, 'L4', { cycleTime: 80 }),
    obj('test-stand', 'Run test B', 14, -3, 0, 'L4', { cycleTime: 120 }),
    obj('vision-qc', 'Vision QC B', 26, -3, 0, 'L4', { cycleTime: 40 }),
    obj('pack-station', 'Pack B', 36, -3, 0, 'L4', { cycleTime: 85 }),
  ];
  chain(b);
  link(st[st.length - 1], b[0], 'transport');
  const shipB = obj('shipping-dock', 'Shipping dock 2', -37.25, 43, 90);
  link(b[b.length - 1], shipB, 'transport');

  // Operators at the manual benches (they walk to the kitchen on breaks)
  const op = (name, x, zz, stationId) => obj('operator', name, x, zz, 90, '', { stationId });
  op('Ana', 15.4, -11.2, a[3]);
  op('Ben', 16.6, -11.2, a[3]);
  op('Chen', 26, -11.2, a[4]);
  op('Dee', -12.6, -0.7, b[0]);
  op('Eli', -11.4, -0.7, b[0]);

  // Vehicles
  for (let i = 0; i < 4; i++) obj('agv', `AGV ${i + 1}`, -4 + i * 4, 6.2, 0, '', { speed: 2.2 });
  obj('forklift', 'Forklift 1', 71, 9, 90, '', { speed: 2.8 });
  obj('forklift', 'Forklift 2', -37, 9, 90, '', { speed: 2.8 });

  // A little set dressing
  for (const x of [-40, -10.75, 10.25, 31.25, 52.25]) obj('column', 'Column', x, -8.2);
  obj('tank', 'Resin tank', -36, -16.5);
  obj('pallet', 'Pallets', -66, 14);
  obj('pallet', 'Pallets', -64.5, 14);
  return p;
}
