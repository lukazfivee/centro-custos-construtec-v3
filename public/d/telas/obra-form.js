// Nova e editar obra no painel lateral. Inclui o orcamento (corrige o problema 3: o formulario atual
// nao envia o campo) e manda a revisao para nao sobrescrever a alteracao de outra pessoa.
(function (CC) {
  const D = CC.d;
  const O = D.obras = D.obras || {};
  const U = D.ui;
  const valorBr = (n) => (Number(n) ? Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');

  function campos(o) {
    const sit = Object.entries(O.SITUACAO).map(([valor, [rotulo]]) => ({ valor, rotulo }));
    return `<form class="form-lanc" novalidate>
      <div class="duas">${U.campo({ rotulo: 'Código', name: 'codigo', valor: o.codigo, placeholder: 'Ex.: CC-031' })}
        ${U.campo({ rotulo: 'Situação', name: 'situacao', tipo: 'select', valor: o.situacao || 'planejamento', opcoes: sit })}</div>
      ${U.campo({ rotulo: 'Nome da obra', name: 'nome', valor: o.nome, placeholder: 'Ex.: Residencial Aurora' })}
      <div class="duas">${U.campo({ rotulo: 'Cliente', name: 'cliente', valor: o.cliente })}${U.campo({ rotulo: 'Contrato', name: 'contrato', valor: o.contrato })}</div>
      ${U.campo({ rotulo: 'Responsável', name: 'responsavel', valor: o.responsavel })}
      <div class="duas">${U.campo({ rotulo: 'Início', name: 'data_inicio', tipo: 'date', valor: o.data_inicio })}${U.campo({ rotulo: 'Término previsto', name: 'data_fim', tipo: 'date', valor: o.data_fim })}</div>
      <div class="duas">${U.campo({ rotulo: 'Valor contratado (R$)', name: 'valor_contrato', valor: valorBr(o.valor_contrato), placeholder: '0,00' })}
        ${U.campo({ rotulo: 'Orçamento mensal (R$)', name: 'orcamento', valor: valorBr(o.orcamento), placeholder: '0,00', ajuda: 'Usado na barra realizado × orçado do Início' })}</div>
      ${U.campo({ rotulo: 'Descrição / escopo', name: 'descricao', tipo: 'textarea', valor: o.descricao, placeholder: 'Opcional' })}
      ${o.id ? `<label class="check"><input type="checkbox" name="ativo"${o.ativo !== false ? ' checked' : ''}> Obra ativa (inativas somem das listas de lançamento)</label>` : ''}
    </form>`;
  }

  function ler(corpo) {
    const v = (n) => (CC.$(`[name="${n}"]`, corpo) || {}).value || '';
    const ativo = CC.$('[name="ativo"]', corpo);
    return {
      codigo: v('codigo').trim(), nome: v('nome').trim(), situacao: v('situacao'), cliente: v('cliente').trim(), contrato: v('contrato').trim(),
      responsavel: v('responsavel').trim(), data_inicio: v('data_inicio'), data_fim: v('data_fim'),
      valor_contrato: v('valor_contrato'), orcamento: v('orcamento'), descricao: v('descricao').trim(), ativo: ativo ? ativo.checked : true,
    };
  }

  function validar(d) {
    const erros = {};
    if (!d.codigo) erros.codigo = 'Informe o código.';
    if (!d.nome) erros.nome = 'Informe o nome.';
    const dinheiro = (x) => (x.trim() === '' ? 0 : CC.parseMoney(x));
    if (!(dinheiro(d.valor_contrato) >= 0)) erros.valor_contrato = 'Valor inválido.';
    if (!(dinheiro(d.orcamento) >= 0)) erros.orcamento = 'Valor inválido.';
    if (d.data_inicio && d.data_fim && d.data_fim < d.data_inicio) erros.data_fim = 'O término não pode ser antes do início.';
    return { erros, valorContrato: dinheiro(d.valor_contrato), orcamento: dinheiro(d.orcamento) };
  }

  // o: obra (null para nova). aoSalvar: recarrega a tela de origem.
  O.formulario = async function (o, aoSalvar) {
    const obra = o || {};
    let enviando = false;
    const ctl = await D.painel.abrir({
      icone: o ? 'pencil-simple' : 'plus', titulo: o ? 'Editar obra' : 'Nova obra', sub: o ? [o.codigo, o.nome].filter(Boolean).join(' · ') : 'Obra ou centro de custo',
      corpo: campos(obra),
      rodape: `<button type="button" class="btn btn-s" data-fechar>Cancelar</button><button type="button" class="btn btn-p" data-salvar>${D.ic('check')}${o ? 'Salvar alterações' : 'Criar obra'}</button>`,
    });
    if (!ctl) return;
    const salvar = async () => {
      if (enviando) return;
      const d = ler(ctl.corpo);
      const { erros, valorContrato, orcamento } = validar(d);
      ctl.errosCampos(erros);
      if (Object.keys(erros).length) { ctl.erro(Object.values(erros)[0]); return; }
      ctl.erro('');
      enviando = true;
      const body = { ...d, valor_contrato: valorContrato, orcamento, data_inicio: d.data_inicio || null, data_fim: d.data_fim || null };
      try {
        if (o) await CC.api(`/centros-custo/${o.id}`, { method: 'PUT', body: { ...body, revisao: Number(o.revision) } });
        else await CC.api('/centros-custo', { method: 'POST', body });
        ctl.marcarSalvo();
        ctl.fechar(true);
        CC.toast(o ? 'Obra atualizada' : 'Obra criada');
        if (D.lanc && D.lanc.esquecerApoio) D.lanc.esquecerApoio();
        if (aoSalvar) aoSalvar();
      } catch (error) {
        ctl.erro(error.status === 0 ? 'Sem internet. Salvar a obra precisa da conexão.' : error.message);
      } finally {
        enviando = false;
      }
    };
    CC.$('[data-salvar]', ctl.rodape).addEventListener('click', salvar);
    CC.$('form', ctl.corpo).addEventListener('submit', (e) => { e.preventDefault(); salvar(); });
  };
})(window.CC);
