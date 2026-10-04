// Historico (D7, prints 76 a 79): auditoria so de leitura, com filtros, antes -> depois, origem e CSV.
(function (CC) {
  const D = CC.d;
  const H = D.hist = D.hist || {};
  const U = D.ui;
  const { esc } = CC;
  const PERIODOS = [['', 'Todo o período'], ['hoje', 'Hoje'], ['7d', 'Últimos 7 dias'], ['mes', 'Este mês'], ['mes_ant', 'Mês anterior'], ['custom', 'Escolher datas']];
  const COLUNAS = ['Quando', 'Usuário', 'Ação', 'Registro', 'Detalhe', 'Origem'].map((rotulo) => ({ rotulo }));
  const cache = new Map();

  function linha(item) {
    cache.set(String(item.id), item);
    const a = H.acao(item.acao);
    const o = H.origem(item.origem);
    const q = H.quando(item.created_at);
    const sub = [H.tipoNome(item.tipo), item.entity_id && String(item.entity_id).length <= 14 ? item.entity_id : ''].filter(Boolean).join(' · ');
    return {
      id: item.id, clicavel: true,
      celulas: [
        `<span class="duas-l"><b>${esc(q.dia)}</b><span>${esc(q.hora)}</span></span>`,
        `<span class="hist-pessoa"><span class="usu-avatar">${esc(D.iniciais(item.usuario))}</span>${esc(item.usuario || 'Sistema')}</span>`,
        U.chip(a.rotulo, a.tom, a.icone),
        `<span class="duas-l hist-reg"><b>${esc(item.resumo || '')}</b><span>${esc(sub)}</span></span>`,
        `<span class="hist-detalhe">${esc(H.resumoMudancas(item) || '—')}</span>`,
        `<span class="hist-origem">${D.ic(o.icone, 15)}${esc(o.rotulo)}</span>`,
      ],
    };
  }

  function filtrosHtml(f, pessoas) {
    const opcoesPessoas = [{ valor: '', rotulo: 'Todas as pessoas' }, ...pessoas.map((p) => ({ valor: String(p.id), rotulo: p.nome }))];
    const sel = (nome, opcoes, atual, rotulo) => `<select class="inp hist-sel" data-sel="${nome}" aria-label="${esc(rotulo)}">${opcoes.map((o) => `<option value="${esc(o.valor)}"${o.valor === atual ? ' selected' : ''}>${esc(o.rotulo)}</option>`).join('')}</select>`;
    return `<div class="card filtros"><div class="linha">
      <label class="campo-busca">${D.ic('magnifying-glass')}<input class="inp" type="search" data-busca value="${esc(f.busca)}" placeholder="Registro, detalhe ou usuário" aria-label="Buscar no histórico"></label>
      ${U.seg('tipo', H.TIPOS, f.tipo, 'Tipo de registro')}
      ${sel('usuario', opcoesPessoas, f.usuario, 'Pessoa')}
      ${sel('periodo', PERIODOS.map(([valor, rotulo]) => ({ valor, rotulo })), f.periodo, 'Período')}
      ${f.periodo === 'custom' ? `<label class="mini">De <input class="inp" type="date" data-data="de" value="${esc(f.de)}"></label><label class="mini">Até <input class="inp" type="date" data-data="ate" value="${esc(f.ate)}"></label>` : ''}
    </div></div>`;
  }

  async function baixarCsv(f) {
    try {
      const resposta = await fetch(`/api/historico/exportar.csv?${H.query(f, false)}`, { headers: { Authorization: `Bearer ${CC.session.token()}` }, cache: 'no-store' });
      if (!resposta.ok) throw new Error((await resposta.json().catch(() => ({}))).erro || 'Não foi possível gerar o CSV agora.');
      const url = URL.createObjectURL(await resposta.blob());
      const a = D.el(`<a href="${url}" download="historico.csv"></a>`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (error) {
      CC.toast(error.message.includes('fetch') ? 'Sem internet. O CSV precisa da conexão.' : error.message, 'warning');
    }
  }

  async function render(el, rota, vivo) {
    if (!D.pode('historico')) return D.telaEmConstrucao(el, rota, vivo);
    const f = { ...H.PADRAO };
    el.innerHTML = `<div class="pagina historico">${U.cabecalho({ grupo: 'Administração', titulo: 'Histórico', sub: ' ', acoes: `<button type="button" class="btn btn-s" data-csv>${D.ic('download-simple')}Exportar CSV</button>` })}
      <div data-filtros></div><div data-tabela>${U.carregando('Carregando o histórico…')}</div></div>`;
    const alvoFiltros = CC.$('[data-filtros]', el);
    const alvo = CC.$('[data-tabela]', el);
    let vez = 0;
    let pessoas = [];
    try { pessoas = (await CC.api('/historico/pessoas')).data; } catch { pessoas = []; }
    if (!vivo()) return undefined;

    async function carregar() {
      const minha = ++vez;
      let r;
      try {
        r = (await CC.api(`/historico?${H.query(f, true)}`)).data;
      } catch (error) {
        if (!vivo() || minha !== vez) return;
        alvo.innerHTML = U.faixa(error.status === 0 ? 'warn' : 'err', error.status === 0 ? 'wifi-slash' : 'warning-circle', error.status === 0 ? 'Sem internet. O histórico volta quando a conexão voltar.' : error.message);
        return;
      }
      if (!vivo() || minha !== vez) return;
      const p = r.paginacao;
      CC.$('.cab .sub', el).textContent = `Quem mudou o quê, quando e de onde · ${p.total} registro${p.total === 1 ? '' : 's'}`;
      const ini = p.total ? (p.pagina - 1) * p.limite + 1 : 0;
      const fim = Math.min(p.total, p.pagina * p.limite);
      alvo.innerHTML = `<div class="card tabela">${U.tabela({ colunas: COLUNAS, linhas: r.itens.map(linha), vazio: 'Nenhum registro com esses filtros.' })}
        <div class="rodape"><span class="muted">Exibindo ${ini}–${fim} de ${p.total}</span><span class="pager" style="margin-left:auto">
          <button type="button" class="btn btn-s" data-pag="-1"${p.temAnterior ? '' : ' disabled'} aria-label="Página anterior">${D.ic('caret-left')}</button>
          <button type="button" class="btn btn-s" data-pag="1"${p.temProxima ? '' : ' disabled'} aria-label="Próxima página">${D.ic('caret-right')}</button></span></div></div>`;
      CC.$$('[data-pag]', alvo).forEach((b) => b.addEventListener('click', () => { f.pagina += Number(b.dataset.pag); carregar(); }));
      CC.$$('tr.rw', alvo).forEach((tr) => {
        const abrir = () => H.abrirDetalhe(cache.get(tr.dataset.id));
        tr.addEventListener('click', abrir);
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === tr) abrir(); });
      });
    }

    function desenharFiltros() {
      alvoFiltros.innerHTML = filtrosHtml(f, pessoas);
      const buscar = D.debounce(() => { f.pagina = 1; carregar(); }, 300);
      CC.$('[data-busca]', alvoFiltros).addEventListener('input', (e) => { f.busca = e.target.value.trim(); buscar(); });
      CC.$$('[data-seg="tipo"]', alvoFiltros).forEach((b) => b.addEventListener('click', () => { f.tipo = b.dataset.valor; f.pagina = 1; U.segEscolher(b.parentElement, b); carregar(); }));
      CC.$('[data-sel="usuario"]', alvoFiltros).addEventListener('change', (e) => { f.usuario = e.target.value; f.pagina = 1; carregar(); });
      CC.$('[data-sel="periodo"]', alvoFiltros).addEventListener('change', (e) => {
        f.periodo = e.target.value;
        if (f.periodo !== 'custom') Object.assign(f, H.periodo(f.periodo));
        f.pagina = 1;
        desenharFiltros();
        carregar();
      });
      CC.$$('[data-data]', alvoFiltros).forEach((i) => i.addEventListener('change', () => { f[i.dataset.data] = i.value; f.pagina = 1; carregar(); }));
    }

    CC.$('[data-csv]', el).addEventListener('click', () => baixarCsv(f));
    desenharFiltros();
    await carregar();
    return undefined;
  }

  D.tela('historico', { render });
})(window.CC);
