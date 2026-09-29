// Editar os dados do acompanhamento de uma cobranca (mesmos campos e validacoes do Worker).
// voltar(): volta para a aba Acompanhamento (depois de salvar ou cancelar). opcoes: { foco, aviso }.
(function (CC) {
  const D = CC.d;
  const B = D.cobr = D.cobr || {};
  const U = D.ui;
  const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
  const brl = (n) => (Number(n) ? Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
  const OP = [['em_execucao', 'Aguardando aprovação'], ['finalizada', 'Medição aprovada'], ['entregue', 'Obra concluída']];
  const FIN = [['a_faturar', 'A faturar'], ['nf_emitida', 'NF emitida'], ['enviada', 'E-mail enviado'], ['aguardando_pagamento', 'Aguardando pagamento'], ['pago', 'Paga']];
  const opc = (lista) => lista.map(([valor, rotulo]) => ({ valor, rotulo }));

  B.formDados = async function (ctl, item, voltar, opcoes) {
    const o = opcoes || {};
    let clientes = [];
    try { clientes = ((await CC.api('/cloud-sync/clientes')).data.clients || []).filter((c) => c.active !== false); } catch { /* segue sem a lista de cadastrados */ }
    ctl.desenhar(`${o.aviso ? U.faixa('info', 'info', o.aviso) : ''}<form class="form-lanc" novalidate>
      ${clientes.length ? U.campo({ rotulo: 'Cliente cadastrado', name: 'cadastrado', tipo: 'select', valor: '', opcoes: [{ valor: '', rotulo: 'Escolher um cliente cadastrado' }, ...clientes.map((c) => ({ valor: c.id, rotulo: [c.company, c.name].filter(Boolean).join(' · ') }))] }) : ''}
      ${U.campo({ rotulo: 'Cliente', name: 'clientName', valor: item.clientName })}
      ${U.campo({ rotulo: 'E-mails do cliente', name: 'clientEmails', valor: (item.clientEmails || []).join(', '), placeholder: 'financeiro@cliente.com.br, outro@cliente.com.br', ajuda: 'Até 15, separados por vírgula' })}
      <div class="duas">${U.campo({ rotulo: 'Responsável', name: 'responsible', valor: item.responsible })}${U.campo({ rotulo: 'Número da NF', name: 'invoiceNumber', valor: item.invoiceNumber, placeholder: 'Ex.: 2.199' })}</div>
      <div class="duas">${U.campo({ rotulo: 'Situação operacional', name: 'operationalStatus', tipo: 'select', valor: item.operationalStatus, opcoes: opc(OP) })}
        ${U.campo({ rotulo: 'Situação financeira', name: 'financialStatus', tipo: 'select', valor: item.financialStatus, opcoes: opc(FIN) })}</div>
      <div class="duas">${U.campo({ rotulo: 'Valor do contrato (R$)', name: 'contractAmount', valor: brl(item.contractAmount) })}${U.campo({ rotulo: 'Valor a receber (R$)', name: 'receivableAmount', valor: brl(item.receivableAmount) })}</div>
      <div class="duas">${U.campo({ rotulo: 'Conclusão', name: 'completionDate', tipo: 'date', valor: item.completionDate })}${U.campo({ rotulo: 'Vencimento', name: 'dueDate', tipo: 'date', valor: item.dueDate })}</div>
      ${U.campo({ rotulo: 'Observações', name: 'notes', tipo: 'textarea', valor: item.notes })}</form>`);
    ctl.botoes(`<button type="button" class="btn btn-s" data-voltar>Cancelar</button><button type="button" class="btn btn-p" data-salvar-dados>${D.ic('check')}Salvar dados</button>`);
    const corpo = ctl.corpo;
    const v = (n) => (CC.$(`[name="${n}"]`, corpo) || {}).value || '';
    const sel = CC.$('[name="cadastrado"]', corpo);
    if (sel) sel.addEventListener('change', () => {
      const c = clientes.find((x) => String(x.id) === sel.value);
      if (!c) return;
      CC.$('[name="clientName"]', corpo).value = c.company || c.name || '';
      const campo = CC.$('[name="clientEmails"]', corpo);
      const emails = new Set(campo.value.split(/[,;\s]+/).filter(Boolean));
      if (c.email) emails.add(c.email.toLowerCase());
      campo.value = [...emails].join(', ');
    });
    if (o.foco) { const f = CC.$(`[name="${o.foco}"]`, corpo); if (f) f.focus(); }
    CC.$('[data-voltar]', ctl.rodape).addEventListener('click', async () => { if (ctl.sujo && !(await D.confirmar({ titulo: 'Descartar as alterações?', texto: 'O que você mudou ainda não foi salvo.', ok: 'Descartar', cancelar: 'Continuar editando', tom: 'aviso', icone: 'warning' }))) return; ctl.marcarSalvo(); voltar(); });
    let enviando = false;
    CC.$('[data-salvar-dados]', ctl.rodape).addEventListener('click', async () => {
      if (enviando) return;
      const emails = [...new Set(v('clientEmails').split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
      const contrato = v('contractAmount').trim() === '' ? 0 : CC.parseMoney(v('contractAmount'));
      const receber = v('receivableAmount').trim() === '' ? 0 : CC.parseMoney(v('receivableAmount'));
      const erros = {};
      if (emails.some((e) => !EMAIL.test(e))) erros.clientEmails = `E-mail inválido: ${emails.find((e) => !EMAIL.test(e))}`;
      else if (emails.length > 15) erros.clientEmails = 'No máximo 15 e-mails.';
      if (!(contrato >= 0)) erros.contractAmount = 'Valor inválido.';
      if (!(receber >= 0)) erros.receivableAmount = 'Valor inválido.';
      if (v('financialStatus') === 'nf_emitida' && !v('invoiceNumber').trim()) erros.invoiceNumber = 'Informe o número da NF.';
      ctl.errosCampos(erros);
      if (Object.keys(erros).length) { ctl.erro(Object.values(erros)[0]); return; }
      ctl.erro('');
      enviando = true;
      try {
        await B.salvarAcompanhamento(item, {
          clientName: v('clientName').trim(), clientEmails: emails, responsible: v('responsible').trim(), invoiceNumber: v('invoiceNumber').trim(),
          operationalStatus: v('operationalStatus'), financialStatus: v('financialStatus'), contractAmount: contrato, receivableAmount: receber,
          completionDate: v('completionDate') || null, dueDate: v('dueDate') || null, notes: v('notes').trim(),
        });
        B.mudou = true;
        ctl.marcarSalvo();
        CC.toast('Dados da cobrança salvos');
        voltar();
      } catch (error) {
        ctl.erro(error.status === 0 ? 'Sem internet. Salvar precisa da conexão.' : error.message);
      } finally {
        enviando = false;
      }
    });
  };
})(window.CC);
