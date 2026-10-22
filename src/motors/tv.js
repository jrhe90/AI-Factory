// Production-office TV view of the motor plant twin: open motors.html?tv (or motors.html#tv).
// One fixed, high-level 3D view of the whole plant with problem zones lit up in the scene, four
// shift KPIs, a short "needs attention" list, output by hour, and a live close-up of the worst
// stoppage. Sized to be read on a 40" screen from 3–5 m; the normal UI is hidden.
import * as THREE from 'three';
import { PLAN_RATE, FACTORY_SEC } from './main.js';

const SHIFT_START_MIN = 6 * 60;
const SHIFT_LEN = 8 * 60;
const SHIFT_NAMES = ['A', 'B', 'C'];
const VIEW = { pos: [2, 204, 108], target: [2, 0, 4] };
const LINE_NAME = {
  press: 'Press', shaft: 'East 2 Shafts', rotor: 'East 1 Rotors', frame: 'East 3 Frames', bracket: 'Brackets',
  stator: 'Stator & VPI', asmA: 'Line A', asmB: 'Line B', rewind: 'Rewind',
};
// What the TV calls an area, and which lines it covers
const ZONES = [
  { id: 'press', name: 'Press shop', lines: ['press'] },
  { id: 'east', name: 'East lines', lines: ['rotor', 'shaft', 'frame'] },
  { id: 'bracket', name: 'Brackets', lines: ['bracket'] },
  { id: 'stator', name: 'Stator & VPI', lines: ['stator'] },
  { id: 'asmA', name: 'Line A', lines: ['asmA'] },
  { id: 'asmB', name: 'Line B', lines: ['asmB'], below: true },
  { id: 'rewind', name: 'Rewinding', lines: ['rewind'] },
];
const COLOR = { crit: 0xff5b52, warn: 0xf2aa3c };

const wanted = new URLSearchParams(location.search).has('tv') || location.hash === '#tv';
if (wanted && window.motorPlant) startTV(window.motorPlant);

function startTV(mp) {
  const { sim, lines, stations, stock, ai, snapshot, renderer, camera, controls, scene, plant, breakStation } = mp;
  document.body.classList.add('tv');
  const font = document.createElement('link');
  font.rel = 'stylesheet';
  font.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&display=swap';
  document.head.appendChild(font);

  // A dark wall screen with a fixed bird's-eye view: nothing to orbit, nothing moves but the plant
  scene.background = new THREE.Color(0x0d1317);
  scene.fog = null;
  plant.labels.visible = false;
  controls.enabled = false;
  camera.position.set(...VIEW.pos);
  controls.target.set(...VIEW.target);
  controls.update();

  // ------------------------------------------------------------------ overlay
  const kpi = (id, label, unit) => `
    <div class="tv-kpi">
      <div class="k-top"><label>${label}</label><span class="tv-chip" id="tv-c-${id}"></span></div>
      <div class="tv-val" id="tv-v-${id}"><span></span><small>${unit}</small></div>
      <div class="tv-sub" id="tv-s-${id}"><div></div><div></div></div>
    </div>`;
  const root = document.createElement('div');
  root.id = 'tv';
  root.innerHTML = `
    <header class="tv-top">
      <div class="tv-bar">
        <div class="tv-brand"><span class="tv-mark"></span><b>Motor Plant</b><span id="tv-shift"></span></div>
        <div class="tv-clock"><span class="tv-live"><i></i>LIVE</span><span id="tv-clock"></span></div>
      </div>
      <div class="tv-kpis">
        ${kpi('out', 'Shift output', 'motors')}${kpi('rate', 'Rate now', '/h')}${kpi('oee', 'OEE', '%')}${kpi('fpy', 'First-pass yield', '%')}
      </div>
    </header>
    <div id="tv-zones"></div>
    <div id="tv-pip" hidden>
      <div class="tv-pip-head"><small>LIVE</small><span id="tv-pip-title"></span></div>
      <div id="tv-pip-view"></div>
    </div>
    <aside class="tv-side">
      <section class="tv-card"><h2>Needs attention <small id="tv-attn-n"></small></h2><div id="tv-attn"></div></section>
      <section class="tv-card"><h2>Output by hour <small>dashed line = plan ${PLAN_RATE}/h</small></h2><svg id="tv-hours" viewBox="0 0 600 150"></svg></section>
    </aside>
    <nav id="tv-ctl">
      <button type="button" data-act="stop">Stop a station</button>
      <button type="button" data-act="full">Full screen</button>
      <a href="./motors.html">Exit TV view</a>
    </nav>`;
  document.body.appendChild(root);
  const $ = (id) => document.getElementById(id);
  const zonesEl = $('tv-zones');

  // ------------------------------------------------------------------ zones in the scene
  const tvGroup = new THREE.Group();
  const beacons = new THREE.Group();
  scene.add(tvGroup, beacons);
  const lineById = Object.fromEntries(lines.map((l) => [l.id, l]));
  const zones = ZONES.map((z) => {
    const sts = z.lines.flatMap((id) => lineById[id]?.stations ?? []);
    const box = new THREE.Box2();
    for (const st of sts) {
      const p = st.group.position;
      const r = Math.max(st.footW, st.footD) / 2 + 0.8;
      box.expandByPoint(new THREE.Vector2(p.x - r, p.z - r));
      box.expandByPoint(new THREE.Vector2(p.x + r, p.z + r));
    }
    const size = box.getSize(new THREE.Vector2());
    const c = box.getCenter(new THREE.Vector2());
    const mat = new THREE.MeshBasicMaterial({ color: COLOR.crit, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(size.x, size.y), mat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(c.x, 0.08, c.y);
    tvGroup.add(floor);
    const tag = document.createElement('div');
    tag.className = 'tv-tag';
    zonesEl.appendChild(tag);
    const anchor = new THREE.Vector3(c.x, 3, z.below ? box.max.y - 1 : box.min.y + 1);
    return { ...z, sts, mat, tag, anchor, state: { s: 'ok', sub: 'Running' } };
  });
  const shipTag = document.createElement('div');
  shipTag.className = 'tv-tag';
  zonesEl.appendChild(shipTag);
  const shipAnchor = new THREE.Vector3(-31, 3, 20);

  const beaconGeo = new THREE.CylinderGeometry(0.55, 0.55, 1, 20, 1, true).translate(0, 0.5, 0);
  const beaconOf = new Map();
  function beacon(st) {
    let b = beaconOf.get(st);
    if (!b) {
      b = new THREE.Mesh(beaconGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
      b.position.set(st.group.position.x, 0, st.group.position.z);
      beacons.add(b);
      beaconOf.set(st, b);
    }
    return b;
  }

  // ------------------------------------------------------------------ plant state
  const stopped = (st) => st.down && st.downKind !== 'maint';
  const inMaint = (st) => st.down && st.downKind === 'maint';
  const alerted = (st) => !st.down && !!st.ai?.alert;
  const where = (st) => `${LINE_NAME[st.line.id] ?? st.line.short} · ${st.cfg.name}`;
  const fmtRul = (h) => (h >= 2 ? `~${Math.round(h)} h` : `~${Math.max(1, Math.round(h * 60))} min`);
  const pad2 = (n) => String(n).padStart(2, '0');
  const hhmm = (m) => { m = ((Math.floor(m) % 1440) + 1440) % 1440; return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`; };
  const clockMin = () => SHIFT_START_MIN + (sim.time * FACTORY_SEC) / 60;

  const downSince = new Map();
  function trackDowns() {
    for (const st of stations) {
      if (st.down) { if (!downSince.has(st)) downSince.set(st, sim.time); } else downSince.delete(st);
    }
  }
  const downMin = (st) => Math.round(((sim.time - (downSince.get(st) ?? sim.time)) * FACTORY_SEC) / 60);

  const shift = { n: -1, base: 0, hourBase: [], bins: [] };
  function trackShift() {
    const m = clockMin() - SHIFT_START_MIN;
    const n = Math.floor(m / SHIFT_LEN);
    if (n !== shift.n) Object.assign(shift, { n, base: sim.built, hourBase: Array(8).fill(null), bins: Array(8).fill(0) });
    const h = Math.min(7, Math.floor((m - n * SHIFT_LEN) / 60));
    if (shift.hourBase[h] == null) shift.hourBase[h] = sim.built;
    shift.bins[h] = sim.built - shift.hourBase[h];
  }

  function zoneState(z) {
    const stop = z.sts.find(stopped);
    if (stop) return { s: 'crit', sub: `■ ${stop.cfg.name} stopped` };
    const maint = z.sts.find(inMaint);
    if (maint) return { s: 'warn', sub: `▲ Maintenance · ${maint.cfg.name}` };
    const al = z.sts.find(alerted);
    if (al) return { s: 'warn', sub: `▲ AI alert · ${al.cfg.name}` };
    return { s: 'ok', sub: 'Running' };
  }

  function attention() {
    const items = [];
    for (const st of stations) {
      if (stopped(st)) items.push({ s: 'crit', t: where(st), d: `Stopped ${downMin(st)} min · ${st.downCause.replace(/ — /g, ' · ')}`, o: -downMin(st) });
      else if (inMaint(st)) items.push({ s: 'warn', t: where(st), d: `${st.downCause.replace(/ — /g, ' · ')} · ${downMin(st)} min`, o: 50 });
    }
    for (const a of ai.alerts) {
      if (a.st.down) continue;
      items.push({ s: 'warn', t: where(a.st), d: `${a.st.ai.mode} · fails in ${fmtRul(a.rulH)}${a.st.maintPending ? ' · tech booked' : ''}`, o: 100 + a.rulH });
    }
    for (const b of Object.values(stock)) {
      if (b.count / b.cap < 0.15) items.push({ s: 'warn', t: `${b.name} running low`, d: `${b.count} left of ${b.cap} · assembly may starve`, o: 80 + b.count });
    }
    const rank = { crit: 0, warn: 1 };
    return items.sort((a, b) => rank[a.s] - rank[b.s] || a.o - b.o);
  }

  // ------------------------------------------------------------------ panels (twice a second)
  function setKpi(id, value, state, chip, sub1, sub2) {
    const v = $(`tv-v-${id}`);
    v.dataset.s = state;
    v.firstElementChild.textContent = value;
    const c = $(`tv-c-${id}`);
    c.dataset.s = state;
    c.textContent = chip;
    const [a, b] = $(`tv-s-${id}`).children;
    a.textContent = sub1;
    b.textContent = sub2;
  }

  let lastAttn = '';
  function renderPanels() {
    const snap = snapshot();
    const shiftMin = clockMin() - SHIFT_START_MIN - shift.n * SHIFT_LEN;
    const start = SHIFT_START_MIN + shift.n * SHIFT_LEN;
    $('tv-shift').textContent = `Shift ${SHIFT_NAMES[((shift.n % 3) + 3) % 3]} · ${hhmm(start)}–${hhmm(start + SHIFT_LEN)}`;
    $('tv-clock').textContent = hhmm(clockMin());
    const early = shiftMin < 20;

    const built = sim.built - shift.base;
    const planNow = (PLAN_RATE * shiftMin) / 60;
    const gap = Math.round(built - planNow);
    const pct = planNow > 5 ? gap / planNow : 0;
    const outS = pct >= -0.02 ? 'ok' : pct >= -0.08 ? 'warn' : 'crit';
    setKpi('out', built.toLocaleString(), outS, outS === 'ok' ? 'On plan' : 'Behind',
      `${gap >= 0 ? '▲' : '▼'} ${Math.abs(gap)} vs plan`, `target ${PLAN_RATE * 8}`);

    const rate = Math.round(snap.output_rate_per_h);
    const rateS = rate >= PLAN_RATE * 0.9 ? 'ok' : rate >= PLAN_RATE * 0.7 ? 'warn' : 'crit';
    setKpi('rate', early || !rate ? '—' : rate, early ? 'ok' : rateS, early || !rate ? '' : rateS === 'ok' ? 'OK' : 'Low',
      `plan ${PLAN_RATE}/h`, `A ${snap.line_A_built} · B ${snap.line_B_built} built`);

    const oee = Math.round(snap.oee * 100);
    const oeeS = oee >= 75 ? 'ok' : oee >= 65 ? 'warn' : 'crit';
    setKpi('oee', early ? '—' : oee, early ? 'ok' : oeeS, early ? '' : oeeS === 'ok' ? 'OK' : 'Low',
      `avail ${Math.round(snap.availability * 100)} · perf ${Math.round(snap.performance * 100)}`, `quality ${Math.round(snap.quality * 100)}`);

    const fpy = snap.first_pass_yield;
    const fpyS = fpy == null || fpy >= 0.97 ? 'ok' : fpy >= 0.95 ? 'warn' : 'crit';
    setKpi('fpy', fpy == null ? '—' : (fpy * 100).toFixed(1), fpyS, fpy == null ? '' : fpyS === 'ok' ? 'OK' : 'Low',
      `${snap.rework_rejects} ${snap.rework_rejects === 1 ? 'reject' : 'rejects'}`, 'target 97%');

    // Attention list
    const items = attention();
    const MAX = 4;
    let html;
    if (!items.length) html = '<div class="tv-clear"><em></em><b>All lines running</b><span>Nothing needs attention</span></div>';
    else {
      html = items.slice(0, MAX).map((it) => `<div class="tv-item" data-s="${it.s}"><i></i><div style="min-width:0"><b>${it.t}</b><span>${it.d}</span></div></div>`).join('');
      if (items.length > MAX) html += `<div class="tv-more">+ ${items.length - MAX} more</div>`;
    }
    if (html !== lastAttn) { $('tv-attn').innerHTML = html; lastAttn = html; }
    $('tv-attn-n').textContent = items.length ? `${items.length} open` : '';

    // Zone tags
    for (const z of zones) {
      z.state = zoneState(z);
      z.tag.dataset.s = z.state.s;
      z.tag.innerHTML = `<b>${z.name}</b>${z.state.s === 'ok' ? '' : `<span>${z.state.sub}</span>`}`;
    }
    shipTag.dataset.s = 'ok';
    shipTag.innerHTML = `<b>Shipping</b><span>${snap.trucks_at_dock} at dock · ${snap.staged_pallets} pallets staged</span>`;

    renderHours(shiftMin);
  }

  function renderHours(shiftMin) {
    const W = 600, base = 112, maxV = 64, slot = W / 8, bw = 50;
    const yv = (v) => base - (Math.min(v, maxV) / maxV) * 84;
    const cur = Math.min(7, Math.floor(shiftMin / 60));
    const start = SHIFT_START_MIN + shift.n * SHIFT_LEN;
    let s = `<line class="base" x1="0" y1="${base}" x2="${W}" y2="${base}"/>`;
    for (let i = 0; i < 8; i++) {
      const cx = i * slot + slot / 2, x = cx - bw / 2, v = shift.bins[i];
      if (i < cur) {
        const low = v < PLAN_RATE * 0.9;
        s += `<rect class="${low ? 'bar-warn' : 'bar'}" x="${x}" y="${yv(v)}" width="${bw}" height="${base - yv(v)}" rx="2"/>` +
          `<text class="v ${low ? 'v-warn' : ''}" x="${cx}" y="${yv(v) - 8}">${v}</text>`;
      } else if (i === cur) {
        s += `<rect class="bar-now" x="${x}" y="${yv(v)}" width="${bw}" height="${base - yv(v)}" rx="2"/>` +
          `<text class="v" x="${cx}" y="${yv(v) - 8}">${v}</text>`;
      } else {
        s += `<rect class="slot" x="${x}" y="${yv(PLAN_RATE)}" width="${bw}" height="${base - yv(PLAN_RATE)}" rx="2"/>`;
      }
      s += `<text class="hl ${i === cur ? 'hl-now' : ''}" x="${cx}" y="${base + 26}">${hhmm(start + i * 60).slice(0, 2)}</text>`;
    }
    s += `<line class="plan" x1="0" y1="${yv(PLAN_RATE)}" x2="${W}" y2="${yv(PLAN_RATE)}"/>`;
    $('tv-hours').innerHTML = s;
  }

  // ------------------------------------------------------------------ per frame
  // Centre the plant in the area left of the side column and below the KPI band
  function frameView() {
    const W = window.innerWidth, H = window.innerHeight;
    const top = root.querySelector('.tv-top').offsetHeight;
    const side = root.querySelector('.tv-side').offsetWidth;
    const cx = (W - side) / 2, cy = top + (H - top) / 2;
    const fw = 2 * Math.max(cx, W - cx), fh = 2 * Math.max(cy, H - cy);
    camera.aspect = fw / fh;
    camera.setViewOffset(fw, fh, fw / 2 - cx, fh / 2 - cy, W, H);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', frameView);
  frameView();

  // Tags sit above their anchor (or below it for zones marked `below`) and hide under the close-up
  const v = new THREE.Vector3();
  function place(el, p, below = false) {
    v.copy(p).project(camera);
    const x = ((v.x + 1) / 2) * window.innerWidth, y = ((1 - v.y) / 2) * window.innerHeight;
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, ${below ? '0' : '-100%'})`;
    el.style.visibility = '';
    if (pip.el.hidden) return;
    const r = pip.el.getBoundingClientRect(), t = el.getBoundingClientRect();
    if (t.right > r.left && t.left < r.right && t.bottom > r.top && t.top < r.bottom) el.style.visibility = 'hidden';
  }

  function updateScene(t) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    for (const z of zones) {
      z.mat.opacity = z.state.s === 'crit' ? 0.28 + 0.22 * pulse : z.state.s === 'warn' ? 0.22 : 0;
      if (z.state.s !== 'ok') z.mat.color.setHex(COLOR[z.state.s]);
      place(z.tag, z.anchor, z.below);
    }
    place(shipTag, shipAnchor);
    for (const b of beacons.children) b.visible = false;
    for (const st of stations) {
      const s = stopped(st) ? 'crit' : inMaint(st) || alerted(st) ? 'warn' : null;
      if (!s) continue;
      const b = beacon(st);
      b.visible = true;
      b.material.color.setHex(COLOR[s]);
      b.material.opacity = s === 'crit' ? 0.45 + 0.4 * pulse : 0.6;
      b.scale.set(1, s === 'crit' ? 16 : 9, 1);
    }
  }

  // Close-up of the longest stoppage, rotating between stoppages every 10 s
  const pip = { el: $('tv-pip'), view: $('tv-pip-view'), st: null, t: 0, cam: new THREE.PerspectiveCamera(38, 16 / 9, 0.3, 400) };
  function updatePip(dt) {
    const crit = stations.filter(stopped).sort((a, b) => downMin(b) - downMin(a));
    pip.t += dt;
    if (!crit.includes(pip.st) || pip.t > 10) {
      pip.t = 0;
      pip.st = crit.length ? crit[(crit.indexOf(pip.st) + 1) % crit.length] : null;
    }
    pip.el.hidden = !pip.st;
    if (!pip.st) return;
    $('tv-pip-title').textContent = `${where(pip.st)} · stopped ${downMin(pip.st)} min`;
    const r = pip.view.getBoundingClientRect();
    if (r.width < 10) return;
    // Steep enough to look over the neighbouring line, which sits only ~6 m away on the east lines
    const g = pip.st.group.position;
    pip.cam.position.set(g.x - 2, 10, g.z + 6.5);
    pip.cam.lookAt(g.x, 0.8, g.z);
    pip.cam.aspect = r.width / r.height;
    pip.cam.updateProjectionMatrix();
    const y = window.innerHeight - r.bottom;
    beacons.visible = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setScissorTest(true);
    renderer.setViewport(r.left, y, r.width, r.height);
    renderer.setScissor(r.left, y, r.width, r.height);
    renderer.render(scene, pip.cam);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    renderer.shadowMap.autoUpdate = true;
    beacons.visible = true;
  }

  // Runs after the twin's own frame (registered later), so it draws on top of the main render
  let last = performance.now();
  let panelT = 1;
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    trackDowns();
    trackShift();
    panelT += dt;
    if (panelT >= 0.5) { panelT = 0; renderPanels(); }
    updateScene(now / 1000);
    updatePip(dt);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ------------------------------------------------------------------ controls (on mouse move)
  let hideCtl = 0;
  window.addEventListener('mousemove', () => {
    document.body.classList.add('tv-ctl-on');
    clearTimeout(hideCtl);
    hideCtl = setTimeout(() => document.body.classList.remove('tv-ctl-on'), 3000);
  });
  root.querySelector('[data-act="stop"]').addEventListener('click', () => {
    const ok = stations.filter((st) => !st.down && st.line.id !== 'rewind');
    const st = ok[Math.floor(Math.random() * ok.length)];
    if (st) breakStation(st, 45, 'Manual stop (demo)');
    renderPanels();
  });
  root.querySelector('[data-act="full"]').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { /* not available in this browser */ }
    try { await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
  });
}
