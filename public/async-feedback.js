/* Camada de feedback assíncrono do Centro de Custos.
   Fornece, de forma não invasiva e idempotente:
   - skeleton por view enquanto o loader correspondente está em execução;
   - aria-busy + realce de leitura durante a operação;
   - botões de ação desabilitados com spinner durante submits (sem perder o rótulo);
   - erro com ação de "Tentar novamente" (retry) em vez de apenas um toast;
   - estado vazio consistente.
   Respeita prefers-reduced-motion. Complementa os módulos chatgpt-pN */
(() => {
  if (window.__ccAsyncFeedbackLoaded) return;
  window.__ccAsyncFeedbackLoaded = true;

  const $ = (selector) => document.querySelector(selector);

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[char]));

  /* ----------------------------- Skeletons ------------------------------ */
  const skeletonLine = (width = '') => `<div class="cc-skeleton-line${width ? ` ${width}` : ''}"></div>`;

  const skeletonRows = (columns, rows = 5) => Array.from({ length: rows })
    .map(() => `<tr class="cc-skeleton-row" aria-hidden="true">${Array.from({ length: columns })
      .map(() => `<td>${skeletonLine()}</td>`).join('')}</tr>`).join('');

  const skeletonCards = (count) => Array.from({ length: count })
    .map(() => '<div class="cc-skeleton-block cc-skeleton-card" aria-hidden="true"></div>').join('');

  // Mapeia cada loader para o container de conteúdo e o skeleton a ser exibido
  // enquanto os dados chegam. Estrutura antecipável = skeleton.
  // OBS: 'dashboard' foi removido deste mapa de propósito. loadDashboard()
  // não recria o .kpi-grid — ela apenas seta textContent em elementos
  // (#kpi-receitas, #kpi-a-pagar etc.) que precisam continuar existindo no
  // DOM. Um skeleton que substitui o innerHTML do .kpi-grid os apaga, e
  // loadDashboard() falha com "Cannot set properties of null (setting
  // 'textContent')" assim que tenta escrever no primeiro deles — e como
  // clearSkeleton() não reconstrói o HTML original, o painel fica travado
  // no skeleton para sempre. wrapLoader('dashboard', 'loadDashboard')
  // continua ativo (retry + aria-busy), só sem essa entrada aqui.
  const VIEWS = {
    lancamentos: { target: '#tabela-lancamentos', render: () => skeletonRows(8, 6) },
    centros: { target: '#lista-centros-cards', render: () => skeletonCards(6) },
    categorias: { target: '#tabela-categorias', render: () => skeletonRows(5, 6) },
    fornecedores: { target: '#tabela-fornecedores', render: () => skeletonRows(6, 6) },
    historico: { target: '#tabela-historico', render: () => skeletonRows(5, 6) },
    sincronizacao: { target: '#sync-historico', render: () => skeletonRows(7, 3) },
    usuarios: { target: '#tabela-usuarios', render: () => skeletonRows(5, 4) },
    recorrentes: { target: '#lista-recorrentes', render: () => skeletonCards(4) },
    bugreports: { target: '#lista-bugreports', render: () => skeletonRows(4, 4) },
  };

  function currentViewName() {
    const active = $('.view:not(.oculto)');
    return active ? active.id.replace(/^view-/, '') : '';
  }

  // Antecipa o layout com skeleton durante a busca — inclusive em recarga,
  // para que a view nunca pareça travada enquanto os dados chegam.
  function showSkeleton(name) {
    const spec = VIEWS[name];
    if (!spec) return;
    const target = $(spec.target);
    if (!target) return;
    target.dataset.ccSkeleton = 'true';
    target.innerHTML = spec.render();
  }

  function clearSkeleton(name) {
    const spec = VIEWS[name];
    if (!spec) return;
    const target = $(spec.target);
    if (target) delete target.dataset.ccSkeleton;
  }

  function setBusy(name, busy) {
    const view = $(`#view-${name}`);
    if (view) view.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  /* ---------------------------- Retry (erro) ---------------------------- */
  let retryTimer = null;
  function showRetry(message, onRetry) {
    closeRetry();
    const el = document.createElement('div');
    el.className = 'cc-retry-toast';
    el.setAttribute('role', 'alert');
    el.innerHTML = `
      <div class="cc-retry-message">${escapeHtml(message)}</div>
      <div class="cc-retry-actions">
        <button type="button" class="cc-retry-dismiss">Fechar</button>
        <button type="button" class="cc-retry-primary">Tentar novamente</button>
      </div>`;
    document.body.appendChild(el);
    const dismiss = () => closeRetry();
    el.querySelector('.cc-retry-dismiss').addEventListener('click', dismiss);
    const retryBtn = el.querySelector('.cc-retry-primary');
    retryBtn.addEventListener('click', async () => {
      retryBtn.disabled = true;
      retryBtn.textContent = 'Tentando...';
      try {
        await onRetry();
        closeRetry();
      } catch (error) {
        retryBtn.disabled = false;
        retryBtn.textContent = 'Tentar novamente';
        el.querySelector('.cc-retry-message').textContent = error?.message || 'Falha ao tentar novamente.';
      }
    });
    // Auto-dismiss só quando há sucesso; erros persistentes permanecem para retry.
    clearTimeout(retryTimer);
  }

  function closeRetry() {
    clearTimeout(retryTimer);
    document.querySelector('.cc-retry-toast')?.remove();
  }

  window.ccShowRetry = showRetry;

  /* --------------------- Envolvimento dos loaders ----------------------- */
  // Envolve um loader global para exibir skeleton + aria-busy e oferecer retry.
  function wrapLoader(name, loaderName) {
    const original = window[loaderName];
    if (typeof original !== 'function' || original.__ccWrapped) return;
    const wrapped = async function wrappedLoader(...args) {
      const isCurrentView = currentViewName() === name;
      if (isCurrentView) {
        showSkeleton(name);
        setBusy(name, true);
      }
      closeRetry();
      try {
        const result = await original.apply(this, args);
        return result;
      } catch (error) {
        const message = error?.message || 'Não foi possível carregar os dados.';
        // Na view atual, troca o toast genérico por um aviso com retry, e marca
        // o erro como tratado para não duplicar a notificação do showView.
        if (isCurrentView) {
          showRetry(message, () => wrappedLoader(...args));
          suppressToast(message);
        } else if (typeof window.toast === 'function') {
          window.toast(message, true);
          suppressToast(message);
        }
        throw error;
      } finally {
        if (isCurrentView) {
          clearSkeleton(name);
          setBusy(name, false);
        }
      }
    };
    wrapped.__ccWrapped = true;
    window[loaderName] = wrapped;
  }

  // Deduplica o toast genérico do showView quando o wrapper já mostrou o retry.
  // O showView chama toast(error.message) mesmo após tratarmos o erro, então
  // suprimimos a repetição da mesma mensagem por uma janela curta.
  const suppressedToasts = new Map();
  function suppressToast(message, ms = 1500) {
    suppressedToasts.set(String(message || ''), Date.now() + ms);
  }
  function isToastSuppressed(message) {
    const key = String(message || '');
    const until = suppressedToasts.get(key);
    if (!until) return false;
    if (Date.now() > until) { suppressedToasts.delete(key); return false; }
    return true;
  }
  function wrapToast() {
    if (typeof window.toast !== 'function' || window.toast.__ccWrapped) return;
    const original = window.toast;
    const wrapped = function wrappedToast(message, isError) {
      if (isError && isToastSuppressed(message)) return;
      return original.call(this, message, isError);
    };
    wrapped.__ccWrapped = true;
    window.toast = wrapped;
  }

  /* -------------------- Ação de botão durante submit -------------------- */
  // Marca visualmente um botão como "em operação" sem perder o rótulo original.
  function beginButton(button) {
    if (!button || button.dataset.ccBusy === 'true') return () => {};
    button.dataset.ccBusy = 'true';
    button.dataset.ccLabel = button.textContent;
    button.disabled = true;
    button.classList.add('is-loading');
    return () => {
      button.disabled = false;
      button.classList.remove('is-loading');
      delete button.dataset.ccBusy;
      if (button.dataset.ccLabel) button.textContent = button.dataset.ccLabel;
    };
  }

  window.ccBeginButton = beginButton;

  /* ------------------ Submit de formulários (contexto preservado) ------- */
  // Instrumenta window.api para contar operações em voo e reabilitar o
  // botão de submit exatamente quando a operação correspondente termina.
  let inFlight = 0;
  const pendingRestores = new Set();
  let apiWrapped = false;

  function releasePending() {
    if (inFlight > 0) return;
    window.setTimeout(() => {
      if (inFlight > 0) return;
      pendingRestores.forEach((restore) => restore());
      pendingRestores.clear();
    }, 30);
  }

  function wrapApi() {
    if (apiWrapped || typeof window.api !== 'function') return;
    const original = window.api;
    if (original.__ccWrapped) { apiWrapped = true; return; }
    const wrapped = function wrappedApi(...args) {
      inFlight += 1;
      let result;
      try {
        result = original.apply(this, args);
      } catch (error) {
        inFlight -= 1;
        releasePending();
        throw error;
      }
      return Promise.resolve(result).finally(() => {
        inFlight -= 1;
        releasePending();
      });
    };
    wrapped.__ccWrapped = true;
    window.api = wrapped;
    apiWrapped = true;
  }

  function initSubmitFeedback() {
    wrapApi();
    document.addEventListener('submit', (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const button = event.submitter || form.querySelector('button[type="submit"], button:not([type])');
      if (!button) return;
      // Respeita botões já gerenciados manualmente (data-cc-busy).
      const restore = beginButton(button);
      pendingRestores.add(restore);
      // Segurança: se a operação não passar por api(), reabilita após 12s.
      const guard = window.setTimeout(() => { pendingRestores.delete(restore); restore(); }, 12000);
      pendingRestores.add(() => window.clearTimeout(guard));
    }, true);
  }

  function initLoaderFeedback() {
    wrapApi();
    wrapToast();
    wrapLoader('dashboard', 'loadDashboard');
    wrapLoader('lancamentos', 'loadTransactions');
    wrapLoader('centros', 'loadCenters');
    wrapLoader('categorias', 'loadCategories');
    wrapLoader('fornecedores', 'loadSuppliers');
    wrapLoader('historico', 'loadHistory');
    wrapLoader('sincronizacao', 'loadSync');
    wrapLoader('usuarios', 'loadUsers');
    wrapLoader('recorrentes', 'loadRecurring');
    wrapLoader('bugreports', 'loadBugReports');
  }

  function boot() {
    initSubmitFeedback();
    initLoaderFeedback();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Reaplica o wrapping caso os scripts de melhoria reatribuam os loaders após o load.
  setTimeout(initLoaderFeedback, 400);
})();
