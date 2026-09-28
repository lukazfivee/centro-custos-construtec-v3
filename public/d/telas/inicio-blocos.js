// Inicio: atividades recentes, obras (realizado x orcado) e despesas por categoria.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const I = D.inicio = D.inicio || {};

  I.recentes = function (lista) {
    const itens = (lista || []).slice(0, 6);
    if (!itens.length) return D.ui.vazio('receipt', 'Nenhum lançamento neste mês.', 'Use o lançamento rápido para registrar o primeiro.');
    return itens.map((l) => {
      D.lancCache.set(String(l.id), l);
      const v = D.valorSinal(l);
      const situacao = D.situacaoTexto(l).split(' · ')[0].replace(/ em .*/, '');
      const sub = [l.centro_nome, D.data(l.data), situacao].filter(Boolean).join(' · ');
      return `<button type="button" class="linha-rec" data-lanc="${esc(l.id)}">
        <span class="ic ${v.entrada ? 'entrada' : ''}">${D.ic(v.entrada ? 'arrow-down-left' : 'arrow-up-right')}</span>
        <span class="tx"><b>${esc(l.descricao)}</b><span>${esc(sub)}</span></span>
        <span class="v ${v.entrada ? 'entrada' : ''}">${esc(v.texto)}</span></button>`;
    }).join('');
  };

  // Cores da regra do orcamento: ate 80%, acima de 80% e acima de 100%.
  const faixa = (p) => (p > 1 ? 'estourado' : (p > 0.8 ? 'alerta' : 'normal'));

  I.obras = function (porCentro) {
    const itens = (porCentro || []).filter((o) => Number(o.orcamento) > 0 || Number(o.qtd_lancamentos) > 0).slice(0, 5);
    if (!itens.length) return D.ui.vazio('buildings', 'Nenhuma obra com movimento neste mês.');
    return itens.map((o) => {
      const orcado = Number(o.orcamento) || 0;
      const real = Number(o.comprometido) || 0;
      const p = orcado > 0 ? real / orcado : 0;
      const barra = orcado > 0
        ? `<span class="bar"><span class="${faixa(p)}" style="width:${Math.min(100, p * 100).toFixed(1)}%"></span></span>
           <span class="pct ${faixa(p)}">${Math.round(p * 100)}% do orçado${p > 1 ? ' · estourado' : ''}</span>`
        : '<span class="pct muted">Sem orçamento do mês</span>';
      return `<a class="linha-obra" href="#/obras/${esc(o.id)}">
        <span class="tx"><b>${esc(o.nome)}</b><span>${esc([o.codigo, o.cliente].filter(Boolean).join(' · '))}</span></span>
        <span class="uso">${barra}</span>
        <span class="num"><b>${esc(CC.moneyShort(real))}</b><span class="muted"> / ${esc(orcado > 0 ? CC.moneyShort(orcado) : '—')}</span></span></a>`;
    }).join('');
  };

  I.categorias = function (porCategoria) {
    const itens = (porCategoria || []).filter((c) => c.tipo === 'despesa' && Number(c.total) > 0).slice(0, 8);
    if (!itens.length) return D.ui.vazio('tag', 'Nenhuma despesa neste mês.');
    const max = Math.max(...itens.map((c) => Number(c.total)));
    return itens.map((c) => `<div class="linha-cat">
      <span class="topo"><span>${esc(c.categoria)}</span><b>${esc(CC.money(c.total))}</b></span>
      <span class="bar"><span style="width:${((Number(c.total) / max) * 100).toFixed(1)}%"></span></span></div>`).join('');
  };

  // Banner de primeiro uso: os mesmos passos do sistema atual. "Marcar como concluído" vale para este computador.
  const CHAVE_BANNER = 'cc_first_use_dismissed';
  I.primeiroUso = async function (alvo) {
    let dispensado = false;
    try { dispensado = localStorage.getItem(CHAVE_BANNER) === 'true'; } catch { /* segue */ }
    if (dispensado) return;
    let data;
    try { ({ data } = await CC.api('/first-use/status')); } catch { return; }
    if (!data || data.completed || !alvo.isConnected) return;
    const c = data.counts || {};
    const passos = [
      ['Cadastrar obra / centro de custo', 'Registro necessário para lançamentos', c.obras, 1],
      ['Cadastrar categorias', 'Classificação de receitas e despesas', c.categorias, 1],
      ['Cadastrar fornecedor', 'Base para lançamentos rápidos', c.fornecedores, 1],
      ['Criar usuário adicional', 'Cada pessoa deve ter seu próprio acesso', c.usuarios, 2],
      ['Adicionar foto de perfil', 'A foto acompanha seu usuário nas instalações sincronizadas', c.foto, 1],
    ];
    alvo.innerHTML = `<div class="card primeiro-uso">
      <div class="pu-cab"><span class="tit"><b>Assistente de primeiro uso</b><span class="muted">Complete os passos abaixo para começar a usar o sistema.</span></span>
        <button type="button" class="btn btn-s" data-pu-ok>${D.ic('check')}Marcar como concluído</button></div>
      <div class="pu-passos">${passos.map(([t, s, n, min]) => {
        const feito = Number(n || 0) >= min;
        return `<span class="pu-passo${feito ? ' feito' : ''}">${D.ic(feito ? 'check-circle-fill' : 'circle')}<span class="tx"><b>${esc(t)}</b><span>${esc(s)}</span></span><span class="n">${esc(n || 0)}</span></span>`;
      }).join('')}</div></div>`;
    CC.$('[data-pu-ok]', alvo).addEventListener('click', () => {
      try { localStorage.setItem(CHAVE_BANNER, 'true'); } catch { /* segue */ }
      alvo.innerHTML = '';
    });
  };
})(window.CC);
