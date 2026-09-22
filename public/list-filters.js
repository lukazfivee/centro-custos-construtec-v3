(function (root) {
  const fold = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const text = (item, keys) => keys.map((key) => fold(item[key])).join(' ');
  const moneyCents = (value) => Math.round(Number(String(value ?? 0).replace(',', '.')) * 100);

  function filterTransactions(items, filters = {}) {
    const search = fold(filters.busca);
    return items.filter((item) => {
      if (search && !text(item, ['descricao', 'favorecido', 'documento', 'observacao', 'categoria', 'centro_nome']).includes(search)) return false;
      if (filters.tipo && item.tipo !== filters.tipo) return false;
      if (filters.situacao && (item.situacao || item.status_financeiro) !== filters.situacao) return false;
      if (filters.centroId && String(item.cost_center_id ?? item.centro_id) !== String(filters.centroId)) return false;
      if (filters.categoriaId && String(item.category_id ?? item.categoria_id) !== String(filters.categoriaId)) return false;
      if (filters.dataInicio && String(item.data).slice(0, 10) < filters.dataInicio) return false;
      if (filters.dataFim && String(item.data).slice(0, 10) > filters.dataFim) return false;
      return true;
    });
  }

  function filterCenters(items, filters = {}) {
    const search = fold(filters.busca);
    return items.filter((item) => {
      if (search && !text(item, ['codigo', 'nome', 'cliente', 'contrato', 'responsavel', 'descricao']).includes(search)) return false;
      if (!filters.status) return true;
      const status = !item.ativo ? 'inativo' : item.situacao === 'execucao' ? 'em-aberto' : ['pausado', 'concluido'].includes(item.situacao) ? item.situacao : 'ativo';
      return status === filters.status;
    });
  }

  function filterCategories(items, filters = {}) {
    const search = fold(filters.busca);
    return items.filter((item) => (!search || text(item, ['nome']).includes(search)) && (!filters.tipo || item.tipo === filters.tipo));
  }

  function filterSuppliers(items, filters = {}) {
    const search = fold(filters.busca);
    return items.filter((item) => (!search || text(item, ['nome', 'documento', 'contato', 'email', 'telefone']).includes(search)) && (!filters.status || (item.ativo ? 'ativo' : 'inativo') === filters.status));
  }

  function sumTransactionsCents(items) {
    return items.reduce((sum, item) => {
      if (item.situacao === 'cancelado' || item.status_financeiro === 'cancelado') return sum;
      const sign = Number(item.sinal_contabil ?? 1) || 1;
      return sum + sign * (item.tipo === 'receita' ? moneyCents(item.valor) : -moneyCents(item.valor));
    }, 0);
  }

  root.ListFilters = { fold, filterTransactions, filterCenters, filterCategories, filterSuppliers, sumTransactionsCents, moneyCents };
})(typeof window === 'object' ? window : globalThis);
