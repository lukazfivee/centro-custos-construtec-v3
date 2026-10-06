// Configuracoes > Sistema > "Atualizacao do aplicativo": versao instalada, ultima verificacao,
// situacao e o botao manual. So aparece no app do Windows (Electron) e para quem administra.
(function (CC) {
  const D = CC.d;
  const U = D.ui;
  const { esc } = CC;
  const C = D.cfg = D.cfg || {};

  const SITUACAO = {
    idle: ['Ainda não verificado', 'neutro', 'clock'],
    checking: ['Verificando…', 'info', 'arrows-clockwise'],
    'not-available': ['Você usa a versão mais recente', 'ok', 'check-circle'],
    available: ['Nova versão disponível', 'warn', 'arrow-circle-up'],
    downloading: ['Baixando a atualização', 'info', 'download-simple'],
    downloaded: ['Pronta para instalar', 'ok', 'check-circle'],
    installing: ['Instalando', 'info', 'arrow-clockwise'],
    error: ['Não foi possível verificar', 'err', 'warning-circle'],
    unavailable: ['Indisponível nesta instalação', 'neutro', 'info'],
  };

  C.atualizacaoCartao = function () {
    return `<section class="card cfg-card" aria-labelledby="cfg-upd-t" data-upd-cartao hidden><div class="cfg-topo-sis"><h2 id="cfg-upd-t">Atualização do aplicativo</h2><span data-upd-chip></span></div>
      <div class="cfg-linhas" data-upd-linhas></div><div data-upd-msg aria-live="polite"></div>
      <div class="cfg-rodape"><span class="cfg-nota">A verificação automática acontece ao abrir o aplicativo, no máximo a cada 6 horas.</span>
        <div class="cfg-botoes"><button type="button" class="btn btn-p" data-upd-abrir hidden>${D.ic('arrow-circle-up')}Ver novidades</button>
        <button type="button" class="btn btn-s" data-verificar>${D.ic('arrows-clockwise')}Verificar atualização</button></div></div></section>`;
  };

  C.atualizacao = function (cartao) {
    const up = D.upd;
    if (!up || !up.disponivel()) return;
    cartao.hidden = false;
    const linhas = CC.$('[data-upd-linhas]', cartao);
    const msg = CC.$('[data-upd-msg]', cartao);
    const botao = CC.$('[data-verificar]', cartao);
    const ver = CC.$('[data-upd-abrir]', cartao);
    const linha = (r, v) => `<div class="cfg-linha"><span>${esc(r)}</span><b>${esc(v)}</b></div>`;

    const pintar = (e) => {
      if (!cartao.isConnected) return;
      const s = e && e.supported === false ? 'unavailable' : (e && e.status ? e.status : 'idle');
      const [texto, tom, icone] = SITUACAO[s] || SITUACAO.idle;
      CC.$('[data-upd-chip]', cartao).innerHTML = U.chip(texto, tom, icone);
      const nova = e && e.info && e.info.version ? ` · nova: ${e.info.version}` : '';
      linhas.innerHTML = linha('Versão instalada', e && e.currentVersion ? `v${e.currentVersion}` : 'não identificada') + linha('Última verificação', up.ha(up.ultimaVerificacao()) + (s === 'available' ? nova : ''));
      ver.hidden = !['available', 'downloading', 'downloaded'].includes(s);
      if (s === 'error') msg.innerHTML = U.faixa('err', 'warning-circle', e.error || 'Não foi possível verificar agora.');
      else if (s === 'unavailable') msg.innerHTML = U.faixa('info', 'info', e.unsupportedReason || e.error || 'As atualizações automáticas só existem no aplicativo instalado no Windows.');
      else msg.innerHTML = '';
    };

    const parar = up.aoMudar(pintar);
    pintar(up.estado);
    up.ler().then(pintar).catch((error) => { msg.innerHTML = U.faixa('err', 'warning-circle', error.message); });
    ver.addEventListener('click', () => up.abrirPainel());
    botao.addEventListener('click', async () => {
      const solto = U.ocupar(botao, 'Verificando…');
      msg.innerHTML = '';
      try { pintar(await up.verificar()); } catch (error) { msg.innerHTML = U.faixa('err', 'warning-circle', error.message); }
      solto();
      if (!cartao.isConnected) parar();
    });
  };
})(window.CC);
