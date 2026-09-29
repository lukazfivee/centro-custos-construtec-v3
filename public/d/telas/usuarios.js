// D6: usuarios com o contrato atual do servidor. Os seis papeis entram junto
// da migracao e das regras de acesso no diretorio central.
(function (CC) {
  const D = CC.d;
  const U = D.ui;
  const { esc } = CC;
  const PAPEIS = [
    { valor: 'admin', rotulo: 'Administrador' },
    { valor: 'gestor', rotulo: 'Gestor' },
    { valor: 'supervisor', rotulo: 'Supervisor' },
  ];
  let busca = '';
  let aba = 'usuarios';

  const tituloPapel = (role) => PAPEIS.find((p) => p.valor === role)?.rotulo || role;
  const lista = (data) => Array.isArray(data) ? data : (Array.isArray(data?.itens) ? data.itens : []);
  const tituloEmail = (item) => typeof item === 'string' ? item : String(item?.email || '');

  function linha(usuario) {
    const ativo = usuario.ativo !== false;
    return {
      id: usuario.id,
      celulas: [
        `<span class="usu-pessoa"><span class="usu-avatar">${esc(D.iniciais(usuario.nome || usuario.email))}</span><span class="dois-tx"><b>${esc(usuario.nome || usuario.email)}</b><span>${esc(usuario.email)}</span></span></span>`,
        esc(tituloPapel(usuario.role)),
        U.chip(ativo ? 'Ativo' : 'Desativado', ativo ? 'ok' : 'neutro'),
        `<div class="usu-acoes"><button type="button" class="ibtn" data-editar="${esc(usuario.id)}" aria-label="Editar ${esc(usuario.nome)}" title="Editar">${D.ic('pencil-simple')}</button>
          <button type="button" class="ibtn" data-status="${esc(usuario.id)}" aria-label="${ativo ? 'Desativar' : 'Ativar'} ${esc(usuario.nome)}" title="${ativo ? 'Desativar' : 'Ativar'}">${D.ic(ativo ? 'user-minus' : 'user-plus')}</button></div>`,
      ],
    };
  }

  async function alterarStatus(usuario, atualizar) {
    const ativo = usuario.ativo !== false;
    const verbo = ativo ? 'Desativar' : 'Ativar';
    const sim = await D.confirmar({
      titulo: `${verbo} ${usuario.nome}?`,
      texto: ativo ? 'A pessoa perderá acesso. O histórico dela será preservado.' : 'A pessoa poderá voltar a acessar o sistema.',
      ok: verbo, icone: ativo ? 'user-minus' : 'user-plus', tom: ativo ? 'aviso' : undefined,
    });
    if (!sim) return;
    try {
      await CC.api(`/usuarios/${usuario.id}/status`, { method: 'PUT', body: { ativo: !ativo } });
      CC.toast(ativo ? 'Acesso desativado' : 'Acesso ativado');
      await atualizar();
    } catch (error) { CC.toast(error.message); }
  }

  async function formulario(usuario, atualizar) {
    const editando = !!usuario;
    const corpo = `<form class="form-lanc" novalidate>
      ${U.campo({ rotulo: 'Nome', name: 'nome', valor: usuario?.nome, obrigatorio: true })}
      ${U.campo({ rotulo: 'E-mail', name: 'email', tipo: 'email', valor: usuario?.email, obrigatorio: true })}
      ${U.campo({ rotulo: 'Papel', name: 'role', tipo: 'select', valor: usuario?.role || 'supervisor', opcoes: PAPEIS })}
      ${editando ? '' : U.campo({ rotulo: 'Senha provisória', name: 'senha', tipo: 'password', obrigatorio: true, ajuda: 'Pelo menos 10 caracteres. Informe a senha à pessoa por um canal seguro.' })}
      ${usuario?.cloud_managed ? U.faixa('info', 'info', 'O perfil corporativo é gerenciado pelo diretório central.') : ''}
    </form>`;
    const ctl = await D.painel.abrir({
      icone: 'user', titulo: editando ? 'Editar usuário' : 'Novo usuário',
      sub: editando ? usuario.nome : 'Cadastro com senha provisória',
      corpo, rodape: `<button type="button" class="btn btn-s" data-fechar>Cancelar</button><button type="button" class="btn btn-p" data-salvar>${D.ic('check')}Salvar</button>`,
    });
    if (!ctl) return;
    const form = CC.$('form', ctl.corpo);
    if (usuario?.cloud_managed) {
      CC.$$('[name]', form).forEach((campo) => { campo.disabled = true; });
      CC.$('[data-salvar]', ctl.rodape).disabled = true;
      return;
    }
    let ocupado = false;
    const salvar = async () => {
      if (ocupado) return;
      const body = Object.fromEntries(new FormData(form).entries());
      body.nome = String(body.nome || '').trim();
      body.email = String(body.email || '').trim().toLowerCase();
      const erros = {};
      if (!body.nome) erros.nome = 'Informe o nome.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) erros.email = 'Informe um e-mail válido.';
      if (!editando && String(body.senha || '').length < 10) erros.senha = 'Use pelo menos 10 caracteres.';
      ctl.errosCampos(erros);
      if (Object.keys(erros).length) { ctl.erro('Confira os campos destacados.'); return; }
      ocupado = true;
      try {
        await CC.api(editando ? `/usuarios/${usuario.id}` : '/usuarios', { method: editando ? 'PUT' : 'POST', body });
        ctl.marcarSalvo();
        ctl.fechar(true);
        CC.toast(editando ? 'Usuário atualizado' : 'Usuário criado');
        await atualizar();
      } catch (error) { ctl.erro(error.message); }
      finally { ocupado = false; }
    };
    form.addEventListener('submit', (event) => { event.preventDefault(); salvar(); });
    CC.$('[data-salvar]', ctl.rodape).addEventListener('click', salvar);
  }

  async function convidar(atualizar) {
    const ctl = await D.painel.abrir({
      icone: 'envelope-simple', titulo: 'Convidar por e-mail', sub: 'O convite usa o código da empresa.',
      corpo: `<form class="form-lanc" novalidate>
        ${U.campo({ rotulo: 'E-mail', name: 'email', tipo: 'email', obrigatorio: true })}
        ${U.campo({ rotulo: 'Papel', name: 'perfil', tipo: 'select', valor: 'supervisor', opcoes: PAPEIS })}
      </form>`,
      rodape: `<button type="button" class="btn btn-s" data-fechar>Cancelar</button><button type="button" class="btn btn-p" data-enviar>${D.ic('paper-plane-tilt')}Enviar convite</button>`,
    });
    if (!ctl) return;
    let ocupado = false;
    const enviar = async () => {
      if (ocupado) return;
      const body = Object.fromEntries(new FormData(CC.$('form', ctl.corpo)).entries());
      body.email = String(body.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
        ctl.errosCampos({ email: 'Informe um e-mail válido.' });
        return;
      }
      ocupado = true;
      try {
        await CC.api('/cadastros/convites', { method: 'POST', body });
        ctl.marcarSalvo();
        ctl.desenhar(D.sucesso('Convite enviado', `Enviamos o convite para ${body.email}.`));
        ctl.botoes('<button type="button" class="btn btn-p" data-concluir>Concluir</button>');
        CC.$('[data-concluir]', ctl.rodape).addEventListener('click', () => ctl.fechar(true));
        await atualizar();
      } catch (error) { ctl.erro(error.message); }
      finally { ocupado = false; }
    };
    CC.$('form', ctl.corpo).addEventListener('submit', (event) => { event.preventDefault(); enviar(); });
    CC.$('[data-enviar]', ctl.rodape).addEventListener('click', enviar);
  }

  async function mostrarEmails(el, vivo) {
    const corpo = CC.$('[data-corpo]', el);
    corpo.innerHTML = U.carregando('Carregando e-mails autorizados…');
    const { data } = await CC.api('/usuarios/emails-autorizados/lista');
    if (!vivo() || aba !== 'emails') return;
    if (!data.disponivel) {
      corpo.innerHTML = U.faixa('info', 'info', 'E-mails externos são administrados apenas com uma conta corporativa.');
      return;
    }
    const emails = Array.isArray(data.emails) ? data.emails : [];
    corpo.innerHTML = `<div class="card usu-emails"><div class="usu-email-topo"><b>E-mails externos autorizados</b><button type="button" class="btn btn-p" data-autorizar>${D.ic('plus')}Autorizar e-mail</button></div>
      ${emails.length ? emails.map((item) => `<div class="usu-email"><span>${esc(tituloEmail(item))}</span><button type="button" class="btn btn-s" data-revogar="${esc(tituloEmail(item))}">Revogar</button></div>`).join('') : U.vazio('envelope', 'Nenhum e-mail externo autorizado.')}</div>`;
    CC.$('[data-autorizar]', corpo).addEventListener('click', () => emailForm(null, () => mostrarEmails(el, vivo)));
    CC.$$('[data-revogar]', corpo).forEach((botao) => botao.addEventListener('click', () => emailForm(botao.dataset.revogar, () => mostrarEmails(el, vivo))));
  }

  async function emailForm(email, atualizar) {
    const revogar = !!email;
    const ctl = await D.painel.abrir({
      icone: 'envelope', titulo: revogar ? 'Revogar autorização' : 'Autorizar e-mail externo',
      corpo: revogar ? U.faixa('warn', 'warning', `Revogar o acesso de ${email}?`) :
        `<form class="form-lanc" novalidate>${U.campo({ rotulo: 'E-mail', name: 'email', tipo: 'email', obrigatorio: true })}${U.campo({ rotulo: 'Observação', name: 'observacao' })}</form>`,
      rodape: `<button type="button" class="btn btn-s" data-fechar>Cancelar</button><button type="button" class="btn btn-p" data-confirmar>${revogar ? 'Revogar' : 'Autorizar'}</button>`,
    });
    if (!ctl) return;
    CC.$('[data-confirmar]', ctl.rodape).addEventListener('click', async () => {
      const body = revogar ? { email } : Object.fromEntries(new FormData(CC.$('form', ctl.corpo)).entries());
      try {
        await CC.api(revogar ? '/usuarios/emails-autorizados/revogar' : '/usuarios/emails-autorizados', { method: 'POST', body });
        ctl.marcarSalvo();
        ctl.fechar(true);
        CC.toast(revogar ? 'Autorização revogada' : 'E-mail autorizado');
        await atualizar();
      } catch (error) { ctl.erro(error.message); }
    });
  }

  async function render(el, rota, vivo) {
    if (!D.pode('usuarios')) return D.telaEmConstrucao(el, rota, vivo);
    el.innerHTML = `<div class="pagina">${U.cabecalho({ grupo: 'Administração', titulo: 'Usuários', sub: 'Gerencie os acessos ao Centro de Custos.' })}
      <div class="usu-abas" role="tablist">
        <button type="button" role="tab" data-aba="usuarios" aria-selected="${aba === 'usuarios'}">Usuários</button>
        <button type="button" role="tab" data-aba="emails" aria-selected="${aba === 'emails'}">E-mails externos</button>
      </div><div data-corpo></div></div>`;
    const carregar = async () => {
      if (aba === 'emails') return mostrarEmails(el, vivo);
      const corpo = CC.$('[data-corpo]', el);
      corpo.innerHTML = U.carregando('Carregando os usuários…');
      const { data } = await CC.api('/usuarios');
      if (!vivo() || aba !== 'usuarios') return;
      const todos = lista(data);
      const ativos = todos.filter((u) => u.ativo !== false).length;
      corpo.innerHTML = `<div class="usu-kpis">
        ${U.kpi({ rotulo: 'Ativos', valor: String(ativos), icone: 'users', tom: 'ok' })}
        ${U.kpi({ rotulo: 'Desativados', valor: String(todos.length - ativos), icone: 'user-minus', tom: 'warn' })}
        ${U.kpi({ rotulo: 'Papéis em uso', valor: String(new Set(todos.filter((u) => u.ativo !== false).map((u) => u.role)).size), icone: 'shield-check', tom: 'info' })}
      </div><div class="card usu-barra"><label class="campo-busca">${D.ic('magnifying-glass')}<input class="inp" type="search" data-busca value="${esc(busca)}" placeholder="Buscar nome ou e-mail" aria-label="Buscar usuário"></label>
        <div class="usu-botoes"><button type="button" class="btn btn-s" data-convidar>${D.ic('envelope-simple')}Convidar por e-mail</button><button type="button" class="btn btn-p" data-novo>${D.ic('plus')}Novo usuário</button></div></div>
        <div class="card cad-tabela"><div data-tabela></div></div>`;
      const pintar = () => {
        const q = busca.trim().toLowerCase();
        const vis = todos.filter((u) => !q || [u.nome, u.email].join(' ').toLowerCase().includes(q));
        CC.$('[data-tabela]', corpo).innerHTML = U.tabela({
          colunas: [{ rotulo: 'Usuário' }, { rotulo: 'Papel' }, { rotulo: 'Status' }, { rotulo: 'Ações' }],
          linhas: vis.map(linha), vazio: 'Nenhum usuário encontrado.',
        });
        CC.$$('[data-editar]', corpo).forEach((b) => b.addEventListener('click', () => {
          const usuario = todos.find((u) => String(u.id) === b.dataset.editar);
          if (usuario) formulario(usuario, carregar);
        }));
        CC.$$('[data-status]', corpo).forEach((b) => b.addEventListener('click', () => {
          const usuario = todos.find((u) => String(u.id) === b.dataset.status);
          if (usuario) alterarStatus(usuario, carregar);
        }));
      };
      CC.$('[data-busca]', corpo).addEventListener('input', (event) => { busca = event.target.value; pintar(); });
      CC.$('[data-novo]', corpo).addEventListener('click', () => formulario(null, carregar));
      CC.$('[data-convidar]', corpo).addEventListener('click', () => convidar(carregar));
      pintar();
    };
    CC.$$('[data-aba]', el).forEach((botao) => botao.addEventListener('click', async () => {
      aba = botao.dataset.aba;
      CC.$$('[data-aba]', el).forEach((b) => b.setAttribute('aria-selected', b === botao ? 'true' : 'false'));
      try { await carregar(); } catch (error) { CC.$('[data-corpo]', el).innerHTML = U.faixa('err', 'warning-circle', error.message); }
    }));
    await carregar();
  }
  D.tela('usuarios', { render });
})(window.CC);
