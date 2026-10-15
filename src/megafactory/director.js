// Director mode: a scripted cinematic tour for presenting or recording the plant. Each shot
// dollies the camera from one framing to another (or rides along with a live unit), under
// letterbox bars with a caption; cuts dip to black. Captions read live numbers from the sim.
import * as THREE from 'three';
import { N } from './plant.js';
import { kpis } from './sim.js';
import { clock } from './hud.js';

const V = (a) => new THREE.Vector3(...a);
const smooth = (k) => k * k * (3 - 2 * k);

// static dolly: from [pos, target] to [pos, target]
const dolly = (from, to) => ({ from: [V(from[0]), V(from[1])], to: [V(to[0]), V(to[1])] });

const SHOTS = [
  { title: 'Megafactory', sub: () => 'Body in White → powder coat → battery modules → pack line → yard', dur: 8,
    ...dolly([[-80, 300, 290], [-20, 0, -10]], [[40, 165, 175], [-6, 0, -22]]) },
  { title: 'Body in White', sub: () => 'Robots weld roll-formed rails into an 8.8 m enclosure frame', dur: 7,
    ...dolly([[-88, 16, 14], [-114, 1, 0]], [[-92, 14, -24], [-114, 1, -32]]) },
  { title: 'Pretreatment', sub: () => 'Five spray stages: alkaline clean, rinse, zirconium conversion, rinse, DI rinse', dur: 7,
    ...dolly([[-92, 11, -50], [-88, 2.4, -66]], [[-60, 11, -50], [-64, 2.4, -66]]) },
  { title: 'Primer booth', sub: () => 'Sixteen automatic guns charge the powder so it wraps onto the frame', dur: 8,
    track: (c) => c.inNode(N.PRIMER, (e) => -Math.abs(e.u.at.x + 22)), off: [[13, 9, 17], [-9, 8, 16]],
    ...dolly([[-10, 12, -50], [-22, 2.4, -66]], [[-30, 10, -52], [-20, 2.4, -66]]) },
  { title: 'Topcoat booth', sub: () => 'Megapack white, then touched up by hand at the corners and door frames', dur: 7,
    track: (c) => c.inNode(N.TOP, (e) => -Math.abs(e.u.at.x - 54)), off: [[-12, 8, 16], [12, 9, 17]],
    ...dolly([[44, 12, -50], [54, 2.4, -66]], [[66, 10, -52], [56, 2.4, -66]]) },
  { title: 'Cure oven', sub: () => '200 °C: the powder flows out and cures to a gloss white finish', dur: 7,
    ...dolly([[84, 14, -34], [70, 3, -50]], [[44, 12, -36], [50, 3, -50]]) },
  { title: 'Inspection', sub: (k) => `Film thickness and gloss on every part · first pass ${(k.paintFpy * 100).toFixed(1)} %`, dur: 6,
    ...dolly([[20, 9, -38], [8, 2.4, -49]], [[14, 6, -41], [8, 2.6, -50]]) },
  { title: 'Battery modules', sub: () => '144 cells per tray, laser-welded, potted, lidded and tested', dur: 7,
    ...dolly([[70, 12, -10], [60, 1, -24]], [[14, 10, -10], [8, 1, -24]]) },
  { title: 'Pack line', sub: () => '48 modules, an HV busbar spine, a thermal roof and 16 doors per Megapack', dur: 9,
    track: (c) => c.inNode(N.MI) || c.inNode(N.EN), off: [[10, 7, 15], [-8, 6, 14]],
    ...dolly([[-90, 12, 26], [-80, 1, 8]], [[-20, 12, 26], [-30, 1, 8]]) },
  { title: 'End-of-Line Test', sub: (k) => `The constraint: one Megapack every ${k.takt ? k.takt.toFixed(0) : '–'} minutes`, dur: 6,
    ...dolly([[18, 10, 24], [6, 2, 8]], [[0, 8, 20], [6, 2, 8]]) },
  { title: 'Outbound', sub: () => 'The gantry crane sets each pack down; straddle carriers take it out to the lot', dur: 8,
    track: (c) => c.carried(), off: [[24, 17, 28], [-22, 15, 28]],
    ...dolly([[72, 20, 24], [36, 3, 14]], [[120, 38, 46], [64, 0, 62]]) },
  { title: 'Shipping', sub: (k, s) => `${k.shipped} Megapacks shipped since ${clock(s.kpi.t0).day.split(' ·')[0]} · ${k.lot} in the lot`, dur: 7,
    ...dolly([[150, 26, 128], [100, 1, 100]], [[130, 34, 70], [80, 0, 70]]) },
  { title: 'Megafactory', sub: (k) => `${k.gwhYear ? k.gwhYear.toFixed(1) : '–'} GWh a year at the current rate`, dur: 8,
    ...dolly([[40, 165, 175], [-6, 0, -22]], [[-60, 330, 300], [-20, 0, -10]]) },
];

export class Director {
  constructor({ stage, items, sim, onStart, onStop }) {
    Object.assign(this, { stage, items, sim, onStart, onStop });
    this.on = false;
    const el = (cls, html = '') => { const e = document.createElement('div'); e.className = cls; e.innerHTML = html; document.body.append(e); return e; };
    this.top = el('lbar top', '<span class="lmark"><i></i>MEGAFACTORY</span>');
    this.bottom = el('lbar bottom', '<div class="cap"><b></b><span></span></div><span class="esc">Esc or D to exit</span>');
    this.fade = el('lfade');
    this.capT = this.bottom.querySelector('b');
    this.capS = this.bottom.querySelector('.cap span');
    this.cap = this.bottom.querySelector('.cap');
    this.tracked = new THREE.Vector3();
  }

  // live context for tracking shots
  ctx() {
    const live = this.items.live || [];
    return {
      inNode: (n, score = () => 0) => {
        const c = live.filter(e => e.n === n);
        c.sort((a, b) => score(b) - score(a));
        return c[0]?.u.at || null;
      },
      carried: () => live.find(e => (e.n === N.LOT || e.n === N.TRUCK || e.n === N.PAD || e.n === N.CRANE) && (e.pl.mf < 1 || e.n === N.CRANE))?.u.at || null,
    };
  }

  start() {
    if (this.on) return;
    this.on = true;
    this.i = -1;
    this.next();
    document.body.classList.add('director');
    this.stage.controls.enabled = false;
    this.stage.drive = (dt) => this.update(dt);
    this.onStart?.();
  }
  stop() {
    if (!this.on) return;
    this.on = false;
    document.body.classList.remove('director');
    this.fade.style.opacity = '0';
    this.stage.drive = null;
    this.stage.controls.enabled = true;
    this.onStop?.();
  }
  toggle() { this.on ? this.stop() : this.start(); }

  next() {
    this.i = (this.i + 1) % SHOTS.length;
    this.shot = SHOTS[this.i];
    this.t = 0;
    this.lock = null;
    this.capT.textContent = this.shot.title;
  }

  update(dt) {
    const sh = this.shot;
    this.t += dt;
    if (this.t >= sh.dur) { this.next(); return this.update(0); }
    const k = smooth(Math.min(1, this.t / sh.dur));
    this.capS.textContent = sh.sub(kpis(this.sim), this.sim);
    // dip to black at the cuts
    const edge = Math.min(this.t, sh.dur - this.t);
    this.fade.style.opacity = String(edge < 0.45 ? 1 - edge / 0.45 : 0);
    // caption rises in after the cut (driven by the shot clock, not a CSS animation)
    const c = Math.min(1, Math.max(0, (this.t - 0.3) / 0.8));
    this.cap.style.opacity = String(c);
    this.cap.style.transform = `translateY(${(1 - c) * 10}px)`;
    // a tracking shot rides along with a live unit when there is one
    const hit = sh.track ? sh.track(this.ctx()) : null;
    if (hit) {
      if (!this.lock) { this.lock = true; this.tracked.copy(hit); }
      this.tracked.lerp(hit, Math.min(1, dt * 4));
      const o = sh.off[0].map((v, j) => v + (sh.off[1][j] - v) * k);
      return { pos: this.tracked.clone().add(V(o)), target: this.tracked.clone().add(V([0, 1.6, 0])) };
    }
    return { pos: sh.from[0].clone().lerp(sh.to[0], k), target: sh.from[1].clone().lerp(sh.to[1], k) };
  }
}
