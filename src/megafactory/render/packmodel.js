// Megapack built station by station, drawn in about ten calls: merged frame and skid, the HV
// busbar spine revealed piece by piece (draw range), 48 modules and their orange fronts as
// instances that slide in from the sides, a thermal roof that the hoist lowers, 16 doors as
// instances that swing shut on their hinges, end caps and status lights.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PACK } from '../../models.js';

const { L, W, BASE, BODY, BAYS, LEVELS } = PACK;
const BAY = L / BAYS;
export const FRAME_TOP = BASE + BODY + 0.05;
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

// one merged frame: base rails, 18 posts, top rails (base first, then posts, then top, so a
// draw range can reveal it in the order the Body-in-White line welds it)
export function frameGeo() {
  const g = [];
  for (const s of [-1, 1]) g.push(box(L, 0.12, 0.1, 0, 0.06, s * (W / 2 - 0.05)));
  for (const s of [-1, 1]) g.push(box(0.1, 0.12, W - 0.2, s * (L / 2 - 0.05), 0.06, 0));
  for (let i = 0; i < BAYS; i++) g.push(box(0.06, 0.06, W - 0.2, -L / 2 + (i + 0.5) * BAY, 0.08, 0));
  const baseN = g.length;
  for (let i = 0; i <= BAYS; i++) {
    const x = Math.min(L / 2 - 0.05, Math.max(-L / 2 + 0.05, -L / 2 + i * BAY));
    for (const s of [-1, 1]) g.push(box(0.1, BODY, 0.1, x, BODY / 2, s * (W / 2 - 0.05)));
  }
  const postN = g.length;
  for (const s of [-1, 1]) g.push(box(L, 0.1, 0.1, 0, BODY, s * (W / 2 - 0.05)));
  for (const s of [-1, 1]) g.push(box(0.1, 0.1, W - 0.2, s * (L / 2 - 0.05), BODY, 0));
  const per = g[0].index.count;
  const geo = mergeGeometries(g);
  geo.userData.stages = [baseN * per, postN * per, g.length * per];   // index counts after base, posts, top
  return geo;
}
// a door kit for the paint line: 16 doors and two end caps hung in two rows from a load bar
export function doorKitGeo() {
  const g = [];
  for (let i = 0; i < 8; i++) for (const s of [-1, 1]) g.push(box(1.0, 1.9, 0.05, -3.9 + i * 1.1, 0.95, s * 0.35));
  g.push(box(1.4, 1.9, 0.05, 0, 0.95, 0), box(0.05, 0.05, 1.0, -4.3, 1.95, 0), box(0.05, 0.05, 1.0, 4.3, 1.95, 0));
  return mergeGeometries(g);
}
// compact tray for racks and AGVs: plate + 12 module lids
export function trayGeo() {
  const g = [box(2.4, 0.08, 1.6, 0, 0.04, 0)];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) g.push(box(0.54, 0.44, 0.46, -0.87 + i * 0.58, 0.3, -0.5 + j * 0.5));
  return mergeGeometries(g);
}

let shared = null;
function sharedParts() {
  if (shared) return shared;
  const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.1, ...o });
  const fg = frameGeo().translate(0, BASE, 0);
  // HV spine: two main rails along the centre and a riser + link per bay, in assembly order
  const hv = [];
  hv.push(box(L - 0.4, 0.08, 0.1, 0, BASE + 0.25, 0), box(L - 0.4, 0.08, 0.1, 0, BASE + BODY - 0.15, 0));
  for (let i = 0; i < BAYS; i++) {
    const x = -L / 2 + (i + 0.5) * BAY;
    hv.push(box(0.08, BODY - 0.4, 0.1, x, BASE + BODY / 2 + 0.05, 0));
    for (let l = 0; l < LEVELS; l++) hv.push(box(BAY - 0.3, 0.05, 0.16, x, BASE + 0.62 + l * 0.65, 0));
  }
  const hvPer = hv[0].index.count;
  const hvGeo = mergeGeometries(hv);
  hvGeo.userData.n = hv.length; hvGeo.userData.per = hvPer;
  // thermal roof: housing slab, louvres, and two rows of fan shrouds
  const roofA = [box(L + 0.1, 0.22, W + 0.1, 0, 0.11, 0), box(L + 0.12, 0.04, W + 0.12, 0, 0.24, 0)];
  for (let i = 0; i < BAYS; i++) for (const s of [-1, 1]) roofA.push(box(BAY - 0.2, 0.12, 0.04, -L / 2 + (i + 0.5) * BAY, 0.08, s * (W / 2 + 0.06)));
  const roofB = [];
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) roofB.push(new THREE.CylinderGeometry(0.26, 0.26, 0.12, 14).translate(-L / 2 + 0.9 + i * (L - 1.8) / 5, 0.3, s * 0.42));
  shared = {
    frame: fg,
    skid: box(L + 0.2, BASE, W + 0.12, 0, BASE / 2, 0),
    hv: hvGeo,
    module: new THREE.BoxGeometry(1, 1, 1),
    roofA: mergeGeometries(roofA), roofB: mergeGeometries(roofB),
    door: box(BAY - 0.04, BODY - 0.08, 0.045, (BAY - 0.04) / 2, 0, 0),   // hinged on its left edge
    cap: box(0.05, BODY, W - 0.1, 0, BASE + BODY / 2 + 0.02, 0),
    light: new THREE.BoxGeometry(0.05, 0.12, 0.22),
    mats: {
      coated: std(0xf1f2f0, { roughness: 0.34 }), skid: std(0x16181b, { roughness: 0.8 }), hv: std(0xf2801f, { roughness: 0.45 }),
      module: std(0x2e3238, { roughness: 0.5, metalness: 0.3 }), front: std(0xf2801f, { roughness: 0.5 }),
      roof: std(0xeeeeec, { roughness: 0.5 }), fan: std(0x24272c, { roughness: 0.6 }), door: std(0xf4f5f3, { roughness: 0.4 }),
      blue: new THREE.MeshStandardMaterial({ color: 0, emissive: 0x2f8cff, emissiveIntensity: 2 }),
      green: new THREE.MeshStandardMaterial({ color: 0, emissive: 0x22c55e, emissiveIntensity: 2 }),
      red: new THREE.MeshStandardMaterial({ color: 0, emissive: 0xff3b3b, emissiveIntensity: 2.4 }),
    },
  };
  return shared;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0);
const MODULE_SLOTS = [];
for (let l = 0; l < LEVELS; l++) for (let b = 0; b < BAYS; b++) for (const side of [-1, 1]) MODULE_SLOTS.push({ x: -L / 2 + (b + 0.5) * BAY, y: BASE + 0.4 + l * 0.65, side });
const MOD_DEPTH = 0.62;

export function createPack() {
  const S = sharedParts(), M = S.mats;
  const group = new THREE.Group();
  const mk = (g, m) => { const o = new THREE.Mesh(g, m); o.castShadow = o.receiveShadow = true; group.add(o); return o; };
  mk(S.skid, M.skid);
  mk(S.frame, M.coated);
  const hv = mk(S.hv.clone(), M.hv);   // own copy so its draw range can reveal the spine
  hv.userData.keep = true;
  const mods = new THREE.InstancedMesh(S.module, M.module, MODULE_SLOTS.length);
  const fronts = new THREE.InstancedMesh(S.module, M.front, MODULE_SLOTS.length);
  for (const im of [mods, fronts]) { im.castShadow = true; im.count = 0; im.frustumCulled = false; group.add(im); }
  const roof = new THREE.Group(); group.add(roof);
  const ra = new THREE.Mesh(S.roofA, M.roof), rb = new THREE.Mesh(S.roofB, M.fan);
  ra.castShadow = rb.castShadow = true; roof.add(ra, rb);
  const doors = new THREE.InstancedMesh(S.door, M.door, BAYS * 2);
  doors.castShadow = true; doors.count = 0; doors.frustumCulled = false; group.add(doors);
  const caps = [-1, 1].map(s => { const c = mk(S.cap, M.door); c.position.x = s * (L / 2 + 0.02); return c; });
  const coolant = mk(S.light, M.blue); coolant.position.set(L / 2 + 0.08, BASE + 0.4, 0.5);
  const status = mk(S.light, M.green); status.position.set(L / 2 + 0.08, BASE + 0.4, -0.5);

  let lastKey = '';
  // level = how many pack stations are complete (0 = at Chassis Load), p = progress at the current one
  function set(level, p = 0, opts = {}) {
    const key = level + ':' + (Math.round(p * 200) / 200) + ':' + (opts.fail ? 1 : 0);
    if (key === lastKey) return;
    lastKey = key;
    const at = (k) => level > k ? 1 : level === k ? p : 0;
    // busbars
    const nHv = Math.floor(at(1) * S.hv.userData.n);
    hv.visible = nHv > 0;
    hv.geometry.setDrawRange(0, nHv * S.hv.userData.per);
    // modules: installed in order; the one going in now slides in from the side
    const mk2 = at(2) * MODULE_SLOTS.length, done = Math.floor(mk2), frac = mk2 - done;
    const count = Math.min(MODULE_SLOTS.length, done + (frac > 0 ? 1 : 0));
    for (let i = 0; i < count; i++) {
      const s = MODULE_SLOTS[i], out = i === done ? (1 - frac) * 1.6 : 0;
      const zc = s.side * (0.12 + MOD_DEPTH / 2 + out);
      _m.compose(_p.set(s.x, s.y, zc), _q.identity(), _s.set(BAY - 0.14, 0.56, MOD_DEPTH));
      mods.setMatrixAt(i, _m);
      _m.compose(_p.set(s.x, s.y, zc + s.side * (MOD_DEPTH / 2 + 0.01)), _q, _s.set(BAY - 0.18, 0.5, 0.02));
      fronts.setMatrixAt(i, _m);
    }
    mods.count = fronts.count = count;
    mods.instanceMatrix.needsUpdate = fronts.instanceMatrix.needsUpdate = true;
    // roof comes down from the hoist
    const r = at(3);
    roof.visible = r > 0;
    roof.position.y = FRAME_TOP + 3.2 * (1 - Math.min(1, r * 1.5)) ** 2;
    // doors are hung one by one and swing shut
    const kd = at(4) * BAYS * 2, dn = Math.floor(kd), df = kd - dn;
    const nd = Math.min(BAYS * 2, dn + (df > 0 ? 1 : 0));
    for (let i = 0; i < nd; i++) {
      const bay = i >> 1, side = i & 1 ? 1 : -1;
      const open = i === dn ? (1 - df) * 1.7 : 0;
      _q.setFromAxisAngle(_y, -side * open);   // swings outwards from its hinge
      const hx = -L / 2 + bay * BAY + 0.02, hz = side * (W / 2 + 0.03);
      _m.compose(_p.set(hx, BASE + BODY / 2 + 0.02, hz), _q, _s.set(1, 1, 1));
      doors.setMatrixAt(i, _m);
    }
    doors.count = nd;
    doors.instanceMatrix.needsUpdate = true;
    caps.forEach(c => { c.visible = at(4) > 0.92; });
    coolant.visible = at(5) > 0.3;
    status.visible = level >= 6;
    status.material = opts.fail ? M.red : M.green;
  }
  set(0, 0);
  return { group, set, roof };
}
