/* ============================================================
   Start screen: new-file presets & templates, recent projects, open files
   ============================================================ */
const homeEl = h('div', { id: 'home', class: 'home', hidden: true, role: 'dialog', 'aria-label': 'Start screen' });
document.body.append(homeEl);
const homeVisible = () => !homeEl.hidden;
let homeQuery = '';
function showHome() { closeFloating(); if (dialogOpen && !dialogOpen.locked) dialogOpen.close(); if (S.editingText) commitTextEdit(); homeEl.hidden = false; renderHome(); }
function hideHome() { if (homeEl.hidden) return; homeEl.hidden = true; requestDraw(); resizeCanvases(); }
function relTime(t) {
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return 'yesterday';
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
const TEE_ICON = '<svg viewBox="-160 -10 320 300" aria-hidden="true"><path d="M0 30C22 30 34 16 40 0L100 16L150 86L126 104C116 100 104 88 96 76L100 276L0 278L-100 276L-96 76C-104 88-116 100-126 104L-150 86L-100 16L-40 0C-34 16-22 30 0 30Z" fill="#fff" stroke="#24252a" stroke-width="7" stroke-linejoin="round"/><path d="M-97 262H97" stroke="#24252a" stroke-width="4" stroke-dasharray="12 9"/></svg>';
function presetThumb(p) {
  const box = 92, k = Math.min(box / p.w, box / p.h);
  const w = Math.max(10, p.w * k), hh = Math.max(10, p.h * k);
  const page = h('div', { class: 'h-page', style: { width: w + 'px', height: hh + 'px' } });
  if (p.tpl === 'flats' || p.tpl === 'techpack') {
    page.innerHTML = p.tpl === 'flats'
      ? `<div class="h-tees">${TEE_ICON}${TEE_ICON}</div>`
      : `<div class="h-tp"><i></i><div class="h-tees sm">${TEE_ICON}${TEE_ICON}</div><b></b></div>`;
  } else if (p.tpl === 'printArea') page.innerHTML = '<div class="h-print"></div>';
  return h('div', { class: 'h-thumb' }, page);
}
async function renderHome() {
  if (homeEl.hidden) return;
  const draft = await readAutosave();
  let items = [];
  let libErr = false;
  try { items = await Lib.list(); } catch (e) { console.warn(e); libErr = true; }
  const q = homeQuery.trim().toLowerCase();
  const shown = q ? items.filter(it => (it.name || '').toLowerCase().includes(q)) : items;
  homeEl.innerHTML = '';
  // sidebar
  const newBtn = h('button', { class: 'btn primary h-wide', type: 'button' }, 'New file');
  newBtn.addEventListener('click', () => openNewDialog());
  const openBtn = h('button', { class: 'btn h-wide', type: 'button' }, 'Open…');
  openBtn.addEventListener('click', () => confirmDiscard(() => pickFile('open')));
  const back = h('button', { class: 'h-link', type: 'button' }, '← Back to editor');
  back.addEventListener('click', hideHome);
  const side = h('aside', { class: 'h-side' },
    h('div', { class: 'h-brand', html: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M10 1.8 15.6 9.2 12.8 18H7.2L4.4 9.2Z"/><path d="M10 1.8v7.4"/><circle cx="10" cy="10.6" r="1.5" fill="currentColor" stroke="none"/></svg><span>Nib <em>Vector Studio</em></span>` }),
    newBtn, openBtn,
    h('nav', { class: 'h-nav' },
      h('a', { href: '#h-new' }, 'Start new'), h('a', { href: '#h-recent' }, 'Your files'),
      h('button', { type: 'button', class: 'h-link', onclick: () => openSample() }, 'Open the sample poster')),
    h('div', { class: 'h-grow' }),
    h('p', { class: 'hint' }, cloudLib() ? 'Projects are saved privately to your account on this page.' : 'Projects are saved in this browser on this device. Use File › Download Copy now and then for a backup.'),
    back);
  // main
  const search = h('input', { class: 'txt h-search', type: 'search', placeholder: 'Search your files', value: homeQuery, id: 'homeSearch', 'aria-label': 'Search your files' });
  search.addEventListener('input', debounce(() => { homeQuery = search.value; renderHome().then(() => { const s = $('#homeSearch'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }); }, 150));
  search.addEventListener('keydown', e => e.stopPropagation());
  const hello = items.length ? 'Welcome back' : 'Welcome to Nib';
  const head = h('header', { class: 'h-head' }, h('div', null, h('h1', null, hello), h('p', { class: 'h-sub' }, 'Design apparel, logos and print graphics. Open Illustrator files, PDFs and SVGs, or start from a template.')), search);
  // presets
  const strip = h('div', { class: 'h-strip' });
  for (const cat of ['Apparel', 'Print', 'Screen']) {
    const row = h('div', { class: 'h-cards' });
    PRESETS.filter(p => p.cat === cat).forEach(p => {
      const card = h('button', { class: 'h-card', type: 'button', title: `New ${p.name} (${p.note})` }, presetThumb(p), h('b', null, p.name), h('span', null, p.note));
      card.addEventListener('click', () => newFromPreset(p));
      row.append(card);
    });
    strip.append(h('div', { class: 'h-cat' }, cat), row);
  }
  const more = h('button', { class: 'btn small', type: 'button' }, 'Custom size…');
  more.addEventListener('click', () => openNewDialog());
  // recent
  const grid = h('div', { class: 'h-grid' });
  if (draft && draft.doc && (draft.dirty || !draft.libId)) {
    const ab = draft.doc.artboards && draft.doc.artboards[0];
    const c = h('button', { class: 'h-file draft', type: 'button' },
      h('div', { class: 'h-fthumb' }, h('span', { class: 'h-badge' }, 'Unsaved')),
      h('b', null, draft.doc.name || 'Untitled'),
      h('span', null, `Continue where you left off · ${relTime(draft.t)}`));
    c.addEventListener('click', async () => { await restoreAutosave(); afterRestoreDraft(); });
    void ab;
    grid.append(c);
  }
  for (const it of shown) {
    const thumb = h('div', { class: 'h-fthumb' });
    if (it.thumb) thumb.style.backgroundImage = `url("${it.thumb}")`;
    const menuB = h('button', { class: 'h-more', type: 'button', title: 'More actions', 'aria-label': `More actions for ${it.name}` }, '⋯');
    const card = h('div', { class: 'h-file', role: 'button', tabindex: '0', title: `Open ${it.name}` }, thumb, h('b', null, it.name), h('span', null, `${relTime(it.updated)}${it.dims ? ' · ' + it.dims : ''}`), menuB);
    const open = () => confirmDiscard(() => openFromLibrary(it.id).catch(e => toast(e.message || 'Could not open that project.')));
    card.addEventListener('click', e => { if (e.target === menuB) return; open(); });
    card.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
    menuB.addEventListener('click', e => {
      e.stopPropagation();
      const r = menuB.getBoundingClientRect();
      closeFloating();
      buildMenuEl([
        { label: 'Open', run: open },
        { label: 'Rename…', run: () => { const f = fText('Name', it.name); openDialog({ title: 'Rename', body: [f.el], buttons: [{ label: 'Cancel' }, { label: 'Rename', primary: true, onClick: () => { const n = f.get().trim(); if (n) Lib.rename(it.id, n).then(() => { if (doc.libId === it.id) { doc.name = n; updateStatus(); } renderHome(); }); } }] }); } },
        { label: 'Download copy (.nib.json)', run: async () => { try { const text = await Lib.load(it.id); offerFile(safeName(it.name) + '.nib.json', text, 'application/json'); } catch (err) { toast(err.message); } } },
        '-',
        { label: 'Delete…', run: () => openDialog({ title: 'Delete project?', body: [h('p', null, `“${it.name}” will be removed from ${cloudLib() ? 'your library' : 'this browser'}. This can't be undone.`)], buttons: [{ label: 'Cancel' }, { label: 'Delete', primary: true, onClick: () => { Lib.remove(it.id).then(() => { if (doc.libId === it.id) doc.libId = null; renderHome(); }); } }] }) },
      ], r.right - 220, r.bottom + 4, 0);
      floating.add(menuFloat);
    });
    grid.append(card);
  }
  let emptyNote = null;
  if (!shown.length) emptyNote = h('div', { class: 'h-empty' }, libErr ? 'Your saved files could not be read in this browser.' : q ? `No files match “${homeQuery}”.` : 'No saved projects yet. Press Ctrl+S in the editor to save one; it will show up here with a preview.');
  const drop = h('p', { class: 'h-drop' }, 'Drop an .ai, .pdf, .svg, image or .nib.json file anywhere on this screen to open it.');
  const newSec = h('section', { id: 'h-new' }, h('div', { class: 'h-sec-h' }, h('h2', null, 'Start something new'), more), strip);
  const recentSec = h('section', { id: 'h-recent' }, h('div', { class: 'h-sec-h' }, h('h2', null, 'Your files'), h('span', { class: 'hint' }, `${items.length} saved`)), grid, emptyNote);
  const hasWork = items.length || grid.children.length;
  const main = h('main', { class: 'h-main' }, head, ...(hasWork ? [recentSec, newSec] : [newSec, recentSec]), drop);
  homeEl.append(side, main);
}
function afterRestoreDraft() {
  sel.items = new Set(); sel.pts = new Map();
  selectionChanged(); emit('doc'); requestDraw();
  hideHome();
}
homeEl.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); homeEl.classList.add('dropping'); } });
homeEl.addEventListener('dragleave', e => { if (e.target === homeEl) homeEl.classList.remove('dropping'); });
homeEl.addEventListener('drop', e => {
  homeEl.classList.remove('dropping');
  if (!e.dataTransfer || !e.dataTransfer.files.length) return;
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  confirmDiscard(() => openFile(f));
});
