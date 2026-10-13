import { useRef } from 'react';
import { useStore } from '../store.js';
import { getViewport } from '../engine/Viewport.js';
import { referenceProject } from '../samples/reference.js';
import { newFactory, runAutoBuild, startSimulation } from '../actions.js';
import { Icon } from './icons.jsx';

function download(name, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export default function TopBar() {
  const project = useStore((s) => s.project);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const view = useStore((s) => s.view);
  const sim = useStore((s) => s.sim);
  const showLabels = useStore((s) => s.showLabels);
  const dashboard = useStore((s) => s.dashboard);
  const guideOpen = useStore((s) => s.guide.open);
  const fileRef = useRef(null);
  const st = useStore.getState;

  const openFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      st().setProject(JSON.parse(await f.text()), `Opened ${f.name}`);
      setTimeout(() => getViewport()?.fit(), 50);
    } catch {
      st().toast('That file is not a Sim Factory project (.json).', 'warn');
    }
  };
  const loadSample = () => {
    getViewport()?.resetSim();
    st().setProject(referenceProject(), 'Loaded the reference motor plant layout');
    setTimeout(() => getViewport()?.fit(), 50);
  };
  const newProject = () => {
    st().openDialog({ kind: 'confirm', title: 'Start a new factory?', text: 'The current layout is replaced. Save it first if you want to keep it.', ok: 'Start new', onOk: newFactory });
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">SF</span>
        <div>
          <b>Sim Factory</b>
          <input className="pname" value={project.name} aria-label="Project name"
            onChange={(e) => st().update((p) => { p.name = e.target.value; }, { history: false })} />
        </div>
      </div>
      <div className="tb-group guide-group">
        <button className={`tb ${guideOpen ? 'on' : ''}`} onClick={() => useStore.getState().setGuide({ open: !guideOpen })} title="Step-by-step setup guide"><Icon name="help" />Guide</button>
      </div>
      <div className="tb-group">
        <button className="tb" data-guide="new" onClick={newProject} title="New factory"><Icon name="file" />New</button>
        <button className="tb" onClick={() => fileRef.current.click()} title="Open a project file"><Icon name="open" /><span className="lbl">Open</span></button>
        <button className="tb" data-guide="save" onClick={() => download(`${project.name.replace(/[^\w-]+/g, '_') || 'factory'}.json`, JSON.stringify(project, null, 1))} title="Save the project as a JSON file"><Icon name="save" /><span className="lbl">Save</span></button>
        <button className="tb" onClick={loadSample} title="Load the reference motor plant"><Icon name="sample" /><span className="lbl">Sample</span></button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={openFile} />
      </div>
      <div className="tb-group">
        <button className="tb accent" data-guide="import" onClick={() => st().openDialog({ kind: 'import' })}><Icon name="import" />Import layout</button>
        <button className="tb build" data-guide="autobuild" onClick={() => runAutoBuild()} title="Fill the zones with lines, storage, docks, staff and AGV routes from templates"><Icon name="build" />Auto-build</button>
      </div>
      <div className="tb-group">
        <button className="tb icon" disabled={!canUndo} onClick={() => st().undo()} title="Undo (Ctrl+Z)"><Icon name="undo" /></button>
        <button className="tb icon" disabled={!canRedo} onClick={() => st().redo()} title="Redo (Ctrl+Shift+Z)"><Icon name="redo" /></button>
      </div>
      <div className="tb-group">
        <div className="seg" data-guide="view">
          <button className={view === '3d' ? 'on' : ''} onClick={() => useStore.setState({ view: '3d' })}><Icon name="cube" size={16} />3D</button>
          <button className={view === 'plan' ? 'on' : ''} onClick={() => useStore.setState({ view: 'plan' })}><Icon name="map" size={16} />Plan</button>
        </div>
        <button className="tb icon" onClick={() => getViewport()?.fit()} title="Fit the whole layout"><Icon name="fit" /></button>
        <button className={`tb icon ${showLabels ? 'on' : ''}`} onClick={() => useStore.setState({ showLabels: !showLabels })} title="Show labels"><Icon name="eye" /></button>
      </div>
      <div className="tb-group sim">
        {sim.running
          ? <button className="tb run" data-guide="simulate" onClick={() => getViewport()?.pauseSim()}><Icon name="pause" />Pause</button>
          : <button className="tb run" data-guide="simulate" onClick={() => startSimulation()}><Icon name="play" />{sim.built ? 'Resume' : 'Simulate'}</button>}
        <button className="tb icon" disabled={!sim.built} onClick={() => getViewport()?.resetSim()} title="Stop and reset the simulation"><Icon name="reset" /></button>
        <button className={`tb ${dashboard ? 'on' : ''}`} data-guide="dashboard" onClick={() => useStore.setState({ dashboard: !dashboard })} title="Live KPI dashboard"><Icon name="chart" /><span className="lbl">Dashboard</span></button>
        <label className="speed" data-guide="speed" title="Simulation speed">
          <select value={sim.speed} onChange={(e) => useStore.setState({ sim: { ...sim, speed: Number(e.target.value) } })}>
            {[1, 5, 10, 30, 60, 120, 300, 600, 1200].map((v) => <option key={v} value={v}>{v}×</option>)}
          </select>
        </label>
      </div>
    </header>
  );
}
