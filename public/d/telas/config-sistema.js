// Configuracoes, aba "Sistema" (print 95): versao real, servidor, banco, usuarios, atualizacao,
// armazenamento, atalho para Reports e, so no app Windows, o acesso pelo celular.
(function (CC) {
  const D = CC.d;
  const U = D.ui;
  const { esc } = CC;
  const C = D.cfg = D.cfg || {};
  const num = (n) => Number(n || 0).toLocaleString('pt-BR');

  const duracao = (s) => {
    const m = Math.floor(Number(s || 0) / 60);
    if (m < 1) return 'agora há pouco';
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    return h < 48 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} dias`;
  };
  const linha = (rotulo, valor) => `<div class="cfg-linha"><span>${esc(rotulo)}</span><b>${esc(valor)}</b></div>`;
  const barra = (rotulo, bytes, total, alt) => `<div class="cfg-uso${alt ? ' alt' : ''}"><div class="l"><span>${esc(rotulo)}</span><b>${esc(C.bytes(bytes))}</b></div>
    <div class="barra" role="img" aria-label="${esc(rotulo)}: ${esc(C.bytes(bytes))}"><i style="width:${total ? Math.max(2, Math.round((bytes / total) * 100)) : 0}%"></i></div></div>`;

  const TEXTO_ATUALIZACAO = {
    'not-available': 'Você já usa a versão mais recente.',
    unavailable: 'As atualizações automáticas só existem no aplicativo instalado no Windows.',
  };
  async function verificarAtualizacao(destino, botao) {
    const solto = U.ocupar(botao, 'Verificando…');
    const dizer = (tom, icone, texto) => { destino.innerHTML = U.faixa(tom, icone, texto); };
    // No navegador (sem o app do Windows) nao ha atualizador: evita chamar a rota so para receber erro.
    if (!window.electronAPI) { dizer('info', 'info', TEXTO_ATUALIZACAO.unavailable); solto(); return; }
    try {
      await CC.api('/update/check');
      let estado = {};
      for (let i = 0; i < 8; i += 1) {
        await new Promise((r) => setTimeout(r, 1200));
        estado = (await CC.api('/update/status')).data;
        if (!['idle', 'checking'].includes(estado.status)) break;
      }
      if (estado.status === 'available') dizer('warn', 'arrow-circle-up', `Há uma nova versão: ${estado.info && estado.info.version ? estado.info.version : 'disponível'}. Instale pelo aplicativo do Windows.`);
      else if (estado.status === 'error') dizer('err', 'warning-circle', estado.error || 'Não foi possível verificar agora.');
      else dizer('info', 'check-circle', TEXTO_ATUALIZACAO[estado.status] || 'A verificação ainda está em andamento. Tente de novo em instantes.');
    } catch (error) { dizer('info', 'info', error.message); }
    solto();
  }

  async function acessoCelular(cartao) {
    const api = window.electronAPI;
    cartao.hidden = false;
    const { data } = await CC.api('/version');
    const urls = Array.isArray(data.mobileUrls) ? data.mobileUrls : [];
    const publico = String(data.mobileAppUrl || '').trim();
    CC.$('[data-cel-corpo]', cartao).innerHTML = publico || urls.length
      ? `<div class="cfg-cel">${publico ? '<img src="/api/mobile-qr" alt="QR Code para abrir a versão do celular" width="168" height="168">' : ''}
        <div class="dados">${publico ? `<b>Abra a versão do celular</b><span>Aponte a câmera para o código. Endereço seguro (HTTPS):</span><a href="${esc(publico)}" target="_blank" rel="noopener">${esc(publico)}</a>` : ''}
        ${urls.length ? `<b>Rede local</b><span>Use este endereço no aplicativo Android:</span><a href="${esc(urls[0])}" target="_blank" rel="noopener">${esc(urls[0])}</a>` : ''}</div></div>`
      : '<span class="cfg-nota">A versão do celular não está configurada nesta instalação.</span>';
    const chave = CC.$('[data-cel-chave]', cartao);
    chave.disabled = !api.setMobileAccess;
    chave.checked = !!(api.getMobileAccess && api.getMobileAccess() === true);
    chave.addEventListener('change', async () => {
      chave.disabled = true;
      try { await api.setMobileAccess(chave.checked); CC.toast(chave.checked ? 'Acesso pelo celular ligado' : 'Acesso pelo celular desligado'); } catch (error) { chave.checked = !chave.checked; CC.toast(error.message || 'Não foi possível alterar agora.'); }
      chave.disabled = false;
    });
  }

  C.sistema = async function (corpo, vivo) {
    corpo.innerHTML = U.carregando('Lendo o sistema…');
    const inicio = performance.now();
    const [{ data: s }, saude, copias] = await Promise.all([
      CC.api('/sistema/status'),
      CC.api('/health').then((r) => r.data).catch(() => null),
      CC.api('/backup/copias').then((r) => r.data).catch(() => null),
    ]);
    if (!vivo()) return;
    const ms = saude ? Math.round(Number(saude.databaseLatencyMs || 0)) : Math.round(performance.now() - inicio);
    const a = s.application;
    const r = s.database.records;
    const arm = s.database.storage || {};
    const bytesBanco = Number(arm.sizeBytes || 0);
    const bytesBackup = copias && copias.resumo ? copias.resumo.bytes : 0;
    const total = bytesBanco + bytesBackup;
    const modo = s.database.mode === 'postgres' ? 'PostgreSQL central' : 'Banco local (PGlite)';
    corpo.innerHTML = `<div class="cfg-grade"><div class="cfg-col">
      <section class="card cfg-card" aria-labelledby="cfg-sis-t"><div class="cfg-topo-sis"><h2 id="cfg-sis-t">Sistema</h2>${U.chip('Operando normalmente', 'ok', 'check-circle')}</div>
        <div class="cfg-linhas">${linha('Versão', `Centro de Custos v${a.version}`)}${linha('Servidor', `Online · responde em ${num(ms)} ms · ligado há ${duracao(a.uptimeSeconds)}`)}
          ${linha('Banco de dados', `${modo}${arm.sizeBytes != null ? ` · ${C.bytes(bytesBanco)}` : ''} · ${num(r.activeTransactions)} lançamentos`)}
          ${linha('Usuários ativos', num(r.activeUsers))}${linha('Obras e fornecedores', `${num(r.costCenters)} obras · ${num(r.suppliers)} fornecedores`)}
          ${linha('Fuso e moeda', `${s.regional.timezone} · ${s.regional.currency}`)}
          ${linha('Última migração', s.database.migrations.latest ? s.database.migrations.latest.filename.replace(/\.sql$/, '') : 'Nenhuma')}</div>
        <div data-atualizacao></div>
        <div class="cfg-rodape"><span class="cfg-nota">A versão é lida do próprio sistema, não de um texto fixo.</span>
          <button type="button" class="btn btn-s" data-verificar>${D.ic('arrows-clockwise')}Verificar atualização</button></div></section></div>
      <div class="cfg-col">
      <section class="card cfg-card" aria-labelledby="cfg-arm-t"><h2 id="cfg-arm-t">Armazenamento</h2>
        ${arm.kind === 'remote' ? '<span class="cfg-nota">O banco fica no servidor central. O tamanho não é medido por aqui.</span>' : barra('Banco de dados', bytesBanco, total)}
        ${copias && copias.modo === 'local' ? barra('Backups', bytesBackup, total, true) : ''}
        <span class="cfg-nota">${arm.truncated ? 'Medida parcial: a pasta tem muitos arquivos. ' : ''}Sem limite de plano: é o espaço usado neste computador.</span></section>
      <section class="card cfg-card" aria-labelledby="cfg-rep-t"><h2 id="cfg-rep-t">Reports</h2>
        <span class="cfg-nota">Algo não funcionou? Envie um report com o diagnóstico. A equipe responde por lá.</span>
        <div class="cfg-botoes"><a class="btn btn-s" href="#/reports">${D.ic('list')}Ver reports</a></div></section>
      <section class="card cfg-card" aria-labelledby="cfg-cel-t" data-cel hidden><div class="cfg-topo-sis"><h2 id="cfg-cel-t">Acesso pelo celular</h2>
        <label class="cfg-chave"><input type="checkbox" data-cel-chave aria-label="Permitir acesso pelo celular"><span>Permitir</span></label></div>
        <div data-cel-corpo>${U.carregando('Lendo os endereços…')}</div></section></div></div>`;
    CC.$('[data-verificar]', corpo).addEventListener('click', (e) => verificarAtualizacao(CC.$('[data-atualizacao]', corpo), e.currentTarget));
    if (window.electronAPI) acessoCelular(CC.$('[data-cel]', corpo)).catch((e) => { CC.$('[data-cel-corpo]', corpo).innerHTML = `<span class="cfg-nota">${esc(e.message)}</span>`; });
  };
})(window.CC);
