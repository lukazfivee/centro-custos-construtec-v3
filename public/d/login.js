// Tela de entrar do desktop (Rodada 29): marca a esquerda, formulario a direita, tema no canto.
// Usa o mesmo /api/auth/login do celular e da pagina antiga; o bloqueio por tentativas e do servidor.
// "Esqueci a senha" pede o link ao diretorio central (/v1, igual ao celular), que vale para os dois apps.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const ic = (nome, tam) => D.ic(nome, tam);
  const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const CHAVE_EMAIL = 'cc_ultimo_email'; // a mesma do celular
  const CHAVE_AVISO = 'cc_d_aviso';
  const CHAVE_TEMPORARIA = 'cc_d_sessao_temporaria';
  const COOKIE_ABERTA = 'cc_d_aberta';

  const ler = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const gravar = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* sem armazenamento */ } };

  // Aviso que a tela de entrar mostra depois de recarregar (sair ou sessao terminada).
  // "Manter conectado" desmarcado: a sessao vale ate fechar o navegador. O cookie de sessao (sem validade)
  // e comum a todas as abas e some ao fechar o navegador; sem ele, a sessao guardada e descartada.
  D.sessao = {
    avisar(tipo) { try { sessionStorage.setItem(CHAVE_AVISO, tipo); } catch { /* segue sem aviso */ } },
    aviso() {
      let tipo = '';
      try { tipo = sessionStorage.getItem(CHAVE_AVISO) || ''; sessionStorage.removeItem(CHAVE_AVISO); } catch { /* sem aviso */ }
      return tipo;
    },
    conferirTemporaria() {
      if (ler(CHAVE_TEMPORARIA) !== '1') return;
      if (document.cookie.split(/;\s*/).includes(`${COOKIE_ABERTA}=1`)) return;
      try { CC.session.clear(); } catch { /* sem armazenamento */ }
      gravar(CHAVE_TEMPORARIA, '');
    },
    manter(sim) {
      gravar(CHAVE_TEMPORARIA, sim ? '' : '1');
      if (!sim) document.cookie = `${COOKIE_ABERTA}=1; path=/; SameSite=Strict`;
    },
  };

  const AVISOS = {
    exp: ['info', 'clock-counter-clockwise', 'Sua sessão terminou', 'Entre de novo: nada do que você salvou se perdeu.'],
    sair: ['ok', 'sign-out', 'Você saiu do Centro de Custos', 'Para entrar de novo, use o mesmo e-mail e senha.'],
    off: ['warn', 'wifi-slash', 'Sem internet', 'O Centro de Custos no computador precisa de conexão para entrar. No aplicativo do celular, o PIN funciona mesmo sem internet.'],
  };
  const CARDS = [
    ['buildings', 'Obras e serviços', 'Orçado × realizado de cada obra e o resultado de cada serviço curto.'],
    ['receipt', 'Lançamentos com recibo', 'Despesa com foto no celular, mesmo sem internet, e conferência aqui.'],
    ['chart-line-up', 'Medições e cobranças', 'Curva S, boletins e cobrança com nota fiscal, sem planilha paralela.'],
  ];

  function marca() {
    const seguro = location.protocol === 'https:' || /^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname);
    return `<section class="lg-marca" aria-label="Centro de Custos Construtec">
      <div class="lg-fundo" aria-hidden="true"><span class="b1"></span><span class="b2"></span><span class="b3"></span><span class="pontos"></span></div>
      <div class="lg-topo"><img src="logo-fundo-escuro.png" alt="Construtec"><span class="lg-chip">Centro de Custos</span></div>
      <div class="lg-meio">
        <h1>Cada obra e cada serviço com o custo na mão.</h1>
        <p>Do lançamento no campo à medição aprovada, com o mesmo login do Orçamentos.</p>
        <div class="lg-cards">${CARDS.map(([i, t, s]) => `<div class="lg-card">${ic(i)}<span><b>${t}</b>${s}</span></div>`).join('')}</div>
      </div>
      <div class="lg-rodape"><span>${seguro ? `${ic('shield-check')}Conexão segura · ` : ''}Construtec Engenharia</span><span data-versao>Suíte Construtec</span></div>
    </section>`;
  }

  const campo = (rotulo, icone, input, extra = '') => `<label class="fld"><span>${rotulo}</span><span class="lg-inp">${ic(icone)}${input}${extra}</span></label>`;
  const titulo = (h, p) => `<div class="lg-titulo"><span class="eyebrow">Centro de Custos</span><h2 tabindex="-1">${h}</h2><p>${p}</p></div>`;

  function formulario() {
    return `<form class="lg-vista" data-v="login" novalidate>
        ${titulo('Entrar', 'Use o e-mail da Construtec. A mesma conta vale para o Orçamentos.')}
        <div class="lg-aviso" role="alert" data-aviso hidden></div>
        <div class="lg-campos" data-campos>
          ${campo('E-mail', 'envelope-simple', '<input class="inp" type="email" name="email" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="nome@rcconstrutec.com.br">')}
          ${campo('Senha', 'lock-simple', '<input class="inp com-olho" type="password" name="senha" autocomplete="current-password" placeholder="Sua senha">',
    `<button type="button" class="ibtn" data-olho aria-label="Mostrar a senha" aria-pressed="false">${ic('eye', 19)}</button>`)}
        </div>
        <div class="lg-linha">
          <label class="lg-manter"><input type="checkbox" name="manter" checked><span class="marca-caixa" aria-hidden="true">${ic('check')}</span>Manter conectado neste computador</label>
          <button type="button" class="btn btn-g" data-esqueci>Esqueci a senha</button>
        </div>
        <button type="submit" class="btn btn-p lg-ir" data-ir>${ic('arrow-right')}<span>Entrar</span></button>
        <button type="button" class="btn btn-s lg-nova" data-esqueci data-nova hidden>${ic('key')}Criar uma senha nova</button>
        <div class="lg-primeiro">${ic('envelope-open')}<span><b>Primeiro acesso?</b> Abra o convite que chegou no seu e-mail. Sem convite, peça a um administrador em Usuários.</span></div>
      </form>
      <form class="lg-vista" data-v="rec" novalidate hidden>
        <button type="button" class="btn btn-g lg-voltar" data-voltar>${ic('arrow-left', 16)}Voltar para entrar</button>
        ${titulo('Recuperar a senha', 'Digite o e-mail da sua conta. Mandamos um link para criar uma senha nova.')}
        ${campo('E-mail', 'envelope-simple', '<input class="inp" type="email" name="rec" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="nome@rcconstrutec.com.br">')}
        <span class="lg-msg" role="alert" data-rec-msg hidden>${ic('warning-circle')}<span data-rec-txt></span></span>
        <button type="submit" class="btn btn-p lg-ir" data-rec-ir>${ic('paper-plane-tilt')}<span>Enviar link</span></button>
      </form>
      <div class="lg-vista lg-ok" data-v="ok" hidden>
        <span class="lg-ok-ic">${ic('envelope-simple-open')}</span>
        <div class="lg-titulo"><h2 tabindex="-1">Confira seu e-mail</h2><p data-ok-txt></p></div>
        <div class="lg-botoes"><button type="button" class="btn btn-p" data-voltar>${ic('arrow-left')}Voltar para entrar</button><button type="button" class="btn btn-s" data-reenviar>Reenviar link</button></div>
        <span class="lg-nota">Não chegou? Confira o spam ou peça ajuda a um administrador.</span>
      </div>`;
  }

  async function postar(url, corpo) {
    const resposta = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo), cache: 'no-store' });
    const data = await resposta.json().catch(() => ({}));
    return { status: resposta.status, ok: resposta.ok, data };
  }
  const hora = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const minutosDe = (data) => Number(data.bloqueadoMinutos) || Number((/(\d+)\s*minuto/.exec(String(data.erro || data.error || '')) || [])[1]) || 15;

  // aviso: 'sair' | 'exp' | ''. aoEntrar: chamado com a sessao ja salva.
  D.entrar = function ({ aviso = '', aoEntrar }) {
    const raiz = CC.$('#app');
    raiz.innerHTML = `<main class="lg" aria-label="Entrar no Centro de Custos">${marca()}
      <section class="lg-lado">
        <div class="lg-tema"><button type="button" class="btn btn-g" data-tema></button></div>
        <div class="lg-rolar"><div class="lg-caixa">${formulario()}</div></div>
        <div class="lg-ajuda"><span>Precisa de ajuda? Fale com um administrador do Centro de Custos.</span></div>
      </section></main>`;
    document.title = 'Entrar · Centro de Custos';
    const $ = (sel) => CC.$(sel, raiz);
    const email = $('[name=email]'), senha = $('[name=senha]'), manter = $('[name=manter]'), rec = $('[name=rec]');
    const ir = $('[data-ir]'), caixaAviso = $('[data-aviso]'), campos = $('[data-campos]');
    const st = { ocupado: false, off: false, ate: 0, timer: 0, reenvio: 0 };

    function pintarTema() {
      const escuro = D.tema.atual() === 'escuro';
      $('[data-tema]').innerHTML = `${ic(escuro ? 'sun' : 'moon', 18)}${escuro ? 'Tema claro' : 'Tema escuro'}`;
    }
    function mostrarAviso(tipo, icone, t, s) {
      caixaAviso.className = `lg-aviso ${tipo}`;
      caixaAviso.innerHTML = `${ic(icone)}<span><b>${esc(t)}</b>${esc(s)}</span>`;
      caixaAviso.hidden = false;
    }
    const avisoFixo = (chave) => mostrarAviso(...AVISOS[chave]);
    const limparAviso = () => { caixaAviso.hidden = true; };
    const ruim = (e, s) => { email.classList.toggle('ruim', !!e); senha.classList.toggle('ruim', !!s); };
    function tremer() { campos.classList.remove('tremer'); void campos.offsetWidth; campos.classList.add('tremer'); }
    function botao(el, icone, texto, ocupado) {
      el.innerHTML = `${ic(ocupado ? 'circle-notch' : icone)}<span>${esc(texto)}</span>`;
      el.classList.toggle('ocupado', !!ocupado);
    }
    function pintarBotao() {
      const preso = st.ate > Date.now();
      ir.disabled = preso;
      if (st.ocupado) botao(ir, '', 'Entrando…', true);
      else if (preso) botao(ir, 'lock-simple', `Bloqueado até ${hora(st.ate)}`);
      else if (st.off) botao(ir, 'arrow-clockwise', 'Tentar de novo');
      else botao(ir, 'arrow-right', 'Entrar');
      email.disabled = senha.disabled = st.ocupado || preso;
      $('[data-nova]').hidden = !preso;
    }
    function vista(nome) {
      CC.$$('[data-v]', raiz).forEach((v) => { v.hidden = v.dataset.v !== nome; });
      const alvo = nome === 'login' ? (email.disabled ? $('[data-v=login] h2') : (email.value ? senha : email))
        : nome === 'rec' ? rec : $('[data-v=ok] h2');
      alvo.focus();
    }

    function bloquear(minutos) {
      st.ate = Date.now() + minutos * 60000;
      clearTimeout(st.timer);
      st.timer = setTimeout(() => { st.ate = 0; limparAviso(); pintarBotao(); }, st.ate - Date.now());
      mostrarAviso('bad', 'lock-simple', `Acesso bloqueado por ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`,
        `Foram muitas tentativas com a senha errada. O acesso libera às ${hora(st.ate)}, ou você pode criar uma senha nova agora.`);
      ruim(false, true);
      pintarBotao();
    }
    function semInternet() { st.off = true; avisoFixo('off'); pintarBotao(); }

    async function entrar() {
      if (st.ocupado || st.ate > Date.now()) return;
      const valor = email.value.trim().toLowerCase();
      if (!valor || !senha.value) {
        mostrarAviso('bad', 'warning-circle', 'Falta preencher', !valor && !senha.value ? 'Digite o e-mail e a senha.' : (!valor ? 'Digite o e-mail.' : 'Digite a senha.'));
        ruim(!valor, !senha.value); tremer(); (valor ? senha : email).focus();
        return;
      }
      if (navigator.onLine === false) { if (st.off) CC.toast('Ainda sem internet', 'wifi-slash'); semInternet(); return; }
      st.ocupado = true; st.off = false; limparAviso(); ruim(false, false); pintarBotao();
      let r;
      try { r = await postar('/api/auth/login', { email: valor, senha: senha.value }); } catch { r = null; }
      st.ocupado = false;
      if (!r) { pintarBotao(); semInternet(); return; }
      const { data } = r;
      if (r.ok && data.token && data.usuario && data.instancia) {
        gravar(CHAVE_EMAIL, valor);
        D.sessao.manter(manter.checked);
        CC.session.save(data);
        senha.value = '';
        clearTimeout(st.timer);
        window.removeEventListener('online', voltouRede);
        const nome = String(data.usuario.nome || '').trim().split(/\s+/)[0];
        await aoEntrar();
        if (nome) CC.toast(`${CC.greeting()}, ${nome}`, 'check-circle');
        return;
      }
      senha.value = '';
      if (r.status === 429 || (r.status === 401 && (data.tentativasRestantes === 0 || data.bloqueadoMinutos))) { bloquear(minutosDe(data)); return; }
      pintarBotao();
      if (r.status === 401) {
        const n = Number.isInteger(data.tentativasRestantes) ? data.tentativasRestantes : null;
        const resto = n === null ? '' : ` ${n === 1 ? 'Resta 1 tentativa' : `Restam ${n} tentativas`} antes do bloqueio de 15 minutos.`;
        mostrarAviso('bad', 'warning-circle', 'E-mail ou senha não conferem', `Confira e tente de novo.${resto}`);
        ruim(false, true); tremer(); senha.focus();
        return;
      }
      mostrarAviso(r.status === 403 ? 'bad' : 'warn', 'warning-circle', 'Não foi possível entrar', data.erro || 'Tente de novo em instantes.');
    }
    function voltouRede() { if (!raiz.contains(ir)) return; if (st.off) { st.off = false; limparAviso(); pintarBotao(); } }

    // Recuperar a senha: o diretorio sempre responde "aceito" (nao revela se o e-mail tem conta).
    const recMsg = (texto) => { $('[data-rec-txt]').textContent = texto; $('[data-rec-msg]').hidden = !texto; rec.classList.toggle('ruim', !!texto); };
    async function pedirLink() {
      try {
        const r = await postar('/v1/auth/password-reset/request', { email: rec.value.trim().toLowerCase() });
        return r.ok ? '' : (r.data.error || r.data.erro || 'Não foi possível enviar agora. Tente de novo.');
      } catch { return 'Sem internet. Confira a conexão e tente de novo.'; }
    }
    function travarReenvio() {
      const b = $('[data-reenviar]');
      b.disabled = true;
      clearTimeout(st.reenvio);
      st.reenvio = setTimeout(() => { b.disabled = false; }, 60000);
    }
    async function enviarLink() {
      const b = $('[data-rec-ir]');
      if (b.classList.contains('ocupado')) return;
      if (!EMAIL_OK.test(rec.value.trim())) { recMsg('Digite um e-mail válido, como nome@rcconstrutec.com.br.'); rec.focus(); return; }
      recMsg(''); botao(b, '', 'Enviando…', true);
      const erro = await pedirLink();
      botao(b, 'paper-plane-tilt', 'Enviar link');
      if (erro) { recMsg(erro); return; }
      $('[data-ok-txt]').textContent = `Se houver uma conta com ${rec.value.trim().toLowerCase()}, o link chega em alguns minutos. Ele vale por 30 minutos e cria uma senha nova para o Orçamentos e o Centro de Custos.`;
      travarReenvio();
      vista('ok');
    }

    $('[data-v=login]').addEventListener('submit', (e) => { e.preventDefault(); entrar(); });
    $('[data-v=rec]').addEventListener('submit', (e) => { e.preventDefault(); enviarLink(); });
    [email, senha].forEach((el) => el.addEventListener('input', () => {
      if (st.ate > Date.now() || st.off) return;
      el.classList.remove('ruim');
      if (!caixaAviso.classList.contains('ok') && !caixaAviso.classList.contains('info')) limparAviso();
    }));
    rec.addEventListener('input', () => recMsg(''));
    $('[data-olho]').addEventListener('click', (e) => {
      const ver = senha.type === 'password';
      senha.type = ver ? 'text' : 'password';
      e.currentTarget.innerHTML = ic(ver ? 'eye-slash' : 'eye', 19);
      e.currentTarget.setAttribute('aria-pressed', String(ver));
      e.currentTarget.setAttribute('aria-label', ver ? 'Esconder a senha' : 'Mostrar a senha');
    });
    CC.$$('[data-esqueci]', raiz).forEach((b) => b.addEventListener('click', () => { rec.value = email.value.trim(); recMsg(''); vista('rec'); }));
    CC.$$('[data-voltar]', raiz).forEach((b) => b.addEventListener('click', () => vista('login')));
    $('[data-reenviar]').addEventListener('click', async () => {
      travarReenvio();
      const erro = await pedirLink();
      CC.toast(erro || 'Link reenviado · confira também o spam', erro ? 'warning-circle' : 'paper-plane-tilt');
    });
    $('[data-tema]').addEventListener('click', () => { D.tema.aplicar(D.tema.atual() === 'escuro' ? 'claro' : 'escuro'); pintarTema(); });
    window.addEventListener('online', voltouRede);

    fetch('/api/version', { cache: 'no-store' }).then((r) => r.json()).then((v) => {
      if (v && /^\d+\.\d+/.test(String(v.version || ''))) $('[data-versao]').textContent = `Suíte Construtec · v${String(v.version).split('.').slice(0, 2).join('.')}`;
    }).catch(() => { /* fica sem a versao */ });
    email.value = ler(CHAVE_EMAIL);
    if (AVISOS[aviso]) avisoFixo(aviso);
    if (navigator.onLine === false) semInternet();
    pintarTema();
    pintarBotao();
    vista('login');
  };
})(window.CC);
