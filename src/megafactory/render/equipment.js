// Static plant equipment: overhead rail, paint enclosures, stations, racks, crane, andon lamps,
// floor stencils and click targets. Phase 1 builds every area at layout accuracy; Phase 2
// replaces the paint shop internals with the detailed process equipment.
import * as THREE from 'three';
import { Batch } from './batch.js';
import { materials, STATUS } from './materials.js';
import { stencil } from './textures.js';
import { NODES, N, RAIL_Y, HANG_Y, RACK, BUILDING, TRUCK_BAY } from '../plant.js';
import { createRobot } from '../../models.js';

const H = BUILDING.h;
// paint process enclosures: [node, x0, x1, z, style]
const HOUSINGS = [
  ['PRE', -95, -55, -66, 'wash'],
  ['DRY', -53, -33, -66, 'oven'],
  ['PRIMER', -30, -14, -66, 'booth'],
  ['GEL', 5, 29, -66, 'oven'],
  ['COOL1', 31, 43, -66, 'cool'],
  ['TOP', 46, 62, -66, 'booth'],
  ['CURE', 36, 80, -50, 'oven'],
  ['COOL2', 17, 35, -50, 'cool'],
];
const STYLE = {
  wash: { w: 4.8, h: 6.0, wall: 'ss', strip: 'washStrip' },
  oven: { w: 5.2, h: 6.4, wall: 'insulated', strip: 'ovenStrip' },
  booth: { w: 5.4, h: 6.0, wall: 'panel', strip: 'boothStrip' },
  cool: { w: 4.6, h: 5.6, wall: 'panelGrey', strip: 'boothStrip' },
};
// overhead rail: main loop, repair spur and the empty-carrier return
export const RAILS = [
  [[-108, -66], [94, -66], [94, -50], [-100, -50], [-100, -4]],
  [[8, -50], [8, -38], [-108, -38]],
  [[-100, -4], [-100, 2], [-108, 2], [-108, -66]],
];

export function buildEquipment(stage) {
  const M = materials();
  const root = new THREE.Group();
  root.name = 'equipment';
  stage.scene.add(root);
  const S = new Batch();     // opaque, shadow casting
  const T = new Batch();     // transparent
  const G = new Batch();     // emissive
  const out = { root, lamps: new Map(), picks: [], stencils: new Map(), robots: [] };
  const L = (text, x, y, z, cls, far) => stage.label(text, x, y, z, cls, { far });

  // ---------------- overhead power-and-free rail
  for (const path of RAILS) {
    const pts = path.map(([x, z]) => [x, RAIL_Y, z]);
    S.polyline(M.rail, pts, 0.14, 0.22);
    S.polyline(M.rail, pts.map(([x, y, z]) => [x, y + 0.6, z]), 0.16, 0.18);
    for (let i = 1; i < path.length; i++) {
      const [ax, az] = path[i - 1], [bx, bz] = path[i];
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 6));
      // header steel above the rail, hung from the roof trusses every 12 m
      S.beam(M.joist, [ax, RAIL_Y + 1.9, az], [bx, RAIL_Y + 1.9, bz], 0.16, 0.24);
      for (let k = 0; k <= n; k++) {
        const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n;
        S.box(M.darkSteel, 0.1, 0.62, 0.1, x, RAIL_Y + 0.3, z);
        S.box(M.joist, 0.08, 1.2, 0.08, x, RAIL_Y + 1.3, z);
        S.box(M.darkSteel, 0.5, 0.08, 0.12, x, RAIL_Y + 0.72, z);
        if (k % 2 === 0) S.box(M.joist, 0.06, H - RAIL_Y - 2.0, 0.06, x, (RAIL_Y + 2.0 + H) / 2, z);
      }
    }
  }

  // ---------------- paint enclosures (cut away on the south side)
  for (const [key, x0, x1, z, style] of HOUSINGS) {
    const st = STYLE[style], len = x1 - x0, x = (x0 + x1) / 2, w = st.w, h = st.h;
    const fz = z - w / 2, nz = z + w / 2;
    S.box(M[st.wall], len, h, 0.14, x, h / 2, fz);
    S.box(M[st.wall], len, 1.3, 0.14, x, 0.65, nz);
    T.box(M.poly, len, h - 1.3, 0.03, x, 1.3 + (h - 1.3) / 2, nz);
    T.box(M.polyRoof, len, 0.04, w, x, h, z);
    for (let k = 0; k <= Math.round(len / 2); k++) {
      const xx = x0 + k * len / Math.round(len / 2);
      S.box(M.steel, 0.1, h, 0.12, xx, h / 2, nz);
      S.box(M.steel, 0.1, 0.12, w, xx, h, z);
    }
    S.box(M.steel, len, 0.16, 0.16, x, h, fz); S.box(M.steel, len, 0.16, 0.16, x, h, nz); S.box(M.steel, len, 0.12, 0.14, x, 1.3, nz);
    // end portals with the carrier opening
    for (const ex of [x0, x1]) {
      S.box(M[st.wall], 0.14, h, (w - 2.4) / 2, ex, h / 2, fz + (w - 2.4) / 4);
      S.box(M[st.wall], 0.14, h, (w - 2.4) / 2, ex, h / 2, nz - (w - 2.4) / 4);
      S.box(M[st.wall], 0.14, h - 4.4, 2.4, ex, 4.4 + (h - 4.4) / 2, z);
    }
    S.box(M[st.strip], len, 0.22, 0.02, x, h - 0.5, nz + 0.08);
    if (style === 'oven') ovenExtras(S, G, M, x0, x1, z, w, h);
    if (style === 'wash') washExtras(S, M, x0, x1, z, w, h);
    if (style === 'booth') boothExtras(S, G, M, x0, x1, z, w, h);
    if (style === 'cool') for (let xx = x0 + 3; xx < x1 - 1; xx += 4) { S.cyl(M.panelDark, 0.9, 0.5, xx, h, z, 18); S.cyl(M.steel, 0.95, 0.06, xx, h + 0.5, z, 18); }
    const d = NODES[N[key]];
    L(d.label.toUpperCase(), x, h + 2.2, z, style === 'oven' ? 'eq hot' : 'eq', 235);
    if (d.sub) L(d.sub, x, 0.4, nz + 1.4, 'sub', 120);
    addPick(out, N[key], x, h / 2, z, len, h, w);
    lamp(out, root, N[key], x1 - 0.6, h + 0.2, nz - 0.4);
  }
  // cure oven turn and dry-off are joined by insulated duct runs
  S.beam(M.insulated, [80, H - 2.6, -50], [80, H - 2.6, -66], 1.0, 1.0);

  // ---------------- paint stations: platforms with handrails
  for (const key of ['LOAD', 'PTOUCH', 'TTOUCH', 'INSP', 'REPAIR', 'DROP']) {
    const d = NODES[N[key]], [x, z] = d.pos;
    const along = key === 'REPAIR' || key === 'DROP' ? 'z' : 'x';
    const lx = along === 'x' ? 11 : 4, lz = along === 'x' ? 4 : 11;
    if (key === 'PTOUCH' || key === 'TTOUCH' || key === 'REPAIR') {
      // two-level touch-up platforms either side of the hanging part
      for (const s of [-1, 1]) {
        const px = along === 'x' ? x : x + s * 2.0, pz = along === 'x' ? z + s * 2.0 : z;
        const pw = along === 'x' ? 10 : 1.4, pd = along === 'x' ? 1.4 : 10;
        for (const y of [1.2, 2.6]) {
          S.box(M.darkSteel, pw, 0.08, pd, px, y, pz);
          const ox = along === 'x' ? 0 : s * 0.7, oz = along === 'x' ? s * 0.7 : 0;
          S.box(M.safety, along === 'x' ? pw : 0.05, 0.05, along === 'x' ? 0.05 : pd, px + ox, y + 1.05, pz + oz);
        }
        for (const k of [-1, 1]) {
          const cx = along === 'x' ? px + k * 4.8 : px, cz = along === 'x' ? pz : pz + k * 4.8;
          S.box(M.safety, 0.08, 3.7, 0.08, cx, 1.85, cz);
        }
      }
      T.box(M.poly, along === 'x' ? 12 : 0.03, 4.2, along === 'x' ? 0.03 : 12, along === 'x' ? x : x - 3.2, 2.1, along === 'x' ? z - 3.2 : z);
    } else if (key === 'INSP') {
      for (const s of [-1, 1]) { S.box(M.panel, 0.4, 4.6, 0.4, x - 2, 2.3, z + s * 2.2); S.box(M.panel, 0.4, 4.6, 0.4, x + 2, 2.3, z + s * 2.2); }
      S.box(M.panel, 4.4, 0.4, 4.8, x, 4.7, z);
      for (const s of [-1, 1]) G.box(M.lampWhite, 3.6, 0.06, 0.2, x, 4.48, z + s * 1.6);
      for (const s of [-1, 1]) G.box(M.lampWhite, 0.08, 3.2, 0.2, x + s * 1.8, 2.5, z + s * 2.0);
    } else {
      // load / drop: scissor lift table under the rail
      S.box(M.darkSteel, lx * 0.82, 0.3, lz * 0.5, x, 0.15, z);
      S.box(M.safety, lx * 0.82, 0.08, lz * 0.5, x, 0.34, z);
      S.box(M.safety, lx, 0.05, 0.05, x, 1.1, z + lz / 2); S.box(M.safety, 0.05, 0.05, lz, x + lx / 2, 1.1, z);
    }
    L(d.label.toUpperCase(), x, 6.4, z, 'eq', 170);
    addPick(out, N[key], x, 2.5, z, lx, 5, lz);
    lamp(out, root, N[key], x + (along === 'x' ? lx / 2 : 1.4), 4.6, z + (along === 'x' ? 2.6 : lz / 2));
    floorStencil(out, root, N[key], x - (along === 'x' ? lx / 2 : 1.6), z + (along === 'x' ? 3.6 : lz / 2 + 1.4));
  }
  // door kit staging racks and the coated-door buffer: A-frame carts
  for (const key of ['DOORKIT', 'DOORBUF']) for (const [x, z] of NODES[N[key]].slots) {
    S.box(M.darkSteel, 4.6, 0.12, 2.2, x, 0.3, z);
    S.beam(M.steel, [x - 2.2, 0.35, z - 0.9], [x - 2.2, 2.6, z], 0.08, 0.08); S.beam(M.steel, [x - 2.2, 0.35, z + 0.9], [x - 2.2, 2.6, z], 0.08, 0.08);
    S.beam(M.steel, [x + 2.2, 0.35, z - 0.9], [x + 2.2, 2.6, z], 0.08, 0.08); S.beam(M.steel, [x + 2.2, 0.35, z + 0.9], [x + 2.2, 2.6, z], 0.08, 0.08);
    S.beam(M.steel, [x - 2.2, 2.6, z], [x + 2.2, 2.6, z], 0.08, 0.08);
  }
  L('DOOR & PANEL KITS', -112, 4.4, -74, 'eq', 200);
  L('COATED DOORS', -99, 4.2, 19, 'eq', 200);

  // ---------------- Body in White: red weld cells with yellow robots
  const biwTop = new THREE.Group(); root.add(biwTop);
  for (const key of ['BIW1', 'BIW2', 'BIW3', 'BIW4']) {
    const d = NODES[N[key]], [x, z] = d.pos;
    S.box(M.weldRed, 10, 0.7, 2.4, x, 0.35, z);
    for (const sx of [-4.6, 0, 4.6]) S.box(M.weldRed, 0.5, 1.1, 2.8, x + sx, 0.55, z);
    if (key === 'BIW4') {
      S.box(M.panel, 0.5, 4.6, 0.5, x - 5.6, 2.3, z); S.box(M.panel, 0.5, 4.6, 0.5, x + 5.6, 2.3, z);
      S.box(M.panel, 11.7, 0.5, 0.6, x, 4.6, z);
      G.box(M.lampWhite, 10.6, 0.06, 0.1, x, 4.33, z + 0.2);
    } else {
      for (const s of [-1, 1]) {
        T.box(M.weldCurtain, 13, 2.8, 0.03, x, 1.6, z + s * 5.2);
        S.box(M.weldRed, 13, 0.08, 0.08, x, 3.0, z + s * 5.2);
        for (const k of [-6.5, 0, 6.5]) S.box(M.weldRed, 0.08, 3.0, 0.08, x + k, 1.5, z + s * 5.2);
        for (const rx of [-2.6, 2.6]) {
          const r = createRobot(0xf2c200, 1);
          r.root.position.set(x + rx, 0, z + s * 3.2);
          r.root.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
          r.root.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
          biwTop.add(r.root);
          out.robots.push({ ...r, n: N[key], phase: rx + s });
        }
      }
    }
    L(d.label.toUpperCase(), x + 7.8, 5.2, z, 'eq', 150);
    addPick(out, N[key], x, 2, z, 13, 4, 10);
    lamp(out, root, N[key], x - 6.6, 3.2, z + 4.4);
    floorStencil(out, root, N[key], x + 6.4, z + 3.4, 0.7);
  }
  // outfeed transfer to Load & Hang
  for (const s of [-1, 1]) S.box(M.steel, 0.16, 0.5, 12.4, -114 + s * 3.6, 0.45, -56);
  for (let zz = -50; zz >= -62; zz -= 1.2) S.rod(M.alu, [-118, 0.72, zz], [-110, 0.72, zz], 0.06, 8);

  // ---------------- battery modules: guarded cells over a roller conveyor
  S.box(M.alu, 74, 0.12, 2.0, 32, 0.78, -24);
  for (let xx = -4; xx <= 70; xx += 0.8) S.rod(M.ss, [xx, 0.86, -25], [xx, 0.86, -23], 0.05, 6);
  for (let xx = -4; xx <= 70; xx += 3) for (const s of [-1, 1]) S.box(M.steel, 0.1, 0.8, 0.1, xx, 0.4, -24 + s * 0.95);
  for (const key of ['M1', 'M2', 'M3', 'M4', 'M5', 'M6']) {
    const d = NODES[N[key]], [x, z] = d.pos;
    for (const s of [-1, 1]) {
      T.box(M.meshGuard, 8, 2.2, 0.03, x, 1.1, z + s * 3.6);
      for (const k of [-4, 0, 4]) S.box(M.alu, 0.08, 2.3, 0.08, x + k, 1.15, z + s * 3.6);
      S.box(M.alu, 8, 0.08, 0.08, x, 2.3, z + s * 3.6);
    }
    S.box(M.panel, 1.2, 1.8, 0.8, x - 3, 0.9, z - 2.6);
    G.box(M.lampWhite, 6.8, 0.05, 0.12, x, 2.6, z);
    S.box(M.alu, 7.6, 0.1, 0.1, x, 2.68, z - 0.4); S.box(M.alu, 7.6, 0.1, 0.1, x, 2.68, z + 0.4);
    if (key !== 'M1' && key !== 'M4') {
      const r = createRobot(0xf2c200, 0.55, 0xc8102e);
      r.root.position.set(x, 0.9, z - 2.0);
      r.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
      biwTop.add(r.root);
      out.robots.push({ ...r, n: N[key], phase: x * 0.3 });
    }
    L(d.label.toUpperCase(), x, 4.0, z, 'eq', 130);
    addPick(out, N[key], x, 1.2, z, 8, 2.4, 7.2);
    lamp(out, root, N[key], x + 3.8, 2.6, z + 3.4);
    floorStencil(out, root, N[key], x - 4, z + 5.2, 0.62);
  }
  // rack warehouse: two rack rows, 7 bays × 4 levels
  for (const rz of RACK.rows) {
    const x0 = RACK.x0 - RACK.dx / 2, x1 = RACK.x0 + (RACK.bays - 0.5) * RACK.dx;
    for (let b = 0; b <= RACK.bays; b++) for (const s of [-1, 1]) S.box(M.conveyorBlue, 0.1, RACK.levels * RACK.dy + 0.4, 0.1, x0 + b * RACK.dx, (RACK.levels * RACK.dy + 0.4) / 2, rz + s * 0.9);
    for (let l = 0; l < RACK.levels; l++) for (const s of [-1, 1]) S.box(M.hvOrange, x1 - x0, 0.12, 0.08, (x0 + x1) / 2, RACK.y0 + l * RACK.dy - 0.06, rz + s * 0.9);
  }
  L('MODULE RACKS · 56 TRAYS', -31, 7.2, -24, 'eq', 260);
  L('MODULE OUTFEED', -7, 2.6, -21, 'sub', 120);

  // ---------------- pack line: low floor rails and white station gantries
  for (const s of [-1, 1]) S.box(M.steel, 132, 0.2, 0.16, -26, 0.1, 8 + s * 0.55);
  for (let xx = -92; xx <= 42; xx += 2) S.box(M.darkSteel, 0.2, 0.06, 1.5, xx, 0.03, 8);
  for (const key of ['CL', 'HV', 'MI', 'TH', 'EN', 'CF', 'EOL', 'QA']) {
    const d = NODES[N[key]], [x, z] = d.pos;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) S.box(M.column, 0.3, 6.6, 0.3, x + sx * 5.4, 3.3, z + sz * 4);
    for (const sz of [-1, 1]) S.box(M.column, 11.1, 0.4, 0.4, x, 6.6, z + sz * 4);
    S.box(M.panelDark, 4.8, 1.0, 0.1, x, 7.4, z + 4);
    G.box(M.lampWhite, 9.8, 0.06, 0.2, x, 6.36, z);
    for (const sz of [-1, 1]) { S.box(M.darkSteel, 7, 0.06, 0.9, x, 0.03, z + sz * 2.6); S.box(M.hazard, 7, 0.07, 0.12, x, 0.035, z + sz * 3.1); }
    if (key === 'EOL') { S.box(M.panelDark, 1.4, 2.2, 0.8, x + 4.2, 1.1, z - 3); G.box(M.lampWhite, 0.06, 1.2, 0.6, x + 3.48, 1.4, z - 3); }
    if (key === 'MI' || key === 'EN') for (const sz of [-1, 1]) { S.cyl(M.safety, 0.18, 4.4, x - 2, 0, z + sz * 3.2, 10); S.beam(M.safety, [x - 2, 4.3, z + sz * 3.2], [x + 1.6, 4.3, z + sz * 1.6], 0.16, 0.16); }
    L(d.label.toUpperCase(), x, 8.6, z, 'eq', 150);
    addPick(out, N[key], x, 3, z, 11, 6.6, 8);
    lamp(out, root, N[key], x + 5.4, 6.9, z + 4);
    floorStencil(out, root, N[key], x - 5, z + 5.1);
  }
  // gantry crane over Final QA → pickup pad
  {
    const cx = 36;
    for (const s of [-1, 1]) {
      for (const z of [1, 22]) S.box(M.safety, 0.5, 8.6, 0.5, cx + s * 6, 4.3, z);
      S.box(M.safety, 0.5, 0.7, 22, cx + s * 6, 8.6, 11.5);
    }
    out.crane = { x: cx };
    L('GANTRY CRANE', cx, 10.6, 6, 'eq', 260);
    addPick(out, N.CRANE, cx, 4, 11.5, 12, 8.6, 21);
    lamp(out, root, N.CRANE, cx + 6, 9.2, 1);
    S.box(M.darkSteel, 10.4, 0.1, 2.6, cx, 0.05, 19);
    S.box(M.hazard, 10.8, 0.11, 0.16, cx, 0.06, 20.4); S.box(M.hazard, 10.8, 0.11, 0.16, cx, 0.06, 17.6);
    L('PICKUP PAD', cx, 2.4, 21.2, 'sub', 120);
  }
  // truck bay
  {
    const [x, z] = TRUCK_BAY;
    S.box(M.darkSteel, 18, 0.1, 4.4, x, 0.05, z);
    L('TRUCK LOADING', x, 5, z - 3, 'eq', 300);
    addPick(out, N.TRUCK, x, 2, z, 18, 4, 5);
    lamp(out, root, N.TRUCK, x - 9.5, 3.2, z - 2.6);
    for (const s of [-1, 1]) S.cyl(M.safety, 0.12, 1.2, x + s * 9.6, 0, z + 2.6, 8);
  }
  L('MEGAPACK STORAGE LOT · 60', 52, 4.6, 36, 'eq', 380);

  S.build(root);
  T.build(root, { cast: false, receive: false });
  G.build(root, { cast: false, receive: false });
  return out;
}

// ---------------- paint enclosure extras
function ovenExtras(S, G, M, x0, x1, z, w, h) {
  const len = x1 - x0;
  for (let xx = x0 + 4; xx < x1 - 2; xx += 10) {
    S.box(M.insulated, 2.4, 1.6, 2.6, xx, h + 0.8, z - 0.6);
    S.box(M.darkSteel, 1.2, 0.9, 1.0, xx + 1.9, h + 0.45, z - 0.8);
    S.rod(M.steel, [xx - 0.6, h + 1.6, z - 1], [xx - 0.6, h + 5.4, z - 1], 0.36, 14);
    G.box(M.ovenGlow, 0.5, 0.3, 0.05, xx - 0.4, h + 0.9, z + 0.72);
  }
  S.beam(M.insulated, [x0 + 1, h + 1.9, z - 1.8], [x1 - 1, h + 1.9, z - 1.8], 0.9, 0.9);
  G.box(M.ovenGlow, len - 0.6, 0.02, w - 1.2, (x0 + x1) / 2, 0.03, z);
  G.box(M.ovenGlow, len - 0.6, 0.12, 0.05, (x0 + x1) / 2, 0.5, z - w / 2 + 0.12);
}
function washExtras(S, M, x0, x1, z, w, h) {
  const stages = 5, sl = (x1 - x0) / stages;
  for (let k = 0; k < stages; k++) {
    const sx = x0 + k * sl;
    for (let r = 0; r < 3; r++) {
      const xx = sx + 1.2 + r * (sl - 2.4) / 2;
      for (const s of [-1, 1]) S.rod(M.ss, [xx, 0.6, z + s * 1.7], [xx, 4.0, z + s * 1.7], 0.06, 8);
      S.rod(M.ss, [xx, 4.0, z - 1.7], [xx, 4.0, z + 1.7], 0.06, 8);
    }
    if (k) S.box(M.panelGrey, 0.04, h - 1.2, w - 0.4, sx, (h - 1.2) / 2 + 1.2, z);
    // process tank and pump behind the tunnel
    S.box(M.ss, sl - 1.4, 2.0, 2.6, sx + sl / 2, 1.0, z - w / 2 - 1.8);
    S.cyl(M.conveyorBlue, 0.32, 0.7, sx + 1.3, 0, z - w / 2 - 3.6, 12);
    S.rod(M.ss, [sx + 1.3, 0.6, z - w / 2 - 3.6], [sx + 1.3, 0.6, z - w / 2 - 0.2], 0.07, 8);
  }
  for (let xx = x0 + 4; xx < x1; xx += 14) S.rod(M.ss, [xx, h, z - 0.8], [xx, h + 4.2, z - 0.8], 0.42, 14);
}
function boothExtras(S, G, M, x0, x1, z, w, h) {
  const x = (x0 + x1) / 2;
  for (const s of [-1, 1]) G.box(M.lampWhite, x1 - x0 - 1, 0.06, 0.24, x, h - 0.16, z + s * 1.5);
  // gun reciprocator towers on both sides of the part
  for (const s of [-1, 1]) for (const dx of [-3.2, 3.2]) {
    S.box(M.panelGrey, 0.45, 4.6, 0.45, x + dx, 2.3, z + s * 2.25);
    S.box(M.darkSteel, 0.3, 0.3, 0.6, x + dx, 2.4, z + s * 1.95);
  }
  // cartridge filter module, cyclone and powder feed centre on the north side
  S.box(M.panelDark, x1 - x0 - 2, 3.8, 2.4, x, 1.9, z - w / 2 - 1.5);
  for (let xx = x0 + 2; xx < x1 - 1.5; xx += 2.2) S.cyl(M.ss, 0.32, 0.8, xx, 3.8, z - w / 2 - 1.5, 12);
  S.cyl(M.ss, 0.8, 4.4, x1 + 1.6, 1.6, z - w / 2 - 1.6, 18);
  S.add(M.ss, new THREE.ConeGeometry(0.8, 1.6, 18), { x: x1 + 1.6, y: 0.8, z: z - w / 2 - 1.6, rx: Math.PI });
  S.rod(M.ss, [x1 + 1.6, 6.2, z - w / 2 - 1.6], [x, 6.2, z - w / 2 - 1.6], 0.4, 12);
  S.box(M.panel, 1.6, 1.8, 1.2, x0 - 1.4, 0.9, z - w / 2 - 1.2);
}

// ---------------- dynamic per-node helpers
function lamp(out, root, n, x, y, z) {
  const m = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: STATUS.starved.color, emissiveIntensity: 2.2, roughness: 0.4 });
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6), materials().darkSteel);
  pole.position.y = -0.3;
  const light = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.32, 12), m);
  light.position.y = 0.16;
  g.add(pole, light);
  g.position.set(x, y, z);
  root.add(g);
  out.lamps.set(n, m);
}
function addPick(out, n, x, y, z, w, h, d) {
  out.picks.push({ n, box: new THREE.Box3(new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2), new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2)) });
}
function floorStencil(out, root, n, x, z, scale = 1) {
  const st = stencil(1024, 256);
  const w = 6.4 * scale, h = 1.6 * scale;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: st.texture, transparent: true, depthWrite: false, opacity: 0.9 }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x + w / 2, 0.025, z + h / 2);
  m.renderOrder = 4;
  root.add(m);
  out.stencils.set(n, st);
}

export function updateEquipment(eq, sim, statusOf, dt, simDt) {
  for (const [n, m] of eq.lamps) m.emissive.set(STATUS[statusOf(n)].color);
  // robots move while their cell is working
  for (const r of eq.robots) {
    const busy = statusOf(r.n) === 'busy';
    r.k = (r.k ?? 0) + (busy ? dt : 0);
    const a = r.k * 1.6 + r.phase, ease = Math.min(1, dt * 3);
    const tgt = busy
      ? { yaw: 0.5 * Math.sin(a * 0.7), sh: 0.55 + Math.sin(a * 1.3) * 0.22, el: 0.85 + Math.sin(a * 1.7 + 1) * 0.3, wr: 0.5 + Math.sin(a * 2.1) * 0.3 }
      : { yaw: 0, sh: 0.05, el: 0.6, wr: 0.4 };
    r.turret.rotation.y += (tgt.yaw - r.turret.rotation.y) * ease;
    r.shoulder.rotation.x += (tgt.sh - r.shoulder.rotation.x) * ease;
    r.elbow.rotation.x += (tgt.el - r.elbow.rotation.x) * ease;
    r.wrist.rotation.x += (tgt.wr - r.wrist.rotation.x) * ease;
  }
}
