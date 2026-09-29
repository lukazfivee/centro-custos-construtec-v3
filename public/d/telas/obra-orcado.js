// Aba Orcado x realizado da obra (print 31): saldo e consumo, indicadores, planilha analitica com
// filtro e CSV, contrato com a proposta em PDF, totais por tipo e gastos sem vinculo.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const O = D.obras = D.obras || {};
  const U = D.ui;
  O.abas = O.abas || {};

  async function baixar(url, nome) {
    try {
      const r = await fetch(`/api${url}`, { headers: { Authorization: `Bearer ${CC.session.token()}` }, cache: 'no-store' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || 'Não foi possível baixar agora.');
      const href = URL.createObjectURL(await r.blob());
      const a = D.el('<a></a>');
      a.href = href;
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 5000);
    } catch (error) {
      CC.toast(String(error.message).includes('fetch') ? 'Sem internet. Baixar precisa da conexão.' : error.message, 'warning');
    }
  }
  O.baixar = baixar;

  const abc = (cmp) => {
    const m = new Map();
    ['a', 'b', 'c'].forEach((k) => ((cmp.abcCurve && cmp.abcCurve[k]) || []).forEach((i) => m.set(i.lineId, k.toUpperCase())));
    return m;
  };
  const desvio = (v) => `<span class="${v > 0 ? 'desvio-mais' : (v < 0 ? 'desvio-menos' : '')}">${v > 0 ? '+' : (v < 0 ? '−' : '')}${esc(CC.money(Math.abs(v)))}</span>`;

  function planilha(cmp, filtro) {
    const classes = abc(cmp);
    const itens = (cmp.items || []).filter((i) => !filtro || i.kind === filtro);
    const linhas = itens.map((i) => {
      const p = i.budgetedCost > 0 ? i.realizedCost / i.budgetedCost : 0;
      const q = Number(i.budgetedQuantity || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
      return { id: i.lineId, celulas: [
        `<span class="duas-l"><b>${esc(i.name || i.description || '—')}</b><span>${esc([i.code, i.kind === 'labor' ? 'Mão de obra' : 'Material'].filter(Boolean).join(' · '))}</span></span>`,
        esc(`${q} ${i.unit || ''}`.trim()), esc(CC.money(i.budgetedCost)), `<b>${esc(CC.money(i.realizedCost))}</b>`, desvio(Number(i.variance) || 0),
        `<span class="bar mini-bar"><span class="${O.faixaUso(p)}" style="width:${Math.min(100, p * 100).toFixed(1)}%"></span></span>`,
        classes.get(i.lineId) ? U.chip(classes.get(i.lineId), 'info') : '<span class="muted">—</span>',
      ] };
    });
    return U.tabela({
      colunas: [{ rotulo: 'Insumo' }, { rotulo: 'Qtd.', num: true }, { rotulo: 'Orçado', num: true }, { rotulo: 'Realizado', num: true }, { rotulo: 'Desvio', num: true }, { rotulo: 'Consumo' }, { rotulo: 'ABC' }],
      linhas, vazio: 'Nenhum item neste filtro.',
    });
  }

  function lado(obra, cmp, proposta) {
    const ct = cmp.contract || {};
    const linha = (k, v) => (v ? `<span><span class="muted">${esc(k)}</span><b>${esc(v)}</b></span>` : '');
    const porTipo = (rotulo, real, orc) => {
      const p = orc > 0 ? real / orc : 0;
      return `<div class="linha-cat"><span class="topo"><span>${esc(rotulo)}</span><span><b>${esc(CC.moneyShort(real))}</b><span class="muted"> / ${esc(CC.moneyShort(orc))}</span></span></span>
        <span class="bar"><span class="${O.faixaUso(p)}" style="width:${Math.min(100, p * 100).toFixed(1)}%"></span></span></div>`;
    };
    const soma = (k) => (cmp.items || []).filter((i) => i.kind === k).reduce((s, i) => s + (Number(i.realizedCost) || 0), 0);
    const semVinculo = cmp.unmapped || { count: 0, totalCost: 0 };
    return `<aside class="lado-obra">
      <section class="card bloco"><b class="bt">Contrato</b><div class="linhas-dl">
        ${linha('Contrato', [ct.number, ct.baselineVersion != null ? `REV ${String(ct.baselineVersion).padStart(2, '0')}` : ''].filter(Boolean).join(' '))}
        ${linha('Cliente', obra.cliente)}${linha('Responsável', obra.responsavel)}${linha('Início', D.data(obra.data_inicio))}${linha('Término previsto', D.data(obra.data_fim))}
        ${linha('Baseline', ct.approvedAt ? 'Aprovada e selada' : '')}</div>
        ${proposta ? `<button type="button" class="btn btn-s" data-proposta>${D.ic('file-pdf')}Proposta aprovada (PDF)</button>` : ''}
        ${D.pode('cadastrar') ? `<button type="button" class="btn btn-g" data-revisao>${D.ic('arrows-clockwise')}Atualizar revisão</button>` : ''}</section>
      <section class="card bloco"><b class="bt">Orçado × realizado por tipo</b>${porTipo('Material', soma('material'), ct.materialsCost || 0)}${porTipo('Mão de obra', soma('labor'), ct.laborCost || 0)}</section>
      ${semVinculo.count ? `<section class="card bloco sem-vinculo"><b class="bt">${D.ic('link-break')}${semVinculo.count} gasto${semVinculo.count === 1 ? '' : 's'} sem vínculo · ${esc(CC.money(semVinculo.totalCost))}</b>
        <span class="muted">Lançamentos da obra que ainda não estão ligados a um insumo da planilha. Vincule para o consumo ficar certo.</span>
        ${D.pode('cadastrar') ? '<button type="button" class="btn btn-s" data-vincular>Vincular a insumos</button>' : ''}</section>` : ''}
    </aside>`;
  }

  O.abas.orcado = async function (corpo, obra, vivo) {
    corpo.innerHTML = U.carregando('Carregando o orçado × realizado…');
    const [cmp, carteira, prop] = await Promise.all([
      CC.api(`/centros-custo/${obra.id}/orcado-realizado`).then((r) => r.data),
      CC.api('/centros-custo/portfolio-summary').then((r) => r.data).catch(() => ({ porObra: [] })),
      CC.api(`/centros-custo/${obra.id}/proposta`).then((r) => r.data.proposta).catch(() => null),
    ]);
    if (!vivo()) return;
    const recarregar = () => { if (vivo()) O.abas.orcado(corpo, obra, vivo); };
    if (!cmp.hasBudget) {
      corpo.innerHTML = `<div class="card">${U.vazio('file-text', 'Esta obra ainda não tem orçamento importado.', 'Importe a proposta aprovada do Orçamentos para ver a planilha, o consumo e a Curva S.')}${D.pode('cadastrar') ? '<div class="centro"><button type="button" class="btn btn-p" data-importar-obra>Importar orçamento</button></div>' : ''}</div>
        <div class="kpis">${U.kpi({ rotulo: 'Realizado', valor: CC.money(obra.total_despesas || 0), icone: 'arrow-up-right', tom: 'saida' })}${U.kpi({ rotulo: 'Contrato', valor: CC.money(obra.valor_contrato || 0), icone: 'handshake' })}${U.kpi({ rotulo: 'Orçamento mensal', valor: CC.money(obra.orcamento || 0), icone: 'calendar-blank' })}</div>`;
      const bi = CC.$('[data-importar-obra]', corpo);
      if (bi) bi.addEventListener('click', () => O.importar(obra.id, recarregar));
      return;
    }
    const s = cmp.summary;
    const p = s.baseCost > 0 ? s.realizedCost / s.baseCost : 0;
    const estado = p > 1 ? ['Estourado', 'err'] : (p > 0.8 ? ['Atenção', 'warn'] : ['Dentro do orçado', 'ok']);
    const maior = (cmp.items || []).filter((i) => i.variance > 0).sort((a, b) => b.variance - a.variance)[0];
    const n = (carteira.porObra || []).find((x) => x.id === obra.id) || {};
    const h = cmp.laborHours || {};
    const horas = (x) => Number(x || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
    corpo.innerHTML = `<div class="grade-obra"><div class="principal">
      <section class="card saldo-obra"><div><span class="lbl">Saldo disponível</span><b class="${s.balance < 0 ? 'err' : ''}">${esc(CC.money(s.balance))}</b><span class="muted">do custo base orçado</span></div>
        <div class="consumo"><span class="topo"><span>Consumo do orçamento <b>${Math.round(p * 100)}%</b></span>${U.chip(estado[0], estado[1])}</span>
          <span class="bar"><span class="${O.faixaUso(p)}" style="width:${Math.min(100, p * 100).toFixed(1)}%"></span></span>
          ${maior ? `<span class="muted">Maior desvio: <b>${esc(maior.name || maior.description)}</b> (+${esc(CC.money(maior.variance))})</span>` : ''}</div></section>
      <div class="kpis cinco">${[
        U.kpi({ rotulo: 'Realizado', valor: CC.money(s.realizedCost), icone: 'arrow-up-right', tom: 'saida' }),
        U.kpi({ rotulo: 'Horas da equipe', valor: `${horas(h.consumed)} / ${horas(h.planned)} h`, icone: 'clock' }),
        U.kpi({ rotulo: 'Contrato', valor: CC.money(s.contractValue), icone: 'handshake' }),
        U.kpi({ rotulo: 'Custo orçado', valor: CC.money(s.baseCost), icone: 'calculator' }),
        U.kpi({ rotulo: 'Faturado', valor: CC.money(n.billed || 0), icone: 'receipt', tom: 'ok' })].join('')}</div>
      <section class="card tabela"><div class="bcab pad"><b>Planilha analítica de itens orçados</b><span class="acoes">
        ${U.seg('kind', [{ valor: '', rotulo: 'Todos' }, { valor: 'material', rotulo: 'Materiais' }, { valor: 'labor', rotulo: 'Mão de obra' }], '', 'Tipo de item')}
        <button type="button" class="btn btn-s" data-csv>${D.ic('download-simple')}CSV</button></span></div><div data-planilha>${planilha(cmp, '')}</div></section>
      </div>${lado(obra, cmp, prop)}</div>`;
    CC.$$('[data-seg="kind"]', corpo).forEach((b) => b.addEventListener('click', () => { U.segEscolher(b.parentElement, b); CC.$('[data-planilha]', corpo).innerHTML = planilha(cmp, b.dataset.valor); }));
    CC.$('[data-csv]', corpo).addEventListener('click', () => baixar(`/centros-custo/${obra.id}/orcado-realizado/csv`, `orcado-vs-realizado-${obra.codigo || obra.id}.csv`));
    const bp = CC.$('[data-proposta]', corpo);
    if (bp) bp.addEventListener('click', () => baixar(`/centros-custo/${obra.id}/proposta/arquivo`, (prop && prop.nome) || 'proposta.pdf'));
    const br = CC.$('[data-revisao]', corpo);
    if (br) br.addEventListener('click', () => O.importar(obra.id, recarregar));
    const bv = CC.$('[data-vincular]', corpo);
    if (bv) bv.addEventListener('click', () => O.vincular(obra, cmp, recarregar));
  };
})(window.CC);
