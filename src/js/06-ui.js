/* ============================================================
   UI: toasts, dialogs, fields, menus, toolbar, control bar, panels, color picker, status bar
   ============================================================ */

/* ---------------- toasts ---------------- */
let toastTimer = null;
function toast(msg, ms = 3400) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function toastQuiet(msg) { toast(msg, 1300); }

/* ---------------- key labels ---------------- */
function keyLabel(k) {
  if (!k) return '';
  const first = Array.isArray(k) ? k[0] : k;
  if (!IS_MAC) return first.replace('Esc', 'Esc');
  return first.replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧');
}

/* ---------------- fields ---------------- */
function numField(o) {
  const dec = o.decimals == null ? 2 : o.decimals;
  let last = o.mixed ? null : o.value;
  const input = h('input', { value: o.mixed || o.value == null ? '' : fmt(o.value, dec), placeholder: o.mixed ? '—' : '', id: o.id, 'aria-label': o.title || o.label || '', inputmode: 'decimal', spellcheck: 'false', autocomplete: 'off' });
  const lab = o.label ? h('span', { class: 'fl', title: (o.title || o.label) + ' — drag to adjust' }, o.label) : null;
  const el = h('label', { class: 'fld ' + (o.cls || ''), title: o.title || '' }, lab, input, o.unit ? h('span', { class: 'unit' }, o.unit) : null);
  const commitV = v => {
    if (!isFinite(v)) { input.value = last == null ? '' : fmt(last, dec); return; }
    if (o.min != null) v = Math.max(o.min, v);
    if (o.max != null) v = Math.min(o.max, v);
    input.value = fmt(v, dec);
    if (last != null && Math.abs(v - last) < 1e-9) return;
    last = v;
    o.onCommit && o.onCommit(v);
  };
  input.addEventListener('focus', () => input.select());
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commitV(safeEval(input.value)); input.select(); }
    else if (e.key === 'Escape') { input.value = last == null ? '' : fmt(last, dec); input.blur(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const cur = safeEval(input.value), base = isFinite(cur) ? cur : (last || 0);
      commitV(base + (e.key === 'ArrowUp' ? 1 : -1) * (o.step || 1) * (e.shiftKey ? 10 : 1));
      input.select();
    }
  });
  input.addEventListener('change', () => commitV(safeEval(input.value)));
  if (lab) lab.addEventListener('pointerdown', e => {
    e.preventDefault();
    const x0 = e.clientX, v0 = isFinite(safeEval(input.value)) ? safeEval(input.value) : (last || 0);
    let moved = false;
    lab.setPointerCapture(e.pointerId);
    const mv = ev => {
      const dx = ev.clientX - x0;
      if (Math.abs(dx) > 2) moved = true;
      let v = v0 + Math.round(dx / 2) * (o.step || 1) * (ev.shiftKey ? 10 : 1);
      if (o.min != null) v = Math.max(o.min, v);
      if (o.max != null) v = Math.min(o.max, v);
      input.value = fmt(v, dec);
    };
    const up = () => { lab.removeEventListener('pointermove', mv); lab.removeEventListener('pointerup', up); if (moved) commitV(safeEval(input.value)); else input.focus(); };
    lab.addEventListener('pointermove', mv); lab.addEventListener('pointerup', up);
  });
  return { el, input, set(v) { last = v; input.value = fmt(v, dec); }, get: () => safeEval(input.value) };
}
let fieldSeq = 0;
function fNum(label, value, o = {}) {
  const id = 'dlgf' + (++fieldSeq);
  const f = numField({ value, unit: o.unit, step: o.step || 1, decimals: o.decimals, id, cls: 'grow' });
  const el = h('label', { class: 'f', for: id }, h('span', null, label), f.el);
  return { el, input: f.input, get: f.get, set: v => f.input.value = fmt(v) };
}
function fLen(label, px, o = {}) {
  const f = fNum(label, toU(px), { unit: unitKey(), decimals: UD().dec, ...o });
  return { el: f.el, input: f.input, get: () => fromU(f.get()), set: v => f.input.value = fmt(toU(v), UD().dec) };
}
function fChk(label, checked) {
  const id = 'dlgf' + (++fieldSeq);
  const inp = h('input', { type: 'checkbox', id, checked: !!checked });
  return { el: h('label', { class: 'chk', for: id }, inp, label), get: () => inp.checked, input: inp };
}
function fText(label, value) {
  const id = 'dlgf' + (++fieldSeq);
  const inp = h('input', { class: 'txt', id, value: value || '', spellcheck: 'false' });
  inp.addEventListener('keydown', e => e.stopPropagation());
  return { el: h('label', { class: 'f', for: id }, h('span', null, label), inp), get: () => inp.value, input: inp };
}
function fSel(label, value, options) {
  const id = 'dlgf' + (++fieldSeq);
  const s = h('select', { class: 'sel', id }, options.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value) }, t)));
  return { el: h('label', { class: 'f', for: id }, h('span', null, label), s), get: () => s.value, input: s };
}
function fRadio(label, options, value) {
  let cur = value;
  const seg = h('div', { class: 'seg' });
  options.forEach(([v, t]) => {
    const b = h('button', { type: 'button', class: v === cur ? 'on' : '' }, t);
    b.addEventListener('click', () => { cur = v; $$('button', seg).forEach(x => x.classList.remove('on')); b.classList.add('on'); });
    seg.append(b);
  });
  return { el: h('div', { class: 'f', style: { display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: '8px' } }, h('span', null, label), h('div', null, seg)), get: () => cur };
}

/* ---------------- dialogs ---------------- */
let dialogOpen = null;
// A dialog closed any way other than one of its buttons (Esc, clicking outside, another screen taking over)
// counts as cancelled, so live previews are always rolled back. `locked` dialogs (progress) can't be dismissed.
function openDialog({ title, body, buttons = [], wide, onEscape, onClose, locked }) {
  closeFloating();
  if (dialogOpen) dialogOpen.close();
  const bg = h('div', { class: 'modal-bg' });
  const b = h('div', { class: 'dlg-b' }, ...(body || []).filter(Boolean));
  const f = h('div', { class: 'dlg-f' });
  const dlg = h('div', { class: 'dlg' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('div', { class: 'dlg-h' }, title), b, buttons.length ? f : null);
  bg.append(dlg);
  let settled = false, closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    bg.remove();
    if (dialogOpen && dialogOpen.bg === bg) dialogOpen = null;
    document.removeEventListener('keydown', onKey, true);
    if (!settled && onEscape) { try { onEscape(); } catch (e) { console.error(e); } }
    onClose && onClose();
  };
  let primary = null;
  for (const bt of buttons) {
    const btn = h('button', { class: 'btn' + (bt.primary ? ' primary' : '') + (bt.left ? ' left' : ''), type: 'button' }, bt.label);
    btn.addEventListener('click', () => {
      if (closed) return;
      settled = !!bt.onClick;
      let r;
      try { r = bt.onClick ? bt.onClick() : undefined; } catch (e) { console.error(e); toast('Something went wrong: ' + (e.message || e)); }
      if (r === false) { settled = false; return; }
      close();
    });
    if (bt.primary) primary = btn;
    f.append(btn);
  }
  const onKey = e => {
    if (!document.body.contains(bg)) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!locked) close(); }
    else if (e.key === 'Enter' && primary && !(e.target && e.target.tagName === 'TEXTAREA')) { e.preventDefault(); e.stopPropagation(); setTimeout(() => primary.click(), 0); }
    else e.stopPropagation();
  };
  document.addEventListener('keydown', onKey, true);
  bg.addEventListener('pointerdown', e => { if (e.target === bg && !locked) close(); });
  document.body.append(bg);
  dialogOpen = { bg, close, locked: !!locked };
  setTimeout(() => { const first = dlg.querySelector('input:not([type=checkbox]):not([type=range]), select'); if (first) { first.focus(); first.select && first.select(); } else if (primary) primary.focus(); }, 0);
  return { close, el: dlg };
}

/* ---------------- floating things (menus, flyouts, popovers) ---------------- */
const floating = new Set();
function closeFloating(except) {
  for (const f of [...floating]) if (f !== except) { f.close(); floating.delete(f); }
  $$('.mtop.open').forEach(b => b.classList.remove('open'));
}
document.addEventListener('pointerdown', e => {
  if (e.target.closest('.menu, .flyout, .pop, .mtop')) return;
  closeFloating();
}, true);

/* ---------------- menus ---------------- */
const hasSel = () => selItems().length > 0;
const MENUS = [
  { label: 'File', items: [
    { label: 'Home', key: 'Ctrl+Alt+H', run: () => showHome() },
    { label: 'New…', key: 'Ctrl+Alt+N', run: () => confirmDiscard(openNewDialog) },
    { label: 'Open…', key: 'Ctrl+O', run: () => confirmDiscard(() => pickFile('open')) },
    { label: 'Open Recent…', run: () => showHome() },
    '-',
    { label: 'Save', key: 'Ctrl+S', run: () => saveDoc() },
    { label: 'Save As…', key: 'Ctrl+Shift+S', run: () => saveAs() },
    { label: 'Download Copy (.nib.json)', key: 'Ctrl+Alt+S', run: () => downloadDoc() },
    '-',
    { label: 'Place…', key: 'Ctrl+Shift+P', run: () => pickFile('place') },
    { label: 'Export', sub: [
      { label: 'Export as PNG…', key: 'Ctrl+Shift+E', run: () => openExportDialog('png') },
      { label: 'Export as JPG…', run: () => openExportDialog('jpg') },
      { label: 'Export as SVG…', key: 'Ctrl+Alt+Shift+E', run: () => openExportDialog('svg') },
      { label: 'Export as PDF…', run: () => openExportDialog('pdf') },
      { label: 'Export Selection as SVG', enabled: hasSel, run: () => exportSelectionSVG() },
    ] },
    '-',
    { label: 'Document Setup…', key: 'Ctrl+Alt+P', run: () => openDocSetup() },
  ] },
  { label: 'Edit', items: [
    { label: () => 'Undo' + (undoLabel() ? ' ' + undoLabel() : ''), key: 'Ctrl+Z', enabled: () => H.idx > 0, run: undo },
    { label: () => 'Redo' + (redoLabel() ? ' ' + redoLabel() : ''), key: 'Ctrl+Shift+Z', enabled: () => H.idx < H.stack.length - 1, run: redo },
    '-',
    { label: 'Cut', key: 'Ctrl+X', enabled: hasSel, run: () => copySel(true) },
    { label: 'Copy', key: 'Ctrl+C', enabled: hasSel, run: () => { copySel(); toastQuiet('Copied'); } },
    { label: 'Paste', key: 'Ctrl+V', enabled: () => !!clip, run: () => pasteClip('center') },
    { label: 'Paste in Front', key: 'Ctrl+F', enabled: () => !!clip, run: () => pasteClip('front') },
    { label: 'Paste in Back', key: 'Ctrl+B', enabled: () => !!clip, run: () => pasteClip('back') },
    { label: 'Paste in Place', key: 'Ctrl+Shift+V', enabled: () => !!clip, run: () => pasteClip('inplace') },
    { label: 'Duplicate', key: 'Ctrl+Alt+D', enabled: hasSel, run: duplicateSel },
    { label: 'Clear', key: 'Delete', enabled: hasSel, run: deleteSelection },
    '-',
    { label: 'Keyboard Shortcuts…', key: 'Ctrl+Alt+Shift+K', run: () => openShortcuts() },
  ] },
  { label: 'Object', items: [
    { label: 'Transform', sub: [
      { label: 'Transform Again', key: 'Ctrl+D', enabled: () => hasSel() && !!S.lastXform, run: transformAgain },
      '-',
      { label: 'Move…', key: 'Ctrl+Shift+M', enabled: hasSel, run: () => openTransformDialog('move') },
      { label: 'Rotate…', enabled: hasSel, run: () => openTransformDialog('rotate') },
      { label: 'Reflect…', enabled: hasSel, run: () => openTransformDialog('reflect') },
      { label: 'Scale…', enabled: hasSel, run: () => openTransformDialog('scale') },
      '-',
      { label: 'Reset Bounding Box', enabled: hasSel, run: resetBBox },
    ] },
    { label: 'Arrange', sub: [
      { label: 'Bring to Front', key: 'Ctrl+Shift+]', enabled: hasSel, run: () => arrange('front') },
      { label: 'Bring Forward', key: 'Ctrl+]', enabled: hasSel, run: () => arrange('forward') },
      { label: 'Send Backward', key: 'Ctrl+[', enabled: hasSel, run: () => arrange('backward') },
      { label: 'Send to Back', key: 'Ctrl+Shift+[', enabled: hasSel, run: () => arrange('back') },
      '-',
      { label: 'Send to Current Layer', enabled: hasSel, run: () => sendToLayer(activeLayer()) },
    ] },
    { label: 'Align', sub: [
      { label: 'Left', enabled: hasSel, run: () => alignSel('L') }, { label: 'Horizontal Center', enabled: hasSel, run: () => alignSel('CH') }, { label: 'Right', enabled: hasSel, run: () => alignSel('R') },
      '-',
      { label: 'Top', enabled: hasSel, run: () => alignSel('T') }, { label: 'Vertical Center', enabled: hasSel, run: () => alignSel('CV') }, { label: 'Bottom', enabled: hasSel, run: () => alignSel('B') },
      '-',
      { label: 'Distribute Horizontal Centers', enabled: hasSel, run: () => distributeSel('H') }, { label: 'Distribute Vertical Centers', enabled: hasSel, run: () => distributeSel('V') },
      { label: 'Distribute Horizontal Space', enabled: hasSel, run: () => distributeSel('SH') }, { label: 'Distribute Vertical Space', enabled: hasSel, run: () => distributeSel('SV') },
    ] },
    '-',
    { label: 'Group', key: 'Ctrl+G', enabled: hasSel, run: groupSel },
    { label: 'Ungroup', key: 'Ctrl+Shift+G', enabled: () => selItems().some(isGroup), run: ungroupSel },
    { label: 'Isolate Selected Group', enabled: () => selItems().length === 1 && isGroup(selItems()[0]), run: () => enterIsolation(selItems()[0]) },
    '-',
    { label: 'Lock Selection', key: 'Ctrl+2', enabled: hasSel, run: lockSel },
    { label: 'Unlock All', key: 'Ctrl+Alt+2', run: unlockAll },
    { label: 'Hide Selection', key: 'Ctrl+3', enabled: hasSel, run: hideSel },
    { label: 'Show All', key: 'Ctrl+Alt+3', run: showAll },
    '-',
    { label: 'Path', sub: [
      { label: 'Join', key: 'Ctrl+J', enabled: hasSel, run: joinPaths },
      { label: 'Mirror & Join…', key: 'Ctrl+Alt+M', enabled: hasSel, run: openMirrorDialog },
      { label: 'Add Stitch Line…', enabled: hasSel, run: openStitchDialog },
      '-',
      { label: 'Simplify…', enabled: hasSel, run: openSimplifyDialog },
      { label: 'Smooth', enabled: hasSel, run: smoothPaths },
      { label: 'Offset Path…', enabled: hasSel, run: openOffsetDialog },
      { label: 'Outline Stroke', enabled: hasSel, run: outlineStroke },
      { label: 'Reverse Path Direction', enabled: hasSel, run: reversePaths },
      '-',
      { label: 'Convert Anchors to Corner', enabled: hasSel, run: () => convertSelectedAnchors('corner') },
      { label: 'Convert Anchors to Smooth', enabled: hasSel, run: () => convertSelectedAnchors('smooth') },
      { label: 'Cut Path at Selected Anchors', enabled: () => sel.pts.size > 0, run: cutAtSelectedAnchors },
    ] },
    { label: 'Pathfinder', sub: [
      { label: 'Unite', enabled: hasSel, run: () => pathfinder('unite') },
      { label: 'Minus Front', enabled: hasSel, run: () => pathfinder('minusFront') },
      { label: 'Intersect', enabled: hasSel, run: () => pathfinder('intersect') },
      { label: 'Exclude', enabled: hasSel, run: () => pathfinder('exclude') },
      { label: 'Divide', enabled: hasSel, run: () => pathfinder('divide') },
      { label: 'Minus Back', enabled: hasSel, run: () => pathfinder('minusBack') },
      '-',
      { label: 'Trim', enabled: hasSel, run: () => pathfinderExtra('trim') },
      { label: 'Merge', enabled: hasSel, run: () => pathfinderExtra('merge') },
      { label: 'Crop', enabled: hasSel, run: () => pathfinderExtra('crop') },
    ] },
    { label: 'Pattern', sub: [
      { label: 'Fill with Pattern…', enabled: hasSel, run: openPatternDialog },
      { label: 'Make Pattern from Selection', enabled: hasSel, run: makePatternSwatch },
      { label: 'Release Pattern Fill', enabled: () => selItems().some(it => it._data && it._data.pattern), run: releasePatternFill },
    ] },
    { label: 'Image Trace…', enabled: () => selItems().some(isRaster), run: openImageTrace },
    { label: 'Rasterize', enabled: hasSel, run: rasterizeSel },
    '-',
    { label: 'Clipping Mask', sub: [
      { label: 'Make', key: 'Ctrl+7', enabled: () => selItems().length > 1, run: makeClip },
      { label: 'Release', key: 'Ctrl+Alt+7', enabled: () => selItems().some(it => isGroup(it) && it.clipped), run: releaseClip },
    ] },
    { label: 'Compound Path', sub: [
      { label: 'Make', key: 'Ctrl+8', enabled: () => selItems().length > 1, run: makeCompound },
      { label: 'Release', key: 'Ctrl+Alt+Shift+8', enabled: () => selItems().some(isCompound), run: releaseCompound },
    ] },
    { label: 'Artboards', sub: [
      { label: 'Fit to Artwork Bounds', run: () => fitArtboardTo('all') },
      { label: 'Fit to Selected Art', enabled: hasSel, run: () => fitArtboardTo('sel') },
      { label: 'New Artboard', run: () => newArtboard() },
      { label: 'Delete Artboard', enabled: () => doc.artboards.length > 1, run: () => { doc.artboards.splice(doc.ab, 1); doc.ab = Math.max(0, doc.ab - 1); commit('Delete Artboard'); } },
    ] },
  ] },
  { label: 'Type', items: [
    { label: 'Type on a Path', key: 'Shift+T', run: () => setTool('typePath') },
    { label: 'Create Outlines', key: 'Ctrl+Shift+O', enabled: hasSel, run: createOutlines },
    '-',
    { label: 'Font', sub: () => FONTS.map(([n]) => ({ label: n, checked: () => fontName(currentTextProp('fontFamily', S.text.family)) === n, run: () => setTextProp('fontFamily', fontCSS(n)) })) },
    { label: 'Size', sub: () => [8, 10, 12, 14, 18, 24, 36, 48, 72, 96, 144, 200].map(s => ({ label: s + ' px', checked: () => currentTextProp('fontSize', S.text.size) === s, run: () => setTextProp('fontSize', s) })) },
    { label: 'Weight', sub: [['normal', 'Regular'], ['500', 'Medium'], ['bold', 'Bold'], ['900', 'Black']].map(([v, t]) => ({ label: t, checked: () => String(currentTextProp('fontWeight', S.text.weight)) === v, run: () => setTextProp('fontWeight', v) })) },
    { label: 'Paragraph', sub: [['left', 'Align Left'], ['center', 'Align Center'], ['right', 'Align Right']].map(([v, t]) => ({ label: t, checked: () => currentTextProp('justification', S.text.justification) === v, run: () => setTextProp('justification', v) })) },
    '-',
    { label: 'Change Case', sub: [
      { label: 'UPPERCASE', run: () => changeCase(s => s.toUpperCase()) },
      { label: 'lowercase', run: () => changeCase(s => s.toLowerCase()) },
      { label: 'Title Case', run: () => changeCase(s => s.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase())) },
    ] },
  ] },
  { label: 'Select', items: [
    { label: 'All', key: 'Ctrl+A', run: () => selectAll() },
    { label: 'All on Active Artboard', key: 'Ctrl+Alt+A', run: () => selectAll(true) },
    { label: 'Deselect', key: 'Ctrl+Shift+A', run: () => clearSelection() },
    { label: 'Inverse', run: selectInverse },
    '-',
    { label: 'Same', sub: [
      { label: 'Fill Color', enabled: hasSel, run: () => selectSame('fill') },
      { label: 'Stroke Color', enabled: hasSel, run: () => selectSame('stroke') },
      { label: 'Stroke Weight', enabled: hasSel, run: () => selectSame('weight') },
      { label: 'Fill & Stroke', enabled: hasSel, run: () => selectSame('fillstroke') },
      { label: 'Opacity', enabled: hasSel, run: () => selectSame('opacity') },
    ] },
  ] },
  { label: 'Effect', items: [
    { label: 'Drop Shadow…', enabled: hasSel, run: openShadowDialog },
    { label: 'Warp…', enabled: hasSel, run: openWarpDialog },
    { label: 'Image Trace…', enabled: () => selItems().some(isRaster), run: openImageTrace },
  ] },
  { label: 'View', items: [
    { label: () => S.view.outline ? 'Preview' : 'Outline', key: 'Ctrl+Y', run: () => toggleView('outline') },
    '-',
    { label: 'Zoom In', key: ['Ctrl+=', 'Ctrl+Shift+=!'], run: () => zoomStep(1) },
    { label: 'Zoom Out', key: 'Ctrl+-', run: () => zoomStep(-1) },
    { label: 'Fit Artboard in Window', key: 'Ctrl+0', run: () => fitArtboard() },
    { label: 'Fit All in Window', key: 'Ctrl+Alt+0', run: fitAll },
    { label: 'Actual Size', key: 'Ctrl+1', run: actualSize },
    '-',
    { label: 'Bounding Box', checked: () => S.view.bbox, key: 'Ctrl+Shift+B', run: () => toggleView('bbox') },
    { label: 'Rulers', checked: () => S.view.rulers, key: 'Ctrl+R', run: () => toggleView('rulers') },
    { label: 'Guides', sub: [
      { label: 'Show Guides', checked: () => S.view.guides, key: 'Ctrl+;', run: () => toggleView('guides') },
      { label: 'Lock Guides', checked: () => S.view.lockGuides, key: 'Ctrl+Alt+;', run: () => toggleView('lockGuides') },
      { label: 'Clear Guides', enabled: () => doc.guides.v.length + doc.guides.h.length > 0, run: () => { doc.guides = { v: [], h: [] }; commit('Clear Guides'); } },
    ] },
    { label: 'Smart Guides', checked: () => S.view.smart, key: 'Ctrl+U', run: () => toggleView('smart') },
    { label: 'Show Grid', checked: () => S.view.grid, key: "Ctrl+'", run: () => toggleView('grid') },
    { label: 'Snap to Grid', checked: () => S.view.snapGrid, key: "Ctrl+Shift+'", run: () => toggleView('snapGrid') },
    '-',
    { label: 'Interface', sub: [
      { label: 'Dark', checked: () => uiTheme() === 'dark', run: () => setTheme('dark') },
      { label: 'Light', checked: () => uiTheme() === 'light', run: () => setTheme('light') },
      { label: 'Match System', checked: () => uiTheme() === 'system', run: () => setTheme('system') },
    ] },
  ] },
  { label: 'Window', items: [
    { label: 'Properties', run: () => showDockTab('top', 'props') },
    { label: 'Swatches', run: () => showDockTab('top', 'swatches') },
    { label: 'Layers', key: 'F7', run: () => showDockTab('bottom', 'layers') },
    '-',
    { label: 'Hide / Show Panels', key: 'Tab', run: togglePanels },
  ] },
  { label: 'Help', items: [
    { label: 'Keyboard Shortcuts…', run: () => openShortcuts() },
    { label: 'About Nib…', run: openAbout },
  ] },
];
const menuStack = [];
function closeMenus() { while (menuStack.length) menuStack.pop().remove(); $$('.mtop.open').forEach(b => b.classList.remove('open')); }
function buildMenuEl(items, x, y, level = 0, alignRight) {
  while (menuStack.length > level) menuStack.pop().remove();
  const m = h('div', { class: 'menu', role: 'menu' });
  const list = typeof items === 'function' ? items() : items;
  let hlTimer = null;
  for (const it of list) {
    if (it === '-') { m.append(h('div', { class: 'sep' })); continue; }
    const dis = it.enabled ? !it.enabled() : false;
    const label = typeof it.label === 'function' ? it.label() : it.label;
    const row = h('div', { class: 'mi' + (dis ? ' dis' : ''), role: 'menuitem', 'aria-disabled': dis ? 'true' : null },
      it.checked && it.checked() ? h('span', { class: 'chk' }, '✓') : null,
      h('span', null, label),
      it.sub ? h('span', { class: 'sub' }, '›') : (it.key ? h('span', { class: 'k' }, keyLabel(it.key)) : null));
    row.addEventListener('pointerenter', () => {
      clearTimeout(hlTimer);
      $$('.mi.hl', m).forEach(r => r.classList.remove('hl'));
      if (it.sub) { row.classList.add('hl'); hlTimer = setTimeout(() => { const r = row.getBoundingClientRect(); buildMenuEl(it.sub, r.right - 2, r.top - 5, level + 1); }, 90); }
      else hlTimer = setTimeout(() => { while (menuStack.length > level + 1) menuStack.pop().remove(); }, 120);
    });
    if (it.sub) row.addEventListener('click', () => { const r = row.getBoundingClientRect(); buildMenuEl(it.sub, r.right - 2, r.top - 5, level + 1); });
    else row.addEventListener('click', () => { if (dis) return; closeFloating(); it.run && it.run(); });
    m.append(row);
  }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  let left = alignRight ? x - r.width : x, top = y;
  if (left + r.width > innerWidth - 4) left = level ? x - r.width - (r.width - 4) / r.width * 0 - (menuStack[level - 1] ? menuStack[level - 1].getBoundingClientRect().width : 0) + 4 : innerWidth - r.width - 4;
  if (left < 4) left = 4;
  if (top + r.height > innerHeight - 4) top = Math.max(4, innerHeight - r.height - 4);
  m.style.left = left + 'px'; m.style.top = top + 'px';
  menuStack.push(m);
  return m;
}
const menuFloat = { close: closeMenus };
function buildMenubar() {
  const nav = $('#menus');
  nav.innerHTML = '';
  MENUS.forEach(menu => {
    const b = h('button', { class: 'mtop', type: 'button', 'aria-haspopup': 'true' }, menu.label);
    const open = () => {
      closeFloating(menuFloat); closeMenus();
      b.classList.add('open');
      const r = b.getBoundingClientRect();
      buildMenuEl(menu.items, r.left, r.bottom, 0);
      floating.add(menuFloat);
    };
    b.addEventListener('pointerdown', e => { e.preventDefault(); if (b.classList.contains('open')) closeFloating(); else open(); });
    b.addEventListener('pointerenter', () => { if ($('.mtop.open') && !b.classList.contains('open')) open(); });
    nav.append(b);
  });
}
function openContextMenu(x, y) {
  closeFloating();
  const items = [
    { label: () => 'Undo' + (undoLabel() ? ' ' + undoLabel() : ''), key: 'Ctrl+Z', enabled: () => H.idx > 0, run: undo },
    { label: 'Redo', key: 'Ctrl+Shift+Z', enabled: () => H.idx < H.stack.length - 1, run: redo },
    '-',
    { label: 'Cut', key: 'Ctrl+X', enabled: hasSel, run: () => copySel(true) },
    { label: 'Copy', key: 'Ctrl+C', enabled: hasSel, run: () => copySel() },
    { label: 'Paste', key: 'Ctrl+V', enabled: () => !!clip, run: () => pasteClip('center') },
    '-',
    { label: 'Group', key: 'Ctrl+G', enabled: hasSel, run: groupSel },
    { label: 'Ungroup', key: 'Ctrl+Shift+G', enabled: () => selItems().some(isGroup), run: ungroupSel },
    { label: 'Make Clipping Mask', key: 'Ctrl+7', enabled: () => selItems().length > 1, run: makeClip },
    { label: 'Release Clipping Mask', enabled: () => selItems().some(it => isGroup(it) && it.clipped), run: releaseClip },
    { label: 'Make Compound Path', key: 'Ctrl+8', enabled: () => selItems().length > 1, run: makeCompound },
    '-',
    MENUS[2].items[0], MENUS[2].items[1],
    { label: 'Select', sub: MENUS[4].items },
    '-',
    { label: 'Lock Selection', enabled: hasSel, run: lockSel },
    { label: 'Hide Selection', enabled: hasSel, run: hideSel },
    { label: 'Delete', key: 'Delete', enabled: hasSel, run: deleteSelection },
  ];
  buildMenuEl(items, x, y, 0);
  floating.add(menuFloat);
}

/* ---------------- toolbar ---------------- */
let flyout = null;
function buildToolbar() {
  const tb = $('#toolbar');
  tb.innerHTML = '';
  TOOL_GROUPS.forEach((g, gi) => {
    if (g === '|') { tb.append(h('div', { class: 'tsep' })); return; }
    if (!groupCurrent[gi]) groupCurrent[gi] = g[0];
    const btn = h('button', { class: 'tool' + (g.length > 1 ? ' more' : ''), type: 'button', 'data-g': gi, 'aria-label': TOOLS[g[0]].name });
    let timer = null, flew = false;
    btn.addEventListener('pointerdown', e => {
      flew = false;
      if (g.length > 1 && e.button === 0) timer = setTimeout(() => { flew = true; openFlyout(gi, btn); }, 380);
    });
    btn.addEventListener('pointerup', () => clearTimeout(timer));
    btn.addEventListener('pointerleave', () => clearTimeout(timer));
    btn.addEventListener('click', e => {
      if (flew) return;
      if (e.altKey && g.length > 1) { const i = g.indexOf(groupCurrent[gi]); setTool(g[(i + 1) % g.length]); return; }
      setTool(groupCurrent[gi]);
    });
    btn.addEventListener('contextmenu', e => { e.preventDefault(); if (g.length > 1) openFlyout(gi, btn); });
    btn.addEventListener('dblclick', () => {
      const id = groupCurrent[gi];
      if (['rotate', 'reflect', 'scale'].includes(id)) openTransformDialog(id);
      else if (id === 'hand') fitArtboard();
      else if (id === 'zoom') actualSize();
      else if (id === 'polygon' || id === 'star' || id === 'rrect') showDockTab('top', 'props');
    });
    tb.append(btn);
  });
  // fill / stroke proxy
  const fs = h('div', { class: 'fs' });
  const fillB = h('button', { class: 'sw fill', type: 'button', title: 'Fill — click to edit (X switches fill/stroke)' });
  const strokeB = h('button', { class: 'sw stroke', type: 'button', title: 'Stroke — click to edit (X switches fill/stroke)' }, h('span', { class: 'hole' }));
  const swapB = h('button', { class: 'swap', type: 'button', title: 'Swap Fill and Stroke (Shift+X)', html: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M2 5V3.5A1.5 1.5 0 0 1 3.5 2H8M6.5.5 8 2 6.5 3.5M10 7v1.5A1.5 1.5 0 0 1 8.5 10H4M5.5 11.5 4 10l1.5-1.5"/></svg>' });
  const defB = h('button', { class: 'dflt', type: 'button', title: 'Default Fill and Stroke (D)', html: '<svg viewBox="0 0 12 12"><rect x="4.5" y="4.5" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="1" y="1" width="6" height="6" fill="#fff" stroke="currentColor"/></svg>' });
  const clickSw = kind => () => { if (S.style.focus !== kind) { S.style.focus = kind; updateToolbar(); } else openColorFor(kind, kind === 'fill' ? fillB : strokeB); };
  fillB.addEventListener('click', clickSw('fill'));
  strokeB.addEventListener('click', clickSw('stroke'));
  fillB.addEventListener('dblclick', () => openColorFor('fill', fillB));
  strokeB.addEventListener('dblclick', () => openColorFor('stroke', strokeB));
  swapB.addEventListener('click', swapFillStroke);
  defB.addEventListener('click', defaultFillStroke);
  fs.append(fillB, strokeB, swapB, defB);
  const pm = h('div', { class: 'paintmodes' });
  const mk = (mode, title) => { const b = h('button', { type: 'button', title, 'data-mode': mode }); b.addEventListener('click', () => paintMode(mode)); return b; };
  const bSolid = mk('solid', 'Color (,)'), bGrad = mk('gradient', 'Gradient (.)'), bNone = mk('none', 'None (/)');
  paintSwatch(bGrad, { type: 'linear', angle: 0, stops: [{ c: C(255, 255, 255, 1), o: 0 }, { c: C(0, 0, 0, 1), o: 1 }] });
  paintSwatch(bNone, null);
  pm.append(bSolid, bGrad, bNone);
  tb.append(h('div', { class: 'tsep' }), fs, pm);
  updateToolbar();
}
function updateToolbar() {
  $$('#toolbar .tool').forEach(btn => {
    const gi = +btn.dataset.g, g = TOOL_GROUPS[gi], cur = groupCurrent[gi] || g[0], t = TOOLS[cur];
    if (btn.dataset.cur !== cur) { btn.innerHTML = icon(t.icon || cur); btn.dataset.cur = cur; }
    btn.title = `${t.name}${t.key ? ' (' + keyLabel(t.key) + ')' : ''}${g.length > 1 ? ' — hold for more' : ''}`;
    btn.setAttribute('aria-label', t.name);
    btn.classList.toggle('on', g.includes(S.tool));
  });
  const fillB = $('#toolbar .sw.fill'), strokeB = $('#toolbar .sw.stroke');
  if (!fillB) return;
  const f = curPaint('fill'), s = curPaint('stroke');
  paintSwatch(fillB, f); paintSwatch(strokeB, s);
  fillB.classList.toggle('front', S.style.focus === 'fill'); strokeB.classList.toggle('front', S.style.focus === 'stroke');
  const p = curPaint(S.style.focus);
  const bSolid = $('#toolbar .paintmodes [data-mode=solid]');
  paintSwatch(bSolid, (p && p !== 'mixed' && p.type === 'solid') ? p : (S.style.lastSolid[S.style.focus] || solid('#000000')));
  $$('#toolbar .paintmodes button').forEach(b => b.classList.toggle('on', p !== 'mixed' && (b.dataset.mode === 'none' ? !p : b.dataset.mode === 'solid' ? p && p.type === 'solid' : p && p.type !== 'solid')));
}
function openFlyout(gi, btn) {
  closeFloating();
  const g = TOOL_GROUPS[gi];
  const el = h('div', { class: 'flyout', role: 'menu' });
  for (const id of g) {
    const t = TOOLS[id];
    const b = h('button', { type: 'button', role: 'menuitem', html: icon(t.icon || id) }, h('span', null, t.name), t.key ? h('span', { class: 'k' }, keyLabel(t.key)) : null);
    b.addEventListener('click', () => { closeFloating(); setTool(id); });
    el.append(b);
  }
  document.body.append(el);
  const r = btn.getBoundingClientRect();
  el.style.left = (r.right + 4) + 'px';
  el.style.top = Math.min(r.top, innerHeight - el.getBoundingClientRect().height - 6) + 'px';
  const fl = { close: () => el.remove() };
  floating.add(fl);
}

/* ---------------- color popover ---------------- */
function openColorFor(kind, anchor) {
  const cur = curPaint(kind);
  const targets = styleTargets();
  let changed = false;
  openColorPopover(anchor, {
    title: kind === 'fill' ? 'Fill' : 'Stroke',
    paint: cur === 'mixed' ? clonePaint(S.style.lastSolid[kind]) : clonePaint(cur),
    onChange(p, final) {
      if (!final) { changed = true; applyPaint(kind, p, targets, { live: true, keepGeometry: true }); updateToolbar(); return; }
      if (changed) { if (targets.length) { styleTargets(); commit(kind === 'fill' ? 'Fill' : 'Stroke'); } else emit('selection'); }
    },
  });
}
function openColorPopover(anchor, opts) {
  closeFloating();
  let paint = clonePaint(opts.paint);
  let stopIdx = 0;
  let hsv = { h: 0, s: 0, v: 0 };
  const el = h('div', { class: 'pop', role: 'dialog', 'aria-label': (opts.title || 'Color') + ' color' });
  const typeSeg = h('div', { class: 'seg' });
  const types = [['none', 'None'], ['solid', 'Solid'], ['linear', 'Linear'], ['radial', 'Radial']];
  types.forEach(([v, t]) => {
    const b = h('button', { type: 'button', 'data-t': v }, t);
    b.addEventListener('click', () => {
      if (v === 'none') paint = null;
      else if (v === 'solid') paint = paint && paint.type === 'solid' ? paint : { type: 'solid', c: paint && paint.stops ? { ...paint.stops[0].c } : (S.style.lastSolid.fill ? { ...S.style.lastSolid.fill.c } : C(0, 0, 0, 1)) };
      else if (!paint || paint.type === 'solid') { const prev = paint; paint = clonePaint(S.style.lastGradient); paint.type = v; if (prev && prev.type === 'solid') paint.stops[0].c = { ...prev.c }; }
      else paint.type = v;
      stopIdx = 0; loadHSV(); render(); emitChange();
    });
    typeSeg.append(b);
  });
  const closeBtn = h('button', { class: 'icon-btn', type: 'button', title: 'Close', html: icon('close') });
  const gradWrap = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } });
  const gbar = h('div', { class: 'gbar checker', title: 'Click to add a color stop' });
  const gstops = h('div', { class: 'gstops' });
  const angF = numField({ label: '∠', value: 0, unit: '°', cls: 'w84', title: 'Gradient angle', onCommit: v => { if (paint && paint.type === 'linear') { paint.angle = norm180(-v); render(); emitChange(); } } });
  const locF = numField({ label: 'Loc', value: 0, unit: '%', cls: 'w84', min: 0, max: 100, title: 'Stop location', onCommit: v => { if (paint && paint.stops) { paint.stops[stopIdx].o = v / 100; render(); emitChange(); } } });
  const revB = h('button', { class: 'btn small', type: 'button', title: 'Reverse gradient' }, 'Reverse');
  revB.addEventListener('click', () => { paint.stops = paint.stops.map(s => ({ c: s.c, o: 1 - s.o })).reverse(); render(); emitChange(); });
  const delB = h('button', { class: 'btn small', type: 'button', title: 'Delete selected stop' }, 'Delete stop');
  delB.addEventListener('click', () => { if (paint.stops.length > 2) { paint.stops.splice(stopIdx, 1); stopIdx = 0; loadHSV(); render(); emitChange(); } });
  gradWrap.append(gbar, gstops, h('div', { class: 'row' }, angF.el, locF.el), h('div', { class: 'row' }, revB, delB));
  const svBox = h('div', { class: 'sv' });
  const svCv = h('canvas', { width: 232, height: 150 });
  const svKnob = h('div', { class: 'knob' });
  svBox.append(svCv, svKnob);
  const hue = h('div', { class: 'slider hue' }), hueKnob = h('div', { class: 'knob' }); hue.append(hueKnob);
  const alpha = h('div', { class: 'slider checker' }), alphaFill = h('div', { style: { position: 'absolute', inset: '0', borderRadius: '6px' } }), alphaKnob = h('div', { class: 'knob' }); alpha.append(alphaFill, alphaKnob);
  const hexF = h('input', { class: 'txt', value: '', 'aria-label': 'Hex color', spellcheck: 'false', style: { width: '100%', fontFamily: 'var(--font-num)' } });
  const mkC = (lab, max) => numField({ label: lab, value: 0, decimals: 0, min: 0, max, onCommit: () => fromFields() });
  const rF = mkC('R', 255), gF = mkC('G', 255), bF = mkC('B', 255), aF = mkC('A', 100);
  const fields = h('div', { class: 'cfields' }, hexF, rF.el, gF.el, bF.el, aF.el);
  const swRow = h('div', { class: 'cpsw' });
  const colorWrap = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, svBox, hue, alpha, fields);
  el.append(h('div', { class: 'pop-h' }, h('span', null, opts.title || 'Color'), closeBtn), typeSeg, gradWrap, colorWrap, h('div', { class: 'cap' }, 'Swatches'), swRow);
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  let left = r.right + 8, top = r.top - 10;
  const pr = el.getBoundingClientRect();
  if (left + pr.width > innerWidth - 6) left = Math.max(6, r.left - pr.width - 8);
  if (top + pr.height > innerHeight - 6) top = Math.max(6, innerHeight - pr.height - 6);
  el.style.left = left + 'px'; el.style.top = top + 'px';

  const curColor = () => !paint ? null : paint.type === 'solid' ? paint.c : paint.stops[stopIdx].c;
  function loadHSV() { const c = curColor(); if (c) { const n = rgbToHsv(c); if (n.s > 0 && n.v > 0) hsv.h = n.h; hsv.s = n.s; hsv.v = n.v; } }
  function setCur(c) { if (!paint) return; if (paint.type === 'solid') paint.c = c; else paint.stops[stopIdx].c = c; }
  function fromHSV() { const c = curColor(); if (!c) return; const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v); setCur({ ...rgb, a: c.a }); render(); emitChange(); }
  function fromFields() { const c = curColor(); if (!c) return; setCur(C(rF.get() || 0, gF.get() || 0, bF.get() || 0, clamp((aF.get() ?? 100) / 100, 0, 1))); loadHSV(); render(); emitChange(); }
  hexF.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') hexF.blur(); });
  hexF.addEventListener('change', () => { const c = parseHex(hexF.value); const cur = curColor(); if (c && cur) { if (hexF.value.replace('#', '').length <= 6) c.a = cur.a; setCur(c); loadHSV(); render(); emitChange(); } else render(); });
  function drawSV() {
    const ctx = svCv.getContext('2d'), w = svCv.width, hh = svCv.height;
    const base = hsvToRgb(hsv.h, 1, 1);
    ctx.fillStyle = `rgb(${base.r},${base.g},${base.b})`; ctx.fillRect(0, 0, w, hh);
    const g1 = ctx.createLinearGradient(0, 0, w, 0); g1.addColorStop(0, '#fff'); g1.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g1; ctx.fillRect(0, 0, w, hh);
    const g2 = ctx.createLinearGradient(0, 0, 0, hh); g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(1, '#000');
    ctx.fillStyle = g2; ctx.fillRect(0, 0, w, hh);
  }
  function render() {
    $$('button', typeSeg).forEach(b => b.classList.toggle('on', b.dataset.t === (paint ? paint.type : 'none')));
    const isG = paint && paint.type !== 'solid';
    gradWrap.hidden = !isG;
    colorWrap.hidden = !paint;
    if (isG) {
      const sorted = paint.stops.map((s, i) => ({ ...s, i })).sort((a, b) => a.o - b.o);
      gbar.style.backgroundImage = `linear-gradient(90deg, ${sorted.map(s => cssColor(s.c) + ' ' + (s.o * 100) + '%').join(', ')}), conic-gradient(#ccc 25%, #fff 0 50%, #ccc 0 75%, #fff 0)`;
      gbar.style.backgroundSize = 'auto, 8px 8px';
      gstops.innerHTML = '';
      paint.stops.forEach((s, i) => {
        const m = h('div', { class: 'gstop' + (i === stopIdx ? ' on' : ''), style: { left: (s.o * 100) + '%', background: cssColor(s.c) }, title: 'Drag to move, drag down to remove' });
        m.addEventListener('pointerdown', e => {
          e.preventDefault(); stopIdx = i; loadHSV(); render();
          const bar = gbar.getBoundingClientRect();
          m.setPointerCapture(e.pointerId);
          const mv = ev => {
            const o = clamp((ev.clientX - bar.left) / bar.width, 0, 1);
            paint.stops[i].o = +o.toFixed(4);
            m.style.left = (o * 100) + '%';
            m.style.opacity = ev.clientY - bar.bottom > 34 && paint.stops.length > 2 ? '0.3' : '1';
            locF.set(o * 100);
            gbar.style.backgroundImage = `linear-gradient(90deg, ${paint.stops.slice().sort((a, b) => a.o - b.o).map(s => cssColor(s.c) + ' ' + (s.o * 100) + '%').join(', ')}), conic-gradient(#ccc 25%, #fff 0 50%, #ccc 0 75%, #fff 0)`;
            emitChange();
          };
          const up = ev => {
            m.removeEventListener('pointermove', mv); m.removeEventListener('pointerup', up);
            if (ev.clientY - bar.bottom > 34 && paint.stops.length > 2) { paint.stops.splice(i, 1); stopIdx = 0; loadHSV(); }
            render(); emitChange();
          };
          m.addEventListener('pointermove', mv); m.addEventListener('pointerup', up);
        });
        gstops.append(m);
      });
      angF.set(paint.type === 'linear' ? norm180(-paint.angle) : 0);
      angF.el.style.display = paint.type === 'linear' ? '' : 'none';
      locF.set(paint.stops[stopIdx].o * 100);
      delB.disabled = paint.stops.length <= 2;
    }
    const c = curColor();
    if (c) {
      drawSV();
      svKnob.style.left = (hsv.s * 100) + '%'; svKnob.style.top = ((1 - hsv.v) * 100) + '%';
      hueKnob.style.left = (hsv.h / 360 * 100) + '%';
      alphaKnob.style.left = (c.a * 100) + '%';
      alphaFill.style.background = `linear-gradient(90deg, rgba(${c.r},${c.g},${c.b},0), rgb(${c.r},${c.g},${c.b}))`;
      if (document.activeElement !== hexF) hexF.value = toHex(c);
      rF.set(c.r); gF.set(c.g); bF.set(c.b); aF.set(Math.round(c.a * 100));
    }
    swRow.innerHTML = '';
    doc.swatches.slice(0, 30).forEach(sw => {
      const b = h('button', { type: 'button', title: paintLabel(sw) });
      paintSwatch(b, sw);
      b.addEventListener('click', () => {
        if (!sw) { paint = null; }
        else if (sw.type !== 'solid') { paint = clonePaint(sw); stopIdx = 0; }
        else if (!paint) paint = clonePaint(sw);
        else setCur({ ...sw.c });
        loadHSV(); render(); emitChange();
      });
      swRow.append(b);
    });
  }
  function drag(elm, fn) {
    elm.addEventListener('pointerdown', e => {
      e.preventDefault(); elm.setPointerCapture(e.pointerId);
      const box = elm.getBoundingClientRect();
      const go = ev => fn(clamp((ev.clientX - box.left) / box.width, 0, 1), clamp((ev.clientY - box.top) / box.height, 0, 1));
      go(e);
      const up = () => { elm.removeEventListener('pointermove', go); elm.removeEventListener('pointerup', up); };
      elm.addEventListener('pointermove', go); elm.addEventListener('pointerup', up);
    });
  }
  drag(svBox, (x, y) => { hsv.s = x; hsv.v = 1 - y; fromHSV(); });
  drag(hue, x => { hsv.h = x * 360; fromHSV(); });
  drag(alpha, x => { const c = curColor(); if (c) { setCur({ ...c, a: +x.toFixed(3) }); render(); emitChange(); } });
  gbar.addEventListener('pointerdown', e => {
    if (!paint || !paint.stops) return;
    const bar = gbar.getBoundingClientRect(), o = clamp((e.clientX - bar.left) / bar.width, 0, 1);
    paint.stops.push({ c: colorAtStops(paint.stops, o), o: +o.toFixed(4) });
    stopIdx = paint.stops.length - 1; loadHSV(); render(); emitChange();
  });
  let raf = 0;
  function emitChange() { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => opts.onChange(clonePaint(paint), false)); }
  const close = () => { cancelAnimationFrame(raf); el.remove(); floating.delete(handle); opts.onChange(clonePaint(paint), true); };
  const handle = { close: () => { cancelAnimationFrame(raf); el.remove(); opts.onChange(clonePaint(paint), true); } };
  closeBtn.addEventListener('click', close);
  el.addEventListener('keydown', e => { if (e.key === 'Escape') close(); e.stopPropagation(); });
  floating.add(handle);
  loadHSV(); render();
}

/* ---------------- control bar ---------------- */
function swatchButton(kind, paint) {
  const b = h('button', { class: 'swbtn' + (kind === 'stroke' ? ' strokeish' : ''), type: 'button', title: (kind === 'fill' ? 'Fill: ' : 'Stroke: ') + paintLabel(paint) });
  paintSwatch(b, paint);
  b.addEventListener('click', () => { S.style.focus = kind; updateToolbar(); openColorFor(kind, b); });
  return b;
}
function selectionKindLabel() {
  const items = selItems();
  if (S.tool === 'artboard') return 'Artboard';
  if (!items.length) return 'No Selection';
  if (sel.pts.size && TOOLS[S.tool].display === 'anchors') {
    const n = [...sel.pts.values()].reduce((a, s) => a + s.size, 0);
    if (n && items.every(it => sel.pts.has(it))) return n === 1 ? 'Anchor Point' : `${n} Anchor Points`;
  }
  if (items.length === 1) return kindName(items[0]);
  return `${items.length} Objects`;
}
function buildControlBar() {
  const cb = $('#controlbar');
  if (cb.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') { cb.dataset.stale = '1'; return; }
  cb.innerHTML = '';
  const items = selItems();
  cb.append(h('span', { class: 'kind' }, selectionKindLabel()));
  if (S.tool === 'artboard') {
    const ab = activeAB();
    cb.append(h('div', { class: 'grp' }, h('span', { class: 'lbl' }, 'Name'), Object.assign(h('input', { class: 'txt', value: ab.name, id: 'cbAbName', style: { width: '140px' } }), { onchange: e => { ab.name = e.target.value || ab.name; commit('Rename Artboard'); }, onkeydown: e => e.stopPropagation() })));
    cb.append(h('div', { class: 'vsep' }), artboardFields(ab, 'cb'));
    cb.append(h('div', { class: 'spacer' }), h('label', { class: 'chk' }, Object.assign(h('input', { type: 'checkbox', checked: S.moveArt }), { onchange: e => { S.moveArt = e.target.checked; } }), 'Move art with artboard'));
    return;
  }
  const f = curPaint('fill'), s = curPaint('stroke');
  cb.append(h('div', { class: 'grp' }, h('span', { class: 'lbl' }, 'Fill'), swatchButton('fill', f)));
  const sw = S.selStyle ? S.selStyle.strokeWidth : S.style.strokeWidth;
  cb.append(h('div', { class: 'grp' }, h('span', { class: 'lbl' }, 'Stroke'), swatchButton('stroke', s),
    numField({ value: sw === 'mixed' ? null : sw, mixed: sw === 'mixed', unit: strokeUnit(), cls: 'w72', min: 0, step: 1, title: 'Stroke weight', id: 'cbStrokeW', onCommit: v => setStrokeProp('strokeWidth', v, 'Stroke Weight') }).el));
  if (items.length) {
    const op = S.selStyle ? S.selStyle.opacity : 100;
    cb.append(h('div', { class: 'vsep' }), h('div', { class: 'grp' }, h('span', { class: 'lbl' }, 'Opacity'),
      numField({ value: op === 'mixed' ? null : op, mixed: op === 'mixed', unit: '%', cls: 'w72', min: 0, max: 100, decimals: 0, id: 'cbOpacity', title: 'Opacity', onCommit: setOpacity }).el));
  }
  const texts = items.filter(isText);
  if (texts.length || S.tool === 'type') {
    cb.append(h('div', { class: 'vsep' }), h('div', { class: 'grp' }, fontSelect('cbFont'),
      numField({ value: currentTextProp('fontSize', S.text.size), unit: strokeUnit(), cls: 'w72', min: 1, id: 'cbFontSize', title: 'Font size', onCommit: v => setTextProp('fontSize', v) }).el));
  }
  if (TOOLS[S.tool].display === 'anchors' && sel.pts.size) {
    const bt = (ic, title, fn) => { const b = h('button', { class: 'icon-btn', type: 'button', title, html: icon(ic) }); b.addEventListener('click', fn); return b; };
    cb.append(h('div', { class: 'vsep' }), h('div', { class: 'grp' }, h('span', { class: 'lbl' }, 'Convert'),
      bt('corner', 'Convert selected anchors to corner', () => convertSelectedAnchors('corner')),
      bt('smooth', 'Convert selected anchors to smooth', () => convertSelectedAnchors('smooth')),
      bt('cut', 'Cut path at selected anchors', cutAtSelectedAnchors)));
  }
  if (['polygon', 'star', 'rrect'].includes(S.tool)) {
    const g = h('div', { class: 'grp' });
    if (S.tool === 'polygon') g.append(h('span', { class: 'lbl' }, 'Sides'), numField({ value: S.shape.sides, decimals: 0, min: 3, max: 100, cls: 'w60', id: 'cbSides', onCommit: v => { S.shape.sides = Math.round(v); } }).el);
    if (S.tool === 'star') g.append(h('span', { class: 'lbl' }, 'Points'), numField({ value: S.shape.points, decimals: 0, min: 3, max: 100, cls: 'w60', id: 'cbPoints', onCommit: v => { S.shape.points = Math.round(v); } }).el,
      h('span', { class: 'lbl' }, 'Inner'), numField({ value: S.shape.ratio * 100, decimals: 0, min: 1, max: 100, unit: '%', cls: 'w72', id: 'cbRatio', onCommit: v => { S.shape.ratio = v / 100; } }).el);
    if (S.tool === 'rrect') g.append(h('span', { class: 'lbl' }, 'Radius'), numField({ value: toU(S.shape.radius), min: 0, unit: unitKey(), decimals: UD().dec, cls: 'w72', id: 'cbRadius', onCommit: v => { S.shape.radius = fromU(v); } }).el);
    cb.append(h('div', { class: 'vsep' }), g, h('span', { class: 'hint' }, '↑/↓ while dragging'));
  }
  cb.append(h('div', { class: 'spacer' }));
  if (items.length) {
    cb.append(alignButtons(), h('div', { class: 'vsep' }), transformFields('cb', true));
  }
}
function fontSelect(id) {
  const cur = fontName(currentTextProp('fontFamily', S.text.family));
  const s = h('select', { class: 'sel', id, title: 'Font family', style: { width: '150px' } }, FONTS.map(([n]) => h('option', { value: n, selected: n === cur }, n)));
  if (!FONTS.some(f => f[0] === cur)) s.prepend(h('option', { value: cur, selected: true }, cur || 'Mixed'));
  s.addEventListener('change', () => setTextProp('fontFamily', fontCSS(s.value)));
  s.addEventListener('keydown', e => e.stopPropagation());
  return s;
}
function currentTextProp(prop, dflt) {
  const t = selItems().flatMap(it => isText(it) ? [it] : (isGroup(it) && !isPathText(it) ? it.getItems({ class: paper.PointText }) : []));
  if (!t.length) return dflt;
  const v = commonValue(t, x => x[prop]);
  return v === 'mixed' ? dflt : v;
}
// Rejects values that would break text layout (non-numeric sizes, unknown weights, …) no matter where they come from.
function cleanTextValue(prop, val) {
  switch (prop) {
    case 'fontSize': case 'size': { const n = +val; return isFinite(n) && n > 0 ? Math.min(n, 5000) : undefined; }
    case 'leading': { if (val == null) return null; const n = +val; return isFinite(n) && n >= 0 ? n : undefined; }
    case 'spacing': case 'shift': { const n = +val; return isFinite(n) ? n : undefined; }
    case 'offset': { const n = +val; return isFinite(n) ? clamp(n, 0, 1) : undefined; }
    case 'fontWeight': case 'weight': return /^(italic\s+)?(normal|bold|lighter|bolder|[1-9]00)$/.test(String(val)) ? String(val) : undefined;
    case 'justification': return ['left', 'center', 'right'].includes(val) ? val : undefined;
    case 'fontFamily': case 'family': return typeof val === 'string' && val.trim() ? val : undefined;
    case 'fill': { const c = parseHex(val); return c ? toHex(c) : undefined; }
    case 'content': return val == null ? '' : String(val);
  }
  return val;
}
function setTextProp(prop, val) {
  val = cleanTextValue(prop, val);
  if (val === undefined) return;
  const map = { fontFamily: 'family', fontSize: 'size', fontWeight: 'weight', justification: 'justification' };
  if (map[prop]) S.text[map[prop]] = val;
  const t = selItems().flatMap(it => isText(it) ? [it] : (isGroup(it) && !isPathText(it) ? it.getItems({ class: paper.PointText }) : []));
  if (prop === 'fontFamily') ensureFont(val);
  if (!t.length) { emit('selection'); return; }
  t.forEach(x => {
    if (prop === 'justification') {
      const b0 = x.bounds;
      x.justification = val;
      const b1 = x.bounds;
      x.translate(P(b0.left - b1.left, 0));
    } else x[prop] = val;
  });
  if (S.editingText) layoutTextEditor();
  commit('Character');
}
function changeCase(fn) {
  const t = selItems().filter(isText);
  if (!t.length) return toast('Select a text object first.');
  t.forEach(x => x.content = fn(x.content));
  commit('Change Case');
}
function ensureFont(css) {
  const n = fontName(css);
  if (!document.fonts || !n) return;
  document.fonts.load(`16px "${n}"`).then(() => { refreshTexts(); }).catch(() => {});
}
function refreshTexts() {
  for (const L of project.layers) for (const t of L.getItems({ class: paper.PointText })) t.content = t.content;
  invalidateFrame(); requestDraw();
}
function alignButtons() {
  const wrap = h('div', { class: 'iconrow' });
  for (const [k, ic, t] of [['L', 'alL', 'Align left'], ['CH', 'alCH', 'Align horizontal centers'], ['R', 'alR', 'Align right'], ['T', 'alT', 'Align top'], ['CV', 'alCV', 'Align vertical centers'], ['B', 'alB', 'Align bottom']]) {
    const b = h('button', { class: 'icon-btn', type: 'button', title: t + (selItems().length === 1 || S.alignTo === 'artboard' ? ' (to artboard)' : ''), html: icon(ic) });
    b.addEventListener('click', () => alignSel(k));
    wrap.append(b);
  }
  return wrap;
}
function transformFields(prefix, compact) {
  const fr = getFrame();
  const g = h('div', { class: compact ? 'grp' : 'grid2' });
  if (!fr) return g;
  const ab = activeAB(), ref = refPoint(fr);
  const dec = UD().dec, step = unitKey() === 'in' ? 0.125 : unitKey() === 'cm' ? 0.1 : 1;
  const mk = (key, label, val, extra = {}) => numField({ label, value: toU(val), decimals: dec, step, cls: compact ? 'w84' : '', id: prefix + key, title: `${extra.title || label} (${unitKey()})`, onCommit: v => setFrameValue(key, fromU(v)), ...extra });
  g.append(mk('x', 'X', ref.p.x - ab.x).el, mk('y', 'Y', ref.p.y - ab.y).el, mk('w', 'W', fr.rect.width, { min: 0.0001 }).el, mk('h', 'H', fr.rect.height, { min: 0.0001 }).el);
  return g;
}
function artboardFields(ab, prefix) {
  const g = h('div', { class: prefix === 'cb' ? 'grp' : 'grid2' });
  const set = (k, v) => { v = fromU(v); ab[k] = k === 'w' || k === 'h' ? Math.max(1, v) : v; commit('Artboard'); requestDraw(); };
  const cls = prefix === 'cb' ? 'w84' : '', decimals = UD().dec;
  g.append(
    numField({ label: 'X', value: toU(ab.x), decimals, cls, id: prefix + 'abx', title: `X (${unitKey()})`, onCommit: v => set('x', v) }).el,
    numField({ label: 'Y', value: toU(ab.y), decimals, cls, id: prefix + 'aby', title: `Y (${unitKey()})`, onCommit: v => set('y', v) }).el,
    numField({ label: 'W', value: toU(ab.w), decimals, cls, min: 0.001, id: prefix + 'abw', title: `Width (${unitKey()})`, onCommit: v => set('w', v) }).el,
    numField({ label: 'H', value: toU(ab.h), decimals, cls, min: 0.001, id: prefix + 'abh', title: `Height (${unitKey()})`, onCommit: v => set('h', v) }).el,
  );
  return g;
}

/* ---------------- dock ---------------- */
const DOCK = { top: lsGet('nib.dock.top', 'props'), bottom: 'layers' };
const DOCK_TABS = { top: [['props', 'Properties'], ['swatches', 'Swatches']], bottom: [['layers', 'Layers']] };
const collapsedSecs = new Set(lsGet('nib.secs', []));
function buildDockTabs() {
  for (const where of ['top', 'bottom']) {
    const bar = $(where === 'top' ? '#dockTabsTop' : '#dockTabsBottom');
    bar.innerHTML = '';
    for (const [id, label] of DOCK_TABS[where]) {
      const b = h('button', { class: 'dtab' + (DOCK[where] === id ? ' on' : ''), type: 'button' }, label);
      b.addEventListener('click', () => showDockTab(where, id));
      bar.append(b);
    }
  }
}
function showDockTab(where, id) {
  DOCK[where] = id; if (where === 'top') lsSet('nib.dock.top', id);
  if ($('#app').classList.contains('hide-panels')) togglePanels();
  if (innerWidth <= 760) $('#app').classList.add('show-dock-mobile');
  buildDockTabs(); renderDock(true);
}
let dockStale = false;
function renderDock(force, layers = true) {
  const top = $('#dockBodyTop');
  const busy = top.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  if (busy && !force) dockStale = true;
  else {
    dockStale = false;
    const st = top.scrollTop;
    top.innerHTML = '';
    if (DOCK.top === 'props') top.append(...buildProperties());
    else top.append(...buildSwatches());
    top.scrollTop = st;
  }
  if (layers) renderLayers(); else updateLayerSelection();
}
document.addEventListener('focusout', () => setTimeout(() => {
  if (dockStale && !$('#dockBodyTop').contains(document.activeElement)) renderDock();
  const cb = $('#controlbar'); if (cb.dataset.stale && !cb.contains(document.activeElement)) { delete cb.dataset.stale; buildControlBar(); }
}, 0));
function section(id, title, ...content) {
  const s = h('div', { class: 'sec' + (collapsedSecs.has(id) ? ' closed' : '') });
  const hd = h('div', { class: 'sec-h', role: 'button', tabindex: '0', 'aria-expanded': String(!collapsedSecs.has(id)), html: icon('chevDown', 'chev') }, title);
  const toggle = () => { s.classList.toggle('closed'); collapsedSecs[s.classList.contains('closed') ? 'add' : 'delete'](id); lsSet('nib.secs', [...collapsedSecs]); hd.setAttribute('aria-expanded', String(!s.classList.contains('closed'))); };
  hd.addEventListener('click', toggle);
  hd.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  s.append(hd, h('div', { class: 'sec-b' }, ...content));
  return s;
}
function segButtons(opts, cur, onPick) {
  const seg = h('div', { class: 'seg' });
  for (const [v, ic, title] of opts) {
    const b = h('button', { type: 'button', class: v === cur ? 'on' : '', title, html: ic.startsWith('<') ? ic : icon(ic) });
    b.addEventListener('click', () => onPick(v));
    seg.append(b);
  }
  return seg;
}
function iconButton(ic, title, fn, on) { const b = h('button', { class: 'icon-btn' + (on ? ' on' : ''), type: 'button', title, 'aria-label': title, html: icon(ic) }); b.addEventListener('click', fn); return b; }
function buildProperties() {
  const items = selItems();
  const out = [];
  if (S.tool === 'artboard') {
    const ab = activeAB();
    const name = h('input', { class: 'txt grow', value: ab.name, id: 'pAbName' });
    name.addEventListener('change', () => { ab.name = name.value || ab.name; commit('Rename Artboard'); });
    name.addEventListener('keydown', e => e.stopPropagation());
    const presets = h('select', { class: 'sel grow', id: 'pAbPreset' }, h('option', { value: '' }, 'Preset…'), PRESETS.map((p, i) => h('option', { value: i }, `${p.name} — ${p.w}×${p.h}`)));
    presets.addEventListener('change', () => { const p = PRESETS[+presets.value]; if (p) { ab.w = p.w; ab.h = p.h; commit('Artboard Preset'); } });
    out.push(section('ab', 'Artboard', h('div', { class: 'row' }, name), artboardFields(ab, 'p'), h('div', { class: 'row' }, presets),
      h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: () => { [ab.w, ab.h] = [ab.h, ab.w]; commit('Orientation'); } }, 'Swap orientation'),
        h('button', { class: 'btn small', type: 'button', onclick: () => newArtboard(), }, 'New artboard'),
        h('button', { class: 'btn small', type: 'button', disabled: doc.artboards.length < 2, onclick: () => { doc.artboards.splice(doc.ab, 1); doc.ab = Math.max(0, doc.ab - 1); commit('Delete Artboard'); } }, 'Delete')),
      h('p', { class: 'hint' }, 'Drag on the pasteboard to draw a new artboard. Drag an artboard to move it with its artwork. Press Enter or Esc to finish.')));
    return out;
  }
  if (!items.length) {
    const ab = activeAB();
    const abSel = h('select', { class: 'sel grow', id: 'pAbSel' }, doc.artboards.map((a, i) => h('option', { value: i, selected: i === doc.ab }, `${i + 1} - ${a.name}`)));
    abSel.addEventListener('change', () => { doc.ab = +abSel.value; fitArtboard(); emit('doc'); });
    out.push(section('doc', 'Document',
      h('div', { class: 'row' }, h('span', { class: 'cap' }, 'Artboard'), abSel),
      h('div', { class: 'grid2' }, h('div', { class: 'cap num' }, `W ${fmtU(ab.w)}`), h('div', { class: 'cap num' }, `H ${fmtU(ab.h)}`)),
      h('div', { class: 'row' }, h('span', { class: 'cap' }, 'Units'), unitsSelect()),
      h('div', { class: 'row', style: { flexWrap: 'wrap' } }, h('button', { class: 'btn small', type: 'button', onclick: () => setTool('artboard') }, 'Edit Artboards'), h('button', { class: 'btn small', type: 'button', onclick: openDocSetup }, 'Document Setup…'), h('button', { class: 'btn small', type: 'button', onclick: () => showHome() }, 'Start screen')),
    ));
    const chk = (label, key) => h('label', { class: 'chk' }, Object.assign(h('input', { type: 'checkbox', checked: !!S.view[key], id: 'pv' + key }), { onchange: () => toggleView(key) }), label);
    out.push(section('rulers', 'Rulers & Grids', h('div', { class: 'grid2' }, chk('Rulers', 'rulers'), chk('Grid', 'grid'), chk('Guides', 'guides'), chk('Snap to grid', 'snapGrid'))));
    out.push(section('guidesSec', 'Smart Guides', chk('Snap to objects and show alignment guides', 'smart')));
    out.push(section('tips', 'Quick start', h('p', { class: 'hint' }, 'V selects, A edits points, P draws with the pen, M and L draw rectangles and ellipses, T adds text. Hold Space to pan, Ctrl+scroll to zoom. Drag from a ruler to add a guide.')));
    return out;
  }
  // Transform
  const fr = getFrame();
  if (fr) {
    const rp = h('div', { class: 'refpt', title: 'Reference point' });
    for (let i = 0; i < 9; i++) { const b = h('button', { type: 'button', class: i === S.refPt ? 'on' : '', 'aria-label': 'Reference point ' + (i + 1) }); b.addEventListener('click', () => { S.refPt = i; renderDock(true); buildControlBar(); }); rp.append(b); }
    const link = iconButton('link', 'Constrain width and height proportions', () => { S.lockRatio = !S.lockRatio; renderDock(true); }, S.lockRatio);
    const ang = numField({ label: '∠', value: norm180(-fr.angle), unit: '°', decimals: 2, id: 'pAngle', title: 'Rotation angle', onCommit: v => setFrameValue('angle', v) });
    out.push(section('xf', 'Transform',
      h('div', { class: 'row' }, rp, h('div', { class: 'grow' }, transformFields('p')), link),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, ang.el), iconButton('flipH', 'Flip horizontal', () => flipSel('h')), iconButton('flipV', 'Flip vertical', () => flipSel('v')))));
  }
  // Rectangle (live corners)
  const lives = items.filter(it => it._data && it._data.live);
  if (lives.length && lives.length === items.length) {
    const r = commonValue(lives, it => +(it._data.live.r || 0).toFixed(2));
    const ls = liveSize(lives[0]);
    out.push(section('rect', 'Rectangle',
      lives.length === 1 ? h('div', { class: 'grid2' }, h('div', { class: 'cap num' }, `W ${fmtU(ls.w)}`), h('div', { class: 'cap num' }, `H ${fmtU(ls.h)}`)) : null,
      h('div', { class: 'row' }, h('span', { class: 'cap' }, 'Corner radius'), numField({ value: r === 'mixed' ? null : toU(r), mixed: r === 'mixed', unit: unitKey(), decimals: UD().dec, min: 0, cls: 'grow', id: 'pRadius', onCommit: v => setCornerRadius(fromU(v)) }).el)));
  }
  // Appearance
  const f = curPaint('fill'), s = curPaint('stroke');
  const sw = S.selStyle ? S.selStyle.strokeWidth : S.style.strokeWidth;
  const op = S.selStyle ? S.selStyle.opacity : 100;
  const blend = commonValue(items, it => it.blendMode);
  const blendSel = h('select', { class: 'sel grow', id: 'pBlend', title: 'Blend mode' }, ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'].map(m => h('option', { value: m, selected: m === blend }, m.replace(/(^|-)(\w)/g, (a, b, c) => (b ? ' ' : '') + c.toUpperCase()))));
  if (blend === 'mixed') blendSel.prepend(h('option', { value: '', selected: true }, 'Mixed'));
  blendSel.addEventListener('change', () => blendSel.value && setBlend(blendSel.value));
  const hexInput = (kind, p) => {
    const inp = h('input', { class: 'txt grow', value: paintLabel(p), id: 'pHex' + kind, spellcheck: 'false', 'aria-label': kind + ' color', readonly: !(p && p.type === 'solid') || p === 'mixed' });
    inp.style.fontFamily = 'var(--font-num)';
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); });
    inp.addEventListener('change', () => { const c = parseHex(inp.value); if (c) applyPaint(kind, { type: 'solid', c }); else inp.value = paintLabel(p); });
    return inp;
  };
  out.push(section('app', 'Appearance',
    h('div', { class: 'row' }, swatchButton('fill', f), h('span', { class: 'cap', style: { width: '40px' } }, 'Fill'), hexInput('fill', f)),
    h('div', { class: 'row' }, swatchButton('stroke', s), h('span', { class: 'cap', style: { width: '40px' } }, 'Stroke'), hexInput('stroke', s)),
    h('div', { class: 'grid2' },
      numField({ label: 'Wt', value: sw === 'mixed' ? null : sw, mixed: sw === 'mixed', unit: strokeUnit(), min: 0, id: 'pStrokeW', title: 'Stroke weight', onCommit: v => setStrokeProp('strokeWidth', v, 'Stroke Weight') }).el,
      numField({ label: 'Op', value: op === 'mixed' ? null : op, mixed: op === 'mixed', unit: '%', min: 0, max: 100, decimals: 0, id: 'pOpacity', title: 'Opacity', onCommit: setOpacity }).el),
    h('div', { class: 'row' }, h('span', { class: 'cap' }, 'Blend'), blendSel)));
  // Stroke options
  const t = styleTargets().filter(x => !isText(x) && !isRaster(x));
  if (t.length) {
    const cap = commonValue(t, x => x.strokeCap), join = commonValue(t, x => x.strokeJoin);
    const dash = commonValue(t, x => (x.dashArray || []).map(v => +v.toFixed(2)));
    const dashed = Array.isArray(dash) && dash.length > 0;
    const dVal = dashed ? dash[0] : 12, gVal = dashed ? (dash[1] != null ? dash[1] : dash[0]) : 6;
    const setDash = (d, g) => setStrokeProp('dashArray', [d, g], 'Dashes');
    const dashChk = h('input', { type: 'checkbox', checked: dashed, id: 'pDashed' });
    dashChk.addEventListener('change', () => setStrokeProp('dashArray', dashChk.checked ? [dVal, gVal] : [], 'Dashes'));
    out.push(section('stroke', 'Stroke',
      h('div', { class: 'row' }, h('span', { class: 'cap', style: { width: '44px' } }, 'Cap'), segButtons([['butt', 'capButt', 'Butt cap'], ['round', 'capRound', 'Round cap'], ['square', 'capSquare', 'Projecting cap']], cap, v => setStrokeProp('strokeCap', v, 'Stroke Cap'))),
      h('div', { class: 'row' }, h('span', { class: 'cap', style: { width: '44px' } }, 'Corner'), segButtons([['miter', 'joinMiter', 'Miter join'], ['round', 'joinRound', 'Round join'], ['bevel', 'joinBevel', 'Bevel join']], join, v => setStrokeProp('strokeJoin', v, 'Stroke Join'))),
      h('div', { class: 'row' }, h('label', { class: 'chk', for: 'pDashed' }, dashChk, 'Dashed line'), dashPresetSelect()),
      dashed ? h('div', { class: 'grid2' },
        numField({ label: 'Dash', value: dVal, min: 0, id: 'pDash', onCommit: v => setDash(v, gVal) }).el,
        numField({ label: 'Gap', value: gVal, min: 0, id: 'pGap', onCommit: v => setDash(dVal, v) }).el) : null));
  }
  // Type on a path
  if (items.length === 1 && isPathText(items[0])) out.push(pathTextSection(items[0]));
  // Pattern fill
  if (items.length === 1 && items[0]._data && items[0]._data.pattern) {
    const sp = items[0]._data.pattern;
    out.push(section('pat', 'Pattern Fill', h('p', { class: 'hint' }, `${(PATTERN_KINDS.find(k => k[0] === sp.kind) || [0, 'Your pattern'])[1]} · repeat ${fmtU(sp.size)}`),
      h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: openPatternDialog }, 'Edit pattern…'), h('button', { class: 'btn small', type: 'button', onclick: releasePatternFill }, 'Release'))));
  }
  // Image
  if (items.some(isRaster)) out.push(section('img', 'Image', h('div', { class: 'row', style: { flexWrap: 'wrap' } }, h('button', { class: 'btn small', type: 'button', onclick: openImageTrace }, 'Image Trace…'))));
  // Character
  const texts = items.flatMap(it => isText(it) ? [it] : (isGroup(it) && !isPathText(it) ? it.getItems({ class: paper.PointText }) : []));
  if (texts.length) {
    const w = String(currentTextProp('fontWeight', 'normal'));
    const wSel = h('select', { class: 'sel grow', id: 'pWeight' }, [['normal', 'Regular'], ['300', 'Light'], ['500', 'Medium'], ['bold', 'Bold'], ['900', 'Black']].map(([v, tx]) => h('option', { value: v, selected: v === w || (v === 'bold' && w === '700') }, tx)));
    wSel.addEventListener('change', () => setTextProp('fontWeight', wSel.value));
    const just = currentTextProp('justification', 'left');
    const lead = currentTextProp('leading', null);
    out.push(section('char', 'Character',
      h('div', { class: 'row' }, fontSelect('pFont')),
      h('div', { class: 'row' }, wSel),
      h('div', { class: 'grid2' },
        numField({ label: 'Size', value: currentTextProp('fontSize', S.text.size), unit: strokeUnit(), min: 1, id: 'pFontSize', onCommit: v => setTextProp('fontSize', v) }).el,
        numField({ label: 'Lead', value: lead || currentTextProp('fontSize', 12) * 1.2, unit: strokeUnit(), min: 0, id: 'pLeading', title: 'Leading', onCommit: v => setTextProp('leading', v) }).el),
      h('div', { class: 'row' }, h('span', { class: 'cap', style: { width: '44px' } }, 'Align'), segButtons([['left', 'txL', 'Align left'], ['center', 'txC', 'Align center'], ['right', 'txR', 'Align right']], just, v => setTextProp('justification', v)))));
  }
  // Align
  out.push(section('align', 'Align',
    alignButtons(),
    h('div', { class: 'iconrow' },
      iconButton('diH', 'Distribute horizontal centers', () => distributeSel('H')), iconButton('diV', 'Distribute vertical centers', () => distributeSel('V')),
      iconButton('spH', 'Distribute horizontal spacing', () => distributeSel('SH')), iconButton('spV', 'Distribute vertical spacing', () => distributeSel('SV'))),
    h('div', { class: 'row' }, h('span', { class: 'cap' }, 'Align to'), segButtons([['selection', '<span>Selection</span>', 'Align to selection'], ['artboard', '<span>Artboard</span>', 'Align to artboard']], S.alignTo, v => { S.alignTo = v; renderDock(true); }))));
  // Pathfinder
  if (items.length > 1) {
    out.push(section('pf', 'Pathfinder', h('div', { class: 'iconrow' },
      iconButton('pfUnite', 'Unite', () => pathfinder('unite')), iconButton('pfMinus', 'Minus Front', () => pathfinder('minusFront')),
      iconButton('pfIntersect', 'Intersect', () => pathfinder('intersect')), iconButton('pfExclude', 'Exclude', () => pathfinder('exclude')),
      iconButton('pfDivide', 'Divide', () => pathfinder('divide')), iconButton('pfMinusBack', 'Minus Back', () => pathfinder('minusBack')))));
  }
  // Quick actions
  const qa = h('div', { class: 'row', style: { flexWrap: 'wrap' } });
  const btn = (label, fn, dis) => h('button', { class: 'btn small', type: 'button', disabled: !!dis, onclick: fn }, label);
  if (items.length > 1) qa.append(btn('Group', groupSel));
  if (items.some(isGroup)) qa.append(btn('Ungroup', ungroupSel));
  if (items.length > 1) qa.append(btn('Make Clipping Mask', makeClip));
  if (items.some(it => isGroup(it) && it.clipped)) qa.append(btn('Release Mask', releaseClip));
  if (items.filter(isPathLike).length > 1) qa.append(btn('Compound Path', makeCompound));
  if (items.some(it => (it._data && it._data.angle))) qa.append(btn('Reset Bounding Box', resetBBox));
  if (items.some(isPathLike)) qa.append(btn('Simplify…', openSimplifyDialog), btn('Offset…', openOffsetDialog), btn('Mirror & Join…', openMirrorDialog), btn('Stitch line…', openStitchDialog), btn('Pattern fill…', openPatternDialog));
  if (items.some(it => isText(it) || isPathText(it))) qa.append(btn('Create Outlines', createOutlines));
  qa.append(btn('Warp…', openWarpDialog), btn('Drop shadow…', openShadowDialog));
  qa.append(btn('Lock', lockSel), btn('Hide', hideSel));
  const arr = h('div', { class: 'iconrow' }, iconButton('front', 'Bring to front', () => arrange('front')), iconButton('back', 'Send to back', () => arrange('back')),
    h('button', { class: 'btn small', type: 'button', title: 'Bring forward', onclick: () => arrange('forward') }, 'Forward'), h('button', { class: 'btn small', type: 'button', title: 'Send backward', onclick: () => arrange('backward') }, 'Backward'));
  out.push(section('qa', 'Quick Actions', arr, qa));
  return out;
}
function buildSwatches() {
  const grid = h('div', { class: 'swgrid' });
  doc.swatches.forEach((sw, i) => {
    const b = h('button', { type: 'button', title: paintLabel(sw) + ' — Alt+click to delete' });
    paintSwatch(b, sw);
    b.addEventListener('click', e => {
      if (e.altKey && sw) { doc.swatches.splice(i, 1); scheduleAutosave(); renderDock(true); return; }
      applyPaint(S.style.focus, clonePaint(sw));
    });
    grid.append(b);
  });
  const add = h('button', { class: 'btn small', type: 'button', title: 'Add the current ' + S.style.focus + ' as a swatch' }, '+ New swatch');
  add.addEventListener('click', () => { const p = curPaint(S.style.focus); if (p === 'mixed' || p === undefined) return; doc.swatches.push(clonePaint(p)); scheduleAutosave(); renderDock(true); });
  const fromSel = h('button', { class: 'btn small', type: 'button', title: 'Add every color used in the selection' }, 'Add used colors');
  fromSel.addEventListener('click', () => {
    const seen = new Set(doc.swatches.map(x => JSON.stringify(x)));
    for (const t of styleTargets().length ? styleTargets() : project.layers.flatMap(L => leafItems(L).map(styleTarget))) for (const pc of [t.fillColor, t.strokeColor]) { const p = paintFromPaper(pc); const k = JSON.stringify(p); if (p && !seen.has(k)) { seen.add(k); doc.swatches.push(p); } }
    scheduleAutosave(); renderDock(true);
  });
  return [section('sw', 'Swatches', h('p', { class: 'hint' }, `Click to apply to the ${S.style.focus}. Press X to switch between fill and stroke.`), grid, h('div', { class: 'row' }, add, fromSel))];
}

/* ---------------- layers panel ---------------- */
const expanded = new WeakSet(), collapsedLayers = new WeakSet();
let renamePending = null;
let dragItem = null;
const ROW_CAP = 250;
const rowCaps = new WeakMap();
let layerRows = new Map();
function firstLeaf(it) {
  let n = 0;
  while (it && it.children && it.children.length && !isText(it) && n++ < 50) it = it.clipped && it.children[1] ? it.children[1] : it.firstChild;
  return it;
}
function selectionAncestors(selSet) {
  const anc = new Set();
  for (const s of selSet) for (let p = s.parent; p; p = p.parent) { if (anc.has(p)) break; anc.add(p); }
  return anc;
}
function renderLayers() {
  const body = $('#dockBodyBottom');
  if (renamePending) return;
  const st = body.scrollTop;
  body.innerHTML = '';
  layerRows = new Map();
  const list = h('div', { class: 'lyr-list', role: 'tree' });
  const selSet = new Set(selItems());
  const anc = selectionAncestors(selSet);
  const active = activeLayer();
  const addRow = (it, depth) => {
    const L = isLayer(it);
    const kids = (L || isGroup(it) || isCompound(it)) ? it.children : null;
    const open = L ? !collapsedLayers.has(it) : expanded.has(it);
    const row = h('div', { class: 'lrow' + (L ? ' layer' : '') + (L && it === active ? ' active' : ''), role: 'treeitem', draggable: 'true' });
    const eye = h('button', { class: 'tg' + (it.visible ? '' : ' off'), type: 'button', title: it.visible ? 'Hide' : 'Show', html: icon(it.visible ? 'eye' : 'eyeOff') });
    eye.addEventListener('click', e => { e.stopPropagation(); it.visible = !it.visible; if (!it.visible) { for (const s of [...sel.items]) if (s === it || it.isAncestor(s)) sel.items.delete(s); selectionChanged(); } commit(it.visible ? 'Show' : 'Hide'); });
    const lock = h('button', { class: 'tg' + (it.locked ? '' : ' off'), type: 'button', title: it.locked ? 'Unlock' : 'Lock', html: icon(it.locked ? 'lock' : 'unlock') });
    lock.addEventListener('click', e => { e.stopPropagation(); it.locked = !it.locked; if (it.locked) { for (const s of [...sel.items]) if (s === it || it.isAncestor(s)) sel.items.delete(s); selectionChanged(); } commit(it.locked ? 'Lock' : 'Unlock'); });
    const tw = h('button', { class: 'tw' + (open ? ' open' : ''), type: 'button', title: open ? 'Collapse' : 'Expand', html: kids && kids.length ? icon('chev') : '', style: { marginLeft: (depth * 12) + 'px' } });
    tw.addEventListener('click', e => { e.stopPropagation(); if (L) { collapsedLayers.has(it) ? collapsedLayers.delete(it) : collapsedLayers.add(it); } else { expanded.has(it) ? expanded.delete(it) : expanded.add(it); } renderLayers(); });
    row.append(eye, lock, tw);
    if (L) row.append(h('span', { class: 'chip', style: { background: it.data.color || LAYER_COLORS[0] } }));
    else {
      const th = h('span', { class: 'thumb' });
      const tgt = styleTarget(firstLeaf(it) || it);
      paintSwatch(th, isRaster(tgt) ? solid('#9a9aa2') : paintFromPaper(tgt.fillColor) || paintFromPaper(tgt.strokeColor));
      row.append(th);
    }
    const nm = h('span', { class: 'nm', title: displayName(it) }, displayName(it));
    row.append(nm);
    const dot = h('i');
    row.append(h('span', { class: 'tgt' }, dot));
    paintLayerDot(it, dot, selSet, anc);
    layerRows.set(it, { row, dot });
    row.addEventListener('click', e => {
      if (L) { it.activate(); if (e.shiftKey || e.altKey) { selectAllInLayer(it); } emit('doc'); return; }
      if (!isEditable(it)) return toastQuiet('Unlock or show this object to select it');
      if (e.shiftKey || e.ctrlKey || e.metaKey) toggleInSelection(it); else setSelection([it]);
      if (it.layer && it.layer !== activeLayer()) { it.layer.activate(); updateLayerSelection(); }
    });
    nm.addEventListener('dblclick', e => { e.stopPropagation(); startRename(it, nm); });
    row.addEventListener('dragstart', e => { dragItem = it; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', 'nib-layer-item'); } catch {} });
    row.addEventListener('dragend', () => { dragItem = null; $$('.lrow', list).forEach(r => r.classList.remove('drop-above', 'drop-below', 'drop-into')); });
    const zone = e => {
      const r = row.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
      if (!dragItem) return null;
      if (isLayer(dragItem)) return L ? (y < 0.5 ? 'above' : 'below') : null;
      if (it === dragItem || dragItem.isAncestor(it)) return null;
      const container = L || (isGroup(it) && !it.clipped && !isPathText(it));
      if (container && y > 0.28 && y < 0.72) return 'into';
      if (L) return 'into';
      return y < 0.5 ? 'above' : 'below';
    };
    row.addEventListener('dragover', e => {
      const z = zone(e);
      row.classList.remove('drop-above', 'drop-below', 'drop-into');
      if (!z) return;
      e.preventDefault();
      row.classList.add('drop-' + z);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-above', 'drop-below', 'drop-into'));
    row.addEventListener('drop', e => {
      const z = zone(e);
      row.classList.remove('drop-above', 'drop-below', 'drop-into');
      if (!z || !dragItem) return;
      e.preventDefault();
      const moving = (!isLayer(dragItem) && sel.items.has(dragItem)) ? selItems().filter(x => x !== it && !x.isAncestor(it)) : [dragItem];
      if (z === 'into') { moving.forEach(m => it.addChild(m)); if (L) it.activate(); else expanded.add(it); }
      else if (z === 'above') { moving.forEach(m => m.insertAbove(it)); }
      else { [...moving].reverse().forEach(m => m.insertBelow(it)); }
      dragItem = null;
      commit(isLayer(it) && moving.every(isLayer) ? 'Reorder Layers' : 'Reorder');
    });
    list.append(row);
    if (open && kids && kids.length) {
      const cap = rowCaps.get(it) || ROW_CAP;
      const n = kids.length;
      for (let i = n - 1; i >= Math.max(0, n - cap); i--) addRow(kids[i], depth + 1);
      if (n > cap) {
        const more = h('button', { class: 'lmore', type: 'button', style: { marginLeft: ((depth + 1) * 12 + 50) + 'px' } }, `Show ${Math.min(500, n - cap)} more of ${n - cap} hidden objects`);
        more.addEventListener('click', () => { rowCaps.set(it, cap + 500); renderLayers(); });
        list.append(more);
      }
    }
  };
  [...project.layers].reverse().forEach(L => addRow(L, 0));
  const foot = h('div', { class: 'lfoot' },
    h('span', { class: 'cnt' }, `${project.layers.length} Layer${project.layers.length === 1 ? '' : 's'}`),
    iconButton('newLayer', 'Create new layer', () => { newLayer(null, activeLayer()); commit('New Layer'); }),
    iconButton('trash', 'Delete selection, or the active layer when nothing is selected', () => {
      if (selItems().length) return deleteSelection();
      if (project.layers.length < 2) return toast('A document needs at least one layer.');
      const L = activeLayer(); const i = L.index; L.remove(); (project.layers[Math.max(0, i - 1)]).activate(); commit('Delete Layer');
    }));
  body.append(list, foot);
  body.scrollTop = st;
}
function paintLayerDot(it, dot, selSet, anc) {
  const selected = selSet.has(it), within = !selected && anc.has(it);
  dot.className = selected ? 'sel' : '';
  dot.style.background = selected ? layerColor(it) : '';
  dot.style.borderColor = within ? layerColor(it) : '';
}
// Selection-only changes just repaint the target dots instead of rebuilding every row.
function updateLayerSelection() {
  if (renamePending) return;
  const selSet = new Set(selItems()), anc = selectionAncestors(selSet), active = activeLayer();
  for (const [it, r] of layerRows) {
    paintLayerDot(it, r.dot, selSet, anc);
    if (isLayer(it)) r.row.classList.toggle('active', it === active);
  }
}
function selectAllInLayer(L) { setSelection(L.children.filter(c => c.visible && !c.locked)); }
function startRename(it, nm) {
  renamePending = it;
  const inp = h('input', { value: it.name || (isLayer(it) ? '' : ''), placeholder: displayName(it), 'aria-label': 'Name' });
  nm.innerHTML = ''; nm.append(inp); inp.focus(); inp.select();
  const done = save => {
    if (renamePending !== it) return;
    renamePending = null;
    if (save) { it.name = inp.value.trim() || null; if (isLayer(it) && !it.name) it.name = 'Layer'; commit('Rename'); }
    else renderLayers();
  };
  inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
  inp.addEventListener('blur', () => done(true));
}

/* ---------------- status bar, tab, theme ---------------- */
function buildStatusBar() {
  const sb = $('#statusbar');
  sb.innerHTML = '';
  const zIn = h('input', { id: 'zoomIn', value: '100%', 'aria-label': 'Zoom level' });
  zIn.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { const v = safeEval(zIn.value); if (v > 0) zoomAt(P(VW / 2, VH / 2), v / 100); zIn.blur(); } });
  zIn.addEventListener('focus', () => zIn.select());
  const zSel = h('select', { id: 'zoomSel', 'aria-label': 'Zoom presets' }, h('option', { value: '' }, '▾'), ['Fit Artboard', 'Fit All', ...[0.25, 0.5, 0.6667, 1, 1.5, 2, 3, 4, 8].map(z => Math.round(z * 100) + '%')].map(t => h('option', { value: t }, t)));
  zSel.addEventListener('change', () => { const v = zSel.value; if (v === 'Fit Artboard') fitArtboard(); else if (v === 'Fit All') fitAll(); else if (v) zoomAt(P(VW / 2, VH / 2), parseFloat(v) / 100); zSel.value = ''; });
  const abSel = h('select', { id: 'abNav', 'aria-label': 'Artboard' });
  abSel.addEventListener('change', () => { doc.ab = +abSel.value; fitArtboard(); emit('doc'); });
  const prev = h('button', { class: 'icon-btn', type: 'button', title: 'Previous artboard', style: { width: '18px', height: '18px' }, html: '<svg viewBox="0 0 10 10" width="10" height="10"><path d="M6.5 2 3.5 5l3 3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>' });
  const next = h('button', { class: 'icon-btn', type: 'button', title: 'Next artboard', style: { width: '18px', height: '18px' }, html: '<svg viewBox="0 0 10 10" width="10" height="10"><path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>' });
  prev.addEventListener('click', () => { doc.ab = (doc.ab - 1 + doc.artboards.length) % doc.artboards.length; fitArtboard(); emit('doc'); });
  next.addEventListener('click', () => { doc.ab = (doc.ab + 1) % doc.artboards.length; fitArtboard(); emit('doc'); });
  sb.append(h('div', { class: 'zoom' }, zIn, zSel), h('div', { class: 'zoom' }, prev, abSel, next),
    h('span', { class: 'toolname', id: 'sbTool' }), h('span', { class: 'grow', id: 'sbInfo' }), h('span', { class: 'xy', id: 'sbXY' }), h('span', { id: 'sbSave' }));
}
function updateStatus() {
  const abSel = $('#abNav');
  if (abSel) { abSel.innerHTML = ''; doc.artboards.forEach((a, i) => abSel.append(h('option', { value: i, selected: i === doc.ab }, `${i + 1} ${a.name}`))); }
  const t = TOOLS[S.tool];
  $('#sbTool').textContent = t ? t.name : '';
  const items = selItems();
  let info = '';
  if (S.isolated) info = 'Isolation mode: ' + displayName(S.isolated) + ' — Esc to exit · ';
  if (items.length === 1) {
    const it = items[0];
    const n = leafPaths(it).reduce((a, p) => a + p.segments.length, 0);
    info += `${kindName(it)}${n ? ` · ${n} anchor${n === 1 ? '' : 's'}` : ''} · ${it.layer ? it.layer.name : ''}`;
  } else if (items.length) info += `${items.length} objects selected`;
  else info += `${project.layers.reduce((a, L) => a + L.children.length, 0)} objects · ${project.layers.length} layer${project.layers.length === 1 ? '' : 's'}`;
  $('#sbInfo').textContent = info;
  $('#sbSave').textContent = S.dirty ? (S.autosaved ? 'Autosaved draft' : 'Unsaved changes') : (doc.libId ? 'Saved' : '');
  updateDocTab();
}
function updateStatusXY(pt) {
  const ab = activeAB();
  const el = $('#sbXY');
  if (el) el.textContent = `X ${fmtU(pt.x - ab.x)}  Y ${fmtU(pt.y - ab.y)}`;
}
function updateZoomUI() {
  const z = $('#zoomIn');
  if (z && document.activeElement !== z) z.value = fmt(zoom() * 100, zoom() < 0.1 ? 2 : 1) + '%';
  updateDocTab();
}
function updateDocTab() {
  const tab = $('#docTab');
  if (!tab) return;
  tab.innerHTML = '';
  tab.append(h('span', null, doc.name + '.nib'), h('span', { class: 'meta' }, ` @ ${fmt(zoom() * 100, 1)}% (RGB/${S.view.outline ? 'Outline' : 'Preview'})`));
  if (S.dirty) tab.append(h('span', { class: 'dirty', title: 'Unsaved changes' }, ' ●'));
  tab.title = 'Double-click to rename the document';
}
$('#docTab').addEventListener('dblclick', () => renameDocDialog());
function renameDocDialog() {
  const f = fText('Name', doc.name);
  openDialog({ title: 'Rename Document', body: [f.el], buttons: [{ label: 'Cancel' }, { label: 'Rename', primary: true, onClick: () => { doc.name = f.get().trim() || doc.name; S.dirty = true; updateStatus(); scheduleAutosave(); } }] });
}
function uiTheme() { return lsGet('nib.theme', 'dark'); }
function setTheme(t) {
  lsSet('nib.theme', t);
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  $('#btnTheme').innerHTML = icon(effectiveTheme() === 'dark' ? 'moon' : 'sun');
  setTimeout(readTheme, 0);
}
function effectiveTheme() { const t = uiTheme(); return t === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t; }
function togglePanels() {
  if (innerWidth <= 760) { $('#app').classList.toggle('show-dock-mobile'); }
  else $('#app').classList.toggle('hide-panels');
  setTimeout(resizeCanvases, 0);
}
function toggleView(key) {
  S.view[key] = !S.view[key];
  lsSet('nib.view', S.view);
  if (key === 'rulers') { $('#stage').classList.toggle('rulers', S.view.rulers); setTimeout(resizeCanvases, 0); }
  if (key === 'outline') $('#cvPaper').style.visibility = S.view.outline ? 'hidden' : 'visible';
  emit('selection');
  requestDraw();
}

/* ---------------- dialogs: help & about ---------------- */
function openShortcuts() {
  const rows = [h('h4', null, 'Tools')];
  for (const id in TOOLS) { const t = TOOLS[id]; if (t.key) rows.push(h('span', null, t.name), h('kbd', null, keyLabel(t.key))); }
  rows.push(h('h4', null, 'Navigation & modifiers'));
  [['Pan', 'Space + drag'], ['Zoom at cursor', 'Ctrl + scroll'], ['Temporary Selection tool', 'Hold Ctrl'], ['Constrain angle / proportions', 'Shift while dragging'], ['From center / duplicate on drag', 'Alt while dragging'], ['Nudge (×10 with Shift)', 'Arrow keys'], ['Switch fill / stroke', 'X'], ['Swap fill and stroke', 'Shift+X'], ['Default fill and stroke', 'D'], ['None / Color / Gradient', '/   ,   .'], ['Hide panels', 'Tab'], ['Finish path or exit', 'Esc / Enter']]
    .forEach(([a, b]) => rows.push(h('span', null, a), h('kbd', null, b)));
  const walk = (items, prefix) => { for (const it of (typeof items === 'function' ? items() : items)) { if (it === '-') continue; const lab = typeof it.label === 'function' ? it.label() : it.label; if (it.sub) walk(it.sub, lab + ' › '); else if (it.key) rows.push(h('span', null, prefix + lab), h('kbd', null, keyLabel(it.key))); } };
  for (const m of MENUS) { rows.push(h('h4', null, m.label)); walk(m.items, ''); }
  openDialog({ title: 'Keyboard Shortcuts', wide: true, body: [h('p', { class: 'hint' }, 'Your browser keeps a few shortcuts for itself (such as Ctrl+N and Ctrl+1–8 in some browsers). Every command is also in the menus.'), h('div', { class: 'kbd-table' }, rows)], buttons: [{ label: 'Close', primary: true }] });
}
function openAbout() {
  openDialog({ title: 'About Nib Vector Studio', body: [
    h('p', null, 'Nib is a personal vector illustration studio that runs in your browser: pen and shape tools, layers, gradients, pathfinder, artboards, smart guides, and SVG / PNG export.'),
    h('p', { class: 'hint' }, 'Vector geometry is powered by Paper.js (MIT license). Documents save to your library inside this page when it is available, and you can always download a .json copy or export SVG.'),
  ], buttons: [{ label: 'Close', primary: true }] });
}

function unitsSelect() {
  const s2 = h('select', { class: 'sel grow', id: 'pUnits', title: 'Measurement units' }, Object.keys(UNIT_DEFS).map(k => h('option', { value: k, selected: k === unitKey() }, UNIT_DEFS[k].name)));
  s2.addEventListener('change', () => { doc.units = s2.value; S.dirty = true; scheduleAutosave(); emit('doc'); requestDraw(); });
  return s2;
}
function dashPresetSelect() {
  const s2 = h('select', { class: 'sel grow', id: 'pDashPreset', title: 'Stroke style presets (stitches, dots, dashes)' }, h('option', { value: '' }, 'Stitch & dash presets…'), DASH_PRESETS.map(([k, label]) => h('option', { value: k }, label)));
  s2.addEventListener('change', () => { if (s2.value) applyDashPreset(s2.value); });
  return s2;
}
function pathTextSection(g) {
  const tp = g._data.textPath;
  const ta = h('textarea', { class: 'txt', id: 'pPathText', rows: '2', spellcheck: 'false', 'aria-label': 'Text on the path' });
  ta.value = tp.content;
  ta.addEventListener('keydown', e => e.stopPropagation());
  ta.addEventListener('input', debounce(() => { g._data.textPath.content = ta.value; layoutPathText(g); requestDraw(); }, 120));
  ta.addEventListener('change', () => { g._data.textPath.content = ta.value; layoutPathText(g); commit('Edit Text'); });
  const fsel = h('select', { class: 'sel grow', id: 'pPathFont' }, FONTS.map(([n]) => h('option', { value: n, selected: n === fontName(tp.family) }, n)));
  fsel.addEventListener('change', () => setPathTextProp('family', fontCSS(fsel.value), 'Font'));
  const wsel = h('select', { class: 'sel', id: 'pPathWeight' }, [['normal', 'Regular'], ['500', 'Medium'], ['bold', 'Bold'], ['900', 'Black']].map(([v, t]) => h('option', { value: v, selected: v === String(tp.weight) }, t)));
  wsel.addEventListener('change', () => setPathTextProp('weight', wsel.value, 'Font Weight'));
  const offset = h('input', { type: 'range', min: '0', max: '100', step: '0.5', value: String(tp.offset * 100), id: 'pPathOffset', style: { width: '100%' } });
  offset.addEventListener('input', () => { g._data.textPath.offset = +offset.value / 100; layoutPathText(g); requestDraw(); });
  offset.addEventListener('change', () => commit('Move Text Along Path'));
  const guide = pathTextGuide(g);
  const showPath = h('input', { type: 'checkbox', id: 'pPathShow', checked: !!(guide && guide.strokeColor) });
  showPath.addEventListener('change', () => { const p = pathTextGuide(g); if (p) { p.strokeColor = showPath.checked ? paperColor(C(0, 0, 0, 1)) : null; p.strokeWidth = 1; } commit('Path Visibility'); });
  const color = h('input', { class: 'txt', id: 'pPathColor', value: tp.fill, 'aria-label': 'Text color', spellcheck: 'false' });
  color.addEventListener('keydown', e => e.stopPropagation());
  color.addEventListener('change', () => { const c = parseHex(color.value); if (c) setPathTextProp('fill', toHex(c), 'Text Color'); });
  return section('ptext', 'Type on a Path', ta,
    h('div', { class: 'row' }, fsel, wsel),
    h('div', { class: 'grid2' },
      numField({ label: 'Size', value: tp.size, unit: strokeUnit(), min: 1, id: 'pPathSize', onCommit: v => setPathTextProp('size', v, 'Font Size') }).el,
      numField({ label: 'Track', value: tp.spacing || 0, step: 0.5, id: 'pPathTrack', title: 'Letter spacing', onCommit: v => setPathTextProp('spacing', v, 'Tracking') }).el,
      numField({ label: 'Shift', value: tp.shift || 0, step: 0.5, id: 'pPathShift', title: 'Baseline shift', onCommit: v => setPathTextProp('shift', v, 'Baseline Shift') }).el,
      color),
    h('label', { class: 'f', for: 'pPathOffset', style: { display: 'grid', gridTemplateColumns: '64px 1fr', alignItems: 'center', gap: '6px' } }, h('span', { class: 'cap' }, 'Position'), offset),
    h('div', { class: 'row', style: { flexWrap: 'wrap' } },
      h('button', { class: 'btn small', type: 'button', onclick: () => { const p = pathTextGuide(g); if (p) { p.reverse(); layoutPathText(g); commit('Flip Text'); } } }, 'Flip side'),
      h('label', { class: 'chk', for: 'pPathShow' }, showPath, 'Show path'),
      h('button', { class: 'btn small', type: 'button', onclick: createOutlines }, 'Create Outlines')),
    h('p', { class: 'hint' }, 'Edit the path itself with the Direct Selection tool (A); the text follows it.'));
}
