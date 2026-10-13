// Step-by-step setup guide: walks a new user from an empty factory to a simulated plant with a
// dashboard, using the sample floor plan. Each step highlights the control to use, ticks itself
// off when the app state shows it is done, and offers "Do it for me".
import { useEffect, useState } from 'react';
import { useStore } from '../store.js';
import { getViewport } from '../engine/Viewport.js';
import { ZONE_KINDS } from '../model/project.js';
import { CATALOG_BY_TYPE } from '../library/catalog.js';
import { SAMPLE_PLAN, SAMPLE_ZONES } from '../samples/samplePlan.js';
import { newFactory, loadSampleFloor, calibrateSample, addSampleZones, runAutoBuild, startSimulation, openDashboard } from '../actions.js';
import { Icon } from './icons.jsx';

const PROCESS = new Set(['assembly', 'production', 'secondary']);
const sel = (name) => `[data-guide="${name}"]`;
const Key = ({ children }) => <kbd className="g-key">{children}</kbd>;

const STEPS = [
  {
    title: 'Build a factory digital twin',
    body: () => (
      <>
        <p>This guide takes you from an empty factory to a running simulation with a live dashboard. It uses a sample floor plan of a 160 m × 85 m electric motor plant and takes about five minutes.</p>
        <ol className="g-plan">
          <li>Start a new factory</li>
          <li>Import the floor plan</li>
          <li>Set its scale</li>
          <li>Sketch the zones</li>
          <li>Auto-build the equipment</li>
          <li>Review and edit</li>
          <li>Simulate a shift</li>
          <li>Read the dashboard</li>
        </ol>
        <p className="g-note">Each step ticks itself off when you have done it. If you just want to see the result, use <b>Do it for me</b>.</p>
      </>
    ),
    done: () => true,
  },
  {
    title: 'Start a new factory',
    target: () => sel('new'),
    body: () => (
      <>
        <p>Click <b>New</b> in the top bar and confirm. The plant on screen now is a finished example; you will build one like it from scratch.</p>
        <p className="g-note">Your current layout is replaced. Use <b>Save</b> first if you want to keep it.</p>
      </>
    ),
    done: (s) => !s.project.objects.length && !s.project.zones.length && !s.project.floor.source,
    doIt: newFactory,
  },
  {
    title: 'Import the floor plan',
    target: (s) => (s.dialog?.kind === 'import' ? sel('sample-plan') : sel('import')),
    body: () => (
      <>
        <p>Click <b>Import layout</b>, then <b>Use the sample floor plan</b>.</p>
        <p>For your own plant, drop a PNG, JPG or PDF drawing, or a DXF from AutoCAD, into the same dialog. Images become a see-through floor you trace over.</p>
      </>
    ),
    done: (s) => !!s.project.floor.source,
    doIt: loadSampleFloor,
  },
  {
    title: 'Set the scale',
    target: (s) => (s.tool === 'calibrate' ? null : sel('tool-calibrate')),
    body: (s) => (
      <>
        <p>An image has no units, so tell the app how big it is. With the scale tool {s.tool === 'calibrate' ? '(already on)' : <>(<Key>M</Key>)</>}:</p>
        <ol>
          <li>Click the <b>left outer wall</b> of the building, level with the wide main aisle.</li>
          <li>Click the <b>right outer wall</b> on the same line.</li>
          <li>Type <b>{SAMPLE_PLAN.realWidth}</b> and press <b>Apply scale</b>.</li>
        </ol>
        <p className="g-note">Zoom with the wheel for precise clicks. On your own drawings, use any dimension you know, such as a column bay or a door.</p>
      </>
    ),
    done: (s) => !!s.project.floor.calibrated,
    doIt: calibrateSample,
  },
  {
    title: 'Sketch the zones',
    target: (s) => (s.tool === 'zone' ? sel('zone-kind') : sel('tool-zone')),
    body: () => (
      <>
        <p>Zones tell Auto-build what goes where. Press <Key>Z</Key>, pick the <b>zone type</b>, then drag a rectangle over each area of the plan. Rename a zone in <b>Properties</b>.</p>
        <ul className="g-zones">
          {SAMPLE_ZONES.map(([name, kind]) => (
            <li key={name}><i style={{ background: ZONE_KINDS[kind].color }} />{name}<span>{ZONE_KINDS[kind].label}</span></li>
          ))}
        </ul>
        <p className="g-note">You need at least one assembly, production or secondary-process zone. The rest are optional.</p>
      </>
    ),
    done: (s) => s.project.zones.length >= 3 && s.project.zones.some((z) => PROCESS.has(z.kind)),
    doIt: addSampleZones,
    doLabel: 'Add the sample zones',
  },
  {
    title: 'Auto-build the factory',
    target: () => sel('autobuild'),
    body: () => (
      <>
        <p>Click <b>Auto-build</b>. Each zone is filled from a template for its type, then everything is wired into one flow:</p>
        <ul>
          <li><b>Warehouse, dock:</b> receiving doors, ASRS or raw-material racks</li>
          <li><b>Production, secondary, assembly:</b> machining, stator and assembly lines with buffers and conveyors</li>
          <li><b>Storage:</b> finished-goods racks and a shipping door</li>
          <li><b>Plant-wide:</b> operators at manual stations, an AGV loop with spurs, AGVs and forklifts</li>
        </ul>
        <p className="g-note">Auto-build is rule-based, not AI. Everything it creates is ordinary, editable equipment.</p>
      </>
    ),
    done: (s) => s.project.objects.length > 0 && s.project.routes.length > 0,
    doIt: () => runAutoBuild({ confirm: false }),
  },
  {
    title: 'Review and edit',
    target: () => null,
    body: () => (
      <>
        <p>Look around: <b>right-drag</b> to orbit, <b>left-drag</b> to pan, the <b>wheel</b> to zoom. <b>Plan</b> in the top bar gives a top-down view.</p>
        <p><b>Click a station</b> to open its properties: cycle time, operators needed, breakdown rate (MTBF) and repair time (MTTR).</p>
        <ul>
          <li>Drag to move, <Key>R</Key> to rotate, <Key>Del</Key> to delete</li>
          <li>Add equipment from the <b>Library</b> (minimise this guide with – to see it), and link it with Connect (<Key>C</Key>)</li>
          <li>The <b>Plant</b> tab lists every zone, line, station and vehicle</li>
        </ul>
      </>
    ),
    done: (s) => s.selection.some((id) => CATALOG_BY_TYPE[s.project.objects.find((o) => o.id === id)?.type]?.role === 'station'),
    doIt: () => {
      const s = useStore.getState();
      const o = s.project.objects.find((x) => x.name === 'Run test A') ?? s.project.objects.find((x) => CATALOG_BY_TYPE[x.type]?.role === 'station');
      if (!o) return;
      useStore.setState({ view: '3d', rightTab: 'props' });
      s.select(o.id);
      getViewport()?.focusSelection();
    },
    doLabel: 'Show me a station',
  },
  {
    title: 'Simulate a shift',
    target: (s) => (s.sim.running ? sel('speed') : sel('simulate')),
    body: () => (
      <>
        <p>Click <b>Simulate</b>, then raise the <b>speed</b> to 300× or more to fast-forward. Parts flow from the receiving doors through the lines to shipping, AGVs carry them between areas, and crews walk to the canteen on breaks.</p>
        <ul className="g-legend">
          <li><i style={{ background: '#22c55e' }} />Working</li>
          <li><i style={{ background: '#f59e0b' }} />Blocked: no room downstream</li>
          <li><i style={{ background: '#94a3b8' }} />Starved: waiting for parts</li>
          <li><i style={{ background: '#ef4444' }} />Down: breakdown</li>
        </ul>
        <p className="g-note">This step ticks off after one simulated hour.</p>
      </>
    ),
    done: (s) => (s.simStats?.t ?? 0) >= 3600,
    doIt: () => startSimulation(300),
    doLabel: 'Run it at 300×',
  },
  {
    title: 'Read the dashboard',
    target: () => sel('dashboard'),
    body: () => (
      <>
        <p>Click <b>Dashboard</b> to see live KPIs: units shipped, hourly throughput, work in progress, lead time, station and fleet utilisation, and breakdowns.</p>
        <p><b>Station time split</b> shows where each station's time goes, and flags the <b>bottleneck</b>, the station that limits output.</p>
        <p className="g-note">Try a what-if: close the dashboard, select the bottleneck, lower its cycle time, then reset (↺) and simulate again.</p>
      </>
    ),
    done: (s) => s.dashboard,
    doIt: openDashboard,
  },
  {
    title: 'You built a digital twin',
    target: () => sel('save'),
    body: () => (
      <>
        <p>Use <b>Save</b> to download the project as a JSON file, and <b>Open</b> to load it again. Your work also autosaves in this browser.</p>
        <p>To model your own plant, repeat the same steps:</p>
        <ol>
          <li><b>New</b>, then <b>Import layout</b> with your drawing</li>
          <li>Calibrate on a known dimension</li>
          <li>Draw your zones, then <b>Auto-build</b>, or place equipment by hand</li>
          <li>Enter real cycle times and staffing, then simulate</li>
        </ol>
      </>
    ),
    done: () => true,
  },
];

// A pulsing ring around the control the current step wants you to use
function Spotlight({ selector }) {
  const [rect, setRect] = useState(null);
  useEffect(() => {
    if (!selector) {
      setRect(null);
      return undefined;
    }
    const measure = () => {
      const el = document.querySelector(selector);
      const r = el?.getBoundingClientRect();
      setRect(r && r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null);
    };
    measure();
    const id = setInterval(measure, 250);
    return () => clearInterval(id);
  }, [selector]);
  if (!rect) return null;
  return <div className="g-spot" style={{ left: rect.x - 5, top: rect.y - 5, width: rect.w + 10, height: rect.h + 10 }} aria-hidden="true" />;
}

export default function Guide() {
  const guide = useStore((s) => s.guide);
  const state = useStore();
  if (!guide.open) return null;
  const setGuide = useStore.getState().setGuide;
  const i = Math.min(guide.step, STEPS.length - 1);
  const step = STEPS[i];
  const done = step.done(state);
  const go = (n) => setGuide({ step: Math.max(0, Math.min(STEPS.length - 1, n)), min: false });
  const close = () => setGuide({ open: false });
  const last = i === STEPS.length - 1;

  if (guide.min) {
    return (
      <button className="g-pill" onClick={() => setGuide({ min: false })} title="Show the setup guide">
        <Icon name="help" size={16} />{i === 0 ? 'Setup guide' : last ? 'Guide · finished' : `Guide · step ${i} of ${STEPS.length - 2}${done ? ' ✓' : ''}`}
      </button>
    );
  }
  return (
    <>
      <Spotlight selector={step.target?.(state) ?? null} />
      <aside className="guide" role="dialog" aria-label="Setup guide">
        <header className="g-head">
          <span className="g-count">{i === 0 ? 'Setup guide' : last ? 'Finished' : `Step ${i} of ${STEPS.length - 2}`}</span>
          <div className="g-tools">
            <button className="tb icon" onClick={() => setGuide({ min: true })} title="Minimise"><Icon name="minus" size={16} /></button>
            <button className="tb icon" onClick={close} title="Close the guide (reopen it from Guide in the top bar)"><Icon name="close" size={16} /></button>
          </div>
        </header>
        <div className="g-progress" aria-hidden="true">
          {STEPS.slice(1, -1).map((_, k) => <i key={k} className={k + 1 < i ? 'past' : k + 1 === i ? 'now' : ''} />)}
        </div>
        <h3>{step.title}</h3>
        <div className="g-body">{step.body(state)}</div>
        {i > 0 && !last && (
          <div className={`g-status ${done ? 'ok' : ''}`}>
            {done ? <><Icon name="check" size={16} />Done. Continue when you are ready.</> : 'Waiting for you to do this step…'}
          </div>
        )}
        <footer className="g-foot">
          {step.doIt && !done && <button className="btn g-do" onClick={() => step.doIt()}>{step.doLabel ?? 'Do it for me'}</button>}
          <div>
            {i > 0 ? <button className="btn" onClick={() => go(i - 1)}><Icon name="back" size={15} />Back</button> : <span />}
            {last
              ? <span className="g-right"><button className="btn" onClick={() => go(0)}>Restart</button><button className="btn primary" onClick={close}>Finish</button></span>
              : <button className={`btn g-next ${done ? 'primary' : ''}`} onClick={() => go(i + 1)}>{i === 0 ? 'Start' : done ? 'Next' : 'Skip'}<Icon name="arrow" size={15} /></button>}
          </div>
        </footer>
      </aside>
    </>
  );
}
