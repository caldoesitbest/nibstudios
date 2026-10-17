/* ============================================================
   State, document model, selection, history, serialization
   ============================================================ */
const cvPaper = $('#cvPaper');
paper.setup(cvPaper);
const view = paper.view;
const project = paper.project;

const LAYER_COLORS = ['#4f8cff', '#ff4f6d', '#2bd17e', '#2fc8e8', '#ff9f43', '#b36bff', '#e2b400', '#ff6fd8', '#7cc34f'];
const DEFAULT_SWATCHES = [
  null,
  solid('#FFFFFF'), solid('#000000'), solid('#BFBFBF'), solid('#808080'), solid('#404040'),
  solid('#E53935'), solid('#FB8C00'), solid('#FDD835'), solid('#7CB342'), solid('#43A047'),
  solid('#00897B'), solid('#00ACC1'), solid('#1E88E5'), solid('#3949AB'), solid('#8E24AA'),
  solid('#D81B60'), solid('#6D4C41'), solid('#F4D9C6'), solid('#1B2A4A'), solid('#F2A65A'),
  { type: 'linear', angle: 0, stops: [{ c: C(255, 255, 255, 1), o: 0 }, { c: C(0, 0, 0, 1), o: 1 }] },
  { type: 'radial', angle: 0, stops: [{ c: C(255, 255, 255, 1), o: 0 }, { c: C(0, 0, 0, 1), o: 1 }] },
  { type: 'linear', angle: 0, stops: [{ c: C(255, 126, 95, 1), o: 0 }, { c: C(254, 180, 123, 1), o: 1 }] },
  { type: 'linear', angle: 0, stops: [{ c: C(33, 147, 176, 1), o: 0 }, { c: C(109, 213, 237, 1), o: 1 }] },
  { type: 'linear', angle: 0, stops: [{ c: C(131, 58, 180, 1), o: 0 }, { c: C(253, 29, 29, 1), o: 0.5 }, { c: C(252, 176, 69, 1), o: 1 }] },
];
const FONTS = [
  ['Roboto', 'sans-serif'], ['IBM Plex Sans', 'sans-serif'], ['Montserrat', 'sans-serif'], ['Oswald', 'sans-serif'],
  ['Bebas Neue', 'sans-serif'], ['Playfair Display', 'serif'], ['DM Serif Display', 'serif'], ['Lora', 'serif'],
  ['Pacifico', 'cursive'], ['Caveat', 'cursive'], ['JetBrains Mono', 'monospace'], ['IBM Plex Mono', 'monospace'],
  ['Arial', 'sans-serif'], ['Helvetica', 'sans-serif'], ['Verdana', 'sans-serif'], ['Trebuchet MS', 'sans-serif'],
  ['Georgia', 'serif'], ['Times New Roman', 'serif'], ['Courier New', 'monospace'], ['Impact', 'sans-serif'],
];
const fontCSS = name => { const f = FONTS.find(x => x[0] === name); return `"${name}", ${f ? f[1] : 'sans-serif'}`; };
const fontName = css => (String(css || '').split(',')[0] || '').replace(/["']/g, '').trim();

const S = {
  tool: 'select', lastSelTool: 'select',
  style: { fill: solid('#FFFFFF'), stroke: solid('#000000'), strokeWidth: 1, focus: 'fill',
    lastSolid: { fill: solid('#FFFFFF'), stroke: solid('#000000') },
    lastGradient: { type: 'linear', angle: 0, stops: [{ c: C(255, 255, 255, 1), o: 0 }, { c: C(0, 0, 0, 1), o: 1 }] } },
  text: { family: fontCSS('Roboto'), size: 36, weight: 'normal', justification: 'left' },
  view: { rulers: true, guides: true, lockGuides: false, grid: false, snapGrid: false, smart: true, outline: false, bbox: true, gridSize: 20, gridSub: 4 },
  shape: { sides: 6, points: 5, ratio: 0.5, radius: 12 },
  refPt: 4, lockRatio: false, alignTo: 'selection', nudge: 1, moveArt: true,
  hover: null, snapLines: null, label: null, marquee: null,
  editingText: null, lastXform: null, dirty: false, isolated: null,
};

let doc = null;
const sel = { items: new Set(), pts: new Map() };

function newDocModel(name, w, h, units) {
  return { name, units: UNIT_DEFS[units] ? units : 'px', artboards: [{ name: 'Artboard 1', x: 0, y: 0, w, h }], ab: 0, guides: { v: [], h: [] }, swatches: clonePaint(DEFAULT_SWATCHES), patterns: [], images: {}, libId: null };
}
const activeAB = () => doc.artboards[clamp(doc.ab, 0, doc.artboards.length - 1)];

/* ---------------- units (internal unit is the point/px: 72 per inch) ---------------- */
const UNIT_DEFS = {
  px: { f: 1, dec: 2, name: 'Pixels' },
  pt: { f: 1, dec: 2, name: 'Points' },
  in: { f: 1 / 72, dec: 3, name: 'Inches' },
  mm: { f: 25.4 / 72, dec: 2, name: 'Millimeters' },
  cm: { f: 2.54 / 72, dec: 3, name: 'Centimeters' },
};
const unitKey = () => (doc && UNIT_DEFS[doc.units]) ? doc.units : 'px';
const UD = () => UNIT_DEFS[unitKey()];
const toU = v => v * UD().f;
const fromU = v => v / UD().f;
const fmtU = (v, withUnit = true) => fmt(toU(v), UD().dec) + (withUnit ? ' ' + unitKey() : '');
const strokeUnit = () => unitKey() === 'px' ? 'px' : 'pt';
const isPrintUnits = () => ['in', 'mm', 'cm', 'pt'].includes(unitKey());
const abRect = ab => new paper.Rectangle(ab.x, ab.y, ab.w, ab.h);
function newLayer(name, above) {
  const L = new paper.Layer({ name: name || `Layer ${project.layers.length + 1}` });
  L.data.color = LAYER_COLORS[(project.layers.length - 1) % LAYER_COLORS.length];
  if (above && above.isInserted()) L.insertAbove(above);
  L.activate();
  return L;
}
function activeLayer() {
  let L = project.activeLayer;
  if (!L || !L.isInserted()) { L = project.layers[project.layers.length - 1] || newLayer(); L.activate(); }
  return L;
}

/* ---------------- item helpers ---------------- */
const isLayer = it => it instanceof paper.Layer;
const isPath = it => it instanceof paper.Path;
const isCompound = it => it instanceof paper.CompoundPath;
const isPathLike = it => isPath(it) || isCompound(it);
const isText = it => it instanceof paper.PointText;
const isRaster = it => it instanceof paper.Raster;
const isGroup = it => it instanceof paper.Group && !isLayer(it);
const alive = it => !!it && it.isInserted() && it.project === project;
function isEditable(it) {
  for (let p = it; p; p = p.parent) { if (!p.visible || p.locked) return false; }
  return true;
}
function topLevel(it) { while (it && it.parent && !isLayer(it.parent)) it = it.parent; return it; }
function hasSelectedAncestor(it) { for (let p = it.parent; p && !isLayer(p); p = p.parent) if (sel.items.has(p)) return true; return false; }
function zKey(it) { const k = []; for (let p = it; p; p = p.parent) k.unshift(p.index); return k; }
function zCmp(a, b) { const x = zKey(a), y = zKey(b); for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i]; return x.length - y.length; }
function selItems() {
  const out = [];
  for (const it of sel.items) if (alive(it) && !hasSelectedAncestor(it)) out.push(it);
  return out.sort(zCmp);
}
function leafPaths(it, out = []) {
  if (!it || !it.visible) return out;
  if (isPath(it)) out.push(it);
  else if (it.children && !isText(it)) for (const c of it.children) leafPaths(c, out);
  return out;
}
function leafItems(it, out = []) {
  if (!it || !it.visible) return out;
  if (isPath(it) || isText(it) || isRaster(it) || it instanceof paper.Shape) out.push(it);
  else if (it.children) for (const c of it.children) leafItems(c, out);
  return out;
}
const styleTarget = it => (it.parent && isCompound(it.parent)) ? it.parent : it;
function styleTargets(items = selItems()) {
  const set = new Set();
  for (const it of items) {
    if (isGroup(it) && !it.clipped) leafItems(it).forEach(l => set.add(styleTarget(l)));
    else if (isGroup(it) && it.clipped) it.children.slice(1).forEach(c => (isGroup(c) ? leafItems(c) : [c]).forEach(l => set.add(styleTarget(l))));
    else set.add(styleTarget(it));
  }
  return [...set];
}
function kindName(it) {
  if (isText(it)) return 'Text';
  if (isRaster(it)) return 'Image';
  if (isCompound(it)) return 'Compound Path';
  if (isGroup(it) && it._data && it._data.textPath) return 'Type on a Path';
  if (isGroup(it) && it._data && it._data.pattern) return 'Pattern Fill';
  if (isGroup(it)) return it.clipped ? 'Clip Group' : 'Group';
  if (isPath(it)) {
    const L = it._data && it._data.live;
    if (L) return 'Rectangle';
    return it.data.shape || 'Path';
  }
  if (isLayer(it)) return 'Layer';
  return it.className || 'Object';
}
function displayName(it) {
  if (it.name) return it.name;
  if (isText(it)) return (it.content || '<Text>').split('\n')[0].slice(0, 40) || '<Text>';
  return `<${kindName(it)}>`;
}
function layerColor(it) { const L = it && it.layer; return (L && L.data.color) || LAYER_COLORS[0]; }
function dropLive(it) { if (it && it._data && it._data.live) delete it._data.live; }

/* ---------------- selection ---------------- */
const listeners = { selection: [], doc: [] };
function on(evt, fn) { listeners[evt].push(fn); }
function emit(evt) { for (const fn of listeners[evt]) fn(); }

function setSelection(items, pts) {
  sel.items = new Set(items.filter(Boolean));
  sel.pts = pts || new Map();
  selectionChanged();
}
function addToSelection(items) { items.forEach(i => sel.items.add(i)); selectionChanged(); }
function toggleInSelection(it) { if (sel.items.has(it)) { sel.items.delete(it); sel.pts.delete(it); } else sel.items.add(it); selectionChanged(); }
function clearSelection() { if (sel.items.size || sel.pts.size) setSelection([]); }
function selectionChanged() {
  for (const it of [...sel.items]) if (!alive(it)) { sel.items.delete(it); sel.pts.delete(it); }
  for (const p of [...sel.pts.keys()]) if (!sel.items.has(p)) sel.pts.delete(p);
  invalidateFrame();
  syncStyleFromSelection();
  emit('selection');
  requestDraw();
}
function isPtSelected(path, i) {
  const s = sel.pts.get(path);
  return s ? s.has(i) : true;
}
function normalizeToTopLevel() {
  const set = new Set();
  for (const it of sel.items) if (alive(it)) set.add(topLevel(it));
  setSelection([...set]);
}

/* ---------------- images (deduped out of history) ---------------- */
function registerRasters() {
  for (const L of project.layers) for (const r of L.getItems({ class: paper.Raster })) {
    const id = r._data && r._data.imgId;
    if (!id || !doc.images[id]) {
      const src = r.source;
      if (!src) continue;
      const nid = id || ('img' + uid());
      doc.images[nid] = src;
      r.data.imgId = nid;
    }
  }
}
function mapRasterSources(node, fn) {
  if (Array.isArray(node)) {
    if (node[0] === 'Raster' && node[1] && typeof node[1] === 'object') {
      const o = Object.assign({}, node[1]);
      const id = o.data && o.data.imgId;
      if (id) o.source = fn(id, o.source);
      return [node[0], o, ...node.slice(2)];
    }
    return node.map(n => mapRasterSources(n, fn));
  }
  if (node && typeof node === 'object') { const o = {}; for (const k in node) o[k] = mapRasterSources(node[k], fn); return o; }
  return node;
}
function usedImageIds(layersJson) {
  const ids = new Set();
  mapRasterSources(layersJson, id => { ids.add(id); return ''; });
  return ids;
}

/* ---------------- serialization ---------------- */
// Text being typed is hidden behind the editor box; make sure saved copies never record it as hidden.
function withEditingTextShown(fn) {
  const t = S.editingText && alive(S.editingText) ? S.editingText : null;
  if (t) t.visible = true;
  try { return fn(); } finally { if (t) t.visible = false; }
}
function serializeLayers() {
  registerRasters();
  return withEditingTextShown(() => project.layers.map(L => mapRasterSources(L.exportJSON({ asString: false, precision: 4 }), id => 'img:' + id)));
}
// Compact string form for undo history (much smaller in memory than object trees).
function serializeLayersString() {
  registerRasters();
  return withEditingTextShown(() => '[' + project.layers.map(L => L.getItems({ class: paper.Raster }).length
    ? JSON.stringify(mapRasterSources(L.exportJSON({ asString: false, precision: 4 }), id => 'img:' + id))
    : L.exportJSON({ precision: 4 })).join(',') + ']');
}
function restoreLayers(layersJson) {
  if (typeof layersJson === 'string') layersJson = JSON.parse(layersJson);
  project.clear();
  for (const j of layersJson) {
    const L = new paper.Layer();
    L.importJSON(mapRasterSources(j, (id, src) => doc.images[id] || src));
  }
  if (!project.layers.length) newLayer('Layer 1');
}
function selPaths() {
  return {
    items: [...sel.items].filter(alive).map(itemPath),
    pts: [...sel.pts].filter(([p]) => alive(p)).map(([p, s]) => [itemPath(p), [...s]]),
  };
}
function itemPath(it) { return zKey(it); }
function itemAt(path) {
  if (!path || !path.length) return null;
  let it = project.layers[path[0]];
  for (let i = 1; i < path.length && it; i++) it = it.children ? it.children[path[i]] : null;
  return it || null;
}
function serializeDoc() {
  const layers = serializeLayers();
  const ids = usedImageIds(layers);
  const images = {};
  for (const id of ids) if (doc.images[id]) images[id] = doc.images[id];
  return {
    format: 'nib-vector', version: 1, name: doc.name, units: unitKey(),
    artboards: doc.artboards, ab: doc.ab, guides: doc.guides, swatches: doc.swatches, patterns: doc.patterns || [],
    activeLayer: activeLayer().index, layers, images,
  };
}
function loadDocObject(o) {
  if (!o || o.format !== 'nib-vector' || !Array.isArray(o.layers)) throw new Error('This file is not a Nib document.');
  doc = newDocModel(o.name || 'Untitled', 800, 600, o.units);
  doc.patterns = Array.isArray(o.patterns) ? o.patterns : [];
  doc.artboards = (o.artboards && o.artboards.length ? o.artboards : doc.artboards).map(a => ({ name: a.name || 'Artboard', x: +a.x || 0, y: +a.y || 0, w: Math.max(1, +a.w || 1), h: Math.max(1, +a.h || 1) }));
  doc.ab = clamp(o.ab | 0, 0, doc.artboards.length - 1);
  doc.guides = { v: (o.guides && o.guides.v) || [], h: (o.guides && o.guides.h) || [] };
  doc.swatches = Array.isArray(o.swatches) ? o.swatches : clonePaint(DEFAULT_SWATCHES);
  doc.images = o.images || {};
  restoreLayers(o.layers);
  const L = project.layers[o.activeLayer] || project.layers[project.layers.length - 1];
  L.activate();
}

/* ---------------- history ---------------- */
// Undo keeps up to 120 steps, but never more than ~80 MB of saved states, so big documents can't exhaust memory.
const H = { stack: [], idx: -1, max: 120, maxChars: 80e6, minSteps: 6 };
function snapshot(label) {
  const layers = serializeLayersString();
  return {
    label, layers, size: layers.length,
    active: activeLayer().index,
    artboards: JSON.parse(JSON.stringify(doc.artboards)), ab: doc.ab,
    guides: JSON.parse(JSON.stringify(doc.guides)),
    sel: selPaths(),
  };
}
function commit(label = 'Edit') {
  if (typeof refreshPathTexts === 'function') refreshPathTexts();
  H.stack.length = H.idx + 1;
  H.stack.push(snapshot(label));
  let total = H.stack.reduce((n, s) => n + (s.size || 0), 0);
  while (H.stack.length > H.minSteps && (H.stack.length > H.max || total > H.maxChars)) total -= H.stack.shift().size || 0;
  H.idx = H.stack.length - 1;
  S.dirty = true;
  afterDocChange();
}
function resetHistory() { H.stack = [snapshot('Open')]; H.idx = 0; }
function restoreSnapshot(s) {
  const isoPath = S.isolated && alive(S.isolated) ? itemPath(S.isolated) : null;
  restoreLayers(s.layers);
  const iso = isoPath ? itemAt(isoPath) : null;
  S.isolated = iso && isGroup(iso) ? iso : null;
  (project.layers[s.active] || project.layers[project.layers.length - 1]).activate();
  doc.artboards = JSON.parse(JSON.stringify(s.artboards)); doc.ab = s.ab;
  doc.guides = JSON.parse(JSON.stringify(s.guides));
  const items = s.sel.items.map(itemAt).filter(Boolean);
  const pts = new Map();
  for (const [p, idx] of s.sel.pts) { const it = itemAt(p); if (it && isPath(it)) pts.set(it, new Set(idx)); }
  S.hover = null;
  sel.items = new Set(items); sel.pts = pts;
  selectionChanged();
  afterDocChange();
}
function undo() {
  if (S.editingText) { commitTextEdit(); }
  if (typeof cancelToolState === 'function') cancelToolState();
  if (H.idx > 0) { H.idx--; restoreSnapshot(H.stack[H.idx]); S.dirty = true; toastQuiet(`Undo ${H.stack[H.idx + 1].label}`); }
}
function redo() {
  if (typeof cancelToolState === 'function') cancelToolState();
  if (H.idx < H.stack.length - 1) { H.idx++; restoreSnapshot(H.stack[H.idx]); S.dirty = true; toastQuiet(`Redo ${H.stack[H.idx].label}`); }
}
const undoLabel = () => H.idx > 0 ? H.stack[H.idx].label : null;
const redoLabel = () => H.idx < H.stack.length - 1 ? H.stack[H.idx + 1].label : null;

function afterDocChange() {
  invalidateFrame();
  if (S.isolated && !alive(S.isolated)) S.isolated = null;
  for (const it of sel.items) if (!alive(it)) { selectionChanged(); break; }
  emit('doc');
  requestDraw();
  scheduleAutosave();
}
