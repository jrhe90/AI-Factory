// App state: the project being edited (with undo/redo), the active tool and UI flags.
import { create } from 'zustand';
import { emptyProject, normalizeProject, newId, findEntity } from './model/project.js';
import { CATALOG_BY_TYPE } from './library/catalog.js';

const STORAGE_KEY = 'sim-factory-project-v1';
const HISTORY_LIMIT = 80;

// Deep copy that shares the (large, immutable) floor image between history states
function snapshot(p) {
  const source = p.floor.source;
  const c = structuredClone({ ...p, floor: { ...p.floor, source: null } });
  c.floor.source = source;
  return c;
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeProject(JSON.parse(raw));
  } catch { /* storage unavailable or corrupt */ }
  return null;
}

let saveTimer = null;
function autosave(project) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    } catch {
      // Too big for localStorage (usually the floor image): keep the layout, drop the image
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...project, floor: { ...project.floor, source: null } }));
        useStore.getState().toast('Autosave kept the layout but not the floor image (too large). Use Save to keep everything.', 'warn');
      } catch { /* give up quietly */ }
    }
  }, 600);
}

export const useStore = create((set, get) => ({
  project: loadSaved() ?? emptyProject(),
  past: [],
  future: [],
  selection: [],
  tool: 'select',
  placeType: null,
  linkKind: 'conveyor',
  zoneKind: 'production',
  view: '3d',
  snap: 0.5,
  snapOn: true,
  showLabels: true,
  leftTab: 'library',
  rightTab: 'props',
  dialog: null,
  toasts: [],
  cursor: null,
  hint: '',
  sim: { running: false, speed: 10, built: false },
  dashboard: false,
  simStats: null,

  // ---- project editing
  update(recipe, { history = true, select } = {}) {
    const prev = get().project;
    const next = snapshot(prev);
    recipe(next);
    set((s) => ({
      project: next,
      past: history ? [...s.past.slice(-HISTORY_LIMIT + 1), prev] : s.past,
      future: history ? [] : s.future,
      selection: select ?? s.selection.filter((id) => findEntity(next, id)),
    }));
    autosave(next);
  },
  setProject(p, message) {
    const project = normalizeProject(p);
    set({ project, past: [], future: [], selection: [] });
    autosave(project);
    if (message) get().toast(message);
  },
  undo() {
    const { past, project, future } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({ project: prev, past: past.slice(0, -1), future: [project, ...future], selection: get().selection.filter((id) => findEntity(prev, id)) });
    autosave(prev);
  },
  redo() {
    const { past, project, future } = get();
    if (!future.length) return;
    const next = future[0];
    set({ project: next, past: [...past, project], future: future.slice(1) });
    autosave(next);
  },

  addObject(type, x, z, rot = 0) {
    const def = CATALOG_BY_TYPE[type];
    let id;
    get().update((p) => {
      id = newId(p, 'object', type);
      const n = p.objects.filter((o) => o.type === type).length + 1;
      p.objects.push({ id, type, name: `${def.label} ${n}`, x, z, rot, lineId: '', props: { ...def.defaults } });
    });
    set({ selection: [id] });
    return id;
  },
  removeSelected() {
    const ids = new Set(get().selection);
    if (!ids.size) return;
    get().update((p) => {
      for (const key of ['objects', 'zones', 'walls', 'aisles', 'routes', 'links', 'lines']) p[key] = p[key].filter((e) => !ids.has(e.id));
      p.links = p.links.filter((l) => !ids.has(l.from) && !ids.has(l.to));
      for (const o of p.objects) {
        if (ids.has(o.lineId)) o.lineId = '';
        if (o.props?.stationId && ids.has(o.props.stationId)) o.props.stationId = '';
      }
    }, { select: [] });
  },
  duplicateSelected() {
    const sel = get().selection;
    const created = [];
    get().update((p) => {
      for (const id of sel) {
        const o = p.objects.find((e) => e.id === id);
        if (!o) continue;
        const nid = newId(p, 'object', o.type);
        p.objects.push({ ...structuredClone(o), id: nid, name: `${o.name} copy`, x: o.x + 2, z: o.z + 2 });
        created.push(nid);
      }
    });
    if (created.length) set({ selection: created });
  },
  rotateSelected(deg) {
    const ids = new Set(get().selection);
    get().update((p) => {
      for (const o of p.objects) if (ids.has(o.id)) o.rot = (((o.rot ?? 0) + deg) % 360 + 360) % 360;
    });
  },

  // ---- UI
  select(ids, additive = false) {
    const list = Array.isArray(ids) ? ids : ids ? [ids] : [];
    set((s) => {
      if (!additive) return { selection: list };
      const cur = new Set(s.selection);
      for (const id of list) {
        if (cur.has(id)) cur.delete(id);
        else cur.add(id);
      }
      return { selection: [...cur] };
    });
  },
  setTool(tool, extra = {}) {
    set({ tool, placeType: tool === 'place' ? extra.placeType ?? get().placeType : null, ...extra });
  },
  toast(text, kind = 'info') {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4500);
  },
  openDialog(dialog) { set({ dialog }); },
  closeDialog() { set({ dialog: null }); },
}));

export const STORAGE = { key: STORAGE_KEY };
