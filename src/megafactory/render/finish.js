// Per-part finish material for frames and door kits. A MeshStandardMaterial with a small shader
// extension that blends from finish A to finish B:
//   sweep: B covers the part from its leading end back to a threshold along local x
//          (the gun line, so powder visibly builds up as the part passes the guns)
//   flat:  B fades in over the whole part (wetting in the washer, gloss coming up in the oven)
// plus an uncured-powder grain and a heat glow while the part is in an oven.
import * as THREE from 'three';

export const FINISH = {
  bare:       { color: 0x5f666e, rough: 0.32, metal: 0.85, grain: 0 },
  stripped:   { color: 0x6a7179, rough: 0.5,  metal: 0.7,  grain: 0.2 },
  pretreated: { color: 0x4c535b, rough: 0.08, metal: 0.8,  grain: 0 },
  dry:        { color: 0x5d646d, rough: 0.45, metal: 0.65, grain: 0 },
  primer:     { color: 0x8c978d, rough: 0.97, metal: 0,    grain: 1 },
  gelled:     { color: 0x939d94, rough: 0.6,  metal: 0,    grain: 0.25 },
  topcoat:    { color: 0xecece8, rough: 1.0,  metal: 0,    grain: 1 },
  cured:      { color: 0xf3f4f2, rough: 0.3,  metal: 0.02, grain: 0 },
};

export function finishMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: FINISH.bare.color, roughness: FINISH.bare.rough, metalness: FINISH.bare.metal });
  const u = {
    uColorB: { value: new THREE.Color() }, uRoughB: { value: 1 }, uMetalB: { value: 0 },
    uGrainA: { value: 0 }, uGrainB: { value: 0 },
    uThr: { value: 99 }, uEdge: { value: 0.35 }, uFlat: { value: 0 }, uBlend: { value: 0 }, uHeat: { value: 0 },
  };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLocal;
        uniform vec3 uColorB; uniform float uRoughB, uMetalB, uGrainA, uGrainB, uThr, uEdge, uFlat, uBlend, uHeat;
        float fh(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float fnoise(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(fh(i), fh(i + vec3(1,0,0)), f.x), mix(fh(i + vec3(0,1,0)), fh(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(fh(i + vec3(0,0,1)), fh(i + vec3(1,0,1)), f.x), mix(fh(i + vec3(0,1,1)), fh(i + vec3(1,1,1)), f.x), f.y), f.z); }
        float coverMask() {
          if (uFlat > 0.5) return uBlend;
          float n = fnoise(vLocal * 3.0) * 0.5 + fnoise(vLocal * 9.0) * 0.25;
          return smoothstep(uThr - uEdge, uThr + uEdge, vLocal.x + (n - 0.35) * 0.6);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float cm = coverMask();
        float grain = mix(uGrainA, uGrainB, cm);
        float sp = fh(floor(vLocal * 60.0));
        vec3 col = mix(diffuseColor.rgb, uColorB, cm);
        col *= 1.0 - grain * 0.07 * sp;
        diffuseColor.rgb = col;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, uRoughB, cm);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, uMetalB, cm);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float hn = 0.75 + 0.25 * fnoise(vLocal * 2.0 + vec3(0.0, uHeat * 3.0, 0.0));
        totalEmissiveRadiance += vec3(1.0, 0.32, 0.07) * uHeat * hn;`);
  };
  return m;
}

// Set the material to show finish a → b. opts: { sweep: threshold along local x } or { blend: 0..1 }, heat
export function setFinish(m, a, b = a, { sweep = null, blend = 0, heat = 0, edge = 0.35 } = {}) {
  const A = FINISH[a] || FINISH.bare, B = FINISH[b] || A, u = m.userData.u;
  m.color.setHex(A.color);
  m.roughness = A.rough;
  m.metalness = A.metal;
  u.uColorB.value.setHex(B.color);
  u.uRoughB.value = B.rough;
  u.uMetalB.value = B.metal;
  u.uGrainA.value = A.grain;
  u.uGrainB.value = B.grain;
  u.uEdge.value = edge;
  if (sweep != null) { u.uFlat.value = 0; u.uThr.value = sweep; }
  else { u.uFlat.value = 1; u.uBlend.value = a === b ? 0 : blend; }
  u.uHeat.value = heat;
}
