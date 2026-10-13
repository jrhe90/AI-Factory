import { useRef, useState } from 'react';
import { useStore } from '../store.js';
import { getViewport } from '../engine/Viewport.js';
import { importFloorFile } from '../importers/index.js';
import { Icon } from './icons.jsx';

function ImportDialog({ close }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const inputRef = useRef(null);
  const handle = async (file) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const { source, mpp } = await importFloorFile(file);
      useStore.getState().update((p) => {
        p.floor = { ...p.floor, source, mpp, center: [0, 0], rotation: 0, visible: true };
      });
      close();
      setTimeout(() => getViewport()?.fit(), 50);
      const st = useStore.getState();
      st.toast(source.kind === 'dxf'
        ? `Imported ${source.layers.length} CAD layers. Check the scale, then turn layers into walls in Properties.`
        : 'Plan imported. Now set the scale: click two points whose real distance you know.');
      st.select([]);
      useStore.setState({ rightTab: 'props' });
      if (source.kind !== 'dxf') st.setTool('calibrate');
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="dialog wide" role="dialog" aria-label="Import layout">
      <h2>Import factory layout</h2>
      <p>Bring in your floor plan to trace over. The scale is set in the next step.</p>
      <div
        className={`drop ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files?.[0]); }}
        onClick={() => inputRef.current.click()}
      >
        <Icon name="import" size={30} />
        <b>{busy ? 'Reading the file…' : 'Drop a file here or click to choose'}</b>
        <span>PNG, JPG or WebP drawings · PDF (first page) · DXF from AutoCAD</span>
        <input ref={inputRef} type="file" hidden accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,.pdf,.dxf,.dwg,image/*,application/pdf" onChange={(e) => handle(e.target.files?.[0])} />
      </div>
      {error && <div className="warn">{error}</div>}
      <ul className="tips">
        <li><b>Images and PDFs</b> become a see-through floor. Use <i>Calibrate scale</i> on a known dimension, such as a column grid or door width.</li>
        <li><b>DXF</b> keeps exact geometry and units. You can toggle layers and turn a layer into walls.</li>
        <li><b>DWG</b> must be saved as DXF first (AutoCAD: Save As → DXF).</li>
        <li>No drawing? Close this and sketch walls (W) and zones (Z) directly.</li>
      </ul>
      <div className="dialog-actions">
        <button className="btn" onClick={close}>Cancel</button>
      </div>
    </div>
  );
}

function CalibrateDialog({ d, close }) {
  const [val, setVal] = useState(d.measured.toFixed(2));
  const apply = () => {
    const real = Number(val);
    if (!(real > 0)) return;
    const k = real / d.measured;
    useStore.getState().update((p) => {
      const f = p.floor;
      f.mpp *= k;
      f.center = [d.a[0] + (f.center[0] - d.a[0]) * k, d.a[1] + (f.center[1] - d.a[1]) * k];
    });
    getViewport()?.cancelDraft();
    close();
    useStore.getState().setTool('select');
    useStore.getState().toast(`Scale set: that distance is now ${real} m`);
    setTimeout(() => getViewport()?.fit(), 50);
  };
  const cancel = () => {
    getViewport()?.cancelDraft();
    close();
  };
  return (
    <div className="dialog" role="dialog" aria-label="Set scale">
      <h2>Set the plan scale</h2>
      <p>The two points you clicked are <b>{d.measured.toFixed(2)} m</b> apart at the current scale. How far apart are they really?</p>
      <form onSubmit={(e) => { e.preventDefault(); apply(); }}>
        <label className="field big"><span>Real distance (m)</span>
          <input autoFocus type="number" step="0.01" min="0.01" value={val} onChange={(e) => setVal(e.target.value)} />
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={cancel}>Cancel</button>
          <button type="submit" className="btn primary">Apply scale</button>
        </div>
      </form>
    </div>
  );
}

function ConfirmDialog({ d, close }) {
  return (
    <div className="dialog" role="dialog" aria-label={d.title}>
      <h2>{d.title}</h2>
      <p>{d.text}</p>
      <div className="dialog-actions">
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn primary" onClick={() => { close(); d.onOk(); }}>{d.ok}</button>
      </div>
    </div>
  );
}

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  const close = () => useStore.getState().closeDialog();
  if (!dialog) return null;
  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && dialog.kind !== 'calibrate') close(); }}>
      {dialog.kind === 'import' && <ImportDialog close={close} />}
      {dialog.kind === 'calibrate' && <CalibrateDialog d={dialog} close={close} />}
      {dialog.kind === 'confirm' && <ConfirmDialog d={dialog} close={close} />}
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
    </div>
  );
}

export function StatusBar() {
  const cursor = useStore((s) => s.cursor);
  const project = useStore((s) => s.project);
  const snapOn = useStore((s) => s.snapOn);
  const snap = useStore((s) => s.snap);
  const sel = useStore((s) => s.selection.length);
  return (
    <footer className="status">
      <span className="mono">{cursor ? `x ${cursor[0].toFixed(2)} m   z ${cursor[1].toFixed(2)} m` : '—'}</span>
      <button className={`chip-btn ${snapOn ? 'on' : ''}`} onClick={() => useStore.setState({ snapOn: !snapOn })} title="Snap to grid (hold Alt to bypass)">Snap {snapOn ? `${snap} m` : 'off'}</button>
      <span>{project.objects.length} objects · {project.links.length} links · {project.routes.length} routes</span>
      {sel > 0 && <span>{sel} selected</span>}
      <span className="grow" />
      <span className="muted">Left-drag pans · right-drag orbits · wheel zooms · F focuses selection</span>
    </footer>
  );
}
