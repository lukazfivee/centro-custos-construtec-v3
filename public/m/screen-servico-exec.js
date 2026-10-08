// Aba Execucao do servico: o que foi feito, checklist, fotos antes e depois e o aceite do cliente (assinatura com o dedo).
// Prototipo: Rodada 28 (stExec, svAss). Fotos e assinatura vem da API com o token (fetch + blob).
(function (CC) {
  const { esc, icon } = CC;
  const blobs = new Map(); // url da API -> blob: (reaproveita entre aberturas da tela)

  async function blobUrl(path) {
    if (blobs.has(path)) return blobs.get(path);
    const r = await fetch(path, { headers: { Authorization: `Bearer ${CC.session.token()}` }, cache: 'no-store' });
    if (!r.ok) throw new Error('foto');
    const url = URL.createObjectURL(await r.blob());
    blobs.set(path, url);
    return url;
  }
  CC.sv.blobUrl = blobUrl;

  CC.sv.execucao = function (s) {
    const fechado = s.situacao === 'faturado';
    const itens = s.checklist || [];
    const feitos = itens.filter((c) => c.feito).length;
    const fotos = s.fotos || [];
    const fase = (k) => fotos.filter((f) => f.fase === k);
    const strip = (k, label) => `<div class="sv-fase"><small>${label}</small><div class="sv-fotos">
      ${fase(k).map((f) => `<button type="button" class="sv-foto${f.pendente ? ' pend' : ''}" data-foto="${esc(f.id)}" aria-label="Foto ${esc(label)} · ${esc(f.nome)}${f.pendente ? ' · aguardando internet' : ''}"${f.pendente ? '' : ` data-src="${esc(f.url)}"`}>${icon(f.pendente ? 'cloud-arrow-up' : 'image', 20)}</button>`).join('')}
      ${fechado ? '' : `<label class="sv-foto add" aria-label="Adicionar foto ${esc(label.toLowerCase())}">${icon('camera', 20)}<span>Foto</span><input class="sr" type="file" accept="image/jpeg,image/png,image/webp" data-fase="${k}"></label>`}</div></div>`;
    const ace = s.aceite;
    return `${CC.sv.avisoFila(s)}<div class="card"><span class="label">O que foi feito</span><p class="sv-desc${s.descricao ? '' : ' muted'}">${esc(s.descricao || 'Ainda sem descrição. Conte o que foi feito quando terminar.')}</p></div>
      <div class="card"><div class="sv-head"><span class="label">Checklist</span><small class="muted">${itens.length ? `${feitos} de ${itens.length}` : 'Sem itens'}</small></div>
        ${itens.map((c) => `<button type="button" class="sv-check" role="checkbox" aria-checked="${c.feito}" data-item="${esc(c.id)}"${fechado ? ' disabled' : ''}>
          <span class="box">${c.feito ? icon('check', 14) : ''}</span><span>${esc(c.texto)}</span>${c.pendente ? `<span class="sv-pend" title="Aguardando internet">${icon('cloud-arrow-up', 14)}</span>` : ''}</button>`).join('')}
        ${fechado ? '' : `<form class="sv-add" id="sv-add"><input id="sv-add-txt" maxlength="200" placeholder="Novo item do checklist" aria-label="Novo item do checklist" autocomplete="off">
          <button class="btn2" type="submit" aria-label="Adicionar item">${icon('plus', 18)}</button></form>`}</div>
      <div class="card"><div class="sv-head"><span class="label">Fotos</span><small class="muted">${fase('antes').length} antes · ${fase('depois').length} depois</small></div>
        ${strip('antes', 'Antes')}${strip('depois', 'Depois')}</div>
      <div class="card"><span class="label">Aceite do cliente</span>
        ${ace ? `<div class="sv-ass"><img id="sv-ass-img" alt="Assinatura do cliente"></div><b class="sv-ace-t">${esc([ace.nome, ace.cargo].filter(Boolean).join(' · '))}</b>
          <small class="muted">Assinou em ${esc(CC.sv.dataHora(ace.dataHora))}${ace.pendente ? ' · aguardando internet para enviar' : ''}</small>
          ${fechado ? '' : `<button class="btn2" type="button" id="sv-coletar">${icon('signature', 18)}Coletar de novo</button>`}`
        : `<p class="sv-desc muted">O cliente assina com o dedo na tela do celular quando o serviço termina. O aceite sai no relatório.</p>
          ${fechado ? '' : `<button class="btn" type="button" id="sv-coletar">${icon('signature', 18)}Coletar assinatura</button>`}`}</div>`;
  };

  const SALVO = 'Sem internet · salvo no celular, sobe sozinho';

  async function incluirItem(s, texto) {
    const id = CC.uuid(), body = { id, texto };
    try {
      const via = await CC.sv.enviar(s, { client_id: `add-${id}`, op: 'checklist-add', rotulo: `Novo item: ${texto}`, body },
        () => CC.api(`/servicos/${s.id}/checklist`, { method: 'POST', body }));
      CC.toast(via === 'fila' ? SALVO : 'Item incluído no checklist', via === 'fila' ? 'cloud-slash' : undefined);
    } catch (error) {
      CC.toast(error.message, 'warning-circle');
    }
    CC.sv.reload(s.id, 'exec');
  }

  CC.sv.bindExec = function (s, page) {
    CC.$$('[data-item]', page).forEach((b) => b.addEventListener('click', async () => {
      const feito = b.getAttribute('aria-checked') !== 'true';
      b.setAttribute('aria-checked', String(feito));
      b.querySelector('.box').innerHTML = feito ? icon('check', 14) : '';
      const item = b.dataset.item, texto = (b.querySelector('span:nth-child(2)') || {}).textContent || '';
      try {
        // Uma entrada por item: marcar e desmarcar sem internet deixa so o ultimo valor.
        const via = await CC.sv.enviar(s, { client_id: `chk-${s.id}-${item}`, op: 'checklist', rotulo: `Checklist: ${texto}`, body: { item, feito } },
          () => CC.api(`/servicos/${s.id}/checklist/${encodeURIComponent(item)}`, { method: 'PATCH', body: { feito } }));
        if (via === 'fila') CC.toast(SALVO, 'cloud-slash');
      } catch (error) {
        CC.toast(error.message, 'warning-circle');
      }
      CC.sv.reload(s.id, 'exec');
    }));
    const add = CC.$('#sv-add', page);
    if (add) add.addEventListener('submit', (e) => {
      e.preventDefault();
      const texto = CC.$('#sv-add-txt', page).value.trim();
      if (!texto) return;
      incluirItem(s, texto);
    });
    CC.$$('[data-fase]', page).forEach((input) => input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const label = input.closest('label');
      label.classList.add('busy');
      label.innerHTML = icon('circle-notch', 20, 'spin');
      try {
        const data = await CC.shrink(file);
        const fase = input.dataset.fase, body = { fase, nome: `${fase}-${Date.now()}.jpg`, tipo: 'image/jpeg', conteudoBase64: data };
        const via = await CC.sv.enviar(s, { client_id: CC.uuid(), op: 'foto', rotulo: `Foto (${fase})`, body },
          () => CC.api(`/servicos/${s.id}/fotos`, { method: 'POST', body }));
        if (via === 'fila') CC.toast('Sem internet · foto salva no celular, sobe sozinha', 'cloud-slash');
        else CC.toast(`Foto adicionada em ${fase === 'antes' ? 'Antes' : 'Depois'}`);
      } catch (error) {
        CC.toast(error.message || 'Não foi possível ler a foto.', 'warning-circle');
      }
      CC.sv.reload(s.id, 'exec');
    }));
    CC.$$('[data-foto]', page).forEach((b) => {
      const f = (s.fotos || []).find((x) => String(x.id) === b.dataset.foto);
      if (f && f.pendente) { b.style.backgroundImage = `url('${f.local}')`; b.innerHTML = icon('cloud-arrow-up', 14); } // ainda no celular
      else blobUrl(b.dataset.src).then((url) => { b.style.backgroundImage = `url('${url}')`; b.innerHTML = ''; }).catch(() => {});
      b.addEventListener('click', () => verFoto(s, f));
    });
    CC.$$('[data-retry]', page).forEach((b) => b.addEventListener('click', async () => { await CC.queue.retry(b.dataset.retry); CC.sv.reload(s.id, 'exec'); }));
    CC.$$('[data-discard]', page).forEach((b) => b.addEventListener('click', async () => { await CC.queue.discard(b.dataset.discard); CC.sv.reload(s.id, 'exec'); }));
    const img = CC.$('#sv-ass-img', page);
    if (img && s.aceite && s.aceite.pendente) img.src = s.aceite.local;
    else if (img && s.aceite) blobUrl(s.aceite.assinaturaUrl).then((url) => { img.src = url; }).catch(() => {});
    const col = CC.$('#sv-coletar', page);
    if (col) col.addEventListener('click', () => aceite(s));
  };

  function verFoto(s, f) {
    if (!f) return;
    const sh = CC.sheet('sv-sheet', `${CC.sheetHead('image', f.fase === 'antes' ? 'Foto · antes' : 'Foto · depois')}
      <img class="sv-foto-full" id="sv-ff" alt="${esc(f.nome)}"><p class="muted od-sub">${f.pendente ? 'Aguardando internet para enviar' : esc([f.enviadoPor, CC.sv.dataHora(f.criadoEm)].filter(Boolean).join(' · '))}</p>
      ${s.situacao === 'faturado' ? '' : `<button class="btn2" type="button" id="sv-ff-rm">${icon('trash', 18)}${f.pendente ? 'Tirar da fila' : 'Remover foto'}</button>`}`);
    if (f.pendente) CC.$('#sv-ff', sh.el).src = f.local;
    else blobUrl(f.url).then((url) => { CC.$('#sv-ff', sh.el).src = url; }).catch(() => {});
    const rm = CC.$('#sv-ff-rm', sh.el);
    if (rm && f.pendente) rm.addEventListener('click', async () => {
      await CC.queue.discard(f.id);
      sh.close();
      CC.toast('Foto tirada da fila');
      CC.sv.reload(s.id, 'exec');
    });
    else if (rm) rm.addEventListener('click', async () => {
      CC.busy(rm, 'Removendo…');
      try { await CC.api(`/servicos/${s.id}/fotos/${f.id}`, { method: 'DELETE' }); } catch (error) {
        rm.disabled = false; rm.innerHTML = `${icon('trash', 18)}Remover foto`;
        return CC.toast(error.status === 0 ? 'Sem internet · a foto continua' : error.message, 'warning-circle');
      }
      sh.close();
      CC.toast('Foto removida');
      CC.sv.reload(s.id, 'exec');
    });
  }

  // Assinatura com o dedo num canvas; sai em PNG para PUT /aceite.
  function aceite(s, error, prev) {
    const p = prev || { nome: '', cargo: '' };
    const sh = CC.sheet('sv-sheet', `${CC.sheetHead('signature', 'Aceite do cliente')}<p class="muted od-sub">${esc(s.codigo)} · ${esc(s.nome)}</p>
      ${error ? CC.sheetErr(error) : ''}
      <div class="sv-pad"><canvas id="sv-canvas" aria-label="Área para assinar com o dedo"></canvas>
        <span class="sv-pad-hint" id="sv-hint">${icon('hand-pointing', 26)}Assine aqui com o dedo</span>
        <button type="button" class="sv-pad-clear" id="sv-limpar" hidden>Limpar</button><span class="sv-pad-line"></span></div>
      <label class="field"><span>Nome de quem assina</span><input id="sv-a-nome" maxlength="120" autocomplete="off" placeholder="Ex.: Renata Okada" value="${esc(p.nome)}"></label>
      <label class="field"><span>Cargo · opcional</span><input id="sv-a-cargo" maxlength="120" autocomplete="off" placeholder="Ex.: Gerente administrativa" value="${esc(p.cargo)}"></label>
      <p class="muted sv-small">A assinatura, o nome, a data e a hora saem no relatório do serviço.</p>
      <button class="btn sv-full" type="button" id="sv-a-ok" disabled>${icon('signature', 18)}Confirmar aceite</button>`);
    const canvas = CC.$('#sv-canvas', sh.el), ctx = canvas.getContext('2d');
    const ratio = window.devicePixelRatio || 1, box = canvas.getBoundingClientRect();
    canvas.width = Math.round(box.width * ratio); canvas.height = Math.round(box.height * ratio);
    ctx.scale(ratio, ratio); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b2530';
    let drawing = false, traced = 0;
    const ok = CC.$('#sv-a-ok', sh.el), nome = CC.$('#sv-a-nome', sh.el);
    const check = () => { ok.disabled = !(traced > 2 && nome.value.trim().length > 1); };
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    canvas.addEventListener('pointerdown', (e) => { drawing = true; canvas.setPointerCapture(e.pointerId); const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); CC.$('#sv-hint', sh.el).hidden = true; CC.$('#sv-limpar', sh.el).hidden = false; });
    canvas.addEventListener('pointermove', (e) => { if (!drawing) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); traced += 1; });
    const end = () => { drawing = false; check(); };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    CC.$('#sv-limpar', sh.el).addEventListener('click', () => { ctx.clearRect(0, 0, canvas.width, canvas.height); traced = 0; CC.$('#sv-hint', sh.el).hidden = false; CC.$('#sv-limpar', sh.el).hidden = true; check(); });
    nome.addEventListener('input', check);
    ok.addEventListener('click', async () => {
      const dados = { nome: nome.value.trim(), cargo: CC.$('#sv-a-cargo', sh.el).value.trim() };
      // Fundo branco: a assinatura fica legivel no relatorio em qualquer tema.
      const out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height;
      const o = out.getContext('2d'); o.fillStyle = '#fff'; o.fillRect(0, 0, out.width, out.height); o.drawImage(canvas, 0, 0);
      CC.busy(ok, 'Salvando…');
      // A hora do aceite e a de quando o cliente assinou, mesmo que o envio so aconteca depois.
      const body = { ...dados, dataHora: new Date().toISOString(), assinatura: { conteudoBase64: out.toDataURL('image/png') } };
      let via;
      try {
        via = await CC.sv.enviar(s, { client_id: `aceite-${s.id}`, op: 'aceite', rotulo: `Aceite do cliente: ${dados.nome}`, body },
          () => CC.api(`/servicos/${s.id}/aceite`, { method: 'PUT', body }));
      } catch (err) { return aceite(s, err, dados); }
      sh.close();
      blobs.delete(`/api/servicos/${s.id}/aceite/assinatura`);
      CC.toast(via === 'fila' ? 'Sem internet · aceite salvo no celular, sobe sozinho' : 'Aceite do cliente salvo', via === 'fila' ? 'cloud-slash' : undefined);
      CC.sv.reload(s.id, 'exec');
    });
  }
  CC.sv.aceite = aceite;
})(window.CC = window.CC || {});
