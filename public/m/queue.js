// Armazenamento no celular (IndexedDB) e fila de lancamentos feitos sem internet.
// Contrato: docs/suite-mobile/05-CONTRATO-FASE2.md (client_id no POST, 409 do anexo = ja enviado).
(function (CC) {
  let dbPromise = null;
  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('cc-celular', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('fila')) db.createObjectStore('fila', { keyPath: 'client_id' });
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  function tx(store, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const result = fn(t.objectStore(store));
      t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
      t.onerror = () => reject(t.error);
    }));
  }
  CC.store = {
    put: (store, value) => tx(store, 'readwrite', (s) => s.put(value)),
    get: (store, key) => tx(store, 'readonly', (s) => s.get(key)),
    all: (store) => tx(store, 'readonly', (s) => s.getAll()),
    del: (store, key) => tx(store, 'readwrite', (s) => s.delete(key)),
  };

  const listeners = [];
  const state = { syncing: false, pending: 0, errors: 0, wasOffline: false };
  CC.queue = { state, on: (fn) => listeners.push(fn) };
  function emit() { listeners.forEach((fn) => { try { fn(state); } catch { /* tela fechada */ } }); }

  CC.queue.refresh = async function () {
    const items = await CC.store.all('fila').catch(() => []);
    state.pending = items.filter((i) => i.estado !== 'erro').length;
    state.errors = items.filter((i) => i.estado === 'erro').length;
    emit();
    return items;
  };

  // Guarda a despesa no celular. Ela sai da fila so depois de o servidor confirmar.
  CC.queue.add = async function (item) {
    await CC.store.put('fila', { ...item, estado: 'fila', erro: '', lancamento_id: null, criado_em: Date.now() });
    await CC.queue.refresh();
    return CC.queue.run();
  };

  async function sendOne(item) {
    if (!item.lancamento_id) {
      const { data } = await CC.api('/lancamentos', { method: 'POST', body: { ...item.payload, client_id: item.client_id } });
      item.lancamento_id = data.id;
      await CC.store.put('fila', item);
    }
    if (item.foto) {
      try {
        await CC.api(`/anexos/lancamento/${item.lancamento_id}`, { method: 'POST', body: item.foto });
      } catch (error) {
        if (error.status !== 409) throw error; // 409 = o mesmo arquivo ja esta anexado
      }
    }
    await CC.store.del('fila', item.client_id);
  }

  // Envia a fila em ordem. Para na primeira falha de rede; erros de dados ficam marcados.
  CC.queue.run = async function () {
    if (state.syncing || CC.offline() || !CC.session.token()) return CC.queue.refresh();
    const items = (await CC.store.all('fila').catch(() => [])).filter((i) => i.estado !== 'erro').sort((a, b) => a.criado_em - b.criado_em);
    if (!items.length) return CC.queue.refresh();
    state.syncing = true;
    emit();
    let sent = 0;
    try {
      for (const item of items) {
        try {
          await sendOne(item);
          sent += 1;
        } catch (error) {
          if (error.status === 0) state.wasOffline = true;
          if (error.status === 0 || error.status === 401 || error.status >= 500) break;
          item.estado = 'erro';
          item.erro = error.message;
          await CC.store.put('fila', item);
        }
      }
    } finally {
      state.syncing = false;
      await CC.queue.refresh();
    }
    if (sent && state.wasOffline) {
      state.wasOffline = false;
      CC.toast(sent === 1 ? 'Internet de volta · 1 lançamento enviado' : `Internet de volta · ${sent} lançamentos enviados`, 'cloud-arrow-up');
    }
    if (sent && CC.onQueueSent) CC.onQueueSent();
    return sent;
  };

  CC.queue.discard = async (clientId) => { await CC.store.del('fila', clientId); return CC.queue.refresh(); };
  CC.queue.retry = async (clientId) => {
    const item = await CC.store.get('fila', clientId);
    if (item) { item.estado = 'fila'; item.erro = ''; await CC.store.put('fila', item); }
    return CC.queue.run();
  };

  // Faixa "Sem internet" / "Enviando" (prototipo, Rodada 15).
  function paintBar() {
    const bar = document.getElementById('netbar');
    if (!bar) return;
    const off = CC.offline();
    const show = off || state.syncing;
    bar.hidden = !show;
    document.body.classList.toggle('has-netbar', show);
    if (!show) return;
    const n = state.pending;
    if (state.syncing) {
      bar.className = 'netbar sync';
      bar.innerHTML = `<span class="spin" aria-hidden="true"></span><span class="msg">${n === 1 ? 'Enviando 1 lançamento…' : `Enviando ${n} lançamentos…`}</span>`;
      return;
    }
    bar.className = 'netbar off';
    const msg = n ? (n === 1 ? 'Sem internet · 1 lançamento na fila' : `Sem internet · ${n} lançamentos na fila`) : 'Sem internet · você pode continuar usando';
    bar.innerHTML = `${CC.icon('wifi-slash', 17)}<span class="msg">${msg}</span><button type="button" id="net-retry">Tentar agora</button>`;
    CC.$('#net-retry', bar).addEventListener('click', () => {
      if (CC.offline()) CC.toast('Ainda sem internet · seus dados estão salvos no celular', 'cloud-slash');
      else CC.queue.run();
    });
  }
  CC.queue.on(paintBar);
  window.addEventListener('online', () => { paintBar(); CC.queue.run(); });
  window.addEventListener('offline', () => { state.wasOffline = true; paintBar(); });
  setInterval(() => { if (state.pending && !state.syncing && !CC.offline()) CC.queue.run(); }, 30000);
  CC.queue.paint = paintBar;
})(window.CC = window.CC || {});
