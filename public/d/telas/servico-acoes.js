// Acoes do servico: Iniciar, Concluir (28Dt, confere checklist, fotos e aceite), Faturar (28Dv a 28Dx)
// e Relatorio do servico (28Dm: HTML de 1 pagina do servidor, para imprimir ou salvar em PDF).
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const U = D.ui;
  const S = D.serv = D.serv || {};

  S.iniciar = async (sv, botao, aoMudar) => {
    const voltar = U.ocupar(botao, 'Iniciando…');
    try {
      await CC.api(`/servicos/${sv.id}/situacao`, { method: 'PUT', body: { situacao: 'em_andamento' } });
      CC.toast(`${sv.codigo} em andamento`);
      aoMudar();
    } catch (error) { voltar(); CC.toast(S.erro(error, 'A situação não mudou.'), 'warning'); }
  };

  // Linhas do Concluir: checklist, fotos e aceite, com o que falta.
  function conferencia(sv, pendencias) {
    const itens = sv.checklist || [];
    const feitos = itens.filter((i) => i.feito).length;
    const fotos = sv.fotos || [];
    const antes = fotos.filter((f) => f.fase === 'antes').length;
    const tem = (cod) => pendencias.some((p) => p.codigo === cod);
    const linhas = [
      ['list-checks', 'Checklist', itens.length ? `${feitos} de ${itens.length}${tem('checklist_incompleto') ? ' · faltam itens' : ' feitos'}` : 'Sem itens', !tem('checklist_incompleto')],
      ['images', 'Fotos', `${antes} antes · ${fotos.length - antes} depois`, !tem('sem_foto_antes') && !tem('sem_foto_depois')],
      ['signature', 'Aceite do cliente', sv.aceite ? `Assinado por ${sv.aceite.nome}` : 'Ainda não coletado no celular', !tem('sem_aceite')],
    ];
    const faltam = pendencias.find((p) => p.codigo === 'checklist_incompleto');
    return `<div class="conferencia">${linhas.map(([ic, t, s, ok]) => `<div class="cf">${D.ic(ic, 20)}<span class="duas-l"><b>${esc(t)}</b><span>${esc(s)}</span></span>
        <span class="${ok ? 'ok' : 'warn'}">${D.ic(ok ? 'check-circle' : 'warning-circle', 20)}</span></div>`).join('')}</div>
      ${faltam && faltam.itens && faltam.itens.length ? `<div class="fld"><span>Itens não feitos</span><ul class="faltam">${faltam.itens.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
      ${pendencias.length ? U.faixa('warn', 'warning', `${pendencias.map((p) => p.mensagem).join(' ')} Dá para concluir mesmo assim; as pendências ficam registradas.`) : U.faixa('ok', 'check-circle', 'Tudo certo para concluir. Depois de concluir, o escritório fatura o serviço.')}`;
  }

  S.concluir = async (sv, aoMudar) => {
    let pendencias = sv.pendencias || [];
    try { ({ data: { pendencias } } = await CC.api(`/servicos/${sv.id}/pendencias`)); } catch (e) { /* usa as do detalhe */ }
    let enviando = false;
    const rotulo = () => (pendencias.length ? 'Concluir com pendências' : 'Concluir serviço');
    const ctl = await D.painel.abrir({
      icone: 'check-circle', titulo: 'Concluir o serviço?', sub: `${sv.codigo} · ${sv.nome}`,
      corpo: conferencia(sv, pendencias),
      rodape: `<button type="button" class="btn btn-s" data-fechar>Voltar</button><button type="button" class="btn btn-p" data-salvar>${D.ic('check-circle')}${esc(rotulo())}</button>`,
    });
    if (!ctl) return;
    const bt = CC.$('[data-salvar]', ctl.rodape);
    bt.addEventListener('click', async () => {
      if (enviando) return;
      enviando = true;
      const voltar = U.ocupar(bt, 'Concluindo…');
      try {
        await CC.api(`/servicos/${sv.id}/concluir`, { method: 'POST', body: { comPendencias: pendencias.length > 0 } });
        ctl.fechar(true);
        CC.toast(pendencias.length ? `${sv.codigo} concluído com pendências` : `${sv.codigo} concluído`);
        aoMudar();
      } catch (error) {
        voltar();
        // Algo mudou desde a conferencia (ex.: o tecnico desmarcou um item): mostra a lista nova.
        if (error.status === 409 && /pend/i.test(error.message)) {
          try { ({ data: { pendencias } } = await CC.api(`/servicos/${sv.id}/pendencias`)); } catch (e) { /* mantem */ }
          ctl.desenhar(conferencia(sv, pendencias));
          bt.innerHTML = `${D.ic('check-circle')}${esc(rotulo())}`;
        }
        ctl.erro(S.erro(error, 'Nada foi alterado. Confira a conexão e tente de novo.'));
      } finally { enviando = false; }
    });
  };

  const VENC = [{ valor: '0', rotulo: 'À vista' }, { valor: '15', rotulo: '15 dias' }, { valor: '30', rotulo: '30 dias' }];
  const FORMAS = [{ valor: 'pix', rotulo: 'Pix' }, { valor: 'boleto', rotulo: 'Boleto' }, { valor: 'transferencia', rotulo: 'Transferência' }];
  const somarDias = (dias) => { const d = new Date(); d.setDate(d.getDate() + Number(dias)); return d.toLocaleDateString('pt-BR'); };

  S.faturar = async (sv, aoMudar) => {
    const f = { venc: '15', forma: 'pix', nfse: '', pdf: null };
    let enviando = false;
    const desenhar = (ctl) => {
      ctl.desenhar(`<form class="form-lanc" novalidate>
        <div class="card resumo-ok"><span><span class="muted">Valor</span><b>${esc(CC.money(sv.valor))}</b></span><span><span class="muted">Cliente</span><b>${esc(sv.cliente)}</b></span></div>
        <div class="fld"><span>Vencimento</span>${U.seg('venc', VENC, f.venc, 'Vencimento')}</div>
        <div class="fld"><span>Forma de pagamento</span>${U.seg('forma', FORMAS, f.forma, 'Forma de pagamento')}</div>
        ${U.campo({ rotulo: 'Número da NFS-e', name: 'nfse', valor: f.nfse, placeholder: 'Ex.: NFS-e 1.205 (opcional)' })}
        <div class="fld"><span>PDF da NFS-e</span>${f.pdf ? `<div class="recibo-sv">${D.ic('file-pdf', 20)}<span class="duas-l"><b>${esc(f.pdf.nome)}</b><span>Vai para os anexos do serviço</span></span><button type="button" class="btn btn-s" data-tirar-pdf>Remover</button></div>`
          : `<label class="recibo-sv vazio">${D.ic('file-arrow-up', 20)}<span class="duas-l"><b>Anexar o PDF da nota</b><span>Até 5 MB (opcional)</span></span><input type="file" accept="application/pdf" data-pdf hidden></label>`}</div>
        <span class="muted" data-txt-venc>Vence em ${esc(somarDias(f.venc))}. A cobrança aparece em Cobranças e o serviço fica Faturado.</span>
      </form>`);
      const corpo = ctl.corpo;
      CC.$$('[data-seg]', corpo).forEach((b) => b.addEventListener('click', () => {
        f[b.dataset.seg] = b.dataset.valor;
        U.segEscolher(b.parentElement, b);
        CC.$('[data-txt-venc]', corpo).textContent = `Vence em ${somarDias(f.venc)}. A cobrança aparece em Cobranças e o serviço fica Faturado.`;
      }));
      const pdf = CC.$('[data-pdf]', corpo);
      if (pdf) pdf.addEventListener('change', async () => {
        const arq = pdf.files && pdf.files[0];
        if (!arq) return;
        f.nfse = CC.$('[name="nfse"]', corpo).value;
        if (arq.size > 5 * 1024 * 1024) { ctl.erro('O PDF passa de 5 MB.'); return; }
        f.pdf = { nome: arq.name, conteudoBase64: await S.base64(arq) };
        desenhar(ctl);
      });
      const tirar = CC.$('[data-tirar-pdf]', corpo);
      if (tirar) tirar.addEventListener('click', () => { f.nfse = CC.$('[name="nfse"]', corpo).value; f.pdf = null; desenhar(ctl); });
    };
    const ctl = await D.painel.abrir({
      icone: 'receipt', titulo: 'Faturar serviço', sub: `${sv.codigo} · ${sv.nome}`, corpo: (_, c) => desenhar(c),
      rodape: `<button type="button" class="btn btn-s" data-fechar>Cancelar</button><button type="button" class="btn btn-p" data-salvar>${D.ic('receipt')}Gerar cobrança</button>`,
    });
    if (!ctl) return;
    const bt = CC.$('[data-salvar]', ctl.rodape);
    bt.addEventListener('click', async () => {
      if (enviando) return;
      f.nfse = CC.$('[name="nfse"]', ctl.corpo).value.trim();
      enviando = true;
      ctl.erro('');
      const voltar = U.ocupar(bt, 'Gerando a cobrança…');
      const nfse = f.nfse || f.pdf ? { numero: f.nfse || undefined, arquivo: f.pdf || undefined } : undefined;
      try {
        const { data } = await CC.api(`/servicos/${sv.id}/faturar`, { method: 'POST', body: { vencimentoDias: Number(f.venc), forma: f.forma, nfse } });
        ctl.marcarSalvo();
        ctl.fechar(true);
        CC.toast(`Cobrança criada · ${sv.codigo} faturado`);
        aoMudar();
        if (data.cobranca && data.cobranca.sincronizada === false) {
          D.avisar('Faturado neste computador', `A linha de Cobranças não foi atualizada${data.cobranca.motivo ? `: ${data.cobranca.motivo}` : ''}. Confira e atualize em Cobranças.`);
        }
      } catch (error) {
        voltar();
        ctl.erro(error.status === 0 ? 'Sem internet. Nada foi alterado. Confira a conexão e tente de novo.' : error.message);
      } finally { enviando = false; }
    });
  };

  // Relatorio: o HTML do servidor num quadro (blob), com Imprimir / PDF.
  S.relatorio = async (sv) => {
    let url;
    try {
      const html = await (await S.baixar(`/api/servicos/${sv.id}/relatorio`)).text();
      url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    } catch (error) {
      CC.toast(S.erro(error, 'O relatório precisa da conexão.'), 'warning');
      return;
    }
    const ctl = await D.painel.abrir({
      icone: 'file-text', titulo: 'Relatório do serviço', sub: `${sv.codigo} · PDF de 1 página para o cliente`,
      corpo: `<iframe class="quadro-rel" title="Relatório do serviço ${esc(sv.codigo)}" src="${url}"></iframe>
        <span class="muted">O relatório mostra o que foi feito, as fotos, o valor e o aceite. Gastos, resultado e margem não aparecem.</span>`,
      rodape: `<button type="button" class="btn btn-s" data-fechar>Fechar</button><button type="button" class="btn btn-p" data-imprimir>${D.ic('printer')}Imprimir / PDF</button>`,
      aoFechar: () => URL.revokeObjectURL(url),
    });
    if (!ctl) { URL.revokeObjectURL(url); return; }
    ctl.raiz.classList.add('largo');
    CC.$('[data-imprimir]', ctl.rodape).addEventListener('click', () => { const q = CC.$('iframe', ctl.corpo); if (q && q.contentWindow) q.contentWindow.print(); });
  };
})(window.CC);
