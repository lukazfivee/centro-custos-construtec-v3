// Execucao do servico sem internet: checklist, fotos e aceite entram na fila do celular (queue.js, item com `op`)
// e sobem na ordem quando a conexao volta. Aqui ficam o envio de cada operacao, o que mostrar enquanto esta pendente
// e as linhas da lista de pendencias. Contrato: docs/suite-desktop/SERVICOS-API.md.
(function (CC) {
  const { esc, icon } = CC;
  const doServico = (id) => (i) => Number(i.servicoId) === Number(id);

  // Chamada direta quando ha internet e nada pendente neste servico (mantem a ordem das alteracoes);
  // sem internet, ou com pendencia na frente, o item vai para a fila. Devolve 'enviado' ou 'fila'.
  CC.sv.enviar = async function (s, item, direto) {
    const pendente = (await CC.queue.ops()).some(doServico(s.id));
    if (!CC.offline() && !pendente) {
      try { await direto(); return 'enviado'; } catch (error) { if (error.status !== 0) throw error; }
    }
    await CC.queue.add({ ...item, servicoId: s.id, obra_nome: s.nome });
    return 'fila';
  };

  // Envio de um item da fila. O mesmo envio repetido e inofensivo: o checklist grava o valor final, o servidor ignora
  // item repetido e foto repetida (409), e o aceite substitui o anterior.
  CC.sv.sendOp = async function (item) {
    const base = `/servicos/${item.servicoId}`, b = item.body || {};
    try {
      if (item.op === 'checklist-add') await CC.api(`${base}/checklist`, { method: 'POST', body: b });
      else if (item.op === 'checklist') await CC.api(`${base}/checklist/${encodeURIComponent(b.item)}`, { method: 'PATCH', body: { feito: b.feito } });
      else if (item.op === 'foto') await CC.api(`${base}/fotos`, { method: 'POST', body: b });
      else if (item.op === 'aceite') await CC.api(`${base}/aceite`, { method: 'PUT', body: b });
    } catch (error) {
      const jaFeito = (item.op === 'checklist' && error.status === 404) // item removido por outra pessoa
        || (item.op === 'foto' && error.status === 409 && /mesma foto/i.test(error.message || ''));
      if (!jaFeito) throw error;
    }
    // Se a pessoa mexeu no mesmo item enquanto subia, o que ficou na fila e mais novo e continua la.
    const atual = await CC.store.get('fila', item.client_id);
    if (atual && atual.criado_em === item.criado_em) await CC.store.del('fila', item.client_id);
  };

  const dataUrl = (b64, mime) => (String(b64 || '').startsWith('data:') ? b64 : `data:${mime};base64,${b64}`);

  // Poe por cima do servico guardado o que ainda nao subiu, para a tela mostrar o que a pessoa acabou de fazer.
  CC.sv.overlay = async function (s) {
    const fila = (await CC.queue.ops()).filter(doServico(s.id)).sort((a, b) => a.criado_em - b.criado_em);
    s.filaOps = fila;
    if (!fila.length) return s;
    s.checklist = (s.checklist || []).map((c) => ({ ...c }));
    s.fotos = (s.fotos || []).slice();
    for (const i of fila) {
      const b = i.body || {};
      if (i.op === 'checklist-add') {
        if (!s.checklist.some((c) => c.id === b.id)) s.checklist.push({ id: b.id, texto: b.texto, feito: false, pendente: true });
      } else if (i.op === 'checklist') {
        const c = s.checklist.find((x) => x.id === b.item);
        if (c) { c.feito = b.feito; c.pendente = true; }
      } else if (i.op === 'foto') {
        s.fotos.push({ id: i.client_id, fase: b.fase, nome: b.nome, local: dataUrl(b.conteudoBase64, b.tipo || 'image/jpeg'), pendente: true });
      } else if (i.op === 'aceite') {
        s.aceite = { nome: b.nome, cargo: b.cargo, dataHora: b.dataHora, local: dataUrl(b.assinatura && b.assinatura.conteudoBase64, 'image/png'), pendente: true };
      }
    }
    return s;
  };

  function linha(i, aviso) {
    const erro = i.estado === 'erro';
    return `<div class="tx"><span class="grow"><b>${esc(i.rotulo || 'Alteração do serviço')}</b>${aviso ? '' : `<small>${esc(i.obra_nome || '')}</small>`}
      <small class="${erro ? 'state' : ''}">${erro ? esc('Não aceito: ' + i.erro) : (CC.queue.state.syncing ? 'Enviando…' : 'Na fila, sem internet')}</small>
      ${erro ? `<span class="grid2" style="margin-top:6px"><button class="btn2" type="button" data-retry="${esc(i.client_id)}">Tentar de novo</button>
        <button class="btn2" type="button" data-discard="${esc(i.client_id)}">Descartar</button></span>` : ''}</span></div>`;
  }

  // Cartao no topo da aba Execucao: o que esta esperando internet neste servico.
  CC.sv.avisoFila = function (s) {
    const fila = s.filaOps || [];
    if (!fila.length) return '';
    const erros = fila.filter((i) => i.estado === 'erro');
    const sobe = fila.length - erros.length;
    return `<div class="card sv-fila"><div class="sv-head"><span class="label">No celular</span>
      <small class="muted">${sobe ? `${icon('cloud-arrow-up', 12)} ${sobe} ${sobe === 1 ? 'alteração sobe' : 'alterações sobem'} quando a internet voltar` : ''}</small></div>
      ${erros.map((i) => linha(i, true)).join('')}</div>`;
  };

  // Linhas da lista de pendencias (aba Lancamentos): mesma fila, mesmos botoes de tentar de novo e descartar.
  CC.sv.opRows = async function () {
    const fila = (await CC.queue.ops()).sort((a, b) => a.criado_em - b.criado_em);
    return fila.map((i) => linha(i, false)).join('');
  };
})(window.CC = window.CC || {});
