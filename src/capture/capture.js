// Phone capture page: take or pick photos, add a name, size and role, then upload them to
// tools/capture-server.mjs, which writes captures/<slug>/ for the photo-to-model skill.
const MAX_SIDE = 2048; // downscale on the phone so uploads stay small
const MAX_PHOTOS = 6;
const VIEWS = ['front', 'side', 'three-quarter', 'back', 'top', 'detail'];

const $ = (id) => document.getElementById(id);
const shots = []; // { data, view }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read ${file.name || 'that image'}`));
    };
    img.src = url;
  });
}

// Browsers apply EXIF orientation when drawing an <img>, so the JPEG comes out upright.
async function downscale(file) {
  const { img, url } = await loadImage(file);
  const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return c.toDataURL('image/jpeg', 0.88);
}

async function addFiles(fileList) {
  const files = [...fileList].slice(0, MAX_PHOTOS - shots.length);
  if (fileList.length > files.length) setStatus(`Up to ${MAX_PHOTOS} photos per object`, 'err');
  for (const f of files) {
    try {
      shots.push({ data: await downscale(f), view: VIEWS[Math.min(shots.length, VIEWS.length - 1)] });
    } catch (err) {
      setStatus(err.message, 'err');
    }
  }
  renderShots();
}

function renderShots() {
  $('shots').innerHTML = shots
    .map((s, i) => `<div class="shot">
      <img src="${s.data}" alt="Photo ${i + 1}">
      <select data-i="${i}" aria-label="View of photo ${i + 1}">${VIEWS.map((v) => `<option ${v === s.view ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <button type="button" data-rm="${i}" aria-label="Remove photo ${i + 1}">×</button></div>`)
    .join('');
  $('shots').querySelectorAll('select').forEach((el) => el.addEventListener('change', () => { shots[el.dataset.i].view = el.value; }));
  $('shots').querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
    shots.splice(Number(b.dataset.rm), 1);
    renderShots();
  }));
  validate();
}

function validate() {
  $('submit').disabled = !shots.length || !$('name').value.trim();
}

function setStatus(msg, kind = '') {
  $('status').textContent = msg;
  $('status').className = kind;
}

for (const id of ['camera', 'gallery']) {
  $(id).addEventListener('change', async (e) => {
    await addFiles(e.target.files);
    e.target.value = ''; // allow the same photo to be picked again
  });
}
$('name').addEventListener('input', validate);

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if ($('submit').disabled) return;
  $('submit').disabled = true;
  setStatus('Uploading…');
  const body = {
    name: $('name').value.trim(),
    size: ['w', 'h', 'd'].map((k) => ($(k).value === '' ? null : Number($(k).value))),
    role: document.querySelector('input[name="role"]:checked').value,
    notes: $('notes').value.trim(),
    photos: shots,
  };
  try {
    const res = await fetch('./api/captures', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error ?? `Upload failed (${res.status})`);
    setStatus(`Saved as captures/${out.slug}/`, 'ok');
    shots.length = 0;
    $('form').reset();
    renderShots();
    loadList();
  } catch (err) {
    const offline = err instanceof TypeError;
    setStatus(offline ? 'Could not reach the capture server. Is "node tools/capture-server.mjs" running on this network?' : err.message, 'err');
    validate();
  }
});

async function loadList() {
  const list = $('list');
  try {
    const res = await fetch('./api/captures', { cache: 'no-store' });
    if (!res.ok) throw new Error();
    const caps = await res.json();
    list.innerHTML = caps.length
      ? caps.map((c) => `<div class="cap">
          <img src="./captures/${esc(c.slug)}/${esc(c.photos?.[0]?.file)}" alt="">
          <div><b>${esc(c.name)}</b><small>${esc(c.role)} · ${c.photos?.length ?? 0} photo${c.photos?.length === 1 ? '' : 's'}${c.size ? ` · ${c.size.map((v) => v ?? '?').join(' × ')} m` : ''}</small></div>
          <span class="badge ${esc(c.status)}">${esc(c.status)}</span></div>`).join('')
      : '<p class="muted">No captures yet.</p>';
  } catch {
    list.innerHTML = '<p class="muted">Start <code>node tools/capture-server.mjs</code> to upload and list captures. A plain static server can show this page but cannot receive photos.</p>';
  }
}

loadList();
