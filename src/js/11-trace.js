/* ============================================================
   Tracing: bitmap masks -> vector outlines. Powers Image Trace and Create Outlines.
   ============================================================ */
// Follows pixel edges so the filled side is always on the right; outer loops run clockwise, holes counter-clockwise.
function traceMask(mask, w, hh, minArea = 4) {
  const W1 = w + 1;
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < hh && mask[y * w + x] === 1;
  const from = [], to = [];
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
    if (mask[y * w + x] !== 1) continue;
    if (!inside(x, y - 1)) { from.push(y * W1 + x); to.push(y * W1 + x + 1); }
    if (!inside(x + 1, y)) { from.push(y * W1 + x + 1); to.push((y + 1) * W1 + x + 1); }
    if (!inside(x, y + 1)) { from.push((y + 1) * W1 + x + 1); to.push((y + 1) * W1 + x); }
    if (!inside(x - 1, y)) { from.push((y + 1) * W1 + x); to.push(y * W1 + x); }
  }
  const n = from.length;
  const head = new Map();
  for (let i = 0; i < n; i++) { const l = head.get(from[i]); if (l) l.push(i); else head.set(from[i], [i]); }
  const used = new Uint8Array(n);
  const loops = [];
  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    const pts = [];
    let e = i, guard = 0;
    while (e >= 0 && !used[e] && guard++ < n + 4) {
      used[e] = 1;
      pts.push(from[e]);
      const list = head.get(to[e]);
      let next = -1;
      if (list) {
        if (list.length === 1) next = list[0];
        else {
          // two exits at a pinch point: prefer the right turn so touching corners stay separate shapes
          const fx = from[e] % W1, fy = (from[e] / W1) | 0, tx = to[e] % W1, ty = (to[e] / W1) | 0;
          const dx = tx - fx, dy = ty - fy;
          let best = -1;
          for (const c of list) {
            if (used[c]) continue;
            const nx = (to[c] % W1) - tx, ny = ((to[c] / W1) | 0) - ty;
            const cross = dx * ny - dy * nx;
            if (best < 0 || cross > 0) best = c;
          }
          next = best;
        }
      }
      if (next >= 0 && used[next]) next = -1;
      e = next;
    }
    if (pts.length < 4) continue;
    // keep corners only
    const poly = [];
    for (let k = 0; k < pts.length; k++) {
      const a = pts[(k - 1 + pts.length) % pts.length], b = pts[k], c = pts[(k + 1) % pts.length];
      const ax = a % W1, ay = (a / W1) | 0, bx = b % W1, by = (b / W1) | 0, cx = c % W1, cy = (c / W1) | 0;
      if ((bx - ax) * (cy - by) - (by - ay) * (cx - bx) !== 0) poly.push([bx, by]);
    }
    if (poly.length < 3) continue;
    let area = 0;
    for (let k = 0; k < poly.length; k++) { const [x1, y1] = poly[k], [x2, y2] = poly[(k + 1) % poly.length]; area += x1 * y2 - x2 * y1; }
    if (Math.abs(area / 2) < minArea) continue;
    loops.push(poly);
  }
  return loops;
}
function loopsToItem(loops, matrix, tol) {
  const paths = [];
  for (const l of loops) {
    const p = new paper.Path({ segments: l, closed: true, insert: false });
    if (tol > 0 && l.length > 4) p.simplify(tol);
    p.transform(matrix);
    paths.push(p);
  }
  if (!paths.length) return null;
  const item = paths.length === 1 ? paths[0] : new paper.CompoundPath({ children: paths, insert: false });
  item.fillRule = 'evenodd';
  return item;
}

/* ---------------- Create Outlines (text -> shapes) ---------------- */
function textToOutlines(t) {
  const gm = t.globalMatrix, k = Math.sqrt(Math.abs(gm.a * gm.d - gm.b * gm.c)) || 1;
  const fsPx = t.fontSize * k;
  const tmp = t.clone({ insert: false });
  tmp.fillColor = 'black'; tmp.strokeColor = null; tmp.opacity = 1; tmp.shadowColor = null; tmp.visible = true;
  // pixels per unit of the text's own space: aim for ~240 px tall letters, but cap the canvas at 6000 px / 24 MP
  let ppu = clamp(240 / Math.max(fsPx, 1), 0.5, 48);
  const sb = tmp.strokeBounds, big = Math.max(sb.width, sb.height, 1);
  if (big * ppu > 6000) ppu = 6000 / big;
  if (sb.width * sb.height * ppu * ppu > 24e6) ppu = Math.sqrt(24e6 / Math.max(1, sb.width * sb.height));
  const res = 72 * ppu;
  const r = tmp.rasterize({ resolution: res, insert: false });
  const c = r.canvas;
  if (!c || !c.width) return null;
  const W = c.width, H = c.height, d = c.getContext('2d').getImageData(0, 0, W, H).data;
  const mask = new Uint8Array(W * H);
  for (let i = 0, j = 3; i < mask.length; i++, j += 4) mask[i] = d[j] >= 128 ? 1 : 0;
  const loops = traceMask(mask, W, H, 3);
  const m = r.matrix.appended(new paper.Matrix(1, 0, 0, 1, -W / 2, -H / 2));
  const item = loopsToItem(loops, m, 0.7);
  if (!item) return null;
  item.fillColor = t.fillColor ? (t.fillColor.type === 'gradient' ? paintToPaper(paintFromPaper(t.fillColor), item) : t.fillColor.clone()) : null;
  if (t.strokeColor && t.strokeWidth) { item.strokeColor = t.strokeColor.clone(); item.strokeWidth = t.strokeWidth; }
  item.opacity = t.opacity; item.blendMode = t.blendMode;
  item.name = (t.content || '').split('\n')[0].slice(0, 40);
  return item;
}
function createOutlines() {
  const texts = [];
  for (const it of selItems()) {
    if (isText(it)) texts.push(it);
    else if (isGroup(it) && it._data && it._data.textPath) texts.push(it);
    else if (isGroup(it)) texts.push(...it.getItems({ class: paper.PointText }).filter(x => !(x.parent && x.parent._data && x.parent._data.textPath)));
  }
  if (!texts.length) return toast('Select text to convert it to outlines.');
  const busy = showBusy('Create Outlines', 'Converting text to shapes…');
  setTimeout(() => {
    try {
      const out = [];
      for (const t of texts) {
        if (isGroup(t)) {
          const glyphs = t.children.filter(isText);
          const shapes = glyphs.map(textToOutlines).filter(Boolean);
          if (!shapes.length) continue;
          const g = new paper.Group({ insert: false }); g.addChildren(shapes); g.name = (t._data.textPath.content || 'Type on a path').slice(0, 40);
          g.insertAbove(t); t.remove(); out.push(g);
          continue;
        }
        const o = textToOutlines(t);
        if (!o) continue;
        o.insertAbove(t); t.remove(); out.push(o);
      }
      setSelection(out);
      commit('Create Outlines');
      toastQuiet(`${out.length} text object${out.length === 1 ? '' : 's'} converted to shapes`);
    } finally { busy.close(); }
  }, 30);
}

/* ---------------- Image Trace ---------------- */
function rasterPixels(r, maxDim) {
  const src = r.canvas;
  if (!src || !src.width) return null;
  const s = Math.min(1, maxDim / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * s)), hh = Math.max(1, Math.round(src.height * s));
  const c = document.createElement('canvas'); c.width = w; c.height = hh;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, hh);
  return { w, h: hh, s, data: ctx.getImageData(0, 0, w, hh).data, srcW: src.width, srcH: src.height };
}
function kmeans(px, k, gray) {
  const n = px.length / 4;
  const sample = [];
  const step = Math.max(1, Math.floor(n / 25000));
  for (let i = 0; i < n; i += step) if (px[i * 4 + 3] >= 128) sample.push(gray ? [lum(px, i)] : [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]]);
  if (!sample.length) return [];
  const dim = sample[0].length;
  const dist = (a, b) => { let s = 0; for (let j = 0; j < dim; j++) { const d = a[j] - b[j]; s += d * d; } return s; };
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const cents = [sample[Math.floor(rnd() * sample.length)].slice()];
  while (cents.length < k) {
    const d2 = sample.map(p => Math.min(...cents.map(c => dist(p, c))));
    const tot = d2.reduce((a, b) => a + b, 0);
    if (!tot) break;
    let r = rnd() * tot, idx = 0;
    while (r > d2[idx] && idx < d2.length - 1) { r -= d2[idx]; idx++; }
    cents.push(sample[idx].slice());
  }
  for (let it = 0; it < 12; it++) {
    const sum = cents.map(() => new Array(dim + 1).fill(0));
    for (const p of sample) { let bi = 0, bd = Infinity; cents.forEach((c, i) => { const d = dist(p, c); if (d < bd) { bd = d; bi = i; } }); for (let j = 0; j < dim; j++) sum[bi][j] += p[j]; sum[bi][dim]++; }
    cents.forEach((c, i) => { if (sum[i][dim]) for (let j = 0; j < dim; j++) c[j] = sum[i][j] / sum[i][dim]; });
  }
  return cents;
}
const lum = (px, i) => 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
function traceRaster(r, opts) {
  const pix = rasterPixels(r, opts.maxDim || 700);
  if (!pix) throw new Error('This image has not finished loading.');
  const { w, h: hh, data } = pix, n = w * hh;
  const m = r.globalMatrix.appended(new paper.Matrix(pix.srcW / w, 0, 0, pix.srcH / hh, -pix.srcW / 2, -pix.srcH / 2));
  const tol = opts.smooth, minArea = opts.noise;
  const out = [];
  if (opts.mode === 'bw') {
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = data[i * 4 + 3] >= 128 && lum(data, i) < opts.threshold ? 1 : 0;
    const item = loopsToItem(traceMask(mask, w, hh, minArea), m, tol);
    if (item) { item.fillColor = paperColor(C(0, 0, 0, 1)); out.push(item); }
    return out;
  }
  const gray = opts.mode === 'gray';
  const cents = kmeans(data, opts.colors, gray);
  if (!cents.length) return out;
  const assign = new Int16Array(n).fill(-1), counts = new Array(cents.length).fill(0);
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] < 128) continue;
    const p = gray ? [lum(data, i)] : [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
    let bi = 0, bd = Infinity;
    for (let c = 0; c < cents.length; c++) { let s = 0; for (let j = 0; j < p.length; j++) { const d = p[j] - cents[c][j]; s += d * d; } if (s < bd) { bd = s; bi = c; } }
    assign[i] = bi; counts[bi]++;
  }
  // Stack colors: biggest area at the back, each layer also covers the colors drawn above it, so no hairline gaps.
  const order = cents.map((_, i) => i).filter(i => counts[i] > 0).sort((a, b) => counts[b] - counts[a]);
  const rank = new Int16Array(cents.length).fill(-1);
  order.forEach((ci, r2) => { rank[ci] = r2; });
  order.forEach((ci, layer) => {
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = assign[i] >= 0 && rank[assign[i]] >= layer ? 1 : 0;
    const item = loopsToItem(traceMask(mask, w, hh, minArea), m, tol);
    if (!item) return;
    const c = cents[ci];
    item.fillColor = gray ? paperColor(C(c[0], c[0], c[0], 1)) : paperColor(C(Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), 1));
    item.name = gray ? `Gray ${Math.round(c[0] / 2.55)}%` : toHex({ r: c[0], g: c[1], b: c[2] });
    out.push(item);
  });
  return out;
}
function openImageTrace() {
  const r = selItems().find(isRaster);
  if (!r) return toast('Select a placed image to trace it.');
  const preset = fSel('Preset', 'colors6', [['bw', 'Black and white (logo, sketch)'], ['gray', 'Shades of gray'], ['colors3', '3 colors'], ['colors6', '6 colors'], ['colors12', '12 colors'], ['colors24', '24 colors (photo)']]);
  const thr = h('input', { type: 'range', min: '10', max: '245', value: '128', id: 'trThr', style: { width: '100%' } });
  const thrRow = h('label', { class: 'f', for: 'trThr' }, h('span', null, 'Threshold'), thr);
  const smooth = h('input', { type: 'range', min: '0.3', max: '6', step: '0.1', value: '1.6', id: 'trSmooth', style: { width: '100%' } });
  const noise = h('input', { type: 'range', min: '1', max: '200', step: '1', value: '12', id: 'trNoise', style: { width: '100%' } });
  const detail = h('input', { type: 'range', min: '200', max: '1400', step: '50', value: '700', id: 'trDetail', style: { width: '100%' } });
  const keep = fChk('Keep the original image (hidden, underneath)', false);
  const sync = () => { thrRow.hidden = preset.get() !== 'bw'; };
  preset.input.addEventListener('change', sync); sync();
  openDialog({
    title: 'Image Trace', body: [preset.el, thrRow,
      h('label', { class: 'f', for: 'trDetail' }, h('span', null, 'Detail'), detail),
      h('label', { class: 'f', for: 'trSmooth' }, h('span', null, 'Smoothness'), smooth),
      h('label', { class: 'f', for: 'trNoise' }, h('span', null, 'Ignore specks'), noise),
      keep.el, h('p', { class: 'hint' }, 'Tip: logos and line art trace best in black and white. Larger detail values are slower but follow the image more closely.')],
    buttons: [{ label: 'Cancel' }, { label: 'Trace', primary: true, onClick: () => {
      const p = preset.get();
      const opts = { mode: p === 'bw' ? 'bw' : p === 'gray' ? 'gray' : 'color', colors: p === 'gray' ? 5 : parseInt(p.replace('colors', ''), 10) || 6, threshold: +thr.value, smooth: +smooth.value, noise: +noise.value, maxDim: +detail.value };
      const busy = showBusy('Image Trace', 'Tracing… this can take a few seconds for large images.');
      rasterReady(r).then(() => {
        try {
          const items = traceRaster(r, opts);
          if (!items.length) { toast('Nothing was traced. Try a different preset or threshold.'); return; }
          const g = new paper.Group({ insert: false });
          g.addChildren(items);
          g.name = 'Image Trace';
          g.insertAbove(r);
          if (keep.get()) r.visible = false; else r.remove();
          setSelection([g]);
          commit('Image Trace');
          toastQuiet(`Traced ${items.length} color${items.length === 1 ? '' : 's'}. Ungroup to edit each one.`);
        } catch (e) { console.error(e); toast('Image Trace failed: ' + (e.message || e)); }
        finally { busy.close(); }
      });
    } }],
  });
}

function rasterReady(r) {
  return new Promise(res => {
    const ok = () => r.loaded || (r.canvas && r.canvas.width > 0);
    if (ok()) return setTimeout(res, 30);
    const t0 = Date.now();
    const poll = () => { if (ok() || Date.now() - t0 > 8000) res(); else setTimeout(poll, 60); };
    poll();
  });
}
