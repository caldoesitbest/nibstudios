/* ============================================================
   Files: library (cloud, IndexedDB or localStorage), open/save, place, export, autosave, sample
   ============================================================ */
// Sizes are in points (72 per inch). `units` is how the document displays them; `tpl` names a starter template.
const PRESETS = [
  { cat: 'Apparel', name: 'T-shirt print', w: 864, h: 1152, units: 'in', note: '12 × 16 in', tpl: 'printArea' },
  { cat: 'Apparel', name: 'Left chest logo', w: 288, h: 288, units: 'in', note: '4 × 4 in', tpl: 'printArea' },
  { cat: 'Apparel', name: 'Hoodie front', w: 1008, h: 1008, units: 'in', note: '14 × 14 in', tpl: 'printArea' },
  { cat: 'Apparel', name: 'Sleeve print', w: 216, h: 864, units: 'in', note: '3 × 12 in', tpl: 'printArea' },
  { cat: 'Apparel', name: 'Apparel flats', w: 792, h: 612, units: 'in', note: 'Tee front + back', tpl: 'flats' },
  { cat: 'Apparel', name: 'Tech pack', w: 792, h: 612, units: 'in', note: 'Spec sheet layout', tpl: 'techpack' },
  { cat: 'Print', name: 'Letter', w: 612, h: 792, units: 'in', note: '8.5 × 11 in' },
  { cat: 'Print', name: 'A4', w: 595.28, h: 841.89, units: 'mm', note: '210 × 297 mm' },
  { cat: 'Print', name: 'Tabloid', w: 792, h: 1224, units: 'in', note: '11 × 17 in' },
  { cat: 'Print', name: 'Poster', w: 1296, h: 1728, units: 'in', note: '18 × 24 in' },
  { cat: 'Print', name: 'Business card', w: 252, h: 144, units: 'in', note: '3.5 × 2 in' },
  { cat: 'Print', name: 'Sticker', w: 216, h: 216, units: 'in', note: '3 × 3 in' },
  { cat: 'Screen', name: 'Square post', w: 1080, h: 1080, units: 'px', note: '1080 × 1080 px' },
  { cat: 'Screen', name: 'Portrait post', w: 1080, h: 1350, units: 'px', note: '1080 × 1350 px' },
  { cat: 'Screen', name: 'Story', w: 1080, h: 1920, units: 'px', note: '1080 × 1920 px' },
  { cat: 'Screen', name: 'Web 1920', w: 1920, h: 1080, units: 'px', note: '1920 × 1080 px' },
  { cat: 'Screen', name: 'Logo', w: 1000, h: 1000, units: 'px', note: '1000 × 1000 px' },
  { cat: 'Screen', name: 'App icon', w: 1024, h: 1024, units: 'px', note: '1024 × 1024 px' },
];

/* ---------------- capabilities (only present inside claude.ai) ---------------- */
const CAP = { db: null, user: null, downloads: null, uid: null };
async function initCapabilities() {
  const cl = window.claude;
  if (!cl || typeof cl.use !== 'function') { updateLibState(); return; }
  const safe = p => p.then(x => x, () => null);
  const [dl, db, user] = await Promise.all([safe(cl.use('downloads')), safe(cl.use('db')), safe(cl.use('user'))]);
  CAP.downloads = dl; CAP.db = db; CAP.user = user;
  if (db && user) { try { CAP.uid = await user.id(); } catch { CAP.uid = null; } }
  updateLibState();
  if (typeof renderHome === 'function') renderHome();
}
const cloudLib = () => !!(CAP.db && CAP.uid);
function libLabel() { return cloudLib() ? 'Saved to your account' : 'Saved in this browser'; }
function updateLibState() {
  const el = $('#libState');
  if (el) { el.textContent = libLabel(); el.title = cloudLib() ? 'Saved projects are stored privately with this page for your account.' : 'Saved projects live in this browser on this device. Use File › Download Copy for a backup file.'; }
}

/* ---------------- IndexedDB ---------------- */
let idbPromise = null;
function idbOpen() {
  if (!idbPromise) idbPromise = new Promise((res, rej) => {
    let req;
    try { req = indexedDB.open('nib-library', 1); } catch (e) { rej(e); return; }
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error || new Error('IndexedDB unavailable'));
    req.onblocked = () => rej(new Error('IndexedDB blocked'));
  });
  idbPromise.catch(() => {});
  return idbPromise;
}
function idbTx(stores, mode, fn) {
  return idbOpen().then(d => new Promise((res, rej) => {
    const tx = d.transaction(stores, mode);
    let out;
    const r = fn(tx);
    if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
    tx.oncomplete = () => res(out);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error('Storage is full'));
  }));
}
let idbOK = null;
async function idbAvailable() {
  if (idbOK !== null) return idbOK;
  try { await idbOpen(); idbOK = true; } catch { idbOK = false; }
  if (idbOK) await migrateLocalLibrary();
  return idbOK;
}
async function migrateLocalLibrary() {
  const idx = lsGet('nib.lib.index', []);
  if (!idx.length) return;
  for (const m of idx) {
    let text = null;
    try { text = localStorage.getItem('nib.lib.f.' + m.id); } catch {}
    if (text == null) continue;
    try {
      await idbTx(['meta', 'files'], 'readwrite', tx => { tx.objectStore('meta').put(m); tx.objectStore('files').put(text, m.id); });
      lsDel('nib.lib.f.' + m.id);
    } catch { return; }
  }
  lsDel('nib.lib.index');
}
let persistAsked = false;
function askPersistence() {
  if (persistAsked) return;
  persistAsked = true;
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {}); } catch {}
}

/* ---------------- library ---------------- */
const CHUNK = 150000;
const Lib = {
  async list() {
    if (cloudLib()) {
      const snap = await CAP.db.collection(`data/users/${CAP.uid}`).get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => x.name).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    }
    if (await idbAvailable()) {
      const all = await idbTx(['meta'], 'readonly', tx => tx.objectStore('meta').getAll());
      return (all || []).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    }
    return lsGet('nib.lib.index', []).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  },
  async save(id, meta, text) {
    if (cloudLib()) {
      const base = CAP.db.collection(`data/users/${CAP.uid}`).doc(id);
      const n = Math.ceil(text.length / CHUNK) || 1;
      for (let i = 0; i < n; i++) await base.collection('chunks').doc(String(i)).set({ d: text.slice(i * CHUNK, (i + 1) * CHUNK) });
      const prev = await base.get();
      const prevN = prev.exists ? (prev.data().chunks || 0) : 0;
      await base.set({ ...meta, chunks: n });
      for (let i = n; i < prevN; i++) await base.collection('chunks').doc(String(i)).delete();
      return;
    }
    if (await idbAvailable()) {
      askPersistence();
      try { await idbTx(['meta', 'files'], 'readwrite', tx => { tx.objectStore('files').put(text, id); tx.objectStore('meta').put({ id, ...meta }); }); }
      catch { throw new Error('This browser is out of storage space.'); }
      return;
    }
    const idx = lsGet('nib.lib.index', []).filter(x => x.id !== id);
    try { localStorage.setItem('nib.lib.f.' + id, text); } catch { throw new Error('This browser is out of storage space.'); }
    idx.push({ id, ...meta });
    if (!lsSet('nib.lib.index', idx)) throw new Error('This browser is out of storage space.');
  },
  async load(id) {
    if (cloudLib()) {
      const base = CAP.db.collection(`data/users/${CAP.uid}`).doc(id);
      const m = await base.get();
      if (!m.exists) throw new Error('That project is no longer in your library.');
      const n = m.data().chunks || 1;
      let text = '';
      for (let i = 0; i < n; i++) { const c = await base.collection('chunks').doc(String(i)).get(); text += c.exists ? c.data().d : ''; }
      return text;
    }
    if (await idbAvailable()) {
      const text = await idbTx(['files'], 'readonly', tx => tx.objectStore('files').get(id));
      if (text == null) throw new Error('That project is no longer in this browser.');
      return text;
    }
    let text = null;
    try { text = localStorage.getItem('nib.lib.f.' + id); } catch {}
    if (text == null) throw new Error('That project is no longer in this browser.');
    return text;
  },
  async remove(id) {
    if (cloudLib()) {
      const base = CAP.db.collection(`data/users/${CAP.uid}`).doc(id);
      const m = await base.get();
      const n = m.exists ? (m.data().chunks || 1) : 0;
      for (let i = 0; i < n; i++) await base.collection('chunks').doc(String(i)).delete();
      await base.delete();
      return;
    }
    if (await idbAvailable()) { await idbTx(['meta', 'files'], 'readwrite', tx => { tx.objectStore('meta').delete(id); tx.objectStore('files').delete(id); }); return; }
    lsDel('nib.lib.f.' + id);
    lsSet('nib.lib.index', lsGet('nib.lib.index', []).filter(x => x.id !== id));
  },
  async rename(id, name) {
    const items = await Lib.list();
    const m = items.find(x => x.id === id);
    if (!m) return;
    const text = await Lib.load(id);
    let o = null;
    try { o = JSON.parse(text); o.name = name; } catch {}
    const { id: _ignored, ...rest } = m;
    await Lib.save(id, { ...rest, name, updated: Date.now() }, o ? JSON.stringify(o) : text);
  },
};

/* ---------------- downloads ---------------- */
async function offerFile(filename, data, mime) {
  if (CAP.downloads) {
    try { await CAP.downloads.save({ filename, data }); toastQuiet('Saved ' + filename); return true; }
    catch (e) {
      const code = e && e.code;
      if (code === 'declined') return false;
      if (code === 'rate_limited') { toast('A save prompt is already open.'); return false; }
      if (code === 'too_large') { toast('That file is too large to save here. Try a smaller size.'); return false; }
    }
  }
  try {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
    return true;
  } catch { toast('This browser blocked the download.'); return false; }
}
const safeName = s => (String(s || 'Untitled').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Untitled').slice(0, 80);

/* ---------------- save / open ---------------- */
async function makeThumb() {
  try {
    const ab = doc.artboards[0];
    const s = Math.min(1, 320 / Math.max(ab.w, ab.h));
    const cv = renderArtboardCanvas(0, s, '#ffffff');
    return cv.toDataURL('image/jpeg', 0.72);
  } catch { return ''; }
}
let saving = false;
async function saveDoc() {
  if (S.editingText) commitTextEdit();
  if (!doc.libId) { saveAs(); return false; }
  if (saving) return false;
  saving = true;
  try {
    const text = JSON.stringify(serializeDoc());
    const ab = doc.artboards[0];
    await Lib.save(doc.libId, { name: doc.name, updated: Date.now(), size: text.length, dims: `${fmtU(ab.w, false)} × ${fmtU(ab.h)}`, boards: doc.artboards.length, thumb: await makeThumb() }, text);
    S.dirty = false; S.autosaved = false;
    toast(`Saved “${doc.name}”`);
    scheduleAutosave();
    return true;
  } catch (e) {
    console.error(e);
    toast((e && e.message ? e.message : 'Saving failed.') + ' Use File › Download Copy to keep a file.', 6000);
    return false;
  } finally { saving = false; updateStatus(); }
}
function saveAs(after) {
  const f = fText('Name', doc.name);
  openDialog({
    title: 'Save As', body: [f.el, h('p', { class: 'hint' }, cloudLib() ? 'Saves to the library attached to this page, private to your account.' : 'Saves to this browser so it appears on the start screen. Use File › Download Copy for a backup file you can keep anywhere.')],
    buttons: [{ label: 'Download .nib.json instead', left: true, onClick: () => { doc.name = f.get().trim() || doc.name; downloadDoc().then(ok => { if (ok && after) after(); }); } }, { label: 'Cancel' },
      { label: 'Save', primary: true, onClick: () => { doc.name = f.get().trim() || doc.name; const prev = doc.libId; doc.libId = 'd' + uid(); saveDoc().then(ok => { if (ok) { if (after) after(); } else doc.libId = prev; }); } }],
  });
}
function downloadDoc() {
  if (S.editingText) commitTextEdit();
  const text = JSON.stringify(serializeDoc());
  return offerFile(safeName(doc.name) + '.nib.json', text, 'application/json').then(ok => { if (ok && !doc.libId) { S.dirty = false; updateStatus(); } return ok; });
}
function confirmDiscard(next) {
  if (!S.dirty) return next();
  openDialog({
    title: 'Unsaved changes', body: [h('p', null, `Save changes to “${doc.name}” before continuing?`)],
    buttons: [{ label: "Don't Save", left: true, onClick: () => { S.dirty = false; setTimeout(next, 0); } }, { label: 'Cancel' }, { label: 'Save', primary: true, onClick: () => { if (!doc.libId) { setTimeout(() => saveAs(next), 0); return; } saveDoc().then(ok => { if (ok) setTimeout(next, 0); }); } }],
  });
}
function afterLoad() {
  if (S.editingText) { S.editingText = null; ted.hidden = true; }
  S.isolated = null;
  sel.items = new Set(); sel.pts = new Map();
  for (const L of project.layers) for (const t of L.getItems({ class: paper.PointText })) ensureFont(t.fontFamily);
  resetHistory();
  S.dirty = false; S.autosaved = false;
  selectionChanged();
  fitArtboard();
  emit('doc');
  scheduleAutosave();
  if (typeof hideHome === 'function') hideHome();
}
async function openFromLibrary(id) {
  const text = await Lib.load(id);
  loadDocObject(JSON.parse(text));
  doc.libId = id;
  afterLoad();
  toastQuiet(`Opened “${doc.name}”`);
}
function openOpenDialog() { showHome(); }

/* ---------------- file picking, placing ---------------- */
let pickMode = 'open';
const fileInput = $('#fileInput');
const OPEN_ACCEPT = '.ai,.ait,.pdf,.json,.nib,.svg,image/svg+xml,application/pdf,image/png,image/jpeg,image/webp,image/gif';
function pickFile(mode) {
  pickMode = mode;
  fileInput.accept = mode === 'open' ? OPEN_ACCEPT : '.ai,.pdf,.svg,image/svg+xml,application/pdf,image/png,image/jpeg,image/webp,image/gif';
  fileInput.value = '';
  fileInput.click();
}
fileInput.addEventListener('change', () => {
  const f = fileInput.files && fileInput.files[0];
  if (!f) return;
  if (pickMode === 'open') openFile(f); else placeFile(f, view.center);
});
const isSVGFile = f => /\.svg$/i.test(f.name) || f.type === 'image/svg+xml';
const isJSONFile = f => /\.(json|nib)$/i.test(f.name) || f.type === 'application/json';
const isAIorPDF = f => /\.(ai|ait|pdf)$/i.test(f.name) || f.type === 'application/pdf' || f.type === 'application/illustrator' || f.type === 'application/postscript';
function readText(f) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(f); }); }
function readDataURL(f) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); }); }
function loadImage(url) { return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = url; }); }
async function openFile(f) {
  try {
    if (isAIorPDF(f)) { await openAIFile(f); return; }
    if (isJSONFile(f)) {
      const o = JSON.parse(await readText(f));
      loadDocObject(o); doc.libId = null; afterLoad();
      toastQuiet(`Opened ${f.name}`);
    } else if (isSVGFile(f)) {
      const text = await readText(f);
      const item = parseSVG(text);
      const page = svgPageSize(text);
      const name = f.name.replace(/\.svg$/i, '');
      if (page) {
        doc = newDocModel(name, page.w, page.h, page.unit);
        if (Math.abs(page.k - 1) > 1e-6) item.scale(page.k, P(0, 0));
      } else {
        const b = item.bounds;
        doc = newDocModel(name, Math.max(1, Math.round(b.width)) || 800, Math.max(1, Math.round(b.height)) || 600);
        item.translate(P(-b.x, -b.y));
      }
      project.clear(); const L = newLayer('Layer 1');
      L.addChild(item);
      registerRasters(); afterLoad();
    } else if (f.type.startsWith('image/')) {
      const url = await readDataURL(f), img = await loadImage(url);
      doc = newDocModel(f.name.replace(/\.\w+$/, ''), img.naturalWidth, img.naturalHeight);
      project.clear(); newLayer('Layer 1');
      const r = new paper.Raster({ insert: false }); r.image = img;
      activeLayer().addChild(r);
      r.position = P(img.naturalWidth / 2, img.naturalHeight / 2);
      const id = 'img' + uid(); doc.images[id] = url; r.data.imgId = id;
      afterLoad();
    } else toast('Nib opens Illustrator (.ai) and PDF files, Nib projects (.nib.json), SVG files, and PNG, JPG, WebP or GIF images.');
  } catch (e) { console.error(e); toast('That file could not be opened. ' + friendlyError(e)); }
}
function friendlyError(e) {
  const m = String((e && e.message) || e || '');
  if (/JSON/.test(m)) return "It isn't a valid Nib project file (it may be damaged or incomplete).";
  if (/PDF structure|reference points|XRef|Invalid PDF|stream|dictionary/i.test(m)) return 'The file looks damaged or incomplete. Try exporting it again from the app that made it.';
  return m;
}
// The page size an SVG declares, in points. The importer sizes artwork to the bare numbers in width/height,
// so `k` converts those numbers to points (e.g. an Inkscape file in millimetres).
function svgPageSize(text) {
  const root = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') return null;
  const PT = { '': 1, px: 1, pt: 1, pc: 12, in: 72, mm: 72 / 25.4, cm: 72 / 2.54 };
  const len = s => { const m = /^\s*([\d.]+(?:e[-+]?\d+)?)\s*(px|pt|pc|in|mm|cm)?\s*$/i.exec(s || ''); return m && +m[1] > 0 ? { v: +m[1], u: (m[2] || '').toLowerCase() } : null; };
  const W = len(root.getAttribute('width')), Hh = len(root.getAttribute('height'));
  const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const hasVB = vb.length === 4 && vb.every(isFinite) && vb[2] > 0 && vb[3] > 0;
  const unit = W && ['in', 'mm', 'cm'].includes(W.u) ? W.u : W && W.u === 'pt' ? 'pt' : 'px';
  if (W && Hh) return { w: W.v * PT[W.u], h: Hh.v * PT[Hh.u], k: PT[W.u], unit };
  if (hasVB) return { w: vb[2], h: vb[3], k: 1, unit: 'px' };
  return null;
}
function parseSVG(text) {
  const xml = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (xml.querySelector('parsererror') || !xml.documentElement || xml.documentElement.nodeName.toLowerCase() !== 'svg') throw new Error('This SVG file is damaged or incomplete.');
  const item = project.importSVG(text, { expandShapes: true, insert: false });
  if (!item || !item.bounds || !isFinite(item.bounds.width) || (item.children && !item.children.length)) throw new Error('This SVG has no artwork in it.');
  if (item.children) for (const c of [...item.children]) if (c instanceof paper.Shape && c.clipMask) c.remove();
  return item;
}
async function placeFile(f, at) {
  try {
    if (isJSONFile(f)) return confirmDiscard(() => openFile(f));
    if (!canDrawOnLayer()) return;
    if (isAIorPDF(f)) return placeAIFile(f, at);
    if (isSVGFile(f)) return placeSVGString(await readText(f), at, f.name);
    if (f.type.startsWith('image/')) {
      const url = await readDataURL(f), img = await loadImage(url);
      return placeImage(img, url, at, f.name);
    }
    toast('Place accepts Illustrator, PDF and SVG files, and PNG, JPG, WebP or GIF images.');
  } catch (e) { console.error(e); toast('That file could not be placed.'); }
}
function placeSVGString(text, at, name) {
  try {
    const item = parseSVG(text);
    const page = svgPageSize(text);
    if (page && Math.abs(page.k - 1) > 1e-6) item.scale(page.k, P(0, 0));
    placeNew(item);
    if (name) item.name = name.replace(/\.svg$/i, '');
    item.position = at || view.center;
    registerRasters();
    setSelection([item]); commit('Place');
  } catch (e) { console.error(e); toast('That SVG could not be read.'); }
}
function placeImage(img, url, at, name) {
  const r = new paper.Raster({ insert: false }); r.image = img;
  placeNew(r);
  const ab = activeAB(), s = Math.min(1, ab.w / img.naturalWidth, ab.h / img.naturalHeight);
  if (s < 1) r.scale(s);
  r.position = at || view.center;
  const id = 'img' + uid(); doc.images[id] = url; r.data.imgId = id;
  if (name) r.name = name;
  setSelection([r]); commit('Place Image');
}
document.addEventListener('paste', async e => {
  if (dialogOpen || isTypingTarget(e.target) || homeVisible()) return;
  const dt = e.clipboardData;
  if (!dt) return;
  const img = [...(dt.files || [])].find(f => f.type.startsWith('image/') && f.type !== 'image/svg+xml');
  if (img) { e.preventDefault(); placeFile(img, view.center); return; }
  const text = dt.getData('image/svg+xml') || dt.getData('text/plain') || '';
  if (clip && (!text || text === clip.svg)) { e.preventDefault(); pasteClip('center'); return; }
  if (/^\s*(<\?xml|<svg)/i.test(text)) { e.preventDefault(); if (canDrawOnLayer()) placeSVGString(text, view.center, 'Pasted SVG'); return; }
  if (text.trim()) {
    e.preventDefault();
    if (!canDrawOnLayer()) return;
    const t = placeNew(new paper.PointText({ point: view.center, content: text.slice(0, 5000), insert: false }));
    t.fillColor = paperColor(C(0, 0, 0, 1)); t.fontFamily = S.text.family; t.fontSize = S.text.size; t.justification = 'center';
    setSelection([t]); commit('Paste Text');
  }
});

/* ---------------- export ---------------- */
function cleanSVG(svg) { svg.querySelectorAll('[data-paper-data]').forEach(n => n.removeAttribute('data-paper-data')); }
function buildSVG(items, rect) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('xmlns', NS);
  svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  svg.setAttribute('version', '1.1');
  const f = isPrintUnits() ? UD().f : 1, u = isPrintUnits() && unitKey() !== 'pt' ? unitKey() : '';
  svg.setAttribute('width', fmt(rect.width * f, 4) + u); svg.setAttribute('height', fmt(rect.height * f, 4) + u);
  svg.setAttribute('viewBox', `${fmt(rect.x, 3)} ${fmt(rect.y, 3)} ${fmt(rect.width, 3)} ${fmt(rect.height, 3)}`);
  let defs = null;
  const ensureDefs = () => { if (!defs) { defs = document.createElementNS(NS, 'defs'); svg.insertBefore(defs, svg.firstChild); } return defs; };
  let fx = 0;
  const onExport = (item, node) => {
    if (item.hasShadow && item.hasShadow() && node.setAttribute) {
      const id = 'nib-shadow-' + (++fx);
      const c = item.shadowColor, o = item.shadowOffset || P(0, 0);
      const flt = document.createElementNS(NS, 'filter');
      flt.setAttribute('id', id); flt.setAttribute('x', '-50%'); flt.setAttribute('y', '-50%'); flt.setAttribute('width', '200%'); flt.setAttribute('height', '200%');
      const ds = document.createElementNS(NS, 'feDropShadow');
      ds.setAttribute('dx', fmt(o.x, 3)); ds.setAttribute('dy', fmt(o.y, 3)); ds.setAttribute('stdDeviation', fmt((item.shadowBlur || 0) / 2, 3));
      ds.setAttribute('flood-color', c.toCSS(true)); ds.setAttribute('flood-opacity', fmt(c.alpha, 3));
      flt.appendChild(ds); ensureDefs().appendChild(flt);
      node.setAttribute('filter', `url(#${id})`);
    }
    return node;
  };
  for (const it of items) {
    const node = it.exportSVG({ asString: false, precision: 3, embedImages: true, matchShapes: false, onExport });
    if (!node) continue;
    if (node.nodeName.toLowerCase() === 'svg') {
      for (const ch of [...node.childNodes]) {
        if (ch.nodeName.toLowerCase() === 'defs') [...ch.childNodes].forEach(d => ensureDefs().appendChild(d));
        else svg.appendChild(ch);
      }
    } else svg.appendChild(node);
  }
  cleanSVG(svg);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
}
function artboardSVG(i) {
  const ab = doc.artboards[i];
  return buildSVG(project.layers.filter(L => L.visible && L.children.length), abRect(ab));
}
function exportSelectionSVG() {
  const items = selItems();
  if (!items.length) return;
  const sb = items.reduce((r, it) => r ? r.unite(it.strokeBounds) : it.strokeBounds.clone(), null);
  offerFile(safeName(doc.name) + '-selection.svg', buildSVG(items, sb), 'image/svg+xml');
}
function renderArtboardCanvas(i, scale, bg) {
  const ab = doc.artboards[i];
  const W = Math.max(1, Math.round(ab.w * scale)), Hh = Math.max(1, Math.round(ab.h * scale));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = Hh;
  const ctx = cv.getContext('2d');
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, Hh); }
  const m = new paper.Matrix().scale(scale).translate(-ab.x, -ab.y);
  const hidden = S.editingText && alive(S.editingText) ? S.editingText : null;
  if (hidden) hidden.visible = true;
  for (const L of project.layers) {
    if (!L.visible || !L.children.length) continue;
    ctx.save();
    m.applyToContext(ctx);
    L.draw(ctx, new paper.Base({ matrices: [m], pixelRatio: scale }));
    ctx.restore();
  }
  if (hidden) hidden.visible = false;
  return cv;
}
function canvasBlob(cv, type, q) { return new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('The image was too large to encode. Try a lower resolution.')), type, q)); }
const MAX_EXPORT_PX = 16384;
function openExportDialog(format = 'png') {
  if (S.editingText) commitTextEdit();
  const print = isPrintUnits();
  const fmtSel = fSel('Format', format, [['png', 'PNG image'], ['jpg', 'JPG image'], ['svg', 'SVG vector'], ['pdf', 'PDF (print, opens in Illustrator)']]);
  const abOpts = doc.artboards.map((a, i) => [String(i), `${i + 1} - ${a.name} (${fmtU(a.w, false)} × ${fmtU(a.h)})`]);
  if (doc.artboards.length > 1) abOpts.push(['all', 'All artboards']);
  const abSel = fSel('Artboard', String(doc.ab), abOpts);
  const resSel = fSel('Resolution', print ? '300' : '1x', [['1x', 'Screen (1×, 72 ppi)'], ['2x', '2×'], ['3x', '3×'], ['4x', '4×'], ['150', '150 ppi'], ['300', '300 ppi (print)'], ['600', '600 ppi']]);
  const bgChk = fChk('Transparent background', true);
  const qual = h('input', { type: 'range', min: '0.5', max: '1', step: '0.05', value: '0.92', id: 'expQ', style: { width: '100%' } });
  const qualRow = h('label', { class: 'f', for: 'expQ' }, h('span', null, 'Quality'), qual);
  const info = h('p', { class: 'hint num' });
  const scaleOf = v => v.endsWith('x') ? parseFloat(v) : parseFloat(v) / 72;
  const sync = () => {
    const f = fmtSel.get(), sel = abSel.get(), ab = doc.artboards[sel === 'all' ? 0 : +sel], s = scaleOf(resSel.get());
    resSel.el.hidden = f === 'svg' || f === 'pdf'; bgChk.el.hidden = f !== 'png'; qualRow.hidden = f !== 'jpg';
    abSel.el.hidden = doc.artboards.length < 2;
    if (f === 'svg') info.textContent = `Vector file at ${fmtU(ab.w, false)} × ${fmtU(ab.h)}.`;
    else if (f === 'pdf') info.textContent = `Vector PDF, one page per artboard. Text uses standard PDF fonts; gradients keep their colors but not stop transparency.`;
    else { const W = Math.round(ab.w * s), Hh = Math.round(ab.h * s); info.textContent = `Output: ${W} × ${Hh} px` + (W > MAX_EXPORT_PX || Hh > MAX_EXPORT_PX ? ' — too large, pick a lower resolution.' : ''); }
  };
  [fmtSel.input, abSel.input, resSel.input].forEach(x => x.addEventListener('change', sync));
  sync();
  openDialog({
    title: 'Export', body: [fmtSel.el, abSel.el, resSel.el, bgChk.el, qualRow, info],
    buttons: [{ label: 'Cancel' }, { label: 'Export', primary: true, onClick: () => {
      const f = fmtSel.get(), sel = abSel.get(), s = scaleOf(resSel.get());
      const list = sel === 'all' ? doc.artboards.map((_, i) => i) : [+sel];
      (async () => {
        try {
          if (f === 'pdf') { const bytes = await buildPDF(list); await offerFile(safeName(doc.name) + '.pdf', new Blob([bytes], { type: 'application/pdf' }), 'application/pdf'); return; }
          for (const i of list) {
            const ab = doc.artboards[i];
            const base = safeName(doc.name) + (doc.artboards.length > 1 ? '-' + safeName(ab.name) : '');
            if (f === 'svg') { await offerFile(base + '.svg', artboardSVG(i), 'image/svg+xml'); continue; }
            if (ab.w * s > MAX_EXPORT_PX || ab.h * s > MAX_EXPORT_PX) { toast('That size is too large to export. Choose a lower resolution.'); return; }
            if (f === 'png') await offerFile(base + '.png', await canvasBlob(renderArtboardCanvas(i, s, bgChk.get() ? null : '#ffffff'), 'image/png'), 'image/png');
            else await offerFile(base + '.jpg', await canvasBlob(renderArtboardCanvas(i, s, '#ffffff'), 'image/jpeg', +qual.value), 'image/jpeg');
          }
        } catch (e) { console.error(e); toast('Export failed: ' + (e.message || e)); }
      })();
    } }],
  });
}

/* ---------------- new document, setup, artboards ---------------- */
function newDocument(name, w, hh, units, tpl) {
  doc = newDocModel(name, w, hh, units);
  project.clear();
  newLayer('Layer 1');
  doc.libId = null;
  if (tpl && typeof TEMPLATES !== 'undefined' && TEMPLATES[tpl]) { try { TEMPLATES[tpl](); } catch (e) { console.error(e); } }
  afterLoad();
}
function newFromPreset(p, name) {
  const run = () => newDocument(name || (p.tpl === 'flats' || p.tpl === 'techpack' ? p.name : 'Untitled-' + (lsGet('nib.newCount', 0) + 1)), p.w, p.h, p.units, p.tpl);
  lsSet('nib.newCount', lsGet('nib.newCount', 0) + 1);
  confirmDiscard(run);
}
function openNewDialog() {
  const nameF = fText('Name', 'Untitled-' + (lsGet('nib.newCount', 0) + 1));
  let units = 'in', pick = PRESETS[0];
  const unitSel = fSel('Units', units, Object.keys(UNIT_DEFS).map(k => [k, UNIT_DEFS[k].name]));
  const conv = v => v * UNIT_DEFS[units].f, back = v => v / UNIT_DEFS[units].f;
  const wF = fNum('Width', conv(pick.w), { unit: units, decimals: UNIT_DEFS[units].dec }), hF = fNum('Height', conv(pick.h), { unit: units, decimals: UNIT_DEFS[units].dec });
  const refresh = () => {
    $$('.unit', wF.el).concat($$('.unit', hF.el)).forEach(u => u.textContent = units);
  };
  unitSel.input.addEventListener('change', () => {
    const w = back(wF.get()), hh = back(hF.get());
    units = unitSel.get(); unitSel.input.value = units;
    wF.set(+fmt(conv(w), UNIT_DEFS[units].dec)); hF.set(+fmt(conv(hh), UNIT_DEFS[units].dec)); refresh();
  });
  const groups = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });
  for (const cat of ['Apparel', 'Print', 'Screen']) {
    const grid = h('div', { class: 'presets' });
    PRESETS.filter(p => p.cat === cat).forEach(p => {
      const b = h('button', { class: 'preset' + (p === pick ? ' on' : ''), type: 'button' }, h('b', null, p.name), h('span', null, p.note));
      b.addEventListener('click', () => {
        pick = p; units = p.units; unitSel.input.value = units;
        wF.set(+fmt(conv(p.w), UNIT_DEFS[units].dec)); hF.set(+fmt(conv(p.h), UNIT_DEFS[units].dec)); refresh();
        $$('.preset', groups).forEach(x => x.classList.remove('on')); b.classList.add('on');
      });
      grid.append(b);
    });
    groups.append(h('div', { class: 'cap' }, cat), grid);
  }
  openDialog({
    title: 'New Document', wide: true,
    body: [nameF.el, groups, h('div', { class: 'grid2' }, wF.el, hF.el), unitSel.el],
    buttons: [{ label: 'Cancel' }, { label: 'Create', primary: true, onClick: () => {
      const W = back(wF.get()), Hh = back(hF.get());
      if (!(W > 0) || !(Hh > 0)) { toast('Width and height must be greater than zero.'); return false; }
      lsSet('nib.newCount', lsGet('nib.newCount', 0) + 1);
      const sameSize = Math.abs(W - pick.w) < 0.5 && Math.abs(Hh - pick.h) < 0.5;
      newDocument(nameF.get().trim() || 'Untitled', W, Hh, units, sameSize ? pick.tpl : null);
    } }],
  });
}
function openDocSetup() {
  const ab = activeAB();
  const nameF = fText('Document name', doc.name);
  const abName = fText('Artboard name', ab.name);
  const unitSel = fSel('Units', unitKey(), Object.keys(UNIT_DEFS).map(k => [k, UNIT_DEFS[k].name]));
  const wF = fLen('Artboard width', ab.w), hF = fLen('Artboard height', ab.h);
  const gF = fLen('Grid every', S.view.gridSize), sF = fNum('Subdivisions', S.view.gridSub, { step: 1 });
  const nF = fLen('Keyboard increment', S.nudge);
  openDialog({
    title: 'Document Setup', body: [nameF.el, unitSel.el, abName.el, wF.el, hF.el, h('div', { class: 'cap' }, 'Grid & nudging'), gF.el, sF.el, nF.el,
      h('p', { class: 'hint' }, 'Sizes use the units shown when the dialog opened. Changing units only changes how measurements are displayed.')],
    buttons: [{ label: 'Edit Artboards', left: true, onClick: () => setTool('artboard') }, { label: 'Cancel' }, { label: 'OK', primary: true, onClick: () => {
      const w = wF.get(), hh = hF.get(), g = gF.get(), n = nF.get();
      doc.name = nameF.get().trim() || doc.name;
      ab.name = abName.get().trim() || ab.name;
      if (w > 0) ab.w = w; if (hh > 0) ab.h = hh;
      if (g > 0) S.view.gridSize = g;
      if (sF.get() >= 1) S.view.gridSub = Math.round(sF.get());
      if (n > 0) S.nudge = n;
      doc.units = unitSel.get();
      lsSet('nib.view', S.view);
      commit('Document Setup');
    } }],
  });
}
function fitArtboardTo(what) {
  const items = what === 'sel' ? selItems() : project.layers.flatMap(L => L.children.filter(c => c.visible));
  const b = items.reduce((r, it) => r ? r.unite(it.strokeBounds) : it.strokeBounds.clone(), null);
  if (!b) return toast('There is no artwork to fit the artboard to.');
  Object.assign(activeAB(), { x: b.x, y: b.y, w: Math.max(1, b.width), h: Math.max(1, b.height) });
  commit('Fit Artboard');
}
function newArtboard() {
  const ab = activeAB();
  const right = Math.max(...doc.artboards.map(a => a.x + a.w));
  doc.artboards.push({ name: `Artboard ${doc.artboards.length + 1}`, x: right + 60, y: ab.y, w: ab.w, h: ab.h });
  doc.ab = doc.artboards.length - 1;
  commit('New Artboard');
  fitArtboard();
}

/* ---------------- autosave ---------------- */
const scheduleAutosave = debounce(() => {
  try {
    if (S.editingText) return;
    const payload = JSON.stringify({ doc: serializeDoc(), libId: doc.libId, dirty: S.dirty, zoom: zoom(), center: [view.center.x, view.center.y], t: Date.now() });
    if (payload.length < 4.5e6) { localStorage.setItem('nib.autosave', payload); if (S.dirty) S.autosaved = true; }
    else if (window.indexedDB) idbTx(['files'], 'readwrite', tx => tx.objectStore('files').put(payload, '__autosave__')).then(() => { lsSet('nib.autosave', { big: true, t: Date.now() }); if (S.dirty) S.autosaved = true; }).catch(() => {});
  } catch {}
  updateStatus();
}, 1200);
async function readAutosave() {
  let o = null;
  try { o = JSON.parse(localStorage.getItem('nib.autosave') || 'null'); } catch {}
  if (o && o.big) { try { o = JSON.parse(await idbTx(['files'], 'readonly', tx => tx.objectStore('files').get('__autosave__')) || 'null'); } catch { o = null; } }
  return o && o.doc ? o : null;
}
async function restoreAutosave() {
  const o = await readAutosave();
  if (!o) return false;
  try {
    loadDocObject(o.doc);
    doc.libId = o.libId || null;
    sel.items = new Set(); sel.pts = new Map();
    resetHistory();
    S.dirty = !!o.dirty; S.autosaved = !!o.dirty;
    for (const L of project.layers) for (const t of L.getItems({ class: paper.PointText })) ensureFont(t.fontFamily);
    if (o.zoom && o.center) { view.zoom = o.zoom; view.center = P(o.center[0], o.center[1]); } else fitArtboard();
    return true;
  } catch (e) { console.warn('Autosave could not be restored', e); return false; }
}

/* ---------------- sample artwork ---------------- */
function buildSample() {
  doc = newDocModel('Summit Poster (sample)', 1080, 1350);
  doc.artboards[0].name = 'Poster';
  project.clear();
  const col = (r, g, b, a = 1) => paperColor(C(r, g, b, a));
  const bg = newLayer('Background');
  const sky = makeRect(new paper.Rectangle(0, 0, 1080, 1350), 0);
  bg.addChild(sky); sky.name = 'Sky';
  sky.fillColor = paintToPaper({ type: 'linear', angle: 90, stops: [{ c: C(18, 27, 58, 1), o: 0 }, { c: C(86, 62, 118, 1), o: 0.55 }, { c: C(242, 152, 92, 1), o: 1 }] }, sky);
  const art = newLayer('Artwork');
  const sun = makeEllipse(new paper.Rectangle(330, 470, 420, 420));
  art.addChild(sun); sun.name = 'Sun';
  sun.fillColor = paintToPaper({ type: 'radial', angle: 0, stops: [{ c: C(255, 246, 220, 1), o: 0 }, { c: C(255, 196, 120, 1), o: 0.55 }, { c: C(255, 150, 96, 0), o: 1 }] }, sun);
  const far = new paper.Path({ segments: [[0, 900], [120, 780], [230, 840], [380, 660], [520, 800], [640, 700], [760, 780], [900, 620], [1080, 760], [1080, 1350], [0, 1350]], closed: true, insert: false });
  art.addChild(far); far.name = 'Far range'; far.fillColor = col(92, 72, 132);
  const snow = new paper.Path({ segments: [[380, 660], [430, 718], [402, 712], [372, 740], [350, 700]], closed: true, insert: false });
  art.addChild(snow); snow.name = 'Snowcap'; snow.fillColor = col(236, 226, 246, 0.9);
  const near = new paper.Path({ segments: [[0, 1010], [200, 880], [360, 960], [560, 820], [760, 980], [920, 900], [1080, 960], [1080, 1350], [0, 1350]], closed: true, insert: false });
  near.segments.slice(1, 7).forEach(s => s.smooth({ type: 'catmull-rom' }));
  art.addChild(near); near.name = 'Near range'; near.fillColor = col(36, 32, 70);
  const trail = new paper.Path({ segments: [[300, 1350], [430, 1170], [520, 1090], [598, 1000]], insert: false });
  trail.smooth({ type: 'catmull-rom' });
  art.addChild(trail); trail.name = 'Trail'; trail.strokeColor = col(255, 214, 170, 0.85); trail.strokeWidth = 6; trail.dashArray = [1, 16]; trail.strokeCap = 'round';
  for (const [x, y, r] of [[170, 190, 16], [880, 250, 11], [770, 150, 7], [300, 330, 6], [960, 440, 9], [90, 520, 6]]) {
    const st = makeStar(P(x, y), r, r * 0.38, 4, 0);
    art.addChild(st); st.fillColor = col(255, 240, 214, 0.95);
  }
  const title = new paper.PointText({ point: [540, 300], content: 'SUMMIT', insert: false });
  art.addChild(title);
  Object.assign(title, { justification: 'center', fontFamily: fontCSS('Bebas Neue'), fontSize: 240, fillColor: col(255, 243, 226) });
  const sub = new paper.PointText({ point: [540, 372], content: 'SAMPLE ARTWORK  ·  CTRL+A THEN DELETE TO START FRESH', insert: false });
  art.addChild(sub);
  Object.assign(sub, { justification: 'center', fontFamily: fontCSS('IBM Plex Mono'), fontSize: 19, fillColor: col(255, 243, 226, 0.72) });
  const foot = new paper.PointText({ point: [540, 1262], content: 'ELEVATION 4,392 M', insert: false });
  art.addChild(foot);
  Object.assign(foot, { justification: 'center', fontFamily: fontCSS('Oswald'), fontSize: 36, fillColor: col(255, 243, 226, 0.9) });
  art.activate();
  ensureFont(fontCSS('Bebas Neue')); ensureFont(fontCSS('Oswald')); ensureFont(fontCSS('IBM Plex Mono'));
}
function openSample() { confirmDiscard(() => { buildSample(); afterLoad(); }); }
