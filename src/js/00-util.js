'use strict';
/* ============================================================
   Nib Vector Studio — utilities, color math, icons, cursors
   ============================================================ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = (v, d = 2) => { if (v == null || !isFinite(v)) return ''; const r = +(+v).toFixed(d); return String(Object.is(r, -0) ? 0 : r); };
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const deg = r => r * 180 / Math.PI;
const norm180 = a => { a = ((a % 360) + 360) % 360; return a > 180 ? a - 360 : a; };
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function safeEval(str) {
  const s = String(str).trim().replace(/,/g, '.').replace(/[a-z%°]+$/i, '').trim();
  if (!s) return NaN;
  if (!/^[-+*/().\d\s]+$/.test(s)) return NaN;
  try { const v = Function('"use strict";return (' + s + ')')(); return typeof v === 'number' && isFinite(v) ? v : NaN; } catch { return NaN; }
}
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
function lsDel(k) { try { localStorage.removeItem(k); } catch {} }

/* ---------------- color ---------------- */
// Internal color: {r,g,b: 0-255, a: 0-1}. Paint: null (none) | {type:'solid', c} | {type:'linear'|'radial', stops:[{c,o}], angle}
const C = (r, g, b, a = 1) => ({ r, g, b, a });
function parseHex(s) {
  if (!s) return null;
  s = String(s).trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map(x => x + x).join('');
  if (/^[0-9a-f]{4}$/i.test(s)) s = s.split('').map(x => x + x).join('');
  if (!/^([0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return null;
  const n = i => parseInt(s.slice(i, i + 2), 16);
  return C(n(0), n(2), n(4), s.length === 8 ? +(n(6) / 255).toFixed(3) : 1);
}
const hex2 = v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
const toHex = c => ('#' + hex2(c.r) + hex2(c.g) + hex2(c.b)).toUpperCase();
const cssColor = c => `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${+c.a.toFixed(3)})`;
function rgbToHsv({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hh = 0;
  if (d) {
    if (mx === r) hh = ((g - b) / d) % 6; else if (mx === g) hh = (b - r) / d + 2; else hh = (r - g) / d + 4;
    hh *= 60; if (hh < 0) hh += 360;
  }
  return { h: hh, s: mx ? d / mx : 0, v: mx };
}
function hsvToRgb(hh, s, v) {
  const f = n => { const k = (n + hh / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return { r: Math.round(f(5) * 255), g: Math.round(f(3) * 255), b: Math.round(f(1) * 255) };
}
const clonePaint = p => p ? JSON.parse(JSON.stringify(p)) : null;
const paintEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const solid = (hex) => ({ type: 'solid', c: parseHex(hex) });
function paintCSS(p) {
  if (!p) return null;
  if (p.type === 'solid') return cssColor(p.c);
  const stops = p.stops.map(s => `${cssColor(s.c)} ${fmt(s.o * 100, 1)}%`).join(', ');
  if (p.type === 'radial') return `radial-gradient(circle, ${stops})`;
  return `linear-gradient(${fmt(90 + p.angle, 1)}deg, ${stops})`;
}
function paintSwatch(el, p) {
  el.classList.add('paint');
  el.classList.toggle('none', p === null);
  el.classList.toggle('mixed', p === 'mixed');
  el.classList.remove('checker');
  el.style.background = '';
  if (p && p !== 'mixed') {
    const css = paintCSS(p);
    const hasAlpha = p.type === 'solid' ? p.c.a < 1 : p.stops.some(s => s.c.a < 1);
    if (hasAlpha) {
      el.style.background = (p.type === 'solid' ? `linear-gradient(${css}, ${css})` : css) + ', conic-gradient(#ccc 25%, #fff 0 50%, #ccc 0 75%, #fff 0) 0 0 / 8px 8px';
    } else el.style.background = css;
  }
}
function paintLabel(p) {
  if (p === 'mixed') return 'Mixed';
  if (!p) return 'None';
  if (p.type === 'solid') return toHex(p.c) + (p.c.a < 1 ? ` ${Math.round(p.c.a * 100)}%` : '');
  return p.type === 'radial' ? 'Radial gradient' : 'Linear gradient';
}
function lerpC(a, b, t) { return C(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, a.a + (b.a - a.a) * t); }
function colorAtStops(stops, o) {
  const s = stops.slice().sort((x, y) => x.o - y.o);
  if (o <= s[0].o) return { ...s[0].c };
  for (let i = 1; i < s.length; i++) if (o <= s[i].o) { const t = (o - s[i - 1].o) / ((s[i].o - s[i - 1].o) || 1); return lerpC(s[i - 1].c, s[i].c, t); }
  return { ...s[s.length - 1].c };
}

/* ---------------- icons ---------------- */
const SVGS = {
  select: '<path d="M5 2.5 16 11l-5 .7 3 6.1-2.1 1-3-6.1L5 16Z" fill="currentColor" stroke="none"/>',
  direct: '<path d="M5 2.5 16 11l-5 .7 3 6.1-2.1 1-3-6.1L5 16Z" stroke-width="1.3"/>',
  pen: '<path d="M10 2.2 15.3 9.4 12.6 17.6H7.4L4.7 9.4Z"/><path d="M10 2.2v6.6"/><circle cx="10" cy="10" r="1.3" fill="currentColor" stroke="none"/>',
  penAdd: '<path d="M8 2.5 12.4 8.5 10.2 15.4H5.8L3.6 8.5Z"/><path d="M8 2.5V8"/><path d="M15 12.5v5M12.5 15h5"/>',
  penDel: '<path d="M8 2.5 12.4 8.5 10.2 15.4H5.8L3.6 8.5Z"/><path d="M8 2.5V8"/><path d="M12.5 15h5"/>',
  anchor: '<path d="M3.5 15.5 10 5l6.5 10.5"/><rect x="8.3" y="3.3" width="3.4" height="3.4" fill="currentColor" stroke="none"/>',
  type: '<path d="M4 4.5h12v2.6M4 7.1V4.5M10 4.5v11.5M7.4 16h5.2"/>',
  line: '<path d="M4 16 16 4"/>',
  rect: '<rect x="3.5" y="5.5" width="13" height="9"/>',
  rrect: '<rect x="3.5" y="5.5" width="13" height="9" rx="3"/>',
  ellipse: '<ellipse cx="10" cy="10" rx="7" ry="5.5"/>',
  polygon: '<path d="M10 3.2 16.2 6.6v6.8L10 16.8 3.8 13.4V6.6Z"/>',
  star: '<path d="m10 2.8 2.2 4.6 5 .6-3.7 3.5.9 5-4.4-2.4-4.4 2.4.9-5L2.8 8l5-.6Z"/>',
  pencil: '<path d="m4 16 .9-3.7 8.3-8.3 2.8 2.8-8.3 8.3Z"/><path d="m11.8 5.4 2.8 2.8"/>',
  brush: '<path d="m15.6 3.2 1.4 1.4-6.6 7.6-2.4-2.4Z"/><path d="M7.6 10.2c-2.3-.3-3.3 1.3-3.4 2.9-.1 1.5-.8 2.6-2 3.1 3.6.6 6.6-.6 6.9-3.4"/>',
  scissors: '<circle cx="5.5" cy="14.5" r="2.3"/><circle cx="14.5" cy="14.5" r="2.3"/><path d="m7.2 12.9 8.3-9.6M12.8 12.9 4.5 3.3"/>',
  rotate: '<path d="M15.8 8.2A6.2 6.2 0 1 0 16.2 12"/><path d="M16.4 3.8v4.6h-4.6"/>',
  reflect: '<path d="M10 2.5v15" stroke-dasharray="1.6 1.8"/><path d="M7.6 5.5 3 14.5h4.6Z"/><path d="m12.4 5.5 4.6 9h-4.6Z" fill="currentColor"/>',
  scale: '<rect x="3" y="9.5" width="7.5" height="7.5"/><path d="M8 3h9v9" stroke-dasharray="1.6 1.6"/><path d="m10.5 9.5 5.2-5.2M12 4.3h3.7V8"/>',
  eyedropper: '<path d="m12.6 3.9 3.5 3.5-2 2-3.5-3.5Z" fill="currentColor"/><path d="m11.4 6.7-7 7v2.4h2.4l7-7"/>',
  gradient: '<rect x="3.5" y="3.5" width="13" height="13"/><path d="M6.5 3.5v13" stroke-width="2.4" opacity=".25"/><path d="M10 3.5v13" stroke-width="2.4" opacity=".55"/><path d="M13.5 3.5v13" stroke-width="2.4" opacity=".9"/>',
  hand: '<path d="M7 10.5V4.8a1.2 1.2 0 0 1 2.4 0V9.5V3.7a1.2 1.2 0 0 1 2.4 0v5.8V4.6a1.2 1.2 0 0 1 2.4 0v5.6-3.2a1.2 1.2 0 0 1 2.4 0v4.9c0 3.4-2.3 5.6-5.5 5.6-2.3 0-3.5-1-4.7-2.6L3.9 11a1.2 1.2 0 0 1 1.8-1.5Z"/>',
  zoom: '<circle cx="8.5" cy="8.5" r="5.3"/><path d="m12.4 12.4 4.6 4.6"/>',
  artboard: '<path d="M6 2.5v15M14 2.5v15M2.5 6h15M2.5 14h15"/>',
  eye: '<path d="M1.8 10S5 4.5 10 4.5 18.2 10 18.2 10 15 15.5 10 15.5 1.8 10 1.8 10Z"/><circle cx="10" cy="10" r="2.4"/>',
  eyeOff: '<path d="M1.8 10S5 4.5 10 4.5 18.2 10 18.2 10 15 15.5 10 15.5 1.8 10 1.8 10Z" opacity=".35"/><path d="m3.5 16.5 13-13"/>',
  lock: '<rect x="4.5" y="9" width="11" height="8" rx="1.2"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/>',
  unlock: '<rect x="4.5" y="9" width="11" height="8" rx="1.2" opacity=".35"/><path d="M7 9V6.5a3 3 0 0 1 6 0" opacity=".35"/>',
  chev: '<path d="m6 4 6 6-6 6"/>',
  chevDown: '<path d="m4 7 6 6 6-6"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  trash: '<path d="M4 5.5h12M8 5.5V3.8h4v1.7M5.5 5.5l.8 11h7.4l.8-11"/>',
  newLayer: '<rect x="3" y="5" width="11" height="11" rx="1"/><path d="M6 3h11v11" opacity=".5"/><path d="M8.5 8v5M6 10.5h5"/>',
  close: '<path d="m5 5 10 10M15 5 5 15"/>',
  swap: '<path d="M3 9a6 6 0 0 1 6-6h1M10 3 8 1M10 3 8 5M17 11a6 6 0 0 1-6 6h-1M10 17l2-2M10 17l2 2" stroke-width="1.6"/>',
  sun: '<circle cx="10" cy="10" r="3.4"/><path d="M10 1.8v2.4M10 15.8v2.4M1.8 10h2.4M15.8 10h2.4M4.2 4.2l1.7 1.7M14.1 14.1l1.7 1.7M4.2 15.8l1.7-1.7M14.1 5.9l1.7-1.7"/>',
  moon: '<path d="M15.8 12.6A6.5 6.5 0 0 1 7.4 4.2 6.5 6.5 0 1 0 15.8 12.6Z"/>',
  panels: '<rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/><path d="M12.5 3.5v13"/>',
  alL: '<path d="M3 2.5v15"/><rect x="5" y="5" width="10" height="3.5" fill="currentColor" stroke="none"/><rect x="5" y="11.5" width="6" height="3.5" fill="currentColor" stroke="none"/>',
  alCH: '<path d="M10 2.5v15"/><rect x="4" y="5" width="12" height="3.5" fill="currentColor" stroke="none" opacity=".85"/><rect x="6.5" y="11.5" width="7" height="3.5" fill="currentColor" stroke="none" opacity=".85"/>',
  alR: '<path d="M17 2.5v15"/><rect x="5" y="5" width="10" height="3.5" fill="currentColor" stroke="none"/><rect x="9" y="11.5" width="6" height="3.5" fill="currentColor" stroke="none"/>',
  alT: '<path d="M2.5 3h15"/><rect x="5" y="5" width="3.5" height="10" fill="currentColor" stroke="none"/><rect x="11.5" y="5" width="3.5" height="6" fill="currentColor" stroke="none"/>',
  alCV: '<path d="M2.5 10h15"/><rect x="5" y="4" width="3.5" height="12" fill="currentColor" stroke="none" opacity=".85"/><rect x="11.5" y="6.5" width="3.5" height="7" fill="currentColor" stroke="none" opacity=".85"/>',
  alB: '<path d="M2.5 17h15"/><rect x="5" y="5" width="3.5" height="10" fill="currentColor" stroke="none"/><rect x="11.5" y="9" width="3.5" height="6" fill="currentColor" stroke="none"/>',
  diH: '<path d="M3 3v14M17 3v14M10 3v14" opacity=".45"/><rect x="5" y="7" width="3" height="6" fill="currentColor" stroke="none"/><rect x="12" y="5" width="3" height="10" fill="currentColor" stroke="none"/>',
  diV: '<path d="M3 3h14M3 17h14M3 10h14" opacity=".45"/><rect x="7" y="5" width="6" height="3" fill="currentColor" stroke="none"/><rect x="5" y="12" width="10" height="3" fill="currentColor" stroke="none"/>',
  spH: '<rect x="2.5" y="5" width="3.5" height="10" fill="currentColor" stroke="none"/><rect x="8.25" y="5" width="3.5" height="10" fill="currentColor" stroke="none"/><rect x="14" y="5" width="3.5" height="10" fill="currentColor" stroke="none"/>',
  spV: '<rect x="5" y="2.5" width="10" height="3.5" fill="currentColor" stroke="none"/><rect x="5" y="8.25" width="10" height="3.5" fill="currentColor" stroke="none"/><rect x="5" y="14" width="10" height="3.5" fill="currentColor" stroke="none"/>',
  pfUnite: '<path d="M3 3h9v4h5v10H8v-4H3Z" fill="currentColor" stroke="none"/>',
  pfMinus: '<path d="M3 3h9v4H8v6H3Z" fill="currentColor" stroke="none"/><rect x="8.5" y="7.5" width="8" height="9" stroke-dasharray="1.5 1.5"/>',
  pfIntersect: '<rect x="3.5" y="3.5" width="8" height="9" stroke-dasharray="1.5 1.5"/><rect x="8.5" y="7.5" width="8" height="9" stroke-dasharray="1.5 1.5"/><rect x="8" y="7" width="4" height="6" fill="currentColor" stroke="none"/>',
  pfExclude: '<path d="M3 3h9v4H8v6H3ZM12 7h5v10H8v-4h4Z" fill="currentColor" stroke="none"/>',
  pfDivide: '<path d="M3 3h9v4H8v6H3Z" fill="currentColor" stroke="none" opacity=".55"/><rect x="8.5" y="7.5" width="3" height="5" fill="currentColor" stroke="none"/><path d="M12.5 7.5H17v9H8.5v-3.5" fill="currentColor" stroke="none" opacity=".8"/>',
  pfMinusBack: '<rect x="3.5" y="3.5" width="8" height="9" stroke-dasharray="1.5 1.5"/><path d="M12 7h5v10H8v-4h4Z" fill="currentColor" stroke="none"/>',
  flipH: '<path d="M10 2.5v15" stroke-dasharray="1.6 1.8"/><path d="M7.5 5.5 3 14.5h4.5ZM12.5 5.5l4.5 9h-4.5Z"/>',
  flipV: '<path d="M2.5 10h15" stroke-dasharray="1.6 1.8"/><path d="M5.5 7.5 14.5 3v4.5ZM5.5 12.5l9 4.5v-4.5Z"/>',
  link: '<path d="M8.5 11.5 11.5 8.5"/><path d="M7 9.5 5.3 11.2a2.5 2.5 0 0 0 3.5 3.5L10.5 13M13 10.5l1.7-1.7a2.5 2.5 0 0 0-3.5-3.5L9.5 7"/>',
  capButt: '<path d="M3 10h10" stroke-width="5"/><path d="M13 5v10" stroke-width="1"/>',
  capRound: '<path d="M3 10h10" stroke-width="5" stroke-linecap="round"/><path d="M13 5v10" stroke-width="1" opacity=".5"/>',
  capSquare: '<path d="M3 10h12.5" stroke-width="5"/><path d="M13 5v10" stroke-width="1" opacity=".5"/>',
  joinMiter: '<path d="M4 16V5h11" stroke-width="4.5" stroke-linejoin="miter"/>',
  joinRound: '<path d="M4 16V5h11" stroke-width="4.5" stroke-linejoin="round"/>',
  joinBevel: '<path d="M4 16V5h11" stroke-width="4.5" stroke-linejoin="bevel"/>',
  txL: '<path d="M3 5h14M3 9h9M3 13h14M3 17h7"/>',
  txC: '<path d="M3 5h14M5.5 9h9M3 13h14M6.5 17h7"/>',
  txR: '<path d="M3 5h14M8 9h9M3 13h14M10 17h7"/>',
  front: '<rect x="3" y="3" width="9" height="9" opacity=".45"/><rect x="8" y="8" width="9" height="9" fill="currentColor" stroke="none"/>',
  back: '<rect x="8" y="8" width="9" height="9" opacity=".45"/><rect x="3" y="3" width="9" height="9" fill="currentColor" stroke="none"/>',
  fwd: '<rect x="3" y="3" width="9" height="9" opacity=".45"/><rect x="8" y="8" width="9" height="9"/><path d="M12.5 12.5" />',
  group: '<rect x="2.5" y="2.5" width="15" height="15" stroke-dasharray="2 2"/><rect x="5" y="5" width="5" height="5" fill="currentColor" stroke="none"/><circle cx="12.5" cy="12.5" r="2.6" fill="currentColor" stroke="none"/>',
  ungroup: '<rect x="3" y="3" width="6" height="6" fill="currentColor" stroke="none"/><circle cx="13.5" cy="13.5" r="3" fill="currentColor" stroke="none"/>',
  smooth: '<path d="M3 15c3 0 4-10 7-10s4 10 7 10"/><circle cx="10" cy="5" r="1.6" fill="currentColor"/>',
  corner: '<path d="M3 15 10 5l7 10"/><rect x="8.5" y="3.5" width="3" height="3" fill="currentColor"/>',
  cut: '<path d="M3 10h5M12 10h5"/><rect x="7.5" y="8.5" width="3" height="3" fill="currentColor"/>',
  doc: '<path d="M5 2.5h7l3.5 3.5v11.5H5Z"/><path d="M12 2.5V6h3.5"/>',
  folder: '<path d="M2.5 5.5V15a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V7.5a1 1 0 0 0-1-1H9L7.5 4.5h-4a1 1 0 0 0-1 1Z"/>',
  cloud: '<path d="M6 15.5h8.5a3.5 3.5 0 0 0 .3-7A5 5 0 0 0 5.2 9 3.3 3.3 0 0 0 6 15.5Z"/>',
};
function icon(name, cls) {
  return `<svg class="${cls || ''}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVGS[name] || ''}</svg>`;
}
function iconEl(name) { const s = document.createElement('span'); s.innerHTML = icon(name); return s.firstChild; }

/* ---------------- cursors ---------------- */
function svgCursor(inner, hx, hy, fallback = 'default') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${inner}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hx} ${hy}, ${fallback}`;
}
const ARROW = 'M4 3 L4 22 L9 17.5 L12.3 25 L15.4 23.6 L12.2 16.3 L18.5 16 Z';
const NIB = 'M6 3 L12.5 12 L9.5 22 H2.5 L-0.5 12 Z';
const penCursor = (mark) => svgCursor(
  `<g transform="translate(9 4)"><path d="${NIB}" fill="#111" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/><path d="M6 3v8" stroke="#fff" stroke-width="1"/><circle cx="6" cy="12.3" r="1.4" fill="#fff"/></g>` + (mark || ''), 15, 6, 'crosshair');
const markW = (d) => `<g stroke-linecap="round"><path d="${d}" stroke="#fff" stroke-width="4"/><path d="${d}" stroke="#111" stroke-width="1.8"/></g>`;
const CUR = {
  arrow: svgCursor(`<path d="${ARROW}" fill="#111" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/>`, 4, 3),
  arrowObj: svgCursor(`<path d="${ARROW}" fill="#111" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/><rect x="19" y="20" width="6" height="6" fill="#111" stroke="#fff" stroke-width="1"/>`, 4, 3),
  arrowDup: svgCursor(`<path d="${ARROW}" fill="#111" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/><path d="${ARROW}" transform="translate(9 3)" fill="#111" stroke="#fff" stroke-width="1.3" stroke-linejoin="round" opacity=".9"/>`, 4, 3),
  white: svgCursor(`<path d="${ARROW}" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/>`, 4, 3),
  whiteObj: svgCursor(`<path d="${ARROW}" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/><rect x="19" y="20" width="6" height="6" fill="#111" stroke="#fff" stroke-width="1"/>`, 4, 3),
  whitePt: svgCursor(`<path d="${ARROW}" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/><rect x="19" y="20" width="6" height="6" fill="#fff" stroke="#111" stroke-width="1.2"/>`, 4, 3),
  pen: penCursor(markW('M24 22l5 5M29 22l-5 5')),
  penPlain: penCursor(''),
  penAdd: penCursor(markW('M26.5 21.5v6M23.5 24.5h6')),
  penDel: penCursor(markW('M23.5 24.5h6')),
  penClose: penCursor('<circle cx="26.5" cy="24.5" r="3" fill="none" stroke="#fff" stroke-width="3.5"/><circle cx="26.5" cy="24.5" r="3" fill="none" stroke="#111" stroke-width="1.6"/>'),
  penCont: penCursor(markW('M24 27.5l5-6')),
  penConvert: penCursor(markW('M23.5 27l3-5 3 5')),
  convert: svgCursor(markW('M8 22l8-13 8 13') + '<rect x="13.5" y="6.5" width="5" height="5" fill="#111" stroke="#fff"/>', 16, 9, 'crosshair'),
  rotate: svgCursor(`<g fill="none" stroke-linecap="round"><path d="M8 20a9 9 0 0 1 13-11" stroke="#fff" stroke-width="4.2"/><path d="M8 20a9 9 0 0 1 13-11" stroke="#111" stroke-width="2"/></g><path d="M23 5.5 24.5 12 18 11Z" fill="#111" stroke="#fff" stroke-width="1"/><path d="M4.5 16 11 17.5 5.5 22Z" fill="#111" stroke="#fff" stroke-width="1"/>`, 14, 14, 'crosshair'),
  eyedropper: svgCursor(`<path d="M21 4.5l6.5 6.5-3 3-6.5-6.5Z" fill="#111" stroke="#fff"/><path d="M18.5 9 6.5 21v4.5H11L23 13.5" fill="#fff" stroke="#111" stroke-width="1.5"/>`, 6, 26, 'crosshair'),
  pencil: svgCursor(`<path d="m4 28 1.6-6.4L20 7.2l4.8 4.8L10.4 26.4Z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/><path d="m4 28 1.6-6.4 4.8 4.8Z" fill="#111"/>`, 4, 28, 'crosshair'),
  scissors: 'crosshair',
  cross: 'crosshair',
  text: 'text',
  hand: 'grab',
  handDown: 'grabbing',
  zoomIn: 'zoom-in',
  zoomOut: 'zoom-out',
  guideV: 'col-resize',
  guideH: 'row-resize',
};
