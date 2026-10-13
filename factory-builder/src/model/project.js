// The project file: everything the builder edits and the simulator runs.
// Plain JSON so it can be saved, exported and diffed. Units are metres and seconds;
// the floor is the x/z plane, y is up. Rotations are in degrees.

export const SCHEMA_VERSION = 1;

export const ZONE_KINDS = {
  production: { label: 'Production', color: '#3b82f6' },
  assembly: { label: 'Assembly', color: '#2563eb' },
  secondary: { label: 'Secondary processes', color: '#f28c28' },
  warehouse: { label: 'Warehouse', color: '#16a34a' },
  storage: { label: 'Storage / staging', color: '#ca8a04' },
  dock: { label: 'Dock', color: '#64748b' },
  office: { label: 'Office / lab', color: '#8b5cf6' },
  welfare: { label: 'Welfare', color: '#0ea5e9' },
  break: { label: 'Break area', color: '#14b8a6' },
  utility: { label: 'Utility', color: '#ef4444' },
  other: { label: 'Other', color: '#94a3b8' },
};

export const LINK_KINDS = {
  conveyor: { label: 'Conveyor', color: '#94a3b8' },
  manual: { label: 'Manual hand-off', color: '#f59e0b' },
  transport: { label: 'Vehicle transport', color: '#22d3ee' },
};

export function emptyProject(name = 'Untitled factory') {
  return {
    version: SCHEMA_VERSION,
    name,
    floor: {
      source: null, // { kind: 'image'|'pdf'|'dxf', name, image?, width, height, dxf? }
      mpp: 0.05, // metres per image pixel (or per DXF drawing unit)
      center: [0, 0],
      rotation: 0,
      opacity: 0.85,
      visible: true,
    },
    walls: [], // { id, points: [[x,z],...], height, thickness }
    zones: [], // { id, name, kind, color, points: [[x,z]x4] }
    aisles: [], // { id, points, width }
    lines: [], // { id, name, color }
    objects: [], // { id, type, name, x, z, rot, lineId, props }
    links: [], // { id, from, to, kind }
    routes: [], // { id, name, points, oneWay, color }
    shifts: { start: 6, length: 8, breaks: [{ at: 2, minutes: 15 }, { at: 4, minutes: 30 }, { at: 6, minutes: 15 }] },
  };
}

const PREFIX = { wall: 'W', zone: 'Z', aisle: 'A', line: 'L', link: 'K', route: 'R' };
export function newId(project, kind, type) {
  const prefix = PREFIX[kind] ?? (type ? type.slice(0, 3).toUpperCase() : 'O');
  const all = new Set([
    ...project.walls, ...project.zones, ...project.aisles, ...project.lines, ...project.objects, ...project.links, ...project.routes,
  ].map((e) => e.id));
  let n = 1;
  while (all.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

export function polygonArea(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, z1] = points[i];
    const [x2, z2] = points[(i + 1) % points.length];
    a += x1 * z2 - x2 * z1;
  }
  return Math.abs(a) / 2;
}

export function polylineLength(points) {
  let L = 0;
  for (let i = 1; i < points.length; i++) L += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return L;
}

export function rectPoints(x0, z0, x1, z1) {
  const [a, b] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [c, d] = [Math.min(z0, z1), Math.max(z0, z1)];
  return [[a, c], [b, c], [b, d], [a, d]];
}

// Find any entity by id, with the collection it lives in
export function findEntity(project, id) {
  for (const key of ['objects', 'zones', 'walls', 'aisles', 'routes', 'links', 'lines']) {
    const e = project[key].find((x) => x.id === id);
    if (e) return { key, entity: e };
  }
  return null;
}

// Bring an older or hand-written file up to the current shape
export function normalizeProject(p) {
  const base = emptyProject(p?.name);
  const out = { ...base, ...p, floor: { ...base.floor, ...(p?.floor ?? {}) }, shifts: { ...base.shifts, ...(p?.shifts ?? {}) } };
  for (const k of ['walls', 'zones', 'aisles', 'lines', 'objects', 'links', 'routes']) out[k] = Array.isArray(p?.[k]) ? p[k] : [];
  out.objects = out.objects.map((o) => ({ rot: 0, props: {}, ...o }));
  out.version = SCHEMA_VERSION;
  return out;
}
