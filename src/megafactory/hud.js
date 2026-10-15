// Heads-up display: top bar, camera rail, status legend, KPI strip, station card, tooltips and toasts.
import { NODES, LINES } from './plant.js';
import { kpis, status, utilisation } from './sim.js';
import { STATUS } from './render/materials.js';
import { VIEWS } from './render/stage.js';

export const SPEEDS = [1, 4, 15, 60];   // factory minutes per real second
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const START = 6 * 60;                     // t = 0 is Monday 06:00

export function clock(t) {
  const m = Math.floor(t + START), d = Math.floor(m / 1440);
  return { time: `${String(Math.floor(m % 1440 / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
           day: `${DAYS[d % 7]} · day ${d + 1}`, shift: (m % 1440) >= 360 && (m % 1440) < 1080 ? 'Day shift' : 'Night shift' };
}

const h = (tag, cls, html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; e.innerHTML = html; return e; };
const fmt = (v, d = 0) => v == null || !isFinite(v) ? '–' : v.toFixed(d);

export class Hud {
  constructor({ onSpeed, onPause, onView, onQuality, onClose }) {
    this.cb = { onSpeed, onPause, onView, onQuality, onClose };
    const top = h('header', 'panel top', `
      <div class="brand"><div class="mark" aria-hidden="true"></div>
        <div><h1>MEGAFACTORY</h1><p>Utility-scale battery plant · powder coat → modules → pack line → yard</p></div></div>
      <div class="spacer"></div>
      <div class="clock"><b id="clk">06:00</b><span id="day">Mon · day 1</span></div>
      <div class="seg"><button class="btn icon" id="pause" title="Pause (Space)" aria-label="Pause">❚❚</button>
        <span class="seg" id="speeds"></span><span class="rate" id="rate"></span></div>`);
    document.body.append(top);
    this.$ = (id) => document.getElementById(id);
    SPEEDS.forEach((v, i) => {
      const b = h('button', 'btn', `${v}×`);
      b.title = `1 s = ${v} min (${i + 1 === 1 ? 'slow' : i + 1 === SPEEDS.length ? 'fast' : 'normal'})`;
      b.dataset.v = v;
      b.onclick = () => onSpeed(v);
      this.$('speeds').append(b);
    });
    this.$('pause').onclick = () => onPause();

    const rail = h('nav', 'panel rail', '<h3>Camera</h3>');
    Object.entries(VIEWS).forEach(([k, v], i) => {
      const b = h('button', 'btn', v.label);
      b.title = `${v.label} (${i + 1})`;
      b.onclick = () => onView(k);
      rail.append(b);
    });
    rail.append(h('div', 'sep'));
    const q = h('button', 'btn', 'Quality: high'); q.id = 'quality'; q.onclick = () => onQuality();
    const hide = h('button', 'btn', 'Hide panels'); hide.title = 'Hide panels (H)'; hide.onclick = () => document.body.classList.toggle('clean');
    rail.append(q, hide);
    document.body.append(rail);

    const legend = h('div', 'legend', Object.values(STATUS).map(s => `<span><i style="color:${s.color};background:${s.color}"></i>${s.label}</span>`).join(''));
    document.body.append(legend);

    this.kpiEl = h('section', 'panel kpis', `
      <div class="kpi hero"><div class="v" id="k-built">0</div><div class="l" id="k-built-l">Megapacks built</div></div>
      <div class="kpi"><div class="v"><span id="k-takt">–</span><small>min</small></div><div class="l">Takt (target 68)</div></div>
      <div class="kpi"><div class="v"><span id="k-gwh">–</span><small>GWh/yr</small></div><div class="l">Run-rate</div></div>
      <div class="kpi"><div class="v" id="k-wip">0</div><div class="l">Paint carriers in use</div><div class="bar"><i id="b-wip"></i></div></div>
      <div class="kpi"><div class="v"><span id="k-fpy">–</span><small>%</small></div><div class="l">Paint first-pass yield</div></div>
      <div class="kpi"><div class="v"><span id="k-eol">–</span><small>%</small></div><div class="l">End-of-line first pass</div></div>
      <div class="kpi"><div class="v" id="k-rack">0</div><div class="l">Module trays in racks</div><div class="bar"><i id="b-rack"></i></div></div>
      <div class="kpi"><div class="v" id="k-lot">0</div><div class="l">Packs in lot · <span id="k-ship">0</span> shipped</div><div class="bar"><i id="b-lot"></i></div></div>`);
    document.body.append(this.kpiEl);

    this.card = h('aside', 'panel card');
    this.card.hidden = true;
    document.body.append(this.card);
    this.tip = h('div', 'tip');
    document.body.append(this.tip);
    this.toasts = h('div', 'toasts');
    this.toasts.setAttribute('role', 'status');
    document.body.append(this.toasts);
    this.selected = -1;
    this.logSeen = 0;
  }

  setSpeed(v, paused) {
    this.$('speeds').querySelectorAll('.btn').forEach(b => b.classList.toggle('on', Number(b.dataset.v) === v && !paused));
    this.$('pause').textContent = paused ? '▶' : '❚❚';
    this.$('pause').setAttribute('aria-label', paused ? 'Play' : 'Pause');
    this.$('rate').textContent = paused ? 'paused' : `1 s = ${v} min`;
  }
  setQuality(q) { this.$('quality').textContent = `Quality: ${q}`; }

  update(s) {
    const c = clock(s.t);
    this.$('clk').textContent = c.time;
    this.$('day').textContent = `${c.day} · ${c.shift}`;
    const k = kpis(s);
    this.$('k-built').textContent = k.built;
    const since = clock(s.kpi.t0);
    this.$('k-built-l').textContent = `Built since ${since.day.split(' ·')[0]} ${since.time}`;
    this.$('k-takt').textContent = fmt(k.takt);
    this.$('k-gwh').textContent = fmt(k.gwhYear, 1);
    this.$('k-wip').innerHTML = `${k.paintWip}<small>/ ${s.p.carriers}</small>`;
    this.$('b-wip').style.width = `${(k.paintWip / s.p.carriers) * 100}%`;
    this.$('k-fpy').textContent = fmt(k.paintFpy * 100, 1);
    this.$('k-eol').textContent = fmt(k.eolFpy * 100, 1);
    this.$('k-rack').innerHTML = `${k.rack}<small>/ 56</small>`;
    this.$('b-rack').style.width = `${(k.rack / 56) * 100}%`;
    this.$('b-rack').className = k.rack < 8 ? 'warn' : '';
    this.$('k-lot').innerHTML = `${k.lot}<small>/ 60</small>`;
    this.$('b-lot').style.width = `${(k.lot / 60) * 100}%`;
    this.$('b-lot').className = k.lot > 52 ? 'warn' : '';
    this.$('k-ship').textContent = k.shipped;
    if (this.selected >= 0) this.renderCard(s, this.selected);
    // toasts for breakdowns, repairs and paint rejects
    const fresh = s.log.filter(e => e.t > this.logSeen);
    if (fresh.length) this.logSeen = fresh[fresh.length - 1].t;
    for (const e of fresh.slice(-3)) {
      if (!['fail', 'repair', 'reject'].includes(e.kind)) continue;
      const t = h('div', `toast ${e.kind === 'repair' ? 'ok' : e.kind === 'reject' ? 'warn' : ''}`, `<time>${clock(e.t).time}</time>${e.msg}`);
      this.toasts.prepend(t);
      setTimeout(() => t.remove(), 5200);
      while (this.toasts.children.length > 3) this.toasts.lastChild.remove();
    }
  }

  select(s, n) {
    this.selected = n;
    this.card.hidden = n < 0;
    if (n >= 0) this.renderCard(s, n);
  }

  renderCard(s, n) {
    const d = NODES[n], nd = s.nodes[n], st = status(s, n), u = utilisation(s, n);
    const S = STATUS[st];
    const unit = nd.items[0];
    let prog = '';
    if (unit && d.kind !== 'conveyor' && unit.ready > s.t) {
      const p = Math.max(0, Math.min(1, (s.t - unit.pStart) / (unit.ready - unit.pStart)));
      prog = `<div class="row"><span>Working on</span><b>${unit.name}</b></div><div class="prog"><i style="width:${p * 100}%"></i></div>`;
    } else if (d.kind === 'conveyor') {
      prog = `<div class="row"><span>On the section</span><b>${nd.items.length} / ${d.cap}</b></div>`;
    }
    const plan = d.kind === 'conveyor' ? `${fmt(d.L / d.v)} min dwell · ${d.v} m/min` : `${d.time} min · ${d.mode}`;
    const actual = nd.done ? (nd.st.busy + nd.st.blocked * 0) / nd.done : null;
    const pct = (v) => `${Math.round(v * 100)}%`;
    this.card.innerHTML = `
      <button class="btn icon x" aria-label="Close">✕</button>
      <h2>${d.label}</h2>
      <div class="line">${LINES[d.line]?.name ?? ''}${d.sub ? ' · ' + d.sub : ''}</div>
      <span class="pill" style="color:${S.color}"><i></i>${S.label}</span>
      ${prog}
      <div class="row"><span>Plan</span><b>${plan}</b></div>
      ${d.kind !== 'conveyor' ? `<div class="row"><span>Measured</span><b>${fmt(actual, 1)} min / unit</b></div>` : ''}
      <div class="row"><span>Completed since start</span><b>${nd.done}</b></div>
      <div class="row"><span>Breakdowns</span><b>${nd.fails}${nd.down ? ` · back at ${clock(nd.downUntil).time}` : ''}</b></div>
      <div class="stack" aria-label="Time split">${['busy', 'blocked', 'starved', 'down'].map(k => `<i style="width:${u[k] * 100}%;background:${STATUS[k].color}"></i>`).join('')}</div>
      <div class="stackkey">${['busy', 'blocked', 'starved', 'down'].map(k => `<span>${STATUS[k].label} <b>${pct(u[k])}</b></span>`).join('')}</div>`;
    this.card.querySelector('.x').onclick = () => this.cb.onClose();
  }

  showTip(x, y, s, n) {
    if (n < 0) { this.tip.style.display = 'none'; return; }
    const st = STATUS[status(s, n)];
    this.tip.innerHTML = `<b>${NODES[n].label}</b> <span>· ${st.label}</span>`;
    this.tip.style.display = 'block';
    this.tip.style.left = `${Math.min(x + 14, innerWidth - 220)}px`;
    this.tip.style.top = `${y + 14}px`;
  }
}
