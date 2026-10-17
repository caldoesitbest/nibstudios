/* ============================================================
   Import: Adobe Illustrator (.ai saved with PDF compatibility) and PDF files
   -> editable Nib artwork (paths, colors, gradients, clips, images, text, layers)
   ============================================================ */
const PDFJS_VER = '3.11.174';
let pdfjsPromise = null;
function loadScriptOnce(src) {
  return new Promise((res, rej) => {
    if ([...document.scripts].some(s => s.src === src)) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error('Could not load ' + src.split('/').pop()));
    document.head.append(s);
  });
}
function loadPdfJs() {
  if (!pdfjsPromise) pdfjsPromise = (async () => {
    const base = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VER}/`;
    await loadScriptOnce(base + 'pdf.min.js');
    // Loading the worker as a plain script makes PDF.js run it on the page itself (no separate worker file needed).
    await loadScriptOnce(base + 'pdf.worker.min.js');
    const lib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
    if (!lib) throw new Error('The PDF reader did not load.');
    return lib;
  })();
  pdfjsPromise.catch(() => { pdfjsPromise = null; });
  return pdfjsPromise;
}
function sniffBytes(b) {
  const head = String.fromCharCode(...b.subarray(0, Math.min(b.length, 1024)));
  if (head.includes('%PDF-')) return 'pdf';
  if (head.startsWith('%!PS') || (b[0] === 0xC5 && b[1] === 0xD0 && b[2] === 0xD3 && b[3] === 0xC6)) return 'ps';
  return 'unknown';
}
function objGet(store, id, ms = 4000) {
  return new Promise(res => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; res(null); } }, ms);
    try { store.get(id, data => { if (!done) { done = true; clearTimeout(t); res(data); } }); }
    catch { clearTimeout(t); res(null); }
  });
}

/* ---------------- font mapping ---------------- */
function mapPdfFont(f) {
  const raw = String((f && (f.name || f.loadedName)) || 'Helvetica').replace(/^[A-Z]{6}\+/, '');
  const parts = raw.split(/[-,]/);
  let base = parts[0].replace(/(PSMT|PS|MT|Std|LT)$/g, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim() || 'Helvetica';
  const style = parts.slice(1).join(' ') + ' ' + raw;
  let weight = 'normal';
  if ((f && f.black) || /Black|Heavy|Ultra/i.test(style)) weight = '900';
  else if (/ExtraBold|Extra Bold/i.test(style)) weight = '800';
  else if (/SemiBold|Semibold|Demi/i.test(style)) weight = '600';
  else if ((f && f.bold) || /Bold/i.test(style)) weight = 'bold';
  else if (/Medium/i.test(style)) weight = '500';
  else if (/Light|Thin/i.test(style)) weight = '300';
  const italic = (f && f.italic) || /Italic|Oblique/i.test(style);
  const mono = (f && f.isMonospace) || /Courier|Mono|Consol/i.test(raw);
  const serif = !mono && ((f && f.isSerifFont) || /Times|Serif|Garamond|Georgia|Minion|Caslon|Bodoni|Baskerville|Palatino/i.test(raw));
  const known = FONTS.find(x => x[0].replace(/\s/g, '').toLowerCase() === base.replace(/\s/g, '').toLowerCase());
  const fallback = mono ? '"Courier New", monospace' : serif ? 'Georgia, "Times New Roman", serif' : '"Helvetica Neue", Arial, sans-serif';
  return { family: known ? fontCSS(known[0]) : `"${base}", ${fallback}`, weight: (italic ? 'italic ' : '') + weight, key: base + weight + italic };
}

/* ---------------- color helpers ---------------- */
const hexToC = s => parseHex(s) || C(0, 0, 0, 1);
function rgbFromArgs(a) {
  if (typeof a[0] === 'string') return hexToC(a[0]);
  return C(a[0] | 0, a[1] | 0, a[2] | 0, 1);
}
function shadingToColor(ir, m) {
  if (!ir) return null;
  if (ir[0] !== 'RadialAxial') {
    if (ir[0] === 'Mesh' && ir[3] && ir[3].length >= 3) return paperColor(C(ir[3][0], ir[3][1], ir[3][2], 1));
    return null;
  }
  const [, type, , stopsRaw, p0, p1, r0, r1] = ir;
  let stops = stopsRaw.map(([o, css]) => ({ o: clamp(o, 0, 1), c: css === 'transparent' ? null : hexToC(css) }));
  stops.forEach((s, i) => {
    if (!s.c) { const n = stops[i + 1] && stops[i + 1].c || stops[i - 1] && stops[i - 1].c || C(0, 0, 0, 1); s.c = { ...n, a: 0 }; }
  });
  stops = stops.filter((s, i) => !(s.c.a === 0 && stops.length > 2 && (i === 0 || i === stops.length - 1) && Math.abs(s.o - (i === 0 ? stops[1].o : stops[i - 1].o)) < 1e-3));
  const P0 = m.transform(P(p0[0], p0[1])), P1 = m.transform(P(p1[0], p1[1]));
  if (type === 'axial') {
    return new paper.Color({ gradient: { stops: stops.map(s => new paper.GradientStop(paperColor(s.c), s.o)), radial: false }, origin: P0, destination: P1 });
  }
  const R1 = m.transform(P(p1[0] + r1, p1[1])).getDistance(P1) || 1;
  const k = r1 > 0 ? clamp(r0 / r1, 0, 0.99) : 0;
  const gs = stops.map(s => new paper.GradientStop(paperColor(s.c), k + s.o * (1 - k)));
  const col = new paper.Color({ gradient: { stops: gs, radial: true }, origin: P1, destination: P1.add(P(R1, 0)) });
  if (P0.getDistance(P1) > 0.5) col.highlight = P0;
  return col;
}

/* ---------------- the interpreter ---------------- */
async function interpretPdf(lib, pdf, onProgress) {
  const OPS = lib.OPS;
  let ocConfig = null;
  try { ocConfig = await pdf.getOptionalContentConfig(); } catch {}
  const buckets = new Map(); // layer key -> { name, visible, group }
  const bucketOrder = [];
  const bucketFor = key => {
    if (!buckets.has(key)) {
      let name = 'Layer 1', visible = true;
      if (key !== '_default' && ocConfig) {
        const g = ocConfig.getGroup(key);
        if (g) { name = g.name || 'Layer'; visible = g.visible !== false; }
      }
      const b = { key, name, visible, group: new paper.Group({ insert: false }) };
      buckets.set(key, b); bucketOrder.push(b);
    }
    return buckets.get(key);
  };
  const images = {};
  const pages = [];
  let xOffset = 0, textSeen = '', count = 0;
  const warnings = new Set();

  for (let pn = 1; pn <= pdf.numPages; pn++) {
    onProgress && onProgress(pn, pdf.numPages);
    const page = await pdf.getPage(pn);
    const vp = page.getViewport({ scale: 1 });
    const pageRect = new paper.Rectangle(xOffset, 0, vp.width, vp.height);
    const V = new paper.Matrix(1, 0, 0, 1, xOffset, 0).appended(new paper.Matrix(...vp.transform));
    pages.push({ x: xOffset, w: vp.width, h: vp.height });
    const ol = await page.getOperatorList({ annotationMode: lib.AnnotationMode ? lib.AnnotationMode.DISABLE : 0 });
    const fns = ol.fnArray, args = ol.argsArray;
    // make sure fonts, images and shadings referenced by the page are available
    const waits = [];
    for (let i = 0; i < fns.length; i++) {
      const fn = fns[i], a = args[i];
      if (fn === OPS.setFont) waits.push(objGet(page.commonObjs, a[0]));
      else if (fn === OPS.paintImageXObject && typeof a[0] === 'string') waits.push(objGet(a[0].startsWith('g_') ? page.commonObjs : page.objs, a[0]));
      else if (fn === OPS.shadingFill && typeof a[0] === 'string') waits.push(objGet(page.objs, a[0]));
      else if ((fn === OPS.setFillColorN || fn === OPS.setStrokeColorN) && a && a[0] === 'Shading') waits.push(objGet(page.objs, a[1]));
    }
    await Promise.all(waits);
    const getObj = id => { try { return (id.startsWith('g_') ? page.commonObjs : page.objs).get(id); } catch { return null; } };

    let st = {
      ctm: new paper.Matrix(), base: new paper.Matrix(),
      fill: { kind: 'rgb', c: C(0, 0, 0, 1) }, stroke: { kind: 'rgb', c: C(0, 0, 0, 1) },
      lw: 1, cap: 0, join: 0, miter: 10, dash: [[], 0], fa: 1, sa: 1, bm: 'normal',
      font: null, fontSize: 0, fontDir: 1, charSpacing: 0, wordSpacing: 0, hScale: 1, leading: 0, rise: 0, trm: 0,
      tm: new paper.Matrix(), x: 0, y: 0, lineX: 0, lineY: 0,
      clips: [],
    };
    const stack = [];
    const mcStack = [];
    let subs = [], cur = null, cpt = null, pendingClip = null;
    let lastText = null;
    const M = () => V.appended(st.ctm);
    const scaleOf = m => Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
    const layerKey = () => { for (let i = mcStack.length - 1; i >= 0; i--) if (mcStack[i]) return mcStack[i]; return '_default'; };

    const containerFor = (skipLast) => {
      const b = bucketFor(layerKey());
      let parent = b.group;
      const clips = skipLast ? st.clips.slice(0, -1) : st.clips;
      for (const c of clips) {
        if (c.skip) continue;
        let g = c.groups.get(parent);
        if (!g) {
          g = new paper.Group({ insert: false });
          const mask = c.path.clone({ insert: false });
          mask.fillColor = null; mask.strokeColor = null;
          g.addChild(mask);
          g.clipped = true;
          parent.addChild(g);
          c.groups.set(parent, g);
        }
        parent = g;
      }
      return parent;
    };
    const emit = (item, skipLastClip) => { containerFor(skipLastClip).addChild(item); count++; };

    const buildPath = () => {
      const valid = subs.filter(s => s.segs.length > 1 || (s.segs.length === 1 && s.closed));
      if (!valid.length) return null;
      const mk = s => { const p = new paper.Path({ segments: s.segs, closed: s.closed, insert: false }); return p; };
      if (valid.length === 1) return mk(valid[0]);
      return new paper.CompoundPath({ children: valid.map(mk), insert: false });
    };
    const fillColorFor = () => {
      const f = st.fill;
      if (f.kind === 'rgb') return paperColor({ ...f.c, a: f.c.a * st.fa });
      if (f.kind === 'shading') {
        const ir = getObj(f.id);
        const col = shadingToColor(ir, V.appended(f.base).appended(f.matrix ? new paper.Matrix(...f.matrix) : new paper.Matrix()));
        if (col) return col;
        warnings.add('Some gradient meshes were simplified to a flat color.');
        return paperColor(C(128, 128, 128, st.fa));
      }
      warnings.add('Pattern fills were replaced with a flat color.');
      return paperColor(f.c ? { ...f.c, a: st.fa } : C(160, 160, 160, st.fa));
    };
    const strokeColorFor = () => {
      const s = st.stroke;
      if (s.kind === 'rgb') return paperColor({ ...s.c, a: s.c.a * st.sa });
      return paperColor(s.c ? { ...s.c, a: st.sa } : C(0, 0, 0, st.sa));
    };
    const applyStroke = (item) => {
      const m = M(), k = scaleOf(m);
      item.strokeColor = strokeColorFor();
      item.strokeWidth = Math.max(st.lw * k, st.lw === 0 ? 0.25 : 0);
      item.strokeCap = ['butt', 'round', 'square'][st.cap] || 'butt';
      item.strokeJoin = ['miter', 'round', 'bevel'][st.join] || 'miter';
      item.miterLimit = st.miter || 10;
      if (st.dash && st.dash[0] && st.dash[0].length) { item.dashArray = st.dash[0].map(v => v * k); item.dashOffset = (st.dash[1] || 0) * k; }
    };
    const consumeClip = () => {
      if (!pendingClip) return;
      const path = buildPath();
      if (path) {
        if (pendingClip.evenOdd) path.fillRule = 'evenodd';
        const b = path.bounds;
        const isRect = isPath(path) && path.segments.length === 4 && !path.hasHandles();
        const skip = isRect && b.contains(pageRect.expand(-1)) || b.contains(pageRect.expand(2));
        st.clips = st.clips.concat([{ path, groups: new Map(), skip, fresh: true }]);
      }
      pendingClip = null;
    };
    const paint = (doFill, doStroke, evenOdd) => {
      const clipPending = !!pendingClip;
      if ((doFill || doStroke) && subs.length) {
        const item = buildPath();
        if (item) {
          if (doFill) { item.fillColor = fillColorFor(); if (evenOdd) item.fillRule = 'evenodd'; }
          if (doStroke) applyStroke(item);
          if (st.bm && st.bm !== 'normal') item.blendMode = st.bm;
          emit(item);
        }
      }
      if (clipPending) consumeClip();
      subs = []; cur = null;
    };
    const textColor = () => {
      const f = st.fill;
      if (f.kind === 'rgb') return paperColor({ ...f.c, a: f.c.a * st.fa });
      if (f.kind === 'shading') { const ir = getObj(f.id); if (ir && ir[3] && ir[3].length) { const s = ir[3].find(x => x[1] !== 'transparent'); if (s) return paperColor({ ...hexToC(s[1]), a: st.fa }); } }
      return paperColor(C(0, 0, 0, st.fa));
    };
    const showText = (glyphs) => {
      const font = st.font;
      if (!font || !st.fontSize || !Array.isArray(glyphs)) return;
      const fs = st.fontSize, fm = (font.fontMatrix && font.fontMatrix[0]) || 0.001;
      let x = 0, txt = '';
      for (const g of glyphs) {
        if (typeof g === 'number') {
          const adv = -g * fs / 1000;
          if (adv > fs * 0.22 && txt && !txt.endsWith(' ')) txt += ' ';
          x += adv;
          continue;
        }
        if (!g) continue;
        txt += g.unicode || '';
        x += (g.width || 0) * fs * fm + (g.isSpace ? st.wordSpacing : 0) + st.charSpacing;
      }
      const startX = st.x;
      st.x += x * st.hScale * st.fontDir;
      const mode = st.trm & 3;
      if (mode === 3 || !txt.trim()) return;
      textSeen += txt + ' ';
      const A = V.appended(st.ctm).appended(st.tm).appended(new paper.Matrix(1, 0, 0, 1, startX, st.y + st.rise)).appended(new paper.Matrix(st.hScale * st.fontDir, 0, 0, -1, 0, 0));
      const origin = A.transform(P(0, 0)), endPt = A.transform(P(x, 0));
      const sx = Math.hypot(A.a, A.b), sy = Math.hypot(A.c, A.d), rot = Math.atan2(A.b, A.a) * 180 / Math.PI;
      const upright = Math.abs(rot) < 0.05 && Math.abs(A.c) < 1e-6 && A.d > 0 && Math.abs(sx - sy) < 1e-3 * sx;
      const fsPage = fs * sy;
      const mf = mapPdfFont(font);
      const col = mode === 1 ? null : textColor();
      const colKey = col ? col.toCSS(true) + col.alpha : 'none';
      if (lastText && alive(lastText.item) === false && lastText.item.parent && lastText.upright && upright && lastText.key === mf.key && lastText.colKey === colKey &&
          Math.abs(lastText.size - fsPage) < 0.05 && Math.abs(lastText.end.y - origin.y) < fsPage * 0.2 && origin.x - lastText.end.x > -fsPage * 0.3 && origin.x - lastText.end.x < fsPage * 0.9 && lastText.layer === layerKey()) {
        const gap = origin.x - lastText.end.x;
        lastText.item.content += (gap > fsPage * 0.12 && !lastText.item.content.endsWith(' ') && !txt.startsWith(' ') ? ' ' : '') + txt;
        lastText.end = endPt;
        return;
      }
      const t = new paper.PointText({ insert: false });
      t.content = txt;
      t.fontFamily = mf.family; t.fontWeight = mf.weight;
      if (upright) { t.fontSize = fsPage; t.point = origin; }
      else { t.fontSize = fs; t.matrix = A; t.data.angle = norm180(rot); }
      t.fillColor = col;
      if (mode === 1 || mode === 2) { t.strokeColor = strokeColorFor(); t.strokeWidth = Math.max(0.25, st.lw * scaleOf(M())); }
      if (st.bm && st.bm !== 'normal') t.blendMode = st.bm;
      emit(t);
      lastText = { item: t, end: endPt, upright, key: mf.key, colKey, size: fsPage, layer: layerKey() };
    };
    const paintImage = (img) => {
      if (!img || !img.width || !img.height) return;
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d');
      let alpha = false;
      if (img.bitmap) ctx.drawImage(img.bitmap, 0, 0);
      else if (img.data) {
        const id = ctx.createImageData(img.width, img.height), d = id.data, s = img.data, n = img.width * img.height;
        if (img.kind === 3) { d.set(s.subarray(0, d.length)); alpha = true; }
        else if (img.kind === 2) { for (let i = 0, j = 0; i < n; i++, j += 4) { d[j] = s[i * 3]; d[j + 1] = s[i * 3 + 1]; d[j + 2] = s[i * 3 + 2]; d[j + 3] = 255; } }
        else { const rb = (img.width + 7) >> 3; for (let y = 0; y < img.height; y++) for (let x2 = 0; x2 < img.width; x2++) { const on = s[y * rb + (x2 >> 3)] & (128 >> (x2 & 7)); const j = (y * img.width + x2) * 4; const v = on ? 255 : 0; d[j] = d[j + 1] = d[j + 2] = v; d[j + 3] = 255; } }
        ctx.putImageData(id, 0, 0);
      } else return;
      if (img.bitmap) alpha = true;
      const url = c.toDataURL(alpha ? 'image/png' : 'image/jpeg', 0.92);
      const r = new paper.Raster({ insert: false });
      r.canvas = c;
      const imgId = 'img' + uid();
      images[imgId] = url; r.data.imgId = imgId;
      r.matrix = V.appended(st.ctm).appended(new paper.Matrix(1 / img.width, 0, 0, -1 / img.height, 0.5, 0.5));
      if (st.fa < 1) r.opacity = st.fa;
      emit(r);
    };

    for (let i = 0; i < fns.length; i++) {
      const fn = fns[i], a = args[i] || [];
      switch (fn) {
        case OPS.save: stack.push({ ...st, dash: [st.dash[0].slice(), st.dash[1]], clips: st.clips.slice() }); break;
        case OPS.restore: if (stack.length) st = stack.pop(); pendingClip = null; break;
        case OPS.transform: st.ctm = st.ctm.appended(new paper.Matrix(a[0], a[1], a[2], a[3], a[4], a[5])); break;
        case OPS.setLineWidth: st.lw = a[0]; break;
        case OPS.setLineCap: st.cap = a[0]; break;
        case OPS.setLineJoin: st.join = a[0]; break;
        case OPS.setMiterLimit: st.miter = a[0]; break;
        case OPS.setDash: st.dash = [a[0] || [], a[1] || 0]; break;
        case OPS.setGState:
          for (const [k, v] of (a[0] || [])) {
            if (k === 'LW') st.lw = v; else if (k === 'LC') st.cap = v; else if (k === 'LJ') st.join = v; else if (k === 'ML') st.miter = v;
            else if (k === 'D') st.dash = [v[0] || [], v[1] || 0];
            else if (k === 'CA') st.sa = v; else if (k === 'ca') st.fa = v;
            else if (k === 'BM') st.bm = (!v || v === 'source-over') ? 'normal' : v;
            else if (k === 'Font') { st.font = getObj(v[0]); st.fontSize = Math.abs(v[1]); st.fontDir = v[1] < 0 ? -1 : 1; }
          }
          break;
        case OPS.setFillRGBColor: st.fill = { kind: 'rgb', c: rgbFromArgs(a) }; break;
        case OPS.setStrokeRGBColor: st.stroke = { kind: 'rgb', c: rgbFromArgs(a) }; break;
        case OPS.setFillColorN:
        case OPS.setStrokeColorN: {
          let v;
          if (a[0] === 'Shading') v = { kind: 'shading', id: a[1], matrix: a[2], base: st.base.clone() };
          else if (a[0] === 'TilingPattern') v = { kind: 'pattern', c: a[1] ? C(a[1][0], a[1][1], a[1][2], 1) : null };
          else v = { kind: 'pattern', c: null };
          if (fn === OPS.setFillColorN) st.fill = v;
          else { st.stroke = v.kind === 'shading' ? { kind: 'pattern', c: (() => { const ir = getObj(v.id); const s = ir && ir[3] && ir[3].find(x => x[1] !== 'transparent'); return s ? hexToC(s[1]) : null; })() } : v; }
          break;
        }
        case OPS.constructPath: {
          const ops = a[0], co = a[1], m = M();
          const T = (x, y) => m.transform(P(x, y));
          for (let j = 0, k = 0; j < ops.length; j++) {
            switch (ops[j] | 0) {
              case OPS.moveTo: { const p = T(co[k], co[k + 1]); cpt = [co[k], co[k + 1]]; k += 2; cur = { segs: [new paper.Segment(p)], closed: false }; subs.push(cur); break; }
              case OPS.lineTo: { const p = T(co[k], co[k + 1]); if (!cur) { cur = { segs: [new paper.Segment(T(...(cpt || [0, 0])))], closed: false }; subs.push(cur); } cur.segs.push(new paper.Segment(p)); cpt = [co[k], co[k + 1]]; k += 2; break; }
              case OPS.curveTo: case OPS.curveTo2: case OPS.curveTo3: {
                const op = ops[j] | 0;
                if (!cur) { cur = { segs: [new paper.Segment(T(...(cpt || [0, 0])))], closed: false }; subs.push(cur); }
                const last = cur.segs[cur.segs.length - 1], p0 = last.point;
                let c1, c2, p3, end;
                if (op === OPS.curveTo) { c1 = T(co[k], co[k + 1]); c2 = T(co[k + 2], co[k + 3]); end = [co[k + 4], co[k + 5]]; k += 6; }
                else if (op === OPS.curveTo2) { c1 = p0; c2 = T(co[k], co[k + 1]); end = [co[k + 2], co[k + 3]]; k += 4; }
                else { c1 = T(co[k], co[k + 1]); end = [co[k + 2], co[k + 3]]; c2 = null; k += 4; }
                p3 = T(end[0], end[1]);
                if (!c2) c2 = p3;
                last.handleOut = c1.subtract(p0);
                cur.segs.push(new paper.Segment(p3, c2.subtract(p3), null));
                cpt = end;
                break;
              }
              case OPS.closePath:
                if (cur) {
                  cur.closed = true;
                  const s = cur.segs;
                  if (s.length > 2 && s[0].point.getDistance(s[s.length - 1].point) < 1e-3) { s[0].handleIn = s[s.length - 1].handleIn; s.pop(); }
                  cpt = null; cur = null;
                }
                break;
              case OPS.rectangle: {
                const x = co[k], y = co[k + 1], w = co[k + 2], hh = co[k + 3]; k += 4;
                cur = { segs: [T(x, y), T(x + w, y), T(x + w, y + hh), T(x, y + hh)].map(p => new paper.Segment(p)), closed: true };
                subs.push(cur); cur = null; cpt = [x, y];
                break;
              }
            }
          }
          break;
        }
        case OPS.closePath: if (cur) { cur.closed = true; cur = null; } break;
        case OPS.fill: paint(true, false, false); break;
        case OPS.eoFill: paint(true, false, true); break;
        case OPS.stroke: paint(false, true, false); break;
        case OPS.closeStroke: if (cur) cur.closed = true; paint(false, true, false); break;
        case OPS.fillStroke: paint(true, true, false); break;
        case OPS.eoFillStroke: paint(true, true, true); break;
        case OPS.closeFillStroke: if (cur) cur.closed = true; paint(true, true, false); break;
        case OPS.closeEOFillStroke: if (cur) cur.closed = true; paint(true, true, true); break;
        case OPS.endPath: paint(false, false, false); break;
        case OPS.clip: pendingClip = { evenOdd: false }; break;
        case OPS.eoClip: pendingClip = { evenOdd: true }; break;
        case OPS.shadingFill: {
          const ir = getObj(a[0]);
          const col = shadingToColor(ir, M());
          if (!col) break;
          const c = st.clips[st.clips.length - 1];
          let item;
          if (c && !c.skip && c.fresh && !c.groups.size) { item = c.path.clone({ insert: false }); c.fresh = false; item.fillColor = col; emit(item, true); }
          else { item = new paper.Path.Rectangle({ rectangle: pageRect, insert: false }); item.fillColor = col; emit(item); }
          if (st.fa < 1) item.opacity = st.fa;
          break;
        }
        case OPS.beginText: st.tm = new paper.Matrix(); st.x = st.lineX = 0; st.y = st.lineY = 0; lastText = lastText && { ...lastText }; break;
        case OPS.endText: break;
        case OPS.setCharSpacing: st.charSpacing = a[0]; break;
        case OPS.setWordSpacing: st.wordSpacing = a[0]; break;
        case OPS.setHScale: st.hScale = a[0] / 100; break;
        case OPS.setLeading: st.leading = -a[0]; break;
        case OPS.setFont: st.font = getObj(a[0]); st.fontSize = Math.abs(a[1]); st.fontDir = a[1] < 0 ? -1 : 1; break;
        case OPS.setTextRenderingMode: st.trm = a[0]; break;
        case OPS.setTextRise: st.rise = a[0]; break;
        case OPS.moveText: st.x = st.lineX += a[0]; st.y = st.lineY += a[1]; break;
        case OPS.setLeadingMoveText: st.leading = a[1]; st.x = st.lineX += a[0]; st.y = st.lineY += a[1]; break;
        case OPS.setTextMatrix: st.tm = new paper.Matrix(a[0], a[1], a[2], a[3], a[4], a[5]); st.x = st.lineX = 0; st.y = st.lineY = 0; break;
        case OPS.nextLine: st.x = st.lineX += 0; st.y = st.lineY += st.leading; break;
        case OPS.showText: case OPS.showSpacedText: showText(a[0]); break;
        case OPS.nextLineShowText: st.y = st.lineY += st.leading; st.x = st.lineX; showText(a[0]); break;
        case OPS.nextLineSetSpacingShowText: st.wordSpacing = a[0]; st.charSpacing = a[1]; st.y = st.lineY += st.leading; st.x = st.lineX; showText(a[2]); break;
        case OPS.paintImageXObject: paintImage(typeof a[0] === 'string' ? getObj(a[0]) : null); break;
        case OPS.paintInlineImageXObject: paintImage(a[0]); break;
        case OPS.paintImageMaskXObject: warnings.add('Some image masks were skipped.'); break;
        case OPS.paintFormXObjectBegin:
          stack.push({ ...st, dash: [st.dash[0].slice(), st.dash[1]], clips: st.clips.slice() });
          if (Array.isArray(a[0]) && a[0].length === 6) st.ctm = st.ctm.appended(new paper.Matrix(...a[0]));
          st.base = st.ctm.clone();
          break;
        case OPS.paintFormXObjectEnd: if (stack.length) st = stack.pop(); break;
        case OPS.beginMarkedContentProps: {
          const props = a[1];
          let id = null;
          if (a[0] === 'OC' && props) id = props.type === 'OCG' ? props.id : (props.ids && props.ids[0]) || null;
          mcStack.push(id);
          break;
        }
        case OPS.beginMarkedContent: mcStack.push(null); break;
        case OPS.endMarkedContent: mcStack.pop(); break;
      }
    }
    xOffset += vp.width + 60;
    page.cleanup && page.cleanup();
  }
  return { pages, buckets: bucketOrder.filter(b => b.group.children.length), images, textSeen, count, warnings };
}

/* ---------------- progress UI ---------------- */
function showBusy(title, text) {
  const msg = h('p', { class: 'hint num' }, text || '');
  const dlg = openDialog({ title, body: [h('div', { class: 'busy-bar' }, h('i')), msg], buttons: [], locked: true });
  return { set: t => { msg.textContent = t; }, close: () => dlg.close() };
}

/* ---------------- open / place ---------------- */
function aiHelp(kind) {
  const why = kind === 'nopdf'
    ? 'This Illustrator file was saved without its PDF-compatible copy, so the artwork inside is in Adobe\'s private format that other apps cannot read.'
    : 'This is an older PostScript-style Illustrator or EPS file, which Nib cannot read.';
  openDialog({
    title: 'This file needs a quick re-save', body: [
      h('p', null, why),
      h('p', null, 'If you have access to Illustrator (or a friend does), any of these makes it open here with layers intact:'),
      h('ul', { class: 'hint', style: { margin: '0', paddingLeft: '18px', lineHeight: '1.6' } },
        h('li', null, 'File › Save As › Adobe Illustrator, and tick “Create PDF Compatible File”.'),
        h('li', null, 'Or File › Save As › Adobe PDF (keep “Preserve Illustrator Editing Capabilities” on).'),
        h('li', null, 'Or File › Export › SVG.')),
    ], buttons: [{ label: 'OK', primary: true }],
  });
}
async function readAI(f, onProgress) {
  const bytes = new Uint8Array(await f.arrayBuffer());
  const kind = sniffBytes(bytes);
  if (kind === 'ps') { aiHelp('ps'); return null; }
  if (kind !== 'pdf') throw new Error('This does not look like an Illustrator or PDF file.');
  const lib = await loadPdfJs();
  const task = lib.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, isOffscreenCanvasSupported: false, verbosity: 0, stopAtErrors: false });
  const pdf = await task.promise;
  const res = await interpretPdf(lib, pdf, onProgress);
  try { pdf.destroy(); } catch {}
  if (/saved without PDF Content/i.test(res.textSeen) && res.count < 40) { aiHelp('nopdf'); return null; }
  return res;
}
async function openAIFile(f) {
  const go = async () => {
    const busy = showBusy('Opening ' + f.name, 'Loading the Illustrator reader…');
    try {
      const res = await readAI(f, (n, t) => busy.set(`Converting artboard ${n} of ${t}…`));
      if (!res) return;
      doc = newDocModel(f.name.replace(/\.(ai|ait|pdf)$/i, ''), res.pages[0].w, res.pages[0].h, 'in');
      doc.artboards = res.pages.map((p, i) => ({ name: `Artboard ${i + 1}`, x: p.x, y: 0, w: p.w, h: p.h }));
      doc.images = res.images;
      project.clear();
      if (!res.buckets.length) newLayer('Layer 1');
      for (const b of res.buckets) {
        const L = newLayer(b.name);
        L.addChildren(b.group.removeChildren());
        L.visible = b.visible;
      }
      doc.libId = null;
      afterLoad();
      S.dirty = true; updateStatus();
      const w = [...res.warnings];
      toast(`Opened ${f.name}: ${res.count} objects on ${res.buckets.length || 1} layer${res.buckets.length === 1 ? '' : 's'}. Press Ctrl+S to save it as a Nib project.` + (w.length ? ' ' + w.join(' ') : ''), 7000);
    } catch (e) {
      console.error(e);
      toast('That file could not be opened. ' + friendlyError(e), 6000);
    } finally { busy.close(); }
  };
  confirmDiscard(go);
}
async function placeAIFile(f, at) {
  const busy = showBusy('Placing ' + f.name, 'Loading the Illustrator reader…');
  try {
    const res = await readAI(f, (n, t) => busy.set(`Converting artboard ${n} of ${t}…`));
    if (!res) return;
    Object.assign(doc.images, res.images);
    const g = new paper.Group({ insert: false });
    for (const b of res.buckets) { const lg = b.group; lg.name = b.name; lg.visible = b.visible; g.addChild(lg); }
    if (g.children.length === 1) { const only = g.firstChild; g.addChildren(only.removeChildren()); only.remove(); }
    placeNew(g);
    g.name = f.name.replace(/\.(ai|ait|pdf)$/i, '');
    g.position = at || view.center;
    setSelection([g]); commit('Place');
  } catch (e) { console.error(e); toast('That file could not be placed. ' + friendlyError(e), 6000); }
  finally { busy.close(); }
}
