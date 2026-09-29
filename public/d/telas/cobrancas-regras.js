// Cobrancas (D4): regras de situacao, andamento em 4 passos e indicadores. Uma cobranca por obra
// (decisao do Lucas). Valores vem do Worker em reais; as somas usam centavos com HALF_UP.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const B = D.cobr = D.cobr || {};

  // Data de hoje em Brasilia (AAAA-MM-DD): "vencida" nao pode depender do fuso do computador.
  B.hoje = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const centavos = (x) => Math.round(CC.cents(x) * 100);
  B.reais = (c) => c / 100;
  B.cents = centavos;

  B.pago = (i) => i.financialStatus === 'pago';
  B.vencida = (i) => !B.pago(i) && !!i.dueDate && i.dueDate < B.hoje();
  B.aprovada = (i) => i.operationalStatus !== 'em_execucao';
  // Pendente: falta a NF ou falta enviar (aprovacao, NF ou envio).
  B.pendente = (i) => ['a_faturar', 'nf_emitida'].includes(i.financialStatus);
  B.aguardando = (i) => ['enviada', 'aguardando_pagamento'].includes(i.financialStatus) && !B.vencida(i);

  B.OPERACIONAL = {
    em_execucao: ['Aguardando aprovação', 'warn', 'clock'],
    finalizada: ['Medição aprovada', 'ok', 'check-circle'],
    entregue: ['Obra concluída', 'neutro', 'flag-checkered'],
  };
  B.chipOperacional = (i) => { const [t, tom, ic] = B.OPERACIONAL[i.operationalStatus] || B.OPERACIONAL.em_execucao; return D.ui.chip(t, tom, ic); };
  B.chipFinanceiro = (i) => {
    if (B.pago(i)) return D.ui.chip('Paga', 'ok', 'check');
    if (B.vencida(i)) return D.ui.chip('Vencida', 'err', 'warning');
    const mapa = {
      aguardando_pagamento: ['Aguardando pagamento', 'info', 'hourglass'], enviada: ['E-mail enviado', 'info', 'paper-plane-tilt'],
      nf_emitida: ['NF emitida', 'info', 'file-text'],
      a_faturar: B.aprovada(i) ? ['NF a emitir', 'warn', 'file-plus'] : ['Pendente', 'neutro', 'clock'],
    };
    const [t, tom, ic] = mapa[i.financialStatus] || mapa.a_faturar;
    return D.ui.chip(t, tom, ic);
  };
  B.textoFinanceiro = (i) => {
    if (B.pago(i)) return 'Paga';
    if (B.vencida(i)) return 'Vencida';
    return ({ aguardando_pagamento: 'Aguardando pagamento', enviada: 'E-mail enviado', nf_emitida: 'NF emitida', a_faturar: B.aprovada(i) ? 'NF a emitir' : 'Pendente' })[i.financialStatus] || '';
  };

  // Os 4 passos: medicao aprovada, NF emitida, e-mail enviado, pagamento. "atual" e o primeiro que falta.
  B.passos = (i) => {
    const fin = ['a_faturar', 'nf_emitida', 'enviada', 'aguardando_pagamento', 'pago'].indexOf(i.financialStatus);
    const feitos = [B.aprovada(i), fin >= 1, fin >= 2, fin >= 4];
    const atual = feitos.indexOf(false);
    const venc = B.vencida(i);
    const detalhes = [
      feitos[0] ? (i.completionDate ? `Concluída em ${D.data(i.completionDate)}` : 'Aprovada') : 'Aguardando aprovação do cliente',
      feitos[1] ? (i.invoiceNumber || 'Nota fiscal emitida') : 'Falta emitir a NF',
      feitos[2] ? 'E-mail enviado ao cliente' : 'Falta enviar o e-mail',
      feitos[3] ? 'Pagamento registrado' : (venc ? `Venceu em ${D.data(i.dueDate)} · cobrar de novo` : (i.dueDate ? `Vence em ${D.data(i.dueDate)}` : 'Sem vencimento definido')),
    ];
    const titulos = ['Medição aprovada pelo cliente', 'NF emitida', 'E-mail enviado ao cliente', 'Pagamento recebido'];
    return titulos.map((titulo, n) => ({ titulo, detalhe: detalhes[n], feito: feitos[n], atual: n === atual, vencido: n === 3 && venc && !feitos[3] }));
  };

  B.filtrar = (itens, filtro, busca) => {
    const q = String(busca || '').trim().toLowerCase();
    return itens.filter((i) => {
      if (q && ![i.code, i.name, i.clientName, i.client, i.invoiceNumber].join(' ').toLowerCase().includes(q)) return false;
      if (filtro === 'pendentes') return !B.pago(i) && B.pendente(i);
      if (filtro === 'aguardando') return B.aguardando(i);
      if (filtro === 'vencidas') return B.vencida(i);
      if (filtro === 'pagas') return B.pago(i);
      return true;
    });
  };

  // Indicadores (print 40), em centavos.
  B.indicadores = (itens) => {
    const soma = (lista) => lista.reduce((s, i) => s + centavos(i.receivableAmount), 0);
    const pagas = itens.filter(B.pago);
    const aguard = itens.filter((i) => i.financialStatus === 'aguardando_pagamento');
    const abertas = itens.filter((i) => !B.pago(i));
    return {
      finalizadas: soma(pagas), qtdPagas: pagas.length,
      aguardando: soma(aguard), venceramEntre: aguard.filter(B.vencida).length,
      pendentes: itens.filter((i) => !B.pago(i) && B.pendente(i)).length,
      aReceber: soma(abertas),
      contador: itens.filter((i) => !B.pago(i) && (B.pendente(i) || B.vencida(i))).length,
    };
  };

  // Corpo para PUT /cloud-sync/cobrancas/:id: o registro inteiro com as mudancas por cima.
  B.corpo = (i, mudancas) => ({
    clientName: i.clientName || '', clientEmails: i.clientEmails || [], responsible: i.responsible || '',
    operationalStatus: i.operationalStatus, financialStatus: i.financialStatus, invoiceNumber: i.invoiceNumber || '',
    contractAmount: Number(i.contractAmount || 0), receivableAmount: Number(i.receivableAmount || 0),
    completionDate: i.completionDate || null, dueDate: i.dueDate || null, notes: i.notes || '', ...mudancas,
  });

  B.csv = (itens) => {
    const cel = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const linhas = [['Obra', 'Cliente', 'Situação operacional', 'Situação financeira', 'NF', 'Vencimento', 'Valor a receber']];
    itens.forEach((i) => linhas.push([`${i.code} ${i.name}`, i.clientName || i.client, (B.OPERACIONAL[i.operationalStatus] || [''])[0], B.textoFinanceiro(i), i.invoiceNumber, D.data(i.dueDate), Number(i.receivableAmount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })]));
    return `﻿${linhas.map((l) => l.map(cel).join(';')).join('\r\n')}`;
  };
  B.esc = esc;
})(window.CC);
