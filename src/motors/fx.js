// Point-sprite particle pools (sparks, coolant mist, wash water, paint, oven smoke).
import * as THREE from 'three';

let dotTex;
function dot() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

export class Particles {
  constructor(scene, { count, color, size, gravity, speed, up, life, opacity = 1, additive = true, floor = 0.02 }) {
    Object.assign(this, { count, gravity, speed, up, life, floor });
    this.pos = new Float32Array(count * 3).fill(-100);
    this.vel = new Float32Array(count * 3);
    this.age = new Float32Array(count);
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      color, size, map: dot(), transparent: true, opacity, depthWrite: false, toneMapped: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  emit(p, n) {
    for (let i = 0; i < n; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % this.count;
      this.pos[k * 3] = p.x;
      this.pos[k * 3 + 1] = p.y;
      this.pos[k * 3 + 2] = p.z;
      this.vel[k * 3] = (Math.random() - 0.5) * this.speed;
      this.vel[k * 3 + 1] = Math.random() * this.up;
      this.vel[k * 3 + 2] = (Math.random() - 0.5) * this.speed;
      this.age[k] = this.life * (0.6 + Math.random() * 0.6);
    }
  }
  emitDir(p, dir, n, spread = 0.6) {
    for (let i = 0; i < n; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % this.count;
      this.pos[k * 3] = p.x;
      this.pos[k * 3 + 1] = p.y;
      this.pos[k * 3 + 2] = p.z;
      this.vel[k * 3] = dir.x + (Math.random() - 0.5) * spread;
      this.vel[k * 3 + 1] = dir.y + (Math.random() - 0.5) * spread;
      this.vel[k * 3 + 2] = dir.z + (Math.random() - 0.5) * spread;
      this.age[k] = this.life * (0.6 + Math.random() * 0.6);
    }
  }
  update(dt) {
    const { pos, vel, age } = this;
    for (let k = 0; k < this.count; k++) {
      if (age[k] <= 0) continue;
      age[k] -= dt;
      if (age[k] <= 0) {
        pos[k * 3 + 1] = -100;
        continue;
      }
      vel[k * 3 + 1] -= this.gravity * dt;
      pos[k * 3] += vel[k * 3] * dt;
      pos[k * 3 + 1] = Math.max(this.floor, pos[k * 3 + 1] + vel[k * 3 + 1] * dt);
      pos[k * 3 + 2] += vel[k * 3 + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

export function createFx(scene) {
  const fx = {
    sparks: new Particles(scene, { count: 900, color: 0xffb347, size: 0.12, gravity: 9.8, speed: 3.5, up: 3, life: 0.5 }),
    mist: new Particles(scene, { count: 500, color: 0xe8f2ff, size: 0.45, gravity: -0.3, speed: 0.6, up: 0.5, life: 1.6, opacity: 0.25, additive: false }),
    water: new Particles(scene, { count: 1000, color: 0xd6ecff, size: 0.08, gravity: 9.8, speed: 0, up: 0, life: 0.45, opacity: 0.8, additive: false }),
    paint: new Particles(scene, { count: 700, color: 0x24486f, size: 0.18, gravity: 0.2, speed: 1.2, up: 0.3, life: 0.9, opacity: 0.45, additive: false }),
    smoke: new Particles(scene, { count: 300, color: 0xcfd4da, size: 1.2, gravity: -0.6, speed: 0.4, up: 0.4, life: 3.5, opacity: 0.18, additive: false }),
  };
  fx.update = (dt) => {
    for (const k of ['sparks', 'mist', 'water', 'paint', 'smoke']) fx[k].update(dt);
  };
  return fx;
}
