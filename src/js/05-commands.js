/* ============================================================
   Commands: edit, object, path, pathfinder, align, transform, style, select
   ============================================================ */

/* ---------------- style ---------------- */
function commonValue(list, fn) {
  if (!list.length) return undefined;
  const v0 = fn(list[0]), k0 = JSON.stringify(v0);
  for (let i = 1; i < list.length; i++) if (JSON.stringify(fn(list[i])) !== k0) return 'mixed';
  return v0;
}
function syncStyleFromSelection() {
  const t = styleTargets();
  if (!t.length) { S.selStyle = null; return; }
  const fill = commonValue(t, x => paintFromPaper(x.fillColor));
  const stroke = commonValue(t, x => paintFromPaper(x.strokeColor));
  const sw = commonValue(t, x => +(x.strokeWidth || 0).toFixed(3));
  S.selStyle = { fill, stroke, strokeWidth: sw, opacity: commonValue(selItems(), x => Math.round(x.opacity * 100)) };
  if (fill !== 'mixed') S.style.fill = clonePaint(fill);
  if (stroke !== 'mixed') S.style.stroke = clonePaint(stroke);
  if (typeof sw === 'number' && sw > 0) S.style.strokeWidth = sw;
}
const curPaint = kind => S.selStyle ? S.selStyle[kind] : S.style[kind];
function applyPaint(kind, paint, targets = styleTargets(), opts = {}) {
  const prop = kind === 'fill' ? 'fillColor' : 'strokeColor';
  for (const t of targets) {
    if (t === S.editingText) continue;
    t[prop] = paintToPaper(paint, t, opts.keepGeometry ? t[prop] : null);
  }
  S.style[kind] = clonePaint(paint);
  if (paint && paint.type === 'solid') S.style.lastSolid[kind] = clonePaint(paint);
  if (paint && paint.type !== 'solid') S.style.lastGradient = clonePaint(paint);
  if (opts.live) { if (S.selStyle) S.selStyle[kind] = clonePaint(paint); requestDraw(); emit('style'); return; }
  if (targets.length) commit(kind === 'fill' ? 'Fill' : 'Stroke');
  else emit('selection');
}
listeners.style = [];
function setStrokeProp(prop, value, label) {
  const t = styleTargets();
  for (const it of t) {
    it[prop] = value;
    if (prop === 'strokeWidth' && value > 0 && !it.strokeColor) it.strokeColor = paintToPaper(S.style.lastSolid.stroke || solid('#000000'), it);
  }
  if (prop === 'strokeWidth') S.style.strokeWidth = value;
  if (t.length) commit(label || 'Stroke'); else emit('selection');
}
function setOpacity(pct) { const items = selItems(); items.forEach(it => it.opacity = clamp(pct, 0, 100) / 100); if (items.length) commit('Opacity'); }
function setBlend(mode) { const items = selItems(); items.forEach(it => it.blendMode = mode); if (items.length) commit('Blend Mode'); }
function swapFillStroke() {
  const f = curPaint('fill'), s = curPaint('stroke');
  if (f === 'mixed' || s === 'mixed') return;
  const t = styleTargets();
  for (const it of t) { const a = it.fillColor, b = it.strokeColor; it.fillColor = b; it.strokeColor = a; }
  S.style.fill = clonePaint(s); S.style.stroke = clonePaint(f);
  if (t.length) commit('Swap Fill & Stroke'); else emit('selection');
}
function defaultFillStroke() {
  const t = styleTargets();
  for (const it of t) { it.fillColor = paperColor(C(255, 255, 255, 1)); it.strokeColor = paperColor(C(0, 0, 0, 1)); it.strokeWidth = 1; }
  S.style.fill = solid('#FFFFFF'); S.style.stroke = solid('#000000'); S.style.strokeWidth = 1;
  if (t.length) commit('Default Fill & Stroke'); else emit('selection');
}
function paintMode(mode) {
  const kind = S.style.focus;
  if (mode === 'none') return applyPaint(kind, null);
  if (mode === 'solid') return applyPaint(kind, clonePaint(S.style.lastSolid[kind] || solid('#000000')));
  return applyPaint(kind, clonePaint(S.style.lastGradient));
}

/* ---------------- clipboard ---------------- */
let clip = null;
function exportItemsSVG(items) {
  const b = items.reduce((r, it) => r ? r.unite(it.strokeBounds) : it.strokeBounds.clone(), null);
  return b ? buildSVG(items, b) : '';
}
function copySel(cut) {
  const items = selItems();
  if (!items.length) return false;
  registerRasters();
  const images = {};
  const json = items.map(it => mapRasterSources(it.exportJSON({ asString: false }), id => { images[id] = doc.images[id]; return 'img:' + id; }));
  clip = { items: json, images, bounds: unionBounds(items), svg: '', svgWritten: false };
  const mine = clip;
  try {
    clip.svg = exportItemsSVG(items);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(clip.svg).then(() => { mine.svgWritten = true; }, () => {});
  } catch {}
  if (cut) { items.forEach(it => it.remove()); setSelection([]); commit('Cut'); }
  return true;
}
function importItemJSON(j, parent) {
  const it = paper.Base.importJSON(mapRasterSources(j, (id, src) => doc.images[id] || src));
  parent.addChild(it);
  return it;
}
function pasteClip(mode = 'center') {
  if (!clip) return;
  Object.assign(doc.images, clip.images);
  const items = selItems();
  const ref = mode === 'front' ? items[items.length - 1] : mode === 'back' ? items[0] : null;
  const parent = ref ? ref.parent : (S.isolated && alive(S.isolated) ? S.isolated : activeLayer());
  if (!ref && !S.isolated && !canDrawOnLayer()) return;
  const made = clip.items.map(j => importItemJSON(j, parent));
  if (ref) {
    if (mode === 'front') { let anchor = ref; for (const m of made) { m.insertAbove(anchor); anchor = m; } }
    else { for (const m of made) m.insertBelow(ref); }
  }
  if (mode === 'center') {
    const b = unionBounds(made), c = view.center;
    if (b) transformItems(made, new paper.Matrix().translate(c.subtract(b.center)));
  }
  setSelection(made);
  commit(mode === 'center' ? 'Paste' : mode === 'inplace' ? 'Paste in Place' : mode === 'front' ? 'Paste in Front' : 'Paste in Back');
}
function duplicateSel() {
  const items = selItems();
  if (!items.length) return;
  const clones = items.map(it => it.clone());
  transformItems(clones, new paper.Matrix().translate(10, 10));
  setSelection(clones);
  commit('Duplicate');
}

/* ---------------- delete ---------------- */
function deleteAnchors(path, del) {
  const segs = path.segments, n = segs.length;
  if (del.size >= n) { path.remove(); return []; }
  const keep = i => !del.has(i);
  const runs = [];
  let cur = [];
  if (path.closed) {
    const start = [...del][0];
    for (let k = 1; k <= n; k++) { const i = (start + k) % n; if (keep(i)) cur.push(i); else { if (cur.length) runs.push(cur); cur = []; } }
  } else {
    for (let i = 0; i < n; i++) { if (keep(i)) cur.push(i); else { if (cur.length) runs.push(cur); cur = []; } }
  }
  if (cur.length) runs.push(cur);
  const out = [];
  for (const r of runs) {
    if (r.length < 2) continue;
    const np = new paper.Path({ segments: r.map(i => segs[i].clone()), insert: false });
    np.copyAttributes(path, true);
    np.closed = false;
    np.firstSegment.handleIn = P(0, 0); np.lastSegment.handleOut = P(0, 0);
    np.insertAbove(path);
    dropLive(np); out.push(np);
  }
  path.remove();
  return out;
}
function deleteSelection() {
  const items = selItems();
  if (!items.length) return;
  const anchorsMode = (TOOLS[S.tool].display === 'anchors');
  const partial = anchorsMode && items.some(it => sel.pts.has(it) && isPath(it) && sel.pts.get(it).size < it.segments.length);
  if (partial) {
    const out = [];
    for (const it of items) {
      const set = sel.pts.get(it);
      if (isPath(it) && set) out.push(...deleteAnchors(it, set)); else it.remove();
    }
    setSelection(out);
    commit('Delete Anchors');
    return;
  }
  items.forEach(it => it.remove());
  setSelection([]);
  commit('Delete');
}

/* ---------------- select ---------------- */
function selectAll(abOnly) {
  if (S.tool === 'direct') {
    const out = [];
    for (const p of allEditablePaths()) out.push(p);
    return setSelection(out);
  }
  const out = [];
  const roots = S.isolated && alive(S.isolated) ? [S.isolated] : project.layers;
  const r = abOnly ? abRect(activeAB()) : null;
  for (const L of roots) if (isEditable(L)) for (const it of L.children) if (it.visible && !it.locked && (!r || r.intersects(it.bounds))) out.push(it);
  setSelection(out);
}
function selectInverse() {
  const cur = new Set(selItems().map(topLevel));
  const out = [];
  for (const L of project.layers) if (isEditable(L)) for (const it of L.children) if (it.visible && !it.locked && !cur.has(it)) out.push(it);
  setSelection(out);
}
function selectSame(kind) {
  const ref = styleTargets()[0];
  if (!ref) return toast('Select an object first.');
  const key = it => kind === 'fill' ? JSON.stringify(paintFromPaper(it.fillColor))
    : kind === 'stroke' ? JSON.stringify(paintFromPaper(it.strokeColor))
    : kind === 'weight' ? String(it.strokeWidth)
    : kind === 'fillstroke' ? JSON.stringify([paintFromPaper(it.fillColor), paintFromPaper(it.strokeColor)])
    : String(it.opacity);
  const k = key(ref), out = [];
  for (const L of project.layers) if (isEditable(L)) for (const l of leafItems(L)) {
    const t = styleTarget(l);
    if (isEditable(t) && key(t) === k && !out.includes(t)) out.push(t);
  }
  setSelection(out);
}

/* ---------------- object ---------------- */
function groupSel() {
  const items = selItems();
  if (!items.length) return;
  const top = items[items.length - 1];
  const g = new paper.Group({ insert: false });
  g.insertAbove(top);
  g.addChildren(items);
  setSelection([g]);
  commit('Group');
}
function ungroupSel() {
  const out = []; let did = false;
  for (const it of selItems()) {
    if (isGroup(it)) {
      did = true;
      const m = it.matrix.clone();
      const kids = it.removeChildren();
      if (it.clipped && kids[0]) kids[0].clipMask = false;
      if (!m.isIdentity()) kids.forEach(k => transformItem(k, m));
      if (it.opacity < 1) kids.forEach(k => k.opacity *= it.opacity);
      it.parent.insertChildren(it.index, kids);
      it.remove();
      out.push(...kids);
    } else out.push(it);
  }
  if (did) { setSelection(out); commit('Ungroup'); }
}
function arrange(op) {
  const items = selItems();
  if (!items.length) return;
  if (op === 'front') items.forEach(it => it.bringToFront());
  else if (op === 'back') [...items].reverse().forEach(it => it.sendToBack());
  else if (op === 'forward') [...items].reverse().forEach(it => { const n = it.nextSibling; if (n && !sel.items.has(n)) it.insertAbove(n); });
  else if (op === 'backward') items.forEach(it => { const p = it.previousSibling; if (p && !sel.items.has(p)) it.insertBelow(p); });
  commit('Arrange');
}
function sendToLayer(L) {
  const items = selItems();
  if (!items.length || !L) return;
  items.forEach(it => L.addChild(it));
  L.activate(); commit('Move to Layer');
}
function lockSel() { const items = selItems(); if (!items.length) return; items.forEach(it => it.locked = true); setSelection([]); commit('Lock'); }
function hideSel() { const items = selItems(); if (!items.length) return; items.forEach(it => it.visible = false); setSelection([]); commit('Hide'); }
function unlockAll() {
  const out = [];
  for (const L of project.layers) for (const it of L.getItems({ match: x => x.locked })) { it.locked = false; out.push(it); }
  if (!out.length) return toastQuiet('Nothing is locked');
  setSelection(out.filter(isEditable)); commit('Unlock All');
}
function showAll() {
  const out = [];
  for (const L of project.layers) for (const it of L.getItems({ match: x => !x.visible })) { it.visible = true; out.push(it); }
  if (!out.length) return toastQuiet('Nothing is hidden');
  setSelection(out.filter(isEditable)); commit('Show All');
}
function makeCompound() {
  const items = selItems().filter(isPathLike);
  if (items.length < 2) return toast('Select two or more paths to make a compound path.');
  const back = items[0];
  const st = back.style.clone ? back.style : null;
  const fill = back.fillColor && back.fillColor.clone(), stroke = back.strokeColor && back.strokeColor.clone(), sw = back.strokeWidth;
  const cp = new paper.CompoundPath({ insert: false });
  cp.insertAbove(items[items.length - 1]);
  for (const it of items) {
    if (isCompound(it)) { const kids = it.removeChildren(); cp.addChildren(kids); it.remove(); }
    else { dropLive(it); cp.addChild(it); }
  }
  cp.fillColor = fill; cp.strokeColor = stroke; cp.strokeWidth = sw; cp.fillRule = 'evenodd';
  void st;
  setSelection([cp]); commit('Make Compound Path');
}
function releaseCompound() {
  const out = []; let did = false;
  for (const it of selItems()) {
    if (!isCompound(it)) { out.push(it); continue; }
    did = true;
    const kids = it.removeChildren();
    kids.forEach(k => { k.style = it.style; });
    it.parent.insertChildren(it.index, kids);
    it.remove(); out.push(...kids);
  }
  if (did) { setSelection(out); commit('Release Compound Path'); }
}
function makeClip() {
  const items = selItems();
  if (items.length < 2) return toast('Select the artwork and, on top of it, a shape to use as the clipping mask.');
  const mask = items[items.length - 1];
  if (!isPathLike(mask)) return toast('The top object must be a path or compound path to work as a clipping mask.');
  const g = new paper.Group({ insert: false });
  g.insertAbove(mask);
  g.addChildren([mask, ...items.slice(0, -1)]);
  mask.fillColor = null; mask.strokeColor = null;
  g.clipped = true;
  setSelection([g]); commit('Make Clipping Mask');
}
function releaseClip() {
  let did = false;
  for (const it of selItems()) if (isGroup(it) && it.clipped) { it.clipped = false; if (it.firstChild) it.firstChild.clipMask = false; did = true; }
  if (did) { emit('selection'); commit('Release Clipping Mask'); }
}
function joinPaths() {
  const paths = selItems().filter(p => isPath(p) && !p.closed);
  if (paths.length === 1) { paths[0].closed = true; dropLive(paths[0]); commit('Join'); return; }
  if (paths.length !== 2) return toast('Select one open path to close it, or two open paths to join them.');
  let [a, b] = paths;
  const d = (p, q) => p.getDistance(q);
  const opts = [
    [d(a.lastSegment.point, b.firstSegment.point), false, false],
    [d(a.lastSegment.point, b.lastSegment.point), false, true],
    [d(a.firstSegment.point, b.firstSegment.point), true, false],
    [d(a.firstSegment.point, b.lastSegment.point), true, true],
  ].sort((x, y) => x[0] - y[0])[0];
  if (opts[1]) a.reverse();
  if (opts[2]) b.reverse();
  a.join(b, 0.5);
  dropLive(a); setSelection([a]); commit('Join');
}
function reversePaths() { const ps = selItems().flatMap(it => leafPaths(it)); ps.forEach(p => p.reverse()); if (ps.length) commit('Reverse Path Direction'); }
function smoothPaths() { const ps = selItems().flatMap(it => leafPaths(it)); ps.forEach(p => { p.smooth({ type: 'continuous' }); dropLive(p); }); if (ps.length) commit('Smooth'); }
function rasterizeSel() {
  const items = selItems();
  if (!items.length) return;
  const out = items.map(it => { const r = it.rasterize({ resolution: 144, insert: false }); r.insertAbove(it); it.remove(); return r; });
  registerRasters();
  setSelection(out); commit('Rasterize');
}
function resetBBox() { selItems().forEach(it => { it.data.angle = 0; }); invalidateFrame(); commit('Reset Bounding Box'); }
function transformAgain() {
  const lx = S.lastXform;
  let items = selItems();
  if (!lx || !items.length) return;
  if (lx.copy) items = items.map(it => it.clone());
  transformItems(items, lx.m);
  if (lx.rot) rotateBookkeeping(items, lx.rot);
  if (lx.axis != null) reflectBookkeeping(items, lx.axis);
  setSelection(items);
  commit('Transform Again');
}

/* ---------------- pathfinder ---------------- */
const isEmptyPath = x => !x || (x.isEmpty && x.isEmpty()) || Math.abs(x.area || 0) < 0.01;
function pathfinder(op) {
  const items = selItems();
  const ops = [];
  for (const it of items) {
    if (isPathLike(it)) ops.push(it);
    else if (isGroup(it) && !it.clipped) ops.push(...it.getItems({ match: x => isPathLike(x) && !(x.parent && isCompound(x.parent)) }));
  }
  if (ops.length < 2) return toast('Select two or more shapes to combine with Pathfinder.');
  ops.sort(zCmp);
  const top = ops[ops.length - 1], bottom = ops[0], opt = { insert: false };
  let result;
  try {
    if (op === 'unite') { result = top; for (const p of ops) if (p !== top) result = result.unite(p, opt); }
    else if (op === 'minusFront') { result = bottom; for (const p of ops.slice(1)) result = result.subtract(p, opt); }
    else if (op === 'minusBack') { result = top; for (const p of ops.slice(0, -1)) result = result.subtract(p, opt); }
    else if (op === 'intersect') { result = top; for (const p of ops) if (p !== top) result = result.intersect(p, opt); }
    else if (op === 'exclude') { result = top; for (const p of ops) if (p !== top) result = result.exclude(p, opt); }
    else if (op === 'divide') {
      let pieces = [];
      for (const s of ops) {
        const next = [];
        let rest = s.clone({ insert: false });
        for (const p of pieces) {
          const inter = s.intersect(p, opt), diff = p.subtract(s, opt);
          if (!isEmptyPath(inter)) next.push(inter);
          if (!isEmptyPath(diff)) next.push(diff);
          rest = rest.subtract(p, opt);
        }
        if (!isEmptyPath(rest)) next.push(rest);
        pieces = next;
      }
      const g = new paper.Group({ insert: false });
      g.insertAbove(top);
      pieces.forEach(p => { if (p._data) { delete p._data.live; delete p._data.shape; delete p._data.angle; } g.addChild(p); });
      cleanupAfterPathfinder(ops, items);
      setSelection([g]); commit('Divide'); return;
    }
  } catch (err) { console.error(err); return toast('Pathfinder could not combine these shapes.'); }
  if (!result || result === top || result === bottom) return;
  result.insertAbove(top);
  if (result._data) { delete result._data.live; delete result._data.shape; delete result._data.angle; }
  cleanupAfterPathfinder(ops, items);
  if (isEmptyPath(result)) { result.remove(); setSelection([]); commit('Pathfinder'); return toast('The shapes do not overlap, so nothing is left.'); }
  setSelection([result]);
  commit({ unite: 'Unite', minusFront: 'Minus Front', minusBack: 'Minus Back', intersect: 'Intersect', exclude: 'Exclude' }[op]);
}
function cleanupAfterPathfinder(ops, items) {
  ops.forEach(p => p.remove());
  for (const it of items) if (isGroup(it) && alive(it) && !it.getItems({ match: x => !isGroup(x) }).length) it.remove();
}

/* ---------------- align / distribute ---------------- */
function alignSel(op) {
  const items = selItems();
  if (!items.length) return;
  const toAB = S.alignTo === 'artboard' || items.length === 1;
  const ref = toAB ? abRect(activeAB()) : unionBounds(items);
  for (const it of items) {
    const b = boundsIn(it);
    let dx = 0, dy = 0;
    if (op === 'L') dx = ref.left - b.left; if (op === 'CH') dx = ref.center.x - b.center.x; if (op === 'R') dx = ref.right - b.right;
    if (op === 'T') dy = ref.top - b.top; if (op === 'CV') dy = ref.center.y - b.center.y; if (op === 'B') dy = ref.bottom - b.bottom;
    if (dx || dy) transformItem(it, new paper.Matrix().translate(dx, dy));
  }
  commit('Align');
}
function distributeSel(op) {
  const items = selItems();
  if (items.length < 3) return toast('Select three or more objects to distribute them.');
  const bs = items.map(it => ({ it, b: boundsIn(it) }));
  const horiz = op === 'H' || op === 'SH';
  bs.sort((a, b) => horiz ? a.b.center.x - b.b.center.x : a.b.center.y - b.b.center.y);
  const n = bs.length, first = bs[0].b, last = bs[n - 1].b;
  if (op === 'H' || op === 'V') {
    const a = horiz ? first.center.x : first.center.y, z = horiz ? last.center.x : last.center.y, step = (z - a) / (n - 1);
    bs.forEach((o, i) => { const c = horiz ? o.b.center.x : o.b.center.y, d = a + step * i - c; transformItem(o.it, new paper.Matrix().translate(horiz ? d : 0, horiz ? 0 : d)); });
  } else {
    const total = bs.reduce((s, o) => s + (horiz ? o.b.width : o.b.height), 0);
    const span = horiz ? last.right - first.left : last.bottom - first.top;
    const gap = (span - total) / (n - 1);
    let pos = horiz ? first.left : first.top;
    bs.forEach(o => { const cur = horiz ? o.b.left : o.b.top, d = pos - cur; transformItem(o.it, new paper.Matrix().translate(horiz ? d : 0, horiz ? 0 : d)); pos += (horiz ? o.b.width : o.b.height) + gap; });
  }
  commit('Distribute');
}

/* ---------------- transform values ---------------- */
function setFrameValue(key, val) {
  const items = selItems(), fr = getFrame();
  if (!fr || !items.length || !isFinite(val)) return;
  const ref = refPoint(fr), ab = activeAB();
  let m;
  if (key === 'x') m = new paper.Matrix().translate(val + ab.x - ref.p.x, 0);
  else if (key === 'y') m = new paper.Matrix().translate(0, val + ab.y - ref.p.y);
  else if (key === 'w' || key === 'h') {
    const cur = key === 'w' ? fr.rect.width : fr.rect.height;
    if (cur < 1e-9 || val <= 0) return;
    const s = val / cur;
    let sx = key === 'w' ? s : 1, sy = key === 'h' ? s : 1;
    if (S.lockRatio) sx = sy = s;
    m = frameScaleMatrix(fr, sx, sy, ref.f);
  } else if (key === 'angle') {
    const da = -val - fr.angle;
    transformItems(items, new paper.Matrix().rotate(da, ref.p));
    rotateBookkeeping(items, da);
    commit('Rotate'); return;
  }
  transformItems(items, m);
  commit('Transform');
}
function flipSel(axis) {
  const fr = getFrame(), items = selItems();
  if (!fr) return;
  transformItems(items, frameScaleMatrix(fr, axis === 'h' ? -1 : 1, axis === 'v' ? -1 : 1, fr.rect.center));
  commit(axis === 'h' ? 'Flip Horizontal' : 'Flip Vertical');
}
function setCornerRadius(v) {
  const t = selItems().filter(it => it._data && it._data.live);
  for (const it of t) { it._data.live.r = Math.max(0, v); regenLive(it); }
  if (t.length) commit('Corner Radius');
}
function nudge(dx, dy) {
  const items = selItems();
  if (!items.length) return;
  const d = P(dx, dy);
  if (TOOLS[S.tool].display === 'anchors' && sel.pts.size) movePoints(d);
  else transformItems(items, new paper.Matrix().translate(d));
  S.nudging = true;
  requestDraw();
}
function convertSelectedAnchors(kind) {
  let n = 0;
  for (const [p, set] of sel.pts) {
    for (const i of set) {
      const s = p.segments[i]; if (!s) continue;
      if (kind === 'corner') { s.handleIn = P(0, 0); s.handleOut = P(0, 0); }
      else s.smooth({ type: 'catmull-rom' });
      n++;
    }
    dropLive(p);
  }
  if (!n) for (const it of selItems()) for (const p of leafPaths(it)) { p.segments.forEach(s => kind === 'corner' ? (s.handleIn = P(0, 0), s.handleOut = P(0, 0)) : s.smooth({ type: 'catmull-rom' })); dropLive(p); n++; }
  if (n) commit(kind === 'corner' ? 'Convert to Corner' : 'Convert to Smooth');
}
function cutAtSelectedAnchors() {
  const out = [];
  for (const [p, set] of [...sel.pts]) {
    if (!isPath(p)) continue;
    let idx = [...set].sort((a, b) => b - a);
    if (!idx.length) continue;
    const n = p.segments.length;
    if (p.closed) {
      const i0 = idx.shift();
      p.splitAt(p.segments[i0].location);
      idx = idx.map(j => j + (n - i0)).sort((a, b) => b - a);
    }
    for (const i of idx) {
      if (i <= 0 || i >= p.segments.length - 1) continue;
      const r = p.splitAt(p.segments[i].location);
      if (r && r !== p) out.push(r);
    }
    out.push(p); dropLive(p);
  }
  if (out.length) { setSelection(out); commit('Cut Path at Anchors'); }
}

/* ---------------- dialogs that transform ---------------- */
function applyDialogXform(m, copy, label, book) {
  let items = selItems();
  if (!items.length) return;
  if (copy) items = items.map(it => it.clone());
  transformItems(items, m);
  if (book && book.rot) rotateBookkeeping(items, book.rot);
  if (book && book.axis != null) reflectBookkeeping(items, book.axis);
  S.lastXform = { m, copy, rot: book && book.rot || 0, axis: book ? book.axis : null };
  setSelection(items);
  commit(copy ? label + ' Copy' : label);
}
function openTransformDialog(kind) {
  if (!selItems().length) return toast('Select something to transform first.');
  const o = xformOrigin();
  if (kind === 'move') {
    const fH = fLen('Horizontal', 0), fV = fLen('Vertical', 0);
    const fDist = fLen('Distance', 0), fAng = fNum('Angle', 0, { unit: '°' });
    const syncPolar = () => { const v = P(fH.get() || 0, fV.get() || 0); fDist.set(v.length); fAng.set(v.isZero() ? 0 : norm180(-v.angle)); };
    const syncCart = () => { const v = P(1, 0).rotate(-(fAng.get() || 0)).multiply(fDist.get() || 0); fH.set(v.x); fV.set(v.y); };
    [fH, fV].forEach(f => f.input.addEventListener('change', syncPolar));
    [fDist, fAng].forEach(f => f.input.addEventListener('change', syncCart));
    const go = copy => applyDialogXform(new paper.Matrix().translate(fH.get() || 0, fV.get() || 0), copy, 'Move');
    openDialog({ title: 'Move', body: [fH.el, fV.el, fDist.el, fAng.el], buttons: [{ label: 'Copy', left: true, onClick: () => go(true) }, { label: 'Cancel' }, { label: 'OK', primary: true, onClick: () => go(false) }] });
  } else if (kind === 'rotate') {
    const fA = fNum('Angle', 0, { unit: '°' });
    const go = copy => { const a = -(fA.get() || 0); applyDialogXform(new paper.Matrix().rotate(a, o), copy, 'Rotate', { rot: a }); };
    openDialog({ title: 'Rotate', body: [fA.el, h('p', { class: 'hint' }, 'Positive angles rotate counterclockwise around the reference point.')], buttons: [{ label: 'Copy', left: true, onClick: () => go(true) }, { label: 'Cancel' }, { label: 'OK', primary: true, onClick: () => go(false) }] });
  } else if (kind === 'reflect') {
    const fAx = fRadio('Axis', [['h', 'Horizontal'], ['v', 'Vertical'], ['a', 'Angle']], 'v');
    const fA = fNum('Angle', 90, { unit: '°' });
    const go = copy => {
      const ax = fAx.get();
      const a = ax === 'h' ? 0 : ax === 'v' ? 90 : -(fA.get() || 0);
      applyDialogXform(new paper.Matrix().translate(o).rotate(a).scale(1, -1).rotate(-a).translate(o.negate()), copy, 'Reflect', { axis: a });
    };
    openDialog({ title: 'Reflect', body: [fAx.el, fA.el], buttons: [{ label: 'Copy', left: true, onClick: () => go(true) }, { label: 'Cancel' }, { label: 'OK', primary: true, onClick: () => go(false) }] });
  } else if (kind === 'scale') {
    const fU = fChk('Uniform', true), fS = fNum('Scale', 100, { unit: '%' }), fH = fNum('Horizontal', 100, { unit: '%' }), fV = fNum('Vertical', 100, { unit: '%' });
    const go = copy => {
      const u = fU.get(), sx = (u ? fS.get() : fH.get()) / 100, sy = (u ? fS.get() : fV.get()) / 100;
      if (!sx || !sy) return false;
      applyDialogXform(new paper.Matrix().translate(o).scale(sx, sy).translate(o.negate()), copy, 'Scale');
    };
    openDialog({ title: 'Scale', body: [fU.el, fS.el, fH.el, fV.el], buttons: [{ label: 'Copy', left: true, onClick: () => go(true) }, { label: 'Cancel' }, { label: 'OK', primary: true, onClick: () => go(false) }] });
  }
}
function openShapeDialog(id, p0, centered) {
  if (!canDrawOnLayer()) return;
  const make = (item, label) => { placeNew(item); applyNewStyle(item, { noFill: id === 'line' }); if (id === 'line' && !item.strokeColor) item.strokeColor = paperColor(C(0, 0, 0, 1)); setSelection([item]); commit(label); };
  const at = (w, hh) => centered ? new paper.Rectangle(p0.x - w / 2, p0.y - hh / 2, w, hh) : new paper.Rectangle(p0.x, p0.y, w, hh);
  if (id === 'rect' || id === 'rrect' || id === 'ellipse') {
    const fW = fLen('Width', isPrintUnits() ? 72 : 100), fH = fLen('Height', isPrintUnits() ? 72 : 100);
    const fR = id === 'rrect' ? fLen('Corner radius', S.shape.radius) : null;
    openDialog({
      title: id === 'ellipse' ? 'Ellipse' : id === 'rrect' ? 'Rounded Rectangle' : 'Rectangle',
      body: [fW.el, fH.el, fR && fR.el],
      buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, onClick: () => {
        const w = fW.get(), hh = fH.get();
        if (!(w > 0) || !(hh > 0)) return false;
        const r = at(w, hh);
        if (fR) S.shape.radius = Math.max(0, fR.get() || 0);
        make(id === 'ellipse' ? makeEllipse(r) : makeRect(r, id === 'rrect' ? S.shape.radius : 0), id === 'ellipse' ? 'Ellipse' : 'Rectangle');
      } }],
    });
  } else if (id === 'polygon') {
    const fR = fLen('Radius', 50), fS = fNum('Sides', S.shape.sides, { step: 1 });
    openDialog({ title: 'Polygon', body: [fR.el, fS.el], buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, onClick: () => {
      S.shape.sides = clamp(Math.round(fS.get() || 6), 3, 1000);
      make(makePolygon(p0, Math.max(0.1, fR.get() || 50), S.shape.sides, 0), 'Polygon');
    } }] });
  } else if (id === 'star') {
    const f1 = fLen('Radius 1', 50), f2 = fLen('Radius 2', 25), fP = fNum('Points', S.shape.points, { step: 1 });
    openDialog({ title: 'Star', body: [f1.el, f2.el, fP.el], buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, onClick: () => {
      S.shape.points = clamp(Math.round(fP.get() || 5), 3, 1000);
      const r1 = Math.max(0.1, f1.get() || 50), r2 = Math.max(0.1, f2.get() || 25);
      S.shape.ratio = clamp(Math.min(r1, r2) / Math.max(r1, r2), 0.01, 1);
      make(makeStar(p0, r1, r2, S.shape.points, 0), 'Star');
    } }] });
  } else if (id === 'line') {
    const fL = fLen('Length', 100), fA = fNum('Angle', 0, { unit: '°' });
    openDialog({ title: 'Line Segment', body: [fL.el, fA.el], buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, onClick: () => {
      const v = P(1, 0).rotate(-(fA.get() || 0)).multiply(fL.get() || 100);
      make(makeLine(p0, p0.add(v)), 'Line');
    } }] });
  }
}
function openSimplifyDialog() {
  const paths = selItems().flatMap(it => leafPaths(it));
  if (!paths.length) return toast('Select one or more paths to simplify.');
  const orig = paths.map(p => ({ p, segs: p.segments.map(s => s.clone()), closed: p.closed }));
  const before = orig.reduce((n, o) => n + o.segs.length, 0);
  const info = h('div', { class: 'hint' });
  const slider = h('input', { type: 'range', min: '0.2', max: '30', step: '0.1', value: '2.5', id: 'simpTol', style: { width: '100%' } });
  const apply = () => {
    const tol = +slider.value;
    for (const o of orig) { o.p.removeSegments(); o.p.addSegments(o.segs.map(s => s.clone())); o.p.closed = o.closed; o.p.simplify(tol); }
    const after = paths.reduce((n, p) => n + p.segments.length, 0);
    info.textContent = `Anchor points: ${before} → ${after}   (tolerance ${fmt(tol, 1)} px)`;
    requestDraw();
  };
  slider.addEventListener('input', apply);
  const restore = () => { for (const o of orig) { o.p.removeSegments(); o.p.addSegments(o.segs); o.p.closed = o.closed; } requestDraw(); };
  apply();
  openDialog({
    title: 'Simplify', body: [h('div', { class: 'cap' }, 'Fewer points ← → closer to original'), slider, info],
    buttons: [{ label: 'Cancel', onClick: restore }, { label: 'OK', primary: true, onClick: () => { paths.forEach(dropLive); commit('Simplify'); } }],
    onEscape: restore,
  });
}
function openOffsetDialog() {
  const items = selItems().filter(isPathLike);
  if (!items.length) return toast('Select a closed path to offset.');
  const fO = fLen('Offset', 10);
  openDialog({ title: 'Offset Path', body: [fO.el, h('p', { class: 'hint' }, 'Creates an approximate outline grown (positive) or shrunk (negative) by the offset. Works best on closed shapes.')], buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, onClick: () => {
    const d = fO.get();
    if (!d) return false;
    const out = [];
    for (const it of items) { const r = offsetPath(it, d); if (r) { r.insertAbove(it); out.push(r); } }
    if (out.length) { setSelection(out); commit('Offset Path'); }
  } }] });
}
// Approximate offset: sample the outline, push points along the normal, rebuild with simplify.
function offsetPath(it, d) {
  const paths = isCompound(it) ? it.children : [it];
  const res = [];
  for (const p of paths) {
    if (p.length < 1e-6) continue;
    const n = Math.max(24, Math.min(1500, Math.round(p.length / 2)));
    const cw = p.clockwise ? 1 : -1;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const off = p.length * i / n;
      const pt = p.getPointAt(off), nm = p.getNormalAt(off);
      if (pt && nm) pts.push(pt.add(nm.multiply(d * cw)));
    }
    const np = new paper.Path({ segments: pts, closed: p.closed, insert: false });
    np.simplify(0.4);
    res.push(np);
  }
  if (!res.length) return null;
  let out = res.length === 1 ? res[0] : new paper.CompoundPath({ children: res, insert: false });
  if (out.resolveCrossings) out = out.resolveCrossings();
  out.style = it.style;
  return out;
}
function outlineStroke() {
  const items = selItems().flatMap(it => leafPaths(it)).filter(p => p.strokeColor && p.strokeWidth > 0);
  if (!items.length) return toast('Select a path with a stroke to outline it.');
  const out = [];
  for (const p of items) {
    const w = p.strokeWidth / 2;
    const outer = offsetPath(p, w);
    let shape = outer;
    if (p.closed) { const inner = offsetPath(p, -w); if (outer && inner) shape = outer.subtract(inner, { insert: false }); }
    else {
      const n = Math.max(16, Math.min(1200, Math.round(p.length / 2)));
      const left = [], right = [];
      for (let i = 0; i <= n; i++) {
        const off = p.length * i / n, pt = p.getPointAt(off), nm = p.getNormalAt(off);
        if (!pt || !nm) continue;
        left.push(pt.add(nm.multiply(w))); right.unshift(pt.subtract(nm.multiply(w)));
      }
      shape = new paper.Path({ segments: left.concat(right), closed: true, insert: false });
      shape.simplify(0.3);
    }
    if (!shape) continue;
    shape.fillColor = p.strokeColor.clone(); shape.strokeColor = null; shape.opacity = p.opacity;
    shape.insertAbove(p); p.remove(); out.push(shape);
  }
  setSelection(out); commit('Outline Stroke');
}
