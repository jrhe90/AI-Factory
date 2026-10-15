// The site around the plant: grass, boulevard to the north with employee parking, west office,
// parking and substation, the south truck road with a fence and gate, drop trailers on the apron,
// trees and light poles. Employee cars (src/cars.js) fill the lots for the day shift and thin
// out in the evening, following the factory clock.
import * as THREE from 'three';
import { Batch } from './batch.js';
import { materials } from './materials.js';
import { BUILDING } from '../plant.js';
import { createBoxTrailer, createForklift, createScissorLift } from '../../models.js';
import { CarTraffic } from '../../cars.js';
import { instancer } from './instancer.js';

const B = BUILDING;
export const BLVD_Z = -124;
const WEST_X = -202;
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (repeat) t.repeat.set(...repeat);
  return t;
}
const asphalt = (w, d) => new THREE.MeshStandardMaterial({ roughness: 0.95, map: canvasTex(256, 256, (g, W, H) => {
  g.fillStyle = '#44484e'; g.fillRect(0, 0, W, H);
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 14; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  g.putImageData(img, 0, 0);
}, [w / 10, d / 10]) });
function flat(parent, x0, x1, z0, z1, material, y = 0.005) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), material);
  m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); m.receiveShadow = true;
  parent.add(m);
  return m;
}
function road(parent, M, x0, x1, z, width, alongZ = false) {
  if (alongZ) flat(parent, z - width / 2, z + width / 2, x0, x1, asphalt(width, x1 - x0), -0.02);
  else flat(parent, x0, x1, z - width / 2, z + width / 2, asphalt(x1 - x0, width), -0.02);
  const R = new Batch();
  const len = x1 - x0;
  for (let d = 3; d < len; d += 9) alongZ ? R.box(M.lineYellow, 0.16, 0.02, 4, z, -0.008, x0 + d) : R.box(M.lineYellow, 4, 0.02, 0.16, x0 + d, -0.008, z);
  for (const s of [-1, 1]) alongZ ? R.box(M.lineWhite, 0.14, 0.02, len, z + s * (width / 2 - 0.4), -0.008, (x0 + x1) / 2) : R.box(M.lineWhite, len, 0.02, 0.14, (x0 + x1) / 2, -0.008, z + s * (width / 2 - 0.4));
  R.build(parent, { cast: false });
}
// parking lot: stalls along local x in rows at local z; returns the group and stall centres
function parkingLot(M, len, depth, rows) {
  const g = new THREE.Group();
  const lot = new THREE.Mesh(new THREE.PlaneGeometry(len, depth), asphalt(len, depth));
  lot.rotation.x = -Math.PI / 2; lot.position.y = -0.01; lot.receiveShadow = true;
  g.add(lot);
  const stallW = 2.7, stallD = 5.4, perRow = Math.floor((len - 4) / stallW);
  const R = new Batch(), stalls = [];
  rows.forEach(({ z: rz, aisle }) => {
    for (let i = 0; i <= perRow; i++) {
      const x = -len / 2 + 2 + i * stallW;
      R.box(M.lineWhite, 0.12, 0.02, stallD, x, 0.005, rz);
      if (i < perRow) stalls.push({ lx: x + stallW / 2, lz: rz, aisle });
    }
  });
  R.build(g, { cast: false });
  return { group: g, stalls };
}
function fence(S, T, M, x0, z0, x1, z1) {
  const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 3));
  for (let i = 0; i <= n; i++) S.box(M.darkSteel, 0.08, 2.2, 0.08, x0 + (x1 - x0) * i / n, 1.1, z0 + (z1 - z0) * i / n);
  for (const y of [0.25, 2.1]) S.beam(M.darkSteel, [x0, y, z0], [x1, y, z1], 0.05, 0.05);
  T.beam(M.meshGuard, [x0, 1.18, z0], [x1, 1.18, z1], 0.02, 1.85);
}

export function buildSite(stage) {
  const M = materials();
  const scene = stage.scene;
  const root = new THREE.Group(); root.name = 'site'; scene.add(root);
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647, (seed - 1) / 2147483646);
  const S = new Batch(), T = new Batch(), G = new Batch();

  // grass under everything
  flat(root, -700, 700, -500, 500, new THREE.MeshStandardMaterial({ color: '#6f8758', roughness: 1 }), -0.06);
  // roads: boulevard (north), truck road (south, drawn by the building), west and east service roads
  road(root, M, -460, 460, BLVD_Z, 10);
  road(root, M, BLVD_Z, 118, WEST_X, 10, true);
  road(root, M, BLVD_Z, 118, 140, 8, true);
  // drop-trailer apron along the south wall west of the carrier door
  flat(root, B.x0 - 8, 20, B.z1 + 10, B.z1 + 24, asphalt(148, 14), -0.022);
  for (let x = B.x0 + 2; x < 14; x += 4.4) if (rand() < 0.55) {
    const t = createBoxTrailer();
    t.position.set(x, 0, B.z1 + 17);
    root.add(t);
    instancer.adopt(t);
  }

  // employee parking: north along the boulevard, west next to the office
  const north = parkingLot(M, 200, 26, [{ z: -6.8, aisle: 0 }, { z: 6.8, aisle: 0 }]);
  north.group.position.set(-10, 0, -104); root.add(north.group);
  const west = parkingLot(M, 76, 52, [{ z: -19.5, aisle: -13 }, { z: -6.5, aisle: -13 }, { z: 6.5, aisle: 13 }, { z: 19.5, aisle: 13 }]);
  west.group.rotation.y = Math.PI / 2; west.group.position.set(-166, 0, 2); root.add(west.group);

  // office block with glazing bands and an entrance canopy
  const glass = new THREE.MeshStandardMaterial({ color: 0x2a4a63, roughness: 0.08, metalness: 0.7 });
  const ox = -166, oz = -66;
  S.box(M.panel, 14, 10, 30, ox, 5, oz);
  for (const y of [2.6, 6.8]) S.box(glass, 14.05, 1.9, 30.05, ox, y, oz);
  S.box(M.darkSteel, 3.2, 0.25, 9, ox + 8.6, 3.8, oz);
  stage.label('OFFICE', ox, 12.5, oz, 'eq', 420);
  // substation behind a fence
  const sx = -166, sz = 76;
  flat(root, sx - 12, sx + 12, sz - 10, sz + 10, new THREE.MeshStandardMaterial({ color: '#9b9d9a', roughness: 1 }), -0.015);
  for (let i = 0; i < 3; i++) {
    S.box(M.panelGrey, 3.4, 3.4, 2.8, sx - 7 + i * 7, 1.7, sz - 3);
    for (const dx of [-0.8, 0, 0.8]) S.cyl(M.darkSteel, 0.16, 1.5, sx - 7 + i * 7 + dx, 3.4, sz - 3, 8);
    S.box(M.alu, 2.2, 2.6, 1.2, sx - 7 + i * 7, 1.3, sz + 4);
  }
  for (const [a, b] of [[[sx - 12, sz - 10], [sx + 12, sz - 10]], [[sx + 12, sz - 10], [sx + 12, sz + 10]], [[sx + 12, sz + 10], [sx - 12, sz + 10]], [[sx - 12, sz + 10], [sx - 12, sz - 10]]])
    fence(S, T, M, a[0], a[1], b[0], b[1]);
  stage.label('SUBSTATION', sx, 7, sz, 'sub', 300);
  // perimeter fence along the truck road with the gate gap east of the lot
  fence(S, T, M, -40, 107, 34, 107);
  fence(S, T, M, 62, 107, 124, 107);
  // yard vehicles by the carrier stand
  const fork = createForklift(); fork.position.set(126, 0, 70); fork.rotation.y = 0.4; root.add(fork); instancer.adopt(fork);
  const lift = createScissorLift(); lift.position.set(128, 0, 76); root.add(lift); instancer.adopt(lift);

  // trees and light poles
  const treePos = [];
  for (let x = -240; x <= 240; x += 9) {
    treePos.push([x + rand() * 3, BLVD_Z - 9 - rand() * 2, 0.9 + rand() * 0.4]);
    treePos.push([x + rand() * 3, 128 + rand() * 2, 0.9 + rand() * 0.4]);
  }
  for (let z = -110; z <= 110; z += 9) { treePos.push([WEST_X - 10 - rand() * 3, z, 0.9 + rand() * 0.4]); treePos.push([152 + rand() * 3, z, 0.9 + rand() * 0.4]); }
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.25, 2.4, 8), new THREE.MeshStandardMaterial({ color: 0x6b4f35 }), treePos.length);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.9, 1), new THREE.MeshStandardMaterial({ color: 0x5f8f4a, roughness: 0.9, flatShading: true }), treePos.length);
  treePos.forEach(([x, z, s], i) => {
    trunk.setMatrixAt(i, m4.compose(p.set(x, 1.2 * s, z), q.identity(), sc.set(s, s, s)));
    crown.setMatrixAt(i, m4.compose(p.set(x, 3.4 * s, z), q.identity(), sc.set(s, s * 0.9, s)));
  });
  trunk.castShadow = crown.castShadow = true;
  root.add(trunk, crown);
  const poles = [];
  for (let x = -100; x <= 90; x += 25) poles.push([x, -92]);
  for (const z of [36, 60, 84]) poles.push([-22, z], [126, z]);
  for (let z = -30; z <= 30; z += 20) poles.push([-140, z]);
  for (const [x, z] of poles) {
    S.cyl(M.darkSteel, 0.12, 9, x, 0, z, 8);
    S.box(M.panelDark, 1.0, 0.18, 0.5, x + 0.4, 9, z);
    G.box(M.lampWarm, 0.8, 0.04, 0.35, x + 0.4, 8.88, z);
  }
  S.build(root); T.build(root, { cast: false, receive: false }); G.build(root, { cast: false, receive: false });

  // employee cars
  const toWorld = (lot) => { lot.group.updateMatrixWorld(true); const v = new THREE.Vector3(); return (lx, lz) => { v.set(lx, 0, lz).applyMatrix4(lot.group.matrixWorld); return [v.x, v.z]; }; };
  const eastLane = BLVD_Z + 2.4, westLane = BLVD_Z - 2.4;
  const northLot = (entryX) => {
    const mx = -10 + entryX;
    return { toWorld: toWorld(north), stalls: north.stalls.filter(st => Math.sign(st.lx) === Math.sign(entryX)), entryX,
             arrive: [[mx - 110, eastLane], [mx, eastLane], [mx, -117]], depart: [[mx, -117], [mx, westLane], [mx - 110, westLane]], maxMoving: 9 };
  };
  const lots = [northLot(98.5), northLot(-98.5), {
    toWorld: toWorld(west), stalls: west.stalls, entryX: 36.5,
    arrive: [[WEST_X + 2.4, 100], [WEST_X + 2.4, -34.5], [-192, -34.5]],
    depart: [[-192, -34.5], [WEST_X - 2.4, -34.5], [WEST_X - 2.4, 100]], maxMoving: 12,
  }];
  const through = [];
  for (let i = 0; i < 12; i++) { const dir = i % 2 ? 1 : -1; through.push({ x0: -460, x1: 460, z: dir > 0 ? eastLane : westLane, dir, v: 12 + rand() * 6 }); }
  const cars = new CarTraffic(scene, lots, through, rand, 9);
  return { root, cars, update(dt, hour) { cars.update(dt, hour); } };
}
