(() => {
  let itemMap = new Map();
  let refreshTimer = null;

  function authHeaders(json = false) {
    const headers = {};
    const token = localStorage.getItem('cc_token');
    if (token) headers.Authorization = `Bearer ${token}`;
    if (json) headers['Content-Type'] = 'application/json';
    return headers;
  }

  function userRole() {
    try { return JSON.parse(localStorage.getItem('cc_usuario') || '{}').role || ''; } catch { return ''; }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;',
    }[char]));
  }

  function sizeLabel(bytes) {
    const n = Number(bytes || 0);
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  function categoryLabel(value) {
    return ({ comprovante:'Comprovante',nota_fiscal:'Nota fiscal',boleto:'Boleto',recibo:'Recibo',contrato:'Contrato',outro:'Outro' })[value] || 'Documento';
  }

  async function refreshItems() {
    try {
      const response = await fetch('/api/lancamentos', { headers:authHeaders() });
      if (!response.ok) return;
      const data = await response.json();
      const items = Array.isArray(data) ? data : (data.itens || []);
      itemMap = new Map(items.map((item) => [Number(item.id), item]));
      decorateRows();
    } catch {}
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshItems, 160);
  }

  function decorateRows() {
    const tbody = document.querySelector('#tabela-lancamentos');
    if (!tbody) return;
    tbody.querySelectorAll('tr').forEach((row) => {
      const edit = row.querySelector('[data-edit-transaction]');
      const existing = row.querySelector('.cc-doc-button');
      if (!edit || existing) return;
      const item = itemMap.get(Number(edit.dataset.editTransaction));
      const actions = edit.closest('.row-actions');
      if (!item || !actions) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cc-doc-button';
      button.textContent = '📎 Documentos';
      button.title = 'Comprovantes, notas fiscais, boletos e recibos';
      button.addEventListener('click', () => openDocuments(item));
      actions.prepend(button);
    });
  }

  async function apiJson(path, options = {}) {
    const response = await fetch(path, { ...options, headers:{ ...authHeaders(Boolean(options.body)), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.erro || 'Não foi possível concluir a operação.');
    return data;
  }

  function closeModal() { document.querySelector('.cc-doc-backdrop')?.remove(); }

  async function openDocuments(item) {
    closeModal();
    const backdrop = document.createElement('div');
    backdrop.className = 'cc-doc-backdrop';
    backdrop.innerHTML = `
      <section class="cc-doc-modal" role="dialog" aria-modal="true" aria-label="Documentos do lançamento">
        <header class="cc-doc-head">
          <div><p>P4 · Documentos</p><h3>${escapeHtml(item.descricao || 'Lançamento')}</h3><span>${escapeHtml(item.favorecido || '')}</span></div>
          <button type="button" class="cc-doc-close" aria-label="Fechar">×</button>
        </header>
        <div class="cc-doc-body">
          <section class="cc-upload-card">
            <div class="cc-upload-grid">
              <label>Tipo do documento
                <select id="cc-doc-category">
                  <option value="comprovante">Comprovante</option><option value="nota_fiscal">Nota fiscal</option>
                  <option value="boleto">Boleto</option><option value="recibo">Recibo</option>
                  <option value="contrato">Contrato</option><option value="outro">Outro</option>
                </select>
              </label>
              <label>Arquivo
                <input id="cc-doc-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp">
              </label>
            </div>
            <label>Observação opcional
              <input id="cc-doc-notes" maxlength="500" placeholder="Ex.: PIX referente à compra de material elétrico">
            </label>
            <div class="cc-upload-foot"><small>PDF, JPG, PNG ou WEBP · máximo 8 MB · arquivos duplicados são bloqueados</small><button class="btn primary cc-doc-upload" type="button">Anexar documento</button></div>
            <div class="cc-doc-error"></div>
          </section>
          <section><div class="cc-doc-list-head"><strong>Arquivos anexados</strong><span class="cc-doc-count">Carregando…</span></div><div class="cc-doc-list"></div></section>
        </div>
      </section>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector('.cc-doc-close').addEventListener('click', closeModal);
    backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closeModal(); });
    backdrop.querySelector('.cc-doc-upload').addEventListener('click', () => uploadDocument(item, backdrop));
    await loadDocuments(item, backdrop);
  }

  async function loadDocuments(item, backdrop) {
    const list = backdrop.querySelector('.cc-doc-list');
    const count = backdrop.querySelector('.cc-doc-count');
    try {
      const items = await apiJson(`/api/anexos/lancamento/${item.id}`);
      count.textContent = `${items.length} arquivo${items.length === 1 ? '' : 's'}`;
      if (!items.length) {
        list.innerHTML = '<div class="cc-doc-empty">Nenhum documento anexado ainda.</div>';
        return;
      }
      const canDelete = ['admin','gestor'].includes(userRole());
      list.innerHTML = items.map((doc) => `
        <article class="cc-doc-item" data-doc-id="${doc.id}">
          <div class="cc-doc-icon">${doc.tipo === 'application/pdf' ? 'PDF' : 'IMG'}</div>
          <div class="cc-doc-copy"><strong>${escapeHtml(doc.nome)}</strong><span>${categoryLabel(doc.categoria)} · ${sizeLabel(doc.tamanho)} · ${escapeHtml(doc.enviado_por || '')}</span>${doc.observacao ? `<small>${escapeHtml(doc.observacao)}</small>` : ''}</div>
          <div class="cc-doc-actions"><button type="button" class="cc-doc-download">Baixar</button>${canDelete ? '<button type="button" class="cc-doc-delete">Excluir</button>' : ''}</div>
        </article>`).join('');
      list.querySelectorAll('.cc-doc-item').forEach((card) => {
        const id = Number(card.dataset.docId);
        const doc = items.find((entry) => Number(entry.id) === id);
        card.querySelector('.cc-doc-download')?.addEventListener('click', () => downloadDocument(doc));
        card.querySelector('.cc-doc-delete')?.addEventListener('click', () => deleteDocument(item, doc, backdrop));
      });
    } catch (error) {
      count.textContent = 'Erro';
      list.innerHTML = `<div class="cc-doc-empty error">${escapeHtml(error.message)}</div>`;
    }
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
      reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
      reader.readAsDataURL(file);
    });
  }

  async function uploadDocument(item, backdrop) {
    const file = backdrop.querySelector('#cc-doc-file').files[0];
    const error = backdrop.querySelector('.cc-doc-error');
    const button = backdrop.querySelector('.cc-doc-upload');
    error.textContent = '';
    if (!file) { error.textContent = 'Selecione um arquivo.'; return; }
    if (file.size > 8 * 1024 * 1024) { error.textContent = 'O arquivo ultrapassa 8 MB.'; return; }
    button.disabled = true; button.textContent = 'Enviando…';
    try {
      const content = await fileToBase64(file);
      await apiJson(`/api/anexos/lancamento/${item.id}`, {
        method:'POST', body:JSON.stringify({ nome:file.name,tipo:file.type,categoria:backdrop.querySelector('#cc-doc-category').value,observacao:backdrop.querySelector('#cc-doc-notes').value,conteudoBase64:content }),
      });
      backdrop.querySelector('#cc-doc-file').value = '';
      backdrop.querySelector('#cc-doc-notes').value = '';
      await loadDocuments(item, backdrop);
    } catch (err) { error.textContent = err.message; }
    finally { button.disabled = false; button.textContent = 'Anexar documento'; }
  }

  async function downloadDocument(doc) {
    try {
      const response = await fetch(`/api/anexos/${doc.id}/arquivo`, { headers:authHeaders() });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.erro || 'Falha no download.'); }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = doc.nome; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    } catch (error) { window.alert(error.message); }
  }

  async function deleteDocument(item, doc, backdrop) {
    if (!window.confirm(`Excluir o documento "${doc.nome}"? O histórico da remoção será mantido.`)) return;
    try {
      await apiJson(`/api/anexos/${doc.id}`, { method:'DELETE' });
      await loadDocuments(item, backdrop);
    } catch (error) { backdrop.querySelector('.cc-doc-error').textContent = error.message; }
  }

  function addHint() {
    const meta = document.querySelector('#view-lancamentos .table-meta');
    if (!meta || meta.querySelector('.cc-p4-note')) return;
    const note = document.createElement('span'); note.className = 'cc-p4-note'; note.textContent = 'P4: documentos vinculados ao lançamento';
    const tools = meta.querySelector('.cc-list-tools'); if (tools) tools.prepend(note); else meta.appendChild(note);
  }

  function init() {
    addHint();
    const tbody = document.querySelector('#tabela-lancamentos');
    if (tbody) new MutationObserver(() => { addHint(); scheduleRefresh(); }).observe(tbody, { childList:true,subtree:true });
    scheduleRefresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
