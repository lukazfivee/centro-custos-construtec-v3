// Inicio / Painel financeiro (D1): filtros de obra e mes, 6 indicadores, evolucao de 12 meses,
// atividades recentes, obras (realizado x orcado), despesas por categoria e banner de primeiro uso.
// Dados de GET /api/dashboard/resumo?mes=&centroId= (o mesmo do painel atual).
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const I = D.inicio = D.inicio || {};

  // Ultimos 24 meses para o filtro, do atual para tras.
  function meses() {
    const [a, m] = CC.month().split('-').map(Number);
    return Array.from({ length: 24 }, (_, i) => {
      const d = new Date(a, m - 1 - i, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
  }

  I.obrasAtivas = async function () {
    const { data } = await CC.api('/centros-custo');
    return (Array.isArray(data) ? data : []).filter((o) => o.ativo !== false);
  };

  function kpis(r) {
    const k = D.ui.kpi;
    const res = Number(r.saldo) || 0;
    const qv = Number(r.qtdVencidos) || 0;
    return [
      k({ rotulo: 'Recebido', valor: CC.money(r.receitas), det: `${r.qtdRecebidos || 0} recebimento(s) no mês`, icone: 'arrow-down-left', tom: 'ok' }),
      k({ rotulo: 'Pago', valor: CC.money(r.despesas), det: `${r.qtdPagos || 0} despesas liquidadas`, icone: 'arrow-up-right', tom: 'saida' }),
      k({ rotulo: 'Resultado', valor: CC.money(res), det: 'recebido − pago', icone: 'scales', tom: 'info', tomValor: res < 0 ? 'err' : 'ok' }),
      k({ rotulo: 'A receber', valor: CC.money(r.aReceber), det: 'previsto em aberto', icone: 'hourglass', tom: 'info' }),
      k({ rotulo: 'A pagar', valor: CC.money(r.aPagar), det: 'contas pendentes', icone: 'calendar-blank', tom: 'warn' }),
      k({ rotulo: 'Vencidos', valor: CC.money(r.vencidos), det: qv ? `${qv} conta(s) em atraso` : 'nenhuma pendência', icone: 'warning', tom: qv ? 'err' : 'ok', tomValor: qv ? 'err' : '' }),
    ].join('');
  }

  function subtitulo(mes, obraId, obras) {
    const obra = obras.find((o) => String(o.id) === String(obraId));
    return `${D.mesAno(mes)} · ${obra ? obra.nome : 'todas as obras'}`;
  }

  async function render(el, rota, vivo) {
    const mes = /^\d{4}-\d{2}$/.test(rota.query.mes || '') ? rota.query.mes : CC.month();
    const obraId = /^\d+$/.test(rota.query.obra || '') ? rota.query.obra : '';
    const opcoesMes = meses();
    if (!opcoesMes.includes(mes)) opcoesMes.push(mes);
    el.innerHTML = `<div class="pagina inicio">
      ${D.ui.cabecalho({ grupo: 'Visão geral', titulo: 'Painel financeiro', sub: D.mesAno(mes), acoes: `
        <select class="inp" data-f="obra" aria-label="Filtrar por obra" style="width:260px"><option value="">Todas as obras</option></select>
        <select class="inp" data-f="mes" aria-label="Mês" style="width:190px">${opcoesMes.map((m) => `<option value="${m}"${m === mes ? ' selected' : ''}>${esc(D.mesAno(m))}</option>`).join('')}</select>
        <button type="button" class="btn btn-p" data-rapido>${D.ic('lightning')}Lançamento rápido</button>` })}
      <div data-pu></div>
      <div data-corpo>${D.ui.carregando('Carregando o painel…')}</div></div>`;
    const selObra = CC.$('[data-f="obra"]', el);
    const trocar = () => {
      const q = new URLSearchParams();
      if (CC.$('[data-f="mes"]', el).value !== CC.month()) q.set('mes', CC.$('[data-f="mes"]', el).value);
      if (selObra.value) q.set('obra', selObra.value);
      D.ir(`inicio${q.toString() ? `?${q}` : ''}`);
    };
    CC.$$('[data-f]', el).forEach((s) => s.addEventListener('change', trocar));
    CC.$('[data-rapido]', el).addEventListener('click', () => I.lancamentoRapido({ obraId, aoRegistrar: () => { if (vivo()) render(el, rota, vivo); } }));
    I.primeiroUso(CC.$('[data-pu]', el));

    const [obras, resumo] = await Promise.all([
      I.obrasAtivas().catch(() => []),
      CC.api(`/dashboard/resumo?mes=${mes}&meses=12${obraId ? `&centroId=${obraId}` : ''}`).then((r) => r.data),
    ]);
    if (!vivo()) return;
    selObra.innerHTML = `<option value="">Todas as obras</option>${obras.map((o) => `<option value="${esc(o.id)}"${String(o.id) === obraId ? ' selected' : ''}>${esc(o.nome)}</option>`).join('')}`;
    CC.$('.cab .sub', el).textContent = subtitulo(mes, obraId, obras);
    CC.$('[data-corpo]', el).innerHTML = `
      <div class="kpis seis">${kpis(resumo)}</div>
      <div class="grade">
        <section class="card bloco" aria-labelledby="ini-evo">
          <div class="bcab"><b id="ini-evo">Evolução mensal · 12 meses</b>
            <span class="legenda"><span><i class="q rec"></i>Receitas</span><span><i class="q desp"></i>Despesas</span></span></div>
          ${I.grafico(resumo.tendencia)}${I.medias(resumo.tendencia)}</section>
        <section class="card bloco" aria-labelledby="ini-rec">
          <div class="bcab"><b id="ini-rec">Atividades recentes</b><a class="btn btn-g" href="#/lancamentos">Ver todos</a></div>
          <div class="lista-rec">${I.recentes(resumo.ultimosLancamentos)}</div></section>
        <section class="card bloco" aria-labelledby="ini-obr">
          <div class="bcab"><b id="ini-obr">Obras · realizado × orçado</b><a class="btn btn-g" href="#/obras">Ver carteira</a></div>
          <div class="lista-obras">${I.obras(resumo.porCentro)}</div></section>
        <section class="card bloco" aria-labelledby="ini-cat">
          <div class="bcab"><b id="ini-cat">Despesas por categoria</b></div>
          <div class="lista-cat">${I.categorias(resumo.porCategoria)}</div></section>
      </div>`;
    CC.$$('[data-lanc]', el).forEach((b) => b.addEventListener('click', () => D.lanc.abrirPorId(b.dataset.lanc)));
  }

  D.tela('inicio', { render });

  // Depois de uma sincronizacao, o painel aberto recarrega os numeros.
  document.addEventListener('d:sincronizado', () => {
    if (D.lerRota().nome === 'inicio' && !D.painel.aberto()) D.ir(location.hash.replace(/^#\/?/, ''));
  });
})(window.CC);
