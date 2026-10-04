// Fechamento mensal (D7, prints 71 e 75): confirmar o fechamento listando as pendencias e reabrir com
// motivo de pelo menos 10 caracteres. Os dialogos gravam por dentro: se o servidor recusar, ficam abertos.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const F = D.fech = D.fech || {};
  const MOTIVO_MINIMO = 10;

  // aoConfirmar(camada) devolve true para fechar, false para continuar aberto, ou lanca o erro a mostrar.
  function dialogo({ icone, tom, id, titulo, texto, corpo, ok, aoConfirmar }) {
    const anterior = document.activeElement;
    return new Promise((resolve) => {
      const camada = D.el(`<div class="dialogo-camada">
        <div class="card dialogo lista ${esc(tom)}" role="alertdialog" aria-modal="true" aria-labelledby="${id}-tit">
          <span class="dic">${D.ic(icone)}</span>
          <b id="${id}-tit">${esc(titulo)}</b>
          <span class="txt">${esc(texto)}</span>
          <span class="erro-dlg faixa err" role="alert" hidden></span>
          ${corpo}
          <div class="bts"><button type="button" class="btn btn-s" data-r="0">Cancelar</button><button type="button" class="btn btn-p" data-r="1">${esc(ok)}</button></div>
        </div></div>`);
      const fechar = (valor) => {
        document.removeEventListener('keydown', teclas, true);
        camada.remove();
        if (anterior && anterior.focus) anterior.focus();
        resolve(valor);
      };
      const teclas = (event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); fechar(false); return; }
        D.prenderFoco(camada, event);
      };
      camada.addEventListener('click', async (event) => {
        const bt = event.target.closest('[data-r]');
        if (!bt && event.target === camada) { fechar(false); return; }
        if (!bt) return;
        if (bt.dataset.r === '0') { fechar(false); return; }
        const botoes = CC.$$('[data-r]', camada);
        botoes.forEach((b) => { b.disabled = true; });
        const faixa = CC.$('.erro-dlg', camada);
        faixa.hidden = true;
        try {
          if (await aoConfirmar(camada)) { fechar(true); return; }
        } catch (error) {
          faixa.hidden = false;
          faixa.textContent = error.status === 0 ? 'Sem internet. Esta ação precisa da conexão.' : error.message;
        }
        botoes.forEach((b) => { b.disabled = false; });
      });
      document.addEventListener('keydown', teclas, true);
      document.body.appendChild(camada);
      (CC.$('textarea', camada) || CC.$('[data-r="1"]', camada)).focus();
    });
  }

  // Resolve true se o mes foi fechado. pendencias: o que o checklist achou (vai gravado no fechamento).
  F.dialogoFechar = function (ano, mes, pendencias) {
    const nome = F.nome(ano, mes);
    const n = pendencias.length;
    const lista = n ? `<div class="itens">${pendencias.map((p) => `<div class="item"><div class="dois-tx"><b>${esc(p.titulo)}</b><span>${esc(p.detalhe || '')}</span></div></div>`).join('')}</div>` : '';
    return dialogo({
      icone: 'lock-simple', tom: 'info', id: 'fech', titulo: `Fechar ${nome}?`, ok: n ? 'Fechar mesmo assim' : 'Fechar mês',
      texto: n
        ? `Ainda há ${F.plural(n, 'pendência', 'pendências')}. Dá para fechar mesmo assim; elas ficam registradas no fechamento e no Histórico. Depois, ninguém edita, exclui ou estorna lançamentos deste mês sem reabrir.`
        : 'Tudo certo no checklist. Depois de fechar, ninguém edita, exclui ou estorna lançamentos deste mês sem reabrir.',
      corpo: lista,
      aoConfirmar: async () => {
        await CC.api('/fechamento-mensal', { method: 'POST', body: { ano, mes, pendencias } });
        return true;
      },
    });
  };

  // Resolve true se o mes foi reaberto.
  F.dialogoReabrir = function (ano, mes, fechamentoId) {
    const corpo = `<label class="fld" for="fech-motivo"><span>Motivo da reabertura</span>
      <textarea class="inp" id="fech-motivo" name="motivo" rows="3" maxlength="500" placeholder="Ex.: NF de agosto chegou depois do fechamento"></textarea>
      <small class="muted">Pelo menos ${MOTIVO_MINIMO} caracteres.</small><span class="erro" role="alert"></span></label>`;
    return dialogo({
      icone: 'lock-simple-open', tom: 'aviso', id: 'reab', titulo: `Reabrir ${F.nome(ano, mes)}?`, ok: 'Reabrir o mês', corpo,
      texto: 'Os lançamentos do mês voltam a ser editáveis até alguém fechar de novo. O motivo fica no Histórico e aparece na lista de competências.',
      aoConfirmar: async (camada) => {
        const motivo = CC.$('[name="motivo"]', camada).value.trim();
        const erro = CC.$('.fld .erro', camada);
        if (motivo.length < MOTIVO_MINIMO) { erro.textContent = `Conte o motivo com pelo menos ${MOTIVO_MINIMO} caracteres.`; return false; }
        erro.textContent = '';
        await CC.api(`/fechamento-mensal/${fechamentoId}`, { method: 'DELETE', body: { motivo } });
        return true;
      },
    });
  };

  // Fluxo do botao "Fechar": confere o checklist de novo, confirma e grava. Resolve true se fechou.
  F.fechar = async function (ano, mes) {
    const lista = await F.checklist(ano, mes);
    return F.dialogoFechar(ano, mes, F.pendenciasDe(lista));
  };
})(window.CC);
