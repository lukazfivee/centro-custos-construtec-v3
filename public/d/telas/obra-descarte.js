// Descartar uma obra sem movimento financeiro (inclusive a vinda de orcamento aprovado) e recuperar obras
// descartadas. So administrador; o servidor confere tudo (routes/costCenterDiscard.js).
(function (CC) {
  const D = CC.d;
  const U = D.ui;
  const O = D.obras = D.obras || {};
  const { esc } = CC;

  O.descartar = async function (obra, depois) {
    const ctl = await D.painel.abrir({
      icone: 'trash', titulo: 'Descartar obra',
      sub: `${obra.codigo} · ${obra.nome}`,
      corpo: `${U.faixa('warn', 'warning', 'A obra sai da carteira, com o contrato e a base de custo. Só vale para obra sem lançamento, nota fiscal, medição nem recorrência. Fica guardada em "Obras descartadas" e pode ser recuperada.')}
        ${U.faixa('info', 'info', 'Se a obra veio do Orçamentos, a proposta de origem volta a "Aprovada sem Centro de Custo" no Orçamentos e volta a apontar para a obra se ela for recuperada.')}
        <form class="form-lanc" novalidate>
          ${U.campo({ rotulo: 'Motivo (opcional)', name: 'motivo', placeholder: 'Ex.: obra de teste' })}
          ${U.campo({ rotulo: `Digite o código da obra (${obra.codigo}) para confirmar`, name: 'confirmar', obrigatorio: true })}
        </form>`,
      rodape: '<button type="button" class="btn btn-s" data-fechar>Cancelar</button><button type="button" class="btn btn-d" data-confirmar>Descartar obra</button>',
    });
    if (!ctl) return;
    let ocupado = false;
    const enviar = async () => {
      if (ocupado) return;
      const body = Object.fromEntries(new FormData(CC.$('form', ctl.corpo)).entries());
      if (String(body.confirmar || '').trim().toLowerCase() !== String(obra.codigo).trim().toLowerCase()) {
        ctl.errosCampos({ confirmar: 'Digite o código exatamente como aparece.' });
        return;
      }
      ocupado = true;
      try {
        await CC.api(`/centros-custo/${obra.id}/descartar`, { method: 'POST', body });
        ctl.marcarSalvo();
        ctl.fechar(true);
        CC.toast('Obra descartada. Dá para recuperar em "Obras descartadas".');
        await depois();
      } catch (error) { ctl.erro(error.message); }
      finally { ocupado = false; }
    };
    CC.$('form', ctl.corpo).addEventListener('submit', (event) => { event.preventDefault(); enviar(); });
    CC.$('[data-confirmar]', ctl.rodape).addEventListener('click', enviar);
  };

  O.descartadas = async function (depois) {
    const { data } = await CC.api('/centros-custo/descartadas');
    const lista = Array.isArray(data) ? data : [];
    const linha = (d) => `<div class="usu-email"><span><b>${esc(d.code)}</b> · ${esc(d.name)}<br><small class="muted">${d.restored_at ? `Restaurada em ${esc(D.data(d.restored_at))}` : `Descartada em ${esc(D.data(d.discarded_at))} por ${esc(d.discarded_by_name || '')}`}${d.reason ? ` · ${esc(d.reason)}` : ''}</small></span>
      ${d.restored_at ? U.chip('Restaurada', 'ok') : `<button type="button" class="btn btn-s" data-restaurar="${esc(d.id)}">Restaurar</button>`}</div>`;
    const ctl = await D.painel.abrir({
      icone: 'arrow-counter-clockwise', titulo: 'Obras descartadas', sub: 'Restaurar devolve a obra, o contrato e a base de custo.',
      corpo: lista.length ? `<div class="card usu-emails">${lista.map(linha).join('')}</div>` : U.vazio('buildings', 'Nenhuma obra descartada.'),
      rodape: '<button type="button" class="btn btn-p" data-fechar>Fechar</button>',
    });
    if (!ctl) return;
    CC.$$('[data-restaurar]', ctl.corpo).forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await CC.api(`/centros-custo/descartadas/${b.dataset.restaurar}/restaurar`, { method: 'POST', body: {} });
        ctl.marcarSalvo();
        ctl.fechar(true);
        CC.toast('Obra restaurada');
        await depois();
      } catch (error) { ctl.erro(error.message); b.disabled = false; }
    }));
  };
})(window.CC);
