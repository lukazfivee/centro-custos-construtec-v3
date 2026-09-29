// Pecas comuns dos Cadastros (D5): nome do mes, interruptor "ativo" do painel e tratamento do erro do servidor.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const C = D.cad = D.cad || {};
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  C.nomeMes = (ym) => MESES[Number(String(ym).slice(5, 7)) - 1] || '';
  C.mesAbrev = (ym) => C.nomeMes(ym).slice(0, 3);
  C.maiuscula = (texto) => `${String(texto).charAt(0).toUpperCase()}${String(texto).slice(1)}`;
  C.somarMes = (ym, n) => {
    const total = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
  };
  C.pode = () => D.pode('cadastrar');
  C.plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

  // Interruptor com rotulo e ajuda (role="switch"). Use C.ligarTroca no corpo do painel.
  C.troca = ({ titulo, texto, ligado }) => `<button type="button" class="troca" role="switch" data-troca aria-checked="${ligado ? 'true' : 'false'}">
    <span><b>${esc(titulo)}</b><small>${esc(texto)}</small></span><span class="chave" aria-hidden="true"></span></button>`;
  C.ligarTroca = (corpo, ctl) => {
    const bt = CC.$('[data-troca]', corpo);
    bt.addEventListener('click', () => {
      bt.setAttribute('aria-checked', bt.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
      if (ctl) ctl.sujo = true;
    });
    return () => bt.getAttribute('aria-checked') === 'true';
  };

  // Mostra o erro do servidor no topo do painel; se o texto casa com um campo, marca o campo tambem.
  C.mostrarErro = (ctl, error, campoPorTexto) => {
    if (error.status === 0) { ctl.erro('Sem internet. Salvar precisa da conexão.'); return; }
    ctl.erro(error.message);
    const campo = campoPorTexto && campoPorTexto(String(error.message || ''));
    if (campo) ctl.errosCampos({ [campo]: error.message });
  };

  // Baixa um CSV da API com a sessao (o link direto nao levaria o token).
  C.baixarCsv = async (caminho, nomeArquivo) => {
    try {
      const resposta = await fetch(`/api${caminho}`, { headers: { Authorization: `Bearer ${CC.session.token()}` }, cache: 'no-store' });
      if (!resposta.ok) throw new Error('Não foi possível exportar agora.');
      const url = URL.createObjectURL(await resposta.blob());
      const a = D.el(`<a href="${url}" download="${esc(nomeArquivo)}"></a>`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (error) {
      CC.toast(error.message || 'Não foi possível exportar agora.', 'warning-circle');
    }
  };
})(window.CC);
