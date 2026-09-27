// Menu Suite: troca de sistema. Mesmos enderecos do seletor do Centro de Custos atual.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;

  const ITENS = [
    ['squares-four', 'Portal Hub', 'Launcher e esteira de trabalho', 'https://hub-sistemas-construtec.lucas-coelho5923.workers.dev/'],
    ['file-text', 'Orçamentos', 'Etapa 01 · propostas e BDI', 'https://construtec-orcamentos-cloud.construtec-reports.workers.dev/'],
    ['chart-bar', 'Centro de Custos', 'Etapa 02 · gestão das obras', null],
    ['wrench', 'Chamados e O.S.', 'Etapa 03 · ChamadoPro', 'https://chamadopro-app.lucas-coelho5923.workers.dev/'],
  ];
  const WEBMAIL = 'https://webmailpro.uol.com.br/';

  const item = ([icone, titulo, sub, url]) => {
    const miolo = `<span class="ic">${D.ic(icone, 17)}</span><span class="tx"><b>${esc(titulo)}</b><span>${esc(sub)}</span></span>`;
    if (!url) return `<div class="res atual" role="menuitem" aria-current="page">${miolo}${D.ui.chip('Atual', 'ok')}</div>`;
    return `<a class="res" role="menuitem" href="${esc(url)}" target="_blank" rel="noopener">${miolo}${D.ic('arrow-square-out', 15)}</a>`;
  };

  D.montarSuite = function () {
    const raiz = CC.$('.suite');
    raiz.innerHTML = `<button type="button" class="btn btn-s" aria-haspopup="menu" aria-expanded="false">${D.ic('squares-four')}Suíte${D.ic('caret-down', 12)}</button>
      <div class="pop" role="menu" aria-label="Suíte Construtec" hidden>
        <span class="lbl">Suíte Construtec</span>
        ${ITENS.map(item).join('')}
        <div class="sep" role="separator"></div>
        ${item(['envelope-simple', 'Webmail', 'E-mail corporativo UOL', WEBMAIL])}
      </div>`;
    const botao = CC.$('button', raiz);
    const pop = CC.$('.pop', raiz);
    const abrir = (sim) => {
      pop.hidden = !sim;
      botao.setAttribute('aria-expanded', sim ? 'true' : 'false');
      if (sim) (CC.$('a.res', pop) || botao).focus();
    };
    botao.addEventListener('click', () => abrir(pop.hidden));
    // No app Windows o Webmail abre na janela propria, como no sistema atual.
    pop.addEventListener('click', (event) => {
      const link = event.target.closest('a.res');
      if (link && link.href === WEBMAIL && window.electronAPI && window.electronAPI.openWebmail) {
        event.preventDefault();
        window.electronAPI.openWebmail();
      }
      if (link) abrir(false);
    });
    document.addEventListener('click', (event) => { if (!raiz.contains(event.target)) abrir(false); });
    raiz.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !pop.hidden) { event.stopPropagation(); abrir(false); botao.focus(); }
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !pop.hidden) {
        event.preventDefault();
        const links = CC.$$('a.res', pop);
        const i = links.indexOf(document.activeElement);
        const j = event.key === 'ArrowDown' ? Math.min(links.length - 1, i + 1) : Math.max(0, i - 1);
        links[j].focus();
      }
    });
  };
})(window.CC);
