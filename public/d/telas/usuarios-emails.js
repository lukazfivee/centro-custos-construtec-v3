// D6: aba "E-mails externos" (a lista que ja existia, no visual novo).
(function (CC) {
  const D = CC.d;
  const U = D.ui;
  const { esc } = CC;
  const tituloEmail = (item) => (typeof item === 'string' ? item : String(item?.email || ''));

  async function emailForm(email, atualizar) {
    const revogar = !!email;
    const ctl = await D.painel.abrir({
      icone: 'envelope', titulo: revogar ? 'Revogar autorização' : 'Autorizar e-mail externo',
      corpo: revogar ? U.faixa('warn', 'warning', `Revogar o acesso de ${email}?`) :
        `<form class="form-lanc" novalidate>${U.campo({ rotulo: 'E-mail', name: 'email', tipo: 'email', obrigatorio: true })}${U.campo({ rotulo: 'Observação', name: 'observacao' })}</form>`,
      rodape: `<button type="button" class="btn btn-s" data-fechar>Cancelar</button><button type="button" class="btn btn-p" data-confirmar>${revogar ? 'Revogar' : 'Autorizar'}</button>`,
    });
    if (!ctl) return;
    CC.$('[data-confirmar]', ctl.rodape).addEventListener('click', async () => {
      const body = revogar ? { email } : Object.fromEntries(new FormData(CC.$('form', ctl.corpo)).entries());
      try {
        await CC.api(revogar ? '/usuarios/emails-autorizados/revogar' : '/usuarios/emails-autorizados', { method: 'POST', body });
        ctl.marcarSalvo();
        ctl.fechar(true);
        CC.toast(revogar ? 'Autorização revogada' : 'E-mail autorizado');
        await atualizar();
      } catch (error) { ctl.erro(error.message); }
    });
  }

  D.usu.abaEmails = async function (corpo, vivo) {
    corpo.innerHTML = U.carregando('Carregando e-mails autorizados…');
    const { data } = await CC.api('/usuarios/emails-autorizados/lista');
    if (!vivo()) return;
    if (!data.disponivel) {
      corpo.innerHTML = U.faixa('info', 'info', 'E-mails externos são administrados apenas com uma conta corporativa.');
      return;
    }
    const emails = Array.isArray(data.emails) ? data.emails : [];
    corpo.innerHTML = `<div class="card usu-emails"><div class="usu-email-topo"><b>E-mails externos autorizados</b><button type="button" class="btn btn-p" data-autorizar>${D.ic('plus')}Autorizar e-mail</button></div>
      ${emails.length ? emails.map((item) => `<div class="usu-email"><span>${esc(tituloEmail(item))}</span><button type="button" class="btn btn-s" data-revogar="${esc(tituloEmail(item))}">Revogar</button></div>`).join('') : U.vazio('envelope', 'Nenhum e-mail externo autorizado.')}</div>`;
    const recarregar = () => D.usu.abaEmails(corpo, vivo);
    CC.$('[data-autorizar]', corpo).addEventListener('click', () => emailForm(null, recarregar));
    CC.$$('[data-revogar]', corpo).forEach((botao) => botao.addEventListener('click', () => emailForm(botao.dataset.revogar, recarregar)));
  };
})(window.CC);
