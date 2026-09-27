// Roteador por hash: #/lancamentos, #/obras/12, #/obras/12/medicoes, #/lancamentos?id=5.
// Cada tela se registra com CC.d.tela(nome, { render(el, rota, vivo) }).
(function (CC) {
  const D = CC.d;
  const telas = {};
  let hashAnterior = '';
  let versao = 0;

  D.tela = (nome, def) => { telas[nome] = def; };
  D.temTela = (nome) => !!telas[nome];

  D.lerRota = (hash) => {
    const bruto = String(hash == null ? location.hash : hash).replace(/^#\/?/, '');
    const [caminho, busca] = bruto.split('?');
    const partes = caminho.split('/').filter(Boolean).map(decodeURIComponent);
    return {
      nome: partes[0] || 'inicio',
      id: partes[1] || '',
      aba: partes[2] || '',
      query: Object.fromEntries(new URLSearchParams(busca || '')),
    };
  };

  D.ir = (caminho) => {
    const alvo = `#/${String(caminho || '').replace(/^#?\/?/, '')}`;
    if (location.hash === alvo) mostrar();
    else location.hash = alvo;
  };

  async function mostrar() {
    // Painel com alteracao nao salva: pergunta antes de trocar de tela.
    if (D.painel && D.painel.aberto()) {
      const pode = await D.painel.fecharSePuder();
      if (!pode) { history.replaceState(null, '', hashAnterior || '#/inicio'); return; }
    }
    hashAnterior = location.hash;
    const rota = D.lerRota();
    const minha = ++versao;
    // "vivo()" diz se esta tela ainda e a atual (evita desenhar uma tela antiga por cima da nova).
    const vivo = () => minha === versao;
    const el = CC.$('#conteudo');
    const def = telas[rota.nome] || telas['em-construcao'];
    if (D.aoNavegar) D.aoNavegar(rota);
    el.scrollTop = 0;
    try {
      await def.render(el, rota, vivo);
    } catch (error) {
      if (!vivo()) return;
      el.innerHTML = `<div class="pagina">${D.ui.faixa('err', 'warning-circle', error.message || 'Não foi possível abrir esta tela.')}</div>`;
    }
  }

  D.iniciarRotas = () => {
    window.addEventListener('hashchange', mostrar);
    if (!location.hash || location.hash === '#' || location.hash === '#/') history.replaceState(null, '', '#/inicio');
    mostrar();
  };
})(window.CC);
