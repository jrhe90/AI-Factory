// Shared material palette. Static equipment is batched per material, so every material here is
// one draw call for the whole plant.
import * as THREE from 'three';
import { brushed, wallPanel, hazard } from './textures.js';

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...o });
const glass = (color, opacity, o = {}) => new THREE.MeshPhysicalMaterial({
  color, transparent: true, opacity, roughness: 0.08, metalness: 0, depthWrite: false, side: THREE.DoubleSide, ...o });
const glow = (color, intensity = 1) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 1 });

let cache = null;
export function materials() {
  if (cache) return cache;
  const grain = brushed();
  cache = {
    // building
    wall: std(0xd9dde2, { map: wallPanel('#e4e8ec', [24, 1]), roughness: 0.8 }),
    wallInner: std(0xe6e9ec, { roughness: 0.85 }),
    column: std(0xe8eaec, { roughness: 0.6 }),
    roofSteel: std(0xe9ecef, { roughness: 0.6, metalness: 0.2 }),
    joist: std(0xd5d9de, { roughness: 0.55, metalness: 0.35 }),
    ledPanel: glow(0xf4f8ff, 2.2),
    // floor paint
    lineYellow: std(0xf2c230, { roughness: 0.55 }),
    lineWhite: std(0xf6f7f8, { roughness: 0.55 }),
    walkway: std(0x2c7d4c, { roughness: 0.7 }),
    hazard: std(0xffffff, { map: hazard([1, 1]), roughness: 0.6 }),
    // steel and finishes
    steel: std(0x7d858e, { roughness: 0.42, metalness: 0.65 }),
    darkSteel: std(0x3a3f45, { roughness: 0.5, metalness: 0.5 }),
    ss: std(0xc5cbd1, { roughnessMap: grain, roughness: 0.32, metalness: 0.85 }),
    alu: std(0xd9dde2, { roughness: 0.35, metalness: 0.7 }),
    panel: std(0xf1f3f5, { roughness: 0.62 }),
    panelGrey: std(0xb9c0c7, { roughness: 0.6 }),
    panelDark: std(0x2b3036, { roughness: 0.55, metalness: 0.2 }),
    insulated: std(0xe4e2dc, { roughness: 0.8 }),
    rubber: std(0x16181b, { roughness: 0.9 }),
    safety: std(0xf2c230, { roughness: 0.5, metalness: 0.15 }),
    robot: std(0xf2c200, { roughness: 0.42, metalness: 0.2 }),
    weldRed: std(0xc8102e, { roughness: 0.5, metalness: 0.15 }),
    conveyorBlue: std(0x1f6fd1, { roughness: 0.45, metalness: 0.35 }),
    rail: std(0x2d5fa8, { roughness: 0.45, metalness: 0.5 }),
    hvOrange: std(0xf2801f, { roughness: 0.5 }),
    ovenStrip: std(0xff6a1a, { roughness: 0.5, emissive: 0xff4a10, emissiveIntensity: 0.35 }),
    washStrip: std(0x2ec4d6, { roughness: 0.5, emissive: 0x16a6c4, emissiveIntensity: 0.25 }),
    boothStrip: std(0xf3f6fa, { roughness: 0.5, emissive: 0xdfe8ff, emissiveIntensity: 0.25 }),
    // transparent
    poly: glass(0xd8e4ee, 0.16),
    polyRoof: glass(0xe8eef4, 0.10),
    weldCurtain: glass(0xd0142c, 0.38, { roughness: 0.4 }),
    meshGuard: glass(0x9aa3ad, 0.22, { roughness: 0.6, metalness: 0.4 }),
    // light emitters
    lampWhite: glow(0xffffff, 2.5),
    lampWarm: glow(0xffb070, 2.0),
    ovenGlow: glow(0xff5a14, 1.6),
  };
  return cache;
}

// Andon / status colours (shared by the 3D lamps and the HUD legend)
export const STATUS = {
  busy: { color: '#3ddc84', label: 'Working' },
  starved: { color: '#f5b335', label: 'Starved' },
  blocked: { color: '#4aa3ff', label: 'Blocked' },
  down: { color: '#ff4d4f', label: 'Down' },
};
