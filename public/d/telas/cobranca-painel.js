// Painel lateral de uma cobranca (prints 41 e 43): aba Acompanhamento (andamento em 4 passos e proximo passo)
// e aba E-mail ao cliente. Editar dados do acompanhamento fica em cobranca-dados.js.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const B = D.cobr = D.cobr || {};
  const U = D.ui;

  // Salva o acompanhamento inteiro com as mudancas por cima (PUT /cloud-sync/cobrancas/:id).
  B.salvarAcompanhamento = async (item, mudancas) => {
    await CC.api(`/cloud-sync/cobrancas/${encodeURIComponent(item.publicId)}`, { method: 'PUT', body: B.corpo(item, mudancas) });
    Object.assign(item, mudancas);
  };

  function passosHtml(item) {
    return `<ol class="andamento">${B.passos(item).map((p) => `<li class="${p.feito ? 'feito' : ''}${p.atual ? ' atual' : ''}${p.vencido ? ' vencido' : ''}">
      <span class="bolinha">${p.feito ? D.ic('check', 13) : ''}</span><span class="tx"><b>${esc(p.titulo)}</b><span>${esc(p.detalhe)}</span></span></li>`).join('')}</ol>`;
  }

  // Texto e botao do proximo passo, conforme o estado.
  function proximo(item) {
    const passos = B.passos(item);
    const n = passos.findIndex((p) => p.atual);
    if (B.pago(item)) return { texto: 'Cobrança paga. Nada a fazer.', acao: null };
    if (n === 0) return { texto: 'Marcar a medição como aprovada para poder cobrar', acao: 'aprovar', rotulo: 'Marcar aprovada', icone: 'check-circle' };
    if (n === 1) return { texto: 'Emitir a NF para poder cobrar', acao: 'nf', rotulo: 'Emitir NF', icone: 'file-text' };
    if (n === 2) return { texto: 'Preparar o e-mail de cobrança ao cliente', acao: 'email', rotulo: 'Preparar e-mail', icone: 'envelope-simple' };
    return { texto: B.vencida(item) ? 'Cobrança vencida: reenviar ou registrar pagamento' : 'Aguardando o pagamento do cliente', acao: 'pagar', rotulo: 'Registrar pagamento', icone: 'check' };
  }

  function acompanhar(ctl, item, pode, ir) {
    const venc = B.vencida(item);
    const linha = (k, v) => `<span class="dl-linha"><span class="muted">${esc(k)}</span><b>${esc(v)}</b></span>`;
    const prox = proximo(item);
    ctl.desenhar(`<div class="duas resumo-cob"><div class="card"><span class="lbl">Valor</span><b>${esc(CC.money(item.receivableAmount))}</b></div>
        <div class="card"><span class="lbl">Vencimento</span><b class="${venc ? 'vencido' : ''}">${esc(D.data(item.dueDate) || '—')}</b></div></div>
      <div class="linhas-dl">${linha('Cliente', item.clientName || item.client || '—')}${linha('Contato financeiro', (item.clientEmails || []).join(', ') || '—')}
        ${linha('Conclusão', D.data(item.completionDate) || '—')}${linha('Nota fiscal', item.invoiceNumber || 'Ainda não emitida')}${linha('Situação', B.textoFinanceiro(item))}</div>
      <span class="lbl">Andamento</span>${passosHtml(item)}
      <div class="proximo-passo"><span class="tx"><span class="lbl">Próximo passo</span><b>${esc(prox.texto)}</b></span>
        ${pode && prox.acao ? `<button type="button" class="btn btn-p" data-proximo>${D.ic(prox.icone)}${esc(prox.rotulo)}</button>` : ''}</div>
      ${pode ? `<button type="button" class="btn btn-g editar-dados" data-dados>${D.ic('pencil-simple')}Editar dados do acompanhamento</button>` : ''}`);
    const proximoBt = CC.$('[data-proximo]', ctl.corpo);
    if (proximoBt) proximoBt.addEventListener('click', () => executar(ctl, item, prox.acao, ir));
    const dados = CC.$('[data-dados]', ctl.corpo);
    if (dados) dados.addEventListener('click', () => B.formDados(ctl, item, () => ir('acompanhar')));
    ctl.botoes(`<button type="button" class="btn btn-s" data-fechar>Fechar</button><button type="button" class="btn btn-p" data-ir-email>${D.ic('envelope-simple')}E-mail ao cliente</button>`);
    CC.$('[data-ir-email]', ctl.rodape).addEventListener('click', () => ir('email'));
  }

  async function executar(ctl, item, acao, ir) {
    ctl.erro('');
    try {
      if (acao === 'aprovar') {
        await B.salvarAcompanhamento(item, { operationalStatus: 'finalizada' });
        CC.toast('Medição marcada como aprovada');
      } else if (acao === 'nf') {
        if (!String(item.invoiceNumber || '').trim()) { B.formDados(ctl, item, () => ir('acompanhar'), { foco: 'invoiceNumber', aviso: 'Informe o número da NF e escolha a situação NF emitida.' }); return; }
        await B.salvarAcompanhamento(item, { financialStatus: 'nf_emitida' });
        CC.toast('NF marcada como emitida');
      } else if (acao === 'email') { ir('email'); return; } else if (acao === 'pagar') {
        const sim = await D.confirmar({ titulo: 'Registrar o pagamento?', texto: ['A cobrança de ', item.name, ' passa a Paga.'].join(''), ok: 'Registrar pagamento', icone: 'check' }); // o dialogo escapa o texto
        if (!sim) return;
        await B.salvarAcompanhamento(item, { financialStatus: 'pago' });
        CC.toast('Pagamento registrado');
      }
      B.mudou = true;
      ir('acompanhar');
    } catch (error) {
      ctl.erro(error.status === 0 ? 'Sem internet. Atualizar a cobrança precisa da conexão.' : error.message);
    }
  }

  // aba: 'acompanhar' ou 'email'. aoMudar: recarrega a lista se algo mudou.
  B.abrir = async function (item, aba, aoMudar) {
    if (!item) return null;
    const pode = D.pode('cadastrar'); // admin e gestor salvam, autorizam e enviam; supervisor so consulta
    B.mudou = false;
    let ctl;
    let atualAba = aba === 'email' ? 'email' : 'acompanhar';
    const ir = (id) => {
      atualAba = id;
      CC.$$('[data-aba]', ctl.raiz).forEach((b) => b.setAttribute('aria-selected', b.dataset.aba === id ? 'true' : 'false'));
      ctl.cabecalho({ icone: id === 'email' ? 'envelope-simple' : 'list-checks', titulo: item.name, sub: [item.code, item.clientName || item.client].filter(Boolean).join(' · ') });
      ctl.erro('');
      if (id === 'email') B.emailTab(ctl, item, pode, ir); else acompanhar(ctl, item, pode, ir);
    };
    ctl = await D.painel.abrir({
      icone: 'list-checks', titulo: item.name, sub: [item.code, item.clientName || item.client].filter(Boolean).join(' · '),
      abas: [{ id: 'acompanhar', rotulo: 'Acompanhamento' }, { id: 'email', rotulo: 'E-mail ao cliente' }], aba: aba === 'email' ? 'email' : 'acompanhar',
      corpo: '', aoTrocarAba: async (id) => {
        if (id === atualAba) return;
        if (ctl.sujo && !(await D.confirmar({ titulo: 'Descartar as alterações?', texto: 'O que você mudou ainda não foi salvo.', ok: 'Descartar', cancelar: 'Continuar editando', tom: 'aviso', icone: 'warning' }))) {
          CC.$$('[data-aba]', ctl.raiz).forEach((b) => b.setAttribute('aria-selected', b.dataset.aba === atualAba ? 'true' : 'false'));
          return;
        }
        ctl.marcarSalvo();
        ir(id);
      }, aoFechar: () => { if (B.mudou && aoMudar) aoMudar(); },
    });
    if (ctl) ir(aba === 'email' ? 'email' : 'acompanhar');
    return ctl;
  };
})(window.CC);
