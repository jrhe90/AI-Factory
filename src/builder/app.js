// Line Builder: lay out generic objects from a JSON layout, connect them, and watch items flow.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LIBRARY, PROPS } from './objects.js';

const STORE_KEY = 'line-builder-layout-v1';
const DEG = Math.PI / 180;
const SNAP = 0.25;
const snap = (v) => Math.round(v / SNAP) * SNAP;

// =====================================================================
// Scene
// =====================================================================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd6dde4);
scene.fog = new THREE.Fog(0xd6dde4, 120, 320);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture;
scene.add(new THREE.HemisphereLight(0xf4f7ff, 0x7d838b, 0.7));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(30, 60, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 50, bottom: -50, near: 5, far: 200 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.3, 800);
camera.position.set(-18, 34, 46);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2.05;
controls.target.set(-4, 0, 4);

let floorMesh;
let grid;
function buildFloor(w, d) {
  if (floorMesh) scene.remove(floorMesh, grid);
  floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: 0xc3c8cd, roughness: 0.6 }));
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.receiveShadow = true;
  scene.add(floorMesh);
  grid = new THREE.GridHelper(Math.max(w, d), Math.max(w, d), 0x9aa1a9, 0xb3b9bf);
  grid.position.y = 0.004;
  grid.material.transparent = true;
  grid.material.opacity = 0.5;
  scene.add(grid);
}

// =====================================================================
// Layout model
// =====================================================================
let layout = null;
const root = new THREE.Group();
scene.add(root);
const itemsGroup = new THREE.Group();
scene.add(itemsGroup);
const linesGroup = new THREE.Group();
scene.add(linesGroup);
let nodes = [];
const byId = new Map();
let showLabels = true;

// Conveyors may be given as from/to points; store them as centre + rotation + length.
function normalize(l) {
  for (const o of l.objects) {
    if (o.type === 'conveyor' && o.from && o.to) {
      const [x0, z0] = o.from;
      const [x1, z1] = o.to;
      o.x = (x0 + x1) / 2;
      o.z = (z0 + z1) / 2;
      o.length = Math.round(Math.hypot(x1 - x0, z1 - z0) * 100) / 100;
      o.rot = Math.round((Math.atan2(z1 - z0, x1 - x0) / DEG) * 10) / 10;
      delete o.from;
      delete o.to;
    }
    o.x ??= 0;
    o.z ??= 0;
    o.rot ??= 0;
  }
  return l;
}

function itemSpec(sourceCfg) {
  return {
    size: sourceCfg?.itemSize ?? layout.item?.size ?? [1.2, 0.45, 0.7],
    color: sourceCfg?.itemColor ?? layout.item?.color ?? '#e8ecef',
  };
}

function labelSprite(text, sub) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(20,23,27,0.82)';
  g.beginPath();
  g.roundRect(4, 4, 504, 120, 22);
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = '600 50px Inter, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, sub ? 46 : 64, 480);
  if (sub) {
    g.fillStyle = '#9aa3ad';
    g.font = '500 32px Inter, system-ui, sans-serif';
    g.fillText(sub, 256, 96, 480);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set(3, 0.75, 1);
  return s;
}

function build() {
  root.clear();
  itemsGroup.clear();
  nodes = [];
  byId.clear();
  buildFloor(layout.floor?.w ?? 90, layout.floor?.d ?? 50);
  const firstSource = layout.objects.find((o) => o.type === 'source');
  for (const cfg of layout.objects) {
    const def = LIBRARY[cfg.type];
    if (!def) continue;
    const model = def.build(cfg, itemSpec(firstSource));
    const g = model.group;
    g.position.set(cfg.x, 0, cfg.z);
    g.rotation.y = -cfg.rot * DEG;
    g.traverse((o) => { o.userData.nodeId = cfg.id; });
    root.add(g);
    const node = {
      cfg, model, def, items: [], reserved: 0, rr: 0, state: 'idle', timer: 0, holding: null, count: 0,
      stats: { idle: 0, busy: 0, blocked: 0, down: 0 }, down: 0,
    };
    // Name tags: stations show their cycle time; unnamed conveyors and fences stay unlabelled
    const tagged = !model.flat && cfg.type !== 'fence' && (cfg.type !== 'conveyor' || cfg.label);
    if (tagged) {
      const sub = cfg.type === 'processor' ? `${cfg.time ?? 60} s cycle` : def.flow ? def.name : null;
      node.label = labelSprite(cfg.label ?? cfg.id, cfg.label ? sub : null);
      node.label.position.set(0, (model.height ?? 1.5) + 0.7, 0);
      node.label.visible = showLabels;
      g.add(node.label);
    }
    if (cfg.path?.length > 1) node.mover = makeMover(cfg);
    nodes.push(node);
    byId.set(cfg.id, node);
  }
  for (const n of nodes) n.next = (n.cfg.next ?? []).map((id) => byId.get(id)).filter(Boolean);
  resetSim();
  drawLinks();
  refreshPanels();
}

// Movers follow a polyline path (loop, or back and forth with "pingpong": true)
function makeMover(cfg) {
  const pts = cfg.path.map(([x, z]) => new THREE.Vector2(x, z));
  if (!cfg.pingpong) pts.push(pts[0].clone());
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = pts[i].distanceTo(pts[i + 1]);
    segs.push({ a: pts[i], b: pts[i + 1], len, s0: total });
    total += len;
  }
  return { segs, total, s: 0, dir: 1, speed: cfg.speed ?? 1.5, pause: 0 };
}

function stepMover(node, dt) {
  const m = node.mover;
  if (m.pause > 0) {
    m.pause -= dt;
    return false;
  }
  m.s += m.dir * m.speed * dt;
  if (node.cfg.pingpong) {
    if (m.s >= m.total || m.s <= 0) {
      m.s = Math.min(m.total, Math.max(0, m.s));
      m.dir *= -1;
      m.pause = 2;
    }
  } else m.s = ((m.s % m.total) + m.total) % m.total;
  const seg = m.segs.find((sg) => m.s >= sg.s0 && m.s <= sg.s0 + sg.len) ?? m.segs[m.segs.length - 1];
  const t = (m.s - seg.s0) / Math.max(1e-6, seg.len);
  const x = seg.a.x + (seg.b.x - seg.a.x) * t;
  const z = seg.a.y + (seg.b.y - seg.a.y) * t;
  const dx = (seg.b.x - seg.a.x) * m.dir;
  const dz = (seg.b.y - seg.a.y) * m.dir;
  const g = node.model.group;
  g.position.set(x, 0, z);
  g.rotation.y = node.cfg.type === 'operator' ? Math.atan2(dx, dz) : Math.atan2(-dz, dx);
  return true;
}

// =====================================================================
// Flow simulation
// =====================================================================
const sim = { t: 0, speed: 5, running: true, made: 0, transit: [] };
let itemSerial = 0;
const tmp = new THREE.Vector3();

function worldPoint(node, local) {
  return node.model.group.localToWorld((local ?? new THREE.Vector3(0, 0.5, 0)).clone());
}

function makeItem(src) {
  const spec = itemSpec(src.cfg);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...spec.size), new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.45, metalness: 0.1 }));
  mesh.castShadow = true;
  itemsGroup.add(mesh);
  return { id: ++itemSerial, mesh, h: spec.size[1], len: spec.size[0] };
}

function canAccept(node) {
  const type = node.cfg.type;
  if (type === 'sink') return true;
  if (type === 'queue') return node.items.length + node.reserved < (node.cfg.capacity ?? 6);
  if (type === 'processor') return node.down <= 0 && node.items.length + node.reserved < (node.cfg.capacity ?? 1);
  if (type === 'conveyor') {
    if (node.reserved > 0) return false;
    const gap = (node.items[0]?.len ?? 1) + 0.3;
    return !node.items.some((it) => it.s < gap);
  }
  return false;
}

function tryPush(node, item) {
  const n = node.next.length;
  for (let k = 0; k < n; k++) {
    const target = node.next[(node.rr + k) % n];
    if (!canAccept(target)) continue;
    node.rr = (node.rr + k + 1) % n;
    target.reserved++;
    const from = worldPoint(node, node.model.exit);
    const to = worldPoint(target, target.model.entry);
    const dur = Math.min(2.5, Math.max(0.3, from.distanceTo(to) / 2.5));
    sim.transit.push({ item, target, from, to, t: 0, dur });
    node.count++;
    return true;
  }
  return false;
}

function receive(node, item) {
  node.reserved--;
  const type = node.cfg.type;
  if (type === 'sink') {
    node.count++;
    sim.made++;
    itemsGroup.remove(item.mesh);
    item.mesh.geometry.dispose();
    return;
  }
  if (type === 'processor') {
    const base = node.cfg.time ?? 60;
    item.dur = base * THREE.MathUtils.randFloat(0.9, 1.1);
    item.t = 0;
    item.done = false;
  }
  if (type === 'conveyor') item.s = 0;
  node.items.push(item);
}

function stepNode(node, dt) {
  const cfg = node.cfg;
  switch (cfg.type) {
    case 'source': {
      if (!node.holding) {
        node.timer -= dt;
        if (node.timer <= 0) {
          node.holding = makeItem(node);
          node.timer = (cfg.interarrival ?? 60) * THREE.MathUtils.randFloat(0.85, 1.15);
        }
      }
      if (node.holding && tryPush(node, node.holding)) node.holding = null;
      node.state = node.holding ? 'blocked' : 'busy';
      break;
    }
    case 'queue':
      if (node.items.length && tryPush(node, node.items[0])) node.items.shift();
      node.state = node.items.length ? (node.items.length >= (cfg.capacity ?? 6) ? 'blocked' : 'busy') : 'idle';
      break;
    case 'processor': {
      if (node.down > 0) {
        node.down -= dt;
        node.state = 'down';
        break;
      }
      const it = node.items[0];
      if (!it) {
        node.state = 'idle';
        break;
      }
      if (!it.done) {
        it.t += dt;
        if (it.t >= it.dur) it.done = true;
        node.state = 'busy';
        if (cfg.failRate && Math.random() < (cfg.failRate * dt) / 3600) {
          node.down = THREE.MathUtils.randFloat(60, 240);
          toast(`${cfg.label ?? cfg.id} is down`);
        }
      }
      if (it.done) {
        if (tryPush(node, it)) {
          node.items.shift();
          node.state = 'idle';
        } else node.state = 'blocked';
      }
      break;
    }
    case 'conveyor': {
      const travel = node.model.travel;
      const speed = cfg.speed ?? 1;
      const sorted = node.items.slice().sort((a, b) => b.s - a.s);
      let ahead = null;
      for (const it of sorted) {
        const limit = ahead ? ahead.s - (ahead.len + it.len) / 2 - 0.15 : travel;
        it.s = Math.min(limit, it.s + speed * dt);
        ahead = it;
      }
      const lead = sorted[0];
      if (lead && lead.s >= travel - 1e-3 && tryPush(node, lead)) node.items.splice(node.items.indexOf(lead), 1);
      node.state = !node.items.length ? 'idle' : lead && lead.s >= travel - 1e-3 ? 'blocked' : 'busy';
      break;
    }
  }
  node.stats[node.state] = (node.stats[node.state] ?? 0) + dt;
}

function stepSim(dt) {
  sim.t += dt;
  for (const n of nodes) if (n.def.flow) stepNode(n, dt);
  for (let i = sim.transit.length - 1; i >= 0; i--) {
    const tr = sim.transit[i];
    tr.t += dt / tr.dur;
    if (tr.t >= 1) {
      sim.transit.splice(i, 1);
      receive(tr.target, tr.item);
    }
  }
}

function resetSim() {
  sim.t = 0;
  sim.made = 0;
  sim.transit = [];
  itemSerial = 0;
  itemsGroup.clear();
  for (const n of nodes) {
    n.items = [];
    n.reserved = 0;
    n.holding = null;
    n.timer = 0;
    n.count = 0;
    n.down = 0;
    n.stats = { idle: 0, busy: 0, blocked: 0, down: 0 };
  }
}

// Place item meshes where they are
function placeItems() {
  for (const n of nodes) {
    const g = n.model.group;
    const yaw = g.rotation.y;
    if (n.holding) {
      n.holding.mesh.position.copy(worldPoint(n, n.model.exit)).y += n.holding.h / 2;
      n.holding.mesh.rotation.y = yaw;
    }
    n.items.forEach((it, i) => {
      let p;
      if (n.cfg.type === 'queue') p = worldPoint(n, n.model.slot(i));
      else if (n.cfg.type === 'conveyor') p = worldPoint(n, n.model.along(it.s));
      else p = worldPoint(n, n.model.workPoint);
      it.mesh.position.copy(p).y += it.h / 2;
      it.mesh.rotation.y = yaw;
    });
  }
  for (const tr of sim.transit) {
    tmp.lerpVectors(tr.from, tr.to, tr.t);
    tmp.y += Math.sin(Math.PI * tr.t) * 0.6 + tr.item.h / 2;
    tr.item.mesh.position.copy(tmp);
  }
}

// =====================================================================
// Editing: selection, drag, connect, add/remove
// =====================================================================
const ui = { edit: false, selected: null, connecting: false, dragging: false };
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const selBox = new THREE.BoxHelper(new THREE.Object3D(), 0xffb020);
selBox.visible = false;
scene.add(selBox);

function pickNode(e) {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(root.children, true).filter((h) => h.object.visible && !h.object.isSprite);
  for (const h of hits) {
    const id = h.object.userData.nodeId;
    const n = id && byId.get(id);
    // Zones are big and flat – only pick them if nothing else is under the pointer
    if (n && (!n.model.flat || hits.every((x) => byId.get(x.object.userData.nodeId)?.model.flat))) return n;
  }
  return null;
}
function floorPoint(e) {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  return raycaster.ray.intersectPlane(floorPlane, new THREE.Vector3());
}

function select(node) {
  ui.selected = node;
  ui.connecting = false;
  updateSelection();
  refreshPanels();
}
function updateSelection() {
  const n = ui.selected && byId.get(ui.selected.cfg.id);
  ui.selected = n ?? null;
  selBox.visible = !!n && ui.edit;
  if (n) selBox.setFromObject(n.model.group);
}

let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY };
  if (!ui.edit) return;
  const n = pickNode(e);
  if (ui.connecting && ui.selected) {
    if (n && n !== ui.selected && n.def.flow && ui.selected.def.flow) {
      const next = (ui.selected.cfg.next ??= []);
      if (!next.includes(n.cfg.id)) next.push(n.cfg.id);
      toast(`Connected ${ui.selected.cfg.id} → ${n.cfg.id}`);
      commit();
    }
    ui.connecting = false;
    refreshPanels();
    return;
  }
  if (n && n === ui.selected) {
    const p = floorPoint(e);
    if (p) {
      ui.dragging = true;
      ui.dragOffset = new THREE.Vector3(n.cfg.x - p.x, 0, n.cfg.z - p.z);
      controls.enabled = false;
    }
  }
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!ui.dragging || !ui.selected) return;
  const p = floorPoint(e);
  if (!p) return;
  const cfg = ui.selected.cfg;
  const nx = snap(p.x + ui.dragOffset.x);
  const nz = snap(p.z + ui.dragOffset.z);
  if (cfg.path) cfg.path = cfg.path.map(([x, z]) => [x + nx - cfg.x, z + nz - cfg.z]);
  cfg.x = nx;
  cfg.z = nz;
  ui.selected.model.group.position.set(nx, 0, nz);
  updateSelection();
  drawLinks();
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (ui.dragging) {
    ui.dragging = false;
    controls.enabled = true;
    commit();
    return;
  }
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
  const n = pickNode(e);
  if (ui.edit) select(n);
  else if (n) select(n);
  else select(null);
});

window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    setRunning(!sim.running);
  }
  if (!ui.edit || !ui.selected) return;
  if (e.key === 'r' || e.key === 'R') rotateSelected();
  if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
  if (e.key === 'c' || e.key === 'C') startConnect();
  if (e.key === 'd' || e.key === 'D') duplicateSelected();
  if (e.key === 'Escape') select(null);
});

function rotateSelected() {
  ui.selected.cfg.rot = ((ui.selected.cfg.rot ?? 0) + 90) % 360;
  commit();
}
function deleteSelected() {
  const id = ui.selected.cfg.id;
  layout.objects = layout.objects.filter((o) => o.id !== id);
  for (const o of layout.objects) if (o.next) o.next = o.next.filter((x) => x !== id);
  ui.selected = null;
  commit();
}
function duplicateSelected() {
  const copy = JSON.parse(JSON.stringify(ui.selected.cfg));
  copy.id = newId(copy.type);
  copy.x += 3;
  if (copy.path) copy.path = copy.path.map(([x, z]) => [x + 3, z]);
  copy.next = [];
  layout.objects.push(copy);
  commit(copy.id);
}
function startConnect() {
  if (!ui.selected.def.flow) return;
  ui.connecting = true;
  toast('Click the object this one feeds into');
  refreshPanels();
}

const DEFAULTS = {
  source: { label: 'Source', interarrival: 60, next: [] },
  queue: { label: 'Buffer', capacity: 6, next: [] },
  processor: { label: 'Station', time: 60, style: 'bench', operators: 1, next: [] },
  conveyor: { label: 'Conveyor', length: 5, speed: 1, next: [] },
  sink: { label: 'Ship' },
  rack: { bays: 3, levels: 4 },
  zone: { label: 'Area', w: 12, d: 8, color: '#3b82f6' },
  fence: { length: 6 },
  agv: {},
  forklift: {},
  operator: { label: 'Operator', task: 'idle' },
};
const PREFIX = { source: 'SRC', queue: 'Q', processor: 'ST', conveyor: 'C', sink: 'SNK' };
function newId(type) {
  const p = PREFIX[type] ?? type.toUpperCase().slice(0, 3);
  let i = 1;
  while (layout.objects.some((o) => o.id === `${p}${i}`)) i++;
  return `${p}${i}`;
}
function addObject(type) {
  const cfg = { id: newId(type), type, x: snap(controls.target.x), z: snap(controls.target.z), rot: 0, ...JSON.parse(JSON.stringify(DEFAULTS[type] ?? {})) };
  layout.objects.push(cfg);
  commit(cfg.id);
}

// Any layout change: rebuild, keep the selection, save locally
function commit(selectId) {
  const keep = selectId ?? ui.selected?.cfg.id;
  build();
  ui.selected = keep ? byId.get(keep) ?? null : null;
  updateSelection();
  refreshPanels();
  save();
}
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(layout));
  } catch {
    // storage unavailable (private window) – the layout still works for this visit
  }
}

// Connection arrows (edit mode)
function drawLinks() {
  linesGroup.clear();
  if (!ui.edit) return;
  const matLine = new THREE.LineBasicMaterial({ color: 0xff8a00 });
  const cone = new THREE.ConeGeometry(0.18, 0.5, 10);
  for (const n of nodes) {
    for (const t of n.next ?? []) {
      const a = worldPoint(n, n.model.exit);
      const b = worldPoint(t, t.model.entry);
      a.y = b.y = 1.6;
      linesGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), matLine));
      const head = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color: 0xff8a00 }));
      head.position.lerpVectors(a, b, 0.75);
      head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      linesGroup.add(head);
    }
  }
}

// =====================================================================
// Panels
// =====================================================================
const $ = (id) => document.getElementById(id);
const STATE_LABEL = { idle: 'Starved', busy: 'Working', blocked: 'Blocked', down: 'Down' };

function fmtTime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function refreshPanels() {
  document.body.classList.toggle('editing', ui.edit);
  $('btn-edit').classList.toggle('active', ui.edit);
  $('btn-edit').textContent = ui.edit ? 'Done editing' : 'Edit layout';
  $('layout-name').textContent = layout?.name ?? 'Layout';
  renderProps();
}

function renderProps() {
  const box = $('props');
  const n = ui.selected;
  if (!n) {
    box.innerHTML = ui.edit
      ? '<p class="muted">Select an object to edit it, or add one from the library. Drag to move · R rotate · C connect · D duplicate · Delete remove.</p>'
      : '';
    box.hidden = !ui.edit;
    return;
  }
  box.hidden = false;
  const cfg = n.cfg;
  const fields = PROPS[cfg.type] ?? [['label', 'Name', 'text']];
  const row = ([key, label, kind, opts]) => {
    const v = cfg[key] ?? '';
    const id = `p-${key}`;
    if (!ui.edit) return `<div class="kv"><span>${label}</span><b>${v === '' ? '—' : v}</b></div>`;
    if (kind === 'select') {
      return `<label class="field"><span>${label}</span><select id="${id}" data-key="${key}">${opts.map((o) => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
    }
    return `<label class="field"><span>${label}</span><input id="${id}" data-key="${key}" data-kind="${kind}" type="${kind}" value="${v}" ${kind === 'number' ? 'step="any"' : ''}></label>`;
  };
  const stats = n.def.flow && !ui.edit ? statBlock(n) : '';
  const links = n.def.flow
    ? `<div class="links"><span class="muted">Feeds into</span>${(cfg.next ?? []).map((t) => `<span class="chip">${t}${ui.edit ? ` <button data-unlink="${t}" aria-label="Remove link">×</button>` : ''}</span>`).join('') || '<span class="muted">nothing</span>'}</div>`
    : '';
  box.innerHTML = `
    <div class="props-head"><small>${LIBRARY[cfg.type]?.name ?? cfg.type} · ${cfg.id}</small><button id="p-close" aria-label="Close">×</button></div>
    <h3>${cfg.label ?? cfg.id}</h3>
    ${stats}
    ${fields.map(row).join('')}
    ${ui.edit ? `<div class="xyz">${['x', 'z', 'rot'].map((k) => `<label class="field"><span>${k === 'rot' ? 'Rotation°' : k.toUpperCase() + ' (m)'}</span><input data-key="${k}" data-kind="number" type="number" step="any" value="${cfg[k]}"></label>`).join('')}</div>` : ''}
    ${links}
    ${ui.edit ? `<div class="actions">
      ${n.def.flow && cfg.type !== 'sink' ? `<button class="btn ${ui.connecting ? 'active' : ''}" id="p-connect">${ui.connecting ? 'Click target…' : 'Connect →'}</button>` : ''}
      <button class="btn" id="p-rotate">Rotate</button><button class="btn" id="p-dup">Duplicate</button><button class="btn danger" id="p-del">Delete</button></div>` : ''}`;
  box.querySelectorAll('input, select').forEach((el) => {
    el.addEventListener('change', () => {
      const key = el.dataset.key;
      let val = el.value;
      if (el.dataset.kind === 'number') val = val === '' ? undefined : Number(val);
      if (val === undefined) delete cfg[key];
      else cfg[key] = val;
      commit();
    });
  });
  box.querySelectorAll('[data-unlink]').forEach((b) => b.addEventListener('click', () => {
    cfg.next = cfg.next.filter((x) => x !== b.dataset.unlink);
    commit();
  }));
  $('p-close').onclick = () => select(null);
  if (ui.edit) {
    $('p-connect') && ($('p-connect').onclick = startConnect);
    $('p-rotate').onclick = rotateSelected;
    $('p-dup').onclick = duplicateSelected;
    $('p-del').onclick = deleteSelected;
  }
}

function statBlock(n) {
  const total = Object.values(n.stats).reduce((a, b) => a + b, 0) || 1;
  const pct = (k) => Math.round(((n.stats[k] ?? 0) / total) * 100);
  return `<div class="statebar">${['busy', 'blocked', 'idle', 'down'].map((k) => `<i data-s="${k}" style="width:${pct(k)}%"></i>`).join('')}</div>
    <div class="kv"><span>Now</span><b><span class="dot" data-s="${n.state}"></span>${STATE_LABEL[n.state]}</b></div>
    <div class="kv"><span>Working / blocked / starved</span><b>${pct('busy')}% / ${pct('blocked')}% / ${pct('idle')}%</b></div>
    <div class="kv"><span>Items passed</span><b>${n.count}</b></div>`;
}

function renderStats() {
  const hours = sim.t / 3600;
  $('k-time').textContent = fmtTime(sim.t);
  $('k-out').textContent = sim.made;
  $('k-rate').textContent = hours > 0.05 ? (sim.made / hours).toFixed(1) : '—';
  $('k-wip').textContent = itemsGroup.children.length;
  const procs = nodes.filter((n) => n.cfg.type === 'processor');
  let worst = null;
  for (const n of procs) {
    const total = Object.values(n.stats).reduce((a, b) => a + b, 0) || 1;
    const u = (n.stats.busy ?? 0) / total;
    if (!worst || u > worst.u) worst = { n, u };
  }
  $('k-bneck').textContent = worst && sim.t > 60 ? `${worst.n.cfg.label ?? worst.n.cfg.id} · ${Math.round(worst.u * 100)}%` : '—';
  const list = $('station-list');
  if (list.dataset.count !== String(procs.length)) {
    list.dataset.count = String(procs.length);
    list.innerHTML = procs.map((n) => `<button class="row" data-id="${n.cfg.id}"><span class="dot"></span><span class="nm"></span><span class="pct"></span></button>`).join('');
    list.querySelectorAll('.row').forEach((r) => r.addEventListener('click', () => {
      const n = byId.get(r.dataset.id);
      select(n);
      focusOn(n);
    }));
  }
  list.querySelectorAll('.row').forEach((r) => {
    const n = byId.get(r.dataset.id);
    if (!n) return;
    const total = Object.values(n.stats).reduce((a, b) => a + b, 0) || 1;
    r.querySelector('.dot').dataset.s = n.state;
    r.querySelector('.nm').textContent = n.cfg.label ?? n.cfg.id;
    r.querySelector('.pct').textContent = `${Math.round(((n.stats.busy ?? 0) / total) * 100)}%`;
    r.classList.toggle('selected', ui.selected === n);
  });
  if (ui.selected && !ui.edit && ui.selected.def.flow) renderProps();
}

function focusOn(n) {
  const p = n.model.group.position;
  const offset = camera.position.clone().sub(controls.target).setLength(16);
  controls.target.copy(p);
  camera.position.copy(p).add(offset);
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('toasts').prepend(el);
  while ($('toasts').children.length > 3) $('toasts').lastChild.remove();
  setTimeout(() => el.remove(), 3500);
}

// =====================================================================
// Toolbar, palette, import/export
// =====================================================================
function setRunning(on) {
  sim.running = on;
  $('btn-play').textContent = on ? '❚❚ Pause' : '▶ Run';
}
$('btn-play').onclick = () => setRunning(!sim.running);
$('btn-reset').onclick = () => { resetSim(); toast('Simulation reset'); };
document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
  sim.speed = Number(b.dataset.speed);
  document.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('active', x === b));
}));
$('btn-edit').onclick = () => {
  ui.edit = !ui.edit;
  ui.connecting = false;
  if (ui.edit) setRunning(false);
  else {
    resetSim();
    setRunning(true);
  }
  drawLinks();
  updateSelection();
  refreshPanels();
};
$('btn-labels').onclick = () => {
  showLabels = !showLabels;
  for (const n of nodes) if (n.label) n.label.visible = showLabels;
  $('btn-labels').classList.toggle('active', showLabels);
};
$('btn-top').onclick = () => {
  const t = controls.target;
  camera.position.set(t.x, 70, t.z + 0.01);
};
$('btn-3d').onclick = () => {
  const t = controls.target;
  camera.position.set(t.x - 18, 30, t.z + 40);
};

const palette = $('palette');
palette.innerHTML = Object.entries(LIBRARY)
  .map(([type, d]) => `<button class="pal" data-type="${type}" title="Add ${d.name}"><span>${d.icon}</span>${d.name}</button>`)
  .join('');
palette.querySelectorAll('.pal').forEach((b) => b.addEventListener('click', () => addObject(b.dataset.type)));

const modal = $('modal');
$('btn-export').onclick = () => {
  $('modal-title').textContent = 'Layout JSON';
  $('modal-text').value = JSON.stringify(layout, null, 2);
  $('modal-apply').hidden = true;
  $('modal-copy').hidden = false;
  modal.hidden = false;
};
$('btn-import').onclick = () => {
  $('modal-title').textContent = 'Paste a layout JSON';
  $('modal-text').value = '';
  $('modal-apply').hidden = false;
  $('modal-copy').hidden = true;
  modal.hidden = false;
};
$('modal-close').onclick = () => { modal.hidden = true; };
$('modal-copy').onclick = async () => {
  const ta = $('modal-text');
  try {
    await navigator.clipboard.writeText(ta.value);
    toast('Copied layout JSON');
  } catch {
    ta.select();
    toast('Select-all is done – press Ctrl/Cmd+C');
  }
};
$('modal-apply').onclick = () => {
  try {
    const l = JSON.parse($('modal-text').value);
    if (!Array.isArray(l.objects)) throw new Error('missing "objects" array');
    layout = normalize(l);
    ui.selected = null;
    commit();
    modal.hidden = true;
    toast(`Loaded "${layout.name ?? 'layout'}"`);
  } catch (err) {
    toast(`Could not load that JSON: ${err.message}`);
  }
};
$('btn-example').onclick = async () => {
  layout = normalize(await loadExample());
  ui.selected = null;
  commit();
  toast('Example layout loaded');
};

async function loadExample() {
  const res = await fetch('./layouts/pack-line.json');
  return res.json();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// =====================================================================
// Main loop
// =====================================================================
const clock = new THREE.Clock();
let uiTick = 0;
function frame() {
  const realDt = Math.min(clock.getDelta(), 0.1);
  const dt = sim.running ? realDt * sim.speed : 0;
  if (dt > 0) {
    const steps = Math.ceil(dt / 0.25);
    for (let i = 0; i < steps; i++) stepSim(dt / steps);
  }
  for (const n of nodes) {
    let moving = false;
    if (n.mover && sim.running && !(ui.dragging && ui.selected === n)) moving = stepMover(n, realDt * Math.min(sim.speed, 3));
    n.model.setState?.(n.state);
    n.model.animate?.(sim.running ? realDt * Math.min(sim.speed, 4) : 0, n.state, moving);
  }
  placeItems();
  if (++uiTick % 12 === 0) renderStats();
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

(async function start() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
  } catch {
    saved = null;
  }
  layout = normalize(saved?.objects ? saved : await loadExample());
  build();
  renderStats();
  document.body.classList.add('ready');
  frame();
  // Console helpers: lineBuilder.layout, lineBuilder.run(seconds) to fast-forward
  window.lineBuilder = { get layout() { return layout; }, sim, get nodes() { return nodes; }, run(sec) { for (let t = 0; t < sec; t += 0.25) stepSim(0.25); } };
})();
