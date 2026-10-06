// Cobrancas: excluir (reversivel) e restaurar. Lixeira por linha, selecao multipla e a aba Excluidas.
// Excluir so marca a cobranca como excluida no servico corporativo: a obra, os lancamentos, as medicoes
// e a NF continuam como estao. Quem exclui precisa da permissao de cobrancas (p6).
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const B = D.cobr = D.cobr || {};
  const U = D.ui;
  const url = (item, acao) => `/cloud-sync/cobrancas/${encodeURIComponent(item.publicId)}/${acao}`;
  const plural = (n, um, varios) => (n === 1 ? um : varios);

  B.podeExcluir = () => D.tem('p6');
  // Cobranca ja paga ou com e-mail enviado pede uma segunda confirmacao.
  B.sensivel = (i) => ['pago', 'enviada'].includes(i.financialStatus);

  B.carregarExcluidas = async () => {
    const { data } = await CC.api('/cloud-sync/cobrancas?excluidas=1');
    return Array.isArray(data.items) ? data.items : [];
  };

  const resumo = (i) => `${i.code} · ${i.name} · ${CC.money(i.receivableAmount)} · ${B.textoFinanceiro(i)}`;

  B.confirmarExclusao = async (lista) => {
    const n = lista.length;
    const linhas = lista.slice(0, 6).map(resumo);
    if (n > 6) linhas.push(`e mais ${n - 6}`);
    const texto = `${linhas.join('\n')}\n\nA obra, os lançamentos, as medições e a NF NÃO são apagados. ${n === 1 ? 'A cobrança sai' : 'As cobranças saem'} da lista, dos indicadores e do contador do menu, e dá para restaurar na aba Excluídas.`;
    const ok = await D.confirmar({ titulo: n === 1 ? 'Excluir esta cobrança?' : `Excluir ${n} cobranças?`, texto, ok: n === 1 ? 'Excluir cobrança' : `Excluir ${n} cobranças`, tom: 'perigo', icone: 'trash' });
    if (!ok) return false;
    const sensiveis = lista.filter(B.sensivel);
    if (!sensiveis.length) return true;
    return D.confirmar({
      titulo: sensiveis.length === 1 ? 'Esta cobrança já foi enviada ou paga' : `${sensiveis.length} cobranças já foram enviadas ou pagas`,
      texto: `${sensiveis.slice(0, 6).map(resumo).join('\n')}${sensiveis.length > 6 ? `\ne mais ${sensiveis.length - 6}` : ''}\n\nExcluir tira ${sensiveis.length === 1 ? 'esta cobrança' : 'estas cobranças'} do acompanhamento financeiro. Confirma mesmo assim?`,
      ok: 'Sim, excluir mesmo assim', cancelar: 'Voltar', tom: 'perigo', icone: 'warning',
    });
  };

  // Confirma, exclui uma a uma e avisa o resultado. Devolve true se algo mudou (para recarregar a lista).
  B.excluirLista = async (lista) => {
    if (!lista.length || !(await B.confirmarExclusao(lista))) return false;
    let feitas = 0;
    let erro = null;
    for (const item of lista) {
      try { await CC.api(url(item, 'excluir'), { method: 'POST', body: {} }); feitas += 1; } catch (e) { erro = erro || e; }
    }
    const falhas = lista.length - feitas;
    if (!falhas) CC.toast(feitas === 1 ? 'Cobrança excluída · dá para restaurar na aba Excluídas' : `${feitas} cobranças excluídas · dá para restaurar na aba Excluídas`);
    else CC.toast(`${feitas ? `${feitas} excluída${feitas === 1 ? '' : 's'}, ` : ''}${falhas} não ${plural(falhas, 'foi excluída', 'foram excluídas')}: ${erro.status === 0 ? 'sem internet' : erro.message}`, 'warning-circle');
    return feitas > 0;
  };

  B.restaurar = async (item) => {
    try {
      await CC.api(url(item, 'restaurar'), { method: 'POST', body: {} });
      CC.toast('Cobrança restaurada');
      return true;
    } catch (e) {
      CC.toast(e.status === 0 ? 'Sem internet. Restaurar precisa da conexão.' : e.message, 'warning-circle');
      return false;
    }
  };

  // Pecas da tabela principal.
  B.colunaSelecao = { rotulo: 'Selecionar', html: '<label class="sel-cel"><input type="checkbox" class="chk" data-sel-todas aria-label="Selecionar todas as cobranças exibidas"></label>' };
  B.celulaSelecao = (i) => `<label class="sel-cel"><input type="checkbox" class="chk" data-sel aria-label="Selecionar ${esc(i.name)}"></label>`;
  B.botaoExcluir = (i) => `<button type="button" class="ibtn" data-acao="excluir" aria-label="Excluir cobrança" title="Excluir cobrança: ${esc(i.name)}">${D.ic('trash', 18)}</button>`;
  B.cliqueEmControle = (e) => !!e.target.closest('.sel-cel, [data-acao="excluir"], [data-acao="restaurar"]');

  // Caixas de selecao + barra "Excluir N selecionadas". sel: Set de publicId; aoExcluir(lista).
  B.ligarSelecao = (el, vis, sel, aoExcluir) => {
    for (const id of [...sel]) if (!vis.some((i) => i.publicId === id)) sel.delete(id);
    const barra = CC.$('[data-barra]', el);
    const todas = CC.$('[data-sel-todas]', el);
    const caixas = CC.$$('input[data-sel]', el);
    const escolhidas = () => vis.filter((i) => sel.has(i.publicId));
    const pintar = () => {
      const n = sel.size;
      barra.hidden = !n;
      barra.innerHTML = n ? `<span><b>${n}</b> ${plural(n, 'selecionada', 'selecionadas')}</span><span class="grow"></span>
        <button type="button" class="btn btn-s" data-limpar>Limpar seleção</button>
        <button type="button" class="btn btn-d" data-excluir-sel>${D.ic('trash')}Excluir ${n} ${plural(n, 'selecionada', 'selecionadas')}</button>` : '';
      if (todas) { todas.checked = n > 0 && n === vis.length; todas.indeterminate = n > 0 && n < vis.length; }
      caixas.forEach((c) => { c.checked = sel.has(c.closest('tr').dataset.id); });
      const limpar = CC.$('[data-limpar]', barra);
      if (limpar) limpar.addEventListener('click', () => { sel.clear(); pintar(); });
      const excluir = CC.$('[data-excluir-sel]', barra);
      if (excluir) excluir.addEventListener('click', () => aoExcluir(escolhidas()));
    };
    caixas.forEach((c) => c.addEventListener('change', () => { const id = c.closest('tr').dataset.id; if (c.checked) sel.add(id); else sel.delete(id); pintar(); }));
    if (todas) todas.addEventListener('change', () => { sel.clear(); if (todas.checked) vis.forEach((i) => sel.add(i.publicId)); pintar(); });
    pintar();
  };

  // Aba Excluidas: tabela com "Restaurar" por linha.
  const COLUNAS_EXCLUIDAS = [{ rotulo: 'Obra' }, { rotulo: 'Situação financeira' }, { rotulo: 'Valor', num: true }, { rotulo: 'Excluída' }, { rotulo: 'Ações', num: true }];
  const linhaExcluida = (i) => ({
    id: i.publicId,
    celulas: [
      `<span class="duas-l"><b>${esc(i.code)}</b><span>${esc(i.name)}</span></span>`,
      `<span class="duas-l">${B.chipFinanceiro(i)}<span>${esc(i.clientName || i.client || '')}</span></span>`,
      `<b>${esc(CC.money(i.receivableAmount))}</b>`,
      `<span class="duas-l excl-quem"><b>${esc(D.data(i.deletedAt) || '—')}</b><span>${esc([i.deletedByEmail, i.deletedReason].filter(Boolean).join(' · '))}</span></span>`,
      `<span class="acoes"><button type="button" class="btn btn-s" data-acao="restaurar" data-id="${esc(i.publicId)}" aria-label="Restaurar cobrança ${esc(i.name)}">${D.ic('arrow-counter-clockwise', 16)}Restaurar</button></span>`,
    ],
  });
  B.htmlExcluidas = (vis, total) => `<div class="card tabela">${U.tabela({ colunas: COLUNAS_EXCLUIDAS, linhas: vis.map(linhaExcluida), vazio: total ? 'Nenhuma cobrança excluída com esses filtros.' : 'Nenhuma cobrança excluída. O que você excluir aparece aqui para restaurar.' })}
    <div class="rodape"><span class="muted">${vis.length} de ${total} ${plural(total, 'cobrança excluída', 'cobranças excluídas')}</span></div></div>`;
  B.ligarRestaurar = (el, vis, aoMudar) => CC.$$('[data-acao="restaurar"]', el).forEach((b) => b.addEventListener('click', async () => {
    const item = vis.find((x) => x.publicId === b.dataset.id);
    const solta = U.ocupar(b, 'Restaurando…');
    const ok = item && await B.restaurar(item);
    if (ok) aoMudar(); else solta();
  }));
})(window.CC);
