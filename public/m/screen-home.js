// Inicio (pendencias do dia e resumo do mes) e lista de Obras. Prototipo: sCcHome e sObras.
(function (CC) {
  const { esc, icon, money, moneyShort } = CC;

  // Pilula do seletor Suite (suite.js), no cabecalho de todas as telas com abas.
  CC.suitePill = () => `<button class="suite-pill" type="button" data-suite aria-haspopup="dialog">${icon('squares-four', 16)}Suíte</button>`;

  function header(title) {
    return `<div class="top"><span class="brand"><img src="simbolo.png" alt=""><span>Centro de Custos</span></span>${CC.iaBtn ? CC.iaBtn() : ''}${CC.bellBtn ? CC.bellBtn() : ''}${CC.suitePill()}</div>
      ${title ? `<h1 class="title">${esc(title)}</h1>` : ''}`;
  }
  CC.header = header;

  function staleNote(result) {
    if (!result.stale) return '';
    const when = new Date(result.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `<p class="sub">Dados salvos no celular em ${esc(when)}</p>`;
  }
  CC.staleNote = staleNote;

  function pct(spent, budget) {
    return budget > 0 ? Math.round((spent / budget) * 100) : null;
  }

  function tasksFrom(dash, queue) {
    const tasks = [];
    if (queue.errors) {
      tasks.push({ alert: true, icon: 'warning-circle', title: 'Lançamentos com erro', sub: queue.errors === 1 ? '1 lançamento não foi aceito pelo servidor' : `${queue.errors} lançamentos não foram aceitos pelo servidor`, action: 'Ver', go: ['lancamentos'] });
    }
    if (dash.qtdVencidos > 0) {
      tasks.push({ alert: true, icon: 'warning-circle', title: 'Contas vencidas', sub: dash.qtdVencidos === 1 ? '1 conta passou do vencimento' : `${dash.qtdVencidos} contas passaram do vencimento`, value: money(dash.vencidos), action: 'Ver', go: ['lancamentos', { situacao: 'vencido', mes: '' }] });
    }
    for (const c of dash.porCentro || []) {
      const budget = Number(c.orcamento), spent = Number(c.comprometido);
      if (budget > 0 && spent > budget) {
        tasks.push({ alert: true, icon: 'trend-up', title: 'Custo acima do orçado', sub: c.nome + ' passou ' + moneyShort(spent - budget) + ' do orçado', action: 'Ver obra', go: ['obra', { id: c.id }] });
      } else if (Number(c.qtd_lancamentos) === 0 && c.situacao !== 'concluido') {
        const sv = c.tipo_centro === 'servico';
        tasks.push({ alert: false, icon: sv ? 'wrench' : 'buildings', title: sv ? 'Serviço sem lançamentos' : 'Obra sem lançamentos', sub: c.nome, action: sv ? 'Abrir serviço' : 'Abrir obra', go: [sv ? 'servico' : 'obra', { id: c.id }] });
      }
    }
    if (dash.aPagar > 0) {
      tasks.push({ alert: false, icon: 'calendar-blank', title: 'A pagar neste mês', sub: 'Contas pendentes com vencimento no mês', value: money(dash.aPagar), action: 'Ver', go: ['lancamentos', { situacao: 'pendente' }] });
    }
    return tasks;
  }

  CC.screens.home = async function (params) {
    const user = CC.session.user() || {};
    const first = String(user.nome || user.name || '').trim().split(/\s+/)[0];
    const el = CC.render(`${header('')}<p class="hello">${esc(CC.greeting())}${first ? `, ${esc(first)}` : ''}</p>
      <div class="skeleton"></div><div class="skeleton"></div>`);
    let result;
    try {
      result = await CC.cached(`dash-${CC.month()}`, `/dashboard/resumo?mes=${CC.month()}`);
    } catch (error) {
      return CC.errorScreen(el, error, () => CC.screens.home());
    }
    const dash = result.data;
    const tasks = tasksFrom(dash, CC.queue.state);
    const active = (dash.porCentro || []).filter((c) => c.situacao !== 'concluido').length;
    const title = tasks.length ? (tasks.length === 1 ? '1 pendência hoje' : `${tasks.length} pendências hoje`) : 'Nada pendente hoje';
    CC.render(`${header('')}<p class="hello">${esc(CC.greeting())}${first ? `, ${esc(first)}` : ''}</p>
      <h1 class="title">${esc(title)}</h1>${staleNote(result)}
      <button class="summary" type="button" id="resumo" aria-label="Ver lançamentos do mês">
        <span><small>Saldo de ${esc(CC.monthName())}</small><b>${esc((dash.saldo < 0 ? '− ' : '+ ') + moneyShort(dash.saldo))}</b></span>
        <span><small>Vencidas</small><b class="${dash.vencidos > 0 ? 'warn' : ''}">${esc(moneyShort(dash.vencidos))}</b></span>
        <span><small>Obras</small><b>${active === 1 ? '1 ativa' : `${active} ativas`}</b></span>
        ${icon('caret-right', 18)}
      </button>
      ${tasks.map((t, i) => `<div class="card task${t.alert ? ' hot' : ''}"><span class="ic">${icon(t.icon, 18)}</span>
        <span class="txt"><b>${esc(t.title)}</b><small>${esc(t.sub)}</small></span>${t.value ? `<span class="val">${esc(t.value)}</span>` : ''}
        <button class="chip-act" type="button" data-task="${i}">${esc(t.action)}${icon('arrow-right', 14)}</button></div>`).join('')}
      ${tasks.length ? '' : `<div class="empty">${icon('check-circle', 28)}Tudo em dia por aqui.</div>`}`, false, params);
    CC.$('#resumo').addEventListener('click', () => CC.go('lancamentos'));
    CC.$$('[data-task]').forEach((b) => b.addEventListener('click', () => { const t = tasks[Number(b.dataset.task)]; CC.go(t.go[0], t.go[1]); }));
  };

  // Abas Obras / Servicos / Todos da lista, lembradas no celular (sem armazenamento, volta para Todos). Prototipo: Rodada 28 (28a a 28j).
  const TIPO_CHAVE = 'cc.m.obras.tipo';
  const TIPOS = [['obra', 'Obras'], ['servico', 'Serviços'], ['todos', 'Todos']];
  function tipoAtual() {
    try { const v = localStorage.getItem(TIPO_CHAVE); if (TIPOS.some(([t]) => t === v)) return v; } catch (e) { /* sem armazenamento */ }
    return 'todos';
  }
  function guardarTipo(v) { try { localStorage.setItem(TIPO_CHAVE, v); } catch (e) { /* sem armazenamento */ } }
  // Filtro de situacao da lista (como no desktop), lembrado por tipo. Obras inativas so aparecem no filtro proprio.
  const SIT_OBRA = [['', 'Ativas'], ['execucao', 'Em execução'], ['planejamento', 'Planejamento'], ['pausado', 'Pausadas'], ['concluido', 'Concluídas'], ['inativas', 'Inativas']];
  const SIT_SERV = [['', 'Todos'], ['agendado', 'Agendados'], ['em_andamento', 'Em andamento'], ['concluido', 'Concluídos'], ['faturado', 'Faturados']];
  const sitAtual = (tipo) => { try { return localStorage.getItem(`cc.m.obras.sit.${tipo}`) || ''; } catch (e) { return ''; } };
  const guardarSit = (tipo, v) => { try { localStorage.setItem(`cc.m.obras.sit.${tipo}`, v); } catch (e) { /* sem armazenamento */ } };

  function obraRow(c) {
    const budget = Number(c.orcamento), spent = Number(c.total_comprometido), p = pct(spent, budget);
    const over = p !== null && p > 100, atencao = p !== null && p > 80; // desktop: atencao acima de 80%
    const tag = c.ativo === false ? '<span class="tag">Inativa</span>' : (Number(c.total_lancamentos || 0) === 0 && !spent ? '<span class="tag">Nova</span>'
      : (p === null ? '<span class="tag">Sem orçamento</span>' : `<span class="tag${atencao ? ' warn' : ''}">${p}% gasto</span>`));
    return `<button class="row" type="button" data-obra="${c.id}">
      <span class="line"><span class="grow"><span class="name">${esc(c.nome)}</span><br><span class="cli">${esc(c.cliente || c.codigo || '')}</span></span>${tag}${icon('caret-right', 16)}</span>
      ${p === null ? '' : `<span class="bar${over ? ' warn' : ''}"><span style="width:${Math.min(100, p)}%"></span></span>`}
      <span class="foot">Gasto ${esc(moneyShort(spent))}${budget > 0 ? ` de ${esc(moneyShort(budget))} orçado` : ''}</span></button>`;
  }

  // Cartao compacto do servico: codigo, data, nome, cliente, tecnico, situacao e cobrado, gasto e resultado numa linha.
  function servicoRow(v) {
    const ve = v.valor !== undefined;
    return `<button class="row sv-row" type="button" data-servico="${v.id}">
      <span class="line"><span class="grow"><small class="sv-cod">${esc(v.codigo)}${v.data ? ` · ${esc(CC.dateBr(v.data))}` : ''}</small><span class="name">${esc(v.nome)}</span>
        <span class="cli">${esc([v.cliente, v.responsavel].filter(Boolean).join(' · '))}</span></span>${CC.sv.badge(v.situacao)}${icon('caret-right', 16)}</span>
      <span class="sv-nums">${ve ? `<span>Cobrado <b>${esc(money(v.valor))}</b></span>` : ''}<span>Gasto <b>${Number(v.gastos) ? esc(money(v.gastos)) : 'Sem gastos'}</b></span>
        ${ve ? `<span>Resultado <b class="${Number(v.resultado) < 0 ? 'down' : 'up'}">${esc(money(v.resultado))}</b></span>` : ''}</span></button>`;
  }

  // Tres totais que acompanham a aba. Tecnico (sem valores) ve contagem e gastos.
  function totais(tipo, obras, servs) {
    const ve = servs.length ? servs.some((v) => v.valor !== undefined) : CC.sv.can('p1');
    const sum = (list, f) => list.reduce((a, x) => a + (Number(f(x)) || 0), 0);
    const mes = servs.filter((v) => String(v.data || '').startsWith(CC.month()));
    const oGas = sum(obras, (c) => c.total_comprometido), oCont = sum(obras, (c) => c.valor_contrato);
    const andamento = servs.filter((v) => v.situacao === 'em_andamento').length;
    let k;
    if (tipo === 'obra') k = [['Obras', String(obras.length), `${obras.filter((c) => c.situacao === 'execucao').length} em execução`], ['Contratado', moneyShort(oCont), 'soma dos contratos'], ['Gasto', moneyShort(oGas), 'até hoje']];
    else if (tipo === 'servico') {
      k = ve ? [['Cobrado', moneyShort(sum(mes, (v) => v.valor)), `${mes.length} em ${CC.monthName()}`], ['Gastos', moneyShort(sum(mes, (v) => v.gastos)), 'do mês'], ['Resultado', moneyShort(sum(mes, (v) => v.resultado)), 'cobrado − gastos']]
        : [['Serviços', String(servs.length), CC.sv.plural(servs.filter((v) => v.situacao === 'agendado').length, 'agendado', 'agendados')], ['Em andamento', String(andamento), 'agora'], ['Gastos', moneyShort(sum(servs, (v) => v.gastos)), 'lançados']];
    } else {
      k = [['Centros', String(obras.length + servs.length), `${obras.length} obras · ${servs.length} serviços`],
        ve ? ['Receita', moneyShort(oCont + sum(servs, (v) => v.valor)), 'contratos e serviços'] : ['Em andamento', String(andamento), 'serviços'],
        ['Gasto', moneyShort(oGas + sum(servs, (v) => v.gastos)), 'até hoje']];
    }
    return `<div class="summary sv-totais">${k.map(([l, v, s]) => `<span><small>${esc(l)}</small><b>${esc(v)}</b><small>${esc(s)}</small></span>`).join('')}</div>`;
  }

  CC.screens.obras = async function (params) {
    const tipo = tipoAtual();
    if (CC.sv) await CC.sv.loadPerms();
    const novo = CC.sv && CC.sv.can('p5') ? `<button class="sv-novo" type="button" id="novo">${icon('plus', 16)}Novo</button>` : '';
    const top = `<div class="top"><span class="brand"><img src="simbolo.png" alt=""><span>Centro de Custos</span></span>${CC.bellBtn ? CC.bellBtn() : ''}${novo}${CC.suitePill()}</div>
      <div class="seg obras-tipo" role="group" aria-label="Obra ou serviço">${TIPOS.map(([v, t]) => `<button type="button" data-tipo="${v}" aria-pressed="${v === tipo}">${t}</button>`).join('')}</div>`;
    const bind = () => {
      CC.$$('[data-tipo]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.tipo === tipo) return; guardarTipo(b.dataset.tipo); CC.screens.obras(params); }));
      const n = CC.$('#novo');
      if (n) n.addEventListener('click', () => CC.sv.form({ tipo: tipo === 'obra' ? 'obra' : 'servico' }));
    };
    const el = CC.render(`${top}<div class="skeleton" style="height:72px"></div><div class="skeleton"></div><div class="skeleton"></div>`, false, params);
    bind();
    let obrasRes = { data: [] }, servRes = { data: [] };
    try {
      [obrasRes, servRes] = await Promise.all([tipo === 'servico' ? obrasRes : CC.cached('obras', `/centros-custo?mes=${CC.month()}`),
        tipo === 'obra' ? servRes : CC.cached('servicos', '/servicos?ativo=true')]);
    } catch (error) {
      return CC.errorScreen(el, error, () => CC.screens.obras());
    }
    const sitO = tipo === 'obra' ? sitAtual('obra') : '', sitS = tipo === 'servico' ? sitAtual('servico') : '';
    const obras = (obrasRes.data || []).filter((c) => (c.tipo || 'obra') === 'obra'
      && (sitO === 'inativas' ? c.ativo === false : c.ativo !== false && (!sitO || c.situacao === sitO)));
    const servs = (servRes.data || []).filter((v) => v.ativo !== false && (!sitS || v.situacao === sitS));
    const sits = tipo === 'obra' ? SIT_OBRA : (tipo === 'servico' ? SIT_SERV : null);
    const chips = sits ? `<div class="chips" role="group" aria-label="Situação">${sits.map(([k, l]) => `<button class="chip-act" type="button" data-sit="${k}" aria-pressed="${k === (tipo === 'obra' ? sitO : sitS)}">${l}</button>`).join('')}</div>` : '';
    const stale = obrasRes.stale ? obrasRes : servRes;
    const title = tipo === 'obra' ? 'Obras' : tipo === 'servico' ? 'Serviços' : 'Obras e serviços';
    const sub = tipo === 'obra' ? `${obras.length} obras · orçado × gasto` : tipo === 'servico' ? `${servs.length} serviços · ${CC.monthName()}` : `${obras.length} obras e ${servs.length} serviços`;
    const vazio = `<div class="empty">${icon(tipo === 'servico' ? 'wrench' : 'buildings', 28)}${sitO || sitS ? 'Nada nesta situação.' : (tipo === 'servico' ? 'Nenhum serviço cadastrado.' : tipo === 'todos' ? 'Nenhuma obra ou serviço cadastrado.' : 'Nenhuma obra cadastrada.')}</div>`;
    const lista = tipo === 'obra' ? obras.map(obraRow).join('') : tipo === 'servico' ? servs.map(servicoRow).join('')
      : `${obras.length ? `<div class="group">Obras</div>${obras.map(obraRow).join('')}` : ''}${servs.length ? `<div class="group">Serviços</div>${servs.map(servicoRow).join('')}` : ''}`;
    CC.render(`${top}<h1 class="title">${title}</h1><p class="sub">${esc(sub)}</p>${staleNote(stale)}${totais(tipo, obras, servs)}${chips}
      <div class="rows">${lista || vazio}</div>`, false, params);
    bind();
    CC.$$('[data-sit]').forEach((b) => b.addEventListener('click', () => { guardarSit(tipo, b.dataset.sit); CC.screens.obras(params); }));
    CC.$$('[data-obra]').forEach((b) => b.addEventListener('click', () => CC.go('obra', { id: Number(b.dataset.obra) })));
    CC.$$('[data-servico]').forEach((b) => b.addEventListener('click', () => CC.go('servico', { id: Number(b.dataset.servico) })));
    return undefined;
  };
})(window.CC = window.CC || {});
