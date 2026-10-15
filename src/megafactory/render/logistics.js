// Everything that moves material between areas: straddle-carrier pairs (pad → lot → truck),
// outbound trucks (arrive on the road, queue, load at the bay, leave with the pack), AGVs taking
// tray stacks from the module racks to Module Install, a tugger taking door kits to Enclosure &
// Doors, the rack stacker crane, the gantry crane over the pad, and forklifts on the aisles.
import * as THREE from 'three';
import { NODES, N, RACK } from '../plant.js';
import { PACK, TRUCK_BED, createStraddleCarrier, createTruck, createForklift, createFinishedPack } from '../../models.js';
import { carryPath, along, pathLen, APPROACH, STANDS, LANE_Z, EAST_X, TRUCK_LOAD } from './routes.js';
import { DOOR_X } from '../plant.js';
import { trayGeo } from './packmodel.js';
import { instancer } from './instancer.js';

const ease = (k) => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
const AGV_GEO = { body: new THREE.BoxGeometry(2.9, 0.38, 1.9), stripe: new THREE.BoxGeometry(2.92, 0.08, 1.92), lidar: new THREE.CylinderGeometry(0.12, 0.12, 0.14, 12), lamp: new THREE.BoxGeometry(0.04, 0.06, 1.2) };
const QUEUE = [[86, 101], [70, 101], [54, 101]];
const ROAD_Z = 114;

function heading(pts, k) {
  const a = along(pts, Math.max(0, k - 0.01)), b = along(pts, Math.min(1, k + 0.01));
  return Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) < 1e-6 ? null : -Math.atan2(b[1] - a[1], b[0] - a[0]);
}

// a vehicle that drives along polylines at a given speed and remembers where it is
class Mover {
  constructor(obj, x, z, r = 0) { this.obj = obj; this.x = x; this.z = z; this.r = r; this.path = null; this.d = 0; this.L = 0; obj.position.set(x, 0, z); obj.rotation.y = r; }
  go(pts, then) { this.path = [[this.x, this.z], ...pts]; this.L = pathLen(this.path); this.d = 0; this.then = then; }
  step(dist, faceAlong = true) {
    if (!this.path) return;
    this.d = Math.min(this.L, this.d + dist);
    const k = this.L ? this.d / this.L : 1;
    [this.x, this.z] = along(this.path, k);
    if (faceAlong) { const h = heading(this.path, k); if (h != null) this.r += angle(this.r, h) * 0.25; }
    this.obj.position.set(this.x, this.obj.position.y, this.z);
    this.obj.rotation.y = this.r;
    if (this.d >= this.L) { const t = this.then; this.path = null; this.then = null; t?.(); }
  }
}
function angle(a, b) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }

export function buildLogistics(stage) {
  const scene = stage.scene;
  const L = { pairs: [], trucks: [], agvs: [], tugger: null, lastArrivals: null, lastTruckUnit: null, lastMI: null, lastEN: null };

  // ---------------- straddle-carrier pairs
  STANDS.forEach(([x, z], i) => {
    const mk = () => { const c = createStraddleCarrier(); scene.add(c.group); instancer.adopt(c.group); return c; };
    const a = mk(), b = mk();
    const pair = { a, b, x, z, stand: [x, z], job: null, ret: null, i };
    placePair(pair, x, z, 1.6);
    L.pairs.push(pair);
  });

  // ---------------- trucks are created as they arrive
  L.makeTruck = () => {
    const t = createTruck();
    t.group.traverse(o => { if (o.isMesh) o.castShadow = true; });
    const pack = createFinishedPack();
    pack.position.set(-1.2 + 1.2, TRUCK_BED, 0);
    pack.visible = false;
    t.group.add(pack);
    scene.add(t.group);
    instancer.adopt(t.group);
    return { m: new Mover(t.group, -260, ROAD_Z), pack, state: 'arriving' };
  };

  // ---------------- AGVs and the door tugger
  const trayG = trayGeo(), trayM = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.55, metalness: 0.3 });
  const agvBody = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.5, metalness: 0.3 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.5 });
  const teal = new THREE.MeshStandardMaterial({ color: 0, emissive: 0x2ee6d2, emissiveIntensity: 2 });
  const makeAgv = (home, cargo) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(AGV_GEO.body, agvBody); body.position.y = 0.24;
    const stripe = new THREE.Mesh(AGV_GEO.stripe, yellow); stripe.position.y = 0.3;
    const lidar = new THREE.Mesh(AGV_GEO.lidar, agvBody); lidar.position.set(1.25, 0.5, 0);
    const lamp = new THREE.Mesh(AGV_GEO.lamp, teal); lamp.position.set(1.46, 0.26, 0);
    g.add(body, stripe, lidar, lamp, cargo);
    scene.add(g);
    instancer.adopt(g);
    return { m: new Mover(g, home[0], home[1], 0), cargo, home, busy: false };
  };
  for (const home of [[-24, -16], [-38, -16]]) {
    const cargo = new THREE.Group();
    for (let k = 0; k < 4; k++) { const t = new THREE.Mesh(trayG, trayM); t.position.y = 0.44 + k * 0.62; t.castShadow = true; cargo.add(t); }
    cargo.visible = false;
    L.agvs.push(makeAgv(home, cargo));
  }
  {
    const cargo = new THREE.Group();
    const kit = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 1.2), new THREE.MeshStandardMaterial({ color: 0xf1f2f0, roughness: 0.35 }));
    kit.position.y = 1.25; cargo.add(kit); cargo.visible = false;
    L.tugger = makeAgv([-92, 15], cargo);
  }

  // ---------------- rack stacker crane in the aisle between the two rack rows
  {
    const g = new THREE.Group();
    const blue = new THREE.MeshStandardMaterial({ color: 0x1f6fd1, roughness: 0.45, metalness: 0.35 });
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6.4, 0.5), blue); mast.position.y = 3.2;
    const carriage = new THREE.Group();
    const cb = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 2.0), yellow);
    carriage.add(cb);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 1.0), blue); top.position.y = 6.5;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 1.2), blue); foot.position.y = 0.2;
    g.add(mast, carriage, top, foot);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.position.set(RACK.x0 - 3, 0, -24);
    scene.add(g);
    instancer.adopt(g);
    L.stacker = { g, carriage, x: RACK.x0 - 3, y: 0.5 };
    // aisle rails
    const rail = new THREE.Mesh(new THREE.BoxGeometry(RACK.bays * RACK.dx + 6, 0.08, 0.2), new THREE.MeshStandardMaterial({ color: 0x3a3f45, metalness: 0.6, roughness: 0.4 }));
    rail.position.set(RACK.x0 + (RACK.bays - 1) * RACK.dx / 2 - 1.5, 0.04, -24); scene.add(rail);
  }

  // ---------------- gantry crane bridge and hoist over Final QA → pickup pad
  {
    const yel = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.5, metalness: 0.15 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.5, metalness: 0.4 });
    const g = new THREE.Group();
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(12.6, 0.8, 0.9), yel); bridge.position.y = 9.3;
    const trolley = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 1.6), new THREE.MeshStandardMaterial({ color: 0x1f6fd1, roughness: 0.45 })); trolley.position.y = 8.6;
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 6).translate(0, -0.5, 0), dark); cable.position.y = 8.25;
    const spreader = new THREE.Mesh(new THREE.BoxGeometry(9.0, 0.22, 0.5), yel);
    g.add(bridge, trolley, cable, spreader);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.position.set(36, 0, 8);
    scene.add(g);
    instancer.adopt(g);
    L.crane = { g, cable, spreader, z: 8, y: 4.5 };
  }

  // ---------------- forklifts on the cross aisles (ambient)
  L.forks = [];
  for (const [loop, phase] of [[[[-110, -38.5], [96, -38.5], [96, -36.2], [-110, -36.2]], 0], [[[-110, -12.6], [96, -12.6], [96, -10.4], [-110, -10.4]], 0.5]]) {
    const f = createForklift();
    scene.add(f);
    instancer.adopt(f);
    const m = new Mover(f, loop[0][0], loop[0][1]);
    const cyc = () => m.go([...loop.slice(1), loop[0]], cyc);
    cyc();
    m.step(pathLen(m.path) * phase);
    L.forks.push(m);
  }

  L.update = (s, live, dt, simDt) => updateLogistics(L, s, live, dt, simDt);
  return L;
}

function placePair(pair, x, z, liftY, packY = 0) {
  const off = PACK.L / 2 - 1.3;
  pair.a.group.position.set(x - off, 0, z);
  pair.b.group.position.set(x + off, 0, z);
  pair.a.lift.position.y = pair.b.lift.position.y = liftY;
  pair.x = x; pair.z = z;
}

function updateLogistics(L, s, live, dt, simDt) {
  const f = dt > 0 && simDt > 0 ? Math.max(0.5, Math.min(4, simDt / dt / 4)) : 0;
  const drive = dt * 9 * f;                       // vehicles: ~9 m/s at the default speed
  const byId = new Map(live.map(e => [e.it.id, e]));

  // ---- straddle carriers: a pair per pack on its way into the lot or onto a truck
  const jobs = live.filter(e => (e.n === N.LOT || e.n === N.TRUCK) && e.pl.mf < 1 && e.u.from);
  for (const e of jobs) {
    if (L.pairs.some(p => p.job?.id === e.it.id)) continue;
    const free = L.pairs.filter(p => !p.job).sort((a, b) => Math.hypot(a.x - e.u.from.x, a.z - e.u.from.z) - Math.hypot(b.x - e.u.from.x, b.z - e.u.from.z));
    const p = free[0];
    if (!p) continue;
    const fx = e.u.from.x, fz = e.u.from.z;
    const approach = e.n === N.LOT
      ? [[p.x, p.z], [EAST_X, Math.min(p.z, LANE_Z)], [EAST_X, LANE_Z], [DOOR_X, LANE_Z], [fx, fz]]
      : [[p.x, p.z], [EAST_X, p.z], [EAST_X, fz], [fx, fz]];
    p.job = { id: e.it.id, approach, n: e.n };
    p.ret = null;
  }
  for (const p of L.pairs) {
    if (p.job) {
      const e = byId.get(p.job.id);
      if (!e || e.pl.mf >= 1 || e.n !== p.job.n) {
        // delivered: drive back to the stand
        p.job = null;
        p.ret = { path: [[p.x, p.z], [EAST_X, p.z], [EAST_X, p.stand[1]], p.stand], d: 0 };
        p.ret.L = pathLen(p.ret.path);
        continue;
      }
      if (e.pl.mf < APPROACH) {
        const [x, z] = along(p.job.approach, ease(e.pl.mf / APPROACH));
        placePair(p, x, z, 1.6);
      } else {
        placePair(p, e.u.at.x, e.u.at.z, 0.75 + e.u.g.position.y);
      }
    } else if (p.ret) {
      p.ret.d = Math.min(p.ret.L, p.ret.d + drive);
      const [x, z] = along(p.ret.path, p.ret.L ? p.ret.d / p.ret.L : 1);
      placePair(p, x, z, 1.6);
      if (p.ret.d >= p.ret.L) p.ret = null;
    }
  }

  // ---- trucks: one per booked truck waiting, plus the one at the bay
  const tu = s.nodes[N.TRUCK].items[0];
  const needed = s.trucks + (tu ? 1 : 0);
  const present = L.trucks.filter(t => t.state !== 'departing');
  const first = L.lastArrivals == null;
  for (let k = present.length; k < needed; k++) {
    const t = L.makeTruck();
    if (first) {
      // opening the page: the truck being loaded is already at the bay, the rest are queued
      const atBay = tu && k === 0;
      const [qx, qz] = atBay ? TRUCK_LOAD : QUEUE[Math.min(k - (tu ? 1 : 0), 2)];
      t.m.x = qx; t.m.z = qz; t.m.obj.position.set(qx, 0, qz); t.state = atBay ? 'atBay' : 'queued';
    }
    else t.m.go([[40, ROAD_Z], [50, QUEUE[2][1]], ...[QUEUE[Math.min(present.length, 2)]]], () => { t.state = 'queued'; });
    L.trucks.push(t);
    present.push(t);
  }
  L.lastArrivals = s.truckN;
  // the shipped pack leaves on the truck at the bay
  if (L.lastTruckUnit != null && (!tu || tu.id !== L.lastTruckUnit)) {
    const t = L.trucks.find(t => t.state === 'atBay' || t.state === 'toBay');
    if (t) {
      t.pack.visible = true;
      t.pack.position.set(0, TRUCK_BED, 0);
      t.state = 'departing';
      t.m.go([[124, TRUCK_LOAD[1]], [134, ROAD_Z], [420, ROAD_Z]], () => { t.state = 'gone'; });
    }
  }
  L.lastTruckUnit = tu ? tu.id : null;
  // queue order: the front truck takes the bay
  const waiting = L.trucks.filter(t => t.state !== 'departing' && t.state !== 'gone');
  waiting.forEach((t, i) => {
    if (i === 0 && t.state === 'queued' && !t.m.path) {
      t.state = 'toBay';
      t.m.go([[96, t.m.z], [TRUCK_LOAD[0], TRUCK_LOAD[1]]], () => { t.state = 'atBay'; });
    } else if (i > 0 && t.state === 'queued' && !t.m.path) {
      const q = QUEUE[Math.min(i - 1, 2)];
      if (Math.hypot(t.m.x - q[0], t.m.z - q[1]) > 0.5) t.m.go([q], () => { t.state = 'queued'; });
    }
  });
  for (const t of L.trucks) t.m.step(drive * 1.3);
  for (const t of L.trucks.filter(t => t.state === 'gone')) { t.m.obj.parent?.remove(t.m.obj); }
  L.trucks = L.trucks.filter(t => t.state !== 'gone');

  // ---- AGVs: four trays to Module Install each time a pack starts there
  const mi = s.nodes[N.MI].items[0];
  if (mi && mi.id !== L.lastMI && L.lastMI !== null) {
    const a = L.agvs.find(a => !a.busy) || L.agvs[0];
    a.busy = true; a.cargo.visible = true;
    const [hx, hz] = a.home;
    a.m.go([[hx, -9], [-50, -9], [-50, 2.6]], () => {
      a.cargo.visible = false;
      a.m.go([[-50, -9], [hx, -9], [hx, hz]], () => { a.busy = false; });
    });
  }
  L.lastMI = mi ? mi.id : (L.lastMI ?? 0);
  // ---- tugger: a door kit to Enclosure & Doors
  const en = s.nodes[N.EN].items[0];
  if (en && en.id !== L.lastEN && L.lastEN !== null) {
    const t = L.tugger;
    t.cargo.visible = true;
    t.m.go([[-92, 15.6], [-27, 15.6], [-24, 13.6]], () => {
      t.cargo.visible = false;
      t.m.go([[-27, 15.6], [-92, 15.6], t.home], () => {});
    });
  }
  L.lastEN = en ? en.id : (L.lastEN ?? 0);
  for (const a of [...L.agvs, L.tugger]) a.m.step(drive * 0.55);

  // ---- rack stacker follows trays going into the racks
  const st = L.stacker;
  const inbound = live.find(e => e.n === N.RACK && e.pl.mf < 1);
  const tx = inbound ? inbound.u.at.x : st.x, ty = inbound ? inbound.u.at.y : 0.5;
  st.x += (tx - st.x) * Math.min(1, dt * 4);
  st.y += (ty - st.y) * Math.min(1, dt * 4);
  st.g.position.x = st.x;
  st.carriage.position.y = st.y;

  // ---- gantry crane: lifts at Final QA → carries over the pad → lowers
  const cr = L.crane;
  const held = live.find(e => e.n === N.CRANE || (e.n === N.PAD && e.pl.mf < 1));
  const tz = held ? held.u.g.position.z : cr.z;
  const top = held ? held.u.g.position.y + PACK.HEIGHT + 0.15 : 4.5;
  cr.z += (tz - cr.z) * Math.min(1, dt * 6);
  cr.y += (top - cr.y) * Math.min(1, dt * 6);
  cr.g.position.z = cr.z;
  cr.spreader.position.y = cr.y;
  cr.cable.scale.y = Math.max(0.2, 8.25 - cr.y);

  for (const m of L.forks) m.step(drive * 0.4);
}
