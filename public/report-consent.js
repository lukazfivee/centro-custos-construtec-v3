(() => {
  function addConsent(form) {
    if (!form || form.dataset.reportConsentReady === 'true') return;
    form.dataset.reportConsentReady = 'true';

    const submit = form.querySelector('button[type="submit"], input[type="submit"]');
    const container = document.createElement('div');
    container.className = 'report-privacy-consent';
    container.style.cssText = 'margin:14px 0;padding:12px 13px;border:1px solid var(--line);border-radius:10px;background:rgba(50,169,205,.06);font-size:11px;line-height:1.5';
    container.innerHTML = `
      <label style="display:flex;align-items:flex-start;gap:9px;cursor:pointer;margin:0">
        <input id="report-privacy-consent" type="checkbox" required style="margin-top:3px;min-height:auto">
        <span>
          <strong>Confirmação de envio externo</strong><br>
          Ao enviar este report, seu nome, e-mail e o texto informado serão enviados ao servidor central de reports da Construtec para triagem.
        </span>
      </label>`;

    if (submit?.parentNode) submit.parentNode.insertBefore(container, submit);
    else form.appendChild(container);
  }

  function scan() {
    document.querySelectorAll('#bugreport-form').forEach(addConsent);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
  else scan();

  new MutationObserver(scan).observe(document.documentElement, { childList:true, subtree:true });
})();
