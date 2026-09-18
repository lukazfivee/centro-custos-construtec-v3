(() => {
  const token = () => localStorage.getItem('cc_token') || '';
  const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        Authorization: `Bearer ${token()}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.erro || json.error || `Erro HTTP ${res.status}`);
    return json;
  }

  function toast(msg, isError = false) {
    if (typeof window.toast === 'function') return window.toast(msg, isError);
    const el = document.getElementById('toast');
    if (el) {
      el.textContent = msg;
      el.className = `toast${isError ? ' error' : ''}`;
      setTimeout(() => el.classList.add('oculto'), 3500);
    }
  }

  async function openBudgetMeasurementsModal(costCenterId, center, budgetData, initialTab = 'labor') {
    const existing = document.getElementById('budget-measurements-backdrop');
    if (existing) existing.remove();

    const cCode = center?.codigo || budgetData?.contract?.number || `Obra #${costCenterId}`;
    const cName = center?.nome ? ` — ${center.nome}` : '';

    const backdrop = document.createElement('div');
    backdrop.id = 'budget-measurements-backdrop';
    backdrop.className = 'budget-measurements-backdrop';
    backdrop.setAttribute('role', 'presentation');

    backdrop.innerHTML = `
      <div class="budget-measurements-modal" role="dialog" aria-modal="true" aria-labelledby="measurements-dialog-title" onclick="event.stopPropagation()">
        <header class="measurements-toolbar">
          <div class="toolbar-info">
            <h3>Medições de Obra & Avanço de Campo</h3>
            <p id="measurements-dialog-title">Medições orçamentárias — ${esc(cCode)}${esc(cName)}</p>
          </div>
          <button type="button" class="btn-close-measurements" id="btn-close-measurements" aria-label="Fechar medições orçamentárias" title="Fechar medições orçamentárias">×</button>
        </header>

        <nav class="measurements-tabs" role="tablist" aria-label="Tipo de medição">
          <button type="button" role="tab" class="measurements-tab-btn ${initialTab === 'labor' ? 'active' : ''}" data-tab="labor" aria-selected="${initialTab === 'labor'}">Mão de Obra & Equipe</button>
          <button type="button" role="tab" class="measurements-tab-btn ${initialTab === 'contract' ? 'active' : ''}" data-tab="contract" aria-selected="${initialTab === 'contract'}">Medições de Contrato (Cliente)</button>
        </nav>

        <div id="measurements-tab-content">Carregando medições...</div>
      </div>
    `;

    document.body.appendChild(backdrop);
    backdrop.querySelector('#btn-close-measurements')?.focus();

    const closeModal = () => {
      backdrop.remove();
      window.removeEventListener('keydown', onKey);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') closeModal();
    };

    window.addEventListener('keydown', onKey);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });
    backdrop.querySelector('#btn-close-measurements')?.addEventListener('click', closeModal);

    let currentTab = initialTab;
    let measurementsData = { labor: [], contracts: [] };

    async function loadAndRender() {
      const container = document.getElementById('measurements-tab-content');
      if (!container) return;
      try {
        measurementsData = await api(`/api/centros-custo/${costCenterId}/medicoes`);
        renderCurrentTab();
      } catch (err) {
        container.innerHTML = `<div class="form-error" style="padding:20px;">Falha ao carregar medições: ${esc(err.message)}</div>`;
      }
    }

    function renderCurrentTab() {
      const container = document.getElementById('measurements-tab-content');
      if (!container) return;

      if (currentTab === 'labor') {
        renderLaborTab(container);
      } else {
        renderContractTab(container);
      }
    }

    function renderLaborTab(container) {
      const plannedHours = budgetData?.laborHours?.planned || 0;
      const consumedHours = (measurementsData.labor || []).reduce((acc, m) => acc + Number(m.team_hours || 0), 0);
      const balanceHours = plannedHours - consumedHours;

      container.innerHTML = `
        <div class="measurements-kpi-row">
          <div class="measurements-kpi-card"><span>Horas Planejadas</span><strong>${plannedHours.toFixed(1)}h</strong></div>
          <div class="measurements-kpi-card highlight"><span>Horas Medidas</span><strong>${consumedHours.toFixed(1)}h</strong></div>
          <div class="measurements-kpi-card"><span>Saldo Disponível</span><strong style="color:${balanceHours < 0 ? '#dc2626' : '#059669'};">${balanceHours.toFixed(1)}h</strong></div>
        </div>
        <div class="measurements-body">
          <form class="measurement-form-card" id="form-labor-measurement">
            <h4>Apontar Nova Medição de Mão de Obra</h4>
            <div class="measurement-form-grid">
              <div><label>Data Início</label><input type="date" id="labor-period-start" required /></div>
              <div><label>Data Fim</label><input type="date" id="labor-period-end" required /></div>
              <div><label>Horas da Equipe</label><input type="number" step="0.5" min="0.5" id="labor-team-hours" placeholder="ex: 44.0" required /></div>
              <div class="measurement-field-full"><label>Observações / Frente de Trabalho</label><input type="text" id="labor-notes" placeholder="ex: Alvenaria do 2º pavimento e instalações hidráulicas" /></div>
            </div>
            <div class="measurement-form-actions">
              <button type="submit" class="btn primary" id="btn-submit-labor" style="background:#0284c7;">Registrar Medição de Equipe</button>
            </div>
          </form>

          <div class="measurements-table-card">
            <div class="measurements-table-title">Histórico de Medições de Campo (${(measurementsData.labor || []).length})</div>
            <table class="measurements-table cc-mobile-table">
              <thead><tr><th>Período</th><th>Horas Medidas</th><th>Observações</th><th>Registro</th></tr></thead>
              <tbody>
                ${(measurementsData.labor || []).length === 0 ? '<tr><td colspan="4" style="text-align:center;padding:16px;color:#94a3b8;">Nenhuma medição de mão de obra registrada.</td></tr>' : ''}
                ${(measurementsData.labor || []).map(m => `
                  <tr>
                    <td data-label="Período"><strong>${esc(m.period_start)}</strong> até <strong>${esc(m.period_end)}</strong></td>
                    <td data-label="Horas Medidas"><strong style="color:#0284c7;">${Number(m.team_hours).toFixed(1)}h</strong></td>
                    <td data-label="Observações">${esc(m.notes || '—')}</td>
                    <td data-label="Registro">${new Date(m.created_at).toLocaleDateString('pt-BR')}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

      // Set default dates to current week
      const now = new Date();
      const firstDay = new Date(now.setDate(now.getDate() - now.getDay() + 1));
      const lastDay = new Date(now.setDate(firstDay.getDate() + 5));
      const startEl = document.getElementById('labor-period-start');
      const endEl = document.getElementById('labor-period-end');
      if (startEl) startEl.value = firstDay.toISOString().split('T')[0];
      if (endEl) endEl.value = lastDay.toISOString().split('T')[0];

      document.getElementById('form-labor-measurement')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById('btn-submit-labor');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Gravando...'; }
        try {
          await api(`/api/centros-custo/${costCenterId}/medicoes`, {
            method: 'POST',
            body: JSON.stringify({
              type: 'labor',
              periodStart: document.getElementById('labor-period-start')?.value,
              periodEnd: document.getElementById('labor-period-end')?.value,
              teamHours: Number(document.getElementById('labor-team-hours')?.value),
              notes: document.getElementById('labor-notes')?.value || null,
            }),
          });
          toast('Medição de mão de obra registrada com sucesso.');
          await loadAndRender();
          if (typeof window.refreshBudgetComparisonData === 'function') window.refreshBudgetComparisonData();
        } catch (err) {
          toast(err.message, true);
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Registrar Medição de Equipe'; }
        }
      });
    }

    function renderContractTab(container) {
      const contractValue = budgetData?.summary?.contractValue || 0;
      const totalBilled = (measurementsData.contracts || []).reduce((acc, m) => acc + Number(m.measured_amount || 0), 0);
      const balanceToBill = contractValue - totalBilled;
      const nextNumber = (measurementsData.contracts || []).length + 1;

      container.innerHTML = `
        <div class="measurements-kpi-row">
          <div class="measurements-kpi-card"><span>Valor Contratual</span><strong>${fmtMoney(contractValue)}</strong></div>
          <div class="measurements-kpi-card highlight"><span>Total Medido ao Cliente</span><strong>${fmtMoney(totalBilled)}</strong></div>
          <div class="measurements-kpi-card"><span>Saldo a Faturar</span><strong>${fmtMoney(balanceToBill)}</strong></div>
        </div>
        <div class="measurements-body">
          <form class="measurement-form-card" id="form-contract-measurement">
            <h4>Registrar Nova Medição Contratual ao Cliente</h4>
            <div class="measurement-form-grid">
              <div><label>Nº da Medição</label><input type="number" min="1" id="contract-meas-number" value="${nextNumber}" required /></div>
              <div><label>Data Início</label><input type="date" id="contract-period-start" required /></div>
              <div><label>Data Fim</label><input type="date" id="contract-period-end" required /></div>
              <div><label>Valor Medido (R$)</label><input type="number" step="0.01" min="0.01" id="contract-amount" placeholder="0,00" required /></div>
              <div class="measurement-field-full"><label>Observações / Boletim de Medição</label><input type="text" id="contract-notes" placeholder="ex: 1ª Medição quinzenal aprovada pela fiscalização" /></div>
            </div>
            <div class="measurement-form-actions">
              <button type="submit" class="btn primary" id="btn-submit-contract" style="background:#0284c7;">Registrar Medição Contratual</button>
            </div>
          </form>

          <div class="measurements-table-card">
            <div class="measurements-table-title">Medições de Faturamento Contratual (${(measurementsData.contracts || []).length})</div>
            <table class="measurements-table cc-mobile-table">
              <thead><tr><th>Medição</th><th>Período</th><th>Valor Medido</th><th>Status</th><th>Boletim</th></tr></thead>
              <tbody>
                ${(measurementsData.contracts || []).length === 0 ? '<tr><td colspan="5" style="text-align:center;padding:16px;color:#94a3b8;">Nenhuma medição contratual registrada.</td></tr>' : ''}
                ${(measurementsData.contracts || []).map(m => `
                  <tr>
                    <td data-label="Medição"><strong>Medição ${String(m.measurement_number).padStart(2, '0')}</strong></td>
                    <td data-label="Período">${esc(m.period_start)} até ${esc(m.period_end)}</td>
                    <td data-label="Valor Medido"><strong style="color:#059669;">${fmtMoney(m.measured_amount)}</strong></td>
                    <td data-label="Status"><span class="pill ativo" style="font-size:0.72rem;">Aprovada</span></td>
                    <td data-label="Boletim"><button type="button" class="btn secondary" data-boletim-id="${m.id}" aria-label="Emitir boletim da medição ${String(m.measurement_number).padStart(2, '0')} de ${esc(m.period_start)} a ${esc(m.period_end)}" title="Emitir boletim desta medição" style="font-size:0.72rem;padding:3px 8px;">Emitir Boletim</button></td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

      container.querySelectorAll('[data-boletim-id]').forEach(btn => {
        btn.addEventListener('click', () => {
          const m = (measurementsData.contracts || []).find(x => x.id === btn.dataset.boletimId);
          window.openBudgetClientReport?.(costCenterId, center, budgetData, m, measurementsData.contracts);
        });
      });

      document.getElementById('form-contract-measurement')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById('btn-submit-contract');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Gravando...'; }
        try {
          await api(`/api/centros-custo/${costCenterId}/medicoes`, {
            method: 'POST',
            body: JSON.stringify({
              type: 'contract',
              measurementNumber: Number(document.getElementById('contract-meas-number')?.value),
              periodStart: document.getElementById('contract-period-start')?.value,
              periodEnd: document.getElementById('contract-period-end')?.value,
              measuredAmount: Number(document.getElementById('contract-amount')?.value),
              notes: document.getElementById('contract-notes')?.value || null,
            }),
          });
          toast('Medição contratual registrada com sucesso.');
          await loadAndRender();
        } catch (err) {
          toast(err.message, true);
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Registrar Medição Contratual'; }
        }
      });
    }

      backdrop.querySelectorAll('.measurements-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        backdrop.querySelectorAll('.measurements-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTab = btn.dataset.tab;
        backdrop.querySelectorAll('.measurements-tab-btn').forEach(b => b.setAttribute('aria-selected', String(b === btn)));
        renderCurrentTab();
      });
    });

    loadAndRender();
  }

  window.openBudgetMeasurementsModal = openBudgetMeasurementsModal;
})();
