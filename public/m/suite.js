// Seletor "Suite" (passo 4 da Suite mobile): folha inferior com os apps da esteira.
// Dentro do app Android, o Orcamentos troca de WebView por suite://app/orcamentos
// (com ?proposta= para ir direto a proposta de origem da obra); fora do app, abre
// o site em outra aba. O ChamadoPro sempre abre no navegador.
(function (CC) {
  const { esc, icon } = CC;
  const ORC_URL = 'https://construtec-orcamentos-cloud.construtec-reports.workers.dev/';
  const CHAMADOPRO_URL = 'https://chamadopro-app.lucas-coelho5923.workers.dev/';
  const inApp = () => /SuiteConstrutec\//.test(navigator.userAgent) || new URLSearchParams(location.search).has('app');
  const orcLink = (proposta) => {
    const id = proposta ? encodeURIComponent(proposta) : '';
    if (inApp()) return `suite://app/orcamentos${id ? `?proposta=${id}` : ''}`;
    return `${ORC_URL}${id ? `#proposta=${id}` : ''}`;
  };

  // Contexto da tela aberta: a obra informa a proposta de origem; CC.go limpa.
  CC.suite = { context: null };

  function onKey(event) { if (event.key === 'Escape') close(); }
  function close() {
    const el = document.getElementById('suite-sheet');
    if (el) el.remove();
    document.removeEventListener('keydown', onKey);
  }

  CC.suite.open = function () {
    close();
    const origem = CC.suite.context && CC.suite.context.proposta;
    const other = inApp() ? '' : ' target="_blank" rel="noopener"';
    const el = document.createElement('div');
    el.id = 'suite-sheet';
    el.className = 'sheet-backdrop';
    el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="suite-title">
      <div class="sheet-handle"></div>
      <div class="sheet-head"><b id="suite-title">${icon('squares-four', 18)}Esteira Operacional Construtec</b>
        <button type="button" class="sheet-x" aria-label="Fechar">${icon('x', 20)}</button></div>
      ${origem && origem.id ? `<p class="sheet-sec">Ir direto para</p>
        <a class="suite-item ctx" href="${esc(orcLink(origem.id))}"${other}>${icon('arrow-right', 20)}<span><b>Proposta de origem</b><small>${esc(origem.numero || '')} no Orçamentos</small></span>${icon('caret-right', 18)}</a>` : ''}
      <p class="sheet-sec">Sistemas</p>
      <a class="suite-item" href="${esc(orcLink())}"${other}>${icon('receipt', 22)}<span><small>Etapa 01</small><b>Orçamentos</b></span>${icon('caret-right', 18)}</a>
      <div class="suite-item current" aria-current="page">${icon('buildings-fill', 22)}<span><small>Etapa 02</small><b>Centro de Custos</b></span><em>Atual</em></div>
      <a class="suite-item" href="${CHAMADOPRO_URL}" target="_blank" rel="noopener">${icon('check-circle', 22)}<span><small>Etapa 03</small><b>ChamadoPro</b><small>Abre no navegador</small></span>${icon('arrow-right', 18)}</a>
    </div>`;
    el.addEventListener('click', (event) => {
      if (event.target === el || event.target.closest('.sheet-x')) close();
      else if (event.target.closest('a')) setTimeout(close, 0); // deixa o link navegar antes de fechar
    });
    document.body.appendChild(el);
    document.addEventListener('keydown', onKey);
    CC.$('.sheet-x', el).focus();
  };

  document.addEventListener('click', (event) => { if (event.target.closest('[data-suite]')) CC.suite.open(); });
})(window.CC = window.CC || {});
