// Fornecedores (D5, prints 53 a 55): busca por nome, CPF/CNPJ ou contato, gasto e lancamentos do mes, CSV.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const C = D.cad;
  const U = D.ui;
  let busca = '';

  const linha = (f) => ({
    id: f.id, clicavel: C.pode(),
    celulas: [
      `<div class="dois-tx"><b>${esc(f.nome)}${f.ativo === false ? ' (inativo)' : ''}</b>${f.documento ? `<span>${esc(f.documento)}</span>` : ''}</div>`,
      esc(f.contato || '—'),
      f.email ? `<a class="link" href="mailto:${esc(f.email)}" data-email>${esc(f.email)}</a>` : '—',
      esc(f.telefone || '—'),
      esc(Number(f.gasto_mes) ? CC.money(f.gasto_mes) : '—'),
      esc(String(Number(f.lancamentos_mes) || 0)),
      C.pode() ? `<button type="button" class="ibtn" data-editar="${esc(f.id)}" aria-label="Editar ${esc(f.nome)}">${D.ic('pencil-simple')}</button>` : '',
    ],
  });

  async function render(el, rota, vivo) {
    const mes = CC.month();
    el.innerHTML = `<div class="pagina">${U.cabecalho({ grupo: 'Cadastros', titulo: 'Fornecedores',
      acoes: `<button type="button" class="btn btn-s" data-csv>${D.ic('download-simple')}Exportar CSV</button>${C.pode() ? `<button type="button" class="btn btn-p" data-novo>${D.ic('plus')}Novo fornecedor</button>` : ''}` })}
      <div data-corpo>${U.carregando('Carregando os fornecedores…')}</div></div>`;
    const recarregar = () => render(el, rota, vivo);
    const novo = CC.$('[data-novo]', el);
    if (novo) novo.addEventListener('click', () => C.fornecedorForm(null, recarregar));
    CC.$('[data-csv]', el).addEventListener('click', () => C.baixarCsv('/fornecedores/exportar.csv', 'fornecedores.csv'));
    const { data } = await CC.api(`/fornecedores?mes=${mes}`);
    if (!vivo()) return;
    const todos = Array.isArray(data) ? data : [];
    if (!CC.$('.cab .sub', el)) CC.$('.cab .tit', el).insertAdjacentHTML('beforeend', `<span class="sub">${esc(C.plural(todos.length, 'cadastrado', 'cadastrados'))} · gasto de ${esc(C.nomeMes(mes))} de ${esc(mes.slice(0, 4))}</span>`);
    CC.$('[data-corpo]', el).innerHTML = `<div class="card cad-barra">
        <label class="campo-busca">${D.ic('magnifying-glass')}<input class="inp" type="search" data-busca value="${esc(busca)}" placeholder="Nome, CPF/CNPJ ou contato" aria-label="Buscar fornecedor"></label></div>
      <div class="card cad-tabela"><div data-tabela></div><div class="cad-rodape"><span data-conta></span><span>Gasto em ${esc(C.nomeMes(mes))}: <b data-soma></b></span></div></div>`;

    const pintar = () => {
      const q = busca.trim().toLowerCase();
      const digitos = q.replace(/\D/g, '');
      const vis = todos.filter((f) => !q || `${f.nome} ${f.contato || ''}`.toLowerCase().includes(q) || (digitos && String(f.documento || '').replace(/\D/g, '').includes(digitos)));
      CC.$('[data-tabela]', el).innerHTML = U.tabela({
        colunas: [{ rotulo: 'Fornecedor' }, { rotulo: 'Contato' }, { rotulo: 'E-mail' }, { rotulo: 'Telefone' }, { rotulo: `Gasto em ${C.nomeMes(mes)}`, num: true }, { rotulo: 'Lançamentos', num: true }, { rotulo: '' }],
        linhas: vis.map(linha), vazio: 'Nenhum fornecedor encontrado.',
      });
      CC.$('[data-conta]', el).textContent = `${vis.length} de ${todos.length} fornecedores`;
      CC.$('[data-soma]', el).textContent = CC.money(vis.reduce((s, f) => s + Number(f.gasto_mes || 0), 0));
      const abrir = (id) => { const f = todos.find((x) => String(x.id) === String(id)); if (f) C.fornecedorForm(f, recarregar); };
      CC.$$('[data-editar]', el).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); abrir(b.dataset.editar); }));
      CC.$$('[data-email]', el).forEach((a) => a.addEventListener('click', (e) => e.stopPropagation()));
      CC.$$('tr.rw', el).forEach((tr) => {
        tr.addEventListener('click', () => abrir(tr.dataset.id));
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') abrir(tr.dataset.id); });
      });
    };
    CC.$('[data-busca]', el).addEventListener('input', (e) => { busca = e.target.value; pintar(); });
    pintar();
  }

  D.tela('fornecedores', { render });
})(window.CC);
