// Painel da atualizacao: novidades, "Baixar e instalar" com barra de progresso e "Reiniciar e instalar".
(function (CC) {
  const D = CC.d;
  const U = D.upd;
  const { esc } = CC;
  const mb = (n) => `${(Number(n || 0) / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
  const BT_FECHAR = '<button type="button" class="btn btn-s" data-fechar>Fechar</button>';

  function novidades(e) {
    const info = e.info || {};
    const notas = String(info.releaseNotes || '').trim();
    const dados = [info.size ? mb(info.size) : '', info.releaseDate ? `publicada em ${D.data(info.releaseDate)}` : ''].filter(Boolean).join(' · ');
    return `<div class="upd-bloco"><span class="upd-versao">Versão ${esc(info.version || '')}</span>${dados ? `<span class="cfg-nota">${esc(dados)}</span>` : ''}</div>
      <div class="upd-bloco"><b>O que mudou</b>${notas ? `<div class="upd-notas">${esc(notas)}</div>` : '<span class="cfg-nota">Esta versão não trouxe notas.</span>'}</div>`;
  }

  function progresso(e) {
    const p = e.progress || {};
    const pct = Math.max(0, Math.min(100, Number(p.percent) || 0));
    const detalhe = p.total ? `${mb(p.transferred)} de ${mb(p.total)}` : 'Preparando o download…';
    return `<div class="upd-bloco"><div class="upd-prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Progresso do download"><i style="width:${pct}%"></i></div>
      <div class="upd-prog-txt"><span>${esc(detalhe)}</span><b>${pct}%</b></div></div>`;
  }

  // Desenha o painel conforme o estado. Devolve true quando ainda vale acompanhar o servidor.
  function desenhar(corpo, ctl, e) {
    ctl.limparErro();
    const s = e.status;
    let html = '';
    let botoes = BT_FECHAR;
    if (s === 'available') {
      html = novidades(e) + '<span class="cfg-nota">O download é feito em segundo plano. Depois você escolhe quando reiniciar.</span>';
      botoes = `<button type="button" class="btn btn-s" data-fechar>Depois</button><button type="button" class="btn btn-p" data-baixar>${D.ic('download-simple')}Baixar e instalar</button>`;
    } else if (s === 'downloading') {
      html = `${novidades(e)}${progresso(e)}`;
      botoes = `<button type="button" class="btn btn-p" disabled aria-busy="true"><span class="spin" aria-hidden="true"></span>Baixando…</button>`;
    } else if (s === 'downloaded') {
      html = `${U.faixa('ok', 'check-circle', 'Download concluído. A atualização está pronta para instalar.')}${novidades(e)}
        <span class="cfg-nota">O aplicativo fecha e abre de novo sozinho. Seus dados ficam guardados neste computador.</span>`;
      botoes = `<button type="button" class="btn btn-s" data-fechar>Depois</button><button type="button" class="btn btn-p" data-reiniciar>${D.ic('arrow-clockwise')}Reiniciar e instalar</button>`;
    } else if (s === 'installing') {
      html = U.faixa('info', 'arrow-clockwise', 'Instalando a atualização. O aplicativo vai fechar e abrir de novo em instantes.');
      botoes = '';
    } else if (s === 'error') {
      html = U.faixa('err', 'warning-circle', e.error || 'Não foi possível atualizar agora.');
      botoes = `${BT_FECHAR}<button type="button" class="btn btn-p" data-tentar>${D.ic('arrows-clockwise')}Verificar de novo</button>`;
    } else if (s === 'checking') {
      html = D.ui.carregando('Verificando se há versão nova…');
    } else {
      html = U.faixa('info', 'check-circle', s === 'not-available' ? 'Você já usa a versão mais recente.' : (e.error || 'Nenhuma atualização no momento.'));
    }
    corpo.innerHTML = `<div class="upd-corpo">${html}</div>`;
    ctl.botoes(botoes);
    return ['checking', 'downloading'].includes(s);
  }

  U.faixa = (tom, icone, texto) => D.ui.faixa(tom, icone, texto);

  U.abrirPainel = async () => {
    if (!U.disponivel()) return;
    let vivo = true;
    let relogio = 0;
    const ctl = await D.painel.abrir({
      icone: 'arrow-circle-up', titulo: 'Atualização do aplicativo', sub: `Versão instalada ${U.estado && U.estado.currentVersion ? U.estado.currentVersion : ''}`.trim(),
      corpo: '', aoFechar: () => { vivo = false; clearTimeout(relogio); },
    });
    if (!ctl) return;

    const pintar = (e) => desenhar(ctl.corpo, ctl, e);
    const acompanhar = async () => {
      if (!vivo) return;
      try {
        const e = await U.ler();
        if (pintar(e) && vivo) relogio = setTimeout(acompanhar, 700);
      } catch (error) {
        if (vivo) { ctl.erro(error.message); }
      }
    };
    const agir = async (alvo, acao) => {
      const solto = D.ui.ocupar(alvo, 'Aguarde…');
      try { await acao(); } catch (error) { solto(); ctl.erro(error.message); return false; }
      return true;
    };

    ctl.raiz.addEventListener('click', async (event) => {
      const alvo = event.target.closest('[data-baixar], [data-reiniciar], [data-tentar]');
      if (!alvo) return;
      if (alvo.hasAttribute('data-baixar')) {
        if (await agir(alvo, () => CC.api('/update/download', { method: 'POST' }))) acompanhar();
      } else if (alvo.hasAttribute('data-tentar')) {
        if (await agir(alvo, () => CC.api('/update/check'))) acompanhar();
      } else {
        const sim = await D.confirmar({ titulo: 'Reiniciar e instalar agora?', texto: 'O aplicativo vai fechar por alguns instantes. Termine o que estiver aberto antes de continuar.', ok: 'Reiniciar e instalar', cancelar: 'Agora não', tom: 'aviso', icone: 'arrow-clockwise' });
        if (!sim) return;
        if (await agir(alvo, () => CC.api('/update/install', { method: 'POST' }))) { vivo = false; pintar({ status: 'installing' }); U.estado = { ...(U.estado || {}), status: 'installing' }; U.pintar(); }
      }
    });

    pintar(U.estado || { status: 'idle' });
    acompanhar();
  };
})(window.CC);
