// Draws any number of articulated rigs (people, robots, carriers, trucks…) as one InstancedMesh
// per (geometry, material). adopt(root) hides every plain mesh under root from the camera;
// sync() writes their world matrices into the instanced meshes once per frame. Rigs keep animating through their Object3D hierarchy as before.
// (People are built from bare Object3D parts that carry [geometry, material] in userData.part.)
import * as THREE from 'three';

const HIDDEN = 31;

class Instancer {
  constructor() { this.roots = new Set(); this.meshes = new Map(); this.scene = null; }
  attach(scene) { this.scene = scene; }

  // register a rig; plain meshes under it move to a layer the camera never draws and are drawn
  // through the instanced batches instead (they keep their identity, so code can still toggle
  // their visibility or swap their material). Meshes with material arrays, instanced meshes and
  // anything marked userData.keep render normally.
  adopt(root) {
    root.traverse((o) => {
      if (o.userData.part) return;
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || o.userData.keep) return;
      o.userData.part = true;
      o.layers.set(HIDDEN);
    });
    this.roots.add(root);
    return root;
  }
  release(root) { this.roots.delete(root); }

  batch(g, m) {
    let e = this.meshes.get(g);
    if (!e) { e = new Map(); this.meshes.set(g, e); }
    let b = e.get(m);
    if (!b) {
      const im = new THREE.InstancedMesh(g, m, 16);
      im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; im.count = 0;
      this.scene.add(im);
      b = { im, n: 0 };
      e.set(m, b);
    }
    if (b.n >= b.im.instanceMatrix.count) {
      const big = new THREE.InstancedMesh(g, m, b.im.instanceMatrix.count * 2);
      big.castShadow = true; big.receiveShadow = true; big.frustumCulled = false;
      big.instanceMatrix.array.set(b.im.instanceMatrix.array);
      this.scene.remove(b.im); b.im.dispose();
      this.scene.add(big);
      b.im = big;
    }
    return b;
  }

  sync() {
    if (!this.scene) return;
    for (const e of this.meshes.values()) for (const b of e.values()) b.n = 0;
    for (const root of this.roots) {
      // skip rigs that are hidden or no longer in the scene
      let o = root, shown = true;
      while (o) { if (!o.visible) { shown = false; break; } if (o === this.scene) break; o = o.parent; }
      if (!shown || o !== this.scene) continue;
      root.updateWorldMatrix(true, true);
      root.traverseVisible((n) => {
        const pt = n.userData.part;
        if (!pt) return;
        const b = pt === true ? this.batch(n.geometry, n.material) : this.batch(pt[0], pt[1]);
        b.im.setMatrixAt(b.n++, n.matrixWorld);
      });
    }
    for (const e of this.meshes.values()) for (const b of e.values()) { b.im.count = b.n; b.im.instanceMatrix.needsUpdate = true; }
  }
}

export const instancer = new Instancer();
