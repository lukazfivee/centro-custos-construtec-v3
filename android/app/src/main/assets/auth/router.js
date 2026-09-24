// Estado e navegacao das telas de entrada. As telas se registram em window.Screens.
(function (root) {
  const Screens = root.Screens = root.Screens || {};
  const App = root.App = {
    state: { hasPin: false, hasSession: false, bioEnabled: false, bioAvailable: false, profile: null, autoLock: 300, online: true },
    current: '',
    lastEmail: '',
  };

  App.go = function (name, params) {
    const screen = Screens[name];
    if (!screen) return;
    App.current = name;
    const old = document.querySelector('.bio-overlay');
    if (old) old.remove();
    screen(params || {});
    const focusable = document.querySelector('#app h1, #app h2, #app .title, #app .hero');
    if (focusable) { focusable.setAttribute('tabindex', '-1'); focusable.focus({ preventScroll: true }); }
  };

  App.refresh = async function () {
    const result = await root.Native.call('state');
    if (result && result.ok) Object.assign(App.state, result);
    if (App.state.profile && App.state.profile.email) App.lastEmail = App.lastEmail || App.state.profile.email;
    return App.state;
  };

  App.name = function () {
    return root.AuthRules.firstName(App.state.profile && App.state.profile.name);
  };

  App.enter = function (notice) {
    return root.Native.call('enterApp', { notice: notice || '' });
  };

  // Decide a primeira tela conforme o motivo informado pelo lado nativo.
  App.route = function (reason, extra) {
    const st = App.state;
    const token = (extra && extra.resetToken) || st.resetToken || root.AuthRules.parseResetFragment(location.hash);
    if (reason === 'reset' || token) return App.go('recover', { step: 3, token });
    if (reason === 'security') return App.go('security');
    if (reason === 'menu') return App.go('menu');
    if (reason === 'lock' && st.hasPin) return App.go('pin', { mode: 'lock' });
    if (st.pinLocked) return App.go('locked');
    if (st.hasPin && st.hasSession) return App.go('pin', { mode: 'enter' });
    return App.go('login', { notice: extra && extra.notice });
  };

  root.Native.on(async (name, data) => {
    if (name !== 'show') return;
    await App.refresh();
    App.route(data.reason, data);
  });

  root.addEventListener('DOMContentLoaded', async () => {
    root.UI.wireGlow();
    await App.refresh();
    App.route(App.state.reason || 'start');
  });

  // Botao voltar do Android: o nativo pergunta se a tela quer tratar.
  root.__onBack = function () {
    const handler = Screens[App.current] && Screens[App.current].back;
    if (typeof handler === 'function') { handler(); return true; }
    return false;
  };
})(window);
