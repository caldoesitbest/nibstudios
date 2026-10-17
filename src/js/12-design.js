/* ============================================================
   Design toolkit for apparel & graphics: mirror & join, stitch lines, fabric patterns,
   type on a path, warp, drop shadow, extra pathfinder ops, starter templates
   ============================================================ */

/* ---------------- live previews: rebuild from the last saved state on each change ---------------- */
function previewSession() {
  const base = H.stack[H.idx];
  return {
    reset() { restoreSnapshot(base); },
    cancel() { restoreSnapshot(base); },
  };
}

/* ---------------- Mirror & Join (draw half a garment, get the whole thing) ---------------- */
function mirrorJoin(dir) {
  const items = selItems();
  if (!items.length) return toast('Select the half you drew. Its center edge becomes the mirror line.');
  const b = unionBounds(items);
  const vertical = dir === 'right' || dir === 'left';
  const axis = dir === 'right' ? b.right : dir === 'left' ? b.left : dir === 'down' ? b.bottom : b.top;
  const M = vertical ? new paper.Matrix(-1, 0, 0, 1, 2 * axis, 0) : new paper.Matrix(1, 0, 0, -1, 0, 2 * axis);
  const tol = Math.max(0.5, 3 / zoom());
  const out = [];
  let joined = 0;
  for (const it of items) {
    if (isPath(it) && !it.closed) {
      // snap endpoints that sit on the mirror line exactly onto it, so both halves meet cleanly
      for (const s of [it.firstSegment, it.lastSegment]) {
        const d = vertical ? Math.abs(s.point.x - axis) : Math.abs(s.point.y - axis);
        if (d <= tol) s.point = vertical ? P(axis, s.point.y) : P(s.point.x, axis);
      }
      const onAxis = [it.firstSegment, it.lastSegment].some(s => (vertical ? Math.abs(s.point.x - axis) : Math.abs(s.point.y - axis)) < 1e-6);
      const c = it.clone();
      transformItem(c, M);
      if (onAxis) { it.join(c, 0.01); dropLive(it); joined++; out.push(it); }
      else out.push(it, c);
    } else {
      const c = it.clone();
      transformItem(c, M);
      reflectBookkeeping([c], vertical ? 90 : 0);
      out.push(it, c);
    }
  }
  setSelection(out);
  commit('Mirror & Join');
  toastQuiet(joined ? `Mirrored and joined ${joined} path${joined === 1 ? '' : 's'}` : 'Mirrored copy added');
}
function openMirrorDialog() {
  if (!selItems().length) return toast('Select the half you drew first.');
  const dirF = fRadio('Mirror', [['right', 'To the right'], ['left', 'To the left'], ['down', 'Down'], ['up', 'Up']], 'right');
  openDialog({ title: 'Mirror & Join', body: [dirF.el, h('p', { class: 'hint' }, 'Draw one half of a garment with the Pen tool so both ends touch the center line, then mirror it. Open paths whose ends sit on the mirror line are joined into one closed shape.')],
    buttons: [{ label: 'Cancel' }, { label: 'Mirror', primary: true, onClick: () => mirrorJoin(dirF.get()) }] });
}

/* ---------------- stitch lines ---------------- */
const DASH_PRESETS = [['solid', 'Solid', []], ['stitch', 'Topstitch 4 / 3', [4, 3]], ['fine', 'Fine stitch 2 / 2', [2, 2]], ['coverstitch', 'Long stitch 8 / 4', [8, 4]], ['dots', 'Dotted', [0.01, 4]], ['dash', 'Dashed 12 / 6', [12, 6]]];
function applyDashPreset(key) {
  const p = DASH_PRESETS.find(x => x[0] === key);
  if (!p) return;
  const t = styleTargets().filter(x => !isText(x) && !isRaster(x));
  for (const it of t) {
    it.dashArray = p[2].slice();
    if (key === 'dots') { it.strokeCap = 'round'; if (!it.strokeWidth || it.strokeWidth < 1.5) it.strokeWidth = 1.5; }
    if (!it.strokeColor) it.strokeColor = paperColor(C(0, 0, 0, 1));
  }
  if (t.length) commit('Dashes');
}
function parallelPath(p, d) {
  const n = Math.max(16, Math.min(1500, Math.round(p.length / 1.5)));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const off = Math.min(p.length, p.length * i / n), pt = p.getPointAt(off), nm = p.getNormalAt(off);
    if (pt && nm) pts.push(pt.add(nm.multiply(d)));
  }
  const np = new paper.Path({ segments: pts, insert: false });
  np.simplify(0.15);
  return np;
}
function openStitchDialog() {
  const paths = selItems().flatMap(it => isPathLike(it) ? (isCompound(it) ? it.children.slice() : [it]) : leafPaths(it));
  if (!paths.length) return toast('Select the seam or edge you want to stitch along.');
  const dF = fLen('Distance from edge', 6);
  const sideF = fRadio('Side', [['in', 'Inside'], ['out', 'Outside'], ['both', 'Both']], 'in');
  const dashF = fLen('Stitch length', 4), gapF = fLen('Gap', 3);
  const wF = fNum('Thread weight', 0.75, { unit: strokeUnit(), step: 0.25 });
  const rowsF = fRadio('Rows', [['1', 'Single'], ['2', 'Double needle']], '1');
  const pv = previewSession();
  const build = () => {
    pv.reset();
    const src = selItems().flatMap(it => isPathLike(it) ? (isCompound(it) ? it.children.slice() : [it]) : leafPaths(it));
    const d = Math.max(0, dF.get() || 0), side = sideF.get(), rows = +rowsF.get();
    const out = [];
    for (const p of src) {
      const color = p.strokeColor ? solidColorOf(p.strokeColor) : paperColor(C(0, 0, 0, 1));
      const offsets = [];
      for (let r = 0; r < rows; r++) {
        const dd = d + r * Math.max(2, d * 0.6);
        if (side === 'in' || side === 'both') offsets.push(-dd);
        if (side === 'out' || side === 'both') offsets.push(dd);
      }
      for (const o of offsets) {
        let s;
        if (p.closed) { const sign = p.clockwise ? 1 : -1; s = offsetPath(p, o * sign); if (s && isCompound(s) && s.children.length === 1) s = s.firstChild; }
        else s = parallelPath(p, o);
        if (!s) continue;
        s.fillColor = null; s.strokeColor = color.clone(); s.strokeWidth = wF.get() || 0.75;
        s.dashArray = [dashF.get() || 4, gapF.get() || 3]; s.strokeCap = 'butt'; s.name = 'Stitch';
        s.insertAbove(p.parent && isCompound(p.parent) ? p.parent : p);
        out.push(s);
      }
    }
    requestDraw();
    return out;
  };
  [dF, dashF, gapF, wF].forEach(f => f.input.addEventListener('change', build));
  build();
  openDialog({ title: 'Add Stitch Line', body: [dF.el, sideF.el, rowsF.el, dashF.el, gapF.el, wF.el, h('p', { class: 'hint' }, 'Adds dashed topstitching that follows the selected edge. For open seams “Inside” means the left side of the path direction.')],
    buttons: [{ label: 'Preview', left: true, onClick: () => { build(); return false; } }, { label: 'Cancel', onClick: () => pv.cancel() }, { label: 'Add', primary: true, onClick: () => { const out = build(); setSelection(out); commit('Add Stitch Line'); } }],
    onEscape: () => pv.cancel() });
}
const solidColorOf = col => col.type === 'gradient' ? col.gradient.stops[0].color.clone() : col.clone();

/* ---------------- fabric & graphic patterns ---------------- */
const PATTERN_KINDS = [['stripes', 'Stripes'], ['pinstripe', 'Pinstripe'], ['diagonal', 'Diagonal stripes'], ['dots', 'Polka dots'], ['gingham', 'Gingham'], ['check', 'Checkerboard'], ['plaid', 'Plaid'], ['grid', 'Grid'], ['chevron', 'Chevron'], ['herringbone', 'Herringbone']];
function patternTiles(spec, rect) {
  const g = new paper.Group({ insert: false });
  const c = rect.center;
  let size = Math.max(2, spec.size || 24);
  const half = Math.hypot(rect.width, rect.height) / 2 + size * 2;
  if (Math.pow(2 * half / size, 2) > 9000) size = 2 * half / Math.sqrt(9000);
  const x0 = c.x - half, y0 = c.y - half, span = 2 * half;
  const A = paperColor(parseHex(spec.a) || C(0, 0, 0, 1)), B = spec.c2 ? paperColor(parseHex(spec.c2) || C(255, 255, 255, 1)) : null;
  const rect2 = (x, y, w, hh, col, op) => { const r = new paper.Path.Rectangle({ point: [x, y], size: [w, hh], insert: false }); r.fillColor = col.clone(); if (op != null) r.opacity = op; g.addChild(r); return r; };
  const n = Math.ceil(span / size) + 1;
  switch (spec.kind) {
    case 'stripes': for (let i = 0; i < n; i++) rect2(x0, y0 + i * size, span, size / 2, A); break;
    case 'pinstripe': for (let i = 0; i < n; i++) rect2(x0, y0 + i * size, span, Math.max(0.5, size * 0.07), A); break;
    case 'diagonal': for (let i = 0; i < n; i++) rect2(x0, y0 + i * size, span, size / 2, A); g.rotate(45, c); break;
    case 'dots': for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const cx = x0 + i * size + (j % 2 ? size / 2 : 0), cy = y0 + j * size * 0.866;
      const d = new paper.Path.Circle({ center: [cx, cy], radius: size * 0.2, insert: false }); d.fillColor = A.clone(); g.addChild(d);
    } break;
    case 'gingham': for (let i = 0; i < n; i++) { rect2(x0, y0 + i * size, span, size / 2, A, 0.5); rect2(x0 + i * size, y0, size / 2, span, A, 0.5); } break;
    case 'check': for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if ((i + j) % 2 === 0) rect2(x0 + i * size / 2 * 2, y0 + j * size, size, size, A); break;
    case 'plaid': for (let i = 0; i < n; i += 1) {
      rect2(x0, y0 + i * size * 1.5, span, size * 0.55, A, 0.45); rect2(x0 + i * size * 1.5, y0, size * 0.55, span, A, 0.45);
      if (B) { rect2(x0, y0 + i * size * 1.5 + size * 0.85, span, Math.max(0.5, size * 0.08), B, 0.9); rect2(x0 + i * size * 1.5 + size * 0.85, y0, Math.max(0.5, size * 0.08), span, B, 0.9); }
    } break;
    case 'grid': for (let i = 0; i < n; i++) { rect2(x0, y0 + i * size, span, Math.max(0.5, size * 0.06), A); rect2(x0 + i * size, y0, Math.max(0.5, size * 0.06), span, A); } break;
    case 'chevron': for (let j = 0; j < n; j++) {
      const zz = new paper.Path({ insert: false });
      for (let i = 0; i <= n * 2; i++) zz.add(P(x0 + i * size / 2, y0 + j * size + (i % 2 ? size / 2 : 0)));
      zz.strokeColor = A.clone(); zz.strokeWidth = size * 0.22; zz.strokeJoin = 'miter'; g.addChild(zz);
    } break;
    case 'herringbone': for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = x0 + i * size, y = y0 + j * size, up = i % 2 === 0;
      const l = new paper.Path.Line({ from: [x, up ? y + size : y], to: [x + size, up ? y : y + size], insert: false });
      l.strokeColor = A.clone(); l.strokeWidth = size * 0.18; g.addChild(l);
    } break;
    default: {
      const pat = (doc.patterns || []).find(p => 'custom:' + p.id === spec.kind);
      if (!pat) break;
      const tmpl = new paper.Group({ insert: false });
      pat.json.forEach(j => tmpl.addChild(paper.Base.importJSON(mapRasterSources(j, (id, src) => doc.images[id] || src))));
      const tb = tmpl.bounds, sx = (spec.size || tb.width) / Math.max(tb.width, 1);
      tmpl.scale(sx, tb.topLeft);
      const tw = tmpl.bounds.width + (spec.gap || 0), th = tmpl.bounds.height + (spec.gap || 0);
      const cols = Math.min(120, Math.ceil(span / tw) + 1), rows = Math.min(120, Math.ceil(span / th) + 1);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const cl = tmpl.clone({ insert: false });
        cl.position = P(x0 + i * tw + (spec.brick && j % 2 ? tw / 2 : 0) + tw / 2, y0 + j * th + th / 2);
        g.addChild(cl);
      }
    }
  }
  if (spec.angle) g.rotate(spec.angle, c);
  return g;
}
function patternGroupParts(g) {
  const clip = g.children.find(ch => isGroup(ch) && ch.clipped);
  return clip ? { clip, mask: clip.firstChild } : null;
}
function buildPatternFill(target, spec) {
  const g = new paper.Group({ insert: false });
  g.insertAbove(target);
  const clip = new paper.Group({ insert: false });
  const mask = target.clone({ insert: false }); mask.fillColor = null; mask.strokeColor = null; mask.opacity = 1; dropLive(mask);
  clip.addChild(mask);
  if (spec.bg) { const bg = target.clone({ insert: false }); bg.fillColor = paperColor(parseHex(spec.bg) || C(255, 255, 255, 1)); bg.strokeColor = null; bg.opacity = 1; clip.addChild(bg); }
  clip.addChild(patternTiles(spec, target.bounds));
  clip.clipped = true;
  g.addChild(clip);
  if (target.strokeColor && target.strokeWidth) { const o = target.clone({ insert: false }); o.fillColor = null; g.addChild(o); }
  g.opacity = target.opacity;
  g.name = 'Pattern Fill';
  g.data.pattern = spec;
  target.remove();
  return g;
}
function rebuildPatternFill(g, spec) {
  const parts = patternGroupParts(g);
  if (!parts) return;
  const { clip, mask } = parts;
  clip.removeChildren(1);
  if (spec.bg) { const bg = mask.clone({ insert: false }); bg.fillColor = paperColor(parseHex(spec.bg) || C(255, 255, 255, 1)); clip.addChild(bg); }
  clip.addChild(patternTiles(spec, mask.bounds));
  g.data.pattern = spec;
}
function releasePatternFill() {
  const out = [];
  for (const g of selItems()) {
    const parts = g._data && g._data.pattern ? patternGroupParts(g) : null;
    if (!parts) { out.push(g); continue; }
    const s = parts.mask.clone({ insert: false });
    const sp = g._data.pattern;
    s.fillColor = paperColor(parseHex(sp.bg || sp.a) || C(200, 200, 200, 1));
    const outline = g.children.find(ch => ch !== parts.clip && isPathLike(ch));
    if (outline) { s.strokeColor = outline.strokeColor; s.strokeWidth = outline.strokeWidth; }
    s.insertAbove(g); g.remove(); out.push(s);
  }
  setSelection(out); commit('Release Pattern');
}
function makePatternSwatch() {
  const items = selItems();
  if (!items.length) return toast('Select the artwork that should repeat, then make it a pattern.');
  registerRasters();
  const b = unionBounds(items);
  const json = items.map(it => mapRasterSources(it.exportJSON({ asString: false }), id => 'img:' + id));
  const id = uid();
  doc.patterns = doc.patterns || [];
  doc.patterns.push({ id, name: `Pattern ${doc.patterns.length + 1}`, json, w: b.width, h: b.height });
  S.dirty = true; scheduleAutosave(); updateStatus();
  toast(`Saved as “Pattern ${doc.patterns.length}”. Select a shape and use Object › Pattern › Fill with Pattern.`);
}
function openPatternDialog() {
  const sel0 = selItems();
  const editing = sel0.length === 1 && sel0[0]._data && sel0[0]._data.pattern ? sel0[0] : null;
  const targets0 = sel0.filter(isPathLike);
  if (!editing && !targets0.length) return toast('Select one or more closed shapes (a garment panel, a letterform…) to fill with a pattern.');
  const sp = editing ? { ...editing._data.pattern } : { kind: 'stripes', a: '#1E2A44', bg: '#F4F1E8', c2: '#C8553D', size: isPrintUnits() ? 18 : 24, angle: 0, gap: 0 };
  const kinds = PATTERN_KINDS.concat((doc.patterns || []).map(p => ['custom:' + p.id, p.name + ' (yours)']));
  const kindF = fSel('Pattern', sp.kind, kinds);
  const colA = fText('Pattern color', sp.a), colB = fText('Background', sp.bg || ''), colC = fText('Accent (plaid)', sp.c2 || '');
  const sizeF = fLen('Repeat size', sp.size), angF = fNum('Angle', sp.angle || 0, { unit: '°' }), gapF = fLen('Spacing (yours)', sp.gap || 0);
  const pv = previewSession();
  const read = () => ({ kind: kindF.get(), a: (parseHex(colA.get()) && toHex(parseHex(colA.get()))) || '#000000', bg: parseHex(colB.get()) ? toHex(parseHex(colB.get())) : null, c2: parseHex(colC.get()) ? toHex(parseHex(colC.get())) : null, size: Math.max(1, sizeF.get() || 24), angle: angF.get() || 0, gap: gapF.get() || 0 });
  const run = () => {
    pv.reset();
    const spec = read();
    const sel = selItems();
    if (editing) { const g = sel[0]; if (g && g._data && g._data.pattern) rebuildPatternFill(g, spec); requestDraw(); return [g]; }
    const out = sel.filter(isPathLike).map(t => buildPatternFill(t, spec));
    sel.items = new Set(out); sel.pts = new Map(); selectionChanged();
    return out;
  };
  [kindF, colA, colB, colC, sizeF, angF, gapF].forEach(f => f.input.addEventListener('change', run));
  run();
  openDialog({
    title: editing ? 'Edit Pattern' : 'Fill with Pattern', body: [kindF.el, colA.el, colB.el, colC.el, sizeF.el, angF.el, gapF.el,
      h('p', { class: 'hint' }, 'Colors are hex codes like #1E2A44. Leave Background empty for a transparent ground. To repeat your own artwork, select it and choose Object › Pattern › Make Pattern from Selection first.')],
    buttons: [{ label: 'Cancel', onClick: () => pv.cancel() }, { label: editing ? 'Update' : 'Fill', primary: true, onClick: () => { const out = run(); setSelection(out.filter(Boolean)); commit(editing ? 'Edit Pattern' : 'Pattern Fill'); } }],
    onEscape: () => pv.cancel(),
  });
}

/* ---------------- type on a path ---------------- */
function isPathText(it) { return !!(it && it._data && it._data.textPath && isGroup(it)); }
function pathTextGuide(g) { return g.children.find(c => isPath(c) && c._data && c._data.textGuide) || g.firstChild; }
function makePathText(path, content) {
  const g = new paper.Group({ insert: false });
  g.insertAbove(path);
  path.fillColor = null; path.strokeColor = null; path.data.textGuide = true; dropLive(path);
  g.addChild(path);
  const fill = S.style.fill && S.style.fill.type === 'solid' && !(S.style.fill.c.r > 250 && S.style.fill.c.g > 250 && S.style.fill.c.b > 250) ? toHex(S.style.fill.c) : '#000000';
  g.data.textPath = { content: content || 'Type on a path', family: S.text.family, size: S.text.size, weight: S.text.weight, fill, offset: 0.5, spacing: 0, shift: 0, align: 'center' };
  g.name = 'Type on a Path';
  layoutPathText(g);
  return g;
}
function layoutPathText(g) {
  const tp = g._data.textPath, path = pathTextGuide(g);
  for (const c of g.children.slice()) if (c !== path) c.remove();
  if (!path || !alive(path) && !path.parent) return;
  const L = path.length;
  measureCtx.font = `${tp.weight} ${tp.size}px ${tp.family}`;
  const chars = [...(tp.content || '')];
  const widths = chars.map(ch => measureCtx.measureText(ch).width + (tp.spacing || 0));
  const total = widths.reduce((a, b) => a + b, 0);
  let s = tp.align === 'left' ? L * tp.offset : L * tp.offset - total / 2;
  const col = paperColor(parseHex(tp.fill) || C(0, 0, 0, 1));
  chars.forEach((ch, i) => {
    let mid = s + widths[i] / 2;
    s += widths[i];
    if (ch === ' ') return;
    if (path.closed) mid = ((mid % L) + L) % L; else if (mid < 0 || mid > L) return;
    const pt = path.getPointAt(mid), tan = path.getTangentAt(mid);
    if (!pt || !tan) return;
    const t = new paper.PointText({ insert: false });
    t.content = ch; t.justification = 'center';
    t.fontFamily = tp.family; t.fontSize = tp.size; t.fontWeight = tp.weight; t.fillColor = col.clone();
    t.matrix = new paper.Matrix().translate(pt).rotate(tan.angle).translate(0, -(tp.shift || 0));
    t.data.pathGlyph = true;
    g.addChild(t);
  });
  tp.sig = path.pathData + '|' + L.toFixed(3);
}
function refreshPathTexts() {
  for (const L of project.layers) for (const g of L.getItems({ match: x => isPathText(x) })) {
    const p = pathTextGuide(g);
    if (p && g._data.textPath.sig !== p.pathData + '|' + p.length.toFixed(3)) layoutPathText(g);
  }
}
function afterPathTextTransform(g, m) {
  const k = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
  if (Math.abs(k - 1) > 1e-6) g._data.textPath.size *= k;
  layoutPathText(g);
}
function setPathTextProp(prop, val, label) {
  val = cleanTextValue(prop, val);
  if (val === undefined) return;
  const gs = selItems().filter(isPathText);
  for (const g of gs) { g._data.textPath[prop] = val; if (prop === 'family') ensureFont(val); layoutPathText(g); }
  if (gs.length) commit(label || 'Type on a Path');
}
defTool('typePath', {
  name: 'Type on a Path Tool', key: 'Shift+T', icon: 'typePath', display: 'outline', cursor: CUR.text,
  move(ev) { const h2 = hitStroke(ev.pt, 8) || hitAny(ev.pt); S.hover = h2 && isPath(h2.item) ? h2.item : null; setCursor(CUR.text); },
  down(ev, D) {
    D.done = true;
    const h2 = hitStroke(ev.pt, 8) || hitAny(ev.pt);
    const it = h2 && h2.item;
    if (it && it.parent && isPathText(it.parent)) { setSelection([it.parent]); showDockTab('top', 'props'); setTimeout(() => { const ta = $('#pPathText'); if (ta) { ta.focus(); ta.select(); } }, 60); return; }
    if (!it || !isPath(it)) { toast('Click on a path (a circle, an arc or a line you drew) to put text along it.'); return; }
    const g = makePathText(it, 'Type on a path');
    setSelection([g]);
    commit('Type on a Path');
    setTool('select');
    showDockTab('top', 'props');
    setTimeout(() => { const ta = $('#pPathText'); if (ta) { ta.focus(); ta.select(); } }, 60);
  },
});
SVGS.typePath = '<path d="M3 15c3-7 11-7 14 0" stroke-dasharray="1.6 1.6"/><path d="M6.5 5h7M10 5v7"/>';
(() => { const g = TOOL_GROUPS.find(x => Array.isArray(x) && x.includes('type')); if (g && !g.includes('typePath')) g.push('typePath'); })();

/* ---------------- warp ---------------- */
const WARPS = [['arc', 'Arc'], ['arch', 'Arch'], ['bulge', 'Bulge'], ['flag', 'Flag'], ['wave', 'Wave'], ['rise', 'Rise'], ['squeeze', 'Squeeze'], ['inflate', 'Inflate']];
function warpFn(style, bend, b) {
  const Wd = b.width || 1, Hd = b.height || 1;
  return p => {
    const u = (p.x - b.left) / Wd, v = (p.y - b.top) / Hd, x0 = u - 0.5, y0 = v - 0.5;
    let dx = 0, dy = 0;
    const bow = 1 - 4 * x0 * x0;
    switch (style) {
      case 'arc': dy = -bend * Hd * 0.9 * bow; break;
      case 'arch': dy = -bend * Hd * 0.9 * bow * (1 - v); break;
      case 'bulge': dy = bend * y0 * Hd * 1.1 * bow; break;
      case 'flag': dy = bend * Hd * 0.3 * Math.sin(u * Math.PI * 2); break;
      case 'wave': dy = bend * Hd * 0.3 * Math.sin(u * Math.PI * 2) * (1 - v) + bend * Hd * 0.15 * Math.sin(u * Math.PI * 2 + Math.PI) * v; break;
      case 'rise': dy = -bend * Hd * 0.9 * x0; break;
      case 'squeeze': dx = -bend * x0 * Wd * 0.6 * (1 - 4 * y0 * y0); break;
      case 'inflate': { const k = bow * (1 - 4 * y0 * y0); dx = bend * x0 * Wd * 0.45 * k; dy = bend * y0 * Hd * 0.45 * k; break; }
    }
    return P(p.x + dx, p.y + dy);
  };
}
function warpPath(p, f, maxLen) {
  const curves = p.curves.slice();
  for (const cv of curves) {
    const parts = Math.min(16, Math.max(1, Math.ceil(cv.length / maxLen)));
    let rest = cv;
    for (let k = parts; k > 1 && rest; k--) rest = rest.divideAtTime(1 / k);
  }
  for (const cv of p.curves) {
    if (cv.isStraight()) {
      const a = cv.point1, d = cv.point2.subtract(a);
      cv.handle1 = d.divide(3); cv.handle2 = d.divide(-3);
    }
  }
  const segs = p.segments.map(s => {
    const pt = s.point, a = f(pt);
    return [a, f(pt.add(s.handleIn)).subtract(a), f(pt.add(s.handleOut)).subtract(a)];
  });
  p.segments.forEach((s, i) => { s.point = segs[i][0]; s.handleIn = segs[i][1]; s.handleOut = segs[i][2]; });
  dropLive(p);
}
function openWarpDialog() {
  if (!selItems().length) return toast('Select the artwork or text to warp.');
  const styleF = fSel('Style', 'arc', WARPS);
  const bend = h('input', { type: 'range', min: '-100', max: '100', step: '1', value: '35', id: 'wpBend', style: { width: '100%' } });
  const bendVal = h('span', { class: 'cap num' }, '35%');
  const pv = previewSession();
  const run = () => {
    pv.reset();
    bendVal.textContent = bend.value + '%';
    let items = selItems();
    const texts = items.flatMap(it => isText(it) ? [it] : isPathText(it) ? [it] : []);
    if (texts.length) {
      const conv = [];
      for (const t of texts) {
        if (isPathText(t)) { const shapes = t.children.filter(isText).map(textToOutlines).filter(Boolean); const g = new paper.Group({ insert: false }); g.addChildren(shapes); g.insertAbove(t); t.remove(); conv.push(g); }
        else { const o = textToOutlines(t); if (o) { o.insertAbove(t); t.remove(); conv.push(o); } }
      }
      items = items.filter(it => !texts.includes(it)).concat(conv);
    }
    const b = unionBounds(items);
    if (!b) return items;
    const f = warpFn(styleF.get(), (+bend.value) / 100, b);
    const maxLen = Math.max(b.width, b.height) / 18;
    for (const it of items) for (const p of leafPaths(it)) warpPath(p, f, maxLen);
    sel.items = new Set(items); sel.pts = new Map(); invalidateFrame();
    requestDraw();
    return items;
  };
  bend.addEventListener('input', debounce(run, 60));
  styleF.input.addEventListener('change', run);
  run();
  openDialog({
    title: 'Warp', body: [styleF.el, h('label', { class: 'f', for: 'wpBend' }, h('span', null, 'Bend'), h('div', { class: 'row' }, bend, bendVal)),
      h('p', { class: 'hint' }, 'Great for arched team names and curved logos. Text is converted to shapes first. Images are left as they are.')],
    buttons: [{ label: 'Cancel', onClick: () => pv.cancel() }, { label: 'Warp', primary: true, onClick: () => { const out = run(); setSelection(out); commit('Warp'); } }],
    onEscape: () => pv.cancel(),
  });
}

/* ---------------- drop shadow ---------------- */
function openShadowDialog() {
  if (!selItems().length) return toast('Select something to give it a drop shadow.');
  const first = selItems()[0];
  const has = first.hasShadow && first.hasShadow();
  const colF = fText('Color', has ? toHex(colorFromPaper(first.shadowColor)) : '#000000');
  const opF = fNum('Opacity', has ? Math.round(first.shadowColor.alpha * 100) : 45, { unit: '%' });
  const xF = fLen('X offset', has ? first.shadowOffset.x : 4), yF = fLen('Y offset', has ? first.shadowOffset.y : 4), bF = fLen('Blur', has ? first.shadowBlur : 8);
  const pv = previewSession();
  const run = () => {
    pv.reset();
    const c = parseHex(colF.get()) || C(0, 0, 0, 1);
    for (const it of selItems()) { it.shadowColor = paperColor({ ...c, a: clamp((opF.get() || 0) / 100, 0, 1) }); it.shadowBlur = Math.max(0, bF.get() || 0); it.shadowOffset = P(xF.get() || 0, yF.get() || 0); }
    requestDraw();
  };
  [colF, opF, xF, yF, bF].forEach(f => f.input.addEventListener('change', run));
  run();
  openDialog({ title: 'Drop Shadow', body: [colF.el, opF.el, xF.el, yF.el, bF.el, h('p', { class: 'hint' }, 'Shadows show in PNG, JPG and SVG exports. PDF export leaves them out.')],
    buttons: [{ label: 'Remove shadow', left: true, onClick: () => { pv.reset(); for (const it of selItems()) { it.shadowColor = null; it.shadowBlur = 0; it.shadowOffset = P(0, 0); } commit('Remove Shadow'); } },
      { label: 'Cancel', onClick: () => pv.cancel() }, { label: 'OK', primary: true, onClick: () => { run(); commit('Drop Shadow'); } }],
    onEscape: () => pv.cancel() });
}

/* ---------------- more pathfinder ---------------- */
function pathfinderExtra(op) {
  const items = selItems().filter(isPathLike).sort(zCmp);
  if (items.length < 2) return toast('Select two or more shapes.');
  const opt = { insert: false };
  const out = [];
  if (op === 'trim' || op === 'merge') {
    let above = null;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      let res = above ? it.subtract(above, opt) : it.clone(opt);
      res.strokeColor = null;
      above = above ? above.unite(it, opt) : it.clone(opt);
      if (isEmptyPath(res)) continue;
      out.unshift(res);
    }
    if (op === 'merge') {
      const byColor = new Map();
      for (const r of out) { const k = JSON.stringify(paintFromPaper(r.fillColor)); byColor.set(k, (byColor.get(k) || []).concat([r])); }
      out.length = 0;
      for (const group of byColor.values()) out.push(group.slice(1).reduce((a, b) => a.unite(b, opt), group[0]));
    }
  } else if (op === 'crop') {
    const top = items[items.length - 1];
    for (const it of items.slice(0, -1)) { const r = it.intersect(top, opt); if (!isEmptyPath(r)) out.push(r); }
  }
  const g = new paper.Group({ insert: false });
  g.insertAbove(items[items.length - 1]);
  out.forEach(r => { if (r._data) { delete r._data.live; delete r._data.shape; delete r._data.angle; } g.addChild(r); });
  items.forEach(it => it.remove());
  setSelection([g]); commit({ trim: 'Trim', merge: 'Merge', crop: 'Crop' }[op]);
}

/* ---------------- starter templates ---------------- */
function teeFlat(back) {
  const g = new paper.Group({ insert: false });
  const ink = paperColor(C(26, 26, 30, 1));
  const half = new paper.Path({ insert: false });
  half.add(new paper.Segment(P(0, back ? 10 : 30), null, P(22, 0)));
  half.add(new paper.Segment(P(40, 0), back ? P(-14, 6) : P(-6, 14), null));
  half.add(P(100, 16), P(150, 86));
  half.add(new paper.Segment(P(126, 104), null, P(-10, -4)));
  half.add(new paper.Segment(P(96, 76), P(6, 10), null));
  half.add(P(100, 276), P(0, 278));
  const other = half.clone({ insert: false }); other.transform(new paper.Matrix(-1, 0, 0, 1, 0, 0));
  half.join(other, 0.01);
  half.fillColor = paperColor(C(255, 255, 255, 1)); half.strokeColor = ink.clone(); half.strokeWidth = 1.5; half.strokeJoin = 'round';
  half.name = back ? 'Back body' : 'Front body';
  g.addChild(half);
  const rib = new paper.Path({ insert: false });
  rib.add(new paper.Segment(P(0, back ? 19 : 40), null, P(24, 0)));
  rib.add(new paper.Segment(P(48, 3), back ? P(-15, 7) : P(-8, 15), null));
  const ribL = rib.clone({ insert: false }); ribL.transform(new paper.Matrix(-1, 0, 0, 1, 0, 0));
  rib.join(ribL, 0.01);
  rib.strokeColor = ink.clone(); rib.strokeWidth = 1.2; rib.name = 'Collar rib';
  g.addChild(rib);
  const stitch = (a, b) => { const s = new paper.Path.Line({ from: a, to: b, insert: false }); s.strokeColor = ink.clone(); s.strokeWidth = 0.75; s.dashArray = [4, 3]; s.name = 'Stitch'; g.addChild(s); };
  stitch(P(-97, 266), P(97, 266));
  stitch(P(144.6, 78.8), P(120.6, 96.8)); stitch(P(-144.6, 78.8), P(-120.6, 96.8));
  const ribStitch = rib.clone({ insert: false }); ribStitch.translate(P(0, 4)); ribStitch.strokeWidth = 0.75; ribStitch.dashArray = [4, 3]; ribStitch.name = 'Stitch'; g.addChild(ribStitch);
  g.name = back ? 'Tee back' : 'Tee front';
  return g;
}
function placeTemplateText(L, content, x, y, size, opts = {}) {
  const t = new paper.PointText({ insert: false });
  L.addChild(t);
  t.point = P(x, y); t.content = content;
  t.fontFamily = fontCSS(opts.font || 'Montserrat'); t.fontSize = size; t.fontWeight = opts.weight || 'normal';
  t.justification = opts.just || 'left';
  t.fillColor = paperColor(opts.color || C(40, 40, 46, 1));
  return t;
}
const TEMPLATES = {
  printArea() {
    const ab = activeAB();
    doc.guides.v.push(ab.x + ab.w / 2); doc.guides.h.push(ab.y + ab.h / 2);
    doc.artboards[0].name = 'Print area';
  },
  flats() {
    const ab = activeAB();
    ab.name = 'Flats';
    const L = activeLayer(); L.name = 'Flats';
    const f = teeFlat(false), b = teeFlat(true);
    for (const [g, cx] of [[f, ab.x + ab.w * 0.29], [b, ab.x + ab.w * 0.71]]) {
      g.scale(1.05, P(0, 0)); L.addChild(g);
      g.position = P(cx, ab.y + ab.h * 0.52);
    }
    const T = newLayer('Labels');
    placeTemplateText(T, 'FRONT', f.position.x, f.bounds.bottom + 34, 12, { weight: 'bold', just: 'center' });
    placeTemplateText(T, 'BACK', b.position.x, b.bounds.bottom + 34, 12, { weight: 'bold', just: 'center' });
    placeTemplateText(T, 'Style name — Tee flats', ab.x + 36, ab.y + 48, 18, { weight: 'bold' });
    placeTemplateText(T, 'Template: edit the shapes, or select one half and use Object › Path › Mirror & Join for your own designs.', ab.x + 36, ab.y + 68, 9, { color: C(120, 120, 128, 1) });
    L.activate();
  },
  techpack() {
    const ab = activeAB();
    ab.name = 'Tech pack';
    const L = activeLayer(); L.name = 'Flats';
    const T = newLayer('Spec sheet');
    const ink = paperColor(C(30, 30, 34, 1));
    const box = (x, y, w, hh, sw = 0.75) => { const r = new paper.Path.Rectangle({ point: [ab.x + x, ab.y + y], size: [w, hh], insert: false }); r.strokeColor = ink.clone(); r.strokeWidth = sw; r.fillColor = null; T.addChild(r); return r; };
    box(36, 28, 720, 58, 1);
    ['STYLE #', 'STYLE NAME', 'SEASON', 'DESIGNER', 'DATE', 'SIZE RANGE'].forEach((lab, i) => {
      if (i) { const l = new paper.Path.Line({ from: [ab.x + 36 + i * 120, ab.y + 28], to: [ab.x + 36 + i * 120, ab.y + 86], insert: false }); l.strokeColor = ink.clone(); l.strokeWidth = 0.75; T.addChild(l); }
      placeTemplateText(T, lab, ab.x + 44 + i * 120, ab.y + 42, 7, { weight: 'bold', color: C(110, 110, 118, 1) });
    });
    box(36, 100, 480, 420);
    placeTemplateText(T, 'FRONT VIEW', ab.x + 156, ab.y + 506, 8, { weight: 'bold', just: 'center', color: C(110, 110, 118, 1) });
    placeTemplateText(T, 'BACK VIEW', ab.x + 396, ab.y + 506, 8, { weight: 'bold', just: 'center', color: C(110, 110, 118, 1) });
    box(528, 100, 228, 300);
    placeTemplateText(T, 'MATERIALS & TRIMS', ab.x + 538, ab.y + 116, 8, { weight: 'bold', color: C(110, 110, 118, 1) });
    for (let i = 0; i < 9; i++) { const l = new paper.Path.Line({ from: [ab.x + 538, ab.y + 142 + i * 28], to: [ab.x + 746, ab.y + 142 + i * 28], insert: false }); l.strokeColor = paperColor(C(200, 200, 206, 1)); l.strokeWidth = 0.5; T.addChild(l); }
    box(528, 412, 228, 108);
    placeTemplateText(T, 'COLORWAYS', ab.x + 538, ab.y + 428, 8, { weight: 'bold', color: C(110, 110, 118, 1) });
    ['#1E2A44', '#C8553D', '#F4F1E8', '#2F6B4F'].forEach((hx, i) => {
      const sq = new paper.Path.Rectangle({ point: [ab.x + 540 + i * 52, ab.y + 442], size: [40, 40], insert: false });
      sq.fillColor = paperColor(parseHex(hx)); sq.strokeColor = ink.clone(); sq.strokeWidth = 0.5; T.addChild(sq);
      placeTemplateText(T, hx, ab.x + 560 + i * 52, ab.y + 496, 6, { just: 'center', color: C(110, 110, 118, 1) });
    });
    placeTemplateText(T, 'NOTES: ', ab.x + 36, ab.y + 548, 8, { weight: 'bold' });
    const f = teeFlat(false), b = teeFlat(true);
    for (const [g, cx] of [[f, ab.x + 156], [b, ab.x + 396]]) { g.scale(0.72, P(0, 0)); L.addChild(g); g.position = P(cx, ab.y + 300); }
    L.bringToFront();
    L.activate();
  },
};
function focusPathText(g) {
  setSelection([g]);
  if (S.tool !== 'select') setTool('select');
  showDockTab('top', 'props');
  setTimeout(() => { const ta = $('#pPathText'); if (ta) { ta.focus(); ta.select(); } }, 60);
}
