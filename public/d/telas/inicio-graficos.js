// Inicio: evolucao mensal de 12 meses (barras de receitas e despesas) com medias e margem.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const I = D.inicio = D.inicio || {};
  const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  // Topo do eixo "redondo" (1, 2, 2,5 ou 5 vezes 10^n) e 5 divisoes.
  function topoEixo(max) {
    if (max <= 0) return 1000;
    const bruto = max / 5;
    const pot = 10 ** Math.floor(Math.log10(bruto));
    const passo = [1, 2, 2.5, 5, 10].map((m) => m * pot).find((p) => p >= bruto);
    return passo * 5;
  }
  const rotuloEixo = (v) => {
    if (!v) return '0';
    if (v >= 1e6) return `${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
    if (v >= 1000) return `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
    return v.toLocaleString('pt-BR');
  };

  I.grafico = function (tendencia) {
    const meses = (tendencia || []).slice(-12);
    const W = 700;
    const H = 292;
    const base = 262; // linha do zero
    const alto = 240; // altura util das barras
    const esquerda = 52;
    const max = topoEixo(Math.max(0, ...meses.map((m) => Math.max(Number(m.receitas) || 0, Number(m.despesas) || 0))));
    const passoX = (W - esquerda - 8) / Math.max(1, meses.length);
    const larg = Math.min(18, passoX / 2 - 4);
    const linhas = [];
    const rotulosY = [];
    for (let i = 0; i <= 5; i += 1) {
      const v = (max / 5) * i;
      const y = base - (v / max) * alto;
      linhas.push(`<line x1="${esquerda}" x2="${W}" y1="${y}" y2="${y}" stroke="var(--color-divider)" stroke-width="1" vector-effect="non-scaling-stroke"></line>`);
      rotulosY.push(`<span class="eixo-y" style="top:${y - 8}px">${esc(rotuloEixo(v))}</span>`);
    }
    const barras = [];
    const rotulosX = [];
    meses.forEach((m, i) => {
      const r = Number(m.receitas) || 0;
      const d = Number(m.despesas) || 0;
      const x = esquerda + 8 + i * passoX + (passoX - (larg * 2 + 2)) / 2;
      const h1 = (r / max) * alto;
      const h2 = (d / max) * alto;
      const nome = MES_CURTO[Number(String(m.mes).slice(5, 7)) - 1] || '';
      barras.push(`<rect x="${x}" y="${base - h1}" width="${larg}" height="${h1}" rx="3" fill="#12a9d1"><title>${esc(`${nome} · receitas ${CC.money(r)}`)}</title></rect>`);
      barras.push(`<rect x="${x + larg + 2}" y="${base - h2}" width="${larg}" height="${h2}" rx="3" fill="#e0803a"><title>${esc(`${nome} · despesas ${CC.money(d)}`)}</title></rect>`);
      rotulosX.push(`<span class="eixo-x" style="left:${(((x + larg + 1) / W) * 100).toFixed(2)}%">${esc(nome)}</span>`);
    });
    return `<div class="grafico">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" width="100%" height="${H}" role="img" aria-label="Receitas e despesas dos últimos 12 meses">${linhas.join('')}${barras.join('')}</svg>
      ${rotulosY.join('')}${rotulosX.join('')}</div>`;
  };

  // Medias dos 12 meses e margem media ((receitas - despesas) / receitas).
  I.medias = function (tendencia) {
    const meses = (tendencia || []).slice(-12);
    const n = meses.length || 1;
    const r = meses.reduce((s, m) => s + (Number(m.receitas) || 0), 0) / n;
    const d = meses.reduce((s, m) => s + (Number(m.despesas) || 0), 0) / n;
    const margem = r > 0 ? `${Math.round(((r - d) / r) * 100)}%` : '—';
    const item = (rotulo, valor, cls) => `<span class="media"><span>${esc(rotulo)}</span><b class="${cls}">${esc(valor)}</b></span>`;
    return `<div class="medias">${item('Média mensal de receitas', CC.moneyShort(r), 'rec')}${item('Média mensal de despesas', CC.moneyShort(d), 'desp')}${item('Margem média', margem, '')}</div>`;
  };
})(window.CC);
