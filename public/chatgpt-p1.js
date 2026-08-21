(() => {
  if (window.__ccP1Loaded) return;
  window.__ccP1Loaded = true;

  const STORAGE_KEY = 'cc_p1_lista_lancamentos';
  const defaultState = { pagina:1, limite:50, ordenarPor:'data', ordem:'desc' };
  let savedState = {};
  try { savedState = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch {}

  const state = {
    ...defaultState,
    ...savedState,
    pagina:Number(savedState.pagina) > 0 ? Number(savedState.pagina) : 1,
    limite:[25,50,100,200].includes(Number(savedState.limite)) ? Number(savedState.limite) : 50,
    requestSequence:0,
    meta:null,
  };

  const filterSelectors = [
    '#filtro-tipo','#filtro-situacao','#filtro-centro','#filtro-categoria',
    '#filtro-inicio','#filtro-fim',
  ];

  function persistState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      pagina:state.pagina,
      limite:state.limite,
      ordenarPor:state.ordenarPor,
      ordem:state.ordem,
    }));
  }

  function element(id) { return document.getElementById(id); }

  function ensureUi() {
    const view = element('view-lancamentos');
    if (!view || element('cc-pagination')) return;

    const tableCard = view.querySelector('.table-card');
    const tableMeta = view.querySelector('.table-meta');
    const tableScroll = view.querySelector('.table-scroll');
    const exportButton = element('btn-exportar-relatorio');
    if (!tableCard || !tableMeta || !tableScroll || !exportButton) return;

    const tools = document.createElement('div');
    tools.className = 'cc-list-tools';
    tools.innerHTML = `
      <label>Ordenar
        <select id="cc-sort-field" aria-label="Ordenar lançamentos por">
          <option value="data">Competência</option>
          <option value="vencimento">Vencimento</option>
          <option value="valor">Valor</option>
          <option value="criado">Inclusão</option>
          <option value="atualizado">Última alteração</option>
        </select>
      </label>
      <button id="cc-sort-direction" class="cc-sort-direction" type="button" title="Alternar sentido da ordenação" aria-label="Alternar sentido da ordenação">↓</button>
      <button id="cc-clear-filters" class="text-btn" type="button">Limpar filtros</button>
    `;
    tools.appendChild(exportButton);
    tableMeta.appendChild(tools);

    const pagination = document.createElement('div');
    pagination.id = 'cc-pagination';
    pagination.className = 'cc-pagination';
    pagination.setAttribute('aria-live','polite');
    pagination.innerHTML = `
      <div id="cc-pagination-summary" class="cc-pagination-summary">Nenhum lançamento carregado.</div>
      <div class="cc-pagination-controls">
        <label>Por página
          <select id="cc-page-size" aria-label="Quantidade de lançamentos por página">
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="200">200</option>
          </select>
        </label>
        <button id="cc-first-page" class="cc-page-button" type="button" title="Primeira página" aria-label="Primeira página">«</button>
        <button id="cc-prev-page" class="cc-page-button" type="button" title="Página anterior" aria-label="Página anterior">‹</button>
        <span id="cc-page-label" class="cc-page-label">Página 1</span>
        <button id="cc-next-page" class="cc-page-button" type="button" title="Próxima página" aria-label="Próxima página">›</button>
        <button id="cc-last-page" class="cc-page-button" type="button" title="Última página" aria-label="Última página">»</button>
      </div>
    `;
    tableCard.appendChild(pagination);

    element('cc-sort-field').value = state.ordenarPor;
    element('cc-page-size').value = String(state.limite);
    updateDirectionButton();

    element('cc-sort-field').addEventListener('change', () => {
      state.ordenarPor = element('cc-sort-field').value;
      state.pagina = 1;
      persistState();
      loadTransactions().catch((error) => toast(error.message,true));
    });

    element('cc-sort-direction').addEventListener('click', () => {
      state.ordem = state.ordem === 'asc' ? 'desc' : 'asc';
      state.pagina = 1;
      updateDirectionButton();
      persistState();
      loadTransactions().catch((error) => toast(error.message,true));
    });

    element('cc-page-size').addEventListener('change', () => {
      state.limite = Number(element('cc-page-size').value) || 50;
      state.pagina = 1;
      persistState();
      loadTransactions().catch((error) => toast(error.message,true));
    });

    element('cc-first-page').addEventListener('click', () => goToPage(1));
    element('cc-prev-page').addEventListener('click', () => goToPage(state.pagina - 1));
    element('cc-next-page').addEventListener('click', () => goToPage(state.pagina + 1));
    element('cc-last-page').addEventListener('click', () => goToPage(state.meta?.totalPaginas || 1));

    element('cc-clear-filters').addEventListener('click', () => {
      const search = element('filtro-busca');
      if (search) search.value = '';
      filterSelectors.forEach((selector) => {
        const field = document.querySelector(selector);
        if (field) field.value = '';
      });
      state.pagina = 1;
      persistState();
      loadTransactions().catch((error) => toast(error.message,true));
    });

    const filterButton = element('btn-filtrar');
    if (filterButton) {
      filterButton.addEventListener('click', () => {
        state.pagina = 1;
        persistState();
      }, true);
    }

    const search = element('filtro-busca');
    if (search) {
      search.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          state.pagina = 1;
          persistState();
        }
      }, true);
      let debounceTimer;
      search.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          state.pagina = 1;
          persistState();
          loadTransactions().catch((error) => toast(error.message,true));
        }, 450);
      });
    }

    filterSelectors.forEach((selector) => {
      const field = document.querySelector(selector);
      if (!field) return;
      field.addEventListener('change', () => {
        state.pagina = 1;
        persistState();
        loadTransactions().catch((error) => toast(error.message,true));
      });
    });

    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        const currentView = element('view-lancamentos');
        if (!currentView || currentView.classList.contains('oculto')) return;
        event.preventDefault();
        element('filtro-busca')?.focus();
      }
    });
  }

  function updateDirectionButton() {
    const button = element('cc-sort-direction');
    if (!button) return;
    const ascending = state.ordem === 'asc';
    button.textContent = ascending ? '↑' : '↓';
    button.title = ascending ? 'Crescente — clique para inverter' : 'Decrescente — clique para inverter';
    button.setAttribute('aria-label',button.title);
  }

  function goToPage(page) {
    const totalPages = Math.max(1,Number(state.meta?.totalPaginas || 1));
    const target = Math.min(totalPages,Math.max(1,Number(page) || 1));
    if (target === state.pagina) return;
    state.pagina = target;
    persistState();
    loadTransactions().catch((error) => toast(error.message,true));
  }

  function setBusy(busy) {
    const card = document.querySelector('#view-lancamentos .table-card');
    if (card) card.setAttribute('aria-busy',busy ? 'true' : 'false');
    if (busy) {
      const tbody = element('tabela-lancamentos');
      if (tbody) tbody.innerHTML = '<tr class="cc-loading-row"><td colspan="8"><span class="cc-loading-indicator">Carregando lançamentos</span></td></tr>';
    }
  }

  function renderRows(items) {
    const tbody = element('tabela-lancamentos');
    if (!tbody) return;
    tbody.innerHTML = items.length ? items.map((item) => `<tr>
      <td>${dateBr(item.data)}</td><td>${dateBr(item.vencimento)}</td>
      <td><span class="pill ${esc(item.situacao)}">${esc(financialLabel(item))}</span></td>
      <td><span class="pill ${esc(item.tipo)}">${esc(item.tipo)}</span></td>
      <td><strong>${esc(item.centro_codigo)}</strong><br>${esc(item.centro_nome)}</td>
      <td><strong>${esc(item.descricao)}</strong><br><span class="muted">${esc(item.categoria)}${item.favorecido?` · ${esc(item.favorecido)}`:''}</span></td>
      <td class="money" style="color:var(--${item.tipo==='receita'?'green':'red'})">${item.tipo==='receita'?'+':'-'} ${money(item.valor)}</td>
      <td><div class="row-actions"><button data-edit-transaction="${item.id}">Editar</button>${['admin','gestor'].includes(usuario.role)?`<button class="danger" data-delete-transaction="${item.id}">Excluir</button>`:''}</div></td>
    </tr>`).join('') : '<tr><td colspan="8"><div class="empty">Nenhum lançamento encontrado.</div></td></tr>';

    document.querySelectorAll('[data-edit-transaction]').forEach((button) => {
      button.addEventListener('click', () => openTransaction(lancamentos.find((item) => item.id === Number(button.dataset.editTransaction))));
    });
    document.querySelectorAll('[data-delete-transaction]').forEach((button) => {
      button.addEventListener('click', () => deleteTransaction(Number(button.dataset.deleteTransaction)));
    });
  }

  function updatePagination(meta, itemCount) {
    state.meta = meta;
    state.pagina = Number(meta.pagina || state.pagina);
    state.limite = Number(meta.limite || state.limite);
    persistState();

    const total = Number(meta.total || 0);
    const first = total ? ((state.pagina - 1) * state.limite) + 1 : 0;
    const last = total ? first + itemCount - 1 : 0;
    const totalPages = Number(meta.totalPaginas || 0);

    const totalLabel = element('lancamentos-total');
    if (totalLabel) totalLabel.textContent = `${total} lançamento(s)`;

    const summary = element('cc-pagination-summary');
    if (summary) {
      summary.innerHTML = total
        ? `Exibindo <strong>${first}–${last}</strong> de <strong>${total}</strong> lançamentos`
        : 'Nenhum lançamento encontrado com os filtros atuais.';
    }

    const pageLabel = element('cc-page-label');
    if (pageLabel) pageLabel.textContent = totalPages ? `Página ${state.pagina} de ${totalPages}` : 'Página 0 de 0';

    const firstButton = element('cc-first-page');
    const previousButton = element('cc-prev-page');
    const nextButton = element('cc-next-page');
    const lastButton = element('cc-last-page');
    if (firstButton) firstButton.disabled = !meta.temAnterior;
    if (previousButton) previousButton.disabled = !meta.temAnterior;
    if (nextButton) nextButton.disabled = !meta.temProxima;
    if (lastButton) lastButton.disabled = !meta.temProxima;
  }

  async function loadPaginatedTransactions() {
    ensureUi();
    const requestId = ++state.requestSequence;
    setBusy(true);
    try {
      const params = transactionParams();
      params.set('paginar','1');
      params.set('pagina',String(state.pagina));
      params.set('limite',String(state.limite));
      params.set('ordenarPor',state.ordenarPor);
      params.set('ordem',state.ordem);

      const response = await api(`/lancamentos?${params}`);
      if (requestId !== state.requestSequence) return;

      const items = Array.isArray(response) ? response : (response.itens || []);
      const meta = Array.isArray(response)
        ? { pagina:1,limite:items.length,total:items.length,totalPaginas:items.length?1:0,temAnterior:false,temProxima:false }
        : response.paginacao;

      if (!items.length && Number(meta?.total || 0) > 0 && state.pagina > 1) {
        state.pagina = Math.max(1,Number(meta.totalPaginas || state.pagina - 1));
        persistState();
        return loadPaginatedTransactions();
      }

      lancamentos = items;
      renderRows(items);
      updatePagination(meta,items.length);
    } finally {
      if (requestId === state.requestSequence) setBusy(false);
    }
  }

  ensureUi();
  loadTransactions = loadPaginatedTransactions;
})();
