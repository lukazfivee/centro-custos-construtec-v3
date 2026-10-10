// Lancamentos (com a fila do celular): mes, busca, tipo, situacao, total liquido e "carregar mais".
// Mesmos filtros da API que o desktop usa (lib/transactionFilters.js). Tocar numa linha abre o detalhe (screen-lanc.js).
(function (CC) {
  const { esc, icon } = CC;
  const SIT = [['', 'Todos'], ['pendente', 'Em aberto'], ['vencido', 'Vencidos'], ['liquidado', 'Pagos']];
  const TIPOS = [['', 'Tudo'], ['despesa', 'Despesas'], ['receita', 'Receitas']];
  const POR_PAGINA = 50;

  // Mes em AAAA-MM: nome por extenso e passo para frente ou para tras.
  CC.mesNome = (mes) => { const s = new Date(`${mes}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1); };
  CC.mesSoma = (mes, n) => {
    const [a, m] = mes.split('-').map(Number);
    const d = new Date(a, m - 1 + n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  // mes vazio = todos os meses (as contas vencidas do Inicio somam todos).
  CC.monthStep = (mes) => (!mes ? `<div class="mes-step"><b>Todos os meses</b><button class="chip-act" type="button" data-mes="${esc(CC.month())}">Ver por mês</button></div>`
    : `<div class="mes-step" role="group" aria-label="Mês"><button class="back" type="button" data-mes="${esc(CC.mesSoma(mes, -1))}" aria-label="Mês anterior">${icon('caret-left', 20)}</button>
    <b>${esc(CC.mesNome(mes))}</b><button class="back" type="button" data-mes="${esc(CC.mesSoma(mes, 1))}" aria-label="Próximo mês"${mes >= CC.month() ? ' disabled' : ''}>${icon('caret-right', 20)}</button></div>`);
  CC.wireMonthStep = (fn) => CC.$$('[data-mes]').forEach((b) => b.addEventListener('click', () => fn(b.dataset.mes)));

  async function queueBlock() {
    const items = (await CC.queue.mine()).sort((a, b) => a.criado_em - b.criado_em);
    const ops = CC.sv && CC.sv.opRows ? await CC.sv.opRows() : ''; // checklist, fotos e aceite de servico
    if (!items.length && !ops) return '';
    return `<span class="label">No celular</span>${ops}${items.map((i) => `<div class="tx"><span class="grow"><b>${esc(i.payload.favorecido || i.payload.descricao)}</b>
        <small>${esc(i.obra_nome)} · ${esc(CC.dateBr(i.payload.data))}</small>
        <small class="${i.estado === 'erro' ? 'state' : ''}">${i.estado === 'erro' ? esc('Não aceito: ' + i.erro) : (CC.queue.state.syncing ? 'Enviando…' : 'Na fila, sem internet')}</small>
        ${i.estado === 'erro' ? `<span class="grid2" style="margin-top:6px"><button class="btn2" type="button" data-retry="${esc(i.client_id)}">Tentar de novo</button>
          <button class="btn2" type="button" data-discard="${esc(i.client_id)}">Descartar</button></span>` : ''}</span>
        <span class="amt${i.payload.tipo === 'receita' ? ' in' : ''}">${esc(CC.signed(i.payload.tipo === 'receita' ? i.payload.valor : -i.payload.valor))}</span></div>`).join('')}`;
  }

  // Ultima lista carregada, para "carregar mais" somar a proxima pagina sem perder a rolagem.
  let memo = { key: '', rows: [], total: 0, liquido: 0, pagina: 0 };

  CC.screens.lancamentos = async function (params) {
    const f = { mes: CC.month(), situacao: '', tipo: '', busca: '', ...(params || {}) };
    delete f.__nav;
    const key = JSON.stringify([f.mes, f.situacao, f.tipo, f.busca]);
    const filtros = `${CC.monthStep(f.mes)}
      <label class="field busca"><span class="sr">Buscar</span>${icon('magnifying-glass', 18)}<input id="l-busca" type="search" enterkeyhint="search" autocomplete="off" value="${esc(f.busca)}" placeholder="Descrição, fornecedor ou nota fiscal"></label>
      <div class="chips" role="group" aria-label="Tipo">${TIPOS.map(([k, l]) => `<button class="chip-act" type="button" data-t="${k}" aria-pressed="${k === f.tipo}">${l}</button>`).join('')}</div>
      <div class="seg" role="group" aria-label="Situação">${SIT.map(([k, l]) => `<button type="button" data-f="${k}" aria-pressed="${k === f.situacao}">${k === 'liquidado' && f.tipo === 'receita' ? 'Recebidos' : l}</button>`).join('')}</div>`;
    const go = (mudar) => CC.screens.lancamentos({ ...f, ...mudar });
    const wire = () => {
      CC.$$('[data-f]').forEach((b) => b.addEventListener('click', () => go({ situacao: b.dataset.f })));
      CC.$$('[data-t]').forEach((b) => b.addEventListener('click', () => go({ tipo: b.dataset.t })));
      CC.wireMonthStep((mes) => go({ mes }));
      const busca = CC.$('#l-busca');
      if (busca) {
        let t = 0;
        busca.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); busca.blur(); go({ busca: busca.value.trim() }); } });
        busca.addEventListener('search', () => { clearTimeout(t); t = setTimeout(() => { if (busca.value.trim() !== f.busca) go({ busca: busca.value.trim() }); }, 50); });
      }
    };
    const el = CC.render(`${CC.header('Lançamentos')}${filtros}<div class="skeleton"></div>`);
    wire();
    const local = (!f.mes || f.mes === CC.month()) && !f.busca ? await queueBlock() : '';
    const q = (pagina) => `paginar=1&limite=${POR_PAGINA}&pagina=${pagina}${f.mes ? `&mes=${f.mes}` : ''}${f.situacao ? `&situacao=${f.situacao}` : ''}${f.tipo ? `&tipo=${f.tipo}` : ''}${f.busca ? `&busca=${encodeURIComponent(f.busca)}` : ''}`;
    let result;
    try {
      result = await CC.cached(`lanc-${key}`, `/lancamentos?${q(1)}`);
    } catch (error) {
      if (error.status === 0 && local) {
        CC.render(`${CC.header('Lançamentos')}${filtros}${local}<p class="sub">Sem internet para mostrar os lançamentos do servidor.</p>`, false, params);
        return wire();
      }
      return CC.errorScreen(el, error, () => CC.screens.lancamentos(params));
    }
    const d = result.data || {};
    memo = { key, rows: d.itens || (Array.isArray(d) ? d : []), total: d.paginacao ? Number(d.paginacao.total) || 0 : 0, liquido: Number(d.totalLiquido) || 0, pagina: 1 };
    paint(params, f, filtros, local, result, wire);
    const mais = async (b) => {
      CC.busy(b, 'Carregando…');
      try {
        const { data } = await CC.api(`/lancamentos?${q(memo.pagina + 1)}`);
        if (memo.key !== key) return;
        memo.rows = memo.rows.concat(data.itens || []);
        memo.pagina += 1;
      } catch (error) { CC.toast(error.status === 0 ? 'Sem internet para carregar mais.' : error.message, 'warning-circle'); }
      const y = window.scrollY;
      paint(params, f, filtros, local, result, wire);
      window.scrollTo(0, y);
      bindMais();
    };
    const bindMais = () => { const b = CC.$('#l-mais'); if (b) b.addEventListener('click', () => mais(b)); };
    bindMais();
  };

  function paint(params, f, filtros, local, result, wire) {
    let last = '';
    const list = memo.rows.map((t) => {
      const head = t.data !== last ? `<div class="group">${esc(CC.dateFull(t.data))}</div>` : '';
      last = t.data;
      return head + CC.txRow(t, t.centro_nome);
    }).join('');
    const resto = memo.total - memo.rows.length;
    const quando = f.mes ? `em ${CC.mesNome(f.mes)}` : 'em nenhum mês';
    const vazio = f.busca ? `Nada encontrado para "${esc(f.busca)}" ${esc(quando)}.` : `Nenhum lançamento ${esc(quando)}.`;
    const page = CC.render(`${CC.header('Lançamentos')}${filtros}${CC.staleNote(result)}${local}
      ${memo.total ? `<div class="kv lanc-total"><span>${memo.total === 1 ? '1 lançamento' : `${memo.total} lançamentos`} · total líquido</span><b class="${memo.liquido >= 0 ? 'in' : ''}">${esc(CC.signed(memo.liquido))}</b></div>` : ''}
      ${list || (local ? '' : `<div class="empty">${icon('list-bullets', 28)}${vazio}</div>`)}
      ${resto > 0 ? `<button class="btn2" type="button" id="l-mais">Carregar mais ${Math.min(resto, POR_PAGINA)} de ${resto}</button>` : ''}`, false, params);
    wire();
    CC.wireTx(page, ['lancamentos', { mes: f.mes, situacao: f.situacao, tipo: f.tipo, busca: f.busca }]);
    CC.$$('[data-retry]').forEach((b) => b.addEventListener('click', async () => { await CC.queue.retry(b.dataset.retry); CC.screens.lancamentos(params); }));
    CC.$$('[data-discard]').forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Toque de novo'; return; }
      await CC.queue.discard(b.dataset.discard);
      CC.screens.lancamentos(params);
    }));
  }
})(window.CC = window.CC || {});
