// Floor-plan importers. Each returns a floor `source` plus a suggested scale (metres per
// drawing unit) that the user then confirms with the calibrate tool.
const readAs = (file, how) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r[how](file);
});

function imageSize(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('This image could not be read.'));
    img.src = url;
  });
}

// Large photos are downsized so the project file stays small enough to save
async function shrink(url, maxSide = 4096) {
  const { width, height } = await imageSize(url);
  if (Math.max(width, height) <= maxSide) return { image: url, width, height };
  const k = maxSide / Math.max(width, height);
  const c = document.createElement('canvas');
  c.width = Math.round(width * k);
  c.height = Math.round(height * k);
  const img = new Image();
  img.src = url;
  await img.decode();
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return { image: c.toDataURL('image/jpeg', 0.9), width: c.width, height: c.height };
}

export async function importImage(file) {
  const url = await readAs(file, 'readAsDataURL');
  const img = await shrink(url);
  // Assume a typical plant drawing is ~160 m across until the user calibrates
  return { source: { kind: 'image', name: file.name, ...img }, mpp: 160 / img.width };
}

export async function importPdf(file) {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const data = new Uint8Array(await readAs(file, 'readAsArrayBuffer'));
  const doc = await pdfjs.getDocument({ data }).promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(4, 3200 / Math.max(base.width, base.height));
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width);
  c.height = Math.round(vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const image = c.toDataURL('image/jpeg', 0.9);
  return { source: { kind: 'pdf', name: file.name, image, width: c.width, height: c.height, pages: doc.numPages }, mpp: 160 / c.width };
}

const UNITS = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1 };

export async function importDxf(file) {
  const { default: DxfParser } = await import('dxf-parser');
  const text = await readAs(file, 'readAsText');
  let dxf;
  try {
    dxf = new DxfParser().parseSync(text);
  } catch (e) {
    throw new Error(`This DXF could not be read (${e.message}). Save it as ASCII DXF and try again.`);
  }
  const layers = new Map();
  const layerInfo = dxf.tables?.layer?.layers ?? {};
  const layerOf = (name) => {
    if (!layers.has(name)) {
      const c = layerInfo[name]?.color;
      let color = typeof c === 'number' ? `#${c.toString(16).padStart(6, '0')}` : '#475569';
      if (color === '#ffffff' || color === '#000000') color = '#475569';
      layers.set(name, { name, color, visible: true, segments: [] });
    }
    return layers.get(name);
  };
  const texts = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const seg = (L, a, b) => {
    L.segments.push(a.x, a.y, b.x, b.y);
    minX = Math.min(minX, a.x, b.x);
    maxX = Math.max(maxX, a.x, b.x);
    minY = Math.min(minY, a.y, b.y);
    maxY = Math.max(maxY, a.y, b.y);
  };
  const arc = (L, c, r, a0, a1, xf) => {
    let span = a1 - a0;
    if (span <= 0) span += Math.PI * 2;
    const n = Math.max(8, Math.ceil(span / (Math.PI / 16)));
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const a = a0 + (span * i) / n;
      const p = xf({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
      if (prev) seg(L, prev, p);
      prev = p;
    }
  };
  const walk = (entities, xf, depth) => {
    for (const e of entities ?? []) {
      const L = layerOf(e.layer ?? '0');
      switch (e.type) {
        case 'LINE':
          seg(L, xf(e.vertices[0]), xf(e.vertices[1]));
          break;
        case 'LWPOLYLINE':
        case 'POLYLINE': {
          const vs = e.vertices ?? [];
          for (let i = 1; i < vs.length; i++) seg(L, xf(vs[i - 1]), xf(vs[i]));
          if (e.shape && vs.length > 2) seg(L, xf(vs[vs.length - 1]), xf(vs[0]));
          break;
        }
        case 'CIRCLE':
          arc(L, e.center, e.radius, 0, Math.PI * 2, xf);
          break;
        case 'ARC':
          arc(L, e.center, e.radius, e.startAngle, e.endAngle, xf);
          break;
        case 'TEXT':
        case 'MTEXT': {
          const p = xf(e.startPoint ?? e.position ?? { x: 0, y: 0 });
          if (e.text) texts.push({ x: p.x, y: p.y, text: String(e.text).replace(/\\P/g, ' ').replace(/[{}]|\\[A-Za-z][^;]*;/g, '').slice(0, 80), layer: L.name });
          break;
        }
        case 'INSERT': {
          const block = dxf.blocks?.[e.name];
          if (!block || depth > 3) break;
          const sx = e.xScale ?? 1;
          const sy = e.yScale ?? 1;
          const rot = ((e.rotation ?? 0) * Math.PI) / 180;
          const bp = block.position ?? { x: 0, y: 0 };
          const inner = (pt) => {
            const x = (pt.x - bp.x) * sx;
            const y = (pt.y - bp.y) * sy;
            return xf({ x: e.position.x + x * Math.cos(rot) - y * Math.sin(rot), y: e.position.y + x * Math.sin(rot) + y * Math.cos(rot) });
          };
          walk(block.entities, inner, depth + 1);
          break;
        }
        default:
          break;
      }
    }
  };
  walk(dxf.entities, (p) => ({ x: p.x, y: p.y }), 0);
  if (!Number.isFinite(minX)) throw new Error('No lines, polylines or arcs were found in this DXF.');
  const extent = Math.max(maxX - minX, maxY - minY);
  const units = dxf.header?.$INSUNITS;
  const mpp = UNITS[units] ?? (extent > 2000 ? 0.001 : 1);
  const list = [...layers.values()].filter((l) => l.segments.length);
  return {
    source: { kind: 'dxf', name: file.name, bounds: [minX, minY, maxX, maxY], layers: list, texts: texts.slice(0, 2000), units: units ?? null },
    mpp,
  };
}

export async function importFloorFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.dxf')) return importDxf(file);
  if (name.endsWith('.dwg')) throw new Error('DWG files cannot be read in the browser. In AutoCAD or a free converter, save as DXF and import that.');
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return importPdf(file);
  if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|svg)$/.test(name)) return importImage(file);
  throw new Error('Unsupported file. Import an image (PNG, JPG, WebP), a PDF or a DXF.');
}

// Drawing-unit point -> world point under the current floor transform
export function drawingToWorld(floor, u, v) {
  const src = floor.source;
  let dx;
  let dz;
  if (src.kind === 'dxf') {
    const [x0, y0, x1, y1] = src.bounds;
    dx = (u - (x0 + x1) / 2) * floor.mpp;
    dz = -(v - (y0 + y1) / 2) * floor.mpp;
  } else {
    dx = (u - src.width / 2) * floor.mpp;
    dz = (v - src.height / 2) * floor.mpp;
  }
  const r = ((floor.rotation ?? 0) * Math.PI) / 180;
  return [floor.center[0] + dx * Math.cos(r) + dz * Math.sin(r), floor.center[1] - dx * Math.sin(r) + dz * Math.cos(r)];
}
