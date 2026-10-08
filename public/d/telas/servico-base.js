// Servicos curtos (Rodada 28D): pecas comuns a lista, detalhe e paineis.
// Contrato do servidor: docs/suite-desktop/SERVICOS-API.md.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const U = D.ui;
  const S = D.serv = D.serv || {};

  S.SITUACAO = {
    agendado: ['Agendado', 'info', 'calendar-blank'], em_andamento: ['Em andamento', 'warn', 'play-circle'],
    concluido: ['Concluído', 'ok', 'check-circle'], faturado: ['Faturado', 'vio', 'receipt'],
  };
  S.chip = (s) => { const [t, tom, ic] = S.SITUACAO[s] || S.SITUACAO.agendado; return U.chip(t, tom, ic); };
  // Atalhos do Lancar despesa: tipo do servidor, rotulo, icone e descricao padrao.
  S.ATALHOS = [
    { tipo: 'deslocamento', rotulo: 'Uber ou transporte', icone: 'car', desc: 'Uber · ida e volta' },
    { tipo: 'combustivel', rotulo: 'Combustível', icone: 'gas-pump', desc: 'Combustível' },
    { tipo: 'material', rotulo: 'Miscelânea', icone: 'wrench', desc: 'Miscelânea · parafusos, abraçadeiras e conectores' },
    { tipo: 'mao_de_obra', rotulo: 'Mão de obra terceirizada', icone: 'hard-hat', desc: 'Mão de obra terceirizada' },
    { tipo: 'outros', rotulo: 'Outros', icone: 'dots-three-circle', desc: 'Outro gasto' },
  ];
  S.atalho = (tipo) => S.ATALHOS.find((a) => a.tipo === tipo) || S.ATALHOS[4];
  S.ROTULO_GRUPO = { deslocamento: 'Deslocamento', combustivel: 'Combustível', material: 'Material e miscelânea', mao_de_obra: 'Mão de obra terceirizada', outros: 'Outros' };

  // Quem nao tem p1 (tecnico, comercial) nao ve cobrado, resultado nem margem (o servidor tambem omite).
  S.veValores = (sv) => (sv && typeof sv.veValores === 'boolean' ? sv.veValores : D.tem('p1'));
  S.pct = (m) => (m == null ? '—' : `${Number(m).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
  S.erro = (error, acao) => (error && error.status === 0 ? `Sem internet. ${acao}` : (error && error.message) || 'Não foi possível concluir agora.');

  // Arquivo protegido (foto, assinatura, relatorio): fetch com o token.
  S.baixar = async (url) => {
    let r;
    try { r = await fetch(url, { headers: { Authorization: `Bearer ${CC.session.token()}` }, cache: 'no-store' }); } catch (e) { const x = new Error('Sem internet.'); x.status = 0; throw x; }
    if (!r.ok) { const x = new Error('Não foi possível abrir o arquivo.'); x.status = r.status; throw x; }
    return r;
  };
  // Le um arquivo escolhido para base64 (sem o prefixo data:).
  S.base64 = (file) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).replace(/^data:[^,]*,/, ''));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });

  // Despesas deste servico guardadas na fila deste computador (sem internet).
  S.naFila = async (id) => {
    if (!CC.queue) return [];
    const itens = await CC.queue.mine().catch(() => []);
    return itens.filter((i) => i.servico && String(i.payload && i.payload.cost_center_id) === String(id));
  };

  // Cartao compacto da lista (28Db): codigo, situacao, nome, cliente, data, tecnico e numeros.
  S.cartao = (v) => {
    const ve = v.valor !== undefined && D.tem('p1');
    const meta = [v.cliente, D.data(v.data), v.responsavel].filter(Boolean).join(' · ');
    const res = Number(v.resultado || 0);
    return `<article class="card cartao-servico">
      <div class="topo">${U.chip(v.codigo || '—', 'info')}${U.chip('Serviço', 'contorno', 'wrench')}<span class="espaco"></span>${v.ativo === false ? U.chip('Inativo', 'neutro') : S.chip(v.situacao)}</div>
      <a class="tx" href="#/servicos/${esc(v.id)}"><b>${esc(v.nome)}</b><span class="muted">${esc(meta || 'Sem cliente')}</span></a>
      <div class="valores">${ve ? `<span><span class="lbl">Cobrado</span><b>${esc(CC.money(v.valor))}</b></span>` : ''}
        <span><span class="lbl">Gasto</span><b>${Number(v.gastos) ? esc(CC.money(v.gastos)) : 'Sem gastos'}</b></span>
        ${ve && v.resultado !== undefined ? `<span><span class="lbl">Resultado</span><b class="${res < 0 ? 'err' : 'ok'}">${esc(CC.money(res))}</b></span>` : ''}</div>
      <div class="bts"><a class="btn btn-p" href="#/servicos/${esc(v.id)}">Abrir serviço</a>
        ${D.tem('p2') && v.situacao !== 'faturado' ? `<button type="button" class="btn btn-s" data-gasto-sv="${esc(v.id)}">${D.ic('receipt')}Lançar despesa</button>` : ''}</div></article>`;
  };

  // Totais da aba Servicos (28Db) e do tecnico de campo (28Df, sem cobrado, resultado nem margem).
  S.kpisServicos = (lista) => {
    const k = U.kpi;
    const n = (s) => lista.filter((v) => v.situacao === s).length;
    const soma = (f) => lista.reduce((t, v) => t + Number(f(v) || 0), 0);
    const gastos = soma((v) => v.gastos);
    if (!D.tem('p1')) {
      return [
        k({ rotulo: 'Serviços', valor: String(lista.length), det: 'atribuídos a você ou à equipe', icone: 'wrench' }),
        k({ rotulo: 'Agendados', valor: String(n('agendado')), det: 'próximos dias', icone: 'calendar-blank' }),
        k({ rotulo: 'Em andamento', valor: String(n('em_andamento')), det: 'agora', icone: 'play-circle', tom: 'warn' }),
        k({ rotulo: 'Concluídos', valor: String(n('concluido') + n('faturado')), det: 'prontos', icone: 'check-circle', tom: 'ok' }),
        k({ rotulo: 'Gastos', valor: CC.money(gastos), det: 'deslocamento e material', icone: 'receipt' }),
      ].join('');
    }
    const cobrado = soma((v) => v.valor);
    const res = cobrado - gastos;
    const aFaturar = soma((v) => (v.situacao === 'concluido' ? v.valor : 0));
    return [
      k({ rotulo: 'Serviços', valor: String(lista.length), det: `${n('em_andamento')} em andamento · ${n('agendado')} agendado${n('agendado') === 1 ? '' : 's'}`, icone: 'wrench' }),
      k({ rotulo: 'Cobrado', valor: CC.money(cobrado), det: 'valor dos serviços', icone: 'handshake' }),
      k({ rotulo: 'Gastos', valor: CC.money(gastos), det: 'Uber, combustível e material', icone: 'arrow-up-right', tom: 'warn' }),
      k({ rotulo: 'Resultado', valor: CC.money(res), det: 'cobrado − gastos', icone: 'scales', tom: res < 0 ? 'err' : 'ok', tomValor: res < 0 ? 'err' : 'ok' }),
      k({ rotulo: 'Margem média', valor: cobrado > 0 ? S.pct(Math.round((res / cobrado) * 1000) / 10) : '—', det: 'do valor cobrado', icone: 'percent', tom: 'ok' }),
      k({ rotulo: 'A faturar', valor: CC.money(aFaturar), det: `${n('concluido')} concluído${n('concluido') === 1 ? '' : 's'} sem cobrança`, icone: 'receipt', tom: 'warn' }),
    ].join('');
  };

  // Totais da aba Todos (28De): obras e servicos somados.
  S.kpisTodos = (obras, numeros, servicos) => {
    const k = U.kpi;
    const real = obras.reduce((t, o) => { const x = numeros.get(o.id); return t + Number(x && x.realizedCost != null ? x.realizedCost : o.total_despesas || 0); }, 0);
    const gastos = servicos.reduce((t, v) => t + Number(v.gastos || 0), 0);
    const base = [k({ rotulo: 'Centros de custo', valor: String(obras.length + servicos.length), det: `${obras.length} obras · ${servicos.length} serviços`, icone: 'stack' })];
    if (!D.tem('p1')) {
      return base.concat([
        k({ rotulo: 'Realizado em obras', valor: CC.moneyShort(real), det: 'custo lançado', icone: 'arrow-up-right', tom: 'warn' }),
        k({ rotulo: 'Gastos em serviços', valor: CC.money(gastos), det: 'custo lançado', icone: 'arrow-up-right', tom: 'warn' }),
      ]).join('');
    }
    const contrato = obras.reduce((t, o) => t + Number(o.valor_contrato || 0), 0);
    const cobrado = servicos.reduce((t, v) => t + Number(v.valor || 0), 0);
    const res = cobrado - gastos;
    return base.concat([
      k({ rotulo: 'Valor contratual', valor: CC.moneyShort(contrato), det: 'obras', icone: 'buildings' }),
      k({ rotulo: 'Cobrado em serviços', valor: CC.money(cobrado), det: 'valor dos serviços', icone: 'wrench' }),
      k({ rotulo: 'Realizado em obras', valor: CC.moneyShort(real), det: 'custo lançado', icone: 'arrow-up-right', tom: 'warn' }),
      k({ rotulo: 'Gastos em serviços', valor: CC.money(gastos), det: 'custo lançado', icone: 'arrow-up-right', tom: 'warn' }),
      k({ rotulo: 'Resultado em serviços', valor: CC.money(res), det: cobrado > 0 ? `margem ${S.pct(Math.round((res / cobrado) * 1000) / 10)}` : 'sem valor cobrado', icone: 'scales', tom: res < 0 ? 'err' : 'ok', tomValor: res < 0 ? 'err' : 'ok' }),
    ]).join('');
  };

  // Liga os botoes "Lancar despesa" dos cartoes.
  S.ligarCartoes = (raiz, lista, aoMudar) => {
    CC.$$('[data-gasto-sv]', raiz).forEach((b) => b.addEventListener('click', () => {
      const v = lista.find((x) => String(x.id) === b.dataset.gastoSv);
      if (v) S.lancarDespesa(v, aoMudar);
    }));
  };
})(window.CC);
