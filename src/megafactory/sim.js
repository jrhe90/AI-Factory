// Megafactory flow simulation.
// Event-driven, time in minutes. The whole state is plain data (no three.js objects), so a
// running plant can be structuredClone()'d and forked later. Randomness is hash-based: every
// draw is keyed by (seed, stream, entity, index), so the same seed always gives the same run
// and forks share the same breakdowns and defects.
import { NODES, N, pointAt } from './plant.js';

export const DEFAULTS = {
  cvManual: 0.15,       // lognormal sd / mean for manual work
  cvAuto: 0.03,         // normal sd / mean for automatic work (truncated ±3σ)
  carriers: 14,         // power-and-free carriers in the paint loop
  mtbf: 2400, mttr: 45, // station breakdowns (min)
  boothMtbf: 1800, boothMttr: 35,
  paintDefect: 0.05,    // share of carriers rejected at paint inspection
  touchFix: 0.7,        // share of rejects fixed by spot repair (the rest are stripped and recoated)
  eolFail: 0.06, modFail: 0.03,
  retest: 0.6,          // a failed test is repeated at this share of the cycle
  mwhPerPack: 3.9,
};

const S_PT = 1, S_TEST = 2, S_FAIL = 3, S_TTR = 4, S_DEF = 5, S_FIX = 6, S_TRUCK = 7;
const EPS = 1e-7;

// ------------------------------------------------------------------ randomness
export function rnd(seed, a, b = 0, c = 0) {
  let h = Math.imul((seed | 0) ^ 0x3c6ef372, 0x9e3779b1);
  for (const v of [a, b, c]) {
    h = Math.imul(h ^ (v | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}
function gauss(seed, a, b, c) {
  const u1 = Math.max(1e-12, rnd(seed, a, b, c)), u2 = rnd(seed, a, b, c + 7919);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
function lognormal(mean, cv, z) {
  const s2 = Math.log(1 + cv * cv);
  return mean * Math.exp(-s2 / 2 + Math.sqrt(s2) * z);
}
const expo = (mean, u) => -mean * Math.log(1 - u);

// ------------------------------------------------------------------ event heap (min-heap on t, then seq)
function push(s, t, k, n = -1) {
  const h = s.heap, e = { t, q: s.seq++, k, n };
  h.push(e);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (!less(h[i], h[p])) break;
    [h[i], h[p]] = [h[p], h[i]];
    i = p;
  }
}
const less = (a, b) => a.t < b.t || (a.t === b.t && a.q < b.q);
function pop(s) {
  const h = s.heap, top = h[0], last = h.pop();
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < h.length && less(h[l], h[m])) m = l;
      if (r < h.length && less(h[r], h[m])) m = r;
      if (m === i) break;
      [h[i], h[m]] = [h[m], h[i]];
      i = m;
    }
  }
  return top;
}
const WAKE = 0, FAIL = 1, REPAIR = 2, TRUCK = 3;

// ------------------------------------------------------------------ create
export function createSim({ seed = 1, params = {}, warmup = 0 } = {}) {
  const s = {
    t: 0, seed, p: { ...DEFAULTS, ...params }, seq: 0, nextId: 1, heap: [],
    nodes: NODES.map(() => ({ items: [], down: false, downUntil: 0, fails: 0, done: 0, st: { busy: 0, blocked: 0, starved: 0, down: 0 } })),
    nextLoad: 'frame', trucks: 0, truckN: 0,
    log: [], kpi: null,
  };
  resetKpi(s);
  NODES.forEach((d, n) => { if (d.fail) scheduleFail(s, n, 0); });
  push(s, 30, TRUCK);
  flow(s);
  if (warmup > 0) { step(s, warmup); resetKpi(s); }
  return s;
}

export function resetKpi(s) {
  s.kpi = { t0: s.t, built: 0, shipped: 0, builtLog: [], painted: 0, inspected: 0, rejects: 0, recoats: 0,
            eolTested: 0, eolFirstPass: 0, trays: 0 };
  s.nodes.forEach(nd => { nd.st = { busy: 0, blocked: 0, starved: 0, down: 0 }; nd.done = 0; });
}

function note(s, kind, n, msg) {
  s.log.push({ t: s.t, kind, n, msg });
  if (s.log.length > 60) s.log.shift();
}

// ------------------------------------------------------------------ breakdowns
function scheduleFail(s, n, from) {
  const d = NODES[n], nd = s.nodes[n];
  const mtbf = d.booth ? s.p.boothMtbf : s.p.mtbf;
  push(s, from + expo(mtbf, rnd(s.seed, S_FAIL, n, nd.fails)), FAIL, n);
}
function breakDown(s, n) {
  const d = NODES[n], nd = s.nodes[n];
  const mttr = d.booth ? s.p.boothMttr : s.p.mttr;
  const ttr = lognormal(mttr, 0.5, gauss(s.seed, S_TTR, n, nd.fails));
  nd.fails++;
  nd.down = true;
  nd.downUntil = s.t + ttr;
  if (d.kind === 'conveyor') {
    // the whole section stops: freeze every unit where it is until the repair
    nd.items.forEach((it, i) => { it.s0 = convPos(s, n, it, i); it.t0 = Math.max(it.t0, nd.downUntil); });
  } else {
    for (const it of nd.items) if (it.ready > s.t) { it.ready += ttr; push(s, it.ready, WAKE); }
  }
  push(s, nd.downUntil, REPAIR, n);
  note(s, 'fail', n, `${d.label} down · ~${Math.round(ttr)} min`);
}

// ------------------------------------------------------------------ conveyors
// A unit on a conveyor is at s0 + v·(t − t0), stopped `pitch` behind the unit ahead (or at the
// end of the track for the head). When the head leaves, the others are re-based so they glide
// up from where they stood instead of jumping.
export function convPos(s, n, it, idx, t = s.t) {
  const d = NODES[n];
  return Math.min(it.s0 + d.v * Math.max(0, t - it.t0), d.L - idx * d.pitch);
}
function wakeHead(s, n) {
  const d = NODES[n], it = s.nodes[n].items[0];
  if (it) push(s, Math.max(s.t, it.t0) + Math.max(0, d.L - it.s0) / d.v, WAKE);
}

function isReady(s, n, it, idx) {
  const d = NODES[n];
  if (d.kind === 'conveyor') return idx === 0 && convPos(s, n, it, 0) >= d.L - EPS;
  return it.ready <= s.t + EPS;
}

// ------------------------------------------------------------------ process times
function procTime(s, n, it) {
  const d = NODES[n];
  const mean = d.times?.[it.type] ?? d.time;
  const z = gauss(s.seed, S_PT, n, it.id * 16 + (it.visits % 16));
  return d.mode === 'manual' ? lognormal(mean, s.p.cvManual, z) : mean * (1 + s.p.cvAuto * Math.max(-3, Math.min(3, z)));
}

// ------------------------------------------------------------------ capacity
export const paintWip = (s) => NODES.reduce((a, d, n) => a + (d.hang ? s.nodes[n].items.length : 0), 0);

function readyCount(s, n) {
  let c = 0;
  s.nodes[n].items.forEach((it, i) => { if (isReady(s, n, it, i)) c++; });
  return c;
}

function canAccept(s, n) {
  const d = NODES[n], nd = s.nodes[n];
  if (nd.down) return false;
  switch (d.kind) {
    case 'sink': return true;
    case 'truck': return nd.items.length === 0 && s.trucks > 0;
    case 'station':
      if (nd.items.length) return false;
      if (d.consume && readyCount(s, N[d.consume.from]) < d.consume.n) return false;
      return true;
    case 'buffer': return nd.items.length < d.cap;
    case 'conveyor': {
      if (nd.items.length >= d.cap) return false;
      const last = nd.items[nd.items.length - 1];
      if (!last) return true;
      const pos = convPos(s, n, last, nd.items.length - 1);
      if (pos >= d.pitch - EPS) return true;
      // the last unit is still clearing the entrance: wake when it has, if it is moving freely
      if (d.L - (nd.items.length - 1) * d.pitch >= d.pitch) push(s, Math.max(s.t, last.t0) + (d.pitch - last.s0) / d.v, WAKE);
      return false;
    }
  }
  return false;
}

// ------------------------------------------------------------------ routing
function route(s, n, it) {
  const d = NODES[n];
  switch (d.route) {
    case 'inspect': return it.defect ? 'REPAIR' : 'OUT';
    case 'repair': return it.fixed ? 'OUT' : 'RECOAT';
    case 'drop': return it.type === 'doors' ? 'DOORBUF' : 'CL';
  }
  return d.next ?? null;
}

// ------------------------------------------------------------------ moving units
function enter(s, n, it) {
  const d = NODES[n], nd = s.nodes[n];
  it.node = n;
  it.tin = s.t;
  it.visits = (it.visits || 0) + 1;
  it.mv = d.kind === 'conveyor' ? 0 : (d.move || 0);
  switch (d.kind) {
    case 'sink':
      if (n === N.SHIPPED) { s.kpi.shipped++; note(s, 'ship', n, `${it.name} shipped`); }
      return;
    case 'conveyor':
      it.s0 = 0; it.t0 = s.t;
      nd.items.push(it);
      if (nd.items.length === 1) wakeHead(s, n);
      return;
    case 'buffer':
      it.ready = s.t + it.mv;
      nd.items.push(it);
      push(s, it.ready, WAKE);
      return;
    default: { // station, truck
      let dur = procTime(s, n, it);
      it.pStart = s.t + it.mv;
      it.pDur = dur;
      it.failAt = null;
      if (d.test && rnd(s.seed, S_TEST, it.id, n) < s.p[d.test]) {
        it.failAt = it.pStart + dur;
        dur += dur * s.p.retest;
      }
      if (n === N.INSP) {
        it.defect = rnd(s.seed, S_DEF, it.id, it.visits) < s.p.paintDefect;
        s.kpi.inspected++;
        if (it.defect) { s.kpi.rejects++; note(s, 'reject', n, `${it.name} rejected at paint inspection`); }
      }
      if (n === N.REPAIR) it.fixed = rnd(s.seed, S_FIX, it.id, it.visits) < s.p.touchFix;
      if (n === N.CL) { it.type = 'pack'; it.name = 'MP-' + String(it.serial).padStart(4, '0'); }
      if (n === N.TRUCK) s.trucks--;
      if (n === N.CRANE) { s.kpi.built++; s.kpi.builtLog.push(s.t); if (s.kpi.builtLog.length > 40) s.kpi.builtLog.shift(); }
      it.ready = it.pStart + dur;
      nd.items.push(it);
      push(s, it.ready, WAKE);
      if (d.consume) consume(s, n, it);
    }
  }
}

function consume(s, n, it) {
  const { from, n: count } = NODES[n].consume, src = s.nodes[N[from]];
  it.consumed = (it.consumed || 0);
  for (let k = 0; k < count; k++) {
    const idx = src.items.findIndex((u, i) => isReady(s, N[from], u, i));
    src.items.splice(idx, 1);
    it.consumed++;
  }
  if (from === 'RACK') s.kpi.trays += count;
}

function leave(s, n, idx) {
  const d = NODES[n], nd = s.nodes[n];
  const it = nd.items.splice(idx, 1)[0];
  nd.done++;
  if (d.coat) it.coat = d.coat;
  if (n === N.INSP && !it.defect && !it.recoated) s.kpi.painted++;
  if (n === N.REPAIR && !it.fixed) { it.coat = 'stripped'; it.recoated = true; s.kpi.recoats++; }
  if (n === N.EOL) { s.kpi.eolTested++; if (!it.failAt) s.kpi.eolFirstPass++; }
  if (d.kind === 'conveyor') {
    // re-base the units behind so they glide up into the freed space
    nd.items.forEach((u, i) => { u.s0 = convPos(s, n, u, i + 1); u.t0 = Math.max(u.t0, s.t); });
    wakeHead(s, n);
  }
  return it;
}

function newItem(s, type) {
  const id = s.nextId++;
  const it = { id, type, serial: id, name: (type === 'tray' ? 'MT-' : type === 'doors' ? 'DK-' : 'BW-') + String(id).padStart(4, '0'),
               coat: 'bare', visits: 0, tNew: s.t };
  return it;
}

function release(s, n) {
  const d = NODES[n], nd = s.nodes[n];
  if (!nd.items.length || nd.down) return false;
  const it = nd.items[0];
  if (!isReady(s, n, it, 0)) return false;
  const key = route(s, n, it);
  if (!key) return false;
  const to = N[key];
  if (NODES[to].pull) return false;   // the destination picks what it takes
  if (!canAccept(s, to)) return false;
  enter(s, to, leave(s, n, 0));
  return true;
}

// Load & Hang: strip-and-recoat units first, then alternate frames and door kits (one of each per pack)
function pullLoad(s, n) {
  const d = NODES[n];
  if (!canAccept(s, n) || paintWip(s) >= s.p.carriers) return false;
  const headReady = (k) => {
    const src = N[k], it = s.nodes[src].items[0];
    return it && !s.nodes[src].down && isReady(s, src, it, 0) ? src : -1;
  };
  let src = headReady('RECOAT');
  if (src < 0) {
    // Frames and door kits share one FIFO rail, so keep them within one of each other:
    // a surplus of either would park at Drop & Unload and block the other behind it.
    const { frames, doors } = paintMix(s);
    const order = [];
    if (doors <= frames && doors < frames + 1) order.push('DOORKIT');
    if (frames <= doors) order.push('BIW_OUT');
    if (s.nextLoad === 'frame') order.reverse();
    for (const k of order) { src = headReady(k); if (src >= 0) break; }
    if (src >= 0) s.nextLoad = src === N.BIW_OUT ? 'doors' : 'frame';
  }
  if (src < 0) return false;
  enter(s, n, leave(s, src, 0));
  return true;
}

// Frames still waiting for their doors (on the rail or on the pack line before Enclosure &
// Doors) against door kits on their way (on the rail or in the door buffer)
const NEED_DOORS = ['CL', 'HV', 'MI', 'TH'].map(k => N[k]);
function paintMix(s) {
  let frames = 0, doors = s.nodes[N.DOORBUF].items.length;
  NODES.forEach((d, n) => {
    if (!d.hang) return;
    for (const it of s.nodes[n].items) it.type === 'doors' ? doors++ : frames++;
  });
  for (const n of NEED_DOORS) frames += s.nodes[n].items.length;
  return { frames, doors };
}

function feed(s, n) {
  const d = NODES[n], to = N[d.next];
  if (NODES[to].pull || !canAccept(s, to)) return false;
  enter(s, to, newItem(s, d.make));
  return true;
}

function flow(s) {
  for (let guard = 0; guard < 400; guard++) {
    let moved = false;
    for (let n = NODES.length - 1; n >= 0; n--) {
      const d = NODES[n];
      if (d.kind === 'sink') continue;
      if (d.kind === 'source') { moved = feed(s, n) || moved; continue; }
      if (d.pull) moved = pullLoad(s, n) || moved;
      moved = release(s, n) || moved;
    }
    if (!moved) return;
  }
}

// ------------------------------------------------------------------ time
export function status(s, n) {
  const d = NODES[n], nd = s.nodes[n];
  if (nd.down) return 'down';
  if (!nd.items.length) return 'starved';
  if (d.kind === 'conveyor') return isReady(s, n, nd.items[0], 0) ? 'blocked' : 'busy';
  return nd.items[0].ready > s.t + EPS ? 'busy' : 'blocked';
}

function advance(s, t) {
  const dt = t - s.t;
  if (dt <= 0) return;
  NODES.forEach((d, n) => {
    if (d.kind === 'station' || d.kind === 'conveyor' || d.kind === 'truck') s.nodes[n].st[status(s, n)] += dt;
  });
  s.t = t;
}

function handle(s, e) {
  if (e.k === FAIL) {
    if (!s.nodes[e.n].down) breakDown(s, e.n);
  } else if (e.k === REPAIR) {
    const nd = s.nodes[e.n];
    if (nd.down && nd.downUntil <= s.t + EPS) {
      nd.down = false;
      scheduleFail(s, e.n, s.t);
      if (NODES[e.n].kind === 'conveyor') wakeHead(s, e.n);
      note(s, 'repair', e.n, `${NODES[e.n].label} back in service`);
    }
  } else if (e.k === TRUCK) {
    s.trucks = Math.min(3, s.trucks + 1);
    const stock = s.nodes[N.LOT].items.length;
    const [lo, hi] = stock > 40 ? [40, 60] : stock < 12 ? [85, 120] : [70, 100];
    push(s, s.t + lo + (hi - lo) * rnd(s.seed, S_TRUCK, s.truckN++), TRUCK);
  }
}

export function step(s, until) {
  while (s.heap.length && s.heap[0].t <= until) {
    const e = pop(s);
    advance(s, e.t);
    handle(s, e);
    flow(s);
  }
  advance(s, until);
}

// ------------------------------------------------------------------ reading the state
export function fork(s) { return structuredClone(s); }

// Where every unit is: [{ it, n, x, z, rot, idx, p }] with p = progress through the node (0..1)
export function placeItems(s) {
  const out = [];
  s.nodes.forEach((nd, n) => {
    const d = NODES[n];
    nd.items.forEach((it, i) => {
      let x, z, rot = 0, y = null, p = 0;
      if (d.kind === 'conveyor') {
        const pos = convPos(s, n, it, i);
        [x, z, rot] = pointAt(d.path, pos);
        if (d.sideways) rot += Math.PI / 2;
        p = pos / d.L;
      } else if (d.kind === 'buffer') {
        const sl = d.slots[i % d.slots.length];
        [x, z] = sl; y = sl[2] ?? null;
        p = 1;
      } else {
        [x, z] = d.pos;
        p = it.pDur ? Math.max(0, Math.min(1, (s.t - it.pStart) / (it.ready - it.pStart || 1))) : 1;
      }
      const mf = it.mv > 0 ? Math.max(0, Math.min(1, (s.t - it.tin) / it.mv)) : 1;
      out.push({ it, n, x, z, y, rot, idx: i, p, mf });
    });
  });
  return out;
}

export function kpis(s) {
  const k = s.kpi, hrs = Math.max(1e-6, (s.t - k.t0) / 60);
  const log = k.builtLog;
  const takt = log.length >= 3 ? (log[log.length - 1] - log[0]) / (log.length - 1) : null;
  return {
    built: k.built, shipped: k.shipped,
    perDay: k.built / hrs * 24,
    takt,
    gwhYear: takt ? (525600 / takt) * s.p.mwhPerPack / 1000 : null,
    paintWip: paintWip(s),
    rack: s.nodes[N.RACK].items.length,
    lot: s.nodes[N.LOT].items.length,
    doors: s.nodes[N.DOORBUF].items.length,
    paintFpy: k.inspected ? 1 - k.rejects / k.inspected : 1,
    eolFpy: k.eolTested ? k.eolFirstPass / k.eolTested : 1,
    recoats: k.recoats,
  };
}

// share of time a node spent in each state since the last KPI reset
export function utilisation(s, n) {
  const st = s.nodes[n].st, tot = st.busy + st.blocked + st.starved + st.down || 1;
  return { busy: st.busy / tot, blocked: st.blocked / tot, starved: st.starved / tot, down: st.down / tot };
}
