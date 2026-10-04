// Busca global (Ctrl K): a partir de 2 letras, procura obras (nome, codigo, cliente) e lancamentos
// (descricao e favorecido). Clicar num resultado abre o item.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  D.lancCache = D.lancCache || new Map();

  let obras = null;
  let obrasEm = 0;
  async function listaObras() {
    if (obras && Date.now() - obrasEm < 60000) return obras;
    const { data } = await CC.api('/centros-custo');
    obras = Array.isArray(data) ? data : [];
    obrasEm = Date.now();
    return obras;
  }
  const normal = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  async function procurar(q) {
    const alvo = normal(q);
    const [lista, lancs] = await Promise.all([
      listaObras().catch(() => []),
      CC.api(`/lancamentos?busca=${encodeURIComponent(q)}&limite=5&pagina=1`).then((r) => r.data.itens || []),
    ]);
    const achadas = lista.filter((o) => normal([o.nome, o.codigo, o.cliente].join(' ')).includes(alvo)).slice(0, 3);
    return [
      ...achadas.map((o) => ({ tipo: 'obra', id: o.id, icone: 'buildings', titulo: o.nome, sub: [o.tipo === 'servico' ? 'Serviço' : '', o.codigo, o.cliente].filter(Boolean).join(' · '), valor: '' })),
      ...lancs.map((l) => {
        D.lancCache.set(String(l.id), l);
        const v = D.valorSinal(l);
        return { tipo: 'lanc', id: l.id, icone: 'receipt', titulo: l.descricao, sub: [l.favorecido || l.centro_nome, D.data(l.data)].filter(Boolean).join(' · '), valor: v.texto, entrada: v.entrada };
      }),
    ];
  }

  D.montarBusca = function () {
    const raiz = CC.$('.busca');
    raiz.innerHTML = `${D.ic('magnifying-glass')}
      <input class="inp" type="search" placeholder="Buscar lançamentos, obras, fornecedores" aria-label="Busca global" autocomplete="off"
        role="combobox" aria-expanded="false" aria-controls="busca-res" aria-autocomplete="list">
      <kbd>Ctrl K</kbd>
      <div class="pop" id="busca-res" role="listbox" hidden></div>`;
    const input = CC.$('input', raiz);
    const pop = CC.$('.pop', raiz);
    let resultados = [];
    let marcado = -1;
    let vez = 0;

    const fechar = () => { pop.hidden = true; input.setAttribute('aria-expanded', 'false'); marcado = -1; };
    const pintar = (q) => {
      pop.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      if (!resultados.length) { pop.innerHTML = `<span class="vazio">Nada encontrado para "${esc(q)}".</span>`; return; }
      pop.innerHTML = resultados.map((r, i) => `<button type="button" class="res" role="option" id="br-${i}" data-i="${i}" aria-selected="${i === marcado ? 'true' : 'false'}" tabindex="-1">
        <span class="ic">${D.ic(r.icone)}</span><span class="tx"><b>${esc(r.titulo)}</b><span>${esc(r.sub)}</span></span>
        ${r.valor ? `<span class="v${r.entrada ? ' entrada' : ''}">${esc(r.valor)}</span>` : ''}</button>`).join('');
      if (marcado >= 0) input.setAttribute('aria-activedescendant', `br-${marcado}`);
      else input.removeAttribute('aria-activedescendant');
    };
    const abrirItem = (r) => {
      if (!r) return;
      fechar();
      input.value = '';
      input.blur();
      D.ir(r.tipo === 'obra' ? `obras/${r.id}` : `lancamentos?id=${r.id}`);
    };
    const buscar = D.debounce(async () => {
      const q = input.value.trim();
      const minha = ++vez;
      if (q.length < 2) { fechar(); return; }
      try {
        const lista = await procurar(q);
        if (minha !== vez) return;
        resultados = lista;
        marcado = lista.length ? 0 : -1;
        pintar(q);
      } catch (error) {
        if (minha !== vez) return;
        pop.hidden = false;
        pop.innerHTML = `<span class="vazio">${esc(error.status === 0 ? 'Sem internet. A busca volta quando a conexão voltar.' : error.message)}</span>`;
      }
    }, 250);

    input.addEventListener('input', buscar);
    input.addEventListener('focus', () => { if (input.value.trim().length >= 2) buscar(); });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); if (!pop.hidden) fechar(); else input.blur(); return; }
      if (pop.hidden || !resultados.length) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        marcado = (marcado + (event.key === 'ArrowDown' ? 1 : -1) + resultados.length) % resultados.length;
        pintar(input.value.trim());
      } else if (event.key === 'Enter') {
        event.preventDefault();
        abrirItem(resultados[marcado]);
      }
    });
    pop.addEventListener('mousedown', (event) => event.preventDefault());
    pop.addEventListener('click', (event) => {
      const bt = event.target.closest('[data-i]');
      if (bt) abrirItem(resultados[Number(bt.dataset.i)]);
    });
    input.addEventListener('blur', () => setTimeout(fechar, 120));
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        input.focus();
        input.select();
      }
    });
  };
})(window.CC);
