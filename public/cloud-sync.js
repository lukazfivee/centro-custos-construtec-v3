(() => {
  const INTERVAL_MS = 30000;
  let running = false;
  let lastSuccess = 0;

  function currentToken() {
    return localStorage.getItem('cc_token') || '';
  }

  function currentUser() {
    try { return JSON.parse(localStorage.getItem('cc_usuario') || 'null'); } catch { return null; }
  }

  function eligible(user) {
    return /@rcconstrutec\.com\.br$/i.test(String(user?.email || ''));
  }

  async function refreshVisibleData() {
    try {
      if (typeof loadReferences === 'function') await loadReferences();
      const active = document.querySelector('.nav-item.ativo')?.dataset?.view;
      const loaders = {
        dashboard:typeof loadDashboard === 'function' ? loadDashboard : null,
        lancamentos:typeof loadTransactions === 'function' ? loadTransactions : null,
        centros:typeof loadCenters === 'function' ? loadCenters : null,
        categorias:typeof loadCategories === 'function' ? loadCategories : null,
        fornecedores:typeof loadSuppliers === 'function' ? loadSuppliers : null,
        historico:typeof loadHistory === 'function' ? loadHistory : null,
      };
      if (active && loaders[active]) await loaders[active]();
    } catch {}
  }

  async function syncCloud({ quiet = true } = {}) {
    if (running || !navigator.onLine) return;
    const user = currentUser();
    const auth = currentToken();
    if (!auth || !eligible(user)) return;
    running = true;
    try {
      const statusResponse = await fetch('/api/cloud-sync/status', {
        headers:{ Authorization:`Bearer ${auth}` },
        cache:'no-store',
      });
      if (!statusResponse.ok) return;
      const status = await statusResponse.json();
      if (!status.configured || !status.eligible) return;

      const response = await fetch('/api/cloud-sync/sincronizar', {
        method:'POST',
        headers:{ Authorization:`Bearer ${auth}`, 'Content-Type':'application/json' },
        body:'{}',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.erro || 'Falha na sincronização compartilhada.');
      lastSuccess = Date.now();
      await refreshVisibleData();
      if (!quiet && typeof toast === 'function') toast('Dados compartilhados sincronizados.');
    } catch (error) {
      if (!quiet && typeof toast === 'function') toast(error.message, true);
    } finally {
      running = false;
    }
  }

  window.addEventListener('online', () => syncCloud({ quiet:false }));
  window.addEventListener('focus', () => {
    if (Date.now() - lastSuccess > 10000) syncCloud({ quiet:true });
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastSuccess > 10000) syncCloud({ quiet:true });
  });

  setInterval(() => syncCloud({ quiet:true }), INTERVAL_MS);
  setTimeout(() => syncCloud({ quiet:true }), 4000);
})();
