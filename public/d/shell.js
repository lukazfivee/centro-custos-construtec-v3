// Estrutura da tela: menu lateral com grupos (so o que o papel pode usar) e barra do topo.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;

  // [chave, icone, rotulo, regra de acesso (CC.d.pode), nome no sistema atual]
  D.MENU = [
    ['Visão geral', [['inicio', 'squares-four', 'Início', null, 'Início']]],
    ['Operação', [
      ['lancamentos', 'receipt', 'Lançamentos', null, 'Lançamentos'],
      ['obras', 'buildings', 'Obras', null, 'Obras/centros'],
      ['cobrancas', 'envelope-simple', 'Cobranças', 'cobrancas', 'Cobranças'],
    ]],
    ['Cadastros', [
      ['categorias', 'tag', 'Categorias', null, 'Categorias'],
      ['fornecedores', 'truck', 'Fornecedores', null, 'Fornecedores'],
      ['recorrentes', 'arrows-clockwise', 'Recorrentes', 'recorrentes', 'Recorrentes'],
    ]],
    ['Ferramentas', [['fechamento', 'lock-simple', 'Fechamento mensal', 'fechamento', null]]],
    ['Administração', [
      ['usuarios', 'users', 'Usuários', 'usuarios', 'Usuários'],
      ['historico', 'clock-counter-clockwise', 'Histórico', 'historico', null],
      ['reports', 'bug', 'Reports', null, 'Reports'],
      ['config', 'gear-six', 'Configurações', null, 'Configurações'],
    ]],
  ];

  D.itemMenu = (chave) => {
    for (const [grupo, itens] of D.MENU) {
      const item = itens.find((i) => i[0] === chave);
      if (item) return { grupo, chave: item[0], icone: item[1], rotulo: item[2], regra: item[3], antigo: item[4] };
    }
    return null;
  };
  D.podeTela = (chave) => {
    const item = D.itemMenu(chave);
    return !item || !item.regra || D.pode(item.regra);
  };

  function menu() {
    return D.MENU.map(([grupo, itens]) => {
      const visiveis = itens.filter((i) => !i[3] || D.pode(i[3]));
      if (!visiveis.length) return '';
      return `<div class="grupo"><span>${esc(grupo)}</span>${visiveis.map(([k, icone, rotulo]) => `<a class="nav" href="#/${k}" data-nav="${k}" data-rot="${esc(rotulo)}" aria-label="${esc(rotulo)}">${D.ic(icone)}<span class="rot">${esc(rotulo)}</span><span class="badge" data-badge="${k}" hidden></span></a>`).join('')}</div>`;
    }).join('');
  }

  function avatar(u) {
    return `<span class="avatar" data-avatar>${esc(D.iniciais(u.nome || u.name || u.email))}</span>`;
  }

  D.montarEstrutura = function () {
    const u = D.usuario();
    CC.$('#app').innerHTML = `<div class="app">
      <aside class="side" id="menu-lateral" aria-label="Menu">
        <a class="marca" href="#/inicio"><img class="logo" src="logo-fundo-escuro.png" alt="Construtec"><img class="simb" src="simbolo.png" alt=""><span>Centro de Custos</span></a>
        <button type="button" class="recolher" data-recolher aria-controls="menu-lateral">${D.ic('caret-left', 14)}</button>
        <nav aria-label="Navegação principal">${menu()}</nav>
        <div class="quem">${avatar(u)}<span class="nome"><b>${esc(u.nome || u.name || '')}</b><span>${esc(D.papelNome())}${D.simulando() ? ' · simulação' : ''}</span></span>
          <button type="button" class="ibtn" data-sair aria-label="Sair" title="Sair">${D.ic('sign-out', 18)}</button></div>
      </aside>
      <div class="area">
        ${D.simulando() ? `<div class="como-faixa" role="status">${D.ic('eye')}<span>Você está vendo o sistema como <b>${esc(D.papelNome())}</b>. Menus e botões sem permissão somem. O servidor continua usando o seu papel real.</span><button type="button" class="btn btn-s" data-sair-como>Voltar para ${esc(D.papelNome(D.usuario().suiteRole || 'admin'))}</button></div>` : ''}
        <header class="top">
          <div class="busca" role="search"></div>
          <span class="espaco"></span>
          <button type="button" class="selo local" data-selo aria-live="polite"><span class="ponto"></span><span data-selo-txt>Dados neste computador</span></button>
          <div class="suite"></div>
          <button type="button" class="ibtn" data-tema></button>
        </header>
        <main id="conteudo" class="conteudo" tabindex="-1"></main>
      </div></div>`;
    pintarTema();
    CC.$('[data-tema]').addEventListener('click', () => D.tema.alternar());
    CC.$('[data-sair]').addEventListener('click', sair);
    const voltar = CC.$('[data-sair-como]');
    if (voltar) voltar.addEventListener('click', () => { D.simular(''); location.hash = '#/usuarios'; location.reload(); });
    document.addEventListener('d:tema', pintarTema);
    iniciarRecolher();
    carregarFoto();
  };

  // Menu recolhido: escolha do usuario guardada; sem escolha, recolhe abaixo de 1280 px.
  const CHAVE_MENU = 'cc_d_menu';
  function iniciarRecolher() {
    const app = CC.$('.app');
    const bt = CC.$('[data-recolher]');
    let salvo = '';
    try { salvo = localStorage.getItem(CHAVE_MENU) || ''; } catch { /* sem armazenamento */ }
    const aplicar = (recolhido) => {
      app.classList.toggle('recolhido', recolhido);
      bt.setAttribute('aria-expanded', String(!recolhido));
      bt.setAttribute('aria-label', recolhido ? 'Expandir menu' : 'Recolher menu');
      bt.title = `${bt.getAttribute('aria-label')} (Ctrl B)`;
    };
    aplicar(salvo ? salvo === 'recolhido' : window.innerWidth < 1280);
    const alternar = () => {
      const recolhido = !app.classList.contains('recolhido');
      aplicar(recolhido);
      try { localStorage.setItem(CHAVE_MENU, recolhido ? 'recolhido' : 'aberto'); } catch { /* segue */ }
    };
    bt.addEventListener('click', alternar);
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') { e.preventDefault(); alternar(); }
    });
    requestAnimationFrame(() => app.classList.add('anima'));
    iniciarDica(app);
  }

  // Nome do item ao lado do icone com o menu recolhido.
  function iniciarDica(app) {
    let dica = null;
    const tirar = () => { if (dica) { dica.remove(); dica = null; } };
    const mostrar = (e) => {
      const a = e.target.closest('[data-nav]');
      tirar();
      if (!a || !app.classList.contains('recolhido')) return;
      const r = a.getBoundingClientRect();
      dica = document.createElement('div');
      dica.className = 'menu-dica';
      dica.textContent = a.dataset.rot;
      dica.style.left = `${r.right + 14}px`;
      dica.style.top = `${r.top + r.height / 2}px`;
      document.body.appendChild(dica);
    };
    const nav = CC.$('.side nav');
    nav.addEventListener('mouseover', mostrar);
    nav.addEventListener('focusin', mostrar);
    nav.addEventListener('mouseleave', tirar);
    nav.addEventListener('focusout', tirar);
    nav.addEventListener('scroll', tirar);
    nav.addEventListener('click', tirar);
  }

  function pintarTema() {
    const bt = CC.$('[data-tema]');
    if (!bt) return;
    const escuro = D.tema.atual() === 'escuro';
    bt.innerHTML = D.ic(escuro ? 'sun' : 'moon');
    bt.setAttribute('aria-label', escuro ? 'Usar tema claro' : 'Usar tema escuro');
    bt.title = bt.getAttribute('aria-label');
  }

  // Foto { mime, contentBase64 } no menu lateral; sem foto, volta para as iniciais. Usado tambem pelas Configuracoes.
  D.pintarAvatar = (foto) => {
    const alvo = CC.$('[data-avatar]');
    if (!alvo) return;
    const ok = foto && foto.mime && foto.contentBase64 && /^image\/(png|jpe?g|webp)$/.test(foto.mime);
    alvo.innerHTML = ok ? `<img src="data:${foto.mime};base64,${foto.contentBase64.replace(/[^A-Za-z0-9+/=]/g, '')}" alt="">`
      : esc(D.iniciais(D.usuario().nome || D.usuario().name || D.usuario().email));
  };
  D.pintarNome = (nome) => {
    const alvo = CC.$('.quem .nome b');
    if (alvo) alvo.textContent = nome;
    const u = CC.session.user() || {};
    try { localStorage.setItem('cc_usuario', JSON.stringify({ ...u, nome })); } catch { /* segue sem guardar */ }
  };

  async function carregarFoto() {
    try {
      const { data } = await CC.api('/auth/foto-perfil');
      if (data && data.mime && data.contentBase64) D.pintarAvatar(data);
    } catch { /* fica com as iniciais */ }
  }

  async function sair() {
    const sim = await D.confirmar({ titulo: 'Sair do Centro de Custos?', texto: 'Você vai precisar entrar de novo neste computador.', ok: 'Sair', icone: 'sign-out' });
    if (!sim) return;
    if (D.painel.aberto()) D.painel.fecharJa();
    CC.session.clear();
    location.href = '/?entrar=1';
  }

  // Marca o item atual do menu a cada troca de tela.
  D.aoNavegar = (rota) => {
    CC.$$('[data-nav]').forEach((a) => {
      if (a.dataset.nav === rota.nome) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    const item = D.itemMenu(rota.nome);
    document.title = item ? `${item.rotulo} · Centro de Custos` : 'Centro de Custos';
  };
})(window.CC);
