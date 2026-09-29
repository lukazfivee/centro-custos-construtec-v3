// Aba Curva S da obra (print 34): BAC, AC, EV, CPI, EAC e VAC, grafico acumulado (previsto tracejado,
// realizado e medido), "Como ler", tabela mensal e premissas (GET /centros-custo/:id/curva-s).
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const O = D.obras = D.obras || {};
  const U = D.ui;
  O.abas = O.abas || {};
  const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const nomeMes = (m) => { const [a, n] = String(m).split('-').map(Number); return `${MES[(n || 1) - 1]}${a ? `/${String(a).slice(2)}` : ''}`; };
  const pct = (x) => (x == null ? '—' : `${Number(x).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);

  function grafico(tl, bac, contrato) {
    const W = 1000; const H = 230; const esq = 48; const topo = 10; const alto = 190;
    const n = tl.length;
    const x = (i) => esq + (n <= 1 ? 0 : (i / (n - 1)) * (W - esq - 20));
    const y = (p) => topo + alto * (1 - Math.max(0, Math.min(1.05, p)) / 1.05); // 100% perto do topo
    const linha = (campo, base, cls) => {
      const pts = tl.map((t, i) => (t[campo] == null || !base ? null : `${x(i).toFixed(1)},${y(t[campo] / base).toFixed(1)}`)).filter(Boolean);
      if (!pts.length) return '';
      // Com um mes so nao ha linha: desenha o ponto para a serie aparecer.
      if (pts.length === 1) { const [px, py] = pts[0].split(','); return `<circle cx="${px}" cy="${py}" r="4" class="ponto-${cls}"></circle>`; }
      return `<polyline class="${cls}" points="${pts.join(' ')}" fill="none" vector-effect="non-scaling-stroke"></polyline>`;
    };
    const grade = [0, 0.25, 0.5, 0.75, 1].map((p) => `<line x1="${esq}" x2="${W}" y1="${y(p)}" y2="${y(p)}" class="grade" vector-effect="non-scaling-stroke"></line>`).join('');
    const rotY = [0, 0.25, 0.5, 0.75, 1].map((p) => `<span class="eixo-y" style="top:${y(p) - 8}px">${p * 100}%</span>`).join('');
    const passo = Math.max(1, Math.ceil(n / 12));
    const rotX = tl.map((t, i) => (i % passo === 0 || i === n - 1 ? `<span class="eixo-x" style="left:${((x(i) / W) * 100).toFixed(2)}%;top:${topo + alto + 8}px">${esc(nomeMes(t.month))}</span>` : '')).join('');
    const ult = tl.filter((t) => t.realizedCumulative != null).length - 1;
    const ponto = ult >= 0 && bac ? `<circle cx="${x(ult)}" cy="${y(tl[ult].realizedCumulative / bac)}" r="5" class="ponto"></circle>` : '';
    return `<div class="grafico curva"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" width="100%" height="${H}" role="img" aria-label="Curva S acumulada: previsto, realizado e medido">
      ${grade}${linha('plannedCumulative', bac, 'previsto')}${linha('realizedCumulative', bac, 'realizado')}${linha('measuredCumulative', contrato, 'medido')}${ponto}</svg>${rotY}${rotX}</div>`;
  }

  O.abas.curva = async function (corpo, obra, vivo) {
    corpo.innerHTML = U.carregando('Calculando a Curva S…');
    let d;
    try { ({ data: d } = await CC.api(`/centros-custo/${obra.id}/curva-s`)); } catch (error) {
      if (!vivo()) return;
      corpo.innerHTML = `<div class="card">${U.vazio('chart-line-up', error.status === 404 || error.status === 400 ? 'Esta obra ainda não tem orçamento importado.' : error.message, 'A Curva S usa o orçamento aprovado e as medições ao cliente.')}</div>`;
      return;
    }
    if (!vivo()) return;
    const e = d.evm || {};
    const c = d.center || {};
    const tl = d.timeline || [];
    if (!tl.length) { corpo.innerHTML = `<div class="card">${U.vazio('chart-line-up', 'Sem cronograma para calcular a Curva S.', 'Confira o início e o término da obra.')}</div>`; return; }
    const k = U.kpi;
    const cpiTom = e.cpi == null ? '' : (e.cpi >= 1 ? 'ok' : 'err');
    const vacTom = e.vac == null ? '' : (e.vac < 0 ? 'err' : 'ok');
    const kpis = [
      k({ rotulo: 'BAC · orçado', valor: CC.moneyShort(e.bac), det: 'custo base aprovado', icone: 'calculator' }),
      k({ rotulo: 'AC · realizado', valor: CC.moneyShort(e.ac), det: `${pct(e.financialBurnPercent)} consumido`, icone: 'arrow-up-right', tom: 'saida', tomValor: e.ac > e.bac ? 'err' : '' }),
      k({ rotulo: 'EV · valor agregado', valor: e.ev == null ? '—' : CC.moneyShort(e.ev), det: `${pct(e.physicalPercent)} medido`, icone: 'check' }),
      k({ rotulo: 'CPI', valor: e.cpi == null ? '—' : Number(e.cpi).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), det: e.cpi == null ? 'sem medição' : (e.cpi >= 1 ? 'custo dentro do avanço' : 'custo acima do avanço'), icone: 'gauge', tomValor: cpiTom }),
      k({ rotulo: 'EAC · projeção', valor: e.eac == null ? '—' : CC.moneyShort(e.eac), det: 'custo estimado no término', icone: 'target' }),
      k({ rotulo: 'VAC · desvio', valor: e.vac == null ? '—' : `${e.vac < 0 ? '−' : ''}${CC.moneyShort(Math.abs(e.vac))}`, det: e.projectedStatus || '', icone: 'scales', tom: vacTom === 'err' ? 'err' : 'info', tomValor: vacTom }),
    ].join('');
    const din = (v) => (v == null ? '' : esc(CC.money(v)));
    const tabela = U.tabela({
      colunas: [{ rotulo: 'Mês' }, { rotulo: 'Previsto mês', num: true }, { rotulo: 'Previsto acum.', num: true }, { rotulo: 'Realizado mês', num: true }, { rotulo: 'Realizado acum.', num: true }, { rotulo: 'Medido mês', num: true }, { rotulo: 'Medido acum.', num: true }],
      linhas: tl.map((t) => ({ id: t.month, celulas: [esc(nomeMes(t.month)), din(t.plannedMonth), din(t.plannedCumulative), din(t.realizedMonth), din(t.realizedCumulative), din(t.measuredMonth), din(t.measuredCumulative)] })),
    });
    corpo.innerHTML = `<div class="kpis seis">${kpis}</div>
      <section class="card bloco"><div class="bcab"><b>Curva S físico-financeira · acumulado</b>
        <span class="legenda"><span><i class="q l-prev"></i>Previsto</span><span><i class="q l-real"></i>Realizado</span><span><i class="q l-med"></i>Medido</span></span></div>
        ${grafico(tl, Number(e.bac || c.baseCost || 0), Number(c.contractValue || 0))}</section>
      <section class="card bloco como-ler"><span><b>Como ler:</b> previsto segue a distribuição S do orçamento aprovado; realizado é o custo lançado; medido é o avanço aprovado pelo cliente. CPI abaixo de 1 indica custo acima do avanço; EAC = AC + (BAC − EV) / CPI.</span></section>
      <section class="card tabela"><div class="bcab pad"><b>Mês a mês</b></div>${tabela}</section>
      <section class="card bloco"><b class="bt">Premissas</b><ul class="premissas">${(d.hypotheses || []).map((h) => `<li>${esc(h)}</li>`).join('')}</ul></section>`;
  };
})(window.CC);
