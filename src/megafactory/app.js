// Megafactory twin: wires the simulation to the 3D view and the HUD.
import * as THREE from 'three';
import { createSim, step, status, kpis, utilisation, fork } from './sim.js';
import { NODES } from './plant.js';
import { Stage, VIEWS } from './render/stage.js';
import { buildBuilding } from './render/building.js';
import { buildEquipment, updateEquipment } from './render/equipment.js';
import { Items } from './render/items.js';
import { Hud, SPEEDS } from './hud.js';

const params = new URLSearchParams(location.search);
const WARMUP = 1440;       // a day to fill the plant, then KPIs count from Tue 06:00
const START = 3 * 1440;    // open on Thursday morning with two days of history

const stage = new Stage(document.getElementById('view'));
const building = buildBuilding(stage);
const eq = buildEquipment(stage);
const items = new Items(stage);
const sim = createSim({ seed: Number(params.get('seed') || 1), warmup: WARMUP });
step(sim, START);

let speed = Number(params.get('speed') || 4), paused = false;
const hud = new Hud({
  onSpeed: (v) => { speed = v; paused = false; hud.setSpeed(speed, paused); },
  onPause: () => { paused = !paused; hud.setSpeed(speed, paused); },
  onView: (k) => stage.view(k),
  onQuality: () => { stage.setQuality(stage.quality === 'high' ? 'low' : 'high'); hud.setQuality(stage.quality); },
  onClose: () => hud.select(sim, -1),
});
hud.setSpeed(speed, paused);
if (params.get('clean')) document.body.classList.add('clean');
if (params.get('quality') === 'low') { stage.setQuality('low'); hud.setQuality('low'); }
if (params.get('view') && VIEWS[params.get('view')]) {
  const v = VIEWS[params.get('view')];
  stage.camera.position.set(...v.pos); stage.controls.target.set(...v.target);
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
  else if (e.key === 'Escape') hud.select(sim, -1);
  else if (/^[1-9]$/.test(e.key)) { const k = Object.keys(VIEWS)[Number(e.key) - 1]; if (k) stage.view(k); }
});

// ---------------- floor stencils: name, plan and the measured cycle, refreshed every few seconds
function drawStencils() {
  for (const [n, st] of eq.stencils) {
    const d = NODES[n], nd = sim.nodes[n];
    const meas = nd.done ? nd.st.busy / nd.done : null;
    st.draw(d.label, [`PLAN ${d.time} MIN · ${d.mode.toUpperCase()}`, `ACTUAL ${meas ? meas.toFixed(1) : '–'} MIN · ${nd.done} DONE`]);
  }
}

// ---------------- main loop
let last = performance.now(), hudT = 0, stT = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const simDt = paused ? 0 : dt * speed;
  if (simDt > 0) step(sim, sim.t + simDt);
  items.sync(sim);
  updateEquipment(eq, sim, (n) => status(sim, n), paused ? 0 : dt, simDt);
  building.update(stage.camera);
  stage.update(dt);
  stage.render();
  hudT -= dt; stT -= dt;
  if (hudT <= 0) { hud.update(sim); hudT = 0.25; }
  if (stT <= 0) { drawStencils(); stT = 2; }
  requestAnimationFrame(frame);
}
drawStencils();
hud.update(sim);
requestAnimationFrame(frame);
const loading = document.getElementById('loading');
if (loading) { loading.style.opacity = '0'; setTimeout(() => loading.remove(), 700); }

// console access for checks and demos
window.megafactory = { sim, step, status, kpis, utilisation, fork, stage, view: (k) => stage.view(k), SPEEDS };
