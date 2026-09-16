/* Ciclo único do modal compartilhado, inclusive chamadas dos módulos de orçamento. */
function modal(title, content) {
  const backdrop = document.getElementById('modal-fundo');
  if (backdrop.classList.contains('oculto')) document._modalOrigin = document.activeElement;
  document.getElementById('modal-titulo').textContent = title;
  const body = document.getElementById('modal-corpo');
  body.innerHTML = content;
  body.querySelectorAll('.form-error').forEach(element => element.setAttribute('role', 'status'));
  backdrop.style.display = '';
  backdrop.classList.remove('oculto');
  document.getElementById('app').inert = true;
  document.getElementById('modal-fechar').focus();
}
function closeModal() {
  const backdrop = document.getElementById('modal-fundo');
  if (!backdrop || backdrop.classList.contains('oculto')) return;
  backdrop.classList.add('oculto');
  backdrop.style.display = 'none';
  backdrop.querySelector('.modal').classList.remove('budget-modal-wide');
  document.getElementById('modal-corpo').innerHTML = '';
  document.getElementById('app').inert = false;
  const origin = document._modalOrigin;
  if (origin?.isConnected) origin.focus();
  document._modalOrigin = null;
}
document.getElementById('modal-fechar').addEventListener('click', () => window.closeModal());
document.getElementById('modal-fundo').addEventListener('click', event => {
  if (event.target.id === 'modal-fundo') window.closeModal();
});
document.addEventListener('keydown', event => {
  const backdrop = document.getElementById('modal-fundo');
  if (event.key === 'Escape') {
    const nested = document.querySelector('#budget-measurements-backdrop, #budget-report-backdrop, #budget-curves-backdrop');
    if (nested) return;
    window.closeModal();
    document.querySelectorAll('.cc-doc-backdrop, .cc-reversal-modal-backdrop, #v31-refine-overlay, #v31-overlay, .cc-cockpit-backdrop').forEach(element => element.remove());
  }
  if (event.key !== 'Tab' || backdrop.classList.contains('oculto')) return;
  const focusable = [...backdrop.querySelectorAll('button, a[href], input, select, textarea, [tabindex="0"]')]
    .filter(element => !element.disabled && element.getClientRects().length);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first) { event.preventDefault(); backdrop.focus(); return; }
  if (event.shiftKey && (document.activeElement === first || !backdrop.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || !backdrop.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
});
