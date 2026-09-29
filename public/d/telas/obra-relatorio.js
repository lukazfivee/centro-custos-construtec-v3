// Relatorio executivo da obra: resumo financeiro, curva ABC, gastos sem vinculo e planilha de itens,
// com Imprimir / PDF e o CSV do servidor (mesmo conteudo de public/budget-reports.js).
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const O = D.obras = D.obras || {};

  O.relatorio = async function (obra) {
    let cmp;
    try { ({ data: cmp } = await CC.api(`/centros-custo/${obra.id}/orcado-realizado`)); } catch (error) {
      CC.toast(error.status === 0 ? 'Sem internet. O relatório precisa da conexão.' : error.message, 'warning');
      return;
    }
    if (!cmp.hasBudget) { await D.avisar('Sem orçamento importado', 'O relatório executivo usa o orçamento aprovado da obra. Importe a proposta do Orçamentos primeiro.'); return; }
    const s = cmp.summary;
    const ct = cmp.contract || {};
    const h = cmp.laborHours || {};
    const abc = cmp.abcCurve || {};
    const classe = new Map();
    ['a', 'b', 'c'].forEach((k) => (abc[k] || []).forEach((i) => classe.set(i.lineId, k.toUpperCase())));
    const totalAbc = ['a', 'b', 'c'].reduce((t, k) => t + (abc[k] || []).reduce((x, i) => x + Number(i.realizedCost || 0), 0), 0);
    const linhaAbc = (k) => {
      const lista = abc[k] || [];
      const v = lista.reduce((x, i) => x + Number(i.realizedCost || 0), 0);
      return `<tr><td><b>${k.toUpperCase()}</b></td><td class="num">${lista.length}</td><td class="num">${esc(CC.money(v))}</td><td class="num">${totalAbc ? Math.round((v / totalAbc) * 100) : 0}%</td></tr>`;
    };
    const situacao = (i) => (i.isOverBudget ? 'Estourado' : (i.realizedCost > 0 ? 'Em execução' : 'Previsto'));
    const itens = (cmp.items || []).map((i) => `<tr><td>${esc(i.code || '—')}</td><td>${esc(i.name || i.description)}</td><td>${i.kind === 'labor' ? 'Mão de obra' : 'Material'}</td>
      <td class="num">${esc(`${Number(i.budgetedQuantity || 0).toLocaleString('pt-BR')} ${i.unit || ''}`.trim())}</td><td class="num">${esc(CC.money(i.budgetedCost))}</td><td class="num">${esc(CC.money(i.realizedCost))}</td>
      <td class="num">${esc(CC.money(i.variance))}</td><td class="num">${esc(CC.money(i.balance))}</td><td>${classe.get(i.lineId) || '—'}</td><td>${situacao(i)}</td></tr>`).join('');
    const sem = cmp.unmapped || { items: [] };
    const semHtml = sem.items && sem.items.length ? `<h3>Gastos sem vínculo ao orçamento</h3><table class="tbl"><thead><tr><th>Data</th><th>Descrição</th><th class="num">Valor</th></tr></thead><tbody>
      ${sem.items.map((u) => `<tr><td>${esc(D.data(String(u.date || '').slice(0, 10)))}</td><td>${esc(u.description || 'Despesa')}</td><td class="num">${esc(CC.money(u.amount))}</td></tr>`).join('')}</tbody></table>` : '';
    O.imprimir({
      titulo: 'Relatório executivo',
      acoes: '<button type="button" class="btn btn-s" data-csv-rel>CSV</button>',
      conteudo: `${O.cabecalhoFolha('Relatório de controle orçamentário', [
        ['Obra', [obra.codigo, obra.nome].filter(Boolean).join(' · ')], ['Cliente', obra.cliente], ['Responsável', obra.responsavel],
        ['Contrato', [ct.number, ct.baselineVersion != null ? `REV ${String(ct.baselineVersion).padStart(2, '0')}` : ''].filter(Boolean).join(' ')], ['Situação', (O.SITUACAO[obra.situacao] || [''])[0]]])}
        ${O.numerosFolha([['Valor contratual', CC.money(s.contractValue)], ['Custo base', CC.money(s.baseCost)], ['Realizado líquido', CC.money(s.realizedCost)],
          ['Exposição', CC.money(s.exposure)], ['Saldo', CC.money(s.balance), s.balance < 0 ? 'err' : ''], ['Consumo', `${Math.round(Number(s.burnRatePercent || 0))}% · ${Number(h.consumed || 0).toLocaleString('pt-BR')} de ${Number(h.planned || 0).toLocaleString('pt-BR')} h`]])}
        <h3>Curva ABC do realizado</h3><table class="tbl"><thead><tr><th>Classe</th><th class="num">Itens</th><th class="num">Realizado</th><th class="num">% do total</th></tr></thead><tbody>${linhaAbc('a')}${linhaAbc('b')}${linhaAbc('c')}</tbody></table>
        ${semHtml}
        <h3>Planilha de itens</h3><table class="tbl pequena"><thead><tr><th>Código</th><th>Descrição</th><th>Tipo</th><th class="num">Qtd</th><th class="num">Orçado</th><th class="num">Realizado</th><th class="num">Desvio</th><th class="num">Saldo</th><th>ABC</th><th>Status</th></tr></thead><tbody>${itens}</tbody></table>`,
      aoAbrir: (folha) => CC.$('[data-csv-rel]', folha).addEventListener('click', () => O.baixar(`/centros-custo/${obra.id}/orcado-realizado/csv`, `orcado-vs-realizado-${obra.codigo || obra.id}.csv`)),
    });
  };
})(window.CC);
