// Lancamentos (com a fila do celular) e Menu. Prototipo: aba Lancamentos e sCcMenu.
(function (CC) {
  const { esc, icon } = CC;
  const FILTERS = [['', 'Todos'], ['pendente', 'Em aberto'], ['vencido', 'Vencidos']];

  async function queueBlock() {
    const items = (await CC.queue.mine()).sort((a, b) => a.criado_em - b.criado_em);
    if (!items.length) return '';
    return `<span class="label">No celular</span>${items.map((i) => `<div class="tx"><span class="grow"><b>${esc(i.payload.favorecido || i.payload.descricao)}</b>
        <small>${esc(i.obra_nome)} · ${esc(CC.dateBr(i.payload.data))}</small>
        <small class="${i.estado === 'erro' ? 'state' : ''}">${i.estado === 'erro' ? esc('Não aceito: ' + i.erro) : (CC.queue.state.syncing ? 'Enviando…' : 'Na fila, sem internet')}</small>
        ${i.estado === 'erro' ? `<span class="grid2" style="margin-top:6px"><button class="btn2" type="button" data-retry="${esc(i.client_id)}">Tentar de novo</button>
          <button class="btn2" type="button" data-discard="${esc(i.client_id)}">Descartar</button></span>` : ''}</span>
        <span class="amt">${esc(CC.signed(-i.payload.valor))}</span></div>`).join('')}`;
  }

  CC.screens.lancamentos = async function (params) {
    const situacao = (params && params.situacao) || '';
    const tabs = `<div class="seg" role="group" aria-label="Filtro">${FILTERS.map(([k, l]) => `<button type="button" data-f="${k}" aria-pressed="${k === situacao}">${l}</button>`).join('')}</div>`;
    const el = CC.render(`${CC.header('Lançamentos')}${tabs}<div class="skeleton"></div>`);
    const wire = () => CC.$$('[data-f]').forEach((b) => b.addEventListener('click', () => CC.screens.lancamentos({ situacao: b.dataset.f })));
    wire();
    const local = await queueBlock();
    let result;
    try {
      const q = `paginar=1&limite=50&mes=${CC.month()}${situacao ? `&situacao=${situacao}` : ''}`;
      result = await CC.cached(`lanc-${situacao}-${CC.month()}`, `/lancamentos?${q}`);
    } catch (error) {
      if (error.status === 0 && local) {
        CC.render(`${CC.header('Lançamentos')}${tabs}${local}<p class="sub">Sem internet para mostrar os lançamentos do servidor.</p>`, false, params);
        return wire();
      }
      return CC.errorScreen(el, error, () => CC.screens.lancamentos(params));
    }
    const rows = (result.data.itens || result.data || []);
    let last = '';
    const list = rows.map((t) => {
      const head = t.data !== last ? `<div class="group">${esc(CC.dateFull(t.data))}</div>` : '';
      last = t.data;
      return head + CC.txRow(t, t.centro_nome);
    }).join('');
    CC.render(`${CC.header('Lançamentos')}${tabs}${CC.staleNote(result)}${local}
      ${local && rows.length ? `<span class="label">No Centro de Custos · ${esc(CC.monthName())}</span>` : ''}
      ${list || (local ? '' : `<div class="empty">${icon('list-bullets', 28)}Nenhum lançamento neste mês.</div>`)}`, false, params);
    wire();
    CC.$$('[data-retry]').forEach((b) => b.addEventListener('click', async () => { await CC.queue.retry(b.dataset.retry); CC.screens.lancamentos(params); }));
    CC.$$('[data-discard]').forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Toque de novo'; return; }
      await CC.queue.discard(b.dataset.discard);
      CC.screens.lancamentos(params);
    }));
  };

  CC.screens.menu = function () {
    const inApp = /SuiteConstrutec/.test(navigator.userAgent) || new URLSearchParams(location.search).has('app');
    const dark = CC.theme.get() === 'escuro';
    const user = CC.session.user() || {};
    const el = CC.render(`${CC.header('Menu')}
      <div class="rows">
        <button class="menu-item" type="button" id="m-perfil">${CC.avatar(CC.perfilFoto, user.nome, 40)}<span>${esc(user.nome || 'Meu perfil')}<small>${esc(user.email || '')} · Meu perfil</small></span></button>
        ${CC.ia && CC.ia.ready() ? `<button class="menu-item" type="button" id="m-ia">${icon('sparkle', 22)}<span>Assistente<small>Tire dúvidas sobre obras, custos e propostas e vá direto a qualquer tela</small></span></button>
        <button class="menu-item" type="button" id="m-bug">${icon('bug', 22)}<span>Reportar problema<small>Conte o que aconteceu e o assistente monta o relato</small></span></button>` : ''}
        <button class="menu-item" type="button" id="m-tema">${icon(dark ? 'sun' : 'moon', 22)}<span>${dark ? 'Modo claro' : 'Modo escuro'}</span></button>
        ${inApp ? `<button class="menu-item" type="button" id="m-seg">${icon('shield-check', 22)}<span>Segurança<small>PIN, digital, bloqueio automático e aparelhos</small></span></button>` : ''}
        ${CC.isAdmin && CC.isAdmin() ? `<button class="menu-item" type="button" id="m-pedidos">${icon('user-plus', 22)}<span>Pedidos de acesso<small>Aprovar cadastros, convidar por e-mail e código da empresa</small></span></button>` : ''}
        ${CC.isAdmin && CC.isAdmin() && CC.screens.descartadas ? `<button class="menu-item" type="button" id="m-desc">${icon('archive', 22)}<span>Obras descartadas<small id="m-desc-n">Recuperar obras guardadas</small></span></button>` : ''}
        ${inApp && CC.screens.atualizacao ? `<button class="menu-item" type="button" id="m-upd">${icon('arrow-counter-clockwise', 22)}<span>Atualização do aplicativo<small>Ver a versão instalada e instalar a mais nova</small></span></button>` : ''}
        ${inApp ? `<button class="menu-item" type="button" id="m-tour">${icon('arrow-right', 22)}<span>Rever o tour<small>As quatro telas de boas-vindas da Suíte</small></span></button>` : ''}
        <a class="menu-item" href="/" id="m-web" style="color:inherit;text-decoration:none">${icon('desktop', 22)}<span>Versão completa<small>Todas as telas do Centro de Custos</small></span></a>
        <button class="menu-item danger" type="button" id="m-sair">${icon('sign-out', 22)}<span>Sair</span></button>
      </div>`);
    CC.$('#m-tema', el).addEventListener('click', () => { CC.theme.toggle(); CC.screens.menu(); });
    CC.$('#m-perfil', el).addEventListener('click', () => CC.go('perfil'));
    // A foto chega depois (uma vez por abertura do site) e entra no lugar das iniciais.
    if (CC.perfilFoto === undefined) {
      CC.perfilFoto = null;
      CC.api('/perfil').then(({ data }) => {
        CC.perfilFoto = data.foto || null;
        const slot = CC.$('#m-perfil .avatar');
        if (slot && CC.perfilFoto) slot.outerHTML = CC.avatar(CC.perfilFoto, data.nome, 40);
      }).catch(() => { CC.perfilFoto = undefined; });
    }
    const ia = CC.$('#m-ia', el);
    if (ia) ia.addEventListener('click', () => CC.ia.open());
    const bug = CC.$('#m-bug', el);
    if (bug) bug.addEventListener('click', () => CC.ia.open('Quero reportar um problema no app.'));
    const pedidos = CC.$('#m-pedidos', el);
    if (pedidos) pedidos.addEventListener('click', () => CC.go('pedidos'));
    const desc = CC.$('#m-desc', el);
    if (desc) {
      desc.addEventListener('click', () => CC.go('descartadas'));
      CC.loadDescartadasCount().then((n) => { const s = CC.$('#m-desc-n'); if (s && n != null) s.textContent = n ? `${n} ${n > 1 ? 'guardadas' : 'guardada'} · recuperar` : 'Nenhuma guardada'; });
    }
    const seg = CC.$('#m-seg', el);
    if (seg) seg.addEventListener('click', () => { location.href = 'suite://seguranca'; });
    const upd = CC.$('#m-upd', el);
    if (upd) upd.addEventListener('click', () => CC.go('atualizacao'));
    const tour = CC.$('#m-tour', el);
    if (tour) tour.addEventListener('click', () => { location.href = 'suite://tour'; });
    CC.$('#m-sair', el).addEventListener('click', async () => {
      // Conta tambem os recusados: eles ficam guardados no celular ate a pessoa corrigir ou descartar.
      const pending = CC.queue.state.pending + CC.queue.state.errors;
      const b = CC.$('#m-sair', el);
      if (pending && b.dataset.armed !== '1') {
        b.dataset.armed = '1';
        b.querySelector('span').textContent = pending === 1 ? '1 lançamento ainda não foi enviado. Ele fica guardado neste celular. Toque de novo para sair.' : `${pending} lançamentos ainda não foram enviados. Eles ficam guardados neste celular. Toque de novo para sair.`;
        return;
      }
      if (CC.ia) CC.ia.reset();
      CC.session.clear(); // a fila do celular continua guardada para quando esta conta voltar
      if (inApp) { location.href = 'suite://sair'; return; }
      location.replace('/m/'); // volta para a tela de entrar do celular
    });
  };
})(window.CC = window.CC || {});
