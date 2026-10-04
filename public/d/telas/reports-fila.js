// Fila de reports feitos sem internet (D7), guardada neste navegador. Mesma ideia da fila do celular
// (public/m/queue.js), mas em um banco proprio para nao se misturar com a fila de lancamentos.
// O report sai sozinho quando a conexao volta; o client_id impede duplicar se o envio for repetido.
(function (CC) {
  const D = CC.d;
  const R = D.rep = D.rep || {};
  const BANCO = 'cc-desktop-reports';
  const LOJA = 'fila';
  const estado = { rodando: false, ficouOffline: false };
  let abrindo = null;

  function abrir() {
    if (abrindo) return abrindo;
    abrindo = new Promise((resolve, reject) => {
      const req = indexedDB.open(BANCO, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(LOJA)) req.result.createObjectStore(LOJA, { keyPath: 'client_id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { abrindo = null; reject(req.error); };
    });
    return abrindo;
  }
  function loja(modo, fn) {
    return abrir().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(LOJA, modo);
      const pedido = fn(t.objectStore(LOJA));
      t.oncomplete = () => resolve(pedido && 'result' in pedido ? pedido.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }
  const avisar = () => document.dispatchEvent(new CustomEvent('d:reports'));

  // So os itens da conta atual: outra conta no mesmo navegador nao envia nem enxerga a fila alheia.
  const minha = async () => ((await loja('readonly', (s) => s.getAll()).catch(() => [])) || [])
    .filter((i) => i.owner && i.owner === CC.owner()).sort((a, b) => b.criado_em - a.criado_em);

  async function enviar(item) {
    await CC.api('/bug-reports', { method: 'POST', body: { ...item.payload, client_id: item.client_id } });
    await loja('readwrite', (s) => s.delete(item.client_id));
  }

  // Envia em ordem. Para na primeira falha de rede; recusa do servidor (dados) deixa o item marcado como erro.
  async function executar() {
    if (estado.rodando || CC.offline() || !CC.session.token()) return 0;
    const itens = (await minha()).filter((i) => i.estado !== 'erro').reverse();
    if (!itens.length) return 0;
    estado.rodando = true;
    let enviados = 0;
    try {
      for (const item of itens) {
        try {
          await enviar(item);
          enviados += 1;
        } catch (error) {
          if (error.status === 0) estado.ficouOffline = true;
          if (error.status === 0 || error.status === 401 || error.status >= 500) break;
          item.estado = 'erro';
          item.erro = error.message;
          await loja('readwrite', (s) => s.put(item));
        }
      }
    } finally {
      estado.rodando = false;
      avisar();
    }
    if (enviados && estado.ficouOffline) {
      estado.ficouOffline = false;
      CC.toast(enviados === 1 ? 'Internet de volta · 1 report enviado' : `Internet de volta · ${enviados} reports enviados`, 'cloud-arrow-up');
    }
    return enviados;
  }

  R.fila = {
    minha,
    executar,
    // payload: { titulo, tipo, tela, descricao, diagnostico, anexo }. Sobe o erro se nao der para gravar.
    async adicionar(payload, clientId) {
      const item = { client_id: clientId || CC.uuid(), owner: CC.owner(), payload, estado: 'fila', erro: '', criado_em: Date.now() };
      await loja('readwrite', (s) => s.put(item));
      avisar();
      return item;
    },
    async descartar(clientId) { await loja('readwrite', (s) => s.delete(clientId)); avisar(); },
    async tentar(clientId) {
      const item = await loja('readonly', (s) => s.get(clientId));
      if (item) { item.estado = 'fila'; item.erro = ''; await loja('readwrite', (s) => s.put(item)); }
      return executar();
    },
  };

  const tentarSozinho = () => { if (CC.session.token()) executar().catch(() => {}); };
  window.addEventListener('online', tentarSozinho);
  window.addEventListener('offline', () => { estado.ficouOffline = true; });
  setInterval(tentarSozinho, 30000);
  setTimeout(tentarSozinho, 3000);
})(window.CC);
