/* ============================================================
   Vector PDF export (one page per artboard). Opens in Illustrator, Acrobat and print RIPs.
   ============================================================ */
const PDF_BLEND = { multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', darken: 'Darken', lighten: 'Lighten', 'color-dodge': 'ColorDodge', 'color-burn': 'ColorBurn', 'hard-light': 'HardLight', 'soft-light': 'SoftLight', difference: 'Difference', exclusion: 'Exclusion', hue: 'Hue', saturation: 'Saturation', color: 'Color', luminosity: 'Luminosity' };
const WINANSI = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
const pn = v => { if (!isFinite(v)) return '0'; const s = (+v.toFixed(4)).toString(); return s === '-0' ? '0' : s; };
function pdfText(str) {
  let out = '(';
  for (const ch of str) {
    let c = ch.codePointAt(0);
    if (c > 255) c = WINANSI[c] || 63;
    else if (c >= 0x80 && c < 0xA0) c = 63;
    if (c === 40 || c === 41 || c === 92) out += '\\' + String.fromCharCode(c);
    else if (c < 32 || c > 126) out += '\\' + c.toString(8).padStart(3, '0');
    else out += String.fromCharCode(c);
  }
  return out + ')';
}
const latin1 = s => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; };
async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const cs = new CompressionStream('deflate');
    const out = new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer();
    return new Uint8Array(await out);
  } catch { return null; }
}
function standardFont(it) {
  const fam = String(it.fontFamily || '').toLowerCase(), w = String(it.fontWeight || '');
  const bold = /bold|[6-9]00/.test(w), italic = /italic|oblique/.test(w);
  if (/mono|courier|consol/.test(fam)) return 'Courier' + (bold && italic ? '-BoldOblique' : bold ? '-Bold' : italic ? '-Oblique' : '');
  if (/serif|times|georgia|lora|playfair|garamond|minion/.test(fam) && !/sans/.test(fam)) return 'Times-' + (bold && italic ? 'BoldItalic' : bold ? 'Bold' : italic ? 'Italic' : 'Roman');
  return 'Helvetica' + (bold && italic ? '-BoldOblique' : bold ? '-Bold' : italic ? '-Oblique' : '');
}

class PdfWriter {
  constructor() { this.objs = []; }
  ref() { this.objs.push(null); return this.objs.length; }
  put(n, body, stream) { this.objs[n - 1] = { body, stream }; return n; }
  add(body, stream) { return this.put(this.ref(), body, stream); }
  build(root) {
    const chunks = []; let len = 0;
    const push = b => { const u = typeof b === 'string' ? latin1(b) : b; chunks.push(u); len += u.length; };
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const offsets = [];
    this.objs.forEach((o, i) => {
      offsets.push(len);
      push(`${i + 1} 0 obj\n`);
      if (o.stream) { push(o.body.replace(/>>\s*$/, `/Length ${o.stream.length} >>`) + '\nstream\n'); push(o.stream); push('\nendstream'); }
      else push(o.body);
      push('\nendobj\n');
    });
    const xref = len;
    let x = `xref\n0 ${this.objs.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) x += String(off).padStart(10, '0') + ' 00000 n \n';
    push(x + `trailer\n<< /Size ${this.objs.length + 1} /Root ${root} 0 R /Info << /Producer (Nib Vector Studio) >> >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(len); let p = 0;
    for (const c of chunks) { out.set(c, p); p += c.length; }
    return out;
  }
}

async function buildPDF(abList) {
  const W = new PdfWriter();
  const catalog = W.ref(), pagesRef = W.ref();
  const fonts = new Map(), pageRefs = [];
  const fontRef = name => { if (!fonts.has(name)) fonts.set(name, W.add(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`)); return fonts.get(name); };
  const imgCache = new Map();
  for (const abi of abList) {
    const ab = doc.artboards[abi];
    const ops = [], res = { gs: new Map(), pat: [], img: [], font: new Set() };
    const toDefault = p => P(p.x - ab.x, ab.y + ab.h - p.y);
    const gsName = (ca, CA, bm) => {
      const key = `${pn(ca)}|${pn(CA)}|${bm || ''}`;
      if (!res.gs.has(key)) res.gs.set(key, { name: 'G' + res.gs.size, body: `<< /Type /ExtGState /ca ${pn(ca)} /CA ${pn(CA)}${bm && PDF_BLEND[bm] ? ' /BM /' + PDF_BLEND[bm] : ''} >>` });
      return res.gs.get(key).name;
    };
    const colorOf = c => `${pn(c.red)} ${pn(c.green)} ${pn(c.blue)}`;
    const solidOf = col => col.type === 'gradient' ? col.gradient.stops[0].color : col;
    const gradientPattern = (col, it) => {
      const g = col.gradient, m = it.globalMatrix;
      const stops = g.stops.map((s, i, a) => ({ o: s.offset != null ? s.offset : i / Math.max(1, a.length - 1), c: s.color })).sort((a, b) => a.o - b.o);
      if (stops[0].o > 0) stops.unshift({ o: 0, c: stops[0].c });
      if (stops[stops.length - 1].o < 1) stops.push({ o: 1, c: stops[stops.length - 1].c });
      for (let i = 1; i < stops.length; i++) if (stops[i].o <= stops[i - 1].o) stops[i].o = Math.min(1, stops[i - 1].o + 1e-4);
      const fn2 = (a, b) => `<< /FunctionType 2 /Domain [0 1] /C0 [${colorOf(a)}] /C1 [${colorOf(b)}] /N 1 >>`;
      let fn;
      if (stops.length === 2) fn = fn2(stops[0].c, stops[1].c);
      else {
        const fs = [], bounds = [], enc = [];
        for (let i = 0; i < stops.length - 1; i++) { fs.push(fn2(stops[i].c, stops[i + 1].c)); enc.push('0 1'); if (i > 0) bounds.push(pn(stops[i].o)); }
        fn = `<< /FunctionType 3 /Domain [0 1] /Functions [${fs.join(' ')}] /Bounds [${bounds.join(' ')}] /Encode [${enc.join(' ')}] >>`;
      }
      const o = toDefault(m.transform(col.origin)), d = toDefault(m.transform(col.destination));
      let sh;
      if (g.radial) {
        const r = m.transform(col.origin).getDistance(m.transform(col.destination));
        const f = col.highlight ? toDefault(m.transform(col.highlight)) : o;
        sh = `<< /ShadingType 3 /ColorSpace /DeviceRGB /Coords [${pn(f.x)} ${pn(f.y)} 0 ${pn(o.x)} ${pn(o.y)} ${pn(r)}] /Function ${fn} /Extend [true true] >>`;
      } else sh = `<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [${pn(o.x)} ${pn(o.y)} ${pn(d.x)} ${pn(d.y)}] /Function ${fn} /Extend [true true] >>`;
      const ref = W.add(`<< /PatternType 2 /Shading ${sh} >>`);
      const name = 'P' + res.pat.length;
      res.pat.push({ name, ref });
      return name;
    };
    const pathOps = it => {
      const m = it.globalMatrix, paths = isCompound(it) ? it.children : [it];
      for (const p of paths) {
        const segs = p.segments;
        if (!segs.length) continue;
        const pt = s => m.transform(s);
        let prev = segs[0];
        const a0 = pt(prev.point);
        ops.push(`${pn(a0.x)} ${pn(a0.y)} m`);
        const curve = (s0, s1) => {
          const c1 = pt(s0.point.add(s0.handleOut)), c2 = pt(s1.point.add(s1.handleIn)), e = pt(s1.point);
          if (s0.handleOut.isZero() && s1.handleIn.isZero()) ops.push(`${pn(e.x)} ${pn(e.y)} l`);
          else ops.push(`${pn(c1.x)} ${pn(c1.y)} ${pn(c2.x)} ${pn(c2.y)} ${pn(e.x)} ${pn(e.y)} c`);
        };
        for (let i = 1; i < segs.length; i++) { curve(prev, segs[i]); prev = segs[i]; }
        if (p.closed) { if (!prev.handleOut.isZero() || !segs[0].handleIn.isZero()) curve(prev, segs[0]); ops.push('h'); }
      }
    };
    const imageXObject = async (r) => {
      if (imgCache.has(r)) return imgCache.get(r);
      const c = r.canvas;
      if (!c || !c.width || !c.height) return null;
      const w = c.width, hh = c.height;
      const data = c.getContext('2d').getImageData(0, 0, w, hh).data;
      let alpha = false;
      for (let i = 3; i < data.length; i += 4) if (data[i] < 255) { alpha = true; break; }
      let ref;
      if (!alpha) {
        const url = c.toDataURL('image/jpeg', 0.92);
        const bin = atob(url.split(',')[1]);
        ref = W.add(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${hh} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode >>`, latin1(bin));
      } else {
        const rgb = new Uint8Array(w * hh * 3), a = new Uint8Array(w * hh);
        for (let i = 0, j = 0, k = 0; i < data.length; i += 4, j += 3, k++) { rgb[j] = data[i]; rgb[j + 1] = data[i + 1]; rgb[j + 2] = data[i + 2]; a[k] = data[i + 3]; }
        const zr = await deflate(rgb), za = await deflate(a);
        const sm = W.add(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${hh} /ColorSpace /DeviceGray /BitsPerComponent 8${za ? ' /Filter /FlateDecode' : ''} >>`, za || a);
        ref = W.add(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${hh} /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask ${sm} 0 R${zr ? ' /Filter /FlateDecode' : ''} >>`, zr || rgb);
      }
      const name = 'I' + imgCache.size;
      imgCache.set(r, { name, ref });
      return imgCache.get(r);
    };
    const draw = async (it, alpha) => {
      if (!it.visible) return;
      const a = alpha * (it.opacity == null ? 1 : it.opacity);
      if (a <= 0.001) return;
      const bm = it.blendMode !== 'normal' ? it.blendMode : null;
      if (isGroup(it) || isLayer(it)) {
        const kids = it.children.slice();
        if (it.clipped && kids[0] && isPathLike(kids[0])) {
          ops.push('q'); pathOps(kids[0]); ops.push(kids[0].fillRule === 'evenodd' ? 'W* n' : 'W n');
          for (const k of kids.slice(1)) await draw(k, a);
          ops.push('Q');
        } else for (const k of kids) if (!k.clipMask) await draw(k, a);
        return;
      }
      if (isPathLike(it)) {
        const fc = it.fillColor, sc = it.strokeColor, sw = it.strokeWidth || 0;
        const hasF = !!fc && (fc.type === 'gradient' || fc.alpha > 0), hasS = !!sc && sw > 0 && (sc.type === 'gradient' || sc.alpha > 0);
        if (!hasF && !hasS) return;
        ops.push('q');
        const fa = hasF && fc.type !== 'gradient' ? fc.alpha : 1, sa = hasS ? solidOf(sc).alpha : 1;
        if (a * fa < 1 || a * sa < 1 || bm) ops.push(`/${gsName(a * fa, a * sa, bm)} gs`);
        if (hasF) { if (fc.type === 'gradient') ops.push(`/Pattern cs /${gradientPattern(fc, it)} scn`); else ops.push(`${colorOf(fc)} rg`); }
        if (hasS) {
          const k = Math.sqrt(Math.abs(it.globalMatrix.a * it.globalMatrix.d - it.globalMatrix.b * it.globalMatrix.c)) || 1;
          ops.push(`${colorOf(solidOf(sc))} RG ${pn(sw * k)} w ${{ butt: 0, round: 1, square: 2 }[it.strokeCap] || 0} J ${{ miter: 0, round: 1, bevel: 2 }[it.strokeJoin] || 0} j ${pn(it.miterLimit || 10)} M`);
          const da = it.dashArray || [];
          if (da.length) ops.push(`[${da.map(v => pn(v * k)).join(' ')}] ${pn((it.dashOffset || 0) * k)} d`);
        }
        pathOps(it);
        const eo = it.fillRule === 'evenodd';
        ops.push(hasF && hasS ? (eo ? 'B*' : 'B') : hasF ? (eo ? 'f*' : 'f') : 'S');
        ops.push('Q');
        return;
      }
      if (isText(it)) {
        if (!it.content) return;
        const fc = it.fillColor;
        if (!fc) return;
        const col = solidOf(fc);
        const fname = standardFont(it), fref = fontRef(fname);
        res.font.add(fname);
        const lines = it.content.split('\n'), lead = it.leading || it.fontSize * 1.2;
        measureCtx.font = `${it.fontWeight} ${it.fontSize}px ${it.fontFamily}`;
        ops.push('q');
        if (a * col.alpha < 1 || bm) ops.push(`/${gsName(a * col.alpha, a, bm)} gs`);
        ops.push(`${colorOf(col)} rg BT /F${[...fonts.keys()].indexOf(fname)} ${pn(it.fontSize)} Tf`);
        lines.forEach((ln, i) => {
          const w = measureCtx.measureText(ln).width;
          const dx = it.justification === 'center' ? -w / 2 : it.justification === 'right' ? -w : 0;
          const G = it.globalMatrix.appended(new paper.Matrix(1, 0, 0, -1, dx, i * lead));
          ops.push(`${pn(G.a)} ${pn(G.b)} ${pn(G.c)} ${pn(G.d)} ${pn(G.tx)} ${pn(G.ty)} Tm ${pdfText(ln)} Tj`);
        });
        ops.push('ET Q');
        void fref;
        return;
      }
      if (isRaster(it)) {
        const x = await imageXObject(it);
        if (!x) return;
        res.img.push(x);
        const sz = it.size, K = it.globalMatrix.appended(new paper.Matrix(sz.width, 0, 0, -sz.height, -sz.width / 2, sz.height / 2));
        ops.push('q');
        if (a < 1 || bm) ops.push(`/${gsName(a, a, bm)} gs`);
        ops.push(`${pn(K.a)} ${pn(K.b)} ${pn(K.c)} ${pn(K.d)} ${pn(K.tx)} ${pn(K.ty)} cm /${x.name} Do Q`);
      }
    };
    ops.push(`1 0 0 -1 ${pn(-ab.x)} ${pn(ab.y + ab.h)} cm`);
    for (const L of project.layers) await draw(L, 1);
    const raw = latin1(ops.join('\n'));
    const z = await deflate(raw);
    const contents = W.add(`<<${z ? ' /Filter /FlateDecode' : ''} >>`, z || raw);
    const fontDict = [...fonts.entries()].map(([n, r], i) => `/F${i} ${r} 0 R`).join(' ');
    const gsDict = [...res.gs.values()].map(g => `/${g.name} ${g.body}`).join(' ');
    const patDict = res.pat.map(p => `/${p.name} ${p.ref} 0 R`).join(' ');
    const imgDict = [...new Set(res.img)].map(x => `/${x.name} ${x.ref} 0 R`).join(' ');
    const resources = `<< /ProcSet [/PDF /Text /ImageB /ImageC] /Font << ${fontDict} >> /ExtGState << ${gsDict} >> /Pattern << ${patDict} >> /XObject << ${imgDict} >> >>`;
    pageRefs.push(W.add(`<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 ${pn(ab.w)} ${pn(ab.h)}] /TrimBox [0 0 ${pn(ab.w)} ${pn(ab.h)}] /Resources ${resources} /Contents ${contents} 0 R >>`));
  }
  W.put(pagesRef, `<< /Type /Pages /Kids [${pageRefs.map(r => r + ' 0 R').join(' ')}] /Count ${pageRefs.length} >>`);
  W.put(catalog, `<< /Type /Catalog /Pages ${pagesRef} 0 R >>`);
  return W.build(catalog);
}
