// Exterior site around the plant: truck court, storage lot surface, roads, employee parking,
// office, substation, landscaping, dock doors and trailers. Layout follows the MFTX aerial:
// parking to the north (along the boulevard) and west, docks and a concrete court to the south.
import * as THREE from 'three';
import {
  COLORS, mat, box, cyl, glow, createBoxTrailer, createForklift, createScissorLift,
} from './models.js';
import { CarTraffic } from './cars.js';

export const SITE = {
  doorX: 57, // south door used by the straddle carriers
  doorHalf: 5.5,
  wallZ: 34.4,
  roadZ: 100, // outbound truck road (south)
  blvdZ: -77, // boulevard (north)
};

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const p = new THREE.Vector3();
const sc = new THREE.Vector3();

function tex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (repeat) t.repeat.set(...repeat);
  return t;
}

function flat(scene, x0, x1, z0, z1, material, y = 0.005) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), material);
  m.rotation.x = -Math.PI / 2;
  m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

// Concrete slab with saw-cut joints every 6 m
function concrete(w, d) {
  return new THREE.MeshStandardMaterial({
    map: tex(256, 256, (g, W, H) => {
      g.fillStyle = '#c3c4c1';
      g.fillRect(0, 0, W, H);
      const img = g.getImageData(0, 0, W, H);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (Math.random() - 0.5) * 9;
        img.data[i] += n;
        img.data[i + 1] += n;
        img.data[i + 2] += n;
      }
      g.putImageData(img, 0, 0);
      g.strokeStyle = 'rgba(70,72,75,0.45)';
      g.lineWidth = 2;
      g.strokeRect(0, 0, W, H);
    }, [w / 6, d / 6]),
    roughness: 0.85,
  });
}

function asphalt(w, d) {
  return new THREE.MeshStandardMaterial({
    map: tex(256, 256, (g, W, H) => {
      g.fillStyle = '#4b4f55';
      g.fillRect(0, 0, W, H);
      const img = g.getImageData(0, 0, W, H);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (Math.random() - 0.5) * 14;
        img.data[i] += n;
        img.data[i + 1] += n;
        img.data[i + 2] += n;
      }
      g.putImageData(img, 0, 0);
    }, [w / 10, d / 10]),
    roughness: 0.95,
  });
}

function road(scene, x0, x1, z, width) {
  flat(scene, x0, x1, z - width / 2, z + width / 2, asphalt(x1 - x0, width), 0.01);
  // Yellow centre dashes
  const n = Math.floor((x1 - x0) / 6);
  const dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(3, 0.02, 0.18), mat(COLORS.yellow), n);
  for (let i = 0; i < n; i++) dashes.setMatrixAt(i, m4.makeTranslation(x0 + 3 + i * 6, 0.02, z));
  scene.add(dashes);
  for (const s of [-1, 1]) {
    const edge = box(x1 - x0, 0.02, 0.15, mat(0xf4f4f4), false);
    edge.position.set((x0 + x1) / 2, 0.02, z + s * (width / 2 - 0.4));
    scene.add(edge);
  }
}

// Parking lot surface and stall lines; stalls run along local x in rows at local z.
// Returns the group (to position/rotate) and the stall centres for the car traffic.
function parkingLot(len, depth, rows) {
  const g = new THREE.Group();
  const lot = new THREE.Mesh(new THREE.PlaneGeometry(len, depth), asphalt(len, depth));
  lot.rotation.x = -Math.PI / 2;
  lot.position.y = 0.012;
  lot.receiveShadow = true;
  g.add(lot);
  const stallW = 2.7;
  const stallD = 5.4;
  const perRow = Math.floor((len - 4) / stallW);
  const lines = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.02, stallD), mat(0xf4f4f4), rows.length * (perRow + 1));
  const stalls = [];
  let li = 0;
  rows.forEach(({ z: rz, aisle }) => {
    for (let i = 0; i <= perRow; i++) {
      const x = -len / 2 + 2 + i * stallW;
      lines.setMatrixAt(li++, m4.makeTranslation(x, 0.025, rz));
      if (i < perRow) stalls.push({ lx: x + stallW / 2, lz: rz, aisle });
    }
  });
  g.add(lines);
  return { group: g, stalls };
}

function trees(scene, positions) {
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.25, 2.4, 8), mat(0x6b4f35), positions.length);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.9, 1), mat(0x5f8f4a, { roughness: 0.9, flatShading: true }), positions.length);
  positions.forEach(([x, z, s], i) => {
    trunk.setMatrixAt(i, m4.compose(p.set(x, 1.2 * s, z), q.identity(), sc.set(s, s, s)));
    crown.setMatrixAt(i, m4.compose(p.set(x, 3.4 * s, z), q.identity(), sc.set(s, s * 0.9, s)));
  });
  trunk.castShadow = crown.castShadow = true;
  scene.add(trunk, crown);
}

function lightPoles(scene, positions) {
  const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.14, 9, 8), mat(0x3a3e44, { metalness: 0.6 }), positions.length);
  const head = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 0.18, 0.5), mat(0x2b2f35), positions.length);
  const lamp = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.04, 0.35), glow(0xfff6e0), positions.length);
  positions.forEach(([x, z], i) => {
    pole.setMatrixAt(i, m4.makeTranslation(x, 4.5, z));
    head.setMatrixAt(i, m4.makeTranslation(x + 0.4, 9, z));
    lamp.setMatrixAt(i, m4.makeTranslation(x + 0.4, 8.9, z));
  });
  pole.castShadow = true;
  scene.add(pole, head, lamp);
}

function fence(scene, x0, z0, x1, z1) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const ang = Math.atan2(-(z1 - z0), x1 - x0);
  const g = new THREE.Group();
  g.position.set(x0, 0, z0);
  g.rotation.y = ang;
  const black = mat(0x1d1f22, { metalness: 0.5 });
  const n = Math.max(1, Math.round(len / 3));
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 2.2, 0.08), black, n + 1);
  for (let i = 0; i <= n; i++) posts.setMatrixAt(i, m4.makeTranslation((i * len) / n, 1.1, 0));
  g.add(posts);
  for (const y of [0.25, 2.1]) {
    const r = box(len, 0.05, 0.05, black, false);
    r.position.set(len / 2, y, 0);
    g.add(r);
  }
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(len, 1.85),
    new THREE.MeshStandardMaterial({ color: 0x1d1f22, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
  );
  mesh.position.set(len / 2, 1.18, 0);
  g.add(mesh);
  scene.add(g);
}

// Exterior skirt along the south wall with dock doors (faces outward; low, so the
// building interior stays visible from above).
function dockWall(scene, x0, x1) {
  const len = x1 - x0;
  const t = tex(256, 280, (g, W, H) => {
    g.fillStyle = '#e4e7ea';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#d2d6da';
    for (let x = 0; x < W; x += 24) g.fillRect(x, 0, 3, H);
    // Door, seal and bumpers
    g.fillStyle = '#1b1d20';
    g.fillRect(W * 0.18, H * 0.22, W * 0.64, H * 0.78);
    g.fillStyle = '#9aa1a8';
    for (let y = H * 0.26; y < H; y += 14) g.fillRect(W * 0.22, y, W * 0.56, 3);
    g.fillStyle = '#111';
    g.fillRect(W * 0.12, H * 0.82, W * 0.06, H * 0.12);
    g.fillRect(W * 0.82, H * 0.82, W * 0.06, H * 0.12);
    g.fillStyle = '#f2c230';
    g.fillRect(W * 0.18, H * 0.2, W * 0.64, 5);
  }, [len / 4.2, 1]);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 4.8), new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 }));
  m.position.set((x0 + x1) / 2, 2.4, SITE.wallZ + 0.02);
  m.receiveShadow = true;
  scene.add(m);
}

export function buildSite(scene) {
  let seed = 11;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  // Grass everywhere outside, then paved surfaces on top
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(1200, 800), mat(0x8fa66d, { roughness: 1 }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.03;
  grass.receiveShadow = true;
  scene.add(grass);

  // South truck court + Megapack storage lot (one big concrete apron)
  flat(scene, -112, 124, 34.4, 96, concrete(236, 61.6));
  // East and west aprons around the building
  flat(scene, 99.5, 124, -46, 34.4, concrete(24.5, 80.4));
  flat(scene, -112, -99.5, -46, 34.4, concrete(12.5, 80.4));
  // North drive between building and parking
  flat(scene, -112, 124, -46, -34.4, concrete(236, 11.6));

  // Roads
  road(scene, -420, 420, SITE.roadZ, 8);
  road(scene, -420, 420, SITE.blvdZ, 10);
  flat(scene, 124, 132, -72, 96, asphalt(8, 168), 0.008); // east service road
  flat(scene, -184, -176, -72, 96, asphalt(8, 168), 0.008); // west service road

  // Employee parking: north strip along the boulevard, and a big lot west of the office
  // Stalls face a shared drive aisle; driveways sit at the lot ends
  const north = parkingLot(200, 26, [{ z: -6.8, aisle: 0 }, { z: 6.8, aisle: 0 }]);
  north.group.position.set(6, 0, -59);
  scene.add(north.group);
  const west = parkingLot(76, 52, [
    { z: -19.5, aisle: -13 }, { z: -6.5, aisle: -13 }, { z: 6.5, aisle: 13 }, { z: 19.5, aisle: 13 },
  ]);
  west.group.rotation.y = Math.PI / 2;
  west.group.position.set(-148, 0, -6);
  scene.add(west.group);

  // Office block next to the west parking (the "briefcase" building on the map)
  const office = new THREE.Group();
  const shell = box(12, 9, 26, mat(0xeef0f2, { roughness: 0.6 }));
  shell.position.y = 4.5;
  office.add(shell);
  const glass = mat(0x2a4a63, { roughness: 0.1, metalness: 0.7 });
  for (const y of [2.4, 6.4]) {
    const band = box(12.05, 1.8, 26.05, glass, false);
    band.position.y = y;
    office.add(band);
  }
  const canopy = box(3, 0.25, 8, mat(0x3a3e44));
  canopy.position.set(-7.4, 3.6, 0);
  office.add(canopy);
  office.position.set(-116, 0, -22);
  scene.add(office);

  // Substation / utility yard on the west side
  const yard = new THREE.Group();
  flat(yard, -10, 10, -9, 9, mat(0x9b9d9a, { roughness: 1 }), 0.02);
  for (let i = 0; i < 3; i++) {
    const tx = box(3.2, 3.2, 2.6, mat(0x8a929a, { metalness: 0.4 }));
    tx.position.set(-6 + i * 6, 1.6, -3);
    yard.add(tx);
    for (const dx of [-0.8, 0, 0.8]) {
      const bush = cyl(0.15, 0.2, 1.4, 8, mat(0x7a5a3a));
      bush.position.set(-6 + i * 6 + dx, 3.9, -3);
      yard.add(bush);
    }
    const sw = box(2, 2.4, 1.2, mat(0xc0c6cc, { metalness: 0.3 }));
    sw.position.set(-6 + i * 6, 1.2, 4);
    yard.add(sw);
  }
  yard.position.set(-150, 0, 50);
  scene.add(yard);
  fence(scene, -160, 41, -140, 41);
  fence(scene, -140, 41, -140, 59);
  fence(scene, -140, 59, -160, 59);
  fence(scene, -160, 59, -160, 41);

  // Dock doors along the south wall, with drop trailers backed in at some of them
  const d = SITE.doorX - SITE.doorHalf;
  const e = SITE.doorX + SITE.doorHalf;
  dockWall(scene, -99.5, d);
  dockWall(scene, e, 99.5);
  // Carrier door frame
  const frameMat = mat(0x2b2f35, { metalness: 0.5 });
  for (const x of [d, e]) {
    const post = box(0.5, 6.5, 0.5, frameMat);
    post.position.set(x, 3.25, SITE.wallZ + 0.2);
    scene.add(post);
  }
  const header = box(e - d + 0.5, 0.6, 0.5, frameMat);
  header.position.set(SITE.doorX, 6.5, SITE.wallZ + 0.2);
  scene.add(header);
  const doorXs = [];
  for (let x = -99.5 + 2.1; x < 99.5; x += 4.2) if (x < d - 2 || x > e + 2) doorXs.push(x);
  doorXs.forEach((x, i) => {
    if ((i * 7) % 5 < 2) {
      const t = createBoxTrailer();
      t.position.set(x, 0, SITE.wallZ + 8.3);
      t.traverse((o) => { o.castShadow = true; });
      scene.add(t);
    }
  });

  // Yard vehicles parked by the carrier stand (east of the storage lot)
  const fork = createForklift();
  fork.position.set(116, 0, 42);
  fork.rotation.y = 0.4;
  scene.add(fork);
  const lift = createScissorLift();
  lift.position.set(118, 0, 48);
  scene.add(lift);

  // Landscaping
  const treePos = [];
  for (let x = -170; x <= 200; x += 9) {
    treePos.push([x + rand() * 3, SITE.roadZ + 9 + rand() * 2, 0.9 + rand() * 0.4]);
    treePos.push([x + rand() * 3, SITE.blvdZ - 9 - rand() * 2, 0.9 + rand() * 0.4]);
  }
  for (let z = -60; z <= 80; z += 9) {
    treePos.push([-192 - rand() * 3, z, 0.9 + rand() * 0.4]);
    treePos.push([140 + rand() * 3, z, 0.9 + rand() * 0.4]);
  }
  trees(scene, treePos);

  // Light poles stand in the gaps between lot columns, clear of the carrier aisles
  const poles = [];
  for (const x of [-90, -60, -30, 0, 38, 76]) poles.push([x, 62], [x, 78], [x, 94]);
  for (let x = -90; x <= 110; x += 25) poles.push([x, -47]);
  for (let z = -40; z <= 30; z += 22) poles.push([-110, z], [-186 + 10, z]);
  lightPoles(scene, poles);

  // Perimeter fence along the south road with a truck gate gap
  fence(scene, -112, SITE.roadZ - 4.6, 20, SITE.roadZ - 4.6);
  fence(scene, 105, SITE.roadZ - 4.6, 124, SITE.roadZ - 4.6);

  // Employee cars drive in from the boulevard / west road, park nose-in, back out and leave
  const toWorld = (lot) => {
    lot.group.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    return (lx, lz) => {
      v.set(lx, 0, lz).applyMatrix4(lot.group.matrixWorld);
      return [v.x, v.z];
    };
  };
  const eastLane = SITE.blvdZ + 2.4; // eastbound
  const westLane = SITE.blvdZ - 2.4; // westbound
  const northLot = (entryX) => {
    const mx = 6 + entryX;
    return {
      toWorld: toWorld(north),
      stalls: north.stalls.filter((st) => Math.sign(st.lx) === Math.sign(entryX)),
      entryX,
      arrive: [[mx - 110, eastLane], [mx, eastLane], [mx, -72]],
      depart: [[mx, -72], [mx, westLane], [mx - 110, westLane]],
      maxMoving: 9,
    };
  };
  const lots = [
    northLot(98.5),
    northLot(-98.5),
    {
      toWorld: toWorld(west),
      stalls: west.stalls,
      entryX: 36.5,
      arrive: [[-177.6, 70], [-177.6, -42.5], [-174, -42.5]],
      depart: [[-174, -42.5], [-182.4, -42.5], [-182.4, 70]],
      maxMoving: 12,
    },
  ];
  const through = [];
  for (let i = 0; i < 12; i++) {
    const dir = i % 2 ? 1 : -1;
    through.push({ x0: -420, x1: 420, z: dir > 0 ? eastLane : westLane, dir, v: 12 + rand() * 6 });
  }
  const cars = new CarTraffic(scene, lots, through, rand, 6);

  return {
    cars,
    update(dt, hour) {
      cars.update(dt, hour);
    },
  };
}
