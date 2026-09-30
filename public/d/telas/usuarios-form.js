// D6: convidar, criar com senha provisoria e editar acesso (papel, apps e obras).
(function (CC) {
  const D = CC.d;
  const U = D.ui;
  const X = D.usu;
  const { esc } = CC;
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const listaObras = async () => {
    const { data } = await CC.api('/centros-custo');
    return Array.isArray(data) ? data : (data?.itens || []);
  };

  function blocoApps(apps) {
    return `<div class="fld"><span>Acesso aos apps</span><div class="usu-apps">${X.APPS.map((a) =>
      `<button type="button" class="usu-app" data-app="${esc(a.valor)}" aria-pressed="${apps.includes(a.valor)}">${D.ic(a.icone)}${esc(a.rotulo)}${D.ic('check')}</button>`).join('')}</div></div>`;
  }

  function blocoObras(todas, ids, obras) {
    return `<div class="fld" data-bloco-obras><span>Obras que pode ver</span>
      ${U.seg('obras', [{ valor: 'todas', rotulo: 'Todas as obras' }, { valor: 'algumas', rotulo: 'Só algumas' }], todas ? 'todas' : 'algumas', 'Obras')}
      <div class="usu-obras" data-lista-obras${todas ? ' hidden' : ''}>${obras.length ? obras.map((o) =>
        `<button type="button" class="usu-obra" data-obra="${esc(o.id)}" aria-pressed="${ids.includes(Number(o.id))}">${esc(o.codigo)} · ${esc(o.nome)}</button>`).join('') : '<span class="muted">Nenhuma obra cadastrada.</span>'}</div>
      <small class="muted" data-aviso-obras></small></div>`;
  }

  function oQuePode(papel, dados) {
    const linhas = X.GRUPOS.flatMap(([, itens]) => itens).map(([id, nome]) => {
      const ok = !!dados.matriz[papel]?.[id];
      return `<li class="${ok ? 'sim' : 'nao'}">${D.ic(ok ? 'check-circle' : 'minus-circle')}${esc(nome)}</li>`;
    }).join('');
    return `<div class="usu-pode"><span class="eyebrow">O que ${esc(X.nomePapel(papel))} pode fazer</span><ul>${linhas}</ul></div>`;
  }

  D.usu.abrirForm = async function (usuario, atualizar) {
    const editando = !!usuario;
    const [dados, obras] = await Promise.all([X.matriz(), listaObras().catch(() => [])]);
    const papelInicial = usuario?.suiteRole || 'tecnico';
    const estado = {
      apps: usuario?.apps?.length ? [...usuario.apps] : ['orcamentos', 'centro'],
      todas: usuario ? usuario.todasObras !== false : false,
      obras: (usuario?.obras || []).map(Number),
      metodo: X.convitesOk ? 'convite' : 'senha',
    };
    const corpo = `<form class="form-lanc" novalidate>
      ${U.campo({ rotulo: 'Nome', name: 'nome', valor: usuario?.nome })}
      ${U.campo({ rotulo: 'E-mail', name: 'email', tipo: 'email', valor: usuario?.email })}
      ${U.campo({ rotulo: 'Papel', name: 'suiteRole', tipo: 'select', valor: papelInicial, opcoes: X.PAPEIS })}
      ${blocoApps(estado.apps)}
      <div data-obras-wrap></div>
      ${editando ? '' : `<div class="fld"><span>Como a pessoa entra</span>${X.convitesOk ? U.seg('metodo', [{ valor: 'convite', rotulo: 'Convite por e-mail' }, { valor: 'senha', rotulo: 'Senha provisória' }], 'convite', 'Método') : '<small class="muted">Sem conta corporativa, o acesso é por senha provisória.</small>'}</div>
        <div data-senha-wrap${X.convitesOk ? ' hidden' : ''}>${U.campo({ rotulo: 'Senha provisória', name: 'senha', tipo: 'password', ajuda: 'Pelo menos 10 caracteres. Informe a senha à pessoa por um canal seguro.' })}</div>`}
      <div data-pode></div>
      ${usuario?.cloud_managed ? U.faixa('info', 'info', 'Nome e e-mail vêm do diretório central; aqui mudam papel, apps e obras.') : ''}
    </form>`;
    const ctl = await D.painel.abrir({
      icone: editando ? 'user-gear' : 'user-plus', titulo: editando ? 'Editar acesso' : (X.convitesOk ? 'Convidar usuário' : 'Novo usuário'),
      sub: editando ? usuario.email : 'Papel, apps e obras que a pessoa pode ver.',
      corpo, rodape: `<button type="button" class="btn btn-s" data-fechar>Cancelar</button><button type="button" class="btn btn-p" data-salvar>${D.ic('check')}<span data-rot>${editando ? 'Salvar acesso' : (X.convitesOk ? 'Enviar convite' : 'Criar usuário')}</span></button>`,
    });
    if (!ctl) return;
    const form = CC.$('form', ctl.corpo);
    if (editando) ['nome', 'email'].forEach((n) => { form.elements[n].disabled = true; });
    const papel = () => form.elements.suiteRole.value;

    const pintar = () => {
      const escopado = X.ESCOPADOS.includes(papel());
      const wrap = CC.$('[data-obras-wrap]', form);
      // Convite novo nao leva obras: a conta ainda nao existe (entra sem obras ate o admin atribuir).
      wrap.innerHTML = (escopado && (editando || estado.metodo === 'senha'))
        ? blocoObras(estado.todas, estado.obras, obras)
        : (escopado ? '<small class="muted">Quem entra por convite começa sem obras. Atribua as obras depois que a conta for criada.</small>'
          : '<small class="muted">Este papel vê todas as obras.</small>');
      CC.$('[data-pode]', form).innerHTML = oQuePode(papel(), dados);
      avisoObras();
    };
    const avisoObras = () => {
      const aviso = CC.$('[data-aviso-obras]', form);
      if (aviso) aviso.textContent = !estado.todas && !estado.obras.length ? 'Sem nenhuma obra, a pessoa não vê nada até receber uma.' : '';
    };

    form.addEventListener('click', (event) => {
      const app = event.target.closest('[data-app]');
      if (app) {
        const valor = app.dataset.app;
        estado.apps = estado.apps.includes(valor) ? estado.apps.filter((a) => a !== valor) : [...estado.apps, valor];
        app.setAttribute('aria-pressed', String(estado.apps.includes(valor)));
        return;
      }
      const obra = event.target.closest('[data-obra]');
      if (obra) {
        const id = Number(obra.dataset.obra);
        estado.obras = estado.obras.includes(id) ? estado.obras.filter((o) => o !== id) : [...estado.obras, id];
        obra.setAttribute('aria-pressed', String(estado.obras.includes(id)));
        avisoObras();
        return;
      }
      const seg = event.target.closest('[data-seg]');
      if (seg) {
        U.segEscolher(seg.parentElement, seg);
        if (seg.dataset.seg === 'obras') {
          estado.todas = seg.dataset.valor === 'todas';
          CC.$('[data-lista-obras]', form).hidden = estado.todas;
          avisoObras();
        } else {
          estado.metodo = seg.dataset.valor;
          CC.$('[data-senha-wrap]', form).hidden = estado.metodo !== 'senha';
          CC.$('[data-rot]', ctl.rodape).textContent = estado.metodo === 'senha' ? 'Criar usuário' : 'Enviar convite';
          pintar();
        }
      }
    });
    form.elements.suiteRole.addEventListener('change', pintar);
    pintar();

    let ocupado = false;
    const salvar = async () => {
      if (ocupado) return;
      const nome = String(form.elements.nome.value || '').trim();
      const email = String(form.elements.email.value || '').trim().toLowerCase();
      const senha = form.elements.senha ? String(form.elements.senha.value || '') : '';
      const erros = {};
      if (!editando && !nome && estado.metodo === 'senha') erros.nome = 'Informe o nome.';
      if (!editando && !EMAIL.test(email)) erros.email = 'Informe um e-mail válido.';
      if (!editando && estado.metodo === 'senha' && senha.length < 10) erros.senha = 'Use pelo menos 10 caracteres.';
      ctl.errosCampos(erros);
      if (Object.keys(erros).length) { ctl.erro('Confira os campos destacados.'); return; }
      if (!estado.apps.length) { ctl.erro('Escolha ao menos um app.'); return; }
      const escopado = X.ESCOPADOS.includes(papel());
      const obrasCorpo = escopado ? (estado.todas ? 'todas' : estado.obras) : 'todas';
      ocupado = true;
      try {
        if (editando) {
          await CC.api(`/usuarios/${usuario.id}/acesso`, { method: 'PUT', body: { suiteRole: papel(), apps: estado.apps, obras: obrasCorpo } });
          ctl.marcarSalvo(); ctl.fechar(true); CC.toast('Acesso atualizado'); await atualizar();
        } else if (estado.metodo === 'senha') {
          await CC.api('/usuarios', { method: 'POST', body: { nome, email, senha, suiteRole: papel(), apps: estado.apps, obras: obrasCorpo } });
          ctl.marcarSalvo();
          ctl.desenhar(`${D.sucesso('Usuário criado', `${nome} já pode entrar com a senha provisória.`)}<div class="usu-senha"><span class="eyebrow">Senha provisória</span><code>${esc(senha)}</code><button type="button" class="btn btn-s" data-copiar>${D.ic('copy')}Copiar senha</button></div>`);
          ctl.botoes('<button type="button" class="btn btn-p" data-concluir>Concluir</button>');
          CC.$('[data-copiar]', ctl.corpo).addEventListener('click', () => { navigator.clipboard?.writeText(senha).then(() => CC.toast('Senha copiada')); });
          CC.$('[data-concluir]', ctl.rodape).addEventListener('click', () => ctl.fechar(true));
          await atualizar();
        } else {
          const { data } = await CC.api('/cadastros/convites', { method: 'POST', body: { email, papel: papel(), apps: estado.apps } });
          ctl.marcarSalvo();
          ctl.desenhar(`${D.sucesso('Convite enviado', `Enviamos o convite para ${email} como ${X.nomePapel(papel())}.`)}${data?.code ? `<div class="usu-senha"><span class="eyebrow">Código da empresa</span><code>${esc(data.code)}</code></div>` : ''}`);
          ctl.botoes('<button type="button" class="btn btn-p" data-concluir>Concluir</button>');
          CC.$('[data-concluir]', ctl.rodape).addEventListener('click', () => ctl.fechar(true));
          await atualizar();
        }
      } catch (error) { ctl.erro(error.message); }
      finally { ocupado = false; }
    };
    form.addEventListener('submit', (event) => { event.preventDefault(); salvar(); });
    CC.$('[data-salvar]', ctl.rodape).addEventListener('click', salvar);
  };
})(window.CC);
