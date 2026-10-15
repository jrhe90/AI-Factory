// Heads-up display: top bar, camera rail, status legend, KPI strip, station card, tooltips and toasts.
import { NODES, LINES } from './plant.js';
import { kpis, status, utilisation, bottleneck } from './sim.js';
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
  constructor(cb) {
    this.cb = cb;
    const { onSpeed, onPause, onView, onQuality } = cb;
    const top = h('header', 'panel top', `
      <div class="brand"><div class="mark" aria-hidden="true"></div>
        <div><h1>MEGAFACTORY</h1><p>Utility-scale battery plant · powder coat → modules → pack line → yard</p></div></div>
      <div class="spacer"></div>
      <button class="btn icon menu" id="menuBtn" aria-label="Views and controls" aria-expanded="false">☰</button>
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
    this.$('menuBtn').onclick = () => this.menu();

    const rail = h('nav', 'panel rail');
    let group = null;
    Object.entries(VIEWS).forEach(([k, v], i) => {
      if (v.group !== group) { group = v.group; rail.append(h('h3', '', group)); }
      const b = h('button', 'btn', v.label);
      b.title = i < 10 ? `${v.label} (${(i + 1) % 10})` : v.label;
      b.onclick = () => onView(k);
      rail.append(b);
    });
    rail.append(h('h3', '', 'Ride along'));
    const fol = h('button', 'btn follow', 'Follow a frame');
    fol.title = 'Ride along with a frame through the paint shop (F)';
    fol.onclick = () => this.cb.onFollow?.('frame');
    const folp = h('button', 'btn follow', 'Follow a pack');
    folp.title = 'Ride along with a pack from Chassis Load to the truck (G)';
    folp.onclick = () => this.cb.onFollow?.('pack');
    rail.append(fol, folp);
    rail.append(h('div', 'sep'));
    const st = h('button', 'btn', 'Stations'); st.id = 'stationsBtn'; st.title = 'Station list by line (L)'; st.onclick = () => this.toggleStations();
    const faults = h('label', 'toggle', '<input type="checkbox" id="faults" checked> Random faults');
    faults.querySelector('input').onchange = (e) => this.cb.onFaults?.(e.target.checked);
    const q = h('button', 'btn', 'Quality: high'); q.id = 'quality'; q.onclick = () => onQuality();
    const hide = h('button', 'btn', 'Hide panels'); hide.title = 'Hide panels (H)'; hide.onclick = () => document.body.classList.toggle('clean');
    rail.append(st, faults, q, hide);
    rail.append(h('h3', '', 'Present'));
    const dir = h('button', 'btn', 'Director tour'); dir.title = 'Cinematic tour with captions, for presenting or recording (D)'; dir.onclick = () => this.cb.onDirector?.();
    const orb = h('button', 'btn', 'Orbit'); orb.id = 'orbitBtn'; orb.title = 'Slow cinematic orbit around the view (C)'; orb.onclick = () => this.cb.onOrbit?.();
    const still = h('button', 'btn', '4K still'); still.title = 'Save a 3840 × 2160 image of the 3D view (P)'; still.onclick = () => this.cb.onStill?.();
    rail.append(dir, orb, still);
    rail.querySelectorAll('.btn').forEach(b => b.addEventListener('click', () => { if (innerWidth <= 760) this.menu(false); }));
    document.body.append(rail);

    const legend = h('div', 'legend', Object.values(STATUS).map(s => `<span><i style="color:${s.color};background:${s.color}"></i>${s.label}</span>`).join(''));
    document.body.append(legend);

    this.kpiEl = h('section', 'panel kpis', `
      <div class="kpi hero"><div class="v" id="k-built">0</div><div class="l" id="k-built-l">Megapacks built</div></div>
      <div class="kpi"><div class="v" id="k-ship">0</div><div class="l"><span id="k-mwh">0</span> MWh shipped</div></div>
      <div class="kpi"><div class="v"><span id="k-takt">–</span><small>min</small></div><div class="l">Takt (target 68)</div></div>
      <div class="kpi"><div class="v"><span id="k-gwh">–</span><small>GWh/yr</small></div><div class="l">Run-rate</div></div>
      <div class="kpi wide"><div class="v small" id="k-bn">–</div><div class="l">Bottleneck · <span id="k-bnp">–</span> working</div></div>
      <div class="kpi"><div class="v"><span id="k-fpy">–</span><small>/ <span id="k-eol">–</span>%</small></div><div class="l">First pass: paint / EOL</div></div>
      <div class="kpi"><div class="v" id="k-frames">0</div><div class="l">Coated frames waiting</div></div>
      <div class="kpi"><div class="v" id="k-rack">0</div><div class="l">Module trays in racks</div><div class="bar"><i id="b-rack"></i></div></div>
      <div class="kpi"><div class="v" id="k-lot">0</div><div class="l">In lot · <span id="k-trucks">0</span> trucks waiting</div><div class="bar"><i id="b-lot"></i></div></div>`);
    document.body.append(this.kpiEl);

    this.card = h('aside', 'panel card');
    this.card.hidden = true;
    document.body.append(this.card);
    this.tip = h('div', 'tip');
    document.body.append(this.tip);
    this.toasts = h('div', 'toasts');
    this.toasts.setAttribute('role', 'status');
    document.body.append(this.toasts);
    this.stations = h('aside', 'panel stations');
    this.stations.hidden = true;
    this.lineTab = 'pack';
    document.body.append(this.stations);
    this.followEl = h('div', 'panel followchip');
    this.followEl.hidden = true;
    document.body.append(this.followEl);
    this.selected = -1;
    this.logSeen = 0;
  }

  // phone: the camera rail opens as a sheet from the menu button
  menu(open) {
    const on = document.body.classList.toggle('menu-open', open);
    this.$('menuBtn').setAttribute('aria-expanded', String(on));
  }
  setOrbit(on) { this.$('orbitBtn').classList.toggle('on', on); }
  toast(text, kind = 'ok') {
    const t = h('div', `toast ${kind}`, text);
    this.toasts.prepend(t);
    setTimeout(() => t.remove(), 4200);
  }

  setFollow(text) {
    this.followEl.hidden = !text;
    if (!text) return;
    if (this.followEl.dataset.t === text) return;
    this.followEl.dataset.t = text;
    this.followEl.innerHTML = `<span class="dot"></span><span>${text}</span><button class="btn" aria-label="Stop following">Stop</button>`;
    this.followEl.querySelector('button').onclick = () => this.cb.onStopFollow?.();
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
    this.$('k-mwh').textContent = fmt(k.mwhShipped, 0);
    const bn = bottleneck(s);
    this.$('k-bn').textContent = bn ? NODES[bn.n].label : '–';
    this.$('k-bnp').textContent = bn ? `${Math.round(bn.share * 100)}%` : '–';
    this.$('k-frames').textContent = k.coatedFrames;
    this.$('k-trucks').textContent = k.trucksWaiting;
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
    if (!this.stations.hidden) this.renderStations(s);
    this.sim = s;
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

  toggleStations(force) {
    this.stations.hidden = force != null ? !force : !this.stations.hidden;
    this.$('stationsBtn').classList.toggle('on', !this.stations.hidden);
    if (!this.stations.hidden && this.sim) this.renderStations(this.sim);
  }

  // station list for one line: status dot, name, time split bar; click opens the station card.
  // Rows are built when the tab changes and only their values are updated afterwards, so clicks
  // always land on a live element.
  renderStations(s) {
    if (this.builtTab !== this.lineTab) {
      this.builtTab = this.lineTab;
      const tabs = Object.entries(LINES).map(([k, l]) => `<button class="tab ${k === this.lineTab ? 'on' : ''}" data-line="${k}" role="tab" aria-selected="${k === this.lineTab}">${l.name}</button>`).join('');
      this.rows = NODES.map((d, n) => ({ d, n })).filter(({ d }) => d.line === this.lineTab && (d.kind === 'station' || d.kind === 'conveyor' || d.kind === 'truck'));
      this.stations.innerHTML = `<div class="tabs" role="tablist">${tabs}</div>
        <div class="srows">${this.rows.map(({ d, n }) => `<button class="srow" data-n="${n}"><i class="dot"></i>
          <span class="sname">${d.label}</span><span class="spct"></span>
          <span class="sbar">${['busy', 'blocked', 'starved', 'down'].map(k => `<i style="background:${STATUS[k].color}"></i>`).join('')}</span></button>`).join('')}</div>
        <div class="sfoot"></div>`;
      this.stations.querySelectorAll('.tab').forEach(b => b.onclick = () => { this.lineTab = b.dataset.line; this.renderStations(this.sim || s); });
      this.stations.querySelectorAll('.srow').forEach(b => b.onclick = () => this.cb.onSelect?.(Number(b.dataset.n)));
    }
    this.stations.querySelectorAll('.tab').forEach((t) => {
      t.classList.toggle('fault', NODES.some((d, n) => d.line === t.dataset.line && s.nodes[n].down));
    });
    this.stations.querySelectorAll('.srow').forEach((row) => {
      const n = Number(row.dataset.n), st = STATUS[status(s, n)], u = utilisation(s, n);
      const dot = row.querySelector('.dot');
      dot.style.background = dot.style.color = st.color;
      row.querySelector('.spct').textContent = `${Math.round(u.busy * 100)}%`;
      row.querySelectorAll('.sbar i').forEach((bar, k) => { bar.style.width = `${u[['busy', 'blocked', 'starved', 'down'][k]] * 100}%`; });
      row.title = `${NODES[n].label} · ${st.label}`;
    });
    const last = this.rows[this.rows.length - 1];
    this.stations.querySelector('.sfoot').textContent = last ? `${s.nodes[last.n].done} through ${last.d.label} since start` : '';
  }

  select(s, n) {
    this.selected = n;
    this.cardFor = null;
    this.card.hidden = n < 0;
    document.body.classList.toggle('card-open', n >= 0);
    if (n >= 0) this.renderCard(s, n);
  }

  // station card: built once per selection, values refreshed in place
  renderCard(s, n) {
    const d = NODES[n], nd = s.nodes[n], st = status(s, n), u = utilisation(s, n);
    const q = (sel) => this.card.querySelector(sel);
    if (this.cardFor !== n) {
      this.cardFor = n;
      const plan = d.kind === 'conveyor' ? `${fmt(d.L / d.v)} min dwell · ${d.v} m/min` : `${d.time} min · ${d.mode}`;
      const canFault = d.kind === 'station' || d.fail;
      this.card.innerHTML = `
        <button class="btn icon x" aria-label="Close">✕</button>
        <h2>${d.label}</h2>
        <div class="line">${LINES[d.line]?.name ?? ''}${d.sub ? ' · ' + d.sub : ''}</div>
        <span class="pill"><i></i><span class="pl"></span></span>
        <div class="row unit"><span class="ul">Working on</span><b class="uv"></b></div><div class="prog"><i></i></div>
        <div class="row"><span>Plan</span><b>${plan}</b></div>
        ${d.kind !== 'conveyor' ? '<div class="row"><span>Measured</span><b class="meas"></b></div>' : ''}
        <div class="row"><span>Completed since start</span><b class="done"></b></div>
        <div class="row"><span>Breakdowns</span><b class="fails"></b></div>
        <div class="stack" aria-label="Time split">${['busy', 'blocked', 'starved', 'down'].map(k => `<i style="background:${STATUS[k].color}"></i>`).join('')}</div>
        <div class="stackkey">${['busy', 'blocked', 'starved', 'down'].map(k => `<span>${STATUS[k].label} <b data-k="${k}"></b></span>`).join('')}</div>
        ${canFault ? '<button class="btn danger fault">Inject fault</button>' : ''}`;
      q('.x').onclick = () => this.cb.onClose();
      const fb = q('.fault');
      if (fb) fb.onclick = () => ((this.sim || s).nodes[n].down ? this.cb.onClear : this.cb.onFault)?.(n);
    }
    const S = STATUS[st];
    q('.pill').style.color = S.color;
    q('.pl').textContent = S.label;
    const unit = nd.items[0];
    if (d.kind === 'conveyor') {
      q('.ul').textContent = 'On the section';
      q('.uv').textContent = `${nd.items.length} / ${d.cap}`;
      q('.prog').hidden = true;
    } else {
      const working = unit && unit.ready > s.t;
      q('.ul').textContent = working ? 'Working on' : unit ? 'Holding' : 'Waiting for work';
      q('.uv').textContent = unit ? unit.name : '–';
      q('.prog').hidden = !working;
      if (working) q('.prog i').style.width = `${Math.max(0, Math.min(1, (s.t - unit.pStart) / (unit.ready - unit.pStart))) * 100}%`;
    }
    const meas = q('.meas');
    if (meas) meas.textContent = `${fmt(nd.done ? nd.st.busy / nd.done : null, 1)} min / unit`;
    q('.done').textContent = nd.done;
    q('.fails').textContent = `${nd.fails}${nd.down ? ` · back at ${clock(nd.downUntil).time}` : ''}`;
    this.card.querySelectorAll('.stack i').forEach((bar, k) => { bar.style.width = `${u[['busy', 'blocked', 'starved', 'down'][k]] * 100}%`; });
    this.card.querySelectorAll('.stackkey b').forEach((b) => { b.textContent = `${Math.round(u[b.dataset.k] * 100)}%`; });
    const fb = q('.fault');
    if (fb) { fb.textContent = nd.down ? 'Clear fault' : 'Inject fault'; fb.classList.toggle('clear', nd.down); }
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
