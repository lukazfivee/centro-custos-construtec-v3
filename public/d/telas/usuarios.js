// D6: usuarios, papeis e permissoes (prints 60 a 67). Abas: Usuarios, Papeis e permissoes, E-mails externos.
(function (CC) {
  const D = CC.d;
  const U = D.ui;
  const X = D.usu;
  const { esc } = CC;
  let busca = '';
  let aba = 'usuarios';
  let filtro = 'todos';

  const lista = (data) => (Array.isArray(data) ? data : (Array.isArray(data?.itens) ? data.itens : []));
  const nomeApp = (valor) => X.APPS.find((a) => a.valor === valor)?.rotulo || valor;

  function obrasTexto(usuario) {
    if (!X.ESCOPADOS.includes(usuario.suiteRole) || usuario.todasObras) return 'Todas as obras';
    const n = (usuario.obras || []).length;
    return n ? `${n} ${n === 1 ? 'obra' : 'obras'}` : 'Sem obras';
  }

  function linhaUsuario(u) {
    const ativo = u.ativo !== false;
    const acessou = u.ultimoAcesso ? D.data(u.ultimoAcesso) : 'Nunca entrou';
    return {
      id: u.id,
      celulas: [
        `<span class="usu-pessoa"><span class="usu-avatar">${esc(D.iniciais(u.nome || u.email))}</span><span class="dois-tx"><b>${esc(u.nome || u.email)}</b><span>${esc(u.email)}</span></span></span>`,
        `<span class="dois-tx">${U.chip(X.nomePapel(u.suiteRole), 'info')}<span>${esc(obrasTexto(u))}</span></span>`,
        `<span class="usu-apps-lista">${(u.apps || []).map((a) => U.chip(nomeApp(a), 'neutro')).join('')}</span>`,
        esc(acessou),
        U.chip(ativo ? 'Ativo' : 'Desativado', ativo ? 'ok' : 'neutro'),
        `<div class="usu-acoes"><button type="button" class="ibtn" data-editar="${esc(u.id)}" aria-label="Editar acesso de ${esc(u.nome)}" title="Editar acesso">${D.ic('pencil-simple')}</button>
          <button type="button" class="ibtn" data-status="${esc(u.id)}" aria-label="${ativo ? 'Desativar' : 'Ativar'} ${esc(u.nome)}" title="${ativo ? 'Desativar' : 'Ativar'}">${D.ic(ativo ? 'user-minus' : 'user-plus')}</button></div>`,
      ],
    };
  }

  function linhaConvite(c) {
    return {
      id: c.email,
      celulas: [
        `<span class="usu-pessoa"><span class="usu-avatar">${esc(D.iniciais(c.email))}</span><span class="dois-tx"><b>${esc(c.email)}</b><span>Aguardando cadastro no app</span></span></span>`,
        `<span class="dois-tx">${U.chip(X.nomePapel(c.suiteRole), 'info')}<span>Sem obras até o cadastro</span></span>`,
        '', '—', U.chip('Convite enviado', 'warn', 'envelope-simple'),
        `<div class="usu-acoes"><button type="button" class="btn btn-s" data-reenviar="${esc(c.email)}" data-papel="${esc(c.suiteRole || 'tecnico')}">Reenviar</button></div>`,
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

  async function aba_usuarios(el, corpo, vivo) {
    corpo.innerHTML = U.carregando('Carregando os usuários…');
    const [{ data }, pedidos] = await Promise.all([CC.api('/usuarios'), CC.api('/cadastros').then((r) => r.data).catch(() => ({}))]);
    if (!vivo() || aba !== 'usuarios') return;
    const todos = lista(data);
    const convites = Array.isArray(pedidos?.invites) ? pedidos.invites : [];
    X.convitesOk = Boolean(pedidos?.code); // convite por e-mail so com a conta corporativa
    const ativos = todos.filter((u) => u.ativo !== false);
    const papeisEmUso = new Set(ativos.map((u) => u.suiteRole)).size;
    const recarregar = () => render(el, null, vivo);
    corpo.innerHTML = `<div class="usu-kpis">
      ${U.kpi({ rotulo: 'Ativos', valor: String(ativos.length), icone: 'users', tom: 'ok' })}
      ${U.kpi({ rotulo: 'Convites pendentes', valor: String(convites.length), icone: 'envelope-simple', tom: 'info' })}
      ${U.kpi({ rotulo: 'Desativados', valor: String(todos.length - ativos.length), icone: 'user-minus', tom: 'warn' })}
      ${U.kpi({ rotulo: 'Papéis em uso', valor: String(papeisEmUso), icone: 'shield-check', tom: 'info' })}
    </div><div class="card usu-barra"><label class="campo-busca">${D.ic('magnifying-glass')}<input class="inp" type="search" data-busca value="${esc(busca)}" placeholder="Nome ou e-mail" aria-label="Buscar usuário"></label>
      ${U.seg('filtro', [{ valor: 'todos', rotulo: 'Todos' }, { valor: 'ativos', rotulo: 'Ativos' }, { valor: 'convites', rotulo: 'Convites' }, { valor: 'desativados', rotulo: 'Desativados' }], filtro, 'Situação')}
      <div class="usu-botoes"><button type="button" class="btn btn-p" data-novo>${D.ic('user-plus')}${X.convitesOk ? 'Convidar usuário' : 'Novo usuário'}</button></div></div>
      <div class="card cad-tabela"><div data-tabela></div></div>`;
    const pintar = () => {
      const q = busca.trim().toLowerCase();
      const passa = (texto) => !q || texto.toLowerCase().includes(q);
      const us = todos.filter((u) => passa([u.nome, u.email].join(" ")) && (filtro === 'todos' || (filtro === 'ativos' && u.ativo !== false) || (filtro === 'desativados' && u.ativo === false)));
      const cs = filtro === 'todos' || filtro === 'convites' ? convites.filter((c) => passa(c.email)) : [];
      CC.$('[data-tabela]', corpo).innerHTML = U.tabela({
        colunas: [{ rotulo: 'Usuário' }, { rotulo: 'Papel · Obras' }, { rotulo: 'Apps' }, { rotulo: 'Último acesso' }, { rotulo: 'Status' }, { rotulo: 'Ações' }],
        linhas: [...us.map(linhaUsuario), ...cs.map(linhaConvite)], vazio: 'Nenhum usuário encontrado.',
      });
      CC.$$('[data-editar]', corpo).forEach((b) => b.addEventListener('click', () => {
        const u = todos.find((x) => String(x.id) === b.dataset.editar);
        if (u) X.abrirForm(u, recarregar);
      }));
      CC.$$('[data-status]', corpo).forEach((b) => b.addEventListener('click', () => {
        const u = todos.find((x) => String(x.id) === b.dataset.status);
        if (u) alterarStatus(u, recarregar);
      }));
      CC.$$('[data-reenviar]', corpo).forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        try { await CC.api('/cadastros/convites', { method: 'POST', body: { email: b.dataset.reenviar, papel: b.dataset.papel } }); CC.toast('Convite reenviado'); }
        catch (error) { CC.toast(error.message); }
        b.disabled = false;
      }));
    };
    CC.$('[data-busca]', corpo).addEventListener('input', (event) => { busca = event.target.value; pintar(); });
    CC.$$('[data-seg="filtro"]', corpo).forEach((b) => b.addEventListener('click', () => { filtro = b.dataset.valor; U.segEscolher(b.parentElement, b); pintar(); }));
    CC.$('[data-novo]', corpo).addEventListener('click', () => X.abrirForm(null, recarregar));
    pintar();
  }

  async function render(el, rota, vivo) {
    if (!D.pode('usuarios')) return D.telaEmConstrucao(el, rota, vivo);
    el.innerHTML = `<div class="pagina">${U.cabecalho({ grupo: 'Administração', titulo: 'Usuários e permissões', sub: 'Quem acessa o Orçamentos e o Centro de Custos, com que papel e em quais obras.', acoes: X.seletorComo ? X.seletorComo() : '' })}
      <div class="usu-abas" role="tablist">
        <button type="button" role="tab" data-aba="usuarios" aria-selected="${aba === 'usuarios'}">Usuários</button>
        <button type="button" role="tab" data-aba="papeis" aria-selected="${aba === 'papeis'}">Papéis e permissões</button>
        <button type="button" role="tab" data-aba="emails" aria-selected="${aba === 'emails'}">E-mails externos</button>
      </div><div data-corpo></div></div>`;
    if (X.ligarComo) X.ligarComo(el);
    const corpo = CC.$('[data-corpo]', el);
    const carregar = async () => {
      if (aba === 'emails') return X.abaEmails(corpo, vivo);
      if (aba === 'papeis') {
        const usuarios = lista((await CC.api('/usuarios')).data);
        return X.abaPapeis(corpo, vivo, usuarios);
      }
      return aba_usuarios(el, corpo, vivo);
    };
    CC.$$('[data-aba]', el).forEach((botao) => botao.addEventListener('click', async () => {
      aba = botao.dataset.aba;
      CC.$$('[data-aba]', el).forEach((b) => b.setAttribute('aria-selected', b === botao ? 'true' : 'false'));
      try { await carregar(); } catch (error) { corpo.innerHTML = U.faixa('err', 'warning-circle', error.message); }
    }));
    try { await carregar(); } catch (error) { corpo.innerHTML = U.faixa('err', 'warning-circle', error.message); }
    return undefined;
  }
  D.tela('usuarios', { render });
})(window.CC);
