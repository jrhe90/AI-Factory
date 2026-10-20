// Procedural models for a prismatic battery module & pack line. The reference is a semi-automatic
// line: a pallet conveyor runs through every station, the automatic cells (stacking, laser
// welding, test) sit behind guarding, and the manual stations work under yellow gantry frames
// with hoists. The stations use the same interface as MACHINES in ../motors/models.js, so the
// Sim Factory catalog wraps them the same way:
//   kind(y) -> { group, light, ops: [[x, z, facing]], update(c) }
//   c = { working, status, p, t, simDt, dt, y, blink }
// The product at each stage (cell, module, pack) is exported too.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  C, mat, glow, box, cyl, mergeColored, machineCommon, enclosure, guardFence, workbench, balancerTool,
  abbRobot, animateRobot,
} from '../motors/models.js';

const add = (parent, obj, x = 0, y = 0, z = 0) => {
  obj.position.set(x, y, z);
  parent.add(obj);
  return obj;
};
const lerpK = (dt, rate = 6) => 1 - Math.exp(-rate * dt);
const busy = (c) => c.status === 'working' || c.status === 'blocked';

export const B = {
  gantry: 0xf5a524, // safety-yellow gantry frames
  alu: 0xc9d0d7,
  aluDark: 0x8f98a2,
  machine: 0xeef0f2,
  accent: 0x1d6fd8,
  cell: 0x2f6fd0, // blue PET-wrapped cells
  cap: 0xb8bfc7,
  copper: 0xc8763a,
  nickel: 0xd5d9de,
  hv: 0xff7a1a, // orange high-voltage parts
  ccs: 0x2b2f35,
  paste: 0x8d959e,
  housing: 0x6f7883,
  lid: 0x3d434a,
};
const M = {
  alu: mat(B.alu, { metalness: 0.55, roughness: 0.35 }),
  aluDark: mat(B.aluDark, { metalness: 0.55, roughness: 0.4 }),
  dark: mat(0x2b2f35, { roughness: 0.6 }),
  black: mat(0x16181b, { roughness: 0.5 }),
  white: mat(B.machine, { roughness: 0.45, metalness: 0.15 }),
  accent: mat(B.accent, { roughness: 0.45 }),
  gantry: mat(B.gantry, { roughness: 0.45, metalness: 0.2 }),
  hv: mat(B.hv, { roughness: 0.5 }),
  tint: mat(0x2a1d08, { transparent: true, opacity: 0.6, roughness: 0.1 }),
};

// ------------------------------------------------------------------ product
// Prismatic cell 45 x 115 x 173 mm (thickness along x). A module is 12 cells in series between
// two end plates; a pack is 2 x 6 modules in an aluminium housing with a BDU at the front.
const CELL = { t: 0.045, w: 0.17, h: 0.115 };
const CELLS = 12;
export const MODULE = { L: CELLS * CELL.t + 0.05, W: CELL.w + 0.02, H: CELL.h + 0.03 };
export const PACK = { L: 1.65, W: 1.4, H: 0.22, rows: 6, cols: 2 };
export const MODULE_STAGES = ['cells', 'stack', 'welded', 'busbar', 'module'];
export const PACK_STAGES = ['housing', 'paste', 'modules', 'wired', 'closed'];

function cellParts(g, x, y, flip) {
  add(g, box(CELL.t - 0.003, CELL.h, CELL.w, mat(B.cell, { roughness: 0.5 })), x, y + CELL.h / 2, 0);
  add(g, box(CELL.t - 0.003, 0.006, CELL.w - 0.004, mat(B.cap, { metalness: 0.6, roughness: 0.35 })), x, y + CELL.h + 0.003, 0);
  const s = flip ? -1 : 1;
  add(g, box(0.024, 0.012, 0.036, mat(B.cap, { metalness: 0.7, roughness: 0.3 })), x, y + CELL.h + 0.012, -s * CELL.w * 0.3); // Al (−)
  add(g, box(0.024, 0.012, 0.036, mat(B.copper, { metalness: 0.7, roughness: 0.3 })), x, y + CELL.h + 0.012, s * CELL.w * 0.3); // Cu (+)
  add(g, box(0.014, 0.003, 0.03, mat(0x1b1e22)), x, y + CELL.h + 0.007, 0); // vent
}

function buildModule(stage) {
  const n = MODULE_STAGES.indexOf(stage);
  const g = new THREE.Group();
  const gap = n === 0 ? 0.012 : 0;
  const pitch = CELL.t + gap;
  const x0 = -(CELLS - 1) * pitch / 2;
  const yb = n >= 1 ? 0.004 : 0;
  const top = yb + CELL.h + 0.006;
  for (let i = 0; i < CELLS; i++) cellParts(g, x0 + i * pitch, yb, i % 2 === 1);
  if (n >= 1) {
    add(g, box(CELLS * CELL.t, 0.004, CELL.w, mat(0x1b1e22)), 0, 0.002, 0);
    for (const s of [-1, 1]) {
      add(g, box(0.025, CELL.h + 0.02, MODULE.W, M.alu), s * (CELLS * CELL.t / 2 + 0.0125), (CELL.h + 0.02) / 2, 0);
      add(g, box(0.006, 0.03, 0.03, M.dark), s * (CELLS * CELL.t / 2 + 0.028), CELL.h * 0.5, 0); // lifting point
    }
  }
  if (n >= 2) {
    for (const s of [-1, 1]) {
      add(g, box(CELLS * CELL.t + 0.05, CELL.h * 0.8, 0.006, mat(0xaab2bb, { metalness: 0.7, roughness: 0.3 })), 0, CELL.h * 0.45, s * (MODULE.W / 2 + 0.003));
      for (const e of [-1, 1]) add(g, box(0.008, CELL.h * 0.8, 0.008, mat(0x5a5f66, { metalness: 0.5 })), e * (CELLS * CELL.t / 2 + 0.022), CELL.h * 0.45, s * (MODULE.W / 2 + 0.004)); // weld seam
    }
  }
  if (n >= 3) {
    const bar = mat(B.nickel, { metalness: 0.8, roughness: 0.25 });
    for (let i = 0; i < CELLS - 1; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      add(g, box(pitch * 2 - 0.012, 0.004, 0.034, bar), x0 + (i + 0.5) * pitch, top + 0.014, side * CELL.w * 0.3);
    }
    add(g, box(0.07, 0.006, 0.034, M.hv), x0 - 0.03, top + 0.014, CELL.w * 0.3);
    add(g, box(0.07, 0.006, 0.034, M.hv), -x0 + 0.03, top + 0.014, (CELLS % 2 ? 1 : -1) * CELL.w * 0.3);
  }
  if (n >= 4) {
    add(g, box(CELLS * CELL.t, 0.01, CELL.w * 0.32, mat(B.ccs)), 0, top + 0.012, 0); // CCS carrier
    add(g, box(CELLS * CELL.t - 0.04, 0.002, 0.03, mat(0xd9a441)), 0, top + 0.018, 0); // FPC
    add(g, box(0.03, 0.02, 0.04, mat(0xf2f2f2)), x0 - 0.01, top + 0.02, 0); // LV connector
    add(g, box(0.004, 0.05, 0.1, mat(0xf2f2f2)), -(CELLS * CELL.t / 2 + 0.026), CELL.h * 0.55, 0); // label
  }
  return g;
}

function buildPack(stage) {
  const n = PACK_STAGES.indexOf(stage);
  const { L, W, H } = PACK;
  const g = new THREE.Group();
  const wall = mat(B.housing, { metalness: 0.55, roughness: 0.4 });
  add(g, box(L, 0.02, W, mat(0x5a626c, { metalness: 0.5, roughness: 0.45 })), 0, 0.01, 0); // cooling floor
  for (const s of [-1, 1]) {
    add(g, box(L, H, 0.03, wall), 0, H / 2, s * (W / 2 - 0.015));
    add(g, box(0.03, H, W, wall), s * (L / 2 - 0.015), H / 2, 0);
    add(g, box(L + 0.08, 0.012, 0.05, wall), 0, H, s * (W / 2 + 0.01)); // flange
    add(g, box(0.05, 0.012, W + 0.08, wall), s * (L / 2 + 0.01), H, 0);
    for (let i = 0; i < 4; i++) add(g, box(0.08, 0.06, 0.06, mat(0x4a525b, { metalness: 0.5 })), -L / 2 + 0.25 + i * 0.38, 0.08, s * (W / 2 + 0.03)); // mounting brackets
  }
  add(g, box(L - 0.36, 0.08, 0.05, wall), -0.15, 0.06, 0); // centre member
  add(g, box(0.03, H - 0.02, W - 0.06, wall), L / 2 - 0.28, H / 2, 0); // BDU bulkhead
  add(g, box(0.04, 0.08, 0.1, M.hv), L / 2 + 0.02, 0.12, -0.3); // HV connector
  add(g, box(0.04, 0.06, 0.07, M.black), L / 2 + 0.02, 0.12, -0.12); // LV connector
  add(g, cyl(0.025, 0.025, 0.03, 12, M.alu), L / 2 + 0.02, 0.12, 0.25).rotation.z = Math.PI / 2; // vent valve
  const rowX = (r) => -L / 2 + 0.15 + r * 0.22;
  const colZ = (c) => (c ? 1 : -1) * 0.335;
  if (n >= 1) {
    const paste = mat(B.paste, { roughness: 0.9 });
    for (let r = 0; r < PACK.rows; r++) for (let c = 0; c < PACK.cols; c++) add(g, box(MODULE.W * 0.85, 0.004, MODULE.L * 0.9, paste), rowX(r), 0.022, colZ(c));
  }
  if (n >= 2) {
    for (let r = 0; r < PACK.rows; r++) for (let c = 0; c < PACK.cols; c++) {
      const m = buildModule('module');
      m.rotation.y = Math.PI / 2;
      add(g, m, rowX(r), 0.024, colZ(c));
    }
  }
  if (n >= 3) {
    const top = 0.024 + CELL.h + 0.035;
    for (let c = 0; c < PACK.cols; c++) for (let r = 0; r < PACK.rows - 1; r++) {
      const z = colZ(c) + (r % 2 ? -1 : 1) * (MODULE.L / 2 + 0.02);
      add(g, box(0.24, 0.008, 0.03, M.hv), rowX(r) + 0.11, top, z);
    }
    add(g, box(0.2, 0.1, 0.9, M.dark), L / 2 - 0.15, 0.08, 0); // BDU
    add(g, box(0.18, 0.02, 0.3, M.hv), L / 2 - 0.15, 0.14, -0.2);
    add(g, box(0.14, 0.03, 0.2, mat(0x1f7a3d)), L / 2 - 0.15, 0.145, 0.25); // BMS board
    add(g, box(L - 0.4, 0.01, 0.025, mat(0x1b1e22)), -0.12, top + 0.004, 0); // LV harness
  }
  if (n >= 4) {
    const lid = mat(B.lid, { metalness: 0.45, roughness: 0.45 });
    add(g, box(L + 0.06, 0.015, W + 0.06, lid), 0, H + 0.014, 0);
    for (let i = 0; i < 5; i++) add(g, box(L - 0.2, 0.012, 0.04, lid), 0, H + 0.027, -W / 2 + 0.2 + i * (W - 0.4) / 4); // ribs
    add(g, box(0.24, 0.002, 0.16, mat(0xf2f2f2)), L / 2 - 0.25, H + 0.035, -0.4);
    add(g, box(0.1, 0.002, 0.1, mat(0xf2c230)), L / 2 - 0.25, H + 0.036, -0.15);
  }
  return g;
}

// Each stage is baked once into a single vertex-coloured mesh; callers get cheap clones.
const productCache = new Map();
const product = (key, build) => {
  if (!productCache.has(key)) productCache.set(key, mergeColored(build()));
  return productCache.get(key).clone();
};
export const createModule = (stage = 'module') => product(`m:${stage}`, () => buildModule(stage));
export const createPack = (stage = 'closed') => product(`p:${stage}`, () => buildPack(stage));
export function createCell() {
  return product('cell', () => {
    const g = new THREE.Group();
    cellParts(g, 0, 0, false);
    return g;
  });
}
// Blue blister tray of 2 x 12 standing cells, as delivered from the cell supplier
export function createCellTray() {
  return product('tray', () => {
    const g = new THREE.Group();
    add(g, box(0.6, 0.03, 0.42, mat(0x22324a, { roughness: 0.7 })), 0, 0.015, 0);
    for (const s of [-1, 1]) add(g, box(0.6, 0.06, 0.012, mat(0x22324a, { roughness: 0.7 })), 0, 0.03, s * 0.205);
    for (let i = 0; i < CELLS; i++) for (const z of [-0.095, 0.095]) {
      const c = new THREE.Group();
      cellParts(c, 0, 0, false);
      add(g, c, -0.26 + i * CELL.t * 1.05, 0.03, z);
    }
    return g;
  });
}
const TRAY_H = 0.155;

// ------------------------------------------------------------------ building blocks
// Pallet conveyor section (double-strand chain on aluminium profile) with one tooling pallet.
// Returns the pallet; products go on it at local y = 0.
const LINE = { module: { W: 0.62, PL: 0.78, PW: 0.6 }, pack: { W: 1.5, PL: 1.85, PW: 1.56 } };
function palletLine(g, y, len, kind, withPallet = true) {
  const { W, PL, PW } = LINE[kind];
  for (const s of [-1, 1]) {
    add(g, box(len, 0.1, 0.07, M.alu), 0, y - 0.09, s * W / 2);
    add(g, box(len, 0.012, 0.05, M.black), 0, y - 0.034, s * (W / 2 - 0.05));
  }
  const n = Math.max(2, Math.round(len / 1.2) + 1);
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + 0.1 + (len - 0.2) * i / (n - 1);
    for (const s of [-1, 1]) {
      add(g, box(0.06, y - 0.14, 0.06, M.alu), x, (y - 0.14) / 2, s * W / 2);
      add(g, box(0.12, 0.02, 0.12, M.dark), x, 0.01, s * W / 2);
    }
    add(g, box(0.05, 0.05, W, M.alu), x, 0.25, 0);
  }
  if (!withPallet) return null;
  add(g, box(0.05, 0.07, 0.1, mat(C.yellow)), PL / 2 + 0.06, y - 0.03, 0); // stopper
  const pal = new THREE.Group();
  add(pal, box(PL, 0.028, PW, mat(0x9aa3ad, { metalness: 0.6, roughness: 0.35 })), 0, -0.014, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(pal, box(0.06, 0.03, 0.06, M.accent), sx * (PL / 2 - 0.06), 0.015, sz * (PW / 2 - 0.06));
  pal.position.set(0, y, 0);
  g.add(pal);
  return pal;
}

// Plain conveyor section (no pallet) for joining stations, `len` along x
export function createLineSection(kind = 'module', len = 1) {
  const g = new THREE.Group();
  palletLine(g, 0.9, len, kind, false);
  return g;
}
export const PALLET = { module: LINE.module, pack: LINE.pack };

// Yellow overhead gantry frame: four posts, two runways, a bridge travelling along x and a
// trolley with an electric chain hoist travelling along z. `tool` hangs from the hoist.
// set(x, z, toolY) gives targets in the frame's parent space; update(dt) eases towards them.
function gantry(g, { w = 3.2, d = 3.6, h = 3.4, cx = 0, cz = 0, tool }) {
  const G = new THREE.Group();
  G.position.set(cx, 0, cz);
  g.add(G);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    add(G, box(0.14, h, 0.14, M.gantry), sx * w / 2, h / 2, sz * d / 2);
    add(G, box(0.3, 0.02, 0.3, M.dark), sx * w / 2, 0.01, sz * d / 2);
    const brace = add(G, box(0.06, 0.6, 0.06, M.gantry), sx * (w / 2 - 0.2), h - 0.22, sz * d / 2);
    brace.rotation.z = sx * 0.78;
  }
  for (const sz of [-1, 1]) add(G, box(w + 0.14, 0.2, 0.14, M.gantry), 0, h + 0.1, sz * d / 2);
  for (const sx of [-1, 1]) add(G, box(0.12, 0.12, d, M.gantry), sx * w / 2, h + 0.06, 0);
  const bridge = new THREE.Group();
  bridge.position.y = h + 0.3;
  add(bridge, box(0.16, 0.18, d + 0.1, M.gantry), 0, 0, 0);
  for (const sz of [-1, 1]) add(bridge, box(0.34, 0.12, 0.2, M.dark), 0, 0.02, sz * d / 2);
  G.add(bridge);
  const trolley = new THREE.Group();
  bridge.add(trolley);
  add(trolley, box(0.3, 0.12, 0.3, M.dark), 0, -0.15, 0);
  add(trolley, box(0.24, 0.32, 0.22, mat(0x2a5d9f)), 0, -0.37, 0);
  const cable = add(trolley, cyl(0.01, 0.01, 1, 6, M.black, false), 0, 0, 0);
  const hang = new THREE.Group();
  trolley.add(hang);
  add(hang, box(0.08, 0.12, 0.08, mat(C.yellow)), 0, 0.06, 0);
  if (tool) hang.add(tool);
  const top = h + 0.3 - 0.53; // underside of the hoist, in frame space
  const tgt = { x: 0, z: 0, y: top - 0.6 };
  const set = (y) => {
    hang.position.y = y - (h + 0.3);
    cable.scale.y = Math.max(0.01, top - y - 0.12);
    cable.position.y = (top + y + 0.12) / 2 - (h + 0.3);
  };
  set(tgt.y);
  return {
    group: G,
    set(x, z, y) {
      tgt.x = x - cx;
      tgt.z = z - cz;
      tgt.y = Math.min(y, top - 0.15);
    },
    update(dt, rate = 3) {
      const k = lerpK(dt, rate);
      bridge.position.x += (tgt.x - bridge.position.x) * k;
      trolley.position.z += (tgt.z - trolley.position.z) * k;
      set(hang.position.y + (h + 0.3) + (tgt.y - hang.position.y - (h + 0.3)) * k);
    },
    // The tool's hook point in frame-parent space
    get y() { return hang.position.y + h + 0.3; },
  };
}

// Vacuum lifter frame for housings and lids: a rectangular frame with suction cups
function vacuumLifter(w, d) {
  const t = new THREE.Group();
  add(t, box(0.06, 0.25, 0.06, M.dark), 0, -0.12, 0);
  add(t, box(w, 0.06, 0.08, M.alu), 0, -0.27, 0);
  add(t, box(0.08, 0.06, d, M.alu), 0, -0.27, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(t, cyl(0.05, 0.06, 0.06, 12, M.black), sx * w / 2, -0.33, sz * d / 2);
  for (const sx of [-1, 1]) add(t, box(0.06, 0.04, 0.06, M.accent), sx * w * 0.25, -0.22, 0);
  return t;
}

// Light curtain pair (safety sensor posts) across the station opening at x
function lightCurtain(g, x, z0, z1, h = 1.6) {
  for (const z of [z0, z1]) {
    add(g, box(0.05, h, 0.05, M.black), x, h / 2, z);
    add(g, box(0.052, h - 0.2, 0.01, glow(0xff3030), false), x, h / 2, z + (z < z1 ? 0.026 : -0.026));
  }
}

// Work-instruction screen on a pole, like the line-side monitors in the reference line
function instructionScreen(g, x, z, rotY = 0) {
  const s = new THREE.Group();
  add(s, box(0.05, 1.8, 0.05, M.aluDark), 0, 0.9, 0);
  add(s, box(0.55, 0.36, 0.04, M.dark), 0, 1.75, 0.03);
  add(s, box(0.5, 0.31, 0.005, glow(0x9cc8ff), false), 0, 1.75, 0.052);
  s.position.set(x, 0, z);
  s.rotation.y = rotY;
  g.add(s);
}

// Free-standing cabinet (controller, laser source, tester, chiller)
function cabinet(g, x, z, w, h, d, color = B.machine, { screen = false, stripe = B.accent } = {}) {
  add(g, box(w, h, d, mat(color, { roughness: 0.45, metalness: 0.15 })), x, h / 2, z);
  add(g, box(w + 0.01, 0.05, d + 0.01, mat(stripe)), x, h - 0.15, z);
  if (screen) add(g, box(0.3, 0.2, 0.01, glow(0x2ee6d2), false), x, h * 0.65, z + d / 2 + 0.006);
}

function fumeDuct(g, x, z, from, to = 4.2) {
  add(g, cyl(0.12, 0.12, to - from, 14, M.alu), x, (from + to) / 2, z);
  add(g, cyl(0.2, 0.12, 0.2, 14, M.alu), x, from, z);
}

// Station footprint: pallet line through x, gantry or enclosure etc. around it
const MOD_LEN = 3.0;
const PACK_LEN = 3.8;

// ------------------------------------------------------------------ module line stations
export const BATTERY = {
  // Cell trays come in on a pallet; a robot scans each cell, OCV/IR tests it and places it
  // in the stacking order on the module pallet. NG cells drop into the red reject bin.
  cellload(y) {
    const g = new THREE.Group();
    const pal = palletLine(g, y, MOD_LEN, 'module');
    const prod = add(pal, createModule('cells'));
    add(g, box(1.2, 0.14, 1.0, mat(C.wood, { roughness: 0.85 })), -0.6, 0.07, -2.0); // tray pallet
    for (let i = 0; i < 4; i++) add(g, createCellTray(), -0.6, 0.14 + i * TRAY_H, -2.0).scale.set(1.6, 1, 2.2);
    const r = abbRobot(0.55, B.accent);
    r.root.position.set(0.3, 0, -1.0);
    r.baseYaw = Math.PI / 2;
    g.add(r.root);
    cabinet(g, 1.15, -1.5, 0.6, 1.1, 0.5, B.machine, { screen: true }); // OCV/IR tester
    add(g, box(0.5, 0.5, 0.4, mat(0xd93636)), 1.15, 0.25, -0.75); // NG bin
    add(g, box(0.06, 0.06, 0.4, M.aluDark), 0.95, 0.65, -0.95).rotation.x = 0.4; // reject chute
    guardFence(g, -1.5, -2.7, 1.5, -2.7);
    guardFence(g, -1.5, -2.7, -1.5, -0.5);
    guardFence(g, 1.5, -2.7, 1.5, -0.5);
    lightCurtain(g, -1.35, -0.45, 0.45);
    const light = machineCommon(g, { lightAt: [1.5, 2.1, -0.5], hmiAt: [1.6, 1.4, 0.7, -0.5] });
    return {
      group: g, light, ops: [],
      update(c) {
        prod.visible = busy(c);
        animateRobot(r, c.working, c.simDt, c.dt);
      },
    };
  },

  // Atmospheric plasma cleans the cell surfaces before gluing
  plasma(y) {
    const g = new THREE.Group();
    const pal = palletLine(g, y, MOD_LEN, 'module');
    const prod = add(pal, createModule('cells'));
    enclosure(g, 2.2, 1.9, 1.6, { color: B.machine, accent: B.accent, tunnelY: y + 0.1, tunnelH: 0.6, tunnelW: 0.8 });
    const head = new THREE.Group();
    add(head, box(0.1, 0.4, 0.1, M.dark), 0, 0.2, 0);
    add(head, cyl(0.05, 0.03, 0.12, 12, M.alu), 0, -0.06, 0);
    const plume = add(head, cyl(0.01, 0.05, 0.12, 12, glow(0x7aa8ff), false), 0, -0.17, 0);
    add(g, box(2.0, 0.08, 0.08, M.aluDark), 0, y + 0.85, -0.2);
    head.position.set(0, y + 0.28, 0);
    g.add(head);
    cabinet(g, 0.4, -1.3, 0.7, 1.4, 0.5, B.machine, { screen: true }); // plasma generator
    const light = machineCommon(g, { lightAt: [0.9, 2.15, 0.6], hmiAt: [1.2, 1.4, 0.95] });
    return {
      group: g, light, ops: [],
      update(c) {
        prod.visible = busy(c);
        plume.visible = c.working;
        if (c.working) {
          head.position.x = Math.sin(c.t * 2.2) * 0.26;
          head.position.z = Math.sin(c.t * 7.1) * 0.06;
        }
      },
    };
  },

  // A portal dispenser lays adhesive beads between the cells; a 2K pump feeds it from drums
  gluing(y) {
    const g = new THREE.Group();
    const pal = palletLine(g, y, MOD_LEN, 'module');
    const prod = add(pal, createModule('cells'));
    for (const s of [-1, 1]) add(g, box(0.1, 1.2, 0.1, M.alu), s * 0.8, y + 0.15, -0.5); // portal legs
    add(g, box(1.7, 0.12, 0.12, M.alu), 0, y + 0.8, -0.5);
    const carriage = new THREE.Group();
    add(carriage, box(0.18, 0.18, 0.18, M.dark), 0, y + 0.8, -0.38);
    add(carriage, box(0.06, 0.06, 0.4, M.aluDark), 0, y + 0.72, -0.2);
    const needle = add(carriage, box(0.05, 0.5, 0.05, M.accent), 0, y + 0.5, 0);
    g.add(carriage);
    const bead = add(g, box(MODULE.L * 0.9, 0.006, 0.012, mat(0xe8e2c8)), 0, y + CELL.h + 0.01, 0);
    add(g, box(1.1, 0.12, 0.7, M.dark), -0.3, 0.06, -1.6); // pump skid
    for (const [x, col] of [[-0.55, 0x1d6fd8], [-0.05, 0xf2f2f2]]) {
      add(g, cyl(0.25, 0.25, 0.85, 20, mat(col, { roughness: 0.5 })), x, 0.55, -1.6);
      add(g, cyl(0.06, 0.06, 0.9, 10, M.alu), x, 1.3, -1.6); // ram pump
    }
    add(g, box(0.06, 0.06, 1.1, M.black), -0.3, 1.6, -1.1); // hose
    cabinet(g, 0.9, -1.6, 0.6, 1.3, 0.5, B.machine, { screen: true });
    lightCurtain(g, -1.3, -0.5, 0.5);
    lightCurtain(g, 1.3, -0.5, 0.5);
    const light = machineCommon(g, { lightAt: [0.8, y + 0.86, -0.5], hmiAt: [1.4, 1.4, 0.7, -0.5] });
    return {
      group: g, light, ops: [],
      update(c) {
        prod.visible = busy(c);
        const along = c.working ? -0.3 + 0.6 * c.p : 0;
        carriage.position.x += (along - carriage.position.x) * lerpK(c.dt, 5);
        needle.position.y = y + (c.working ? 0.42 : 0.55);
        bead.visible = busy(c) && (c.status === 'blocked' || c.p > 0.05);
        bead.scale.x = c.status === 'blocked' ? 1 : Math.max(0.01, c.p);
        bead.position.x = -MODULE.L * 0.45 * (1 - bead.scale.x);
      },
    };
  },

  // A robot stacks the cells and end plates in a fixture; servo clamps compress the stack
  stacking(y) {
    const g = new THREE.Group();
    const pal = palletLine(g, y, MOD_LEN, 'module');
    const loose = add(pal, createModule('cells'));
    const stack = add(pal, createModule('stack'));
    const press = [];
    for (const s of [-1, 1]) {
      add(g, box(0.18, 0.5, 0.5, M.accent), s * 0.62, y + 0.2, 0);
      add(g, cyl(0.06, 0.06, 0.2, 14, M.alu), s * 0.48, y + 0.08, 0).rotation.z = Math.PI / 2;
      press.push(add(g, box(0.02, CELL.h + 0.02, 0.2, M.dark), s * 0.4, y + 0.08, 0));
    }
    const r = abbRobot(0.6, B.accent);
    r.root.position.set(0, 0, -1.2);
    r.baseYaw = Math.PI / 2;
    g.add(r.root);
    add(g, box(1.0, 0.8, 0.6, M.dark), -1.0, 0.4, -1.8); // cell buffer
    for (let i = 0; i < 2; i++) add(g, createCellTray(), -1.0, 0.8 + i * TRAY_H, -1.8);
    add(g, box(0.6, 0.7, 0.5, M.alu), 1.0, 0.35, -1.8); // end-plate magazine
    for (let i = 0; i < 6; i++) add(g, box(0.03, 0.14, 0.2, M.aluDark), 0.82 + i * 0.07, 0.77, -1.8);
    guardFence(g, -1.5, -2.5, 1.5, -2.5);
    guardFence(g, -1.5, -2.5, -1.5, -0.45);
    guardFence(g, 1.5, -2.5, 1.5, -0.45);
    lightCurtain(g, -1.35, -0.45, 0.45);
    const light = machineCommon(g, { lightAt: [1.5, 2.1, -0.45], hmiAt: [1.6, 1.4, 0.7, -0.5] });
    return {
      group: g, light, ops: [],
      update(c) {
        const done = c.status === 'blocked' || (c.working && c.p > 0.6);
        loose.visible = busy(c) && !done;
        stack.visible = busy(c) && done;
        const tgt = c.working && c.p > 0.5 ? 0.31 : 0.4;
        press.forEach((m, i) => { m.position.x += ((i ? 1 : -1) * tgt - m.position.x) * lerpK(c.dt, 5); });
        animateRobot(r, c.working && c.p < 0.6, c.simDt, c.dt);
      },
    };
  },

  // Enclosed fibre-laser cell welding the side plates to the end plates
  sideweld(y) {
    const g = new THREE.Group();
    const pal = palletLine(g, y, MOD_LEN, 'module');
    const before = add(pal, createModule('stack'));
    const after = add(pal, createModule('welded'));
    enclosure(g, 2.2, 2.0, 1.8, { color: B.machine, accent: B.accent, tunnelY: y + 0.1, tunnelH: 0.6, tunnelW: 0.8 });
    add(g, new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.9), M.tint), -0.53, y + 0.85, 0.915);
    const head = new THREE.Group();
    add(head, box(0.14, 0.3, 0.14, M.dark), 0, 0.15, 0);
    const beam = add(head, box(0.006, 0.35, 0.006, glow(0x7cff6a), false), 0, -0.18, 0);
    const spark = add(head, cyl(0.025, 0.025, 0.01, 10, glow(0xfff2b0), false), 0, -0.35, 0);
    add(g, box(2.0, 0.08, 0.08, M.aluDark), 0, y + 0.95, 0.2);
    head.position.set(0, y + 0.42, MODULE.W / 2 + 0.06);
    head.rotation.x = -0.35;
    g.add(head);
    cabinet(g, -0.4, -1.4, 0.7, 1.6, 0.6, B.machine, { screen: true }); // laser source
    cabinet(g, 0.5, -1.4, 0.6, 1.1, 0.6, 0x2a5d9f, { stripe: 0xf2f2f2 }); // chiller
    fumeDuct(g, 0.7, -0.4, 2.3);
    const light = machineCommon(g, { lightAt: [0.9, 2.3, 0.6], hmiAt: [1.2, 1.4, 1.05] });
    return {
      group: g, light, ops: [],
      update(c) {
        const done = c.status === 'blocked' || c.p > 0.95;
        before.visible = busy(c) && !done;
        after.visible = busy(c) && done;
        const on = c.working && Math.sin(c.t * 9) > -0.3;
        beam.visible = spark.visible = on;
        if (c.working) {
          const side = c.p < 0.5 ? 1 : -1;
          head.position.x = (c.p < 0.5 ? 1 : -1) * MODULE.L / 2;
          head.position.z = side * (MODULE.W / 2 + 0.06);
          head.rotation.x = -0.35 * side;
          head.position.y = y + 0.1 + ((c.p * 2) % 1) * 0.08 + 0.32;
        }
      },
    };
  },

  // Manual: operators place the busbars / CCS (cell contact system) and its FPC on the module
  ccs(y) {
    const g = new THREE.Group();
    const pal = palletLine(g, y, MOD_LEN, 'module');
    const before = add(pal, createModule('welded'));
    const after = add(pal, createModule('busbar'));
    workbench(g, 0, -1.5, 1.8, 0.7);
    for (let i = 0; i < 3; i++) add(g, box(0.5, 0.06, 0.35, mat([0x2b2f35, 0x1d6fd8, 0x2b2f35][i])), -0.6 + i * 0.6, 0.96, -1.5);
    for (let i = 0; i < 3; i++) add(g, box(0.4, 0.01, 0.06, mat(B.nickel, { metalness: 0.8, roughness: 0.25 })), -0.6 + i * 0.6, 1.0, -1.5);
    instructionScreen(g, 1.1, -0.9, 0);
    instructionScreen(g, -1.1, 0.9, Math.PI);
    const t1 = balancerTool(g, 0.3, -0.45, 2.6);
    const light = machineCommon(g, { lightAt: [1.25, 1.6, -1.8] });
    return {
      group: g, light, ops: [[-0.3, -0.85, Math.PI / 2], [0.3, 0.8, -Math.PI / 2]],
      update(c) {
        const done = c.status === 'blocked' || c.p > 0.55;
        before.visible = busy(c) && !done;
        after.visible = busy(c) && done;
        t1.set(c.working ? y + 0.5 + Math.sin(c.t * 2.8) * 0.12 : 1.9);
      },
    };
  },

  // Enclosed galvo-laser cell welding busbars to the cell terminals, with fume extraction
  busweld(y) {
    const g = new THREE.Group();
    const pal = palletLine(g, y, MOD_LEN, 'module');
    const prod = add(pal, createModule('busbar'));
    enclosure(g, 2.2, 2.0, 1.8, { color: B.machine, accent: B.accent, tunnelY: y + 0.1, tunnelH: 0.6, tunnelW: 0.8 });
    add(g, new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.9), M.tint), -0.53, y + 0.85, 0.915);
    add(g, box(2.0, 0.1, 0.1, M.aluDark), 0, y + 1.05, -0.3);
    const x = new THREE.Group();
    add(x, box(0.12, 0.12, 0.6, M.aluDark), 0, y + 1.05, 0);
    const head = add(x, new THREE.Group(), 0, 0, 0);
    add(head, box(0.22, 0.26, 0.2, M.dark), 0, y + 0.8, 0);
    add(head, cyl(0.06, 0.06, 0.1, 14, M.black), 0, y + 0.62, 0);
    const beam = add(head, box(0.005, 0.38, 0.005, glow(0x7cff6a), false), 0, y + 0.38, 0);
    g.add(x);
    add(g, box(0.5, 0.12, 0.3, M.alu), 0, y + 0.45, -0.45); // extraction nozzle
    cabinet(g, -0.4, -1.4, 0.7, 1.6, 0.6, B.machine, { screen: true });
    cabinet(g, 0.5, -1.4, 0.6, 1.1, 0.6, 0x2a5d9f, { stripe: 0xf2f2f2 });
    fumeDuct(g, 0.0, -0.45, 2.3);
    const light = machineCommon(g, { lightAt: [0.9, 2.3, 0.6], hmiAt: [1.2, 1.4, 1.05] });
    return {
      group: g, light, ops: [],
      update(c) {
        prod.visible = busy(c);
        beam.visible = c.working && Math.sin(c.t * 14) > 0;
        if (c.working) {
          const k = Math.floor(c.p * (CELLS - 1));
          x.position.x = -MODULE.L / 2 + 0.05 + (k + 0.5) * CELL.t;
          head.position.z = (k % 2 ? -1 : 1) * CELL.w * 0.3;
        }
      },
    };
  },

  // Module end-of-line test: a probe head drops onto the terminals (OCV, IR, hipot, DCR)
  moduleeol(y) {
    const g = new THREE.Group();
    const pal = palletLine(g, y, MOD_LEN, 'module');
    const prod = add(pal, createModule('module'));
    for (const s of [-1, 1]) add(g, box(0.1, 1.2, 0.1, M.alu), s * 0.55, y + 0.2, -0.45);
    add(g, box(1.2, 0.12, 0.12, M.alu), 0, y + 0.85, -0.45);
    add(g, cyl(0.05, 0.05, 0.3, 12, M.alu), 0, y + 0.7, -0.2);
    const probe = new THREE.Group();
    add(probe, box(0.62, 0.05, 0.2, M.dark), 0, 0, 0);
    for (let i = 0; i < 8; i++) add(probe, box(0.01, 0.06, 0.01, mat(0xd9a441, { metalness: 0.8 })), -0.27 + i * 0.077, -0.05, 0);
    add(probe, box(0.06, 0.04, 0.06, M.hv), -0.32, -0.03, 0.05);
    probe.position.set(0, y + 0.45, 0);
    g.add(probe);
    // 19" test rack
    add(g, box(0.7, 1.9, 0.7, M.black), -0.6, 0.95, -1.5);
    for (let i = 0; i < 6; i++) add(g, box(0.6, 0.18, 0.01, i % 2 ? M.dark : mat(0x3a3f45)), -0.6, 0.4 + i * 0.24, -1.14);
    for (let i = 0; i < 3; i++) add(g, box(0.18, 0.08, 0.005, glow([0x2ee6d2, 0x34ff6a, 0xffd23f][i]), false), -0.75 + i * 0.15, 1.55, -1.14);
    add(g, box(0.06, 0.06, 1.0, M.hv), -0.2, 1.4, -1.0); // test cables
    lightCurtain(g, -1.3, -0.45, 0.45);
    lightCurtain(g, 1.3, -0.45, 0.45);
    const light = machineCommon(g, { lightAt: [0.6, y + 0.91, -0.45], hmiAt: [1.0, 1.4, 0.7, -0.5] });
    return {
      group: g, light, ops: [],
      update(c) {
        prod.visible = busy(c);
        const down = c.working && c.p > 0.1 && c.p < 0.9;
        const tgt = y + (down ? CELL.h + 0.07 : 0.45);
        probe.position.y += (tgt - probe.position.y) * lerpK(c.dt, 6);
      },
    };
  },

  // ------------------------------------------------------------------ pack line stations
  // Empty pack housings are lifted from the stack onto the pack pallet with a gantry hoist
  housingload(y) {
    const g = new THREE.Group();
    const pal = palletLine(g, y, PACK_LEN, 'pack');
    const prod = add(pal, createPack('housing'));
    add(g, box(1.9, 0.14, 1.6, mat(C.wood, { roughness: 0.85 })), 0, 0.07, -2.4);
    for (let i = 0; i < 3; i++) add(g, createPack('housing'), 0, 0.14 + i * (PACK.H + 0.02), -2.4);
    const lifter = vacuumLifter(1.5, 1.2);
    const carried = add(lifter, createPack('housing'), 0, -0.36 - PACK.H - 0.012, 0);
    const gt = gantry(g, { w: 3.2, d: 4.0, h: 3.4, cz: -1.2, tool: lifter });
    const light = machineCommon(g, { lightAt: [1.5, 1.6, 0.9] });
    return {
      group: g, light, ops: [[-1.3, 1.1, -Math.PI / 2]],
      update(c) {
        const p = c.working ? c.p : c.status === 'blocked' ? 1 : 0;
        const placed = p > 0.75;
        prod.visible = busy(c) && placed;
        carried.visible = c.working && p > 0.3 && !placed;
        const stackTop = 0.14 + 3 * (PACK.H + 0.02) + 0.36;
        if (!c.working) gt.set(0, -1.2, 2.6);
        else if (p < 0.3) gt.set(0, -2.4, p < 0.2 ? 2.6 : stackTop);
        else if (p < 0.55) gt.set(0, p < 0.45 ? -2.4 : 0, 2.6);
        else gt.set(0, 0, p < 0.75 ? y + PACK.H + 0.38 : 2.6);
        gt.update(c.dt);
      },
    };
  },

  // Gap filler / thermal paste dispensed on the cooling floor before the modules go in
  paste(y) {
    const g = new THREE.Group();
    const pal = palletLine(g, y, PACK_LEN, 'pack');
    const before = add(pal, createPack('housing'));
    const after = add(pal, createPack('paste'));
    for (const s of [-1, 1]) for (const z of [-1, 1]) add(g, box(0.12, 1.5, 0.12, M.alu), s * 1.2, y + 0.3, z * 0.95);
    for (const z of [-1, 1]) add(g, box(2.5, 0.14, 0.14, M.alu), 0, y + 1.1, z * 0.95);
    const bridge = new THREE.Group();
    add(bridge, box(0.16, 0.16, 2.0, M.aluDark), 0, y + 1.25, 0);
    const head = add(bridge, new THREE.Group(), 0, 0, 0);
    add(head, box(0.2, 0.3, 0.2, M.dark), 0, y + 1.0, 0);
    add(head, box(0.04, 0.3, 0.04, M.accent), 0, y + 0.72, 0);
    g.add(bridge);
    add(g, box(1.4, 0.12, 0.8, M.dark), -0.4, 0.06, -2.0);
    for (const [x, col] of [[-0.75, 0x8d959e], [-0.05, 0xf2f2f2]]) {
      add(g, cyl(0.3, 0.3, 0.9, 20, mat(col, { roughness: 0.5 })), x, 0.57, -2.0);
      add(g, cyl(0.07, 0.07, 1.0, 10, M.alu), x, 1.4, -2.0);
    }
    add(g, box(0.06, 0.06, 1.0, M.black), -0.4, 1.9, -1.4);
    cabinet(g, 0.9, -2.0, 0.6, 1.4, 0.5, B.machine, { screen: true });
    lightCurtain(g, -1.35, -0.95, 0.95);
    lightCurtain(g, 1.35, -0.95, 0.95);
    const light = machineCommon(g, { lightAt: [1.2, y + 1.17, -0.95], hmiAt: [1.55, 1.4, 1.2, -0.5] });
    return {
      group: g, light, ops: [],
      update(c) {
        const done = c.status === 'blocked' || c.p > 0.9;
        before.visible = busy(c) && !done;
        after.visible = busy(c) && done;
        if (c.working) {
          const row = Math.floor(c.p * PACK.rows);
          bridge.position.x = -PACK.L / 2 + 0.15 + row * 0.22;
          head.position.z = Math.sin(c.t * 3) * 0.55;
        }
      },
    };
  },

  // Modules are lifted from the module cart into the housing with a gantry hoist and gripper
  moduleinsert(y) {
    const g = new THREE.Group();
    const pal = palletLine(g, y, PACK_LEN, 'pack');
    const base = add(pal, createPack('paste'));
    const rowX = (r) => -PACK.L / 2 + 0.15 + r * 0.22;
    const colZ = (k) => (k ? 1 : -1) * 0.335;
    const slots = [];
    for (let r = 0; r < PACK.rows; r++) for (let k = 0; k < PACK.cols; k++) {
      const m = add(pal, createModule('module'), rowX(r), 0.024, colZ(k));
      m.rotation.y = Math.PI / 2;
      slots.push(m);
    }
    // Module cart beside the line
    const cart = new THREE.Group();
    add(cart, box(1.4, 0.04, 0.8, M.aluDark), 0, 0.35, 0);
    add(cart, box(1.4, 0.04, 0.8, M.aluDark), 0, 0.85, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(cart, box(0.04, 0.85, 0.04, M.dark), sx * 0.68, 0.45, sz * 0.38);
    for (const yy of [0.37, 0.87]) for (let i = 0; i < 3; i++) add(cart, createModule('module'), 0, yy, -0.25 + i * 0.25).rotation.y = 0;
    cart.position.set(0, 0, -2.3);
    g.add(cart);
    const grip = new THREE.Group();
    add(grip, box(0.06, 0.2, 0.06, M.dark), 0, -0.1, 0);
    add(grip, box(0.7, 0.06, 0.1, M.accent), 0, -0.23, 0);
    for (const s of [-1, 1]) add(grip, box(0.03, 0.18, 0.08, M.dark), s * 0.33, -0.33, 0);
    const held = add(grip, createModule('module'), 0, -0.42 - MODULE.H + 0.02, 0);
    const gt = gantry(g, { w: 3.4, d: 4.2, h: 3.4, cz: -1.2, tool: grip });
    instructionScreen(g, 1.4, 1.3, Math.PI);
    const light = machineCommon(g, { lightAt: [1.7, 1.6, 1.0] });
    return {
      group: g, light, ops: [[-0.6, 1.15, -Math.PI / 2], [0.8, -1.25, Math.PI / 2]],
      update(c) {
        base.visible = busy(c);
        const n = slots.length;
        const p = c.working ? c.p : c.status === 'blocked' ? 1 : 0;
        const k = Math.min(n, Math.floor(p * n));
        const f = p * n - k;
        slots.forEach((m, i) => { m.visible = busy(c) && i < k; });
        held.visible = c.working && k < n && f > 0.3 && f < 0.85;
        // Gripper holds the module turned 90°, like the slots
        grip.rotation.y = f > 0.45 ? Math.PI / 2 : 0;
        if (!c.working || k >= n) gt.set(0, -1.2, 2.6);
        else if (f < 0.3) gt.set(0, -2.3, f < 0.2 ? 2.6 : 1.4);
        else if (f < 0.55) gt.set(f < 0.45 ? 0 : rowX(Math.floor(k / 2)), f < 0.45 ? -2.3 : colZ(k % 2), 2.6);
        else gt.set(rowX(Math.floor(k / 2)), colZ(k % 2), f < 0.85 ? y + 0.024 + MODULE.H + 0.44 : 2.6);
        gt.update(c.dt, 4);
      },
    };
  },

  // Manual: modules bolted down with a nutrunner on a torque-reaction arm under a gantry
  boltdown(y) {
    const g = new THREE.Group();
    const pal = palletLine(g, y, PACK_LEN, 'pack');
    const prod = add(pal, createPack('modules'));
    const tool = new THREE.Group();
    add(tool, box(0.06, 0.5, 0.06, M.aluDark), 0, -0.25, 0);
    add(tool, cyl(0.05, 0.05, 0.3, 12, M.accent), 0, -0.6, 0);
    add(tool, cyl(0.015, 0.015, 0.1, 8, M.alu), 0, -0.8, 0);
    add(tool, box(0.25, 0.03, 0.03, M.dark), 0.12, -0.52, 0); // handle
    const gt = gantry(g, { w: 3.2, d: 3.0, h: 3.2, tool });
    workbench(g, 0, -2.0, 1.6, 0.6);
    const light = machineCommon(g, { lightAt: [1.5, 1.6, -1.6] });
    return {
      group: g, light, ops: [[0.2, 1.1, -Math.PI / 2]],
      update(c) {
        prod.visible = busy(c);
        if (c.working) {
          const i = Math.floor(c.p * 24);
          const r = Math.floor(i / 4) % PACK.rows;
          const z = (i % 4 < 2 ? -1 : 1) * (0.335 + (i % 2 ? 1 : -1) * (MODULE.L / 2 + 0.015));
          gt.set(-PACK.L / 2 + 0.15 + r * 0.22, z, y + MODULE.H + 0.9 + ((c.p * 24) % 1 < 0.6 ? 0 : 0.15));
        } else gt.set(0, 0, 2.6);
        gt.update(c.dt, 6);
      },
    };
  },

  // Manual: HV busbars, LV harness, BDU and BMS fitted from both sides of the line
  wiring(y) {
    const g = new THREE.Group();
    const pal = palletLine(g, y, PACK_LEN, 'pack');
    const before = add(pal, createPack('modules'));
    const after = add(pal, createPack('wired'));
    for (const s of [-1, 1]) {
      workbench(g, -0.6 * s, s * 1.9, 1.6, 0.6, s > 0 ? Math.PI : 0);
      for (let i = 0; i < 3; i++) add(g, box(0.3, 0.05, 0.2, i === 1 ? M.hv : M.dark), -0.6 * s - 0.45 + i * 0.45, 0.95, s * 1.9);
    }
    for (let i = 0; i < 3; i++) {
      const reel = add(g, cyl(0.2, 0.2, 0.12, 16, mat([0xff7a1a, 0x16181b, 0xf2f2f2][i])), 1.0, 0.4 + i * 0.5, -2.0);
      reel.rotation.x = Math.PI / 2;
    }
    add(g, box(0.6, 1.5, 0.05, M.aluDark), 1.0, 0.75, -2.1);
    const t1 = balancerTool(g, -0.3, -0.5, 2.7);
    const t2 = balancerTool(g, 0.4, 0.5, 2.7);
    instructionScreen(g, 1.7, -1.0, 0);
    const light = machineCommon(g, { lightAt: [1.7, 1.6, 1.4] });
    return {
      group: g, light, ops: [[-0.4, -1.1, Math.PI / 2], [0.5, 1.1, -Math.PI / 2]],
      update(c) {
        const done = c.status === 'blocked' || c.p > 0.6;
        before.visible = busy(c) && !done;
        after.visible = busy(c) && done;
        t1.set(c.working ? y + 0.55 + Math.sin(c.t * 2.4) * 0.12 : 2.0);
        t2.set(c.working ? y + 0.55 + Math.sin(c.t * 2.9 + 1) * 0.12 : 2.0);
      },
    };
  },

  // The lid is lifted from the lid cart with a vacuum lifter; operators fasten it
  lid(y) {
    const g = new THREE.Group();
    const pal = palletLine(g, y, PACK_LEN, 'pack');
    const before = add(pal, createPack('wired'));
    const after = add(pal, createPack('closed'));
    const lidMesh = () => box(PACK.L + 0.06, 0.03, PACK.W + 0.06, mat(B.lid, { metalness: 0.45, roughness: 0.45 }));
    add(g, box(1.9, 0.5, 1.6, M.aluDark), 0, 0.25, -2.4); // lid cart
    for (let i = 0; i < 5; i++) add(g, lidMesh(), 0, 0.515 + i * 0.035, -2.4);
    const lifter = vacuumLifter(1.5, 1.2);
    const carried = add(lifter, lidMesh(), 0, -0.375, 0);
    const gt = gantry(g, { w: 3.2, d: 4.0, h: 3.4, cz: -1.2, tool: lifter });
    const light = machineCommon(g, { lightAt: [1.5, 1.6, 0.9] });
    return {
      group: g, light, ops: [[-0.9, 1.1, -Math.PI / 2], [0.9, 1.1, -Math.PI / 2]],
      update(c) {
        const p = c.working ? c.p : c.status === 'blocked' ? 1 : 0;
        const placed = p > 0.6;
        before.visible = busy(c) && !placed;
        after.visible = busy(c) && placed;
        carried.visible = c.working && p > 0.2 && !placed;
        if (!c.working || p > 0.6) gt.set(0, -1.2, 2.6);
        else if (p < 0.2) gt.set(0, -2.4, p < 0.12 ? 2.6 : 0.75 + 0.36);
        else if (p < 0.4) gt.set(0, p < 0.32 ? -2.4 : 0, 2.6);
        else gt.set(0, 0, y + PACK.H + 0.43);
        gt.update(c.dt);
      },
    };
  },

  // Air / helium leak test: a clamp portal seals the pack, the tester pressurises it
  leaktest(y) {
    const g = new THREE.Group();
    const pal = palletLine(g, y, PACK_LEN, 'pack');
    const prod = add(pal, createPack('closed'));
    for (const s of [-1, 1]) for (const z of [-1, 1]) add(g, box(0.14, 1.6, 0.14, M.alu), s * 1.15, y + 0.35, z * 0.95);
    for (const s of [-1, 1]) add(g, box(0.18, 0.18, 2.1, M.alu), s * 1.15, y + 1.2, 0);
    add(g, box(2.5, 0.18, 0.18, M.alu), 0, y + 1.2, 0);
    const clamp = new THREE.Group();
    add(clamp, box(1.9, 0.06, 1.5, M.aluDark), 0, 0, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(clamp, cyl(0.04, 0.04, 0.5, 10, M.alu), sx * 0.7, 0.28, sz * 0.5);
    clamp.position.y = y + 0.9;
    g.add(clamp);
    cabinet(g, -0.3, -1.6, 0.8, 1.6, 0.6, B.machine, { screen: true }); // leak tester
    add(g, cyl(0.15, 0.15, 0.9, 16, mat(0x2a5d9f)), 0.5, 0.45, -1.7); // helium bottle
    add(g, box(0.05, 0.05, 1.2, M.black), 0.0, y + 0.2, -0.8); // test hose
    add(g, box(0.06, 0.08, 0.06, mat(C.yellow)), PACK.L / 2 + 0.06, y + 0.12, -0.3);
    const light = machineCommon(g, { lightAt: [1.15, y + 1.3, 0.95], hmiAt: [1.5, 1.4, 1.2, -0.5] });
    return {
      group: g, light, ops: [[-1.0, 1.25, -Math.PI / 2]],
      update(c) {
        prod.visible = busy(c);
        const down = c.working && c.p > 0.08 && c.p < 0.92;
        const tgt = y + (down ? PACK.H + 0.08 : 0.9);
        clamp.position.y += (tgt - clamp.position.y) * lerpK(c.dt, 4);
      },
    };
  },

  // Pack end-of-line test: HV and LV connected through a cable boom to the test cabinets
  packeol(y) {
    const g = new THREE.Group();
    const pal = palletLine(g, y, PACK_LEN, 'pack');
    const prod = add(pal, createPack('closed'));
    for (let i = 0; i < 3; i++) cabinet(g, -1.0 + i * 0.75, -1.8, 0.7, 2.0, 0.7, i === 1 ? 0x2b2f35 : B.machine, { screen: true, stripe: i === 1 ? B.hv : B.accent });
    add(g, box(0.12, 2.4, 0.12, M.aluDark), 1.3, 1.2, -1.1);
    const boom = new THREE.Group();
    add(boom, box(1.3, 0.1, 0.1, M.aluDark), 0, 0, 0);
    const plug = add(boom, box(0.12, 0.3, 0.12, M.hv), 0.6, -0.2, 0);
    add(boom, box(0.04, 0.5, 0.04, M.black), 0.6, -0.15, 0.05);
    boom.position.set(1.3, 2.2, -1.1);
    g.add(boom);
    for (const z of [-1, 1]) guardFence(g, -1.9, z * 1.2, 1.9, z * 1.2, 1.4);
    const light = machineCommon(g, { lightAt: [1.9, 1.5, 1.2], hmiAt: [-1.5, 1.4, 1.35, 0.3] });
    return {
      group: g, light, ops: [[-0.4, 1.5, -Math.PI / 2]],
      update(c) {
        prod.visible = busy(c);
        const on = c.working && c.p > 0.1 && c.p < 0.9;
        const tgt = on ? 0.95 : 0.2;
        boom.rotation.y += (tgt - boom.rotation.y) * lerpK(c.dt, 3);
        plug.position.y = on ? -0.9 : -0.2;
      },
    };
  },

  // Finished packs lifted off the line onto shipping pallets with the gantry hoist
  packunload(y) {
    const g = new THREE.Group();
    const pal = palletLine(g, y, PACK_LEN, 'pack');
    const prod = add(pal, createPack('closed'));
    add(g, box(1.9, 0.14, 1.6, mat(C.wood, { roughness: 0.85 })), 0, 0.07, -2.4);
    const out = add(g, createPack('closed'), 0, 0.14, -2.4);
    const lifter = vacuumLifter(1.5, 1.2);
    const carried = add(lifter, createPack('closed'), 0, -0.36 - PACK.H - 0.03, 0);
    const gt = gantry(g, { w: 3.2, d: 4.0, h: 3.4, cz: -1.2, tool: lifter });
    const light = machineCommon(g, { lightAt: [1.5, 1.6, 0.9] });
    return {
      group: g, light, ops: [[1.3, 1.1, -Math.PI / 2]],
      update(c) {
        const p = c.working ? c.p : 0;
        prod.visible = c.status === 'blocked' || (c.working && p < 0.25);
        carried.visible = c.working && p >= 0.25 && p < 0.75;
        out.visible = !c.working || p >= 0.75;
        if (!c.working) gt.set(0, -1.2, 2.6);
        else if (p < 0.25) gt.set(0, 0, p < 0.12 ? 2.6 : y + PACK.H + 0.42);
        else if (p < 0.5) gt.set(0, p < 0.4 ? 0 : -2.4, 2.6);
        else gt.set(0, -2.4, p < 0.75 ? 0.14 + PACK.H + 0.42 : 2.6);
        gt.update(c.dt);
      },
    };
  },
};

// ------------------------------------------------------------------ buffers & storage
// Straight pallet-conveyor buffer with `slots` tooling pallets queued on it
export function createPalletBuffer(kind = 'module', slots = 4) {
  const g = new THREE.Group();
  const pitch = LINE[kind].PL + 0.12;
  const len = slots * pitch + 0.2;
  const first = palletLine(g, 0.9, len, kind);
  first.position.x = len / 2 - 0.1 - pitch / 2;
  const pallets = [first];
  for (let i = 1; i < slots; i++) {
    const p = first.clone();
    p.position.x = first.position.x - i * pitch;
    g.add(p);
    pallets.push(p);
  }
  const loads = pallets.map((p) => add(p, kind === 'pack' ? createPack('closed') : createModule('module')));
  return { group: g, len, loads };
}

// Racking for cell trays (incoming) or finished modules
export function createBatteryRack(kind = 'cells', bays = 3, levels = 4) {
  const g = new THREE.Group();
  const bayW = 1.4;
  const levelH = 0.55;
  const depth = 0.8;
  const H = levels * levelH + 0.2;
  const up = mat(0x2a5d9f, { metalness: 0.4, roughness: 0.5 });
  const beam = mat(0xf07a1a, { metalness: 0.3, roughness: 0.5 });
  const L = bays * bayW;
  for (let i = 0; i <= bays; i++) for (const z of [-depth / 2, depth / 2]) add(g, box(0.07, H, 0.07, up), -L / 2 + i * bayW, H / 2, z);
  for (let l = 0; l < levels; l++) {
    const yy = 0.15 + l * levelH;
    for (const z of [-depth / 2, depth / 2]) add(g, box(L, 0.08, 0.05, beam), 0, yy, z);
    add(g, box(L, 0.02, depth, mat(0x9aa1a9, { metalness: 0.5 })), 0, yy + 0.05, 0);
    for (let b = 0; b < bays; b++) {
      const x = -L / 2 + b * bayW + bayW / 2;
      if (kind === 'cells') {
        for (let k = 0; k < 2; k++) add(g, createCellTray(), x - 0.32 + k * 0.64, yy + 0.06, 0);
        add(g, createCellTray(), x - 0.32, yy + 0.06 + TRAY_H, 0);
      } else {
        for (let k = 0; k < 2; k++) add(g, createModule('module'), x, yy + 0.06, -0.18 + k * 0.36);
      }
    }
  }
  return { group: g, H };
}

// ------------------------------------------------------------------ yard
// Straddle carrier for finished Megapacks: a red portal frame as long as the unit, a leg and wheel
// at each corner and no low cross members, so it can drive over a row of units in either
// direction. Hoists on the top frame lower a spreader between the legs that picks the unit up from
// above. setLift(h) puts the spreader at h (m); setLoaded(b) shows the unit and lifts it to travel
// height, high enough to carry it over a unit standing on the ground.
// The load is a Megapack 2 XL (8.84 x 2.83 x 1.69 m), its length along the frame (x).
const UNIT = { L: 8.84, W: 1.69, H: 2.83 };
export const CARRIER = { len: UNIT.L + 1.2, half: 1.35, H: 7.8, load: UNIT, clearance: 0.35 };
const GRIP = 0.55; // spreader to the top of the unit it holds
CARRIER.pickLift = CARRIER.load.H + GRIP; // spreader height with the unit on the ground
CARRIER.travelLift = 2 * CARRIER.load.H + CARRIER.clearance + GRIP; // unit bottom clears a parked unit
CARRIER.parkedLift = CARRIER.H - 0.9; // empty spreader, clear of everything below
// Megapack 2 XL from the photo pipeline (models/captured/megapack-2xl), baked once into one mesh
// per material so a yard full of them stays cheap. Call loadMegapack() before building scenes.
let megapackProto = null;
function mergeByMaterial(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const rel = new THREE.Matrix4();
  const buckets = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal') g.deleteAttribute(n);
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(rel.multiplyMatrices(inv, o.matrixWorld));
    if (!buckets.has(m)) buckets.set(m, []);
    buckets.get(m).push(g);
  });
  const out = new THREE.Group();
  for (const [m, geos] of buckets) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), m);
    mesh.castShadow = mesh.receiveShadow = true;
    out.add(mesh);
  }
  return out;
}
export async function loadMegapack() {
  if (megapackProto) return true;
  try {
    const mod = await import('../../models/captured/megapack-2xl/model.js');
    megapackProto = mergeByMaterial(mod.createMegapack2XLModel({}));
    return true;
  } catch (err) {
    console.warn('Megapack 2 XL model failed to load; using a plain unit instead', err);
    return false;
  }
}
// A Megapack 2 XL standing on the floor, centred, length along x
export function createMegapackUnit() {
  return megapackProto ? megapackProto.clone() : createWrappedUnit();
}

// Plain stand-in with the same footprint, used until (or if not) the Megapack model loads
export function createWrappedUnit() {
  const U = CARRIER.load;
  return product('unit', () => {
    const u = new THREE.Group();
    add(u, box(U.L, 0.18, U.W, mat(0x6f7883, { metalness: 0.4 })), 0, 0.09, 0); // skid
    add(u, box(U.L, U.H - 0.18, U.W, mat(0xe9ecef, { roughness: 0.75 })), 0, 0.18 + (U.H - 0.18) / 2, 0); // wrap
    for (const x of [-U.L / 4, U.L / 4]) add(u, box(0.05, U.H - 0.2, U.W + 0.01, mat(0xd2d6db, { roughness: 0.8 })), x, U.H / 2 + 0.05, 0); // seams
    add(u, box(U.L + 0.01, 0.04, U.W + 0.01, mat(0xd2d6db, { roughness: 0.8 })), 0, U.H * 0.55, 0);
    add(u, box(0.3, 0.3, 0.005, mat(0x3a3f45)), U.L * 0.2, U.H * 0.7, U.W / 2 + 0.005); // label
    return u;
  });
}
export function createStraddleCarrier({ color = 0xd3202c } = {}) {
  const { len, half, H, load: U } = CARRIER;
  const g = new THREE.Group();
  const s = new THREE.Group();
  const red = mat(color, { roughness: 0.45, metalness: 0.25 });
  const dark = mat(0x1d1f22, { roughness: 0.6 });
  const legX = len / 2 - 0.2;
  for (const z of [-half, half]) {
    add(s, box(len + 0.4, 0.55, 0.42, red), 0, H, z); // top side beam
    for (const x of [-legX, legX]) {
      add(s, box(0.38, H - 0.85, 0.4, red), x, 0.85 + (H - 0.85) / 2, z);
      add(s, box(0.12, H - 1.9, 0.08, dark), x + (x > 0 ? -0.2 : 0.2), 1.5 + (H - 1.9) / 2, z - Math.sign(z) * 0.18); // spreader guide
      add(s, cyl(0.45, 0.45, 0.34, 18, dark), x, 0.45, z).rotation.x = Math.PI / 2;
      add(s, cyl(0.2, 0.2, 0.36, 10, mat(0x9aa1a9, { metalness: 0.6 })), x, 0.45, z).rotation.x = Math.PI / 2;
      add(s, box(0.6, 0.3, 0.5, red), x, 0.85, z); // wheel fork
      add(s, box(0.5, 0.35, 0.5, red), x, H - 0.45, z); // knee bracket
    }
  }
  for (const x of [-legX, legX]) {
    add(s, box(0.45, 0.6, half * 2 + 0.42, red), x, H, 0); // cross beam
    add(s, box(0.02, 0.2, 1.4, mat(0xf2f2f2)), x + Math.sign(x) * 0.235, H, 0); // name board
  }
  // Hoist drums near each end and the power pack in the middle
  for (const x of [-(len / 2 - 1.2), len / 2 - 1.2]) add(s, cyl(0.36, 0.36, 0.14, 20, dark), x, H + 0.35, 0);
  add(s, box(1.0, 0.5, 0.9, mat(0x3a3f45)), 0, H + 0.45, 0.9);
  add(s, box(0.06, 0.06, half * 2, dark), 0, H + 0.32, 0);
  // Cab and ladder on one leg
  add(s, box(0.9, 1.2, 0.8, dark), legX + 0.15, 2.8, half + 0.6);
  add(s, box(0.02, 0.6, 0.6, mat(0x2e4a63, { roughness: 0.1, metalness: 0.3 })), legX + 0.61, 3.0, half + 0.6);
  add(s, box(0.9, 0.06, 0.9, red), legX + 0.15, 2.17, half + 0.6);
  for (let i = 0; i < 9; i++) add(s, box(0.04, 0.04, 0.4, mat(0x9aa1a9)), legX - 0.3, 0.4 + i * 0.22, half + 0.3);
  g.add(mergeColored(s));
  for (const x of [-legX, legX]) for (const z of [-half, half]) {
    add(g, box(0.12, 0.12, 0.04, glow(0xffb020), false), x, 1.45, z + Math.sign(z) * 0.22); // amber
    add(g, box(0.16, 0.12, 0.04, glow(0xf4f7ff), false), x, 2.6, z + Math.sign(z) * 0.22); // work light
  }
  add(g, cyl(0.08, 0.08, 0.12, 12, glow(0xffb020), false), 0, H + 0.76, 0.9); // beacon
  // Spreader with twistlock arms, hanging on four ropes
  const spreader = new THREE.Group();
  const sp = new THREE.Group();
  const grey = mat(0xd5d9de, { roughness: 0.45, metalness: 0.4 });
  for (const z of [-0.95, 0.95]) add(sp, box(len - 0.75, 0.2, 0.2, grey), 0, 0, z);
  for (const x of [-(len / 2 - 0.5), len / 2 - 0.5]) add(sp, box(0.2, 0.2, 2.1, grey), x, 0, 0);
  for (const x of [-(len / 2 - 0.5), len / 2 - 0.5]) for (const z of [-0.95, 0.95]) {
    add(sp, box(0.12, 0.45, 0.12, dark), x, -0.3, z); // gripper arm
    add(sp, box(0.3, 0.12, 0.25, dark), x + Math.sign(x) * 0.15, 0, z + Math.sign(z) * 0.2); // guide shoe
  }
  spreader.add(mergeColored(sp));
  const cargo = new THREE.Group();
  cargo.add(createMegapackUnit());
  cargo.position.y = -GRIP - U.H;
  spreader.add(cargo);
  g.add(spreader);
  const ropes = [];
  for (const x of [-(len / 2 - 0.5), len / 2 - 0.5]) for (const z of [-0.95, 0.95]) ropes.push(add(g, cyl(0.02, 0.02, 1, 6, dark, false), x, 0, z));
  const top = H - 0.3;
  const setLift = (h) => {
    spreader.position.y = h;
    for (const r of ropes) {
      r.scale.y = Math.max(0.01, top - h);
      r.position.y = (top + h) / 2;
    }
  };
  setLift(CARRIER.travelLift);
  return {
    group: g, cargo, spreader, setLift,
    setLoaded(b) {
      cargo.visible = b;
      setLift(b ? CARRIER.travelLift : CARRIER.parkedLift);
    },
  };
}
