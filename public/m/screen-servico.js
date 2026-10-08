// Detalhe do servico curto: Resumo, Execucao e Lancamentos, com Lancar despesa sempre no rodape.
// Prototipo: Rodada 28 (sServ). Contrato: docs/suite-desktop/SERVICOS-API.md.
(function (CC) {
  const { esc, icon, money } = CC;
  const role = () => ((CC.session.user() || {}).role || '');
  // Matriz padrao do servidor (services/permissions.js). O servidor sempre confere de novo.
  const PERM = { p1: ['admin', 'gestor', 'financeiro', 'engenharia'], p5: ['admin', 'gestor'], p6: ['admin', 'gestor', 'financeiro'] };
  const ST = {
    agendado: ['Agendado', 'calendar-blank', 'ac'], em_andamento: ['Em andamento', 'play-circle', 'wn'],
    concluido: ['Concluído', 'check-circle', 'up'], faturado: ['Faturado', 'receipt', 'neu'],
  };
  const TIPOS = {
    deslocamento: ['Uber ou transporte', 'car'], combustivel: ['Combustível', 'gas-pump'], material: ['Miscelânea', 'wrench'],
    mao_de_obra: ['Mão de obra terceirizada', 'hard-hat'], outros: ['Outros', 'dots-three-circle'],
  };
  const TABS = [['resumo', 'Resumo'], ['exec', 'Execução'], ['lanc', 'Lançamentos']];
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const pct = (v) => (v == null ? '—' : `${String(v).replace('.', ',')}%`);
  const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', ' às') : '');

  // Permissoes reais vem de /auth/me (o login so traz o papel antigo); sem resposta, vale a matriz padrao.
  let perms = null, permsDono = '';
  CC.sv = {
    ST, TIPOS, plural, pct, dataHora,
    can: (p) => (perms && permsDono === CC.owner() ? perms.includes(p) : (PERM[p] || []).includes(role())),
    async loadPerms() {
      if (perms && permsDono === CC.owner()) return;
      try { const { data } = await CC.cached('me', '/auth/me'); perms = data.permissoes || null; permsDono = CC.owner(); } catch { /* fica a matriz padrao */ }
    },
    badge: (sit) => { const s = ST[sit] || ST.agendado; return `<span class="sv-st ${s[2]}">${icon(s[1], 12)}${s[0]}</span>`; },
    reload: (id, tab, extra) => CC.go('servico', { id, tab, ...(extra || {}) }),
  };

  function tiles(s) {
    const g = s.resumo || {}, n = (s.gastos || []).length, fotos = s.fotos || [];
    const list = s.veValores
      ? [['Cobrado', money(g.cobrado), 'valor do serviço', ''], ['Gastos', money(g.gastos), n ? plural(n, 'lançamento', 'lançamentos') : 'nenhum ainda', ''],
        ['Resultado', money(g.resultado), 'cobrado − gastos', g.resultado < 0 ? 'down' : 'up'], ['Margem', pct(g.margem), 'do valor cobrado', g.resultado < 0 ? 'down' : 'up']]
      : [['Gastos', money(g.gastos), plural(n, 'lançamento', 'lançamentos'), ''],
        ['Fotos', String(fotos.length), `${fotos.filter((f) => f.fase === 'antes').length} antes · ${fotos.filter((f) => f.fase === 'depois').length} depois`, '']];
    return `<div class="sv-tiles">${list.map(([l, v, sub, c]) => `<div class="sv-tile"><small>${esc(l)}</small><b class="${c}">${esc(v)}</b><span>${esc(sub)}</span></div>`).join('')}</div>`;
  }

  function cobranca(s) {
    const f = s.faturamento;
    if (f) return `${f.nfseNumero ? `${f.nfseNumero} · ` : ''}vence ${CC.dateFull(f.vencimento)} · ${({ pix: 'Pix', boleto: 'Boleto', transferencia: 'Transferência' })[f.forma] || ''}`;
    if (s.situacao === 'concluido') return `Pronto para faturar · ${money(s.valor)}`;
    return 'Fatura depois de concluir';
  }

  function resumo(s) {
    const g = s.resumo || {}, tipos = g.gastosPorTipo || [], total = Number(g.gastos) || 0;
    const grupos = (s.gastos || []).length
      ? tipos.map((t) => { const ic = (TIPOS[t.tipo] || TIPOS.outros)[1], w = total > 0 ? Math.max(0, Math.round((t.total / total) * 100)) : 0;
        return `<div class="sv-grp${t.total ? '' : ' off'}"><span class="ic">${icon(ic, 18)}</span><span class="grow"><b>${esc(t.rotulo)}</b>
          <small>${t.quantidade ? esc(plural(t.quantidade, 'lançamento', 'lançamentos')) : 'Nenhum gasto'}</small><span class="bar"><span style="width:${w}%"></span></span></span>
          <b class="v">${t.total ? esc(money(t.total)) : '—'}</b></div>`; }).join('')
      : `<div class="empty sv-empty">${icon('receipt', 26)}<b>Nenhum gasto lançado</b>Uber, combustível e miscelânea aparecem aqui assim que alguém lançar.
          <button class="btn2" type="button" data-gasto>${icon('plus', 18)}Lançar despesa</button></div>`;
    const kv = [['Cliente', s.cliente], ['Local', s.local], ['Data', CC.dateFull(s.data)], ['Responsável', s.responsavel]]
      .map(([k, v]) => `<div class="kv"><span>${k}</span><b>${esc(v || '—')}</b></div>`).join('');
    return `${tiles(s)}
      <div class="card"><div class="sv-head"><span class="label">Gastos por tipo</span><b>${esc(money(total))}</b></div>${grupos}</div>
      <div class="card">${kv}</div>
      <button class="suite-item om-item" type="button" id="sv-rel">${icon('file-text', 22)}<span><b>Relatório do serviço</b><small>1 página para o cliente, sem custos internos</small></span>${icon('caret-right', 18)}</button>
      ${s.veValores ? `<button class="suite-item om-item" type="button" id="sv-cob">${icon('receipt', 22)}<span><b>Cobrança</b><small>${esc(cobranca(s))}</small></span>${icon('caret-right', 18)}</button>` : ''}
      ${s.veValores ? '' : `<div class="sv-note">${icon('eye-slash', 16)}<span>Seu perfil lança despesas, fotos e o aceite. Valor cobrado, resultado e margem ficam com o escritório.</span></div>`}`;
  }

  async function lancamentos(s, params) {
    const fila = (await CC.queue.mine()).filter((i) => Number(i.servicoId) === s.id);
    const gastos = (s.gastos || []).slice().sort((a, b) => String(b.data).localeCompare(String(a.data)) || b.id - a.id);
    const row = (x, extra) => { const t = TIPOS[x.tipo] || TIPOS.outros;
      return `<div class="sv-gasto${extra.hl ? ' hl' : ''}"><span class="ic">${icon(t[1], 18)}</span><span class="grow"><b>${esc(x.descricao || t[0])}</b>
        <small>${esc(extra.meta)}</small>${extra.chip}</span><b class="v">− ${esc(money(x.valor))}</b></div>`; };
    const filaRows = fila.map((i) => row(i.payload, { meta: `${CC.dateFull(i.payload.data)} · ${i.estado === 'erro' ? 'erro: ' + i.erro : 'sobe quando a internet voltar'}`,
      chip: i.estado === 'erro' ? `<span class="sv-chip warn">${icon('warning-circle', 12)}Erro</span>` : `<span class="sv-chip warn">${icon('cloud-arrow-up', 12)}Na fila</span>`, hl: false })).join('');
    const rows = gastos.map((x) => row(x, { meta: [CC.dateFull(x.data), x.lancadoPor].filter(Boolean).join(' · '),
      chip: x.anexos ? `<span class="sv-chip">${icon('image', 12)}Recibo</span>` : '<span class="sv-chip off">Sem recibo</span>', hl: Number(params.novo) === x.id })).join('');
    const n = gastos.length + fila.length;
    const docs = [];
    const f = s.faturamento;
    if (f && (f.nfseNumero || f.nfseArquivo)) docs.push(['receipt', f.nfseNumero || 'NFS-e', `${f.nfseArquivo ? 'PDF na nota vinculada · ' : ''}faturado em ${CC.dateFull(String(f.faturadoEm || '').slice(0, 10))}`]);
    const recibos = gastos.reduce((a, x) => a + (Number(x.anexos) || 0), 0);
    if (recibos) docs.push(['image', plural(recibos, 'recibo anexado', 'recibos anexados'), 'Fotos dos recibos, nos lançamentos']);
    if (s.aceite) docs.push(['signature', 'Aceite do cliente', `${s.aceite.nome} · ${dataHora(s.aceite.dataHora)}`]);
    return `${n ? `<div class="sv-head"><span class="label">${esc(plural(n, 'despesa', 'despesas'))}</span><b>${esc(money((s.resumo || {}).gastos))}</b></div>
        <div class="card sv-list">${filaRows}${rows}</div>`
      : `<div class="empty sv-empty">${icon('receipt', 26)}<b>Nenhuma despesa ainda</b>Lance o Uber, o combustível e a miscelânea na hora, com a foto do recibo.
        <button class="btn2" type="button" data-gasto>${icon('plus', 18)}Lançar despesa</button></div>`}
      <span class="label">Notas fiscais e anexos</span>
      ${docs.length ? `<div class="card sv-list">${docs.map(([ic, t, sub]) => `<div class="sv-gasto"><span class="ic">${icon(ic, 18)}</span><span class="grow"><b>${esc(t)}</b><small>${esc(sub)}</small></span></div>`).join('')}</div>`
        : `<div class="sv-note">${icon('paperclip', 16)}<span>Sem notas nem anexos. A NFS-e entra aqui quando o serviço for faturado.</span></div>`}`;
  }

  // Botao do rodape ao lado de Lancar despesa, conforme a situacao.
  function secundario(s) {
    if (s.situacao === 'agendado') return ['Iniciar serviço', 'play', 'iniciar'];
    if (s.situacao === 'em_andamento') return ['Concluir', 'check-circle', 'concluir'];
    if (s.situacao === 'concluido' && CC.sv.can('p6')) return ['Faturar', 'receipt', 'faturar'];
    return ['Relatório', 'file-text', 'relatorio'];
  }
  CC.sv.secundario = secundario;

  function topo(title, sub, dots) {
    return `<div class="top sv-top"><button class="back" type="button" id="voltar" aria-label="Voltar">${icon('caret-left', 20)}</button>
      <span class="grow"><h1>${esc(title)}</h1></span>${dots ? `<button class="back sv-dots" type="button" id="sv-mais" aria-label="Mais ações" aria-haspopup="dialog">${icon('dots-three-vertical', 22)}</button>` : ''}</div>${sub || ''}`;
  }

  function carregando() {
    return `${topo('Serviço', '', false)}<div class="sv-tiles"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
      <div class="skeleton" style="height:180px"></div><div class="skeleton"></div><p class="sr" role="status">Abrindo o serviço…</p>`;
  }

  function erro(el, error, params) {
    const off = error && error.status === 0;
    el.innerHTML = `${topo('Serviço', '', false)}<div class="empty sv-empty" style="padding-top:48px">${icon(off ? 'cloud-slash' : 'warning-circle', 30)}
      <b>Não deu para abrir o serviço</b>${esc(off ? 'O celular está sem internet e este serviço ainda não foi salvo no aparelho. Dá para lançar despesas em outro serviço já aberto; elas entram na fila.' : (error && error.message) || 'Tente de novo.')}
      <button class="btn" type="button" id="sv-retry" style="padding:0 22px">${icon('arrow-clockwise', 18)}Tentar de novo</button>
      <button class="btn2" type="button" id="sv-obras" style="padding:0 22px">Voltar para Obras</button></div>`;
    CC.$('#voltar', el).addEventListener('click', () => CC.go('obras'));
    CC.$('#sv-retry', el).addEventListener('click', () => CC.go('servico', params));
    CC.$('#sv-obras', el).addEventListener('click', () => CC.go('obras'));
  }

  CC.screens.servico = async function (params) {
    const id = Number(params && params.id);
    const tab = (params && params.tab) || 'resumo';
    const el = CC.render(carregando(), true, params);
    CC.$('#voltar', el).addEventListener('click', () => CC.go('obras'));
    let result;
    try {
      [result] = await Promise.all([CC.cached(`servico-${id}`, `/servicos/${id}`), CC.sv.loadPerms()]);
    } catch (error) {
      if (params.__nav && params.__nav !== CC.nav) return undefined;
      return erro(el, error, { id, tab });
    }
    const s = await CC.sv.overlay(result.data); // soma o que ainda esta na fila do celular
    CC.sv.atual = s;
    const body = tab === 'resumo' ? resumo(s) : tab === 'exec' ? CC.sv.execucao(s) : await lancamentos(s, params);
    const [secL, secI, secK] = secundario(s);
    const sub = `<div class="sv-sub"><span class="tag">${esc(s.codigo)} · Serviço</span>${CC.sv.badge(s.situacao)}<span>${esc([CC.dateFull(s.data), s.responsavel].filter(Boolean).join(' · '))}</span></div>`;
    const page = CC.render(`${topo(s.nome, sub, true)}${CC.staleNote(result)}
      <div class="seg" role="group" aria-label="Seções do serviço">${TABS.map(([k, label]) => `<button type="button" data-tab="${k}" aria-pressed="${k === tab}">${label}</button>`).join('')}</div>
      ${body}
      <div class="actions sv-actions"><button class="btn2" type="button" id="sv-sec" data-acao="${secK}">${icon(secI, 18)}${esc(secL)}</button>
        <button class="btn" type="button" data-gasto>${icon('plus', 18)}Lançar despesa</button></div>`, true, params);
    CC.$('#voltar', page).addEventListener('click', () => CC.go('obras'));
    CC.$$('[data-tab]', page).forEach((b) => b.addEventListener('click', () => CC.sv.reload(id, b.dataset.tab)));
    CC.$$('[data-gasto]', page).forEach((b) => b.addEventListener('click', () => CC.sv.gasto(s)));
    CC.$('#sv-mais', page).addEventListener('click', () => CC.sv.menu(s));
    CC.$('#sv-sec', page).addEventListener('click', (e) => CC.sv.acao(s, secK, e.currentTarget));
    const rel = CC.$('#sv-rel', page);
    if (rel) rel.addEventListener('click', () => CC.go('servico-rel', { id }));
    const cob = CC.$('#sv-cob', page);
    if (cob) cob.addEventListener('click', () => (s.situacao === 'concluido' && CC.sv.can('p6') ? CC.sv.faturar(s)
      : CC.toast(s.faturamento ? cobranca(s) : 'Conclua o serviço para faturar', 'receipt')));
    if (tab === 'exec') CC.sv.bindExec(s, page);
    const hl = CC.$('.sv-gasto.hl', page);
    if (hl) hl.scrollIntoView({ block: 'center' });
    return undefined;
  };
})(window.CC = window.CC || {});
