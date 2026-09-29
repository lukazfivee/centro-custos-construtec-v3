// Aba E-mail ao cliente (print 42): rascunho, autorizacao e envio. Um envio pendente
// reutiliza a autorizacao e a NF, sem salvar o rascunho novamente.
// Anexo: uma NF em PDF (ate 5 MB). Sem escolha, o servidor usa o PDF da NF vinculada a obra; sem NF, barra o envio.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const B = D.cobr = D.cobr || {};
  const U = D.ui;
  const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
  const lista = (t) => [...new Set(String(t || '').split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const dataHora = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`; };
  const lerBase64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || '').split(',').pop() || '');
    r.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    r.readAsDataURL(blob);
  });

  // O rascunho padrao do Worker escreve o vencimento como AAAA-MM-DD; na mensagem vai dd/mm/aaaa.
  function suavizar(d) {
    const padrao = d.status === 'draft' && !d.authorizedAt && !d.sentAt && /^Prezados,\s+Entramos em contato para acompanhamento financeiro/.test(d.bodyText || '');
    return padrao ? { ...d, bodyText: d.bodyText.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1') } : d;
  }

  // NFs em PDF lancadas para o cliente na obra (aba Notas fiscais da obra). Casa a obra pelo codigo.
  async function nfsDaObra(item) {
    try {
      const obras = (await CC.api('/centros-custo')).data || [];
      const obra = obras.find((o) => String(o.codigo).toLowerCase() === String(item.code).toLowerCase());
      if (!obra) return [];
      const nfs = (await CC.api(`/centros-custo/${obra.id}/notas-fiscais?tipo=cliente`)).data || [];
      return nfs.filter((n) => n.temArquivo);
    } catch { return []; }
  }

  async function anexoEscolhido(corpo, nfs) {
    const escolha = CC.$('[name="anexo"]', corpo).value;
    let blob; let nome;
    if (escolha === 'arquivo') {
      const f = CC.$('[name="arquivo"]', corpo).files[0];
      if (!f) throw new Error('Escolha o PDF da nota fiscal ou mude a opção de anexo.');
      blob = f; nome = f.name;
    } else if (escolha.startsWith('nf:')) {
      const nf = nfs.find((n) => String(n.id) === escolha.slice(3));
      const r = await fetch(`/api/centros-custo/notas-fiscais/${nf.id}/arquivo`, { headers: { Authorization: `Bearer ${CC.session.token()}` }, cache: 'no-store' });
      if (!r.ok) throw new Error('Não foi possível ler o PDF da nota fiscal.');
      blob = await r.blob(); nome = nf.nomeArquivo || `nota-fiscal-${nf.id}.pdf`;
    } else return [];
    if (blob.size > 5 * 1024 * 1024) throw new Error('A nota fiscal em PDF deve ter no máximo 5 MB.');
    return [{ filename: nome, contentType: 'application/pdf', contentBase64: await lerBase64(blob) }];
  }

  B.emailTab = async function (ctl, item, pode, ir) {
    ctl.desenhar(U.carregando('Abrindo o rascunho…'));
    ctl.botoes('');
    let r;
    try { r = (await CC.api(`/cloud-sync/cobrancas/${encodeURIComponent(item.publicId)}/rascunho`)).data; } catch (error) {
      ctl.desenhar(U.faixa('warn', error.status === 0 ? 'wifi-slash' : 'warning', error.status === 0 ? 'Sem internet. O rascunho abre quando a conexão voltar.' : error.message));
      ctl.botoes('<button type="button" class="btn btn-s" data-fechar>Fechar</button>');
      return;
    }
    const nfs = pode ? await nfsDaObra(item) : [];
    const d = suavizar(r.draft || {});
    const fixos = ((r.copyPolicy && r.copyPolicy.emails) || []).map((e) => e.toLowerCase());
    const extras = (d.cc || []).filter((e) => !fixos.includes(String(e).toLowerCase()));
    const enviado = d.status === 'sent';
    const pendente = d.status === 'sending';
    const banner = enviado ? U.faixa('ok', 'check-circle', `Enviado em ${dataHora(d.sentAt)}${pode ? ' · reenviar manda uma nova cópia' : ''}`)
      : (pendente ? U.faixa('warn', 'clock', 'Envio sem confirmação. Após um minuto, escolha a mesma NF e tente confirmar novamente; confira o histórico antes de reenviar.')
        : (d.status === 'failed' ? U.faixa('err', 'warning-circle', `O último envio falhou: ${d.lastError || 'erro desconhecido'}`)
        : (d.status === 'authorized' ? U.faixa('info', 'seal-check', `Autorizado por ${d.authorizedByEmail || 'gestor'} em ${dataHora(d.authorizedAt)}`) : '')));
    const somenteLer = pode ? '' : ' disabled';
    const opcoesAnexo = [...nfs.map((n) => `<option value="nf:${esc(n.id)}">${esc(`${n.nomeArquivo || 'nota.pdf'} · ${n.observacao || 'NF'} · ${CC.money(n.valor)}`)}</option>`), '<option value="vinculada">Usar a NF vinculada à obra (cadastro antigo)</option>', '<option value="arquivo">Outro PDF do computador…</option>'].join('');
    ctl.desenhar(`${banner}<form class="form-lanc" novalidate>
      ${U.campo({ rotulo: 'Para', name: 'to', valor: (d.to || []).join(', '), placeholder: 'cliente@empresa.com.br' }).replace('<input ', `<input${somenteLer} `)}
      <div class="fld"><span>Cópia</span><input class="inp" name="cc" value="${esc(extras.join(', '))}" placeholder="Opcional"${somenteLer}>
        ${fixos.length ? `<small class="muted">Sempre em cópia: ${esc(fixos.join(', '))}</small>` : ''}<span class="erro" role="alert"></span></div>
      ${U.campo({ rotulo: 'Assunto', name: 'subject', valor: d.subject }).replace('<input ', `<input${somenteLer} `)}
      ${U.campo({ rotulo: 'Mensagem', name: 'bodyText', tipo: 'textarea', valor: d.bodyText }).replace('<textarea ', `<textarea${somenteLer} rows="9" `)}
      ${pode ? `<div class="fld"><span>Anexo · nota fiscal em PDF</span><select class="inp" name="anexo">${opcoesAnexo}</select>
        <input class="inp" type="file" name="arquivo" accept="application/pdf,.pdf" hidden>
        <small class="muted" data-aviso-anexo>${nfs.length ? 'Uma NF em PDF por envio, até 5 MB.' : 'Nenhuma NF em PDF lançada para o cliente nesta obra. Lance na obra (aba Notas fiscais) ou escolha um PDF.'}</small></div>
        <label class="check autorizo"><input type="checkbox" name="autorizo"> Autorizo o envio deste e-mail ao cliente</label>` : ''}</form>`);
    const corpo = ctl.corpo;
    if (!pode) { ctl.botoes('<button type="button" class="btn btn-s" data-fechar>Fechar</button>'); return; }
    const sel = CC.$('[name="anexo"]', corpo);
    const arquivo = CC.$('[name="arquivo"]', corpo);
    const trocar = () => { arquivo.hidden = sel.value !== 'arquivo'; };
    sel.addEventListener('change', trocar);
    trocar();
    const marca = CC.$('[name="autorizo"]', corpo);
    ctl.botoes(`<button type="button" class="btn btn-s" data-fechar>Fechar</button><button type="button" class="btn btn-s" data-rascunho${pendente ? ' disabled' : ''}>Salvar rascunho</button>
      <button type="button" class="btn btn-p" data-enviar disabled>${D.ic('paper-plane-tilt')}${pendente ? 'Confirmar envio pendente' : (enviado ? 'Reenviar e-mail' : 'Enviar e-mail')}</button>`);
    const bEnviar = CC.$('[data-enviar]', ctl.rodape);
    const bRascunho = CC.$('[data-rascunho]', ctl.rodape);
    marca.addEventListener('change', () => { bEnviar.disabled = !marca.checked; });

    const ler = () => ({ to: lista(CC.$('[name="to"]', corpo).value), cc: lista(CC.$('[name="cc"]', corpo).value), subject: CC.$('[name="subject"]', corpo).value.trim(), bodyText: CC.$('[name="bodyText"]', corpo).value.trim() });
    const validar = (v) => {
      const erros = {};
      if (!v.to.length) erros.to = 'Informe pelo menos um e-mail de destinatário.';
      else if (v.to.some((e) => !EMAIL.test(e))) erros.to = `E-mail inválido: ${v.to.find((e) => !EMAIL.test(e))}`;
      if (v.cc.some((e) => !EMAIL.test(e))) erros.cc = `E-mail inválido: ${v.cc.find((e) => !EMAIL.test(e))}`;
      if (!v.subject) erros.subject = 'Informe o assunto.';
      if (v.bodyText.length < 5) erros.bodyText = 'Escreva a mensagem.';
      return erros;
    };
    const base = `/cloud-sync/cobrancas/${encodeURIComponent(item.publicId)}`;
    let ocupado = false;
    const salvar = async (v) => CC.api(`${base}/rascunho`, { method: 'PUT', body: v });

    bRascunho.addEventListener('click', async () => {
      if (ocupado) return;
      const v = ler();
      const erros = validar(v);
      ctl.errosCampos(erros);
      if (Object.keys(erros).length) { ctl.erro(Object.values(erros)[0]); return; }
      ctl.erro(''); ocupado = true; bRascunho.disabled = true;
      try { await salvar(v); ctl.marcarSalvo(); CC.toast('Rascunho salvo · confirme a autorização para enviar'); ir('email'); } catch (error) {
        ctl.erro(error.status === 0 ? 'Sem internet. Salvar precisa da conexão.' : error.message);
      } finally { ocupado = false; bRascunho.disabled = pendente; }
    });

    bEnviar.addEventListener('click', async () => {
      if (ocupado || !marca.checked) return;
      const v = ler();
      const erros = validar(v);
      ctl.errosCampos(erros);
      if (Object.keys(erros).length) { ctl.erro(Object.values(erros)[0]); return; }
      ctl.erro(''); ocupado = true; bEnviar.disabled = true; bRascunho.disabled = true;
      try {
        const anexos = await anexoEscolhido(corpo, nfs);
        if (!pendente) {
          await salvar(v); // 1. salva o que esta na tela (problema 7)
          await CC.api(`${base}/autorizar`, { method: 'POST', body: { confirmar: true } }); // 2. salvar zera a autorizacao
        }
        const envio = await CC.api(`${base}/enviar`, { method: 'POST', body: { attachments: anexos } }); // 3. envia; o Worker atualiza a situacao sem sobrescrever outros dados
        B.mudou = true; ctl.marcarSalvo();
        CC.toast('E-mail enviado ao cliente');
        if (envio.data.postSendWarning) {
          ctl.erro('E-mail enviado, mas o histórico ou a situação da cobrança não pôde ser atualizado. Confira o acompanhamento; não reenvie.');
          return;
        }
        ir('email');
      } catch (error) {
        try {
          const atual = (await CC.api(`${base}/rascunho`)).data;
          if (atual.draft?.status === 'sending') { ir('email'); return; }
        } catch { /* Pode continuar sem conexão; a consulta será refeita ao abrir a aba. */ }
        ctl.erro(error.status === 0 ? 'Sem internet. Não foi possível confirmar o envio; confira o rascunho antes de tentar novamente.' : error.message);
        ocupado = false; bEnviar.disabled = !marca.checked; bRascunho.disabled = pendente;
      }
    });
  };
})(window.CC);
