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
    if (!localStorage.getItem('cc_token')) return;
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
          button.setAttribute('aria-label', `Estornar lançamento: ${item.descricao || 'sem descrição'}`);
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
        <header style="position:relative;display:flex;justify-content:space-between;align-items:start;">
          <div><p>Estorno formal</p><h3>${escapeHtml(item.descricao || 'Lançamento')}</h3></div>
          <button type="button" class="cc-doc-close cc-cancel" aria-label="Fechar" style="background:transparent;border:0;font-size:22px;line-height:1;cursor:pointer;color:var(--muted);padding:4px 8px;">×</button>
        </header>
        <div class="cc-body">
          <p class="cc-warning"><strong>${money(item.valor)}</strong> será compensado por um novo movimento de estorno. O lançamento original não será apagado e continuará disponível no histórico.</p>
          <label for="cc-reversal-date">Data do estorno</label>
          <input id="cc-reversal-date" type="date" value="${today()}" min="${item.data || ''}">
          <label for="cc-reversal-reason">Motivo</label>
          <textarea id="cc-reversal-reason" maxlength="500" placeholder="Ex.: pagamento realizado em duplicidade, cobrança cancelada, valor lançado incorretamente..."></textarea>
          <div class="cc-reversal-error" role="alert" aria-live="assertive"></div>
          <div class="cc-actions">
            <button type="button" class="btn secondary cc-cancel">Cancelar</button>
            <button type="button" class="btn primary cc-confirm">Confirmar estorno</button>
          </div>
        </div>
      </section>`;
    document.body.appendChild(backdrop);
    backdrop.querySelectorAll('.cc-cancel').forEach((btn) => btn.addEventListener('click', closeModal));
    backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closeModal(); });
    const escHandler = (e) => { if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);
    backdrop.querySelector('.cc-confirm').addEventListener('click', async () => {
      const button = backdrop.querySelector('.cc-confirm');
      const error = backdrop.querySelector('.cc-reversal-error');
      const reason = backdrop.querySelector('#cc-reversal-reason').value.trim();
      const date = backdrop.querySelector('#cc-reversal-date').value;
      if (reason.length < 5) { error.textContent = 'Explique o motivo do estorno com pelo menos 5 caracteres.'; return; }
      if (item.data && date < item.data) { error.textContent = 'A data do estorno não pode ser anterior à data do lançamento original.'; return; }
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

  function init() {
    const tbody = document.querySelector('#tabela-lancamentos');
    if (tbody) {
      new MutationObserver(scheduleRefresh)
        .observe(tbody, { childList:true, subtree:true });
    }
    scheduleRefresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
