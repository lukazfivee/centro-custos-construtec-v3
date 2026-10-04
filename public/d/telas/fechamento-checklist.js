// Fechamento mensal (D7, prints 70 e 72): coluna "Antes de fechar" com o checklist do mes aberto
// ou "Registrado no fechamento" com as pendencias gravadas no mes fechado. Cada item tem "Ver".
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const U = D.ui;
  const F = D.fech = D.fech || {};

  const ICONE = { pendente: ['warning', 'warn'], ok: ['check', 'ok'], info: ['info', 'info'], indisponivel: ['cloud-slash', 'mudo'] };
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  F.plural = plural;

  // Checklist do servidor mais a fila deste computador (o celular guarda a fila no aparelho).
  F.checklist = async function (ano, mes) {
    const { data } = await CC.api(`/fechamento-mensal/checklist?ano=${ano}&mes=${mes}`);
    const fila = CC.queue && CC.queue.mine ? (await CC.queue.mine()).length : 0;
    const itemFila = fila > 0
      ? { chave: 'fila', situacao: 'pendente', quantidade: fila, titulo: plural(fila, 'lançamento na fila deste computador', 'lançamentos na fila deste computador'), detalhe: 'Esperando internet para ser enviado. Envie antes de fechar.' }
      : { chave: 'fila', situacao: 'ok', quantidade: 0, titulo: 'Fila deste computador vazia', detalhe: 'Nenhum lançamento esperando internet neste computador.' };
    const itens = [...data.itens];
    itens.splice(3, 0, itemFila);
    return { ...data, itens, total_pendencias: itens.filter((i) => i.situacao === 'pendente').length };
  };

  // O que o administrador aceitou ao fechar (vai para o fechamento e para o Historico).
  F.pendenciasDe = (lista) => lista.itens.filter((i) => i.situacao === 'pendente')
    .map(({ chave, titulo, quantidade, valor, detalhe }) => ({ chave, titulo, quantidade, ...(valor == null ? {} : { valor }), detalhe }));

  // Leva para a lista ja filtrada: Lancamentos (filtros guardados), Cobrancas ou Recorrentes.
  F.ver = function (chave, ano, mes) {
    const L = D.lanc;
    const competencia = F.chave(ano, mes);
    const lancamentos = (filtros) => { L.guardarFiltros({ ...L.padrao(), mes: competencia, mais: !!filtros.doc, ...filtros }); D.ir('lancamentos'); };
    if (chave === 'vencidas') lancamentos({ tipo: 'despesa', sit: 'vencidos' });
    else if (chave === 'sem_documento') lancamentos({ tipo: 'despesa', sit: 'pagos', doc: 'sem' });
    else if (chave === 'em_aberto') lancamentos({ sit: 'pendentes' });
    else if (chave === 'cobrancas') D.ir('cobrancas?filtro=pendentes');
    else if (chave === 'recorrentes') D.ir('recorrentes');
  };

  const podeVer = (chave) => ({ vencidas: true, sem_documento: true, em_aberto: true, cobrancas: D.pode('cobrancas'), recorrentes: D.pode('recorrentes') })[chave] === true;

  function linha(item) {
    const [icone, tom] = ICONE[item.situacao] || ICONE.ok;
    const ver = item.situacao !== 'ok' && podeVer(item.chave)
      ? `<button type="button" class="btn btn-g" data-ver="${esc(item.chave)}" aria-label="Ver: ${esc(item.titulo)}">Ver</button>` : '';
    return `<li class="ck-item"><span class="ck-ic ${tom}">${D.ic(icone)}</span>
      <div class="dois-tx"><b>${esc(item.titulo)}</b><span>${esc(item.detalhe || '')}</span></div>${ver}</li>`;
  }

  const NOTA = 'Pendências não impedem o fechamento, mas ficam registradas. Só administrador fecha e reabre; reabrir pede um motivo e vai para o Histórico.';

  function ligarVer(lado, ano, mes) {
    CC.$$('[data-ver]', lado).forEach((b) => b.addEventListener('click', () => F.ver(b.dataset.ver, ano, mes)));
  }

  // Mes aberto: busca o checklist e desenha. Devolve a lista (ou null se falhou).
  F.painelChecklist = async function (lado, ano, mes, vivo) {
    const nome = F.mesNome(ano, mes).toLowerCase();
    lado.innerHTML = `<div class="topo"><b>Antes de fechar ${esc(nome)}</b></div>${U.carregando('Conferindo o mês…')}`;
    let lista;
    try { lista = await F.checklist(ano, mes); } catch (error) {
      if (vivo()) lado.innerHTML = `<div class="topo"><b>Antes de fechar ${esc(nome)}</b></div>${U.faixa('err', 'warning-circle', error.status === 0 ? 'Sem internet. O checklist precisa da conexão.' : error.message)}`;
      return null;
    }
    if (!vivo()) return null;
    const n = lista.total_pendencias;
    lado.innerHTML = `<div class="topo"><b>Antes de fechar ${esc(nome)}</b>${U.chip(n ? `${n} pendência(s)` : 'Tudo certo', n ? 'warn' : 'ok')}</div>
      <ul class="ck">${lista.itens.map(linha).join('')}</ul><p class="nota">${esc(NOTA)}</p>`;
    ligarVer(lado, ano, mes);
    return lista;
  };

  // Mes fechado: mostra o que ficou registrado no fechamento.
  F.painelRegistrado = function (lado, mes) {
    const lista = mes.pendencias || [];
    const itens = lista.length
      ? lista.map((p) => linha({ chave: p.chave, situacao: 'pendente', titulo: p.titulo, detalhe: p.detalhe })).join('')
      : linha({ chave: 'nenhuma', situacao: 'ok', titulo: 'Fechado sem pendências registradas', detalhe: 'Nada ficou em aberto no checklist quando o mês foi fechado.' });
    lado.innerHTML = `<div class="topo"><b>Registrado no fechamento</b>${lista.length ? U.chip(`${lista.length} pendência(s)`, 'warn') : ''}</div>
      <ul class="ck">${itens}</ul><p class="nota">${esc(NOTA)}</p>`;
    ligarVer(lado, mes.ano, mes.mes);
  };
})(window.CC);
