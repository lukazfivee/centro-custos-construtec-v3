// Documentos de um lancamento no celular: lista, ver, anexar (camera, galeria ou PDF) e excluir.
// Mesmas rotas do desktop (public/d/telas/lancamento-docs.js): PDF, JPG, PNG ou WEBP ate 8 MB; duplicado = 409.
(function (CC) {
  const { esc, icon } = CC;
  const TIPOS = [['nota_fiscal', 'Nota fiscal'], ['comprovante', 'Comprovante'], ['boleto', 'Boleto'], ['recibo', 'Recibo'], ['contrato', 'Contrato'], ['outro', 'Outro']];
  const MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
  const MAX = 8 * 1024 * 1024;
  const nomeTipo = (t) => (TIPOS.find((x) => x[0] === t) || TIPOS[5])[1];
  const tamanho = (b) => (b >= 1048576 ? `${(b / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

  const lerBase64 = (arquivo) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || '').split(',').pop() || '');
    r.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    r.readAsDataURL(arquivo);
  });

  async function blobDe(doc) {
    const r = await fetch(`/api/anexos/${doc.id}/arquivo`, { headers: { Authorization: `Bearer ${CC.session.token()}` }, cache: 'no-store' }).catch(() => null);
    if (!r) throw new CC.ApiError(0, 'Sem internet. Ver o documento precisa da conexão.');
    if (!r.ok) throw new CC.ApiError(r.status, 'Não foi possível abrir o documento.');
    return r.blob();
  }

  // Foto abre numa folha; PDF vai para o compartilhar do aparelho ou e baixado.
  async function ver(doc) {
    let blob;
    try { blob = await blobDe(doc); } catch (error) { CC.toast(error.message, 'warning-circle'); return; }
    const url = URL.createObjectURL(blob);
    if (doc.tipo !== 'application/pdf') {
      const sh = CC.sheet('lanc-doc', `${CC.sheetHead('image', doc.nome)}<img class="lanc-foto" src="${url}" alt="${esc(doc.nome)}">`);
      new MutationObserver((_, obs) => { if (!document.body.contains(sh.el)) { URL.revokeObjectURL(url); obs.disconnect(); } }).observe(document.body, { childList: true });
      return;
    }
    const file = new File([blob], doc.nome, { type: doc.tipo });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: doc.nome }); } catch { /* cancelado */ }
    } else {
      const a = document.createElement('a');
      a.href = url; a.download = doc.nome; document.body.appendChild(a); a.click(); a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // slot: elemento da tela; l: lancamento; recarregar: redesenha a tela (contador de anexos).
  CC.lancDocs = async function (slot, l, recarregar) {
    const podeAnexar = CC.sv ? (CC.sv.can('p2') || CC.sv.can('p3')) : true;
    const podeApagar = CC.sv ? CC.sv.can('p3') && !CC.lanc.fechado(l.data) : false;
    slot.innerHTML = `<span class="label">Documentos</span><div class="lanc-docs"><div class="skeleton" style="height:56px"></div></div>
      ${podeAnexar ? `<div class="card lanc-add"><label class="field"><span>Tipo do documento</span><select id="ld-tipo">${TIPOS.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select></label>
        <span class="grid2"><label class="btn2">${icon('camera', 18)}Câmera<input class="sr" type="file" id="ld-cam" accept="image/*" capture="environment"></label>
        <label class="btn2">${icon('paperclip', 18)}Arquivo<input class="sr" type="file" id="ld-arq" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"></label></span>
        <small class="muted">PDF, JPG, PNG ou WEBP até 8 MB. A foto da câmera é reduzida antes de enviar.</small><p class="alert" role="alert" id="ld-err"></p></div>` : ''}`;
    const lista = CC.$('.lanc-docs', slot);
    const erro = (msg) => { const e = CC.$('#ld-err', slot); if (e) e.innerHTML = msg ? `${icon('warning-circle', 16)}<span>${esc(msg)}</span>` : ''; };

    let docs;
    try { docs = (await CC.api(`/anexos/lancamento/${l.id}`)).data || []; } catch (error) {
      lista.innerHTML = `<p class="sub">${esc(error.status === 0 ? 'Sem internet. Os documentos aparecem quando a conexão voltar.' : error.message)}</p>`;
      docs = null;
    }
    if (docs) {
      lista.innerHTML = docs.length ? docs.map((d) => `<div class="tx lanc-doc" data-doc="${esc(d.id)}">${icon(d.tipo === 'application/pdf' ? 'file-pdf' : 'image', 22)}
          <span class="grow"><b>${esc(d.nome)}</b><small>${esc([nomeTipo(d.categoria), tamanho(Number(d.tamanho) || 0), d.enviado_por].filter(Boolean).join(' · '))}</small></span>
          <button class="back" type="button" data-ver aria-label="Ver ${esc(d.nome)}">${icon('download-simple', 20)}</button>
          ${podeApagar ? `<button class="back" type="button" data-apagar aria-label="Excluir ${esc(d.nome)}">${icon('trash', 20)}</button>` : ''}</div>`).join('')
        : `<p class="sub lanc-vazio">Nenhum documento anexado.</p>`;
      CC.$$('[data-doc]', lista).forEach((row) => {
        const doc = docs.find((d) => String(d.id) === row.dataset.doc);
        CC.$('[data-ver]', row).addEventListener('click', () => ver(doc));
        const apagar = CC.$('[data-apagar]', row);
        if (apagar) apagar.addEventListener('click', async () => {
          if (apagar.dataset.armed !== '1') { apagar.dataset.armed = '1'; CC.toast('Toque de novo na lixeira para excluir', 'warning-circle'); return; }
          try { await CC.api(`/anexos/${doc.id}`, { method: 'DELETE' }); } catch (error) { CC.toast(error.message, 'warning-circle'); return; }
          CC.toast('Documento excluído');
          recarregar();
        });
      });
    }

    async function enviar(arquivo, foto) {
      erro('');
      if (!arquivo) return;
      if (!foto && !MIME.includes(arquivo.type)) return erro('Formato não permitido. Use PDF, JPG, PNG ou WEBP.');
      if (!foto && arquivo.size > MAX) return erro('O arquivo passa do limite de 8 MB.');
      const tipo = CC.$('#ld-tipo', slot).value;
      CC.toast('Enviando o documento…', 'cloud-arrow-up');
      try {
        const body = foto
          ? { nome: `${tipo}-${l.data}.jpg`, tipo: 'image/jpeg', categoria: tipo, conteudoBase64: String(await CC.shrink(arquivo)).split(',').pop() }
          : { nome: arquivo.name, tipo: arquivo.type, categoria: tipo, conteudoBase64: await lerBase64(arquivo) };
        await CC.api(`/anexos/lancamento/${l.id}`, { method: 'POST', body });
      } catch (error) {
        return erro(error.status === 0 ? 'Sem internet. Anexar precisa da conexão.' : (error.status === 409 ? 'Este arquivo já está anexado.' : error.message));
      }
      CC.toast('Documento anexado');
      recarregar();
    }
    const cam = CC.$('#ld-cam', slot), arq = CC.$('#ld-arq', slot);
    if (cam) cam.addEventListener('change', () => enviar(cam.files[0], true));
    if (arq) arq.addEventListener('change', () => enviar(arq.files[0], /^image\//.test((arq.files[0] || {}).type || '') && arq.files[0].size > MAX));
  };
})(window.CC = window.CC || {});
