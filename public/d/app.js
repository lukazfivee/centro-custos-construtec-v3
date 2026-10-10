// Entrada do desktop novo: sessao (mesma do Centro de Custos web, cc_token), handoff da Suite,
// tela de entrar (login.js), montagem da estrutura e inicio do roteador.
(function (CC) {
  const D = CC.d;
  let montado = false;

  // Sem sessao, a tela de entrar do proprio /d/. No meio do uso (401), recarrega com o aviso de sessao
  // terminada e volta para a mesma tela depois de entrar (o endereco fica).
  const paraLogin = (aviso) => {
    try { CC.session.clear(); } catch { /* sem armazenamento */ }
    D.entrar({ aviso, aoEntrar: async () => { await conferirSessao(); abrir(); } });
  };
  CC.onUnauthorized = () => {
    if (!montado) return; // na abertura, o iniciar() cuida
    D.sessao.avisar('exp');
    location.reload();
  };

  async function consumirHandoff(code) {
    history.replaceState(null, '', location.pathname + location.search);
    const response = await fetch('/v1/auth/handoff/consume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.token || !data.usuario || !data.instancia) throw new Error('Não foi possível entrar pelo aplicativo.');
    CC.session.save(data);
    D.sessao.manter(true);
  }

  // Confere a sessao e atualiza nome e papel guardados (o papel pode ter mudado).
  async function conferirSessao() {
    try {
      const { data } = await CC.api('/auth/me');
      const atual = CC.session.user() || {};
      localStorage.setItem('cc_usuario', JSON.stringify({ ...atual, id: data.id, nome: data.nome, email: data.email, role: data.role, suiteRole: data.suiteRole, permissoes: data.permissoes, todasObras: data.todasObras }));
      return true;
    } catch (error) {
      if (error.status === 401) return false;
      return !!CC.session.user(); // sem rede: segue com o que esta guardado
    }
  }

  function abrir() {
    montado = true;
    D.montarEstrutura();
    D.montarBusca();
    D.montarSuite();
    D.iniciarSelo();
    D.upd.iniciar();
    if (D.cobr && D.cobr.atualizarContador) D.cobr.atualizarContador();
    D.tema.sincronizar();
    D.iniciarRotas();
  }

  async function iniciar() {
    D.tema.inicial();
    D.sessao.conferirTemporaria();
    const aviso = D.sessao.aviso();
    const code = new URLSearchParams(location.hash.slice(1)).get('handoff');
    if (code) {
      try { await consumirHandoff(code); } catch { /* sem handoff valido: usa a sessao que houver */ }
    }
    if (!CC.session.token()) return paraLogin(aviso);
    if (!(await conferirSessao())) return paraLogin('exp');
    return abrir();
  }

  iniciar();
})(window.CC);
