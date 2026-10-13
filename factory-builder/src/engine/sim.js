// Discrete-time flow simulation of a project.
//
// Parts are created by sources, wait in buffers/storage, are processed one at a time by stations
// and leave at sinks. Links move them: conveyors (with accumulation), manual hand-offs, or
// vehicle transport, where an idle AGV/forklift is dispatched along the drawn route network.
// Stations that need operators stop when their crew is on break; machines fail by MTBF/MTTR.
import { CATALOG_BY_TYPE } from '../library/catalog.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const CONVEYOR_SPEED = 0.5; // m/s
const ITEM_GAP = 0.8; // m between parts on a conveyor
const HANDLE_TIME = 4; // s to load or unload a vehicle
const SAMPLE_EVERY = 300; // s of sim time between dashboard history samples

export class Simulation {
  // geom(id) -> { entry:[x,y,z], exit:[x,y,z], work:[x,y,z] } in world space
  constructor(project, geom) {
    this.project = project;
    this.geom = geom;
    this.t = 0;
    this.items = new Set();
    this.serial = 0;
    this.finished = 0;
    this.leadTimes = [];
    this.doneTimes = [];
    this.nodes = new Map();
    this.links = new Map();
    this.vehicles = [];
    this.operators = [];
    this.events = [];
    this.eventLog = [];
    this.breakdowns = 0;
    this.history = [];
    this.nextSample = 0;
    this.breakZones = project.zones.filter((z) => z.kind === 'break');

    for (const o of project.objects) {
      const def = CATALOG_BY_TYPE[o.type];
      if (!def) continue;
      const props = { ...def.defaults, ...o.props };
      if (['source', 'sink', 'buffer', 'station', 'storage'].includes(def.role)) {
        this.nodes.set(o.id, {
          id: o.id, obj: o, role: def.role, props, items: [], reserved: 0, out: [], rr: 0, state: 'idle', reason: '',
          stats: { busy: 0, idle: 0, blocked: 0, down: 0, off: 0 }, processed: 0, down: 0, timer: rnd(0, props.interval ?? 10),
          holding: null, crew: [], g: geom(o.id),
        });
      } else if (def.role === 'vehicle') {
        this.vehicles.push({
          id: o.id, obj: o, x: o.x, z: o.z, heading: ((o.rot ?? 0) * Math.PI) / 180, home: [o.x, o.z], speed: props.speed ?? 1.5,
          state: 'idle', path: [], job: null, load: null, timer: 0, busyTime: 0, trips: 0, moving: false,
        });
      } else if (def.role === 'operator') {
        this.operators.push({ id: o.id, obj: o, stationId: props.stationId, x: o.x, z: o.z, home: [o.x, o.z], heading: ((o.rot ?? 0) * Math.PI) / 180, homeHeading: ((o.rot ?? 0) * Math.PI) / 180, state: 'atStation', target: null, walking: false });
      }
    }
    for (const op of this.operators) this.nodes.get(op.stationId)?.crew.push(op);
    for (const l of project.links) {
      const a = this.nodes.get(l.from);
      const b = this.nodes.get(l.to);
      if (!a || !b || a.role === 'sink' || b.role === 'source') continue;
      const p0 = a.g.exit;
      const p1 = b.g.entry;
      const length = Math.max(0.5, Math.hypot(p1[0] - p0[0], p1[2] - p0[2]));
      const link = { id: l.id, kind: l.kind, from: a, to: b, items: [], pickup: [], length, cap: Math.max(1, Math.floor(length / ITEM_GAP)), p0, p1 };
      this.links.set(l.id, link);
      a.out.push(link);
    }
    this.graph = buildRouteGraph(project.routes);
  }

  // ---------------------------------------------------------------- clock & shifts
  clock() {
    const { start = 6 } = this.project.shifts ?? {};
    const mins = Math.floor(this.t / 60) + start * 60;
    const day = Math.floor(mins / 1440) + 1;
    return `Day ${day} · ${String(Math.floor((mins % 1440) / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  onBreak() {
    const s = this.project.shifts ?? {};
    const len = (s.length ?? 8) * 3600;
    const into = this.t % len;
    return (s.breaks ?? []).some((b) => into >= b.at * 3600 && into < b.at * 3600 + b.minutes * 60);
  }

  // ---------------------------------------------------------------- flow
  canAccept(n) {
    if (n.role === 'sink') return true;
    if (n.role === 'buffer' || n.role === 'storage') return n.items.length + n.reserved < (n.props.capacity ?? 6);
    if (n.role === 'station') return n.down <= 0 && n.items.length + n.reserved < 1;
    return false;
  }
  newItem(src) {
    const it = { id: ++this.serial, color: src.props.itemColor ?? null, created: this.t, at: src, pos: [0, 0, 0] };
    this.items.add(it);
    return it;
  }
  receive(n, it) {
    n.reserved = Math.max(0, n.reserved - 1);
    it.at = n;
    if (n.role === 'sink') {
      this.items.delete(it);
      this.finished++;
      n.processed++;
      this.leadTimes.push(this.t - it.created);
      if (this.leadTimes.length > 200) this.leadTimes.shift();
      this.doneTimes.push(this.t);
      if (this.doneTimes.length > 200) this.doneTimes.shift();
      return;
    }
    if (n.role === 'station') {
      it.t = 0;
      it.dur = Math.max(1, n.props.cycleTime ?? 60) * rnd(0.9, 1.1);
      it.done = false;
    }
    if (n.role === 'storage') it.readyAt = this.t + (n.props.handling ?? 0);
    else it.readyAt = this.t;
    n.items.push(it);
  }
  tryPush(n, it) {
    const k = n.out.length;
    for (let i = 0; i < k; i++) {
      const link = n.out[(n.rr + i) % k];
      if (link.kind === 'conveyor') {
        if (link.items.length >= link.cap || link.items.some((x) => x.s < ITEM_GAP)) continue;
        it.s = 0;
        it.on = link;
        link.items.push(it);
      } else if (link.kind === 'manual') {
        if (!this.canAccept(link.to)) continue;
        link.to.reserved++;
        it.transit = { link, t: 0, dur: Math.max(2, link.length / 1.1) };
        link.items.push(it);
      } else {
        if (link.pickup.length >= 2) continue;
        it.assigned = false;
        link.pickup.push(it);
      }
      n.rr = (n.rr + i + 1) % k;
      n.processed += n.role === 'station' ? 0 : 1;
      return true;
    }
    return false;
  }

  stepNode(n, dt, onBreak) {
    const p = n.props;
    if (n.role === 'source') {
      if (!n.holding) {
        n.timer -= dt;
        if (n.timer <= 0) {
          n.holding = this.newItem(n);
          n.timer = Math.max(1, p.interval ?? 60) * rnd(0.85, 1.15);
        }
      }
      if (n.holding && this.tryPush(n, n.holding)) n.holding = null;
      n.state = n.holding ? 'blocked' : 'busy';
      n.reason = n.holding ? 'Waiting for space downstream' : '';
    } else if (n.role === 'buffer' || n.role === 'storage') {
      const it = n.items[0];
      if (it && it.readyAt <= this.t && this.tryPush(n, it)) n.items.shift();
      const full = n.items.length >= (p.capacity ?? 6);
      n.state = n.items.length ? (full ? 'blocked' : 'busy') : 'idle';
      n.reason = full ? 'Full' : '';
    } else if (n.role === 'station') {
      if (n.down > 0) {
        n.down -= dt;
        n.state = 'down';
        n.reason = 'Breakdown';
        if (n.down <= 0) this.log(`${n.obj.name} is running again`);
      } else {
        const need = p.operators ?? 0;
        let staffed = true;
        if (need > 0) {
          if (n.crew.length) {
            const present = n.crew.filter((o) => o.state === 'atStation').length;
            staffed = present >= need;
            n.reason = staffed ? '' : `Crew ${present}/${need}${onBreak ? ' (break)' : ''}`;
          } else {
            staffed = !onBreak;
            n.reason = staffed ? '' : 'Crew on break';
          }
        }
        const it = n.items[0];
        if (!staffed) n.state = 'off';
        else if (!it) {
          n.state = 'idle';
          n.reason = 'Waiting for parts';
        } else if (!it.done) {
          it.t += dt;
          if (it.t >= it.dur) it.done = true;
          n.state = 'busy';
          n.reason = '';
          if (p.mtbf > 0 && Math.random() < dt / (p.mtbf * 3600)) {
            n.down = Math.max(60, (p.mttr ?? 15) * 60 * rnd(0.5, 1.5));
            this.breakdowns++;
            this.log(`⚠ ${n.obj.name} broke down`, 'warn');
          }
        }
        if (it?.done && staffed) {
          if (this.tryPush(n, it)) {
            n.items.shift();
            n.processed++;
            n.state = 'idle';
          } else {
            n.state = 'blocked';
            n.reason = 'Waiting for space downstream';
          }
        }
      }
    }
    n.stats[n.state] = (n.stats[n.state] ?? 0) + dt;
  }

  stepLink(l, dt) {
    if (l.kind === 'conveyor') {
      const sorted = l.items.slice().sort((a, b) => b.s - a.s);
      let ahead = null;
      for (const it of sorted) {
        const limit = ahead ? ahead.s - ITEM_GAP : l.length;
        it.s = Math.max(it.s, Math.min(limit, it.s + CONVEYOR_SPEED * dt));
        ahead = it;
      }
      const lead = sorted[0];
      if (lead && lead.s >= l.length - 1e-3 && this.canAccept(l.to)) {
        l.items.splice(l.items.indexOf(lead), 1);
        l.to.reserved++;
        this.receive(l.to, lead);
      }
    } else if (l.kind === 'manual') {
      for (const it of l.items.slice()) {
        it.transit.t += dt / it.transit.dur;
        if (it.transit.t >= 1) {
          l.items.splice(l.items.indexOf(it), 1);
          it.transit = null;
          this.receive(l.to, it);
        }
      }
    }
  }

  // ---------------------------------------------------------------- vehicles
  dispatch() {
    for (const l of this.links.values()) {
      if (l.kind !== 'transport') continue;
      for (const it of l.pickup) {
        if (it.assigned || !this.canAccept(l.to)) continue;
        const from = [l.p0[0], l.p0[2]];
        const idle = this.vehicles.filter((v) => v.state === 'idle' || v.state === 'returning');
        if (!idle.length) return;
        idle.sort((a, b) => dist([a.x, a.z], from) - dist([b.x, b.z], from));
        const v = idle[0];
        it.assigned = true;
        l.to.reserved++;
        v.job = { link: l, item: it };
        v.path = this.route([v.x, v.z], from);
        v.state = 'toPickup';
      }
    }
  }
  route(a, b) {
    return routePath(this.graph, a, b);
  }
  stepVehicle(v, dt) {
    if (v.state !== 'idle') v.busyTime += dt;
    v.moving = false;
    if (v.state === 'loading' || v.state === 'unloading') {
      v.timer -= dt;
      if (v.timer > 0) return;
      const { link, item } = v.job;
      if (v.state === 'loading') {
        link.pickup.splice(link.pickup.indexOf(item), 1);
        v.load = item;
        v.path = this.route([v.x, v.z], [link.p1[0], link.p1[2]]);
        v.state = 'toDrop';
      } else {
        v.load = null;
        this.receive(link.to, item);
        v.job = null;
        v.trips++;
        v.path = this.route([v.x, v.z], v.home);
        v.state = 'returning';
      }
      return;
    }
    if (!v.path.length) {
      if (v.state === 'toPickup') {
        v.state = 'loading';
        v.timer = HANDLE_TIME;
      } else if (v.state === 'toDrop') {
        v.state = 'unloading';
        v.timer = HANDLE_TIME;
      } else if (v.state === 'returning') {
        v.state = 'idle';
      }
      return;
    }
    let budget = v.speed * dt;
    while (budget > 0 && v.path.length) {
      const [tx, tz] = v.path[0];
      const d = Math.hypot(tx - v.x, tz - v.z);
      if (d > 1e-3) {
        const want = Math.atan2(-(tz - v.z), tx - v.x);
        let diff = ((want - v.heading + Math.PI) % (Math.PI * 2)) - Math.PI;
        if (diff < -Math.PI) diff += Math.PI * 2;
        v.heading += diff * Math.min(1, dt * 6);
        v.moving = true;
      }
      if (d <= budget) {
        v.x = tx;
        v.z = tz;
        budget -= d;
        v.path.shift();
      } else {
        v.x += ((tx - v.x) / d) * budget;
        v.z += ((tz - v.z) / d) * budget;
        budget = 0;
      }
    }
  }

  // ---------------------------------------------------------------- operators
  stepOperators(dt, onBreak) {
    for (const op of this.operators) {
      op.walking = false;
      if (onBreak && op.state === 'atStation' && this.breakZones.length) {
        const z = nearestZone(this.breakZones, op.home);
        op.target = [z.cx + rnd(-z.w / 3, z.w / 3), z.cz + rnd(-z.d / 3, z.d / 3)];
        op.path = this.route([op.x, op.z], op.target);
        op.state = 'toBreak';
      } else if (onBreak && op.state === 'atStation') {
        op.state = 'onBreak';
      } else if (!onBreak && (op.state === 'onBreak' || op.state === 'toBreak')) {
        op.path = this.route([op.x, op.z], op.home);
        op.state = 'returning';
      }
      if (op.state === 'onBreak' && !this.breakZones.length && !onBreak) op.state = 'atStation';
      if (op.path?.length) {
        let budget = 1.3 * dt;
        while (budget > 0 && op.path.length) {
          const [tx, tz] = op.path[0];
          const d = Math.hypot(tx - op.x, tz - op.z);
          if (d > 1e-3) op.heading = Math.atan2(-(tz - op.z), tx - op.x);
          if (d <= budget) {
            op.x = tx;
            op.z = tz;
            budget -= d;
            op.path.shift();
          } else {
            op.x += ((tx - op.x) / d) * budget;
            op.z += ((tz - op.z) / d) * budget;
            budget = 0;
          }
          op.walking = true;
        }
      } else if (op.state === 'toBreak') op.state = 'onBreak';
      else if (op.state === 'returning') {
        op.state = 'atStation';
        op.heading = op.homeHeading;
      }
    }
  }

  log(text, kind = 'info') {
    const ev = { t: this.t, clock: this.clock(), text, kind };
    this.events.push(ev);
    this.eventLog.push(ev);
    if (this.eventLog.length > 40) this.eventLog.shift();
  }

  // One dashboard sample: output, rolling hourly rate, WIP, station states, vehicle use
  sample() {
    const states = { busy: 0, idle: 0, blocked: 0, down: 0, off: 0 };
    for (const n of this.nodes.values()) if (n.role === 'station') states[n.state] = (states[n.state] ?? 0) + 1;
    const h = this.history;
    const prev = h.length >= 12 ? h[h.length - 12] : h[0];
    const rate = prev && this.t > prev.t ? (this.finished - prev.finished) / ((this.t - prev.t) / 3600) : 0;
    const veh = this.vehicles.length ? this.vehicles.filter((v) => v.state !== 'idle').length / this.vehicles.length : 0;
    h.push({ t: this.t, finished: this.finished, rate, wip: this.items.size, states, veh });
    if (h.length > 2000) h.splice(0, h.length - 2000);
  }

  step(dt) {
    if (this.t >= this.nextSample) {
      this.sample();
      this.nextSample += SAMPLE_EVERY;
    }
    this.t += dt;
    const brk = this.onBreak();
    this.stepOperators(dt, brk);
    for (const n of this.nodes.values()) this.stepNode(n, dt, brk);
    for (const l of this.links.values()) this.stepLink(l, dt);
    this.dispatch();
    for (const v of this.vehicles) this.stepVehicle(v, dt);
  }

  // ---------------------------------------------------------------- visuals & KPIs
  layoutItems() {
    for (const n of this.nodes.values()) {
      const w = n.role === 'sink' ? n.g.entry : n.g.work;
      n.items.forEach((it, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        it.pos = [w[0] + (col - 1) * 0.55, w[1] + 0.2 + Math.floor(row / 2) * 0.4, w[2] + (row % 2) * 0.5];
      });
      if (n.holding) n.holding.pos = [n.g.exit[0], n.g.exit[1] + 0.2, n.g.exit[2]];
    }
    for (const l of this.links.values()) {
      const [a, b] = [l.p0, l.p1];
      if (l.kind === 'conveyor') {
        for (const it of l.items) {
          const k = Math.min(1, it.s / l.length);
          it.pos = [a[0] + (b[0] - a[0]) * k, 0.98, a[2] + (b[2] - a[2]) * k];
        }
      } else if (l.kind === 'manual') {
        for (const it of l.items) {
          const k = it.transit.t;
          it.pos = [a[0] + (b[0] - a[0]) * k, 1.0 + Math.sin(k * Math.PI) * 0.15, a[2] + (b[2] - a[2]) * k];
        }
      } else {
        l.pickup.forEach((it, i) => { it.pos = [a[0], 0.3 + i * 0.45, a[2]]; });
      }
    }
    for (const v of this.vehicles) if (v.load) v.load.pos = [v.x, 0.75, v.z];
  }

  stats() {
    const hours = this.t / 3600;
    const ts = this.doneTimes.slice(-30);
    const rate = ts.length >= 3 ? (ts.length - 1) / ((ts[ts.length - 1] - ts[0]) / 3600 || 1) : this.finished / Math.max(hours, 1e-6);
    let bottleneck = null;
    const stations = [];
    for (const n of this.nodes.values()) {
      if (n.role !== 'station') continue;
      const total = Object.values(n.stats).reduce((a, b) => a + b, 0) || 1;
      const util = n.stats.busy / total;
      const row = { id: n.id, name: n.obj.name, state: n.state, reason: n.reason, util, blocked: n.stats.blocked / total, starved: n.stats.idle / total, down: n.stats.down / total, off: n.stats.off / total, processed: n.processed };
      stations.push(row);
      if (!bottleneck || util > bottleneck.util) bottleneck = row;
    }
    const avgLead = this.leadTimes.length ? this.leadTimes.reduce((a, b) => a + b, 0) / this.leadTimes.length : null;
    return {
      t: this.t, clock: this.clock(), onBreak: this.onBreak(), finished: this.finished, rate: this.finished ? rate : 0, wip: this.items.size, avgLead,
      bottleneck: this.t > 120 ? bottleneck : null, stations,
      vehicles: this.vehicles.map((v) => ({ id: v.id, name: v.obj.name, state: v.state, util: this.t ? v.busyTime / this.t : 0, trips: v.trips })),
      waitingTransport: [...this.links.values()].reduce((a, l) => a + l.pickup.filter((i) => !i.assigned).length, 0),
      breakdowns: this.breakdowns, history: this.history.slice(), log: this.eventLog.slice(-8),
    };
  }
}

function nearestZone(zones, p) {
  let best = null;
  let bd = Infinity;
  for (const z of zones) {
    const xs = z.points.map((q) => q[0]);
    const zs = z.points.map((q) => q[1]);
    const c = { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cz: (Math.min(...zs) + Math.max(...zs)) / 2, w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs) };
    const d = Math.hypot(c.cx - p[0], c.cz - p[1]);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

// ---------------------------------------------------------------- route network
// Vertices of every route, joined along each route (one-way routes only forwards) and to
// any vertex or segment of another route within 1.5 m (crossings and junctions).
export function buildRouteGraph(routes) {
  const nodes = [];
  const byKey = new Map();
  const add = (p, shared = true) => {
    const key = `${Math.round(p[0] * 20)}|${Math.round(p[1] * 20)}`;
    if (shared && byKey.has(key)) return byKey.get(key);
    nodes.push({ p, edges: [] });
    byKey.set(key, nodes.length - 1);
    return nodes.length - 1;
  };
  const link = (a, b, oneWay) => {
    const w = dist(nodes[a].p, nodes[b].p);
    nodes[a].edges.push([b, w]);
    if (!oneWay) nodes[b].edges.push([a, w]);
  };
  const segs = [];
  for (const r of routes) {
    if (!r.points || r.points.length < 2) continue;
    let prev = null;
    for (const p of r.points) {
      const i = add([p[0], p[1]]);
      if (prev === i) continue;
      if (prev !== null) {
        link(prev, i, r.oneWay);
        segs.push({ a: prev, b: i, route: r.id, oneWay: r.oneWay });
      }
      prev = i;
      nodes[i].route = r.id;
    }
  }
  // Junctions: snap vertices onto nearby segments of other routes
  for (let i = 0; i < nodes.length; i++) {
    for (const s of segs) {
      if (s.route === nodes[i].route) continue;
      const [ax, az] = nodes[s.a].p;
      const [bx, bz] = nodes[s.b].p;
      const [px, pz] = nodes[i].p;
      const L2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / L2));
      const q = [ax + (bx - ax) * t, az + (bz - az) * t];
      if (dist(q, [px, pz]) > 1.5) continue;
      const j = add(q);
      link(s.a, j, s.oneWay);
      link(j, s.b, s.oneWay);
      link(i, j, false);
    }
  }
  return { nodes };
}

export function routePath(graph, a, b) {
  const { nodes } = graph;
  if (!nodes.length) return [b];
  const near = (p) => {
    let best = 0;
    let bd = Infinity;
    nodes.forEach((n, i) => {
      const d = dist(n.p, p);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return [best, bd];
  };
  const [s, ds] = near(a);
  const [e, de] = near(b);
  // Not worth a detour onto the network for short hops
  if (dist(a, b) < ds + de || dist(a, b) < 6) return [b];
  const D = new Array(nodes.length).fill(Infinity);
  const prev = new Array(nodes.length).fill(-1);
  const done = new Array(nodes.length).fill(false);
  D[s] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++) if (!done[i] && D[i] < Infinity && (u < 0 || D[i] < D[u])) u = i;
    if (u < 0 || u === e) break;
    done[u] = true;
    for (const [w, c] of nodes[u].edges) if (D[u] + c < D[w]) {
      D[w] = D[u] + c;
      prev[w] = u;
    }
  }
  if (D[e] === Infinity) return [b];
  const out = [];
  for (let u = e; u >= 0; u = prev[u]) out.unshift(nodes[u].p);
  return [...out, b];
}
