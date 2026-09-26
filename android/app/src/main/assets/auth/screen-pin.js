// [B] PIN do dia a dia, [B2] PIN bloqueado e [C] criar ou trocar PIN.
(function (root) {
  const { UI, App, AuthRules: R, Native } = root;
  const { icon, esc } = UI;
  const LETTERS = ['', 'ABC', 'DEF', 'GHI', 'JKL', 'MNO', 'PQRS', 'TUV', 'WXYZ'];

  function copy(mode, step) {
    const st = App.state;
    const name = App.name();
    if (mode === 'create' || (mode === 'change' && step > 0)) {
      return step === 2
        ? { title: 'Confirme o PIN', sub: 'Digite o mesmo PIN mais uma vez', status: '' }
        : { title: 'Crie seu PIN', sub: '6 dígitos para entrar rápido neste aparelho', status: 'Evite datas e sequências como 123456' };
    }
    if (mode === 'change') return { title: 'Trocar PIN', sub: 'Digite o PIN atual', status: '' };
    if (mode === 'rewrap') return { title: 'Digite seu PIN', sub: 'Para guardar o novo acesso neste aparelho', status: 'O PIN vale só para este aparelho' };
    const status = st.online === false ? 'Sem internet · o PIN funciona mesmo assim' : 'O PIN vale só para este aparelho';
    const sub = mode === 'lock' ? 'O app ficou fora da tela · digite o PIN' : 'Digite seu PIN de 6 dígitos';
    return { title: name ? `Olá, ${name}` : 'Olá', sub, status };
  }

  function keypad(showBio) {
    const keys = [];
    for (let n = 1; n <= 9; n += 1) keys.push(`<button class="key" type="button" data-d="${n}" aria-label="${n}"><b>${n}</b><small>${LETTERS[n - 1]}</small></button>`);
    keys.push(`<button class="key icon${showBio ? '' : ' hide'}" type="button" id="kbio" aria-label="Entrar com a digital"${showBio ? '' : ' tabindex="-1" aria-hidden="true"'}>${icon('fingerprint', 24)}</button>`);
    keys.push('<button class="key" type="button" data-d="0" aria-label="0"><b>0</b><small></small></button>');
    keys.push(`<button class="key icon" type="button" id="kdel" aria-label="Apagar">${icon('backspace', 24)}</button>`);
    return `<div class="pad">${keys.join('')}</div>`;
  }

  function footer(mode) {
    if (mode === 'enter' || mode === 'lock') return `<div class="links">${UI.link('forgot', 'Esqueci o PIN')}${UI.link('email', 'Entrar com e-mail', 'envelope-simple')}</div>`;
    if (mode === 'rewrap') return `<div class="links" style="justify-content:center">${UI.link('newpin', 'Criar PIN novo')}</div>`;
    if (mode === 'change') return `<div class="links" style="justify-content:center">${UI.link('cancel', 'Cancelar')}</div>`;
    return `<div class="links" style="justify-content:center">${UI.link('skip', 'Agora não, entrar sem PIN')}</div>`;
  }

  function pin(params) {
    const mode = params.mode || 'enter';
    let step = params.step != null ? params.step : (mode === 'create' ? 1 : 0);
    let digits = '';
    let first = params.first || '';
    let working = false;
    const st = App.state;
    const unlocking = mode === 'enter' || mode === 'lock' || mode === 'rewrap';
    const showBio = unlocking && st.bioEnabled && st.bioAvailable;
    const text = copy(mode, step);
    const avatar = R.initials(st.profile && st.profile.name) || icon('lock-simple', 28);

    const el = UI.render(`
      <div class="center fade-up" style="gap:10px;margin-top:8px">
        <span class="avatar" aria-hidden="true">${avatar}</span>
        <span style="display:flex;flex-direction:column;gap:2px"><h1 class="title" style="font-size:20px">${esc(text.title)}</h1><span class="muted" style="font-size:13px">${esc(text.sub)}</span></span>
      </div>
      <div class="center" id="dotsbox" style="gap:10px">
        <div class="dots-row" aria-hidden="true">${'<span class="dot"></span>'.repeat(6)}</div>
        <span class="pin-status" role="status" id="status">${esc(text.status)}</span>
        <span class="sr" id="count" aria-live="polite"></span>
      </div>
      <span class="spacer"></span>
      ${keypad(showBio)}
      ${footer(mode)}`, step > 0 ? 'step' : '');

    const dots = UI.$$('.dot', el);
    const status = UI.$('#status', el);
    const count = UI.$('#count', el);

    function paint() {
      dots.forEach((dot, i) => dot.classList.toggle('on', i < digits.length));
      count.textContent = `${digits.length} de 6 dígitos`;
    }
    function say(message, kind) {
      status.textContent = message;
      status.className = `pin-status${kind ? ` ${kind}` : ''}`;
    }
    function reject(message) {
      digits = '';
      paint();
      say(message, 'err');
      UI.shake(UI.$('#dotsbox', el));
      if (navigator.vibrate) navigator.vibrate(60);
    }

    async function unlockResult(result) {
      if (result.ok) {
        say('Entrando…', 'busy');
        return App.enter();
      }
      if (result.code === 'PIN_LOCKED') { await App.refresh(); return App.go('locked'); }
      if (result.code === 'PIN_WRONG') return reject(R.pinAttemptMessage(result.failures));
      if (result.code === 'SESSION_EXPIRED' || result.code === 'SESSION_INVALID') {
        await App.refresh();
        return App.go('login', { notice: R.messageForCode(result.code) });
      }
      return reject(R.messageForCode(result.code));
    }

    async function complete() {
      working = true;
      const value = digits;
      if (unlocking) {
        say('Entrando…', 'busy');
        await unlockResult(await Native.call('unlockPin', { pin: value }));
      } else if (mode === 'change' && step === 0) {
        const result = await Native.call('checkPin', { pin: value });
        if (result.ok) { working = false; return pin({ mode, step: 1 }); }
        if (result.code === 'PIN_LOCKED') { await App.refresh(); working = false; return App.go('locked'); }
        reject(R.pinAttemptMessage(result.failures));
      } else if (step === 1) {
        const check = R.validatePinChoice(value);
        working = false;
        if (!check.ok) return reject(check.message);
        return pin({ mode, step: 2, first: value });
      } else {
        working = false;
        if (value !== first) { UI.toast(R.MSG.pinMismatch, 'warning-circle'); return pin({ mode, step: 1 }); }
        say('Salvando…', 'busy');
        const result = await Native.call('createPin', { pin: value });
        if (!result.ok) return reject(R.messageForCode(result.code));
        await App.refresh();
        if (mode === 'change') { App.go('security'); return UI.toast('PIN trocado'); }
        if (App.state.bioAvailable) return App.go('bioAsk');
        return App.enter('PIN criado');
      }
      working = false;
    }

    function press(d) {
      if (working || digits.length >= 6) return;
      digits += d;
      paint();
      if (digits.length === 6) setTimeout(complete, 120);
    }

    UI.$$('[data-d]', el).forEach((key) => key.addEventListener('click', () => press(key.dataset.d)));
    UI.$('#kdel', el).addEventListener('click', () => { if (!working) { digits = digits.slice(0, -1); paint(); } });
    const bio = UI.$('#kbio', el);
    if (showBio) bio.addEventListener('click', () => root.Screens.bioUnlock());
    const on = (id, fn) => { const b = UI.$(`#${id}`, el); if (b) b.addEventListener('click', fn); };
    on('forgot', async () => { await Native.call('forgetPin'); await App.refresh(); App.go('login', { notice: 'Entre com e-mail e senha para criar um PIN novo' }); });
    on('email', () => App.go('login'));
    on('newpin', async () => { await Native.call('forgetPin'); await App.refresh(); App.go('pin', { mode: 'create' }); });
    on('cancel', () => App.go('security'));
    on('skip', () => App.enter('Sem PIN · no próximo uso entre com e-mail'));

    const onKey = (event) => {
      if (!el.isConnected) return document.removeEventListener('keydown', onKey);
      if (/^\d$/.test(event.key)) press(event.key);
      else if (event.key === 'Backspace') UI.$('#kdel', el).click();
    };
    document.addEventListener('keydown', onKey);
    paint();
    if (showBio && params.autoBio !== false && mode !== 'rewrap' && step === 0) setTimeout(() => root.Screens.bioUnlock(), 350);
  }
  pin.back = () => {
    if (App.state.hasPin && App.current === 'pin') return Native.call('moveToBack');
    return App.go('login');
  };

  function locked() {
    const el = UI.render(`
      <div class="center fade-up" style="gap:10px;margin-top:8px">
        <span class="avatar locked" aria-hidden="true">${icon('lock-simple', 30)}</span>
        <span style="display:flex;flex-direction:column;gap:2px"><h1 class="title" style="font-size:20px">PIN bloqueado</h1><span class="muted" style="font-size:13px">Foram 3 tentativas erradas</span></span>
      </div>
      <span class="spacer"></span>
      <div class="card fade-up">
        <div class="row" style="align-items:flex-start"><span class="badge-ico warn">${icon('shield-warning', 18)}</span>
          <span style="font-size:13.5px">Por segurança, o PIN foi bloqueado neste aparelho. Entre com e-mail e senha para liberar e criar um PIN novo.</span></div>
        <span class="muted" style="font-size:12.5px">Suas propostas e lançamentos continuam salvos</span>
        ${UI.primary('toemail', 'Entrar com e-mail e senha', 'envelope-simple')}
      </div>
      <p class="subtle" style="text-align:center;margin:0;font-size:12.5px">Não foi você? Avise o administrador da Construtec.</p>`);
    UI.$('#toemail', el).addEventListener('click', () => App.go('login'));
  }

  root.Screens.pin = pin;
  root.Screens.locked = locked;
})(window);
