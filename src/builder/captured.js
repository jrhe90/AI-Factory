// Captured models: procedural factories registered under models/captured/ (photo → img2threejs →
// tools/register-model.mjs). Loaded once at start-up; build() then instantiates them synchronously.
import * as THREE from 'three';

const registry = new Map(); // slug -> { meta, create, fit }
const DEG = Math.PI / 180;

export async function loadCaptured() {
  let idx;
  try {
    const res = await fetch('./models/captured/index.json', { cache: 'no-cache' });
    if (!res.ok) return [];
    idx = await res.json();
  } catch {
    return [];
  }
  await Promise.all((idx.models ?? []).map(async ({ slug }) => {
    try {
      const meta = await (await fetch(`./models/captured/${slug}/model.json`, { cache: 'no-cache' })).json();
      const mod = await import(`../../models/captured/${slug}/model.js`);
      const create = mod[meta.factory];
      if (typeof create !== 'function') throw new Error(`model.js has no export "${meta.factory}"`);
      registry.set(slug, { meta, create, fit: null });
    } catch (err) {
      console.warn(`Captured model "${slug}" failed to load:`, err);
    }
  }));
  return capturedList();
}

export const capturedList = () => [...registry.values()].map((r) => r.meta);
export const capturedMeta = (slug) => registry.get(slug)?.meta ?? null;

// Scale to the measured size (fit inside w×h×d, keeping proportions), turn by rotationY,
// then sit the model on the floor centred on the origin. Worked out once per slug.
function measure(entry, inner) {
  inner.rotation.y = (entry.meta.rotationY ?? 0) * DEG;
  inner.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner);
  const ext = box.getSize(new THREE.Vector3());
  const want = entry.meta.size;
  let s = 1;
  if (want) {
    const ratios = [want[0] / ext.x, want[1] / ext.y, want[2] / ext.z].filter((r) => Number.isFinite(r) && r > 0);
    if (ratios.length) s = Math.min(...ratios);
  }
  const c = box.getCenter(new THREE.Vector3());
  const p = inner.position; // keep whatever root offset the factory set, scaled with it
  return { scale: s, offset: new THREE.Vector3((p.x - c.x) * s, (p.y - box.min.y) * s, (p.z - c.z) * s), size: [ext.x * s, ext.y * s, ext.z * s] };
}

function placeholder(slug, size = [1.5, 1.5, 1.5]) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color: 0xff8a00, transparent: true, opacity: 0.35, depthWrite: false }));
  m.position.y = size[1] / 2;
  g.add(m, new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0xff8a00 })));
  g.children[1].position.y = size[1] / 2;
  g.userData.missingModel = slug;
  return { group: g, size, meta: null };
}

// Returns { group, size: [w, h, d], meta }. Each call runs the factory again rather than cloning,
// because generated models may keep runtime state (pivots, animation handles) in userData.
export function capturedModel(slug) {
  const entry = registry.get(slug);
  if (!entry) return placeholder(slug);
  let inner;
  try {
    inner = entry.create({});
  } catch (err) {
    console.warn(`Captured model "${slug}" threw while building:`, err);
    return placeholder(slug, entry.meta.size?.map((v) => v ?? 1.5));
  }
  entry.fit ??= measure(entry, inner);
  const { scale, offset, size } = entry.fit;
  inner.rotation.y = (entry.meta.rotationY ?? 0) * DEG;
  inner.scale.multiplyScalar(scale);
  inner.position.copy(offset);
  inner.updateMatrixWorld(true);
  inner.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });
  const g = new THREE.Group();
  g.add(inner);
  return { group: g, size, meta: entry.meta };
}
