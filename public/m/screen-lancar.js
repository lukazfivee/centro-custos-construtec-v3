// Nova despesa com foto da nota e confirmacao animada. Prototipo: sCam/sConf/sOk (sem leitura automatica da nota).
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

  function validate(d) {
    if (!d.obraId) return 'Escolha a obra.';
    if (!d.categoriaId) return 'Escolha a categoria.';
    if (!d.descricao.trim()) return 'Descreva a despesa.';
    if (!(d.valor > 0)) return 'Informe o valor da despesa.';
    if (!d.data) return 'Informe a data da despesa.';
    if (d.pagamento === 'apagar' && !d.vencimento) return 'Informe o vencimento.';
    return '';
  }

  function read(el) {
    const v = (id) => CC.$(`#${id}`, el).value;
    return {
      ...draft, obraId: Number(v('f-obra')), categoriaId: Number(v('f-cat')), favorecido: v('f-forn').trim(), descricao: v('f-desc'),
      valor: CC.parseMoney(v('f-valor')), data: v('f-data'), vencimento: v('f-venc'), documento: v('f-nf').trim(),
    };
  }

  CC.screens.lancar = async function (params) {
    const from = (params && params.from) || ['home'];
    if (!draft || (params && params.novo)) {
      draft = { obraId: params && params.obraId, categoriaId: 0, foto: null, pagamento: 'apagar', data: CC.today(), vencimento: CC.today(), valor: NaN, descricao: '', favorecido: '', documento: '' };
    }
    const el = CC.render('<div class="skeleton"></div>', true);
    let obras, cats;
    try {
      [obras, cats] = await Promise.all([CC.cached('obras', `/centros-custo?mes=${CC.month()}`), CC.cached('categorias', '/categorias')]);
    } catch (error) {
      return CC.errorScreen(el, error, () => CC.screens.lancar(params));
    }
    const obraList = (obras.data || []).filter((c) => c.ativo !== false && c.situacao !== 'concluida');
    const catList = (cats.data || []).filter((c) => c.ativo !== false && (c.tipo === 'despesa' || c.tipo === 'ambos'));
    const opt = (list, sel, label) => `<option value="">${label}</option>${list.map((i) => `<option value="${i.id}"${Number(sel) === i.id ? ' selected' : ''}>${esc(i.nome)}</option>`).join('')}`;
    const value = Number.isFinite(draft.valor) ? draft.valor.toFixed(2).replace('.', ',') : '';
    const page = CC.render(`<div class="top"><button class="back" type="button" id="voltar" aria-label="Voltar">${icon('caret-left', 20)}</button><h1>Nova despesa</h1></div>
      <div class="card photo"><span class="thumb" id="thumb"${draft.foto ? ` style="background-image:url('${draft.foto}')"` : ''}>${draft.foto ? '' : icon('receipt', 24)}</span>
        <span style="flex:1;display:flex;flex-direction:column;gap:8px"><small class="muted">${draft.foto ? 'Foto da nota anexada' : 'Tire uma foto da nota fiscal ou do recibo'}</small>
        <span class="grid2"><label class="btn2">${icon('camera', 18)}Câmera<input class="sr" type="file" id="f-cam" accept="image/*" capture="environment"></label>
        <label class="btn2">${icon('image', 18)}Galeria<input class="sr" type="file" id="f-gal" accept="image/jpeg,image/png,image/webp"></label></span></span></div>
      <label class="field"><span>Obra</span><select id="f-obra">${opt(obraList, draft.obraId, 'Escolha a obra')}</select></label>
      <label class="field"><span>Fornecedor</span><input id="f-forn" maxlength="160" autocomplete="off" value="${esc(draft.favorecido)}" placeholder="Ex.: Seg Distribuidora"></label>
      <label class="field"><span>Descrição</span><input id="f-desc" maxlength="240" autocomplete="off" value="${esc(draft.descricao)}" placeholder="Ex.: Cabos e conectores"></label>
      <label class="field money"><span>Valor</span><input id="f-valor" inputmode="decimal" autocomplete="off" value="${esc(value)}" placeholder="0,00"></label>
      <div class="grid2"><label class="field"><span>Data</span><input id="f-data" type="date" value="${esc(draft.data)}"></label>
        <label class="field"><span>Nota fiscal</span><input id="f-nf" maxlength="80" inputmode="numeric" value="${esc(draft.documento)}" placeholder="Opcional"></label></div>
      <label class="field"><span>Categoria</span><select id="f-cat">${opt(catList, draft.categoriaId, 'Escolha a categoria')}</select></label>
      <div class="field"><span>Pagamento</span><div class="seg" role="group" aria-label="Pagamento">
        <button type="button" data-pag="apagar" aria-pressed="${draft.pagamento === 'apagar'}">A pagar</button>
        <button type="button" data-pag="pago" aria-pressed="${draft.pagamento === 'pago'}">Já paguei</button></div></div>
      <label class="field" id="venc-box"${draft.pagamento === 'pago' ? ' hidden' : ''}><span>Vencimento</span><input id="f-venc" type="date" value="${esc(draft.vencimento)}"></label>
      <p class="alert" role="alert" id="err"></p>
      <div class="actions"><button class="btn" type="button" id="salvar">${icon('check', 18)}Salvar lançamento</button></div>`, true);
    document.body.classList.add('no-tabs');
    CC.$('#voltar', page).addEventListener('click', () => { draft = null; CC.go(from[0], from[1]); });
    for (const id of ['f-cam', 'f-gal']) {
      CC.$(`#${id}`, page).addEventListener('change', async (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        draft = read(page);
        try { draft.foto = await shrink(file); } catch { CC.toast('Não foi possível ler a foto. Tente outra.', 'warning-circle'); }
        CC.screens.lancar({ from });
      });
    }
    CC.$$('[data-pag]', page).forEach((b) => b.addEventListener('click', () => {
      draft.pagamento = b.dataset.pag;
      CC.$$('[data-pag]', page).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      CC.$('#venc-box', page).hidden = draft.pagamento === 'pago';
    }));
    CC.$('#salvar', page).addEventListener('click', async () => {
      const d = read(page);
      const problem = validate(d);
      if (problem) { CC.$('#err', page).innerHTML = `${icon('warning-circle', 16)}<span>${esc(problem)}</span>`; return; }
      const button = CC.$('#salvar', page);
      button.disabled = true;
      const obra = obraList.find((o) => o.id === d.obraId);
      const paid = d.pagamento === 'pago';
      const item = {
        client_id: CC.uuid(), obra_nome: obra ? obra.nome : '',
        payload: { tipo: 'despesa', cost_center_id: d.obraId, category_id: d.categoriaId, descricao: d.descricao.trim(), favorecido: d.favorecido || null,
          valor: d.valor, data: d.data, vencimento: paid ? d.data : d.vencimento, status_financeiro: paid ? 'liquidado' : 'pendente',
          data_liquidacao: paid ? d.data : null, documento: d.documento || null },
        foto: d.foto ? { nome: `nota-${d.data}.jpg`, tipo: 'image/jpeg', categoria: 'nota_fiscal', observacao: 'Foto tirada no celular', conteudoBase64: d.foto } : null,
      };
      try { await CC.queue.add(item); } catch { /* fica na fila; o envio tenta de novo */ }
      const still = await CC.store.get('fila', item.client_id).catch(() => null);
      draft = null;
      CC.screens.ok({ item, offline: Boolean(still && still.estado !== 'erro'), erro: still && still.estado === 'erro' ? still.erro : '', from });
    });
  };

  CC.screens.ok = function ({ item, offline, erro, from }) {
    const p = item.payload;
    const situacao = p.status_financeiro === 'liquidado' ? `Pago em ${CC.dateBr(p.data)}` : `A pagar · vence ${CC.dateBr(p.vencimento)}`;
    const note = erro ? `<div class="note off">${icon('warning-circle', 18)}<span><b>O servidor não aceitou.</b> ${esc(erro)} Corrija em Lançamentos.</span></div>`
      : (offline ? `<div class="note off">${icon('cloud-slash', 18)}<span><b>Salvo no celular.</b> A despesa e a foto vão para o servidor sozinhas quando a internet voltar. Pode continuar lançando.</span></div>`
        : `<div class="note ok">${icon('check', 18)}<span>Enviado para o Centro de Custos${item.foto ? ' com a foto da nota' : ''}.</span></div>`);
    const el = CC.render(`<div style="height:24px"></div>${CC.success(72, 'Despesa lançada')}
      <h1 class="title" style="text-align:center">Despesa lançada</h1>
      <p class="muted" style="text-align:center;margin:-8px 0 0">${esc(item.obra_nome)}${p.documento ? ` · NF ${esc(p.documento)}` : ''}</p>
      <div class="card"><div class="kv"><span>${esc(p.favorecido || p.descricao)}</span><b>${esc(money(p.valor))}</b></div>
        <div class="kv"><span>Situação</span><b>${esc(situacao)}</b></div></div>
      ${note}
      <div class="actions"><button class="btn2" type="button" id="outra">${icon('camera', 18)}Lançar outra</button>
        <button class="btn" type="button" id="ver">Ver lançamentos</button></div>`, true);
    document.body.classList.add('no-tabs');
    CC.$('#outra', el).addEventListener('click', () => CC.go('lancar', { obraId: p.cost_center_id, novo: true, from }));
    CC.$('#ver', el).addEventListener('click', () => CC.go('obra', { id: p.cost_center_id, tab: 'lanc' }));
  };
})(window.CC = window.CC || {});
