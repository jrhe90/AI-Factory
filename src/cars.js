// Low-poly Model 3 / Model Y style cars, drawn with instancing so hundreds of them cost a
// handful of draw calls, plus the drivers that move them in and out of the parking lots.
import * as THREE from 'three';

// Paint options and wheel finishes
const PAINT = [0xf3f3f1, 0xf3f3f1, 0xf3f3f1, 0x0f1012, 0x0f1012, 0x7e8389, 0xb4b7bb, 0x1d3a78, 0xa3161d, 0x3f4247];
const RIMS = [0x2a2c30, 0x2a2c30, 0x9fa4aa];

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const spow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);

// Smooth function of x through key points (Catmull-Rom, sampled)
function profile(points) {
  const pts = new THREE.SplineCurve(points.map(([x, y]) => new THREE.Vector2(x, y))).getPoints(600);
  return (x) => {
    if (x <= pts[0].x) return pts[0].y;
    let lo = 0;
    let hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].x < x) lo = mid;
      else hi = mid;
    }
    const a = pts[lo];
    const b = pts[hi];
    return a.y + ((b.y - a.y) * (x - a.x)) / Math.max(1e-6, b.x - a.x);
  };
}

// Loft rounded (superellipse) cross-sections along x into a smooth closed body
function loft({ x0, x1, bottom, top, halfWidth, tumble, n, sections = 90, ring = 28 }) {
  const pos = [];
  const idx = [];
  const e = 2 / n;
  for (let i = 0; i <= sections; i++) {
    const t = i / sections;
    const x = x0 + (x1 - x0) * (0.6 * t + 0.4 * (0.5 - 0.5 * Math.cos(Math.PI * t)));
    const y0 = bottom(x);
    const y1 = Math.max(top(x), y0 + 0.01);
    const yc = (y0 + y1) / 2;
    const hh = (y1 - y0) / 2;
    const hw = halfWidth(x);
    for (let k = 0; k < ring; k++) {
      const a = (k / ring) * Math.PI * 2;
      const y = yc + hh * spow(Math.sin(a), e);
      let z = hw * spow(Math.cos(a), e);
      z *= 1 - tumble * smooth(yc, y1, y);
      pos.push(x, y, z);
    }
  }
  for (let i = 0; i < sections; i++) {
    for (let k = 0; k < ring; k++) {
      const a = i * ring + k;
      const b = i * ring + ((k + 1) % ring);
      const c = a + ring;
      const d = b + ring;
      idx.push(a, c, b, b, c, d);
    }
  }
  // End caps
  for (const [i, flip] of [[0, true], [sections, false]]) {
    const base = i * ring;
    let cx = 0;
    let cy = 0;
    for (let k = 0; k < ring; k++) {
      cx += pos[(base + k) * 3];
      cy += pos[(base + k) * 3 + 1];
    }
    const centre = pos.length / 3;
    pos.push(cx / ring, cy / ring, 0);
    for (let k = 0; k < ring; k++) {
      const a = base + k;
      const b = base + ((k + 1) % ring);
      if (flip) idx.push(centre, a, b);
      else idx.push(centre, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildShapes(s) {
  const top = profile(s.top);
  const belt = profile(s.belt);
  const half = s.length / 2;
  const halfWidth = (x) => {
    const f = smooth(half - s.noseRound, half, x);
    const r = smooth(half - s.tailRound, half, -x);
    return (s.width / 2) * (1 - s.noseAmt * f * f - s.tailAmt * r * r);
  };
  const bottom = (x) => {
    let y = s.sill;
    if (x > half - 0.2) y += (x - (half - 0.2)) * s.noseLift;
    if (x < -half + 0.2) y += (-half + 0.2 - x) * s.tailLift;
    for (const c of s.wheel.x) {
      const d = Math.abs(x - c);
      if (d < s.archR) y = Math.max(y, s.wheel.y + Math.sqrt(s.archR * s.archR - d * d));
    }
    return y;
  };
  const [g0, g1] = s.glassRange;
  const bodyTop = (x) => (x > g0 && x < g1 ? Math.max(belt(x) + 0.03, bottom(x) + 0.05) : top(x));
  return {
    body: loft({ x0: -half, x1: half, bottom, top: bodyTop, halfWidth, tumble: 0.07, n: 4.2 }),
    glass: loft({
      x0: g0, x1: g1, bottom: (x) => belt(x) - 0.04, top, halfWidth: (x) => halfWidth(x) * 0.91, tumble: 0.27, n: 3.4, sections: 60,
    }),
  };
}

// Model Y (current generation): crossover, rounded nose, full-width light bar, black cladding
function modelY() {
  const s = {
    length: 4.79, width: 1.92, sill: 0.27, noseLift: 0.6, tailLift: 0.7,
    noseRound: 0.75, noseAmt: 0.24, tailRound: 0.5, tailAmt: 0.12,
    wheel: { x: [1.45, -1.45], y: 0.38, r: 0.37, z: 0.83, w: 0.25 }, archR: 0.48,
    top: [[-2.395, 0.62], [-2.37, 1.0], [-2.25, 1.16], [-1.9, 1.34], [-1.3, 1.54], [-0.5, 1.63], [0.1, 1.59],
      [0.55, 1.42], [0.95, 1.14], [1.6, 1.05], [2.05, 0.97], [2.28, 0.85], [2.37, 0.68], [2.395, 0.55]],
    belt: [[-2.24, 1.15], [-1.5, 1.17], [0, 1.14], [0.95, 1.11]],
    glassRange: [-2.24, 0.96],
  };
  const sill = 0.95;
  return {
    ...s, ...buildShapes(s),
    // Thin full-width light bar along the nose, low headlamp units, dark lower intake
    head: [[2.33, 0.8, 0, 0.05, 0.03, 1.28]],
    housing: [[2.35, 0.55, 0.56, 0.05, 0.13, 0.32, 0.25], [2.35, 0.55, -0.56, 0.05, 0.13, 0.32, -0.25]],
    tail: [[-2.37, 0.94, 0, 0.05, 0.045, 1.4], [-2.33, 0.92, 0.72, 0.06, 0.1, 0.24, 0.6], [-2.33, 0.92, -0.72, 0.06, 0.1, 0.24, -0.6]],
    trim: [
      [0, 0.36, sill, 1.95, 0.2, 0.05], [0, 0.36, -sill, 1.95, 0.2, 0.05],
      [2.32, 0.36, 0, 0.12, 0.16, 1.2], [-2.33, 0.38, 0, 0.1, 0.16, 1.4],
    ],
    arches: [[1.45, sill], [1.45, -sill], [-1.45, sill], [-1.45, -sill]],
    mirrors: [[0.82, 1.15, 0.99, 0.22, 0.1, 0.17], [0.82, 1.15, -0.99, 0.22, 0.1, 0.17]],
  };
}

// Model 3 (current generation): low fastback sedan, slim swept headlights, no cladding
function model3() {
  const s = {
    length: 4.72, width: 1.85, sill: 0.2, noseLift: 0.7, tailLift: 0.8,
    noseRound: 0.8, noseAmt: 0.26, tailRound: 0.55, tailAmt: 0.13,
    wheel: { x: [1.43, -1.44], y: 0.34, r: 0.34, z: 0.8, w: 0.24 }, archR: 0.44,
    top: [[-2.36, 0.5], [-2.33, 0.78], [-2.2, 0.93], [-1.95, 0.98], [-1.5, 1.17], [-0.9, 1.38], [-0.4, 1.44],
      [0.1, 1.41], [0.55, 1.22], [1.0, 0.92], [1.6, 0.83], [2.05, 0.74], [2.28, 0.6], [2.36, 0.42]],
    belt: [[-1.98, 0.97], [-1.0, 0.97], [0, 0.95], [1.0, 0.9]],
    glassRange: [-1.96, 1.0],
  };
  return {
    ...s, ...buildShapes(s),
    head: [[2.27, 0.6, 0.55, 0.05, 0.035, 0.5, -0.55], [2.27, 0.6, -0.55, 0.05, 0.035, 0.5, 0.55]],
    housing: [],
    tail: [[-2.31, 0.84, 0.6, 0.06, 0.08, 0.44, 0.5], [-2.31, 0.84, -0.6, 0.06, 0.08, 0.44, -0.5]],
    trim: [[2.32, 0.3, 0, 0.08, 0.07, 0.9]],
    arches: [],
    mirrors: [[0.9, 0.92, 0.97, 0.2, 0.09, 0.15], [0.9, 0.92, -0.97, 0.2, 0.09, 0.15]],
  };
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const MATS = {
  paint: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.55, roughness: 0.25 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x0b1016, metalness: 0.9, roughness: 0.06 }),
  tyre: new THREE.MeshStandardMaterial({ color: 0x141516, roughness: 0.85 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.7, roughness: 0.35 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.7 }),
  housing: new THREE.MeshStandardMaterial({ color: 0x0a0b0d, metalness: 0.7, roughness: 0.15 }),
  head: new THREE.MeshBasicMaterial({ color: 0xf6f8ff, toneMapped: false }),
  tail: new THREE.MeshBasicMaterial({ color: 0xd0121b, toneMapped: false }),
};

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
const v = new THREE.Vector3();
const sv = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const local = ([x, y, z, sx = 1, sy = 1, sz = 1, ry = 0]) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(up, ry), new THREE.Vector3(sx, sy, sz));

// One variant = a set of instanced meshes; each car owns one slot (with several part instances).
class Variant {
  constructor(scene, spec, capacity) {
    const w = spec.wheel;
    const wheelGeo = new THREE.CylinderGeometry(w.r, w.r, w.w, 22).rotateX(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(w.r * 0.72, w.r * 0.72, 0.02, 20).rotateX(Math.PI / 2);
    const wheelLocals = [];
    const rimLocals = [];
    for (const x of w.x) {
      for (const s of [-1, 1]) {
        wheelLocals.push(local([x, w.y, s * w.z]));
        rimLocals.push(local([x, w.y, s * (w.z + w.w / 2 + 0.01)]));
      }
    }
    const parts = [
      { geo: spec.body, mat: MATS.paint, locals: [local([0, 0, 0])], shadow: true, color: 'paint' },
      { geo: spec.glass, mat: MATS.glass, locals: [local([0, 0, 0])], shadow: true },
      // Dark wheel-well liners so you cannot see through the arches
      { geo: unitBox, mat: MATS.trim, locals: w.x.map((x) => local([x, w.y + 0.2, 0, spec.archR * 2 - 0.04, 0.42, spec.width - 0.3])) },
      { geo: wheelGeo, mat: MATS.tyre, locals: wheelLocals },
      { geo: rimGeo, mat: MATS.rim, locals: rimLocals, color: 'rim' },
      { geo: unitBox, mat: MATS.paint, locals: spec.mirrors.map(local), color: 'paint' },
      { geo: unitBox, mat: MATS.head, locals: spec.head.map(local) },
      { geo: unitBox, mat: MATS.tail, locals: spec.tail.map(local) },
      { geo: unitBox, mat: MATS.trim, locals: spec.trim.map(local) },
      { geo: unitBox, mat: MATS.housing, locals: spec.housing.map(local) },
    ];
    if (spec.arches.length) {
      const arch = new THREE.TorusGeometry(spec.archR + 0.01, 0.055, 6, 20, Math.PI);
      parts.push({ geo: arch, mat: MATS.trim, locals: spec.arches.map(([x, z]) => local([x, w.y, z])) });
    }
    this.parts = parts.filter((p) => p.locals.length);
    for (const p of this.parts) {
      p.mesh = new THREE.InstancedMesh(p.geo, p.mat, capacity * p.locals.length);
      p.mesh.castShadow = !!p.shadow;
      p.mesh.receiveShadow = !!p.shadow;
      p.mesh.frustumCulled = false;
      for (let i = 0; i < p.mesh.count; i++) p.mesh.setMatrixAt(i, ZERO);
      scene.add(p.mesh);
    }
    this.used = 0;
  }
  take(paint, rim) {
    const slot = this.used++;
    const c = new THREE.Color();
    for (const p of this.parts) {
      if (!p.color) continue;
      c.setHex(p.color === 'paint' ? paint : rim);
      for (let k = 0; k < p.locals.length; k++) p.mesh.setColorAt(slot * p.locals.length + k, c);
      p.mesh.instanceColor.needsUpdate = true;
    }
    return slot;
  }
  pose(slot, x, z, yaw) {
    q.setFromAxisAngle(up, yaw);
    const base = new THREE.Matrix4().compose(v.set(x, 0, z), q, sv.copy(ONE));
    for (const p of this.parts) {
      const n = p.locals.length;
      for (let k = 0; k < n; k++) p.mesh.setMatrixAt(slot * n + k, m4.multiplyMatrices(base, p.locals[k]));
      p.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  hide(slot) {
    for (const p of this.parts) {
      const n = p.locals.length;
      for (let k = 0; k < n; k++) p.mesh.setMatrixAt(slot * n + k, ZERO);
      p.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

// Polyline with rounded corners in the ground plane
function roundedPath(points, radius) {
  const pts = [];
  for (const [x, z] of points) {
    const p = new THREE.Vector3(x, 0, z);
    if (!pts.length || pts[pts.length - 1].distanceTo(p) > 0.05) pts.push(p);
  }
  const path = new THREE.CurvePath();
  let prev = pts[0];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const inLen = p.distanceTo(pts[i - 1]);
    const outLen = p.distanceTo(pts[i + 1]);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const a = p.clone().addScaledVector(p.clone().sub(pts[i - 1]).normalize(), -r);
    const b = p.clone().addScaledVector(pts[i + 1].clone().sub(p).normalize(), r);
    if (a.distanceTo(prev) > 0.01) path.add(new THREE.LineCurve3(prev, a));
    path.add(new THREE.QuadraticBezierCurve3(a, p.clone(), b));
    prev = b;
  }
  path.add(new THREE.LineCurve3(prev, pts[pts.length - 1]));
  return path;
}

// Share of stalls in use by hour: day shift fills the lots, night shift is lighter
export function occupancyAt(hour) {
  const day = smooth(5.2, 6.4, hour) * (1 - smooth(17.6, 18.8, hour));
  return 0.32 + 0.52 * day;
}

/**
 * Car traffic for a set of parking lots.
 * Each lot: { toWorld(lx, lz) → [x, z], stalls: [{ lx, lz, aisle }], entryX (local x of the
 * driveway end), arrive: [[x, z], ...] world points from spawn to the driveway mouth,
 * depart: [[x, z], ...] from the driveway mouth to despawn, maxMoving }.
 */
export class CarTraffic {
  constructor(scene, lots, through, rand, hour0) {
    const total = lots.reduce((n, l) => n + l.stalls.length, 0) + through.length;
    this.variants = [new Variant(scene, model3(), total), new Variant(scene, modelY(), total)];
    this.lots = lots;
    this.rand = rand;
    for (const lot of lots) {
      lot.cool = rand() * 2;
      lot.agents = lot.stalls.map((stall) => this.makeAgent(stall, lot));
      const occ = occupancyAt(hour0);
      for (const a of lot.agents) if (rand() < occ) this.park(a);
    }
    // Through traffic on the boulevard
    this.through = through.map((t) => ({ ...this.makeAgent(null, null), ...t, x: t.x0 + rand() * (t.x1 - t.x0) }));
  }
  makeAgent(stall, lot) {
    const variant = this.variants[this.rand() < 0.45 ? 0 : 1];
    const paint = PAINT[Math.floor(this.rand() * PAINT.length)];
    const rim = RIMS[Math.floor(this.rand() * RIMS.length)];
    return { stall, lot, variant, slot: variant.take(paint, rim), state: 'away' };
  }
  // Stall geometry in local lot coordinates
  stallPose(a) {
    const { lx, lz, aisle } = a.stall;
    const d = Math.sign(lz - aisle); // nose points away from the aisle
    const e = Math.sign(a.lot.entryX - lx) || 1; // direction from the stall toward the driveway
    return { lx, lz, aisle, d, e };
  }
  park(a) {
    const { lx, lz, d } = this.stallPose(a);
    const [x, z] = a.lot.toWorld(lx, lz);
    const [x2, z2] = a.lot.toWorld(lx, lz + d);
    a.state = 'parked';
    a.variant.pose(a.slot, x, z, Math.atan2(-(z2 - z), x2 - x));
  }
  drive(a, state, pts, reverse, speed) {
    a.state = state;
    a.path = roundedPath(pts, reverse ? 2.6 : 3.2);
    a.L = a.path.getLength();
    a.s = 0;
    a.reverse = reverse;
    a.speed = speed;
  }
  arrive(a) {
    const lot = a.lot;
    const { lx, lz, aisle, d, e } = this.stallPose(a);
    const w = (x, z) => lot.toWorld(x, z);
    this.drive(a, 'arriving', [
      ...lot.arrive,
      w(lot.entryX, aisle), w(lx + 5 * e, aisle), w(lx, aisle + d * 1.6), w(lx, lz + d * 0.1),
    ], false, 11);
  }
  depart(a) {
    const lot = a.lot;
    const { lx, lz, aisle, d, e } = this.stallPose(a);
    const w = (x, z) => lot.toWorld(x, z);
    // Back out, swinging the rear away from the driveway, then drive off
    this.drive(a, 'reversing', [w(lx, lz), w(lx, aisle + d * 0.4), w(lx - 4 * e, aisle)], true, 2.4);
    a.then = () => this.drive(a, 'leaving', [w(lx - 4 * e, aisle), w(lot.entryX, aisle), ...lot.depart], false, 11);
  }
  update(dt, hour) {
    const rand = this.rand;
    for (const lot of this.lots) {
      lot.cool -= dt;
      if (lot.cool > 0) continue;
      lot.cool = 0.2 + rand() * 0.4;
      const moving = lot.agents.filter((a) => a.state === 'arriving' || a.state === 'reversing' || a.state === 'leaving').length;
      if (moving >= lot.maxMoving) continue;
      const present = lot.agents.filter((a) => a.state === 'parked' || a.state === 'arriving').length;
      const target = Math.round(occupancyAt(hour) * lot.agents.length);
      const away = lot.agents.filter((a) => a.state === 'away');
      const parked = lot.agents.filter((a) => a.state === 'parked');
      const pick = (list) => list[Math.floor(rand() * list.length)];
      if (present < target - 2 && away.length) this.arrive(pick(away));
      else if (present > target + 2 && parked.length) this.depart(pick(parked));
      else if (rand() < 0.3) {
        // Visitors, deliveries, people popping out at lunch
        if (rand() < 0.5 && away.length) this.arrive(pick(away));
        else if (parked.length) this.depart(pick(parked));
      }
    }
    for (const lot of this.lots) {
      for (const a of lot.agents) {
        if (a.state !== 'arriving' && a.state !== 'reversing' && a.state !== 'leaving') continue;
        const remaining = a.L - a.s;
        const vmax = a.speed;
        const vel = a.state === 'reversing' ? vmax : Math.min(vmax, Math.max(1.5, remaining * 1.2));
        a.s = Math.min(a.L, a.s + vel * dt);
        const t = a.s / a.L;
        const p = a.path.getPoint(t);
        const tan = a.path.getTangent(Math.min(t, 0.999));
        const yaw = Math.atan2(-tan.z, tan.x) + (a.reverse ? Math.PI : 0);
        a.variant.pose(a.slot, p.x, p.z, yaw);
        if (a.s >= a.L) {
          if (a.state === 'arriving') this.park(a);
          else if (a.state === 'reversing') a.then();
          else {
            a.state = 'away';
            a.variant.hide(a.slot);
          }
        }
      }
    }
    for (const c of this.through) {
      c.x += c.dir * c.v * dt;
      if (c.x > c.x1) c.x = c.x0;
      if (c.x < c.x0) c.x = c.x1;
      c.variant.pose(c.slot, c.x, c.z, c.dir > 0 ? 0 : Math.PI);
    }
  }
}

// For close-up previews: both variants with room for `capacity` cars each
export function createCarVariants(scene, capacity) {
  return { model3: new Variant(scene, model3(), capacity), modelY: new Variant(scene, modelY(), capacity) };
}
