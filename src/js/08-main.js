/* ============================================================
   Wiring: pointer & keyboard input, UI refresh, startup
   ============================================================ */
const isTypingTarget = el => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
S.keys = { shift: false };

/* ---------------- UI refresh ---------------- */
let uiQueued = false, uiDocChanged = false;
function scheduleUI(docChanged = true) {
  if (docChanged) uiDocChanged = true;
  if (uiQueued) return;
  uiQueued = true;
  requestAnimationFrame(() => {
    uiQueued = false;
    const full = uiDocChanged; uiDocChanged = false;
    updateToolbar(); buildControlBar(); renderDock(false, full); updateStatus();
  });
}
on('selection', () => scheduleUI(false));
on('doc', () => scheduleUI(true));
listeners.tool.push(() => scheduleUI(false));
listeners.style.push(() => updateToolbar());

/* ---------------- pointer input on the canvas ---------------- */
function evInfo(e) {
  const r = cvOver.getBoundingClientRect();
  const vp = P(e.clientX - r.left, e.clientY - r.top);
  return { e, vp, pt: toProj(vp), shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, button: e.button };
}
cvOver.addEventListener('mousedown', e => e.preventDefault());
cvOver.addEventListener('pointerdown', e => {
  if (document.activeElement && document.activeElement !== ted && document.activeElement !== document.body) document.activeElement.blur();
  closeFloating();
  if (e.button === 2) return;
  const ev = evInfo(e);
  cvOver.setPointerCapture(e.pointerId);
  if (e.button === 1 || (spaceHeld && !S.editingText)) { D = { active: true, pan: true, last: ev.vp }; setCursor(CUR.handDown); return; }
  if (S.editingText && S.tool !== 'type') commitTextEdit();
  const id = effectiveToolId();
  const tool = TOOLS[id];
  D = { active: true, tool, toolId: id, start: ev.vp, startPt: ev.pt, moved: false };
  tool.down && tool.down(ev, D);
  requestDraw();
});
cvOver.addEventListener('pointermove', e => {
  const ev = evInfo(e);
  cursorView = ev.vp;
  updateStatusXY(ev.pt);
  if (D && D.active) {
    if (D.pan) { panBy(ev.vp.subtract(D.last)); D.last = ev.vp; return; }
    if (!D.moved && ev.vp.getDistance(D.start) < 3) return;
    D.moved = true;
    D.tool.drag && D.tool.drag(ev, D);
    requestDraw();
    return;
  }
  const tool = TOOLS[effectiveToolId()];
  tool.move && tool.move(ev);
  requestDraw();
});
function endPointer(e, cancelled) {
  if (!D) return;
  const ev = evInfo(e);
  const d = D;
  if (!d.pan && !cancelled && d.tool.up) d.tool.up(ev, d);
  D = null;
  S.snapLines = null; S.label = null; S.marquee = null;
  const tool = TOOLS[effectiveToolId()];
  if (tool.move) tool.move(ev); else setCursor(tool.cursor);
  requestDraw();
}
cvOver.addEventListener('pointerup', e => endPointer(e, false));
cvOver.addEventListener('pointercancel', e => endPointer(e, true));
cvOver.addEventListener('pointerleave', () => { if (!D) { cursorView = null; S.hover = null; S.snapLines = null; requestDraw(); } });
cvOver.addEventListener('dblclick', e => { const t = TOOLS[effectiveToolId()]; if (t.dbl) t.dbl(evInfo(e)); });
cvOver.addEventListener('contextmenu', e => {
  e.preventDefault();
  const ev = evInfo(e);
  if (S.tool === 'select' || S.tool === 'direct') {
    const it = S.tool === 'select' ? hitTop(ev.pt) : hitLeaf(ev.pt);
    if (it && !sel.items.has(it)) setSelection([it]);
  }
  openContextMenu(e.clientX, e.clientY);
});
cvOver.addEventListener('wheel', e => {
  e.preventDefault();
  const r = cvOver.getBoundingClientRect(), vp = P(e.clientX - r.left, e.clientY - r.top);
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? VH : 1;
  if (e.ctrlKey || e.metaKey || e.altKey) zoomAt(vp, zoom() * Math.exp(-e.deltaY * k * 0.0022));
  else {
    let dx = e.deltaX * k, dy = e.deltaY * k;
    if (e.shiftKey && !dx) { dx = dy; dy = 0; }
    panBy(P(-dx, -dy));
  }
}, { passive: false });
window.addEventListener('wheel', e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

/* ---------------- rulers: drag out guides ---------------- */
function rulerDrag(axis) {
  return e => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const mv = ev => {
      const r = cvOver.getBoundingClientRect(), vp = P(ev.clientX - r.left, ev.clientY - r.top), pt = toProj(vp);
      let v = axis === 'h' ? pt.y : pt.x;
      if (!ev.shiftKey) v = Math.round(v);
      S.guidePreview = { axis, v, inside: vp.x >= 0 && vp.y >= 0 && vp.x <= VW && vp.y <= VH };
      S.label = S.guidePreview.inside ? { text: axis === 'h' ? `Y: ${fmtU(v - activeAB().y)}` : `X: ${fmtU(v - activeAB().x)}`, at: vp } : null;
      requestDraw();
    };
    const up = () => {
      el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up);
      const g = S.guidePreview;
      S.guidePreview = null; S.label = null;
      if (g && g.inside) {
        (axis === 'h' ? doc.guides.h : doc.guides.v).push(g.v);
        if (!S.view.guides) { S.view.guides = true; lsSet('nib.view', S.view); }
        commit('New Guide');
      }
      requestDraw();
    };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  };
}
rulerTop.addEventListener('pointerdown', rulerDrag('h'));
rulerLeft.addEventListener('pointerdown', rulerDrag('v'));

/* ---------------- drag & drop files ---------------- */
vpEl.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
vpEl.addEventListener('drop', e => {
  if (!e.dataTransfer || !e.dataTransfer.files.length) return;
  e.preventDefault();
  const r = cvOver.getBoundingClientRect(), at = toProj(P(e.clientX - r.left, e.clientY - r.top));
  [...e.dataTransfer.files].forEach((f, i) => placeFile(f, at.add(P(i * 20, i * 20))));
});

/* ---------------- keyboard ---------------- */
const KEYMAP = new Map();
const CODE_NAMES = { BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Equal: '=', Minus: '-', Slash: '/', Backslash: '\\', IntlBackslash: '\\', Comma: ',', Period: '.', Backquote: '`', NumpadAdd: 'Plus', NumpadSubtract: '-', NumpadEnter: 'Enter', Enter: 'Enter', Escape: 'Esc', Backspace: 'Backspace', Delete: 'Delete', Tab: 'Tab', Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };
function keyName(e) {
  const c = e.code || '';
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (/^Numpad\d$/.test(c)) return c.slice(6);
  if (/^F\d+$/.test(c)) return c;
  if (CODE_NAMES[c]) return CODE_NAMES[c];
  return e.key && e.key.length === 1 ? e.key.toUpperCase() : (e.key || '');
}
function comboFromEvent(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(keyName(e));
  return parts.join('+');
}
function normCombo(s) {
  s = s.replace(/!$/, '');
  const parts = s.split('+');
  const key = parts.pop();
  const mods = new Set(parts);
  return [mods.has('Ctrl') && 'Ctrl', mods.has('Alt') && 'Alt', mods.has('Shift') && 'Shift', key.length === 1 ? key.toUpperCase() : key].filter(Boolean).join('+');
}
function bind(keys, fn) { for (const k of [].concat(keys)) KEYMAP.set(normCombo(k), fn); }
function bindKeys() {
  const walk = items => {
    for (const it of (typeof items === 'function' ? items() : items)) {
      if (it === '-') continue;
      if (it.sub && typeof it.sub !== 'function') walk(it.sub);
      if (it.key && it.run) bind(it.key, () => { if (!it.enabled || it.enabled()) it.run(); });
    }
  };
  MENUS.forEach(m => walk(m.items));
  for (const id in TOOLS) if (TOOLS[id].key) bind(TOOLS[id].key, () => setTool(id));
  bind('Plus', () => setTool('penAdd'));
  bind('Shift+Plus', () => setTool('penAdd'));
  bind(['Ctrl+Plus'], () => zoomStep(1));
  bind('X', () => { S.style.focus = S.style.focus === 'fill' ? 'stroke' : 'fill'; updateToolbar(); if (DOCK.top === 'swatches') renderDock(true); });
  bind('Shift+X', swapFillStroke);
  bind('D', defaultFillStroke);
  bind('/', () => paintMode('none'));
  bind(',', () => paintMode('solid'));
  bind('.', () => paintMode('gradient'));
  bind(['Delete', 'Backspace'], deleteSelection);
  bind('Tab', togglePanels);
  bind('Esc', () => {
    closeFloating();
    if (pen.path) { penFinish(); return; }
    if (S.isolated) { exitIsolation(); return; }
    if (S.tool === 'artboard') { setTool('select'); return; }
    clearSelection();
  });
  bind('Enter', () => { if (S.tool === 'select' && selItems().length) openTransformDialog('move'); });
  bind('F7', () => showDockTab('bottom', 'layers'));
}
function arrowDelta(k) { return k === 'Up' ? [0, -1] : k === 'Down' ? [0, 1] : k === 'Left' ? [-1, 0] : k === 'Right' ? [1, 0] : null; }
window.addEventListener('keydown', e => {
  S.keys.shift = e.shiftKey;
  if (e.key === 'Control' || e.key === 'Meta') { if (!ctrlHeld) { ctrlHeld = true; refreshCursor(); requestDraw(); } }
  if (e.key === 'Alt') { e.preventDefault(); if (!altHeld) { altHeld = true; refreshCursor(); } }
  if (dialogOpen) return;
  if (isTypingTarget(e.target)) return;
  if (homeVisible()) {
    const combo = comboFromEvent(e);
    if (combo === 'Esc') { e.preventDefault(); hideHome(); }
    else if (combo === 'Ctrl+O') { e.preventDefault(); pickFile('open'); }
    else if (combo === 'Ctrl+Alt+N') { e.preventDefault(); openNewDialog(); }
    return;
  }
  if (e.code === 'Space') { e.preventDefault(); if (!spaceHeld) { spaceHeld = true; refreshCursor(); } return; }
  if (D && D.active) {
    if (D.tool && D.tool.onKey && D.tool.onKey(e)) e.preventDefault();
    return;
  }
  const tool = TOOLS[S.tool];
  if (tool.onKey && tool.onKey(e)) { e.preventDefault(); return; }
  const k = keyName(e);
  const ad = arrowDelta(k);
  if (ad && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    if (selItems().length) { const n = S.nudge * (e.shiftKey ? 10 : 1); nudge(ad[0] * n, ad[1] * n); }
    return;
  }
  const combo = comboFromEvent(e);
  if (combo === 'Ctrl+V' && !(clip && !clip.svgWritten)) return; // let the paste event read the system clipboard
  const fn = KEYMAP.get(combo);
  if (fn) { e.preventDefault(); closeFloating(); fn(e); }
});
window.addEventListener('keyup', e => {
  S.keys.shift = e.shiftKey;
  if (e.key === 'Control' || e.key === 'Meta') { ctrlHeld = false; refreshCursor(); requestDraw(); }
  if (e.key === 'Alt') { altHeld = false; refreshCursor(); }
  if (e.code === 'Space') { spaceHeld = false; refreshCursor(); }
  if (arrowDelta(keyName(e)) && S.nudging) { S.nudging = false; commit('Nudge'); }
});
window.addEventListener('blur', () => { spaceHeld = ctrlHeld = altHeld = false; if (S.nudging) { S.nudging = false; commit('Nudge'); } });

/* ---------------- chrome buttons, dock resizer ---------------- */
$('#btnTheme').addEventListener('click', () => setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark'));
$('#btnDock').innerHTML = icon('panels');
$('#btnDock').addEventListener('click', togglePanels);
(() => {
  const rs = $('#dockResize'), dock = $('#dock');
  rs.addEventListener('pointerdown', e => {
    e.preventDefault(); rs.setPointerCapture(e.pointerId);
    const r = dock.getBoundingClientRect();
    const mv = ev => { const pct = clamp((ev.clientY - r.top) / r.height * 100, 20, 85); dock.style.setProperty('--dock-split', pct + '%'); lsSet('nib.dockSplit', pct); };
    const up = () => { rs.removeEventListener('pointermove', mv); rs.removeEventListener('pointerup', up); };
    rs.addEventListener('pointermove', mv); rs.addEventListener('pointerup', up);
  });
})();
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { setTheme(uiTheme()); });

/* ---------------- startup ---------------- */
async function init() {
  const v = lsGet('nib.view', null);
  if (v) Object.assign(S.view, v);
  S.view.outline = false;
  setTheme(uiTheme());
  readTheme();
  buildMenubar(); buildToolbar(); buildDockTabs(); buildStatusBar();
  $('#stage').classList.toggle('rulers', S.view.rulers);
  const split = lsGet('nib.dockSplit', null);
  if (split) $('#dock').style.setProperty('--dock-split', split + '%');
  // a blank document sits behind the start screen until something is opened
  doc = newDocModel('Untitled-1', 864, 1152, 'in');
  project.clear(); newLayer('Layer 1');
  resizeCanvases();
  resetHistory();
  bindKeys();
  setTool('select');
  new ResizeObserver(() => resizeCanvases()).observe(vpEl);
  if (document.fonts) { document.fonts.ready.then(refreshTexts); document.fonts.addEventListener && document.fonts.addEventListener('loadingdone', refreshTexts); }
  const restored = await restoreAutosave().catch(() => false);
  if (!restored) { S.dirty = false; fitArtboard(); }
  selectionChanged();
  scheduleUI();
  requestDraw();
  showHome();
  initCapabilities();
}
