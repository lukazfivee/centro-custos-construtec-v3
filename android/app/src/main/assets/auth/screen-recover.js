// [E] Recuperar senha em 4 passos: e-mail, confira seu e-mail, senha nova e senha alterada.
(function (root) {
  const { UI, App, AuthRules: R, Native } = root;
  const { icon, esc } = UI;
  let lastSent = 0;
  let newPassword = '';

  const backLink = () => `<button class="link back" id="voltar" type="button">${icon('arrow-left', 18)}Voltar ao login</button>`;

  function stepEmail(params, el) {
    const card = UI.$('#card', el);
    const err = UI.$('#err', el);
    const email = UI.$('#email', el);
    const send = UI.$('#enviar', el);
    card.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (send.disabled) return;
      const local = R.validateEmail(email.value);
      if (local) { UI.setAlert(err, local); return UI.shake(card); }
      UI.setAlert(err, '');
      UI.busy(send, true, 'Enviando…');
      const result = await Native.call('resetRequest', { email: email.value.trim() });
      UI.busy(send, false);
      if (!result.ok) {
        if (result.code === 'NOT_AVAILABLE') App.state.resetUnavailable = true;
        UI.setAlert(err, R.messageForCode(result.code));
        return UI.shake(card);
      }
      lastSent = Date.now();
      App.lastEmail = email.value.trim();
      recover({ step: 2, email: App.lastEmail });
    });
    email.focus();
  }

  function stepSent(params, el) {
    const resend = UI.$('#reenviar', el);
    const label = UI.$('span', resend);
    const tick = () => {
      if (!resend.isConnected) return;
      const left = R.resendRemaining(lastSent, Date.now());
      resend.disabled = left > 0;
      label.textContent = left > 0 ? `Reenviar em ${left}s` : 'Reenviar e-mail';
      if (left > 0) setTimeout(tick, 1000);
    };
    tick();
    resend.addEventListener('click', async () => {
      if (resend.disabled) return;
      resend.disabled = true;
      const result = await Native.call('resetRequest', { email: params.email });
      if (result.ok) { lastSent = Date.now(); UI.toast('Enviamos de novo. Veja também a caixa de spam.', 'envelope-simple'); }
      else UI.toast(R.messageForCode(result.code), 'warning-circle');
      tick();
    });
  }

  function stepPassword(params, el) {
    const card = UI.$('#card', el);
    const err = UI.$('#err', el);
    const pw = UI.$('#nova', el);
    const pw2 = UI.$('#conf', el);
    const save = UI.$('#salvar', el);
    const bars = UI.$$('.meter span', el);
    const lbl = UI.$('#forca', el);
    const items = UI.$$('.checklist span', el);
    const update = () => {
      const s = R.passwordStrength(pw.value);
      bars.forEach((bar, i) => { bar.style.background = i < s.score ? s.color : ''; });
      lbl.textContent = s.label;
      lbl.style.color = s.color;
      const checks = R.passwordChecks(pw.value);
      items.forEach((item) => {
        const on = checks[item.dataset.k];
        item.classList.toggle('on', on);
        item.firstElementChild.outerHTML = icon(on ? 'check-circle' : 'x', 14);
      });
    };
    pw.addEventListener('input', update);
    update();
    card.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (save.disabled) return;
      const local = R.validateNewPassword(pw.value, pw2.value);
      if (local) { UI.setAlert(err, local); return UI.shake(card); }
      UI.setAlert(err, '');
      UI.busy(save, true, 'Salvando…');
      const result = await Native.call('resetConfirm', { token: params.token, password: pw.value });
      UI.busy(save, false);
      if (!result.ok) {
        UI.setAlert(err, R.messageForCode(result.code));
        UI.shake(card);
        if (result.code === 'TOKEN_INVALID' || result.code === 'TOKEN_EXPIRED') {
          save.outerHTML = UI.primary('pedir', 'Pedir um novo link', 'envelope-simple');
          UI.$('#pedir', el).addEventListener('click', () => recover({ step: 1 }));
        }
        return;
      }
      newPassword = pw.value;
      recover({ step: 4 });
    });
    pw.focus();
  }

  const BODIES = {
    1: (p) => `${backLink()}
      <form class="card" id="card" novalidate>
        <span class="badge-ico big">${icon('key', 24)}</span>
        <h1>Esqueceu a senha?</h1>
        <span class="muted">Digite o e-mail da empresa. Mandamos um link para você criar uma senha nova.</span>
        ${UI.field({ id: 'email', label: 'E-mail', icon: 'envelope-simple', placeholder: 'voce@empresa.com.br', inputmode: 'email', autocomplete: 'username', value: p.email || App.lastEmail })}
        ${UI.alertLine('err')}
        <button class="btn" id="enviar" type="submit"><span>Enviar link</span>${icon('arrow-right', 18)}</button>
      </form>`,
    2: (p) => `<span class="spacer"></span>
      <div class="center fade-up" style="gap:14px">
        <span class="envelope" aria-hidden="true">${icon('envelope-open', 96)}<span class="seal">${icon('check-circle-fill', 22)}</span></span>
        <h1 class="hero">Confira seu e-mail</h1>
        <span class="muted" style="max-width:300px">Enviamos o link para <b>${esc(p.email)}</b>. Ele vale por 30 minutos. Veja também a caixa de spam.</span>
      </div>
      <span class="spacer"></span>
      <div class="card"><button class="btn2" id="reenviar" type="button" style="flex:none">${icon('envelope-simple', 18)}<span>Reenviar e-mail</span></button>
      ${UI.primary('voltar', 'Voltar ao login')}</div>`,
    3: () => `${backLink()}
      <form class="card" id="card" novalidate>
        <span class="badge-ico big">${icon('lock-key', 24)}</span>
        <h1>Crie uma senha nova</h1>
        ${UI.field({ id: 'nova', label: 'Senha nova', icon: 'lock-key', placeholder: 'Senha nova', autocomplete: 'new-password', password: true })}
        <div class="meter" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
        <span id="forca" role="status" style="font-size:12px;font-weight:600"></span>
        <div class="checklist">
          <span data-k="length"><i></i>8+ caracteres</span><span data-k="upper"><i></i>Letra maiúscula</span>
          <span data-k="number"><i></i>Um número</span><span data-k="symbol"><i></i>Um símbolo</span>
        </div>
        ${UI.field({ id: 'conf', label: 'Confirme a senha', icon: 'lock-key', placeholder: 'Digite de novo', autocomplete: 'new-password', password: true })}
        ${UI.alertLine('err')}
        <button class="btn" id="salvar" type="submit"><span>Salvar senha</span>${icon('check-circle', 18)}</button>
      </form>`,
    4: () => `<span class="spacer"></span>
      <div class="center fade-up" style="gap:16px">
        ${UI.success(104, { green: true, label: 'Senha alterada' })}
        <h1 class="hero">Senha alterada</h1>
        <span class="muted" style="max-width:300px">Por segurança, encerramos as sessões nos outros aparelhos. Entre com a senha nova para continuar.</span>
      </div>
      <span class="spacer"></span>
      ${UI.primary('entrar', 'Entrar com a senha nova', 'arrow-right')}`,
  };

  function recover(params) {
    const step = params.step || 1;
    if (step === 3 && !params.token) return recover({ step: 1 });
    const el = UI.render(BODIES[step](params), 'step');
    UI.wireEyes(el);
    const back = UI.$('#voltar', el);
    if (back) back.addEventListener('click', () => App.go('login'));
    if (step === 1) stepEmail(params, el);
    if (step === 2) stepSent(params, el);
    if (step === 3) stepPassword(params, el);
    if (step === 4) {
      UI.$('#entrar', el).addEventListener('click', () => {
        const password = newPassword;
        newPassword = '';
        App.go('login', { email: App.lastEmail, password });
      });
    }
  }
  recover.back = () => App.go('login');

  root.Screens.recover = recover;
})(window);
