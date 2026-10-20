// Prismatic battery module & pack line, laid out and running: the module line feeds a module
// buffer, the pack line takes 12 modules per pack, and finished units go to the outbound yard
// where a straddle carrier stacks them. Used by battery-line.html.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { createPerson, posePerson } from '../motors/models.js';
import {
  BATTERY, PACK, createLineSection, createBatteryRack, createStraddleCarrier, createMegapackUnit, loadMegapack, CARRIER,
} from './models.js';

const Y = 0.9; // pallet height
const MODULES_PER_PACK = PACK.rows * PACK.cols;

export const MODULE_LINE = [
  { kind: 'cellload', name: 'Cell loading & OCV/IR', cycle: 28, desc: 'Robot picks cells from trays, scans and OCV/IR tests them, rejects NG cells.' },
  { kind: 'plasma', name: 'Plasma cleaning', cycle: 26, desc: 'Atmospheric plasma cleans the cell faces before bonding.' },
  { kind: 'gluing', name: 'Cell gluing', cycle: 30, desc: 'Portal dispenser lays structural adhesive between the cells.' },
  { kind: 'stacking', name: 'Stacking & compression', cycle: 32, desc: 'Robot stacks cells and end plates; servo clamps compress the stack.' },
  { kind: 'sideweld', name: 'Side plate welding', cycle: 30, desc: 'Fibre laser welds the side plates to the end plates.' },
  { kind: 'ccs', name: 'Busbar / CCS placement', cycle: 29, ops: 2, desc: 'Operators place the cell contact system and busbars.' },
  { kind: 'busweld', name: 'Busbar laser welding', cycle: 31, desc: 'Galvo laser welds busbars to every terminal, with fume extraction.' },
  { kind: 'moduleeol', name: 'Module EOL test', cycle: 24, fail: 0.02, desc: 'Probe head contacts the terminals: OCV, IR, hipot and DCR.' },
];
export const PACK_LINE = [
  { kind: 'housingload', name: 'Housing loading', cycle: 300, desc: 'Gantry hoist lifts an empty housing onto the pack pallet.' },
  { kind: 'paste', name: 'Thermal paste', cycle: 300, desc: 'Gap filler dispensed on the cooling floor.' },
  { kind: 'moduleinsert', name: 'Module install', cycle: 330, ops: 2, needs: MODULES_PER_PACK, desc: `Gantry gripper sets ${MODULES_PER_PACK} modules into the housing.` },
  { kind: 'boltdown', name: 'Module bolting', cycle: 310, desc: 'Nutrunner on a torque-reaction arm bolts the modules down.' },
  { kind: 'wiring', name: 'HV / LV wiring & BMS', cycle: 320, ops: 2, desc: 'HV busbars, LV harness, BDU and BMS fitted from both sides.' },
  { kind: 'lid', name: 'Lid installation', cycle: 290, ops: 2, desc: 'Vacuum lifter places the lid; operators fasten it.' },
  { kind: 'leaktest', name: 'Leak test', cycle: 300, fail: 0.03, desc: 'Clamp portal seals the pack; the tester pressurises and checks decay.' },
  { kind: 'packeol', name: 'Pack EOL test', cycle: 310, desc: 'HV/LV connected through a cable boom: insulation, BMS, charge/discharge.' },
  { kind: 'packunload', name: 'Pack unloading', cycle: 280, desc: 'Gantry lifts finished packs onto outbound skids.' },
];

const MOD_PITCH = 3.7;
const PACK_PITCH = 4.6;
const MOD_Z = 6.5;
const PACK_Z = -4;

export async function startBatteryLine(container, { onTick } = {}) {
  await loadMegapack();
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  labels.domElement.className = 'labels';
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf3f4f6);
  scene.fog = new THREE.Fog(0xf3f4f6, 90, 190);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa3ad, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(25, 45, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 40, bottom: -40, near: 1, far: 140 });
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  // Floor plate like the reference render, with walkway markings
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(124, 46), new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.85 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(-14, 0, 1);
  floor.receiveShadow = true;
  scene.add(floor);
  const stripe = (x0, x1, z, color = 0xf2c230) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, 0.12), new THREE.MeshBasicMaterial({ color }));
    m.rotation.x = -Math.PI / 2;
    m.position.set((x0 + x1) / 2, 0.005, z);
    scene.add(m);
  };
  for (const z of [MOD_Z + 3.1, MOD_Z - 3.1, PACK_Z + 3.6, PACK_Z - 3.6]) stripe(-22, 18.5, z);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.minDistance = 4;
  controls.maxDistance = 150;

  // ---------------------------------------------------------------- stations
  const stations = [];
  function place(def, x, z, rotY, line) {
    const m = BATTERY[def.kind](Y);
    const root = new THREE.Group();
    root.add(m.group);
    root.position.set(x, 0, z);
    root.rotation.y = rotY;
    m.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const ops = [];
    for (let i = 0; i < (def.ops ?? m.ops.length); i++) {
      const spot = m.ops[i];
      if (!spot) continue;
      const p = createPerson({ shirt: 0x2b5f8e, vest: 0x2ec4d6, pants: 0x1f3550 });
      p.group.position.set(spot[0], 0, spot[1]);
      p.group.rotation.y = -spot[2];
      root.add(p.group);
      ops.push(p);
    }
    scene.add(root);
    const el = document.createElement('div');
    el.className = 'tag';
    el.innerHTML = `<i></i>${def.name}`;
    const tag = new CSS2DObject(el);
    tag.position.set(0, 4.1, 0);
    root.add(tag);
    const st = { ...def, line, root, m, ops, el, tag, item: null, t: 0, state: 'idle', progress: 0, busyT: 0, blockedT: 0, idleT: 0, count: 0, phase: Math.random() * 10 };
    stations.push(st);
    return st;
  }
  const modX0 = -(MODULE_LINE.length - 1) * MOD_PITCH / 2 - 2;
  const modSt = MODULE_LINE.map((d, i) => place(d, modX0 + i * MOD_PITCH, MOD_Z, 0, 'module'));
  const packX0 = 16;
  const packSt = PACK_LINE.map((d, i) => place(d, packX0 - i * PACK_PITCH, PACK_Z, Math.PI, 'pack'));
  for (let i = 0; i < modSt.length - 1; i++) {
    const s = createLineSection('module', MOD_PITCH - 3.0);
    s.position.set(modX0 + (i + 0.5) * MOD_PITCH, 0, MOD_Z);
    scene.add(s);
  }
  for (let i = 0; i < packSt.length - 1; i++) {
    const s = createLineSection('pack', PACK_PITCH - 3.8);
    s.position.set(packX0 - (i + 0.5) * PACK_PITCH, 0, PACK_Z);
    scene.add(s);
  }
  // Module buffer racks between the two lines, and cell-tray racks at the head of the module line
  const modEnd = modX0 + (MODULE_LINE.length - 1) * MOD_PITCH;
  const rackA = createBatteryRack('modules', 3, 4);
  rackA.group.position.set(modEnd + 5.2, 0, 1.4);
  rackA.group.rotation.y = Math.PI / 2;
  scene.add(rackA.group);
  const rackC = createBatteryRack('cells', 3, 4);
  rackC.group.position.set(modX0 - 4.6, 0, MOD_Z);
  rackC.group.rotation.y = Math.PI / 2;
  scene.add(rackC.group);
  const outConv = createLineSection('module', 2.4);
  outConv.position.set(modEnd + 2.6, 0, MOD_Z);
  scene.add(outConv);

  // ---------------------------------------------------------------- outbound yard
  // Megapacks stand in rows lengthwise; the carrier drives along a row over the units already parked
  const yard = { rows: [], pad: new THREE.Vector3(packX0 - (PACK_LINE.length - 1) * PACK_PITCH - 6.5, 0, PACK_Z - 3.0) };
  const ROW_Z = [-12, -15.4, -18.8];
  const SLOT_X = [-58, -48, -38, -28];
  const padUnit = createMegapackUnit();
  padUnit.position.copy(yard.pad);
  padUnit.visible = false;
  scene.add(padUnit);
  for (const z of ROW_Z) for (const x of SLOT_X) {
    const u = createMegapackUnit();
    u.position.set(x, 0, z);
    u.visible = Math.random() < 0.5;
    scene.add(u);
    yard.rows.push(u);
  }
  stripe(-63, -23, -10.2, 0xffffff);
  stripe(-63, -23, -20.6, 0xffffff);
  const carrier = createStraddleCarrier();
  carrier.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  carrier.group.position.set(yard.pad.x, 0, yard.pad.z);
  scene.add(carrier.group);
  const ctag = new CSS2DObject(Object.assign(document.createElement('div'), { className: 'tag', innerHTML: '<i></i>Straddle carrier' }));
  ctag.position.set(0, CARRIER.H + 1.2, 0);
  carrier.group.add(ctag);
  carrier.setLoaded(false);
  // Carrier job: drive to pad, lower, grip, lift, drive to a free slot (via the cross aisle), lower, release
  const { travelLift, pickLift, parkedLift } = CARRIER;
  const job = { steps: [], i: 0, t: 0, lift: parkedLift, loaded: false, waiting: true };
  const AISLE_X = -19.5; // cross aisle, clear of the nearest yard slot (east end at -23.6)
  function planJob() {
    let slot = yard.rows.findIndex((u) => !u.visible);
    if (slot < 0) {
      yard.rows.forEach((u) => { u.visible = Math.random() < 0.35; }); // a truck run cleared the yard
      slot = yard.rows.findIndex((u) => !u.visible);
    }
    const target = yard.rows[slot].position;
    const p = carrier.group.position;
    job.steps = [
      { drive: [AISLE_X, p.z] }, { drive: [AISLE_X, yard.pad.z] }, { drive: [yard.pad.x, yard.pad.z] },
      { lift: pickLift }, { grip: true }, { lift: travelLift },
      { drive: [AISLE_X, yard.pad.z] }, { drive: [AISLE_X, target.z] }, { drive: [target.x, target.z] },
      { lift: pickLift }, { release: slot }, { lift: parkedLift },
    ];
    job.i = 0;
    job.waiting = false;
  }
  function stepCarrier(dt) {
    if (job.waiting) {
      if (padUnit.visible) planJob();
      return;
    }
    const s = job.steps[job.i];
    if (!s) { job.waiting = true; return; }
    const g = carrier.group;
    if (s.drive) {
      const dx = s.drive[0] - g.position.x;
      const dz = s.drive[1] - g.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.05) { job.i++; return; }
      // Straddle carriers crab sideways in the aisle, so keep the frame aligned with the rows
      const v = Math.min(d, 3.2 * dt);
      g.position.x += (dx / d) * v;
      g.position.z += (dz / d) * v;
    } else if (s.lift !== undefined) {
      const d = s.lift - job.lift;
      if (Math.abs(d) < 0.01) { job.i++; return; }
      job.lift += Math.sign(d) * Math.min(Math.abs(d), 0.9 * dt);
    } else if (s.grip) {
      padUnit.visible = false;
      carrier.cargo.visible = true;
      job.i++;
    } else if (s.release !== undefined) {
      yard.rows[s.release].visible = true;
      carrier.cargo.visible = false;
      job.i++;
    }
    carrier.setLift(job.lift);
  }
  carrier.cargo.visible = false;
  carrier.setLift(job.lift);

  // ---------------------------------------------------------------- flow simulation
  const sim = { t: 0, speed: 20, running: true, modulesBuilt: 0, packsBuilt: 0, rejects: 0, moduleStock: 30, stockCap: 72, nextId: 1 };
  // Warm start: every station mid-cycle, so the line is full when the page opens
  for (const s of stations) {
    s.item = { id: sim.nextId++, fail: false };
    s.t = Math.random() * s.cycle * 0.8;
  }
  function stepSim(dt) {
    sim.t += dt;
    for (const line of [modSt, packSt]) {
      for (let i = line.length - 1; i >= 0; i--) {
        const s = line[i];
        if (s.item) {
          if (s.t < s.cycle) {
            s.t += dt;
            s.state = 'busy';
          }
          if (s.t >= s.cycle) {
            const next = line[i + 1];
            if (s.item.fail) {
              sim.rejects++;
              s.item = null;
              s.count++;
            } else if (!next) {
              if (s.line === 'module') {
                if (sim.moduleStock < sim.stockCap) {
                  sim.moduleStock++;
                  sim.modulesBuilt++;
                  s.item = null;
                  s.count++;
                }
              } else if (!padUnit.visible) {
                padUnit.visible = true;
                sim.packsBuilt++;
                s.item = null;
                s.count++;
              }
            } else if (!next.item && !(next.needs && sim.moduleStock < next.needs)) {
              if (next.needs) sim.moduleStock -= next.needs;
              next.item = s.item;
              next.item.fail = Math.random() < (next.fail ?? 0);
              next.t = 0;
              s.item = null;
              s.count++;
            }
            if (s.item) s.state = 'blocked';
          }
        }
        if (!s.item) {
          if (i === 0) {
            s.item = { id: sim.nextId++, fail: Math.random() < (s.fail ?? 0) };
            s.t = 0;
            s.state = 'busy';
          } else s.state = 'idle';
        }
        if (s.state === 'busy') s.busyT += dt;
        else if (s.state === 'blocked') s.blockedT += dt;
        else s.idleT += dt;
      }
    }
  }

  const STATUS = { busy: 'working', blocked: 'blocked', idle: 'idle' };
  function stepVisuals(dt, simDt, blink) {
    for (const s of stations) {
      const working = s.state === 'busy';
      const status = STATUS[s.state];
      s.progress = s.item ? Math.min(1, s.t / s.cycle) : 0;
      s.m.update({ working, status, p: s.progress, t: sim.t, simDt, dt, y: Y, blink });
      s.m.light.set(status, blink);
      for (const [i, o] of s.ops.entries()) {
        o.phase += simDt * 0.2;
        posePerson(o, working ? 'work' : 'idle', o.phase * 3 + i);
      }
      s.el.dataset.s = s.state;
    }
  }

  // ---------------------------------------------------------------- views
  const VIEWS = {
    overview: { pos: [26, 34, 44], target: [-6, 0, 0] },
    module: { pos: [6, 11, 24], target: [-2, 1, MOD_Z] },
    pack: { pos: [-2, 13, 15], target: [-2, 1, PACK_Z] },
    yard: { pos: [-16, 17, 2], target: [-40, 2, -14] },
  };
  const fly = { from: null, to: null, t: 1 };
  function setView(name, instant = false) {
    const v = VIEWS[name];
    if (!v) return;
    const to = { pos: new THREE.Vector3(...v.pos), target: new THREE.Vector3(...v.target) };
    if (instant) {
      camera.position.copy(to.pos);
      controls.target.copy(to.target);
      fly.t = 1;
      return;
    }
    fly.from = { pos: camera.position.clone(), target: controls.target.clone() };
    fly.to = to;
    fly.t = 0;
  }
  function focusStation(s) {
    const p = s.root.position;
    fly.from = { pos: camera.position.clone(), target: controls.target.clone() };
    fly.to = { pos: new THREE.Vector3(p.x + 5, 6.5, p.z + (s.line === 'module' ? 8 : 9)), target: new THREE.Vector3(p.x, 1.2, p.z) };
    fly.t = 0;
  }
  setView('module', true);

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    labels.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  const clock = new THREE.Clock();
  let blinkT = 0;
  let uiT = 0;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.05, clock.getDelta());
    const simDt = sim.running ? dt * sim.speed : 0;
    if (simDt > 0) {
      // Sub-step so long cycles at high speed don't skip state changes
      const n = Math.ceil(simDt / 2);
      for (let i = 0; i < n; i++) stepSim(simDt / n);
      stepCarrier(dt * Math.min(sim.speed, 8) / 2);
    }
    blinkT += dt;
    stepVisuals(dt, simDt, Math.floor(blinkT * 3) % 2 === 0);
    if (fly.t < 1) {
      fly.t = reduced ? 1 : Math.min(1, fly.t + dt / 1.2);
      const k = fly.t * fly.t * (3 - 2 * fly.t);
      camera.position.lerpVectors(fly.from.pos, fly.to.pos, k);
      controls.target.lerpVectors(fly.from.target, fly.to.target, k);
    }
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
    uiT += dt;
    if (onTick && uiT > 0.25) {
      uiT = 0;
      onTick(api);
    }
  });

  const api = {
    sim, stations, modSt, packSt,
    setSpeed(v) { sim.speed = v; },
    togglePlay() { sim.running = !sim.running; return sim.running; },
    setView, focusStation,
    setLabels(on) { labels.domElement.hidden = !on; },
  };
  return api;
}
