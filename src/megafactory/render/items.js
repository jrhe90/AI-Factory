// Moving units: frames and door kits on paint carriers, module trays, packs being built,
// finished Megapacks. Positions come from the simulation every frame; a change of node is
// drawn as a physical transfer from where the unit was, over the simulated move time.
import * as THREE from 'three';
import { NODES, N, RAIL_Y, HANG_Y } from '../plant.js';
import { placeItems } from '../sim.js';
import { PACK, createModuleTray, createFinishedPack } from '../../models.js';
import { finishMaterial, setFinish } from './finish.js';
import { createPack, frameGeo, doorKitGeo, trayGeo } from './packmodel.js';
import { carryPath, carryK, along, EAST_X } from './routes.js';
import { instancer } from './instancer.js';

const PACK_ORDER = ['CL', 'HV', 'MI', 'TH', 'EN', 'CF', 'EOL', 'QA'].map(k => N[k]);
const MOD_ORDER = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'].map(k => N[k]);
const BIW_ORDER = ['BIW1', 'BIW2', 'BIW3'].map(k => N[k]);
const FINISHED = new Set([N.CRANE, N.PAD, N.LOT, N.TRUCK]);
const FRAME_H = PACK.BODY + 0.05;
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const ease = (k) => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;

export class Items {
  constructor(stage) {
    this.stage = stage;
    this.scene = stage.scene;
    this.units = new Map();   // id → view state
    this.live = [];
    this.frameGeo = frameGeo();
    this.doorGeo = doorKitGeo();
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
  }

  make(it) {
    const g = new THREE.Group();
    const u = { g, type: it.type, n: -1, from: null, at: new THREE.Vector3(), rot: 0 };
    if (it.type === 'frame' || it.type === 'doors') {
      u.mat = finishMaterial();
      u.geo = it.type === 'frame' ? this.frameGeo.clone() : this.doorGeo;
      u.body = new THREE.Mesh(u.geo, u.mat);
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
    const hook = new THREE.Mesh(G.chain, M.chain);
    g.add(trolley, bar, hook);
    instancer.adopt(g);
    return { g, bar, hook };
  }

  // a frame becomes a pack being built when it reaches the pack line
  toPack(u) {
    if (u.pack) return;
    if (u.body) { u.g.remove(u.body); u.body = null; if (u.geo !== this.doorGeo) u.geo.dispose(); }
    if (u.carrier) { this.scene.remove(u.carrier.g); instancer.release(u.carrier.g); u.carrier = null; }
    u.pack = createPack();
    u.g.add(u.pack.group);
    instancer.adopt(u.pack.group);
    u.type = 'pack';
  }
  toFinished(u) {
    if (u.finished) return;
    if (u.pack) { u.g.remove(u.pack.group); instancer.release(u.pack.group); u.pack = null; }
    u.finished = createFinishedPack();
    u.g.add(u.finished);
  }

  dispose(id, u) {
    this.scene.remove(u.g);
    if (u.carrier) { this.scene.remove(u.carrier.g); instancer.release(u.carrier.g); }
    if (u.pack) instancer.release(u.pack.group);
    this.units.delete(id);
  }

  sync(s) {
    const seen = new Set();
    const live = this.live = [];
    let trays = 0, lot = 0;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p3 = new THREE.Vector3();

    for (const pl of placeItems(s)) {
      const { it, n } = pl;
      // stock that never moves on its own is drawn instanced
      if ((n === N.RACK || n === N.LOT) && pl.mf >= 1) {
        q.identity(); m4.compose(p3.set(pl.x, n === N.RACK ? (pl.y ?? 0.3) : 0, pl.z), q, one);
        if (n === N.RACK) this.rackTrays.setMatrixAt(trays++, m4); else this.lotPacks.setMatrixAt(lot++, m4);
        const u = this.units.get(it.id); if (u) this.dispose(it.id, u);
        continue;
      }
      seen.add(it.id);
      let u = this.units.get(it.id);
      if (!u) {
        u = this.make(it); this.units.set(it.id, u);
        u.at.set(pl.x, this.heightAt(n, it, pl), pl.z); u.rot = this.rotAt(n, pl); u.n = n;
        // first seen half-way through a carry (page opened mid-move): start it from where it came from
        if (pl.mf < 1 && n === N.LOT) u.from = { x: NODES[N.PAD].slots[0][0], y: 0, z: NODES[N.PAD].slots[0][1], r: 0, n: N.PAD };
        if (pl.mf < 1 && n === N.TRUCK) u.from = { x: EAST_X, y: 0, z: 80, r: 0, n: N.LOT };
      }
      if (it.type === 'pack' && !u.pack && !FINISHED.has(n)) this.toPack(u);
      if (FINISHED.has(n)) this.toFinished(u);

      const tx = pl.x, tz = pl.z, ty = this.heightAt(n, it, pl), tr = this.rotAt(n, pl);
      if (u.n !== n) { u.from = { x: u.at.x, y: u.at.y, z: u.at.z, r: u.rot, n: u.n }; u.n = n; }
      let x = tx, y = ty, z = tz, r = tr;
      if (u.from && pl.mf < 1) {
        const route = carryPath(n, u.from.x, u.from.z, tx, tz);
        if (route) {
          // carried by a straddle-carrier pair, lifted just off the ground
          const k = carryK(pl.mf);
          [x, z] = along(route, ease(k));
          y = k > 0 && k < 1 ? 0.45 + (n === N.TRUCK ? 0.85 * sm(0.85, 1, k) : 0) : (k >= 1 ? ty : u.from.y);
          r = 0;
        } else {
          const k = ease(pl.mf);
          x = u.from.x + (tx - u.from.x) * k; z = u.from.z + (tz - u.from.z) * k;
          y = u.from.y + (ty - u.from.y) * k;
          r = u.from.r + angleDiff(u.from.r, tr) * k;
        }
      } else u.from = null;
      u.at.set(x, y, z); u.rot = r;
      u.g.position.copy(u.at);
      u.g.rotation.y = r;
      this.stageLook(u, it, n, pl, s);
      if (u.carrier) this.placeCarrier(u, n, x, y, z, r);
      live.push({ u, it, n, pl });
    }
    for (const [id, u] of this.units) if (!seen.has(id)) this.dispose(id, u);
    this.rackTrays.count = trays; this.rackTrays.instanceMatrix.needsUpdate = true;
    this.lotPacks.count = lot; this.lotPacks.instanceMatrix.needsUpdate = true;
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
    if (n === N.CRANE) return 0.2 + 2.8 * ease(Math.min(1, pl.p * 1.4));
    if (n === N.TRUCK) return 1.3;
    if (n === N.LOT) return 0;
    return 0.2;
  }
  rotAt(n, pl) {
    const d = NODES[n];
    if (d.kind === 'conveyor') return pl.rot;
    if (n === N.DROP || n === N.REPAIR) return Math.PI / 2;
    return 0;
  }

  stageLook(u, it, n, pl, s) {
    if (u.body) this.finishLook(u, it, n, pl);
    if (u.geo && u.geo !== this.doorGeo) {
      // Body in White welds the frame up: base rails, then posts, then the top rails
      const st = this.frameGeo.userData.stages, k = BIW_ORDER.indexOf(n), p = pl.mf < 1 ? 0 : pl.p;
      let cnt = st[2];
      if (n === N.BIW1) cnt = st[0];
      else if (k === 1) cnt = st[0] + Math.floor((st[1] - st[0]) / 36 * p) * 36;
      else if (k === 2) cnt = st[1] + Math.floor((st[2] - st[1]) / 36 * p) * 36;
      u.geo.setDrawRange(0, cnt);
    }
    if (n === N.PAD && pl.mf < 1) {
      // the crane carries it across at height and lowers it onto the pad at the end of the move
      u.g.position.y = 3.0 - 3.0 * sm(0.65, 1, pl.mf);
    }
    if (u.pack) {
      const k = PACK_ORDER.indexOf(n), p = pl.mf < 1 ? 0 : pl.p;
      u.pack.set(k < 0 ? 8 : k, p, { fail: it.failAt != null && s.t >= it.failAt && n === N.EOL });
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

  // the finish builds up through the process: wet in the washer, powder swept on by the guns,
  // gloss coming up in the ovens while the part glows with heat
  finishLook(u, it, n, pl) {
    const d = NODES[n], a = it.coat || 'bare', p = pl.p;
    let b = a, o = {};
    if (d.kind === 'conveyor' && d.coat) {
      b = d.coat;
      const q = d.heatFrom ? Math.max(0, (p * d.L - d.heatFrom) / (d.L - d.heatFrom)) : p;
      if (d.booth) o = { sweep: d.gunX - u.at.x };
      else if (n === N.PRE) o = { blend: sm(0.04, 0.25, p) };
      else if (n === N.DRY) o = { blend: sm(0.25, 0.85, p), heat: 0.2 * Math.sin(Math.PI * p) };
      else if (n === N.GEL) o = { blend: sm(0.2, 0.75, p), heat: 0.42 * Math.sin(Math.PI * p) };
      else if (n === N.CURE) o = { blend: sm(0.3, 0.8, q), heat: 0.75 * Math.pow(Math.sin(Math.PI * q), 0.7) };
    } else if (n === N.COOL1 || n === N.COOL2) o = { heat: (n === N.COOL2 ? 0.22 : 0.12) * (1 - p) };
    setFinish(u.mat, a, b, o);
  }

  placeCarrier(u, n, x, y, z, r) {
    const c = u.carrier;
    c.g.visible = !!NODES[n].hang;
    if (!c.g.visible) return;
    c.g.position.set(x, RAIL_Y - 0.25, z);
    c.g.rotation.y = r;
    const top = y + (u.type === 'doors' ? 2.0 : FRAME_H);
    const drop = Math.max(0.2, RAIL_Y - 0.25 - top - 0.1);
    c.bar.position.y = -drop;
    c.hook.scale.y = drop;
  }
}

function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
