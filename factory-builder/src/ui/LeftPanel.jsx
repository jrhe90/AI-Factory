import { useMemo, useState } from 'react';
import { useStore } from '../store.js';
import { getViewport } from '../engine/Viewport.js';
import { CATALOG, CATEGORIES, CATALOG_BY_TYPE } from '../library/catalog.js';
import { ZONE_KINDS, LINK_KINDS, polygonArea, newId } from '../model/project.js';
import { Icon } from './icons.jsx';

const TOOLS = [
  ['select', 'Select & move', 'V'],
  ['wall', 'Draw walls', 'W'],
  ['zone', 'Draw zones', 'Z'],
  ['aisle', 'Draw aisles', 'A'],
  ['route', 'Draw AGV routes', 'P'],
  ['connect', 'Connect flow', 'C'],
  ['calibrate', 'Set plan scale', 'M'],
];

export function ToolRail() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  return (
    <nav className="rail" aria-label="Tools">
      {TOOLS.map(([t, label, key]) => (
        <button key={t} className={tool === t ? 'on' : ''} onClick={() => setTool(t)} title={`${label} (${key})`} aria-label={label}>
          <Icon name={t} size={20} />
          <small>{key}</small>
        </button>
      ))}
    </nav>
  );
}

export function ToolOptions() {
  const tool = useStore((s) => s.tool);
  const zoneKind = useStore((s) => s.zoneKind);
  const linkKind = useStore((s) => s.linkKind);
  const placeType = useStore((s) => s.placeType);
  const hint = useStore((s) => s.hint);
  let opts = null;
  if (tool === 'zone') {
    opts = (
      <label>Zone type
        <select value={zoneKind} onChange={(e) => useStore.setState({ zoneKind: e.target.value })}>
          {Object.entries(ZONE_KINDS).map(([k, z]) => <option key={k} value={k}>{z.label}</option>)}
        </select>
      </label>
    );
  } else if (tool === 'connect') {
    opts = (
      <label>Link type
        <select value={linkKind} onChange={(e) => useStore.setState({ linkKind: e.target.value })}>
          {Object.entries(LINK_KINDS).map(([k, z]) => <option key={k} value={k}>{z.label}</option>)}
        </select>
        <span className="muted">Shift-click keeps the same upstream object</span>
      </label>
    );
  } else if (tool === 'place') {
    opts = <span>Placing <b>{CATALOG_BY_TYPE[placeType]?.label}</b></span>;
  }
  if (!hint && !opts) return null;
  return (
    <div className="tool-options">
      {opts}
      <span className="hint">{hint}</span>
    </div>
  );
}

function Library() {
  const [q, setQ] = useState('');
  const placeType = useStore((s) => s.placeType);
  const setTool = useStore((s) => s.setTool);
  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? CATALOG.filter((c) => `${c.label} ${c.category} ${c.desc} ${c.role}`.toLowerCase().includes(t)) : CATALOG;
  }, [q]);
  return (
    <div className="library">
      <input className="search" placeholder="Search objects…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the object library" />
      {CATEGORIES.map((cat) => {
        const list = items.filter((c) => c.category === cat);
        if (!list.length) return null;
        return (
          <section key={cat}>
            <h3>{cat}</h3>
            <div className="cards">
              {list.map((c) => (
                <button
                  key={c.type}
                  className={`card role-${c.role} ${placeType === c.type ? 'on' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-sim-object', c.type);
                    e.dataTransfer.effectAllowed = 'copy';
                    getViewport()?.beginPaletteDrag(c.type);
                  }}
                  onClick={() => setTool('place', { placeType: c.type })}
                  title={`${c.desc}\nDrag onto the floor, or click then click the floor.`}
                >
                  <span className="glyph">{c.glyph}</span>
                  <span className="lbl">{c.label}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Tree() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const select = (id) => {
    useStore.getState().select(id);
    setTimeout(() => getViewport()?.focusSelection(), 0);
  };
  const row = (id, label, extra, depth = 0) => (
    <button key={id} className={`trow ${selection.includes(id) ? 'on' : ''}`} style={{ paddingLeft: 10 + depth * 14 }} onClick={() => select(id)}>
      <span className="tlabel">{label}</span>
      {extra && <span className="textra">{extra}</span>}
    </button>
  );
  const objects = project.objects;
  const role = (o) => CATALOG_BY_TYPE[o.type]?.role;
  const stations = objects.filter((o) => ['station', 'source', 'sink', 'buffer'].includes(role(o)));
  const unassigned = stations.filter((o) => !project.lines.some((l) => l.id === o.lineId));
  const group = (title, list, render) => list.length ? (
    <section key={title}>
      <h3>{title} <span className="count">{list.length}</span></h3>
      {list.map(render)}
    </section>
  ) : null;
  const f = project.floor;
  return (
    <div className="tree">
      <section>
        <h3>Floor plan</h3>
        <div className="tinfo">{f.source ? `${f.source.name} · ${f.source.kind.toUpperCase()} · ${f.source.kind === 'dxf' ? `${f.mpp} m/unit` : `${(f.mpp * 100).toFixed(2)} cm/px`}` : 'No plan imported yet'}</div>
      </section>
      {group('Zones', project.zones, (z) => row(z.id, z.name, `${Math.round(polygonArea(z.points)).toLocaleString()} m²`))}
      <section>
        <h3>Lines <span className="count">{project.lines.length}</span>
          <button className="mini" onClick={() => useStore.getState().update((p) => { p.lines.push({ id: newId(p, 'line'), name: `Line ${p.lines.length + 1}`, color: '#7c5cff' }); })}><Icon name="plus" size={14} /> New line</button>
        </h3>
        {project.lines.map((l) => (
          <div key={l.id}>
            {row(l.id, <><i className="swatch" style={{ background: l.color }} />{l.name}</>, `${objects.filter((o) => o.lineId === l.id).length} stations`)}
            {objects.filter((o) => o.lineId === l.id).map((o) => row(o.id, o.name, CATALOG_BY_TYPE[o.type]?.label, 1))}
          </div>
        ))}
        {unassigned.length > 0 && <div className="tsub">Not on a line</div>}
        {unassigned.map((o) => row(o.id, o.name, CATALOG_BY_TYPE[o.type]?.label, 1))}
      </section>
      {group('Storage', objects.filter((o) => role(o) === 'storage'), (o) => row(o.id, o.name, CATALOG_BY_TYPE[o.type]?.label))}
      {group('Vehicles', objects.filter((o) => role(o) === 'vehicle'), (o) => row(o.id, o.name, CATALOG_BY_TYPE[o.type]?.label))}
      {group('Operators', objects.filter((o) => role(o) === 'operator'), (o) => row(o.id, o.name, objects.find((s) => s.id === o.props?.stationId)?.name ?? 'unassigned'))}
      {group('AGV routes', project.routes, (r) => row(r.id, r.name, r.oneWay ? 'one-way' : 'two-way'))}
      {group('Walls', project.walls, (w, i) => row(w.id, `Wall ${i + 1}`, `${w.points.length - 1} segments`))}
      {group('Aisles', project.aisles, (a, i) => row(a.id, `Aisle ${i + 1}`, `${a.width} m wide`))}
    </div>
  );
}

export default function LeftPanel() {
  const tab = useStore((s) => s.leftTab);
  return (
    <aside className="left">
      <div className="tabs">
        <button className={tab === 'library' ? 'on' : ''} onClick={() => useStore.setState({ leftTab: 'library' })}>Library</button>
        <button className={tab === 'tree' ? 'on' : ''} onClick={() => useStore.setState({ leftTab: 'tree' })}>Plant</button>
      </div>
      <div className="scroll">{tab === 'library' ? <Library /> : <Tree />}</div>
    </aside>
  );
}
