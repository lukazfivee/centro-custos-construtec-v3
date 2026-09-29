// Novo e editar recorrente no painel lateral (print 57): o modelo que vira lancamento todo mes.
// Uma previa diz a data da proxima geracao (GET /recorrentes/proxima, a mesma conta do servidor).
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const C = D.cad;
  const U = D.ui;
  const FREQ = C.FREQUENCIAS = { mensal: 'Mensal', bimestral: 'Bimestral', trimestral: 'Trimestral', semestral: 'Semestral', anual: 'Anual' };
  const TIPOS = [{ valor: 'despesa', rotulo: 'Despesa' }, { valor: 'receita', rotulo: 'Receita' }];
  const valorBr = (n) => (Number(n) ? Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');

  const categoriasDe = (categorias, tipo) => categorias.filter((c) => c.ativo !== false && (c.tipo === tipo || c.tipo === 'ambos'));
  const opcoes = (lista, vazio) => [{ valor: '', rotulo: vazio }, ...lista.map((x) => ({ valor: x.id, rotulo: x.rotulo || x.nome }))];

  function campos(m, obras, categorias, favorecidos) {
    const tipo = m.tipo || 'despesa';
    return `<form class="form-lanc" novalidate>
      <div class="fld"><span>Tipo</span>${U.seg('tipo', TIPOS, tipo, 'Tipo do modelo')}</div>
      ${U.campo({ rotulo: 'Descrição', name: 'nome', valor: m.nome, placeholder: 'Ex.: Locação de plataforma elevatória' })}
      <div class="duas">${U.campo({ rotulo: 'Obra', name: 'cost_center_id', tipo: 'select', valor: m.cost_center_id || '', opcoes: opcoes(obras.map((o) => ({ id: o.id, rotulo: o.codigo + ' · ' + o.nome })), 'Escolha a obra') })}
        ${U.campo({ rotulo: 'Categoria', name: 'category_id', tipo: 'select', valor: m.category_id || '', opcoes: opcoes(categoriasDe(categorias, tipo), 'Escolha a categoria') })}</div>
      <label class="fld" for="f-favorecido"><span>Favorecido · opcional</span><input class="inp" id="f-favorecido" name="favorecido" list="lista-fav" value="${esc(m.favorecido || '')}" placeholder="Quem recebe">
        <datalist id="lista-fav">${favorecidos.map((f) => `<option value="${esc(f)}"></option>`).join('')}</datalist><span class="erro" role="alert"></span></label>
      <div class="duas">${U.campo({ rotulo: 'Valor (R$)', name: 'valor', valor: valorBr(m.valor), placeholder: '0,00' })}
        ${U.campo({ rotulo: 'Dia do mês', name: 'dia_mes', tipo: 'number', valor: m.dia_mes || '', placeholder: '1 a 31' })}</div>
      <div class="duas">${U.campo({ rotulo: 'Frequência', name: 'frequencia', tipo: 'select', valor: m.frequencia || 'mensal', opcoes: Object.entries(FREQ).map(([valor, rotulo]) => ({ valor, rotulo })) })}
        ${U.campo({ rotulo: 'Parcelas', name: 'total_parcelas', tipo: 'number', valor: m.total_parcelas || '', placeholder: 'Vazio = sem fim' })}</div>
      ${U.campo({ rotulo: 'Primeiro mês · opcional', name: 'inicio', tipo: 'month', valor: m.inicio || '', ajuda: 'Vazio: começa no próximo dia escolhido.' })}
      <div class="faixa info" data-proxima role="status">${D.ic('calendar-check')}<span></span></div>
      ${m.id ? C.troca({ titulo: 'Modelo ativo', texto: 'Pausado não gera lançamentos.', ligado: m.ativo !== false }) : ''}
    </form>`;
  }

  // m: linha da lista (null para novo). aoSalvar: recarrega a tela.
  C.recorrenteForm = async function (m, aoSalvar) {
    const modelo = m || {};
    let enviando = false;
    const [obras, categorias, favorecidos] = await Promise.all([
      CC.api('/centros-custo').then((r) => (Array.isArray(r.data) ? r.data : []).filter((o) => o.ativo !== false || (m && o.id === m.cost_center_id))),
      CC.api('/categorias').then((r) => (Array.isArray(r.data) ? r.data : [])),
      CC.api('/fornecedores').then((r) => (Array.isArray(r.data) ? r.data : []).map((f) => f.nome)).catch(() => []),
    ]);
    const ctl = await D.painel.abrir({
      icone: 'arrows-clockwise', titulo: m ? 'Editar recorrente' : 'Novo recorrente', sub: m ? m.nome : 'Vira lançamento todo mês, com frequência, dia e parcelas',
      corpo: campos(modelo, obras, categorias, favorecidos),
      rodape: `${m ? `<button type="button" class="btn btn-g" data-excluir style="margin-right:auto">${D.ic('trash')}Excluir</button>` : ''}<button type="button" class="btn btn-s" data-fechar>Cancelar</button><button type="button" class="btn btn-p" data-salvar>${D.ic('check')}${m ? 'Salvar alterações' : 'Cadastrar'}</button>`,
    });
    if (!ctl) return;
    const ativo = m ? C.ligarTroca(ctl.corpo, ctl) : () => true;
    const v = (n) => (CC.$(`[name="${n}"]`, ctl.corpo) || {}).value || '';
    const tipo = () => (CC.$('[data-seg="tipo"][aria-pressed="true"]', ctl.corpo) || { dataset: { valor: 'despesa' } }).dataset.valor;

    // Trocar o tipo refaz a lista de categorias (despesa e "receita e despesa", ou receita e "receita e despesa").
    CC.$$('[data-seg="tipo"]', ctl.corpo).forEach((b) => b.addEventListener('click', () => {
      U.segEscolher(b.parentElement, b);
      const sel = CC.$('[name="category_id"]', ctl.corpo);
      const atual = sel.value;
      const lista = categoriasDe(categorias, tipo());
      sel.innerHTML = opcoes(lista, 'Escolha a categoria').map((o) => `<option value="${esc(o.valor)}"${String(o.valor) === atual ? ' selected' : ''}>${esc(o.rotulo)}</option>`).join('');
      ctl.sujo = true;
    }));

    const atualizarProxima = D.debounce(async () => {
      const alvo = CC.$('[data-proxima] span', ctl.corpo);
      if (!alvo) return;
      const q = new URLSearchParams({ frequencia: v('frequencia') || 'mensal' });
      if (v('dia_mes')) q.set('dia_mes', v('dia_mes'));
      if (v('total_parcelas')) q.set('total_parcelas', v('total_parcelas'));
      if (v('inicio')) q.set('inicio', v('inicio'));
      try {
        const { data } = await CC.api(`/recorrentes/proxima?${q}`);
        alvo.textContent = data.data ? `Próxima geração em ${D.data(data.data)}.` : 'Sem próximas gerações: as parcelas já terminaram.';
      } catch { alvo.textContent = ''; }
    }, 250);
    ['dia_mes', 'frequencia', 'total_parcelas', 'inicio'].forEach((n) => CC.$(`[name="${n}"]`, ctl.corpo).addEventListener('input', atualizarProxima));
    atualizarProxima();

    const salvar = async () => {
      if (enviando) return;
      const valor = CC.parseMoney(v('valor'));
      const dia = Number(v('dia_mes')) || null;
      const parcelas = Number(v('total_parcelas')) || null;
      const erros = {};
      if (!v('nome').trim()) erros.nome = 'Informe a descrição.';
      if (!v('cost_center_id')) erros.cost_center_id = 'Escolha a obra.';
      if (!v('category_id')) erros.category_id = 'Escolha a categoria.';
      if (!(valor > 0)) erros.valor = 'Informe um valor maior que zero.';
      if (dia && (dia < 1 || dia > 31)) erros.dia_mes = 'O dia vai de 1 a 31.';
      if (parcelas && (!Number.isInteger(parcelas) || parcelas < 1)) erros.total_parcelas = 'Use um número inteiro.';
      ctl.errosCampos(erros);
      if (Object.keys(erros).length) { ctl.erro(Object.values(erros)[0]); return; }
      ctl.erro('');
      enviando = true;
      const body = { nome: v('nome').trim(), tipo: tipo(), cost_center_id: Number(v('cost_center_id')), category_id: Number(v('category_id')), favorecido: v('favorecido').trim(),
        valor, dia_mes: dia, frequencia: v('frequencia'), total_parcelas: parcelas, forma_pagamento: modelo.forma_pagamento || '', ativo: ativo() };
      if (v('inicio')) body.inicio = v('inicio');
      try {
        if (m) await CC.api(`/recorrentes/${m.id}`, { method: 'PUT', body });
        else await CC.api('/recorrentes', { method: 'POST', body });
        ctl.marcarSalvo();
        ctl.fechar(true);
        CC.toast(m ? 'Recorrente atualizado' : 'Recorrente cadastrado');
        if (aoSalvar) aoSalvar();
      } catch (error) {
        C.mostrarErro(ctl, error);
      } finally {
        enviando = false;
      }
    };
    CC.$('[data-salvar]', ctl.rodape).addEventListener('click', salvar);
    CC.$('form', ctl.corpo).addEventListener('submit', (e) => { e.preventDefault(); salvar(); });
    const excluir = CC.$('[data-excluir]', ctl.rodape);
    if (excluir) excluir.addEventListener('click', async () => {
      const sim = await D.confirmar({ titulo: 'Excluir este recorrente?', texto: 'Os lançamentos já gerados continuam como estão; só o modelo some.', ok: 'Excluir', tom: 'perigo' });
      if (!sim) return;
      try {
        await CC.api(`/recorrentes/${m.id}`, { method: 'DELETE' });
        ctl.marcarSalvo();
        ctl.fechar(true);
        CC.toast('Recorrente excluído');
        if (aoSalvar) aoSalvar();
      } catch (error) { C.mostrarErro(ctl, error); }
    });
  };
})(window.CC);
