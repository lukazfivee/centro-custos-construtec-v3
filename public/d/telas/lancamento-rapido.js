// Lancamento rapido (print 13): so o essencial. Fornecedor, NF, observacao e anexos ficam para o Editar (D2).
// Envia com client_id: um clique duplo ou um reenvio nao criam dois lancamentos.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const I = D.inicio = D.inicio || {};
  const U = D.ui;

  const SITUACOES = {
    despesa: [{ valor: 'pendente', rotulo: 'A pagar' }, { valor: 'liquidado', rotulo: 'Pago' }],
    receita: [{ valor: 'pendente', rotulo: 'A receber' }, { valor: 'liquidado', rotulo: 'Recebido' }],
  };

  function formulario(estado, obras, categorias) {
    const cats = categorias.filter((c) => c.ativo !== false && (c.tipo === estado.tipo || c.tipo === 'ambos'));
    return `<form class="form-rapido" novalidate>
      ${U.seg('tipo', [{ valor: 'despesa', rotulo: 'Despesa' }, { valor: 'receita', rotulo: 'Receita' }], estado.tipo, 'Tipo do lançamento')}
      ${U.campo({ rotulo: 'Obra / centro de custo', name: 'cost_center_id', tipo: 'select', valor: estado.obra, opcoes: obras.map((o) => ({ valor: o.id, rotulo: [o.codigo, o.nome].filter(Boolean).join(' · ') })) })}
      ${U.campo({ rotulo: 'Descrição', name: 'descricao', valor: estado.descricao, placeholder: 'Ex.: NF 18.442 · Câmeras IP dome' })}
      <div class="duas">
        ${U.campo({ rotulo: 'Categoria', name: 'category_id', tipo: 'select', valor: estado.categoria, opcoes: cats.map((c) => ({ valor: c.id, rotulo: c.nome })) })}
        ${U.campo({ rotulo: 'Valor (R$)', name: 'valor', valor: estado.valor, placeholder: '0,00' })}
      </div>
      <div class="duas">
        ${U.campo({ rotulo: 'Competência', name: 'data', tipo: 'date', valor: estado.data })}
        ${U.campo({ rotulo: 'Vencimento', name: 'vencimento', tipo: 'date', valor: estado.vencimento })}
      </div>
      <div class="fld"><span>Situação</span>${U.seg('status', SITUACOES[estado.tipo], estado.status, 'Situação')}</div>
      <div class="nota">${D.ic('lightning')}<span>Fornecedor, NF, observação e anexos ficam para depois: abra o lançamento na lista e use Editar.</span></div>
    </form>`;
  }

  // Le o formulario para o estado (para redesenhar ao trocar o tipo sem perder o que foi digitado).
  function ler(corpo, estado) {
    const val = (n) => { const e = CC.$(`[name="${n}"]`, corpo); return e ? e.value : ''; };
    Object.assign(estado, {
      obra: val('cost_center_id'), descricao: val('descricao'), categoria: val('category_id'),
      valor: val('valor'), data: val('data'), vencimento: val('vencimento'),
    });
  }

  function validar(estado) {
    const erros = {};
    if (!estado.descricao.trim()) erros.descricao = 'Preencha a descrição.';
    if (!(CC.parseMoney(estado.valor) > 0)) erros.valor = 'Informe um valor maior que zero.';
    if (!estado.obra) erros.cost_center_id = 'Escolha a obra.';
    if (!estado.categoria) erros.category_id = 'Escolha a categoria.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(estado.data)) erros.data = 'Informe a competência.';
    if (estado.vencimento && !/^\d{4}-\d{2}-\d{2}$/.test(estado.vencimento)) erros.vencimento = 'Data inválida.';
    return erros;
  }

  function sucesso(ctl, l, obra, aoOutro) {
    const v = D.valorSinal(l);
    ctl.cabecalho({ icone: 'check', titulo: 'Lançamento registrado', sub: obra ? obra.nome : '' });
    const linhas = [['Obra', D.obraTexto(l)], ['Valor', v.texto], ['Situação', D.situacaoTexto(l)]];
    ctl.desenhar(`${D.sucesso('Lançamento registrado', l.descricao)}
      <div class="card resumo-ok">${linhas.map(([k, x]) => `<span><span class="muted">${esc(k)}</span><b>${esc(x)}</b></span>`).join('')}</div>`);
    ctl.botoes(`<button type="button" class="btn btn-s" data-fechar>Fechar</button><button type="button" class="btn btn-p" data-outro>${D.ic('plus')}Lançar outro</button>`);
    CC.$('[data-outro]', ctl.rodape).addEventListener('click', aoOutro);
    ctl.marcarSalvo();
  }

  I.lancamentoRapido = async function (opcoes) {
    const o = opcoes || {};
    const [obras, categorias] = await Promise.all([
      I.obrasAtivas().catch(() => []),
      CC.api('/categorias').then((r) => (Array.isArray(r.data) ? r.data : [])).catch(() => []),
    ]);
    if (!obras.length) {
      await D.avisar('Cadastre uma obra primeiro', 'O lançamento precisa de uma obra ou centro de custo ativo.');
      return;
    }
    const hoje = CC.today();
    const estado = {
      tipo: 'despesa', status: 'pendente', obra: String(o.obraId || obras[0].id), descricao: '', categoria: '',
      valor: '', data: hoje, vencimento: hoje, clientId: CC.uuid(),
    };
    let enviando = false;
    const desenhar = (ctl) => {
      ctl.desenhar(formulario(estado, obras, categorias));
      const corpo = ctl.corpo;
      CC.$$('[data-seg]', corpo).forEach((b) => b.addEventListener('click', () => {
        ler(corpo, estado);
        if (b.dataset.seg === 'tipo' && estado.tipo !== b.dataset.valor) {
          estado.tipo = b.dataset.valor;
          estado.categoria = '';
          desenhar(ctl);
          ctl.sujo = true;
          return;
        }
        estado.status = b.dataset.valor;
        U.segEscolher(b.parentElement, b);
        ctl.sujo = true;
      }));
      CC.$('form', corpo).addEventListener('submit', (e) => { e.preventDefault(); salvar(ctl); });
    };
    const botoesForm = `<button type="button" class="btn btn-s" data-fechar>Cancelar</button><button type="button" class="btn btn-p" data-salvar>${D.ic('check')}Registrar lançamento</button>`;

    async function salvar(ctl) {
      if (enviando) return;
      ler(ctl.corpo, estado);
      const erros = validar(estado);
      ctl.errosCampos(erros);
      if (Object.keys(erros).length) {
        ctl.erro(erros.descricao && erros.valor ? 'Preencha a descrição e um valor maior que zero.' : Object.values(erros)[0]);
        return;
      }
      ctl.erro('');
      enviando = true;
      const bt = CC.$('[data-salvar]', ctl.rodape);
      bt.disabled = true;
      const body = {
        tipo: estado.tipo, descricao: estado.descricao.trim(), valor: CC.parseMoney(estado.valor),
        cost_center_id: Number(estado.obra), category_id: Number(estado.categoria),
        data: estado.data, vencimento: estado.vencimento || estado.data, status_financeiro: estado.status,
        data_liquidacao: estado.status === 'liquidado' ? estado.data : '', client_id: estado.clientId,
      };
      try {
        const { data } = await CC.api('/lancamentos', { method: 'POST', body });
        const obra = obras.find((x) => String(x.id) === estado.obra);
        const cat = categorias.find((c) => String(c.id) === estado.categoria);
        const l = { ...body, id: data.id, sinal_contabil: 1, centro_nome: obra && obra.nome, centro_codigo: obra && obra.codigo, categoria: cat && cat.nome, situacao: body.status_financeiro };
        sucesso(ctl, l, obra, () => { ctl.fechar(true); I.lancamentoRapido(o); });
        if (o.aoRegistrar) o.aoRegistrar(l);
      } catch (error) {
        ctl.erro(error.status === 0 ? 'Sem internet. O lançamento não foi enviado; tente de novo quando a conexão voltar.' : error.message);
        bt.disabled = false;
      } finally {
        enviando = false;
      }
    }

    const ctl = await D.painel.abrir({
      icone: 'plus', titulo: 'Lançamento rápido', sub: 'Só o essencial; o resto dá para completar depois',
      corpo: (_, c) => desenhar(c), rodape: botoesForm,
    });
    if (!ctl) return;
    CC.$('[data-salvar]', ctl.rodape).addEventListener('click', () => salvar(ctl));
  };
})(window.CC);
