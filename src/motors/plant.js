// Building, rooms, floor markings, zone labels, plan-legend footprints and the site around it.
// The layout follows the reference floor plan: three bands (north rooms and machining lines,
// a middle band with Secondary Processes and Assembly, a south band with receiving, finished
// goods staging, welfare rooms and Warehouse 2 & Rewinding).
import * as THREE from 'three';
import { makeFloorTexture, makePanelTexture } from '../models.js';
import {
  C, mat, glow, box, cyl, sphere, add, createRack, createShelf, createPallet, createCarton, createCar, createTruck,
  zoneLabelTexture, roomLabelTexture, workbench, mergeStatic, xcyl, glassMat,
} from './models.js';

export const B = { x0: -80, x1: 80, z0: -42, z1: 43 }; // building interior
export const AISLE = { main: 7, north: -21 };
export const NORTH_WALL_Z = -22.5;
export const SOUTH_WALL_Z = 9.5;
export const DOCKS = [-48.25, -37.25, -26.25]; // south wall dock doors (outbound)
export const ENTRANCE_X = -10.5;

export const ZONES = {
  secondary: { x0: -54, x1: -24, z0: -19.5, z1: 4.5 },
  transformer: { x0: -80, x1: -55, z0: -19.5, z1: 4.5 },
  assembly: { x0: -21, x1: 76, z0: -19.5, z1: 4.5 },
  warehouse2: { x0: 24, x1: 60, z0: 9.5, z1: 43 },
  staging: { x0: -55, x1: -8, z0: 9.5, z1: 43 },
  fgRacks: { x0: 60, x1: 80, z0: 9.5, z1: 43 },
};

const LEGEND_COLORS = { rack: 0x22a855, work: 0x2f7fe0, raw: 0xf07a1a, fg: 0xffd21f, fire: 0xef2b2b };

export function buildPlant(scene) {
  const deco = new THREE.Group(); // static decor, merged at the end
  const labels = new THREE.Group();
  const legend = new THREE.Group();
  const roof = new THREE.Group();
  const people = []; // fixed-position people (office, sub-assembly...)
  scene.add(labels, legend, roof);
  legend.visible = false;

  const footprint = (cat, x, z, w, d, rot = 0) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ color: LEGEND_COLORS[cat], transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rot;
    m.position.set(x, 0.06, z);
    m.renderOrder = 2;
    legend.add(m);
  };

  const label = (text, x, y, z, { zone = false, sub = null, w = 7, color } = {}) => {
    const tex = zone ? zoneLabelTexture(text, sub) : roomLabelTexture(text, color);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, toneMapped: false }));
    const aspect = tex.image.height / tex.image.width;
    s.scale.set(w, w * aspect, 1);
    s.position.set(x, y, z);
    s.renderOrder = 5;
    s.userData.zone = zone;
    labels.add(s);
    return s;
  };

  // ---------------------------------------------------------------- ground & site
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), mat(0x7d8c66, { roughness: 1 }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.05;
  grass.receiveShadow = true;
  scene.add(grass);
  const asphalt = mat(0x3d4146, { roughness: 0.95 });
  const concrete = mat(0xb7bcc2, { roughness: 0.9 });
  const slab = (x0, x1, z0, z1, m, y = -0.03) => {
    const p = box(x1 - x0, 0.04, z1 - z0, m, false);
    p.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    p.receiveShadow = true;
    deco.add(p);
  };
  slab(B.x0 - 6, B.x1 + 6, B.z0 - 6, B.z1 + 6, concrete, -0.035);
  slab(-84, 10, B.z1 + 6, 82, asphalt); // truck court
  slab(-420, 420, 82, 94, asphalt); // road
  slab(-130, -86, 12, 48, asphalt); // receiving apron
  slab(-140, -130, 12, 94, asphalt); // receiving drive
  slab(-70, 70, -82, -48, asphalt); // employee parking
  slab(-4, 4, -100, -82, asphalt);
  slab(-420, 420, -112, -100, asphalt); // north road
  slab(-14, -7, B.z1 + 6, 82, concrete, -0.025); // entrance walk
  // Road and stall markings
  const white = mat(0xf2f2f2, { roughness: 0.8 });
  const yel = mat(C.yellow, { roughness: 0.7 });
  for (let x = -410; x < 410; x += 8) add(deco, box(4, 0.02, 0.2, white, false), x, 0.0, 88);
  for (let x = -410; x < 410; x += 8) add(deco, box(4, 0.02, 0.2, white, false), x, 0.0, -106);
  for (const z of [-80, -62, -50]) for (let x = -68; x <= 68; x += 2.8) add(deco, box(0.12, 0.02, 5.2, white, false), x, 0.0, z + (z === -50 ? -2.6 : z === -80 ? 2.6 : 0));
  for (const x of DOCKS) {
    add(deco, box(0.25, 0.02, 20, yel, false), x - 2, 0.0, B.z1 + 16);
    add(deco, box(0.25, 0.02, 20, yel, false), x + 2, 0.0, B.z1 + 16);
  }
  // Parked cars (employees)
  const carCols = [0xf2f2f2, 0x111214, 0x7e8389, 0xb4b7bb, 0x1d3a78, 0xa3161d, 0x3f4247, 0xe8e2d0];
  for (const [z, rot] of [[-77.4, Math.PI / 2], [-64.6, -Math.PI / 2], [-59.4, Math.PI / 2], [-52.6, -Math.PI / 2]]) {
    for (let x = -66.6; x <= 66.6; x += 2.8) {
      if (Math.random() < 0.28) continue;
      const car = createCar(carCols[Math.floor(Math.random() * carCols.length)]);
      car.position.set(x, 0, z);
      car.rotation.y = rot;
      car.scale.setScalar(0.95);
      deco.add(car);
    }
  }
  // Trees
  const trunk = mat(0x5a4636, { roughness: 1 });
  const leaf = [mat(0x4f6b3a, { roughness: 1 }), mat(0x5d7a43, { roughness: 1 }), mat(0x3f5a33, { roughness: 1 })];
  const tree = (x, z, s = 1) => {
    add(deco, cyl(0.18 * s, 0.25 * s, 2.2 * s, 6, trunk), x, 1.1 * s, z);
    const crown = sphere(1.8 * s, leaf[Math.floor(Math.random() * 3)]);
    crown.position.set(x, 3.4 * s, z);
    crown.scale.set(1, 1.15, 1);
    deco.add(crown);
  };
  for (let x = -200; x <= 200; x += 11) {
    if (x > -150 && x < 20) continue;
    tree(x + Math.random() * 3, 98 + Math.random() * 2, 0.9 + Math.random() * 0.4);
  }
  for (let x = -190; x <= 190; x += 12) tree(x + Math.random() * 3, -116 - Math.random() * 3, 0.9 + Math.random() * 0.4);
  for (let z = -90; z <= 70; z += 10) {
    tree(-160 + Math.random() * 4, z, 1 + Math.random() * 0.3);
    tree(115 + Math.random() * 4, z, 1 + Math.random() * 0.3);
  }
  for (let x = -66; x <= 66; x += 12) tree(x, -45.5, 0.7);
  // Monument sign at the entrance road
  const signTex = new THREE.CanvasTexture((() => {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 320;
    const g = c.getContext('2d');
    g.fillStyle = '#f4f5f6';
    g.fillRect(0, 0, 1024, 320);
    g.fillStyle = '#ff000f';
    g.font = '900 190px Inter, Arial';
    g.textBaseline = 'middle';
    g.fillText('ABB', 50, 165);
    g.fillStyle = '#1b1d21';
    g.font = '700 64px Inter, Arial';
    g.fillText('Baldor-Reliance', 470, 120);
    g.font = '500 44px Inter, Arial';
    g.fillText('Motors · Fort Smith, AR', 470, 205);
    return c;
  })());
  signTex.colorSpace = THREE.SRGBColorSpace;
  const mono = new THREE.Group();
  add(mono, box(9, 2.8, 0.6, mat(0x2b2f35)), 0, 1.4, 0);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(8.6, 2.7), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.5 }));
  face.position.set(0, 1.45, 0.31);
  face.userData.keep = true;
  mono.add(face);
  mono.position.set(-20, 0, 80);
  scene.add(mono);

  // Outbound truck parked at the west receiving dock
  const rt = createTruck();
  rt.rotation.y = 0;
  rt.position.set(-87.5, 0, 30);
  deco.add(rt);

  // ---------------------------------------------------------------- floor
  const floorTex = makeFloorTexture();
  floorTex.repeat.set(26, 14);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(B.x1 - B.x0, B.z1 - B.z0), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.38, metalness: 0.06 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((B.x0 + B.x1) / 2, 0.001, (B.z0 + B.z1) / 2);
  floor.receiveShadow = true;
  scene.add(floor);

  const paint = (x0, x1, z0, z1, m, y = 0.012) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(x1 - x0), Math.abs(z1 - z0)), m);
    p.rotation.x = -Math.PI / 2;
    p.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    p.receiveShadow = true;
    scene.add(p);
    return p;
  };
  const tint = (z, color, op) => new THREE.MeshStandardMaterial({ color, transparent: true, opacity: op, roughness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  paint(ZONES.secondary.x0, ZONES.secondary.x1, ZONES.secondary.z0, ZONES.secondary.z1, tint(0, 0xf6c58a, 0.32));
  paint(ZONES.warehouse2.x0, ZONES.warehouse2.x1, ZONES.warehouse2.z0, ZONES.warehouse2.z1, tint(0, 0x9fd3f0, 0.35));
  paint(ZONES.assembly.x0, ZONES.assembly.x1, ZONES.assembly.z0, ZONES.assembly.z1, tint(0, 0xc9dcf2, 0.18));
  // Aisles: yellow edge lines, green pedestrian walkway
  const yLine = mat(C.yellow, { roughness: 0.6 });
  const stripe = (x0, x1, z0, z1, m = yLine) => {
    const s = box(Math.max(0.12, x1 - x0), 0.02, Math.max(0.12, z1 - z0), m, false);
    s.position.set((x0 + x1) / 2, 0.012, (z0 + z1) / 2);
    s.receiveShadow = true;
    deco.add(s);
  };
  stripe(B.x0, B.x1, 4.4, 4.55);
  stripe(B.x0, B.x1, 9.25, 9.4);
  stripe(B.x0, B.x1, -22.25, -22.1);
  stripe(B.x0, B.x1, -19.8, -19.65);
  const walk = mat(0x2e9e5b, { roughness: 0.7 });
  for (let x = B.x0 + 1; x < B.x1 - 1; x += 3) stripe(x, x + 1.8, 8.75, 9.2, walk);
  // Dashed zone boundaries
  const dashed = (z, x0, x1, z0, z1, color) => {
    const m = mat(color, { roughness: 0.5 });
    const dash = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.floor(len / 1.6);
      for (let i = 0; i < n; i++) {
        const t0 = (i * 1.6) / len;
        const t1 = Math.min(1, (i * 1.6 + 1.0) / len);
        stripe(Math.min(ax + (bx - ax) * t0, ax + (bx - ax) * t1) - (bx === ax ? 0.08 : 0), Math.max(ax + (bx - ax) * t0, ax + (bx - ax) * t1) + (bx === ax ? 0.08 : 0),
          Math.min(az + (bz - az) * t0, az + (bz - az) * t1) - (bz === az ? 0.08 : 0), Math.max(az + (bz - az) * t0, az + (bz - az) * t1) + (bz === az ? 0.08 : 0), m);
      }
    };
    dash(x0, z0, x1, z0);
    dash(x1, z0, x1, z1);
    dash(x1, z1, x0, z1);
    dash(x0, z1, x0, z0);
  };
  dashed(0, ZONES.secondary.x0, ZONES.secondary.x1, ZONES.secondary.z0, ZONES.secondary.z1, 0xf28c28);
  dashed(0, ZONES.transformer.x0, ZONES.transformer.x1, ZONES.transformer.z0, ZONES.transformer.z1, 0xf28c28);
  dashed(0, ZONES.assembly.x0, ZONES.assembly.x1, ZONES.assembly.z0, ZONES.assembly.z1, 0x3b8fe8);
  // Staging lanes
  for (let x = -53.75; x <= -9.5; x += 5.5) stripe(x - 0.06, x + 0.06, 11, 40);
  // Hatched no-go areas in front of electrical gear
  const hatch = mat(0xd31c1c, { roughness: 0.7 });
  for (let i = 0; i < 6; i++) stripe(-77 + i * 2, -76.2 + i * 2, -6.5, -5.8, i % 2 ? yLine : hatch);

  // ---------------------------------------------------------------- walls
  const panelTex = makePanelTexture();
  const extH = 4.6;
  const intH = 3.0;
  const wallMats = new Map();
  const wallMat = (len, h) => {
    const key = `${Math.round(len)}|${h}`;
    if (!wallMats.has(key)) {
      const t = panelTex.clone();
      t.needsUpdate = true;
      t.repeat.set(len / 4, 1);
      wallMats.set(key, new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 }));
    }
    return wallMats.get(key);
  };
  const partMat = mat(0xe4e7ea, { roughness: 0.75 });
  const capMat = mat(C.abb, { roughness: 0.5 });
  // segment with gaps: gaps = [[a,b],...] along the wall's own axis
  const wallLine = (ax, az, bx, bz, h, gaps = [], ext = false) => {
    const horiz = az === bz;
    const a = horiz ? Math.min(ax, bx) : Math.min(az, bz);
    const b = horiz ? Math.max(ax, bx) : Math.max(az, bz);
    const pieces = [];
    let cur = a;
    for (const [g0, g1] of gaps.slice().sort((p, q) => p[0] - q[0])) {
      if (g0 > cur) pieces.push([cur, g0]);
      cur = Math.max(cur, g1);
    }
    if (cur < b) pieces.push([cur, b]);
    const t = ext ? 0.3 : 0.15;
    for (const [p0, p1] of pieces) {
      const len = p1 - p0;
      const w = box(horiz ? len : t, h, horiz ? t : len, ext ? wallMat(len, h) : partMat);
      w.position.set(horiz ? (p0 + p1) / 2 : ax, h / 2, horiz ? az : (p0 + p1) / 2);
      deco.add(w);
      if (ext) {
        const cap = box(horiz ? len : t + 0.04, 0.35, horiz ? t + 0.04 : len, capMat, false);
        cap.position.set(w.position.x, h - 0.4, w.position.z);
        deco.add(cap);
      }
    }
    // lintels over exterior doors
    if (ext) for (const [g0, g1] of gaps) {
      const len = g1 - g0;
      const l = box(horiz ? len : t, h - 4.0, horiz ? t : len, wallMat(len, h));
      l.position.set(horiz ? (g0 + g1) / 2 : ax, 4.0 + (h - 4.0) / 2, horiz ? az : (g0 + g1) / 2);
      if (len < 3.5) {
        l.scale.y = (h - 2.6) / (h - 4.0);
        l.position.y = 2.6 + (h - 2.6) / 2;
      }
      deco.add(l);
    }
  };
  // Exterior
  wallLine(B.x0, B.z0, B.x1, B.z0, extH, [], true);
  wallLine(B.x0, B.z1, B.x1, B.z1, extH, [...DOCKS.map((x) => [x - 1.8, x + 1.8]), [ENTRANCE_X - 1.5, ENTRANCE_X + 1.5], [70, 72]], true);
  wallLine(B.x0, B.z0, B.x0, B.z1, extH, [[28, 32]], true);
  wallLine(B.x1, B.z0, B.x1, B.z1, extH, [[-2, 2]], true);
  // North band
  wallLine(B.x0, NORTH_WALL_Z, B.x1, NORTH_WALL_Z, intH, [[-75, -73], [-62, -58], [-49, -47], [-37, -31], [-24.5, -20], [-2, 2], [16.5, 21.5], [34, 38], [48, 52], [58, 74]]);
  for (const x of [-68.5, -52, -43.5, -24.5, -20, 22.5, 26.5, 46.7, 53.7]) wallLine(x, B.z0, x, NORTH_WALL_Z, intH);
  // South band
  wallLine(B.x0, SOUTH_WALL_Z, B.x1, SOUTH_WALL_Z, intH, [[-76, -72], [-68, -55], [-55, -8], [-1.6, -0.4], [15.4, 16.6], [24, 38], [42, 62], [62, 78]]);
  wallLine(-8, SOUTH_WALL_Z, -8, B.z1, intH, [[25.2, 26.8]]);
  wallLine(24, SOUTH_WALL_Z, 24, B.z1, intH);
  wallLine(60, SOUTH_WALL_Z, 60, B.z1, intH, [[30, 34]]);
  wallLine(24, 38, 24, 42, intH);
  wallLine(-8, 25, 24, 25, intH, [[-1.6, -0.4], [15.4, 16.6]]);
  wallLine(-8, 27, 24, 27, intH, [[-0.6, 0.6], [16.4, 17.6]]);
  wallLine(7.5, SOUTH_WALL_Z, 7.5, 25, intH);
  wallLine(10, 27, 10, B.z1, intH);
  wallLine(-8, 17.5, 7.5, 17.5, intH);
  // Tool crib cage (mesh)
  const cageMat = new THREE.MeshStandardMaterial({ color: 0x6b7178, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
  const cage = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 2.6), cageMat);
    m.position.set((x0 + x1) / 2, 1.3, (z0 + z1) / 2);
    m.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    scene.add(m);
    for (let i = 0; i <= Math.round(len / 2); i++) {
      const t = i / Math.round(len / 2);
      add(deco, box(0.07, 2.7, 0.07, mat(0x4b5158)), x0 + (x1 - x0) * t, 1.35, z0 + (z1 - z0) * t);
    }
  };
  cage(-68.4, 23, -61, 23);
  cage(-59, 23, -55, 23);
  cage(-55, 23, -55, 42.8);

  // Columns on the structural grid, with grid labels
  const colMat = mat(0x8796a8, { roughness: 0.5, metalness: 0.3 });
  const colPos = [];
  for (let x = -64; x <= 64; x += 16) colPos.push([x, NORTH_WALL_Z], [x, SOUTH_WALL_Z]);
  for (const x of [-40, -10.75, 10.25, 31.25, 52.25]) colPos.push([x, -8.2]);
  for (const [x, z] of colPos) {
    add(deco, box(0.32, 5.2, 0.32, colMat), x, 2.6, z); // cut away at 5 m like the walls
    add(deco, box(0.5, 1.2, 0.5, mat(C.yellow, { roughness: 0.6 })), x, 0.6, z); // guard
  }

  // Roof structure (hidden when the camera is high, so the floor reads like the plan)
  const joistMat = mat(0x6b7178, { metalness: 0.5, roughness: 0.5 });
  for (let x = B.x0 + 4; x < B.x1; x += 8) add(roof, box(0.15, 0.6, B.z1 - B.z0, joistMat, false), x, 9.8, (B.z0 + B.z1) / 2);
  const lampGeo = new THREE.BoxGeometry(0.6, 0.1, 0.6);
  const lampPts = [];
  for (let x = B.x0 + 6; x < B.x1; x += 8) for (let z = B.z0 + 5; z < B.z1; z += 7) lampPts.push([x, z]);
  const lamps = new THREE.InstancedMesh(lampGeo, glow(0xffffff), lampPts.length);
  const m4 = new THREE.Matrix4();
  lampPts.forEach(([x, z], i) => lamps.setMatrixAt(i, m4.makeTranslation(x, 9.3, z)));
  roof.add(lamps);
  // ABB lettering on the exterior north wall
  const abbTex = roomLabelTexture('ABB', '#ff000f', '#f4f5f6');
  const abbSign = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.5), new THREE.MeshBasicMaterial({ map: abbTex, toneMapped: false }));
  abbSign.position.set(0, 2.3, B.z0 - 0.17);
  abbSign.rotation.y = Math.PI;
  scene.add(abbSign);
  const abbSign2 = abbSign.clone();
  abbSign2.position.set(-30, 2.3, B.z1 + 0.17);
  abbSign2.rotation.y = 0;
  scene.add(abbSign2);
  // Entrance canopy
  add(deco, box(6, 0.25, 4, mat(0xd8dde2)), ENTRANCE_X, 3.4, B.z1 + 2.2);
  for (const x of [-2.6, 2.6]) add(deco, box(0.15, 3.4, 0.15, mat(0x9aa1a9)), ENTRANCE_X + x, 1.7, B.z1 + 4);
  add(deco, box(6.02, 0.08, 4.02, capMat), ENTRANCE_X, 3.25, B.z1 + 2.2);

  // ---------------------------------------------------------------- rooms & decor
  const desk = (x, z, rot = 0) => {
    const d = new THREE.Group();
    add(d, box(1.6, 0.05, 0.8, mat(0xe8e2d6)), 0, 0.74, 0);
    for (const sx of [-0.75, 0.75]) add(d, box(0.05, 0.74, 0.7, mat(0x4b5158)), sx, 0.37, 0);
    add(d, box(0.6, 0.38, 0.03, mat(0x111214)), 0, 1.0, -0.25);
    add(d, box(0.56, 0.32, 0.01, glow(0x2b5f8a), false), 0, 1.0, -0.234);
    add(d, box(0.5, 0.08, 0.5, mat(0x1d1f22)), 0, 0.45, 0.65);
    add(d, box(0.5, 0.5, 0.08, mat(0x1d1f22)), 0, 0.75, 0.88);
    d.position.set(x, 0, z);
    d.rotation.y = rot;
    deco.add(d);
  };
  const seated = (x, z, rot = 0, shirt = 0x3b5b8a) => people.push({ x, z, rot, kind: 'desk', shirt });
  // Office & QC lab
  for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) {
    desk(-77 + k * 3.5, -38 + i * 3.2);
    if ((i + k) % 2 === 0) seated(-77 + k * 3.5, -37.3 + i * 3.2, Math.PI / 2, [0x3b5b8a, 0x6b7280, 0xffffff][i]);
  }
  add(deco, box(3.2, 0.8, 2.2, mat(0x2b2f35)), -72, 0.4, -29.5); // QC CMM
  add(deco, box(2.4, 0.08, 1.8, mat(0x404650, { roughness: 0.2 })), -72, 0.84, -29.5);
  for (const z of [-30.4, -28.6]) add(deco, box(0.12, 1.4, 0.12, mat(0xe6e8ea)), -71, 1.55, z);
  add(deco, box(0.2, 0.2, 2.0, mat(0xe6e8ea)), -71, 2.25, -29.5);
  add(deco, box(1.6, 2.0, 0.6, mat(0xd8dde2)), -78.8, 1.0, -25);
  footprint('work', -72, -29.5, 3.4, 2.4);
  // Maintenance shop
  workbench(deco, -48, -40.5, 3, 0.9);
  workbench(deco, -45.2, -35, 2.2, 0.9, -Math.PI / 2);
  for (let i = 0; i < 3; i++) add(deco, box(0.9, 1.1, 0.6, mat(C.abb, { roughness: 0.45 })), -51.2, 0.55, -38 + i * 1.1);
  const shelfM = createShelf(3, 2.2, 0.6, 0x4b5158);
  shelfM.position.set(-48, 0, -24.2);
  deco.add(shelfM);
  add(deco, box(2.6, 1.0, 0.9, mat(0x5f8a6a)), -47.5, 0.5, -30); // manual lathe
  add(deco, xcyl(0.3, 0.6, mat(0x3a3f45), 16), -48.5, 1.25, -30);
  footprint('work', -47.5, -30, 2.8, 1.1);
  // spare motors on the floor
  // Sub-assembly & kitting
  for (let i = 0; i < 3; i++) {
    workbench(deco, 31 + i * 5, -36, 2.4, 0.9);
    footprint('work', 31 + i * 5, -36, 2.6, 1.1);
    people.push({ x: 31 + i * 5, z: -35.0, rot: Math.PI / 2, kind: 'work', vest: 0xf2e21a });
  }
  for (let i = 0; i < 3; i++) {
    const sh = createShelf(3.2, 2.0, 0.6);
    sh.position.set(30.5 + i * 5, 0, -41.2);
    deco.add(sh);
    footprint('rack', 30.5 + i * 5, -41.2, 3.4, 0.8);
  }
  for (let i = 0; i < 2; i++) {
    workbench(deco, 31 + i * 7, -28, 2.4, 0.9, Math.PI);
    footprint('work', 31 + i * 7, -28, 2.6, 1.1);
    people.push({ x: 31 + i * 7, z: -29.0, rot: -Math.PI / 2, kind: 'work', vest: 0x9be22e });
  }
  for (let i = 0; i < 4; i++) {
    const cart = new THREE.Group();
    add(cart, box(1.2, 0.05, 0.8, mat(0x9aa1a9)), 0, 0.5, 0);
    add(cart, box(1.2, 0.05, 0.8, mat(0x9aa1a9)), 0, 1.0, 0);
    for (let k = 0; k < 3; k++) add(cart, box(0.35, 0.25, 0.3, mat([0x2a5d9f, C.yellow, 0x3b4148][k])), -0.4 + k * 0.4, 0.66, 0);
    cart.position.set(44.5, 0, -40 + i * 2.2);
    deco.add(cart);
  }
  // Raw material: steel coils, magnet wire drums, castings
  for (let i = 0; i < 4; i++) {
    const coil = cyl(0.8, 0.8, 0.6, 24, mat(0xaeb5bd, { metalness: 0.85, roughness: 0.3 }));
    coil.rotation.x = Math.PI / 2;
    coil.position.set(48.8 + (i % 2) * 2.4, 0.8, -39.5 + Math.floor(i / 2) * 2.2);
    deco.add(coil);
  }
  for (let i = 0; i < 6; i++) {
    add(deco, cyl(0.45, 0.45, 0.7, 18, mat(C.copper, { metalness: 0.8, roughness: 0.35 })), 48.6 + (i % 2) * 1.2, 0.35, -33 + Math.floor(i / 2) * 1.2);
  }
  for (let i = 0; i < 3; i++) {
    const p = createPallet();
    p.position.set(51.5, 0, -33 + i * 1.6);
    deco.add(p);
    for (let k = 0; k < 4; k++) add(deco, box(0.5, 0.35, 0.4, mat(C.castIron, { roughness: 0.9 })), 51.25 + (k % 2) * 0.5, 0.32 + Math.floor(k / 2) * 0.36, -33 + i * 1.6);
  }
  footprint('raw', 50.2, -32, 6.4, 18);
  // General warehouse: selective racking full of purchased parts
  for (const z of [-40.6, -35.4, -32.6, -27.4]) {
    const r = createRack(8, 3, { bayW: 2.9 });
    r.group.position.set(55.6, 0, z);
    deco.add(r.group);
    footprint('rack', 55.6 + 8 * 1.45, z, 8 * 2.9, 1.3);
    for (let b = 0; b < 8; b++) for (let l = 0; l < 3; l++) {
      if (Math.random() < 0.15) continue;
      const p = createPallet(1.1, 1.0);
      const pos = r.slotPos(b, l);
      p.position.set(55.6 + pos.x - 0.6, pos.y, z);
      deco.add(p);
      const load = box(1.05, 0.8 + Math.random() * 0.4, 0.95, mat([0xb98d5c, 0x8a9096, 0x2a5d9f, 0xc8763a][Math.floor(Math.random() * 4)], { roughness: 0.85 }));
      load.position.set(p.position.x, pos.y + 0.14 + load.geometry.parameters.height / 2, z);
      deco.add(load);
      const p2 = p.clone();
      p2.position.x += 1.3;
      deco.add(p2);
      const l2 = load.clone();
      l2.position.x += 1.3;
      deco.add(l2);
    }
  }
  // Transformer yard
  const tx = new THREE.Group();
  add(tx, box(3.4, 2.6, 2.2, mat(0x8b9a8f, { roughness: 0.6 })), 0, 1.3, 0);
  for (let i = 0; i < 12; i++) add(tx, box(0.06, 2.0, 0.5, mat(0x7c8a80)), -1.6 + i * 0.29, 1.3, 1.35);
  for (let i = 0; i < 3; i++) {
    add(tx, cyl(0.12, 0.16, 0.9, 10, mat(0x6b4a3a, { roughness: 0.4 })), -0.9 + i * 0.9, 3.05, -0.4);
    add(tx, cyl(0.06, 0.06, 0.3, 8, mat(0x9aa1a9)), -0.9 + i * 0.9, 3.6, -0.4);
  }
  tx.position.set(-74, 0, -13);
  deco.add(tx);
  for (let i = 0; i < 8; i++) {
    add(deco, box(0.9, 2.2, 0.8, mat(0xc9ced4, { roughness: 0.5 })), -71.8 + i * 0.95, 1.1, -8.8);
    add(deco, box(0.15, 0.15, 0.02, glow(i % 3 ? 0x22c55e : 0xf59e0b), false), -71.8 + i * 0.95, 1.8, -8.39);
  }
  for (let i = 0; i < 2; i++) {
    add(deco, box(2.2, 1.6, 1.2, mat(0x2a5d9f)), -76, 0.8, -1 + i * 3);
    add(deco, cyl(0.5, 0.5, 1.4, 16, mat(0x8d949c, { metalness: 0.6 })), -73.2, 0.7, -1 + i * 3);
  }
  add(deco, box(3.5, 2.0, 1.8, mat(0xe6e8ea)), -62, 1.0, -15); // chiller
  for (let i = 0; i < 3; i++) add(deco, cyl(0.45, 0.45, 0.1, 14, mat(0x2b2f35)), -63.1 + i * 1.1, 2.05, -15);
  add(deco, xcyl(0.12, 18, mat(0x2f6fd6, { metalness: 0.5 })), -64, 3.4, -11);
  footprint('work', -74, -13, 3.6, 2.4);
  // Receiving dock
  for (let i = 0; i < 6; i++) {
    const p = createPallet();
    p.position.set(-76 + (i % 2) * 1.6, 0, 14 + Math.floor(i / 2) * 2.0);
    deco.add(p);
    add(deco, box(1.1, 0.9, 0.9, mat([0xb98d5c, 0xaeb5bd][i % 2], { roughness: 0.85 })), p.position.x, 0.58, p.position.z);
  }
  add(deco, box(1.8, 0.4, 3.0, mat(0x5f6873)), -79, 0.2, 30); // dock leveler
  footprint('raw', -75.2, 16, 4, 6.4);
  // Tool crib shelving
  for (let i = 0; i < 4; i++) {
    const sh = createShelf(4, 2.2, 0.6, 0x4b5158, [0x9aa1a9, 0x2a5d9f, C.yellow]);
    sh.rotation.y = Math.PI / 2;
    sh.position.set(-66.8 + i * 2.7, 0, 34);
    deco.add(sh);
    footprint('rack', -66.8 + i * 2.7, 34, 0.8, 4.2);
  }
  add(deco, box(3.0, 1.0, 0.7, mat(0x9aa1a9)), -60, 0.5, 24.2); // service counter
  // Welfare: restrooms, lockers, kitchen, first aid
  for (let i = 0; i < 5; i++) {
    for (const z0 of [11.2, 23.0]) add(deco, box(0.06, 2.0, 1.6, mat(0x9aa1a9)), -6.6 + i * 1.6, 1.0, z0 + (z0 > 20 ? 0 : 0.6));
  }
  for (let i = 0; i < 4; i++) {
    add(deco, box(0.6, 0.85, 0.5, mat(0xf4f5f6)), -6 + i * 1.6, 0.42, 12.2);
    add(deco, box(0.6, 0.85, 0.5, mat(0xf4f5f6)), -6 + i * 1.6, 0.42, 23.8);
  }
  for (let r = 0; r < 3; r++) for (let i = 0; i < 9; i++) add(deco, box(0.5, 1.9, 0.5, mat(i % 2 ? 0x51708f : 0x5d7d9f, { roughness: 0.5, metalness: 0.3 })), 9 + i * 0.55, 0.95, 12 + r * 4.2 + (r === 2 ? 0 : 0));
  for (let r = 0; r < 2; r++) add(deco, box(5, 0.45, 0.4, mat(0x8a6a48)), 11.4, 0.23, 14.1 + r * 4.2);
  for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) {
    const t = new THREE.Group();
    add(t, box(2.0, 0.05, 1.0, mat(0xf2f2f2)), 0, 0.75, 0);
    add(t, cyl(0.06, 0.06, 0.75, 8, mat(0x4b5158)), 0, 0.37, 0);
    for (const s of [-1, 1]) for (const dx of [-0.5, 0.5]) add(t, box(0.42, 0.45, 0.42, mat(C.abb, { roughness: 0.6 })), dx, 0.23, s * 0.8);
    t.position.set(-5 + i * 4.2, 0, 31 + k * 5);
    deco.add(t);
  }
  add(deco, box(0.7, 0.95, 6, mat(0xd8dde2)), -7.4, 0.48, 35); // counter
  add(deco, box(0.8, 1.9, 0.8, mat(0xe6e8ea)), -7.3, 0.95, 40.8); // fridge
  add(deco, box(0.9, 1.9, 0.8, mat(C.abb)), 8.9, 0.95, 41.5); // vending
  add(deco, box(1.0, 0.6, 2.0, mat(0xf4f5f6)), 14, 0.3, 36);
  add(deco, box(1.0, 0.15, 2.0, mat(0x9fd3f0)), 14, 0.65, 36);
  add(deco, box(1.4, 1.8, 0.5, mat(0xf4f5f6)), 19, 0.9, 42.4);
  add(deco, box(0.5, 0.5, 0.02, mat(0xff1a1a)), 19, 1.4, 42.13);
  // Warehouse 2: racking for service motors and spares
  for (const z of [29.5, 36.5]) {
    const r = createRack(10, 3, { bayW: 2.9, upright: 0x2a5d9f });
    r.group.position.set(26.5, 0, z);
    deco.add(r.group);
    footprint('rack', 26.5 + 14.5, z, 29, 1.3);
    for (let b = 0; b < 10; b++) for (let l = 0; l < 3; l++) {
      if (Math.random() < 0.25) continue;
      const pos = r.slotPos(b, l);
      for (const dx of [-0.65, 0.65]) {
        const p = createPallet(1.1, 1.0);
        p.position.set(26.5 + pos.x + dx, pos.y, z);
        deco.add(p);
        if (Math.random() < 0.6) {
          add(deco, box(0.9, 0.6, 0.6, mat([0x3b4148, 0x24486f, 0x5a4636][Math.floor(Math.random() * 3)], { roughness: 0.6 })), p.position.x, pos.y + 0.45, z);
        } else {
          const c = createCarton(Math.random() < 0.5 ? 'A' : 'B');
          c.position.set(p.position.x, pos.y + 0.13, z);
          c.scale.setScalar(0.8);
          deco.add(c);
        }
      }
    }
  }
  // Test bay in Warehouse 2
  for (let i = 0; i < 2; i++) {
    add(deco, box(2.4, 0.12, 1.2, mat(0x2b2f35)), 33 + i * 8, 0.7, 41);
    add(deco, box(1.2, 1.8, 0.6, mat(0xd8dde2)), 33 + i * 8, 0.9, 42.3);
    add(deco, box(0.6, 0.6, 0.6, mat(0x3b4148)), 33 + i * 8, 1.06, 41);
  }

  // Fire extinguishers on walls / columns (red F on the plan)
  const fires = [[-62, -24], [-40, -24], [-17, -24], [25, -24], [55, -24], [-66, 8], [-54, -10], [-22, -3], [74, -10], [-60, 22], [-6, 10], [26, 11], [58, 41], [79, 30], [-79, 0], [5, -41.5]];
  for (const [x, z] of fires) {
    const g = new THREE.Group();
    add(g, cyl(0.1, 0.1, 0.55, 12, mat(0xd01818, { roughness: 0.4 })), 0, 0.6, 0);
    add(g, box(0.06, 0.12, 0.06, mat(0x111111)), 0, 0.93, 0);
    add(g, box(0.35, 0.35, 0.03, mat(0xd01818)), 0, 1.6, 0);
    add(g, box(0.04, 1.8, 0.04, mat(0x9aa1a9)), 0, 0.9, -0.12);
    g.position.set(x, 0, z);
    deco.add(g);
    footprint('fire', x, z, 0.9, 0.9);
  }

  // ---------------------------------------------------------------- labels
  const area = (z) => `${Math.round((z.x1 - z.x0) * (z.z1 - z.z0)).toLocaleString('en-US')} m²`;
  label('SECONDARY\nPROCESSES', -39, 10, -7.5, { zone: true, sub: area(ZONES.secondary), w: 12 });
  label('ASSEMBLY PROCESS', 27, 11, -8.2, { zone: true, sub: area(ZONES.assembly), w: 14 });
  label('WAREHOUSE 2 &\nREWINDING', 42, 10, 26, { zone: true, sub: area(ZONES.warehouse2), w: 12 });
  label('GENERAL\nWAREHOUSE', 67, 9, -32, { zone: true, w: 11 });
  label('FINISHED GOODS\nSTAGING', -31, 9, 26, { zone: true, w: 12 });
  label('EAST LINES 1–3', 0, 9, -31, { zone: true, w: 10 });
  const rooms = [
    ['OFFICE & QC LAB', -74, -32], ['BRACKET MACHINING', -60, -36], ['MAINTENANCE', -47.7, -33], ['PRESS SHOP', -34, -37.5],
    ['EAST LINE 1 · ROTORS', -17.5, -40.5], ['EAST LINE 2 · SHAFTS', 15, -34], ['EAST LINE 3 · FRAMES', -17.5, -28.4],
    ['SUB-ASSEMBLY & KITTING', 36.5, -32], ['RAW MATERIAL', 50.2, -36], ['TRANSFORMER', -73, -16.5],
    ['STATOR WINDING & VPI', -39, -16.5], ['LINE A · NEMA MOTORS', -12, -17.5], ['LINE B · IEC MOTORS', -12, -6.5],
    ['RECEIVING DOCK', -74, 21], ['TOOL CRIB', -62, 38], ["MEN'S RESTROOM", -0.5, 14], ["WOMEN'S RESTROOM", -0.5, 21],
    ['LOCKERS', 16, 18], ['KITCHEN', 1, 38], ['FIRST AID', 17, 31], ['REWIND SERVICE', 42, 13], ['FG RACKING', 70, 22],
    ['MAIN ENTRANCE', ENTRANCE_X, 47], ['SHIPPING DOCKS', -37, 47],
  ];
  for (const [t, x, z] of rooms) label(t, x, 5.2, z, { w: 8.5, color: t === 'FIRST AID' ? '#ff6b6b' : '#e9ecef' });

  // Merge the static decor into a few draw calls
  const merged = mergeStatic(deco);
  scene.add(merged);

  return {
    labels, legend, roof, people, footprint, label,
    update(camera) {
      roof.visible = camera.position.y < 8.5;
      // Fade labels that are too close to the camera (they would cover the view) or too far to read
      for (const s of labels.children) {
        const d = camera.position.distanceTo(s.position);
        const near = s.userData.zone ? 42 : 13;
        const far = s.userData.zone ? 420 : 170;
        const o = Math.min(1, Math.max(0, (d - near) / 12)) * Math.min(1, Math.max(0, (far - d) / 40));
        s.material.opacity = o;
        s.visible = o > 0.02;
      }
    },
  };
}

// Waypoint graph for people walking between areas (aisles, corridors, room doors).
export function buildWalkGraph() {
  const nodes = new Map();
  const key = (x, z) => `${x}|${z}`;
  const node = (x, z) => {
    const k = key(x, z);
    if (!nodes.has(k)) nodes.set(k, { x, z, edges: new Set(), k });
    return nodes.get(k);
  };
  const path = (...pts) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = node(...pts[i]);
      const b = node(...pts[i + 1]);
      a.edges.add(b);
      b.edges.add(a);
    }
    return node(...pts[pts.length - 1]);
  };
  const MZ = 8.9; // pedestrian walkway along the main aisle
  const NZ = -21; // north aisle
  const mainXs = [-77, -58, -56, -21, -10.5, -1, 16, 40, 70, 77];
  const northXs = [-77, -74, -60, -56, -48, -34, -21, 0, 19, 36, 50, 66, 77];
  path(...mainXs.map((x) => [x, MZ]));
  path(...northXs.map((x) => [x, NZ]));
  path([-21, NZ], [-21, -8], [-21, MZ]);
  path([-56, NZ], [-56, MZ]);
  path([77, NZ], [77, MZ]);
  path([-21, -8], [0, -8], [20, -8], [45, -8], [70, -8]);
  const poi = {};
  poi.office = path([-74, NZ], [-74, -24], [-75, -33]);
  poi.maint = path([-48, NZ], [-48, -24], [-48.5, -32.5]);
  poi.press = path([-34, NZ], [-34, -24], [-34.5, -28]);
  poi.bracket = path([-60, NZ], [-60, -27]);
  poi.eastlines = path([0, NZ], [0, -24.2], [0, -28.5]);
  poi.subassy = path([36, NZ], [36, -24], [36, -31.5]);
  poi.warehouse = path([66, NZ], [66, -24], [66, -30]);
  poi.lineA = node(0, -8);
  poi.lineB = node(20, -8);
  poi.lineC = node(45, -8);
  poi.restroom = path([-1, MZ], [-1, 11], [-3, 14]);
  poi.lockers = path([16, MZ], [16, 11], [14, 16]);
  poi.kitchen = path([-10.5, MZ], [-10.5, 26], [0, 26], [0, 28.5], [-1, 33.5]);
  poi.firstaid = path([0, 26], [17, 26], [17, 28.5], [17, 33]);
  poi.entrance = path([-10.5, 26], [-10.5, 41.5]);
  poi.toolcrib = path([-58, MZ], [-58, 22], [-60, 25]);
  poi.wh2 = path([40, MZ], [40, 11], [40, 22.5]);
  poi.fg = path([70, MZ], [70, 11]);
  poi.transformer = path([-58, MZ], [-62, 0]);
  poi.secondary = path([-56, -7], [-46, -7.5]);
  path([-56, NZ], [-56, -7], [-56, MZ]);
  return { nodes, poi };
}

export function routeWalk(graph, from, to) {
  // Dijkstra on a tiny graph
  const dist = new Map([[from, 0]]);
  const prev = new Map();
  const open = new Set([from]);
  while (open.size) {
    let cur = null;
    for (const n of open) if (!cur || dist.get(n) < dist.get(cur)) cur = n;
    open.delete(cur);
    if (cur === to) break;
    for (const nb of cur.edges) {
      const d = dist.get(cur) + Math.hypot(nb.x - cur.x, nb.z - cur.z);
      if (d < (dist.get(nb) ?? Infinity)) {
        dist.set(nb, d);
        prev.set(nb, cur);
        open.add(nb);
      }
    }
  }
  const out = [];
  for (let n = to; n; n = prev.get(n)) out.unshift(n);
  return out[0] === from ? out : [from, to];
}

export function nearestNode(graph, x, z) {
  let best = null;
  let bd = Infinity;
  for (const n of graph.nodes.values()) {
    const d = Math.hypot(n.x - x, n.z - z);
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

export { glassMat };
