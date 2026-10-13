// App-level actions shared by the toolbar, dialogs and the setup guide.
import { useStore } from './store.js';
import { getViewport } from './engine/Viewport.js';
import { emptyProject, ZONE_KINDS, rectPoints, newId } from './model/project.js';
import { autoBuild } from './model/autobuild.js';
import { drawingToWorld } from './importers/index.js';
import { SAMPLE_PLAN, SAMPLE_ZONES } from './samples/samplePlan.js';

const st = () => useStore.getState();
const fitSoon = () => setTimeout(() => getViewport()?.fit(), 50);

export function newFactory() {
  getViewport()?.resetSim();
  st().setProject(emptyProject(), 'New factory');
  useStore.setState({ dashboard: false, view: '3d', tool: 'select', rightTab: 'props' });
  fitSoon();
}

// A floor drawing was imported: show it in plan view and ask for the scale
export function applyFloor(source, mpp) {
  st().update((p) => {
    p.floor = { ...p.floor, source, mpp, center: [0, 0], rotation: 0, visible: true, opacity: 0.85, calibrated: source.kind === 'dxf' };
  });
  st().select([]);
  useStore.setState({ rightTab: 'props', view: 'plan' });
  fitSoon();
  st().toast(source.kind === 'dxf'
    ? `Imported ${source.layers.length} CAD layers. Check the scale, then turn layers into walls in Properties.`
    : 'Plan imported. Now set the scale: click two points whose real distance you know.');
  if (source.kind !== 'dxf') st().setTool('calibrate');
}

export function loadSampleFloor() {
  const { name, width, height, image } = SAMPLE_PLAN;
  applyFloor({ kind: 'image', name, image: `${import.meta.env.BASE_URL}${image}`, width, height }, 160 / width);
}

// Same result as calibrating the sample by hand: its outer walls are 160 m apart
export function calibrateSample() {
  const { wallLeft, wallRight, realWidth } = SAMPLE_PLAN;
  st().update((p) => {
    p.floor.mpp = realWidth / (wallRight - wallLeft);
    p.floor.calibrated = true;
  });
  getViewport()?.cancelDraft();
  st().setTool('select');
  st().toast(`Scale set: the building is ${realWidth} m wide`);
  fitSoon();
}

export function addSampleZones() {
  const floor = st().project.floor;
  if (!floor.source) return;
  st().update((p) => {
    p.zones = p.zones.filter((z) => !SAMPLE_ZONES.some(([name]) => name === z.name));
    for (const [name, kind, u0, v0, u1, v1] of SAMPLE_ZONES) {
      const [x0, z0] = drawingToWorld(floor, u0, v0);
      const [x1, z1] = drawingToWorld(floor, u1, v1);
      const r = (v) => Math.round(v * 2) / 2;
      p.zones.push({ id: newId(p, 'zone'), name, kind, color: ZONE_KINDS[kind].color, points: rectPoints(r(x0), r(z0), r(x1), r(z1)) });
    }
  }, { select: [] });
  st().setTool('select');
  st().toast(`Added ${SAMPLE_ZONES.length} zones traced from the sample plan`);
}

// Rule-based: fills each zone from its kind's template, then wires flows and AGV routes
export function runAutoBuild({ confirm = true } = {}) {
  if (!st().project.zones.length) {
    st().toast('Draw zones first (Z) and set each one\'s kind: assembly, production, warehouse, storage, dock…', 'warn');
    return;
  }
  const go = () => {
    const vp = getViewport();
    vp?.resetSim();
    let res = null;
    st().update((p) => {
      for (const k of ['objects', 'links', 'routes', 'lines', 'aisles']) p[k] = [];
      res = autoBuild(p);
      // fade the drawing so the equipment reads clearly
      if (p.floor.source) p.floor.opacity = Math.min(p.floor.opacity ?? 0.85, 0.35);
    }, { select: [] });
    if (!res) return;
    useStore.setState({ view: '3d', tool: 'select' });
    vp?.fit();
    vp?.reveal(res.order);
    const c = res.counts;
    st().toast(`Auto-built ${c.lines} lines, ${c.stations} stations, ${c.storage} storage units, ${c.operators} operators and ${c.vehicles} vehicles`);
  };
  if (confirm && st().project.objects.length) {
    st().openDialog({ kind: 'confirm', title: 'Auto-build this layout?', text: 'Equipment, links and AGV routes are replaced with a generated factory. Zones and walls are kept.', ok: 'Auto-build', onOk: go });
  } else go();
}

export function startSimulation(speed) {
  getViewport()?.startSim();
  useStore.setState({ rightTab: 'sim', ...(speed ? { sim: { ...st().sim, running: true, built: true, speed } } : {}) });
}

export function openDashboard() {
  useStore.setState({ dashboard: true });
}
