// Mais acoes, iniciar, concluir (com pendencias), faturar e relatorio do servico.
// Prototipo: Rodada 28 (svMenu, svConc, svFat, sSvRel; 28af a 28am).
(function (CC) {
  const { esc, icon, money } = CC;
  const FORMAS = [['pix', 'Pix'], ['boleto', 'Boleto'], ['transferencia', 'Transferência']];
  const VENCS = [[0, 'À vista'], [15, '15 dias'], [30, '30 dias']];
  const netErr = (error) => (error && error.status === 0 ? { status: 0, message: 'Nada foi alterado. Confira a conexão e tente de novo.' } : error);
  const errBox = (error) => (error ? `<div class="od-err sv-err" role="alert">${icon('warning-circle', 20)}<span><b>${error.status === 0 ? 'Sem conexão' : 'Não foi possível concluir'}</b><small>${esc(error.message)}</small></span></div>` : '');

  CC.sv.menu = function (s) {
    const item = (id, ic, t, sub) => `<button type="button" class="suite-item om-item" id="${id}">${icon(ic, 22)}<span><b>${esc(t)}</b><small>${esc(sub)}</small></span></button>`;
    const sh = CC.sheet('sv-sheet', `${CC.sheetHead('wrench', s.codigo)}<p class="muted od-sub">${esc(s.nome)}</p><div style="height:10px"></div>
      ${CC.sv.can('p5') ? item('sm-edit', 'pencil-simple', 'Editar serviço', 'Dados, valor cobrado ou mudar para obra') : ''}
      ${item('sm-rel', 'file-text', 'Relatório do serviço', '1 página para o cliente')}
      ${s.situacao === 'agendado' ? item('sm-ini', 'play', 'Iniciar serviço', 'Passa para Em andamento') : ''}
      ${s.situacao === 'em_andamento' ? item('sm-conc', 'check-circle', 'Concluir serviço', 'Confere checklist, fotos e aceite') : ''}
      ${s.situacao === 'concluido' && CC.sv.can('p6') ? item('sm-fat', 'receipt', 'Faturar · cobrança', s.veValores ? `Gera a cobrança de ${money(s.valor)}` : 'Gera a cobrança') : ''}`);
    const on = (id, fn) => { const b = CC.$(`#${id}`, sh.el); if (b) b.addEventListener('click', () => { sh.close(); fn(); }); };
    on('sm-edit', () => CC.sv.form({ servico: s }));
    on('sm-rel', () => CC.go('servico-rel', { id: s.id }));
    on('sm-ini', () => CC.sv.acao(s, 'iniciar'));
    on('sm-conc', () => CC.sv.concluir(s));
    on('sm-fat', () => CC.sv.faturar(s));
  };

  CC.sv.acao = async function (s, acao, btn) {
    if (acao === 'concluir') return CC.sv.concluir(s);
    if (acao === 'faturar') return CC.sv.faturar(s);
    if (acao === 'relatorio') return CC.go('servico-rel', { id: s.id });
    if (btn) CC.busy(btn, 'Iniciando…');
    try {
      await CC.api(`/servicos/${s.id}/situacao`, { method: 'PUT', body: { situacao: 'em_andamento' } });
      CC.toast(`${s.codigo} em andamento`, 'play-circle');
    } catch (error) {
      CC.toast(error.status === 0 ? 'Sem internet · nada foi alterado' : error.message, 'warning-circle');
    }
    return CC.sv.reload(s.id, 'resumo');
  };

  CC.sv.concluir = function abrir(s, error) {
    const itens = s.checklist || [], feitos = itens.filter((c) => c.feito).length, fotos = s.fotos || [];
    const chkOk = feitos === itens.length, aceOk = !!s.aceite;
    const nA = fotos.filter((f) => f.fase === 'antes').length, nD = fotos.filter((f) => f.fase === 'depois').length;
    const rows = [['list-checks', 'Checklist', itens.length ? `${feitos} de ${itens.length}${chkOk ? ' feitos' : ' · faltam itens'}` : 'Sem itens', chkOk],
      ['images', 'Fotos', `${nA} antes · ${nD} depois`, nA > 0 && nD > 0], ['signature', 'Aceite do cliente', aceOk ? `Assinado por ${s.aceite.nome}` : 'Ainda não coletado', aceOk]];
    const pend = (s.pendencias || []).length > 0;
    const sh = CC.sheet('sv-sheet', `${CC.sheetHead('check-circle', 'Concluir o serviço?')}<p class="muted od-sub">${esc(s.codigo)} · ${esc(s.nome)}</p>
      ${errBox(error)}
      <div class="card sv-conf">${rows.map(([ic, t, sub, ok]) => `<div class="sv-conf-row">${icon(ic, 19)}<span class="grow"><b>${t}</b><small>${esc(sub)}</small></span>
        <span class="${ok ? 'up' : 'wn'}">${icon(ok ? 'check-circle-fill' : 'warning-circle-fill', 20)}</span></div>`).join('')}</div>
      ${pend ? `<div class="sv-note">${icon('info', 16)}<span>Dá para concluir assim. O que faltar fica marcado como pendente no relatório.</span></div>` : ''}
      <div class="sv-btns"><button class="btn2" type="button" id="c-cancel">Cancelar</button><button class="btn" type="button" id="c-ok">${icon('check-circle', 18)}Concluir serviço</button></div>`);
    CC.$('#c-cancel', sh.el).addEventListener('click', sh.close);
    CC.$('#c-ok', sh.el).addEventListener('click', async (e) => {
      CC.busy(e.currentTarget, 'Concluindo…');
      CC.$('#c-cancel', sh.el).disabled = true;
      try {
        await CC.api(`/servicos/${s.id}/concluir`, { method: 'POST', body: { comPendencias: true } });
      } catch (err) { return abrir(s, netErr(err)); }
      CC.toast(`${s.codigo} concluído · ${CC.sv.can('p6') ? 'pronto para faturar' : 'o escritório fatura'}`);
      sh.set(CC.sheetDone(`${s.codigo} concluído`, CC.sv.can('p6') ? 'O rodapé passa a Faturar.' : 'O escritório faz a cobrança.',
        `<button class="btn sv-full" type="button" id="c-fim">Fechar</button>`));
      CC.$('#c-fim', sh.el).addEventListener('click', sh.close);
      CC.sv.reload(s.id, 'resumo');
    });
  };

  CC.sv.faturar = function abrir(s, error, prev) {
    const f = prev || { valor: s.valor != null ? CC.money(s.valor).replace(/^R\$\s*/, '') : '', venc: 15, forma: 'pix', nfse: '', pdf: null };
    const sh = CC.sheet('sv-sheet', `${CC.sheetHead('receipt', 'Faturar serviço')}<p class="muted od-sub">${esc(s.codigo)} · ${esc(s.nome)}</p>
      ${errBox(error)}
      <label class="field money sv-gap"><span>Valor cobrado (R$)</span><input id="f-valor" inputmode="decimal" autocomplete="off" value="${esc(f.valor)}"></label>
      <small class="muted">${esc(s.cliente || '')}</small>
      <p class="sheet-sec">Vencimento</p><div class="sv-menores">${VENCS.map(([d, l]) => `<button type="button" class="sv-chip-b" data-venc="${d}" aria-pressed="${f.venc === d}">${l}</button>`).join('')}</div>
      <p class="sheet-sec">Forma</p><div class="sv-menores">${FORMAS.map(([k, l]) => `<button type="button" class="sv-chip-b" data-forma="${k}" aria-pressed="${f.forma === k}">${l}</button>`).join('')}</div>
      <p class="sheet-sec">NFS-e · opcional</p>
      <label class="field"><span>Número da nota</span><input id="f-nfse" maxlength="60" autocomplete="off" placeholder="Ex.: NFS-e 1.205" value="${esc(f.nfse)}"></label>
      ${f.pdf ? `<div class="sv-recibo sv-gap"><span class="th">${icon('file-pdf', 20)}</span><span class="grow"><b>${esc(f.pdf.nome)}</b><small>PDF da nota · vai para a nota vinculada</small></span><button type="button" class="sv-link" id="f-rm">Trocar</button></div>`
        : `<label class="btn2 sv-gap">${icon('paperclip', 18)}Anexar PDF da nota<input class="sr" type="file" id="f-pdf" accept="application/pdf"></label>`}
      <p class="muted sv-small" id="f-txt"></p>
      <button class="btn sv-full" type="button" id="f-ok">${icon('receipt', 18)}Gerar cobrança</button>`);
    const ler = () => ({ ...f, valor: CC.$('#f-valor', sh.el).value, nfse: CC.$('#f-nfse', sh.el).value });
    const texto = () => { CC.$('#f-txt', sh.el).textContent = `Vence ${f.venc ? `em ${f.venc} dias` : 'hoje'}. A cobrança aparece em Cobranças e o serviço fica Faturado.`; };
    texto();
    CC.$$('[data-venc]', sh.el).forEach((b) => b.addEventListener('click', () => { f.venc = Number(b.dataset.venc); CC.$$('[data-venc]', sh.el).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); texto(); }));
    CC.$$('[data-forma]', sh.el).forEach((b) => b.addEventListener('click', () => { f.forma = b.dataset.forma; CC.$$('[data-forma]', sh.el).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }));
    const rm = CC.$('#f-rm', sh.el);
    if (rm) rm.addEventListener('click', () => abrir(s, null, { ...ler(), pdf: null }));
    const pdf = CC.$('#f-pdf', sh.el);
    if (pdf) pdf.addEventListener('change', () => {
      const file = pdf.files && pdf.files[0];
      if (!file) return;
      const r = new FileReader();
      r.onload = () => abrir(s, null, { ...ler(), pdf: { nome: file.name.slice(0, 120), conteudoBase64: r.result } });
      r.readAsDataURL(file);
    });
    CC.$('#f-ok', sh.el).addEventListener('click', async (e) => {
      const d = ler();
      const valor = CC.parseMoney(d.valor);
      if (!(valor > 0)) return abrir(s, { status: 400, message: 'Informe o valor da cobrança.' }, d);
      const nfse = d.nfse.trim() || d.pdf ? { ...(d.nfse.trim() ? { numero: d.nfse.trim() } : {}), ...(d.pdf ? { arquivo: d.pdf } : {}) } : undefined;
      CC.busy(e.currentTarget, 'Gerando…');
      let data;
      try {
        ({ data } = await CC.api(`/servicos/${s.id}/faturar`, { method: 'POST', body: { valor, vencimentoDias: d.venc, forma: d.forma, ...(nfse ? { nfse } : {}) } }));
      } catch (err) { return abrir(s, netErr(err), d); }
      const cob = data.cobranca || {};
      CC.toast(`Cobrança criada · ${s.codigo} faturado`, 'receipt');
      sh.set(CC.sheetDone(`${s.codigo} faturado`, `${money(data.faturamento.valor)} · vence ${CC.dateFull(data.faturamento.vencimento)}`,
        `${cob.sincronizada === false ? `<div class="note off sv-gap">${icon('warning-circle', 18)}<span>Cobranças não foi atualizado${cob.motivo ? `: ${esc(String(cob.motivo).replace(/\.+$/, ''))}` : ''}. Confira em Cobranças.</span></div>` : ''}
        <button class="btn sv-full" type="button" id="f-fim">Fechar</button>`));
      CC.$('#f-fim', sh.el).addEventListener('click', sh.close);
      CC.sv.reload(s.id, 'lanc');
    });
  };

  // Relatorio de 1 pagina (HTML do servidor) num iframe; imprimir salva em PDF.
  CC.screens['servico-rel'] = async function (params) {
    const id = Number(params && params.id);
    const head = (sub) => `<div class="top sv-top"><button class="back" type="button" id="voltar" aria-label="Voltar">${icon('caret-left', 20)}</button>
      <span class="grow"><h1>Relatório do serviço</h1><small class="muted">${esc(sub)}</small></span></div>`;
    const el = CC.render(`${head('Carregando…')}<div class="skeleton" style="height:420px"></div>`, true, params);
    document.body.classList.add('no-tabs');
    CC.$('#voltar', el).addEventListener('click', () => CC.go('servico', { id }));
    let html;
    try {
      const r = await fetch(`/api/servicos/${id}/relatorio`, { headers: { Authorization: `Bearer ${CC.session.token()}` }, cache: 'no-store' });
      if (!r.ok) throw Object.assign(new Error((await r.json().catch(() => ({}))).erro || 'Não foi possível gerar o relatório.'), { status: r.status });
      html = await r.text();
    } catch (error) {
      if (params.__nav !== CC.nav) return;
      CC.errorScreen(el, error.status ? error : { status: 0 }, () => CC.go('servico-rel', { id }));
      return;
    }
    if (params.__nav !== CC.nav) return;
    const s = CC.sv.atual && CC.sv.atual.id === id ? CC.sv.atual : null;
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const page = CC.render(`${head(`${s ? `${s.codigo} · ` : ''}1 página`)}
      <iframe class="sv-rel" id="sv-rel" src="${url}" title="Relatório do serviço"></iframe>
      <div class="sv-note">${icon('eye-slash', 16)}<span>Sem custos internos: gastos, resultado e margem não entram no relatório. O cliente vê o que foi feito, as fotos e o valor.</span></div>
      <div class="actions"><button class="btn2" type="button" id="r-share">${icon('share-network', 18)}Compartilhar</button>
        <button class="btn" type="button" id="r-print">${icon('printer', 18)}Imprimir ou PDF</button></div>`, true, params);
    document.body.classList.add('no-tabs');
    CC.$('#voltar', page).addEventListener('click', () => { URL.revokeObjectURL(url); CC.go('servico', { id }); });
    CC.$('#r-print', page).addEventListener('click', () => { try { CC.$('#sv-rel', page).contentWindow.print(); } catch { window.open(url, '_blank'); } });
    CC.$('#r-share', page).addEventListener('click', async () => {
      const file = new File([html], `relatorio-${s ? s.codigo : id}.html`, { type: 'text/html' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'Relatório do serviço' }); } catch { /* cancelado */ }
      } else {
        CC.toast('Use Imprimir ou PDF e salve o arquivo para enviar', 'file-text');
      }
    });
  };
})(window.CC = window.CC || {});
