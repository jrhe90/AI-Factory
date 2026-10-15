// Outdoor routes shared by the moving packs and the straddle carriers that carry them.
// Packs stay oriented along x. Carriers straddle the pack across its width, so they can drive
// along a lot row over other packs in that row, and crab sideways along clear lanes:
//   pad → out through the south door → east along the front lane → down the east lane
//   → west along the row to the slot; and slot → east lane → truck bay.
import { NODES, N, DOOR_X } from '../plant.js';

export const LANE_Z = 33;         // clear lane between the south wall and the first lot row
export const EAST_X = 104;        // clear lane east of the lot columns
export const APPROACH = 0.28;     // share of a carry move spent driving the empty pair to the pickup
export const STANDS = [[118, 40], [118, 50], [118, 60]];   // where idle carrier pairs wait

const [bayX, bayZ] = NODES[N.TRUCK].pos;
export const TRUCK_LOAD = [bayX, bayZ];

// path of a carried pack from (fx, fz) into node n at (tx, tz), or null when it is a plain move
export function carryPath(n, fx, fz, tx, tz) {
  if (n === N.LOT) return [[fx, fz], [DOOR_X, LANE_Z], [EAST_X, LANE_Z], [EAST_X, tz], [tx, tz]];
  if (n === N.TRUCK) return [[fx, fz], [EAST_X, fz], [EAST_X, bayZ], [tx, tz]];
  return null;
}

export function pathLen(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}
export function along(pts, k) {
  const L = pathLen(pts);
  let d = Math.max(0, Math.min(1, k)) * L;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (d <= seg || i === pts.length - 1) {
      const u = seg ? Math.min(1, d / seg) : 1;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u];
    }
    d -= seg;
  }
  return pts[pts.length - 1];
}
// carry progress from the move fraction: the pack waits while the pair drives in
export const carryK = (mf) => Math.max(0, (mf - APPROACH) / (1 - APPROACH));
