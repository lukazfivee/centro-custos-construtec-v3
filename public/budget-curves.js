// ==========================================================================
// CURVA S FÍSICO-FINANCEIRA E PREVISÃO DE TÉRMINO (EAC / EVM)
// Visualização Executiva e Projeção Matemática - Zero Emojis
// ==========================================================================

(function () {
  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let closeActive;

  function formatCurrency(val) {
    return val == null ? '' : money.format(Number(val));
  }

  function generateSvgPath(points) {
    if (!points || points.length === 0) return '';
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  }

  function buildChartSvg(timeline, baseCost) {
    const W = 800;
    const H = 260;
    const padL = 65;
    const padR = 25;
    const padT = 20;
    const padB = 40;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    let maxVal = Math.max(
      baseCost,
      ...timeline.map((t) => Math.max(t.plannedCumulative || 0, t.realizedCumulative || 0))
    );
    if (maxVal <= 0) maxVal = 1000;
    maxVal = maxVal * 1.1;

    const count = timeline.length;
    const stepX = count > 1 ? plotW / (count - 1) : plotW;

    const plannedPoints = [];
    const realizedPoints = [];

    timeline.forEach((t, i) => {
      const x = padL + i * stepX;
      const yPlanned = padT + plotH - ((t.plannedCumulative || 0) / maxVal) * plotH;
      plannedPoints.push({ x, y: yPlanned, val: t.plannedCumulative, month: t.month });

      if (t.realizedCumulative !== null && t.realizedCumulative !== undefined) {
        const yRealized = padT + plotH - (t.realizedCumulative / maxVal) * plotH;
        realizedPoints.push({ x, y: yRealized, val: t.realizedCumulative, month: t.month });
      }
    });

    const gridLines = [0, 0.25, 0.5, 0.75, 1.0].map((frac) => {
      const y = padT + plotH - frac * plotH;
      const val = frac * maxVal;
      return `
        <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" class="curve-grid-line" />
        <text x="${padL - 8}" y="${y + 3}" class="curve-axis-text" style="text-anchor: end; font-size: 9px;">${formatCurrency(val)}</text>
      `;
    }).join('');

    const xLabels = timeline.map((t, i) => {
      const x = padL + i * stepX;
      return `<text x="${x}" y="${H - 12}" class="curve-axis-text">${t.month}</text>`;
    }).join('');

    const plannedD = generateSvgPath(plannedPoints);
    const realizedD = generateSvgPath(realizedPoints);

    const plannedCircles = plannedPoints.map((p) =>
      `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" class="curve-point planned"><title>${p.month} - Previsto Acum.: ${formatCurrency(p.val)}</title></circle>`
    ).join('');

    const realizedCircles = realizedPoints.map((p) =>
      `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.2" class="curve-point realized"><title>${p.month} - Realizado Acum.: ${formatCurrency(p.val)}</title></circle>`
    ).join('');

    return `
      <svg class="curves-svg" viewBox="0 0 ${W} ${H}">
        ${gridLines}
        ${xLabels}
        <path d="${plannedD}" class="curve-path-planned" />
        <path d="${realizedD}" class="curve-path-realized" />
        ${plannedCircles}
        ${realizedCircles}
      </svg>
    `;
  }

  window.openBudgetCurveSModal = async function (costCenterId, center, budgetData) {
    closeActive?.();

    const backdrop = document.createElement('div');
    backdrop.id = 'budget-curves-backdrop';
    backdrop.className = 'budget-curves-backdrop';

    backdrop.innerHTML = `
      <div class="budget-curves-modal" role="dialog" aria-modal="true" aria-labelledby="curves-dialog-title">
        <div class="budget-curves-header">
          <div class="curves-header-titles">
            <span class="curves-header-eyebrow">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3"/></svg>
              Análise de Tendência & EVM
            </span>
            <h2 class="curves-header-title" id="curves-dialog-title">Curva S Físico-Financeira — ${esc(center?.nome || 'Obra')}</h2>
            <span class="curves-header-sub">Contrato: ${esc(center?.contrato || 'N/D')} — Carregando projeções...</span>
          </div>
          <button class="budget-curves-close" id="curves-btn-close" type="button" aria-label="Fechar análise da Curva S" title="Fechar análise da Curva S"></button>
        </div>
        <div class="budget-curves-body" id="curves-body-content">
          <div style="text-align: center; padding: 40px; color: #64748b;">Carregando dados da Curva S e projeção EAC...</div>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    document.getElementById('curves-btn-close')?.focus();

    const closeModal = () => {
      window.removeEventListener('keydown', onEsc);
      backdrop.remove();
      if (closeActive === closeModal) closeActive = null;
    };
    closeActive = closeModal;

    const onEsc = (e) => {
      if (e.key === 'Escape') closeModal();
    };

    window.addEventListener('keydown', onEsc);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });
    document.getElementById('curves-btn-close')?.addEventListener('click', closeModal);

    try {
      const res = await fetch(`/api/centros-custo/${costCenterId}/curva-s`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('cc_token') || ''}` },
      });
      if (!res.ok) throw new Error(`Erro ${res.status} ao carregar dados da Curva S`);
      const data = await res.json();
      if (backdrop.isConnected) renderCurveContent(data, center);
    } catch (err) {
      const body = backdrop.querySelector('#curves-body-content');
      if (body) {
        body.innerHTML = `<div style="padding: 24px; color: #ef4444; background: rgba(239, 68, 68, 0.1); border-radius: 8px;">
          <strong>Falha ao carregar análise de Curva S:</strong> ${esc(err.message)}
        </div>`;
      }
    }
  };

  function renderCurveContent(data, center) {
    const body = document.getElementById('curves-body-content');
    if (!body) return;

    const evm = data.evm || {};
    const timeline = data.timeline || [];
    const baseCost = Number(data.center?.baseCost || 0);
    const subtitle = document.querySelector('#budget-curves-backdrop .curves-header-sub');
    if (subtitle) subtitle.textContent = `Contrato: ${data.center?.contractNumber || 'N/D'} — ${data.center?.startMonth || ''} a ${data.center?.endMonth || ''}`;

    const isOver = Boolean(evm.isOverBudget);
    const vacClass = evm.vac == null ? '' : isOver ? 'danger' : 'positive';
    const cpiClass = evm.cpi == null ? '' : evm.cpi >= 1.0 ? 'positive' : evm.cpi >= 0.85 ? 'accent' : 'danger';

    const svgChart = buildChartSvg(timeline, baseCost);

    const tableRows = timeline.map((t) => `
      <tr>
        <td><strong>${t.month}</strong></td>
        <td data-label="Previsto Mês">${formatCurrency(t.plannedMonth)}</td>
        <td data-label="Previsto Acum." style="color: #085ce5; font-weight: 600;">${formatCurrency(t.plannedCumulative)}</td>
        <td data-label="Realizado Mês">${t.realizedMonth !== null ? formatCurrency(t.realizedMonth) : ''}</td>
        <td data-label="Realizado Acum." style="color: #10b981; font-weight: 700;">${t.realizedCumulative !== null ? formatCurrency(t.realizedCumulative) : ''}</td>
        <td data-label="Medido Mês">${t.measuredMonth !== null ? formatCurrency(t.measuredMonth) : ''}</td>
        <td data-label="Medido Acum.">${t.measuredCumulative !== null ? formatCurrency(t.measuredCumulative) : ''}</td>
      </tr>
    `).join('');

    body.innerHTML = `
      <div class="curves-kpi-grid">
        <div class="curves-kpi-card">
          <span class="curves-kpi-label">Custo Base (BAC)</span>
          <span class="curves-kpi-val">${formatCurrency(evm.bac)}</span>
          <span class="curves-kpi-sub">Orçamento aprovado</span>
        </div>

        <div class="curves-kpi-card">
          <span class="curves-kpi-label">Realizado Atual (AC)</span>
          <span class="curves-kpi-val ${evm.ac > evm.bac ? 'danger' : ''}">${formatCurrency(evm.ac)}</span>
          <span class="curves-kpi-sub">Consumo: ${evm.financialBurnPercent || 0}%</span>
        </div>

        <div class="curves-kpi-card">
          <span class="curves-kpi-label">Valor Agregado (EV)</span>
          <span class="curves-kpi-val accent">${formatCurrency(evm.ev)}</span>
          <span class="curves-kpi-sub">Proporção comercial medida: ${evm.physicalPercent ?? ''}%</span>
        </div>

        <div class="curves-kpi-card">
          <span class="curves-kpi-label">Índice Custo (CPI)</span>
          <span class="curves-kpi-val ${cpiClass}">${evm.cpi == null ? '' : Number(evm.cpi).toFixed(2)}</span>
          <span class="curves-kpi-sub">${evm.cpi == null ? 'Sem base para projeção' : evm.cpi >= 1 ? 'Ritmo econômico estimado' : 'Sobrecusto estimado'}</span>
        </div>

        <div class="curves-kpi-card ${isOver ? 'warning-box' : 'highlight'}">
          <span class="curves-kpi-label">Projetado Término (EAC)</span>
          <span class="curves-kpi-val ${vacClass}">${formatCurrency(evm.eac)}</span>
          <span class="curves-kpi-sub">Fórmula EVM PMBOK</span>
        </div>

        <div class="curves-kpi-card ${isOver ? 'warning-box' : 'highlight'}">
          <span class="curves-kpi-label">Desvio Término (VAC)</span>
          <span class="curves-kpi-val ${vacClass}">${formatCurrency(evm.vac)}</span>
          <span class="curves-kpi-sub">${evm.projectedStatus}</span>
        </div>
      </div>

      <div class="curves-chart-card">
        <div class="curves-chart-header">
          <strong style="font-size: 0.88rem;">Evolução Temporal Acumulada (Previsto vs. Realizado Líquido)</strong>
          <div class="curves-chart-legend">
            <div class="legend-item"><span class="legend-swatch planned"></span> <span>Previsto Acumulado (S-Curve)</span></div>
            <div class="legend-item"><span class="legend-swatch realized"></span> <span>Realizado Líquido Acumulado</span></div>
          </div>
        </div>
        <div class="curves-svg-wrapper">${svgChart}</div>
      </div>

      <div class="curves-table-card">
        <table class="curves-table cc-mobile-table">
          <thead>
            <tr>
              <th>Mês</th>
              <th>Previsto Mês</th>
              <th>Previsto Acum.</th>
              <th>Realizado Mês</th>
              <th>Realizado Acum.</th>
              <th>Medido Mês</th>
              <th>Medido Acum.</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </div>

      <div class="curves-hypotheses-box">
        <strong>Premissas da Metodologia de Projeção:</strong>
        <ul style="margin: 6px 0 0 16px; padding: 0;">
          ${(data.hypotheses || []).map((h) => `<li>${h}</li>`).join('')}
        </ul>
      </div>
    `;
  }
})();
