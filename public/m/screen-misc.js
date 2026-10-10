// Menu do site do celular. Prototipo: sCcMenu. A lista de lancamentos fica em screen-lancamentos.js.
(function (CC) {
  const { esc, icon } = CC;

  CC.screens.menu = function (params) {
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
        <button class="menu-item" type="button" id="m-senha">${icon('key', 22)}<span>Alterar senha<small>Troque a senha de entrada da Suíte</small></span></button>
        <a class="menu-item" href="/d/" id="m-web" style="color:inherit;text-decoration:none">${icon('desktop', 22)}<span>Versão completa<small>Fechamento, cobranças, cadastros e usuários (tela de computador)</small></span></a>
        <button class="menu-item danger" type="button" id="m-sair">${icon('sign-out', 22)}<span>Sair</span></button>
      </div>`, false, params);
    CC.$('#m-senha', el).addEventListener('click', () => CC.senhaSheet());
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
