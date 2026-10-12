import { useStore } from '../store.js';
import { getViewport } from '../engine/Viewport.js';
import { CATALOG_BY_TYPE } from '../library/catalog.js';
import { ZONE_KINDS, LINK_KINDS, polygonArea, polylineLength, newId } from '../model/project.js';
import { drawingToWorld } from '../importers/index.js';
import { Icon } from './icons.jsx';

const upd = (fn, opts) => useStore.getState().update(fn, opts);

function Num({ value, onChange, step = 0.1, min, suffix }) {
  return (
    <span className="num">
      <input type="number" value={Number.isFinite(value) ? +Number(value).toFixed(3) : ''} step={step} min={min}
        onChange={(e) => e.target.value !== '' && onChange(Number(e.target.value))} />
      {suffix && <em>{suffix}</em>}
    </span>
  );
}
function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function ObjectInspector({ o }) {
  const project = useStore((s) => s.project);
  const def = CATALOG_BY_TYPE[o.type];
  const set = (fn) => upd((p) => fn(p.objects.find((x) => x.id === o.id)));
  const vp = getViewport();
  const clashes = vp ? vp.clashesFor(o) : [];
  const stations = project.objects.filter((x) => CATALOG_BY_TYPE[x.type]?.role === 'station');
  const ins = project.links.filter((l) => l.to === o.id);
  const outs = project.links.filter((l) => l.from === o.id);
  const name = (id) => project.objects.find((x) => x.id === id)?.name ?? id;
  const crew = project.objects.filter((x) => x.type === 'operator' && x.props?.stationId === o.id);
  const addOperator = () => {
    let id;
    upd((p) => {
      id = newId(p, 'object', 'operator');
      const r = ((o.rot ?? 0) * Math.PI) / 180;
      const k = crew.length;
      const lx = -0.8 + k * 0.8;
      const lz = 2.4;
      p.objects.push({ id, type: 'operator', name: `Operator ${p.objects.filter((x) => x.type === 'operator').length + 1}`, x: o.x + lx * Math.cos(r) + lz * Math.sin(r), z: o.z - lx * Math.sin(r) + lz * Math.cos(r), rot: (o.rot ?? 0) + 90, lineId: '', props: { stationId: o.id } });
    });
  };
  return (
    <div className="insp">
      <div className="insp-head">
        <span className={`glyph role-${def.role}`}>{def.glyph}</span>
        <div>
          <input className="title-input" value={o.name} onChange={(e) => set((x) => { x.name = e.target.value; })} aria-label="Name" />
          <small>{def.label} · {o.id} · {def.role}</small>
        </div>
      </div>
      <p className="desc">{def.desc}</p>
      <div className="grid2">
        <Field label="X (m)"><Num value={o.x} onChange={(v) => set((x) => { x.x = v; })} /></Field>
        <Field label="Z (m)"><Num value={o.z} onChange={(v) => set((x) => { x.z = v; })} /></Field>
        <Field label="Rotation"><Num value={o.rot ?? 0} step={15} suffix="°" onChange={(v) => set((x) => { x.rot = v; })} /></Field>
        {['station', 'source', 'sink', 'buffer', 'storage'].includes(def.role) && (
          <Field label="Line">
            <select value={o.lineId ?? ''} onChange={(e) => {
              if (e.target.value === '__new') {
                upd((p) => {
                  const id = newId(p, 'line');
                  p.lines.push({ id, name: `Line ${p.lines.length + 1}`, color: '#7c5cff' });
                  p.objects.find((x) => x.id === o.id).lineId = id;
                });
              } else set((x) => { x.lineId = e.target.value; });
            }}>
              <option value="">None</option>
              {project.lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              <option value="__new">+ New line…</option>
            </select>
          </Field>
        )}
      </div>
      {def.fields.length > 0 && <h4>Parameters</h4>}
      <div className="grid2">
        {def.fields.map(([key, label, kind, opt]) => {
          const val = o.props?.[key] ?? def.defaults[key];
          if (kind === 'station') {
            return (
              <Field key={key} label={label}>
                <select value={val ?? ''} onChange={(e) => set((x) => { x.props = { ...x.props, [key]: e.target.value }; })}>
                  <option value="">Unassigned</option>
                  {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            );
          }
          return (
            <Field key={key} label={label}>
              <Num value={val} step={opt?.step ?? 1} min={opt?.min} onChange={(v) => set((x) => { x.props = { ...x.props, [key]: v }; })} />
            </Field>
          );
        })}
        {['source', 'receiving-dock'].includes(o.type) && (
          <Field label="Part colour">
            <input type="color" value={o.props?.itemColor ?? '#4f8bd6'} onChange={(e) => set((x) => { x.props = { ...x.props, itemColor: e.target.value }; })} />
          </Field>
        )}
      </div>
      {def.role === 'station' && (o.props?.operators ?? def.defaults.operators) > 0 && (
        <>
          <h4>Crew</h4>
          <p className="desc">
            {crew.length
              ? `${crew.length} of ${o.props?.operators ?? def.defaults.operators} operators assigned. The station stops when fewer are present (breaks, walking).`
              : `No operators placed: a virtual crew of ${o.props?.operators ?? def.defaults.operators} is assumed and stops for shift breaks.`}
          </p>
          {crew.map((c) => <div key={c.id} className="chip">{c.name}</div>)}
          <button className="btn sm" onClick={addOperator}><Icon name="plus" size={14} /> Add operator here</button>
        </>
      )}
      {(ins.length > 0 || outs.length > 0) && <h4>Flow</h4>}
      {ins.map((l) => <div key={l.id} className="flow-row">← from <b>{name(l.from)}</b><em>{LINK_KINDS[l.kind].label}</em></div>)}
      {outs.map((l) => <div key={l.id} className="flow-row">→ to <b>{name(l.to)}</b><em>{LINK_KINDS[l.kind].label}</em></div>)}
      {clashes.length > 0 && <div className="warn">Overlaps {clashes.map((c) => c.name).join(', ')}</div>}
      <div className="actions">
        <button className="btn" onClick={() => useStore.getState().rotateSelected(90)}><Icon name="rotate" size={15} /> Rotate</button>
        <button className="btn" onClick={() => useStore.getState().duplicateSelected()}><Icon name="copy" size={15} /> Duplicate</button>
        <button className="btn danger" onClick={() => useStore.getState().removeSelected()}><Icon name="trash" size={15} /> Delete</button>
      </div>
    </div>
  );
}

function ShapeInspector({ entity, kind }) {
  const key = { zone: 'zones', wall: 'walls', aisle: 'aisles', route: 'routes', link: 'links', line: 'lines' }[kind];
  const set = (fn) => upd((p) => fn(p[key].find((x) => x.id === entity.id)));
  const project = useStore((s) => s.project);
  const name = (id) => project.objects.find((x) => x.id === id)?.name ?? id;
  return (
    <div className="insp">
      <div className="insp-head"><span className="glyph">{kind.slice(0, 3).toUpperCase()}</span><div><b className="title">{entity.name ?? `${kind[0].toUpperCase()}${kind.slice(1)} ${entity.id}`}</b><small>{entity.id}</small></div></div>
      <div className="grid2">
        {'name' in entity && <Field label="Name"><input value={entity.name} onChange={(e) => set((x) => { x.name = e.target.value; })} /></Field>}
        {kind === 'zone' && (
          <>
            <Field label="Type">
              <select value={entity.kind} onChange={(e) => set((x) => { x.kind = e.target.value; x.color = ZONE_KINDS[e.target.value].color; })}>
                {Object.entries(ZONE_KINDS).map(([k, z]) => <option key={k} value={k}>{z.label}</option>)}
              </select>
            </Field>
            <Field label="Colour"><input type="color" value={entity.color} onChange={(e) => set((x) => { x.color = e.target.value; })} /></Field>
            <Field label="Area"><b>{Math.round(polygonArea(entity.points)).toLocaleString()} m²</b></Field>
          </>
        )}
        {kind === 'wall' && (
          <>
            <Field label="Height"><Num value={entity.height} suffix="m" onChange={(v) => set((x) => { x.height = v; })} /></Field>
            <Field label="Thickness"><Num value={entity.thickness} suffix="m" step={0.05} onChange={(v) => set((x) => { x.thickness = v; })} /></Field>
            <Field label="Length"><b>{polylineLength(entity.points).toFixed(1)} m</b></Field>
          </>
        )}
        {kind === 'aisle' && (
          <>
            <Field label="Width"><Num value={entity.width} suffix="m" onChange={(v) => set((x) => { x.width = v; })} /></Field>
            <Field label="Length"><b>{polylineLength(entity.points).toFixed(1)} m</b></Field>
          </>
        )}
        {kind === 'route' && (
          <>
            <Field label="Direction">
              <select value={entity.oneWay ? '1' : '0'} onChange={(e) => set((x) => { x.oneWay = e.target.value === '1'; })}>
                <option value="0">Two-way</option>
                <option value="1">One-way (drawn direction)</option>
              </select>
            </Field>
            <Field label="Colour"><input type="color" value={entity.color ?? '#06b6d4'} onChange={(e) => set((x) => { x.color = e.target.value; })} /></Field>
            <Field label="Length"><b>{polylineLength(entity.points).toFixed(1)} m</b></Field>
          </>
        )}
        {kind === 'link' && (
          <>
            <Field label="From"><b>{name(entity.from)}</b></Field>
            <Field label="To"><b>{name(entity.to)}</b></Field>
            <Field label="Type">
              <select value={entity.kind} onChange={(e) => set((x) => { x.kind = e.target.value; })}>
                {Object.entries(LINK_KINDS).map(([k, z]) => <option key={k} value={k}>{z.label}</option>)}
              </select>
            </Field>
          </>
        )}
        {kind === 'line' && <Field label="Colour"><input type="color" value={entity.color} onChange={(e) => set((x) => { x.color = e.target.value; })} /></Field>}
      </div>
      {kind === 'route' && <p className="desc">Vehicles use every route as one network: crossing routes are joined, and transport links send the nearest idle AGV or forklift along the shortest path.</p>}
      {kind === 'link' && entity.kind === 'transport' && <p className="desc">Parts wait at the upstream object until a vehicle collects them.</p>}
      {['wall', 'aisle', 'route', 'zone'].includes(kind) && <p className="desc">Drag the purple handles to reshape.</p>}
      <div className="actions">
        <button className="btn danger" onClick={() => useStore.getState().removeSelected()}><Icon name="trash" size={15} /> Delete</button>
      </div>
    </div>
  );
}

function ProjectInspector() {
  const project = useStore((s) => s.project);
  const snap = useStore((s) => s.snap);
  const snapOn = useStore((s) => s.snapOn);
  const f = project.floor;
  const setFloor = (fn, opts) => upd((p) => fn(p.floor), opts);
  const sh = project.shifts;
  const layerToWalls = (L) => {
    upd((p) => {
      for (let i = 0; i < L.segments.length; i += 4) {
        const a = drawingToWorld(p.floor, L.segments[i], L.segments[i + 1]);
        const b = drawingToWorld(p.floor, L.segments[i + 2], L.segments[i + 3]);
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.3) continue;
        p.walls.push({ id: newId(p, 'wall'), points: [a, b], height: 3, thickness: 0.2 });
      }
    });
    useStore.getState().toast(`Layer “${L.name}” converted to walls`);
  };
  return (
    <div className="insp">
      <h4 className="first">Floor plan</h4>
      {!f.source ? (
        <div className="empty">
          <p>Import a floor plan (image, PDF or DXF) to trace over, or start drawing walls and zones directly.</p>
          <button className="btn primary" onClick={() => useStore.getState().openDialog({ kind: 'import' })}><Icon name="import" size={15} /> Import layout</button>
        </div>
      ) : (
        <>
          <div className="kv"><span>File</span><b>{f.source.name}</b></div>
          <div className="grid2">
            <Field label="Scale">
              <Num value={f.source.kind === 'dxf' ? f.mpp : f.mpp * 100} step={f.source.kind === 'dxf' ? 0.001 : 0.01}
                suffix={f.source.kind === 'dxf' ? 'm/unit' : 'cm/px'}
                onChange={(v) => setFloor((fl) => { fl.mpp = f.source.kind === 'dxf' ? v : v / 100; })} />
            </Field>
            <Field label="Rotation"><Num value={f.rotation} step={90} suffix="°" onChange={(v) => setFloor((fl) => { fl.rotation = v; })} /></Field>
            <Field label="Centre X"><Num value={f.center[0]} suffix="m" onChange={(v) => setFloor((fl) => { fl.center = [v, fl.center[1]]; })} /></Field>
            <Field label="Centre Z"><Num value={f.center[1]} suffix="m" onChange={(v) => setFloor((fl) => { fl.center = [fl.center[0], v]; })} /></Field>
          </div>
          <Field label={`Opacity ${Math.round(f.opacity * 100)}%`}>
            <input type="range" min="0.1" max="1" step="0.05" value={f.opacity} onChange={(e) => setFloor((fl) => { fl.opacity = Number(e.target.value); }, { history: false })} />
          </Field>
          <div className="actions">
            <button className="btn primary" onClick={() => useStore.getState().setTool('calibrate')}><Icon name="calibrate" size={15} /> Calibrate scale</button>
            <button className="btn" onClick={() => setFloor((fl) => { fl.visible = !fl.visible; })}>{f.visible ? 'Hide plan' : 'Show plan'}</button>
            <button className="btn danger" onClick={() => setFloor((fl) => { fl.source = null; })}>Remove</button>
          </div>
          {f.source.kind === 'dxf' && (
            <>
              <h4>CAD layers</h4>
              {f.source.layers.map((L, i) => (
                <div key={L.name} className="layer">
                  <input type="checkbox" checked={L.visible} onChange={() => setFloor((fl) => {
                    fl.source = { ...fl.source, layers: fl.source.layers.map((x, k) => (k === i ? { ...x, visible: !x.visible } : x)) };
                  })} aria-label={`Show layer ${L.name}`} />
                  <i className="swatch" style={{ background: L.color }} />
                  <span className="lname">{L.name}</span>
                  <em>{L.segments.length / 4} lines</em>
                  <button className="mini" onClick={() => layerToWalls(L)} title="Create walls from this layer's lines">→ walls</button>
                </div>
              ))}
            </>
          )}
        </>
      )}
      <h4>Shifts</h4>
      <div className="grid2">
        <Field label="Shift starts"><Num value={sh.start} step={1} suffix="h" onChange={(v) => upd((p) => { p.shifts.start = v; })} /></Field>
        <Field label="Shift length"><Num value={sh.length} step={0.5} suffix="h" onChange={(v) => upd((p) => { p.shifts.length = v; })} /></Field>
      </div>
      {sh.breaks.map((b, i) => (
        <div key={i} className="grid3">
          <Field label={`Break ${i + 1} after`}><Num value={b.at} step={0.25} suffix="h" onChange={(v) => upd((p) => { p.shifts.breaks[i].at = v; })} /></Field>
          <Field label="Minutes"><Num value={b.minutes} step={5} onChange={(v) => upd((p) => { p.shifts.breaks[i].minutes = v; })} /></Field>
          <button className="mini x" onClick={() => upd((p) => { p.shifts.breaks.splice(i, 1); })} aria-label="Remove break">×</button>
        </div>
      ))}
      <button className="btn sm" onClick={() => upd((p) => { p.shifts.breaks.push({ at: 3, minutes: 15 }); })}><Icon name="plus" size={14} /> Add break</button>
      <p className="desc">Operators walk to the nearest <b>Break area</b> zone during breaks; stations that need them pause.</p>
      <h4>Editor</h4>
      <div className="grid2">
        <Field label="Snap to grid">
          <select value={snapOn ? snap : 0} onChange={(e) => {
            const v = Number(e.target.value);
            useStore.setState(v ? { snap: v, snapOn: true } : { snapOn: false });
          }}>
            <option value={0}>Off</option>
            {[0.1, 0.25, 0.5, 1, 2].map((v) => <option key={v} value={v}>{v} m</option>)}
          </select>
        </Field>
      </div>
      <div className="counts">
        {project.objects.length} objects · {project.zones.length} zones · {project.walls.length} walls · {project.routes.length} routes · {project.links.length} links
      </div>
    </div>
  );
}

const fmtDur = (s) => (s == null ? '—' : s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`);
const STATE = { busy: 'Working', idle: 'Starved', blocked: 'Blocked', down: 'Down', off: 'No crew' };

function SimPanel() {
  const stats = useStore((s) => s.simStats);
  const sim = useStore((s) => s.sim);
  if (!stats) {
    return (
      <div className="insp">
        <div className="empty">
          <p>Press <b>Simulate</b> to run the factory. Parts flow from sources through connected stations to sinks; vehicles serve transport links along the AGV routes.</p>
          <button className="btn primary" onClick={() => getViewport()?.startSim()}><Icon name="play" size={15} /> Simulate</button>
        </div>
      </div>
    );
  }
  return (
    <div className="insp sim-panel">
      <div className="clock">{stats.clock}{stats.onBreak && <span className="tag">Break</span>}{!sim.running && <span className="tag paused">Paused</span>}</div>
      <div className="kpis">
        <div><label>Finished</label><b>{stats.finished}</b></div>
        <div><label>Throughput</label><b>{stats.rate ? stats.rate.toFixed(1) : '—'}<em>/h</em></b></div>
        <div><label>WIP</label><b>{stats.wip}</b></div>
        <div><label>Lead time</label><b>{fmtDur(stats.avgLead)}</b></div>
      </div>
      {stats.bottleneck && <div className="bneck">Bottleneck: <b>{stats.bottleneck.name}</b> ({Math.round(stats.bottleneck.util * 100)}% busy)</div>}
      {stats.waitingTransport > 0 && <div className="warn">{stats.waitingTransport} part(s) waiting for a vehicle</div>}
      <h4>Stations</h4>
      {stats.stations.map((s) => (
        <button key={s.id} className={`srow st-${s.state}`} onClick={() => { useStore.getState().select(s.id); getViewport()?.focusSelection(); }} title={s.reason}>
          <i className="dot" />
          <span className="sname">{s.name}</span>
          <span className="bar" aria-label="Utilisation">
            <i className="b" style={{ width: `${s.util * 100}%` }} />
            <i className="k" style={{ width: `${s.blocked * 100}%` }} />
            <i className="d" style={{ width: `${(s.down + s.off) * 100}%` }} />
          </span>
          <span className="sstate">{s.reason || STATE[s.state]}</span>
        </button>
      ))}
      {stats.vehicles.length > 0 && <h4>Vehicles</h4>}
      {stats.vehicles.map((v) => (
        <div key={v.id} className="vrow">
          <span className="sname">{v.name}</span>
          <span className="vstate">{v.state}</span>
          <span className="vutil">{Math.round(v.util * 100)}% · {v.trips} trips</span>
        </div>
      ))}
      <div className="legend"><span><i className="b" />working</span><span><i className="k" />blocked</span><span><i className="d" />down / no crew</span><span><i />starved</span></div>
    </div>
  );
}

export default function RightPanel() {
  const selection = useStore((s) => s.selection);
  const project = useStore((s) => s.project);
  const tab = useStore((s) => s.rightTab);
  let body;
  if (tab === 'sim') body = <SimPanel />;
  else if (selection.length > 1) {
    body = (
      <div className="insp">
        <p className="desc">{selection.length} items selected. Drag to move them together.</p>
        <div className="actions">
          <button className="btn" onClick={() => useStore.getState().duplicateSelected()}>Duplicate</button>
          <button className="btn danger" onClick={() => useStore.getState().removeSelected()}>Delete</button>
        </div>
      </div>
    );
  } else if (selection.length === 1) {
    const id = selection[0];
    const o = project.objects.find((x) => x.id === id);
    if (o) body = <ObjectInspector o={o} />;
    else {
      for (const [key, kind] of [['zones', 'zone'], ['walls', 'wall'], ['aisles', 'aisle'], ['routes', 'route'], ['links', 'link'], ['lines', 'line']]) {
        const e = project[key].find((x) => x.id === id);
        if (e) body = <ShapeInspector entity={e} kind={kind} />;
      }
    }
  }
  body ??= <ProjectInspector />;
  return (
    <aside className="right">
      <div className="tabs">
        <button className={tab !== 'sim' ? 'on' : ''} onClick={() => useStore.setState({ rightTab: 'props' })}>Properties</button>
        <button className={tab === 'sim' ? 'on' : ''} onClick={() => useStore.setState({ rightTab: 'sim' })}>Simulation</button>
      </div>
      <div className="scroll">{body}</div>
    </aside>
  );
}
