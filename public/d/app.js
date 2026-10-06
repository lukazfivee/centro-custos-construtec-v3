// Entrada do desktop novo: sessao (mesma do Centro de Custos web, cc_token), handoff da Suite,
// montagem da estrutura e inicio do roteador.
(function (CC) {
  const D = CC.d;

  // Sem sessao, limpa o que sobrou e vai para a tela de entrada (pagina de login em /?entrar=1).
  const paraLogin = () => { try { CC.session.clear(); } catch { /* sem armazenamento */ } location.replace('/?entrar=1'); };
  CC.onUnauthorized = paraLogin;

  async function consumirHandoff(code) {
    history.replaceState(null, '', location.pathname + location.search);
    const response = await fetch('/v1/auth/handoff/consume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.token || !data.usuario || !data.instancia) throw new Error('Não foi possível entrar pelo aplicativo.');
    CC.session.save(data);
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

  async function iniciar() {
    D.tema.inicial();
    const code = new URLSearchParams(location.hash.slice(1)).get('handoff');
    if (code) {
      try { await consumirHandoff(code); } catch { /* sem handoff valido: usa a sessao que houver */ }
    }
    if (!CC.session.token()) return paraLogin();
    if (!(await conferirSessao())) return paraLogin();
    D.montarEstrutura();
    D.montarBusca();
    D.montarSuite();
    D.iniciarSelo();
    D.upd.iniciar();
    if (D.cobr && D.cobr.atualizarContador) D.cobr.atualizarContador();
    D.tema.sincronizar();
    D.iniciarRotas();
    return undefined;
  }

  iniciar();
})(window.CC);
