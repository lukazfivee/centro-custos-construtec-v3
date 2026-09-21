(() => {
  const token = () => localStorage.getItem('cc_token') || '';
  const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(path) {
    const res = await fetch(path, {
      headers: {
        Authorization: `Bearer ${token()}`,
        'Content-Type': 'application/json',
      },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.erro || json.error || `Erro HTTP ${res.status}`);
    return json;
  }

  async function renderPortfolioCockpit() {
    const viewCentros = document.getElementById('view-centros');
    if (!viewCentros) return;
    // Sem sessão ativa não há o que consultar: evita 401 desnecessário no login.
    if (!token() || document.getElementById('app')?.classList.contains('oculto')) return;

    let container = document.getElementById('portfolio-cockpit-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'portfolio-cockpit-container';
      const cardsGrid = document.getElementById('lista-centros-cards');
      if (cardsGrid) {
        viewCentros.insertBefore(container, cardsGrid);
      } else {
        viewCentros.appendChild(container);
      }
    }

    try {
      const data = await api('/api/centros-custo/portfolio-summary');
      const p = data.portfolio;
      if (!p) return;

      const burnClass = p.burnRatePercent > 100 ? 'danger' : p.burnRatePercent > 80 ? 'highlight' : 'good';
      const riskHtml = p.atRiskCount > 0
        ? `
          <div class="portfolio-risk-alert">
            <div>
              <strong>Atenção Executiva: ${p.atRiskCount} obra(s) com consumo acima de 80% ou estouro de orçamento:</strong>
              <span style="margin-left:8px;font-size:0.75rem;">${p.atRiskCenters.map(c => `<strong>${esc(c.code)}</strong> (${c.burnRate}%)`).join(', ')}</span>
            </div>
            <span style="font-weight:700;">Risco Ativo</span>
          </div>`
        : `
          <div class="portfolio-risk-ok">
            <strong>Todas as obras da carteira operando dentro dos limites orçamentários normatizados.</strong>
          </div>`;

      container.innerHTML = `
        <div class="portfolio-cockpit">
          <div class="portfolio-cockpit-header">
            <div class="portfolio-cockpit-title">
              <h2>Cockpit Executivo da Carteira de Obras</h2>
              <p>Visão consolidada multi-obras, faturamento e controle orçamentário global da Construtec</p>
            </div>
            <span class="portfolio-badge-pill">${p.integratedWorksCount} Obra(s) com Baseline Ativa</span>
          </div>

          <div class="portfolio-kpi-grid">
            <div class="portfolio-kpi-card">
              <span>Obras na Carteira</span>
              <strong>${p.totalCenters} (${p.statusCounts.execucao || 0} em execução)</strong>
            </div>
            <div class="portfolio-kpi-card">
              <span>Valor Contratual Total</span>
              <strong>${fmtMoney(p.totalContractValue)}</strong>
            </div>
            <div class="portfolio-kpi-card ${burnClass}">
              <span>Realizado Líquido Global</span>
              <strong>${fmtMoney(p.totalRealizedCost)}</strong>
            </div>
            <div class="portfolio-kpi-card ${p.totalBalance < 0 ? 'danger' : 'good'}">
              <span>Saldo Disponível da Carteira</span>
              <strong>${fmtMoney(p.totalBalance)}</strong>
            </div>
            <div class="portfolio-kpi-card">
              <span>Horas de Equipe Medidas</span>
              <strong>${p.laborHours.consumed}h / ${p.laborHours.planned}h</strong>
            </div>
            <div class="portfolio-kpi-card highlight">
              <span>Faturado ao Cliente</span>
              <strong>${fmtMoney(p.clientBilling.totalBilled)}</strong>
            </div>
          </div>

          ${riskHtml}
        </div>
      `;
    } catch (error) {
      if (container) {
        container.innerHTML = `
          <div class="portfolio-cockpit-error">
            <strong>Não foi possível carregar o Cockpit Executivo da Carteira.</strong>
            <span>Tente novamente em instantes ou recarregue a página.</span>
          </div>`;
      }
      if (typeof window.toast === 'function') {
        window.toast(error.message || 'Erro ao carregar o cockpit executivo da carteira.', true);
      }
    }
  }

  // Interceptar loadCenters para atualizar o cockpit automaticamente
  const origLoadCenters = window.loadCenters;
  if (typeof origLoadCenters === 'function') {
    window.loadCenters = async function() {
      const res = await origLoadCenters.apply(this, arguments);
      renderPortfolioCockpit();
      return res;
    };
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-view="centros"], [data-mobile-view="centros"]')) {
      setTimeout(renderPortfolioCockpit, 120);
    }
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(renderPortfolioCockpit, 200));
  } else {
    setTimeout(renderPortfolioCockpit, 200);
  }

  window.renderPortfolioCockpit = renderPortfolioCockpit;
})();
