// Dialogo "Gerar lancamentos do mes" (print 58): mostra o que sera criado antes de gravar.
// Os lancamentos entram como "A pagar" no dia de cada modelo; repetir no mesmo mes nao duplica.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const C = D.cad;

  // previa: resposta de GET /recorrentes/previa. Resolve com { gerados } ou null se cancelou.
  C.gerarDialogo = function (previa) {
    const nome = C.nomeMes(previa.mes);
    const anterior = document.activeElement;
    return new Promise((resolve) => {
      const camada = D.el(`<div class="dialogo-camada">
        <div class="card dialogo lista" role="alertdialog" aria-modal="true" aria-labelledby="ger-tit">
          <span class="dic">${D.ic('lightning')}</span>
          <b id="ger-tit">Gerar ${esc(C.plural(previa.total_itens, 'lançamento', 'lançamentos'))} de ${esc(nome)}?</b>
          <span class="txt">Todos entram como "A pagar", com vencimento no dia de cada modelo. Dá para editar ou excluir depois, como qualquer lançamento.</span>
          <span class="erro-dlg faixa err" role="alert" hidden></span>
          <div class="itens">${previa.itens.map((i) => `<div class="item"><div class="dois-tx"><b>${esc(i.descricao)}</b><span>${esc(D.data(i.data))} · ${esc(i.obra)}</span></div><b class="val">${esc(CC.money(i.valor))}</b></div>`).join('')}</div>
          <div class="bts"><button type="button" class="btn btn-s" data-r="0">Cancelar</button><button type="button" class="btn btn-p" data-r="1">Gerar lançamentos</button></div>
        </div></div>`);
      const fechar = (valor) => {
        document.removeEventListener('keydown', teclas, true);
        camada.remove();
        if (anterior && anterior.focus) anterior.focus();
        resolve(valor);
      };
      const teclas = (event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); fechar(null); return; }
        D.prenderFoco(camada, event);
      };
      camada.addEventListener('click', async (event) => {
        const bt = event.target.closest('[data-r]');
        if (!bt && event.target === camada) { fechar(null); return; }
        if (!bt) return;
        if (bt.dataset.r === '0') { fechar(null); return; }
        // Grava aqui dentro: se o servidor recusar, o dialogo continua aberto com o motivo.
        const botoes = CC.$$('[data-r]', camada);
        botoes.forEach((b) => { b.disabled = true; });
        try {
          const { data } = await CC.api('/recorrentes/gerar', { method: 'POST', body: { mes: previa.mes, planToken: previa.planToken } });
          fechar({ gerados: data.gerados });
        } catch (error) {
          const faixa = CC.$('.erro-dlg', camada);
          faixa.hidden = false;
          faixa.textContent = error.status === 0 ? 'Sem internet. Gerar precisa da conexão.' : error.message;
          botoes.forEach((b) => { b.disabled = false; });
        }
      });
      document.addEventListener('keydown', teclas, true);
      document.body.appendChild(camada);
      CC.$('[data-r="1"]', camada).focus();
    });
  };
})(window.CC);
