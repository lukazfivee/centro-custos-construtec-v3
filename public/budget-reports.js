(() => {
  const token = () => localStorage.getItem('cc_token') || '';
  const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let closeActive;
  const fmtDate = v => /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10).split('-').reverse().join('/') : '';

  async function exportBudgetComparisonCsv(costCenterId, center, data) {
    try {
      const res = await fetch(`/api/centros-custo/${costCenterId}/orcado-realizado/csv`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) throw new Error('Falha ao gerar CSV no servidor');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeCode = (center?.codigo || data?.contract?.number || `obra-${costCenterId}`).replace(/[^a-zA-Z0-9_-]/g, '_');
      a.download = `orcado-vs-realizado-${safeCode}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (typeof window.toast === 'function') window.toast('Planilha CSV exportada com sucesso.');
    } catch (error) {
      if (typeof window.toast === 'function') window.toast(error.message || 'Erro ao exportar CSV', true);
    }
  }

  function mountReportModal(title, subtitle, sheetHtml, onCsv = null) {
    closeActive?.();
    const backdrop = document.createElement('div');
    backdrop.id = 'budget-report-backdrop';
    backdrop.className = 'budget-report-backdrop';
    backdrop.setAttribute('role', 'presentation');
    backdrop.innerHTML = `
      <div class="budget-report-modal" role="dialog" aria-modal="true" aria-labelledby="budget-report-dialog-title" onclick="event.stopPropagation()">
        <header class="budget-report-toolbar no-print">
          <div class="toolbar-title"><strong id="budget-report-dialog-title">${esc(title)}</strong><span>${esc(subtitle)}</span></div>
          <div class="toolbar-actions">
            ${onCsv ? '<button type="button" class="btn secondary" id="btn-report-download-csv" aria-label="Exportar relatório em formato CSV" title="Baixar os dados deste relatório em CSV">Exportar CSV</button>' : ''}
            <button type="button" class="btn primary" id="btn-report-print" aria-label="Imprimir relatório ou salvar como PDF" title="Imprimir relatório ou salvar como PDF">Imprimir / Salvar PDF</button>
            <button type="button" class="icon-btn" id="btn-report-close" aria-label="Fechar relatório" title="Fechar relatório"></button>
          </div>
        </header>
        <main class="budget-report-sheet">${sheetHtml}</main>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector('#btn-report-close')?.focus();
    const close = () => { backdrop.remove(); window.removeEventListener('keydown', onKey); closeActive = null; };
    closeActive = close;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('#btn-report-close')?.addEventListener('click', close);
    backdrop.querySelector('#btn-report-print')?.addEventListener('click', () => window.print());
    if (onCsv) backdrop.querySelector('#btn-report-download-csv')?.addEventListener('click', onCsv);
  }

  function openBudgetExecutiveReport(costCenterId, center, data) {
    if (!data || !data.hasBudget) {
      if (typeof window.toast === 'function') window.toast('Nenhum orçamento disponível para gerar relatório.', true);
      return;
    }
    const { summary, contract, laborHours, items, unmapped, abcCurve } = data;
    const cCode = center?.codigo || contract?.number || `Obra #${costCenterId}`;
    const cName = center?.nome ? ` — ${center.nome}` : '';
    const burnRate = summary.burnRatePercent || 0;
    const aIds = new Set((abcCurve?.a || []).map(x => x.controlItemId));
    const bIds = new Set((abcCurve?.b || []).map(x => x.controlItemId));
    const cIds = new Set((abcCurve?.c || []).map(x => x.controlItemId));
    const totalA = (abcCurve?.a || []).reduce((acc, it) => acc + (it.realizedCost || 0), 0);
    const totalB = (abcCurve?.b || []).reduce((acc, it) => acc + (it.realizedCost || 0), 0);
    const totalC = (abcCurve?.c || []).reduce((acc, it) => acc + (it.realizedCost || 0), 0);
    const totalRealizedPositive = totalA + totalB + totalC;

    const sheetHtml = `
      <header class="sheet-header">
        <div class="company-brand">
          <h1>LAC CONSTRUTEC CONSTRUTORA EIRELI</h1>
          <p>CNPJ: 34.619.651/0001-08 — Engenharia, Construção e Reformas Corporativas</p>
          <p>Av. Jorge Amado, Imbuí — Salvador / BA — supervisao@rcconstrutec.com.br</p>
        </div>
        <div class="report-meta">
          <h2>RELATÓRIO DE CONTROLE ORÇAMENTÁRIO</h2>
          <div class="meta-row"><span>Emissão:</span> <strong>${new Date().toLocaleDateString('pt-BR')}</strong></div>
          <div class="meta-row"><span>Contrato:</span> <strong>${esc(contract.number)} (REV0${contract.baselineVersion})</strong></div>
          <div class="meta-row"><span>Baseline:</span> <strong>Selo RFC 8785 Ativo</strong></div>
        </div>
      </header>
      <section class="sheet-section project-info-section">
        <div class="info-grid">
          <div><span>Obra / Centro:</span> <strong>${esc(cCode)}${esc(cName)}</strong></div>
          <div><span>Cliente:</span> <strong>${esc(center?.cliente || 'Cliente Corporativo')}</strong></div>
          <div><span>Responsável Técnico:</span> <strong>${esc(center?.responsavel || 'Equipe de Engenharia')}</strong></div>
          <div><span>Status Operacional:</span> <strong>${summary.isOverBudget ? 'Orçamento Excedido' : 'Dentro do Previsto'}</strong></div>
        </div>
      </section>
      <section class="sheet-section kpis-section">
        <h3 class="section-title">Resumo Executivo Financeiro</h3>
        <div class="report-kpi-grid">
          <div class="report-kpi-box"><span>Valor Contratual</span><strong>${fmtMoney(summary.contractValue)}</strong></div>
          <div class="report-kpi-box"><span>Custo Base Orçado</span><strong>${fmtMoney(summary.baseCost)}</strong></div>
          <div class="report-kpi-box highlight"><span>Realizado Líquido</span><strong>${fmtMoney(summary.realizedCost)}</strong></div>
          <div class="report-kpi-box"><span>Exposição Total</span><strong>${fmtMoney(summary.exposure)}</strong></div>
          <div class="report-kpi-box ${summary.isOverBudget ? 'danger' : 'good'}"><span>Saldo Disponível</span><strong>${fmtMoney(summary.balance)}</strong></div>
          <div class="report-kpi-box"><span>Consumo / Horas</span><strong>${burnRate}% — ${laborHours.consumed}h / ${laborHours.planned}h</strong></div>
        </div>
      </section>
      <section class="sheet-section abc-section">
        <h3 class="section-title">Distribuição da Curva ABC de Gastos</h3>
        <table class="report-table abc-summary-table">
          <thead><tr><th>Classe</th><th>Impacto</th><th>Itens</th><th>Realizado</th><th>% Custo Total</th></tr></thead>
          <tbody>
            <tr><td><strong>Classe A</strong></td><td>Até 80% dos gastos</td><td>${(abcCurve?.a || []).length}</td><td>${fmtMoney(totalA)}</td><td>${totalRealizedPositive > 0 ? ((totalA / totalRealizedPositive) * 100).toFixed(1) : 0}%</td></tr>
            <tr><td><strong>Classe B</strong></td><td>De 80% a 95%</td><td>${(abcCurve?.b || []).length}</td><td>${fmtMoney(totalB)}</td><td>${totalRealizedPositive > 0 ? ((totalB / totalRealizedPositive) * 100).toFixed(1) : 0}%</td></tr>
            <tr><td><strong>Classe C</strong></td><td>5% restantes</td><td>${(abcCurve?.c || []).length}</td><td>${fmtMoney(totalC)}</td><td>${totalRealizedPositive > 0 ? ((totalC / totalRealizedPositive) * 100).toFixed(1) : 0}%</td></tr>
          </tbody>
        </table>
      </section>
      ${unmapped.count > 0 ? `
        <section class="sheet-section unmapped-section">
          <h3 class="section-title" style="color:#d97706;">Lançamentos Não Mapeados (${unmapped.count})</h3>
          <table class="report-table">
            <thead><tr><th>Data</th><th>Descrição</th><th style="text-align:right;">Valor</th></tr></thead>
            <tbody>${unmapped.items.map(u => `<tr><td>${esc(u.date || '')}</td><td>${esc(u.description || 'Despesa')}</td><td style="text-align:right;">${fmtMoney(u.amount)}</td></tr>`).join('')}</tbody>
          </table>
        </section>` : ''}
      <section class="sheet-section items-section">
        <h3 class="section-title">Planilha Analítica de Itens Orçados</h3>
        <table class="report-table items-table">
          <thead><tr><th>Código</th><th>Insumo / Descrição</th><th>Tipo</th><th>Qtd</th><th style="text-align:right;">Orçado</th><th style="text-align:right;">Realizado</th><th style="text-align:right;">Desvio</th><th style="text-align:right;">Saldo</th><th>ABC</th><th>Status</th></tr></thead>
          <tbody>
            ${items.map(it => {
              const abcCls = aIds.has(it.controlItemId) ? 'A' : bIds.has(it.controlItemId) ? 'B' : cIds.has(it.controlItemId) ? 'C' : '';
              return `<tr>
                <td class="code-cell">${esc(it.code || '')}</td>
                <td><strong>${esc(it.name || it.description)}</strong></td>
                <td>${it.kind === 'labor' ? 'M. Obra' : 'Material'}</td>
                <td>${it.budgetedQuantity} ${esc(it.unit || 'un')}</td>
                <td style="text-align:right;">${fmtMoney(it.budgetedCost)}</td>
                <td style="text-align:right;">${fmtMoney(it.realizedCost)}</td>
                <td style="text-align:right;" class="${it.variance > 0 ? 'danger-text' : ''}">${fmtMoney(it.variance)}</td>
                <td style="text-align:right;" class="${it.balance < 0 ? 'danger-text' : ''}">${fmtMoney(it.balance)}</td>
                <td><span class="abc-badge ${abcCls.toLowerCase()}">${abcCls}</span></td>
                <td class="${it.isOverBudget ? 'danger-text' : it.realizedCost > 0 ? 'active-text' : 'muted-text'}">${it.isOverBudget ? 'Estourado' : it.realizedCost > 0 ? 'Em execução' : 'Previsto'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </section>
      <footer class="sheet-footer">
        <p>Documento eletrônico gerado pelo Centro de Custos Construtec. Sigilo corporativo restrito.</p>
      </footer>`;

    mountReportModal('Relatório Executivo de Orçado vs. Realizado', `${cCode}${cName}`, sheetHtml, () => exportBudgetComparisonCsv(costCenterId, center, data));
  }

  function openBudgetClientReport(costCenterId, center, data, measurement = null, measurements = []) {
    if (!data || !data.hasBudget) {
      if (typeof window.toast === 'function') window.toast('Nenhum orçamento disponível para gerar boletim.', true);
      return;
    }
    if (!measurement || measurement.status !== 'approved' || !measurements.some(m => m.id === measurement.id)) {
      window.toast?.('Selecione uma medição aprovada no histórico para emitir o boletim.', true);
      return;
    }
    const { summary, contract, items } = data;
    const cCode = center?.codigo || contract?.number || `Obra #${costCenterId}`;
    const cName = center?.nome ? ` — ${center.nome}` : '';
    const measNum = measurement ? `Medição Nº ${String(measurement.measurement_number || 1).padStart(2, '0')}` : 'Medição Acumulada';
    const measPeriod = `${fmtDate(measurement.period_start)} até ${fmtDate(measurement.period_end)}`;
    const measuredPeriodAmount = measurement ? Number(measurement.measured_amount || 0) : Number(summary.contractValue || 0);
    const accumulatedCents = measurements.filter(m => m.status === 'approved'
      && m.contract_id === measurement.contract_id
      && Number(m.measurement_number) <= Number(measurement.measurement_number))
      .reduce((total, m) => total + Math.round(Number(m.measured_amount) * 100), 0);
    const balanceCents = Math.round(Number(summary.contractValue) * 100) - accumulatedCents;

    const sheetHtml = `
      <header class="sheet-header">
        <div class="company-brand">
          <h1>LAC CONSTRUTEC CONSTRUTORA EIRELI</h1>
          <p>CNPJ: 34.619.651/0001-08 — Engenharia, Construção e Reformas Corporativas</p>
          <p>Av. Jorge Amado, Imbuí — Salvador / BA — supervisao@rcconstrutec.com.br</p>
        </div>
        <div class="report-meta">
          <h2>BOLETIM DE MEDIÇÃO CONTRATUAL</h2>
          <div class="meta-row"><span>Documento:</span> <strong>${measNum}</strong></div>
          <div class="meta-row"><span>Emissão:</span> <strong>${new Date().toLocaleDateString('pt-BR')}</strong></div>
          <div class="meta-row"><span>Contrato:</span> <strong>${esc(contract.number)}</strong></div>
        </div>
      </header>
      <section class="sheet-section project-info-section">
        <div class="info-grid">
          <div><span>Obra / Centro:</span> <strong>${esc(cCode)}${esc(cName)}</strong></div>
          <div><span>Cliente Contratante:</span> <strong>${esc(center?.cliente || 'Cliente Corporativo')}</strong></div>
          <div><span>Período Medido:</span> <strong>${measPeriod}</strong></div>
          <div><span>Responsável Técnico:</span> <strong>${esc(center?.responsavel || 'Equipe de Engenharia')}</strong></div>
        </div>
      </section>
      <section class="sheet-section kpis-section">
        <h3 class="section-title">Resumo Financeiro da Medição (Preços Contratuais)</h3>
        <div class="report-kpi-grid">
          <div class="report-kpi-box"><span>Valor Contratual</span><strong>${fmtMoney(summary.contractValue)}</strong></div>
          <div class="report-kpi-box highlight"><span>Valor Desta Medição</span><strong>${fmtMoney(measuredPeriodAmount)}</strong></div>
          <div class="report-kpi-box"><span>Acumulado até Esta Medição</span><strong>${fmtMoney(accumulatedCents / 100)}</strong></div>
          <div class="report-kpi-box"><span>Saldo Contratual a Medir</span><strong>${fmtMoney(balanceCents / 100)}</strong></div>
          <div class="report-kpi-box good"><span>Situação da Medição</span><strong>Aprovada p/ Faturamento</strong></div>
        </div>
      </section>
      <section class="sheet-section items-section">
        <h3 class="section-title">Referência de Itens Contratados</h3>
        <p>Quantidades contratadas de referência; este boletim não atesta execução física por item.</p>
        <table class="report-table items-table">
          <thead><tr><th>Item</th><th>Descrição</th><th>Unidade</th><th style="text-align:right;">Qtd Contratada</th></tr></thead>
          <tbody>
            ${items.map(it => `
              <tr>
                <td class="code-cell">${esc(it.code || '')}</td>
                <td><strong>${esc(it.name || it.description)}</strong></td>
                <td>${esc(it.unit || 'un')}</td>
                <td style="text-align:right;">${it.budgetedQuantity}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </section>
      <section class="sheet-section signature-section">
        <h3 class="section-title">Atesto e Liberação Técnica</h3>
        <div class="client-signature-grid">
          <div class="signature-box">
            <div class="signature-line"></div>
            <strong>LAC CONSTRUTEC CONSTRUTORA EIRELI</strong>
            <p>${esc(center?.responsavel || 'Engenheiro Responsável Técnico')}</p>
            <span>Responsável Técnico / CREA ou CAU: ____________________</span>
          </div>
          <div class="signature-box">
            <div class="signature-line"></div>
            <strong>${esc(center?.cliente || 'CLIENTE CONTRATANTE')}</strong>
            <p>Fiscalização / Gestão do Contrato</p>
            <span>Atesto e Liberação da Medição</span>
          </div>
        </div>
      </section>
      <footer class="sheet-footer">
        <p>Boletim oficial de medição contratual gerado eletronicamente pela Construtec Engenharia.</p>
        <p>Valores e quantidades aferidos conforme contrato firmado. Não contêm custos internos.</p>
      </footer>`;

    mountReportModal('Boletim de Medição (Saída Comercial)', `${cCode}${cName} — ${measNum}`, sheetHtml);
  }

  window.exportBudgetComparisonCsv = exportBudgetComparisonCsv;
  window.openBudgetExecutiveReport = openBudgetExecutiveReport;
  window.openBudgetClientReport = openBudgetClientReport;
})();
