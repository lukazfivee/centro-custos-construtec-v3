// Lancamentos (D2, print 10): filtros, tabela, total liquido, CSV e acoes da linha.
// Uma busca por mudanca de filtro (corrige o problema 2 do sistema atual: requisicoes em loop).
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const L = D.lanc = D.lanc || {};
  const U = D.ui;
  D.lancCache = D.lancCache || new Map();

  const podeGerir = () => D.pode('cadastrar'); // estornar, excluir e apagar anexo: admin e gestor
  L.podeEstornar = (l) => podeGerir() && l.status_financeiro === 'liquidado' && !l.estorno_de && !l.estornado
    && (l.aprovacao || 'aprovado') === 'aprovado' && !L.fechamento(l.data);
  L.podeExcluir = (l) => podeGerir() && !l.estorno_de && !l.estornado && !L.fechamento(l.data);
  L.soLeitura = (l) => !!(l.estorno_de || l.estornado || L.fechamento(l.data));

  function linha(l) {
    D.lancCache.set(String(l.id), l);
    const v = D.valorSinal(l);
    const fechado = L.fechamento(l.data);
    const qtd = Number(l.qtd_anexos) || 0;
    const acoes = [
      `<button type="button" class="ibtn" data-acao="docs" aria-label="Documentos${qtd ? ` (${qtd})` : ''}" title="Documentos">${D.ic('paperclip', 18)}${qtd ? `<span class="cont">${qtd}</span>` : ''}</button>`,
      L.podeEstornar(l) ? `<button type="button" class="ibtn" data-acao="estornar" aria-label="Estornar" title="Estornar">${D.ic('arrow-u-up-left', 18)}</button>` : '',
      L.podeExcluir(l) ? `<button type="button" class="ibtn" data-acao="excluir" aria-label="Excluir" title="Excluir">${D.ic('trash', 18)}</button>` : '',
    ].join('');
    const sub = [l.categoria, l.favorecido].filter(Boolean).join(' · ');
    return {
      id: l.id, clicavel: true,
      celulas: [
        `<span class="data">${esc(D.data(l.data))}${fechado ? `<span title="Mês fechado">${D.ic('lock-simple', 14)}</span>` : ''}</span>`,
        `<span class="${l.situacao === 'vencido' ? 'vencido' : ''}">${esc(D.data(l.vencimento))}</span>`,
        U.situacao(l),
        `<span class="duas-l"><b>${esc(l.centro_codigo || '')}</b><span>${esc(l.centro_nome || '')}</span></span>`,
        `<span class="duas-l desc"><b>${esc(l.descricao)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</span>`,
        `<b class="${v.entrada ? 'entrada' : ''}">${esc(v.texto)}</b>`,
        `<span class="acoes">${acoes}</span>`,
      ],
    };
  }

  const COLUNAS = [{ rotulo: 'Competência' }, { rotulo: 'Vencimento' }, { rotulo: 'Situação' }, { rotulo: 'Obra' }, { rotulo: 'Descrição' }, { rotulo: 'Valor', num: true }, { rotulo: 'Ações', num: true }];

  function faixaFechado(f) {
    const fe = f.mes && L.fechamento(f.mes);
    if (!fe) return '';
    const quando = fe.closed_at ? ` em ${new Date(fe.closed_at).toLocaleDateString('pt-BR')}` : ''; // horario local, nao UTC
    const quem = fe.fechado_por ? ` por ${fe.fechado_por}` : '';
    return `<div class="faixa info fechado" role="status">${D.ic('lock-simple')}<span>${esc(`${D.mesAno(f.mes)} foi fechado${quando}${quem}. Os lançamentos do mês ficam só para leitura; anexar documento continua liberado.`)}</span>${D.pode('fechamento') ? '<a class="btn btn-s" href="#/fechamento">Ver fechamento</a>' : ''}</div>`;
  }

  async function baixarCsv(f) {
    try {
      const resposta = await fetch(`/api/lancamentos/exportar.csv?${L.query(f, false)}`, { headers: { Authorization: `Bearer ${CC.session.token()}` }, cache: 'no-store' });
      if (!resposta.ok) throw new Error('Não foi possível gerar o CSV agora.');
      const url = URL.createObjectURL(await resposta.blob());
      const a = D.el(`<a href="${url}" download="lancamentos-${f.mes || 'periodo'}.csv"></a>`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (error) {
      CC.toast(error.message.includes('fetch') ? 'Sem internet. O CSV precisa da conexão.' : error.message, 'warning');
    }
  }

  async function render(el, rota, vivo) {
    const f = L.lerFiltros();
    L.esquecerApoio(); // ao abrir a tela, le de novo obras, categorias e meses fechados
    el.innerHTML = `<div class="pagina lancamentos">
      ${U.cabecalho({ grupo: 'Operação', titulo: 'Lançamentos', sub: ' ', acoes: `<button type="button" class="btn btn-s" data-csv>${D.ic('download-simple')}Exportar CSV</button><button type="button" class="btn btn-p" data-novo>${D.ic('plus')}Novo lançamento</button>` })}
      <div data-faixa></div><div data-filtros></div><div data-tabela>${U.carregando('Carregando os lançamentos…')}</div></div>`;
    CC.$('[data-csv]', el).addEventListener('click', () => baixarCsv(f));
    CC.$('[data-novo]', el).addEventListener('click', () => L.formulario(null));
    let vez = 0;

    async function carregar() {
      const minha = ++vez;
      const a = await L.apoio();
      if (!vivo() || minha !== vez) return;
      CC.$('[data-filtros]', el).innerHTML = L.filtrosHtml(f, a);
      L.ligarFiltros(CC.$('[data-filtros]', el), f, carregar);
      CC.$('[data-faixa]', el).innerHTML = faixaFechado(f);
      const alvo = CC.$('[data-tabela]', el);
      let r;
      try {
        r = (await CC.api(`/lancamentos?${L.query(f)}`)).data;
      } catch (error) {
        if (!vivo() || minha !== vez) return;
        const fila = CC.queue ? (await CC.queue.mine()).length : 0;
        alvo.innerHTML = U.faixa('warn', 'wifi-slash', error.status === 0
          ? `Sem internet. A lista volta quando a conexão voltar.${fila ? ` ${fila} lançamento(s) na fila deste computador.` : ''}`
          : error.message);
        return;
      }
      if (!vivo() || minha !== vez) return;
      const p = r.paginacao || { total: r.itens.length, pagina: 1, limite: f.limite };
      CC.$('.cab .sub', el).textContent = `${p.total} lançamento${p.total === 1 ? '' : 's'}${f.mes ? ` em ${D.mesAno(f.mes).toLowerCase()}` : ''}`;
      const ini = p.total ? (p.pagina - 1) * p.limite + 1 : 0;
      const fim = Math.min(p.total, p.pagina * p.limite);
      alvo.innerHTML = `<div class="card tabela">${U.tabela({ colunas: COLUNAS, linhas: r.itens.map(linha), vazio: 'Nenhum lançamento com esses filtros.' })}
        <div class="rodape"><span class="muted">Exibindo ${ini}–${fim} de ${p.total}</span>
          <span class="total">Total líquido <b class="${Number(r.totalLiquido) >= 0 ? 'entrada' : ''}">${esc(CC.money(r.totalLiquido || 0))}</b></span>
          <span class="pager"><button type="button" class="btn btn-s" data-pag="-1"${p.temAnterior ? '' : ' disabled'} aria-label="Página anterior">${D.ic('caret-left')}</button>
          <button type="button" class="btn btn-s" data-pag="1"${p.temProxima ? '' : ' disabled'} aria-label="Próxima página">${D.ic('caret-right')}</button></span></div></div>`;
      CC.$$('[data-pag]', alvo).forEach((b) => b.addEventListener('click', () => { f.pagina += Number(b.dataset.pag); carregar(); }));
      const abrirLinha = (tr, acao) => {
        const l = D.lancCache.get(tr.dataset.id);
        if (acao === 'docs') L.abrir(l, 'docs');
        else if (acao === 'estornar') L.estornar(l);
        else if (acao === 'excluir') L.excluir(l);
        else L.abrir(l);
      };
      CC.$$('tr.rw', alvo).forEach((tr) => {
        tr.addEventListener('click', (e) => { const b = e.target.closest('[data-acao]'); abrirLinha(tr, b && b.dataset.acao); });
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === tr) abrirLinha(tr); });
      });
    }
    L.recarregar = () => { if (vivo()) { L.esquecerApoio(); carregar(); } };
    await carregar();

    // #/lancamentos?id=5 abre o lancamento; ?novo=1 abre o formulario.
    if (rota.query.novo) L.formulario(null);
    if (rota.query.id && vivo()) L.abrirPorId(rota.query.id);
  }

  D.tela('lancamentos', { render });
  CC.onQueueSent = () => { if (D.lerRota().nome === 'lancamentos' && L.recarregar) L.recarregar(); };
})(window.CC);
