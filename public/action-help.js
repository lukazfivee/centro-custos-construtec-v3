/* Keyboard-visible descriptions use the same wording as pointer tooltips. */
(() => {
  const selector = 'button, a[href], input[type="submit"], [role="button"]';
  const tooltip = document.createElement('div');
  tooltip.id = 'action-tooltip';
  tooltip.className = 'action-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.append(tooltip);
  const descriptions = {
    'mobile-menu': 'Abrir menu de navegação',
    'mobile-nav-scrim': 'Fechar menu de navegação',
    'modal-fechar': 'Fechar janela',
  };
  Object.entries(descriptions).forEach(([id, description]) => {
    const button = document.getElementById(id);
    if (button && !button.title) button.title = description;
  });
  let owner = null;
  let dismissTimer;
  function hide() {
    tooltip.hidden = true;
    if (owner) {
      const ids = (owner.getAttribute('aria-describedby') || '').split(' ').filter(id => id && id !== tooltip.id);
      if (ids.length) owner.setAttribute('aria-describedby', ids.join(' '));
      else owner.removeAttribute('aria-describedby');
    }
    owner = null;
  }
  function show(button) {
    if (!button || button.disabled) return;
    const description = button.getAttribute('title') || button.dataset.actionHelp;
    if (!description) return;
    clearTimeout(dismissTimer);
    hide();
    owner = button;
    tooltip.textContent = description;
    tooltip.hidden = false;
    const ids = (button.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
    button.setAttribute('aria-describedby', [...new Set([...ids, tooltip.id])].join(' '));
    const rect = button.getBoundingClientRect();
    const box = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - box.width - 8))}px`;
    tooltip.style.top = `${rect.bottom + box.height + 12 < innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - box.height - 6)}px`;
  }
  document.addEventListener('focusin', event => show(event.target.closest(selector)));
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerover', event => {
    if (event.pointerType !== 'touch') show(event.target.closest(selector));
  });
  document.addEventListener('pointerout', event => {
    if (owner && !owner.contains(event.relatedTarget) && !tooltip.contains(event.relatedTarget)) dismissTimer = setTimeout(hide, 150);
  });
  tooltip.addEventListener('pointerenter', () => clearTimeout(dismissTimer));
  tooltip.addEventListener('pointerleave', hide);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  document.addEventListener('click', hide);
  window.addEventListener('resize', hide);
  document.addEventListener('scroll', hide, true);
})();
