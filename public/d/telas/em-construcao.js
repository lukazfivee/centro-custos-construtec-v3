// Telas que ainda nao foram feitas: mostram o que vem, em que fase, e o link para o sistema atual.
// Tambem abre o lancamento (painel lateral) e a obra vindos da busca global.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;

  // chave: [fase, o que a tela vai ter]
  const PLANO = {
    lancamentos: ['D2', ['Lista com filtros, ordenação, paginação, total e CSV', 'Novo, editar, documentos, estorno e excluir no painel lateral', 'Cadeado e faixa nos meses fechados']],
    obras: ['D3', ['Carteira com indicadores, alertas e cartões', 'Detalhe com orçado × realizado, medições, Curva S e notas fiscais', 'Importação do orçamento e vínculo de gastos a insumos']],
    cobrancas: ['D4', ['Situação de cada obra em 4 passos: medição, NF, e-mail e pagamento', 'Acompanhamento no painel lateral', 'E-mail ao cliente com rascunho, autorização e envio']],
    categorias: ['D5', ['Tabela com tipo, cor, lançamentos e total do mês', 'Nova e editar no painel lateral', 'Nome repetido recusado']],
    fornecedores: ['D5', ['Tabela com CPF/CNPJ, contato e gasto do mês', 'Detalhe com os últimos lançamentos', 'Documento repetido recusado com o nome de quem já o tem']],
    recorrentes: ['D5', ['Modelos com frequência, dia e parcelas', 'Botão "Gerar lançamentos do mês" com prévia', 'Mês já gerado não duplica']],
    usuarios: ['D6', ['Seis papéis e matriz de permissões', 'Convite por e-mail e obras que cada pessoa vê', '"Ver o sistema como" para o administrador']],
    fechamento: ['D7', ['Checklist antes de fechar o mês', 'Fechar com pendências e reabrir com motivo', 'Meses fechados bloqueiam a edição']],
    historico: ['D7', ['Filtros por pessoa, tipo e período', 'Antes e depois de cada alteração, com a origem', 'Exportar CSV']],
    reports: ['D7', ['Lista com a entrega de cada report', 'Novo report com diagnóstico', 'Fila quando estiver sem internet']],
    config: ['D7', ['Perfil com foto e telefone', 'Senha que encerra as outras sessões', 'Backup, restauração e versão do sistema']],
  };

  function semAcesso(el) {
    el.innerHTML = `<div class="pagina">${D.ui.cabecalho({ titulo: 'Sem acesso' })}
      <div class="card">${D.ui.vazio('lock-simple', 'Seu papel não tem acesso a esta tela.', 'Fale com o administrador se precisar dela.')}</div></div>`;
  }

  function pagina(el, chave, extra) {
    const item = D.itemMenu(chave) || { grupo: '', rotulo: 'Tela não encontrada', antigo: null };
    const [fase, itens] = PLANO[chave] || ['', []];
    const antigo = item.antigo
      ? `<span>No sistema atual, esta tela fica no menu <b>${esc(item.antigo)}</b>.</span>`
      : '<span>No sistema atual, esta tela não tem acesso pelo menu.</span>';
    el.innerHTML = `<div class="pagina">
      ${D.ui.cabecalho({ grupo: item.grupo, titulo: (extra && extra.titulo) || item.rotulo, sub: (extra && extra.sub) || (fase ? `Chega no desktop novo na fase ${fase}` : '') })}
      ${D.ui.faixa('info', 'hammer', 'Esta tela ainda está em construção no desktop novo.')}
      <div class="card construcao">
        <div class="lista"><b>O que esta tela vai ter</b>${itens.map((t) => `<span class="item">${D.ic('check')}${esc(t)}</span>`).join('')}</div>
        <div class="lado"><span class="lbl">Enquanto isso</span>${antigo}
          <a class="btn btn-s" href="/">${D.ic('arrow-square-out')}Abrir o sistema atual</a></div>
      </div></div>`;
  }

  // Lancamento vindo da busca: mostra os dados no painel lateral (a edicao chega na D2).
  function abrirLancamento(id) {
    D.verLancamento(D.lancCache.get(String(id)), {
      aoFechar: () => { if (D.lerRota().query.id) history.replaceState(null, '', '#/lancamentos'); },
    });
  }

  async function obra(el, id, vivo) {
    el.innerHTML = `<div class="pagina">${D.ui.carregando('Abrindo a obra…')}</div>`;
    const { data } = await CC.api('/centros-custo');
    if (!vivo()) return;
    const o = (Array.isArray(data) ? data : []).find((x) => String(x.id) === String(id));
    if (!o) {
      el.innerHTML = `<div class="pagina">${D.ui.cabecalho({ grupo: 'Operação', titulo: 'Obra não encontrada' })}<div class="card">${D.ui.vazio('buildings', 'Esta obra não existe ou foi removida.')}</div></div>`;
      return;
    }
    pagina(el, 'obras', { titulo: o.nome, sub: [o.codigo, o.cliente].filter(Boolean).join(' · ') });
  }

  const render = async (el, rota, vivo) => {
    if (!D.itemMenu(rota.nome)) {
      el.innerHTML = `<div class="pagina"><div class="card">${D.ui.vazio('compass', 'Esta tela não existe.', 'Use o menu ao lado para escolher uma tela.')}</div></div>`;
      return undefined;
    }
    if (!D.podeTela(rota.nome)) return semAcesso(el);
    if (rota.nome === 'obras' && rota.id) return obra(el, rota.id, vivo);
    pagina(el, rota.nome);
    if (rota.nome === 'lancamentos' && rota.query.id) abrirLancamento(rota.query.id);
    return undefined;
  };

  D.tela('em-construcao', { render });
  D.telaEmConstrucao = render;
  Object.keys(PLANO).forEach((chave) => { if (!D.temTela(chave)) D.tela(chave, { render }); });
})(window.CC);
