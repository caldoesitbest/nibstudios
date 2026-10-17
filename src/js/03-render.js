/* ============================================================
   Rendering: pasteboard + artboards (under), selection & tool UI (over), rulers
   ============================================================ */
const vpEl = $('#viewport');
const cvUnder = $('#cvUnder'), cvOver = $('#cvOver');
const ctxU = cvUnder.getContext('2d'), ctxO = cvOver.getContext('2d');
const rulerTop = $('#rulerTop'), rulerLeft = $('#rulerLeft');
let VW = 0, VH = 0, DPR = 1;
const THEME = {};
function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ['paste', 'text', 'text-dim', 'text-faint', 'accent', 'guide', 'smart', 'ab-shadow', 'chrome', 'chrome-2', 'chrome-3', 'line', 'line-soft']) THEME[k] = cs.getPropertyValue('--' + k).trim();
  requestDraw();
}
function sizeCanvas(cv, w, h) {
  cv.width = Math.max(1, Math.round(w * DPR)); cv.height = Math.max(1, Math.round(h * DPR));
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
}
function resizeCanvases() {
  DPR = window.devicePixelRatio || 1;
  const r = vpEl.getBoundingClientRect();
  const center = VW ? toProj(P(VW / 2, VH / 2)) : null;
  VW = Math.max(1, r.width); VH = Math.max(1, r.height);
  sizeCanvas(cvUnder, VW, VH); sizeCanvas(cvOver, VW, VH);
  view.viewSize = new paper.Size(VW, VH);
  if (center) view.center = center;
  sizeCanvas(rulerTop, VW, 18); sizeCanvas(rulerLeft, 18, VH);
  requestDraw();
}
let drawQueued = false;
function requestDraw() { if (!drawQueued) { drawQueued = true; requestAnimationFrame(drawAll); } }
function drawAll() {
  drawQueued = false;
  view.update();
  drawUnder(); drawOver(); drawRulers();
  if (S.editingText) layoutTextEditor();
  emitViewChange();
}
let lastViewKey = '';
function emitViewChange() {
  const k = view.zoom.toFixed(4) + '|' + S.view.outline;
  if (k !== lastViewKey) { lastViewKey = k; if (typeof updateZoomUI === 'function') updateZoomUI(); }
}

/* ---------------- under: pasteboard, artboards, grid ---------------- */
function drawUnder() {
  const ctx = ctxU;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = THEME.paste || '#1b1c1f';
  ctx.fillRect(0, 0, VW, VH);
  const z = zoom();
  doc.artboards.forEach((ab, i) => {
    const tl = toView(P(ab.x, ab.y)), w = ab.w * z, hh = ab.h * z;
    ctx.save();
    ctx.shadowColor = THEME['ab-shadow']; ctx.shadowBlur = 10; ctx.shadowOffsetY = 2;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(tl.x, tl.y, w, hh);
    ctx.restore();
    if (S.view.grid) drawGrid(ctx, ab, tl, w, hh);
    ctx.strokeStyle = i === doc.ab ? 'rgba(0,0,0,.55)' : 'rgba(0,0,0,.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(tl.x) - 0.5, Math.round(tl.y) - 0.5, Math.round(w) + 1, Math.round(hh) + 1);
    ctx.fillStyle = i === doc.ab ? THEME.text : THEME['text-dim'];
    ctx.font = '11px ' + getComputedStyle(document.body).fontFamily;
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${i + 1} - ${ab.name}`, tl.x, tl.y - 5);
  });
}
function drawGrid(ctx, ab, tl, w, hh) {
  const z = zoom(), major = S.view.gridSize, minor = major / S.view.gridSub;
  ctx.save();
  ctx.beginPath(); ctx.rect(tl.x, tl.y, w, hh); ctx.clip();
  const pass = (step, color) => {
    if (step * z < 5) return;
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = 0; x <= ab.w + 0.01; x += step) { const vx = Math.round(tl.x + x * z) + 0.5; ctx.moveTo(vx, tl.y); ctx.lineTo(vx, tl.y + hh); }
    for (let y = 0; y <= ab.h + 0.01; y += step) { const vy = Math.round(tl.y + y * z) + 0.5; ctx.moveTo(tl.x, vy); ctx.lineTo(tl.x + w, vy); }
    ctx.stroke();
  };
  pass(minor, 'rgba(0,0,0,.06)');
  pass(major, 'rgba(0,0,0,.14)');
  ctx.restore();
}

/* ---------------- over: guides, selection, tool previews ---------------- */
function domMatrixFor(it) {
  const m = view.matrix.appended(it.globalMatrix);
  return new DOMMatrix([m.a * DPR, m.b * DPR, m.c * DPR, m.d * DPR, m.tx * DPR, m.ty * DPR]);
}
function itemPath2D(it) {
  const out = new Path2D();
  if (isPathLike(it)) { const d = it.pathData; if (d) out.addPath(new Path2D(d), domMatrixFor(it)); }
  else if (it.internalBounds) { const b = it.internalBounds, q = new Path2D(); q.rect(b.x, b.y, b.width, b.height); out.addPath(q, domMatrixFor(it)); }
  return out;
}
function strokeOutline(ctx, it, color, lw = 1) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = color; ctx.lineWidth = lw * DPR;
  for (const l of (isPathLike(it) || isText(it) || isRaster(it) ? [it] : leafItems(it))) {
    if (isText(l)) { // baseline + box
      ctx.save(); ctx.globalAlpha = 0.55; ctx.stroke(itemPath2D(l)); ctx.restore();
      const m = domMatrixFor(l), b = l.internalBounds;
      const q = new Path2D(); q.moveTo(b.left, 0); q.lineTo(b.right, 0);
      const p = new Path2D(); p.addPath(q, m); ctx.stroke(p);
    } else ctx.stroke(itemPath2D(l));
  }
}
function vline(ctx, x0, y0, x1, y1) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
function drawOver() {
  const ctx = ctxO;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cvOver.width, cvOver.height);
  if (S.view.outline) drawOutlineMode(ctx);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (S.view.guides) drawGuides(ctx);
  const tool = TOOLS[effectiveToolId()] || TOOLS[S.tool];
  const mode = tool.display || 'anchors';
  if (S.hover && alive(S.hover) && !sel.items.has(S.hover) && !(D && D.active)) strokeOutline(ctx, S.hover, layerColor(S.hover), 1.8);
  const items = selItems();
  if (mode !== 'none') {
    // with very large selections, outlining every object each frame gets slow; show the selection box instead
    const many = items.length > 250;
    if (!many) for (const it of items) strokeOutline(ctx, it, layerColor(it), 1);
    if (mode === 'box') { if (!many) drawSmallAnchors(ctx, items); if (S.view.bbox || many) drawFrame(ctx, S.view.bbox); }
    else if (mode === 'anchors') { if (many) drawFrame(ctx, false); else drawAnchors(ctx); }
    else if (mode === 'outline') { if (many) drawFrame(ctx, false); else drawSmallAnchors(ctx, items); }
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (tool.overlay) { ctx.save(); tool.overlay(ctx); ctx.restore(); }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawSnapLines(ctx);
  if (S.guidePreview) {
    const g = S.guidePreview;
    ctx.strokeStyle = THEME.guide; ctx.lineWidth = 1; ctx.setLineDash(g.inside ? [] : [4, 4]);
    if (g.axis === 'h') { const vy = Math.round(toView(P(0, g.v)).y) + .5; vline(ctx, 0, vy, VW, vy); }
    else { const vx = Math.round(toView(P(g.v, 0)).x) + .5; vline(ctx, vx, 0, vx, VH); }
    ctx.setLineDash([]);
  }
  if (S.marquee) {
    const a = toView(S.marquee.topLeft), b = toView(S.marquee.bottomRight);
    ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(a.x) + .5, Math.round(a.y) + .5, Math.round(b.x - a.x), Math.round(b.y - a.y));
    ctx.strokeStyle = '#fff'; ctx.lineDashOffset = 3;
    ctx.strokeRect(Math.round(a.x) + .5, Math.round(a.y) + .5, Math.round(b.x - a.x), Math.round(b.y - a.y));
    ctx.restore();
  }
  if (S.label) drawLabel(ctx, S.label.text, S.label.at);
}
function drawOutlineMode(ctx) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = DPR;
  for (const L of project.layers) if (L.visible) for (const it of leafItems(L)) {
    if (isRaster(it)) { const p = itemPath2D(it); ctx.stroke(p); continue; }
    ctx.stroke(itemPath2D(it));
  }
}
function drawGuides(ctx) {
  ctx.strokeStyle = THEME.guide; ctx.lineWidth = 1;
  for (const x of doc.guides.v) { const vx = Math.round(toView(P(x, 0)).x) + 0.5; vline(ctx, vx, 0, vx, VH); }
  for (const y of doc.guides.h) { const vy = Math.round(toView(P(0, y)).y) + 0.5; vline(ctx, 0, vy, VW, vy); }
}
function anchorSquare(ctx, p, filled, color, size = 6) {
  const x = Math.round(p.x - size / 2) + 0.5, y = Math.round(p.y - size / 2) + 0.5;
  ctx.fillStyle = filled ? color : '#fff';
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = color; ctx.lineWidth = 1;
  ctx.strokeRect(x, y, size, size);
}
function drawSmallAnchors(ctx, items) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  let budget = 3000;
  for (const it of items) {
    const color = layerColor(it);
    for (const p of leafPaths(it)) {
      for (const s of p.segments) { if (--budget < 0) return; const v = viewPt(p, s.point); ctx.fillStyle = color; ctx.fillRect(Math.round(v.x) - 2, Math.round(v.y) - 2, 4, 4); }
    }
  }
}
function drawAnchors(ctx) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const paths = displayedPaths();
  let budget = 6000;
  for (const p of paths) {
    const color = layerColor(p);
    const segs = p.segments;
    if ((budget -= segs.length) < 0) break;
    // handles
    ctx.strokeStyle = color; ctx.lineWidth = 1;
    for (let i = 0; i < segs.length; i++) {
      if (!isPtSelected(p, i) && !neighborSelected(p, i)) continue;
      const s = segs[i], a = viewPt(p, s.point);
      for (const side of ['handleIn', 'handleOut']) {
        const hv = s[side];
        if (hv.isZero()) continue;
        if (!isPtSelected(p, i)) {
          const n = segs.length, prev = i > 0 ? i - 1 : (p.closed ? n - 1 : -1), next = i < n - 1 ? i + 1 : (p.closed ? 0 : -1);
          const toward = side === 'handleIn' ? prev : next;
          if (toward < 0 || !isPtSelected(p, toward)) continue;
        }
        const b = viewPt(p, s.point.add(hv));
        vline(ctx, a.x, a.y, b.x, b.y);
        ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
      }
    }
    for (let i = 0; i < segs.length; i++) anchorSquare(ctx, viewPt(p, segs[i].point), isPtSelected(p, i), color);
  }
}
function drawFrame(ctx, handles = true) {
  const fr = getFrame();
  if (!fr) return;
  const items = selItems();
  const color = items.length ? layerColor(items[0]) : THEME.accent;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const cs = fr.corners.map(toView);
  ctx.strokeStyle = color; ctx.lineWidth = 1;
  ctx.beginPath(); cs.forEach((c, i) => i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)); ctx.closePath(); ctx.stroke();
  if (!handles) return;
  const hs = frameHandles(fr).map(toView);
  const tiny = fr.rect.width * zoom() < 14 && fr.rect.height * zoom() < 14;
  hs.forEach((p, i) => { if (tiny && i % 2) return; anchorSquare(ctx, p, false, color, 7); });
}
function drawSnapLines(ctx) {
  if (!S.snapLines) return;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.strokeStyle = THEME.smart; ctx.lineWidth = 1;
  for (const l of S.snapLines) {
    if (l.pt) {
      const v = toView(l.pt);
      ctx.beginPath(); ctx.arc(v.x, v.y, 4, 0, Math.PI * 2); ctx.stroke();
      drawLabel(ctx, 'anchor', v.add(P(10, -14)), THEME.smart);
    } else if (l.x != null) {
      const a = toView(P(l.x, Math.max(l.a, -1e6))), b = toView(P(l.x, Math.min(l.b, 1e6)));
      vline(ctx, Math.round(a.x) + .5, clamp(a.y, -10, VH + 10), Math.round(a.x) + .5, clamp(b.y, -10, VH + 10));
    } else {
      const a = toView(P(Math.max(l.a, -1e6), l.y)), b = toView(P(Math.min(l.b, 1e6), l.y));
      vline(ctx, clamp(a.x, -10, VW + 10), Math.round(a.y) + .5, clamp(b.x, -10, VW + 10), Math.round(a.y) + .5);
    }
  }
}
function drawLabel(ctx, text, at, bg) {
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.font = '11px ' + getComputedStyle(document.body).fontFamily;
  const lines = String(text).split('\n');
  const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12, hh = lines.length * 14 + 6;
  let x = at.x + 14, y = at.y + 16;
  if (x + w > VW - 4) x = at.x - w - 10;
  if (y + hh > VH - 4) y = at.y - hh - 10;
  ctx.fillStyle = bg || 'rgba(60,60,64,.92)';
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, hh, 3) : ctx.rect(x, y, w, hh); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, x + 6, y + 4 + i * 14));
  ctx.restore();
}

/* ---------------- rulers ---------------- */
let cursorView = null;
function rulerStep(ppu) {
  const steps = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000, 100000];
  for (const s of steps) if (s * ppu >= 56) return s;
  return 1e6;
}
function drawRulers() {
  if (!S.view.rulers) return;
  // ticks are laid out in document units (px, pt, in, mm, cm); positions convert back to points
  const ab = activeAB(), ppu = zoom() / UD().f, major = rulerStep(ppu);
  let sub;
  if (unitKey() === 'in' && major >= 1) sub = major * ppu / 16 >= 5 ? 16 : major * ppu / 8 >= 5 ? 8 : major * ppu / 4 >= 5 ? 4 : 2;
  else sub = major * ppu / 10 >= 5 ? 10 : (major * ppu / 5 >= 5 ? 5 : 2);
  const minor = major / sub;
  const labelDec = major < 1 ? (major < 0.1 ? 3 : 2) : 0;
  const font = '9.5px ' + getComputedStyle(document.body).fontFamily;
  const off = 18; // viewport offset inside stage
  // top
  {
    const cv = rulerTop, ctx = cv.getContext('2d'), w = cv.width / DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = THEME['chrome-2']; ctx.fillRect(0, 0, w, 18);
    ctx.strokeStyle = THEME['text-faint']; ctx.fillStyle = THEME['text-dim']; ctx.font = font; ctx.lineWidth = 1; ctx.textBaseline = 'top';
    const p0 = toU(toProj(P(0, 0)).x - ab.x), p1 = toU(toProj(P(w, 0)).x - ab.x);
    ctx.beginPath();
    for (let k = Math.floor(p0 / minor); k * minor <= p1; k++) {
      const v = k * minor;
      const x = Math.round(toView(P(fromU(v) + ab.x, 0)).x) + 0.5;
      const len = k % sub === 0 ? 18 : (sub % 2 === 0 && k % (sub / 2) === 0 ? 7 : 4);
      ctx.moveTo(x, 18); ctx.lineTo(x, 18 - len);
      if (k % sub === 0) ctx.fillText(fmt(v, labelDec), x + 2, 1);
    }
    ctx.stroke();
    if (cursorView) { ctx.strokeStyle = THEME.accent; vline(ctx, Math.round(cursorView.x) + .5, 0, Math.round(cursorView.x) + .5, 18); }
  }
  // left
  {
    const cv = rulerLeft, ctx = cv.getContext('2d'), hh = cv.height / DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = THEME['chrome-2']; ctx.fillRect(0, 0, 18, hh);
    ctx.strokeStyle = THEME['text-faint']; ctx.fillStyle = THEME['text-dim']; ctx.font = font; ctx.lineWidth = 1; ctx.textBaseline = 'top';
    const p0 = toU(toProj(P(0, 0)).y - ab.y), p1 = toU(toProj(P(0, hh)).y - ab.y);
    ctx.beginPath();
    for (let k = Math.floor(p0 / minor); k * minor <= p1; k++) {
      const v = k * minor;
      const y = Math.round(toView(P(0, fromU(v) + ab.y)).y) + 0.5;
      const len = k % sub === 0 ? 18 : (sub % 2 === 0 && k % (sub / 2) === 0 ? 7 : 4);
      ctx.moveTo(18, y); ctx.lineTo(18 - len, y);
      if (k % sub === 0) { ctx.save(); ctx.translate(1, y + 2); ctx.rotate(Math.PI / 2); ctx.fillText(fmt(v, labelDec), 0, -9); ctx.restore(); }
    }
    ctx.stroke();
    if (cursorView) { ctx.strokeStyle = THEME.accent; vline(ctx, 0, Math.round(cursorView.y) + .5, 18, Math.round(cursorView.y) + .5); }
  }
  void off;
}

/* ---------------- view navigation ---------------- */
const ZOOM_STEPS = [0.0313, 0.0417, 0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
function zoomAt(vp, z) {
  z = clamp(z, 0.02, 64);
  const before = toProj(vp);
  view.zoom = z;
  const after = toProj(vp);
  view.center = view.center.add(before.subtract(after));
  requestDraw();
}
function zoomStep(dir, vp = P(VW / 2, VH / 2)) {
  const z = zoom();
  let nz = dir > 0 ? ZOOM_STEPS.find(s => s > z * 1.001) : [...ZOOM_STEPS].reverse().find(s => s < z * 0.999);
  zoomAt(vp, nz || (dir > 0 ? 64 : 0.02));
}
function fitRect(r, pad = 48) {
  if (!r || r.width <= 0 && r.height <= 0) return;
  const z = Math.min((VW - pad * 2) / Math.max(r.width, 1), (VH - pad * 2) / Math.max(r.height, 1));
  view.zoom = clamp(z, 0.02, 64);
  view.center = r.center;
  requestDraw();
}
const fitArtboard = (i = doc.ab) => fitRect(abRect(doc.artboards[i]));
function fitAll() { let r = null; for (const ab of doc.artboards) r = r ? r.unite(abRect(ab)) : abRect(ab); fitRect(r); }
function actualSize() { zoomAt(toView(abRect(activeAB()).center), 1); view.center = abRect(activeAB()).center; requestDraw(); }
function panBy(dv) { view.center = view.center.subtract(dv.divide(zoom())); requestDraw(); }
