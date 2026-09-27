// Pedidos de acesso (Fase 5), só para admin: código da empresa, pedidos pendentes
// (aprovar com o perfil escolhido ou recusar) e convites por e-mail. Os dados
// ficam no Worker central; o Centro repassa em /api/cadastros.
(function (CC) {
  const { esc, icon } = CC;
  const PERFIS = [['supervisor', 'Supervisor'], ['gestor', 'Gestor'], ['admin', 'Admin']];
  const nomePerfil = (p) => (PERFIS.find(([k]) => k === p) || [p, p])[1];
  const quando = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const fone = (d) => (String(d || '').length >= 10 ? String(d).replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3') : '');

  CC.isAdmin = () => ((CC.session.user() || {}).role === 'admin');

  function perfis(name, value) {
    return `<div class="seg" role="group" aria-label="Perfil">${PERFIS.map(([k, l]) => `<button type="button" data-${name}="${k}" aria-pressed="${k === value}">${l}</button>`).join('')}</div>`;
  }

  function pedido(r) {
    return `<div class="card pedido" data-id="${esc(r.id)}" style="margin-bottom:10px">
      <b>${esc(r.name)}</b>
      <div class="muted" style="font-size:13px">${esc(r.email)}${r.phone ? ` · ${esc(fone(r.phone))}` : ''}</div>
      <div class="muted" style="font-size:11.5px;margin:2px 0 10px">Pedido em ${esc(quando(r.createdAt))}</div>
      <span class="label">Perfil ao aprovar</span>${perfis('perfil', 'supervisor')}
      <span class="grid2" style="margin-top:10px"><button class="btn2" type="button" data-recusar>${icon('x', 18)}Recusar</button>
        <button class="btn" type="button" data-aprovar>${icon('check', 18)}Aprovar</button></span></div>`;
  }

  CC.screens.pedidos = async function (params) {
    const top = `<div class="top"><button class="back" type="button" id="voltar" aria-label="Voltar">${icon('caret-left', 20)}</button><h1>Pedidos de acesso</h1></div>`;
    const back = (el) => CC.$('#voltar', el).addEventListener('click', () => CC.go('menu'));
    back(CC.render(`${top}<div class="skeleton"></div><div class="skeleton"></div>`, true, params));
    let data;
    try { data = (params.data) || (await CC.api('/cadastros')).data; } catch (error) {
      return back(CC.render(`${top}<p class="sub">${esc(error.message)}</p>`, true, params));
    }
    if (data.disponivel === false) return back(CC.render(`${top}<p class="sub">${esc(data.motivo || '')}</p>`, true, params));
    const reqs = data.requests || [], invites = data.invites || [];
    const page = CC.render(`${top}
      <div class="card" style="margin-bottom:6px"><span class="label">Código da empresa</span>
        <div style="display:flex;align-items:center;gap:10px;margin-top:4px"><b style="font-size:22px;letter-spacing:.06em;flex:1">${esc(data.code || '')}</b>
          <button class="btn2" type="button" id="trocar" style="padding:0 14px">${icon('key', 18)}Trocar</button></div>
        <p class="muted" style="font-size:12px;margin:6px 0 0">Quem se cadastra pelo app informa este código. O pedido chega aqui para você aprovar.</p></div>
      <p class="sheet-sec">Aguardando aprovação${reqs.length ? ` · ${reqs.length}` : ''}</p>
      ${reqs.length ? reqs.map(pedido).join('') : `<p class="sub">Nenhum pedido pendente.</p>`}
      <p class="sheet-sec">Convidar por e-mail</p>
      <div class="card"><label class="field"><span>E-mail</span><input id="c-email" type="email" inputmode="email" autocomplete="off" maxlength="200" placeholder="nome@empresa.com.br"></label>
        <span class="label">Perfil</span>${perfis('convite', 'supervisor')}
        <p class="alert" role="alert" id="c-err"></p>
        <button class="btn" type="button" id="convidar" style="margin-top:10px;width:100%">${icon('envelope-simple', 18)}Enviar convite</button>
        <p class="muted" style="font-size:12px;margin:8px 0 0">O convite vale 7 dias. A conta criada pelo link já sai aprovada.</p></div>
      ${invites.length ? `<p class="sheet-sec">Convites enviados</p><div class="card">${invites.map((i) => `<div class="kv"><span>${esc(i.email)}</span><b>${esc(nomePerfil(i.role))}</b></div>`).join('')}</div>` : ''}`, true, params);
    back(page);
    const again = (d) => CC.screens.pedidos({ ...params, data: d });
    const act = async (button, path, body, done) => {
      button.disabled = true;
      try { const res = await CC.api(path, { method: 'POST', body }); CC.toast(done); CC.notif && CC.notif.refresh(); again(res.data); }
      catch (error) { button.disabled = false; CC.toast(error.message, 'warning-circle'); }
    };
    CC.$$('.seg', page).forEach((seg) => seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) CC.$$('button', seg).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }));
    CC.$$('.pedido', page).forEach((card) => {
      const role = () => CC.$('[aria-pressed="true"]', card).dataset.perfil;
      CC.$('[data-aprovar]', card).addEventListener('click', (e) => act(e.currentTarget, `/cadastros/${encodeURIComponent(card.dataset.id)}/aprovar`, { perfil: role() }, 'Acesso aprovado. A pessoa recebe um e-mail.'));
      CC.$('[data-recusar]', card).addEventListener('click', (e) => {
        const b = e.currentTarget;
        if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.lastChild.textContent = 'Toque de novo'; return; }
        act(b, `/cadastros/${encodeURIComponent(card.dataset.id)}/recusar`, {}, 'Pedido recusado.');
      });
    });
    CC.$('#trocar', page).addEventListener('click', (e) => {
      const b = e.currentTarget;
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.lastChild.textContent = 'Confirmar'; CC.toast('O código atual deixa de valer para novos cadastros.', 'warning-circle'); return; }
      act(b, '/cadastros/codigo/trocar', {}, 'Código trocado.');
    });
    CC.$('#convidar', page).addEventListener('click', (e) => {
      const email = CC.$('#c-email', page).value.trim();
      const err = CC.$('#c-err', page);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Informe um e-mail válido.'; return; }
      err.textContent = '';
      const role = CC.$('[data-convite][aria-pressed="true"]', page).dataset.convite;
      act(e.currentTarget, '/cadastros/convites', { email, perfil: role }, `Convite enviado para ${email}.`);
    });
  };
})(window.CC = window.CC || {});
