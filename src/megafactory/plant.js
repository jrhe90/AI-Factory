// Megafactory plant definition: process graph + physical layout, as plain data.
// Shared by the simulation (which only needs the graph, times and lengths) and the 3D view
// (which places equipment and items from the same coordinates).
// Units: metres and minutes. x → east, z → south, y up. The pack line runs along the south
// side of the building, the powder coat loop along the north side.

export const RAIL_Y = 4.2;      // overhead power-and-free rail height (top of free track)
export const HANG_Y = 1.45;     // bottom of a hanging frame above the floor
export const PITCH = 12;        // carrier spacing on the paint rail (a frame is 8.8 m long)

export const BUILDING = { x0: -128, x1: 112, z0: -82, z1: 26, h: 13 };
export const DOOR_X = 36;       // south door the straddle carriers use

// Floor zones (rectangles) with their labels
export const ZONES = [
  { key: 'paint', label: 'POWDER COAT', x0: -110, x1: 100, z0: -76, z1: -42, color: '#2f6db5' },
  { key: 'biw', label: 'BODY IN WHITE', x0: -124, x1: -104, z0: -50, z1: 4, color: '#c8102e' },
  { key: 'module', label: 'BATTERY MODULES', x0: -2, x1: 72, z0: -31, z1: -17, color: '#d9731a' },
  { key: 'rack', label: 'MODULE RACKS', x0: -50, x1: -10, z0: -33, z1: -15, color: '#d9731a' },
  { key: 'pack', label: 'PACK LINE', x0: -92, x1: 44, z0: 2, z1: 14, color: '#5a6672' },
  { key: 'ship', label: 'SHIPPING', x0: 26, x1: 46, z0: 14, z1: 24, color: '#2e8a57' },
];

// Megapack storage lot outside the south wall: 5 aisles × 12 rows
export const LOT = { x0: 20, dx: 16, cols: 5, z0: 42, dz: 4, rows: 12 };
export const TRUCK_BAY = [110, 96];

const lotSlots = [];
for (let c = 0; c < LOT.cols; c++) for (let r = 0; r < LOT.rows; r++) lotSlots.push([LOT.x0 + c * LOT.dx, LOT.z0 + r * LOT.dz]);

// Module rack warehouse: two rack rows × 7 bays × 4 levels = 56 tray positions
export const RACK = { x0: -44, dx: 4.2, bays: 7, rows: [-27.5, -20.5], levels: 4, dy: 1.35, y0: 0.35 };
const rackSlots = [];
for (let l = 0; l < RACK.levels; l++) for (const z of RACK.rows) for (let b = 0; b < RACK.bays; b++) rackSlots.push([RACK.x0 + b * RACK.dx, z, RACK.y0 + l * RACK.dy]);

const line = (x0, x1, z) => [[x0, z], [x1, z]];

// ------------------------------------------------------------------ process graph
// kind: source | station | conveyor | buffer | truck | sink
// station: one unit; time = mean process minutes; mode manual (lognormal) or auto (normal);
//          move = minutes to transfer in (the unit is drawn travelling from the previous node).
// conveyor: continuous accumulating track along `path`; v in m/min; units keep `pitch` apart.
// buffer: FIFO store with `cap` places at `slots`.
export const NODES = [
  // ---------------- Body in White (west column, flows north)
  { key: 'BIW_SRC', kind: 'source', make: 'frame', next: 'BIW1' },
  { key: 'BIW1', kind: 'station', line: 'biw', label: 'Base Frame Weld', time: 30, mode: 'auto', move: 2, fail: true, pos: [-114, -4], next: 'BIW2' },
  { key: 'BIW2', kind: 'station', line: 'biw', label: 'Side Post Weld', time: 35, mode: 'auto', move: 3, fail: true, pos: [-114, -17], next: 'BIW3' },
  { key: 'BIW3', kind: 'station', line: 'biw', label: 'Roof Rail Weld', time: 30, mode: 'auto', move: 3, fail: true, pos: [-114, -30], next: 'BIW4' },
  { key: 'BIW4', kind: 'station', line: 'biw', label: 'Geometry Check', time: 22, mode: 'auto', move: 3, pos: [-114, -43], next: 'BIW_OUT' },
  { key: 'BIW_OUT', kind: 'conveyor', line: 'biw', label: 'Frame outfeed', path: [[-114, -50], [-114, -62]], v: 2, pitch: 3, sideways: true, next: 'LOAD' },

  // ---------------- Powder coat: north row flows east, south row flows west
  { key: 'DOOR_SRC', kind: 'source', make: 'doors', next: 'DOORKIT' },
  { key: 'DOORKIT', kind: 'buffer', line: 'paint', label: 'Door & panel kits', cap: 3, move: 6, slots: [[-112, -70], [-112, -74], [-112, -78]], next: 'LOAD' },
  { key: 'RECOAT', kind: 'buffer', line: 'paint', label: 'Strip & recoat queue', cap: 6, move: 4, hang: true,
    slots: [[-4, -38], [-16, -38], [-28, -38], [-40, -38], [-52, -38], [-64, -38]], next: 'LOAD' },
  { key: 'LOAD', kind: 'station', line: 'paint', label: 'Load & Hang', time: 12, mode: 'manual', move: 3, pos: [-102, -66], hang: true,
    pull: ['RECOAT', 'BIW_OUT', 'DOORKIT'], times: { doors: 9 }, next: 'PRE' },
  { key: 'PRE', kind: 'conveyor', line: 'paint', label: 'Pretreatment', sub: '5-stage wash · zirconium', path: line(-96, -54, -66), v: 2.6, hang: true, coat: 'pretreated', next: 'DRY' },
  { key: 'DRY', kind: 'conveyor', line: 'paint', label: 'Dry-off Oven', sub: '120 °C', path: line(-54, -32, -66), v: 2.2, hang: true, coat: 'dry', next: 'PRIMER' },
  { key: 'PRIMER', kind: 'conveyor', line: 'paint', label: 'Primer Booth', sub: 'automatic guns · grey primer', path: line(-32, -12, -66), v: 1.0, hang: true, booth: 'primer', coat: 'primer', fail: true, next: 'PTOUCH' },
  { key: 'PTOUCH', kind: 'station', line: 'paint', label: 'Primer Touch-up', time: 16, mode: 'manual', move: 2, pos: [-4, -66], hang: true, times: { doors: 9 }, next: 'GEL' },
  { key: 'GEL', kind: 'conveyor', line: 'paint', label: 'Gel Oven', sub: '180 °C partial cure', path: line(4, 30, -66), v: 1.6, hang: true, coat: 'gelled', next: 'COOL1' },
  { key: 'COOL1', kind: 'conveyor', line: 'paint', label: 'Cool Zone', path: line(30, 44, -66), v: 1.4, hang: true, next: 'TOP' },
  { key: 'TOP', kind: 'conveyor', line: 'paint', label: 'Topcoat Booth', sub: 'automatic guns · Megapack white', path: line(44, 64, -66), v: 1.0, hang: true, booth: 'topcoat', coat: 'topcoat', fail: true, next: 'TTOUCH' },
  { key: 'TTOUCH', kind: 'station', line: 'paint', label: 'Topcoat Touch-up', time: 16, mode: 'manual', move: 2, pos: [72, -66], hang: true, times: { doors: 9 }, next: 'CURE' },
  { key: 'CURE', kind: 'conveyor', line: 'paint', label: 'Cure Oven', sub: '200 °C', path: [[80, -66], [94, -66], [94, -50], [80, -50], [36, -50]], v: 1.6, hang: true, coat: 'cured', next: 'COOL2' },
  { key: 'COOL2', kind: 'conveyor', line: 'paint', label: 'Cooling Tunnel', path: line(36, 16, -50), v: 1.4, hang: true, next: 'INSP' },
  { key: 'INSP', kind: 'station', line: 'paint', label: 'Inspection', sub: 'film thickness · gloss', time: 10, mode: 'manual', move: 2, pos: [8, -50], hang: true, times: { doors: 6 }, route: 'inspect' },
  { key: 'REPAIR', kind: 'station', line: 'paint', label: 'Paint Repair', time: 30, mode: 'manual', move: 3, pos: [8, -38], hang: true, route: 'repair' },
  { key: 'OUT', kind: 'conveyor', line: 'paint', label: 'Coated frame buffer', path: [[0, -50], [-100, -50], [-100, -12]], v: 3, hang: true, next: 'DROP' },
  { key: 'DROP', kind: 'station', line: 'paint', label: 'Drop & Unload', time: 8, mode: 'manual', move: 2, pos: [-100, -4], hang: true, route: 'drop' },
  { key: 'DOORBUF', kind: 'buffer', line: 'pack', label: 'Coated doors', cap: 4, move: 4, slots: [[-104, 17], [-104, 21], [-94, 17], [-94, 21]] },

  // ---------------- Battery modules (middle row, flows west into the racks)
  { key: 'CELL_SRC', kind: 'source', make: 'tray', next: 'M1' },
  { key: 'M1', kind: 'station', line: 'module', label: 'Cell Intake & Test', time: 10, mode: 'auto', move: 1, fail: true, pos: [64, -24], next: 'M2' },
  { key: 'M2', kind: 'station', line: 'module', label: 'Cell Insertion', time: 11, mode: 'auto', move: 1, fail: true, pos: [52, -24], next: 'M3' },
  { key: 'M3', kind: 'station', line: 'module', label: 'Interconnect Weld', time: 11, mode: 'auto', move: 1, fail: true, pos: [40, -24], next: 'M4' },
  { key: 'M4', kind: 'station', line: 'module', label: 'Adhesive & Potting', time: 10, mode: 'auto', move: 1, fail: true, pos: [28, -24], next: 'M5' },
  { key: 'M5', kind: 'station', line: 'module', label: 'Lid & BMS Board', time: 11, mode: 'auto', move: 1, fail: true, pos: [16, -24], next: 'M6' },
  { key: 'M6', kind: 'station', line: 'module', label: 'Module EOL Test', time: 11, mode: 'auto', move: 1, test: 'modFail', pos: [4, -24], next: 'MOD_OUT' },
  { key: 'MOD_OUT', kind: 'conveyor', line: 'module', label: 'Tray outfeed', path: line(-2, -12, -24), v: 2, pitch: 3, next: 'RACK' },
  { key: 'RACK', kind: 'buffer', line: 'module', label: 'Module racks', cap: 56, move: 2, slots: rackSlots },

  // ---------------- Pack line (south row, flows east)
  { key: 'CL', kind: 'station', line: 'pack', label: 'Chassis Load', time: 26, mode: 'manual', move: 4, pos: [-84, 8], next: 'HV' },
  { key: 'HV', kind: 'station', line: 'pack', label: 'HV Busbar & Harness', time: 44, mode: 'manual', move: 3, fail: true, pos: [-69, 8], next: 'MI' },
  { key: 'MI', kind: 'station', line: 'pack', label: 'Module Install', time: 50, mode: 'manual', move: 3, fail: true, pos: [-54, 8], consume: { from: 'RACK', n: 4 }, next: 'TH' },
  { key: 'TH', kind: 'station', line: 'pack', label: 'Thermal & Inverter', time: 46, mode: 'manual', move: 3, fail: true, pos: [-39, 8], next: 'EN' },
  { key: 'EN', kind: 'station', line: 'pack', label: 'Enclosure & Doors', time: 48, mode: 'manual', move: 3, fail: true, pos: [-24, 8], consume: { from: 'DOORBUF', n: 1 }, next: 'CF' },
  { key: 'CF', kind: 'station', line: 'pack', label: 'Coolant Fill', time: 34, mode: 'manual', move: 3, fail: true, pos: [-9, 8], next: 'EOL' },
  { key: 'EOL', kind: 'station', line: 'pack', label: 'End-of-Line Test', time: 59, mode: 'auto', move: 3, fail: true, test: 'eolFail', pos: [6, 8], next: 'QA' },
  { key: 'QA', kind: 'station', line: 'pack', label: 'Final QA', time: 28, mode: 'manual', move: 3, pos: [21, 8], next: 'CRANE' },

  // ---------------- Outbound
  { key: 'CRANE', kind: 'station', line: 'out', label: 'Gantry Crane', time: 6, mode: 'auto', move: 4, pos: [36, 8], next: 'PAD' },
  { key: 'PAD', kind: 'buffer', line: 'out', label: 'Pickup pad', cap: 1, move: 4, slots: [[36, 19]], next: 'LOT' },
  { key: 'LOT', kind: 'buffer', line: 'out', label: 'Storage lot', cap: 60, move: 10, slots: lotSlots, next: 'TRUCK' },
  { key: 'TRUCK', kind: 'truck', line: 'out', label: 'Truck loading', time: 14, mode: 'manual', move: 8, pos: TRUCK_BAY, next: 'SHIPPED' },
  { key: 'SHIPPED', kind: 'sink' },
];

export const N = Object.fromEntries(NODES.map((n, i) => [n.key, i]));
NODES.forEach((n, i) => { n.i = i; });

export function pathLength(p) {
  let L = 0;
  for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return L;
}
for (const n of NODES) {
  if (n.kind !== 'conveyor') continue;
  n.pitch ??= PITCH;
  n.L = pathLength(n.path);
  n.cap = Math.floor(n.L / n.pitch) + 1;
}

// [x, z, heading] at distance d along a polyline. Heading is rotation.y for a unit whose
// length runs along local x.
export function pointAt(p, d) {
  let rest = Math.max(0, d);
  for (let i = 1; i < p.length; i++) {
    const [ax, az] = p[i - 1], [bx, bz] = p[i];
    const seg = Math.hypot(bx - ax, bz - az);
    if (rest <= seg || i === p.length - 1) {
      const u = seg ? Math.min(1, rest / seg) : 0;
      return [ax + (bx - ax) * u, az + (bz - az) * u, -Math.atan2(bz - az, bx - ax)];
    }
    rest -= seg;
  }
  return [p[0][0], p[0][1], 0];
}

// The lines, for KPI grouping and the station register
export const LINES = {
  biw: { name: 'Body in White', color: '#c8102e' },
  paint: { name: 'Powder Coat', color: '#2f6db5' },
  module: { name: 'Battery Modules', color: '#d9731a' },
  pack: { name: 'Pack Line', color: '#8a96a3' },
  out: { name: 'Outbound', color: '#2e8a57' },
};
