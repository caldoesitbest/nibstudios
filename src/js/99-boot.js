/* ============================================================
   Boot — runs last so every module above is defined first
   ============================================================ */
(() => {
  const brand = $('.brand');
  brand.setAttribute('role', 'button');
  brand.setAttribute('tabindex', '0');
  brand.title = 'Start screen (Ctrl+Alt+H)';
  brand.style.cursor = 'pointer';
  brand.addEventListener('click', showHome);
  brand.addEventListener('keydown', e => { if (e.key === 'Enter') showHome(); });
})();
init();
