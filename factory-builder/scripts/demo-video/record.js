// Frame-by-frame recorder for the Sim Factory demo video (see README.md in this folder).
// The app's render loop is stopped; every video frame advances virtual timers, steps the
// viewport by 1/FPS, updates the overlay (cursor, captions, cards) and takes a screenshot.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { ZONES } = require('./zones.js');

const FPS = 30;
const W = 1600;
const H = 900;
const DSF = Number(process.env.DSF || 1.2);
const OUT = process.env.OUT || path.join(__dirname, 'frames');
const DRY = !!process.env.DRY; // skip screenshots (timing / logic check)
const STOP_AT = Number(process.env.STOP_AT || 1e9); // seconds
const SHOTS = (process.env.SHOTS || '').split(',').filter(Boolean).map(Number); // frames to save as png when DRY

fs.mkdirSync(OUT, { recursive: true });
const FROM = Number(process.env.FROM || 0); // re-render from this frame on, keeping earlier frames
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.jpg') && Number(f.slice(1, 6)) >= FROM) fs.unlinkSync(path.join(OUT, f));

const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

// ------------------------------------------------------------------ page-side setup
const INIT = () => {
  // deterministic randomness
  let seed = 20261012;
  Math.random = () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // virtual timers, advanced by the recorder once per frame
  const q = new Map();
  let now = 0;
  let nid = 1;
  window.setTimeout = (fn, ms = 0, ...args) => { const id = nid++; q.set(id, { at: now + Math.max(0, ms), fn, args }); return id; };
  window.clearTimeout = (id) => q.delete(id);
  window.setInterval = (fn, ms = 0, ...args) => { const id = nid++; q.set(id, { at: now + Math.max(1, ms), fn, args, every: Math.max(1, ms) }); return id; };
  window.clearInterval = (id) => q.delete(id);
  window.__vt = {
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of q) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        const [id, t] = next;
        now = t.at;
        if (t.every) t.at += t.every; else q.delete(id);
        try { t.fn(...t.args); } catch (e) { console.error(e); }
      }
      now = end;
    },
  };
  try { localStorage.clear(); } catch {}
};

const OVERLAY = () => {
  const css = `
  .toasts { bottom: 122px !important; }
  #fx { position: fixed; inset: 0; pointer-events: none; z-index: 10000; font-family: Inter, system-ui, sans-serif; }
  #fx-cursor { position: absolute; left: 0; top: 0; width: 26px; height: 26px; transform-origin: 0 0; filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)); }
  .fx-ripple { position: absolute; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%; border: 3px solid #a28bff; background: rgba(124,92,255,.25); }
  #fx-cap { position: absolute; left: 50%; bottom: 46px; transform: translateX(-50%); display: flex; align-items: center; gap: 14px; padding: 12px 22px 12px 12px; border-radius: 16px; background: rgba(10,13,18,.92); border: 1px solid rgba(255,255,255,.12); box-shadow: 0 18px 40px rgba(0,0,0,.45); color: #fff; white-space: nowrap; }
  #fx-cap .n { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 11px; background: linear-gradient(135deg,#7c5cff,#22d3ee); font-weight: 800; font-size: 20px; }
  #fx-cap .t { font-size: 23px; font-weight: 700; letter-spacing: -0.01em; }
  #fx-cap .s { font-size: 15px; color: #aab6c3; margin-top: 2px; font-weight: 500; }
  #fx-title, #fx-end { position: absolute; inset: 0; display: grid; place-items: center; background: radial-gradient(900px 500px at 30% 20%, rgba(124,92,255,.35), transparent), radial-gradient(700px 400px at 80% 90%, rgba(34,211,238,.22), transparent), rgba(9,12,17,.94); color: #fff; text-align: center; }
  .fx-card h1 { margin: 0; font-size: 76px; font-weight: 900; letter-spacing: -0.035em; line-height: 1; }
  .fx-card h1 span { background: linear-gradient(135deg,#a28bff,#22d3ee); -webkit-background-clip: text; color: transparent; }
  .fx-card p { margin: 18px 0 0; font-size: 26px; color: #c9d2dc; font-weight: 500; }
  .fx-card .chips { display: flex; gap: 10px; justify-content: center; margin-top: 30px; }
  .fx-card .chips b { padding: 9px 16px; border-radius: 99px; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14); font-size: 17px; font-weight: 600; }
  .fx-card .chips i { font-style: normal; color: #6b7686; align-self: center; font-size: 20px; }
  .fx-card small { display: block; margin-top: 34px; font-size: 15px; color: #7d8896; }
  #fx-file { position: absolute; left: 0; top: 0; display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 12px; background: #fff; color: #111; box-shadow: 0 16px 36px rgba(0,0,0,.4); font-size: 15px; font-weight: 600; }
  #fx-file img { width: 64px; height: 38px; object-fit: cover; border-radius: 4px; border: 1px solid #ddd; }
  #fx-file em { display: block; font-style: normal; font-weight: 500; color: #667; font-size: 12px; }
  `;
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
  const fx = document.createElement('div');
  fx.id = 'fx';
  fx.innerHTML = `
    <div id="fx-title" class="fx-card"><div>
      <h1>Sim <span>Factory</span></h1>
      <p>From a floor plan to a running factory digital twin in one minute</p>
      <div class="chips"><b>Import layout</b><i>→</i><b>Sketch zones</b><i>→</i><b>Auto-build</b><i>→</i><b>Simulate</b><i>→</i><b>Dashboard</b></div>
    </div></div>
    <div id="fx-end" class="fx-card"><div>
      <h1>Sim <span>Factory</span></h1>
      <p>Import · sketch · auto-build · simulate · analyse</p>
      <div class="chips"><b>Image, PDF &amp; DXF import</b><b>40+ equipment models</b><b>AGVs, forklifts &amp; crews</b><b>Live KPIs</b></div>
      <small>Runs in the browser · React + three.js · auto-build is rule-based (zone templates) · all data simulated</small>
    </div></div>
    <div id="fx-file"><img src="samples/reference-plan.webp" alt=""><div>plant-layout.webp<em>2000 × 1183 · floor plan</em></div></div>
    <div id="fx-cap"><div class="n">1</div><div><div class="t"></div><div class="s"></div></div></div>
    <svg id="fx-cursor" viewBox="0 0 24 24"><path d="M4 2l15 10.5-6.6 1.3 3.9 7.3-2.6 1.4-3.9-7.4L4 20z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
  document.body.appendChild(fx);
  const $ = (id) => document.getElementById(id);
  const ripples = [];
  const { vp, store } = window.simFactory;
  vp.capture(true);
  const V3 = vp.persp.position.constructor;

  window.__dir = {
    // world (x, z) -> CSS px in the page
    toScreen(x, z) {
      vp.controls.update();
      vp.camera.updateMatrixWorld();
      const v = new V3(x, 0, z).project(vp.camera);
      const r = vp.renderer.domElement.getBoundingClientRect();
      return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
    },
    ripple(x, y) { ripples.push({ x, y, age: 0 }); },
    frame(s, dt) {
      window.__vt.advance(dt * 1000);
      // camera keyframes
      if (s.cam) {
        const { from, to, k } = s.cam;
        const T = from.target.map((a, i) => a + (to.target[i] - a) * k);
        const off = (c) => { const d = c.pos.map((a, i) => a - c.target[i]); const r = Math.hypot(...d); return { r, phi: Math.acos(Math.max(-1, Math.min(1, d[1] / r))), th: Math.atan2(d[0], d[2]) }; };
        const a = off(from);
        const b = off(to);
        let dth = b.th - a.th;
        if (dth > Math.PI) dth -= Math.PI * 2;
        if (dth < -Math.PI) dth += Math.PI * 2;
        const r = a.r * (b.r / a.r) ** k;
        const phi = a.phi + (b.phi - a.phi) * k;
        const th = a.th + dth * k;
        vp.controlsP.target.set(...T);
        vp.persp.position.set(T[0] + r * Math.sin(phi) * Math.sin(th), T[1] + r * Math.cos(phi), T[2] + r * Math.sin(phi) * Math.cos(th));
        vp.persp.lookAt(...T);
      }
      vp.tick(dt);
      // overlay
      $('fx-title').style.opacity = s.title;
      $('fx-title').style.display = s.title > 0.001 ? '' : 'none';
      $('fx-end').style.opacity = s.end;
      $('fx-end').style.display = s.end > 0.001 ? '' : 'none';
      const cap = $('fx-cap');
      cap.style.opacity = s.cap ? s.capA : 0;
      if (s.cap) {
        cap.querySelector('.n').textContent = s.cap[0];
        cap.querySelector('.t').textContent = s.cap[1];
        cap.querySelector('.s').textContent = s.cap[2] ?? '';
        cap.style.transform = `translateX(-50%) translateY(${(1 - s.capA) * 14}px)`;
      }
      const cur = $('fx-cursor');
      cur.style.display = s.cursorOn ? '' : 'none';
      cur.style.transform = `translate(${s.cursor[0] - 4}px, ${s.cursor[1] - 2}px) scale(${s.pressed ? 0.88 : 1})`;
      const file = $('fx-file');
      file.style.display = s.file ? '' : 'none';
      if (s.file) file.style.transform = `translate(${s.file[0]}px, ${s.file[1]}px) rotate(${s.file[2] ?? 0}deg)`;
      for (const r of ripples) r.age += dt;
      while (ripples.length && ripples[0].age > 0.6) {
        ripples[0].el?.remove();
        ripples.shift();
      }
      for (const r of ripples) {
        if (!r.el) { r.el = document.createElement('div'); r.el.className = 'fx-ripple'; fx.appendChild(r.el); }
        const k = r.age / 0.6;
        r.el.style.left = `${r.x}px`;
        r.el.style.top = `${r.y}px`;
        r.el.style.transform = `scale(${1 + k * 3.2})`;
        r.el.style.opacity = String(1 - k);
      }
    },
  };
};

(async () => {
  const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  if (process.env.HTTPS_PROXY) args.push(`--proxy-server=${process.env.HTTPS_PROXY}`, '--proxy-bypass-list=localhost;127.0.0.1');
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message, e.stack?.split('\n').slice(0, 3).join(' | ')));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) console.log('[console]', m.text().slice(0, 300)); });
  await page.addInitScript(INIT);
  await page.goto(process.env.URL || 'http://localhost:4173/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.simFactory);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(OVERLAY);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));

  // ---------------------------------------------------------------- director state
  const S = { title: 1, end: 0, cap: null, capA: 0, cursor: [W * 0.62, H * 0.6], cursorOn: false, pressed: false, file: null, cam: null };
  let frameNo = 0;
  let capT = 0;
  const t0 = Date.now();
  const frame = async () => {
    if (S.cap) { capT += 1 / FPS; S.capA = Math.min(1, capT / 0.35); } else S.capA = 0;
    await page.evaluate(([s, dt]) => window.__dir.frame(s, dt), [S, 1 / FPS]);
    if (!DRY && frameNo >= FROM) await page.screenshot({ path: path.join(OUT, `f${String(frameNo).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93 });
    else if (SHOTS.includes(frameNo) || (process.env.EVERY && frameNo % Number(process.env.EVERY) === 0)) await page.screenshot({ path: path.join(OUT, `s${frameNo}.png`) });
    frameNo++;
    if (frameNo % 30 === 0) {
      const el = (Date.now() - t0) / 1000;
      process.stdout.write(`t=${(frameNo / FPS).toFixed(1)}s frames=${frameNo} elapsed=${el.toFixed(0)}s (${(el / frameNo).toFixed(2)} s/frame)\n`);
    }
    if (frameNo / FPS >= STOP_AT) throw new Error('STOP');
  };
  const wait = async (sec) => { for (let i = 0, n = Math.round(sec * FPS); i < n; i++) await frame(); };
  const caption = (n, t, s) => { S.cap = [String(n), t, s]; capT = 0; };
  const move = async (x, y, sec = 0.7, during) => {
    const [x0, y0] = S.cursor;
    const n = Math.max(1, Math.round(sec * FPS));
    for (let i = 1; i <= n; i++) {
      const k = ease(i / n);
      S.cursor = [x0 + (x - x0) * k, y0 + (y - y0) * k];
      await page.mouse.move(S.cursor[0], S.cursor[1]);
      if (during) await during(k);
      await frame();
    }
  };
  const click = async (hold = 2) => {
    await page.evaluate(([x, y]) => window.__dir.ripple(x, y), S.cursor);
    S.pressed = true;
    await page.mouse.down();
    await frame();
    await page.mouse.up();
    for (let i = 1; i < hold; i++) await frame();
    S.pressed = false;
  };
  const center = async (sel) => {
    const b = await page.locator(sel).first().boundingBox();
    if (!b) throw new Error(`no element ${sel}`);
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  const clickOn = async (sel, sec = 0.7, pause = 0.15) => {
    const [x, y] = await center(sel);
    await move(x, y, sec);
    await wait(pause);
    await click();
  };
  const until = async (fn, arg, label) => {
    const start = Date.now();
    while (!(await page.evaluate(fn, arg))) {
      if (Date.now() - start > 60000) throw new Error(`timeout waiting for ${label}`);
      await page.waitForTimeout(100);
    }
  };
  const camNow = () => page.evaluate(() => { const { vp } = window.simFactory; vp.controls.update(); return { pos: vp.persp.position.toArray(), target: vp.controlsP.target.toArray() }; });
  const fly = async (to, sec, from) => {
    const a = from ?? await camNow();
    const n = Math.round(sec * FPS);
    for (let i = 1; i <= n; i++) {
      S.cam = { from: a, to, k: ease(i / n) };
      await frame();
    }
    S.cam = null;
  };

  try {
    // ================================================================ 0 · title
    await wait(2.2);
    for (let i = 1; i <= 12; i++) { S.title = 1 - i / 12; await frame(); }
    S.cursorOn = true;

    // ================================================================ 1 · new factory
    caption(1, 'Start a new, empty factory');
    await clickOn('button:has-text("New")', 0.8);
    await wait(0.3);
    await clickOn('.dialog button.primary', 0.6);
    await wait(0.6);

    // ================================================================ 2 · import the plan
    caption(2, 'Import the floor plan', 'Image, PDF or AutoCAD DXF');
    await clickOn('button:has-text("Import layout")', 0.7);
    await wait(0.3);
    const drop = await center('.drop');
    S.file = [W * 0.86, H * 0.82, -4];
    const f0 = [...S.file];
    await move(f0[0] + 40, f0[1] + 30, 0.5);
    await wait(0.15);
    S.pressed = true;
    await move(drop[0] - 20, drop[1] - 10, 1.0, async (k) => {
      S.file = [S.cursor[0] - 40, S.cursor[1] - 30, -4 * (1 - k)];
      if (k > 0.75) await page.evaluate(() => document.querySelector('.drop')?.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })));
    });
    await wait(0.2);
    S.pressed = false;
    S.file = null;
    await page.evaluate(async () => {
      const blob = await (await fetch('samples/reference-plan.webp')).blob();
      const file = new File([blob], 'plant-layout.webp', { type: 'image/webp' });
      const dt = new DataTransfer();
      dt.items.add(file);
      document.querySelector('.drop').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    await until(() => !!window.simFactory.store.getState().project.floor.source && !document.querySelector('.dialog'), null, 'import');
    await until(() => { const m = window.simFactory.vp.floorG.children[0]?.children[0]?.material; return !!m?.map?.image?.complete; }, null, 'floor texture');
    await wait(0.4);
    await clickOn('.seg button:has-text("Plan")', 0.6);
    await page.evaluate(() => window.simFactory.vp.fit());
    await wait(0.6);

    // ================================================================ 3 · calibrate
    caption(3, 'Set the scale', 'Click two points, type the real distance');
    const px = (u, v) => page.evaluate(([u, v]) => {
      const f = window.simFactory.store.getState().project.floor;
      const x = f.center[0] + (u - f.source.width / 2) * f.mpp;
      const z = f.center[1] + (v - f.source.height / 2) * f.mpp;
      return window.__dir.toScreen(x, z);
    }, [u, v]);
    let p = await px(25, 640);
    await move(p[0], p[1], 0.8);
    await click();
    p = await px(1970, 640);
    await move(p[0], p[1], 1.0);
    await click();
    await until(() => !!document.querySelector('.dialog input'), null, 'calibrate dialog');
    await wait(0.4);
    await page.locator('.dialog input').selectText();
    await wait(0.2);
    for (const ch of '160') { await page.keyboard.type(ch); await wait(0.12); }
    await wait(0.25);
    await clickOn('.dialog button.primary', 0.5);
    await wait(0.2);
    await page.evaluate(() => window.simFactory.vp.fit());
    await wait(0.5);

    // ================================================================ 4 · zones
    caption(4, 'Sketch the zones', 'Assembly, machining, warehouses, docks, canteen');
    await clickOn('nav.rail button[aria-label="Draw zones"]', 0.6);
    await wait(0.2);
    for (const [i, [name, kind, u0, v0, u1, v1]] of ZONES.entries()) {
      await page.evaluate((k) => window.simFactory.store.setState({ zoneKind: k }), kind);
      const a = await px(u0, v0);
      const b = await px(u1, v1);
      await move(a[0], a[1], i < 2 ? 0.45 : 0.32);
      S.pressed = true;
      await page.mouse.down();
      await move(b[0], b[1], i < 2 ? 0.6 : 0.4);
      await page.mouse.up();
      S.pressed = false;
      await page.evaluate((nm) => {
        const st = window.simFactory.store.getState();
        const id = st.selection[0];
        st.update((p) => { const z = p.zones.find((q) => q.id === id); if (z) z.name = nm; }, { history: false });
      }, name);
      await wait(i < 2 ? 0.25 : 0.12);
    }
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await wait(0.6);

    // ================================================================ 5 · auto-build
    caption(5, 'Auto-build the factory', 'Lines, storage, docks, crews and AGV routes from zone templates');
    // swap the plan view for a top-down 3D camera that frames the same area
    const top = await page.evaluate(() => {
      const { vp, store } = window.simFactory;
      const o = vp.ortho;
      const t = vp.controlsO.target.clone();
      const visH = (o.top - o.bottom) / o.zoom;
      const h = visH / (2 * Math.tan((vp.persp.fov * Math.PI) / 360));
      store.setState({ view: '3d' });
      return { pos: [t.x, h, t.z + 0.01], target: [t.x, 0, t.z] };
    });
    S.cam = { from: top, to: top, k: 1 };
    await wait(0.05);
    S.cam = null;
    await clickOn('button:has-text("Auto-build")', 0.7);
    // the app's own "fit" framing, pulled in a little
    const over = await page.evaluate(() => {
      const { vp } = window.simFactory;
      const keep = { pos: vp.persp.position.clone(), target: vp.controlsP.target.clone() };
      vp.fit();
      const t = vp.controlsP.target.toArray();
      const pos = vp.persp.position.toArray().map((v, i) => t[i] + (v - t[i]) * 0.9);
      vp.persp.position.copy(keep.pos);
      vp.controlsP.target.copy(keep.target);
      return { pos, target: t };
    });
    S.cursorOn = false;
    // fade the drawing so the equipment reads clearly
    await page.evaluate(() => window.simFactory.store.getState().update((p) => { p.floor.opacity = 0.28; }, { history: false }));
    await fly(over, 5.5, top);
    S.cursorOn = true;
    await wait(0.8);

    // ================================================================ 6 · simulate
    caption(6, 'Run the simulation', 'Fast-forward the first hour, then watch it run at 10×');
    await clickOn('button.run', 0.7);
    await page.evaluate(() => { const st = window.simFactory.store; st.setState({ sim: { ...st.getState().sim, speed: 1200 } }); });
    const speedSel = await center('.speed select');
    await move(speedSel[0], speedSel[1], 0.6);
    await wait(2.6);
    await page.evaluate(() => { const st = window.simFactory.store; st.setState({ sim: { ...st.getState().sim, speed: 10 } }); });
    S.cursorOn = false;
    // close look along assembly line A, then lift back out
    const line = await page.evaluate(() => {
      const p = window.simFactory.store.getState().project;
      const get = (n) => p.objects.find((o) => o.name === n);
      const a = get('Rotor insertion A') ?? p.objects[0];
      const b = get('Paint A') ?? p.objects[1];
      return { a: [a.x, a.z], b: [b.x, b.z] };
    });
    const c1 = { pos: [line.a[0] - 12, 17, line.a[1] + 25], target: [line.a[0] + 6, 0.5, line.a[1] + 3] };
    const c2 = { pos: [line.b[0] - 14, 15, line.b[1] + 23], target: [line.b[0] + 4, 0.5, line.b[1] + 3] };
    await page.evaluate(() => { window.simFactory.vp.zoneLabelNear = 160; });
    await fly(c1, 2.2);
    await fly(c2, 5.5, c1);
    await fly(over, 2.0, c2);
    await page.evaluate(() => { window.simFactory.vp.zoneLabelNear = 38; });
    S.cursorOn = true;

    // ================================================================ 7 · dashboard
    caption(7, 'Live dashboard', 'Throughput, WIP, bottleneck, fleet and crew utilisation');
    await clickOn('button:has-text("Dashboard")', 0.7);
    await page.evaluate(() => { const st = window.simFactory.store; st.setState({ sim: { ...st.getState().sim, speed: 1200 } }); });
    await wait(1.5);
    const chart = await page.locator('.db-grid3 .db-card').first().boundingBox();
    await move(chart.x + chart.width * 0.55, chart.y + chart.height * 0.55, 0.8);
    await move(chart.x + chart.width * 0.8, chart.y + chart.height * 0.5, 1.6);
    const bars = await page.locator('.db-stations').boundingBox();
    await move(bars.x + bars.width * 0.6, bars.y + 50, 0.8);
    await wait(2.2);

    // ================================================================ end card
    S.cap = null;
    S.cursorOn = false;
    for (let i = 1; i <= 15; i++) { S.end = i / 15; await frame(); }
    await wait(3.2);
  } catch (e) {
    if (e.message !== 'STOP') throw e;
  }
  console.log(`done: ${frameNo} frames (${(frameNo / FPS).toFixed(1)} s) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  await browser.close();
})();
