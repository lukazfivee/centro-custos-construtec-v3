// Importar orcamento (arquivo .json do Orcamentos: previa e confirmacao) e vincular gastos sem
// vinculo a insumos. Mesmo fluxo do sistema atual (public/budget-view.js); so admin e gestor.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const O = D.obras = D.obras || {};
  const U = D.ui;
  // Mensagens tecnicas do servidor viram frases claras.
  const amigavel = (m) => (/HASH_MISMATCH/.test(m) ? 'O arquivo foi alterado depois de exportado do Orçamentos: a assinatura não confere. Exporte a proposta de novo.'
    : (/CONFLICT/.test(m) ? 'Esta revisão já foi importada com conteúdo diferente. Confira no Orçamentos qual é a revisão certa.' : m));
  const rev = (p) => `${p.number} REV ${String(p.revision == null ? 0 : p.revision).padStart(2, '0')}`;

  function previaHtml(p) {
    if (p.status === 'already_imported') return U.faixa('info', 'info', `${rev(p.proposal)} já foi importada antes. Nada a fazer.`);
    if (p.status === 'conflict') return U.faixa('err', 'warning-circle', p.message || 'Esta revisão já foi importada com conteúdo diferente.');
    const t = p.totals || {};
    const destino = p.targetCostCenter ? `${p.targetCostCenter.isNew ? 'Nova obra: ' : ''}${[p.targetCostCenter.code, p.targetCostCenter.name].filter(Boolean).join(' · ')}` : '—';
    return `${U.faixa('info', 'seal-check', 'Arquivo conferido: o conteúdo bate com a assinatura do Orçamentos.')}
      <dl class="dados"><dt>Proposta</dt><dd><b>${esc(rev(p.proposal))}</b></dd><dt>Cliente</dt><dd>${esc(p.client && p.client.name)}</dd>
        <dt>Obra</dt><dd>${esc(destino)}</dd><dt>Valor do contrato</dt><dd>${esc(CC.money(t.contractValue || 0))}</dd><dt>Custo base</dt><dd>${esc(CC.money(t.baseCost || 0))}</dd>
        <dt>Itens</dt><dd>${esc(`${p.materialsCount || 0} materiais · ${p.laborCount || 0} de mão de obra`)}</dd></dl>
      ${p.isReplacement ? U.faixa('warn', 'warning', 'Esta revisão atualiza a baseline atual da obra e mantém o mesmo contrato. A revisão anterior fica no histórico.') : ''}`;
  }

  // costCenterId: obra de destino ("Atualizar revisão" no detalhe) ou null (carteira).
  O.importar = async function (costCenterId, aoConcluir) {
    let previa = null;
    let enviando = false;
    const ctl = await D.painel.abrir({
      icone: 'file-arrow-up', titulo: costCenterId ? 'Atualizar revisão do orçamento' : 'Importar orçamento', sub: 'Arquivo .json exportado do Orçamentos',
      corpo: `<label class="soltar" tabindex="0">${D.ic('upload-simple', 22)}<b>Escolha o arquivo do Orçamentos</b><span class="muted">Arquivo .json da proposta aprovada</span>
        <input type="file" accept=".json,application/json" hidden></label><div data-previa></div>`,
      rodape: '<button type="button" class="btn btn-s" data-fechar>Cancelar</button><button type="button" class="btn btn-p" data-confirmar disabled>Confirmar importação</button>',
    });
    if (!ctl) return;
    const input = CC.$('input[type=file]', ctl.corpo);
    const alvo = CC.$('[data-previa]', ctl.corpo);
    const confirmar = CC.$('[data-confirmar]', ctl.rodape);
    CC.$('.soltar', ctl.corpo).addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', async () => {
      ctl.erro('');
      previa = null;
      confirmar.disabled = true;
      const arquivo = input.files[0];
      if (!arquivo) return;
      let envelope;
      try { envelope = JSON.parse(await arquivo.text()); } catch { ctl.erro('O arquivo não é um .json válido do Orçamentos.'); return; }
      alvo.innerHTML = U.carregando('Conferindo o arquivo…');
      try {
        previa = (await CC.api('/integracao/orcamentos/previas', { method: 'POST', body: costCenterId ? { ...envelope, options: { costCenterId } } : envelope })).data;
        alvo.innerHTML = previaHtml(previa);
        confirmar.disabled = previa.status !== 'ready';
      } catch (error) {
        alvo.innerHTML = '';
        ctl.erro(error.status === 0 ? 'Sem internet. Importar precisa da conexão.' : amigavel(error.message));
      }
    });
    confirmar.addEventListener('click', async () => {
      if (!previa || enviando) return;
      enviando = true;
      confirmar.disabled = true;
      try {
        const destino = costCenterId || (previa.targetCostCenter && previa.targetCostCenter.id) || null;
        const { data } = await CC.api(`/integracao/orcamentos/previas/${previa.previewId}/confirmar`, { method: 'POST', body: { hash: previa.hash, costCenterId: destino } });
        ctl.marcarSalvo();
        ctl.fechar(true);
        CC.toast(`Orçamento ${rev(previa.proposal)} importado`);
        if (aoConcluir) aoConcluir(data);
      } catch (error) {
        confirmar.disabled = false;
        ctl.erro(error.status === 0 ? 'Sem internet. Importar precisa da conexão.' : amigavel(error.message));
      } finally {
        enviando = false;
      }
    });
  };

  // Vincular os gastos sem vinculo a um insumo da planilha (um por vez, como no sistema atual).
  O.vincular = async function (obra, cmp, aoConcluir) {
    const itens = cmp.items || [];
    const opcoes = [{ valor: '', rotulo: 'Escolha o insumo' }, ...itens.map((i) => ({ valor: i.controlItemId, rotulo: `${i.name || i.description} (${i.kind === 'labor' ? 'mão de obra' : 'material'} · saldo ${CC.money(i.balance)})` }))];
    const pendentes = (cmp.unmapped && cmp.unmapped.items) || [];
    const lista = () => pendentes.map((g) => `<div class="card doc vinc" data-gasto="${esc(g.id)}"><span class="tx"><b>${esc(g.description || 'Despesa')}</b>
      <span>${esc([D.data(String(g.date || '').slice(0, 10)), CC.money(g.amount)].filter(Boolean).join(' · '))}</span></span>
      <select class="inp" aria-label="Insumo para ${esc(g.description || 'a despesa')}">${opcoes.map((o) => `<option value="${esc(o.valor)}">${esc(o.rotulo)}</option>`).join('')}</select>
      <button type="button" class="btn btn-s" data-ligar>Vincular</button></div>`).join('') || U.vazio('check-circle', 'Todos os gastos estão vinculados.');
    const ctl = await D.painel.abrir({
      icone: 'link', titulo: 'Vincular gastos a insumos', sub: `${pendentes.length} gasto(s) sem vínculo · ${obra.nome}`,
      corpo: `<span class="muted">Ligue cada gasto a um insumo da planilha para o consumo ficar certo.</span><div class="lista-docs" data-lista>${lista()}</div>`,
      rodape: '<button type="button" class="btn btn-s" data-fechar>Fechar</button>',
      aoFechar: aoConcluir,
    });
    if (!ctl) return;
    ctl.corpo.addEventListener('click', async (e) => {
      const bt = e.target.closest('[data-ligar]');
      if (!bt) return;
      const card = bt.closest('[data-gasto]');
      const insumo = CC.$('select', card).value;
      if (!insumo) { ctl.erro('Escolha o insumo antes de vincular.'); return; }
      ctl.erro('');
      bt.disabled = true;
      try {
        await CC.api(`/centros-custo/${obra.id}/apropriacoes`, { method: 'POST', body: { allocationId: card.dataset.gasto, contractId: cmp.contract.id, controlItemId: insumo } });
        pendentes.splice(pendentes.findIndex((g) => String(g.id) === card.dataset.gasto), 1);
        CC.$('[data-lista]', ctl.corpo).innerHTML = lista();
        ctl.sujo = false;
        CC.toast(pendentes.length ? 'Gasto vinculado' : 'Todos os gastos estão vinculados');
      } catch (error) {
        bt.disabled = false;
        ctl.erro(error.message);
      }
    });
    ctl.corpo.addEventListener('change', () => setTimeout(() => { ctl.sujo = false; }));
  };
})(window.CC);
