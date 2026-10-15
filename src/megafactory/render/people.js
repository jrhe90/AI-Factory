// Articulated people built from primitives: powder painters in white coveralls and hoods,
// line workers in hi-vis, inspectors. Each figure faces +z in its local frame; arms hang along
// -y from the shoulder pivots, so rotation.x < 0 raises an arm forwards.
// Figures are plain Object3D skeletons; the shared instancer draws every body part of every
// figure as one InstancedMesh per (shape, material), so a plant full of people costs a few draws.
import * as THREE from 'three';
import { instancer } from './instancer.js';

const geo = {
  thigh: new THREE.BoxGeometry(0.15, 0.46, 0.17).translate(0, -0.23, 0),
  shin: new THREE.BoxGeometry(0.13, 0.44, 0.15).translate(0, -0.22, 0),
  boot: new THREE.BoxGeometry(0.14, 0.09, 0.27).translate(0, -0.045, 0.04),
  pelvis: new THREE.BoxGeometry(0.36, 0.2, 0.22),
  chest: new THREE.BoxGeometry(0.42, 0.56, 0.25).translate(0, 0.28, 0),
  upper: new THREE.BoxGeometry(0.11, 0.32, 0.12).translate(0, -0.16, 0),
  fore: new THREE.BoxGeometry(0.1, 0.3, 0.1).translate(0, -0.15, 0),
  hand: new THREE.BoxGeometry(0.08, 0.1, 0.1).translate(0, -0.05, 0),
  head: new THREE.SphereGeometry(0.115, 14, 10),
  hood: new THREE.SphereGeometry(0.15, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
  cape: new THREE.CylinderGeometry(0.16, 0.24, 0.2, 14, 1, true).translate(0, -0.06, 0),
  visor: new THREE.BoxGeometry(0.2, 0.1, 0.04),
  helmet: new THREE.SphereGeometry(0.135, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  brim: new THREE.CylinderGeometry(0.16, 0.16, 0.015, 16),
  vest: new THREE.BoxGeometry(0.44, 0.4, 0.27).translate(0, 0.32, 0),
  stripe: new THREE.BoxGeometry(0.45, 0.04, 0.28),
  gunBody: new THREE.BoxGeometry(0.06, 0.08, 0.2).translate(0, 0, 0.08),
  gunBarrel: new THREE.CylinderGeometry(0.018, 0.022, 0.32, 8).rotateX(Math.PI / 2).translate(0, 0.02, 0.32),
  gunGrip: new THREE.BoxGeometry(0.04, 0.12, 0.05).translate(0, -0.08, 0),
  hose: new THREE.CylinderGeometry(0.014, 0.014, 0.6, 6).translate(0, -0.3, 0),
  tablet: new THREE.BoxGeometry(0.2, 0.02, 0.26),
};
const M = {};
function mats() {
  if (M.ready) return M;
  const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, ...o });
  Object.assign(M, {
    ready: true,
    coverall: std(0xf1f2f0, { roughness: 0.9 }), glove: std(0x2f5bd3), visor: std(0x1b2430, { roughness: 0.15, metalness: 0.4 }),
    trousers: std(0x2b3440), shirt: std(0x39424e), vest: std(0xff7a1a, { roughness: 0.65 }), stripe: std(0xe8e8e0, { roughness: 0.3, metalness: 0.4 }),
    skin: std(0xc99a78), helmet: std(0xf4f4f2, { roughness: 0.35 }), boot: std(0x1a1c1f), gun: std(0x2a2e33, { metalness: 0.5, roughness: 0.4 }),
    gunTip: std(0xb8bec4, { metalness: 0.8, roughness: 0.3 }), tablet: std(0x101418, { roughness: 0.3 }), polo: std(0x1f4e8c),
  });
  return M;
}

function part(g, m, parent, x = 0, y = 0, z = 0) {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  o.userData.part = [g, m];
  parent.add(o);
  return o;
}

// figures are drawn by the shared instancer
export const crowd = { add(p) { instancer.adopt(p.root); } };

// kind: 'painter' | 'worker' | 'inspector'
export function createPerson(kind = 'worker') {
  const m = mats();
  const legMat = kind === 'painter' ? m.coverall : m.trousers;
  const bodyMat = kind === 'painter' ? m.coverall : kind === 'inspector' ? m.polo : m.shirt;
  const handMat = kind === 'painter' ? m.glove : m.skin;
  const root = new THREE.Group();
  const hips = new THREE.Group(); hips.position.y = 0.93; root.add(hips);
  part(geo.pelvis, legMat, hips);
  const legs = {};
  for (const [k, s] of [['L', 1], ['R', -1]]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.1, -0.05, 0); hips.add(hip);
    part(geo.thigh, legMat, hip);
    const knee = new THREE.Group(); knee.position.y = -0.46; hip.add(knee);
    part(geo.shin, legMat, knee);
    part(geo.boot, m.boot, knee, 0, -0.44, 0);
    legs[k] = { hip, knee };
  }
  const torso = new THREE.Group(); torso.position.y = 0.08; hips.add(torso);
  part(geo.chest, bodyMat, torso);
  if (kind === 'worker') { part(geo.vest, m.vest, torso); part(geo.stripe, m.stripe, torso, 0, 0.36, 0); part(geo.stripe, m.stripe, torso, 0, 0.24, 0); }
  const head = new THREE.Group(); head.position.y = 0.72; torso.add(head);
  part(geo.head, m.skin, head);
  if (kind === 'painter') {
    part(geo.hood, m.coverall, head, 0, 0.0, 0);
    part(geo.cape, m.coverall, head, 0, -0.1, 0);
    part(geo.visor, m.visor, head, 0, 0.01, 0.11);
  } else {
    part(geo.helmet, m.helmet, head, 0, 0.04, 0);
    part(geo.brim, m.helmet, head, 0, 0.045, 0.02);
  }
  const arms = {};
  for (const [k, s] of [['L', 1], ['R', -1]]) {
    const sh = new THREE.Group(); sh.position.set(s * 0.27, 0.52, 0); torso.add(sh);
    part(geo.upper, bodyMat, sh);
    const el = new THREE.Group(); el.position.y = -0.32; sh.add(el);
    part(geo.fore, bodyMat, el);
    const hand = new THREE.Group(); hand.position.y = -0.3; el.add(hand);
    part(geo.hand, handMat, hand);
    arms[k] = { sh, el, hand };
  }
  const p = { root, hips, torso, head, arms, legs, kind, tip: null };
  if (kind === 'painter') {
    // manual powder gun in the right hand, barrel pointing forwards along the forearm's -y → turned to +z
    // local +z of g2 points down the forearm, i.e. where the arm points
    const g2 = new THREE.Group(); g2.position.y = -0.08; g2.rotation.x = Math.PI / 2; arms.R.hand.add(g2);
    part(geo.gunBody, m.gun, g2); part(geo.gunGrip, m.gun, g2); part(geo.gunBarrel, m.gunTip, g2);
    part(geo.hose, m.gun, g2, 0, -0.12, 0);
    const tip = new THREE.Object3D(); tip.position.set(0, 0.02, 0.5); g2.add(tip);
    p.tip = tip; p.gun = g2;
  }
  if (kind === 'inspector') {
    const t = part(geo.tablet, m.tablet, arms.L.hand, 0, -0.08, 0.06);
    t.rotation.x = 0.3;
  }
  rest(p);
  crowd.add(p);
  return p;
}

export function rest(p) {
  for (const a of Object.values(p.arms)) { a.sh.rotation.set(0, 0, 0); a.el.rotation.set(0, 0, 0); }
  p.arms.L.sh.rotation.z = 0.08; p.arms.R.sh.rotation.z = -0.08;
  p.arms.L.el.rotation.x = -0.15; p.arms.R.el.rotation.x = -0.15;
  p.torso.rotation.set(0, 0, 0);
}

// Spraying: right arm extended towards the part, sweeping; the left steadies the hose.
// aimPitch > 0 aims upwards. k is a running phase.
export function poseSpray(p, k, aimPitch = 0, sweep = 1) {
  const s = Math.sin(k), c = Math.sin(k * 0.5 + 1);
  p.torso.rotation.y = 0.18 * s * sweep;
  p.arms.R.sh.rotation.x = -1.45 - aimPitch + 0.18 * c;
  p.arms.R.sh.rotation.z = -0.1 + 0.25 * s * sweep;
  p.arms.R.el.rotation.x = -0.12;
  p.arms.L.sh.rotation.x = -0.9 - aimPitch * 0.5;
  p.arms.L.sh.rotation.z = 0.3;
  p.arms.L.el.rotation.x = -0.9;
  p.head.rotation.x = -aimPitch * 0.4;
}

// Reaching up to hook or unhook a part
export function poseReach(p, k) {
  const s = 0.5 + 0.5 * Math.sin(k);
  p.arms.L.sh.rotation.x = -2.4 - 0.3 * s; p.arms.R.sh.rotation.x = -2.2 - 0.4 * (1 - s);
  p.arms.L.el.rotation.x = -0.3; p.arms.R.el.rotation.x = -0.4;
  p.torso.rotation.y = 0.1 * Math.sin(k * 0.5);
  p.head.rotation.x = -0.35;
}

// Inspector holding a gauge to the part with the tablet in the other hand
export function poseInspect(p, k) {
  p.arms.R.sh.rotation.x = -1.2 + 0.15 * Math.sin(k);
  p.arms.R.sh.rotation.z = -0.15 + 0.2 * Math.sin(k * 0.6);
  p.arms.R.el.rotation.x = -0.4;
  p.arms.L.sh.rotation.x = -0.7; p.arms.L.el.rotation.x = -1.1; p.arms.L.sh.rotation.z = 0.2;
  p.head.rotation.x = 0.15 * Math.sin(k * 0.3);
  p.torso.rotation.y = 0.2 * Math.sin(k * 0.25);
}

// Sanding a repair: small fast circles
export function poseSand(p, k) {
  p.arms.R.sh.rotation.x = -1.3 + 0.08 * Math.sin(k * 4);
  p.arms.R.sh.rotation.z = -0.1 + 0.08 * Math.cos(k * 4);
  p.arms.R.el.rotation.x = -0.5;
  p.arms.L.sh.rotation.x = -1.1; p.arms.L.el.rotation.x = -0.6;
  p.head.rotation.x = 0.1;
}
