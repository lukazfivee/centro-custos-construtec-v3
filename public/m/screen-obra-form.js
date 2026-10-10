// Editar obra no celular: os mesmos campos do desktop (public/d/telas/obra-form.js), com a revisao
// para nao sobrescrever a alteracao de outra pessoa. PUT /api/centros-custo/:id (p5).
(function (CC) {
  const { esc, icon } = CC;
  const SITUACAO = [['planejamento', 'Planejamento'], ['execucao', 'Em execução'], ['pausado', 'Pausada'], ['concluido', 'Concluída']];
  CC.obraSituacao = (s) => (SITUACAO.find(([k]) => k === s) || SITUACAO[0])[1];
  const valorBr = (n) => (Number(n) ? Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');

  // params: { id, from }. Le a obra de novo para ter a revisao atual.
  CC.screens['obra-editar'] = async function (params) {
    const id = Number(params && params.id);
    const voltar = () => CC.go('obra', { id });
    const el = CC.render(`<div class="top"><button class="back" type="button" id="voltar" aria-label="Voltar">${icon('caret-left', 20)}</button><h1>Editar obra</h1></div><div class="skeleton"></div>`, true);
    CC.$('#voltar', el).addEventListener('click', voltar);
    let o;
    try { o = (await CC.api(`/centros-custo/${id}/detalhes?mes=${CC.month()}`)).data.centro; } catch (error) {
      return CC.errorScreen(el, error, () => CC.screens['obra-editar'](params));
    }
    const campo = (rot, idc, valor, extra) => `<label class="field"><span>${rot}</span><input id="${idc}" value="${esc(valor || '')}"${extra || ''}></label>`;
    const page = CC.render(`<div class="top"><button class="back" type="button" id="voltar" aria-label="Voltar">${icon('caret-left', 20)}</button>
        <span class="grow"><h1>Editar obra</h1><small class="muted">${esc(o.codigo)}</small></span></div>
      <div class="grid2">${campo('Código', 'o-codigo', o.codigo, ' maxlength="40" autocapitalize="characters"')}
        <label class="field"><span>Situação</span><select id="o-sit">${SITUACAO.map(([k, t]) => `<option value="${k}"${o.situacao === k ? ' selected' : ''}>${t}</option>`).join('')}</select></label></div>
      <label class="field"><span>Nome da obra</span><textarea id="o-nome" rows="2" maxlength="140">${esc(o.nome)}</textarea></label>
      ${campo('Cliente', 'o-cli', o.cliente, ' maxlength="160"')}
      <div class="grid2">${campo('Contrato', 'o-contrato', o.contrato, ' maxlength="80"')}${campo('Responsável', 'o-resp', o.responsavel, ' maxlength="120"')}</div>
      <div class="grid2">${campo('Início', 'o-ini', o.data_inicio, ' type="date"')}${campo('Término previsto', 'o-fim', o.data_fim, ' type="date"')}</div>
      <div class="grid2">${campo('Valor contratado (R$)', 'o-contr', valorBr(o.valor_contrato), ' inputmode="decimal" placeholder="0,00"')}
        ${campo('Orçamento mensal (R$)', 'o-orc', valorBr(o.orcamento), ' inputmode="decimal" placeholder="0,00"')}</div>
      <label class="field"><span>Descrição / escopo</span><textarea id="o-desc" rows="3" maxlength="2000" placeholder="Opcional">${esc(o.descricao || '')}</textarea></label>
      <label class="menu-item pref"><span>Obra ativa<small>Inativas somem das listas de lançamento</small></span><input type="checkbox" id="o-ativo"${o.ativo !== false ? ' checked' : ''}></label>
      <p class="alert" role="alert" id="err"></p>
      <div class="actions"><button class="btn" type="button" id="salvar">${icon('check', 18)}Salvar alterações</button></div>`, true, params);
    document.body.classList.add('no-tabs');
    CC.$('#voltar', page).addEventListener('click', voltar);
    CC.$('#salvar', page).addEventListener('click', async () => {
      const v = (idc) => CC.$(`#${idc}`, page).value;
      const dinheiro = (x) => (String(x).trim() === '' ? 0 : CC.parseMoney(x));
      const showErr = (m) => { CC.$('#err', page).innerHTML = `${icon('warning-circle', 16)}<span>${esc(m)}</span>`; };
      const d = { codigo: v('o-codigo').trim(), nome: v('o-nome').trim(), situacao: v('o-sit'), cliente: v('o-cli').trim(), contrato: v('o-contrato').trim(),
        responsavel: v('o-resp').trim(), data_inicio: v('o-ini') || null, data_fim: v('o-fim') || null, valor_contrato: dinheiro(v('o-contr')),
        orcamento: dinheiro(v('o-orc')), descricao: v('o-desc').trim(), ativo: CC.$('#o-ativo', page).checked, tipo: o.tipo || 'obra' };
      if (!d.codigo || !d.nome) return showErr('Informe o código e o nome.');
      if (!(d.valor_contrato >= 0) || !(d.orcamento >= 0)) return showErr('Confira os valores: use o formato 1.234,56.');
      if (d.data_inicio && d.data_fim && d.data_fim < d.data_inicio) return showErr('O término não pode ser antes do início.');
      const b = CC.$('#salvar', page);
      CC.busy(b, 'Salvando…');
      try { await CC.api(`/centros-custo/${id}`, { method: 'PUT', body: { ...d, revisao: Number(o.revision) } }); } catch (error) {
        b.disabled = false; b.innerHTML = `${icon('check', 18)}Salvar alterações`;
        return showErr(error.status === 0 ? 'Sem internet. Salvar a obra precisa da conexão.' : error.message);
      }
      CC.toast('Obra atualizada');
      return voltar();
    });
    return undefined;
  };
})(window.CC = window.CC || {});
