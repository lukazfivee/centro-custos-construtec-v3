// Dialogo de confirmacao proprio (prints 20, 71 e 94). Substitui alert, confirm e prompt do navegador.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;

  // CC.d.confirmar({ titulo, texto, ok, cancelar, tom: 'perigo' | 'aviso' | 'info', icone }) -> Promise<boolean>
  D.confirmar = function (opcoes) {
    const o = opcoes || {};
    const tom = o.tom || 'info';
    const icone = o.icone || (tom === 'perigo' ? 'trash' : (tom === 'aviso' ? 'warning' : 'question'));
    const anterior = document.activeElement;
    return new Promise((resolve) => {
      const camada = D.el(`<div class="dialogo-camada">
        <div class="card dialogo ${esc(tom)}" role="alertdialog" aria-modal="true" aria-labelledby="dlg-tit" aria-describedby="dlg-txt">
          <span class="dic">${D.ic(icone)}</span>
          <b id="dlg-tit">${esc(o.titulo || 'Confirmar')}</b>
          ${o.texto ? `<span class="txt" id="dlg-txt">${esc(o.texto)}</span>` : ''}
          <div class="bts">
            ${o.cancelar === false ? '' : `<button type="button" class="btn btn-s" data-r="0">${esc(o.cancelar || 'Cancelar')}</button>`}
            <button type="button" class="btn ${tom === 'perigo' ? 'btn-d' : 'btn-p'}" data-r="1">${esc(o.ok || 'Confirmar')}</button>
          </div>
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
      camada.addEventListener('click', (event) => {
        const bt = event.target.closest('[data-r]');
        if (bt) fechar(bt.dataset.r === '1');
        else if (event.target === camada) fechar(false);
      });
      document.addEventListener('keydown', teclas, true);
      document.body.appendChild(camada);
      const alvo = CC.$(o.tom === 'perigo' ? '[data-r="0"]' : '[data-r="1"]', camada) || CC.$('[data-r]', camada);
      alvo.focus();
    });
  };

  // Aviso simples com um botao so (no lugar do alert).
  D.avisar = (titulo, texto) => D.confirmar({ titulo, texto, ok: 'Entendi', cancelar: false, tom: 'aviso' });
})(window.CC);
