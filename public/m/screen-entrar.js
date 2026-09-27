// Entrar direto no site do celular (iPhone e navegador). No iPhone, o app da tela de
// inicio nao divide o login com o Safari, entao o /m/ precisa da propria tela de entrar.
(function (CC) {
  const { esc, icon } = CC;
  const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);

  async function post(url, body) {
    let response;
    try {
      response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
    } catch {
      throw new Error('Sem internet. Confira a conexão e tente de novo.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.erro || data.error || 'Não foi possível entrar agora.');
    return data;
  }

  function installTip() {
    if (!isIos() || standalone()) return '';
    return `<div class="card login-tip">${icon('squares-four', 20)}<span><b>Use como aplicativo</b>
      No Safari, toque em Compartilhar e depois em "Adicionar à Tela de Início". Depois abra pelo ícone e entre de novo.</span></div>`;
  }

  // onDone: chamado depois de salvar a sessão (o app.js segue a abertura normal).
  CC.loginScreen = function (message, onDone) {
    document.body.classList.add('no-tabs');
    const el = CC.render(`<div class="login">
      <img class="login-logo" src="simbolo.png" alt="">
      <h1 class="title">Centro de Custos</h1>
      <p class="sub">${esc(message || 'Entre com o seu e-mail da Construtec.')}</p>
      <form class="login-form" id="login-form" novalidate>
        <label class="field"><span>E-mail</span>
          <input id="login-email" type="email" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="email" required></label>
        <label class="field"><span>Senha</span>
          <span class="login-pass"><input id="login-senha" type="password" autocomplete="current-password" required>
          <button class="login-show" type="button" id="login-show" aria-pressed="false" aria-label="Mostrar senha">Mostrar</button></span></label>
        <p class="login-err" id="login-err" role="alert"></p>
        <button class="btn" type="submit" id="login-go">${icon('key', 20)}Entrar</button>
        <button class="btn2" type="button" id="login-forgot">Esqueci minha senha</button>
      </form>
      ${installTip()}
    </div>`);
    const email = CC.$('#login-email', el), senha = CC.$('#login-senha', el), err = CC.$('#login-err', el);
    const last = localStorage.getItem('cc_ultimo_email');
    if (last) email.value = last;

    CC.$('#login-show', el).addEventListener('click', (event) => {
      const visible = senha.type === 'password';
      senha.type = visible ? 'text' : 'password';
      event.currentTarget.textContent = visible ? 'Ocultar' : 'Mostrar';
      event.currentTarget.setAttribute('aria-pressed', String(visible));
      event.currentTarget.setAttribute('aria-label', visible ? 'Ocultar senha' : 'Mostrar senha');
    });

    CC.$('#login-form', el).addEventListener('submit', async (event) => {
      event.preventDefault();
      err.textContent = '';
      const value = email.value.trim().toLowerCase();
      if (!value || !senha.value) { err.textContent = 'Preencha o e-mail e a senha.'; return; }
      const go = CC.$('#login-go', el);
      go.disabled = true;
      try {
        const data = await post('/api/auth/login', { email: value, senha: senha.value });
        if (!data.token || !data.usuario || !data.instancia) throw new Error('Não foi possível entrar agora.');
        localStorage.setItem('cc_ultimo_email', value);
        CC.session.save(data);
        senha.value = '';
        onDone();
      } catch (error) {
        err.textContent = error.message;
        go.disabled = false;
      }
    });

    // Mesmo pedido do app Android: o e-mail leva para /redefinir-senha, que abre no Safari.
    CC.$('#login-forgot', el).addEventListener('click', async (event) => {
      const value = email.value.trim().toLowerCase();
      err.textContent = '';
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) { err.textContent = 'Digite o seu e-mail acima para receber o link.'; email.focus(); return; }
      const b = event.currentTarget;
      b.disabled = true;
      try {
        await post('/v1/auth/password-reset/request', { email: value });
        CC.toast('Se o e-mail estiver cadastrado, o link para criar uma nova senha chega em alguns minutos.', 'envelope-simple');
      } catch (error) {
        err.textContent = error.message;
      }
      setTimeout(() => { b.disabled = false; }, 60000);
    });
  };
})(window.CC = window.CC || {});
