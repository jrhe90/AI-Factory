// Live KPI dashboard over the simulation: headline numbers, throughput and WIP trends,
// station states over time, and where each station's time goes. Plain SVG, no chart library.
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';
import { Icon } from './icons.jsx';

// Status colours are reserved for station states and always shown with a legend
const STATES = [
  ['busy', 'Working', '#22c55e'],
  ['blocked', 'Blocked', '#f59e0b'],
  ['idle', 'Starved', '#64748b'],
  ['down', 'Down', '#ef4444'],
  ['off', 'No crew', '#a78bfa'],
];
const SERIES = { rate: '#a28bff', wip: '#22d3ee' };

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(300);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.max(120, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const fmtH = (t) => (t >= 3600 ? `${(t / 3600).toFixed(t % 3600 ? 1 : 0)}h` : `${Math.round(t / 60)}m`);
function ticks(max, n = 4) {
  const raw = max / n;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? raw;
  const out = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(v);
  return out;
}
function timeTicks(tMax) {
  const hours = tMax / 3600;
  const step = hours <= 1.5 ? 900 : hours <= 3 ? 1800 : hours <= 8 ? 3600 : 7200;
  const out = [];
  for (let t = 0; t <= tMax + 1; t += step) out.push(t);
  return out;
}

// Single-series trend with a hover crosshair
function Trend({ title, unit, data, field, color, fmt = (v) => v.toFixed(0) }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState(null);
  const h = 150;
  const m = { l: 34, r: 10, t: 10, b: 20 };
  const tMax = Math.max(3600, data.length ? data[data.length - 1].t : 0);
  const yMax = Math.max(1, ...data.map((d) => d[field])) * 1.15;
  const yt = ticks(yMax);
  const top = yt[yt.length - 1] || 1;
  const x = (t) => m.l + (t / tMax) * (w - m.l - m.r);
  const y = (v) => h - m.b - (v / top) * (h - m.t - m.b);
  const pts = data.map((d) => [x(d.t), y(d[field])]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const area = pts.length ? `${line}L${pts[pts.length - 1][0]},${y(0)}L${pts[0][0]},${y(0)}Z` : '';
  const last = data[data.length - 1];
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - r.left - m.l) / (w - m.l - m.r)) * tMax;
    let best = null;
    for (const d of data) if (!best || Math.abs(d.t - t) < Math.abs(best.t - t)) best = d;
    setHover(best);
  };
  return (
    <div className="db-card">
      <div className="db-head"><span>{title}</span><b className="db-now">{last ? fmt(last[field]) : '–'} <small>{unit}</small></b></div>
      <div ref={ref} className="db-plot">
        <svg width={w} height={h} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={title}>
          {yt.map((v) => (
            <g key={v}>
              <line x1={m.l} x2={w - m.r} y1={y(v)} y2={y(v)} className="db-grid" />
              <text x={m.l - 6} y={y(v) + 3.5} className="db-axis" textAnchor="end">{v >= 1000 ? `${v / 1000}k` : v}</text>
            </g>
          ))}
          {timeTicks(tMax).map((t) => <text key={t} x={x(t)} y={h - 5} className="db-axis" textAnchor="middle">{fmtH(t)}</text>)}
          {area && <path d={area} fill={color} opacity="0.14" />}
          {line && <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
          {pts.length > 0 && <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="4" fill={color} stroke="var(--panel)" strokeWidth="2" />}
          {hover && (
            <g>
              <line x1={x(hover.t)} x2={x(hover.t)} y1={m.t} y2={h - m.b} className="db-cross" />
              <circle cx={x(hover.t)} cy={y(hover[field])} r="4" fill={color} stroke="var(--panel)" strokeWidth="2" />
            </g>
          )}
        </svg>
        {hover && (
          <div className="db-tip" style={{ left: Math.min(w - 110, x(hover.t) + 8) }}>
            <span>{fmtH(hover.t)}</span><b>{fmt(hover[field])} {unit}</b>
          </div>
        )}
      </div>
    </div>
  );
}

// How many stations are in each state over time (stacked)
function StateArea({ data, total }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState(null);
  const h = 150;
  const m = { l: 34, r: 10, t: 10, b: 20 };
  const tMax = Math.max(3600, data.length ? data[data.length - 1].t : 0);
  const x = (t) => m.l + (t / tMax) * (w - m.l - m.r);
  const y = (v) => h - m.b - (v / Math.max(1, total)) * (h - m.t - m.b);
  const layers = [];
  const base = data.map(() => 0);
  for (const [key, , color] of STATES) {
    const lo = base.slice();
    data.forEach((d, i) => { base[i] += d.states[key] ?? 0; });
    const up = data.map((d, i) => `${x(d.t).toFixed(1)},${y(base[i]).toFixed(1)}`);
    const down = data.map((d, i) => `${x(d.t).toFixed(1)},${y(lo[i]).toFixed(1)}`).reverse();
    if (data.length > 1) layers.push(<path key={key} d={`M${up.join('L')}L${down.join('L')}Z`} fill={color} stroke="var(--panel)" strokeWidth="1" />);
  }
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - r.left - m.l) / (w - m.l - m.r)) * tMax;
    let best = null;
    for (const d of data) if (!best || Math.abs(d.t - t) < Math.abs(best.t - t)) best = d;
    setHover(best);
  };
  return (
    <div className="db-card">
      <div className="db-head"><span>Station states over time</span><small className="muted">{total} stations</small></div>
      <div ref={ref} className="db-plot">
        <svg width={w} height={h} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Station states over time">
          {ticks(total, 3).map((v) => (
            <g key={v}>
              <line x1={m.l} x2={w - m.r} y1={y(v)} y2={y(v)} className="db-grid" />
              <text x={m.l - 6} y={y(v) + 3.5} className="db-axis" textAnchor="end">{v}</text>
            </g>
          ))}
          {timeTicks(tMax).map((t) => <text key={t} x={x(t)} y={h - 5} className="db-axis" textAnchor="middle">{fmtH(t)}</text>)}
          {layers}
          {hover && <line x1={x(hover.t)} x2={x(hover.t)} y1={m.t} y2={h - m.b} className="db-cross" />}
        </svg>
        {hover && (
          <div className="db-tip" style={{ left: Math.min(w - 120, x(hover.t) + 8) }}>
            <span>{fmtH(hover.t)}</span>
            {STATES.map(([k, label]) => <span key={k}>{label}: <b>{hover.states[k] ?? 0}</b></span>)}
          </div>
        )}
      </div>
      <Legend />
    </div>
  );
}

function Legend() {
  return (
    <div className="db-legend">
      {STATES.map(([k, label, color]) => <span key={k}><i style={{ background: color }} />{label}</span>)}
    </div>
  );
}

// Where each station's time goes, busiest first; the bottleneck is flagged
function StationBars({ stations, bottleneckId }) {
  const rows = stations.slice().sort((a, b) => b.util - a.util).slice(0, 12);
  return (
    <div className="db-card db-stations">
      <div className="db-head"><span>Station time split</span><small className="muted">top 12 by utilisation</small></div>
      <div className="db-bars">
        {rows.map((s) => {
          const parts = [['busy', s.util], ['blocked', s.blocked], ['idle', s.starved], ['down', s.down], ['off', s.off]];
          return (
            <div key={s.id} className={`db-bar ${s.id === bottleneckId ? 'neck' : ''}`} title={`${s.name}: ${Math.round(s.util * 100)}% working, ${Math.round(s.blocked * 100)}% blocked, ${Math.round(s.starved * 100)}% starved, ${Math.round(s.down * 100)}% down`}>
              <span className="db-name">{s.id === bottleneckId && <em>BOTTLENECK</em>}{s.name}</span>
              <span className="db-track">
                {parts.map(([k, v]) => v > 0.004 && <i key={k} style={{ width: `${v * 100}%`, background: STATES.find((q) => q[0] === k)[2] }} />)}
              </span>
              <b>{Math.round(s.util * 100)}%</b>
            </div>
          );
        })}
      </div>
      <Legend />
    </div>
  );
}

function Kpi({ label, value, unit, sub }) {
  return (
    <div className="db-kpi">
      <span>{label}</span>
      <b>{value}<small>{unit}</small></b>
      {sub && <em>{sub}</em>}
    </div>
  );
}

export default function Dashboard() {
  const open = useStore((s) => s.dashboard);
  const stats = useStore((s) => s.simStats);
  const project = useStore((s) => s.project);
  if (!open) return null;
  const close = () => useStore.setState({ dashboard: false });
  const h = stats?.history ?? [];
  const stations = stats?.stations ?? [];
  const avgUtil = stations.length ? stations.reduce((a, s) => a + s.util, 0) / stations.length : 0;
  const vehUtil = stats?.vehicles?.length ? stats.vehicles.reduce((a, v) => a + v.util, 0) / stats.vehicles.length : 0;
  const people = project.objects.filter((o) => o.type === 'operator').length;
  return (
    <section className="dashboard" aria-label="Simulation dashboard">
      <header className="db-top">
        <div>
          <h2>Plant dashboard</h2>
          <span className="muted">{project.name} · {stats ? stats.clock : 'not running'}{stats?.onBreak ? ' · crews on break' : ''}</span>
        </div>
        <button className="tb icon" onClick={close} title="Close dashboard"><Icon name="close" /></button>
      </header>
      {!stats ? (
        <p className="db-empty">Start the simulation to see live KPIs.</p>
      ) : (
        <>
          <div className="db-kpis">
            <Kpi label="Units shipped" value={stats.finished.toLocaleString()} unit="" sub={`${Math.round(stats.t / 3600 * 10) / 10} h simulated`} />
            <Kpi label="Throughput" value={stats.rate.toFixed(1)} unit="/h" sub="rolling hour" />
            <Kpi label="Work in progress" value={stats.wip} unit="parts" />
            <Kpi label="Lead time" value={stats.avgLead ? (stats.avgLead / 60).toFixed(0) : '–'} unit="min" sub="avg, last 200" />
            <Kpi label="Station utilisation" value={Math.round(avgUtil * 100)} unit="%" sub={`${stations.length} stations · ${people} operators`} />
            <Kpi label="Fleet busy" value={Math.round(vehUtil * 100)} unit="%" sub={`${stats.vehicles.length} vehicles · ${stats.waitingTransport} waiting`} />
            <Kpi label="Breakdowns" value={stats.breakdowns} unit="" sub={stats.bottleneck ? `bottleneck: ${stats.bottleneck.name}` : 'warming up'} />
          </div>
          <div className="db-grid3">
            <Trend title="Throughput" unit="units/h" data={h} field="rate" color={SERIES.rate} fmt={(v) => v.toFixed(1)} />
            <Trend title="Work in progress" unit="parts" data={h} field="wip" color={SERIES.wip} />
            <StateArea data={h} total={stations.length} />
          </div>
          <div className="db-grid2">
            <StationBars stations={stations} bottleneckId={stats.bottleneck?.id} />
            <div className="db-card">
              <div className="db-head"><span>Vehicles</span><small className="muted">share of time busy</small></div>
              <div className="db-bars">
                {stats.vehicles.map((v) => (
                  <div key={v.id} className="db-bar">
                    <span className="db-name">{v.name}</span>
                    <span className="db-track"><i style={{ width: `${v.util * 100}%`, background: SERIES.wip }} /></span>
                    <b>{Math.round(v.util * 100)}%</b>
                  </div>
                ))}
              </div>
              <div className="db-head db-sub"><span>Events</span></div>
              <ul className="db-log">
                {stats.log.length ? stats.log.slice().reverse().map((e, i) => <li key={i} className={e.kind === 'warn' ? 'db-warn' : ''}><span className="mono">{e.clock.replace(/^Day \d+ · /, '')}</span>{e.text}</li>) : <li className="muted">No events yet</li>}
              </ul>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
