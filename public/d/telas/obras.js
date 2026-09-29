// Obras (D3a, print 30): indicadores da carteira, alerta das obras acima de 80%, filtro por situacao
// e cartoes. Numeros do GET /centros-custo/portfolio-summary (os mesmos do cockpit atual).
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const O = D.obras = D.obras || {};
  const U = D.ui;

  O.SITUACAO = {
    execucao: ['Em execução', 'ok'], planejamento: ['Planejamento', 'info'], pausado: ['Pausada', 'warn'], concluido: ['Concluída', 'neutro'],
  };
  O.chipSituacao = (s) => { const [t, tom] = O.SITUACAO[s] || O.SITUACAO.planejamento; return U.chip(t, tom); };
  O.faixaUso = (p) => (p > 1 ? 'estourado' : (p > 0.8 ? 'alerta' : 'normal'));
  const pct = (x) => `${Math.round(x * 100)}%`;
  const FILTROS = [['', 'Todas'], ['execucao', 'Em execução'], ['planejamento', 'Planejamento'], ['pausado', 'Pausadas'], ['concluido', 'Concluídas']];
  let filtro = '';

  function kpis(p, obras) {
    const k = U.kpi;
    const exec = (p.statusCounts && p.statusCounts.execucao) || 0;
    const horas = p.laborHours || { consumed: 0, planned: 0 };
    const fat = p.clientBilling || { totalBilled: 0 };
    const n = (x) => Number(x || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
    return [
      k({ rotulo: 'Obras na carteira', valor: String(p.totalCenters != null ? p.totalCenters : obras.length), det: `${exec} em execução`, icone: 'buildings', tom: 'info' }),
      k({ rotulo: 'Valor contratual', valor: CC.moneyShort(p.totalContractValue), det: 'soma dos contratos', icone: 'handshake', tom: 'info' }),
      k({ rotulo: 'Realizado', valor: CC.moneyShort(p.totalRealizedCost), det: `${n(p.burnRatePercent)}% do orçado total`, icone: 'arrow-up-right', tom: 'saida' }),
      k({ rotulo: 'Saldo da carteira', valor: CC.moneyShort(p.totalBalance), det: 'orçado − realizado', icone: 'scales', tom: p.totalBalance < 0 ? 'err' : 'ok', tomValor: p.totalBalance < 0 ? 'err' : '' }),
      k({ rotulo: 'Horas medidas', valor: `${n(horas.consumed)} h`, det: `de ${n(horas.planned)} h planejadas`, icone: 'clock', tom: 'info' }),
      k({ rotulo: 'Faturado', valor: CC.moneyShort(fat.totalBilled), det: p.totalContractValue > 0 ? `${n((fat.totalBilled / p.totalContractValue) * 100)}% do contratado` : 'sem contrato importado', icone: 'receipt', tom: 'ok' }),
    ].join('');
  }

  function alerta(p) {
    const risco = (p.atRiskCenters || []).slice().sort((a, b) => b.burnRate - a.burnRate);
    if (!risco.length) return '';
    const texto = risco.map((c) => `${c.name} está em ${Math.round(c.burnRate)}% do orçado${c.isOverBudget ? ' (estourado)' : ''}`).join('; ');
    return `<div class="faixa warn alerta-carteira" role="status">${D.ic('warning')}<span><b>Atenção na carteira:</b> ${esc(texto)}.</span>
      <a class="btn btn-s" href="#/obras/${esc(risco[0].id)}">Abrir obra</a></div>`;
  }

  function cartao(o, numeros) {
    const n = numeros.get(o.id) || {};
    const uso = n.baseCost > 0 ? n.realizedCost / n.baseCost : null;
    const medido = n.contractValue > 0 ? n.billed / n.contractValue : null;
    const barra = (rotulo, p, cls) => `<span class="uso-linha"><span class="topo"><span>${esc(rotulo)}</span><b class="${p > 1 ? 'err' : ''}">${p == null ? '—' : pct(p)}</b></span>
      <span class="bar"><span class="${cls}" style="width:${p == null ? 0 : Math.min(100, p * 100).toFixed(1)}%"></span></span></span>`;
    const real = n.realizedCost != null ? n.realizedCost : Number(o.total_despesas || 0);
    return `<article class="card cartao-obra">
      <div class="topo">${U.chip(o.codigo || '—', 'info')}${O.chipSituacao(o.situacao)}</div>
      <div class="tx"><b>${esc(o.nome)}</b><span class="muted">${esc(o.cliente || 'Sem cliente')}</span></div>
      ${barra('Consumo do orçado', uso, uso == null ? '' : O.faixaUso(uso))}
      ${barra('Medido ao cliente', medido, 'medido')}
      <div class="valores"><span><span class="lbl">Realizado</span><b>${esc(CC.moneyShort(real))}</b></span>
        <span><span class="lbl">Contratado</span><b>${esc(CC.moneyShort(Number(o.valor_contrato || n.contractValue || 0)))}</b></span></div>
      <div class="bts"><a class="btn btn-p" href="#/obras/${esc(o.id)}">Abrir obra</a>
        ${D.pode('cadastrar') ? `<button type="button" class="btn btn-s" data-editar="${esc(o.id)}">Editar</button>` : ''}</div></article>`;
  }

  async function render(el, rota, vivo) {
    el.innerHTML = `<div class="pagina obras">
      ${U.cabecalho({ grupo: 'Operação', titulo: 'Obras e centros de custo', sub: 'Carteira da Construtec · orçado, realizado e medição por obra',
        acoes: D.pode('cadastrar') ? `<button type="button" class="btn btn-s" data-importar>${D.ic('file-arrow-up')}Importar orçamento</button><button type="button" class="btn btn-p" data-nova>${D.ic('plus')}Nova obra</button>` : '' })}
      <div data-corpo>${U.carregando('Carregando a carteira…')}</div></div>`;
    const nova = CC.$('[data-nova]', el);
    if (nova) nova.addEventListener('click', () => O.formulario(null, () => render(el, rota, vivo)));
    const importar = CC.$('[data-importar]', el);
    if (importar) importar.addEventListener('click', () => O.importar(null, (r) => (r && r.costCenterId ? D.ir(`obras/${r.costCenterId}`) : render(el, rota, vivo))));
    const [lista, resumo] = await Promise.all([
      CC.api('/centros-custo').then((r) => (Array.isArray(r.data) ? r.data : [])),
      CC.api('/centros-custo/portfolio-summary').then((r) => r.data).catch(() => ({ portfolio: {}, porObra: [] })),
    ]);
    if (!vivo()) return;
    const p = resumo.portfolio || {};
    const numeros = new Map((resumo.porObra || []).map((x) => [x.id, x]));
    const ativas = lista.filter((o) => o.ativo !== false);
    const pintar = () => {
      const vis = ativas.filter((o) => !filtro || o.situacao === filtro);
      CC.$('[data-cartoes]', el).innerHTML = vis.length ? vis.map((o) => cartao(o, numeros)).join('') : U.vazio('buildings', 'Nenhuma obra nesta situação.');
      CC.$('[data-conta]', el).textContent = `${vis.length} de ${ativas.length} obras`;
      CC.$$('[data-editar]', el).forEach((b) => b.addEventListener('click', () => O.formulario(lista.find((o) => String(o.id) === b.dataset.editar), () => render(el, rota, vivo))));
    };
    CC.$('[data-corpo]', el).innerHTML = `<div class="kpis seis">${kpis(p, ativas)}</div>${alerta(p)}
      <div class="barra-filtro">${U.seg('situacao', FILTROS.map(([valor, rotulo]) => ({ valor, rotulo })), filtro, 'Situação da obra')}<span class="muted" data-conta></span></div>
      <div class="grade-obras" data-cartoes></div>`;
    CC.$$('[data-seg="situacao"]', el).forEach((b) => b.addEventListener('click', () => { filtro = b.dataset.valor; U.segEscolher(b.parentElement, b); pintar(); }));
    pintar();
  }

  D.tela('obras', { render: (el, rota, vivo) => (rota.id ? O.detalhe(el, rota, vivo) : render(el, rota, vivo)) });
})(window.CC);
