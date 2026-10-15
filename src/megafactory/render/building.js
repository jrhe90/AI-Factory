// Building shell, floor, column grid, roof steel, floor markings and the outdoor court.
// The south wall is kept knee-high and the roof hides when the camera is above it, so the
// overview always looks into the plant.
import * as THREE from 'three';
import { Batch } from './batch.js';
import { materials } from './materials.js';
import { concrete, macroNoise, gridAtlas, floorWord } from './textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BUILDING, ZONES, LOT, DOOR_X } from '../plant.js';

const B = BUILDING;
export const COLS_X = [-104, -80, -56, -32, -8, 16, 40, 64, 88];
export const COLS_Z = [-58, -34, -14];
const GRID_LETTERS = 'ABCDEFGHJKLMN';

function flat(parent, w, d, x, z, material, y = 0.004, ro = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  m.renderOrder = ro;
  parent.add(m);
  return m;
}

export function buildBuilding(stage) {
  const M = materials();
  const root = new THREE.Group();
  root.name = 'building';
  stage.scene.add(root);
  const W = B.x1 - B.x0, D = B.z1 - B.z0, cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2;

  // ---------------- ground and outdoor court
  const court = new THREE.MeshStandardMaterial({ map: concrete([12, 7], 150), roughness: 0.92 });
  flat(root, 150, 82, 50, 26 + 41, court, -0.02);
  const apron = new THREE.MeshStandardMaterial({ map: concrete([16, 1], 140), roughness: 0.95 });
  flat(root, W + 24, 10, cx, B.z1 + 5, apron, -0.025);
  flat(root, 10, D + 24, B.x0 - 5, cz, apron, -0.025);
  flat(root, 10, D + 24, B.x1 + 5, cz, apron, -0.025);
  flat(root, W + 24, 10, cx, B.z0 - 5, apron, -0.025);
  // site road along the south side
  flat(root, 520, 12, 20, 112, new THREE.MeshStandardMaterial({ color: '#222428', roughness: 0.95 }), -0.03);
  const marks = new Batch();
  for (let x = -230; x < 270; x += 9) marks.box(M.lineWhite, 4, 0.02, 0.18, x, -0.015, 112);
  marks.box(M.lineYellow, 520, 0.02, 0.16, 20, -0.015, 106.4);

  // storage lot slots
  for (let c = 0; c < LOT.cols; c++) for (let r = 0; r < LOT.rows; r++) {
    const x = LOT.x0 + c * LOT.dx, z = LOT.z0 + r * LOT.dz;
    for (const s of [-1, 1]) marks.box(M.lineWhite, 0.12, 0.02, 2.6, x + s * 4.9, -0.008, z);
  }
  for (let c = 0; c <= LOT.cols; c++) marks.box(M.lineYellow, 0.18, 0.02, LOT.rows * LOT.dz + 4, LOT.x0 - LOT.dx / 2 + c * LOT.dx, -0.008, LOT.z0 + (LOT.rows - 1) * LOT.dz / 2);
  marks.build(root, { cast: false });

  // ---------------- plant floor
  const floorMat = new THREE.MeshStandardMaterial({ map: concrete([W / 12, D / 12], 172), roughness: 0.46, metalness: 0.02, envMapIntensity: 0.7 });
  flat(root, W, D, cx, cz, floorMat, 0);
  const macro = new THREE.MeshBasicMaterial({ map: macroNoise(), blending: THREE.MultiplyBlending, transparent: true, depthWrite: false, premultipliedAlpha: true });
  macro.map.repeat.set(2, 1);
  flat(root, W, D, cx, cz, macro, 0.002, 1);

  // epoxy zone pads with painted borders and names
  const F = new Batch();
  for (const z of ZONES) {
    const w = z.x1 - z.x0, d = z.z1 - z.z0, x = (z.x0 + z.x1) / 2, zz = (z.z0 + z.z1) / 2;
    const pad = new THREE.MeshStandardMaterial({ color: new THREE.Color(z.color).lerp(new THREE.Color('#d8dde2'), 0.86), roughness: 0.32, metalness: 0.02,
                                                 transparent: true, opacity: 0.55, depthWrite: false });
    flat(root, w, d, x, zz, pad, 0.004, 2);
    const edge = new THREE.MeshStandardMaterial({ color: z.color, roughness: 0.5 });
    F.box(edge, w, 0.02, 0.22, x, 0.012, z.z0); F.box(edge, w, 0.02, 0.22, x, 0.012, z.z1);
    F.box(edge, 0.22, 0.02, d, z.x0, 0.012, zz); F.box(edge, 0.22, 0.02, d, z.x1, 0.012, zz);
    const word = floorWord(z.label, 'rgba(255,255,255,0.88)');
    const h = 2.4, wl = h * word.aspect;
    const m = new THREE.MeshBasicMaterial({ map: word.texture, transparent: true, depthWrite: false, opacity: 0.85 });
    word.texture.repeat.set(word.used, 1);
    const p = flat(root, wl, h, z.x0 + 1.2 + wl / 2, z.z1 - 1.8, m, 0.02, 3);
    p.receiveShadow = false;
    stage.label(z.label, x, 1, zz, 'zone', { far: 900, near: 150 });
  }
  // aisles, walkway, crossings and lane arrows
  for (const z of [-41, -34, -15.5, 1]) F.box(M.lineYellow, W - 6, 0.02, 0.16, cx, 0.012, z);
  F.box(M.walkway, W - 6, 0.02, 2.2, cx, 0.01, -5);
  for (const x of [-60, -12, 30]) for (let k = 0; k < 6; k++) F.box(M.lineWhite, 0.5, 0.025, 3, x + k * 0.9, 0.016, -5);
  const arrow = new THREE.Shape();
  arrow.moveTo(-1.4, -0.16); arrow.lineTo(0.6, -0.16); arrow.lineTo(0.6, -0.5); arrow.lineTo(1.4, 0); arrow.lineTo(0.6, 0.5); arrow.lineTo(0.6, 0.16); arrow.lineTo(-1.4, 0.16);
  const arrowGeo = new THREE.ShapeGeometry(arrow).rotateX(-Math.PI / 2);
  for (let x = -110; x < 100; x += 26) {
    F.add(M.lineWhite, arrowGeo, { x, y: 0.016, z: -38.5 });
    F.add(M.lineWhite, arrowGeo, { x: x + 13, y: 0.016, z: -36.5, ry: Math.PI });
    F.add(M.lineWhite, arrowGeo, { x, y: 0.016, z: -10.5 });
    F.add(M.lineWhite, arrowGeo, { x: x + 13, y: 0.016, z: -12.5, ry: Math.PI });
  }
  F.build(root, { cast: false });

  // ---------------- walls and columns
  const S = new Batch();
  const H = B.h;
  S.box(M.wall, W, H, 0.3, cx, H / 2, B.z0);
  S.box(M.wall, 0.3, H, D, B.x0, H / 2, cz);
  S.box(M.wall, 0.3, H, D, B.x1, H / 2, cz);
  // south wall: knee-high cut-away with the door opening for the straddle carriers
  const southSegs = [[B.x0, DOOR_X - 7], [DOOR_X + 7, B.x1]];
  for (const [a, b] of southSegs) S.box(M.wall, b - a, 1.2, 0.3, (a + b) / 2, 0.6, B.z1);
  // perimeter columns every 12 m and the interior grid
  const gridLabels = [];
  const colAt = (x, z, label) => {
    S.box(M.column, 0.6, H, 0.6, x, H / 2, z);
    S.box(M.column, 1.0, 0.25, 1.0, x, 0.125, z);
    if (label) gridLabels.push({ label, x, z });
  };
  for (let x = B.x0; x <= B.x1 + 0.1; x += 12) { colAt(x, B.z0); colAt(x, B.z1); }
  for (let z = B.z0 + 12; z < B.z1; z += 12) { colAt(B.x0, z); colAt(B.x1, z); }
  COLS_X.forEach((x, i) => COLS_Z.forEach((z, j) => colAt(x, z, GRID_LETTERS[i] + (j * 6 + 7))));
  // column grid labels: one atlas, one mesh
  const ga = gridAtlas(gridLabels.map(g => g.label));
  const plates = [];
  gridLabels.forEach(({ x, z }, i) => {
    const [u0, v0, u1, v1] = ga.uv(i);
    for (const [dx, dz, ry] of [[0, 0.31, 0], [0, -0.31, Math.PI], [0.31, 0, Math.PI / 2], [-0.31, 0, -Math.PI / 2]]) {
      const g = new THREE.PlaneGeometry(0.5, 0.5).rotateY(ry).translate(x + dx, 3.2, z + dz);
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) ? u1 : u0, uv.getY(k) ? v1 : v0);
      plates.push(g);
    }
  });
  root.add(new THREE.Mesh(mergeGeometries(plates), new THREE.MeshBasicMaterial({ map: ga.texture })));
  // clerestory band along the north wall
  S.box(M.polyRoof, W, 1.8, 0.05, cx, H - 2.2, B.z0 + 0.2);
  S.build(root);

  // ---------------- roof steel (only drawn when the camera is inside or below the roof line)
  const roof = new THREE.Group();
  roof.name = 'roof';
  root.add(roof);
  const R = new Batch();
  for (let x = B.x0; x <= B.x1 + 0.1; x += 12) {
    R.beam(M.joist, [x, H, B.z0], [x, H, B.z1], 0.25, 0.9);
    R.beam(M.joist, [x, H - 1.6, B.z0], [x, H - 1.6, B.z1], 0.18, 0.18);
    for (let z = B.z0; z < B.z1; z += 4) R.beam(M.joist, [x, H - 1.6, z], [x, H, z + 4], 0.08, 0.08);
  }
  for (let z = B.z0; z <= B.z1; z += 4) R.beam(M.roofSteel, [B.x0, H + 0.5, z], [B.x1, H + 0.5, z], 0.12, 0.2);
  for (let x = B.x0 + 6; x < B.x1; x += 12) for (let z = B.z0 + 6; z < B.z1; z += 8) R.box(M.ledPanel, 1.4, 0.08, 0.35, x, H - 1.9, z);
  R.build(roof, { cast: false });
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: '#d7dbe0', roughness: 0.9, side: THREE.BackSide }));
  deck.rotation.x = -Math.PI / 2;
  deck.position.set(cx, H + 0.62, cz);
  roof.add(deck);

  return {
    root,
    update(camera) { roof.visible = camera.position.y < H - 0.5 && camera.position.z < B.z1 + 2; },
  };
}
