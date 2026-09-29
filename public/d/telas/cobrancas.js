// Cobrancas (D4, print 40): indicadores, filtros, tabela por obra e contador no menu.
// Dados: GET /api/cloud-sync/cobrancas (o mesmo da tela atual). Aparece so para e-mail @rcconstrutec.com.br.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const B = D.cobr = D.cobr || {};
  const U = D.ui;
  const FILTROS = [['', 'Todas'], ['pendentes', 'Pendentes'], ['aguardando', 'Aguardando'], ['vencidas', 'Vencidas'], ['pagas', 'Pagas']];
  let filtro = '';
  let busca = '';
  let itens = [];

  B.carregar = async () => {
    const { data } = await CC.api('/cloud-sync/cobrancas');
    itens = Array.isArray(data.items) ? data.items : [];
    return itens;
  };
  B.itens = () => itens;

  // Contador de pendencias no menu (pendentes + vencidas). Silencioso: sem nuvem, some.
  B.pintarContador = (n) => {
    const selo = CC.$('[data-badge="cobrancas"]');
    if (!selo) return;
    selo.textContent = String(n);
    selo.hidden = !n;
  };
  B.atualizarContador = async () => {
    if (!D.pode('cobrancas')) return;
    let n = 0;
    try { n = B.indicadores(await B.carregar()).contador; } catch { n = 0; }
    B.pintarContador(n);
  };

  function kpis(ind) {
    const k = U.kpi;
    return [
      k({ rotulo: 'Finalizadas', valor: CC.money(B.reais(ind.finalizadas)), det: `${ind.qtdPagas} cobrança${ind.qtdPagas === 1 ? '' : 's'} paga${ind.qtdPagas === 1 ? '' : 's'}`, icone: 'check-circle', tom: 'ok' }),
      k({ rotulo: 'Aguardando pagamento', valor: CC.money(B.reais(ind.aguardando)), det: ind.venceramEntre ? `${ind.venceramEntre} vencida(s) entre elas` : 'nenhuma vencida', icone: 'hourglass', tom: 'info' }),
      k({ rotulo: 'Pendentes', valor: String(ind.pendentes), det: 'aprovação, NF ou envio', icone: 'clock', tom: 'warn' }),
      k({ rotulo: 'A receber', valor: CC.money(B.reais(ind.aReceber)), det: 'tudo o que não foi pago', icone: 'arrow-down-left', tom: 'info' }),
    ].join('');
  }

  function linha(i) {
    return {
      id: i.publicId, clicavel: true,
      celulas: [
        `<span class="duas-l"><b>${esc(i.code)}</b><span>${esc(i.name)}</span></span>`,
        esc(D.data(i.completionDate) || '—'),
        B.chipOperacional(i),
        `<span class="duas-l">${B.chipFinanceiro(i)}<span>${esc(i.clientName || i.client || '')}</span></span>`,
        esc(i.invoiceNumber || '—'),
        `<span class="${B.vencida(i) ? 'vencido' : ''}">${esc(D.data(i.dueDate) || '—')}</span>`,
        `<b>${esc(CC.money(i.receivableAmount))}</b>`,
        `<span class="acoes"><button type="button" class="ibtn" data-acao="acompanhar" aria-label="Acompanhar ${esc(i.name)}" title="Acompanhar">${D.ic('list-checks', 18)}</button>
          <button type="button" class="ibtn" data-acao="email" aria-label="E-mail ao cliente de ${esc(i.name)}" title="E-mail ao cliente">${D.ic('envelope-simple', 18)}</button></span>`,
      ],
    };
  }
  const COLUNAS = [{ rotulo: 'Obra' }, { rotulo: 'Conclusão' }, { rotulo: 'Situação operacional' }, { rotulo: 'Situação financeira' }, { rotulo: 'NF' }, { rotulo: 'Vencimento' }, { rotulo: 'Valor', num: true }, { rotulo: 'Ações', num: true }];

  async function baixarCsv() {
    const url = URL.createObjectURL(new Blob([B.csv(B.filtrar(itens, filtro, busca))], { type: 'text/csv;charset=utf-8' }));
    const a = D.el('<a download="cobrancas.csv"></a>');
    a.href = url;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function render(el, rota, vivo) {
    el.innerHTML = `<div class="pagina cobrancas">${U.cabecalho({ grupo: 'Operação', titulo: 'Cobranças', sub: ' ', acoes: `<button type="button" class="btn btn-s" data-csv>${D.ic('download-simple')}Exportar CSV</button>` })}
      <div data-corpo>${U.carregando('Carregando as cobranças…')}</div></div>`;
    CC.$('[data-csv]', el).addEventListener('click', baixarCsv);
    let lista;
    try { lista = await B.carregar(); } catch (error) {
      if (!vivo()) return;
      CC.$('[data-corpo]', el).innerHTML = U.faixa('warn', error.status === 0 ? 'wifi-slash' : 'warning', error.status === 0
        ? 'Sem internet. As cobranças voltam quando a conexão voltar.' : error.message);
      return;
    }
    if (!vivo()) return;
    const mes = D.mesAno(B.hoje().slice(0, 7)).toLowerCase();
    CC.$('.cab .sub', el).textContent = `${lista.length} obra${lista.length === 1 ? '' : 's'} na cobrança · ${mes}`;
    CC.$('[data-corpo]', el).innerHTML = `<div class="kpis quatro" data-kpis></div>
      <div class="card filtros"><div class="linha"><label class="campo-busca">${D.ic('magnifying-glass')}<input class="inp" type="search" data-busca placeholder="Obra, cliente ou NF" aria-label="Buscar cobranças"></label>
        ${U.seg('filtro', FILTROS.map(([valor, rotulo]) => ({ valor, rotulo })), filtro, 'Situação da cobrança')}</div></div>
      <div data-tabela></div>`;
    const inputBusca = CC.$('[data-busca]', el);
    inputBusca.value = busca;
    const pintar = () => {
      CC.$('[data-kpis]', el).innerHTML = kpis(B.indicadores(itens));
      const vis = B.filtrar(itens, filtro, busca);
      const abertas = vis.filter((i) => !B.pago(i)).reduce((s, i) => s + B.cents(i.receivableAmount), 0);
      CC.$('[data-tabela]', el).innerHTML = `<div class="card tabela">${U.tabela({ colunas: COLUNAS, linhas: vis.map(linha), vazio: 'Nenhuma cobrança com esses filtros.' })}
        <div class="rodape"><span class="muted">Exibindo ${vis.length} de ${itens.length} cobranças</span><span class="total">Em aberto <b>${esc(CC.money(B.reais(abertas)))}</b></span></div></div>`;
      const abrir = (tr, aba) => B.abrir(itens.find((x) => x.publicId === tr.dataset.id), aba, () => vivo() && render(el, rota, vivo));
      CC.$$('tr.rw', el).forEach((tr) => {
        tr.addEventListener('click', (e) => { const b = e.target.closest('[data-acao]'); abrir(tr, b && b.dataset.acao === 'email' ? 'email' : 'acompanhar'); });
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === tr) abrir(tr, 'acompanhar'); });
      });
    };
    CC.$$('[data-seg="filtro"]', el).forEach((b) => b.addEventListener('click', () => { filtro = b.dataset.valor; U.segEscolher(b.parentElement, b); pintar(); }));
    inputBusca.addEventListener('input', D.debounce(() => { busca = inputBusca.value; pintar(); }, 200));
    pintar();
    B.pintarContador(B.indicadores(itens).contador);
  }

  D.tela('cobrancas', { render });
  document.addEventListener('d:sincronizado', () => B.atualizarContador());
})(window.CC);
