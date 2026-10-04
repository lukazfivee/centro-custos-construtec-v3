// Central de notificações (Fase 4): sino com contador no cabeçalho, lista por
// dia (Hoje, Ontem, Anteriores), filtro por app, marcar como lidas, preferências
// e notificação de teste. Os avisos ficam no Worker central (/api/notificacoes).
(function (CC) {
  const { esc, icon } = CC;
  const APPS = [['', 'Todos'], ['centro-custos', 'Centro de Custos'], ['orcamentos', 'Orçamentos'], ['conta', 'Conta']];
  const PREFS = [['proposta_aprovada', 'Proposta aprovada'], ['acima_orcado', 'Item acima do orçado'], ['conta_vencer', 'Contas a vencer'], ['novo_acesso', 'Novo acesso à conta'], ['pedido_acesso', 'Pedido de acesso (admin)'], ['cliente_aprovou', 'Cliente aprovou a proposta'], ['cliente_ajuste', 'Cliente pediu ajuste']];

  CC.notif = { unread: 0 };
  CC.bellBtn = () => {
    const n = CC.notif.unread;
    return `<button class="bell-btn" type="button" data-avisos aria-label="Notificações${n ? `, ${n} ${n === 1 ? 'nova' : 'novas'}` : ''}">${icon('bell', 22)}<span class="bell-count"${n ? '' : ' hidden'}>${n > 99 ? '99+' : n}</span></button>`;
  };
  function paintBell() {
    const n = CC.notif.unread;
    CC.$$('.bell-count').forEach((el) => { el.hidden = !n; el.textContent = n > 99 ? '99+' : String(n); });
    CC.$$('.bell-btn').forEach((el) => el.setAttribute('aria-label', `Notificações${n ? `, ${n} ${n === 1 ? 'nova' : 'novas'}` : ''}`));
  }
  CC.notif.refresh = async function () {
    try { CC.notif.unread = Number((await CC.api('/notificacoes?limite=1')).data.unread) || 0; } catch { /* sem central: o sino fica sem número */ }
    paintBell();
  };
  document.addEventListener('click', (event) => { if (event.target.closest('[data-avisos]')) CC.go('avisos'); });

  const dayKey = (iso) => new Date(iso).toLocaleDateString('en-CA');
  function group(iso) {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86400000);
    if (dayKey(iso) === today.toLocaleDateString('en-CA')) return 'Hoje';
    if (dayKey(iso) === yesterday.toLocaleDateString('en-CA')) return 'Ontem';
    return 'Anteriores';
  }
  const hour = (iso) => new Date(iso).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  // Destino do aviso: obra no Centro, proposta no Orçamentos ou o início.
  function open(link) {
    const [app, query] = String(link || '').split('?');
    const params = new URLSearchParams(query || '');
    if (app === 'orcamentos') { location.href = CC.suite.orcLink(params.get('proposta')); return; }
    if (params.get('pedidos') === '1' && CC.isAdmin && CC.isAdmin()) { CC.go('pedidos'); return; }
    const obra = Number(params.get('obra')) || 0;
    CC.go(obra ? 'obra' : 'home', obra ? { id: obra } : undefined);
  }

  function row(n) {
    return `<button class="aviso${n.read ? '' : ' novo'}" type="button" data-id="${esc(n.id)}" data-link="${esc(n.link || '')}">
      <span class="aviso-dot" aria-hidden="true"></span>
      <span class="aviso-text"><b>${esc(n.title)}</b><span>${esc(n.body)}</span><small>${esc(hour(n.createdAt))}</small></span></button>`;
  }

  CC.screens.avisos = async function (params) {
    const filter = params.app || '';
    const top = `<div class="top"><button class="back" type="button" id="voltar" aria-label="Voltar">${icon('caret-left', 20)}</button><h1>Notificações</h1></div>`;
    const el = CC.render(`${top}<div class="skeleton"></div><div class="skeleton"></div>`, true, params);
    CC.$('#voltar', el).addEventListener('click', () => CC.go('home'));
    let list, prefs;
    try {
      [list, prefs] = await Promise.all([CC.api('/notificacoes'), CC.api('/notificacoes/preferencias')]);
    } catch (error) {
      const page = CC.render(`${top}<p class="sub">${esc(error.message)}</p>`, true, params);
      CC.$('#voltar', page).addEventListener('click', () => CC.go('home'));
      return;
    }
    CC.notif.unread = Number(list.data.unread) || 0;
    const items = (list.data.items || []).filter((n) => !filter || n.app === filter);
    const groups = ['Hoje', 'Ontem', 'Anteriores'].map((g) => [g, items.filter((n) => group(n.createdAt) === g)]).filter(([, l]) => l.length);
    const page = CC.render(`${top}
      <div class="chips" role="group" aria-label="Filtrar por app">${APPS.map(([k, label]) => `<button type="button" class="chip-act" data-app="${k}" aria-pressed="${k === filter}">${label}</button>`).join('')}</div>
      ${CC.notif.unread ? `<button class="btn2 lidas" type="button" id="lidas">${icon('check', 18)}Marcar todas como lidas</button>` : ''}
      ${groups.length ? groups.map(([g, l]) => `<p class="sheet-sec">${g}</p><div class="avisos">${l.map(row).join('')}</div>`).join('')
        : `<p class="sub">Nenhuma notificação${filter ? ' neste filtro' : ''} por enquanto.</p>`}
      <p class="sheet-sec">Receber no celular</p>
      <div class="rows">${PREFS.map(([k, label]) => `<label class="menu-item pref"><span>${label}</span><input type="checkbox" data-pref="${k}"${prefs.data.prefs && prefs.data.prefs[k] === false ? '' : ' checked'}></label>`).join('')}</div>
      <button class="btn2" type="button" id="teste">${icon('bell', 18)}Enviar notificação de teste</button>`, true, params);
    paintBell();
    CC.$('#voltar', page).addEventListener('click', () => CC.go('home'));
    CC.$$('[data-app]', page).forEach((b) => b.addEventListener('click', () => CC.go('avisos', { app: b.dataset.app })));
    const lidas = CC.$('#lidas', page);
    if (lidas) lidas.addEventListener('click', async () => { await CC.api('/notificacoes/lidas', { method: 'POST', body: { todas: true } }).catch(() => {}); CC.go('avisos', { app: filter }); });
    CC.$$('.aviso', page).forEach((b) => b.addEventListener('click', async () => {
      if (b.classList.contains('novo')) await CC.api('/notificacoes/lidas', { method: 'POST', body: { ids: [b.dataset.id] } }).catch(() => {});
      CC.notif.refresh();
      open(b.dataset.link);
    }));
    CC.$$('[data-pref]', page).forEach((input) => input.addEventListener('change', async () => {
      try { await CC.api('/notificacoes/preferencias', { method: 'PUT', body: { tipo: input.dataset.pref, ativo: input.checked } }); }
      catch (error) { input.checked = !input.checked; CC.toast(error.message, 'warning-circle'); }
    }));
    CC.$('#teste', page).addEventListener('click', async () => {
      try {
        const { data } = await CC.api('/notificacoes/teste', { method: 'POST' });
        CC.toast(data.devices ? `Enviada para ${data.devices === 1 ? '1 aparelho' : `${data.devices} aparelhos`}.` : 'Nenhum celular com o app registrado nesta conta.');
      } catch (error) { CC.toast(error.message, 'warning-circle'); }
      CC.notif.refresh();
    });
  };
})(window.CC = window.CC || {});
