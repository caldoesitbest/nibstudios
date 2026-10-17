/* ============================================================
   Geometry: paints, frames, transforms, live corners, snapping, hit tests
   ============================================================ */
const P = (x, y) => new paper.Point(x, y);
const IDENT = () => new paper.Matrix();
const zoom = () => view.zoom;
const toView = p => view.projectToView(p);
const toProj = p => view.viewToProject(p);

/* ---------------- paint <-> paper ---------------- */
function colorFromPaper(pc) {
  if (!pc) return null;
  return C(Math.round(pc.red * 255), Math.round(pc.green * 255), Math.round(pc.blue * 255), +(pc.alpha == null ? 1 : pc.alpha).toFixed(3));
}
function paintFromPaper(pc) {
  if (!pc) return null;
  if (pc.type === 'gradient' && pc.gradient) {
    const g = pc.gradient;
    const stops = g.stops.map((s, i, a) => ({ c: colorFromPaper(s.color), o: s.offset != null ? +s.offset.toFixed(4) : i / Math.max(1, a.length - 1) }));
    const ang = pc.origin && pc.destination ? pc.destination.subtract(pc.origin).angle : 0;
    return { type: g.radial ? 'radial' : 'linear', angle: +(ang || 0).toFixed(2), stops };
  }
  return { type: 'solid', c: colorFromPaper(pc) };
}
const paperColor = c => new paper.Color(c.r / 255, c.g / 255, c.b / 255, c.a);
function itemLocalBounds(it) { return it.applyMatrix ? it.bounds : it.internalBounds; }
function gradientGeom(paint, b) {
  const c = b.center;
  if (paint.type === 'radial') return [c, c.add(P(Math.max(b.width, b.height) / 2 || 1, 0))];
  const dir = P(1, 0).rotate(paint.angle || 0);
  const L = Math.abs(b.width / 2 * dir.x) + Math.abs(b.height / 2 * dir.y) || 1;
  return [c.subtract(dir.multiply(L)), c.add(dir.multiply(L))];
}
function paintToPaper(paint, it, keepFrom) {
  if (!paint) return null;
  if (paint.type === 'solid') return paperColor(paint.c);
  const stops = paint.stops.slice().sort((a, b) => a.o - b.o).map(s => new paper.GradientStop(paperColor(s.c), s.o));
  let origin, destination;
  if (keepFrom && keepFrom.type === 'gradient' && keepFrom.gradient && !!keepFrom.gradient.radial === (paint.type === 'radial') && keepFrom.origin) {
    origin = keepFrom.origin.clone(); destination = keepFrom.destination.clone();
    if (paint.type === 'linear') {
      const cur = destination.subtract(origin);
      if (Math.abs(norm180(cur.angle - paint.angle)) > 0.05) {
        const mid = origin.add(destination).divide(2), half = cur.length / 2 || 1, d = P(1, 0).rotate(paint.angle).multiply(half);
        origin = mid.subtract(d); destination = mid.add(d);
      }
    }
  } else {
    [origin, destination] = gradientGeom(paint, itemLocalBounds(it));
  }
  return new paper.Color({ gradient: { stops, radial: paint.type === 'radial' }, origin, destination });
}

/* ---------------- frames (selection bounding boxes, possibly rotated) ---------------- */
let frameCache = null;
function invalidateFrame() { frameCache = null; }
function getFrame() {
  if (frameCache === null) frameCache = frameOf(selItems()) || false;
  return frameCache || null;
}
function boundsIn(it, m) {
  const pm = it.parent ? it.parent.globalMatrix : IDENT();
  return it.getBounds(m ? m.appended(pm) : pm);
}
function frameOf(items) {
  if (!items.length) return null;
  const angs = items.map(it => (it._data && it._data.angle) || 0);
  const same = angs.every(a => Math.abs(norm180(a - angs[0])) < 0.01);
  const angle = same ? angs[0] : 0;
  const m = angle ? new paper.Matrix().rotate(-angle) : null;
  let r = null;
  for (const it of items) {
    const b = boundsIn(it, m);
    if (!b || !isFinite(b.x)) continue;
    r = r ? r.unite(b) : b.clone();
  }
  if (!r) return null;
  return makeFrame(r, angle);
}
function makeFrame(rect, angle) {
  const f = q => angle ? q.rotate(angle, P(0, 0)) : q.clone();
  return {
    angle, rect,
    corners: [f(rect.topLeft), f(rect.topRight), f(rect.bottomRight), f(rect.bottomLeft)],
    center: f(rect.center),
    toF: p => angle ? p.rotate(-angle, P(0, 0)) : p.clone(),
    fromF: f,
  };
}
// 8 handles in frame space, clockwise from top-left
function frameHandles(fr) {
  const r = fr.rect;
  return [r.topLeft, r.topCenter, r.topRight, r.rightCenter, r.bottomRight, r.bottomCenter, r.bottomLeft, r.leftCenter].map(fr.fromF);
}
function unionBounds(items) {
  let r = null;
  for (const it of items) { const b = boundsIn(it); if (b && isFinite(b.x)) r = r ? r.unite(b) : b.clone(); }
  return r;
}
function refPoint(fr, idx = S.refPt) {
  const r = fr.rect, cx = [r.left, r.center.x, r.right][idx % 3], cy = [r.top, r.center.y, r.bottom][Math.floor(idx / 3)];
  return { f: P(cx, cy), p: fr.fromF(P(cx, cy)) };
}
function frameScaleMatrix(fr, sx, sy, anchorF) {
  return new paper.Matrix().rotate(fr.angle).translate(anchorF).scale(sx, sy).translate(anchorF.negate()).rotate(-fr.angle);
}

/* ---------------- transforms (keeps live rectangles and rotation bookkeeping) ---------------- */
function transformItem(it, m) {
  it.transform(m);
  fixLive(it, m);
  if (it._data && it._data.textPath && typeof afterPathTextTransform === 'function') afterPathTextTransform(it, m);
}
function transformItems(items, m) { for (const it of items) transformItem(it, m); invalidateFrame(); }
function fixLive(it, m) {
  const d = it._data;
  if (d && d.live && d.live.kind === 'rect') {
    d.live.c = d.live.c.map(a => { const p = m.transform(P(a[0], a[1])); return [p.x, p.y]; });
    regenLive(it);
  }
  if (it.children && it.applyMatrix && !isCompound(it)) for (const ch of it.children) fixLive(ch, m);
}
function rotateBookkeeping(items, da) {
  for (const it of items) it.data.angle = norm180(((it._data && it._data.angle) || 0) + da);
}
function reflectBookkeeping(items, axisAngle) {
  for (const it of items) it.data.angle = norm180(2 * axisAngle - ((it._data && it._data.angle) || 0));
}
function liveRect(x, y, w, h, r) { return { kind: 'rect', r: r || 0, c: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] }; }
function regenLive(it) {
  const L = it._data && it._data.live;
  if (!L || !isPath(it)) return;
  const [p0, p1, , p3] = L.c.map(a => P(a[0], a[1]));
  const ux = p1.subtract(p0), uy = p3.subtract(p0), w = ux.length, h = uy.length;
  if (w < 1e-6 || h < 1e-6 || Math.abs(ux.dot(uy)) > 1e-3 * w * h) { delete it._data.live; return; }
  const c = p0.add(ux.divide(2)).add(uy.divide(2));
  const r = Math.max(0, Math.min(L.r || 0, w / 2, h / 2));
  const tmp = new paper.Path.Rectangle({ rectangle: new paper.Rectangle(-w / 2, -h / 2, w, h), radius: r, insert: false });
  const ex = ux.normalize(), ey = uy.normalize();
  tmp.transform(new paper.Matrix(ex.x, ex.y, ey.x, ey.y, c.x, c.y));
  it.removeSegments();
  it.addSegments(tmp.segments);
  it.closed = true;
}
function liveSize(it) {
  const L = it._data && it._data.live; if (!L) return null;
  const [p0, p1, , p3] = L.c.map(a => P(a[0], a[1]));
  return { w: p0.getDistance(p1), h: p0.getDistance(p3), r: L.r };
}

/* ---------------- hit testing ---------------- */
function hitAny(pt, extraMatch) {
  return project.hitTest(pt, {
    fill: true, stroke: true, segments: false, tolerance: 4 / zoom(),
    match: h => isEditable(h.item) && h.item !== S.editingText && !(S.isolated && !S.isolated.isAncestor(h.item)) && (!extraMatch || extraMatch(h.item)),
  });
}
function hitTop(pt) {
  const h = hitAny(pt);
  if (!h) return null;
  if (S.isolated) { let it = h.item; while (it.parent && it.parent !== S.isolated) it = it.parent; return it.parent === S.isolated ? it : null; }
  return topLevel(h.item);
}
function hitLeaf(pt) { const h = hitAny(pt); return h ? h.item : null; }
function hitStroke(pt, tolPx = 5) {
  return project.hitTest(pt, { fill: false, stroke: true, curves: true, tolerance: tolPx / zoom(), match: h => isPath(h.item) && isEditable(h.item) });
}
// anchors & handles are tested in view space so they stay a constant size on screen
function viewPt(path, p) { return toView(path.localToGlobal(p)); }
function hitAnchor(vp, paths, rad = 6) {
  let best = null, bd = rad;
  for (const path of paths) {
    if (!alive(path)) continue;
    const segs = path.segments;
    for (let i = 0; i < segs.length; i++) {
      const d = viewPt(path, segs[i].point).getDistance(vp);
      if (d <= bd) { bd = d; best = { path, i }; }
    }
  }
  return best;
}
function hitHandleOf(vp, paths, rad = 6) {
  let best = null, bd = rad;
  for (const path of paths) {
    if (!alive(path)) continue;
    const segs = path.segments;
    for (let i = 0; i < segs.length; i++) {
      if (!isPtSelected(path, i) && !neighborSelected(path, i)) continue;
      const s = segs[i];
      for (const side of ['In', 'Out']) {
        const hv = s['handle' + side];
        if (hv.isZero()) continue;
        const d = viewPt(path, s.point.add(hv)).getDistance(vp);
        if (d <= bd) { bd = d; best = { path, i, side }; }
      }
    }
  }
  return best;
}
function neighborSelected(path, i) {
  const n = path.segments.length, s = sel.pts.get(path);
  if (!s) return true;
  const prev = i > 0 ? i - 1 : (path.closed ? n - 1 : -1), next = i < n - 1 ? i + 1 : (path.closed ? 0 : -1);
  return (prev >= 0 && s.has(prev)) || (next >= 0 && s.has(next));
}
function displayedPaths() {
  const out = [];
  for (const it of selItems()) leafPaths(it, out);
  return out;
}

/* ---------------- snapping & smart guides ---------------- */
function buildSnap(exclude) {
  const xs = [], ys = [], pts = [];
  const excluded = it => { for (let p = it; p; p = p.parent) if (exclude && exclude.has(p)) return true; return false; };
  for (const ab of doc.artboards) {
    for (const x of [ab.x, ab.x + ab.w / 2, ab.x + ab.w]) xs.push({ v: x, a: ab.y, b: ab.y + ab.h });
    for (const y of [ab.y, ab.y + ab.h / 2, ab.y + ab.h]) ys.push({ v: y, a: ab.x, b: ab.x + ab.w });
    pts.push(P(ab.x, ab.y), P(ab.x + ab.w, ab.y), P(ab.x, ab.y + ab.h), P(ab.x + ab.w, ab.y + ab.h), P(ab.x + ab.w / 2, ab.y + ab.h / 2));
  }
  if (S.view.smart) {
    for (const L of project.layers) {
      if (!L.visible) continue;
      for (const it of L.children) {
        if (!it.visible || excluded(it)) continue;
        const b = it.bounds;
        if (!b || !isFinite(b.x)) continue;
        for (const x of [b.left, b.center.x, b.right]) xs.push({ v: x, a: b.top, b: b.bottom });
        for (const y of [b.top, b.center.y, b.bottom]) ys.push({ v: y, a: b.left, b: b.right });
        pts.push(b.center);
        if (pts.length < 4000) for (const lp of leafPaths(it)) for (const s of lp.segments) pts.push(lp.localToGlobal(s.point));
      }
    }
  }
  if (S.view.guides) {
    for (const x of doc.guides.v) xs.push({ v: x, a: -1e7, b: 1e7, guide: true });
    for (const y of doc.guides.h) ys.push({ v: y, a: -1e7, b: 1e7, guide: true });
  }
  return { xs, ys, pts };
}
function nearest(list, v, tol) {
  let best = null, bd = tol;
  for (const t of list) { const d = Math.abs(t.v - v); if (d < bd) { bd = d; best = t; } }
  return best;
}
function gridSnap(v) { const g = S.view.gridSize / S.view.gridSub; return Math.round(v / g) * g; }
function snapPoint(p, cache, opts = {}) {
  S.snapLines = null;
  if (opts.disable) return p;
  if (S.view.snapGrid) { const ab = activeAB(); return P(gridSnap(p.x - ab.x) + ab.x, gridSnap(p.y - ab.y) + ab.y); }
  if (!cache) return p;
  const tol = 6 / zoom();
  let best = null, bd = tol;
  for (const q of cache.pts) { const d = q.getDistance(p); if (d < bd) { bd = d; best = q; } }
  if (best) { S.snapLines = [{ pt: best }]; return best.clone(); }
  const gx = nearest(cache.xs, p.x, tol), gy = nearest(cache.ys, p.y, tol);
  const out = P(gx ? gx.v : p.x, gy ? gy.v : p.y);
  const lines = [];
  if (gx) lines.push({ x: gx.v, a: Math.min(gx.a, out.y), b: Math.max(gx.b, out.y), guide: gx.guide });
  if (gy) lines.push({ y: gy.v, a: Math.min(gy.a, out.x), b: Math.max(gy.b, out.x), guide: gy.guide });
  S.snapLines = lines.length ? lines : null;
  return out;
}
function snapMove(b0, d, cache) {
  S.snapLines = null;
  if (S.view.snapGrid) {
    const ab = activeAB();
    const nx = gridSnap(b0.left + d.x - ab.x) + ab.x, ny = gridSnap(b0.top + d.y - ab.y) + ab.y;
    return P(nx - b0.left, ny - b0.top);
  }
  if (!cache) return d;
  const tol = 6 / zoom();
  let bx = null, by = null;
  for (const x of [b0.left, b0.center.x, b0.right]) {
    const t = nearest(cache.xs, x + d.x, tol);
    if (t && (!bx || Math.abs(t.v - x - d.x) < Math.abs(bx.delta))) bx = { t, delta: t.v - x - d.x };
  }
  for (const y of [b0.top, b0.center.y, b0.bottom]) {
    const t = nearest(cache.ys, y + d.y, tol);
    if (t && (!by || Math.abs(t.v - y - d.y) < Math.abs(by.delta))) by = { t, delta: t.v - y - d.y };
  }
  const out = P(d.x + (bx ? bx.delta : 0), d.y + (by ? by.delta : 0));
  const lines = [];
  if (bx) lines.push({ x: bx.t.v, a: Math.min(bx.t.a, b0.top + out.y), b: Math.max(bx.t.b, b0.bottom + out.y), guide: bx.t.guide });
  if (by) lines.push({ y: by.t.v, a: Math.min(by.t.a, b0.left + out.x), b: Math.max(by.t.b, b0.right + out.x), guide: by.t.guide });
  S.snapLines = lines.length ? lines : null;
  return out;
}
function constrain45(v) {
  if (v.isZero()) return v;
  const a = Math.round(v.angle / 45) * 45;
  const len = v.length * Math.cos((v.angle - a) * Math.PI / 180);
  return P(1, 0).rotate(a).multiply(len);
}
function constrainAxis(v) { return Math.abs(v.x) > Math.abs(v.y) ? P(v.x, 0) : P(0, v.y); }

/* ---------------- marquee ---------------- */
function touchesRect(it, rect) {
  const b = it.bounds;
  if (!b || !rect.intersects(b)) return false;
  if (rect.contains(b)) return true;
  if (isGroup(it) || isLayer(it)) return it.children.some(c => c.visible && touchesRect(c, rect));
  if (isPathLike(it)) {
    const rp = new paper.Path.Rectangle({ rectangle: rect, insert: false });
    if (it.getIntersections(rp).length) return true;
    if (it.hasFill() && it.contains(rect.center)) return true;
    const pts = leafPaths(it).flatMap(p => p.segments.map(s => s.point));
    return pts.some(p => rect.contains(p));
  }
  return true;
}
function marqueeTop(rect) {
  const out = [];
  const roots = S.isolated ? [S.isolated] : project.layers;
  for (const L of roots) {
    if (!isEditable(L)) continue;
    for (const it of L.children) if (it.visible && !it.locked && touchesRect(it, rect)) out.push(it);
  }
  return out;
}
function allEditablePaths() {
  const out = [];
  for (const L of project.layers) if (isEditable(L)) for (const it of L.children) if (it.visible && !it.locked) {
    for (const p of leafPaths(it)) if (isEditable(p)) out.push(p);
  }
  return out;
}
