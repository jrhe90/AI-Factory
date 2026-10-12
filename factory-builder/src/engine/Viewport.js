// The 3D editor: renders the project, runs the editing tools and plays the simulation.
// React owns the panels; this class owns the canvas. It reads/writes the project only
// through the store, and re-syncs the scene whenever the project changes.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildObject, CATALOG_BY_TYPE, FLOW_ROLES } from '../library/catalog.js';
import { LIBRARY as GENERIC } from '../../../src/builder/objects.js';
import { ZONE_KINDS, LINK_KINDS, polygonArea, rectPoints, newId, polylineLength } from '../model/project.js';
import { Simulation } from './sim.js';

const DEG = Math.PI / 180;
const ACCENT = 0x7c5cff;
const STATE_COLOR = { busy: 0x22c55e, idle: 0x94a3b8, blocked: 0xf59e0b, down: 0xef4444, off: 0x64748b };
const NO_CLASH = new Set(['vehicle', 'operator']);

let instance = null;
export const getViewport = () => instance;

function labelTexture(lines, { color = '#0f172a', bg = 'rgba(255,255,255,0.92)', border = null, size = 44 } = {}) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = `700 ${size}px Inter, system-ui, sans-serif`;
  const w = Math.max(...lines.map((l, i) => g.measureText(l).width * (i ? 0.8 : 1))) + 40;
  const h = size * 1.25 * lines.length + 22;
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(2, 2, c.width - 4, c.height - 4, 14);
  g.fill();
  if (border) {
    g.strokeStyle = border;
    g.lineWidth = 4;
    g.stroke();
  }
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((l, i) => {
    g.font = `${i ? 600 : 700} ${i ? size * 0.8 : size}px Inter, system-ui, sans-serif`;
    g.fillText(l, c.width / 2, 11 + size * 0.65 + i * size * 1.2);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { tex: t, aspect: c.width / c.height };
}
function sprite(lines, worldH, opts) {
  const { tex, aspect } = labelTexture(lines, opts);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, toneMapped: false }));
  s.scale.set(worldH * aspect, worldH, 1);
  s.renderOrder = 20;
  return s;
}

// Separating-axis test for two convex quads given as [[x,z]x4]
function quadsOverlap(a, b) {
  for (const poly of [a, b]) {
    for (let i = 0; i < 4; i++) {
      const [x1, z1] = poly[i];
      const [x2, z2] = poly[(i + 1) % 4];
      const nx = z2 - z1;
      const nz = x1 - x2;
      const proj = (p) => p.map(([x, z]) => x * nx + z * nz);
      const pa = proj(a);
      const pb = proj(b);
      if (Math.max(...pa) <= Math.min(...pb) + 1e-3 || Math.max(...pb) <= Math.min(...pa) + 1e-3) return false;
    }
  }
  return true;
}

export class Viewport {
  constructor(container, store) {
    instance = this;
    this.container = container;
    this.store = store;
    this.views = new Map(); // object id -> view
    this.keys = {};
    this.draft = null; // in-progress polyline / rect / calibration
    this.connectFrom = null;
    this.drag = null;
    this.sim = null;
    this.simRunning = false;
    this.blinkT = 0;
    this.statsTimer = 0;

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.95;
    container.appendChild(r.domElement);

    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0xd9dfe6);
    const pmrem = new THREE.PMREMGenerator(r);
    scene.environment = pmrem.fromScene(new RoomEnvironment(r), 0.04).texture;
    scene.add(new THREE.HemisphereLight(0xf4f7ff, 0x8a9099, 0.8));
    const sun = (this.sun = new THREE.DirectionalLight(0xfffaf0, 1.5));
    sun.position.set(60, 140, 80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: 0xcfd5dc, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    scene.add(ground);
    this.grid = new THREE.Group();
    const minor = new THREE.GridHelper(400, 400, 0xb8c0ca, 0xc4cbd3);
    minor.material.transparent = true;
    minor.material.opacity = 0.35;
    const major = new THREE.GridHelper(400, 40, 0x9aa4b0, 0x9aa4b0);
    major.material.transparent = true;
    major.material.opacity = 0.45;
    major.position.y = 0.002;
    this.grid.add(minor, major);
    scene.add(this.grid);

    for (const k of ['floorG', 'wallsG', 'zonesG', 'aislesG', 'routesG', 'linksG', 'objectsG', 'overlayG', 'itemsG', 'statusG']) {
      this[k] = new THREE.Group();
      scene.add(this[k]);
    }

    // Parts in the simulation: one instanced mesh
    this.itemMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.35, 0.4), new THREE.MeshStandardMaterial({ roughness: 0.5 }), 800);
    this.itemMesh.count = 0;
    this.itemMesh.castShadow = true;
    this.itemMesh.frustumCulled = false;
    this.itemsG.add(this.itemMesh);

    // Cameras: perspective "city" view and orthographic plan view
    const aspect = container.clientWidth / Math.max(1, container.clientHeight);
    this.persp = new THREE.PerspectiveCamera(45, aspect, 0.3, 3000);
    this.persp.position.set(-40, 90, 110);
    this.ortho = new THREE.OrthographicCamera(-100, 100, 60, -60, 0.1, 2000);
    this.ortho.up.set(0, 0, -1); // north up when looking straight down
    this.ortho.position.set(0, 400, 0);
    this.camera = this.persp;

    // Our pointer handlers are registered before the controls', so a gesture that grabs an
    // object can switch the controls off before they start panning.
    const el = r.domElement;
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('dblclick', (e) => this.onDouble(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('dragover', (e) => this.onDragOver(e));
    el.addEventListener('drop', (e) => this.onDrop(e));
    el.addEventListener('dragleave', () => this.clearGhost());

    this.controlsP = new OrbitControls(this.persp, el);
    this.controlsO = new OrbitControls(this.ortho, el);
    for (const c of [this.controlsP, this.controlsO]) {
      c.enableDamping = true;
      c.dampingFactor = 0.1;
      c.screenSpacePanning = false;
      c.zoomToCursor = true;
    }
    this.controlsP.maxPolarAngle = Math.PI / 2.1;
    this.controlsP.minDistance = 3;
    this.controlsP.maxDistance = 900;
    this.controlsO.enableRotate = false;
    this.controlsO.screenSpacePanning = true;
    this.controlsO.minZoom = 0.2;
    this.controlsO.maxZoom = 40;
    this.controlsO.enabled = false;
    this.controls = this.controlsP;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line.threshold = 0.4;
    this.ndc = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    window.addEventListener('keydown', (this._kd = (e) => this.onKey(e)));
    window.addEventListener('keyup', (this._ku = (e) => { this.keys[e.key] = false; }));
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();

    this.lastJSON = {};
    this.unsub = store.subscribe((s, prev) => {
      if (s.project !== prev.project) this.sync(s.project);
      if (s.selection !== prev.selection) this.drawSelection();
      if (s.tool !== prev.tool || s.placeType !== prev.placeType) this.onToolChange();
      if (s.view !== prev.view) this.setView(s.view);
      if (s.showLabels !== prev.showLabels) this.syncLabels();
    });
    this.sync(store.getState().project);
    this.applyMouseButtons();
    this.clock = new THREE.Clock();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.unsub();
    this.ro.disconnect();
    window.removeEventListener('keydown', this._kd);
    window.removeEventListener('keyup', this._ku);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    instance = null;
  }

  resize() {
    const w = this.container.clientWidth;
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    const half = 60;
    this.ortho.left = (-half * w) / h;
    this.ortho.right = (half * w) / h;
    this.ortho.top = half;
    this.ortho.bottom = -half;
    this.ortho.updateProjectionMatrix();
  }

  get state() { return this.store.getState(); }
  get project() { return this.store.getState().project; }

  // =================================================================== sync
  sync(p) {
    const changed = (key, value) => {
      const j = JSON.stringify(value);
      if (this.lastJSON[key] === j) return false;
      this.lastJSON[key] = j;
      return true;
    };
    const f = p.floor;
    if (this.floorSrc !== f.source || changed('floor', { ...f, source: null })) {
      this.floorSrc = f.source;
      this.buildFloor(f);
    }
    if (changed('walls', p.walls)) this.buildWalls(p.walls);
    if (changed('zones', p.zones)) this.buildZones(p.zones);
    if (changed('aisles', p.aisles)) this.buildAisles(p.aisles);
    if (changed('routes', p.routes)) this.buildRoutes(p.routes);
    const objectsChanged = changed('objects', p.objects);
    if (objectsChanged) this.syncObjects(p.objects);
    if (changed('links', p.links) || objectsChanged) this.buildLinks(p.links);
    this.drawSelection();
    this.fitShadows(p);
    if (this.sim && objectsChanged) this.resetSim();
  }

  fitShadows(p) {
    const xs = [];
    const zs = [];
    for (const o of p.objects) {
      xs.push(o.x);
      zs.push(o.z);
    }
    for (const w of p.walls) for (const [x, z] of w.points) {
      xs.push(x);
      zs.push(z);
    }
    if (!xs.length) {
      xs.push(-50, 50);
      zs.push(-50, 50);
    }
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const half = Math.max(30, (Math.max(...xs) - Math.min(...xs)) / 2 + 15, (Math.max(...zs) - Math.min(...zs)) / 2 + 15);
    const cam = this.sun.shadow.camera;
    Object.assign(cam, { left: -half, right: half, top: half, bottom: -half, near: 10, far: 500 });
    cam.updateProjectionMatrix();
    this.sun.position.set(cx + 60, 150, cz + 80);
    this.sun.target.position.set(cx, 0, cz);
  }

  // ---------------------------------------------------------------- floor plan
  buildFloor(f) {
    this.floorG.clear();
    const src = f.source;
    if (!src || !f.visible) return;
    const g = new THREE.Group();
    if (src.kind === 'dxf') {
      const [x0, y0, x1, y1] = src.bounds;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const back = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: f.opacity * 0.9, toneMapped: false, depthWrite: false }));
      back.rotation.x = -Math.PI / 2;
      back.renderOrder = -2;
      g.add(back);
      for (const L of src.layers) {
        if (!L.visible) continue;
        const pos = new Float32Array((L.segments.length / 2) * 3);
        for (let i = 0, k = 0; i < L.segments.length; i += 2, k += 3) {
          pos[k] = L.segments[i] - cx;
          pos[k + 1] = 0;
          pos[k + 2] = -(L.segments[i + 1] - cy);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: L.color, transparent: true, opacity: Math.min(1, f.opacity + 0.15), toneMapped: false }));
        lines.position.y = 0.015 / f.mpp;
        lines.renderOrder = -1;
        g.add(lines);
      }
      g.scale.set(f.mpp, 1, f.mpp);
    } else {
      const tex = new THREE.TextureLoader().load(src.image);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(src.width * f.mpp, src.height * f.mpp),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: f.opacity, toneMapped: false, depthWrite: false }),
      );
      plane.rotation.x = -Math.PI / 2;
      plane.renderOrder = -1;
      g.add(plane);
    }
    g.position.set(f.center[0], 0.006, f.center[1]);
    g.rotation.y = (f.rotation ?? 0) * DEG;
    this.floorG.add(g);
  }

  // ---------------------------------------------------------------- walls, zones, aisles, routes
  buildWalls(walls) {
    this.wallsG.clear();
    const m = new THREE.MeshStandardMaterial({ color: 0xe8ebef, roughness: 0.8 });
    const cap = new THREE.MeshStandardMaterial({ color: 0x9aa4b0, roughness: 0.6 });
    for (const w of walls) {
      const h = w.height ?? 3;
      const t = w.thickness ?? 0.2;
      for (let i = 1; i < w.points.length; i++) {
        const [ax, az] = w.points[i - 1];
        const [bx, bz] = w.points[i];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.05) continue;
        const seg = new THREE.Mesh(new THREE.BoxGeometry(len + t, h, t), m);
        seg.position.set((ax + bx) / 2, h / 2, (az + bz) / 2);
        seg.rotation.y = -Math.atan2(bz - az, bx - ax);
        seg.castShadow = seg.receiveShadow = true;
        seg.userData.pick = { id: w.id, kind: 'wall' };
        this.wallsG.add(seg);
        const top = new THREE.Mesh(new THREE.BoxGeometry(len + t + 0.02, 0.06, t + 0.02), cap);
        top.position.set(seg.position.x, h + 0.03, seg.position.z);
        top.rotation.y = seg.rotation.y;
        this.wallsG.add(top);
      }
    }
  }

  buildZones(zones) {
    this.zonesG.clear();
    for (const z of zones) {
      const color = new THREE.Color(z.color ?? ZONE_KINDS[z.kind]?.color ?? '#94a3b8');
      const shape = new THREE.Shape(z.points.map(([x, zz]) => new THREE.Vector2(x, -zz)));
      const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false, toneMapped: false }));
      fill.rotation.x = -Math.PI / 2;
      fill.position.y = 0.02;
      fill.renderOrder = 1;
      fill.userData.pick = { id: z.id, kind: 'zone' };
      this.zonesG.add(fill);
      const pts = [...z.points, z.points[0]].map(([x, zz]) => new THREE.Vector3(x, 0.04, zz));
      const edge = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color, dashSize: 1.2, gapSize: 0.7, toneMapped: false }));
      edge.computeLineDistances();
      this.zonesG.add(edge);
      const xs = z.points.map((p) => p[0]);
      const zs = z.points.map((p) => p[1]);
      const size = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
      const lbl = sprite([z.name.toUpperCase(), `${Math.round(polygonArea(z.points)).toLocaleString()} m²`], Math.max(1.6, Math.min(5, size * 0.18)), { bg: 'rgba(255,225,26,0.95)', color: '#111', border: '#111' });
      lbl.position.set((Math.min(...xs) + Math.max(...xs)) / 2, 4, (Math.min(...zs) + Math.max(...zs)) / 2);
      lbl.userData.label = true;
      lbl.userData.zoneLabel = true;
      lbl.visible = this.state.showLabels;
      this.zonesG.add(lbl);
    }
  }

  buildAisles(aisles) {
    this.aislesG.clear();
    const fillM = new THREE.MeshBasicMaterial({ color: 0xf3f4f6, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false });
    const edgeM = new THREE.MeshBasicMaterial({ color: 0xf2c230, toneMapped: false });
    for (const a of aisles) {
      const w = a.width ?? 3;
      for (let i = 1; i < a.points.length; i++) {
        const [ax, az] = a.points[i - 1];
        const [bx, bz] = a.points[i];
        const len = Math.hypot(bx - ax, bz - az);
        const ang = -Math.atan2(bz - az, bx - ax);
        const g = new THREE.Group();
        g.position.set((ax + bx) / 2, 0.025, (az + bz) / 2);
        g.rotation.y = ang;
        const band = new THREE.Mesh(new THREE.PlaneGeometry(len + w, w).rotateX(-Math.PI / 2), fillM);
        band.userData.pick = { id: a.id, kind: 'aisle' };
        g.add(band);
        for (const s of [-1, 1]) {
          const e = new THREE.Mesh(new THREE.PlaneGeometry(len + w, 0.12).rotateX(-Math.PI / 2), edgeM);
          e.position.set(0, 0.005, (s * w) / 2);
          g.add(e);
        }
        this.aislesG.add(g);
      }
    }
  }

  buildRoutes(routes) {
    this.routesG.clear();
    for (const r of routes) {
      const color = new THREE.Color(r.color ?? '#06b6d4');
      const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false });
      for (let i = 1; i < r.points.length; i++) {
        const [ax, az] = r.points[i - 1];
        const [bx, bz] = r.points[i];
        const len = Math.hypot(bx - ax, bz - az);
        const ang = -Math.atan2(bz - az, bx - ax);
        const rib = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.3).rotateX(-Math.PI / 2), m);
        rib.position.set((ax + bx) / 2, 0.05, (az + bz) / 2);
        rib.rotation.y = ang;
        rib.renderOrder = 3;
        rib.userData.pick = { id: r.id, kind: 'route' };
        this.routesG.add(rib);
        // Direction chevrons
        const n = Math.floor(len / 4);
        for (let k = 1; k <= n; k++) {
          const t = k / (n + 1);
          const chev = new THREE.Mesh(new THREE.CircleGeometry(0.35, 3).rotateX(-Math.PI / 2), m);
          chev.position.set(ax + (bx - ax) * t, 0.06, az + (bz - az) * t);
          chev.rotation.y = ang;
          chev.renderOrder = 3;
          if (!r.oneWay) chev.scale.set(0.6, 1, 0.6);
          this.routesG.add(chev);
        }
      }
      for (const [x, z] of r.points) {
        const dot = new THREE.Mesh(new THREE.CircleGeometry(0.3, 16).rotateX(-Math.PI / 2), m);
        dot.position.set(x, 0.055, z);
        dot.renderOrder = 3;
        this.routesG.add(dot);
      }
    }
  }

  // ---------------------------------------------------------------- objects
  syncObjects(objects) {
    const seen = new Set();
    const placed = {};
    for (const o of objects) if (o.type === 'operator' && o.props?.stationId) placed[o.props.stationId] = (placed[o.props.stationId] ?? 0) + 1;
    for (const o of objects) {
      seen.add(o.id);
      let v = this.views.get(o.id);
      // Stations draw their own crew, minus any operators placed for them
      const props = placed[o.id] ? { ...o.props, _placed: placed[o.id] } : o.props;
      const key = JSON.stringify([o.type, props]);
      if (!v || v.key !== key) {
        if (v) this.objectsG.remove(v.root);
        const built = buildObject(o.type, props);
        if (!built) continue;
        const root = new THREE.Group();
        root.add(built.group);
        root.userData.pick = { id: o.id, kind: 'object' };
        const def = CATALOG_BY_TYPE[o.type];
        v = { id: o.id, key, root, built, def };
        // Footprint outline (selection / clash)
        const [x0, z0] = built.footprint.min;
        const [x1, z1] = built.footprint.max;
        const outline = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]].map(([x, z]) => new THREE.Vector3(x, 0.06, z))),
          new THREE.LineBasicMaterial({ color: ACCENT, toneMapped: false, depthTest: false }),
        );
        outline.renderOrder = 10;
        outline.visible = false;
        root.add(outline);
        v.outline = outline;
        // Status disc shown while simulating
        if (FLOW_ROLES.has(def.role)) {
          const disc = new THREE.Mesh(new THREE.RingGeometry(0.0, 0.45, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x94a3b8, toneMapped: false, depthTest: false }));
          disc.position.set((x0 + x1) / 2, 0.08, z1 + 0.6);
          disc.renderOrder = 11;
          disc.visible = false;
          root.add(disc);
          v.disc = disc;
        }
        this.objectsG.add(root);
        this.views.set(o.id, v);
      }
      v.data = o;
      v.root.position.set(o.x, 0, o.z);
      v.root.rotation.y = (o.rot ?? 0) * DEG;
      v.root.updateMatrixWorld(true);
      this.setObjectLabel(v);
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) {
        this.objectsG.remove(v.root);
        this.views.delete(id);
      }
    }
  }
  setObjectLabel(v) {
    const text = v.data.name;
    if (v.labelText === text && v.label) return;
    if (v.label) v.root.remove(v.label);
    v.labelText = text;
    if (['vehicle', 'operator'].includes(v.def.role) || v.def.type === 'column') return;
    v.label = sprite([text], 0.55, { bg: 'rgba(15,23,42,0.82)', color: '#fff', size: 40 });
    v.label.position.y = Math.min(6, (v.built.height ?? 2) + 0.7);
    v.label.userData.label = true;
    v.label.visible = this.state.showLabels;
    v.root.add(v.label);
  }
  syncLabels() {
    const on = this.state.showLabels;
    this.scene.traverse((o) => { if (o.userData.label) o.visible = on; });
  }

  footprintWorld(o, def = CATALOG_BY_TYPE[o.type], fp) {
    const f = fp ?? this.views.get(o.id)?.built.footprint;
    if (!f) return null;
    const r = (o.rot ?? 0) * DEG;
    const c = Math.cos(r);
    const s = Math.sin(r);
    return [[f.min[0], f.min[1]], [f.max[0], f.min[1]], [f.max[0], f.max[1]], [f.min[0], f.max[1]]].map(([x, z]) => [o.x + x * c + z * s, o.z - x * s + z * c]);
  }
  clashesFor(o, fp) {
    const def = CATALOG_BY_TYPE[o.type];
    if (!def || NO_CLASH.has(def.role) || def.clash === false) return [];
    const a = this.footprintWorld(o, def, fp);
    if (!a) return [];
    // shrink a little so touching objects don't count
    const out = [];
    for (const other of this.project.objects) {
      if (other.id === o.id) continue;
      const od = CATALOG_BY_TYPE[other.type];
      if (!od || NO_CLASH.has(od.role) || od.clash === false) continue;
      const b = this.footprintWorld(other, od);
      if (b && quadsOverlap(shrink(a, 0.1), shrink(b, 0.1))) out.push(other);
    }
    return out;
  }

  worldPoints(id) {
    const v = this.views.get(id);
    if (!v) return null;
    v.root.updateMatrixWorld(true);
    const w = (p) => v.root.localToWorld(p.clone()).toArray();
    return { entry: w(v.built.entry), exit: w(v.built.exit), work: w(v.built.work) };
  }

  // ---------------------------------------------------------------- links
  buildLinks(links) {
    this.linksG.clear();
    for (const l of links) {
      const a = this.worldPoints(l.from);
      const b = this.worldPoints(l.to);
      if (!a || !b) continue;
      const p0 = new THREE.Vector3(...a.exit);
      const p1 = new THREE.Vector3(...b.entry);
      const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      const ang = -Math.atan2(p1.z - p0.z, p1.x - p0.x);
      const mid = new THREE.Vector3((p0.x + p1.x) / 2, 0, (p0.z + p1.z) / 2);
      const g = new THREE.Group();
      g.position.copy(mid);
      g.rotation.y = ang;
      if (l.kind === 'conveyor' && len > 0.6) {
        const conv = GENERIC.conveyor.build({ length: len, width: 0.7, height: 0.8 });
        g.add(conv.group);
      } else {
        const color = new THREE.Color(LINK_KINDS[l.kind]?.color ?? '#94a3b8');
        const y = l.kind === 'transport' ? 0.09 : 0.07;
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-len / 2, y, 0), new THREE.Vector3(len / 2 - 0.5, y, 0)]), new THREE.LineDashedMaterial({ color, dashSize: 0.6, gapSize: 0.4, toneMapped: false }));
        line.computeLineDistances();
        g.add(line);
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 12).rotateZ(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
        head.position.set(len / 2 - 0.35, y, 0);
        g.add(head);
      }
      const hit = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.5, len), 1.2, 0.9), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.y = 0.6;
      hit.userData.pick = { id: l.id, kind: 'link' };
      g.add(hit);
      g.userData.linkId = l.id;
      this.linksG.add(g);
    }
  }

  // =================================================================== selection overlay
  drawSelection() {
    const sel = new Set(this.state.selection);
    for (const v of this.views.values()) {
      const on = sel.has(v.id);
      v.outline.visible = on || this.state.tool === 'connect';
      if (on) {
        const clash = this.clashesFor(v.data).length > 0;
        v.outline.material.color.setHex(clash ? 0xef4444 : ACCENT);
      } else if (this.state.tool === 'connect') {
        v.outline.material.color.setHex(this.connectFrom === v.id ? 0x22d3ee : FLOW_ROLES.has(v.def.role) ? 0x7dd3fc : 0x64748b);
        v.outline.visible = FLOW_ROLES.has(v.def.role);
      }
    }
    // vertex handles for selected polylines / zones
    this.overlayG.children.filter((c) => c.userData.handle).forEach((c) => this.overlayG.remove(c));
    const p = this.project;
    for (const id of sel) {
      for (const [key, kind] of [['walls', 'wall'], ['aisles', 'aisle'], ['routes', 'route'], ['zones', 'zone']]) {
        const e = p[key].find((x) => x.id === id);
        if (!e) continue;
        e.points.forEach(([x, z], i) => {
          const h = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshBasicMaterial({ color: ACCENT, toneMapped: false, depthTest: false }));
          h.position.set(x, kind === 'wall' ? (e.height ?? 3) + 0.3 : 0.3, z);
          h.renderOrder = 15;
          h.userData = { handle: true, pick: { id, kind: 'handle', key, index: i } };
          this.overlayG.add(h);
        });
      }
    }
    for (const g of this.linksG.children) g.scale.y = sel.has(g.userData.linkId) ? 1.6 : 1;
    for (const c of [...this.wallsG.children, ...this.zonesG.children, ...this.aislesG.children, ...this.routesG.children]) {
      const id = c.userData.pick?.id ?? c.children?.[0]?.userData?.pick?.id;
      if (c.isMesh && c.userData.pick?.kind === 'zone') c.material.opacity = sel.has(id) ? 0.32 : 0.16;
    }
  }

  // =================================================================== picking & tools
  setNdc(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
  }
  groundPoint(e) {
    this.setNdc(e);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, p) ? p : null;
  }
  snap(v) {
    const { snapOn, snap } = this.state;
    return snapOn && !this.keys.Alt ? Math.round(v / snap) * snap : Math.round(v * 100) / 100;
  }
  pick(e, kinds = ['handle', 'object', 'link', 'wall', 'route', 'aisle', 'zone']) {
    this.setNdc(e);
    const groups = { handle: this.overlayG, object: this.objectsG, link: this.linksG, wall: this.wallsG, route: this.routesG, aisle: this.aislesG, zone: this.zonesG };
    for (const k of kinds) {
      const hits = this.raycaster.intersectObjects(groups[k].children, true);
      for (const h of hits) {
        if (h.object.isSprite) continue;
        let o = h.object;
        while (o && !o.userData.pick) o = o.parent;
        if (o?.userData.pick) return { ...o.userData.pick, point: h.point };
      }
    }
    return null;
  }

  applyMouseButtons() {
    const tool = this.state.tool;
    const drawing = tool !== 'select';
    const plan = this.state.view === 'plan';
    this.controlsP.mouseButtons = { LEFT: drawing ? null : THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: drawing ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE };
    this.controlsO.mouseButtons = { LEFT: drawing ? null : THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.renderer.domElement.style.cursor = drawing ? 'crosshair' : 'default';
    void plan;
  }

  onToolChange() {
    this.cancelDraft();
    this.connectFrom = null;
    this.applyMouseButtons();
    this.clearGhost();
    const hints = {
      select: 'Click to select · drag to move · R rotate · Ctrl+D duplicate · Del delete · left-drag empty floor to pan, right-drag to orbit',
      wall: 'Click to add wall points · Shift locks to 90° · double-click or Enter to finish · Esc cancels',
      zone: 'Drag a rectangle to create a zone',
      aisle: 'Click to add aisle centre-line points · double-click or Enter to finish',
      route: 'Click to add AGV route points · double-click or Enter to finish · routes that cross are joined',
      connect: 'Click the upstream object, then the downstream one, to link them',
      calibrate: 'Click two points on the plan whose real distance you know',
      place: 'Click to place · R rotates before placing · Esc to stop',
    };
    this.store.setState({ hint: hints[this.state.tool] ?? '' });
    this.drawSelection();
  }

  cancelDraft() {
    this.draft = null;
    this.overlayG.children.filter((c) => c.userData.draft).forEach((c) => this.overlayG.remove(c));
  }

  onDown(e) {
    this.downAt = [e.clientX, e.clientY];
    if (e.button !== 0) return;
    const s = this.state;
    const gp = this.groundPoint(e);
    if (s.tool === 'select') {
      const hit = this.pick(e);
      if (!hit) {
        if (!e.shiftKey) this.pendingClear = true;
        return;
      }
      this.disableControls();
      if (hit.kind === 'handle') {
        this.drag = { kind: 'vertex', ...hit };
        return;
      }
      if (!s.selection.includes(hit.id) || e.shiftKey) s.select(hit.id, e.shiftKey);
      if (!this.sim) this.store.setState({ rightTab: 'props' });
      const ids = this.state.selection;
      if ((hit.kind === 'object' || hit.kind === 'zone') && gp) {
        const p = this.project;
        this.drag = {
          kind: 'move', start: gp.clone(), moved: false,
          items: ids.map((id) => {
            const o = p.objects.find((x) => x.id === id);
            if (o) return { id, type: 'object', x: o.x, z: o.z };
            const z = p.zones.find((x) => x.id === id);
            if (z) return { id, type: 'zone', points: z.points.map((q) => [...q]) };
            return null;
          }).filter(Boolean),
        };
      }
      return;
    }
    if (!gp) return;
    const x = this.snap(gp.x);
    const z = this.snap(gp.z);
    if (s.tool === 'place') {
      this.placeAt(x, z);
    } else if (s.tool === 'zone') {
      this.disableControls();
      this.draft = { kind: 'zone', a: [x, z], b: [x, z] };
      this.drawDraft();
    } else if (['wall', 'aisle', 'route'].includes(s.tool)) {
      let pt = [x, z];
      if (this.draft?.points.length && e.shiftKey) pt = this.ortho(this.draft.points[this.draft.points.length - 1], pt);
      if (!this.draft) this.draft = { kind: s.tool, points: [] };
      const last = this.draft.points[this.draft.points.length - 1];
      if (!last || Math.hypot(last[0] - pt[0], last[1] - pt[1]) > 0.05) this.draft.points.push(pt);
      this.drawDraft();
    } else if (s.tool === 'connect') {
      const hit = this.pick(e, ['object']);
      const v = hit && this.views.get(hit.id);
      if (!v || !FLOW_ROLES.has(v.def.role)) {
        this.store.getState().toast('Pick a flow object: source, station, buffer, storage or sink.', 'warn');
        return;
      }
      if (!this.connectFrom) {
        if (v.def.role === 'sink') return this.store.getState().toast('A sink has no outputs; start from an upstream object.', 'warn');
        this.connectFrom = hit.id;
        this.drawSelection();
      } else if (hit.id !== this.connectFrom) {
        if (v.def.role === 'source') return this.store.getState().toast('A source has no inputs; pick a downstream object.', 'warn');
        const from = this.connectFrom;
        const kind = this.state.linkKind;
        this.state.update((p) => {
          if (p.links.some((l) => l.from === from && l.to === hit.id)) return;
          p.links.push({ id: newId(p, 'link'), from, to: hit.id, kind });
        });
        this.connectFrom = e.shiftKey ? from : hit.id; // chain: keep linking downstream
        this.drawSelection();
      }
    } else if (s.tool === 'calibrate') {
      const raw = [gp.x, gp.z];
      if (!this.draft) {
        this.draft = { kind: 'calibrate', points: [raw] };
      } else {
        this.draft.points = [this.draft.points[0], raw];
        const [a, b] = this.draft.points;
        const measured = Math.hypot(b[0] - a[0], b[1] - a[1]);
        this.state.openDialog({ kind: 'calibrate', a, b, measured });
      }
      this.drawDraft();
    }
  }

  ortho(prev, pt) {
    return Math.abs(pt[0] - prev[0]) > Math.abs(pt[1] - prev[1]) ? [pt[0], prev[1]] : [prev[0], pt[1]];
  }

  onMove(e) {
    const gp = this.groundPoint(e);
    if (gp) {
      this.cursorTick = (this.cursorTick ?? 0) + 1;
      if (this.cursorTick % 3 === 0) this.store.setState({ cursor: [gp.x, gp.z] });
    }
    const s = this.state;
    if (this.drag && gp) {
      if (this.drag.kind === 'move') {
        const dx = this.snap(gp.x - this.drag.start.x);
        const dz = this.snap(gp.z - this.drag.start.z);
        if (Math.abs(dx) + Math.abs(dz) > 0) this.drag.moved = true;
        this.drag.dx = dx;
        this.drag.dz = dz;
        for (const it of this.drag.items) {
          if (it.type === 'object') {
            const v = this.views.get(it.id);
            v.root.position.set(it.x + dx, 0, it.z + dz);
            const clash = this.clashesFor({ ...v.data, x: it.x + dx, z: it.z + dz }).length > 0;
            v.outline.material.color.setHex(clash ? 0xef4444 : ACCENT);
          }
        }
        if (this.drag.items.some((i) => i.type === 'zone')) this.previewZones(dx, dz);
      } else if (this.drag.kind === 'vertex') {
        this.drag.to = [this.snap(gp.x), this.snap(gp.z)];
        const h = this.overlayG.children.find((c) => c.userData.handle && c.userData.pick.index === this.drag.index && c.userData.pick.id === this.drag.id);
        if (h) h.position.set(this.drag.to[0], h.position.y, this.drag.to[1]);
      }
      return;
    }
    if (!gp) return;
    if (s.tool === 'place') this.moveGhost(this.snap(gp.x), this.snap(gp.z));
    if (this.draft) {
      if (this.draft.kind === 'zone' && this.draft.a) this.draft.b = [this.snap(gp.x), this.snap(gp.z)];
      else {
        let pt = this.draft.kind === 'calibrate' ? [gp.x, gp.z] : [this.snap(gp.x), this.snap(gp.z)];
        const pts = this.draft.points;
        if (e.shiftKey && pts.length && this.draft.kind !== 'calibrate') pt = this.ortho(pts[pts.length - 1], pt);
        this.draft.cursor = pt;
      }
      this.drawDraft();
    }
  }

  onUp(e) {
    const moved = this.downAt && Math.hypot(e.clientX - this.downAt[0], e.clientY - this.downAt[1]) > 4;
    if (this.pendingClear && !moved) this.state.select([]);
    this.pendingClear = false;
    const d = this.drag;
    this.drag = null;
    this.enableControls();
    if (d?.kind === 'move' && d.moved) {
      this.state.update((p) => {
        for (const it of d.items) {
          if (it.type === 'object') {
            const o = p.objects.find((x) => x.id === it.id);
            o.x = it.x + d.dx;
            o.z = it.z + d.dz;
          } else {
            const z = p.zones.find((x) => x.id === it.id);
            z.points = it.points.map(([x, zz]) => [x + d.dx, zz + d.dz]);
          }
        }
      });
    } else if (d?.kind === 'vertex' && d.to) {
      this.state.update((p) => { p[d.key].find((x) => x.id === d.id).points[d.index] = d.to; });
    }
    if (this.draft?.kind === 'zone') {
      const { a, b } = this.draft;
      this.cancelDraft();
      if (Math.abs(b[0] - a[0]) >= 1 && Math.abs(b[1] - a[1]) >= 1) {
        const kind = this.state.zoneKind;
        let id;
        this.state.update((p) => {
          id = newId(p, 'zone');
          const n = p.zones.filter((zz) => zz.kind === kind).length + 1;
          p.zones.push({ id, name: `${ZONE_KINDS[kind].label}${n > 1 ? ` ${n}` : ''}`, kind, color: ZONE_KINDS[kind].color, points: rectPoints(a[0], a[1], b[0], b[1]) });
        });
        this.state.select(id);
      }
    }
  }

  onDouble() {
    if (this.draft && ['wall', 'aisle', 'route'].includes(this.draft.kind)) this.finishPolyline();
  }

  finishPolyline() {
    const d = this.draft;
    this.cancelDraft();
    if (!d || d.points.length < 2) return;
    let id;
    this.state.update((p) => {
      if (d.kind === 'wall') {
        id = newId(p, 'wall');
        p.walls.push({ id, points: d.points, height: 3, thickness: 0.2 });
      } else if (d.kind === 'aisle') {
        id = newId(p, 'aisle');
        p.aisles.push({ id, points: d.points, width: 3 });
      } else {
        id = newId(p, 'route');
        p.routes.push({ id, name: `Route ${p.routes.length + 1}`, points: d.points, oneWay: false, color: '#06b6d4' });
      }
    });
    this.state.toast(`${d.kind === 'route' ? 'AGV route' : d.kind[0].toUpperCase() + d.kind.slice(1)} added (${polylineLength(d.points).toFixed(1)} m)`);
    this.state.select(id);
  }

  disableControls() { this.controls.enabled = false; }
  enableControls() { this.controls.enabled = true; }

  previewZones(dx, dz) {
    this.overlayG.children.filter((c) => c.userData.zonePreview).forEach((c) => this.overlayG.remove(c));
    for (const it of this.drag.items) {
      if (it.type !== 'zone') continue;
      const pts = [...it.points, it.points[0]].map(([x, z]) => new THREE.Vector3(x + dx, 0.08, z + dz));
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: ACCENT, toneMapped: false, depthTest: false }));
      l.userData.zonePreview = true;
      this.overlayG.add(l);
    }
  }

  drawDraft() {
    this.overlayG.children.filter((c) => c.userData.draft || c.userData.zonePreview).forEach((c) => this.overlayG.remove(c));
    const d = this.draft;
    if (!d) return;
    const add = (o) => {
      o.userData.draft = true;
      o.renderOrder = 15;
      this.overlayG.add(o);
    };
    const lineMat = new THREE.LineBasicMaterial({ color: d.kind === 'route' ? 0x06b6d4 : d.kind === 'calibrate' ? 0xef4444 : ACCENT, toneMapped: false, depthTest: false });
    let pts;
    if (d.kind === 'zone') {
      pts = [...rectPoints(d.a[0], d.a[1], d.b[0], d.b[1])];
      pts.push(pts[0]);
      const w = Math.abs(d.b[0] - d.a[0]);
      const h = Math.abs(d.b[1] - d.a[1]);
      const s = sprite([`${w.toFixed(1)} × ${h.toFixed(1)} m`, `${Math.round(w * h)} m²`], 1.4, { bg: 'rgba(124,92,255,0.92)', color: '#fff' });
      s.position.set((d.a[0] + d.b[0]) / 2, 1.5, (d.a[1] + d.b[1]) / 2);
      add(s);
    } else {
      pts = [...d.points];
      if (d.cursor) pts.push(d.cursor);
      if (pts.length >= 2) {
        const [a, b] = pts.slice(-2);
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const s = sprite([`${len.toFixed(2)} m`], 1.1, { bg: 'rgba(15,23,42,0.85)', color: '#fff' });
        s.position.set((a[0] + b[0]) / 2, 1.2, (a[1] + b[1]) / 2);
        add(s);
      }
    }
    for (const [x, z] of pts) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshBasicMaterial({ color: lineMat.color, toneMapped: false, depthTest: false }));
      dot.position.set(x, 0.12, z);
      add(dot);
    }
    if (pts.length >= 2) add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(([x, z]) => new THREE.Vector3(x, 0.12, z))), lineMat));
  }

  // ---------------------------------------------------------------- placing objects
  ensureGhost(type) {
    if (this.ghost?.type === type) return this.ghost;
    this.clearGhost();
    const built = buildObject(type, {});
    if (!built) return null;
    const root = new THREE.Group();
    root.add(built.group);
    const [x0, z0] = built.footprint.min;
    const [x1, z1] = built.footprint.max;
    const rect = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false }));
    rect.position.set((x0 + x1) / 2, 0.07, (z0 + z1) / 2);
    rect.renderOrder = 12;
    root.add(rect);
    root.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    this.overlayG.add(root);
    this.ghost = { type, root, rect, built, rot: this.ghostRot ?? 0 };
    return this.ghost;
  }
  moveGhost(x, z) {
    const type = this.state.placeType ?? this.dragType;
    if (!type) return;
    const g = this.ensureGhost(type);
    if (!g) return;
    g.root.position.set(x, 0, z);
    g.root.rotation.y = (this.ghostRot ?? 0) * DEG;
    g.x = x;
    g.z = z;
    const clash = this.clashesFor({ id: '__ghost', type, x, z, rot: this.ghostRot ?? 0 }, g.built.footprint).length > 0;
    g.rect.material.color.setHex(clash ? 0xef4444 : 0x22c55e);
    g.clash = clash;
  }
  clearGhost() {
    if (this.ghost) this.overlayG.remove(this.ghost.root);
    this.ghost = null;
  }
  placeAt(x, z, type = this.state.placeType) {
    if (!type) return;
    const id = this.state.addObject(type, x, z, this.ghostRot ?? 0);
    if (this.ghost?.clash) this.state.toast('Placed, but it overlaps another object (shown in red).', 'warn');
    return id;
  }
  onDragOver(e) {
    if (!e.dataTransfer.types.includes('application/x-sim-object')) return;
    e.preventDefault();
    const gp = this.groundPoint(e);
    if (gp) this.moveGhost(this.snap(gp.x), this.snap(gp.z));
  }
  onDrop(e) {
    const type = e.dataTransfer.getData('application/x-sim-object');
    if (!type) return;
    e.preventDefault();
    const gp = this.groundPoint(e);
    this.clearGhost();
    this.dragType = null;
    if (gp) this.placeAt(this.snap(gp.x), this.snap(gp.z), type);
  }
  beginPaletteDrag(type) { this.dragType = type; }

  // ---------------------------------------------------------------- keyboard
  onKey(e) {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
    this.keys[e.key] = true;
    const s = this.state;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) s.redo();
      else s.undo();
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      s.redo();
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      s.duplicateSelected();
      return;
    }
    if (ctrl) return;
    switch (e.key) {
      case 'Escape':
        if (this.draft) this.cancelDraft();
        else if (this.connectFrom) {
          this.connectFrom = null;
          this.drawSelection();
        } else if (s.tool !== 'select') s.setTool('select');
        else s.select([]);
        break;
      case 'Enter':
        if (this.draft && ['wall', 'aisle', 'route'].includes(this.draft.kind)) this.finishPolyline();
        break;
      case 'Delete':
      case 'Backspace':
        s.removeSelected();
        break;
      case 'r':
      case 'R':
        if (s.tool === 'place') {
          this.ghostRot = ((this.ghostRot ?? 0) + (e.shiftKey ? -90 : 90) + 360) % 360;
          if (this.ghost) this.ghost.root.rotation.y = this.ghostRot * DEG;
        } else s.rotateSelected(e.shiftKey ? -90 : 90);
        break;
      case 'q':
        s.rotateSelected(-15);
        break;
      case 'e':
        s.rotateSelected(15);
        break;
      case 'f':
        this.focusSelection();
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        const ids = new Set(s.selection);
        if (!ids.size) return;
        e.preventDefault();
        const step = (s.snapOn ? s.snap : 0.1) * (e.shiftKey ? 5 : 1);
        const [dx, dz] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        s.update((p) => {
          for (const o of p.objects) if (ids.has(o.id)) {
            o.x += dx;
            o.z += dz;
          }
        });
        break;
      }
      default: {
        const tools = { v: 'select', w: 'wall', z: 'zone', a: 'aisle', p: 'route', c: 'connect', m: 'calibrate' };
        if (tools[e.key]) s.setTool(tools[e.key]);
      }
    }
  }

  // =================================================================== camera
  setView(view) {
    const plan = view === 'plan';
    const from = this.controls;
    this.controls = plan ? this.controlsO : this.controlsP;
    this.camera = plan ? this.ortho : this.persp;
    this.controlsP.enabled = !plan;
    this.controlsO.enabled = plan;
    if (plan) {
      const t = from.target.clone();
      this.controlsO.target.copy(t);
      this.ortho.position.set(t.x, 400, t.z);
      this.ortho.zoom = Math.max(0.3, 60 / Math.max(10, this.persp.position.distanceTo(from.target) * 0.5));
      this.ortho.updateProjectionMatrix();
    } else {
      this.controlsP.target.copy(from.target);
    }
    this.applyMouseButtons();
  }
  fit() {
    const p = this.project;
    const pts = [];
    for (const o of p.objects) pts.push([o.x, o.z]);
    for (const z of p.zones) pts.push(...z.points);
    for (const w of p.walls) pts.push(...w.points);
    const src = p.floor.source;
    if (src && p.floor.visible && !pts.length) {
      const w = (src.kind === 'dxf' ? src.bounds[2] - src.bounds[0] : src.width) * p.floor.mpp;
      const h = (src.kind === 'dxf' ? src.bounds[3] - src.bounds[1] : src.height) * p.floor.mpp;
      pts.push([p.floor.center[0] - w / 2, p.floor.center[1] - h / 2], [p.floor.center[0] + w / 2, p.floor.center[1] + h / 2]);
    }
    if (!pts.length) pts.push([-40, -30], [40, 30]);
    const xs = pts.map((q) => q[0]);
    const zs = pts.map((q) => q[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), (Math.max(...zs) - Math.min(...zs)) * aspect, 20);
    this.controlsP.target.set(cx, 0, cz + span * 0.04);
    this.persp.position.set(cx - span * 0.08, span * 0.72, cz + span * 0.5);
    this.controlsO.target.set(cx, 0, cz);
    this.ortho.position.set(cx, 400, cz);
    this.ortho.zoom = (120 * (this.container.clientWidth / Math.max(1, this.container.clientHeight))) / (span * 1.08);
    this.ortho.updateProjectionMatrix();
  }
  focusSelection() {
    const id = this.state.selection[0];
    const v = id && this.views.get(id);
    if (!v) return;
    const p = v.root.position;
    this.controls.target.set(p.x, 0, p.z);
    if (this.camera === this.persp) this.persp.position.set(p.x - 8, 10, p.z + 14);
  }

  // =================================================================== simulation
  startSim() {
    if (!this.sim) {
      this.sim = new Simulation(this.project, (id) => this.worldPoints(id));
      for (const v of this.views.values()) if (v.disc) v.disc.visible = true;
      if (!this.sim.nodes.size) this.state.toast('Nothing to simulate yet. Place a Source, some stations and a Sink, then connect them.', 'warn');
      else if (!this.sim.links.size) this.state.toast('Objects are not connected. Use the Connect tool (C) to link them into a flow.', 'warn');
    }
    this.simRunning = true;
    this.store.setState({ sim: { ...this.state.sim, running: true, built: true } });
  }
  pauseSim() {
    this.simRunning = false;
    this.store.setState({ sim: { ...this.state.sim, running: false } });
  }
  resetSim() {
    this.sim = null;
    this.simRunning = false;
    this.itemMesh.count = 0;
    for (const v of this.views.values()) {
      v.root.position.set(v.data.x, 0, v.data.z);
      v.root.rotation.y = (v.data.rot ?? 0) * DEG;
      if (v.disc) v.disc.visible = false;
      v.built.update?.({ state: 'idle', dt: 0.016, simDt: 0, t: 0, blink: false, progress: 0 });
      if (v.built.cargo) v.built.cargo.visible = true;
    }
    this.store.setState({ sim: { ...this.state.sim, running: false, built: false }, simStats: null });
  }

  stepSimVisuals(dt, simDt) {
    const sim = this.sim;
    const blink = Math.floor(this.blinkT * 3) % 2 === 0;
    for (const v of this.views.values()) {
      const n = sim.nodes.get(v.id);
      if (n) {
        const it = n.items[0];
        v.built.update?.({ state: n.state, dt, simDt, t: sim.t, blink, progress: it?.dur ? Math.min(1, it.t / it.dur) : 0 });
        if (v.disc) v.disc.material.color.setHex(STATE_COLOR[n.state] ?? 0x94a3b8);
      }
    }
    for (const veh of sim.vehicles) {
      const v = this.views.get(veh.id);
      if (!v) continue;
      v.root.position.set(veh.x, 0, veh.z);
      v.root.rotation.y = veh.heading;
      if (v.built.cargo) v.built.cargo.visible = !!veh.load;
    }
    for (const op of sim.operators) {
      const v = this.views.get(op.id);
      if (!v) continue;
      v.root.position.set(op.x, 0, op.z);
      v.root.rotation.y = op.heading;
      const st = sim.nodes.get(op.stationId);
      v.built.update?.({ state: op.state === 'atStation' ? st?.state ?? 'idle' : 'idle', walking: op.walking, dt, simDt, t: sim.t });
    }
    sim.layoutItems();
    let i = 0;
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    for (const it of sim.items) {
      if (i >= 800) break;
      m4.makeTranslation(it.pos[0], it.pos[1], it.pos[2]);
      this.itemMesh.setMatrixAt(i, m4);
      this.itemMesh.setColorAt(i, col.set(it.color ?? '#4f8bd6'));
      i++;
    }
    this.itemMesh.count = i;
    this.itemMesh.instanceMatrix.needsUpdate = true;
    if (this.itemMesh.instanceColor) this.itemMesh.instanceColor.needsUpdate = true;
  }

  loop() {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.blinkT += dt;
    let simDt = 0;
    if (this.sim && this.simRunning) {
      simDt = dt * this.state.sim.speed;
      const steps = Math.ceil(simDt / 0.25);
      for (let k = 0; k < steps; k++) this.sim.step(simDt / steps);
      for (const ev of this.sim.events.splice(0)) this.state.toast(ev.text, ev.kind);
    }
    if (this.sim) {
      this.stepSimVisuals(dt, simDt);
      this.statsTimer += dt;
      if (this.statsTimer > 0.3) {
        this.statsTimer = 0;
        this.store.setState({ simStats: this.sim.stats() });
      }
    } else {
      // idle animation so machines look alive while editing
      for (const v of this.views.values()) v.built.update?.({ state: 'idle', dt, simDt: 0, t: this.blinkT, blink: false, progress: 0 });
    }
    // Zone labels are large: hide them when the camera is close enough to read the equipment
    if (this.state.showLabels && this.camera === this.persp) {
      for (const c of this.zonesG.children) if (c.userData.zoneLabel) c.visible = this.persp.position.distanceTo(c.position) > 38;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

function shrink(q, d) {
  const cx = q.reduce((a, p) => a + p[0], 0) / 4;
  const cz = q.reduce((a, p) => a + p[1], 0) / 4;
  return q.map(([x, z]) => {
    const l = Math.hypot(x - cx, z - cz) || 1;
    return [x - ((x - cx) / l) * d, z - ((z - cz) / l) * d];
  });
}
