// [F] Cadastro pelo app (Fase 5): nome, e-mail, celular, código da empresa e senha forte.
// Com código, o pedido fica pendente até um admin aprovar; com o link do convite
// (código e e-mail já preenchidos), a conta sai aprovada e a pessoa já entra.
(function (root) {
  const { UI, App, AuthRules: R, Native } = root;
  const { icon, esc } = UI;
  let created = { email: '', password: '' };

  const backLink = () => `<button class="link back" id="voltar" type="button">${icon('arrow-left', 18)}Voltar ao login</button>`;

  function wireMeter(el) {
    const pw = UI.$('#senha', el);
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
  }

  function form(p) {
    const invite = p.invite || null;
    const el = UI.render(`${backLink()}
      <form class="card" id="card" novalidate>
        <span class="badge-ico big">${icon(invite ? 'envelope-open' : 'user', 24)}</span>
        <h1>${invite ? 'Aceitar convite' : 'Criar cadastro'}</h1>
        <span class="muted">${invite ? 'Você foi convidado para a Suíte Construtec. Complete os dados e crie sua senha.'
          : 'Preencha seus dados e o código da empresa. Um administrador da Construtec aprova o seu acesso.'}</span>
        ${UI.field({ id: 'nome', label: 'Nome completo', icon: 'user', placeholder: 'Seu nome', autocomplete: 'name', value: p.name })}
        ${UI.field({ id: 'email', label: 'E-mail', icon: 'envelope-simple', placeholder: 'voce@empresa.com.br', inputmode: 'email', autocomplete: 'email', value: (invite && invite.email) || p.email })}
        ${UI.field({ id: 'celular', label: 'Celular', icon: 'device-mobile', placeholder: '(11) 98765-4321', inputmode: 'tel', autocomplete: 'tel', value: p.phone })}
        ${invite ? '' : UI.field({ id: 'codigo', label: 'Código da empresa', icon: 'buildings', placeholder: 'CONST-XXXXXX', autocomplete: 'off', value: p.companyCode })}
        ${UI.field({ id: 'senha', label: 'Senha', icon: 'lock-key', placeholder: 'Crie uma senha', autocomplete: 'new-password', password: true })}
        <div class="meter" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
        <span id="forca" role="status" style="font-size:12px;font-weight:600"></span>
        <div class="checklist">
          <span data-k="length"><i></i>8+ caracteres</span><span data-k="upper"><i></i>Letra maiúscula</span>
          <span data-k="number"><i></i>Um número</span><span data-k="symbol"><i></i>Um símbolo</span>
        </div>
        ${UI.field({ id: 'conf', label: 'Confirme a senha', icon: 'lock-key', placeholder: 'Digite de novo', autocomplete: 'new-password', password: true })}
        <label class="accept"><input type="checkbox" id="aceite"><span>Concordo com o uso dos meus dados (nome, e-mail e celular) para o acesso à Suíte Construtec.</span></label>
        ${UI.alertLine('err')}
        <button class="btn" id="criar" type="submit"><span>${invite ? 'Criar conta' : 'Enviar pedido'}</span>${icon('arrow-right', 18)}</button>
      </form>
      <span class="spacer"></span>`, 'step');
    UI.wireEyes(el);
    wireMeter(el);
    const $ = (id) => UI.$(`#${id}`, el);
    const card = $('card'), err = $('err'), button = $('criar');
    $('voltar').addEventListener('click', () => App.go('login'));
    $('celular').addEventListener('input', (e) => { e.target.value = R.formatPhone(e.target.value); });
    const code = $('codigo');
    if (code) code.addEventListener('input', () => { code.value = code.value.toUpperCase(); });
    const fail = (message) => { UI.setAlert(err, message); UI.shake(card); };

    card.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (button.disabled) return;
      const data = {
        name: $('nome').value.trim(), email: $('email').value.trim().toLowerCase(), phone: $('celular').value,
        companyCode: code ? code.value.trim() : (invite.code || ''), password: $('senha').value, confirm: $('conf').value,
        accept: $('aceite').checked, invite: Boolean(invite),
      };
      const local = R.validateSignup(data);
      if (local) return fail(local);
      UI.setAlert(err, '');
      UI.busy(button, true, 'Enviando…');
      const result = await Native.call('signup', {
        name: data.name, email: data.email, phone: data.phone.replace(/\D/g, ''), companyCode: data.companyCode,
        password: data.password, acceptTerms: true, inviteToken: invite ? invite.token : '',
      });
      UI.busy(button, false);
      if (!result.ok) return fail(result.message || R.messageForCode(result.code));
      App.lastEmail = data.email;
      if (result.status === 'approved') {
        created = { email: data.email, password: data.password };
        return signup({ step: 'approved' });
      }
      signup({ step: 'pending', email: data.email });
    });
    UI.$('#nome', el).focus();
  }

  function pending(p) {
    const el = UI.render(`<span class="spacer"></span>
      <div class="center fade-up" style="gap:14px">
        <span class="badge-ico big">${icon('hourglass-medium', 26)}</span>
        <h1 class="hero">Pedido enviado</h1>
        <span class="muted" style="max-width:300px">Um administrador da Construtec vai analisar o seu acesso. Quando for aprovado, você recebe um e-mail em <b>${esc(p.email)}</b> e já pode entrar com a senha que criou.</span>
      </div>
      <span class="spacer"></span>
      ${UI.primary('entrar', 'Voltar ao login')}`, 'step');
    UI.$('#entrar', el).addEventListener('click', () => App.go('login', { email: p.email }));
  }

  function approved() {
    const el = UI.render(`<span class="spacer"></span>
      <div class="center fade-up" style="gap:16px">
        ${UI.success(104, { green: true, label: 'Conta criada' })}
        <h1 class="hero">Conta criada</h1>
        <span class="muted" style="max-width:300px">Seu acesso à Suíte Construtec está liberado. Entre para criar o PIN deste aparelho.</span>
      </div>
      <span class="spacer"></span>
      ${UI.primary('entrar', 'Entrar', 'arrow-right')}`, 'step');
    UI.$('#entrar', el).addEventListener('click', () => {
      const { email, password } = created;
      created = { email: '', password: '' };
      App.go('login', { email, password });
    });
  }

  function signup(params) {
    if (params.step === 'pending') return pending(params);
    if (params.step === 'approved') return approved();
    return form(params);
  }
  signup.back = () => App.go('login');

  root.Screens.signup = signup;
})(window);
