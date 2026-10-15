// Renderer, post-processing, camera, lights and 3D labels.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';

export const VIEWS = {
  overview: { pos: [36, 168, 176], target: [-6, 0, -22], label: 'Overview', group: 'Plant' },
  pack: { pos: [-20, 30, 52], target: [-28, 1, 6], label: 'Pack line', group: 'Plant' },
  modules: { pos: [10, 34, 12], target: [8, 1, -24], label: 'Modules', group: 'Plant' },
  biw: { pos: [-82, 30, 6], target: [-114, 1, -24], label: 'Body in White', group: 'Plant' },
  paint: { pos: [-6, 46, -8], target: [-6, 2, -58], label: 'Powder coat', group: 'Paint shop' },
  pretreat: { pos: [-62, 15, -49], target: [-78, 2.4, -66], label: 'Pretreatment', group: 'Paint shop' },
  primer: { pos: [-12, 13, -50], target: [-22, 2.4, -66], label: 'Primer booth', group: 'Paint shop' },
  topcoat: { pos: [62, 13, -50], target: [53, 2.4, -66], label: 'Topcoat booth', group: 'Paint shop' },
  touchup: { pos: [81, 5.4, -56.5], target: [72, 2.9, -66], label: 'Touch-up', group: 'Paint shop' },
  cure: { pos: [70, 14, -36], target: [58, 3, -50], label: 'Cure oven', group: 'Paint shop' },
  inspection: { pos: [18, 10, -38], target: [8, 2.4, -49], label: 'Inspection', group: 'Paint shop' },
  crane: { pos: [58, 18, 36], target: [36, 3, 12], label: 'Crane & pad', group: 'Outbound' },
  yard: { pos: [124, 60, 118], target: [60, 0, 62], label: 'Storage lot', group: 'Outbound' },
  trucks: { pos: [150, 26, 128], target: [100, 1, 100], label: 'Truck bay', group: 'Outbound' },
  parking: { pos: [-40, 40, -60], target: [-20, 0, -104], label: 'Parking', group: 'Outbound' },
  site: { pos: [-60, 330, 300], target: [-20, 0, -10], label: 'Whole site', group: 'Outbound' },
};

export class Stage {
  constructor(el) {
    this.el = el;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.92;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(r.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'labels3d';
    el.appendChild(this.labels.domElement);
    this.labelList = [];

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color('#0d1116');
    scene.fog = new THREE.Fog('#0d1116', 520, 980);
    const pmrem = new THREE.PMREMGenerator(r);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.45;

    // daylight through the cut-away roof plus a cool sky fill
    scene.add(new THREE.HemisphereLight('#dfe9f5', '#3c3a36', 0.35));
    const sun = this.sun = new THREE.DirectionalLight('#fff4e6', 1.7);
    sun.position.set(90, 160, 120);
    sun.target.position.set(-10, 0, -20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 120, bottom: -120, near: 20, far: 420 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 1800);
    const v = VIEWS.overview;
    this.camera.position.set(...v.pos);
    const c = this.controls = new OrbitControls(this.camera, r.domElement);
    c.target.set(...v.target);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.maxPolarAngle = Math.PI * 0.48;
    c.minDistance = 4;
    c.maxDistance = 620;
    c.autoRotateSpeed = 0.3;
    this.tween = null;

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    const comp = this.composer = new EffectComposer(r, rt);
    comp.addPass(new RenderPass(scene, this.camera));
    this.gtao = new GTAOPass(scene, this.camera, 1, 1);
    this.gtao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.6, thickness: 2.5, scale: 1, samples: 16 });
    this.gtao.blendIntensity = 0.8;
    comp.addPass(this.gtao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.5, 1.15);
    comp.addPass(this.bloom);
    this.vignette = new ShaderPass(VignetteShader);
    this.vignette.uniforms.offset.value = 0.92;
    this.vignette.uniforms.darkness.value = 1.1;
    comp.addPass(this.vignette);
    comp.addPass(new OutputPass());

    this.quality = 'high';
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  setQuality(q) {
    this.quality = q;
    this.gtao.enabled = q === 'high';
    this.renderer.setPixelRatio(q === 'high' ? Math.min(devicePixelRatio, 2) : 1);
    this.renderer.shadowMap.type = q === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.resize();
  }

  resize() {
    const w = this.el.clientWidth || innerWidth, h = this.el.clientHeight || innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.labels.setSize(w, h);
  }

  label(text, x, y, z, cls = 'eq', { far = 300, near = 0, parent = this.scene } = {}) {
    const div = document.createElement('div');
    div.className = 'lbl ' + cls;
    div.textContent = text;
    const o = new CSS2DObject(div);
    o.position.set(x, y, z);
    o.userData.far = far;
    o.userData.near = near;
    parent.add(o);
    this.labelList.push(o);
    return o;
  }

  flyTo(target, pos, dur = 1.6) {
    this.tween = { t: 0, dur, p0: this.camera.position.clone(), t0: this.controls.target.clone(),
                   p1: new THREE.Vector3(...pos), t1: new THREE.Vector3(...target) };
  }
  view(key) { const v = VIEWS[key]; if (v) this.flyTo(v.target, v.pos); }

  update(dt) {
    if (this.drive) {
      const shot = this.drive(dt);
      if (shot) {
        this.tween = null;
        this.camera.position.copy(shot.pos);
        this.controls.target.copy(shot.target);
        this.camera.lookAt(shot.target);
      }
    } else if (this.tween) {
      const tw = this.tween;
      tw.t += dt / tw.dur;
      const k = tw.t >= 1 ? 1 : 1 - Math.pow(1 - tw.t, 3);
      this.camera.position.lerpVectors(tw.p0, tw.p1, k);
      this.controls.target.lerpVectors(tw.t0, tw.t1, k);
      if (tw.t >= 1) this.tween = null;
    }
    if (!this.drive) this.controls.update(dt);
    // labels fade out with distance so the overview stays legible
    const cp = this.camera.position;
    for (const o of this.labelList) {
      const d = cp.distanceTo(o.getWorldPosition(_v));
      const { far, near } = o.userData;
      const a = d > far ? 0 : d > far * 0.75 ? (far - d) / (far * 0.25) : 1;
      const b = near ? Math.max(0, Math.min(1, (d - near) / (near * 0.25))) : 1;
      o.element.style.opacity = String(a * b);
    }
  }

  render() {
    this.composer.render();
    this.labels.render(this.scene, this.camera);
  }

  // Render one frame of the 3D view off-screen at W×H (no HUD or labels) and return a PNG data URL
  capture(W = 3840, H = 2160) {
    const r = this.renderer, pr = r.getPixelRatio(), size = r.getSize(new THREE.Vector2());
    r.setPixelRatio(1);
    r.setSize(W, H, false);
    this.composer.setPixelRatio(1);
    this.composer.setSize(W, H);
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
    this.composer.render();
    const url = r.domElement.toDataURL('image/png');
    r.setPixelRatio(pr);
    r.setSize(size.x, size.y);
    this.resize();
    return url;
  }
}
const _v = new THREE.Vector3();
