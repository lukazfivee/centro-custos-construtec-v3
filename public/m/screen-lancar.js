// Novo lancamento (despesa ou receita) com foto da nota e confirmacao animada, e edicao de um lancamento.
// Prototipo: sCam/sConf/sOk (sem leitura automatica da nota). Novo sem internet entra na fila; editar precisa da conexao.
(function (CC) {
  const { esc, icon, money } = CC;
  let draft = null;

  // Reduz a foto para caber folgada no limite de 8 MB do anexo (JPEG, lado maior 1600 px).
  async function shrink(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
      const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.72);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  CC.shrink = shrink; // tambem usado nas fotos e recibos dos servicos e nos documentos do lancamento

  function validate(d) {
    const rec = d.tipo === 'receita';
    if (!d.obraId) return 'Escolha a obra.';
    if (!d.categoriaId) return 'Escolha a categoria.';
    if (!d.descricao.trim()) return rec ? 'Descreva a receita.' : 'Descreva a despesa.';
    if (!(d.valor > 0)) return rec ? 'Informe o valor da receita.' : 'Informe o valor da despesa.';
    if (!d.data) return 'Informe a data.';
    if (d.pagamento === 'apagar' && !d.vencimento) return 'Informe o vencimento.';
    if (d.pagamento === 'pago' && !d.liquidacao) return rec ? 'Informe a data do recebimento.' : 'Informe a data do pagamento.';
    const fe = CC.lanc && CC.lanc.fechado(d.data);
    if (fe) return `A competência de ${CC.lanc.mesAno(d.data)} está fechada. Use outra data ou peça ao administrador para reabrir.`;
    return '';
  }

  function read(el) {
    const v = (id) => { const x = CC.$(`#${id}`, el); return x ? x.value : ''; };
    return {
      ...draft, obraId: Number(v('f-obra')), categoriaId: Number(v('f-cat')), favorecido: v('f-forn').trim(), descricao: v('f-desc'),
      valor: CC.parseMoney(v('f-valor')), data: v('f-data'), documento: v('f-nf').trim(), observacao: v('f-obs'),
      vencimento: CC.$('#f-venc', el) ? v('f-venc') : draft.vencimento, liquidacao: CC.$('#f-liq', el) ? v('f-liq') : draft.liquidacao,
      forma: CC.$('#f-forma', el) ? v('f-forma') : draft.forma,
    };
  }

  function fromTx(l) {
    return {
      id: l.id, revisao: Number(l.revision), tipo: l.tipo, obraId: l.cost_center_id, categoriaId: l.category_id, foto: null,
      pagamento: l.status_financeiro === 'liquidado' ? 'pago' : 'apagar', data: l.data, vencimento: l.vencimento || l.data,
      liquidacao: l.data_liquidacao || l.data, forma: l.forma_pagamento || '', valor: Number(l.valor), descricao: l.descricao || '',
      favorecido: l.favorecido || '', documento: l.documento || '', observacao: l.observacao || '',
    };
  }

  CC.screens.lancar = async function (params) {
    const from = (params && params.from) || ['home'];
    if (params && params.editar) draft = fromTx(params.editar);
    else if (!draft || (params && params.novo)) {
      draft = { tipo: (params && params.tipo) || 'despesa', obraId: params && params.obraId, categoriaId: 0, foto: null, pagamento: 'apagar', data: CC.today(), vencimento: CC.today(),
        liquidacao: CC.today(), forma: '', valor: NaN, descricao: '', favorecido: '', documento: '', observacao: '' };
    }
    const editing = !!draft.id;
    const el = CC.render('<div class="skeleton"></div>', true);
    let obras, cats, forns;
    try {
      [obras, cats, forns] = await Promise.all([CC.cached('obras', `/centros-custo?mes=${CC.month()}`), CC.cached('categorias', '/categorias'),
        CC.cached('fornecedores', '/fornecedores').catch(() => ({ data: [] })), CC.lanc ? CC.lanc.fechamentos() : null]);
    } catch (error) {
      return CC.errorScreen(el, error, () => CC.screens.lancar(params));
    }
    const rec = draft.tipo === 'receita';
    const obraList = (obras.data || []).filter((c) => (c.ativo !== false && c.situacao !== 'concluido') || c.id === Number(draft.obraId));
    const catList = (cats.data || []).filter((c) => (c.ativo !== false || c.id === Number(draft.categoriaId)) && (c.tipo === draft.tipo || c.tipo === 'ambos'));
    if (draft.categoriaId && !catList.some((c) => c.id === Number(draft.categoriaId))) draft.categoriaId = 0;
    const fornList = (Array.isArray(forns.data) ? forns.data : (forns.data && forns.data.itens) || []).filter((x) => x.ativo !== false);
    const opt = (list, sel, label) => `<option value="">${label}</option>${list.map((i) => `<option value="${i.id}"${Number(sel) === i.id ? ' selected' : ''}>${esc(i.nome)}</option>`).join('')}`;
    const value = Number.isFinite(draft.valor) ? draft.valor.toFixed(2).replace('.', ',') : '';
    const pago = draft.pagamento === 'pago';
    const titulo = editing ? 'Editar lançamento' : (rec ? 'Nova receita' : 'Nova despesa');
    const page = CC.render(`<div class="top"><button class="back" type="button" id="voltar" aria-label="Voltar">${icon('caret-left', 20)}</button><h1>${titulo}</h1></div>
      <div class="seg" role="group" aria-label="Tipo do lançamento"><button type="button" data-tipo="despesa" aria-pressed="${!rec}">Despesa</button><button type="button" data-tipo="receita" aria-pressed="${rec}">Receita</button></div>
      ${editing ? '' : `<div class="card photo"><span class="thumb" id="thumb"${draft.foto ? ` style="background-image:url('${draft.foto}')"` : ''}>${draft.foto ? '' : icon('receipt', 24)}</span>
        <span style="flex:1;display:flex;flex-direction:column;gap:8px"><small class="muted">${draft.foto ? 'Foto anexada' : (rec ? 'Foto do comprovante (opcional)' : 'Tire uma foto da nota fiscal ou do recibo')}</small>
        <span class="grid2"><label class="btn2">${icon('camera', 18)}Câmera<input class="sr" type="file" id="f-cam" accept="image/*" capture="environment"></label>
        <label class="btn2">${icon('image', 18)}Galeria<input class="sr" type="file" id="f-gal" accept="image/jpeg,image/png,image/webp"></label></span></span></div>`}
      <label class="field"><span>Obra</span><select id="f-obra">${opt(obraList, draft.obraId, 'Escolha a obra')}</select></label>
      <label class="field"><span>${rec ? 'Cliente / pagador' : 'Fornecedor'}</span><input id="f-forn" maxlength="160" autocomplete="off" list="f-forn-lista" value="${esc(draft.favorecido)}" placeholder="${rec ? 'Nome ou razão social' : 'Ex.: Seg Distribuidora'}"></label>
      <datalist id="f-forn-lista">${fornList.map((x) => `<option value="${esc(x.nome)}"></option>`).join('')}</datalist>
      <label class="field"><span>Descrição</span><input id="f-desc" maxlength="240" autocomplete="off" value="${esc(draft.descricao)}" placeholder="${rec ? 'Ex.: Medição 3' : 'Ex.: Cabos e conectores'}"></label>
      <label class="field money"><span>Valor</span><input id="f-valor" inputmode="decimal" autocomplete="off" value="${esc(value)}" placeholder="0,00"></label>
      <div class="grid2"><label class="field"><span>Data (competência)</span><input id="f-data" type="date" value="${esc(draft.data)}"></label>
        <label class="field"><span>Nota fiscal</span><input id="f-nf" maxlength="80" value="${esc(draft.documento)}" placeholder="Opcional"></label></div>
      <label class="field"><span>Categoria</span><select id="f-cat">${opt(catList, draft.categoriaId, 'Escolha a categoria')}</select></label>
      <div class="field"><span>Situação</span><div class="seg" role="group" aria-label="Situação">
        <button type="button" data-pag="apagar" aria-pressed="${!pago}">${rec ? 'A receber' : 'A pagar'}</button>
        <button type="button" data-pag="pago" aria-pressed="${pago}">${rec ? 'Já recebi' : 'Já paguei'}</button></div></div>
      ${pago ? `<div class="grid2"><label class="field"><span>${rec ? 'Recebido em' : 'Pago em'}</span><input id="f-liq" type="date" value="${esc(draft.liquidacao)}"></label>
        <label class="field"><span>Forma</span><select id="f-forma"><option value="">Escolha</option>${(CC.lanc ? CC.lanc.FORMAS : []).map((f) => `<option${draft.forma === f ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select></label></div>`
        : `<label class="field"><span>Vencimento</span><input id="f-venc" type="date" value="${esc(draft.vencimento)}"></label>`}
      <label class="field"><span>Observação</span><textarea id="f-obs" maxlength="5000" placeholder="Opcional">${esc(draft.observacao)}</textarea></label>
      <p class="alert" role="alert" id="err"></p>
      <div class="actions"><button class="btn" type="button" id="salvar">${icon('check', 18)}${editing ? 'Salvar alterações' : 'Salvar lançamento'}</button></div>`, true, params);
    document.body.classList.add('no-tabs');
    CC.$('#voltar', page).addEventListener('click', () => { draft = null; CC.go(from[0], from[1]); });
    const redraw = () => CC.screens.lancar({ from });
    for (const id of ['f-cam', 'f-gal']) {
      const input = CC.$(`#${id}`, page);
      if (input) input.addEventListener('change', async (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        draft = read(page);
        try { draft.foto = await shrink(file); } catch { CC.toast('Não foi possível ler a foto. Tente outra.', 'warning-circle'); }
        redraw();
      });
    }
    CC.$$('[data-tipo]', page).forEach((b) => b.addEventListener('click', () => { if (b.dataset.tipo === draft.tipo) return; draft = { ...read(page), tipo: b.dataset.tipo }; redraw(); }));
    CC.$$('[data-pag]', page).forEach((b) => b.addEventListener('click', () => { if (b.dataset.pag === draft.pagamento) return; draft = { ...read(page), pagamento: b.dataset.pag }; redraw(); }));
    CC.$('#salvar', page).addEventListener('click', async () => {
      const d = read(page);
      const problem = validate(d);
      const showErr = (msg) => { CC.$('#err', page).innerHTML = `${icon('warning-circle', 16)}<span>${esc(msg)}</span>`; };
      if (problem) return showErr(problem);
      const button = CC.$('#salvar', page);
      button.disabled = true;
      const obra = obraList.find((o) => o.id === d.obraId);
      const paid = d.pagamento === 'pago';
      const payload = { tipo: d.tipo, cost_center_id: d.obraId, category_id: d.categoriaId, descricao: d.descricao.trim(), favorecido: d.favorecido || null,
        valor: d.valor, data: d.data, vencimento: paid ? (d.vencimento || d.data) : d.vencimento, status_financeiro: paid ? 'liquidado' : 'pendente',
        data_liquidacao: paid ? d.liquidacao : null, forma_pagamento: paid ? (d.forma || null) : null, documento: d.documento || null, observacao: d.observacao.trim() || null };
      if (editing) {
        try { await CC.api(`/lancamentos/${d.id}`, { method: 'PUT', body: { ...payload, revisao: d.revisao } }); } catch (error) {
          draft = d;
          button.disabled = false;
          return showErr(error.status === 0 ? 'Sem internet. Editar precisa da conexão; o que você mudou continua aqui.' : error.message);
        }
        draft = null;
        CC.toast('Alterações salvas');
        return CC.go(from[0], from[1]);
      }
      const item = {
        client_id: CC.uuid(), obra_nome: obra ? obra.nome : '', payload,
        foto: d.foto ? { nome: `${d.tipo === 'receita' ? 'comprovante' : 'nota'}-${d.data}.jpg`, tipo: 'image/jpeg', categoria: d.tipo === 'receita' ? 'comprovante' : 'nota_fiscal', observacao: 'Foto tirada no celular', conteudoBase64: d.foto } : null,
      };
      try {
        await CC.queue.add(item);
      } catch {
        // Nada foi guardado nem enviado: mostra o erro e mantem o que foi digitado.
        draft = d;
        button.disabled = false;
        return showErr('Não foi possível salvar no celular. Libere espaço ou tente sem a foto.');
      }
      const still = await CC.store.get('fila', item.client_id).catch(() => null);
      draft = null;
      CC.screens.ok({ item, offline: Boolean(still && still.estado !== 'erro'), erro: still && still.estado === 'erro' ? still.erro : '', from });
    });
  };

  CC.screens.ok = function ({ item, offline, erro, from }) {
    const p = item.payload;
    const rec = p.tipo === 'receita';
    const nome = rec ? 'Receita lançada' : 'Despesa lançada';
    const situacao = p.status_financeiro === 'liquidado' ? `${rec ? 'Recebido' : 'Pago'} em ${CC.dateBr(p.data_liquidacao || p.data)}` : `${rec ? 'A receber' : 'A pagar'} · vence ${CC.dateBr(p.vencimento)}`;
    const note = erro ? `<div class="note off">${icon('warning-circle', 18)}<span><b>O servidor não aceitou.</b> ${esc(erro)} Corrija em Lançamentos.</span></div>`
      : (offline ? `<div class="note off">${icon('cloud-slash', 18)}<span><b>Salvo no celular.</b> O lançamento e a foto vão para o servidor sozinhos quando a internet voltar. Pode continuar lançando.</span></div>`
        : `<div class="note ok">${icon('check', 18)}<span>Enviado para o Centro de Custos${item.foto ? ' com a foto' : ''}.</span></div>`);
    const el = CC.render(`<div style="height:24px"></div>${CC.success(72, nome)}
      <h1 class="title" style="text-align:center">${nome}</h1>
      <p class="muted" style="text-align:center;margin:-8px 0 0">${esc(item.obra_nome)}${p.documento ? ` · NF ${esc(p.documento)}` : ''}</p>
      <div class="card"><div class="kv"><span>${esc(p.favorecido || p.descricao)}</span><b>${esc(money(p.valor))}</b></div>
        <div class="kv"><span>Situação</span><b>${esc(situacao)}</b></div></div>
      ${note}
      <div class="actions"><button class="btn2" type="button" id="outra">${icon('camera', 18)}Lançar outra</button>
        <button class="btn" type="button" id="ver">Ver lançamentos</button></div>`, true);
    document.body.classList.add('no-tabs');
    CC.$('#outra', el).addEventListener('click', () => CC.go('lancar', { obraId: p.cost_center_id, tipo: p.tipo, novo: true, from }));
    CC.$('#ver', el).addEventListener('click', () => CC.go('obra', { id: p.cost_center_id, tab: 'lanc' }));
  };
})(window.CC = window.CC || {});
