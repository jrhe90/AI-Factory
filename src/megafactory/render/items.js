// Moving units: frames and door kits on paint carriers, module trays, packs being built,
// finished Megapacks. Positions come from the simulation every frame; a change of node is
// drawn as a physical transfer from where the unit was, over the simulated move time.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NODES, N, RAIL_Y, HANG_Y } from '../plant.js';
import { placeItems } from '../sim.js';
import { PACK, FRAME_H, createMegapack, createModuleTray, createFinishedPack, createTruck } from '../../models.js';

// powder-coat finish by process stage
const coat = (color, o) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...o });
export const COAT = {
  bare: coat(0x5f666e, { metalness: 0.85, roughness: 0.32 }),
  stripped: coat(0x7a8088, { metalness: 0.7, roughness: 0.45 }),
  pretreated: coat(0x4f565e, { metalness: 0.8, roughness: 0.1 }),
  dry: coat(0x737a82, { metalness: 0.6, roughness: 0.5 }),
  primer: coat(0x5d636b, { metalness: 0, roughness: 0.95 }),
  gelled: coat(0x666d75, { metalness: 0, roughness: 0.6 }),
  topcoat: coat(0xeeeeea, { metalness: 0, roughness: 1 }),
  cured: coat(0xf3f4f2, { metalness: 0.02, roughness: 0.32 }),
};

const PACK_ORDER = ['CL', 'HV', 'MI', 'TH', 'EN', 'CF', 'EOL', 'QA'].map(k => N[k]);
const MOD_ORDER = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'].map(k => N[k]);
const FINISHED = new Set([N.CRANE, N.PAD, N.LOT, N.TRUCK]);
const ease = (k) => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;

function box(w, h, d, x, y, z) { return new THREE.BoxGeometry(w, h, d).translate(x, y, z); }
// one merged frame geometry: base rails, 18 posts, top rails (8.8 × 1.65 × 2.05 m)
function frameGeo() {
  const { L, W, BODY, BAYS } = PACK, g = [], bay = L / BAYS;
  for (const s of [-1, 1]) { g.push(box(L, 0.12, 0.1, 0, 0.06, s * (W / 2 - 0.05)), box(L, 0.1, 0.1, 0, BODY, s * (W / 2 - 0.05))); }
  for (const s of [-1, 1]) { g.push(box(0.1, 0.12, W - 0.2, s * (L / 2 - 0.05), 0.06, 0), box(0.1, 0.1, W - 0.2, s * (L / 2 - 0.05), BODY, 0)); }
  for (let i = 0; i <= BAYS; i++) {
    const x = Math.min(L / 2 - 0.05, Math.max(-L / 2 + 0.05, -L / 2 + i * bay));
    for (const s of [-1, 1]) g.push(box(0.1, BODY, 0.1, x, BODY / 2, s * (W / 2 - 0.05)));
  }
  for (let i = 0; i < BAYS; i++) g.push(box(0.06, 0.06, W - 0.2, -L / 2 + (i + 0.5) * bay, 0.08, 0));
  return mergeGeometries(g);
}
// a door kit: 16 doors and two end caps hung in two rows from a load bar
function doorGeo() {
  const g = [];
  for (let i = 0; i < 8; i++) for (const s of [-1, 1]) g.push(box(1.0, 1.9, 0.05, -3.9 + i * 1.1, 0.95, s * 0.35));
  g.push(box(1.4, 1.9, 0.05, 0, 0.95, 0), box(0.05, 0.05, 1.0, -4.3, 1.95, 0), box(0.05, 0.05, 1.0, 4.3, 1.95, 0));
  return mergeGeometries(g);
}
// compact tray for racks and AGVs: plate + 12 grey module lids
function trayGeo() {
  const g = [box(2.4, 0.08, 1.6, 0, 0.04, 0)];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) g.push(box(0.54, 0.44, 0.46, -0.87 + i * 0.58, 0.3, -0.5 + j * 0.5));
  return mergeGeometries(g);
}

export class Items {
  constructor(stage) {
    this.stage = stage;
    this.scene = stage.scene;
    this.units = new Map();   // id → view state
    this.frameGeo = frameGeo();
    this.doorGeo = doorGeo();
    const steel = new THREE.MeshStandardMaterial({ color: 0x7c848d, metalness: 0.6, roughness: 0.4 });
    this.carrierMats = { trolley: new THREE.MeshStandardMaterial({ color: 0x1f6fd1, metalness: 0.4, roughness: 0.4 }), bar: steel,
                         chain: new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.4 }) };
    this.carrierGeo = { trolley: new THREE.BoxGeometry(1.5, 0.34, 0.5), bar: new THREE.BoxGeometry(PACK.L * 0.86, 0.16, 0.3),
                        chain: new THREE.CylinderGeometry(0.03, 0.03, 1, 5).translate(0, -0.5, 0) };
    // instanced stock: trays in the racks, finished packs in the lot
    this.rackTrays = new THREE.InstancedMesh(trayGeo(), new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.55, metalness: 0.3 }), 64);
    this.rackTrays.castShadow = true; this.rackTrays.count = 0;
    const fp = createFinishedPack().children[0];
    this.lotPacks = new THREE.InstancedMesh(fp.geometry.clone().translate(0, PACK.HEIGHT / 2, 0), fp.material, 64);
    this.lotPacks.castShadow = this.lotPacks.receiveShadow = true; this.lotPacks.count = 0;
    this.scene.add(this.rackTrays, this.lotPacks);
    this.truck = createTruck();
    this.truck.group?.position?.set?.(0, 0, 0);
    this.truckObj = this.truck.group ?? this.truck;
    this.truckObj.visible = false;
    this.scene.add(this.truckObj);
  }

  make(it) {
    const g = new THREE.Group();
    const u = { g, type: it.type, n: -1, from: null, at: new THREE.Vector3(), rot: 0 };
    if (it.type === 'frame' || it.type === 'doors') {
      u.body = new THREE.Mesh(it.type === 'frame' ? this.frameGeo : this.doorGeo, COAT.bare);
      u.body.castShadow = u.body.receiveShadow = true;
      g.add(u.body);
      u.carrier = this.makeCarrier();
    } else if (it.type === 'tray') {
      u.tray = createModuleTray();
      g.add(u.tray.group);
    }
    this.scene.add(g);
    if (u.carrier) this.scene.add(u.carrier.g);
    return u;
  }

  makeCarrier() {
    const g = new THREE.Group(), M = this.carrierMats, G = this.carrierGeo;
    const trolley = new THREE.Mesh(G.trolley, M.trolley); trolley.position.y = 0.1;
    const bar = new THREE.Mesh(G.bar, M.bar);
    const chains = [-3.2, 3.2].map(x => { const c = new THREE.Mesh(G.chain, M.chain); c.position.x = x; return c; });
    const hook = new THREE.Mesh(G.chain, M.chain);
    g.add(trolley, bar, hook, ...chains);
    trolley.castShadow = bar.castShadow = true;
    return { g, bar, chains, hook };
  }

  // turn a frame into a pack being built when it reaches the pack line
  toPack(u) {
    if (u.pack) return;
    u.g.remove(u.body);
    u.body = null;
    if (u.carrier) { this.scene.remove(u.carrier.g); u.carrier = null; }
    u.pack = createMegapack();
    u.g.add(u.pack.group);
    u.pack.group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    u.type = 'pack';
  }
  toFinished(u) {
    if (u.finished) return;
    if (u.pack) { u.g.remove(u.pack.group); u.pack = null; }
    u.finished = createFinishedPack();
    u.g.add(u.finished);
  }

  dispose(id, u) {
    this.scene.remove(u.g);
    if (u.carrier) this.scene.remove(u.carrier.g);
    this.units.delete(id);
  }

  sync(s) {
    const seen = new Set();
    let trays = 0, lot = 0;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p3 = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0);
    let truckLoaded = false;

    for (const pl of placeItems(s)) {
      const { it, n } = pl, d = NODES[n];
      // stock that never moves on its own is drawn instanced
      if (n === N.RACK && pl.mf >= 1) {
        q.identity(); m4.compose(p3.set(pl.x, pl.y ?? 0.3, pl.z), q, one);
        this.rackTrays.setMatrixAt(trays++, m4);
        const u = this.units.get(it.id); if (u) this.dispose(it.id, u);
        continue;
      }
      if (n === N.LOT && pl.mf >= 1) {
        q.identity(); m4.compose(p3.set(pl.x, 0, pl.z), q, one);
        this.lotPacks.setMatrixAt(lot++, m4);
        const u = this.units.get(it.id); if (u) this.dispose(it.id, u);
        continue;
      }
      seen.add(it.id);
      let u = this.units.get(it.id);
      if (!u) { u = this.make(it); this.units.set(it.id, u); u.at.set(pl.x, this.heightAt(n, it, pl), pl.z); u.rot = this.rotAt(n, pl); u.n = n; }
      if (it.type === 'pack' && !u.pack && !FINISHED.has(n)) this.toPack(u);
      if (FINISHED.has(n)) this.toFinished(u);

      // target position in this node
      const tx = pl.x, tz = pl.z, ty = this.heightAt(n, it, pl), tr = this.rotAt(n, pl);
      if (u.n !== n) { u.from = { x: u.at.x, y: u.at.y, z: u.at.z, r: u.rot, n: u.n }; u.n = n; }
      let x = tx, y = ty, z = tz, r = tr;
      if (u.from && pl.mf < 1) {
        const k = ease(pl.mf);
        const via = this.via(u.from, n, tx, tz);
        if (via) { [x, z] = alongVia(via, k); } else { x = u.from.x + (tx - u.from.x) * k; z = u.from.z + (tz - u.from.z) * k; }
        y = u.from.y + (ty - u.from.y) * k;
        r = u.from.r + angleDiff(u.from.r, tr) * k;
      } else u.from = null;
      u.at.set(x, y, z); u.rot = r;
      u.g.position.copy(u.at);
      u.g.rotation.y = r;
      this.stageLook(u, it, n, pl);
      if (u.carrier) this.placeCarrier(u, it, n, x, y, z, r);
      if (n === N.TRUCK) truckLoaded = true;
    }
    for (const [id, u] of this.units) if (!seen.has(id)) this.dispose(id, u);
    this.rackTrays.count = trays; this.rackTrays.instanceMatrix.needsUpdate = true;
    this.lotPacks.count = lot; this.lotPacks.instanceMatrix.needsUpdate = true;
    this.truckObj.visible = s.trucks > 0 || truckLoaded;
    this.truckObj.position.set(NODES[N.TRUCK].pos[0] - 1.2, 0, NODES[N.TRUCK].pos[1]);
  }

  // where a unit sits vertically in a node
  heightAt(n, it, pl) {
    const d = NODES[n];
    if (n === N.LOAD) return 0.75 + (HANG_Y - 0.75) * ease(Math.min(1, pl.p * 2.5));
    if (n === N.DROP) return HANG_Y + (0.32 - HANG_Y) * ease(Math.max(0, pl.p * 1.6 - 0.6));
    if (d.hang) return HANG_Y;
    if (d.line === 'biw') return 0.72;
    if (d.line === 'module') return pl.y ?? 0.9;
    if (n === N.DOORKIT || n === N.DOORBUF) return 0.42;
    if (n === N.CRANE) return 0.2 + 2.6 * ease(pl.p);
    if (n === N.TRUCK) return 1.3;
    if (n === N.PAD || n === N.LOT) return 0;
    return 0.2;
  }
  rotAt(n, pl) {
    const d = NODES[n];
    if (d.kind === 'conveyor') return pl.rot;
    if (n === N.DROP || n === N.REPAIR) return Math.PI / 2;
    return 0;
  }
  // transfers that must not cut through walls: out through the south door, round to the truck bay
  via(from, n, tx, tz) {
    if (n === N.LOT && from.z < 26) return [[from.x, from.z], [36, 32], [tx, 32], [tx, tz]];
    if (n === N.TRUCK) return [[from.x, from.z], [from.x, 92], [tx, 92], [tx, tz]];
    return null;
  }

  stageLook(u, it, n, pl) {
    const d = NODES[n];
    if (u.body) {
      // finish changes as the part passes through each process section
      let c = it.coat || 'bare';
      if (d.coat && pl.p >= 0.5) c = d.coat;
      u.body.material = COAT[c] || COAT.bare;
    }
    if (u.pack) {
      const k = PACK_ORDER.indexOf(n), p = pl.mf < 1 ? 0 : pl.p;
      const lvl = (station) => k > station ? 1 : k === station ? p : 0;
      u.pack.hv.forEach((m, i) => { m.visible = lvl(1) * u.pack.hv.length > i; });
      u.pack.modules.setCount(Math.floor(lvl(2) * u.pack.modules.total));
      u.pack.roof.visible = lvl(3) > 0.5;
      u.pack.doors.forEach((m, i) => { m.visible = lvl(4) * u.pack.doors.length > i; });
    }
    if (u.tray) {
      const k = MOD_ORDER.indexOf(n), p = pl.mf < 1 ? 0 : pl.p;
      const lvl = (station) => k < 0 ? 1 : k > station ? 1 : k === station ? p : 0;
      const t = u.tray;
      t.cells.count = Math.floor(lvl(1) * t.cells.instanceMatrix.count);
      t.welds.count = Math.floor(lvl(2) * 12);
      t.potting.count = Math.floor(lvl(3) * 12);
      t.lids.count = Math.floor(lvl(4) * 12);
      t.pcbs.count = Math.floor(lvl(4) * 12);
    }
  }

  placeCarrier(u, it, n, x, y, z, r) {
    const c = u.carrier;
    c.g.visible = !!NODES[n].hang;
    if (!c.g.visible) return;
    c.g.position.set(x, RAIL_Y - 0.25, z);
    c.g.rotation.y = r;
    const top = y + (u.type === 'doors' ? 2.0 : FRAME_H);
    const drop = Math.max(0.2, RAIL_Y - 0.25 - top - 0.1);
    c.bar.position.y = -drop;
    for (const ch of c.chains) { ch.position.y = -drop + 0.08; ch.scale.y = 0.08; }
    c.hook.scale.y = drop;
    c.hook.position.y = 0;
  }
}

function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function alongVia(pts, k) {
  let L = 0;
  const seg = [];
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); L += l; }
  let d = k * L;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) {
      const u = seg[i] ? Math.min(1, d / seg[i]) : 1;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u];
    }
    d -= seg[i];
  }
  return pts[pts.length - 1];
}
