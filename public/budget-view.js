(() => {
  const token = () => localStorage.getItem('cc_token') || '';
  const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || data.error || `Erro ${res.status}`);
    return data;
  }

  function toast(msg, isError = false) {
    if (typeof window.toast === 'function') return window.toast(msg, isError);
    const el = document.getElementById('toast');
    if (el) { el.textContent = msg; el.className = `toast${isError ? ' error' : ''}`; setTimeout(() => el.classList.add('oculto'), 3500); }
  }

  function injectBudgetDetailButton(costCenterId) {
    if (!costCenterId) return;
    const actions = document.querySelector('.center-detail-actions');
    if (!actions || document.getElementById('btn-ver-orcado-realizado')) return;
    const btn = document.createElement('button');
    btn.id = 'btn-ver-orcado-realizado';
    btn.className = 'btn primary';
    btn.type = 'button';
    btn.title = 'Abrir a análise de orçamento desta obra';
    btn.innerHTML = 'Análise de Orçamento';
    btn.onclick = () => openBudgetViewModal(costCenterId);
    actions.prepend(btn);
  }

  function injectImportButton() {
    const headActions = document.querySelector('#view-centros .page-head-actions');
    if (!headActions || document.getElementById('btn-importar-orcamento-view')) return;
    const importBtn = document.createElement('button');
    importBtn.id = 'btn-importar-orcamento-view';
    importBtn.className = 'btn secondary';
    importBtn.type = 'button';
    importBtn.title = 'Importar uma proposta aprovada em formato JSON';
    importBtn.style.cssText = 'border-color:#0284c7;color:#0284c7;';
    importBtn.innerHTML = 'Importar Orçamento';
    importBtn.onclick = () => openImportBudgetDialog();
    headActions.insertBefore(importBtn, headActions.firstChild);
  }

  const origOpenCenterDetail = window.openCenterDetail;
  if (typeof origOpenCenterDetail === 'function') {
    window.openCenterDetail = async function(id) {
      await origOpenCenterDetail.apply(this, arguments);
      injectBudgetDetailButton(id);
    };
  }

  const origLoadCenters = window.loadCenters;
  if (typeof origLoadCenters === 'function') {
    window.loadCenters = async function() {
      const res = await origLoadCenters.apply(this, arguments);
      injectImportButton();
      return res;
    };
  }

  document.addEventListener('click', (e) => {
    const card = e.target.closest('.center-card[data-center-id]');
    if (card && !e.target.closest('[data-edit-center]')) {
      const id = Number(card.dataset.centerId);
      if (id) { setTimeout(() => injectBudgetDetailButton(id), 60); setTimeout(() => injectBudgetDetailButton(id), 250); }
    }
    if (e.target.closest('[data-view="centros"], [data-mobile-view="centros"]')) {
      setTimeout(injectImportButton, 100); setTimeout(injectImportButton, 400);
    }
  }, true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectImportButton);
  else injectImportButton();

  async function openBudgetViewModal(costCenterId, center = null) {
    if (typeof window.modal !== 'function') return;
    window.modal('Carregando Orçado vs. Realizado...', '<div style="padding:40px;text-align:center;">Buscando dados orçamentários...</div>');
    const modalBox = document.querySelector('#modal-fundo .modal');
    if (modalBox) modalBox.classList.add('budget-modal-wide');
    const modalContent = document.querySelector('#modal-corpo');
    try {
      if (!center || !center.codigo) {
        const cData = await api(`/api/centros-custo/${costCenterId}/detalhes`).catch(() => null);
        if (cData && cData.centro) center = cData.centro;
      }
      const data = await api(`/api/centros-custo/${costCenterId}/orcado-realizado`);
      if (!center || !center.codigo) {
        center = { codigo: data.contract?.number || `Obra #${costCenterId}`, nome: center?.nome || '' };
      }
      renderBudgetView(data, costCenterId, center);
    } catch (error) {
      if (modalContent) modalContent.innerHTML = `<div class="form-error" style="padding:20px;">${esc(error.message)}</div>`;
    }
  }

  function renderBudgetView(data, costCenterId, center) {
    const modalTitle = document.querySelector('#modal-titulo');
    const cCode = center?.codigo || data.contract?.number || `Obra #${costCenterId}`;
    const cName = center?.nome ? ` — ${center.nome}` : '';
    if (modalTitle) modalTitle.textContent = `Orçado vs. Realizado — ${cCode}${cName}`;
    const modalContent = document.querySelector('#modal-corpo');
    if (!modalContent) return;

    if (!data.hasBudget) {
      modalContent.innerHTML = `
        <div class="budget-view-container" style="padding:24px;text-align:center;">
          <h3 style="margin-bottom:8px;">Nenhum Orçamento Integrado</h3>
          <p class="muted" style="max-width:500px;margin:0 auto 20px auto;">Esta obra ainda não possui uma baseline orçamentária importada do <strong>Construtec Orçamentos</strong>.</p>
          <div><button type="button" class="btn primary budget-accent" id="btn-importar-neste-centro" title="Selecionar e importar o pacote JSON da proposta aprovada">Importar Pacote de Proposta Aprovada</button></div>
        </div>`;
      document.getElementById('btn-importar-neste-centro')?.addEventListener('click', () => openImportBudgetDialog(costCenterId));
      return;
    }

    const { summary, contract, laborHours, items, unmapped, abcCurve } = data;
    const burnRate = summary.burnRatePercent || 0;
    const burnClass = burnRate > 100 ? 'over' : burnRate > 80 ? 'warn' : 'ok';

    modalContent.innerHTML = `
      <div class="budget-view-container">
        <div class="budget-header-card">
          <div class="budget-header-info">
            <h3>Contrato: ${esc(contract.number)} <span class="budget-pill-rev">REV0${contract.baselineVersion}</span></h3>
            <p>Baseline ativa com selo canônico de aprovação imutável</p>
          </div>
          <div><button type="button" class="btn secondary" id="btn-atualizar-revisao-btn" title="Selecionar uma nova revisão aprovada do orçamento para importar" style="font-size:0.8rem;">Atualizar Revisão / Importar</button></div>
        </div>
        <div class="budget-health-panel ${summary.isOverBudget ? 'danger' : 'ok'}">
          <div class="budget-health-main">
            <span class="budget-health-label">Saldo Disponível</span>
            <strong class="budget-health-value">${fmtMoney(summary.balance)}</strong>
          </div>
          <div class="budget-health-burn">
            <div class="budget-burn-labels">
              <span>Consumo do Orçamento: <strong>${burnRate}%</strong></span>
              <span class="budget-health-pill">${summary.isOverBudget ? 'Orçamento Excedido' : 'Dentro do Previsto'}</span>
            </div>
            <div class="budget-burn-track"><div class="budget-burn-fill ${burnClass}" style="transform: scaleX(${Math.min(burnRate, 100) / 100});"></div></div>
            ${(() => {
              if (!summary.isOverBudget) return '';
              const worst = [...items].filter(i => i.isOverBudget).sort((a, b) => a.balance - b.balance)[0];
              if (!worst) return '';
              return `<div class="budget-burn-hint">Maior desvio: <strong>${esc(worst.name)}</strong> (saldo ${fmtMoney(worst.balance)}) — confira a Planilha Analítica abaixo.</div>`;
            })()}
          </div>
        </div>
        <div class="budget-kpis-grid">
          <div class="budget-kpi-card"><span>Realizado Líquido</span><strong style="color:#0284c7;">${fmtMoney(summary.realizedCost)}</strong></div>
          <button type="button" class="budget-kpi-card budget-kpi-action" id="btn-kpi-labor-hours" aria-label="Abrir medições de mão de obra: ${laborHours.consumed} de ${laborHours.planned} horas utilizadas" title="Abrir medições de mão de obra"><span>Horas da Equipe</span><strong>${laborHours.consumed}h / ${laborHours.planned}h</strong></button>
          <div class="budget-kpi-card reference"><span>Valor Contratual</span><strong>${fmtMoney(summary.contractValue)}</strong></div>
          <div class="budget-kpi-card reference"><span>Custo Base Orçado</span><strong>${fmtMoney(summary.baseCost)}</strong></div>
          <div class="budget-kpi-card reference"><span>Exposição Total</span><strong>${fmtMoney(summary.exposure)}</strong></div>
        </div>
        ${(() => {
          const naoVinculado = Math.max(0, Number(center?.total_despesas || 0) - Number(summary.realizedCost || 0));
          if (naoVinculado <= 0.01) return '';
          return `<div class="budget-unmapped-card">
            <div class="budget-unmapped-header">
              <div><strong style="color:#d97706;">Atenção: gastos do centro fora do orçamento</strong><div style="font-size:0.75rem;color:var(--muted);">Este centro tem ${fmtMoney(center.total_despesas)} em lançamentos (aba Detalhamento), mas apenas ${fmtMoney(summary.realizedCost)} foi reconhecido aqui. Registre uma apropriação para os lançamentos restantes.</div></div>
              <strong style="color:#d97706;">${fmtMoney(naoVinculado)}</strong>
            </div>
          </div>`;
        })()}
        ${unmapped.count > 0 ? `
          <div class="budget-unmapped-card">
            <div class="budget-unmapped-header">
              <div><strong style="color:#d97706;">Atenção: ${unmapped.count} lançamento(s) não mapeado(s)</strong><div style="font-size:0.75rem;color:var(--muted);">Custos associados à obra mas sem vínculo à linha orçamentária.</div></div>
              <strong style="color:#d97706;">${fmtMoney(unmapped.totalCost)}</strong>
            </div>
            ${unmapped.items.map(u => `
              <div class="budget-unmapped-item">
                <div><strong>${esc(u.description || 'Despesa')}</strong><span class="muted"> · ${fmtMoney(u.amount)}</span></div>
                <button type="button" class="btn-budget-action" data-map-id="${u.id}" data-contract-id="${contract.id}" aria-label="Vincular ${esc(u.description || 'despesa')} a um insumo do orçamento" title="Escolher o insumo do orçamento para este lançamento">Vincular a Insumo</button>
              </div>`).join('')}
          </div>` : ''}
        <div class="budget-table-section">
          <div class="budget-table-header">
            <h4>Planilha Analítica de Itens Orçados</h4>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <select id="budget-filter-kind" aria-label="Filtrar por tipo de insumo" style="padding:4px 8px;border-radius:6px;font-size:0.8rem;border:1px solid var(--line);"><option value="">Todos os insumos</option><option value="material">Materiais</option><option value="labor">Mão de Obra</option></select>
              <button type="button" class="btn secondary" id="btn-budget-measurements" title="Abrir medições de mão de obra e contrato" style="font-size:0.75rem;padding:4px 10px;">Medições</button>
              <button type="button" class="btn secondary" id="btn-budget-curves" title="Abrir a Curva S físico-financeira" style="font-size:0.75rem;padding:4px 10px;">Curva S</button>
              <button type="button" class="btn secondary" id="btn-budget-export-csv" aria-label="Exportar comparação entre orçado e realizado em CSV" title="Baixar a comparação entre orçado e realizado em CSV" style="font-size:0.75rem;padding:4px 10px;">Exportar CSV</button>
              <button type="button" class="btn primary budget-accent" id="btn-budget-open-report" title="Abrir o relatório executivo desta obra" style="font-size:0.75rem;padding:4px 10px;">Relatório Executivo</button>
            </div>
          </div>
          <div class="budget-table-scroll">
            <table class="budget-table cc-mobile-table">
              <thead><tr><th>Código</th><th>Insumo / Descrição</th><th>Tipo</th><th>Qtd Orçada</th><th>Custo Orçado</th><th>Realizado</th><th>Desvio</th><th>Saldo</th><th>Curva ABC</th></tr></thead>
              <tbody id="budget-items-tbody">${renderTableRows(items, abcCurve)}</tbody>
            </table>
          </div>
        </div>
      </div>`;

    window.refreshBudgetComparisonData = () => openBudgetViewModal(costCenterId, center);
    const openMeas = (tab) => window.openBudgetMeasurementsModal?.(costCenterId, center, data, tab);
    document.getElementById('btn-budget-measurements')?.addEventListener('click', () => openMeas('labor'));
    document.getElementById('btn-kpi-labor-hours')?.addEventListener('click', () => openMeas('labor'));
    document.getElementById('btn-budget-curves')?.addEventListener('click', () => window.openBudgetCurveSModal?.(costCenterId, center, data));
    document.getElementById('btn-atualizar-revisao-btn')?.addEventListener('click', () => openImportBudgetDialog(costCenterId));
    document.getElementById('btn-budget-export-csv')?.addEventListener('click', () => window.exportBudgetComparisonCsv?.(costCenterId, center, data));
    document.getElementById('btn-budget-open-report')?.addEventListener('click', () => window.openBudgetExecutiveReport?.(costCenterId, center, data));
    document.getElementById('budget-filter-kind')?.addEventListener('change', (e) => {
      const filtered = e.target.value ? items.filter(i => i.kind === e.target.value) : items;
      const tbody = document.getElementById('budget-items-tbody');
      if (tbody) tbody.innerHTML = renderTableRows(filtered, abcCurve);
    });
    modalContent.querySelectorAll('[data-map-id]').forEach(btn => {
      btn.addEventListener('click', () => openQuickMapDialog(btn.dataset.mapId, btn.dataset.contractId, costCenterId, items, center, unmapped.count));
    });
  }

  function renderTableRows(items, abcCurve) {
    if (!items.length) return '<tr><td colspan="9" style="text-align:center;padding:20px;">Nenhum insumo encontrado.</td></tr>';
    const aIds = new Set((abcCurve.a || []).map(x => x.controlItemId));
    const bIds = new Set((abcCurve.b || []).map(x => x.controlItemId));
    const cIds = new Set((abcCurve.c || []).map(x => x.controlItemId));
    return items.map(i => {
      let abcBadge = '—';
      if (aIds.has(i.controlItemId)) abcBadge = '<span class="badge-abc badge-a">A</span>';
      else if (bIds.has(i.controlItemId)) abcBadge = '<span class="badge-abc badge-b">B</span>';
      else if (cIds.has(i.controlItemId)) abcBadge = '<span class="badge-abc badge-c">C</span>';
      const varianceColor = i.variance > 0 ? '#dc2626' : i.variance < 0 ? '#059669' : 'inherit';
      return `<tr>
        <td data-label="Código"><span class="muted">${esc(i.code || '—')}</span></td>
        <td data-label="Insumo / Descrição"><strong>${esc(i.name)}</strong></td>
        <td data-label="Tipo"><span class="badge-kind">${i.kind === 'labor' ? 'Mão de Obra' : 'Material'}</span></td>
        <td data-label="Qtd Orçada">${i.budgetedQuantity} ${esc(i.unit)}</td>
        <td data-label="Custo Orçado">${fmtMoney(i.budgetedCost)}</td>
        <td data-label="Realizado" style="font-weight:700;color:#0284c7;">${fmtMoney(i.realizedCost)}</td>
        <td data-label="Desvio" style="color:${varianceColor};font-weight:600;">${i.variance > 0 ? '+' : ''}${fmtMoney(i.variance)}</td>
        <td data-label="Saldo" style="font-weight:700;color:${i.isOverBudget ? '#dc2626' : '#059669'};">${fmtMoney(i.balance)}</td>
        <td data-label="Curva ABC">${abcBadge}</td>
      </tr>`;
    }).join('');
  }

  function openQuickMapDialog(allocId, contractId, costCenterId, items, center, unmappedCount = 0) {
    const options = items.map(i => `<option value="${i.controlItemId}">${esc(i.name)} (${esc(i.category)} - Saldo: ${fmtMoney(i.balance)})</option>`).join('');
    const formHtml = `
      <div style="padding:10px;">
        <p>Selecione a linha orçamentária correspondente para este lançamento:</p>
        <label for="select-quick-map-item" style="display:block;margin-bottom:6px;font-weight:600;">Item de Controle:</label>
        <select id="select-quick-map-item" style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--line);margin-bottom:16px;">${options}</select>
        <div style="display:flex;justify-content:flex-end;gap:10px;">
          <button type="button" class="btn secondary" onclick="closeModal();" title="Cancelar a vinculação deste lançamento">Cancelar</button>
          <button type="button" class="btn primary budget-accent" id="btn-salvar-vinculo-quick" title="Vincular o lançamento ao item selecionado">Confirmar Vínculo</button>
        </div>
      </div>`;
    window.modal('Vincular Lançamento a Item de Orçamento', formHtml);
    document.getElementById('btn-salvar-vinculo-quick')?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      const select = document.getElementById('select-quick-map-item');
      if (!select) return;
      const originalLabel = btn.textContent;
      btn.disabled = true; btn.textContent = 'Vinculando...';
      try {
        await api(`/api/centros-custo/${costCenterId}/apropriacoes`, {
          method: 'POST',
          body: JSON.stringify({ allocationId: allocId, contractId, controlItemId: select.value }),
        });
        toast(unmappedCount <= 1
          ? 'Tudo certo! Todos os lançamentos desta obra estão vinculados ao orçamento.'
          : 'Lançamento vinculado com sucesso!');
        openBudgetViewModal(costCenterId, center);
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false; btn.textContent = originalLabel;
      }
    });
  }

  function openImportBudgetDialog(targetCostCenterId = null) {
    const html = `
      <div style="padding:10px;">
        <p class="muted">Selecione o arquivo de envelope canônico <code>.json</code> exportado do <strong>Construtec Orçamentos</strong>:</p>
        <div style="border:2px dashed #0284c7;border-radius:12px;padding:30px;text-align:center;background:rgba(2,132,199,0.04);margin-bottom:16px;">
          <input type="file" id="budget-file-input" accept=".json" style="display:none;" />
          <button type="button" class="btn primary budget-accent" onclick="document.getElementById('budget-file-input').click();" title="Escolher o arquivo JSON da proposta aprovada">Selecionar Arquivo JSON</button>
          <div id="budget-file-name" style="margin-top:10px;font-size:0.85rem;color:var(--muted);">Nenhum arquivo selecionado</div>
        </div>
        <div id="budget-preview-box" style="display:none;margin-bottom:16px;padding:14px;border:1px solid var(--line);border-radius:10px;background:var(--card-bg);"></div>
        <div style="display:flex;justify-content:flex-end;gap:10px;">
          <button type="button" class="btn secondary" onclick="closeModal();" title="Fechar a janela de importação">Fechar</button>
          <button type="button" class="btn primary budget-success" id="btn-confirmar-importacao-budget" aria-label="Confirmar importação do orçamento após validação" title="Importar o orçamento validado para esta obra" style="display:none;">Confirmar Ingestão</button>
        </div>
      </div>`;
    window.modal('Importar Orçamento / Proposta Aprovada', html);

    document.getElementById('budget-file-input')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      document.getElementById('budget-file-name').textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
      try {
        const envelope = JSON.parse(await file.text());
        renderPreviewAndConfirm(envelope, 'budget-preview-box', 'btn-confirmar-importacao-budget', targetCostCenterId);
      } catch (err) {
        document.getElementById('budget-preview-box').innerHTML = `<div class="form-error">Erro ao ler pacote: ${esc(err.message)}</div>`;
      }
    });
  }

  async function renderPreviewAndConfirm(envelope, previewBoxId, confirmBtnId, targetCostCenterId) {
    const previewBox = document.getElementById(previewBoxId);
    if (!previewBox) return;
    previewBox.style.display = 'block';
    previewBox.innerHTML = '<div style="text-align:center;">Validando hash canônico e consistência...</div>';
    try {
      const previewData = await api('/api/integracao/orcamentos/previas', { method: 'POST', body: JSON.stringify(envelope) });
      if (previewData.status === 'already_imported') {
        previewBox.innerHTML = `<div style="font-size:0.85rem;"><div style="color:#0284c7;font-weight:700;margin-bottom:6px;">Proposta já integrada</div><div><strong>Proposta:</strong> ${esc(previewData.proposal?.number || '—')} REV${String(previewData.proposal?.revision ?? 0).padStart(2, '0')}</div><div>${esc(previewData.message || 'Esta revisão já está vinculada.')}</div></div>`;
        return;
      }
      if (previewData.status === 'conflict') {
        previewBox.innerHTML = `<div class="form-error">${esc(previewData.message || 'Conflito de integração detectado.')}</div>`;
        return;
      }
      previewBox.innerHTML = `
        <div style="font-size:0.85rem;line-height:1.6;">
          <div style="color:#059669;font-weight:700;margin-bottom:6px;">Envelope Canônico Válido (SHA-256 Confirmado)</div>
          <div><strong>Proposta:</strong> ${esc(previewData.proposal?.number || '—')} REV${String(previewData.proposal?.revision ?? 0).padStart(2, '0')}</div>
          <div><strong>Cliente:</strong> ${esc(previewData.client?.name || '—')}</div>
          <div><strong>Obra Proposta:</strong> ${esc(previewData.targetCostCenter?.code || '—')} — ${esc(previewData.targetCostCenter?.name || '—')}</div>
          <div><strong>Valor Contratual:</strong> ${fmtMoney(previewData.totals?.contractValue)} (Custo Base: ${fmtMoney(previewData.totals?.baseCost)})</div>
          ${previewData.isReplacement ? '<div style="margin-top:4px;color:#0284c7;font-weight:600;">Nota: Esta revisão atualizará a baseline vigente mantendo o mesmo contrato.</div>' : ''}
        </div>`;
      const confirmBtn = document.getElementById(confirmBtnId);
      if (confirmBtn) {
        confirmBtn.style.display = 'inline-block';
        confirmBtn.onclick = async () => {
          confirmBtn.disabled = true; confirmBtn.textContent = 'Gravando transação...';
          try {
            const res = await api(`/api/integracao/orcamentos/previas/${previewData.previewId}/confirmar`, {
              method: 'POST', body: JSON.stringify({ hash: previewData.hash, costCenterId: targetCostCenterId }),
            });
            toast(res.status === 'already_imported' ? 'Orçamento já estava importado.' : 'Orçamento importado com sucesso!');
            window.closeModal();
            if (typeof window.loadCenters === 'function') window.loadCenters();
          } catch (err) { toast(err.message, true); confirmBtn.disabled = false; confirmBtn.textContent = 'Tentar novamente'; }
        };
      }
    } catch (err) { previewBox.innerHTML = `<div class="form-error">${esc(err.message)}</div>`; }
  }

  async function openDirectBudgetImport(envelope) {
    if (typeof window.modal !== 'function') return;
    window.modal('Receber proposta aprovada', `
      <div style="padding:10px;">
        <div id="direct-preview-box" style="margin-bottom:16px;">Validando proposta...</div>
        <div style="display:flex;justify-content:flex-end;gap:10px;">
          <button type="button" class="btn secondary" onclick="closeModal()" title="Cancelar a integração da proposta">Cancelar</button>
          <button type="button" class="btn primary budget-accent" id="btn-confirmar-importacao-direta" aria-label="Confirmar integração da proposta aprovada" title="Integrar a proposta aprovada ao orçamento" style="display:none;">Confirmar integração</button>
        </div>
      </div>`);
    renderPreviewAndConfirm(envelope, 'direct-preview-box', 'btn-confirmar-importacao-direta', null);
  }

  const ORCAMENTOS_TRUSTED_ORIGINS = [
    'https://construtec-orcamentos-cloud.construtec-reports.workers.dev',
    'https://construtec-orcamentos.pages.dev',
    'http://localhost:5173',
    'http://localhost:4173',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:4173',
  ];

  const isTrustedBudgetOrigin = (origin) => {
    if (!origin) return false;
    if (ORCAMENTOS_TRUSTED_ORIGINS.includes(origin)) return true;
    return /^https:\/\/[a-z0-9-]+\.construtec-orcamentos\.pages\.dev$/.test(origin);
  };

  window.addEventListener('message', (event) => {
    if (!isTrustedBudgetOrigin(event.origin)) return;
    if (event.data?.type !== 'construtec:budget-envelope' || !event.data.envelope) return;
    openDirectBudgetImport(event.data.envelope);
  });
})();
