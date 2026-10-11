#!/usr/bin/env node
// Dev server for phone capture. Serves the site and accepts photos from capture.html.
//
//   node tools/capture-server.mjs [--port 8000]
//
// Open the printed LAN address on a phone on the same Wi-Fi. Each upload lands in
// captures/<slug>/ as photo-N.jpg plus capture.json, ready for the photo-to-model skill.
// Meant for a trusted local network: there is no authentication.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CAPTURES = path.join(ROOT, 'captures');
const MODELS = path.join(ROOT, 'models', 'captured');
const portArg = process.argv.indexOf('--port');
const PORT = Number(portArg > 0 ? process.argv[portArg + 1] : process.env.PORT ?? 8000);
const MAX_BODY = 60 * 1024 * 1024; // up to ~6 phone photos after client-side downscaling
const MAX_PHOTOS = 6;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

const slugify = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Upload too large'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function freeSlug(base) {
  let slug = base || 'object';
  for (let i = 2; await exists(path.join(CAPTURES, slug)); i++) slug = `${base}-${i}`;
  return slug;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 200 ? n : null;
};

async function createCapture(req, res) {
  const body = JSON.parse(await readBody(req));
  const photos = Array.isArray(body.photos) ? body.photos.slice(0, MAX_PHOTOS) : [];
  if (!photos.length) return send(res, 400, { error: 'Add at least one photo' });
  const name = String(body.name ?? '').trim().slice(0, 80) || 'Untitled object';
  const slug = await freeSlug(slugify(name));
  const dir = path.join(CAPTURES, slug);
  await fs.mkdir(dir, { recursive: true });
  const files = [];
  for (const [i, p] of photos.entries()) {
    const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(String(p.data ?? ''));
    if (!m) continue;
    const file = `photo-${i + 1}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
    await fs.writeFile(path.join(dir, file), Buffer.from(m[2], 'base64'));
    files.push({ file, view: String(p.view ?? '').slice(0, 20) || null });
  }
  if (!files.length) {
    await fs.rm(dir, { recursive: true, force: true });
    return send(res, 400, { error: 'No readable images in upload' });
  }
  const size = [num(body.size?.[0]), num(body.size?.[1]), num(body.size?.[2])];
  const capture = {
    slug,
    name,
    role: body.role === 'equipment' ? 'equipment' : 'station',
    size: size.every((v) => v === null) ? null : size, // [width, height, depth] in metres
    notes: String(body.notes ?? '').slice(0, 1000),
    photos: files,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(dir, 'capture.json'), JSON.stringify(capture, null, 2) + '\n');
  console.log(`  + captured "${name}" → captures/${slug}/ (${files.length} photo${files.length > 1 ? 's' : ''})`);
  send(res, 201, capture);
}

async function listCaptures(res) {
  const out = [];
  const modelled = new Set();
  try {
    const idx = JSON.parse(await fs.readFile(path.join(MODELS, 'index.json'), 'utf8'));
    for (const m of idx.models ?? []) modelled.add(m.slug ?? m);
  } catch {
    // no models registered yet
  }
  let dirs = [];
  try {
    dirs = await fs.readdir(CAPTURES, { withFileTypes: true });
  } catch {
    return send(res, 200, []);
  }
  for (const d of dirs) {
    if (!d.isDirectory() || !SLUG_RE.test(d.name)) continue;
    try {
      const c = JSON.parse(await fs.readFile(path.join(CAPTURES, d.name, 'capture.json'), 'utf8'));
      if (modelled.has(c.slug)) c.status = 'modelled';
      out.push(c);
    } catch {
      // half-written or foreign folder
    }
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  send(res, 200, out);
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(ROOT, '.' + rel);
  if (!file.startsWith(ROOT + path.sep) || rel.split('/').some((s) => s.startsWith('.') && s.length > 1)) return send(res, 403, 'Forbidden', 'text/plain');
  try {
    const data = await fs.readFile(file);
    send(res, 200, data, TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname === '/api/captures' && req.method === 'POST') return await createCapture(req, res);
    if (pathname === '/api/captures' && req.method === 'GET') return await listCaptures(res);
    if (req.method === 'GET' || req.method === 'HEAD') return await serveStatic(req, res);
    send(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    send(res, err.status ?? (err instanceof SyntaxError ? 400 : 500), { error: err.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`Capture server running from ${ROOT}`);
  console.log(`  This computer:  http://localhost:${PORT}/capture.html`);
  for (const ip of lan) console.log(`  Phone (Wi-Fi):  http://${ip}:${PORT}/capture.html`);
  console.log('  Line Builder:   /builder.html · Megafactory: /index.html\n');
});
