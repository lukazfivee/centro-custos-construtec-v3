// D6: "Ver o sistema como" (print 67). So visual: troca o menu e os botoes no navegador do admin;
// o servidor continua usando o papel real.
(function (CC) {
  const D = CC.d;
  const X = D.usu;
  const { esc } = CC;

  X.seletorComo = () => {
    const atual = D.simulando() || 'admin';
    return `<label class="usu-como">${D.ic('eye')}<span>Ver o sistema como</span>
      <select class="inp" data-como aria-label="Ver o sistema como">${X.PAPEIS.map((p) => `<option value="${esc(p.valor)}"${p.valor === atual ? ' selected' : ''}>${esc(p.rotulo)}${p.valor === 'admin' ? ' (eu)' : ''}</option>`).join('')}</select></label>`;
  };

  X.ligarComo = (el) => {
    const seletor = CC.$('[data-como]', el);
    if (!seletor) return;
    seletor.addEventListener('change', async () => {
      const papel = seletor.value;
      try {
        if (papel === 'admin') D.simular('');
        else {
          const dados = await X.matriz();
          const permissoes = Object.keys(dados.matriz[papel] || {}).filter((p) => dados.matriz[papel][p]);
          D.simular(papel, permissoes);
        }
        location.hash = '#/inicio';
        location.reload();
      } catch (error) { CC.toast(error.message); }
    });
  };
})(window.CC);
