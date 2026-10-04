// D7: Configuracoes (prints 90 a 95). Abas pela rota: #/config, #/config/backup, #/config/sistema.
// "Meu perfil" e para todos; backup e sistema so para quem administra (p9), como no servidor.
(function (CC) {
  const D = CC.d;
  const U = D.ui;
  const { esc } = CC;

  const ABAS = [
    ['perfil', 'Meu perfil', () => true],
    ['backup', 'Backup e restauração', () => D.tem('p9')],
    ['sistema', 'Sistema', () => D.tem('p9')],
  ];

  async function render(el, rota, vivo) {
    const abas = ABAS.filter((a) => a[2]());
    const atual = (abas.find((a) => a[0] === rota.id) || abas[0])[0];
    el.innerHTML = `<div class="pagina">${U.cabecalho({ grupo: 'Administração', titulo: 'Configurações', sub: 'Seu perfil, cópias de segurança e informações do sistema' })}
      <div class="usu-abas" role="tablist">${abas.map(([k, rotulo]) => `<button type="button" role="tab" data-aba="${k}" aria-selected="${k === atual}">${esc(rotulo)}</button>`).join('')}</div>
      <div data-corpo></div></div>`;
    CC.$$('[data-aba]', el).forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.aba !== atual) D.ir(b.dataset.aba === 'perfil' ? 'config' : `config/${b.dataset.aba}`);
    }));
    const corpo = CC.$('[data-corpo]', el);
    try {
      await D.cfg[atual === 'perfil' ? 'perfil' : atual](corpo, vivo);
    } catch (error) {
      if (vivo()) corpo.innerHTML = U.faixa('err', 'warning-circle', error.message || 'Não foi possível abrir esta aba.');
    }
  }

  D.tela('config', { render });
})(window.CC);
