// Procedural textures drawn on canvases: no image files are loaded.
import * as THREE from 'three';

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
// deterministic so the plant looks the same on every load
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) | 0) >>> 0) / 4294967296;
}
function finish(c, { srgb = true, repeat = [1, 1], aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Polished concrete: one 12 m slab per tile, trowel cloud, aggregate, tyre marks, saw-cut joints
export function concrete(repeat = [1, 1], tone = 196) {
  const [c, g] = canvas(1024);
  const r = rng(7);
  g.fillStyle = `rgb(${tone},${tone + 2},${tone + 4})`;
  g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 260; i++) {
    const x = r() * 1024, y = r() * 1024, rad = 30 + r() * 140, a = 0.025 + r() * 0.045;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const v = r() > 0.5 ? 255 : 120;
    grd.addColorStop(0, `rgba(${v},${v},${v},${a})`);
    grd.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 9000; i++) {
    const v = 120 + r() * 110;
    g.fillStyle = `rgba(${v},${v},${v},${0.18 + r() * 0.25})`;
    g.fillRect(r() * 1024, r() * 1024, 1 + r() * 1.6, 1 + r() * 1.6);
  }
  g.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    g.strokeStyle = `rgba(40,42,46,${0.035 + r() * 0.04})`;
    g.lineWidth = 10 + r() * 14;
    g.beginPath();
    const y = r() * 1024;
    g.moveTo(-20, y);
    g.bezierCurveTo(300, y + (r() - 0.5) * 300, 700, y + (r() - 0.5) * 300, 1044, y + (r() - 0.5) * 200);
    g.stroke();
  }
  for (let i = 0; i < 14; i++) {
    const x = r() * 1024, y = r() * 1024, rad = 6 + r() * 30;
    g.fillStyle = `rgba(60,58,52,${0.05 + r() * 0.06})`;
    g.beginPath(); g.ellipse(x, y, rad, rad * (0.5 + r() * 0.5), r() * 3, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = 'rgba(70,72,76,0.55)';
  g.fillRect(0, 0, 1024, 3); g.fillRect(0, 0, 3, 1024);
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.fillRect(0, 3, 1024, 1); g.fillRect(3, 0, 1, 1024);
  return finish(c, { repeat });
}

// Large-scale tonal variation, multiplied over the floor so its tiling never reads
export function macroNoise() {
  const [c, g] = canvas(512);
  const r = rng(31);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 90; i++) {
    const x = r() * 512, y = r() * 512, rad = 40 + r() * 120;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, `rgba(170,172,176,${0.08 + r() * 0.12})`);
    grd.addColorStop(1, 'rgba(170,172,176,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return finish(c);
}

// Brushed metal grain: greyscale, for roughness maps and a subtle albedo
export function brushed() {
  const [c, g] = canvas(256);
  const r = rng(3);
  g.fillStyle = '#9a9a9a';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    const v = 110 + r() * 90;
    g.fillStyle = `rgba(${v},${v},${v},0.35)`;
    g.fillRect(0, r() * 256, 256, 0.6 + r());
  }
  return finish(c, { srgb: false, repeat: [4, 4] });
}

// Insulated wall panels: vertical seams every panel, faint ribs
export function wallPanel(base = '#e9ecef', repeat = [1, 1]) {
  const [c, g] = canvas(512, 256);
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 256);
  for (let x = 0; x < 512; x += 128) {
    g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(x, 0, 2, 256);
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(x + 2, 0, 1, 256);
    for (let k = 1; k < 4; k++) { g.fillStyle = 'rgba(0,0,0,0.035)'; g.fillRect(x + k * 32, 0, 1, 256); }
  }
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, 'rgba(255,255,255,0.08)'); grd.addColorStop(1, 'rgba(0,0,0,0.06)');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 256);
  return finish(c, { repeat });
}

// Yellow/black safety stripes
export function hazard(repeat = [1, 1]) {
  const [c, g] = canvas(128, 32);
  g.fillStyle = '#f2c230'; g.fillRect(0, 0, 128, 32);
  g.fillStyle = '#16181b';
  for (let x = -32; x < 160; x += 32) { g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 16, 32); g.lineTo(x + 48, 0); g.lineTo(x + 32, 0); g.fill(); }
  return finish(c, { repeat });
}

// Sign board: coloured plate, big title, small subtitle
export function sign(title, sub = '', { bg = '#15171a', fg = '#ffffff', accent = '#e82127', w = 1024, h = 192 } = {}) {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = accent; g.fillRect(0, 0, 14, h);
  g.fillStyle = fg;
  g.textBaseline = 'middle';
  g.font = `700 ${Math.round(h * 0.42)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  g.fillText(title.toUpperCase(), 44, sub ? h * 0.38 : h * 0.52);
  if (sub) {
    g.globalAlpha = 0.7;
    g.font = `500 ${Math.round(h * 0.2)}px "IBM Plex Mono", ui-monospace, monospace`;
    g.fillText(sub, 46, h * 0.76);
  }
  return finish(c);
}

// Big painted zone name on the floor
export function floorWord(text, color = 'rgba(255,255,255,0.9)', w = 2048, h = 256) {
  const [c, g] = canvas(w, h);
  g.fillStyle = color;
  g.font = `700 ${Math.round(h * 0.78)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  g.textBaseline = 'middle';
  g.fillText(text.toUpperCase(), 10, h / 2 + 6);
  const tex = finish(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return { texture: tex, aspect: Math.min(w, g.measureText(text.toUpperCase()).width + 20) / h, used: (g.measureText(text.toUpperCase()).width + 20) / w };
}

// Many floor stencils on one canvas (name, plan and measured cycle per station); the whole atlas is
// uploaded once with commit(). Returns { texture, slot(i) → { uv, draw(title, lines) }, commit }.
export function stencilAtlas(cols = 4, rows = 16, sw = 512, sh = 128) {
  const [c, g] = canvas(cols * sw, rows * sh);
  const tex = finish(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = true;
  return {
    texture: tex,
    commit() { tex.needsUpdate = true; },
    slot(i) {
      const cx = (i % cols) * sw, cy = Math.floor(i / cols) * sh;
      return {
        uv: [cx / (cols * sw), 1 - (cy + sh) / (rows * sh), (cx + sw) / (cols * sw), 1 - cy / (rows * sh)],
        draw(title, lines = [], color = 'rgba(30,34,40,0.78)') {
          g.clearRect(cx, cy, sw, sh);
          g.fillStyle = color;
          g.textBaseline = 'top';
          g.font = `700 ${Math.round(sh * 0.34)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
          g.fillText(title.toUpperCase(), cx + 4, cy + 3);
          g.font = `500 ${Math.round(sh * 0.16)}px "IBM Plex Mono", ui-monospace, monospace`;
          lines.forEach((l, k) => g.fillText(l, cx + 5, cy + sh * 0.46 + k * sh * 0.22));
        },
      };
    },
  };
}

// All column grid labels on one canvas (black plates, white text); returns { texture, uv(i) }
export function gridAtlas(labels) {
  const n = labels.length, cols = 8, rows = Math.ceil(n / cols), s = 128;
  const [c, g] = canvas(cols * s, rows * s);
  labels.forEach((t, i) => {
    const x = (i % cols) * s, y = Math.floor(i / cols) * s;
    g.fillStyle = '#15171a'; g.fillRect(x, y, s, s);
    g.fillStyle = '#fff';
    g.font = '700 58px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(t, x + s / 2, y + s / 2 + 4);
  });
  const tex = finish(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return { texture: tex, uv: (i) => { const x = (i % cols) / cols, y = Math.floor(i / cols) / rows; return [x, 1 - y - 1 / rows, x + 1 / cols, 1 - y]; } };
}
