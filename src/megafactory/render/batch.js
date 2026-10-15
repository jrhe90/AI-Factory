// Static geometry batching: everything added to a Batch is merged into one mesh per material,
// so the whole plant draws in a few dozen calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3();

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const cylCache = new Map();
function unitCyl(seg) {
  if (!cylCache.has(seg)) cylCache.set(seg, new THREE.CylinderGeometry(1, 1, 1, seg, 1));
  return cylCache.get(seg);
}

function prepare(geo) {
  // merged geometries must agree on attributes and indexing
  let g = geo;
  if (!g.index) {
    const n = g.attributes.position.count;
    g = g.clone();
    g.setIndex([...Array(n).keys()]);
  }
  if (!g.attributes.uv) {
    g = g === geo ? g.clone() : g;
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) { g = g === geo ? g.clone() : g; g.deleteAttribute(k); }
  return g;
}

export class Batch {
  constructor() { this.parts = new Map(); }

  // add a geometry with a transform: { x, y, z, rx, ry, rz, sx, sy, sz } or a Matrix4
  add(material, geometry, t = {}) {
    let m;
    if (t.isMatrix4) m = t;
    else {
      _e.set(t.rx || 0, t.ry || 0, t.rz || 0);
      _q.setFromEuler(_e);
      m = _m.compose(_p.set(t.x || 0, t.y || 0, t.z || 0), _q, _s.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1));
    }
    const g = prepare(geometry).clone().applyMatrix4(m);
    if (!this.parts.has(material)) this.parts.set(material, []);
    this.parts.get(material).push(g);
    return this;
  }

  // axis-aligned box centred at (x, y, z), optionally turned by ry
  box(material, w, h, d, x, y, z, ry = 0) {
    return this.add(material, unitBox, { x, y, z, ry, sx: w, sy: h, sz: d });
  }

  // rectangular beam from point a to point b (w across, h up)
  beam(material, a, b, w, h) {
    _a.set(...a); _b.set(...b);
    const len = _a.distanceTo(_b);
    if (len < 1e-6) return this;
    _dir.subVectors(_b, _a).normalize();
    const up = Math.abs(_dir.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : _up;
    const mtx = new THREE.Matrix4().lookAt(_a, _b, up);
    _q.setFromRotationMatrix(mtx);
    _p.addVectors(_a, _b).multiplyScalar(0.5);
    return this.add(material, unitBox, new THREE.Matrix4().compose(_p, _q, _s.set(w, h, len)));
  }

  // round rod of radius r from a to b
  rod(material, a, b, r, seg = 10) {
    _a.set(...a); _b.set(...b);
    const len = _a.distanceTo(_b);
    if (len < 1e-6) return this;
    _dir.subVectors(_b, _a).normalize();
    _q.setFromUnitVectors(_up, _dir);
    _p.addVectors(_a, _b).multiplyScalar(0.5);
    return this.add(material, unitCyl(seg), new THREE.Matrix4().compose(_p, _q, _s.set(r, len, r)));
  }

  // vertical cylinder standing on y
  cyl(material, r, h, x, y, z, seg = 16) {
    return this.add(material, unitCyl(seg), { x, y: y + h / 2, z, sx: r, sy: h, sz: r });
  }

  // polyline of beams through 3D points
  polyline(material, pts, w, h) {
    for (let i = 1; i < pts.length; i++) this.beam(material, pts[i - 1], pts[i], w, h);
    return this;
  }

  build(parent, { cast = true, receive = true, name = '' } = {}) {
    const meshes = [];
    for (const [material, geos] of this.parts) {
      if (!geos.length) continue;
      const merged = mergeGeometries(geos, false);
      geos.forEach(g => g.dispose());
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = cast && !material.transparent;
      mesh.receiveShadow = receive;
      mesh.matrixAutoUpdate = false;
      mesh.name = name;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.parts.clear();
    return meshes;
  }
}
