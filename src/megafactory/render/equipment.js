// Plant equipment outside the paint shop: Body in White weld cells (robots with weld sparks,
// rail stock, laser geometry arch), the battery module line (guarded robot cells, laser weld,
// potting gantry, light curtains), the pack line (station gantries, crews, lift-assist arms,
// roof hoist, coolant hose, end-of-line scanner, QA arch), the gantry crane runway and the truck
// bay. Also the shared per-node helpers (andon lamps, floor stencils, click targets).
import * as THREE from 'three';
import { Batch } from './batch.js';
import { materials, STATUS } from './materials.js';
import { stencilAtlas } from './textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Particles } from './particles.js';
import { createPerson, rest, poseReach, poseInspect } from './people.js';
import { instancer } from './instancer.js';
import { NODES, N, RACK, TRUCK_BAY } from '../plant.js';
import { createRobot, createLiftAssist, PACK } from '../../models.js';

const rand = (a, b) => a + Math.random() * (b - a);
const PACK_KEYS = ['CL', 'HV', 'MI', 'TH', 'EN', 'CF', 'EOL', 'QA'];

export function buildEquipment(stage) {
  const M = materials();
  const scene = stage.scene;
  const root = new THREE.Group();
  root.name = 'equipment';
  scene.add(root);
  const S = new Batch(), T = new Batch(), G = new Batch();
  const out = { root, lamps: new Map(), lampDefs: [], picks: [], stencils: new Map(), stencilDefs: [], robots: [], crews: [], assists: [],
                sparks: new Particles(scene, 4000, { additive: true }), t: 0 };
  const L = (text, x, y, z, cls, far) => stage.label(text, x, y, z, cls, { far });
  const red = new THREE.MeshStandardMaterial({ color: 0, emissive: 0xff2a2a, emissiveIntensity: 2.6 });
  const cyan = new THREE.MeshStandardMaterial({ color: 0, emissive: 0x39c6ff, emissiveIntensity: 2.2 });
  const person = (kind, x, y, z, ry, n, pose) => {
    const p = createPerson(kind);
    p.root.position.set(x, y, z); p.root.rotation.y = ry;
    root.add(p.root);
    out.crews.push({ p, n, pose, phase: Math.random() * 6 });
    return p;
  };

  // ================= Body in White
  for (const key of ['BIW1', 'BIW2', 'BIW3', 'BIW4']) {
    const d = NODES[N[key]], [x, z] = d.pos;
    S.box(M.weldRed, 10, 0.7, 2.4, x, 0.35, z);
    for (const sx of [-4.6, 0, 4.6]) S.box(M.weldRed, 0.5, 1.1, 2.8, x + sx, 0.55, z);
    for (const sx of [-3.4, 3.4]) for (const sz of [-0.95, 0.95]) S.box(M.darkSteel, 0.25, 0.35, 0.25, x + sx, 0.88, z + sz);
    if (key === 'BIW4') {
      // laser geometry arch: two scanner heads sweep a red line along the frame
      for (const s of [-1, 1]) S.box(M.panel, 0.5, 4.6, 0.5, x + s * 5.6, 2.3, z);
      S.box(M.panel, 11.7, 0.5, 0.6, x, 4.6, z);
      for (const s of [-1, 1]) S.box(M.panelDark, 11.2, 0.3, 0.3, x, 4.2, z + s * 1.4);
      const laser = new THREE.Mesh(new THREE.BoxGeometry(0.03, 2.2, 2.0), red);
      laser.position.set(x, 1.95, z); root.add(laser);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 2.6), M.panelDark); head.position.set(x, 4.0, z); root.add(head);
      instancer.adopt(laser); instancer.adopt(head);
      out.laser = { laser, head, x, n: N[key] };
      S.box(M.panelDark, 0.9, 1.6, 0.6, x + 6.8, 0.8, z + 2.4); G.box(cyan, 0.7, 0.4, 0.02, x + 6.8, 1.3, z + 2.72);
      person('inspector', x + 6.8, 0, z + 3.4, Math.PI, N[key], 'inspect');
    } else {
      for (const s of [-1, 1]) {
        T.box(M.weldCurtain, 13, 2.8, 0.03, x, 1.6, z + s * 5.2);
        S.box(M.weldRed, 13, 0.08, 0.08, x, 3.0, z + s * 5.2);
        for (const k of [-6.5, 0, 6.5]) S.box(M.weldRed, 0.08, 3.0, 0.08, x + k, 1.5, z + s * 5.2);
        for (const rx of [-2.6, 2.6]) {
          const r = createRobot(0xf2c200, 1);
          r.root.position.set(x + rx, 0, z + s * 3.2);
          r.root.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
          r.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
          root.add(r.root);
          instancer.adopt(r.root);
          out.robots.push({ ...r, n: N[key], phase: rx + s, sparks: 'weld' });
        }
      }
      // weld controller cabinets and a loader at the cell door
      S.box(M.panel, 1.0, 2.0, 0.7, x - 6.0, 1.0, z + 6.1);
      G.box(cyan, 0.5, 0.3, 0.02, x - 6.0, 1.5, z + 6.47);
      person('worker', x - 7.6, 0, z + 6.4, Math.PI, N[key], 'idle');
    }
    L(d.label.toUpperCase(), x + 7.8, 5.2, z, 'eq', 150);
    addPick(out, N[key], x, 2, z, 13, 4, 10);
    lamp(out, root, N[key], x - 6.6, 3.2, z + 4.4);
    floorStencil(out, root, N[key], x + 6.4, z + 3.4, 0.7);
  }
  // roll-formed rail stock waiting at the start of the line
  for (let k = 0; k < 3; k++) {
    const zz = 10 + k * 3.2;
    S.box(M.darkSteel, 10, 0.25, 1.8, -114, 0.12, zz);
    for (let l = 0; l < 4; l++) for (let r = 0; r < 4; r++) S.box(M.steel, 9.4, 0.12, 0.1, -114, 0.32 + l * 0.14, zz - 0.6 + r * 0.4);
  }
  L('RAIL STOCK', -114, 3.2, 13, 'sub', 120);
  // outfeed transfer to Load & Hang
  for (const s of [-1, 1]) S.box(M.steel, 0.16, 0.5, 12.4, -114 + s * 3.6, 0.45, -56);
  for (let zz = -50; zz >= -62; zz -= 1.2) S.rod(M.alu, [-118, 0.72, zz], [-110, 0.72, zz], 0.06, 8);

  // ================= battery modules
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
    // light curtains at the cell entry and exit
    for (const ex of [x - 3.9, x + 3.9]) for (const s of [-1, 1]) {
      S.box(M.panelDark, 0.12, 2.0, 0.12, ex, 1.0, z + s * 1.3);
      G.box(red, 0.02, 1.7, 0.02, ex, 1.05, z + s * 1.24);
    }
    S.box(M.panel, 1.2, 1.8, 0.8, x - 3, 0.9, z - 2.6);
    G.box(cyan, 0.8, 0.45, 0.02, x - 3, 1.3, z - 2.18);
    G.box(M.lampWhite, 6.8, 0.05, 0.12, x, 2.6, z);
    S.box(M.alu, 7.6, 0.1, 0.1, x, 2.68, z - 0.4); S.box(M.alu, 7.6, 0.1, 0.1, x, 2.68, z + 0.4);
    if (key === 'M2' || key === 'M3' || key === 'M5') {
      const r = createRobot(0xf2c200, 0.55, key === 'M5' ? 0xc8102e : 0x24272c);
      r.root.position.set(x, 0.9, z - 2.0);
      r.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
      root.add(r.root);
      instancer.adopt(r.root);
      out.robots.push({ ...r, n: N[key], phase: x * 0.3, sparks: key === 'M3' ? 'laser' : null });
    }
    if (key === 'M4') {
      // potting gantry: a dispensing head runs over the tray
      for (const s of [-1, 1]) for (const t of [-1, 1]) S.box(M.alu, 0.12, 2.4, 0.12, x + s * 2.4, 1.2, z + t * 1.4);
      for (const s of [-1, 1]) S.box(M.alu, 4.9, 0.14, 0.14, x, 2.4, z + s * 1.4);
      const bridge = new THREE.Group();
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 3.0), M.alu); bridge.add(b);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.3), M.panelDark); head.position.y = -0.3; bridge.add(head);
      const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.25, 8), M.ss); nozzle.rotation.x = Math.PI; nozzle.position.y = -0.65; head.add(nozzle);
      bridge.position.set(x, 2.4, z); root.add(bridge); instancer.adopt(bridge);
      out.potting = { bridge, head, x, z, n: N[key] };
      S.box(M.panelGrey, 1.0, 1.6, 1.0, x + 3.2, 0.8, z - 2.6);
    }
    if (key === 'M1') {
      // cell totes waiting to be scanned
      for (let k = 0; k < 3; k++) for (let l = 0; l < 2; l++) S.box(M.conveyorBlue, 1.1, 0.5, 0.8, x + 2 - k * 1.2, 0.25 + l * 0.52, z + 5.2);
      person('worker', x + 1.5, 0, z + 4.3, Math.PI, N[key], 'reach');
    }
    if (key === 'M6') person('inspector', x + 2.6, 0, z + 4.4, Math.PI, N[key], 'inspect');
    L(d.label.toUpperCase(), x, 4.0, z, 'eq', 130);
    addPick(out, N[key], x, 1.2, z, 8, 2.4, 7.2);
    lamp(out, root, N[key], x + 3.8, 2.6, z + 3.4);
    floorStencil(out, root, N[key], x - 4, z + 5.2, 0.62);
  }
  // rack warehouse: two rack rows, 7 bays × 4 levels, served by a stacker crane in the aisle
  for (const rz of RACK.rows) {
    const x0 = RACK.x0 - RACK.dx / 2, x1 = RACK.x0 + (RACK.bays - 0.5) * RACK.dx;
    for (let b = 0; b <= RACK.bays; b++) for (const s of [-1, 1]) S.box(M.conveyorBlue, 0.1, RACK.levels * RACK.dy + 0.4, 0.1, x0 + b * RACK.dx, (RACK.levels * RACK.dy + 0.4) / 2, rz + s * 0.9);
    for (let l = 0; l < RACK.levels; l++) for (const s of [-1, 1]) S.box(M.hvOrange, x1 - x0, 0.12, 0.08, (x0 + x1) / 2, RACK.y0 + l * RACK.dy - 0.06, rz + s * 0.9);
  }
  L('MODULE RACKS · 56 TRAYS', -31, 7.2, -24, 'eq', 260);
  L('MODULE OUTFEED', -7, 2.6, -21, 'sub', 120);

  // ================= pack line
  for (const s of [-1, 1]) S.box(M.steel, 132, 0.2, 0.16, -26, 0.1, 8 + s * 0.55);
  for (let xx = -92; xx <= 42; xx += 2) S.box(M.darkSteel, 0.2, 0.06, 1.5, xx, 0.03, 8);
  out.packFx = {};
  for (const key of PACK_KEYS) {
    const d = NODES[N[key]], [x, z] = d.pos;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) S.box(M.column, 0.3, 6.6, 0.3, x + sx * 5.4, 3.3, z + sz * 4);
    for (const sz of [-1, 1]) S.box(M.column, 11.1, 0.4, 0.4, x, 6.6, z + sz * 4);
    S.box(M.panelDark, 4.8, 1.0, 0.1, x, 7.4, z + 4);
    G.box(M.lampWhite, 9.8, 0.06, 0.2, x, 6.36, z);
    for (const sz of [-1, 1]) { S.box(M.darkSteel, 7, 0.06, 0.9, x, 0.03, z + sz * 2.6); S.box(M.hazard, 7, 0.07, 0.12, x, 0.035, z + sz * 3.1); }
    // crew: one each side; inspectors at the test and QA stations
    const kind = key === 'EOL' || key === 'QA' ? 'inspector' : 'worker';
    const pose = key === 'EOL' || key === 'QA' || key === 'CF' ? 'inspect' : 'reach';
    person(kind, x - 1.8, 0, z - 2.5, 0, N[key], pose);
    person('worker', x + 1.8, 0, z + 2.5, Math.PI, N[key], key === 'QA' ? 'inspect' : pose);
    if (key === 'MI' || key === 'EN') for (const sz of [-1, 1]) {
      const a = createLiftAssist();
      a.root.position.set(x - 3.6, 0, z + sz * 3.4);
      a.root.rotation.y = sz > 0 ? Math.PI / 2 : -Math.PI / 2;
      a.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
      root.add(a.root);
      instancer.adopt(a.root);
      out.assists.push({ ...a, n: N[key], s: sz, phase: Math.random() * 3 });
    }
    if (key === 'TH') {
      // jib hoist that sets the thermal roof
      S.cyl(M.safety, 0.22, 7.6, x - 4.6, 0, z - 3.4, 12);
      S.beam(M.safety, [x - 4.6, 7.4, z - 3.4], [x + 1, 7.4, z], 0.3, 0.3);
      S.box(M.conveyorBlue, 0.6, 0.6, 0.6, x + 0.6, 7.0, z);
    }
    if (key === 'CF') {
      const hose = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1, 8).translate(0, -0.5, 0), M.rubber);
      hose.position.set(x + 2.2, 6.4, z + 0.4); root.add(hose); instancer.adopt(hose);
      S.box(M.conveyorBlue, 1.4, 1.8, 1.0, x + 4.4, 0.9, z - 3.0);
      G.box(cyan, 0.9, 0.4, 0.02, x + 4.4, 1.4, z - 2.48);
      out.packFx.hose = { hose, n: N[key] };
    }
    if (key === 'EOL') {
      S.box(M.panelDark, 1.4, 2.2, 0.8, x + 4.2, 1.1, z - 3);
      G.box(cyan, 1.0, 0.6, 0.02, x + 4.2, 1.6, z - 2.58);
      const scan = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 3.6), M.panelDark); scan.add(bar);
      for (const s of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.0, 0.2), M.panelDark); leg.position.set(0, -1.5, s * 1.7); scan.add(leg); }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.03, 2.6, 2.4), cyan); beam.position.y = -1.6; scan.add(beam);
      scan.position.set(x, 3.4, z); root.add(scan); instancer.adopt(scan);
      out.packFx.scan = { scan, x, n: N[key] };
    }
    if (key === 'QA') for (const s of [-1, 1]) { S.box(M.panel, 0.3, 4.4, 0.3, x + 3.4, 2.2, z + s * 2.0); G.box(M.lampWhite, 0.06, 3.6, 0.2, x + 3.25, 2.3, z + s * 1.86); }
    L(d.label.toUpperCase(), x, 8.6, z, 'eq', 150);
    addPick(out, N[key], x, 3, z, 11, 6.6, 8);
    lamp(out, root, N[key], x + 5.4, 6.9, z + 4);
    floorStencil(out, root, N[key], x - 5, z + 5.1);
  }
  // gantry crane runway over Final QA → pickup pad (the bridge and hoist move in logistics.js)
  {
    const cx = 36;
    for (const s of [-1, 1]) {
      for (const z of [1, 22]) S.box(M.safety, 0.5, 8.6, 0.5, cx + s * 6, 4.3, z);
      S.box(M.safety, 0.5, 0.7, 22, cx + s * 6, 8.6, 11.5);
    }
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
    for (const s of [-1, 1]) S.box(M.hazard, 18, 0.11, 0.16, x, 0.06, z + s * 2.3);
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

// ---------------- per-node helpers: andon lamps, floor stencils and click targets
// Lamps and stencils are collected while the plant is built and turned into one instanced lamp
// mesh and one atlas-textured stencil mesh by finalizeEquipment().
export function lamp(out, root, n, x, y, z) { out.lampDefs.push({ n, x, y, z }); }
export function addPick(out, n, x, y, z, w, h, d) {
  out.picks.push({ n, box: new THREE.Box3(new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2), new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2)) });
}
export function floorStencil(out, root, n, x, z, scale = 1) { out.stencilDefs.push({ n, x, z, scale }); }

export function finalizeEquipment(out, scene) {
  // andon lamps: pole + light, instanced; the light colour is set per lamp every frame
  const defs = out.lampDefs, m4 = new THREE.Matrix4();
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6).translate(0, -0.3, 0), materials().darkSteel, defs.length);
  const lights = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.11, 0.32, 12).translate(0, 0.16, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), defs.length);
  defs.forEach((d, i) => { m4.makeTranslation(d.x, d.y, d.z); poles.setMatrixAt(i, m4); lights.setMatrixAt(i, m4); out.lamps.set(d.n, i); });
  lights.setColorAt(0, new THREE.Color(1, 1, 1));
  scene.add(poles, lights);
  out.lampMesh = lights;
  // floor stencils on one atlas
  const atlas = out.stencilAtlas = stencilAtlas(4, Math.max(1, Math.ceil(out.stencilDefs.length / 4)));
  const geos = out.stencilDefs.map((d, i) => {
    const w = 6.4 * d.scale, h = 1.6 * d.scale, sl = atlas.slot(i);
    const g = new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2).translate(d.x + w / 2, 0.025, d.z + h / 2);
    const uv = g.attributes.uv, [u0, v0, u1, v1] = sl.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) ? u1 : u0, uv.getY(k) ? v1 : v0);
    out.stencils.set(d.n, sl);
    return g;
  });
  const sm = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshBasicMaterial({ map: atlas.texture, transparent: true, depthWrite: false, opacity: 0.9 }));
  sm.renderOrder = 4;
  scene.add(sm);
}

const _v = new THREE.Vector3();
const LAMP = Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, new THREE.Color(v.color).multiplyScalar(2.4)]));
export function updateEquipment(eq, sim, statusOf, dt, simDt, live = []) {
  eq.t += dt;
  const run = dt > 0 && simDt > 0;
  if (eq.lampMesh) {
    for (const [n, i] of eq.lamps) eq.lampMesh.setColorAt(i, LAMP[statusOf(n)]);
    eq.lampMesh.instanceColor.needsUpdate = true;
  }
  const at = new Map();
  for (const e of live) if (!at.has(e.n)) at.set(e.n, e);
  const working = (n) => run && statusOf(n) === 'busy' && at.get(n)?.pl.mf >= 1;

  // robots move while their cell is working; weld and laser cells throw sparks
  for (const r of eq.robots) {
    const busy = working(r.n);
    r.k = (r.k ?? 0) + (busy ? dt : 0);
    const a = r.k * 1.6 + r.phase, ease = Math.min(1, dt * 3);
    const tgt = busy
      ? { yaw: 0.5 * Math.sin(a * 0.7), sh: 0.55 + Math.sin(a * 1.3) * 0.22, el: 0.85 + Math.sin(a * 1.7 + 1) * 0.3, wr: 0.5 + Math.sin(a * 2.1) * 0.3 }
      : { yaw: 0, sh: 0.05, el: 0.6, wr: 0.4 };
    r.turret.rotation.y += (tgt.yaw - r.turret.rotation.y) * ease;
    r.shoulder.rotation.x += (tgt.sh - r.shoulder.rotation.x) * ease;
    r.elbow.rotation.x += (tgt.el - r.elbow.rotation.x) * ease;
    r.wrist.rotation.x += (tgt.wr - r.wrist.rotation.x) * ease;
    if (busy && r.sparks && Math.sin(a * 3.1) > -0.2) {
      r.tip.getWorldPosition(_v);
      const n = Math.floor(dt * (r.sparks === 'weld' ? 90 : 50) + Math.random());
      const col = r.sparks === 'weld' ? [1, 0.62, 0.22] : [0.75, 0.9, 1];
      for (let k = 0; k < n; k++) eq.sparks.emit(_v.x, _v.y, _v.z, rand(-2.5, 2.5), rand(0.5, 3.5), rand(-2.5, 2.5),
        { life: rand(0.25, 0.6), size: rand(0.05, 0.1), color: col, alpha: 1, acc: [0, -9.8, 0], drag: 0.4 });
      if (Math.random() < dt * 14) eq.sparks.emit(_v.x, _v.y, _v.z, 0, 0, 0, { life: 0.08, size: 0.9, color: r.sparks === 'weld' ? [1, 0.85, 0.6] : [0.7, 0.85, 1], alpha: 0.9 });
    }
  }
  // laser geometry arch sweeps the frame
  if (eq.laser) {
    const e = at.get(eq.laser.n), on = working(eq.laser.n);
    const x = on ? eq.laser.x - 4.4 + 8.8 * ((e.pl.p * 3) % 1) : eq.laser.x;
    eq.laser.laser.position.x = x; eq.laser.head.position.x = x;
    eq.laser.laser.visible = on;
  }
  // potting gantry
  if (eq.potting) {
    const on = working(eq.potting.n), k = eq.t * 1.4;
    eq.potting.bridge.position.x = eq.potting.x + (on ? Math.sin(k) * 1.0 : 0);
    eq.potting.head.position.z = on ? Math.sin(k * 2.3) * 0.6 : 0;
  }
  // crews
  for (const c of eq.crews) {
    const on = working(c.n);
    c.phase += dt * (on ? 1.8 : 0.4);
    if (!on || c.pose === 'idle') rest(c.p);
    else if (c.pose === 'inspect') poseInspect(c.p, c.phase);
    else poseReach(c.p, c.phase);
  }
  // lift-assist arms swing modules / doors in from the side
  for (const a of eq.assists) {
    const on = working(a.n);
    a.phase += dt * (on ? 1.2 : 0);
    const sw = on ? Math.sin(a.phase) : 0;
    a.arm1.rotation.y += ((on ? 0.6 + 0.5 * sw : 0.2) - a.arm1.rotation.y) * Math.min(1, dt * 3);
    a.arm2.rotation.y += ((on ? -1.0 - 0.6 * sw : -0.4) - a.arm2.rotation.y) * Math.min(1, dt * 3);
  }
  // coolant hose drops in while Coolant Fill works; the scanner sweeps the pack at End-of-Line Test
  const hose = eq.packFx.hose;
  if (hose) { const on = working(hose.n); hose.hose.scale.y += ((on ? 3.4 : 0.6) - hose.hose.scale.y) * Math.min(1, dt * 2); }
  const scan = eq.packFx.scan;
  if (scan) {
    const e = at.get(scan.n), on = working(scan.n);
    const x = on ? scan.x - 4.6 + 9.2 * (0.5 - 0.5 * Math.cos(e.pl.p * Math.PI * 6)) : scan.x - 5;
    scan.scan.position.x += (x - scan.scan.position.x) * Math.min(1, dt * 5);
  }
  eq.sparks.update(dt, innerHeight);
}
