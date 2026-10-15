// CPU-simulated, GPU-drawn particles: powder spray, wash water, mist and stack vapour.
// Each particle has a velocity, drag, a constant acceleration and an optional attractor, so
// electrostatic powder can be pulled round onto the part while overspray drifts to extraction.
import * as THREE from 'three';

const VERT = `
  attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
  varying float vAlpha; varying vec3 vColor;
  uniform float uScale;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
    vAlpha = aAlpha; vColor = aColor;
  }`;
const FRAG = `
  varying float vAlpha; varying vec3 vColor;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = dot(d, d) * 4.0;
    if (r > 1.0) discard;
    gl_FragColor = vec4(vColor, vAlpha * (1.0 - r) * (1.0 - r));
  }`;

export class Particles {
  constructor(scene, cap, { additive = false } = {}) {
    this.cap = cap;
    this.n = 0;
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.vel = new Float32Array(cap * 3);
    this.acc = new Float32Array(cap * 3);
    this.att = new Float32Array(cap * 4);     // attractor x, y, z, strength
    this.life = new Float32Array(cap);
    this.age = new Float32Array(cap);
    this.s0 = new Float32Array(cap);
    this.grow = new Float32Array(cap);
    this.a0 = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.kill = new Float32Array(cap * 2);    // die when within `r` of plane z = c (powder landing on the part)
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms: { uScale: { value: 600 } },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, o = {}) {
    if (this.n >= this.cap) return;
    const i = this.n++, i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    const acc = o.acc || [0, 0, 0];
    this.acc[i3] = acc[0]; this.acc[i3 + 1] = acc[1]; this.acc[i3 + 2] = acc[2];
    const at = o.att || [0, 0, 0, 0];
    this.att.set(at, i * 4);
    const c = o.color || [1, 1, 1];
    this.col[i3] = c[0]; this.col[i3 + 1] = c[1]; this.col[i3 + 2] = c[2];
    this.life[i] = o.life ?? 1;
    this.age[i] = 0;
    this.s0[i] = this.size[i] = o.size ?? 0.2;
    this.grow[i] = o.grow ?? 0;
    this.a0[i] = this.alpha[i] = o.alpha ?? 1;
    this.drag[i] = o.drag ?? 0;
    this.kill[i * 2] = o.killZ ?? NaN; this.kill[i * 2 + 1] = o.killR ?? 0;
  }

  update(dt, viewportH) {
    this.mat.uniforms.uScale.value = viewportH * 0.9;
    let i = 0;
    while (i < this.n) {
      this.age[i] += dt;
      const i3 = i * 3;
      const kz = this.kill[i * 2];
      if (this.age[i] >= this.life[i] || (kz === kz && Math.abs(this.pos[i3 + 2] - kz) < this.kill[i * 2 + 1])) { this.swapOut(i); continue; }
      const a4 = i * 4, k = this.att[a4 + 3];
      let ax = this.acc[i3], ay = this.acc[i3 + 1], az = this.acc[i3 + 2];
      if (k) { ax += (this.att[a4] - this.pos[i3]) * k; ay += (this.att[a4 + 1] - this.pos[i3 + 1]) * k; az += (this.att[a4 + 2] - this.pos[i3 + 2]) * k; }
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] = (this.vel[i3] + ax * dt) * dr;
      this.vel[i3 + 1] = (this.vel[i3 + 1] + ay * dt) * dr;
      this.vel[i3 + 2] = (this.vel[i3 + 2] + az * dt) * dr;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.02) { this.pos[i3 + 1] = 0.02; this.vel[i3 + 1] *= -0.2; }
      const f = this.age[i] / this.life[i];
      this.size[i] = this.s0[i] * (1 + this.grow[i] * f);
      this.alpha[i] = this.a0[i] * (f < 0.15 ? f / 0.15 : 1 - (f - 0.15) / 0.85);
      i++;
    }
    const g = this.geo;
    g.setDrawRange(0, this.n);
    for (const k of ['position', 'aColor', 'aSize', 'aAlpha']) g.attributes[k].needsUpdate = true;
  }

  swapOut(i) {
    const j = --this.n;
    if (i === j) return;
    const c3 = (a, s) => { a[i * s] = a[j * s]; if (s > 1) { a[i * s + 1] = a[j * s + 1]; a[i * s + 2] = a[j * s + 2]; } };
    for (const a of [this.pos, this.col, this.vel, this.acc]) c3(a, 3);
    for (const a of [this.size, this.alpha, this.life, this.age, this.s0, this.grow, this.a0, this.drag]) a[i] = a[j];
    for (let k = 0; k < 4; k++) this.att[i * 4 + k] = this.att[j * 4 + k];
    this.kill[i * 2] = this.kill[j * 2]; this.kill[i * 2 + 1] = this.kill[j * 2 + 1];
  }

  clear() { this.n = 0; }
}
