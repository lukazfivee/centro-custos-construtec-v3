// Categorias (D5, prints 50 a 52): lista com busca e filtro por tipo, lancamentos e total do mes.
// "Receita e despesa" e so o rotulo de "ambos"; o valor no banco continua "ambos".
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const C = D.cad;
  const U = D.ui;
  const TIPOS = { despesa: ['Despesa', 'warn', 'arrow-up-right'], receita: ['Receita', 'ok', 'arrow-down-left'], ambos: ['Receita e despesa', 'info', 'arrows-down-up'] };
  const FILTROS = [['', 'Todas'], ['despesa', 'Despesa'], ['receita', 'Receita'], ['ambos', 'Receita e despesa']];
  let filtro = '';
  let busca = '';

  const dinheiro = (n) => (Number(n) ? CC.money(n) : '—');

  function linha(cat) {
    const [rotulo, tom, icone] = TIPOS[cat.tipo] || TIPOS.ambos;
    return {
      id: cat.id, clicavel: C.pode(),
      celulas: [
        `<div class="cat-nome"><span class="cor" style="${cat.cor ? `background:${esc(cat.cor)}` : ''}"></span><div class="dois-tx"><b>${esc(cat.nome)}</b>${cat.descricao ? `<span>${esc(cat.descricao)}</span>` : ''}</div></div>`,
        U.chip(rotulo, tom, icone),
        esc(String(Number(cat.lancamentos_mes) || 0)),
        esc(dinheiro(cat.total_mes)),
        cat.ativo === false ? U.chip('Inativa', 'neutro') : U.chip('Ativa', 'ok'),
        C.pode() ? `<button type="button" class="ibtn" data-editar="${esc(cat.id)}" aria-label="Editar ${esc(cat.nome)}">${D.ic('pencil-simple')}</button>` : '',
      ],
    };
  }

  async function render(el, rota, vivo) {
    const mes = CC.month();
    el.innerHTML = `<div class="pagina">${U.cabecalho({ grupo: 'Cadastros', titulo: 'Categorias', acoes: C.pode() ? `<button type="button" class="btn btn-p" data-nova>${D.ic('plus')}Nova categoria</button>` : '' })}
      <div data-corpo>${U.carregando('Carregando as categorias…')}</div></div>`;
    const recarregar = () => render(el, rota, vivo);
    const nova = CC.$('[data-nova]', el);
    if (nova) nova.addEventListener('click', () => C.categoriaForm(null, recarregar));
    const { data } = await CC.api(`/categorias?mes=${mes}`);
    if (!vivo()) return;
    const todas = Array.isArray(data) ? data : [];
    const ativas = todas.filter((c) => c.ativo !== false).length;
    if (!CC.$('.cab .sub', el)) CC.$('.cab .tit', el).insertAdjacentHTML('beforeend', `<span class="sub">${esc(C.plural(ativas, 'ativa', 'ativas'))} · usadas nos lançamentos e no painel por categoria</span>`);
    CC.$('[data-corpo]', el).innerHTML = `<div class="card cad-barra">
        <label class="campo-busca">${D.ic('magnifying-glass')}<input class="inp" type="search" data-busca value="${esc(busca)}" placeholder="Buscar categoria" aria-label="Buscar categoria"></label>
        ${U.seg('tipo', FILTROS.map(([valor, rotulo]) => ({ valor, rotulo })), filtro, 'Tipo da categoria')}</div>
      <div class="card cad-tabela"><div data-tabela></div><div class="cad-rodape"><span data-conta></span><span>Total de ${esc(C.nomeMes(mes))}: <b data-soma></b></span></div></div>`;

    const pintar = () => {
      const q = busca.trim().toLowerCase();
      const vis = todas.filter((c) => (!filtro || c.tipo === filtro) && (!q || `${c.nome} ${c.descricao || ''}`.toLowerCase().includes(q)));
      CC.$('[data-tabela]', el).innerHTML = U.tabela({
        colunas: [{ rotulo: 'Categoria' }, { rotulo: 'Tipo padrão' }, { rotulo: `Lançamentos em ${C.nomeMes(mes)}`, num: true }, { rotulo: `Total em ${C.nomeMes(mes)}`, num: true }, { rotulo: 'Status' }, { rotulo: '' }],
        linhas: vis.map(linha), vazio: 'Nenhuma categoria encontrada.',
      });
      CC.$('[data-conta]', el).textContent = `${vis.length} de ${todas.length} categorias`;
      CC.$('[data-soma]', el).textContent = CC.money(vis.reduce((s, c) => s + Number(c.total_mes || 0), 0));
      const abrir = (id) => { const cat = todas.find((c) => String(c.id) === String(id)); if (cat) C.categoriaForm(cat, recarregar); };
      CC.$$('[data-editar]', el).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); abrir(b.dataset.editar); }));
      CC.$$('tr.rw', el).forEach((tr) => {
        tr.addEventListener('click', () => abrir(tr.dataset.id));
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') abrir(tr.dataset.id); });
      });
    };
    CC.$$('[data-seg="tipo"]', el).forEach((b) => b.addEventListener('click', () => { filtro = b.dataset.valor; U.segEscolher(b.parentElement, b); pintar(); }));
    CC.$('[data-busca]', el).addEventListener('input', (e) => { busca = e.target.value; pintar(); });
    pintar();
  }

  D.tela('categorias', { render });
})(window.CC);
