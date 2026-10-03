// Detalhe da obra: Resumo, Lancamentos e Caixa. Prototipo: sObra (otResumo, otLanc, otCaixa).
(function (CC) {
  const { esc, icon, money, moneyShort } = CC;
  const TABS = [['resumo', 'Resumo'], ['lanc', 'Lançamentos'], ['caixa', 'Caixa']];

  function amountOf(t) {
    const v = Number(t.valor) * Number(t.sinal_contabil || 1);
    return t.tipo === 'receita' ? v : -v;
  }

  CC.txRow = function (t, extra) {
    const value = amountOf(t);
    const state = t.situacao === 'vencido' ? '<span class="state">Vencida</span>'
      : (t.status_financeiro === 'pendente' ? `<small>${t.tipo === 'receita' ? 'A receber' : 'A pagar'}${t.vencimento ? ` · vence ${esc(CC.dateBr(t.vencimento))}` : ''}</small>` : '');
    return `<div class="tx"><span class="grow"><b>${esc(t.favorecido || t.descricao)}</b><small>${esc(t.favorecido ? t.descricao : (t.categoria || ''))}${extra ? ` · ${esc(extra)}` : ''}</small>${state}</span>
      <span class="amt${value > 0 ? ' in' : ''}">${esc(CC.signed(value))}</span></div>`;
  };

  CC.queuedRows = async function (filterFn) {
    const items = (await CC.queue.mine()).filter(filterFn || (() => true));
    return items.map((i) => CC.txRow({ ...i.payload, favorecido: i.payload.favorecido, situacao: '', status_financeiro: i.payload.status_financeiro },
      i.estado === 'erro' ? 'erro: ' + i.erro : (CC.queue.state.syncing ? 'enviando…' : 'na fila, sem internet'))).join('');
  };

  function byDate(list) {
    let last = '';
    return list.map((t) => {
      const head = t.data !== last ? `<div class="group">${esc(CC.dateFull(t.data))}</div>` : '';
      last = t.data;
      return head + CC.txRow(t);
    }).join('');
  }

  function resumo(c, list) {
    const budget = Number(c.orcamento), spent = Number(c.total_comprometido), contract = Number(c.valor_contrato || 0);
    const p = budget > 0 ? Math.round((spent / budget) * 100) : null;
    const overdue = list.filter((t) => t.situacao === 'vencido');
    const toPay = list.filter((t) => t.status_financeiro === 'pendente' && t.tipo === 'despesa' && t.situacao !== 'vencido');
    const pend = [];
    if (overdue.length) pend.push(['warning-circle', overdue.length === 1 ? '1 conta vencida' : `${overdue.length} contas vencidas`, money(overdue.reduce((s, t) => s + Number(t.valor), 0))]);
    if (p !== null && p > 100) pend.push(['trend-up', 'Custo acima do orçado', `${p}% do orçado`]);
    if (toPay.length) pend.push(['calendar-blank', toPay.length === 1 ? '1 conta a pagar' : `${toPay.length} contas a pagar`, money(toPay.reduce((s, t) => s + Number(t.valor), 0))]);
    return `<div class="card"><span class="label">Resultado até agora</span>
        <div class="big">${esc(CC.signed(Number(c.total_receitas) - Number(c.total_despesas)))}</div>
        ${contract ? `<div class="kv"><span>Contrato (receita)</span><b>${esc(money(contract))}</b></div>` : ''}
        <div class="kv"><span>Custo orçado</span><b>${budget > 0 ? esc(money(budget)) : 'Sem orçamento'}</b></div>
        <div class="kv"><span>Gasto (comprometido)</span><b${p !== null && p > 100 ? ' style="color:var(--warn)"' : ''}>${esc(money(spent))}</b></div>
        <div class="kv"><span>Pago</span><b>${esc(money(c.total_despesas))}</b></div>
        <div class="kv"><span>Recebido</span><b>${esc(money(c.total_receitas))}</b></div>
        ${p === null ? '' : `<div class="bar${p > 100 ? ' warn' : ''}" style="margin-top:8px"><span style="width:${Math.min(100, p)}%"></span></div>
        <small class="muted">Gasto em relação ao custo orçado · ${p}%</small>`}</div>
      <span class="label">Resolver nesta obra</span>
      ${pend.length ? pend.map(([ic, t, v]) => `<div class="card task hot"><span class="ic">${icon(ic, 18)}</span><span class="txt"><b>${esc(t)}</b><small>${esc(v)}</small></span></div>`).join('')
        : `<div class="empty">${icon('check-circle', 24)}Nada pendente nesta obra.</div>`}`;
  }

  function caixa(list) {
    const open = list.filter((t) => t.status_financeiro === 'pendente').sort((a, b) => String(a.vencimento || a.data).localeCompare(String(b.vencimento || b.data)));
    return open.length ? `<div>${open.map((t) => CC.txRow(t)).join('')}</div>` : `<div class="empty">${icon('check-circle', 24)}Nenhuma conta em aberto.</div>`;
  }

  CC.screens.obra = async function (params) {
    const id = Number(params && params.id);
    const tab = (params && params.tab) || 'resumo';
    const el = CC.render(`<div class="top obra-top"><button class="back" type="button" id="voltar" aria-label="Voltar">${icon('caret-left', 20)}</button><h1>Obra</h1></div><div class="skeleton"></div>`, true);
    CC.$('#voltar', el).addEventListener('click', () => CC.go('obras'));
    let result;
    try {
      result = await CC.cached(`obra-${id}`, `/centros-custo/${id}/detalhes?mes=${CC.month()}`);
    } catch (error) {
      return CC.errorScreen(el, error, () => CC.screens.obra(params));
    }
    const c = result.data.centro, list = result.data.lancamentos || [];
    if (CC.suite) CC.suite.context = { proposta: c.proposta_origem || null };
    const queued = tab === 'lanc' ? await CC.queuedRows((i) => Number(i.payload.cost_center_id) === id) : '';
    const body = tab === 'resumo' ? resumo(c, list)
      : (tab === 'caixa' ? caixa(list)
        : (list.length || queued ? `${queued}${byDate(list)}` : `<div class="empty">${icon('receipt', 28)}Nenhum lançamento nesta obra ainda.</div>`));
    CC.render(`<div class="top obra-top"><button class="back" type="button" id="voltar" aria-label="Voltar">${icon('caret-left', 20)}</button>
        <span class="grow"><h1>${esc(c.nome)}</h1><small class="muted">${esc([c.cliente, c.codigo].filter(Boolean).join(' · '))}</small></span>
        ${CC.obraMenu ? `<button class="back" type="button" id="obra-mais" aria-label="Mais ações da obra" aria-haspopup="dialog">${icon('dots-three', 22)}</button>` : ''}${CC.bellBtn ? CC.bellBtn() : ''}${CC.suitePill()}</div>
      ${CC.staleNote(result)}
      <div class="seg" role="group" aria-label="Seções da obra">${TABS.map(([k, label]) => `<button type="button" data-tab="${k}" aria-pressed="${k === tab}">${label}</button>`).join('')}</div>
      ${body}
      <div class="actions"><button class="btn" type="button" id="lancar">${icon('camera', 18)}Lançar despesa</button></div>`, true, params);
    CC.$('#voltar').addEventListener('click', () => CC.go('obras'));
    CC.$$('[data-tab]').forEach((b) => b.addEventListener('click', () => CC.screens.obra({ id, tab: b.dataset.tab })));
    const mais = CC.$('#obra-mais');
    if (mais) mais.addEventListener('click', () => CC.obraMenu(c));
    CC.$('#lancar').addEventListener('click', () => CC.go('lancar', { obraId: id, from: ['obra', { id, tab: 'lanc' }] }));
  };
})(window.CC = window.CC || {});
