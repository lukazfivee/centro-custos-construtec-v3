(() => {
  const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  const today = () => new Intl.DateTimeFormat('en-CA').format(new Date());
  let refreshTimer = null;
  let itemMap = new Map();

  function authHeaders(json = false) {
    const headers = {};
    const token = localStorage.getItem('cc_token');
    if (token) headers.Authorization = `Bearer ${token}`;
    if (json) headers['Content-Type'] = 'application/json';
    return headers;
  }

  async function refreshItems() {
    try {
      const response = await fetch('/api/lancamentos', { headers:authHeaders() });
      if (!response.ok) return;
      const items = await response.json();
      if (!Array.isArray(items)) return;
      itemMap = new Map(items.map((item) => [Number(item.id), item]));
      decorateRows();
    } catch {}
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshItems, 180);
  }

  function effectiveSign(item) {
    const base = item.tipo === 'receita' ? 1 : -1;
    return base * Number(item.sinal_contabil || 1);
  }

  function decorateRows() {
    const tbody = document.querySelector('#tabela-lancamentos');
    if (!tbody) return;
    tbody.querySelectorAll('tr').forEach((row) => {
      const edit = row.querySelector('[data-edit-transaction]');
      if (!edit) return;
      const id = Number(edit.dataset.editTransaction);
      const item = itemMap.get(id);
      if (!item) return;
      const actions = edit.closest('.row-actions');
      const descriptionCell = row.children[5];
      const moneyCell = row.children[6];
      if (!actions || !descriptionCell || !moneyCell) return;

      row.classList.toggle('cc-reversal-row', Boolean(item.estorno_de));
      row.querySelectorAll('.cc-reversal-badge,.cc-reversal-button').forEach((node) => node.remove());

      if (item.estorno_de) {
        const badge = document.createElement('span');
        badge.className = 'cc-reversal-badge';
        badge.textContent = '↶ Estorno';
        descriptionCell.appendChild(document.createElement('br'));
        descriptionCell.appendChild(badge);
        edit.style.display = 'none';
        const del = actions.querySelector('[data-delete-transaction]');
        if (del) del.style.display = 'none';
      } else if (item.estornado) {
        const badge = document.createElement('span');
        badge.className = 'cc-reversal-badge done';
        badge.textContent = '✓ Estornado';
        descriptionCell.appendChild(document.createElement('br'));
        descriptionCell.appendChild(badge);
        edit.style.display = 'none';
        const del = actions.querySelector('[data-delete-transaction]');
        if (del) del.style.display = 'none';
      } else {
        edit.style.display = '';
        const del = actions.querySelector('[data-delete-transaction]');
        if (del) del.style.display = '';
        const canReverse = item.status_financeiro === 'liquidado' && Boolean(del);
        if (canReverse) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'cc-reversal-button';
          button.textContent = 'Estornar';
          button.addEventListener('click', () => openReversalModal(item));
          actions.insertBefore(button, del || null);
        }
      }

      const sign = effectiveSign(item);
      moneyCell.textContent = `${sign >= 0 ? '+' : '−'} ${money(item.valor)}`;
      moneyCell.style.color = sign >= 0 ? 'var(--green)' : 'var(--red)';
      if (item.estorno_de) moneyCell.style.color = '#8a5a00';
    });
  }

  function closeModal() {
    document.querySelector('.cc-reversal-modal-backdrop')?.remove();
  }

  function openReversalModal(item) {
    closeModal();
    const backdrop = document.createElement('div');
    backdrop.className = 'cc-reversal-modal-backdrop';
    backdrop.innerHTML = `
      <section class="cc-reversal-modal" role="dialog" aria-modal="true" aria-label="Registrar estorno">
        <header><p>Estorno formal</p><h3>${escapeHtml(item.descricao || 'Lançamento')}</h3></header>
        <div class="cc-body">
          <p class="cc-warning"><strong>${money(item.valor)}</strong> será compensado por um novo movimento de estorno. O lançamento original não será apagado e continuará disponível no histórico.</p>
          <label for="cc-reversal-date">Data do estorno</label>
          <input id="cc-reversal-date" type="date" value="${today()}">
          <label for="cc-reversal-reason">Motivo</label>
          <textarea id="cc-reversal-reason" maxlength="500" placeholder="Ex.: pagamento realizado em duplicidade, cobrança cancelada, valor lançado incorretamente..."></textarea>
          <div class="cc-reversal-error"></div>
          <div class="cc-actions">
            <button type="button" class="btn secondary cc-cancel">Cancelar</button>
            <button type="button" class="btn primary cc-confirm">Confirmar estorno</button>
          </div>
        </div>
      </section>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector('.cc-cancel').addEventListener('click', closeModal);
    backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closeModal(); });
    backdrop.querySelector('.cc-confirm').addEventListener('click', async () => {
      const button = backdrop.querySelector('.cc-confirm');
      const error = backdrop.querySelector('.cc-reversal-error');
      const reason = backdrop.querySelector('#cc-reversal-reason').value.trim();
      const date = backdrop.querySelector('#cc-reversal-date').value;
      if (reason.length < 5) { error.textContent = 'Explique o motivo do estorno com pelo menos 5 caracteres.'; return; }
      button.disabled = true;
      button.textContent = 'Registrando…';
      error.textContent = '';
      try {
        const response = await fetch(`/api/lancamentos/${item.id}/estornar`, {
          method:'POST', headers:authHeaders(true), body:JSON.stringify({ motivo:reason, data_estorno:date }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.erro || 'Não foi possível registrar o estorno.');
        closeModal();
        if (typeof window.toast === 'function') window.toast('Estorno registrado com sucesso.');
        setTimeout(() => window.location.reload(), 450);
      } catch (err) {
        error.textContent = err.message;
        button.disabled = false;
        button.textContent = 'Confirmar estorno';
      }
    });
    setTimeout(() => backdrop.querySelector('#cc-reversal-reason')?.focus(), 50);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;',
    }[char]));
  }

  function addP2Hint() {
    const meta = document.querySelector('#view-lancamentos .table-meta');
    if (!meta || meta.querySelector('.cc-p2-note')) return;
    const note = document.createElement('span');
    note.className = 'cc-p2-note';
    note.textContent = 'P2: estorno preserva o histórico';
    const tools = meta.querySelector('.cc-list-tools');
    if (tools) tools.prepend(note); else meta.appendChild(note);
  }

  function init() {
    addP2Hint();
    const tbody = document.querySelector('#tabela-lancamentos');
    if (tbody) {
      new MutationObserver(() => { addP2Hint(); scheduleRefresh(); })
        .observe(tbody, { childList:true, subtree:true });
    }
    scheduleRefresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
