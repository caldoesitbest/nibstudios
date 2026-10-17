/* ============================================================
   Tools
   ============================================================ */
const TOOLS = {};
const TOOL_GROUPS = [
  ['select'], ['direct'], '|',
  ['pen', 'penAdd', 'penDel', 'anchor'], ['type'], ['line'], ['rect', 'rrect', 'ellipse', 'polygon', 'star'], ['pencil', 'brush'], ['scissors'], '|',
  ['rotate', 'reflect'], ['scale'], ['gradient'], ['eyedropper'], '|',
  ['artboard'], ['hand'], ['zoom'],
];
const groupCurrent = {};
let D = null;
let spaceHeld = false, ctrlHeld = false, altHeld = false;
listeners.tool = [];

function defTool(id, spec) { TOOLS[id] = Object.assign({ id, display: 'anchors', cursor: CUR.cross }, spec); }
function setCursor(c) { if (cvOver.style.cursor !== c) cvOver.style.cursor = c; }
function effectiveToolId() {
  if (spaceHeld && !S.editingText) return 'hand';
  if (ctrlHeld && !S.editingText && !(D && D.active) && !['select', 'direct', 'zoom', 'hand'].includes(S.tool)) return S.lastSelTool;
  if (D && D.active && D.toolId) return D.toolId;
  return S.tool;
}
function setTool(id) {
  if (!TOOLS[id]) return;
  if (S.editingText && id !== 'type') commitTextEdit();
  const prev = TOOLS[S.tool];
  if (prev && prev.deactivate && S.tool !== id) prev.deactivate();
  if (id === 'select' || id === 'direct') S.lastSelTool = id;
  S.tool = id;
  TOOL_GROUPS.forEach((g, i) => { if (Array.isArray(g) && g.includes(id)) groupCurrent[i] = id; });
  const t = TOOLS[id];
  if (t.activate) t.activate();
  S.hover = null; S.snapLines = null; S.label = null;
  setCursor(typeof t.cursor === 'function' ? t.cursor() : t.cursor);
  emit('tool');
  requestDraw();
}
function refreshCursor() {
  const t = TOOLS[effectiveToolId()];
  if (cursorView && t.move && !(D && D.active)) t.move(evInfoFromView(cursorView));
  else setCursor(typeof t.cursor === 'function' ? t.cursor() : t.cursor);
}
function evInfoFromView(vp) { return { vp, pt: toProj(vp), shift: !!S.keys?.shift, alt: altHeld, ctrl: ctrlHeld, button: 0, synthetic: true }; }
function cancelToolState() { penFinish(true); D = null; S.marquee = null; S.snapLines = null; S.label = null; }
function canDrawOnLayer() {
  if (S.isolated) return true;
  const L = activeLayer();
  if (L.locked || !L.visible) { toast(`"${L.name}" is ${L.locked ? 'locked' : 'hidden'}. Unlock or show it, or choose another layer, to draw.`); return false; }
  return true;
}
function placeNew(it) {
  if (S.isolated && alive(S.isolated)) S.isolated.addChild(it); else activeLayer().addChild(it);
  return it;
}
function applyNewStyle(it, opts = {}) {
  let fill = S.style.fill, stroke = S.style.stroke;
  if (opts.noFill) fill = null;
  if (!fill && !stroke) stroke = solid('#000000');
  it.fillColor = paintToPaper(fill, it);
  it.strokeColor = paintToPaper(stroke, it);
  it.strokeWidth = S.style.strokeWidth;
  return it;
}
function measureLabel(r) { return `W: ${fmtU(r.width)}\nH: ${fmtU(r.height)}`; }

/* ---------------- Selection (V) ---------------- */
function hitFrameHandle(vp, fr) {
  if (!fr) return null;
  const hs = frameHandles(fr).map(toView);
  const tiny = fr.rect.width * zoom() < 14 && fr.rect.height * zoom() < 14;
  for (let i = 0; i < 8; i++) { if (tiny && i % 2) continue; if (hs[i].getDistance(vp) <= 6) return { type: 'scale', idx: i }; }
  const fp = fr.toF(toProj(vp)), r = fr.rect;
  const inside = fp.x > r.left && fp.x < r.right && fp.y > r.top && fp.y < r.bottom;
  if (!inside) for (const i of [0, 2, 4, 6]) { const d = hs[i].getDistance(vp); if (d > 6 && d <= 22) return { type: 'rotate', idx: i }; }
  return null;
}
function resizeCursor(idx, fr) {
  const base = [45, 90, 135, 0, 45, 90, 135, 0][idx];
  const a = (((base + fr.angle) % 180) + 180) % 180;
  const opts = [[0, 'ew-resize'], [45, 'nwse-resize'], [90, 'ns-resize'], [135, 'nesw-resize'], [180, 'ew-resize']];
  return opts.reduce((b, o) => Math.abs(o[0] - a) < Math.abs(b[0] - a) ? o : b)[1];
}
function hitGuide(vp) {
  if (!S.view.guides || S.view.lockGuides) return null;
  for (let i = 0; i < doc.guides.v.length; i++) if (Math.abs(toView(P(doc.guides.v[i], 0)).x - vp.x) <= 3) return { axis: 'v', i };
  for (let i = 0; i < doc.guides.h.length; i++) if (Math.abs(toView(P(0, doc.guides.h[i])).y - vp.y) <= 3) return { axis: 'h', i };
  return null;
}
defTool('select', {
  name: 'Selection Tool', key: 'V', icon: 'select', display: 'box', cursor: CUR.arrow,
  move(ev) {
    const fr = S.view.bbox ? getFrame() : null;
    const hh = hitFrameHandle(ev.vp, fr);
    if (hh) { S.hover = null; setCursor(hh.type === 'rotate' ? CUR.rotate : resizeCursor(hh.idx, fr)); return; }
    const it = hitTop(ev.pt);
    S.hover = it;
    if (it) { setCursor(sel.items.has(it) && ev.alt ? CUR.arrowDup : CUR.arrowObj); return; }
    const g = hitGuide(ev.vp);
    setCursor(g ? (g.axis === 'v' ? CUR.guideV : CUR.guideH) : CUR.arrow);
  },
  down(ev, D) {
    const fr = S.view.bbox ? getFrame() : null;
    const hh = hitFrameHandle(ev.vp, fr);
    if (hh) {
      D.mode = hh.type; D.idx = hh.idx; D.items = selItems(); D.fr = fr; D.total = IDENT();
      if (hh.type === 'rotate') D.a0 = ev.pt.subtract(fr.center).angle;
      return;
    }
    const it = hitTop(ev.pt);
    if (it) {
      if (ev.shift) { toggleInSelection(it); if (!sel.items.has(it)) { D.mode = 'none'; return; } }
      else if (!sel.items.has(it)) setSelection([it]);
      startMove(D);
      return;
    }
    const g = hitGuide(ev.vp);
    if (g) { D.mode = 'guide'; D.g = g; return; }
    if (!ev.shift) clearSelection();
    D.mode = 'marquee';
  },
  drag(ev, D) {
    if (D.mode === 'move') return dragMove(ev, D);
    if (D.mode === 'scale') return dragScale(ev, D);
    if (D.mode === 'rotate') return dragRotate(ev, D);
    if (D.mode === 'marquee') { S.marquee = new paper.Rectangle(D.startPt, ev.pt); return; }
    if (D.mode === 'guide') {
      const arr = D.g.axis === 'v' ? doc.guides.v : doc.guides.h;
      arr[D.g.i] = D.g.axis === 'v' ? ev.pt.x : ev.pt.y;
      S.label = { text: D.g.axis === 'v' ? `X: ${fmtU(ev.pt.x - activeAB().x)}` : `Y: ${fmtU(ev.pt.y - activeAB().y)}`, at: ev.vp };
    }
  },
  up(ev, D) {
    if (D.mode === 'move' || D.mode === 'scale' || D.mode === 'rotate') return finishXform(D);
    if (D.mode === 'marquee' && S.marquee) {
      const hits = marqueeTop(S.marquee);
      if (ev.shift) { hits.forEach(h => sel.items.has(h) ? sel.items.delete(h) : sel.items.add(h)); selectionChanged(); }
      else setSelection(hits);
    }
    if (D.mode === 'guide') {
      const arr = D.g.axis === 'v' ? doc.guides.v : doc.guides.h;
      if ((D.g.axis === 'v' && ev.vp.x < 0) || (D.g.axis === 'h' && ev.vp.y < 0)) arr.splice(D.g.i, 1);
      if (D.moved) commit('Move Guide');
    }
  },
  dbl(ev) {
    const leaf = hitLeaf(ev.pt);
    if (leaf && isText(leaf) && leaf.parent && isPathText(leaf.parent)) { focusPathText(leaf.parent); return; }
    if (leaf && isText(leaf)) { setTool('type'); startTextEdit(leaf); return; }
    const top = hitTop(ev.pt);
    if (top && isGroup(top) && !top.clipped) { enterIsolation(top); return; }
    if (!top && S.isolated) exitIsolation();
  },
});
function startMove(D) {
  D.mode = 'move'; D.items = selItems(); D.applied = P(0, 0); D.dup = false;
  D.b0 = unionBounds(D.items);
  D.snap = buildSnap(new Set(D.items));
}
function dragMove(ev, D) {
  let d = ev.pt.subtract(D.startPt);
  if (ev.shift) d = constrain45(d);
  if (!D.dup && ev.alt) {
    const clones = D.items.map(it => it.clone());
    transformItems(D.items, new paper.Matrix().translate(D.applied.negate()));
    D.items = clones; D.dup = true;
    sel.items = new Set(clones); sel.pts = new Map(); selectionChanged();
  }
  if (!ev.shift && D.b0) d = snapMove(D.b0, d, D.snap);
  const delta = d.subtract(D.applied);
  if (!delta.isZero()) { transformItems(D.items, new paper.Matrix().translate(delta)); D.applied = d; }
  S.label = { text: `dX: ${fmtU(d.x)}\ndY: ${fmtU(d.y)}`, at: ev.vp };
  setCursor(D.dup ? CUR.arrowDup : CUR.arrow);
}
function dragScale(ev, D) {
  const fr = D.fr, r = fr.rect, pF = fr.toF(ev.pt), i = D.idx;
  const xside = [0, 6, 7].includes(i) ? 'L' : [2, 3, 4].includes(i) ? 'R' : null;
  const yside = [0, 1, 2].includes(i) ? 'T' : [4, 5, 6].includes(i) ? 'B' : null;
  let sx = 1, sy = 1, fx = r.center.x, fy = r.center.y;
  if (xside) {
    fx = ev.alt ? r.center.x : (xside === 'L' ? r.right : r.left);
    const mx = xside === 'L' ? r.left : r.right;
    if (Math.abs(mx - fx) > 1e-9) sx = (pF.x - fx) / (mx - fx);
  }
  if (yside) {
    fy = ev.alt ? r.center.y : (yside === 'T' ? r.bottom : r.top);
    const my = yside === 'T' ? r.top : r.bottom;
    if (Math.abs(my - fy) > 1e-9) sy = (pF.y - fy) / (my - fy);
  }
  if (ev.shift) {
    if (xside && yside) { const s = Math.max(Math.abs(sx), Math.abs(sy)); sx = Math.sign(sx || 1) * s; sy = Math.sign(sy || 1) * s; }
    else if (xside) sy = Math.abs(sx); else if (yside) sx = Math.abs(sy);
  }
  const fix = v => Math.abs(v) < 1e-4 ? 1e-4 * (Math.sign(v) || 1) : v;
  sx = fix(sx); sy = fix(sy);
  const M = frameScaleMatrix(fr, sx, sy, P(fx, fy));
  transformItems(D.items, M.appended(D.total.inverted()));
  D.total = M;
  S.label = { text: `W: ${fmtU(r.width * Math.abs(sx))}\nH: ${fmtU(r.height * Math.abs(sy))}`, at: ev.vp };
  setCursor(resizeCursor(i, fr));
}
function dragRotate(ev, D) {
  let a = ev.pt.subtract(D.fr.center).angle - D.a0;
  if (ev.shift) a = Math.round((a + D.fr.angle) / 45) * 45 - D.fr.angle;
  const M = new paper.Matrix().rotate(a, D.fr.center);
  transformItems(D.items, M.appended(D.total.inverted()));
  D.total = M; D.da = a;
  S.label = { text: `${fmt(norm180(-(D.fr.angle + a)), 1)}°`, at: ev.vp };
  setCursor(CUR.rotate);
}
function finishXform(D) {
  if (!D.moved) return;
  if (D.mode === 'rotate' && D.da) rotateBookkeeping(D.items, D.da);
  if (D.mode === 'move' && D.applied.isZero() && !D.dup) return;
  S.lastXform = { m: D.mode === 'move' ? new paper.Matrix().translate(D.applied) : D.total, copy: !!D.dup, rot: D.mode === 'rotate' ? D.da || 0 : 0 };
  invalidateFrame();
  commit(D.dup ? 'Duplicate' : D.mode === 'move' ? 'Move' : D.mode === 'scale' ? 'Scale' : 'Rotate');
}

/* ---------------- Isolation mode ---------------- */
function enterIsolation(g) { S.isolated = g; setSelection([]); emit('doc'); toastQuiet('Isolation mode — double-click outside or press Esc to exit'); }
function exitIsolation() { if (!S.isolated) return; const g = S.isolated; S.isolated = null; setSelection(alive(g) ? [g] : []); emit('doc'); }

/* ---------------- Direct Selection (A) ---------------- */
function directLeaf(pt) {
  const leaf = hitLeaf(pt);
  if (leaf && leaf._data && leaf._data.pathGlyph && leaf.parent && isPathText(leaf.parent)) return pathTextGuide(leaf.parent);
  return leaf;
}
function anchorCandidates(ev) {
  const out = displayedPaths();
  const leaf = directLeaf(ev.pt);
  if (leaf && isPath(leaf) && !out.includes(leaf)) out.push(leaf);
  return out;
}
function movePoints(delta) {
  for (const it of selItems()) {
    const set = sel.pts.get(it);
    if (!set || !isPath(it)) { transformItem(it, new paper.Matrix().translate(delta)); continue; }
    const g0 = it.globalToLocal(P(0, 0)), g1 = it.globalToLocal(delta), ld = g1.subtract(g0);
    for (const i of set) { const s = it.segments[i]; if (s) s.point = s.point.add(ld); }
    dropLive(it);
  }
  invalidateFrame();
}
defTool('direct', {
  name: 'Direct Selection Tool', key: 'A', icon: 'direct', display: 'anchors', cursor: CUR.white,
  move(ev) {
    const hh = hitHandleOf(ev.vp, displayedPaths());
    const a = hh ? null : hitAnchor(ev.vp, anchorCandidates(ev));
    const leaf = directLeaf(ev.pt);
    S.hover = leaf;
    setCursor(hh || a ? CUR.whitePt : leaf ? CUR.whiteObj : CUR.white);
  },
  down(ev, D) {
    const hh = hitHandleOf(ev.vp, displayedPaths());
    if (hh) {
      const s = hh.path.segments[hh.i];
      const other = s['handle' + (hh.side === 'In' ? 'Out' : 'In')];
      D.mode = 'handle'; D.h = hh;
      D.smooth = !other.isZero() && Math.abs(Math.abs(s['handle' + hh.side].angle - other.angle) - 180) < 2;
      D.otherLen = other.length;
      return;
    }
    const a = hitAnchor(ev.vp, anchorCandidates(ev));
    if (a) {
      if (ev.shift) {
        const set = new Set(sel.pts.get(a.path) || (sel.items.has(a.path) ? a.path.segments.map((_, i) => i) : []));
        set.has(a.i) ? set.delete(a.i) : set.add(a.i);
        if (set.size) { sel.items.add(a.path); sel.pts.set(a.path, set); } else { sel.items.delete(a.path); sel.pts.delete(a.path); }
        selectionChanged();
      } else if (!(sel.items.has(a.path) && isPtSelected(a.path, a.i))) {
        setSelection([a.path], new Map([[a.path, new Set([a.i])]]));
      }
      D.mode = 'points'; D.applied = P(0, 0);
      D.anchor = a.path.localToGlobal(a.path.segments[a.i].point);
      D.snap = buildSnap(new Set(selItems().filter(it => !sel.pts.has(it))));
      return;
    }
    const leaf = directLeaf(ev.pt);
    if (leaf) {
      if (ev.shift) toggleInSelection(leaf);
      else if (!sel.items.has(leaf) || sel.pts.has(leaf)) setSelection([leaf]);
      D.mode = 'points'; D.applied = P(0, 0); D.anchor = null;
      D.b0 = unionBounds(selItems()); D.snap = buildSnap(new Set(selItems()));
      return;
    }
    if (!ev.shift) clearSelection();
    D.mode = 'marquee';
  },
  drag(ev, D) {
    if (D.mode === 'points') {
      let d = ev.pt.subtract(D.startPt);
      if (ev.shift) d = constrain45(d);
      else if (D.anchor) d = snapPoint(D.anchor.add(d), D.snap).subtract(D.anchor);
      else if (D.b0) d = snapMove(D.b0, d, D.snap);
      const delta = d.subtract(D.applied);
      if (!delta.isZero()) { movePoints(delta); D.applied = d; }
      S.label = { text: `dX: ${fmtU(d.x)}\ndY: ${fmtU(d.y)}`, at: ev.vp };
    } else if (D.mode === 'handle') {
      const { path, i, side } = D.h, s = path.segments[i];
      let v = path.globalToLocal(ev.pt).subtract(s.point);
      if (ev.shift) v = constrain45(v);
      s['handle' + side] = v;
      if (D.smooth && !ev.alt && !v.isZero()) s['handle' + (side === 'In' ? 'Out' : 'In')] = v.normalize(-D.otherLen);
      dropLive(path);
    } else if (D.mode === 'marquee') S.marquee = new paper.Rectangle(D.startPt, ev.pt);
  },
  up(ev, D) {
    if ((D.mode === 'points' && !D.applied.isZero()) || (D.mode === 'handle' && D.moved)) { invalidateFrame(); commit(D.mode === 'handle' ? 'Edit Handle' : 'Move Points'); return; }
    if (D.mode === 'marquee' && S.marquee) {
      const r = S.marquee;
      const items = ev.shift ? new Set(sel.items) : new Set();
      const pts = ev.shift ? new Map(sel.pts) : new Map();
      for (const p of allEditablePaths()) {
        const idx = [];
        p.segments.forEach((s, i) => { if (r.contains(p.localToGlobal(s.point))) idx.push(i); });
        if (idx.length) { items.add(p); const set = new Set(pts.get(p) || []); idx.forEach(i => set.add(i)); pts.set(p, set); }
      }
      for (const it of marqueeTop(r)) for (const l of leafItems(it)) if ((isText(l) || isRaster(l)) && r.intersects(l.bounds)) items.add(l);
      setSelection([...items], pts);
    }
  },
  dbl(ev) { const leaf = hitLeaf(ev.pt); if (leaf && isText(leaf)) { setTool('type'); startTextEdit(leaf); } },
});

/* ---------------- Pen family ---------------- */
const pen = { path: null, seg: null, preview: null, hoverKind: null };
function penFinish(silent) {
  const p = pen.path;
  pen.path = null; pen.seg = null; pen.preview = null;
  if (p && alive(p) && p.segments.length < 2) { p.remove(); setSelection([]); if (!silent) commit('Pen'); }
  requestDraw();
}
function penHover(ev) {
  if (pen.path && alive(pen.path)) {
    const segs = pen.path.segments;
    if (segs.length > 1 && viewPt(pen.path, segs[0].point).getDistance(ev.vp) <= 7) return { kind: 'close', cursor: CUR.penClose };
    if (viewPt(pen.path, segs[segs.length - 1].point).getDistance(ev.vp) <= 6) return { kind: 'last', cursor: CUR.penConvert };
    return { kind: 'add', cursor: CUR.penPlain };
  }
  if (pen.path) pen.path = null;
  const paths = displayedPaths();
  const a = hitAnchor(ev.vp, paths);
  if (a) {
    if (!a.path.closed && (a.i === 0 || a.i === a.path.segments.length - 1)) return { kind: 'continue', a, cursor: CUR.penCont };
    return { kind: 'delete', a, cursor: CUR.penDel };
  }
  for (const p of paths) {
    const loc = p.getNearestLocation(p.globalToLocal(ev.pt));
    if (loc && toView(p.localToGlobal(loc.point)).getDistance(ev.vp) <= 5) return { kind: 'insert', path: p, loc, cursor: CUR.penAdd };
  }
  return { kind: 'new', cursor: CUR.pen };
}
function selectLastPoint() {
  const p = pen.path;
  sel.items = new Set([p]); sel.pts = new Map([[p, new Set([p.segments.length - 1])]]);
  selectionChanged();
}
defTool('pen', {
  name: 'Pen Tool', key: 'P', icon: 'pen', display: 'anchors', cursor: CUR.pen,
  deactivate() { penFinish(); },
  move(ev) {
    const st = penHover(ev);
    pen.hoverKind = st.kind;
    setCursor(st.cursor);
    if (pen.path) {
      const last = pen.path.lastSegment.point;
      let p = st.kind === 'close' ? pen.path.firstSegment.point : ev.pt;
      if (st.kind !== 'close') { if (ev.shift) p = last.add(constrain45(p.subtract(last))); else p = snapPoint(p, pen.snap || (pen.snap = buildSnap(new Set([pen.path])))); }
      pen.preview = p;
    } else { pen.preview = null; snapPoint(ev.pt, buildSnapCached()); }
  },
  down(ev, D) {
    const st = penHover(ev);
    pen.snap = null;
    if (st.kind === 'delete') {
      const p = st.a.path; p.removeSegment(st.a.i); dropLive(p);
      if (p.segments.length < 2) { p.remove(); setSelection([]); } else setSelection([p]);
      commit('Delete Anchor'); D.done = true; return;
    }
    if (st.kind === 'insert') { st.path.divideAt(st.loc); dropLive(st.path); setSelection([st.path]); commit('Add Anchor'); D.done = true; return; }
    if (st.kind === 'continue') {
      pen.path = st.a.path; if (st.a.i === 0) pen.path.reverse(); dropLive(pen.path);
      selectLastPoint(); D.done = true; return;
    }
    if (!pen.path) {
      if (!canDrawOnLayer()) { D.done = true; return; }
      const p = snapPoint(ev.pt, buildSnapCached());
      pen.path = placeNew(new paper.Path({ segments: [p], insert: false }));
      applyNewStyle(pen.path);
      pen.seg = pen.path.firstSegment; D.mode = 'new';
      selectLastPoint();
      return;
    }
    if (st.kind === 'close') { pen.path.closed = true; pen.seg = pen.path.firstSegment; D.mode = 'close'; D.origOut = pen.seg.handleOut.clone(); return; }
    if (st.kind === 'last') { pen.seg = pen.path.lastSegment; D.mode = 'last'; return; }
    const last = pen.path.lastSegment.point;
    const p = ev.shift ? last.add(constrain45(ev.pt.subtract(last))) : snapPoint(ev.pt, buildSnap(new Set([pen.path])));
    pen.seg = pen.path.add(p); D.mode = 'new';
    selectLastPoint();
  },
  drag(ev, D) {
    if (D.done || !pen.seg) return;
    const seg = pen.seg;
    let v = ev.pt.subtract(seg.point);
    if (ev.shift) v = constrain45(v);
    if (D.mode === 'new') { seg.handleOut = v; if (!ev.alt) seg.handleIn = v.negate(); }
    else if (D.mode === 'close') { seg.handleIn = v.negate(); if (!ev.alt && !D.origOut.isZero()) seg.handleOut = v.normalize(D.origOut.length); }
    else if (D.mode === 'last') seg.handleOut = v;
    pen.preview = null;
    S.label = { text: `${fmtU(v.length)}  ${fmt(-v.angle, 1)}°`, at: ev.vp };
  },
  up(ev, D) {
    if (D.done) return;
    if (D.mode === 'last' && !D.moved) pen.seg.handleOut = P(0, 0);
    if (D.mode === 'close') { const p = pen.path; pen.path = null; pen.seg = null; setSelection([p]); commit('Close Path'); return; }
    commit('Pen');
  },
  overlay(ctx) {
    if (!pen.path || !alive(pen.path) || !pen.preview || (D && D.active)) return;
    const last = pen.path.lastSegment;
    const a = viewPt(pen.path, last.point), c1 = viewPt(pen.path, last.point.add(last.handleOut)), b = toView(pen.preview);
    let c2 = b;
    if (pen.hoverKind === 'close') { const f = pen.path.firstSegment; c2 = viewPt(pen.path, f.point.add(f.handleIn)); }
    ctx.strokeStyle = layerColor(pen.path); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y); ctx.stroke();
  },
  onKey(e) {
    if ((e.key === 'Enter' || e.key === 'Escape') && pen.path) { const p = pen.path; penFinish(); if (alive(p)) setSelection([p]); return true; }
    return false;
  },
});
let snapCacheT = 0, snapCacheV = null;
function buildSnapCached() { const now = performance.now(); if (!snapCacheV || now - snapCacheT > 400) { snapCacheV = buildSnap(new Set(selItems())); snapCacheT = now; } return snapCacheV; }

defTool('penAdd', {
  name: 'Add Anchor Point Tool', key: 'Shift+=', icon: 'penAdd', display: 'anchors', cursor: CUR.penAdd,
  move(ev) { const h = hitStroke(ev.pt, 6); S.hover = h ? h.item : null; setCursor(h ? CUR.penAdd : CUR.penPlain); },
  down(ev, D) {
    D.done = true;
    const h = hitStroke(ev.pt, 6);
    if (!h || !h.location) return;
    h.item.divideAt(h.location); dropLive(h.item);
    setSelection([h.item]); commit('Add Anchor');
  },
});
defTool('penDel', {
  name: 'Delete Anchor Point Tool', key: '-', icon: 'penDel', display: 'anchors', cursor: CUR.penDel,
  move(ev) { const a = hitAnchor(ev.vp, anchorCandidates(ev)); S.hover = hitLeaf(ev.pt); setCursor(a ? CUR.penDel : CUR.penPlain); },
  down(ev, D) {
    D.done = true;
    const a = hitAnchor(ev.vp, anchorCandidates(ev));
    if (!a) return;
    a.path.removeSegment(a.i); dropLive(a.path);
    if (a.path.segments.length < 2) { a.path.remove(); setSelection([]); } else setSelection([a.path]);
    commit('Delete Anchor');
  },
});
defTool('anchor', {
  name: 'Anchor Point Tool', key: 'Shift+C', icon: 'anchor', display: 'anchors', cursor: CUR.convert,
  move(ev) { const hh = hitHandleOf(ev.vp, displayedPaths()); const a = hitAnchor(ev.vp, anchorCandidates(ev)); S.hover = hitLeaf(ev.pt); setCursor(hh || a ? CUR.convert : CUR.white); },
  down(ev, D) {
    const hh = hitHandleOf(ev.vp, displayedPaths());
    if (hh) { D.mode = 'handle'; D.h = hh; return; }
    const a = hitAnchor(ev.vp, anchorCandidates(ev));
    if (a) { D.mode = 'anchor'; D.a = a; setSelection([a.path], new Map([[a.path, new Set([a.i])]])); return; }
    const leaf = hitLeaf(ev.pt);
    if (leaf && isPath(leaf)) setSelection([leaf]); else clearSelection();
    D.done = true;
  },
  drag(ev, D) {
    if (D.mode === 'anchor') { const p = D.a.path, s = p.segments[D.a.i]; let v = p.globalToLocal(ev.pt).subtract(s.point); if (ev.shift) v = constrain45(v); s.handleOut = v; s.handleIn = v.negate(); dropLive(p); }
    else if (D.mode === 'handle') { const p = D.h.path, s = p.segments[D.h.i]; s['handle' + D.h.side] = p.globalToLocal(ev.pt).subtract(s.point); dropLive(p); }
  },
  up(ev, D) {
    if (D.done) return;
    if (D.mode === 'anchor' && !D.moved) { const s = D.a.path.segments[D.a.i]; s.handleIn = P(0, 0); s.handleOut = P(0, 0); dropLive(D.a.path); }
    commit('Convert Anchor');
  },
});

/* ---------------- Shapes ---------------- */
function rectFrom(p0, p1, ev) {
  let w = p1.x - p0.x, hh = p1.y - p0.y;
  if (ev.shift) { const s = Math.max(Math.abs(w), Math.abs(hh)); w = (Math.sign(w) || 1) * s; hh = (Math.sign(hh) || 1) * s; }
  let x = p0.x, y = p0.y;
  if (ev.alt) { x -= w; y -= hh; w *= 2; hh *= 2; }
  return new paper.Rectangle(P(x, y), P(x + w, y + hh));
}
function makeRect(r, radius = 0) {
  const p = new paper.Path.Rectangle({ rectangle: r, radius: Math.min(radius, r.width / 2, r.height / 2), insert: false });
  p.data.live = liveRect(r.x, r.y, r.width, r.height, radius);
  return p;
}
function makeEllipse(r) { const p = new paper.Path.Ellipse({ rectangle: r, insert: false }); p.data.shape = 'Ellipse'; return p; }
function makePolygon(c, radius, sides, rot) {
  const p = new paper.Path.RegularPolygon({ center: c, sides: Math.max(3, sides), radius: Math.max(radius, 0.01), insert: false });
  if (rot) p.rotate(rot, c);
  p.data.shape = 'Polygon';
  return p;
}
function makeStar(c, r1, r2, points, rot) {
  const p = new paper.Path.Star({ center: c, points: Math.max(3, points), radius1: Math.max(r1, 0.01), radius2: Math.max(r2, 0.01), insert: false });
  if (rot) p.rotate(rot, c);
  p.data.shape = 'Star';
  return p;
}
function makeLine(a, b) { const p = new paper.Path.Line({ from: a, to: b, insert: false }); p.data.shape = 'Line'; return p; }
const SHAPES = {
  rect: { name: 'Rectangle Tool', key: 'M', build: (p0, p1, ev) => { const r = rectFrom(p0, p1, ev); return { item: makeRect(r, 0), label: measureLabel(r) }; } },
  rrect: { name: 'Rounded Rectangle Tool', key: null, build: (p0, p1, ev) => { const r = rectFrom(p0, p1, ev); return { item: makeRect(r, S.shape.radius), label: measureLabel(r) + `\nR: ${fmtU(S.shape.radius)}` }; } },
  ellipse: { name: 'Ellipse Tool', key: 'L', build: (p0, p1, ev) => { const r = rectFrom(p0, p1, ev); return { item: makeEllipse(r), label: measureLabel(r) }; } },
  polygon: { name: 'Polygon Tool', key: null, build: (p0, p1, ev) => { const v = p1.subtract(p0); return { item: makePolygon(p0, v.length, S.shape.sides, ev.shift ? 0 : v.angle - 90), label: `R: ${fmtU(v.length)}\nSides: ${S.shape.sides}` }; } },
  star: { name: 'Star Tool', key: null, build: (p0, p1, ev) => { const v = p1.subtract(p0); return { item: makeStar(p0, v.length, v.length * S.shape.ratio, S.shape.points, ev.shift ? 0 : v.angle - 90), label: `R: ${fmtU(v.length)}\nPoints: ${S.shape.points}` }; } },
  line: { name: 'Line Segment Tool', key: '\\', build: (p0, p1, ev) => { let v = p1.subtract(p0); if (ev.shift) v = constrain45(v); const a = ev.alt ? p0.subtract(v) : p0, b = p0.add(v); return { item: makeLine(a, b), label: `D: ${fmtU(b.getDistance(a))}\n∠: ${fmt(norm180(-v.angle), 1)}°`, line: true }; } },
};
for (const id in SHAPES) {
  const spec = SHAPES[id];
  defTool(id, {
    name: spec.name, key: spec.key, icon: id, display: 'anchors', cursor: CUR.cross,
    move(ev) { setCursor(CUR.cross); S.hover = null; snapPoint(ev.pt, buildSnapCached()); },
    down(ev, D) {
      if (!canDrawOnLayer()) { D.done = true; return; }
      D.snap = buildSnap(new Set()); D.p0 = snapPoint(ev.pt, D.snap); D.item = null;
    },
    drag(ev, D) {
      if (D.done) return;
      D.ev = ev;
      const p1 = ev.shift && id !== 'line' ? ev.pt : snapPoint(ev.pt, D.snap);
      if (D.item) D.item.remove();
      const res = spec.build(D.p0, p1, ev);
      D.item = placeNew(res.item);
      applyNewStyle(D.item, { noFill: !!res.line });
      if (res.line && !D.item.strokeColor) D.item.strokeColor = paperColor(C(0, 0, 0, 1));
      S.label = { text: res.label, at: ev.vp };
    },
    up(ev, D) {
      if (D.done) return;
      if (!D.moved || !D.item) { if (D.item) D.item.remove(); openShapeDialog(id, D.p0, ev.alt); return; }
      const b = D.item.bounds;
      if (b.width < 0.01 && b.height < 0.01) { D.item.remove(); return; }
      setSelection([D.item]);
      commit(spec.name.replace(' Tool', ''));
    },
    onKey(e) {
      if (!D || !D.active || D.toolId !== id || !D.ev) return false;
      const up = e.key === 'ArrowUp', dn = e.key === 'ArrowDown';
      if (!up && !dn) return false;
      if (id === 'polygon') S.shape.sides = clamp(S.shape.sides + (up ? 1 : -1), 3, 100);
      else if (id === 'star') S.shape.points = clamp(S.shape.points + (up ? 1 : -1), 3, 100);
      else if (id === 'rrect') S.shape.radius = Math.max(0, S.shape.radius + (up ? 1 : -1));
      else return false;
      TOOLS[id].drag(D.ev, D); requestDraw(); emit('tool');
      return true;
    },
  });
}

/* ---------------- Pencil & Paintbrush ---------------- */
for (const id of ['pencil', 'brush']) {
  defTool(id, {
    name: id === 'pencil' ? 'Pencil Tool' : 'Paintbrush Tool', key: id === 'pencil' ? 'N' : 'B', icon: id, display: 'anchors', cursor: CUR.pencil,
    move() { setCursor(CUR.pencil); },
    down(ev, D) {
      if (!canDrawOnLayer()) { D.done = true; return; }
      const p = placeNew(new paper.Path({ insert: false }));
      p.strokeColor = paintToPaper(S.style.stroke || solid('#000000'), p);
      p.strokeWidth = id === 'brush' ? Math.max(S.style.strokeWidth, 3) : S.style.strokeWidth;
      if (id === 'brush') { p.strokeCap = 'round'; p.strokeJoin = 'round'; }
      p.add(ev.pt);
      D.path = p;
    },
    drag(ev, D) { if (!D.done) D.path.add(ev.pt); },
    up(ev, D) {
      if (D.done) return;
      const p = D.path;
      if (p.segments.length < 2) { p.remove(); return; }
      const closeIt = ev.alt && toView(p.firstSegment.point).getDistance(toView(p.lastSegment.point)) < 14;
      p.simplify(2.5 / zoom());
      if (closeIt) p.closed = true;
      if (S.style.stroke && S.style.stroke.type !== 'solid') p.strokeColor = paintToPaper(S.style.stroke, p);
      setSelection([p]);
      commit(id === 'pencil' ? 'Pencil' : 'Paintbrush');
    },
  });
}

/* ---------------- Type ---------------- */
const ted = $('#textEditor');
const measureCtx = document.createElement('canvas').getContext('2d');
defTool('type', {
  name: 'Type Tool', key: 'T', icon: 'type', display: 'outline', cursor: CUR.text,
  move(ev) { const it = hitLeaf(ev.pt); S.hover = it && isText(it) ? it : null; setCursor(CUR.text); },
  down(ev, D) {
    D.done = true;
    if (S.editingText) commitTextEdit();
    const it = hitLeaf(ev.pt);
    if (it && isText(it) && it.parent && isPathText(it.parent)) { focusPathText(it.parent); return; }
    if (it && isText(it)) { startTextEdit(it); return; }
    if (!canDrawOnLayer()) return;
    const t = placeNew(new paper.PointText({ point: ev.pt, content: '', insert: false }));
    t.fillColor = paperColor(C(0, 0, 0, 1));
    t.fontFamily = S.text.family; t.fontSize = S.text.size; t.fontWeight = S.text.weight; t.justification = S.text.justification;
    startTextEdit(t, true);
  },
  deactivate() { commitTextEdit(); },
});
function startTextEdit(t, isNew) {
  S.editingText = t; S.editingNew = !!isNew; S.editingOrig = t.content; S.editStart = performance.now();
  sel.items = new Set([t]); sel.pts = new Map(); selectionChanged();
  ted.value = t.content;
  ted.hidden = false;
  layoutTextEditor();
  t.visible = false;
  setTimeout(() => { ted.focus(); const n = ted.value.length; ted.setSelectionRange(n, n); }, 0);
  requestDraw();
}
function layoutTextEditor() {
  const t = S.editingText;
  if (!t || !alive(t)) return;
  const fs = t.fontSize, lead = t.leading || fs * 1.2;
  const font = `${t.fontWeight} ${fs}px ${t.fontFamily}`;
  ted.style.font = font; ted.style.lineHeight = lead + 'px';
  const fc = t.fillColor;
  ted.style.color = fc && fc.type !== 'gradient' ? fc.toCSS() : '#000';
  ted.style.textAlign = t.justification;
  measureCtx.font = font;
  const lines = ted.value.split('\n');
  const w = Math.max(fs * 0.6, ...lines.map(l => measureCtx.measureText(l).width)) + fs * 0.5;
  ted.style.width = w + 'px';
  ted.style.height = (lines.length * lead + 2) + 'px';
  const lx = t.justification === 'center' ? -w / 2 : t.justification === 'right' ? -w : 0;
  const m = view.matrix.appended(t.globalMatrix).appended(new paper.Matrix().translate(lx, -0.77 * lead));
  ted.style.transform = `matrix(${m.a},${m.b},${m.c},${m.d},${m.tx},${m.ty})`;
}
function commitTextEdit() {
  const t = S.editingText;
  if (!t) return;
  S.editingText = null;
  const val = ted.value;
  ted.hidden = true;
  if (document.activeElement === ted) ted.blur();
  if (alive(t)) {
    t.visible = true;
    if (!val.trim()) {
      t.remove(); setSelection([]);
      if (!S.editingNew) commit('Delete Text');
    } else if (val !== S.editingOrig || S.editingNew) {
      t.content = val; setSelection([t]); commit(S.editingNew ? 'Type' : 'Edit Text');
    } else setSelection([t]);
  }
  requestDraw();
}
ted.addEventListener('input', () => layoutTextEditor());
ted.addEventListener('keydown', e => {
  if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); commitTextEdit(); setTool('select'); }
  e.stopPropagation();
});
ted.addEventListener('blur', () => { if (S.editingText && performance.now() - S.editStart > 250) commitTextEdit(); });

/* ---------------- Scissors ---------------- */
defTool('scissors', {
  name: 'Scissors Tool', key: 'C', icon: 'scissors', display: 'anchors', cursor: CUR.scissors,
  move(ev) { const h = hitStroke(ev.pt, 6); S.hover = h ? h.item : null; setCursor(CUR.scissors); },
  down(ev, D) {
    D.done = true;
    const h = hitStroke(ev.pt, 6);
    if (!h || !h.location) { toast('Click on a path segment or anchor point to split the path.'); return; }
    const path = h.item;
    const res = path.splitAt(h.location);
    dropLive(path);
    setSelection(res && res !== path ? [path, res] : [path]);
    commit('Split Path');
  },
});

/* ---------------- Rotate / Reflect / Scale ---------------- */
const xt = { origin: null };
on('selection', () => { if (!(D && D.active)) xt.origin = null; });
function xformOrigin() { const fr = getFrame(); return xt.origin || (fr ? fr.center : null); }
function xformToolMatrix(kind, o, v0, ev) {
  const v = ev.pt.subtract(o);
  if (kind === 'rotate') { let a = v.angle - v0.angle; if (ev.shift) a = Math.round(a / 45) * 45; return { m: new paper.Matrix().rotate(a, o), a, label: `${fmt(norm180(-a), 1)}°` }; }
  if (kind === 'reflect') { let a = v.angle; if (ev.shift) a = Math.round(a / 45) * 45; return { m: new paper.Matrix().translate(o).rotate(a).scale(1, -1).rotate(-a).translate(o.negate()), axis: a, label: `Axis ${fmt(norm180(-a), 1)}°` }; }
  let sx = Math.abs(v0.x) > 1e-6 ? v.x / v0.x : 1, sy = Math.abs(v0.y) > 1e-6 ? v.y / v0.y : 1;
  if (ev.shift) { const s = v.dot(v0) / (v0.dot(v0) || 1); sx = sy = s; }
  const fix = s => Math.abs(s) < 1e-4 ? 1e-4 * (Math.sign(s) || 1) : s;
  sx = fix(sx); sy = fix(sy);
  return { m: new paper.Matrix().translate(o).scale(sx, sy).translate(o.negate()), label: `H: ${fmt(sx * 100, 1)}%\nV: ${fmt(sy * 100, 1)}%` };
}
for (const [id, name, key] of [['rotate', 'Rotate Tool', 'R'], ['reflect', 'Reflect Tool', 'O'], ['scale', 'Scale Tool', 'S']]) {
  defTool(id, {
    name, key, icon: id, display: 'outline', cursor: CUR.cross,
    move(ev) { S.hover = selItems().length ? null : hitTop(ev.pt); setCursor(selItems().length ? (id === 'rotate' ? CUR.rotate : CUR.cross) : CUR.arrow); },
    down(ev, D) {
      const items = selItems();
      if (!items.length) { const it = hitTop(ev.pt); if (it) setSelection([it]); D.done = true; return; }
      if (ev.alt) { xt.origin = ev.pt; D.done = true; requestDraw(); openTransformDialog(id); return; }
      D.items = items; D.o = xformOrigin(); D.v0 = ev.pt.subtract(D.o); D.total = IDENT();
      if (D.v0.length * zoom() < 4) D.v0 = P(40 / zoom(), 0);
    },
    drag(ev, D) {
      if (D.done) return;
      const r = xformToolMatrix(id, D.o, D.v0, ev);
      transformItems(D.items, r.m.appended(D.total.inverted()));
      D.total = r.m; D.res = r;
      S.label = { text: r.label + (ev.alt ? '\n(copy)' : ''), at: ev.vp };
    },
    up(ev, D) {
      if (D.done) return;
      if (!D.moved) { xt.origin = ev.pt; requestDraw(); return; }
      let items = D.items;
      if (ev.alt) {
        const clones = items.map(it => it.clone());
        transformItems(items, D.total.inverted());
        items = clones;
      }
      if (id === 'rotate') rotateBookkeeping(items, D.res.a);
      if (id === 'reflect') reflectBookkeeping(items, D.res.axis);
      S.lastXform = { m: D.total, copy: !!ev.alt, rot: id === 'rotate' ? D.res.a : 0, axis: id === 'reflect' ? D.res.axis : null };
      const o = xt.origin;
      setSelection(items); xt.origin = o;
      commit(ev.alt ? `${name.replace(' Tool', '')} Copy` : name.replace(' Tool', ''));
    },
    overlay(ctx) {
      const o = xformOrigin();
      if (!o || !selItems().length) return;
      const v = toView(o);
      ctx.strokeStyle = '#2a7bff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(v.x, v.y, 5, 0, Math.PI * 2); ctx.stroke();
      vline(ctx, v.x - 9, v.y, v.x + 9, v.y); vline(ctx, v.x, v.y - 9, v.x, v.y + 9);
    },
  });
}

/* ---------------- Gradient ---------------- */
defTool('gradient', {
  name: 'Gradient Tool', key: 'G', icon: 'gradient', display: 'outline', cursor: CUR.cross,
  move(ev) { setCursor(CUR.cross); S.hover = selItems().length ? null : hitTop(ev.pt); },
  down(ev, D) {
    let items = styleTargets();
    if (!items.length) { const it = hitTop(ev.pt); if (it) { setSelection([it]); items = styleTargets(); } }
    D.items = items.filter(isPathLike).concat(items.filter(isText));
    if (!D.items.length) D.done = true;
  },
  drag(ev, D) {
    if (D.done) return;
    let a = D.startPt, b = ev.pt;
    if (ev.shift) b = a.add(constrain45(b.subtract(a)));
    for (const it of D.items) {
      let paint = paintFromPaper(it.fillColor);
      if (!paint || paint.type === 'solid') paint = clonePaint(S.style.lastGradient);
      const stops = paint.stops.slice().sort((x, y) => x.o - y.o).map(s => new paper.GradientStop(paperColor(s.c), s.o));
      it.fillColor = new paper.Color({ gradient: { stops, radial: paint.type === 'radial' }, origin: it.globalToLocal(a), destination: it.globalToLocal(b) });
    }
    S.label = { text: `${fmtU(b.getDistance(a))}  ${fmt(norm180(-b.subtract(a).angle), 1)}°`, at: ev.vp };
  },
  up(ev, D) { if (!D.done && D.moved) { syncStyleFromSelection(); commit('Gradient'); } },
  overlay(ctx) {
    const items = styleTargets();
    if (items.length !== 1) return;
    const it = items[0], fc = it.fillColor;
    if (!fc || fc.type !== 'gradient' || !fc.origin) return;
    const a = toView(it.localToGlobal(fc.origin)), b = toView(it.localToGlobal(fc.destination));
    ctx.strokeStyle = '#111'; ctx.lineWidth = 3; vline(ctx, a.x, a.y, b.x, b.y);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; vline(ctx, a.x, a.y, b.x, b.y);
    for (const s of fc.gradient.stops) {
      const p = a.add(b.subtract(a).multiply(s.offset || 0));
      ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2); ctx.fillStyle = s.color.toCSS(); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(a.x, a.y, 6, 0, Math.PI * 2); ctx.strokeStyle = '#111'; ctx.stroke();
  },
});

/* ---------------- Eyedropper ---------------- */
defTool('eyedropper', {
  name: 'Eyedropper Tool', key: 'I', icon: 'eyedropper', display: 'outline', cursor: CUR.eyedropper,
  move(ev) { S.hover = hitLeaf(ev.pt); setCursor(CUR.eyedropper); },
  down(ev, D) {
    D.done = true;
    const it = hitLeaf(ev.pt);
    if (!it) return;
    const targets = styleTargets();
    if (isRaster(it)) {
      const loc = it.globalToLocal(ev.pt).add(it.size.divide(2));
      const pc = it.getPixel(loc.floor());
      const paint = { type: 'solid', c: colorFromPaper(pc) };
      const key = S.style.focus;
      if (targets.length) applyPaint(key, paint, targets.filter(t => t !== it)); else { S.style[key] = paint; emit('selection'); }
      return;
    }
    const src = styleTarget(it);
    const fill = paintFromPaper(src.fillColor), stroke = paintFromPaper(src.strokeColor);
    const list = targets.filter(t => t !== src);
    if (!list.length) { S.style.fill = fill; S.style.stroke = stroke; S.style.strokeWidth = src.strokeWidth; emit('selection'); toastQuiet('Picked up fill and stroke'); return; }
    for (const t of list) {
      t.fillColor = paintToPaper(fill, t); t.strokeColor = paintToPaper(stroke, t);
      t.strokeWidth = src.strokeWidth; t.strokeCap = src.strokeCap; t.strokeJoin = src.strokeJoin; t.dashArray = src.dashArray;
      if (isText(t) && isText(src)) { t.fontFamily = src.fontFamily; t.fontSize = src.fontSize; t.fontWeight = src.fontWeight; t.leading = src.leading; }
    }
    S.style.fill = fill; S.style.stroke = stroke;
    commit('Eyedropper');
  },
});

/* ---------------- Artboard ---------------- */
function abHandles(ab) { const r = abRect(ab); return [r.topLeft, r.topCenter, r.topRight, r.rightCenter, r.bottomRight, r.bottomCenter, r.bottomLeft, r.leftCenter]; }
function hitABHandle(vp) { const hs = abHandles(activeAB()).map(toView); for (let i = 0; i < 8; i++) if (hs[i].getDistance(vp) <= 7) return i; return -1; }
function itemsOnArtboard(i) {
  const r = abRect(doc.artboards[i]), out = [];
  for (const L of project.layers) if (isEditable(L)) for (const it of L.children) if (it.visible && !it.locked && r.contains(it.bounds.center)) out.push(it);
  return out;
}
defTool('artboard', {
  name: 'Artboard Tool', key: 'Shift+O', icon: 'artboard', display: 'none', cursor: CUR.cross,
  activate() { clearSelection(); emit('doc'); },
  deactivate() { emit('doc'); },
  move(ev) {
    const hi = hitABHandle(ev.vp);
    if (hi >= 0) return setCursor(resizeCursor(hi, { angle: 0 }));
    setCursor(doc.artboards.some(a => abRect(a).contains(ev.pt)) ? 'move' : CUR.cross);
  },
  down(ev, D) {
    D.snap = buildSnap(new Set());
    const hi = hitABHandle(ev.vp);
    if (hi >= 0) { D.mode = 'resize'; D.idx = hi; D.orig = { ...activeAB() }; return; }
    for (let i = doc.artboards.length - 1; i >= 0; i--) {
      if (abRect(doc.artboards[i]).contains(ev.pt)) {
        doc.ab = i; D.mode = 'move'; D.orig = { ...doc.artboards[i] }; D.art = S.moveArt ? itemsOnArtboard(i) : []; D.applied = P(0, 0);
        emit('doc'); requestDraw(); return;
      }
    }
    D.mode = 'new'; D.p0 = snapPoint(ev.pt, D.snap);
  },
  drag(ev, D) {
    const ab = activeAB();
    if (D.mode === 'resize') {
      const o = D.orig, p = snapPoint(ev.pt, D.snap), i = D.idx;
      let l = o.x, t = o.y, r = o.x + o.w, b = o.y + o.h;
      if ([0, 6, 7].includes(i)) l = Math.min(p.x, r - 1); if ([2, 3, 4].includes(i)) r = Math.max(p.x, l + 1);
      if ([0, 1, 2].includes(i)) t = Math.min(p.y, b - 1); if ([4, 5, 6].includes(i)) b = Math.max(p.y, t + 1);
      Object.assign(ab, { x: l, y: t, w: r - l, h: b - t });
      S.label = { text: `W: ${fmtU(ab.w)}\nH: ${fmtU(ab.h)}`, at: ev.vp };
    } else if (D.mode === 'move') {
      let d = ev.pt.subtract(D.startPt);
      if (ev.shift) d = constrainAxis(d);
      d = snapMove(abRect(D.orig), d, D.snap);
      ab.x = D.orig.x + d.x; ab.y = D.orig.y + d.y;
      const delta = d.subtract(D.applied);
      if (D.art.length && !delta.isZero()) transformItems(D.art, new paper.Matrix().translate(delta));
      D.applied = d;
    } else if (D.mode === 'new') {
      const r = new paper.Rectangle(D.p0, snapPoint(ev.pt, D.snap));
      D.rect = r;
      S.label = { text: measureLabel(r), at: ev.vp };
    }
    requestDraw();
  },
  up(ev, D) {
    if (D.mode === 'new' && D.rect && D.rect.width > 2 && D.rect.height > 2) {
      const r = D.rect;
      doc.artboards.push({ name: `Artboard ${doc.artboards.length + 1}`, x: r.x, y: r.y, w: r.width, h: r.height });
      doc.ab = doc.artboards.length - 1;
      commit('New Artboard');
    } else if ((D.mode === 'resize' || D.mode === 'move') && D.moved) commit(D.mode === 'move' ? 'Move Artboard' : 'Resize Artboard');
    else emit('doc');
  },
  overlay(ctx) {
    doc.artboards.forEach((ab, i) => {
      const a = toView(P(ab.x, ab.y)), b = toView(P(ab.x + ab.w, ab.y + ab.h));
      ctx.save();
      ctx.strokeStyle = i === doc.ab ? THEME.accent : 'rgba(120,120,128,.8)';
      ctx.lineWidth = i === doc.ab ? 2 : 1;
      if (i !== doc.ab) ctx.setLineDash([4, 3]);
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.restore();
    });
    abHandles(activeAB()).map(toView).forEach(p => anchorSquare(ctx, p, false, THEME.accent, 8));
    if (D && D.active && D.mode === 'new' && D.rect) {
      const a = toView(D.rect.topLeft), b = toView(D.rect.bottomRight);
      ctx.setLineDash([4, 3]); ctx.strokeStyle = THEME.accent; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.setLineDash([]);
    }
  },
  onKey(e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && doc.artboards.length > 1) {
      doc.artboards.splice(doc.ab, 1); doc.ab = Math.max(0, doc.ab - 1); commit('Delete Artboard'); return true;
    }
    if (e.key === 'Escape' || e.key === 'Enter') { setTool('select'); return true; }
    return false;
  },
});

/* ---------------- Hand & Zoom ---------------- */
defTool('hand', {
  name: 'Hand Tool', key: 'H', icon: 'hand', display: 'box', cursor: CUR.hand,
  move() { setCursor(CUR.hand); },
  down(ev, D) { D.lastVp = ev.vp; setCursor(CUR.handDown); },
  drag(ev, D) { panBy(ev.vp.subtract(D.lastVp)); D.lastVp = ev.vp; },
  up() { setCursor(CUR.hand); },
  dbl() { fitArtboard(); },
});
defTool('zoom', {
  name: 'Zoom Tool', key: 'Z', icon: 'zoom', display: 'box', cursor: CUR.zoomIn,
  move(ev) { setCursor(ev.alt ? CUR.zoomOut : CUR.zoomIn); },
  down() {},
  drag(ev, D) { S.marquee = new paper.Rectangle(D.startPt, ev.pt); },
  up(ev, D) {
    if (D.moved && S.marquee && S.marquee.width * zoom() > 4) { fitRect(S.marquee, 0); return; }
    zoomStep(ev.alt ? -1 : 1, ev.vp);
  },
  dbl() { actualSize(); },
});
