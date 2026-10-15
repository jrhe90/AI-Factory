// Megafactory twin: wires the simulation to the 3D view and the HUD.
import * as THREE from 'three';
import { createSim, step, status, kpis, utilisation, fork, injectFault, clearFault } from './sim.js';
import { NODES, N } from './plant.js';
import { Stage, VIEWS } from './render/stage.js';
import { buildBuilding } from './render/building.js';
import { buildEquipment, updateEquipment, finalizeEquipment } from './render/equipment.js';
import { Items } from './render/items.js';
import { buildPaintShop } from './render/paintshop.js';
import { buildLogistics } from './render/logistics.js';
import { buildSite } from './render/site.js';
import { instancer } from './render/instancer.js';
import { Hud, SPEEDS } from './hud.js';

const params = new URLSearchParams(location.search);
const WARMUP = 1440;       // a day to fill the plant, then KPIs count from Tue 06:00
const START = 3 * 1440;    // open on Thursday morning with two days of history

const stage = new Stage(document.getElementById('view'));
instancer.attach(stage.scene);
const site = buildSite(stage);
const building = buildBuilding(stage);
const eq = buildEquipment(stage);
const paint = buildPaintShop(stage, eq);
finalizeEquipment(eq, stage.scene);
const items = new Items(stage);
const logistics = buildLogistics(stage);
const sim = createSim({ seed: Number(params.get('seed') || 1), warmup: WARMUP });
step(sim, START);

// ?until=PRIMER (or any node key): run on until a unit is mid-way through that section, for demos
if (params.get('until') && N[params.get('until')] != null) {
  const n = N[params.get('until')], d = NODES[n];
  const type = params.get('unit');
  const there = () => sim.nodes[n].items.some((it, i) => (!type || it.type === type) && (d.gunX != null
    ? Math.abs((d.path[0][0] + (Math.min(it.s0 + d.v * Math.max(0, sim.t - it.t0), d.L - i * d.pitch))) - d.gunX) < 1.5
    : d.kind === 'conveyor' ? true
    : d.kind === 'buffer' || n === N.TRUCK ? it.tin + it.mv > sim.t && sim.t > it.tin + it.mv * 0.55
    : it.ready > sim.t && sim.t > it.pStart + (it.ready - it.pStart) * 0.3));
  for (let k = 0; k < 4000 && !there(); k++) step(sim, sim.t + 0.25);
}
let speed = Number(params.get('speed') || 4), paused = params.get('paused') === '1';
const hud = new Hud({
  onSpeed: (v) => { speed = v; paused = false; hud.setSpeed(speed, paused); },
  onPause: () => { paused = !paused; hud.setSpeed(speed, paused); },
  onView: (k) => { stopFollow(); stage.view(k); },
  onFollow: (kind) => startFollow(kind),
  onStopFollow: () => stopFollow(),
  onSelect: (n) => { hud.select(sim, n); focusStation(n); },
  onFault: (n) => { injectFault(sim, n); hud.update(sim); },
  onClear: (n) => { clearFault(sim, n); hud.update(sim); },
  onFaults: (on) => { sim.p.faults = on; },
  onQuality: () => { stage.setQuality(stage.quality === 'high' ? 'low' : 'high'); hud.setQuality(stage.quality); },
  onClose: () => hud.select(sim, -1),
});
hud.setSpeed(speed, paused);
if (params.get('clean')) document.body.classList.add('clean');
if (params.get('quality') === 'low') { stage.setQuality('low'); hud.setQuality('low'); }
if (params.get('follow')) setTimeout(() => startFollow(params.get('follow') === 'pack' ? 'pack' : 'frame'), 50);
if (params.get('view') && VIEWS[params.get('view')]) {
  const v = VIEWS[params.get('view')];
  stage.camera.position.set(...v.pos); stage.controls.target.set(...v.target);
}

// ---------------- ride along with a frame (paint shop) or a pack (pack line → truck)
// The camera keeps whatever offset the viewer orbits to and moves with the unit.
let follow = null;
const ENTRY = { frame: [N.LOAD, N.PRE, N.DRY, N.PRIMER], pack: [N.CL, N.HV, N.MI] };
const OFFSET = { frame: [7, 5, 10.5], pack: [9, 6.5, 14] };
function nextUnit(kind) {
  const c = (items.live || []).filter(e => (kind === 'frame' ? e.u.type === 'frame' : e.it.type === 'pack') && ENTRY[kind].includes(e.n));
  c.sort((a, b) => ENTRY[kind].indexOf(a.n) - ENTRY[kind].indexOf(b.n) || (kind === 'frame' ? a.u.at.x - b.u.at.x : b.u.at.x - a.u.at.x));
  return c[0];
}
function stillFollowing(kind, e) {
  return e && (kind === 'frame' ? NODES[e.n].hang : e.it.type === 'pack');
}
function lockOn(kind, e) {
  follow = { kind, id: e.it.id, last: e.u.at.clone() };
  const p = e.u.at, o = OFFSET[kind];
  stage.flyTo([p.x, p.y + 1.6, p.z], [p.x + o[0], p.y + o[1], p.z + o[2]], 1.4);
}
function startFollow(kind = 'frame') { const e = nextUnit(kind); if (e) lockOn(kind, e); }
function stopFollow() { follow = null; hud.setFollow(null); }
function updateFollow() {
  if (!follow) return;
  let e = items.live.find(x => x.it.id === follow.id);
  if (!stillFollowing(follow.kind, e)) {
    const nx = nextUnit(follow.kind);
    if (!nx) return;
    lockOn(follow.kind, nx);
    e = nx;
  }
  const d = e.u.at.clone().sub(follow.last);
  follow.last.copy(e.u.at);
  stage.camera.position.add(d);
  stage.controls.target.add(d);
  if (stage.tween) { stage.tween.p1.add(d); stage.tween.t1.add(d); }
  hud.setFollow(`Following ${e.it.name} · ${NODES[e.n].label}`);
}

// fly the camera to a station picked from the list
function focusStation(n) {
  const p = eq.picks.find(p => p.n === n);
  if (!p) return;
  stopFollow();
  const c = p.box.getCenter(new THREE.Vector3()), size = p.box.getSize(new THREE.Vector3()).length();
  const r = Math.max(14, size * 1.4);
  stage.flyTo([c.x, Math.max(1, c.y - 1), c.z], [c.x + r * 0.45, c.y + r * 0.55, c.z + r * 0.8], 1.2);
}

// ---------------- picking stations
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
function pick(ev) {
  const r = stage.renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, stage.camera);
  let best = -1, bd = Infinity;
  for (const p of eq.picks) {
    if (ray.ray.intersectBox(p.box, hit)) {
      const d = hit.distanceTo(ray.ray.origin);
      if (d < bd) { bd = d; best = p.n; }
    }
  }
  return best;
}
let down = null;
stage.renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
stage.renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
  hud.select(sim, pick(e));
});
stage.renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.buttons) { hud.showTip(0, 0, sim, -1); return; }
  hud.showTip(e.clientX, e.clientY, sim, pick(e));
});
stage.renderer.domElement.addEventListener('pointerleave', () => hud.showTip(0, 0, sim, -1));

addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea')) return;
  if (e.key === ' ') { e.preventDefault(); paused = !paused; hud.setSpeed(speed, paused); }
  else if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('clean');
  else if (e.key === 'Escape') { hud.select(sim, -1); stopFollow(); }
  else if (e.key === 'f' || e.key === 'F') { follow ? stopFollow() : startFollow('frame'); }
  else if (e.key === 'g' || e.key === 'G') { follow ? stopFollow() : startFollow('pack'); }
  else if (e.key === 'l' || e.key === 'L') hud.toggleStations();
  else if (/^[0-9]$/.test(e.key)) { const k = Object.keys(VIEWS)[(Number(e.key) + 9) % 10]; if (k) { stopFollow(); stage.view(k); } }
});

// ---------------- floor stencils: name, plan and the measured cycle, refreshed every few seconds
function drawStencils() {
  for (const [n, st] of eq.stencils) {
    const d = NODES[n], nd = sim.nodes[n];
    const meas = nd.done ? nd.st.busy / nd.done : null;
    st.draw(d.label, [`PLAN ${d.time} MIN · ${d.mode.toUpperCase()}`, `ACTUAL ${meas ? meas.toFixed(1) : '–'} MIN · ${nd.done} DONE`]);
  }
  eq.stencilAtlas.commit();
}

// ---------------- main loop
let last = performance.now(), hudT = 0, stT = 0;
const perf = { cpu: 0, fps: 0 };   // CPU ms per frame for sim + scene updates (excludes GPU render)
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const simDt = paused ? 0 : dt * speed;
  const c0 = performance.now();
  if (simDt > 0) step(sim, sim.t + simDt);
  items.sync(sim);
  const statusOf = (n) => status(sim, n);
  const rdt = paused ? 0 : dt;
  updateEquipment(eq, sim, statusOf, rdt, simDt, items.live);
  paint.update(sim, rdt, simDt, items.live, statusOf);
  logistics.update(sim, items.live, rdt, simDt);
  site.update(Math.min(simDt / 5, rdt * 3), (((sim.t + 360) % 1440) + 1440) % 1440 / 60);
  instancer.sync();
  updateFollow();
  perf.cpu = perf.cpu * 0.95 + (performance.now() - c0) * 0.05;
  perf.fps = perf.fps * 0.95 + (dt > 0 ? 1 / dt : 0) * 0.05;
  building.update(stage.camera);
  stage.update(dt);
  stage.render();
  hudT -= dt; stT -= dt;
  if (hudT <= 0) { hud.update(sim); hudT = 0.25; }
  if (stT <= 0) { drawStencils(); stT = 3; }
  requestAnimationFrame(frame);
}
drawStencils();
hud.update(sim);
requestAnimationFrame(frame);
const loading = document.getElementById('loading');
if (loading) { loading.style.opacity = '0'; setTimeout(() => loading.remove(), 700); }

// console access for checks and demos
window.megafactory = { sim, step, status, kpis, utilisation, fork, injectFault, stage, items, paint, logistics, site, view: (k) => stage.view(k), follow: startFollow, perf, SPEEDS };
