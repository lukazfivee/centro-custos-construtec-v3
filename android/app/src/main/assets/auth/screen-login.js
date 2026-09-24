// [A] Login de vidro com e-mail e senha.
(function (root) {
  const { UI, App, AuthRules: R, Native } = root;
  const { icon, esc } = UI;
  const TILES = [
    ['video-camera', 'CFTV'], ['fire', 'SDAI'], ['fingerprint', 'Acesso'],
    ['shield-check', 'Alarme'], ['siren', 'Pânico'], ['bell-ringing', 'Enfermagem'],
  ];

  function greeting() {
    const name = App.name();
    return name ? `Bem-vindo(a), ${name}` : 'Bem-vindo(a)';
  }

  function login(params) {
    const st = App.state;
    const quick = st.hasSession && st.hasPin;
    const tiles = TILES.map(([name, label], i) => `<span class="tile" style="animation-delay:${(i * 0.35).toFixed(2)}s" title="${label}">${icon(name, 20)}</span>`).join('');
    const el = UI.render(`
      <div class="center brand fade-up">
        <img src="img/logo.png" alt="Construtec" id="logo">
        <small>Sistemas especiais · do orçamento à obra</small>
      </div>
      <div class="tiles" aria-hidden="true">${tiles}</div>
      <form class="card" id="card" novalidate>
        <h1>${esc(greeting())}</h1>
        ${UI.field({ id: 'email', label: 'E-mail', icon: 'envelope-simple', placeholder: 'voce@empresa.com.br', inputmode: 'email', autocomplete: 'username', value: params.email || App.lastEmail })}
        ${UI.field({ id: 'senha', label: 'Senha', icon: 'lock-key', placeholder: 'Sua senha', autocomplete: 'current-password', password: true, value: params.password })}
        ${UI.alertLine('err')}
        <button class="btn" id="entrar" type="submit"><span>Entrar</span>${icon('arrow-right', 18)}</button>
        ${quick ? `<div class="row">
          ${st.bioEnabled ? `<button class="btn2" id="bio" type="button">${icon('fingerprint', 18)}Biometria</button>` : ''}
          <button class="btn2" id="usepin" type="button">${icon('dots-nine', 18)}Usar PIN</button>
        </div>` : ''}
      </form>
      <div class="links">
        ${st.resetUnavailable ? '<span></span>' : UI.link('esqueci', 'Esqueci a senha')}
        ${UI.link('cadastro', 'Criar cadastro')}
      </div>
      <span class="spacer"></span>`);

    UI.wireEyes(el);
    const card = UI.$('#card', el);
    const err = UI.$('#err', el);
    const button = UI.$('#entrar', el);
    const email = UI.$('#email', el);
    const senha = UI.$('#senha', el);

    const fail = (message) => { UI.setAlert(err, message); UI.shake(card); };

    card.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (button.disabled) return;
      const local = R.validateLogin(email.value, senha.value);
      if (local) return fail(local);
      UI.setAlert(err, '');
      UI.busy(button, true, 'Verificando…');
      App.lastEmail = email.value.trim();
      const result = await Native.call('login', { email: email.value.trim(), password: senha.value });
      UI.busy(button, false);
      if (!result.ok) return fail(R.messageForCode(result.code));
      senha.value = '';
      await App.refresh();
      // Com PIN ja definido, o PIN guarda a sessao nova no cofre (a senha nunca fica no aparelho).
      if (App.state.hasPin) return App.go('pin', { mode: 'rewrap' });
      App.go('pin', { mode: 'create' });
      UI.toast('Senha certa · agora crie seu PIN');
    });

    UI.$('#cadastro', el).addEventListener('click', () => UI.toast('Peça seu acesso ao administrador da Construtec', 'shield-check'));
    const forgot = UI.$('#esqueci', el);
    if (forgot) forgot.addEventListener('click', () => App.go('recover', { step: 1, email: email.value.trim() }));
    const usePin = UI.$('#usepin', el);
    if (usePin) usePin.addEventListener('click', () => App.go('pin', { mode: 'enter' }));
    const bio = UI.$('#bio', el);
    if (bio) bio.addEventListener('click', () => root.Screens.bioUnlock());

    // Toque longo no logo abre a configuracao de servidor local (modo instalacao Windows).
    let pressTimer = 0;
    const logo = UI.$('#logo', el);
    logo.addEventListener('pointerdown', () => { pressTimer = setTimeout(() => Native.call('openLocalSetup'), 900); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => logo.addEventListener(type, () => clearTimeout(pressTimer)));
    logo.addEventListener('contextmenu', (event) => event.preventDefault());

    if (params.notice) UI.toast(params.notice, 'shield-check');
    if (!email.value) email.focus(); else if (!senha.value) senha.focus();
  }

  root.Screens.login = login;
})(window);
