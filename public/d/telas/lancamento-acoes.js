// Estornar (print 19) e excluir (print 20) um lancamento.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const L = D.lanc = D.lanc || {};
  const U = D.ui;

  L.estornar = async function (l) {
    const v = D.valorSinal(l);
    const hoje = CC.today();
    const minimo = l.data && l.data > hoje ? l.data : hoje;
    let enviando = false;
    const ctl = await D.painel.abrir({
      icone: 'arrow-u-up-left', titulo: 'Estornar lançamento', sub: [l.centro_codigo, l.descricao].filter(Boolean).join(' · '),
      corpo: `${U.faixa('warn', 'info', 'O estorno cria um lançamento de sentido contrário e mantém o original, com vínculo entre os dois. O original deixa de ser editável.')}
        <div class="card resumo-lanc"><b>${esc(l.descricao)}</b><span class="muted">${esc([l.centro_codigo, D.situacaoTexto(l).toLowerCase()].filter(Boolean).join(' · '))} · <b class="${v.entrada ? 'entrada' : ''}">${esc(v.texto)}</b></span></div>
        ${U.campo({ rotulo: 'Data do estorno', name: 'data_estorno', tipo: 'date', valor: minimo })}
        ${U.campo({ rotulo: 'Motivo', name: 'motivo', tipo: 'textarea', placeholder: 'Ex.: pagamento em duplicidade' })}`,
      rodape: `<button type="button" class="btn btn-s" data-fechar>Cancelar</button><button type="button" class="btn btn-p" data-ok>${D.ic('arrow-u-up-left')}Confirmar estorno</button>`,
    });
    if (!ctl) return;
    CC.$('[name="data_estorno"]', ctl.corpo).min = l.data || '';
    CC.$('[data-ok]', ctl.rodape).addEventListener('click', async () => {
      if (enviando) return;
      const data = CC.$('[name="data_estorno"]', ctl.corpo).value;
      const motivo = CC.$('[name="motivo"]', ctl.corpo).value.trim();
      const erros = {};
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) erros.data_estorno = 'Informe a data do estorno.';
      else if (l.data && data < l.data) erros.data_estorno = 'A data do estorno não pode ser anterior à do lançamento.';
      if (motivo.length < 5) erros.motivo = 'Informe o motivo com pelo menos 5 caracteres.';
      ctl.errosCampos(erros);
      if (Object.keys(erros).length) { ctl.erro(Object.values(erros)[0]); return; }
      ctl.erro('');
      enviando = true;
      try {
        await CC.api(`/lancamentos/${l.id}/estornar`, { method: 'POST', body: { motivo, data_estorno: data } });
        ctl.marcarSalvo();
        ctl.fechar(true);
        CC.toast('Estorno registrado · o original ficou marcado como estornado');
        if (L.recarregar) L.recarregar();
      } catch (error) {
        ctl.erro(error.status === 0 ? 'Sem internet. O estorno precisa da conexão.' : error.message);
      } finally {
        enviando = false;
      }
    });
  };

  L.excluir = async function (l) {
    const sim = await D.confirmar({
      titulo: 'Excluir este lançamento?',
      texto: ['"', l.descricao, '" sai da lista e dos totais. A exclusão fica no histórico.'].join(''), // o dialogo escapa
      ok: 'Excluir', tom: 'perigo',
    });
    if (!sim) return;
    try {
      await CC.api(`/lancamentos/${l.id}`, { method: 'DELETE' });
      CC.toast('Lançamento excluído');
      if (L.recarregar) L.recarregar();
    } catch (error) {
      await D.avisar('Não foi possível excluir', error.status === 0 ? 'Sem internet. Excluir precisa da conexão.' : error.message);
    }
  };
})(window.CC);
