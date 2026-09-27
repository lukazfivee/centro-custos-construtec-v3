// Ferramentas do assistente (function calling do Gemini). Rodam no celular com a
// sessao de quem pergunta, pelas mesmas rotas das telas: a IA so enxerga o que a
// pessoa ja pode ver. Cada resposta e resumida antes de ir para o modelo.
(function (CC) {
  const IA = CC.ia = CC.ia || {};
  const inApp = () => /SuiteConstrutec\//.test(navigator.userAgent) || new URLSearchParams(location.search).has('app');
  const n = (v) => (Number.isFinite(Number(v)) ? CC.cents(Number(v)) : null);
  const pct = (part, whole) => (Number(whole) > 0 ? Math.round((Number(part) / Number(whole)) * 100) : null);
  const plain = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // Destinos que a IA pode abrir. Cada um devolve a acao feita depois da resposta.
  const TELAS = {
    inicio: () => () => CC.go('home'),
    obras: () => () => CC.go('obras'),
    obra: (a) => (a.obra_id > 0 ? () => CC.go('obra', { id: Number(a.obra_id) }) : 'Informe obra_id (use listar_obras).'),
    nova_despesa: (a) => () => CC.go('lancar', { novo: true, obraId: Number(a.obra_id) || undefined, from: ['home'] }),
    lancamentos: () => () => CC.go('lancamentos'),
    lancamentos_em_aberto: () => () => CC.go('lancamentos', { situacao: 'pendente' }),
    lancamentos_vencidos: () => () => CC.go('lancamentos', { situacao: 'vencido' }),
    notificacoes: () => () => CC.go('avisos'),
    menu: () => () => CC.go('menu'),
    perfil: () => () => CC.go('perfil'),
    pedidos_acesso: () => (CC.isAdmin && CC.isAdmin() ? () => CC.go('pedidos') : 'Só administradores veem os pedidos de acesso.'),
    seguranca: () => (inApp() ? () => { location.href = 'suite://seguranca'; } : 'Segurança (PIN e digital) só existe no aplicativo.'),
    orcamentos: () => () => { location.href = CC.suite.orcLink(); },
    proposta: (a) => (a.proposta_id ? () => { location.href = CC.suite.orcLink(String(a.proposta_id)); } : 'Informe proposta_id (use listar_propostas).'),
    versao_completa: () => () => { location.href = '/'; },
  };

  const NOMES = { inicio: 'Início', obras: 'Obras', obra: 'a obra', nova_despesa: 'Nova despesa', lancamentos: 'Lançamentos', lancamentos_em_aberto: 'Lançamentos em aberto',
    lancamentos_vencidos: 'Lançamentos vencidos', notificacoes: 'Notificações', menu: 'Menu', perfil: 'Meu perfil', pedidos_acesso: 'Pedidos de acesso',
    seguranca: 'Segurança', orcamentos: 'Orçamentos', proposta: 'a proposta', versao_completa: 'Versão completa' };

  function obraResumo(c) {
    const orcado = Number(c.orcamento) || 0, gasto = Number(c.total_comprometido) || 0;
    return {
      id: c.id, codigo: c.codigo, nome: c.nome, cliente: c.cliente || null, situacao: c.situacao, ativa: c.ativo !== false,
      valor_contrato: n(c.valor_contrato), custo_orcado: n(orcado), gasto_comprometido: n(gasto), pct_do_orcado: pct(gasto, orcado),
      acima_do_orcado: orcado > 0 && gasto > orcado, gasto_no_mes: n(c.total_comprometido_mes), pago: n(c.total_despesas), recebido: n(c.total_receitas),
    };
  }
  const lanc = (t) => ({
    id: t.id, obra: t.centro_nome || undefined, tipo: t.tipo, descricao: t.descricao, favorecido: t.favorecido || null, categoria: t.categoria || null,
    valor: n(t.valor), data: t.data, vencimento: t.vencimento || null, situacao: t.situacao === 'vencido' ? 'vencido' : t.status_financeiro,
  });
  const sum = (list) => n(list.reduce((s, t) => s + (Number(t.valor) || 0), 0));

  const RUN = {
    async abrir_tela(a) {
      const make = TELAS[a.tela];
      if (!make) return { erro: 'Tela desconhecida.' };
      const action = make(a);
      if (typeof action === 'string') return { erro: action };
      IA.pendingNav = action;
      IA.pendingLabel = NOMES[a.tela] || 'a tela';
      return { ok: true, aviso: 'A tela abre quando você terminar de responder.' };
    },
    async listar_obras(a) {
      const list = (await CC.api(`/centros-custo?mes=${CC.month()}`)).data || [];
      const term = plain(a.busca).trim();
      const found = list.filter((c) => !term || plain(`${c.codigo} ${c.nome} ${c.cliente || ''}`).includes(term)).map(obraResumo);
      return { total: found.length, obras: found.slice(0, 40) };
    },
    async ver_obra(a) {
      const { centro: c, lancamentos: list = [] } = (await CC.api(`/centros-custo/${Number(a.obra_id)}/detalhes?mes=${CC.month()}`)).data;
      const vencidas = list.filter((t) => t.situacao === 'vencido');
      const pagar = list.filter((t) => t.status_financeiro === 'pendente' && t.tipo === 'despesa' && t.situacao !== 'vencido');
      const receber = list.filter((t) => t.status_financeiro === 'pendente' && t.tipo === 'receita');
      return {
        ...obraResumo(c), responsavel: c.responsavel || null, contrato: c.contrato || null, inicio: c.data_inicio || null, fim: c.data_fim || null,
        resultado: n(Number(c.total_receitas) - Number(c.total_despesas)), proposta_origem: c.proposta_origem || null,
        contas_vencidas: { quantidade: vencidas.length, total: sum(vencidas) }, contas_a_pagar: { quantidade: pagar.length, total: sum(pagar) },
        a_receber: { quantidade: receber.length, total: sum(receber) }, lancamentos_do_mes: list.length, ultimos_lancamentos: list.slice(0, 12).map(lanc),
      };
    },
    async orcado_realizado(a) {
      const d = (await CC.api(`/centros-custo/${Number(a.obra_id)}/orcado-realizado`)).data || {};
      if (!d.hasBudget) return { sem_orcamento: true, aviso: 'Esta obra não tem orçamento aprovado vindo do Orçamentos.' };
      const groups = {};
      for (const i of d.items || []) {
        const g = groups[i.category || 'Sem categoria'] = groups[i.category || 'Sem categoria'] || { categoria: i.category || 'Sem categoria', orcado: 0, realizado: 0 };
        g.orcado += Number(i.budgetedCost) || 0; g.realizado += Number(i.realizedCost) || 0;
      }
      const s = d.summary || {};
      return {
        proposta: d.contract && d.contract.number, versao: d.contract && d.contract.baselineVersion, valor_contrato: n(s.contractValue),
        custo_base_orcado: n(s.baseCost), realizado: n(s.realizedCost), realizado_sem_item: n(s.realizedUnmappedCost), saldo: n(s.balance),
        acima_do_orcado: Boolean(s.isOverBudget), pct_consumido: n(s.burnRatePercent), horas: d.laborHours || null,
        por_categoria: Object.values(groups).map((g) => ({ ...g, orcado: n(g.orcado), realizado: n(g.realizado), saldo: n(g.orcado - g.realizado) })),
        itens_acima_do_orcado: (d.items || []).filter((i) => i.isOverBudget).sort((x, y) => Number(x.balance) - Number(y.balance)).slice(0, 10)
          .map((i) => ({ item: `${i.code || ''} ${i.name || ''}`.trim(), orcado: n(i.budgetedCost), realizado: n(i.realizedCost), diferenca_pct: n(i.variancePercent) })),
        lancamentos_sem_item: d.unmapped ? d.unmapped.count : 0,
      };
    },
    async resumo_geral(a) {
      const mes = /^\d{4}-\d{2}$/.test(a.mes || '') ? a.mes : CC.month();
      const d = (await CC.api(`/dashboard/resumo?mes=${mes}`)).data;
      return {
        mes, receitas: n(d.receitas), despesas: n(d.despesas), saldo: n(d.saldo), custo_orcado: n(d.orcamento), comprometido: n(d.comprometido),
        saldo_do_orcado: n(d.saldoOrcamento), a_receber: n(d.aReceber), a_pagar: n(d.aPagar), vencidos: n(d.vencidos), qtd_vencidos: d.qtdVencidos,
        por_obra: (d.porCentro || []).slice(0, 25).map((c) => ({ id: c.id, nome: c.nome, custo_orcado: n(c.orcamento), comprometido: n(c.comprometido) })),
        por_categoria: (d.porCategoria || []).slice(0, 12).map((c) => ({ categoria: c.nome, total: n(c.total) })),
      };
    },
    async buscar_lancamentos(a) {
      const q = new URLSearchParams({ paginar: '1', limite: '25' });
      if (a.obra_id) q.set('centroId', String(Number(a.obra_id)));
      if (a.busca) q.set('busca', String(a.busca).slice(0, 60));
      if (['pendente', 'vencido', 'liquidado'].includes(a.situacao)) q.set('situacao', a.situacao);
      if (['despesa', 'receita'].includes(a.tipo)) q.set('tipo', a.tipo);
      if (/^\d{4}-\d{2}$/.test(a.mes || '')) q.set('mes', a.mes);
      else if (!a.busca) q.set('mes', CC.month());
      const d = (await CC.api(`/lancamentos?${q}`)).data;
      const rows = d.itens || d || [];
      return { total: d.paginacao && d.paginacao.total != null ? d.paginacao.total : rows.length, mostrando: rows.length, soma_mostrados: sum(rows), lancamentos: rows.map(lanc) };
    },
    async listar_categorias() {
      const list = (await CC.api('/categorias')).data || [];
      return { categorias: list.filter((c) => c.ativo !== false).map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo })) };
    },
    async listar_propostas(a) {
      const q = new URLSearchParams();
      if (a.busca) q.set('busca', String(a.busca));
      if (a.status) q.set('status', String(a.status));
      return (await CC.api(`/assistente/orcamentos/propostas?${q}`)).data;
    },
    async ver_proposta(a) {
      return (await CC.api(`/assistente/orcamentos/propostas/${encodeURIComponent(String(a.proposta_id || ''))}`)).data;
    },
    async preparar_reporte(a) {
      if (!IA.showReport) return { erro: 'Relato indisponível agora.' };
      IA.showReport(a);
      return { ok: true, situacao: 'Cartão mostrado. A pessoa confere, ajusta e toca em Enviar; você não envia nada.' };
    },
  };

  // Executa uma chamada do modelo; erros viram texto para a IA explicar.
  IA.run = async function (call) {
    const fn = RUN[call.name];
    if (!fn) return { erro: 'Ferramenta desconhecida.' };
    try {
      const out = await fn(call.args || {});
      const text = JSON.stringify(out);
      return text.length > 14000 ? { aviso: 'Resultado cortado por tamanho.', parcial: text.slice(0, 14000) } : out;
    } catch (error) {
      return { erro: error.status === 0 ? 'Sem internet.' : (error.message || 'Falhou.') };
    }
  };

  // Declaracoes no formato do Firebase AI Logic (S = Schema do SDK).
  IA.declarations = (S) => [{ functionDeclarations: [
    { name: 'abrir_tela', description: 'Abre uma tela do app para a pessoa. Use quando ela pedir para ir, abrir ou ver uma parte do app.',
      parameters: S.object({ properties: {
        tela: S.enumString({ enum: Object.keys(TELAS), description: 'obra e proposta pedem o id; nova_despesa aceita obra_id; orcamentos e proposta abrem o app Orçamentos.' }),
        obra_id: S.integer({ description: 'id da obra (centro de custo)' }), proposta_id: S.string({ description: 'id da proposta no Orçamentos' }),
      }, optionalProperties: ['obra_id', 'proposta_id'] }) },
    { name: 'listar_obras', description: 'Lista as obras (centros de custo) com orçado, gasto comprometido, % do orçado, pago e recebido. Use para achar o id pelo nome.',
      parameters: S.object({ properties: { busca: S.string({ description: 'parte do nome, código ou cliente' }) }, optionalProperties: ['busca'] }) },
    { name: 'ver_obra', description: 'Detalhe de uma obra: resultado, contas vencidas, a pagar, a receber, proposta de origem e últimos lançamentos do mês.',
      parameters: S.object({ properties: { obra_id: S.integer({}) } }) },
    { name: 'orcado_realizado', description: 'Orçado x realizado da obra pelo orçamento aprovado no Orçamentos: por categoria e itens acima do orçado.',
      parameters: S.object({ properties: { obra_id: S.integer({}) } }) },
    { name: 'resumo_geral', description: 'Resumo financeiro de todas as obras num mês: receitas, despesas, a pagar, vencidos, por obra e por categoria.',
      parameters: S.object({ properties: { mes: S.string({ description: 'AAAA-MM; padrão o mês atual' }) }, optionalProperties: ['mes'] }) },
    { name: 'buscar_lancamentos', description: 'Procura lançamentos (despesas e receitas). Sem mês e sem busca, usa o mês atual. Mostra até 25.',
      parameters: S.object({ properties: {
        obra_id: S.integer({}), busca: S.string({ description: 'texto na descrição, favorecido ou documento' }),
        situacao: S.enumString({ enum: ['pendente', 'vencido', 'liquidado'], description: 'liquidado = pago ou recebido' }), tipo: S.enumString({ enum: ['despesa', 'receita'] }), mes: S.string({ description: 'AAAA-MM' }),
      }, optionalProperties: ['obra_id', 'busca', 'situacao', 'tipo', 'mes'] }) },
    { name: 'listar_categorias', description: 'Categorias de despesa e receita usadas nos lançamentos.', parameters: S.object({ properties: {} }) },
    { name: 'listar_propostas', description: 'Propostas (orçamentos comerciais) do app Orçamentos: número, cliente, obra, status e valor de venda.',
      parameters: S.object({ properties: {
        busca: S.string({ description: 'número, cliente ou obra' }), status: S.enumString({ enum: ['rascunho', 'em revisão', 'enviada', 'aprovada', 'recusada'] }),
      }, optionalProperties: ['busca', 'status'] }) },
    { name: 'ver_proposta', description: 'Detalhe de uma proposta: totais (custo, venda, margem, BDI, impostos), principais itens e mão de obra.',
      parameters: S.object({ properties: { proposta_id: S.string({}) } }) },
    { name: 'preparar_reporte', description: 'Mostra um cartão de relato de bug, melhoria ou sugestão já preenchido para a pessoa conferir e enviar. Chame só quando já souber o que aconteceu.',
      parameters: S.object({ properties: {
        titulo: S.string({ description: 'curto, 3 a 120 caracteres' }), descricao: S.string({ description: 'o que a pessoa fez, o que esperava, o que aconteceu, em que tela' }),
        tipo: S.enumString({ enum: ['bug', 'melhoria', 'sugestao'] }), severidade: S.enumString({ enum: ['baixa', 'media', 'alta', 'critica'] }),
      } }) },
  ] }];
})(window.CC = window.CC || {});
