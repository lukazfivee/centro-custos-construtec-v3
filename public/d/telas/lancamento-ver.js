// Painel de leitura de um lancamento (busca global e atividades recentes do Inicio).
// Editar, anexar e estornar por aqui chegam na D2.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  D.lancCache = D.lancCache || new Map();

  // Situacao por extenso, com a data: "Pago em 22/09/2026" ou "A pagar · vence 05/10/2026".
  D.situacaoTexto = (l) => {
    const receita = l.tipo === 'receita';
    if (l.estorno_de) return 'Estorno';
    if (l.status_financeiro === 'liquidado') return `${receita ? 'Recebido' : 'Pago'}${l.data_liquidacao ? ` em ${D.data(l.data_liquidacao)}` : ''}`;
    const base = l.situacao === 'vencido' ? 'Vencido' : (receita ? 'A receber' : 'A pagar');
    return l.vencimento ? `${base} · vence ${D.data(l.vencimento)}` : base;
  };
  D.obraTexto = (l) => [l.centro_codigo, l.centro_nome].filter(Boolean).join(' · ');

  // Dados do lancamento em lista de definicoes (usado pela leitura e pelos paineis so de leitura).
  D.lancDados = function (l) {
    const linha = (rotulo, valor) => (valor ? `<dt>${esc(rotulo)}</dt><dd>${valor}</dd>` : '');
    const v = D.valorSinal(l);
    return `<dl class="dados">
        ${linha('Descrição', esc(l.descricao))}
        ${linha('Valor', `<b class="${v.entrada ? 'entrada' : ''}">${esc(v.texto)}</b>`)}
        ${linha('Situação', D.ui.situacao(l))}
        ${linha('Obra', esc(D.obraTexto(l)))}
        ${linha('Categoria', esc(l.categoria))}
        ${linha('Favorecido', esc(l.favorecido))}
        ${linha('Competência', esc(D.data(l.data)))}
        ${linha('Vencimento', esc(D.data(l.vencimento)))}
        ${linha('Pagamento', esc(D.data(l.data_liquidacao)))}
        ${linha('Forma', esc(l.forma_pagamento))}
        ${linha('Documento', esc(l.documento))}
        ${linha('Motivo do estorno', esc(l.motivo_estorno))}
        ${linha('Observação', esc(l.observacao))}
      </dl>`;
  };

  D.verLancamento = function (l, opcoes) {
    const o = opcoes || {};
    const corpo = l
      ? D.lancDados(l)
      : D.ui.vazio('receipt', 'Lançamento não encontrado.', 'Ele pode ter sido excluído.');
    return D.painel.abrir({
      icone: 'receipt', titulo: 'Lançamento', sub: l ? l.descricao : '',
      corpo,
      rodape: '<button type="button" class="btn btn-s" data-fechar>Fechar</button>',
      aoFechar: o.aoFechar,
    });
  };
})(window.CC);
