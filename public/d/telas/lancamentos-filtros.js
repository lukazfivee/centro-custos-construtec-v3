// Lancamentos (D2): dados de apoio (obras, categorias, fornecedores, meses fechados) e filtros da lista.
// Os filtros ficam salvos neste navegador, como no sistema atual.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const L = D.lanc = D.lanc || {};
  const U = D.ui;
  const CHAVE = 'cc_d_filtros_lanc';

  // Cadastros usados pela lista e pelo formulario, lidos uma vez por minuto.
  let apoio = null;
  let apoioEm = 0;
  L.apoio = async function (forcar) {
    if (apoio && !forcar && Date.now() - apoioEm < 60000) return apoio;
    const ler = (p) => CC.api(p).then((r) => (Array.isArray(r.data) ? r.data : [])).catch(() => []);
    const [obras, categorias, fornecedores, fechamentos] = await Promise.all([ler('/centros-custo'), ler('/categorias'), ler('/fornecedores'), ler('/fechamento-mensal')]);
    apoio = { obras, categorias, fornecedores, fechamentos };
    apoioEm = Date.now();
    return apoio;
  };
  L.esquecerApoio = () => { apoio = null; };

  // Fechamento da competencia de uma data (AAAA-MM-DD ou AAAA-MM), ou null.
  L.fechamento = (data) => {
    if (!apoio || !data) return null;
    const [a, m] = String(data).split('-').map(Number);
    return apoio.fechamentos.find((f) => Number(f.year) === a && Number(f.month) === m) || null;
  };

  const PADRAO = { busca: '', tipo: '', sit: '', obra: '', mes: CC.month(), categoria: '', doc: '', de: '', ate: '', ordenar: 'data', ordem: 'desc', limite: 50, pagina: 1, mais: false };
  L.lerFiltros = () => {
    let salvo = {};
    try { salvo = JSON.parse(localStorage.getItem(CHAVE) || '{}') || {}; } catch { salvo = {}; }
    return { ...PADRAO, ...salvo, pagina: 1 };
  };
  L.guardarFiltros = (f) => { try { localStorage.setItem(CHAVE, JSON.stringify({ ...f, pagina: 1 })); } catch { /* segue */ } };
  L.padrao = () => ({ ...PADRAO, mes: CC.month() });

  // Situacao do prototipo -> parametros do servidor (tipo + situacao).
  const SIT = {
    pendentes: { situacao: 'pendente' },
    a_pagar: { tipo: 'despesa', situacao: 'pendente' },
    vencidos: { situacao: 'vencido' },
    pagos: { tipo: 'despesa', situacao: 'liquidado' },
    a_receber: { tipo: 'receita', situacao: 'pendente' },
    recebidos: { tipo: 'receita', situacao: 'liquidado' },
  };
  L.tipoDaSituacao = (sit) => (SIT[sit] && SIT[sit].tipo) || '';

  L.query = (f, paginar = true) => {
    const q = new URLSearchParams();
    if (f.busca.trim()) q.set('busca', f.busca.trim());
    const s = SIT[f.sit] || {};
    const tipo = s.tipo || f.tipo;
    if (tipo) q.set('tipo', tipo);
    if (s.situacao) q.set('situacao', s.situacao);
    if (f.obra) q.set('centroId', f.obra);
    if (f.categoria) q.set('categoriaId', f.categoria);
    if (f.doc === 'sem') q.set('semAnexo', '1');
    if (f.mes) q.set('mes', f.mes);
    else {
      if (f.de) q.set('dataInicio', f.de);
      if (f.ate) q.set('dataFim', f.ate);
    }
    q.set('ordenarPor', f.ordenar);
    q.set('ordem', f.ordem);
    if (paginar) { q.set('pagina', String(f.pagina)); q.set('limite', String(f.limite)); }
    return q.toString();
  };

  const alterado = (f, fixa) => f.busca || f.tipo || f.sit || (f.obra && !fixa) || f.categoria || f.doc || f.de || f.ate || f.mes !== (fixa ? '' : CC.month()) || f.ordenar !== 'data' || f.ordem !== 'desc';

  function meses() {
    const [a, m] = CC.month().split('-').map(Number);
    return Array.from({ length: 24 }, (_, i) => {
      const d = new Date(a, m - 1 - i, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
  }

  L.filtrosHtml = (f, a, opcoes = {}) => {
    const opc = (lista, valor, vazio) => `<option value="">${esc(vazio)}</option>${lista.map((o) => `<option value="${esc(o.valor)}"${String(o.valor) === String(valor) ? ' selected' : ''}>${esc(o.rotulo)}</option>`).join('')}`;
    const listaMeses = meses();
    if (f.mes && !listaMeses.includes(f.mes)) listaMeses.push(f.mes);
    return `<div class="card filtros">
      <div class="linha">
        <label class="campo-busca">${D.ic('magnifying-glass')}<input class="inp" type="search" data-f="busca" value="${esc(f.busca)}" placeholder="Descrição, favorecido ou NF" aria-label="Buscar lançamentos"></label>
        ${U.seg('tipo', [{ valor: '', rotulo: 'Todos' }, { valor: 'despesa', rotulo: 'Despesas' }, { valor: 'receita', rotulo: 'Receitas' }], f.tipo, 'Tipo')}
        ${U.seg('sit', [{ valor: '', rotulo: 'Todas' }, { valor: 'pendentes', rotulo: 'Em aberto' }, { valor: 'a_pagar', rotulo: 'A pagar' }, { valor: 'vencidos', rotulo: 'Vencidos' }, { valor: 'pagos', rotulo: 'Pagos' }, { valor: 'a_receber', rotulo: 'A receber' }, { valor: 'recebidos', rotulo: 'Recebidos' }], f.sit, 'Situação')}
      </div>
      <div class="linha">
        ${opcoes.obraFixa ? '' : `<select class="inp" data-f="obra" aria-label="Obra" style="width:240px">${opc(a.obras.map((o) => ({ valor: o.id, rotulo: [o.codigo, o.nome].filter(Boolean).join(' · ') })), f.obra, 'Todas as obras')}</select>`}
        <select class="inp" data-f="mes" aria-label="Competência" style="width:200px">${opc(listaMeses.map((m) => ({ valor: m, rotulo: D.mesAno(m) })), f.mes, 'Todos os meses')}</select>
        <button type="button" class="btn btn-g" data-mais aria-expanded="${f.mais ? 'true' : 'false'}">${D.ic('sliders-horizontal')}Mais filtros</button>
        ${alterado(f, opcoes.obraFixa) ? `<button type="button" class="btn btn-g" data-limpar>${D.ic('x')}Limpar filtros</button>` : ''}
      </div>
      <div class="linha mais"${f.mais ? '' : ' hidden'}>
        <select class="inp" data-f="categoria" aria-label="Categoria" style="width:220px">${opc(a.categorias.map((c) => ({ valor: c.id, rotulo: c.nome })), f.categoria, 'Todas as categorias')}</select>
        <select class="inp" data-f="doc" aria-label="Documento" style="width:240px"><option value="">Com ou sem documento</option><option value="sem"${f.doc === 'sem' ? ' selected' : ''}>Só sem documento anexado</option></select>
        <label class="mini">De<input class="inp" type="date" data-f="de" value="${esc(f.de)}"${f.mes ? ' disabled title="Escolha Todos os meses para usar um período"' : ''}></label>
        <label class="mini">Até<input class="inp" type="date" data-f="ate" value="${esc(f.ate)}"${f.mes ? ' disabled' : ''}></label>
        <select class="inp" data-f="ordenar" aria-label="Ordenar por" style="width:230px">${[['data', 'Competência'], ['vencimento', 'Vencimento'], ['valor', 'Valor'], ['criado', 'Inclusão'], ['atualizado', 'Alteração']].map(([v, r]) => `<option value="${v}"${f.ordenar === v ? ' selected' : ''}>Ordenar por ${esc(r.toLowerCase())}</option>`).join('')}</select>
        <select class="inp" data-f="ordem" aria-label="Sentido" style="width:170px"><option value="desc"${f.ordem === 'desc' ? ' selected' : ''}>Mais recentes</option><option value="asc"${f.ordem === 'asc' ? ' selected' : ''}>Mais antigos</option></select>
        <select class="inp" data-f="limite" aria-label="Por página" style="width:160px">${[25, 50, 100, 200].map((n) => `<option value="${n}"${Number(f.limite) === n ? ' selected' : ''}>${n} por página</option>`).join('')}</select>
      </div></div>`;
  };

  // Liga os filtros: cada mudanca pede UMA busca (a digitacao espera 300 ms). Sem observar a tabela.
  L.ligarFiltros = (raiz, f, aoMudar, opcoes = {}) => {
    const guardar = () => { if (opcoes.salvar !== false) L.guardarFiltros(f); };
    const mudar = () => { f.pagina = 1; guardar(); aoMudar(); };
    const digitar = D.debounce(mudar, 300);
    CC.$$('[data-f]', raiz).forEach((el) => {
      el.addEventListener(el.dataset.f === 'busca' ? 'input' : 'change', () => {
        const v = el.value;
        f[el.dataset.f] = el.dataset.f === 'limite' ? Number(v) : v;
        if (el.dataset.f === 'busca') digitar(); else mudar();
      });
    });
    CC.$$('[data-seg]', raiz).forEach((b) => b.addEventListener('click', () => {
      const nome = b.dataset.seg;
      f[nome] = b.dataset.valor;
      // Situacao com tipo proprio acerta o tipo; tipo incompativel limpa a situacao.
      if (nome === 'sit' && L.tipoDaSituacao(f.sit)) f.tipo = L.tipoDaSituacao(f.sit);
      if (nome === 'tipo' && L.tipoDaSituacao(f.sit) && L.tipoDaSituacao(f.sit) !== f.tipo) f.sit = '';
      mudar();
    }));
    const mais = CC.$('[data-mais]', raiz);
    // Mostrar ou esconder "Mais filtros" nao busca de novo.
    if (mais) mais.addEventListener('click', () => {
      f.mais = !f.mais;
      guardar();
      CC.$('.linha.mais', raiz).hidden = !f.mais;
      mais.setAttribute('aria-expanded', f.mais ? 'true' : 'false');
    });
    const limpar = CC.$('[data-limpar]', raiz);
    if (limpar) limpar.addEventListener('click', () => { Object.assign(f, L.padrao(), { mais: f.mais }, opcoes.obraFixa ? { obra: String(opcoes.obraFixa), mes: '' } : {}); mudar(); });
  };
})(window.CC);
