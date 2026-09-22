(() => {
  const input = document.getElementById('busca-global');
  const dropdown = document.getElementById('busca-resultados');
  const campo = input ? input.closest('.topbar-search') : null;
  if (!input || !dropdown || !campo) return;

  // O dropdown fica fora do <label> (irmão dele no HTML), então sua posição
  // não pode vir de position:absolute relativo ao label — é calculada aqui
  // via getBoundingClientRect() e aplicada como position:fixed.
  function posicionarDropdown() {
    const rect = campo.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + 8}px`;
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.width = `${rect.width}px`;
  }

  window.addEventListener('resize', () => {
    if (!dropdown.classList.contains('oculto')) posicionarDropdown();
  });
  window.addEventListener('scroll', () => {
    if (!dropdown.classList.contains('oculto')) posicionarDropdown();
  }, true);

  const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function authHeaders() {
    const headers = {};
    const token = localStorage.getItem('cc_token');
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  let debounceTimer = null;
  let requestSeq = 0;

  function closeDropdown() {
    dropdown.classList.add('oculto');
    dropdown.innerHTML = '';
  }

  function renderVazio(termo) {
    dropdown.innerHTML = `<div class="busca-resultado-vazio">Nenhum resultado para "${esc(termo)}"</div>`;
    posicionarDropdown();
    dropdown.classList.remove('oculto');
  }

  function renderResultados(lancamentosEncontrados, centrosEncontrados) {
    if (!lancamentosEncontrados.length && !centrosEncontrados.length) return false;
    const partes = [];

    if (lancamentosEncontrados.length) {
      const itens = lancamentosEncontrados.map((item) => `
        <button type="button" class="busca-resultado-item" role="option" data-tipo="lancamento" data-id="${esc(item.id)}">
          <strong>${esc(item.descricao || 'Sem descrição')} — ${esc(money(item.valor))}</strong>
          <span>${esc(item.centro_nome || '')}</span>
        </button>`).join('');
      partes.push(`<div class="busca-resultado-grupo"><div class="busca-resultado-titulo">Lançamentos</div>${itens}</div>`);
    }

    if (centrosEncontrados.length) {
      const itens = centrosEncontrados.map((centro) => `
        <button type="button" class="busca-resultado-item" role="option" data-tipo="centro" data-id="${esc(centro.id)}">
          <strong>${esc(centro.nome || 'Sem nome')}</strong>
          <span>${esc(centro.cliente || '')}${centro.cliente && centro.situacao ? ' · ' : ''}${esc(centro.situacao || '')}</span>
        </button>`).join('');
      partes.push(`<div class="busca-resultado-grupo"><div class="busca-resultado-titulo">Obras</div>${itens}</div>`);
    }

    dropdown.innerHTML = partes.join('');
    posicionarDropdown();
    dropdown.classList.remove('oculto');
    return true;
  }

  async function buscar(termo) {
    const token = localStorage.getItem('cc_token');
    if (!token) return;

    const seq = ++requestSeq;
    let lancamentosData = [];
    let centrosData = [];

    try {
      const [respLancamentos, respCentros] = await Promise.all([
        fetch('/api/lancamentos', { headers: authHeaders() }),
        fetch('/api/centros-custo', { headers: authHeaders() })
      ]);
      if (respLancamentos.ok) {
        const data = await respLancamentos.json();
        if (Array.isArray(data)) lancamentosData = data;
      }
      if (respCentros.ok) {
        const data = await respCentros.json();
        if (Array.isArray(data)) centrosData = data;
      }
    } catch {
      return;
    }

    if (seq !== requestSeq) return; // resposta obsoleta, uma busca mais recente já está em curso

    const termoNormalizado = normalize(termo);

    const lancamentosEncontrados = lancamentosData.filter((item) => {
      const alvo = normalize(item.descricao) + ' ' + normalize(item.favorecido);
      return alvo.includes(termoNormalizado);
    }).slice(0, 5);

    const centrosEncontrados = centrosData.filter((centro) => {
      const alvo = normalize(centro.nome) + ' ' + normalize(centro.cliente) + ' ' + normalize(centro.codigo);
      return alvo.includes(termoNormalizado);
    }).slice(0, 5);

    let combinados = [...lancamentosEncontrados.map((item) => ({ tipo: 'lancamento', item })), ...centrosEncontrados.map((item) => ({ tipo: 'centro', item }))];
    if (combinados.length > 8) {
      const totalLancamentos = Math.min(5, lancamentosEncontrados.length);
      const totalCentros = Math.min(8 - totalLancamentos, centrosEncontrados.length);
      combinados = [
        ...lancamentosEncontrados.slice(0, totalLancamentos).map((item) => ({ tipo: 'lancamento', item })),
        ...centrosEncontrados.slice(0, totalCentros).map((item) => ({ tipo: 'centro', item }))
      ];
    }

    const lancamentosFinal = combinados.filter((entrada) => entrada.tipo === 'lancamento').map((entrada) => entrada.item);
    const centrosFinal = combinados.filter((entrada) => entrada.tipo === 'centro').map((entrada) => entrada.item);

    const teveResultado = renderResultados(lancamentosFinal, centrosFinal);
    if (!teveResultado) renderVazio(termo);
  }

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const termo = input.value.trim();
    if (termo.length < 2) {
      closeDropdown();
      return;
    }
    debounceTimer = setTimeout(() => buscar(termo), 300);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeDropdown();
    }
  });

  dropdown.addEventListener('click', (event) => {
    const item = event.target.closest('.busca-resultado-item');
    if (!item) return;
    const tipo = item.dataset.tipo;
    if (tipo === 'lancamento' && typeof window.showView === 'function') {
      window.showView('lancamentos');
    } else if (tipo === 'centro' && typeof window.showView === 'function') {
      window.showView('centros');
    }
    closeDropdown();
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('.topbar-search') || event.target.closest('#busca-resultados')) return;
    closeDropdown();
  });
})();
