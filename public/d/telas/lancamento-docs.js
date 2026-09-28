// Documentos do lancamento (print 18): tipo, arrastar ou clicar, lista com baixar e excluir.
// PDF, JPG, PNG ou WEBP ate 8 MB; o servidor recusa o mesmo arquivo duas vezes (409).
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const L = D.lanc = D.lanc || {};
  const TIPOS = [['comprovante', 'Comprovante'], ['nota_fiscal', 'Nota fiscal'], ['boleto', 'Boleto'], ['recibo', 'Recibo'], ['contrato', 'Contrato'], ['outro', 'Outro']];
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

  async function baixar(doc) {
    try {
      const resposta = await fetch(`/api/anexos/${doc.id}/arquivo`, { headers: { Authorization: `Bearer ${CC.session.token()}` }, cache: 'no-store' });
      if (!resposta.ok) throw new Error('Não foi possível baixar o documento.');
      const url = URL.createObjectURL(await resposta.blob());
      const a = D.el('<a></a>');
      a.href = url;
      a.download = doc.nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (error) {
      CC.toast(error.message.includes('fetch') ? 'Sem internet. Baixar precisa da conexão.' : error.message, 'warning');
    }
  }

  // Desenha a aba Documentos no painel (ctl) do lancamento l.
  L.docs = async function (ctl, l) {
    const v = D.valorSinal(l);
    ctl.desenhar(`<div class="card resumo-lanc"><b>${esc(l.descricao)}</b><span class="muted">${esc([l.centro_codigo, D.data(l.data)].filter(Boolean).join(' · '))} · <b class="${v.entrada ? 'entrada' : ''}">${esc(v.texto)}</b></span></div>
      ${D.ui.campo({ rotulo: 'Tipo do documento', name: 'categoria_doc', tipo: 'select', valor: 'comprovante', opcoes: TIPOS.map(([valor, rotulo]) => ({ valor, rotulo })) })}
      <label class="soltar" tabindex="0">${D.ic('upload-simple', 22)}<b>Arraste o arquivo ou clique para escolher</b>
        <span class="muted">PDF, JPG, PNG ou WEBP · até 8 MB · duplicados são bloqueados</span>
        <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" hidden></label>
      <div class="lista-docs" data-lista>${D.ui.carregando('Carregando os documentos…')}</div>`);
    const corpo = ctl.corpo;
    const input = CC.$('input[type=file]', corpo);
    const zona = CC.$('.soltar', corpo);

    async function listar() {
      const alvo = CC.$('[data-lista]', corpo);
      let docs;
      try { docs = (await CC.api(`/anexos/lancamento/${l.id}`)).data || []; } catch (error) {
        alvo.innerHTML = D.ui.faixa('warn', 'wifi-slash', error.status === 0 ? 'Sem internet. Os documentos aparecem quando a conexão voltar.' : error.message);
        return;
      }
      l.qtd_anexos = docs.length;
      const aba = CC.$('[data-aba="docs"]', ctl.raiz);
      if (aba) aba.textContent = `Documentos · ${docs.length}`;
      if (!alvo.isConnected) return;
      alvo.innerHTML = `<span class="lbl">Arquivos anexados · ${docs.length}</span>${docs.map((d) => `<div class="card doc" data-doc="${esc(d.id)}">
        <span class="ic">${D.ic(d.tipo === 'application/pdf' ? 'file-pdf' : 'file-image', 20)}</span>
        <span class="tx"><b>${esc(d.nome)}</b><span>${esc([nomeTipo(d.categoria), tamanho(Number(d.tamanho) || 0), d.enviado_por].filter(Boolean).join(' · '))}</span></span>
        <button type="button" class="ibtn" data-baixar aria-label="Baixar ${esc(d.nome)}">${D.ic('download-simple', 18)}</button>
        ${D.pode('cadastrar') ? `<button type="button" class="ibtn" data-apagar aria-label="Excluir ${esc(d.nome)}">${D.ic('trash', 18)}</button>` : ''}</div>`).join('') || '<span class="muted">Nenhum documento ainda.</span>'}`;
      CC.$$('[data-doc]', alvo).forEach((card) => {
        const doc = docs.find((d) => String(d.id) === card.dataset.doc);
        CC.$('[data-baixar]', card).addEventListener('click', () => baixar(doc));
        const apagar = CC.$('[data-apagar]', card);
        if (apagar) apagar.addEventListener('click', async () => {
          const sim = await D.confirmar({ titulo: 'Excluir este documento?', texto: `"${doc.nome}" sai do lançamento. A exclusão fica no histórico.`, ok: 'Excluir', tom: 'perigo' });
          if (!sim) return;
          try { await CC.api(`/anexos/${doc.id}`, { method: 'DELETE' }); CC.toast('Documento excluído'); listar(); if (L.recarregar) L.recarregar(); } catch (error) { ctl.erro(error.message); }
        });
      });
    }

    async function enviar(arquivo) {
      ctl.erro('');
      if (!arquivo) return;
      if (!MIME.includes(arquivo.type)) { ctl.erro('Formato não permitido. Use PDF, JPG, PNG ou WEBP.'); return; }
      if (arquivo.size > MAX) { ctl.erro('O arquivo ultrapassa o limite de 8 MB.'); return; }
      zona.classList.add('enviando');
      try {
        const conteudoBase64 = await lerBase64(arquivo);
        await CC.api(`/anexos/lancamento/${l.id}`, { method: 'POST', body: { nome: arquivo.name, tipo: arquivo.type, categoria: CC.$('[name="categoria_doc"]', corpo).value, conteudoBase64 } });
        CC.toast('Documento anexado');
        await listar();
        if (L.recarregar) L.recarregar();
      } catch (error) {
        ctl.erro(error.status === 0 ? 'Sem internet. Anexar precisa da conexão.' : error.message);
      } finally {
        zona.classList.remove('enviando');
        input.value = '';
      }
    }

    input.addEventListener('change', () => enviar(input.files[0]));
    zona.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    zona.addEventListener('dragover', (e) => { e.preventDefault(); zona.classList.add('sobre'); });
    zona.addEventListener('dragleave', () => zona.classList.remove('sobre'));
    zona.addEventListener('drop', (e) => { e.preventDefault(); zona.classList.remove('sobre'); enviar(e.dataTransfer.files[0]); });
    // Trocar o tipo do documento nao conta como alteracao nao salva.
    CC.$('[name="categoria_doc"]', corpo).addEventListener('change', () => setTimeout(() => { ctl.sujo = false; }));
    listar();
  };
})(window.CC);
