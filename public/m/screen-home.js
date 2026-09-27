// Inicio (pendencias do dia e resumo do mes) e lista de Obras. Prototipo: sCcHome e sObras.
(function (CC) {
  const { esc, icon, money, moneyShort } = CC;

  function header(title) {
    return `<div class="top"><span class="brand"><img src="simbolo.png" alt="">Centro de Custos</span><span class="grow"></span></div>
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
      tasks.push({ alert: true, icon: 'warning-circle', title: 'Contas vencidas', sub: dash.qtdVencidos === 1 ? '1 conta passou do vencimento' : `${dash.qtdVencidos} contas passaram do vencimento`, value: money(dash.vencidos), action: 'Ver', go: ['lancamentos', { situacao: 'vencido' }] });
    }
    for (const c of dash.porCentro || []) {
      const budget = Number(c.orcamento), spent = Number(c.comprometido);
      if (budget > 0 && spent > budget) {
        tasks.push({ alert: true, icon: 'trend-up', title: 'Custo acima do orçado', sub: c.nome + ' passou ' + moneyShort(spent - budget) + ' do orçado', action: 'Ver obra', go: ['obra', { id: c.id }] });
      } else if (Number(c.qtd_lancamentos) === 0 && c.situacao !== 'concluido') {
        tasks.push({ alert: false, icon: 'buildings', title: 'Obra sem lançamentos', sub: c.nome, action: 'Abrir obra', go: ['obra', { id: c.id }] });
      }
    }
    if (dash.aPagar > 0) {
      tasks.push({ alert: false, icon: 'calendar-blank', title: 'A pagar neste mês', sub: 'Contas pendentes com vencimento no mês', value: money(dash.aPagar), action: 'Ver', go: ['lancamentos', { situacao: 'pendente' }] });
    }
    return tasks;
  }

  CC.screens.home = async function () {
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
      ${tasks.length ? '' : `<div class="empty">${icon('check-circle', 28)}Tudo em dia por aqui.</div>`}`);
    CC.$('#resumo').addEventListener('click', () => CC.go('lancamentos'));
    CC.$$('[data-task]').forEach((b) => b.addEventListener('click', () => { const t = tasks[Number(b.dataset.task)]; CC.go(t.go[0], t.go[1]); }));
  };

  CC.screens.obras = async function () {
    const el = CC.render(`${header('Obras')}<div class="skeleton"></div><div class="skeleton"></div>`);
    let result;
    try {
      result = await CC.cached('obras', `/centros-custo?mes=${CC.month()}`);
    } catch (error) {
      return CC.errorScreen(el, error, () => CC.screens.obras());
    }
    const list = (result.data || []).filter((c) => c.ativo !== false);
    const running = list.filter((c) => c.situacao !== 'concluido').length;
    const rows = list.map((c) => {
      const budget = Number(c.orcamento), spent = Number(c.total_comprometido), p = pct(spent, budget);
      const over = p !== null && p > 100;
      const tag = Number(c.total_lancamentos || 0) === 0 && !spent ? '<span class="tag">Nova</span>'
        : (p === null ? '<span class="tag">Sem orçamento</span>' : `<span class="tag${over ? ' warn' : ''}">${p}% gasto</span>`);
      return `<button class="row" type="button" data-obra="${c.id}">
        <span class="line"><span class="grow"><span class="name">${esc(c.nome)}</span><br><span class="cli">${esc(c.cliente || c.codigo || '')}</span></span>${tag}${icon('caret-right', 16)}</span>
        ${p === null ? '' : `<span class="bar${over ? ' warn' : ''}"><span style="width:${Math.min(100, p)}%"></span></span>`}
        <span class="foot">Gasto ${esc(moneyShort(spent))}${budget > 0 ? ` de ${esc(moneyShort(budget))} orçado` : ''}</span></button>`;
    }).join('');
    CC.render(`${header('Obras')}<p class="sub">${running === 1 ? '1 obra em execução' : `${running} obras em execução`}</p>${staleNote(result)}
      <div class="rows">${rows || `<div class="empty">${icon('buildings', 28)}Nenhuma obra cadastrada.</div>`}</div>`);
    CC.$$('[data-obra]').forEach((b) => b.addEventListener('click', () => CC.go('obra', { id: Number(b.dataset.obra) })));
  };
})(window.CC = window.CC || {});
