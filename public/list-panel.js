/* Listas paginadas reutilizáveis do Centro de Custos.
   Cobre categorias, fornecedores, centros de custo, histórico, recorrentes,
   usuários e medições, com:
   - paginação (offset/limit) + tamanho de página configurável;
   - estado de loading, vazio, erro e retry;
   - preservação de filtros, busca e página (sessionStorage);
   - labels acessíveis e navegação por teclado;
   - resposta eficiente do backend (paginar=1, X-Total-Count).
   Complementa chatgpt-p1.js (lançamentos), reaproveitado o mesmo contrato. */
(() => {
  if (window.__ccListPanelLoaded) return;
  window.__ccListPanelLoaded = true;

  const PAGE_SIZES = [25, 50, 100, 200];
  const STORAGE_PREFIX = 'cc_lista_v1_';
  const state = new Map(); // nome → { pagina, limite, filtros }

  const el = (selector) => document.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[c]));
  const toArray = (response) => (Array.isArray(response) ? response : (response?.itens || []));
  const metaOf = (response, items) => (Array.isArray(response)
    ? { pagina: 1, limite: items.length, total: items.length, totalPaginas: items.length ? 1 : 0, temAnterior: false, temProxima: false }
    : (response?.paginacao || { pagina: 1, limite: items.length, total: items.length, totalPaginas: 1, temAnterior: false, temProxima: false }));

  function loadState(name, defaults = {}) {
    if (state.has(name)) return state.get(name);
    let saved = {};
    try { saved = JSON.parse(sessionStorage.getItem(STORAGE_PREFIX + name) || '{}'); } catch { saved = {}; }
    const value = {
      pagina: Number(saved.pagina) > 0 ? Number(saved.pagina) : 1,
      limite: PAGE_SIZES.includes(Number(saved.limite)) ? Number(saved.limite) : (defaults.limite || 50),
      filtros: saved.filtros || {},
    };
    state.set(name, value);
    return value;
  }

  function persist(name) {
    const value = state.get(name);
    if (!value) return;
    try { sessionStorage.setItem(STORAGE_PREFIX + name, JSON.stringify(value)); } catch { /* indisponível */ }
  }

  function stateMarkup(kind, message, extra = '') {
    if (kind === 'error') {
      return `<div class="cc-list-state cc-list-error" role="alert">
        <span>${esc(message)}</span>
        <button type="button" class="cc-list-retry" data-cc-list-retry>${esc(extra || 'Tentar novamente')}</button>
      </div>`;
    }
    if (kind === 'loading') return `<div class="cc-list-state" role="status">Carregando…</div>`;
    return `<div class="cc-list-state">${esc(message)}</div>`;
  }

  // Renderiza um painel paginado dentro de um contêiner de tabela (tbody) ou
  // de cards (div). `spec.render(itens)` produz o HTML das linhas/cards.
  const registries = [];

  // Aceita register({ name, ...spec }) ou register(name, spec).
  function register(nameOrSpec, maybeSpec) {
    const spec = maybeSpec ? { ...maybeSpec, name: nameOrSpec } : nameOrSpec;
    if (!spec || !spec.name || !spec.loaderName) return;
    registries.push(spec);
  }

  // Resolve onde a barra de ferramentas deve morar: prefere o host informado,
  // depois o .table-card da view e, por fim, um container genérico.
  function resolveToolbarHost(spec) {
    if (typeof spec.toolbarHost === 'function') {
      const explicit = spec.toolbarHost();
      if (explicit) return explicit;
    }
    const container = spec.container();
    const card = container?.closest?.('.table-card');
    if (card) return card;
    return spec.paginationHost ? spec.paginationHost() : null;
  }

  function ensureToolbar(spec) {
    const hostEl = resolveToolbarHost(spec);
    if (!hostEl) return null;
    // Evita duplicar: procura em qualquer ancestral do host.
    const existing = document.querySelector(`[data-cc-list-toolbar="${spec.name}"]`);
    if (existing) return existing;
    let bar = document.createElement('div');
    bar.className = 'cc-list-toolbar';
    bar.dataset.ccListToolbar = spec.name;
    bar.innerHTML = `
      <div class="cc-list-toolbar-group">
        ${spec.search === false ? '' : `<label for="cc-search-${spec.name}">Buscar
          <input id="cc-search-${spec.name}" type="search" data-cc-list-search placeholder="${esc(spec.searchPlaceholder || 'Filtrar registros')}" aria-label="${esc(spec.searchLabel || 'Buscar nesta lista')}"></label>`}
      </div>
      <div class="cc-list-toolbar-group">
        <label for="cc-size-${spec.name}">Por página
          <select id="cc-size-${spec.name}" data-cc-list-size aria-label="Registros por página — ${esc(spec.title)}">
            ${PAGE_SIZES.map((size) => `<option value="${size}">${size}</option>`).join('')}
          </select>
        </label>
      </div>`;
    // Insere antes do scroll da tabela quando existir, senão no topo do host.
    const scroll = hostEl.querySelector('.table-scroll');
    if (scroll) hostEl.insertBefore(bar, scroll);
    else hostEl.prepend(bar);

    const search = bar.querySelector('[data-cc-list-search]');
    if (search) {
      let timer;
      search.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const value = state.get(spec.name);
          value.filtros = { ...value.filtros, busca: search.value.trim() };
          value.pagina = 1;
          persist(spec.name);
          spec.load().catch(() => {});
        }, 350);
      });
    }
    bar.querySelector('[data-cc-list-size]').addEventListener('change', (event) => {
      const value = state.get(spec.name);
      value.limite = Number(event.target.value) || 50;
      value.pagina = 1;
      persist(spec.name);
      spec.load().catch(() => {});
    });
    return bar;
  }

  function ensurePagination(spec) {
    if (!spec.paginationHost) return null;
    const host = spec.paginationHost();
    if (!host) return null;
    let bar = host.querySelector(`[data-cc-list-pagination="${spec.name}"]`);
    if (bar) return bar;
    bar = document.createElement('div');
    bar.className = 'cc-pagination-bar';
    bar.dataset.ccListPagination = spec.name;
    bar.innerHTML = `
      <div class="cc-pagination-summary" role="status" aria-live="polite" data-cc-list-summary></div>
      <div class="cc-pagination-controls" role="group" aria-label="Navegação de páginas — ${esc(spec.title)}">
        <button type="button" class="cc-page-button" data-cc-page="first" aria-label="Primeira página" title="Primeira página">«</button>
        <button type="button" class="cc-page-button" data-cc-page="prev" aria-label="Página anterior" title="Página anterior">‹</button>
        <span class="cc-page-label" data-cc-page-label aria-live="polite">Página 1</span>
        <button type="button" class="cc-page-button" data-cc-page="next" aria-label="Próxima página" title="Próxima página">›</button>
        <button type="button" class="cc-page-button" data-cc-page="last" aria-label="Última página" title="Última página">»</button>
      </div>`;
    host.appendChild(bar);

    const go = (target) => {
      const value = state.get(spec.name);
      const totalPages = Math.max(1, Number(value.meta?.totalPaginas || 1));
      value.pagina = Math.min(totalPages, Math.max(1, Number(target) || 1));
      persist(spec.name);
      spec.load().catch(() => {});
    };
    bar.querySelector('[data-cc-page="first"]').addEventListener('click', () => go(1));
    bar.querySelector('[data-cc-page="prev"]').addEventListener('click', () => go(state.get(spec.name).pagina - 1));
    bar.querySelector('[data-cc-page="next"]').addEventListener('click', () => go(state.get(spec.name).pagina + 1));
    bar.querySelector('[data-cc-page="last"]').addEventListener('click', () => go(state.get(spec.name).meta?.totalPaginas || 1));

    // Navegação por teclado: setas movem a página quando o foco está na barra.
    bar.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); go(state.get(spec.name).pagina - 1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); go(state.get(spec.name).pagina + 1); }
      if (event.key === 'Home') { event.preventDefault(); go(1); }
      if (event.key === 'End') { event.preventDefault(); go(state.get(spec.name).meta?.totalPaginas || 1); }
    });
    return bar;
  }

  function updatePagination(spec, meta, itemCount) {
    const value = state.get(spec.name);
    value.meta = meta;
    value.pagina = Number(meta.pagina || value.pagina);
    value.limite = Number(meta.limite || value.limite);
    persist(spec.name);

    const bar = ensurePagination(spec);
    if (!bar) return;
    const total = Number(meta.total || 0);
    const first = total ? (value.pagina - 1) * value.limite + 1 : 0;
    const last = total ? first + itemCount - 1 : 0;
    const totalPages = Number(meta.totalPaginas || 0);

    const summary = bar.querySelector('[data-cc-list-summary]');
    if (summary) {
      summary.textContent = total
        ? `Exibindo ${first}–${last} de ${total} ${spec.itemNoun || 'registros'}`
        : `Nenhum ${spec.itemNoun || 'registro'} encontrado.`;
    }
    const label = bar.querySelector('[data-cc-page-label]');
    if (label) label.textContent = totalPages ? `Página ${value.pagina} de ${totalPages}` : 'Página 0 de 0';

    bar.querySelector('[data-cc-page="first"]').disabled = !meta.temAnterior;
    bar.querySelector('[data-cc-page="prev"]').disabled = !meta.temAnterior;
    bar.querySelector('[data-cc-page="next"]').disabled = !meta.temProxima;
    bar.querySelector('[data-cc-page="last"]').disabled = !meta.temProxima;
  }

  // Substitui um loader global por uma versão paginada, preservando o contrato.
  function adopt(spec) {
    const original = window[spec.loaderName];
    if (typeof original !== 'function' || original.__ccListWrapped) return;
    const value = loadState(spec.name);

    const load = async () => {
      const container = spec.container();
      if (!container) return;
      const view = spec.viewId ? el(`#${spec.viewId}`) : null;
      if (view) view.setAttribute('aria-busy', 'true');
      container.setAttribute('data-cc-list-busy', 'true');
      // Skeleton inicial apenas quando não há conteúdo (evita piscar).
      if (!container.dataset.ccListLoaded) {
        container.innerHTML = spec.skeleton ? spec.skeleton() : `<tr><td colspan="${spec.colspan || 1}">${stateMarkup('loading')}</td></tr>`;
      }
      try {
        const params = new URLSearchParams({ paginar: '1', pagina: String(value.pagina), limite: String(value.limite) });
        if (value.filtros?.busca) params.set(spec.searchParam || 'busca', value.filtros.busca);
        const response = await window.api(`${spec.endpoint}?${params}`);
        const items = toArray(response);
        const meta = metaOf(response, items);
        // Se a página ficou vazia após alteração de dados, recua uma página.
        if (!items.length && Number(meta.total || 0) > 0 && value.pagina > 1) {
          value.pagina = Math.max(1, Number(meta.totalPaginas || value.pagina - 1));
          persist(spec.name);
          return load();
        }
        if (typeof spec.onItems === 'function') spec.onItems(items);
        container.innerHTML = items.length ? spec.render(items) : `<tr><td colspan="${spec.colspan || 1}">${stateMarkup('empty', spec.emptyMessage || 'Nenhum registro encontrado.')}</td></tr>`;
        container.dataset.ccListLoaded = 'true';
        spec.bind(container, items);
        updatePagination(spec, meta, items.length);
      } catch (error) {
        container.innerHTML = `<tr><td colspan="${spec.colspan || 1}">${stateMarkup('error', error.message || 'Não foi possível carregar a lista.')}</td></tr>`;
        const retry = container.querySelector('[data-cc-list-retry]');
        if (retry) retry.addEventListener('click', () => { load().catch(() => {}); });
        throw error;
      } finally {
        container.removeAttribute('data-cc-list-busy');
        if (view) view.setAttribute('aria-busy', 'false');
      }
    };

    const wrapped = async function wrappedListLoader(...args) {
      ensureToolbar(spec);
      ensurePagination(spec);
      // Restaura o termo de busca salvo no campo.
      const value = loadState(spec.name);
      const search = el(`cc-search-${spec.name}`);
      if (search && value.filtros?.busca) search.value = value.filtros.busca;
      const sizeSelect = el(`cc-size-${spec.name}`);
      if (sizeSelect) sizeSelect.value = String(value.limite);
      return load(...args);
    };
    wrapped.__ccListWrapped = true;
    window[spec.loaderName] = wrapped;
  }

  window.ccRegisterList = register;
  window.ccAdoptLists = () => {
    registries.forEach((spec) => adopt(spec));
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.ccAdoptLists());
  } else {
    window.ccAdoptLists();
  }
  setTimeout(() => window.ccAdoptLists(), 450);
})();
