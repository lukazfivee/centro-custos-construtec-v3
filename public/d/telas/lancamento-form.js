// Novo e editar lancamento (prints 14, 15, 17 e 74) e leitura de estorno, estornado ou mes fechado.
// Sem internet, o novo lancamento entra na fila deste computador (public/m/queue.js) com client_id.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const L = D.lanc = D.lanc || {};
  const U = D.ui;
  const FORMAS = ['Pix', 'Boleto', 'Transferência', 'Cartão', 'Dinheiro', 'Outro'];
  const SIT = {
    despesa: [{ valor: 'pendente', rotulo: 'A pagar' }, { valor: 'liquidado', rotulo: 'Pago' }],
    receita: [{ valor: 'pendente', rotulo: 'A receber' }, { valor: 'liquidado', rotulo: 'Recebido' }],
  };
  const valorBr = (n) => (Number(n) ? Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');

  function estadoDe(l, a, obraInicial) {
    const hoje = CC.today();
    const ativa = a.obras.find((o) => o.ativo !== false);
    if (!l) return { tipo: 'despesa', obra: String(obraInicial || (ativa ? ativa.id : '')), descricao: '', categoria: '', valor: '', favorecido: '', data: hoje, vencimento: hoje, status: 'pendente', liquidacao: hoje, forma: '', documento: '', observacao: '' };
    return {
      tipo: l.tipo, obra: String(l.cost_center_id), descricao: l.descricao || '', categoria: String(l.category_id), valor: valorBr(l.valor),
      favorecido: l.favorecido || '', data: l.data || hoje, vencimento: l.vencimento || l.data || hoje, status: l.status_financeiro,
      liquidacao: l.data_liquidacao || l.data || hoje, forma: l.forma_pagamento || '', documento: l.documento || '', observacao: l.observacao || '',
    };
  }

  function camposHtml(e, a) {
    const obras = a.obras.filter((o) => o.ativo !== false || String(o.id) === e.obra);
    const cats = a.categorias.filter((c) => (c.ativo !== false || String(c.id) === e.categoria) && (c.tipo === e.tipo || c.tipo === 'ambos'));
    const pago = e.status === 'liquidado';
    return `<form class="form-lanc" novalidate>
      ${U.seg('tipo', [{ valor: 'despesa', rotulo: 'Despesa' }, { valor: 'receita', rotulo: 'Receita' }], e.tipo, 'Tipo do lançamento')}
      ${U.campo({ rotulo: 'Obra / centro de custo', name: 'cost_center_id', tipo: 'select', valor: e.obra, opcoes: obras.map((o) => ({ valor: o.id, rotulo: [o.codigo, o.nome].filter(Boolean).join(' · ') })) })}
      ${U.campo({ rotulo: 'Descrição', name: 'descricao', valor: e.descricao, placeholder: 'Ex.: NF 18.442 · Câmeras IP dome' })}
      <div class="duas">${U.campo({ rotulo: 'Categoria', name: 'category_id', tipo: 'select', valor: e.categoria, opcoes: cats.map((c) => ({ valor: c.id, rotulo: c.nome })) })}
        ${U.campo({ rotulo: 'Valor (R$)', name: 'valor', valor: e.valor, placeholder: '0,00' })}</div>
      ${U.campo({ rotulo: e.tipo === 'receita' ? 'Cliente / pagador' : 'Fornecedor / favorecido', name: 'favorecido', valor: e.favorecido, placeholder: 'Nome ou razão social' }).replace('<input ', '<input list="lista-fornecedores" autocomplete="off" ')}
      <datalist id="lista-fornecedores">${a.fornecedores.filter((x) => x.ativo !== false).map((x) => `<option value="${esc(x.nome)}"></option>`).join('')}</datalist>
      <div class="duas">${U.campo({ rotulo: 'Competência', name: 'data', tipo: 'date', valor: e.data })}${U.campo({ rotulo: 'Vencimento', name: 'vencimento', tipo: 'date', valor: e.vencimento })}</div>
      <div class="fld"><span>Situação</span>${U.seg('status', SIT[e.tipo], e.status, 'Situação')}</div>
      ${pago ? `<div class="duas">${U.campo({ rotulo: e.tipo === 'receita' ? 'Data do recebimento' : 'Data do pagamento', name: 'data_liquidacao', tipo: 'date', valor: e.liquidacao })}
        ${U.campo({ rotulo: 'Forma de pagamento', name: 'forma_pagamento', tipo: 'select', valor: e.forma, opcoes: [{ valor: '', rotulo: 'Escolha' }, ...FORMAS.map((x) => ({ valor: x, rotulo: x }))] })}</div>` : ''}
      ${U.campo({ rotulo: 'NF / documento', name: 'documento', valor: e.documento, placeholder: 'Número da nota ou recibo' })}
      ${U.campo({ rotulo: 'Observação', name: 'observacao', tipo: 'textarea', valor: e.observacao, placeholder: 'Opcional' })}</form>`;
  }

  function ler(corpo, e) {
    const v = (n) => { const x = CC.$(`[name="${n}"]`, corpo); return x ? x.value : null; };
    [['obra', 'cost_center_id'], ['descricao', 'descricao'], ['categoria', 'category_id'], ['valor', 'valor'], ['favorecido', 'favorecido'], ['data', 'data'], ['vencimento', 'vencimento'], ['liquidacao', 'data_liquidacao'], ['forma', 'forma_pagamento'], ['documento', 'documento'], ['observacao', 'observacao']]
      .forEach(([k, n]) => { const x = v(n); if (x !== null) e[k] = x; });
  }

  function validar(e) {
    const erros = {};
    if (!e.descricao.trim()) erros.descricao = 'Preencha a descrição.';
    if (!(CC.parseMoney(e.valor) > 0)) erros.valor = 'Informe um valor maior que zero.';
    if (!e.obra) erros.cost_center_id = 'Escolha a obra.';
    if (!e.categoria) erros.category_id = 'Escolha a categoria.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.data)) erros.data = 'Informe a competência.';
    if (e.status === 'liquidado' && !/^\d{4}-\d{2}-\d{2}$/.test(e.liquidacao)) erros.data_liquidacao = 'Informe a data.';
    return erros;
  }

  const corpoPost = (e) => ({
    tipo: e.tipo, descricao: e.descricao.trim(), valor: CC.parseMoney(e.valor), cost_center_id: Number(e.obra), category_id: Number(e.categoria),
    favorecido: e.favorecido.trim(), data: e.data, vencimento: e.vencimento || e.data, status_financeiro: e.status,
    data_liquidacao: e.status === 'liquidado' ? e.liquidacao : '', forma_pagamento: e.status === 'liquidado' ? e.forma : '',
    documento: e.documento.trim(), observacao: e.observacao.trim(),
  });

  // Sucesso do novo: animacao, resumo e "Lancar outro" (print 16). Na fila, avisa que sai quando a internet voltar.
  function sucesso(ctl, l, a, naFila) {
    const obra = a.obras.find((o) => String(o.id) === String(l.cost_center_id));
    const cat = a.categorias.find((c) => String(c.id) === String(l.category_id));
    const vis = { ...l, sinal_contabil: 1, centro_nome: obra && obra.nome, centro_codigo: obra && obra.codigo, categoria: cat && cat.nome, situacao: l.status_financeiro };
    ctl.cabecalho({ icone: naFila ? 'cloud-slash' : 'check', titulo: naFila ? 'Guardado na fila' : 'Lançamento registrado', sub: obra ? obra.nome : '' });
    const linhas = [['Obra', D.obraTexto(vis)], ['Valor', D.valorSinal(vis).texto], ['Situação', naFila ? 'Guardado na fila · sai quando a internet voltar' : D.situacaoTexto(vis)]];
    ctl.desenhar(`${D.sucesso(naFila ? 'Guardado neste computador' : 'Lançamento registrado', l.descricao)}
      <div class="card resumo-ok">${linhas.map(([k, x]) => `<span><span class="muted">${esc(k)}</span><b>${esc(x)}</b></span>`).join('')}</div>`);
    ctl.botoes(`<button type="button" class="btn btn-s" data-fechar>Fechar</button><button type="button" class="btn btn-p" data-outro>${D.ic('plus')}Lançar outro</button>`);
    CC.$('[data-outro]', ctl.rodape).addEventListener('click', () => { ctl.fechar(true); L.formulario(null); });
    ctl.marcarSalvo();
  }

  // obraInicial: o novo ja vem com a obra (Lancar despesa no detalhe da obra).
  L.formulario = async function (l, aba, obraInicial) {
    const a = await L.apoio();
    if (!l && !a.obras.some((o) => o.ativo !== false)) { await D.avisar('Cadastre uma obra primeiro', 'O lançamento precisa de uma obra ou centro de custo ativo.'); return; }
    const e = estadoDe(l, a, obraInicial);
    const clientId = CC.uuid();
    let enviando = false;
    const desenharDados = (ctl) => {
      ctl.desenhar(camposHtml(e, a));
      CC.$$('[data-seg]', ctl.corpo).forEach((b) => b.addEventListener('click', () => {
        ler(ctl.corpo, e);
        const antes = `${e.tipo}|${e.status}`;
        if (b.dataset.seg === 'tipo') { if (e.tipo !== b.dataset.valor) e.categoria = ''; e.tipo = b.dataset.valor; } else e.status = b.dataset.valor;
        if (antes !== `${e.tipo}|${e.status}`) { desenharDados(ctl); ctl.sujo = true; }
      }));
      CC.$('form', ctl.corpo).addEventListener('submit', (ev) => { ev.preventDefault(); salvar(ctl); });
    };
    const botoes = `<button type="button" class="btn btn-s" data-fechar>Cancelar</button><button type="button" class="btn btn-p" data-salvar>${D.ic('check')}${l ? 'Salvar alterações' : 'Registrar lançamento'}</button>`;
    const ligarSalvar = (ctl) => { const b = CC.$('[data-salvar]', ctl.rodape); if (b) b.addEventListener('click', () => salvar(ctl)); };

    async function salvar(ctl) {
      if (enviando) return;
      ler(ctl.corpo, e);
      const erros = validar(e);
      const fechado = L.fechamento(e.data);
      if (fechado && !erros.data) erros.data = 'Competência fechada.';
      ctl.errosCampos(erros);
      if (Object.keys(erros).length) {
        ctl.erro(fechado && Object.keys(erros).length === 1
          ? `A competência de ${D.mesAno(e.data.slice(0, 7)).toLowerCase()} está fechada. Use outra data de competência ou peça ao administrador para reabrir.`
          : (erros.descricao && erros.valor ? 'Preencha a descrição e um valor maior que zero.' : Object.values(erros)[0]));
        return;
      }
      ctl.erro('');
      enviando = true;
      const bt = CC.$('[data-salvar]', ctl.rodape);
      bt.disabled = true;
      const body = corpoPost(e);
      try {
        if (l) {
          await CC.api(`/lancamentos/${l.id}`, { method: 'PUT', body: { ...body, revisao: Number(l.revision) } });
          ctl.marcarSalvo();
          ctl.fechar(true);
          CC.toast('Alterações salvas');
        } else if (CC.offline() && CC.queue) {
          await CC.queue.add({ client_id: clientId, payload: body });
          sucesso(ctl, body, a, true);
        } else {
          try {
            const { data } = await CC.api('/lancamentos', { method: 'POST', body: { ...body, client_id: clientId } });
            sucesso(ctl, { ...body, id: data.id }, a, false);
          } catch (error) {
            if (error.status !== 0 || !CC.queue) throw error;
            await CC.queue.add({ client_id: clientId, payload: body });
            sucesso(ctl, body, a, true);
          }
        }
        if (L.recarregar) L.recarregar();
      } catch (error) {
        ctl.erro(error.status === 0 ? 'Sem internet. Editar precisa da conexão; o que você mudou continua neste painel.' : error.message);
        bt.disabled = false;
      } finally {
        enviando = false;
      }
    }

    const abas = l ? [{ id: 'dados', rotulo: 'Dados' }, { id: 'docs', rotulo: `Documentos · ${Number(l.qtd_anexos) || 0}` }] : null;
    const ctl = await D.painel.abrir({
      icone: aba === 'docs' ? 'paperclip' : (l ? 'pencil-simple' : 'plus'), titulo: aba === 'docs' ? 'Documentos' : (l ? 'Editar lançamento' : 'Novo lançamento'),
      sub: l ? [l.centro_codigo, l.descricao].filter(Boolean).join(' · ') : 'Receita ou despesa de uma obra',
      abas, aba: aba === 'docs' ? 'docs' : 'dados',
      corpo: (_, c) => (aba === 'docs' ? L.docs(c, l) : desenharDados(c)),
      rodape: aba === 'docs' ? '<button type="button" class="btn btn-s" data-fechar>Fechar</button>' : botoes,
      aoTrocarAba: (id, c) => {
        if (id === 'docs') { ler(c.corpo, e); L.docs(c, l); c.botoes('<button type="button" class="btn btn-s" data-fechar>Fechar</button>'); } else { desenharDados(c); c.botoes(botoes); ligarSalvar(c); }
      },
    });
    if (ctl) ligarSalvar(ctl);
  };

  // Estorno, estornado ou mes fechado: so leitura e documentos (corrige o problema 6).
  L.leitura = async function (l, aba) {
    const fe = L.fechamento(l.data);
    const aviso = l.estorno_de ? 'Movimento de estorno: não pode ser editado nem excluído.'
      : (l.estornado ? 'Este lançamento foi estornado e fica no histórico, só para leitura.' : `${D.mesAno(String(l.data).slice(0, 7))} está fechado · só leitura. Anexar documento continua liberado.`);
    const dados = (c) => { c.desenhar(`${U.faixa(fe && !l.estorno_de && !l.estornado ? 'info' : 'warn', 'lock-simple', aviso)}${D.lancDados(l)}`); };
    await D.painel.abrir({
      icone: 'receipt', titulo: 'Lançamento', sub: [l.centro_codigo, l.descricao].filter(Boolean).join(' · '),
      abas: [{ id: 'dados', rotulo: 'Dados' }, { id: 'docs', rotulo: `Documentos · ${Number(l.qtd_anexos) || 0}` }], aba: aba === 'docs' ? 'docs' : 'dados',
      corpo: (_, c) => (aba === 'docs' ? L.docs(c, l) : dados(c)),
      rodape: '<button type="button" class="btn btn-s" data-fechar>Fechar</button>',
      aoTrocarAba: (id, c) => (id === 'docs' ? L.docs(c, l) : dados(c)),
    });
  };

  L.abrir = async (l, aba) => {
    await L.apoio(); // meses fechados, para decidir entre editar e so leitura
    return L.soLeitura(l) ? L.leitura(l, aba) : L.formulario(l, aba);
  };
  // Abre pelo id, com os dados completos do servidor (atividades recentes, busca).
  L.abrirPorId = async (id) => {
    try {
      const { data } = await CC.api(`/lancamentos/${encodeURIComponent(id)}`);
      D.lancCache.set(String(data.id), data);
      return L.abrir(data);
    } catch (error) {
      CC.toast(error.status === 404 ? 'Este lançamento não existe mais.' : error.message, 'warning');
      return null;
    }
  };
})(window.CC);
