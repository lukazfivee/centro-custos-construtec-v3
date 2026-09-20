/* Um único estado de navegação para mouse, teclado e celular. */
let mobileMenuOrigin = null;
function setMobileMenu(open, origin) {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;
  if (open) mobileMenuOrigin = origin || document.activeElement;
  sidebar.classList.toggle('open', open);
  document.getElementById('app').classList.toggle('menu-open', open);
  document.querySelectorAll('#mobile-menu, #mobile-menu-legacy, #mobile-more').forEach(button => {
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-controls', sidebar.id);
  });
  document.getElementById('mobile-menu').setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
  if (open) sidebar.querySelector('.nav-item.ativo, .nav-item')?.focus();
  else if (sidebar.contains(document.activeElement)) mobileMenuOrigin?.focus();
}
function syncMobileNavigation(name) {
  document.querySelectorAll('[data-view], [data-mobile-view]').forEach(button => {
    const active = (button.dataset.view || button.dataset.mobileView) === name;
    button.classList.toggle('ativo', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  setMobileMenu(false);
}
document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
document.querySelectorAll('[data-mobile-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.mobileView)));
document.getElementById('mobile-menu').addEventListener('click', event => setMobileMenu(!document.querySelector('.sidebar').classList.contains('open'), event.currentTarget));
document.getElementById('mobile-menu-legacy')?.addEventListener('click', event => setMobileMenu(!document.querySelector('.sidebar').classList.contains('open'), event.currentTarget));
document.getElementById('mobile-more').addEventListener('click', event => setMobileMenu(true, event.currentTarget));
document.getElementById('mobile-nav-scrim').addEventListener('click', () => setMobileMenu(false));
document.addEventListener('keydown', event => {
  const sidebar = document.querySelector('.sidebar.open');
  if (!sidebar) return;
  if (event.key === 'Escape') { event.preventDefault(); setMobileMenu(false); }
  if (event.key !== 'Tab') return;
  const buttons = [...sidebar.querySelectorAll('button')].filter(button => !button.disabled && button.getClientRects().length);
  const target = event.shiftKey ? buttons.at(-1) : buttons[0];
  if (document.activeElement === (event.shiftKey ? buttons[0] : buttons.at(-1))) { event.preventDefault(); target?.focus(); }
});
matchMedia('(max-width:800px)').addEventListener('change', () => setMobileMenu(false));
document.documentElement.classList.toggle('desktop-app', Boolean(window.electronAPI));
