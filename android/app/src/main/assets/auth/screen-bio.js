// [D] Oferta de biometria e sobreposicao de leitura biometrica.
(function (root) {
  const { UI, App, Native } = root;
  const { icon, esc } = UI;

  function overlay() {
    const old = UI.$('.bio-overlay');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'bio-overlay';
    el.innerHTML = `<span class="scan-orb">${icon('fingerprint', 56)}<span class="scan-line"></span></span><span role="status">Toque no sensor</span>`;
    document.body.appendChild(el);
    return {
      done() {
        el.innerHTML = `${UI.success(112, { label: 'Reconhecido' })}<span role="status">Reconhecido</span>`;
        return UI.wait(1500);
      },
      close() { el.remove(); },
    };
  }

  function explain(code) {
    if (code === 'BIO_INVALIDATED') return 'A digital mudou neste aparelho. Use o PIN e ative de novo em Segurança.';
    if (code === 'BIO_UNAVAILABLE') return 'A biometria não está disponível neste aparelho.';
    if (code === 'BIO_LOCKOUT') return 'Muitas tentativas na digital. Use o PIN.';
    return '';
  }

  async function bioUnlock() {
    const view = overlay();
    const result = await Native.call('bioUnlock');
    if (result.ok) {
      await view.done();
      return App.enter();
    }
    view.close();
    if (result.code === 'PIN_LOCKED') { await App.refresh(); return App.go('locked'); }
    if (result.code === 'SESSION_EXPIRED' || result.code === 'SESSION_INVALID') {
      await App.refresh();
      return App.go('login', { notice: root.AuthRules.messageForCode(result.code) });
    }
    const message = explain(result.code);
    if (message) {
      UI.toast(message, 'warning-circle');
      await App.refresh();
      if (App.current === 'pin') App.go('pin', { mode: 'enter', autoBio: false });
    }
  }

  async function enroll(then) {
    const view = overlay();
    const result = await Native.call('bioEnroll');
    if (!result.ok) {
      view.close();
      const message = explain(result.code);
      if (message) UI.toast(message, 'warning-circle');
      return false;
    }
    await view.done();
    await App.refresh();
    if (then) then();
    return true;
  }

  function bioAsk() {
    const name = App.name();
    const perks = [
      ['lightning', 'Mais rápido que digitar o PIN'],
      ['hand', 'Funciona com a mão livre, sem teclado'],
      ['dots-nine', 'O PIN continua valendo como alternativa'],
    ].map(([ico, text]) => `<span class="perk"><i>${icon(ico, 16)}</i>${esc(text)}</span>`).join('');
    const el = UI.render(`
      <span class="spacer"></span>
      <div class="center fade-up" style="gap:18px">
        <span class="scan-orb" aria-hidden="true"><span class="pulse"></span>${icon('fingerprint', 64)}<span class="scan-line"></span></span>
        <span style="display:flex;flex-direction:column;gap:8px;max-width:290px">
          <h1 class="hero">Entrar com a digital?</h1>
          <span class="muted">PIN criado. Quer entrar ainda mais rápido na próxima vez?</span>
        </span>
      </div>
      <span class="spacer"></span>
      <div class="card" style="padding:16px">${perks}${UI.primary('ativar', 'Ativar biometria', 'arrow-right')}</div>
      <div class="links" style="justify-content:center">${UI.link('agora', 'Agora não')}</div>`);
    UI.$('#ativar', el).addEventListener('click', () => enroll(() => App.enter(name ? `Biometria ativada · bem-vindo(a), ${name}` : 'Biometria ativada')));
    UI.$('#agora', el).addEventListener('click', () => App.enter('Dá para ativar depois em Menu → Segurança'));
  }
  bioAsk.back = () => App.enter('Dá para ativar depois em Menu → Segurança');

  root.Screens.bioAsk = bioAsk;
  root.Screens.bioUnlock = bioUnlock;
  root.Screens.bioEnroll = enroll;
})(window);
