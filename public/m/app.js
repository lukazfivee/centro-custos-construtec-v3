// Navegacao, barra de abas, entrada pelo app (handoff) e modo offline do site do celular.
(function (CC) {
  const { esc, icon } = CC;
  CC.screens = CC.screens || {};
  const TABS = [
    ['home', 'Início', 'squares-four', ['home']],
    ['obras', 'Obras', 'buildings', ['obras', 'obra', 'servico', 'servico-rel']],
    ['lancar', 'Lançar', 'plus-circle', ['lancar', 'ok']],
    ['lancamentos', 'Lançamentos', 'list-bullets', ['lancamentos']],
    ['menu', 'Menu', 'list', ['menu', 'pedidos', 'perfil', 'descartadas', 'descartada', 'atualizacao']],
  ];
  let current = 'home', currentParams = {};
  let lensTimer;
  CC.nav = 0;
  CC.current = () => current; // o assistente conta a tela aberta para a IA

  function paintTabs() {
    const nav = document.getElementById('tabs');
    const activeIndex = TABS.findIndex(([, , , owns]) => owns.includes(current));
    if (nav.dataset.activeIndex !== undefined && Number(nav.dataset.activeIndex) !== activeIndex) {
      nav.classList.add('is-moving');
      clearTimeout(lensTimer);
      lensTimer = setTimeout(() => nav.classList.remove('is-moving'), 340);
    }
    nav.dataset.activeIndex = String(activeIndex);
    nav.style.setProperty('--active-x', `${Math.max(0, activeIndex) * 100}%`);
    nav.innerHTML = '<span class="tabs-refraction" aria-hidden="true"></span>' + TABS.map(([key, label, ic, owns]) => {
      const on = owns.includes(current);
      return `<button class="tab" type="button" data-go="${key}"${on ? ' aria-current="page"' : ''}>${icon(on ? `${ic}-fill` : ic, 22)}<span>${label}</span></button>`;
    }).join('');
    CC.$$('[data-go]', nav).forEach((b) => b.addEventListener('click', () => CC.go(b.dataset.go, b.dataset.go === 'lancar' ? { novo: true, from: [current] } : undefined)));
    if (!nav.classList.contains('is-ready')) requestAnimationFrame(() => nav.classList.add('is-ready'));
  }

  CC.go = function (name, params) {
    const screen = CC.screens[name];
    if (!screen) return;
    current = name;
    if (CC.suite) CC.suite.context = null;
    currentParams = { ...(params || {}) };
    delete currentParams.__nav;
    CC.nav += 1;
    document.body.classList.remove('no-tabs');
    paintTabs();
    history.replaceState(null, '', `#${name}`);
    const nav = CC.nav;
    Promise.resolve(screen({ ...currentParams, __nav: nav })).catch((error) => {
      if (error instanceof CC.Stale || nav !== CC.nav) return;
      CC.errorScreen(document.getElementById('view'), error, () => CC.go(name, params));
    });
  };

  CC.errorScreen = function (el, error, retry) {
    const offline = error && error.status === 0;
    const text = offline ? 'Sem internet e sem dados salvos para esta tela ainda.' : (error && error.message) || 'Não foi possível carregar agora.';
    const main = el && el.tagName === 'MAIN' ? el : document.getElementById('view');
    main.innerHTML = `${CC.header('')}<div class="empty">${icon(offline ? 'wifi-slash' : 'warning-circle', 28)}${esc(text)}
      <button class="btn2" type="button" id="retry" style="padding:0 18px">Tentar de novo</button></div>`;
    CC.$('#retry', main).addEventListener('click', retry);
  };

  function signedOut(message) {
    document.body.classList.add('no-tabs');
    // No iPhone e no navegador o login e aqui mesmo; no app Android volta para a tela do app.
    if (!/SuiteConstrutec/.test(navigator.userAgent)) return CC.loginScreen(message, () => start());
    CC.render(`${CC.header('')}<div class="empty" style="padding-top:60px">${icon('shield-check', 32)}
      <b style="color:var(--text);font-size:17px">${esc(message || 'Entre para usar o Centro de Custos')}</b>
      <span>Entre de novo no aplicativo.</span>
      <a class="btn" href="suite://entrar" style="padding:0 22px;text-decoration:none">Entrar</a></div>`);
  }
  CC.onUnauthorized = () => { if (CC.ia && CC.ia.reset) CC.ia.reset(); signedOut('Sua sessão terminou'); };
  CC.onQueueSent = () => { if (['home', 'lancamentos', 'obra', 'servico'].includes(current)) CC.go(current, currentParams); };

  async function consumeHandoff(code) {
    history.replaceState(null, '', location.pathname + location.search);
    const response = await fetch('/v1/auth/handoff/consume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.token || !data.usuario || !data.instancia) throw new Error('Não foi possível entrar pelo aplicativo.');
    CC.session.save(data);
  }

  async function boot() {
    CC.theme.apply(CC.theme.get());
    const hash = new URLSearchParams(location.hash.slice(1));
    const code = hash.get('handoff');
    const obra = Number(hash.get('obra')) || 0; // link direto #obra=<id> (seletor Suite)
    const pedidos = hash.get('pedidos') === '1'; // aviso de pedido de acesso (admin)
    if (code) {
      try { await consumeHandoff(code); } catch (error) { if (!CC.session.token()) return signedOut(error.message); }
    }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => { /* segue sem modo offline */ });
    if (!CC.session.token()) return signedOut();
    return start(obra, pedidos);
  }

  let started = false;
  // Depois de entrar pela tela do /m/, sem recarregar: so abre o Inicio se ja tinha aberto antes.
  async function start(obra, pedidos) {
    if (started) return CC.go('home');
    started = true;
    await CC.queue.refresh();
    CC.queue.paint();
    CC.queue.run();
    // Contador do sino (Fase 4): na abertura e ao voltar para o app.
    if (CC.notif) {
      CC.notif.refresh();
      document.addEventListener('visibilitychange', () => { if (!document.hidden && CC.session.token()) CC.notif.refresh(); });
    }
    // O app Android troca so o fragmento da WebView ja aberta para ir a uma obra.
    window.addEventListener('hashchange', () => {
      const target = new URLSearchParams(location.hash.slice(1));
      const id = Number(target.get('obra')) || 0;
      if (id > 0 && CC.session.token()) CC.go('obra', { id });
      if (target.get('pedidos') === '1' && CC.session.token()) CC.go('pedidos');
    });
    if (obra > 0) return CC.go('obra', { id: obra });
    if (pedidos) return CC.go('pedidos');
    const first = location.hash.slice(1);
    CC.go(CC.screens[first] && !['ok', 'obra', 'login', 'descartada', 'servico', 'servico-rel'].includes(first) ? first : 'home');
  }

  document.addEventListener('DOMContentLoaded', boot);
})(window.CC = window.CC || {});
