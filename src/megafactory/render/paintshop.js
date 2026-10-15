// The powder coat shop in detail: power-and-free rail with empty-carrier return, 5-stage
// pretreatment tunnel, dry-off / gel / cure ovens, primer and topcoat booths with reciprocating
// gun bars, manual touch-up booths with painters, inspection with film-thickness readout, repair,
// load & hang and drop stations. Process effects (powder wrap and overspray, wash water and mist,
// burner flicker, stack vapour, oven haze) are driven by what the simulation has in each section.
import * as THREE from 'three';
import { Batch } from './batch.js';
import { materials } from './materials.js';
import { Particles } from './particles.js';
import { createPerson, rest, poseSpray, poseReach, poseInspect, poseSand } from './people.js';
import { lamp, addPick, floorStencil } from './equipment.js';
import { instancer } from './instancer.js';
import { NODES, N, RAIL_Y, HANG_Y, BUILDING, pointAt, pathLength } from '../plant.js';
import { paintWip } from '../sim.js';
import { PACK } from '../../models.js';

const H = BUILDING.h;
const PART_MID = HANG_Y + PACK.BODY / 2 + 0.03;          // vertical centre of a hanging frame
export const RAILS = [
  [[-108, -66], [94, -66], [94, -50], [-100, -50], [-100, -4]],   // process loop
  [[8, -50], [8, -38], [-108, -38]],                              // repair spur and recoat queue
  [[-100, -4], [-100, 2], [-108, 2], [-108, -66]],                // empty-carrier return
];
const RETURN = RAILS[2], RETURN_L = pathLength(RETURN);
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
  booth: { w: 5.4, h: 6.0, wall: 'boothWall', strip: 'boothStrip' },
  cool: { w: 4.6, h: 5.6, wall: 'panelGrey', strip: 'boothStrip' },
};
const WASH_STAGES = ['1 · Alkaline clean 55 °C', '2 · Rinse', '3 · Zirconium conversion', '4 · Rinse', '5 · DI rinse'];
const OVEN_TEMP = { DRY: 120, GEL: 180, CURE: 200 };
const POWDER = { primer: [0.52, 0.6, 0.54], topcoat: [1, 1, 1] };
const rand = (a, b) => a + Math.random() * (b - a);
// shared shapes for repeated moving parts, so the instancer draws each kind once
const GEO = {
  carBody: new THREE.BoxGeometry(0.5, 0.36, 0.3), gunBar: new THREE.BoxGeometry(0.08, 1.5, 0.08),
  gun: new THREE.CylinderGeometry(0.045, 0.06, 0.55, 10), nozzle: new THREE.ConeGeometry(0.06, 0.12, 10),
  trolley: new THREE.BoxGeometry(1.5, 0.34, 0.5), hook: new THREE.BoxGeometry(0.06, 0.9, 0.06), hanger: new THREE.BoxGeometry(0.05, 0.4, 0.05),
  fan: new THREE.BoxGeometry(1.7, 0.04, 0.22), ovenFan: new THREE.BoxGeometry(1.3, 0.04, 0.2), flame: new THREE.BoxGeometry(0.5, 0.3, 0.05),
};

export function buildPaintShop(stage, eq) {
  const M = materials();
  const scene = stage.scene;
  const root = new THREE.Group(); root.name = 'paintshop'; scene.add(root);
  const S = new Batch(), T = new Batch(), G = new Batch();
  const L = (text, x, y, z, cls, far, near) => stage.label(text, x, y, z, cls, { far, near });
  const ps = { root, booths: {}, wash: { stages: [], stacks: [] }, ovens: [], coolFans: [], painters: [], workers: [], empties: [],
               fx: new Particles(scene, 12000), t: 0, labelT: 0 };
  // extra materials with live values
  ps.flame = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff6a1a, emissiveIntensity: 2.4 });
  ps.screen = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x39c6ff, emissiveIntensity: 1.4 });

  // ---------------- power-and-free rail: free track, power track, header steel, hangers
  for (const path of RAILS) {
    const pts = path.map(([x, z]) => [x, RAIL_Y, z]);
    S.polyline(M.rail, pts, 0.14, 0.22);
    S.polyline(M.rail, pts.map(([x, y, z]) => [x, y + 0.6, z]), 0.16, 0.18);
    for (let i = 1; i < path.length; i++) {
      const [ax, az] = path[i - 1], [bx, bz] = path[i];
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 6));
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
  // drive unit and take-up on the return, as on a real chain loop
  S.box(M.conveyorBlue, 2.2, 1.4, 1.6, -108, RAIL_Y + 1.2, -20);
  S.cyl(M.darkSteel, 0.5, 0.5, -108, RAIL_Y + 1.9, -20, 16);
  L('CARRIER RETURN', -108, RAIL_Y + 3.2, -20, 'sub', 140);

  // ---------------- enclosures
  for (const [key, x0, x1, z, style] of HOUSINGS) {
    const st = STYLE[style], d = NODES[N[key]];
    shell(S, T, M, x0, x1, z, st);
    if (style === 'wash') washTunnel(S, G, M, ps, L, x0, x1, z, st);
    if (style === 'oven') oven(S, G, M, ps, L, key, x0, x1, z, st, root);
    if (style === 'booth') booth(S, T, G, M, ps, L, key, x0, x1, z, st, scene);
    if (style === 'cool') for (let xx = x0 + 3; xx < x1 - 1; xx += 4) {
      S.cyl(M.panelDark, 0.95, 0.5, xx, st.h, z, 18);
      const fan = new THREE.Mesh(GEO.fan, M.steel);
      const fan2 = fan.clone(); fan2.rotation.y = Math.PI / 2; fan.add(fan2);
      fan.position.set(xx, st.h + 0.56, z); root.add(fan); instancer.adopt(fan); ps.coolFans.push(fan);
      S.cyl(M.meshGuard, 0.98, 0.04, xx, st.h + 0.62, z, 18);
    }
    L(d.label.toUpperCase(), (x0 + x1) / 2, st.h + 2.4, z, style === 'oven' ? 'eq hot' : 'eq', 235);
    addPick(eq, N[key], (x0 + x1) / 2, st.h / 2, z, x1 - x0, st.h, st.w);
    lamp(eq, root, N[key], x1 - 0.6, st.h + 0.2, z + st.w / 2 - 0.4);
  }
  S.beam(M.insulated, [80, H - 2.6, -50], [80, H - 2.6, -66], 1.0, 1.0);

  // ---------------- manual touch-up booths
  for (const key of ['PTOUCH', 'TTOUCH']) touchUp(S, T, G, M, ps, eq, root, L, key);
  // ---------------- inspection, repair, load and drop
  inspection(S, G, M, ps, eq, root, L);
  repair(S, T, M, ps, eq, root, L);
  loadDrop(S, M, ps, eq, root, L);
  // door kit staging racks and the coated-door buffer: A-frame carts
  for (const key of ['DOORKIT', 'DOORBUF']) for (const [x, z] of NODES[N[key]].slots) {
    S.box(M.darkSteel, 4.6, 0.12, 2.2, x, 0.3, z);
    for (const sx of [-2.2, 2.2]) for (const sz of [-0.9, 0.9]) S.beam(M.steel, [x + sx, 0.35, z + sz], [x + sx, 2.6, z], 0.08, 0.08);
    S.beam(M.steel, [x - 2.2, 2.6, z], [x + 2.2, 2.6, z], 0.08, 0.08);
  }
  L('DOOR & PANEL KITS', -112, 4.4, -74, 'eq', 200);
  L('COATED DOORS', -99, 4.2, 19, 'eq', 200);

  // ---------------- empty carriers circulating back to Load & Hang
  const cm = { trolley: M.conveyorBlue, bar: M.steel };
  ps.makeEmpty = () => {
    const g = new THREE.Group();
    GEO.bar ??= new THREE.BoxGeometry(PACK.L * 0.86, 0.16, 0.3);
    const tr = new THREE.Mesh(GEO.trolley, cm.trolley); tr.position.y = 0.1;
    const hook = new THREE.Mesh(GEO.hook, M.darkSteel); hook.position.y = -0.45;
    const bar = new THREE.Mesh(GEO.bar, cm.bar); bar.position.y = -0.9;
    for (const x of [-3.2, 3.2]) { const hk = new THREE.Mesh(GEO.hanger, M.darkSteel); hk.position.set(x, -1.18, 0); g.add(hk); }
    g.add(tr, hook, bar);
    root.add(g);
    instancer.adopt(g);
    return { g, d: 0 };
  };

  S.build(root);
  T.build(root, { cast: false, receive: false });
  G.build(root, { cast: false, receive: false });
  ps.update = (s, dt, simDt, live, statusOf) => updatePaintShop(ps, s, dt, simDt, live, statusOf, stage);
  return ps;
}

// ---------------- generic cut-away enclosure (near wall knee-high + clear panels)
function shell(S, T, M, x0, x1, z, st) {
  const len = x1 - x0, x = (x0 + x1) / 2, w = st.w, h = st.h, fz = z - w / 2, nz = z + w / 2;
  S.box(M[st.wall], len, h, 0.14, x, h / 2, fz);
  S.box(M[st.wall], len, 1.3, 0.14, x, 0.65, nz);
  T.box(M.polyNear, len, h - 1.3, 0.03, x, 1.3 + (h - 1.3) / 2, nz);
  T.box(M.polyNear, len, 0.04, w, x, h, z);
  const n = Math.max(1, Math.round(len / 4));
  for (let k = 0; k <= n; k++) {
    const xx = x0 + k * len / n;
    S.box(M.steel, 0.08, h, 0.1, xx, h / 2, nz);
    S.box(M.steel, 0.08, 0.1, w, xx, h, z);
  }
  S.box(M.steel, len, 0.16, 0.16, x, h, fz); S.box(M.steel, len, 0.12, 0.12, x, h, nz); S.box(M.steel, len, 0.1, 0.12, x, 1.3, nz);
  for (const ex of [x0, x1]) {
    S.box(M[st.wall], 0.14, h, (w - 2.4) / 2, ex, h / 2, fz + (w - 2.4) / 4);
    S.box(M[st.wall], 0.14, h, (w - 2.4) / 2, ex, h / 2, nz - (w - 2.4) / 4);
    S.box(M[st.wall], 0.14, h - 4.4, 2.4, ex, 4.4 + (h - 4.4) / 2, z);
  }
  S.box(M[st.strip], len, 0.22, 0.02, x, h - 0.5, fz + 0.08);
}

// ---------------- pretreatment: five spray stages with risers, tanks, pumps and an exhaust
function washTunnel(S, G, M, ps, L, x0, x1, z, st) {
  const sl = (x1 - x0) / 5, w = st.w, h = st.h;
  for (let k = 0; k < 5; k++) {
    const sx = x0 + k * sl, stage = { x0: sx, x1: sx + sl, nozzles: [], heated: k === 0 || k === 2 };
    for (let r = 0; r < 3; r++) {
      const xx = sx + 1.4 + r * (sl - 2.8) / 2;
      for (const s of [-1, 1]) {
        S.rod(M.ss, [xx, 0.6, z + s * 1.7], [xx, 4.0, z + s * 1.7], 0.06, 8);
        for (const y of [1.7, 2.3, 2.9, 3.5]) { S.box(M.darkSteel, 0.08, 0.08, 0.12, xx, y, z + s * 1.62); stage.nozzles.push([xx, y, z + s * 1.58, -s, 0]); }
      }
      S.rod(M.ss, [xx, 4.0, z - 1.7], [xx, 4.0, z + 1.7], 0.06, 8);
      for (const dz of [-0.8, 0, 0.8]) stage.nozzles.push([xx, 3.92, z + dz, 0, -1]);
    }
    S.box(M.rubber, 0.04, h - 1.4, 0.9, sx, (h - 1.4) / 2 + 1.4, z - 1.95);
    S.box(M.rubber, 0.04, h - 1.4, 0.9, sx, (h - 1.4) / 2 + 1.4, z + 1.95);
    // drain pan, process tank, pump and riser feed
    S.box(M.darkSteel, sl - 0.4, 0.3, w - 0.6, sx + sl / 2, 0.15, z);
    S.box(M.ss, sl - 1.4, 2.0, 2.6, sx + sl / 2, 1.0, z - w / 2 - 1.8);
    G.box(stage.heated ? M.ovenStrip : M.washStrip, 0.6, 1.2, 0.02, sx + sl / 2 + 1.6, 1.0, z - w / 2 - 0.48);
    S.cyl(M.conveyorBlue, 0.32, 0.7, sx + 1.3, 0, z - w / 2 - 3.6, 12);
    S.box(M.darkSteel, 0.5, 0.3, 0.7, sx + 1.3, 0.15, z - w / 2 - 3.6);
    S.rod(M.ss, [sx + 1.3, 0.6, z - w / 2 - 3.6], [sx + 1.3, 0.6, z - w / 2 - 0.2], 0.07, 8);
    S.rod(M.ss, [sx + 1.3, 0.6, z - w / 2 - 0.2], [sx + 1.3, 4.3, z - w / 2 - 0.2], 0.07, 8);
    S.rod(M.ss, [sx + 1, 4.3, z - w / 2 - 0.2], [sx + sl - 1, 4.3, z - w / 2 - 0.2], 0.07, 8);
    L(WASH_STAGES[k], sx + sl / 2, 0.35, z + w / 2 + 0.9, 'sub', 70);
    ps.wash.stages.push(stage);
  }
  for (let xx = x0 + 6; xx < x1; xx += 14) {
    S.rod(M.ss, [xx, h, z - 0.8], [xx, h + 4.2, z - 0.8], 0.42, 14);
    ps.wash.stacks.push([xx, h + 4.3, z - 0.8]);
  }
}

// ---------------- ovens: burner boxes, recirculation fans, ducts, stacks, temperature readout
function oven(S, G, M, ps, L, key, x0, x1, z, st, root) {
  const w = st.w, h = st.h, len = x1 - x0;
  const o = { key, x0, x1, z, h, fans: [], stacks: [], temp: OVEN_TEMP[key] };
  for (let xx = x0 + 4; xx < x1 - 2; xx += 10) {
    S.box(M.insulated, 2.4, 1.6, 2.6, xx, h + 0.8, z - 0.6);
    S.box(M.darkSteel, 1.2, 0.9, 1.0, xx + 1.9, h + 0.45, z - 0.8);
    S.rod(M.steel, [xx - 0.6, h + 1.6, z - 1], [xx - 0.6, h + 5.4, z - 1], 0.36, 14);
    o.stacks.push([xx - 0.6, h + 5.5, z - 1]);
    // burner sight glass and flame
    const fl = new THREE.Mesh(GEO.flame, ps.flame);
    fl.position.set(xx - 0.4, h + 0.9, z + 0.72); root.add(fl); instancer.adopt(fl);
    // recirculation fan on the roof
    S.cyl(M.panelDark, 0.75, 0.5, xx + 4.5, h, z + 0.6, 16);
    const fan = new THREE.Mesh(GEO.ovenFan, M.steel);
    const f2 = fan.clone(); f2.rotation.y = Math.PI / 2; fan.add(f2);
    fan.position.set(xx + 4.5, h + 0.56, z + 0.6); root.add(fan); instancer.adopt(fan); o.fans.push(fan);
  }
  S.beam(M.insulated, [x0 + 1, h + 1.9, z - 1.8], [x1 - 1, h + 1.9, z - 1.8], 0.9, 0.9);
  S.box(M.panelDark, len - 0.4, 0.04, w - 0.6, (x0 + x1) / 2, 0.02, z);
  for (let xx = x0 + 1; xx < x1 - 0.5; xx += 2) G.box(M.ovenFloor, 1.4, 0.02, 0.35, xx, 0.05, z - w / 2 + 0.5);
  G.box(M.ovenGlow, len - 0.6, 0.1, 0.05, (x0 + x1) / 2, 0.45, z - w / 2 + 0.12);
  // air seals at both openings
  for (const ex of [x0, x1]) S.box(M.panelDark, 0.6, 0.5, 2.6, ex, 4.65, z);
  o.label = L(`${o.temp} °C`, x1 - 1.5, h + 0.9, z + w / 2, 'chip hot', 200);
  ps.ovens.push(o);
}

// ---------------- automatic powder booth
function booth(S, T, G, M, ps, L, key, x0, x1, z, st, scene) {
  const d = NODES[N[key]], gx = d.gunX, w = st.w, h = st.h, x = (x0 + x1) / 2;
  const b = { key, gx, z, recips: [], color: POWDER[d.booth], spray: 0, phase: Math.random() * 6 };
  // ceiling light panels and the extraction floor
  for (const s of [-1, 1]) G.box(M.lampWhite, x1 - x0 - 1, 0.06, 0.24, x, h - 0.16, z + s * 1.5);
  S.box(M.panelDark, x1 - x0 - 0.4, 0.06, w - 0.4, x, 0.03, z);
  for (let xx = x0 + 0.8; xx < x1 - 0.5; xx += 0.8) S.box(M.steel, 0.05, 0.08, w - 0.6, xx, 0.07, z);
  // two reciprocators per side on the gun line
  for (const s of [-1, 1]) for (const dx of [-1.15, 1.15]) {
    const tx = gx + dx, tz = z + s * 2.3;
    S.box(M.panelGrey, 0.42, 4.8, 0.42, tx, 2.4, tz);
    S.box(M.darkSteel, 0.5, 0.3, 0.5, tx, 4.95, tz);
    S.box(M.darkSteel, 0.7, 0.12, 0.7, tx, 0.06, tz);
    const car = new THREE.Group();
    const cb = new THREE.Mesh(GEO.carBody, M.panel); car.add(cb);
    const bar = new THREE.Mesh(GEO.gunBar, M.steel); bar.position.z = -s * 0.25; car.add(bar);
    const tips = [];
    for (const gy of [-0.6, -0.2, 0.2, 0.6]) {
      const gun = new THREE.Mesh(GEO.gun, M.darkSteel);
      gun.rotation.x = Math.PI / 2; gun.position.set(0, gy, -s * 0.55); car.add(gun);
      const nz = new THREE.Mesh(GEO.nozzle, M.ss);
      nz.rotation.x = s > 0 ? -Math.PI / 2 : Math.PI / 2; nz.position.set(0, gy, -s * 0.87); car.add(nz);
      tips.push(gy);
    }
    car.position.set(tx, PART_MID, tz);
    scene.add(car);
    instancer.adopt(car);
    b.recips.push({ car, s, x: tx, tips, tipZ: tz - s * 0.93 });
  }
  // gun control cabinet with screens, powder feed centre with hoppers and hoses to the towers
  S.box(M.panel, 1.4, 2.1, 0.7, x0 - 1.6, 1.05, z + w / 2 - 0.2);
  G.box(ps.screen, 1.0, 0.5, 0.02, x0 - 1.6, 1.6, z + w / 2 + 0.16);
  S.box(M.panel, 2.0, 1.2, 1.4, x1 + 1.6, 0.6, z + w / 2 - 0.6);
  for (const hx of [-0.45, 0.45]) { S.cyl(M.ss, 0.36, 0.9, x1 + 1.6 + hx, 1.2, z + w / 2 - 0.6, 14); }
  for (const s of [-1, 1]) {
    const pts = [new THREE.Vector3(x1 + 1.2, 1.4, z + w / 2 - 0.6), new THREE.Vector3(x1 - 1, 5.6, z + s * 1.6), new THREE.Vector3(gx + 1.15, 5.2, z + s * 2.3)];
    S.add(M.rubber, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.05, 6), {});
  }
  // cartridge filter module, cyclone and exhaust duct on the extraction (north) side
  S.box(M.panelDark, x1 - x0 - 2, 3.8, 2.4, x, 1.9, z - w / 2 - 1.5);
  for (let xx = x0 + 2; xx < x1 - 1.5; xx += 2.2) S.cyl(M.ss, 0.32, 0.8, xx, 3.8, z - w / 2 - 1.5, 12);
  S.cyl(M.ss, 0.8, 4.4, x1 + 1.6, 1.6, z - w / 2 - 1.6, 18);
  S.add(M.ss, new THREE.ConeGeometry(0.8, 1.6, 18), { x: x1 + 1.6, y: 0.8, z: z - w / 2 - 1.6, rx: Math.PI });
  S.rod(M.ss, [x1 + 1.6, 6.2, z - w / 2 - 1.6], [x, 6.2, z - w / 2 - 1.6], 0.4, 12);
  // the powder cloud inside the booth and the booth light
  b.cloudMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(...b.color), transparent: true, opacity: 0, depthWrite: false });
  const cloud = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 - 0.6, h - 0.4, w - 0.5), b.cloudMat);
  cloud.position.set(x, (h - 0.4) / 2, z); cloud.renderOrder = 5; scene.add(cloud);
  b.light = new THREE.PointLight(0xf4f8ff, 0, 14, 2); b.light.position.set(gx, 4.6, z + 0.5); scene.add(b.light);
  b.chip = L('GUNS IDLE', gx, h + 0.95, z + w / 2, 'chip', 200);
  ps.booths[key] = b;
}

// ---------------- manual touch-up booth with two painters on platforms either side
function touchUp(S, T, G, M, ps, eq, root, L, key) {
  const d = NODES[N[key]], [x, z] = d.pos;
  for (const s of [-1, 1]) {
    for (const y of [1.2, 2.6]) {
      S.box(M.darkSteel, 10, 0.08, 1.4, x, y, z + s * 2.0);
      S.box(M.safety, 10, 0.05, 0.05, x, y + 1.05, z + s * 2.7);
      S.box(M.safety, 10, 0.05, 0.05, x, y + 0.55, z + s * 2.7);
    }
    for (const k of [-1, 1]) S.box(M.safety, 0.08, 3.7, 0.08, x + k * 4.8, 1.85, z + s * 2.7);
    S.beam(M.safety, [x - 6.4, 0, z + s * 2.0], [x - 4.9, 2.6, z + s * 2.0], 0.9, 0.06);
  }
  // back filter wall (extraction), canopy and lights
  S.box(M.panelDark, 11, 5.2, 0.4, x, 2.6, z - 3.3);
  for (let xx = x - 4.8; xx <= x + 4.8; xx += 1.2) S.box(M.panelGrey, 1.0, 4.4, 0.05, xx, 2.6, z - 3.08);
  S.box(M.panel, 11.4, 0.16, 6.8, x, 5.6, z);
  T.box(M.poly, 0.03, 4.4, 6.6, x - 5.6, 3.4, z); T.box(M.poly, 0.03, 4.4, 6.6, x + 5.6, 3.4, z);
  for (const s of [-1, 1]) G.box(M.lampWhite, 9.6, 0.06, 0.24, x, 5.5, z + s * 1.6);
  // painters: north side on the lower deck, south side on the upper deck
  const spots = [{ s: -1, y: 1.24, dx: -2, aim: -0.12 }, { s: 1, y: 2.64, dx: 2, aim: -0.62 }];
  for (const sp of spots) {
    const p = createPerson('painter');
    p.root.position.set(x + sp.dx, sp.y, z + sp.s * 1.6);
    p.root.rotation.y = sp.s < 0 ? 0 : Math.PI;
    root.add(p.root);
    ps.painters.push({ p, n: N[key], x0: x + sp.dx, z, aim: sp.aim, phase: Math.random() * 6, coat: key === 'PTOUCH' ? 'primer' : 'topcoat' });
  }
  L(d.label.toUpperCase(), x, 6.8, z, 'eq', 170);
  addPick(eq, N[key], x, 2.6, z, 11, 5.4, 6.8);
  lamp(eq, root, N[key], x + 5.6, 5.9, z + 3);
  floorStencil(eq, root, N[key], x - 5.4, z + 3.6);
}

// ---------------- inspection arch with an inspector and a live film-thickness readout
function inspection(S, G, M, ps, eq, root, L) {
  const [x, z] = NODES[N.INSP].pos;
  for (const s of [-1, 1]) { S.box(M.panel, 0.4, 4.8, 0.4, x - 2.2, 2.4, z + s * 2.3); S.box(M.panel, 0.4, 4.8, 0.4, x + 2.2, 2.4, z + s * 2.3); }
  S.box(M.panel, 4.8, 0.4, 5.0, x, 4.9, z);
  for (const s of [-1, 1]) G.box(M.lampWhite, 4.0, 0.06, 0.2, x, 4.68, z + s * 1.6);
  for (const s of [-1, 1]) G.box(M.lampWhite, 0.08, 3.4, 0.2, x + s * 2.0, 2.6, z + s * 2.1);
  S.box(M.darkSteel, 0.8, 1.0, 0.5, x + 3.2, 0.5, z + 2.6);
  G.box(ps.screen, 0.6, 0.4, 0.02, x + 3.2, 1.1, z + 2.86);
  const p = createPerson('inspector');
  p.root.position.set(x + 1.2, 0, z + 1.75); p.root.rotation.y = Math.PI;
  root.add(p.root);
  ps.inspector = { p, phase: 0 };
  ps.inspLabel = L('', x, 6.2, z + 2.4, 'readout', 120);
  L('INSPECTION', x, 7.4, z, 'eq', 170);
  addPick(eq, N.INSP, x, 2.5, z, 5, 5, 5);
  lamp(eq, root, N.INSP, x + 2.6, 5.4, z + 2.6);
  floorStencil(eq, root, N.INSP, x - 2.6, z + 3.2, 0.7);
}

function repair(S, T, M, ps, eq, root, L) {
  const [x, z] = NODES[N.REPAIR].pos;      // on the spur, parts hang along z here
  for (const s of [-1, 1]) {
    S.box(M.darkSteel, 1.4, 0.08, 10, x + s * 2.0, 1.2, z);
    S.box(M.safety, 0.05, 0.05, 10, x + s * 2.7, 2.25, z);
    for (const k of [-1, 1]) S.box(M.safety, 0.08, 2.3, 0.08, x + s * 2.7, 1.15, z + k * 4.8);
  }
  S.box(M.panelDark, 0.4, 4.6, 11, x - 3.3, 2.3, z);
  S.box(M.panel, 6.8, 0.16, 11.4, x, 5.2, z);
  const p = createPerson('painter');
  p.root.position.set(x + 1.6, 1.24, z); p.root.rotation.y = -Math.PI / 2;
  root.add(p.root);
  ps.repairer = { p, phase: 0, x0: z };
  L('PAINT REPAIR', x, 6.4, z, 'eq', 170);
  addPick(eq, N.REPAIR, x, 2.5, z, 6.6, 5, 11);
  lamp(eq, root, N.REPAIR, x + 2.8, 5.6, z + 5.5);
  floorStencil(eq, root, N.REPAIR, x + 3.6, z - 3, 0.7);
}

function loadDrop(S, M, ps, eq, root, L) {
  for (const key of ['LOAD', 'DROP']) {
    const d = NODES[N[key]], [x, z] = d.pos, along = key === 'DROP' ? 'z' : 'x';
    const lx = along === 'x' ? 10 : 2.4, lz = along === 'x' ? 2.4 : 10;
    // scissor lift table
    S.box(M.darkSteel, lx, 0.25, lz, x, 0.12, z);
    S.box(M.safety, lx, 0.08, lz, x, 0.3, z);
    for (const s of [-1, 1]) {
      const a = along === 'x' ? [x - lx * 0.4, 0.2, z + s * 0.9] : [x + s * 0.9, 0.2, z - lz * 0.4];
      const b = along === 'x' ? [x + lx * 0.4, 0.2, z + s * 0.9] : [x + s * 0.9, 0.2, z + lz * 0.4];
      S.beam(M.hazard, a, b, 0.12, 0.08);
    }
    const crew = key === 'LOAD' ? [[-2.5, 2.4], [2.5, 2.4]] : [[2.4, 2.5]];
    for (const [ox, oz] of crew) {
      const p = createPerson('worker');
      const px = along === 'x' ? x + ox : x + oz, pz = along === 'x' ? z + oz : z + ox;
      p.root.position.set(px, 0, pz);
      p.root.rotation.y = along === 'x' ? Math.PI : -Math.PI / 2;
      root.add(p.root);
      ps.workers.push({ p, n: N[key], phase: Math.random() * 6 });
    }
    L(d.label.toUpperCase(), x, 6.4, z, 'eq', 170);
    addPick(eq, N[key], x, 2.5, z, Math.max(lx, 4), 5, Math.max(lz, 4));
    lamp(eq, root, N[key], x + (along === 'x' ? lx / 2 : 1.4), 4.6, z + (along === 'x' ? 2.6 : lz / 2));
    floorStencil(eq, root, N[key], x - (along === 'x' ? lx / 2 : 1.6), z + (along === 'x' ? 3.6 : lz / 2 + 1.4));
  }
}

// ================================================================== per-frame
const _v = new THREE.Vector3(), _d = new THREE.Vector3();
function updatePaintShop(ps, s, dt, simDt, live, statusOf, stage) {
  ps.t += dt;
  const fx = ps.fx, run = dt > 0 && simDt > 0;
  const byNode = new Map();
  for (const e of live) { if (!byNode.has(e.n)) byNode.set(e.n, []); byNode.get(e.n).push(e); }
  const at = (key) => byNode.get(N[key]) || [];

  // ---- automatic booths: guns fire while a part is in front of them
  for (const b of Object.values(ps.booths)) {
    const down = s.nodes[N[b.key]].down;
    const part = !down && at(b.key).find(e => Math.abs(e.u.at.x - b.gx) < PACK.L / 2 + 0.4);
    const on = run && !!part;
    b.spray += ((on ? 1 : 0) - b.spray) * Math.min(1, dt * 3);
    b.phase += dt * (on ? 2.6 : 0.4);
    for (const r of b.recips) {
      r.car.position.y = PART_MID + Math.sin(b.phase + (r.s > 0 ? 0 : 1.3)) * 0.62;
      if (!on) continue;
      for (const gy of r.tips) {
        const n = Math.floor(dt * 70 + Math.random());
        for (let k = 0; k < n; k++) {
          const tx = r.x + rand(-0.05, 0.05), ty = r.car.position.y + gy, tz = r.tipZ;
          if (Math.random() < 0.7) {
            // electrostatic wrap: a cone from the gun, pulled onto the part, landing on its face
            fx.emit(tx, ty, tz, rand(-0.9, 0.9), rand(-0.6, 0.6), -r.s * rand(3, 4.6),
              { life: rand(0.4, 0.7), size: rand(0.22, 0.4), grow: 1.2, color: b.color, alpha: 0.75, drag: 2.2,
                att: [tx + rand(-1, 1), ty + rand(-0.5, 0.5), b.z, 8], killZ: b.z, killR: 0.14 });
          } else {
            // overspray drawn down and back to the cartridge wall
            fx.emit(tx, ty, tz, rand(-1.2, 1.2), rand(-0.3, 0.6), -r.s * rand(1.6, 3),
              { life: rand(1.4, 2.4), size: rand(0.5, 0.9), grow: 1.8, color: b.color, alpha: 0.24, drag: 1.4, acc: [0, -0.45, -1.4] });
          }
        }
      }
    }
    // powder haze lingering in the booth while the guns run
    if (on) {
      const nh = Math.floor(dt * 26 + Math.random());
      for (let k = 0; k < nh; k++) fx.emit(b.gx + rand(-4.5, 4.5), rand(0.6, 4.6), b.z + rand(-2.2, 2.2), rand(-0.2, 0.2), rand(-0.1, 0.1), rand(-0.5, -0.1),
        { life: rand(2.5, 3.6), size: rand(1.3, 2.0), grow: 0.8, color: b.color, alpha: 0.07 });
    }
    b.cloudMat.opacity = b.spray * 0.06;
    b.light.intensity = 6 + b.spray * 18;
    b.state = down ? 'down' : on ? 'on' : 'idle';
  }

  // ---- pretreatment: stages spray while a part is in them; drips after the tunnel
  for (const st of ps.wash.stages) {
    const mid = (st.x0 + st.x1) / 2;
    const busy = run && at('PRE').some(e => Math.abs(e.u.at.x - mid) < (st.x1 - st.x0) / 2 + PACK.L / 2 - 1);
    if (!busy) continue;
    for (const [x, y, z, dz, dy] of st.nozzles) {
      const n = Math.floor(dt * 12 + Math.random());
      for (let k = 0; k < n; k++) {
        fx.emit(x, y, z, rand(-0.5, 0.5), dy ? -rand(3.5, 5) : rand(-0.4, 0.6), dz * rand(3.5, 5.5),
          { life: rand(0.28, 0.45), size: rand(0.1, 0.16), grow: 0.6, color: [0.62, 0.82, 0.96], alpha: 0.75, acc: [0, -9.8, 0], drag: 0.6 });
      }
    }
    if (Math.random() < dt * (st.heated ? 6 : 3)) {
      fx.emit(rand(st.x0, st.x1), rand(1, 3.5), -66 + rand(-1.4, 1.4), 0, rand(0.2, 0.5), 0,
        { life: rand(2, 3.2), size: rand(1.4, 2.2), grow: 1.4, color: [0.86, 0.93, 0.98], alpha: 0.11 });
    }
  }
  for (const e of at('DRY')) {
    if (!run || e.pl.p > 0.25) continue;
    if (Math.random() < dt * 14) {
      const lx = rand(-PACK.L / 2, PACK.L / 2);
      fx.emit(e.u.at.x + lx, HANG_Y + 0.02, e.u.at.z + rand(-0.8, 0.8), 0, -0.5, 0, { life: 0.5, size: 0.06, color: [0.75, 0.88, 0.96], alpha: 0.7, acc: [0, -9.8, 0] });
    }
  }
  for (const [x, y, z] of ps.wash.stacks) if (run && Math.random() < dt * 2.5)
    fx.emit(x + rand(-0.2, 0.2), y, z + rand(-0.2, 0.2), rand(-0.1, 0.1), rand(0.8, 1.4), rand(-0.1, 0.1), { life: rand(3, 4.5), size: rand(0.8, 1.2), grow: 2.6, color: [0.95, 0.96, 0.98], alpha: 0.12, drag: 0.3, acc: [0.15, 0, 0.05] });

  // ---- ovens: burner flicker, fans, stack vapour, haze at the openings, temperature readout
  ps.flame.emissiveIntensity = 2.0 + Math.sin(ps.t * 23) * 0.3 + Math.random() * 0.5;
  for (const o of ps.ovens) {
    for (const f of o.fans) f.rotation.y += dt * 9;
    for (const [x, y, z] of o.stacks) if (run && Math.random() < dt * 1.6)
      fx.emit(x + rand(-0.15, 0.15), y, z, rand(-0.1, 0.1), rand(1, 1.6), 0, { life: rand(2.5, 4), size: rand(0.7, 1.1), grow: 2.8, color: [0.93, 0.93, 0.95], alpha: 0.1, drag: 0.3, acc: [0.2, 0, 0.05] });
    for (const ex of [o.x0, o.x1]) if (Math.random() < dt * 2.2)
      fx.emit(ex + rand(-0.3, 0.3), rand(2.2, 4), o.z + rand(-1, 1), (ex === o.x0 ? -1 : 1) * rand(0.1, 0.3), rand(0.4, 0.7), 0,
        { life: rand(1.4, 2.2), size: rand(0.9, 1.3), grow: 1, color: [1, 0.72, 0.45], alpha: 0.05 });
  }
  for (const f of ps.coolFans) f.rotation.y += dt * 11;

  // ---- touch-up painters spray while their station is working on a part
  for (const pt of ps.painters) {
    const e = (byNode.get(pt.n) || [])[0];
    const working = run && e && e.pl.mf >= 1 && statusOf(pt.n) === 'busy';
    pt.phase += dt * (working ? 2.2 : 0.6);
    if (working) {
      pt.p.root.position.x = pt.x0 + Math.sin(pt.phase * 0.18) * 2.4;
      poseSpray(pt.p, pt.phase, pt.aim, 1);
      pt.p.tip.getWorldPosition(_v);
      pt.p.tip.getWorldDirection(_d);
      const color = POWDER[pt.coat];
      const n = Math.floor(dt * 70 + Math.random());
      for (let k = 0; k < n; k++) {
        const sp = rand(3, 4.5);
        fx.emit(_v.x, _v.y, _v.z, _d.x * sp + rand(-0.5, 0.5), _d.y * sp + rand(-0.4, 0.4), _d.z * sp + rand(-0.4, 0.4),
          { life: rand(0.3, 0.55), size: rand(0.1, 0.2), grow: 1, color, alpha: 0.45, drag: 2,
            att: [_v.x + _d.x * 1.4, _v.y + _d.y * 1.4, pt.z, 6], killZ: pt.z, killR: 0.1 });
      }
      if (Math.random() < dt * 8) fx.emit(_v.x, _v.y, _v.z, _d.x, 0.2, _d.z, { life: 1.6, size: 0.5, grow: 1.5, color, alpha: 0.12, drag: 1, acc: [0, -0.2, -1.2] });
    } else { rest(pt.p); pt.p.root.position.x += (pt.x0 - pt.p.root.position.x) * Math.min(1, dt); }
  }
  // ---- repair: sand the defect, then blow it in with a hand gun
  if (ps.repairer) {
    const e = (byNode.get(N.REPAIR) || [])[0], r = ps.repairer;
    const working = run && e && e.pl.mf >= 1 && statusOf(N.REPAIR) === 'busy';
    r.phase += dt * (working ? 2 : 0.5);
    if (!working) rest(r.p);
    else if (e.pl.p < 0.55) poseSand(r.p, r.phase);
    else {
      poseSpray(r.p, r.phase, -0.1, 0.6);
      r.p.tip.getWorldPosition(_v); r.p.tip.getWorldDirection(_d);
      const n = Math.floor(dt * 40 + Math.random());
      for (let k = 0; k < n; k++) fx.emit(_v.x, _v.y, _v.z, _d.x * 3.5 + rand(-0.4, 0.4), _d.y * 3.5 + rand(-0.3, 0.3), _d.z * 3.5 + rand(-0.4, 0.4),
        { life: 0.4, size: 0.14, grow: 1, color: POWDER.topcoat, alpha: 0.4, drag: 2, att: [_v.x + _d.x * 1.3, _v.y, _v.z + _d.z * 1.3, 5], killZ: NaN });
    }
    if (working) r.p.root.position.z = r.x0 + Math.sin(r.phase * 0.2) * 2;
  }
  // ---- load, drop and inspection crew
  for (const w of ps.workers) {
    const e = (byNode.get(w.n) || [])[0];
    const working = e && e.pl.mf >= 1 && statusOf(w.n) === 'busy';
    w.phase += dt * (working ? 1.8 : 0.4);
    if (working) poseReach(w.p, w.phase); else rest(w.p);
  }
  if (ps.inspector) {
    const e = (byNode.get(N.INSP) || [])[0], ins = ps.inspector;
    const working = e && e.pl.mf >= 1 && statusOf(N.INSP) === 'busy';
    ins.phase += dt * (working ? 1.6 : 0.4);
    if (working) poseInspect(ins.p, ins.phase); else rest(ins.p);
  }

  // ---- empty carriers on the return: one per carrier not holding a part
  const empties = Math.max(0, s.p.carriers - paintWip(s));
  while (ps.empties.length < empties) { const c = ps.makeEmpty(); c.d = 0; ps.empties.push(c); }
  while (ps.empties.length > empties) { const c = ps.empties.shift(); ps.root.remove(c.g); instancer.release(c.g); }
  ps.empties.forEach((c, i) => {
    const target = RETURN_L - 3 - i * 3.2;
    const step = Math.min(Math.abs(target - c.d), dt * 12 + simDt * 18);
    c.d += Math.sign(target - c.d) * step;
    const [x, z, r] = pointAt(RETURN, c.d);
    c.g.position.set(x, RAIL_Y - 0.25, z);
    c.g.rotation.y = r;
  });

  fx.update(dt, stage.renderer.domElement.clientHeight || innerHeight);

  // ---- live readouts (a few times a second)
  ps.labelT -= dt;
  if (ps.labelT > 0) return;
  ps.labelT = 0.3;
  for (const b of Object.values(ps.booths)) {
    b.chip.element.textContent = b.state === 'down' ? 'BOOTH DOWN · CLEANING' : b.state === 'on' ? 'GUNS ON · 16 × 80 kV' : 'GUNS IDLE';
    b.chip.element.className = 'lbl chip ' + (b.state === 'down' ? 'alarm' : b.state === 'on' ? 'live' : '');
  }
  for (const o of ps.ovens) o.label.element.textContent = `${(o.temp + Math.sin(ps.t * 0.7 + o.x0) * 1.2).toFixed(0)} °C`;
  const e = (byNode.get(N.INSP) || [])[0];
  const el = ps.inspLabel.element;
  if (e && e.pl.mf >= 1 && e.it.dft) {
    const v = e.pl.p > 0.65 ? (e.it.defect ? `<b class="bad">REJECT · ${e.it.reason}</b>` : '<b class="good">PASS</b>') : '<b>measuring…</b>';
    const d = e.it.dft, shown = (f, val) => e.pl.p > f ? val : '–';
    el.innerHTML = `<span>${e.it.name}</span><span>Primer ${shown(0.2, d.primer)} µm · Top ${shown(0.4, d.top)} µm · Gloss ${shown(0.55, d.gloss)} GU</span>${v}`;
    el.style.display = '';
  } else el.style.display = 'none';
}
