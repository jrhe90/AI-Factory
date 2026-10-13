// AI layer for the motor plant digital twin:
//  • Predictive maintenance – per-machine health model, vibration/temperature signals,
//    remaining-useful-life prediction, alerts, work orders and an autopilot.
//  • Vision QC – a live camera feed of the inspection cell with model detections.
//  • Heatmaps – utilisation / power / blocking / failure-risk overlays on the floor.
//  • Copilot – answers questions from live plant data (scripted), or via Claude when the
//    viewer supplies their own API key.
import * as THREE from 'three';

const KIND = {
  uncoiler: { kw: [8, 2], modes: ['Mandrel gearbox wear'] },
  press: { kw: [85, 12], modes: ['Clutch/brake lining wear', 'Flywheel bearing wear'] },
  stacker: { kw: [14, 3], modes: ['Robot J2 reducer backlash', 'Laser source power drift'] },
  lathe: { kw: [22, 5], modes: ['Spindle bearing wear', 'Turret indexing wear'] },
  mill: { kw: [28, 6], modes: ['Spindle bearing wear', 'Ball-screw backlash'] },
  saw: { kw: [9, 2], modes: ['Blade wear'] },
  grinder: { kw: [18, 4], modes: ['Wheel spindle imbalance'] },
  diecast: { kw: [140, 70], modes: ['Shot-end hydraulic leak', 'Furnace thermocouple drift'] },
  hpress: { kw: [15, 3], modes: ['Hydraulic pump cavitation', 'Ram seal leak'] },
  balancer: { kw: [7, 2], modes: ['Drive belt slip'] },
  washer: { kw: [35, 12], modes: ['Pump seal leak'] },
  robotload: { kw: [6, 2], modes: ['Gripper cylinder leak'] },
  cmm: { kw: [3, 2], modes: ['Air-bearing contamination'] },
  winder: { kw: [12, 3], modes: ['Flyer drive belt wear', 'Wire tensioner drift'] },
  inserter: { kw: [9, 2], modes: ['Insertion blade tooling wear'] },
  lacer: { kw: [0.5, 0.2], manual: true },
  surge: { kw: [4, 1], modes: ['HV relay contact wear'] },
  vpi: { kw: [40, 14], modes: ['Vacuum pump degradation'] },
  oven: { kw: [110, 55], modes: ['Heater element failure', 'Circulation fan bearing wear'] },
  coolinspect: { kw: [6, 1], modes: ['Cooling fan bearing wear'] },
  induction: { kw: [60, 4], modes: ['IGBT module overheating', 'Coil water-cooling flow loss'] },
  rotorinsert: { kw: [2, 0.5], manual: true },
  fanbench: { kw: [1.5, 0.3], manual: true },
  conduit: { kw: [1.5, 0.3], manual: true },
  runtest: { kw: [45, 4], modes: ['Dyno coupling misalignment', 'Dyno bearing wear'] },
  vision: { kw: [1.5, 1], modes: ['Lens contamination'] },
  paint: { kw: [30, 10], modes: ['Atomizer bell bearing wear', 'Booth exhaust fan imbalance'] },
  pack: { kw: [5, 1.5], modes: ['Laser source power drop'] },
  inspectbench: { kw: [1, 0.3], manual: true },
  burnout: { kw: [70, 30], modes: ['Afterburner igniter fault'] },
  strip: { kw: [12, 2], modes: ['Hydraulic puller leak'] },
  rewind: { kw: [8, 2], modes: ['Headstock motor bearing wear'] },
  dipbake: { kw: [50, 20], modes: ['Heater element failure'] },
};
const BASE_LOAD_KW = 240; // HVAC, compressed air, lighting, IT

const DEFECTS = {
  induction: { type: 'Stator not fully seated', part: 'frame', rate: 0.002 },
  rotorinsert: { type: 'Rotor rub mark', part: 'shaft', rate: 0.002 },
  hpress: { type: 'Missing bracket bolt', part: 'bracket', rate: 0.006 },
  fanbench: { type: 'Fan cover dent', part: 'cover', rate: 0.005 },
  conduit: { type: 'Conduit gasket missing', part: 'cbox', rate: 0.007 },
  paint: { type: 'Paint run', part: 'frame', rate: 0.009 },
};
const ALERT_AT = 0.45;
const CRIT_AT = 0.25;
const PLANNED_S = 12;
const UNPLANNED_S = 40;

const rnd = (a, b) => a + Math.random() * (b - a);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pct = (v) => `${(v * 100).toFixed(0)}%`;

export function createAI(ctx) {
  const { scene, renderer, sim, stations, stock, plan, FACTORY_SEC, bounds, toast, dispatchTech, focusStation, snapshot, clockText } = ctx;
  const hrs = (simS) => (simS * FACTORY_SEC) / 3600;
  const mins = (simS) => Math.round((simS * FACTORY_SEC) / 60);
  let failHandler = () => {};
  const events = [];

  const ai = {
    autopilot: false,
    warming: false,
    alerts: [],
    stats: { avoided: 0, orders: 0, caught: 0, failures: 0, escapes: 0 },
    energy: { kw: 0, kwh: 0 },
    defects: {},
    setFailHandler(fn) { failHandler = fn; },
    log(msg, kind) {
      events.unshift({ t: clockText(), msg, kind });
      if (events.length > 40) events.pop();
    },

    // ------------------------------------------------------------ predictive maintenance
    initStation(st) {
      const meta = KIND[st.cfg.kind] ?? { kw: [5, 1] };
      const tracked = !meta.manual && !!meta.modes;
      st.ai = {
        tracked, meta, health: rnd(0.7, 1), wear: 1 / rnd(9000, 22000), accel: 1, anomaly: false,
        mode: tracked ? meta.modes[Math.floor(Math.random() * meta.modes.length)] : null,
        baseVib: rnd(0.9, 1.6), hist: [], sampleT: 0, alert: null, kw: 0,
      };
    },
    wear(st, dt) {
      const a = st.ai;
      if (!a?.tracked || st.down) return;
      a.health -= dt * a.wear * a.accel;
      if (a.health <= 0) {
        a.health = 0;
        if (ai.warming) {
          a.health = 1;
          a.anomaly = false;
          a.accel = 1;
          return;
        }
        ai.stats.failures++;
        if (a.alert) a.alert.missed = true;
        failHandler(st, a.mode);
      }
    },
    repaired(st, kind) {
      const a = st.ai;
      const hadAlert = !!a.alert;
      if (a.tracked) {
        a.health = 1;
        a.anomaly = false;
        a.accel = 1;
        a.mode = a.meta.modes[Math.floor(Math.random() * a.meta.modes.length)];
      }
      removeAlert(st);
      if (kind === 'maint') {
        if (hadAlert) {
          ai.stats.avoided += UNPLANNED_S - PLANNED_S;
          ai.stats.caught++;
        }
        toast(`✅ ${st.cfg.name}: maintenance done — health restored to 100%`);
      } else toast(`✅ ${st.cfg.name} repaired and back in service`);
    },
    sensors(st) {
      const a = st.ai;
      const h = a.health;
      const working = st.status === 'working';
      const noise = Math.sin(sim.time * 3.1 + st.index) * 0.08 + Math.sin(sim.time * 7.3) * 0.05;
      const vib = a.baseVib + (1 - h) ** 2 * (working ? 9 : 3.5) + noise;
      const temp = 34 + (1 - h) * 32 + (working ? 9 : 0) + noise * 4;
      return { health: h, vib: Math.max(0.3, vib), temp, kw: a.kw };
    },
    step(dt) {
      let kw = BASE_LOAD_KW + 24;
      for (const st of stations) {
        const a = st.ai;
        const [kWork, kIdle] = a.meta.kw;
        a.kw = st.status === 'working' ? kWork : st.down ? kIdle * 0.25 : kIdle;
        kw += a.kw;
        if (!a.tracked) continue;
        // anomalies start at random (bearing defects, leaks...) and accelerate wear
        if (!a.anomaly && !st.down && a.health > 0.5 && Math.random() < dt / 9000) {
          a.anomaly = true;
          a.accel = rnd(14, 26);
        }
        // alerts
        if (a.health < ALERT_AT && !st.down) {
          const util = Math.max(0.35, st.ema.util);
          const rul = a.health / (a.wear * a.accel * util);
          const sev = a.health < CRIT_AT ? 2 : 1;
          if (!a.alert) {
            a.alert = { st, sev, rulH: hrs(rul), conf: 0.72 + (1 - a.health) * 0.25, created: sim.time };
            ai.alerts.push(a.alert);
            if (!ai.warming) {
              ai.stats.predicted = (ai.stats.predicted ?? 0) + 1;
              toast(`🧠 AI: ${a.mode} predicted on ${st.cfg.name} (${st.line.short}) — failure in ~${a.alert.rulH.toFixed(1)} h`, 'ai');
            }
          } else {
            if (sev === 2 && a.alert.sev === 1 && !ai.warming) toast(`🧠 AI: ${st.cfg.name} is now critical — ${a.alert.rulH.toFixed(1)} h left`, 'warn');
            a.alert.sev = sev;
            a.alert.rulH = hrs(rul);
            a.alert.conf = Math.min(0.98, 0.72 + (1 - a.health) * 0.3);
          }
          // autopilot: schedule when it costs no output, or before it's too late
          if (ai.autopilot && !ai.warming && !st.maintPending && !st.maintQueued) {
            const quiet = st.status === 'idle' || st.status === 'blocked';
            if (quiet || a.alert.rulH < 0.9) {
              if (dispatchTech(st)) ai.stats.orders++;
            }
          }
        } else if (a.alert && a.health >= ALERT_AT) removeAlert(st);
        // history for sparklines
        a.sampleT += dt;
        if (a.sampleT >= 1) {
          a.sampleT = 0;
          const s = ai.sensors(st);
          a.hist.push([a.health, s.vib]);
          if (a.hist.length > 140) a.hist.shift();
        }
      }
      ai.energy.kw = kw;
      ai.energy.kwh += kw * hrs(dt);
      ai.alerts.sort((x, y) => x.rulH - y.rulH);
    },
    schedule(st) {
      if (dispatchTech(st)) ai.stats.orders++;
    },
    resetAfterWarmup() {
      ai.energy.kwh = 0;
      ai.defects = {};
      Object.assign(ai.stats, { avoided: 0, orders: 0, caught: 0, failures: 0, escapes: 0, predicted: 0 });
      // Seed the demo: a couple of machines are already drifting
      const tracked = stations.filter((s) => s.ai.tracked && !s.down);
      const pick = (pred) => tracked.filter(pred)[0];
      const seeds = [
        [pick((s) => s.line.motorKind === 'A' && s.cfg.kind === 'hpress'), 0.43, 20],
        [pick((s) => s.cfg.kind === 'oven'), 0.56, 16],
        [pick((s) => s.cfg.kind === 'grinder'), 0.62, 18],
      ];
      for (const [st, h, acc] of seeds) {
        if (!st) continue;
        st.ai.health = h;
        st.ai.anomaly = true;
        st.ai.accel = acc;
        st.ai.mode = st.ai.meta.modes[0];
      }
      for (const st of tracked) st.ai.hist = [];
    },

    // ------------------------------------------------------------ quality
    qualityHook(u, st) {
      if (!st.line.motorKind || u.defect) return;
      const d = DEFECTS[st.cfg.kind];
      if (!d) return;
      const h = st.ai.tracked ? st.ai.health : 1;
      const p = d.rate * (1 + 9 * (1 - h) ** 2);
      if (Math.random() < p) u.defect = { ...d, station: st.cfg.name, health: h, applied: false };
    },
    applyDefectVisual(u) {
      const d = u.defect;
      if (!d || d.applied) return;
      const m = u.part;
      if (d.part === 'bracket' && m.stage >= 2) {
        m.missingBolts();
        d.applied = true;
      } else if (d.part === 'cover' && m.stage >= 3.5) {
        m.parts.cover.scale.set(1, 0.88, 1.08);
        d.applied = true;
      } else if (d.part === 'cbox' && m.stage >= 4) {
        m.parts.cbox.children[1].rotation.z = 0.22;
        m.parts.cbox.children[1].position.y += 0.03;
        d.applied = true;
      } else if (d.part === 'frame' && d.type === 'Paint run' && m.stage >= 5) {
        const s = m.spec;
        const drip = new THREE.Mesh(new THREE.BoxGeometry(0.05, s.R * 0.6, 0.03), new THREE.MeshStandardMaterial({ color: 0x0e2238, roughness: 0.15 }));
        drip.position.set(s.L * 0.1, s.R * 0.8, s.R * 1.04);
        m.group.add(drip);
        d.drip = drip;
        d.applied = true;
      }
    },
    inspect(u, st) {
      sim.inspected++;
      const reject = u.defect ? Math.random() < 0.985 : Math.random() < 0.002;
      const conf = reject ? rnd(0.9, 0.995) : rnd(0.96, 0.999);
      vision.record(st, u, reject, conf);
      if (reject) {
        const type = u.defect?.type ?? 'False reject (re-checked OK)';
        ai.defects[type] = (ai.defects[type] ?? 0) + 1;
        toast(`👁 Vision AI rejected ${u.id}: ${type} (${(conf * 100).toFixed(0)}%)`, 'ai');
      } else {
        sim.passed++;
        if (u.defect) ai.stats.escapes++;
      }
      return reject;
    },
    defectCounts() { return { ...ai.defects }; },

    // ------------------------------------------------------------ per frame
    frame(dt) {
      heatmap.tick(dt);
      vision.tick(dt);
    },
    drawSpark(canvas, st) {
      const g = canvas.getContext('2d');
      const w = (canvas.width = canvas.clientWidth * 2);
      const h = (canvas.height = canvas.clientHeight * 2);
      g.clearRect(0, 0, w, h);
      const hist = st.ai.hist;
      g.strokeStyle = 'rgba(255,255,255,0.08)';
      g.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        g.beginPath();
        g.moveTo(0, (h * i) / 4);
        g.lineTo(w, (h * i) / 4);
        g.stroke();
      }
      g.setLineDash([6, 6]);
      g.strokeStyle = 'rgba(245,158,11,0.7)';
      g.beginPath();
      g.moveTo(0, h * (1 - ALERT_AT));
      g.lineTo(w, h * (1 - ALERT_AT));
      g.stroke();
      g.setLineDash([]);
      if (hist.length < 2) return;
      const n = 140;
      const x = (i) => w - ((hist.length - 1 - i) / (n - 1)) * w;
      g.lineWidth = 3;
      g.strokeStyle = '#60a5fa';
      g.beginPath();
      hist.forEach(([, v], i) => g[i ? 'lineTo' : 'moveTo'](x(i), h - Math.min(1, v / 10) * h));
      g.stroke();
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#22c55e');
      grad.addColorStop(0.55, '#f59e0b');
      grad.addColorStop(1, '#ef4444');
      g.strokeStyle = grad;
      g.lineWidth = 4;
      g.beginPath();
      hist.forEach(([v], i) => g[i ? 'lineTo' : 'moveTo'](x(i), h - v * h));
      g.stroke();
    },
    renderPanel() { panel.render(); },
  };

  function removeAlert(st) {
    if (!st.ai.alert) return;
    ai.alerts.splice(ai.alerts.indexOf(st.ai.alert), 1);
    st.ai.alert = null;
  }

  // ============================================================== heatmap
  const heatmap = (() => {
    const W = bounds.x1 - bounds.x0;
    const D = bounds.z1 - bounds.z0;
    const PX = 3; // pixels per metre
    const cw = Math.round(W * PX);
    const ch = Math.round(D * PX);
    const src = document.createElement('canvas');
    src.width = cw;
    src.height = ch;
    const out = document.createElement('canvas');
    out.width = cw;
    out.height = ch;
    const tex = new THREE.CanvasTexture(out);
    tex.colorSpace = THREE.SRGBColorSpace;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    plane.rotation.x = -Math.PI / 2;
    plane.position.set((bounds.x0 + bounds.x1) / 2, 0.09, (bounds.z0 + bounds.z1) / 2);
    plane.renderOrder = 3;
    plane.visible = false;
    scene.add(plane);
    const ramp = [[0, [40, 90, 255]], [0.35, [30, 200, 140]], [0.65, [250, 210, 40]], [1, [240, 50, 40]]];
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let k = 0;
      while (k < ramp.length - 2 && t > ramp[k + 1][0]) k++;
      const [t0, c0] = ramp[k];
      const [t1, c1] = ramp[k + 1];
      const f = (t - t0) / (t1 - t0);
      for (let c = 0; c < 3; c++) lut[i * 3 + c] = c0[c] + (c1[c] - c0[c]) * f;
    }
    let mode = 'off';
    let timer = 0;
    const value = (st) => {
      switch (mode) {
        case 'util': return st.ema.util;
        case 'energy': return Math.sqrt(Math.min(1, st.ai.kw / 120));
        case 'wip': return Math.min(1, st.ema.blocked * 1.3 + (st.waiting ? 0.3 : 0));
        case 'health': return st.ai.tracked ? Math.min(1, (1 - st.ai.health) ** 1.4 * 1.25) : 0;
        default: return 0;
      }
    };
    const srcCtx = src.getContext('2d', { willReadFrequently: true });
    function draw() {
      const g = srcCtx;
      g.clearRect(0, 0, cw, ch);
      g.globalCompositeOperation = 'lighter';
      for (const st of stations) {
        const v = value(st);
        if (v <= 0.01) continue;
        const x = (st.group.position.x - bounds.x0) * PX;
        const y = (st.group.position.z - bounds.z0) * PX;
        const r = (Math.max(st.footW, st.footD) * 0.65 + 2.5) * PX;
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `rgba(255,255,255,${v})`);
        grad.addColorStop(0.55, `rgba(255,255,255,${v * 0.6})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      const img = g.getImageData(0, 0, cw, ch);
      const o = out.getContext('2d');
      const res = o.createImageData(cw, ch);
      const s = img.data;
      const d = res.data;
      for (let i = 0; i < s.length; i += 4) {
        const a = s[i + 3];
        if (a < 3) continue;
        const k = Math.min(255, a) * 3;
        d[i] = lut[k];
        d[i + 1] = lut[k + 1];
        d[i + 2] = lut[k + 2];
        d[i + 3] = Math.min(220, 40 + a * 0.85);
      }
      o.putImageData(res, 0, 0);
      tex.needsUpdate = true;
    }
    return {
      setMode(m) {
        mode = m;
        plane.visible = m !== 'off';
        if (plane.visible) draw();
      },
      get mode() { return mode; },
      tick(dt) {
        if (mode === 'off') return;
        timer += dt;
        if (timer > 0.5) {
          timer = 0;
          draw();
        }
      },
    };
  })();
  ai.heatmap = heatmap;

  // ============================================================== vision QC feed
  const vision = (() => {
    const el = document.getElementById('feed');
    const view = document.getElementById('feed-view');
    const boxes = document.getElementById('feed-boxes');
    const verdict = document.getElementById('feed-verdict');
    const stats = document.getElementById('feed-stats');
    const title = document.getElementById('feed-title');
    const cams = new Map();
    let which = 'A';
    let visible = true;
    let timer = 0;
    const history = [];
    const camFor = (st) => {
      if (!cams.has(st)) {
        const cam = new THREE.PerspectiveCamera(30, 1.6, 0.05, 9);
        const y = st.line.y;
        cam.position.copy(st.group.localToWorld(new THREE.Vector3(-1.75, y + 1.25, 1.15)));
        cam.lookAt(st.group.localToWorld(new THREE.Vector3(0.1, y + 0.3, 0)));
        cams.set(st, cam);
      }
      return cams.get(st);
    };
    const station = () => stations.find((s) => s.cfg.inspect && s.line.motorKind === which);
    document.querySelectorAll('[data-feed]').forEach((b) => b.addEventListener('click', () => {
      which = b.dataset.feed;
      document.querySelectorAll('[data-feed]').forEach((x) => x.classList.toggle('active', x === b));
    }));
    const v3 = new THREE.Vector3();
    const box3 = new THREE.Box3();
    function rectOf(obj, cam, w, h) {
      box3.setFromObject(obj);
      if (box3.isEmpty()) return null;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < 8; i++) {
        v3.set(i & 1 ? box3.max.x : box3.min.x, i & 2 ? box3.max.y : box3.min.y, i & 4 ? box3.max.z : box3.min.z).project(cam);
        const sx = (v3.x * 0.5 + 0.5) * w;
        const sy = (-v3.y * 0.5 + 0.5) * h;
        x0 = Math.min(x0, sx);
        y0 = Math.min(y0, sy);
        x1 = Math.max(x1, sx);
        y1 = Math.max(y1, sy);
      }
      x0 = Math.max(2, x0);
      y0 = Math.max(2, y0);
      x1 = Math.min(w - 2, x1);
      y1 = Math.min(h - 2, y1);
      if (x1 - x0 < 4 || y1 - y0 < 4) return null;
      return [x0, y0, x1 - x0, y1 - y0];
    }
    function overlay() {
      const st = station();
      if (!st) return;
      const cam = camFor(st);
      const w = view.clientWidth;
      const h = view.clientHeight;
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
      title.textContent = `CAM 0${which === 'A' ? 1 : 2} · LINE ${which} · VISION QC`;
      const occ = st.occupant && st.line.units.includes(st.occupant) && st.occupant.next === st.index ? st.occupant : null;
      const p = occ ? Math.min(1, occ.t / occ.dur) : 0;
      let html = '';
      if (occ && st.status === 'working' && p > 0.12) {
        const m = occ.part;
        const parts = [
          ['Housing', m.parts.frame, 'frame'], ['Conduit box', m.parts.cbox, 'cbox'], ['Fan cover', m.parts.cover, 'cover'],
          ['DE bracket', m.parts.brackets[1], 'bracket'], ['Shaft & key', m.parts.shaft, 'shaft'],
        ];
        const shown = Math.ceil(Math.min(1, (p - 0.12) / 0.45) * parts.length);
        parts.slice(0, shown).forEach(([name, obj, key], i) => {
          const r = rectOf(obj, cam, w, h);
          if (!r) return;
          const bad = occ.defect && occ.defect.part === key && p > 0.5;
          const conf = bad ? (0.9 + ((occ.serial ?? i) % 9) / 100) : 0.97 + (i % 3) / 100;
          const lbl = bad ? `✗ ${occ.defect.type} ${conf.toFixed(2)}` : `${name} ✓ ${conf.toFixed(2)}`;
          html += `<div class="det ${bad ? 'bad' : ''}" style="left:${r[0]}px;top:${r[1]}px;width:${r[2]}px;height:${r[3]}px"><span>${esc(lbl)}</span></div>`;
        });
        html += `<div class="scan" style="top:${((p * 2.2) % 1) * 100}%"></div>`;
        if (p > 0.62) {
          const reject = !!occ.defect;
          verdict.textContent = reject ? `REJECT · ${occ.id}` : `PASS · ${occ.id}`;
          verdict.dataset.state = reject ? 'bad' : 'ok';
        } else {
          verdict.textContent = `INSPECTING · ${occ.id}`;
          verdict.dataset.state = 'busy';
        }
      } else {
        verdict.textContent = st.down ? 'CAMERA OFFLINE' : 'WAITING FOR PART';
        verdict.dataset.state = st.down ? 'bad' : 'idle';
      }
      boxes.innerHTML = html;
      const insp = sim.inspected;
      stats.textContent = `Inspected ${insp.toLocaleString()} · Rejected ${sim.rejected} · FPY ${insp ? ((sim.passed / insp) * 100).toFixed(1) : '—'}% · model v3.2`;
    }
    return {
      setVisible(v) {
        visible = v;
        el.hidden = !v;
      },
      record(st, u, reject, conf) {
        history.unshift({ id: u.id, line: st.line.short, reject, conf, type: u.defect?.type });
        if (history.length > 20) history.pop();
      },
      history,
      tick(dt) {
        if (!visible) return;
        timer += dt;
        if (timer > 0.08) {
          timer = 0;
          overlay();
        }
      },
      render() {
        if (!visible || el.hidden) return;
        const st = station();
        if (!st) return;
        const r = view.getBoundingClientRect();
        if (r.width < 10) return;
        const cam = camFor(st);
        const y = window.innerHeight - r.bottom;
        renderer.shadowMap.autoUpdate = false;
        renderer.setScissorTest(true);
        renderer.setViewport(r.left, y, r.width, r.height);
        renderer.setScissor(r.left, y, r.width, r.height);
        renderer.render(scene, cam);
        renderer.setScissorTest(false);
        renderer.shadowMap.autoUpdate = true;
      },
    };
  })();
  ai.vision = vision;

  // ============================================================== insights panel
  const panel = (() => {
    const root = document.getElementById('pane-ai');
    let tick = 0;
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const st = stations[Number(b.dataset.st)];
      if (b.dataset.act === 'schedule' && st) ai.schedule(st);
      if (b.dataset.act === 'view' && st) focusStation(st);
      if (b.dataset.act === 'heat') {
        const sel = document.getElementById('heatmap');
        sel.value = b.dataset.mode;
        sel.dispatchEvent(new Event('change'));
      }
      if (b.dataset.act === 'schedule-all') for (const a of ai.alerts) if (!a.st.maintPending) ai.schedule(a.st);
      panel.render(true);
    });
    function insights() {
      const out = [];
      const qual = qualityInsight();
      if (qual) out.push(qual);
      const en = energyInsight();
      if (en) out.push(en);
      const bn = bottleneckInsight();
      if (bn) out.push(bn);
      return out;
    }
    return {
      render(force) {
        if (root.hidden && !force) return;
        if (!force && tick++ % 3) return;
        const tracked = stations.filter((s) => s.ai.tracked);
        const alerts = ai.alerts.map((a) => {
          const st = a.st;
          const i = stations.indexOf(st);
          const sched = st.maintPending ? (st.maintPending.working ? 'In maintenance' : 'Tech en route') : st.maintQueued ? 'Queued' : null;
          return `<div class="alert" data-sev="${a.sev}">
            <div class="a-head"><b>${esc(st.cfg.name)}</b><span class="a-line">${esc(st.line.short)}</span><span class="a-rul">${a.rulH.toFixed(1)} h</span></div>
            <div class="a-mode">${esc(st.ai.mode)} · ${pct(a.conf)} confidence</div>
            <div class="a-bar"><i style="width:${pct(st.ai.health)}"></i></div>
            <div class="a-act">${sched ? `<span class="tag">${sched}</span>` : `<button class="btn sm" data-act="schedule" data-st="${i}">Schedule maintenance</button>`}<button class="btn sm ghost" data-act="view" data-st="${i}">View</button></div>
          </div>`;
        }).join('');
        const defs = Object.entries(ai.defects).sort((a, b) => b[1] - a[1]);
        const maxD = Math.max(1, ...defs.map((d) => d[1]));
        const defHtml = defs.length
          ? defs.map(([k, n]) => `<div class="d-row"><span>${esc(k)}</span><span class="bar"><i style="width:${(n / maxD) * 100}%"></i></span><b>${n}</b></div>`).join('')
          : '<p class="muted">No rejects yet this shift.</p>';
        const top = stations.slice().sort((a, b) => b.ai.kw - a.ai.kw).slice(0, 4);
        root.innerHTML = `
          <section>
            <div class="sec-head"><h3>Predictive maintenance</h3><span class="muted">${tracked.length} machines monitored</span></div>
            <div class="mini-kpis">
              <div><label>Open alerts</label><b>${ai.alerts.length}</b></div>
              <div><label>Failures avoided</label><b>${ai.stats.caught}</b></div>
              <div><label>Downtime avoided</label><b>${mins(ai.stats.avoided)} min</b></div>
              <div><label>Breakdowns</label><b data-low="${ai.stats.failures > 0}">${ai.stats.failures}</b></div>
            </div>
            ${alerts || '<p class="ok-note">✓ All monitored machines are healthy.</p>'}
            ${ai.alerts.filter((a) => !a.st.maintPending).length > 1 ? '<button class="btn sm wide" data-act="schedule-all">Schedule all open work orders</button>' : ''}
          </section>
          <section>
            <div class="sec-head"><h3>Vision quality</h3><span class="muted">${sim.inspected.toLocaleString()} inspected</span></div>
            <div class="mini-kpis three">
              <div><label>First-pass yield</label><b>${sim.inspected ? ((sim.passed / sim.inspected) * 100).toFixed(1) + '%' : '—'}</b></div>
              <div><label>Rejected</label><b>${sim.rejected}</b></div>
              <div><label>Escapes</label><b>${ai.stats.escapes}</b></div>
            </div>
            ${defHtml}
          </section>
          <section>
            <div class="sec-head"><h3>Energy</h3><span class="muted">${Math.round(ai.energy.kw)} kW now</span></div>
            ${top.map((s) => `<div class="d-row"><span>${esc(s.cfg.name)} <em>${esc(s.line.short)}</em></span><span class="bar en"><i style="width:${Math.min(100, (s.ai.kw / 140) * 100)}%"></i></span><b>${Math.round(s.ai.kw)} kW</b></div>`).join('')}
          </section>
          <section>
            <div class="sec-head"><h3>AI recommendations</h3></div>
            ${insights().map((t) => `<div class="insight">${t}</div>`).join('') || '<p class="muted">Collecting data…</p>'}
            <div class="chips">
              <button class="chip" data-act="heat" data-mode="health">Failure-risk map</button>
              <button class="chip" data-act="heat" data-mode="util">Utilisation map</button>
              <button class="chip" data-act="heat" data-mode="energy">Power map</button>
            </div>
          </section>
          <section>
            <div class="sec-head"><h3>Event log</h3></div>
            <div class="log">${events.slice(0, 12).map((e) => `<div data-kind="${e.kind ?? ''}"><time>${esc(e.t.split(' · ')[1] ?? '')}</time>${esc(e.msg)}</div>`).join('')}</div>
          </section>`;
      },
    };
  })();

  function qualityInsight() {
    const defs = Object.entries(ai.defects).sort((a, b) => b[1] - a[1]);
    if (!defs.length || defs[0][1] < 2) return null;
    const [type, n] = defs[0];
    const kind = Object.keys(DEFECTS).find((k) => DEFECTS[k].type === type);
    const src = stations.filter((s) => s.cfg.kind === kind && s.line.motorKind).sort((a, b) => a.ai.health - b.ai.health)[0];
    if (src?.ai.tracked && src.ai.health < 0.6) {
      return `<b>${esc(type)}</b> is the top reject (${n}). It correlates with <b>${esc(src.cfg.name)}</b> on ${esc(src.line.short)}, whose health is ${pct(src.ai.health)} (${esc(src.ai.mode)}). Servicing it should bring the rate back to baseline.`;
    }
    return `<b>${esc(type)}</b> is the top reject (${n}), raised at ${esc(src?.cfg.name ?? 'assembly')}. The rate is within normal variation, so no action is needed yet.`;
  }
  function energyInsight() {
    const idleHogs = stations.filter((s) => s.ai.meta.kw[1] >= 20 && s.ema.util < 0.6).sort((a, b) => b.ai.meta.kw[1] * (1 - b.ema.util) - a.ai.meta.kw[1] * (1 - a.ema.util));
    const s = idleHogs[0];
    if (!s) return null;
    const idleKwhShift = s.ai.meta.kw[1] * (1 - s.ema.util) * 8;
    return `<b>${esc(s.cfg.name)}</b> (${esc(s.line.short)}) is idle ${pct(1 - s.ema.util)} of the time but still draws ${s.ai.meta.kw[1]} kW. Putting it on an idle setback would save about <b>${Math.round(idleKwhShift * 0.6)} kWh per shift</b>.`;
  }
  function bottleneckInsight() {
    const parts = [];
    for (const line of ctx.lines.filter((l) => l.motorKind)) {
      const st = line.stations.slice().sort((a, b) => b.ema.util - a.ema.util)[0];
      if (st) parts.push(`${esc(line.short)}: <b>${esc(st.cfg.name)}</b> (${pct(st.ema.util)} busy)`);
    }
    const low = Object.values(stock).filter((b) => b.count <= 2);
    let t = `Constraint stations: ${parts.join(', ')}.`;
    if (low.length) t += ` Low stock: <b>${low.map((b) => esc(b.name)).join(', ')}</b>. Downstream stations will run short of parts.`;
    return t;
  }

  // ============================================================== copilot
  const copilot = (() => {
    const log = document.getElementById('chat-log');
    const input = document.getElementById('chat-input');
    const form = document.getElementById('chat-form');
    const keyInput = document.getElementById('api-key');
    const keyState = document.getElementById('api-state');
    const history = [];
    let key = '';
    try { key = localStorage.getItem('motorplant.anthropicKey') ?? ''; } catch { /* storage blocked */ }
    const setKeyState = () => {
      keyState.textContent = key ? 'Claude connected (your key, stored in this browser only)' : 'Using built-in answers. Add a Claude API key for open-ended questions.';
      keyState.dataset.on = !!key;
      keyInput.value = key ? '••••••••••••' + key.slice(-4) : '';
    };
    setKeyState();
    document.getElementById('api-save').addEventListener('click', () => {
      const v = keyInput.value.trim();
      if (v && !v.startsWith('••')) key = v;
      try { localStorage.setItem('motorplant.anthropicKey', key); } catch { /* ignore */ }
      setKeyState();
    });
    document.getElementById('api-clear').addEventListener('click', () => {
      key = '';
      try { localStorage.removeItem('motorplant.anthropicKey'); } catch { /* ignore */ }
      setKeyState();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      input.value = '';
      ask(q);
    });
    document.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => ask(b.dataset.q)));
    log.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cact]');
      if (!b) return;
      const st = stations[Number(b.dataset.st)];
      if (b.dataset.cact === 'schedule' && st) ai.schedule(st);
      if (b.dataset.cact === 'view' && st) focusStation(st);
      if (b.dataset.cact === 'heat') {
        const sel = document.getElementById('heatmap');
        sel.value = b.dataset.mode;
        sel.dispatchEvent(new Event('change'));
      }
      if (b.dataset.cact === 'autopilot') {
        const cb = document.getElementById('autopilot');
        cb.checked = true;
        cb.dispatchEvent(new Event('change'));
      }
      b.disabled = true;
    });

    function bubble(role, html) {
      const el = document.createElement('div');
      el.className = `msg ${role}`;
      el.innerHTML = html;
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
      return el;
    }
    function md(text) {
      const lines = esc(text).split('\n');
      let html = '';
      let inList = false;
      for (const l of lines) {
        const li = l.match(/^\s*[-•*]\s+(.*)/);
        if (li) {
          if (!inList) html += '<ul>';
          inList = true;
          html += `<li>${li[1]}</li>`;
        } else {
          if (inList) html += '</ul>';
          inList = false;
          if (/^#{1,4}\s/.test(l)) html += `<h4>${l.replace(/^#+\s/, '')}</h4>`;
          else if (l.trim()) html += `<p>${l}</p>`;
        }
      }
      if (inList) html += '</ul>';
      return html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    }

    async function ask(q) {
      bubble('user', esc(q));
      if (key) return askClaude(q);
      const el = bubble('bot', '<span class="typing"><i></i><i></i><i></i></span>');
      await new Promise((r) => setTimeout(r, 500 + Math.random() * 400));
      const { text, actions = [] } = scripted(q);
      el.innerHTML = md(text) + (actions.length ? `<div class="c-acts">${actions.map((a) => `<button class="btn sm" data-cact="${a.act}" ${a.st != null ? `data-st="${a.st}"` : ''} ${a.mode ? `data-mode="${a.mode}"` : ''}>${esc(a.label)}</button>`).join('')}</div>` : '');
      log.scrollTop = log.scrollHeight;
    }

    const SYSTEM = `You are the AI operations copilot inside a live digital twin of an electric motor plant modelled on ABB's Baldor-Reliance motor manufacturing (illustrative; figures are simulated).
The plant has feeder lines (press shop for laminations, East Line 1 rotors, East Line 2 shafts, East Line 3 frames, bracket machining, a stator winding & VPI line in Secondary Processes), two final-assembly lines (Line A NEMA Super-E, Line B IEC M3BP), a rewind service shop, FG racking, a tugger train, shipping staging and truck docks.
Every user message includes a JSON snapshot of the live plant. Answer from that data only: be specific (station names, numbers, hours), concise (under 180 words), and practical, as an experienced plant manager would. Use short bullet points when listing. If the data doesn't answer the question, say so.`;

    async function askClaude(q) {
      const el = bubble('bot', '<span class="typing"><i></i><i></i><i></i></span>');
      let text = '';
      try {
        const { default: Anthropic } = await import('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.127.0/+esm');
        const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
        const snap = { ...snapshot(), recent_events: events.slice(0, 12).map((e) => `${e.t}: ${e.msg}`) };
        const userMsg = { role: 'user', content: `Live plant snapshot (JSON):\n${JSON.stringify(snap)}\n\nQuestion: ${q}` };
        const stream = client.beta.messages.stream({
          model: 'claude-opus-5-5',
          max_tokens: 8000,
          system: SYSTEM,
          output_config: { effort: 'low' },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          messages: [...history, userMsg],
        });
        stream.on('text', (delta) => {
          text += delta;
          el.innerHTML = md(text);
          log.scrollTop = log.scrollHeight;
        });
        const msg = await stream.finalMessage();
        if (msg.stop_reason === 'refusal') {
          el.innerHTML = md('Claude declined to answer that request. Try rephrasing your question about the plant.');
          return;
        }
        history.push(userMsg, { role: 'assistant', content: msg.content });
        if (history.length > 12) history.splice(0, 2);
        if (!text) el.innerHTML = md('(no text returned)');
      } catch (err) {
        const status = err?.status;
        const why = status === 401 ? 'the API key was rejected (401)' : status === 429 ? 'rate limited (429), so try again shortly' : status ? `API error ${status}` : err?.message ?? 'network error';
        const fb = scripted(q);
        el.innerHTML = `<p class="muted">Claude unavailable: ${esc(why)}. Built-in answer:</p>${md(fb.text)}`;
      }
    }

    // ---- built-in answers from live data
    function scripted(q) {
      const s = q.toLowerCase();
      if (/(fail|break|maint|predict|health|next|risk|vibration|bearing)/.test(s)) return answerMaintenance();
      if (/(quality|defect|reject|yield|fpy|vision|scrap)/.test(s)) return answerQuality();
      if (/(energy|power|kw|kwh|electric|carbon|co2)/.test(s)) return answerEnergy();
      if (/(bottleneck|constraint|slow|capacity|takt)/.test(s)) return answerBottleneck();
      if (/(stock|inventory|ship|truck|pallet|logistic|warehouse|fg)/.test(s)) return answerLogistics();
      if (/(why|down|output|behind|plan|target|rate|oee)/.test(s)) return answerOutput();
      if (/(summary|summar|shift|report|status|overview|how are)/.test(s)) return answerSummary();
      return { text: `${answerSummary().text}\n\nI can answer questions about **output**, **bottlenecks**, **predicted failures**, **quality**, **energy** and **logistics**. Add a Claude API key below for open-ended questions.` };
    }
    function answerOutput() {
      const snap = snapshot();
      const rate = snap.output_rate_per_h;
      const causes = [];
      const actions = [];
      const down = stations.filter((st) => st.down);
      for (const st of down.slice(0, 3)) {
        causes.push(`**${st.cfg.name}** (${st.line.short}) is down: ${st.downCause}`);
        if (st.downKind !== 'maint' && !st.maintPending) actions.push({ act: 'schedule', st: stations.indexOf(st), label: `Send tech to ${st.cfg.name}` });
      }
      const low = Object.values(stock).filter((b) => b.count <= 2);
      for (const b of low) causes.push(`**${b.name}** stock is ${b.count}/${b.cap}, so assembly is starving`);
      const starved = stations.filter((st) => st.line.motorKind && st.waiting);
      if (starved.length) causes.push(`${starved.map((st) => `${st.cfg.name} (${st.line.short})`).join(', ')} waiting for parts`);
      if (snap.fg_rack_pallets > 50) causes.push('FG racking is nearly full. If line-end pallets cannot be cleared, the lines will block.');
      const crit = ai.alerts.filter((a) => a.sev === 2);
      for (const a of crit.slice(0, 2)) {
        causes.push(`AI risk: **${a.st.cfg.name}** may fail within ${a.rulH.toFixed(1)} h (${a.st.ai.mode})`);
        if (!a.st.maintPending) actions.push({ act: 'schedule', st: stations.indexOf(a.st), label: `Schedule ${a.st.cfg.name}` });
      }
      const verdict = rate >= plan ? `Output is **${rate.toFixed(0)}/h**, at or above the plan of ${plan}/h.` : `Output is **${rate.toFixed(0)}/h** against a plan of **${plan}/h** (${pct(rate / plan)}).`;
      const text = `${verdict} OEE is ${pct(snap.oee)}: availability ${pct(snap.availability)}, performance ${pct(snap.performance)}, quality ${pct(snap.quality)}.\n\n${causes.length ? 'Main factors right now:\n' + causes.map((c) => `- ${c}`).join('\n') : 'No active losses: every line is flowing. The remaining gap is the run-test cycle time on both lines.'}`;
      return { text, actions };
    }
    function answerMaintenance() {
      if (!ai.alerts.length) {
        const worst = stations.filter((s) => s.ai.tracked).sort((a, b) => a.ai.health - b.ai.health).slice(0, 3);
        return { text: `No failures are predicted right now. All ${stations.filter((s) => s.ai.tracked).length} monitored machines are above the ${pct(ALERT_AT)} health threshold.\n\nLowest health to watch:\n${worst.map((s) => `- ${s.cfg.name} (${s.line.short}): ${pct(s.ai.health)}`).join('\n')}`, actions: [{ act: 'heat', mode: 'health', label: 'Show failure-risk map' }] };
      }
      const rows = ai.alerts.slice(0, 5).map((a) => `- **${a.st.cfg.name}** (${a.st.line.short}): ${a.st.ai.mode}, ~${a.rulH.toFixed(1)} h to failure, ${pct(a.conf)} confidence${a.st.maintPending ? ', tech assigned' : ''}`);
      const actions = ai.alerts.filter((a) => !a.st.maintPending).slice(0, 3).map((a) => ({ act: 'schedule', st: stations.indexOf(a.st), label: `Schedule ${a.st.cfg.name}` }));
      if (!ai.autopilot) actions.push({ act: 'autopilot', label: 'Turn on AI autopilot' });
      return { text: `${ai.alerts.length} machine${ai.alerts.length > 1 ? 's are' : ' is'} trending to failure:\n${rows.join('\n')}\n\nA planned stop takes about ${mins(PLANNED_S)} min, against ${mins(UNPLANNED_S)}+ min for a breakdown (including call-out). So far this shift ${ai.stats.caught} failures were prevented, saving ${mins(ai.stats.avoided)} min.`, actions };
    }
    function answerQuality() {
      const insp = sim.inspected;
      const fpy = insp ? sim.passed / insp : 1;
      const defs = Object.entries(ai.defects).sort((a, b) => b[1] - a[1]);
      const qi = qualityInsight();
      return { text: `Vision QC has inspected **${insp.toLocaleString()}** motors. First-pass yield is **${(fpy * 100).toFixed(1)}%**, with ${sim.rejected} rejected to rework and ${ai.stats.escapes} known escapes.\n\n${defs.length ? 'Rejects by type:\n' + defs.map(([k, n]) => `- ${k}: ${n}`).join('\n') : 'No rejects yet.'}${qi ? '\n\n' + qi.replace(/<\/?b>/g, '**') : ''}` };
    }
    function answerEnergy() {
      const top = stations.slice().sort((a, b) => b.ai.kw - a.ai.kw).slice(0, 4);
      const ei = energyInsight();
      const per = sim.built ? ai.energy.kwh / sim.built : null;
      return { text: `The plant is drawing **${Math.round(ai.energy.kw)} kW**, of which ${BASE_LOAD_KW} kW is base load (HVAC, compressed air, lighting). ${per ? `That is **${per.toFixed(1)} kWh per motor** this shift.` : ''}\n\nLargest loads now:\n${top.map((s) => `- ${s.cfg.name} (${s.line.short}): ${Math.round(s.ai.kw)} kW`).join('\n')}${ei ? '\n\n' + ei.replace(/<\/?b>/g, '**') : ''}`, actions: [{ act: 'heat', mode: 'energy', label: 'Show power map' }] };
    }
    function answerBottleneck() {
      const asm = ctx.lines.filter((l) => l.motorKind);
      const rows = asm.map((l) => {
        const top = l.stations.slice().sort((a, b) => b.ema.util - a.ema.util).slice(0, 2);
        return `- ${l.short}: ${top.map((s) => `**${s.cfg.name}** ${pct(s.ema.util)}`).join(', ')}`;
      });
      const feeders = ctx.lines.filter((l) => !l.motorKind && l.id !== 'rewind').map((l) => ({ l, blocked: l.stations.reduce((a, s) => a + s.ema.blocked, 0) / l.stations.length }));
      const idleFeeder = feeders.sort((a, b) => b.blocked - a.blocked)[0];
      return { text: `Busiest stations (the constraints):\n${rows.join('\n')}\n\nRun Test sets the pace on both lines. A second dynamometer, or moving hipot to an offline station, would lift Line A by about 8%.${idleFeeder && idleFeeder.blocked > 0.2 ? ` The feeders have spare capacity: ${idleFeeder.l.short} is blocked ${pct(idleFeeder.blocked)} of the time because its stock is full.` : ''}`, actions: [{ act: 'heat', mode: 'util', label: 'Show utilisation map' }] };
    }
    function answerLogistics() {
      const snap = snapshot();
      return { text: `Sub-assembly stock:\n${Object.values(stock).map((b) => `- ${b.name}: ${b.count}/${b.cap}`).join('\n')}\n\nFinished goods: **${snap.fg_rack_pallets}** pallets in racking, **${snap.staged_pallets}** staged for shipping, ${snap.trucks_at_dock} truck(s) at the docks. ${snap.shipped_motors.toLocaleString()} motors shipped this shift on ${snap.trucks_out} trucks.` };
    }
    function answerSummary() {
      const snap = snapshot();
      return { text: `**${snap.clock}**\n- Built **${snap.motors_built}** motors (A ${snap.line_A_built} / B ${snap.line_B_built}) at ${snap.output_rate_per_h}/h vs plan ${plan}/h\n- OEE ${pct(snap.oee)}, FPY ${snap.first_pass_yield != null ? pct(snap.first_pass_yield) : '—'}\n- ${ai.alerts.length} open AI maintenance alert(s), ${mins(ai.stats.avoided)} min downtime avoided\n- ${Math.round(ai.energy.kw)} kW now${snap.kwh_per_motor ? `, ${snap.kwh_per_motor} kWh/motor` : ''}\n- ${snap.shipped_motors} motors shipped, ${snap.staged_pallets} pallets staged` };
    }
    bubble('bot', md(`Hi, I'm the plant copilot. I read the live data from this digital twin. Ask me why output is down, what will fail next, or how quality is trending.`));
    return { ask };
  })();
  ai.copilot = copilot;

  return ai;
}
