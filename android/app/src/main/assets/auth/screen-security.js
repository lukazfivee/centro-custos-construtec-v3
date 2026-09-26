// Seguranca (PIN, biometria, bloqueio automatico, aparelhos) e menu do shell.
(function (root) {
  const { UI, App, AuthRules: R, Native } = root;
  const { icon, esc } = UI;

  function when(epochSeconds) {
    if (!epochSeconds) return '';
    const date = new Date(epochSeconds * 1000);
    return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  async function loadDevices(box) {
    box.innerHTML = '<span class="subtle">Carregando…</span>';
    const result = await Native.call('sessions');
    if (!box.isConnected) return;
    if (!result.ok) { box.innerHTML = `<span class="subtle">${esc(R.messageForCode(result.code))}</span>`; return; }
    if (!result.sessions.length) { box.innerHTML = '<span class="subtle">Nenhum aparelho conectado.</span>'; return; }
    box.innerHTML = result.sessions.map((s) => `<span class="device">${icon('device-mobile', 20)}<span style="flex:1">${esc(s.instanceName || 'Aparelho')}${s.current ? ' · este aparelho' : ''}<br><small>Último uso ${esc(when(s.lastSeenAt))}</small></span></span>`).join('');
  }

  function confirmTwice(button, confirmLabel, action) {
    let armed = false;
    const original = button.innerHTML;
    button.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        button.innerHTML = `<span>${esc(confirmLabel)}</span>`;
        setTimeout(() => { if (armed && button.isConnected) { armed = false; button.innerHTML = original; } }, 4000);
        return;
      }
      armed = false;
      button.innerHTML = original;
      await action();
    });
  }

  function security() {
    const st = App.state;
    const bioReason = !st.bioAvailable ? 'Este aparelho não tem biometria cadastrada' : (!st.hasPin ? 'Crie um PIN antes' : (st.bioEnabled ? 'Ativa neste aparelho' : 'Desativada'));
    const seg = R.AUTO_LOCK.map((o) => `<button type="button" data-s="${o.seconds}" aria-pressed="${o.seconds === st.autoLock}">${esc(o.label)}</button>`).join('');
    const el = UI.render(`
      <button class="link back" id="voltar" type="button">${icon('arrow-left', 18)}Voltar ao app</button>
      <h1 class="title">Segurança</h1>
      <div class="card">
        <div class="sec-row"><span class="badge-ico">${icon('dots-nine', 16)}</span><span class="txt"><b>PIN de acesso</b><small>${st.hasPin ? 'Definido · 6 dígitos' : 'Não definido'}</small></span>
          <button class="chip-btn" id="trocar" type="button">${st.hasPin ? 'Trocar' : 'Criar'}</button></div>
        <div class="sec-sep"></div>
        <div class="sec-row"><span class="badge-ico">${icon('fingerprint', 16)}</span><span class="txt"><b id="biolbl">Entrar com biometria</b><small>${esc(bioReason)}</small></span>
          <button class="switch" id="bio" type="button" role="switch" aria-labelledby="biolbl" aria-checked="${Boolean(st.bioEnabled)}"${st.bioAvailable && st.hasPin ? '' : ' disabled'}></button></div>
        <div class="sec-sep"></div>
        <div class="sec-row"><span class="badge-ico">${icon('timer', 16)}</span><span class="txt"><b>Bloqueio automático</b><small>Pede o PIN ao voltar para o app</small></span></div>
        <div class="seg" role="group" aria-label="Bloqueio automático">${seg}</div>
        <div class="sec-sep"></div>
        <div class="sec-row"><span class="badge-ico">${icon('shield-warning', 16)}</span><span class="txt"><b>Bloqueio após 3 erros</b><small>O PIN é apagado deste aparelho depois de 3 tentativas erradas</small></span></div>
      </div>
      <div class="card">
        <b>Aparelhos conectados</b>
        <div id="devices" style="display:flex;flex-direction:column;gap:10px"></div>
        <button class="btn2" id="outros" type="button" style="flex:none">${icon('sign-out', 18)}<span>Sair de todos os outros aparelhos</span></button>
      </div>`, 'step');

    UI.$('#voltar', el).addEventListener('click', () => Native.call('close'));
    UI.$('#trocar', el).addEventListener('click', () => App.go('pin', st.hasPin ? { mode: 'change', step: 0 } : { mode: 'change', step: 1 }));
    const bio = UI.$('#bio', el);
    bio.addEventListener('click', async () => {
      if (bio.getAttribute('aria-checked') === 'true') {
        await Native.call('bioDisable');
        await App.refresh();
        return security();
      }
      const ok = await root.Screens.bioEnroll();
      await App.refresh();
      security();
      if (ok) UI.toast('Biometria ativada');
    });
    UI.$$('.seg button', el).forEach((btn) => btn.addEventListener('click', async () => {
      const seconds = Number(btn.dataset.s);
      await Native.call('setAutoLock', { seconds });
      App.state.autoLock = seconds;
      UI.$$('.seg button', el).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    }));
    const devices = UI.$('#devices', el);
    confirmTwice(UI.$('#outros', el), 'Toque de novo para confirmar', async () => {
      const result = await Native.call('revokeOthers');
      if (!result.ok) return UI.toast(R.messageForCode(result.code), 'warning-circle');
      UI.toast(result.revoked === 1 ? '1 aparelho desconectado' : `${result.revoked} aparelhos desconectados`);
      loadDevices(devices);
    });
    loadDevices(devices);
  }
  security.back = () => Native.call('close');

  function menu() {
    document.body.classList.add('see-through');
    const app = document.getElementById('app');
    app.innerHTML = `<div class="scrim" id="scrim"></div>
      <div class="sheet" role="dialog" aria-label="Menu da Suíte">
        <span class="grab" aria-hidden="true"></span>
        <button class="sheet-item" id="m-seg" type="button">${icon('shield-check', 22)}Segurança</button>
        <button class="sheet-item" id="m-sair" type="button">${icon('sign-out', 22)}Sair</button>
        <button class="sheet-item danger" id="m-esquecer" type="button">${icon('x', 22)}<span>Sair e esquecer este aparelho</span></button>
      </div>`;
    const close = () => { document.body.classList.remove('see-through'); Native.call('close'); };
    UI.$('#scrim').addEventListener('click', close);
    UI.$('#m-seg').addEventListener('click', () => { document.body.classList.remove('see-through'); App.go('security'); });
    UI.$('#m-sair').addEventListener('click', () => { document.body.classList.remove('see-through'); Native.call('logout', { forget: false }); });
    confirmTwice(UI.$('#m-esquecer'), 'Toque de novo para esquecer este aparelho', () => {
      document.body.classList.remove('see-through');
      return Native.call('logout', { forget: true });
    });
  }
  menu.back = () => { document.body.classList.remove('see-through'); Native.call('close'); };

  root.Screens.security = security;
  root.Screens.menu = menu;
})(window);
