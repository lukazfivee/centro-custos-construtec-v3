// Diagnostico do report: as ultimas 20 acoes (so nomes de telas e botoes), navegador e conexao.
// Nunca guarda o que a pessoa digitou, senhas, tokens ou valores. O servidor limpa de novo ao receber.
(function (CC) {
  const D = CC.d;
  const LIMITE = 20;
  const acoes = [];
  D.diag = {};

  const registrar = (texto) => {
    acoes.push({ quando: new Date().toISOString(), acao: String(texto).slice(0, 80) });
    if (acoes.length > LIMITE) acoes.shift();
  };
  D.diag.registrar = registrar;

  function navegador() {
    const ua = navigator.userAgent || '';
    const achou = [['Edg/', 'Edge'], ['OPR/', 'Opera'], ['Firefox/', 'Firefox'], ['Chrome/', 'Chrome'], ['Version/', 'Safari']].find(([marca]) => ua.includes(marca));
    const versao = achou ? (ua.split(achou[0])[1] || '').split(/[. ]/)[0] : '';
    const sistema = /Windows/.test(ua) ? 'Windows' : (/Mac OS X/.test(ua) ? 'macOS' : (/Android/.test(ua) ? 'Android' : (/iPhone|iPad/.test(ua) ? 'iOS' : (/Linux/.test(ua) ? 'Linux' : ''))));
    return `${achou ? `${achou[1]} ${versao}` : 'Navegador'}${sistema ? ` · ${sistema}` : ''}`.trim();
  }

  const conexao = () => {
    if (navigator.onLine === false) return 'offline';
    const tipo = navigator.connection && navigator.connection.effectiveType;
    return tipo ? `online · ${tipo}` : 'online';
  };

  // Rotulo de botao serve de acao; se tiver numero (pode ser valor), fica de fora.
  const rotuloSeguro = (el) => {
    const bruto = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
    return bruto && bruto.length <= 40 && !/\d/.test(bruto) ? bruto : '';
  };

  D.diag.coletar = () => ({
    versao: '',
    navegador: navegador(),
    conexao: conexao(),
    idioma: navigator.language || '',
    resolucao: `${window.innerWidth}x${window.innerHeight}`,
    acoes: acoes.slice(-LIMITE),
  });

  // Resumo de uma linha para o detalhe: "versão 3.4.2, Chrome 129, online".
  D.diag.resumo = (d) => [d.versao ? `versão ${d.versao}` : '', (d.navegador || '').split(' · ')[0], d.conexao ? d.conexao.split(' · ')[0] : ''].filter(Boolean).join(', ');

  // Ultima tela de trabalho aberta (o novo report abre com ela em "Onde aconteceu").
  const lembrarTela = (rota) => {
    const item = D.itemMenu(rota.nome);
    if (item && rota.nome !== 'reports') D.diag.ultimaTela = item.rotulo;
    return item;
  };
  registrar('Abriu o sistema');
  lembrarTela(D.lerRota());
  window.addEventListener('hashchange', () => {
    const rota = D.lerRota();
    const item = lembrarTela(rota);
    registrar(`Abriu ${item ? item.rotulo : 'uma tela'}${rota.aba ? ` · ${rota.aba}` : ''}`);
  });
  document.addEventListener('click', (event) => {
    const alvo = event.target.closest && event.target.closest('button, [role="tab"]');
    const rotulo = alvo ? rotuloSeguro(alvo) : '';
    if (rotulo) registrar(`Clicou em ${rotulo}`);
  }, true);
  window.addEventListener('offline', () => registrar('A conexão caiu'));
  window.addEventListener('online', () => registrar('A conexão voltou'));
})(window.CC);
