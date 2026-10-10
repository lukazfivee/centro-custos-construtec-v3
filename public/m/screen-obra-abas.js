// Abas Orcado e Notas do detalhe da obra no celular. Mesmas rotas do desktop
// (public/d/telas/obra-orcado.js e obra-nf.js); o servidor confere as permissoes (NF = p6).
(function (CC) {
  const { esc, icon, money, moneyShort } = CC;

  // Baixa um arquivo da API com o token. PDF vai para o compartilhar do aparelho ou e baixado.
  CC.abrirArquivo = async function (path, nome) {
    const r = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${CC.session.token()}` }, cache: 'no-store' }).catch(() => null);
    if (!r) return CC.toast('Sem internet. Abrir o arquivo precisa da conexão.', 'wifi-slash');
    if (!r.ok) return CC.toast((await r.json().catch(() => ({}))).erro || 'Não foi possível abrir o arquivo.', 'warning-circle');
    const blob = await r.blob();
    const file = new File([blob], nome, { type: blob.type || 'application/octet-stream' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: nome }); } catch { /* cancelado */ }
      return undefined;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return undefined;
  };

  const faixa = (p) => (p > 1 ? ' warn' : '');
  const barra = (p) => `<span class="bar${faixa(p)}"><span style="width:${Math.min(100, p * 100).toFixed(1)}%"></span></span>`;

  function itemRow(i) {
    const p = i.budgetedCost > 0 ? i.realizedCost / i.budgetedCost : 0;
    const v = Number(i.variance) || 0;
    return `<div class="orc-item"><span class="line"><b>${esc(i.name || i.description || 'Item')}</b><span class="tag${v > 0 ? ' warn' : ''}">${Math.round(p * 100)}%</span></span>
      <small class="muted">${esc([i.code, i.kind === 'labor' ? 'Mão de obra' : 'Material', `${Number(i.budgetedQuantity || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${i.unit || ''}`.trim()].filter(Boolean).join(' · '))}</small>
      ${barra(p)}<span class="orc-nums"><span>Orçado <b>${esc(money(i.budgetedCost))}</b></span><span>Realizado <b>${esc(money(i.realizedCost))}</b></span>
      ${v ? `<span>Desvio <b class="${v > 0 ? 'down' : 'up'}">${v > 0 ? '+' : '−'}${esc(money(Math.abs(v)))}</b></span>` : ''}</span></div>`;
  }

  // slot: elemento da aba; c: centro (detalhes da obra).
  CC.obraOrcado = async function (slot, c, filtro) {
    slot.innerHTML = '<div class="skeleton"></div>';
    let cmp, prop;
    try {
      [cmp, prop] = await Promise.all([CC.cached(`orcado-${c.id}`, `/centros-custo/${c.id}/orcado-realizado`).then((r) => r.data),
        CC.api(`/centros-custo/${c.id}/proposta`).then((r) => r.data.proposta).catch(() => null)]);
    } catch (error) {
      slot.innerHTML = `<div class="empty">${icon(error.status === 0 ? 'wifi-slash' : 'warning-circle', 24)}${esc(error.status === 0 ? 'Sem internet e sem dados salvos do orçado.' : error.message)}</div>`;
      return;
    }
    const pdf = prop ? `<button class="btn2 orc-pdf" type="button" id="orc-pdf">${icon('file-pdf', 18)}Proposta aprovada (PDF)</button>` : '';
    if (!cmp.hasBudget) {
      slot.innerHTML = `<div class="empty">${icon('file-text', 28)}Esta obra ainda não tem orçamento importado.<small>Importe a proposta aprovada pelo computador (Obras › Importar orçamento) para ver a planilha e o consumo.</small></div>${pdf}`;
    } else {
      const s = cmp.summary || {}, ct = cmp.contract || {};
      const p = s.baseCost > 0 ? s.realizedCost / s.baseCost : 0;
      const estado = p > 1 ? 'Estourado' : (p > 0.8 ? 'Atenção' : 'Dentro do orçado');
      const h = cmp.laborHours || {};
      const soma = (k) => (cmp.items || []).filter((i) => i.kind === k).reduce((t, i) => t + (Number(i.realizedCost) || 0), 0);
      const porTipo = (rot, real, orc) => `<div class="kv"><span>${esc(rot)}</span><b>${esc(moneyShort(real))} <span class="muted">/ ${esc(moneyShort(orc || 0))}</span></b></div>${barra(orc > 0 ? real / orc : 0)}`;
      const sem = cmp.unmapped || { count: 0, totalCost: 0 };
      const itens = (cmp.items || []).filter((i) => !filtro || i.kind === filtro).sort((a, b) => (Number(b.variance) || 0) - (Number(a.variance) || 0));
      slot.innerHTML = `<div class="card"><span class="label">Saldo disponível</span><div class="big${s.balance < 0 ? ' warn-txt' : ''}">${esc(money(s.balance))}</div>
          <div class="kv"><span>Consumo do orçamento</span><b>${Math.round(p * 100)}% · ${estado}</b></div>${barra(p)}
          <div class="kv"><span>Realizado</span><b>${esc(money(s.realizedCost))}</b></div><div class="kv"><span>Custo orçado</span><b>${esc(money(s.baseCost))}</b></div>
          <div class="kv"><span>Contrato</span><b>${esc(money(s.contractValue))}</b></div>
          ${h.planned ? `<div class="kv"><span>Horas da equipe</span><b>${Math.round(h.consumed || 0)} / ${Math.round(h.planned)} h</b></div>` : ''}
          ${ct.number ? `<div class="kv"><span>Contrato nº</span><b>${esc([ct.number, ct.baselineVersion != null ? `REV ${String(ct.baselineVersion).padStart(2, '0')}` : ''].filter(Boolean).join(' '))}</b></div>` : ''}</div>
        <div class="card"><span class="label">Por tipo</span>${porTipo('Material', soma('material'), ct.materialsCost)}${porTipo('Mão de obra', soma('labor'), ct.laborCost)}</div>
        ${sem.count ? `<div class="note off">${icon('warning-circle', 18)}<span><b>${sem.count} gasto${sem.count === 1 ? '' : 's'} sem vínculo · ${esc(money(sem.totalCost))}</b> Lançamentos que ainda não estão ligados a um insumo. Vincule pelo computador para o consumo ficar certo.</span></div>` : ''}
        ${pdf}
        <div class="seg" role="group" aria-label="Tipo de item">${[['', 'Todos'], ['material', 'Materiais'], ['labor', 'Mão de obra']].map(([k, l]) => `<button type="button" data-kind="${k}" aria-pressed="${k === (filtro || '')}">${l}</button>`).join('')}</div>
        <span class="label">Itens orçados · maior desvio primeiro</span>
        <div class="orc-itens">${itens.map(itemRow).join('') || `<div class="empty">${icon('list-bullets', 24)}Nenhum item neste filtro.</div>`}</div>
        <button class="btn2" type="button" id="orc-csv">${icon('download-simple', 18)}Planilha em CSV</button>`;
      CC.$$('[data-kind]', slot).forEach((b) => b.addEventListener('click', () => CC.obraOrcado(slot, c, b.dataset.kind)));
      CC.$('#orc-csv', slot).addEventListener('click', () => CC.abrirArquivo(`/centros-custo/${c.id}/orcado-realizado/csv`, `orcado-vs-realizado-${c.codigo || c.id}.csv`));
    }
    const b = CC.$('#orc-pdf', slot);
    if (b) b.addEventListener('click', () => CC.abrirArquivo(`/centros-custo/${c.id}/proposta/arquivo`, (prop && prop.nome) || 'proposta.pdf'));
  };

  const BLOCOS = [['fornecedor', 'Fornecedor', 'Notas recebidas de fornecedores'], ['cliente', 'Cliente final', 'Notas emitidas para o cliente']];
  const statusTexto = (tipo, st) => (st === 'paga' ? (tipo === 'cliente' ? 'Recebida' : 'Paga') : (tipo === 'cliente' ? 'A receber' : 'A pagar'));
  const lerBase64 = (arquivo) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || '').split(',').pop() || '');
    r.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    r.readAsDataURL(arquivo);
  });

  CC.obraNf = async function (slot, c) {
    slot.innerHTML = '<div class="skeleton"></div>';
    if (CC.sv) await CC.sv.loadPerms();
    const gerir = CC.sv ? CC.sv.can('p6') : false;
    let todas;
    try { todas = (await CC.cached(`nf-${c.id}`, `/centros-custo/${c.id}/notas-fiscais`)).data || []; } catch (error) {
      slot.innerHTML = `<div class="empty">${icon(error.status === 0 ? 'wifi-slash' : 'warning-circle', 24)}${esc(error.status === 0 ? 'Sem internet e sem notas salvas.' : error.message)}</div>`;
      return;
    }
    const recarregar = () => CC.obraNf(slot, c);
    slot.innerHTML = BLOCOS.map(([tipo, titulo, sub]) => {
      const nfs = todas.filter((n) => n.tipo === tipo);
      const total = nfs.reduce((t, n) => t + Number(n.valor || 0), 0);
      return `<div class="nf-bloco"><span class="line"><span class="grow"><span class="label">${esc(titulo)}</span><small class="muted">${esc(sub)}${nfs.length ? ` · ${esc(money(total))}` : ''}</small></span>
        ${gerir ? `<button class="chip-act" type="button" data-nova-nf="${tipo}">${icon('plus', 14)}Lançar NF</button>` : ''}</span>
        ${nfs.map((n) => `<div class="tx nf-row"><span class="grow"><b>${esc(n.observacao || n.nomeArquivo || 'Nota fiscal')}</b><small>${esc([CC.dateFull(n.dataEmissao), money(n.valor)].filter(Boolean).join(' · '))}</small></span>
          ${gerir ? `<button class="tag${n.status === 'paga' ? ' ok' : ' warn'} nf-st" type="button" data-alternar="${n.id}" aria-label="Alternar situação">${statusTexto(tipo, n.status)}</button>` : `<span class="tag${n.status === 'paga' ? ' ok' : ' warn'}">${statusTexto(tipo, n.status)}</span>`}
          ${n.temArquivo ? `<button class="back" type="button" data-pdf="${n.id}" aria-label="Abrir o PDF">${icon('file-pdf', 20)}</button>` : ''}
          ${gerir ? `<button class="back" type="button" data-apagar="${n.id}" aria-label="Excluir nota">${icon('trash', 20)}</button>` : ''}</div>`).join('') || '<p class="sub nf-vazio">Nenhuma nota lançada.</p>'}</div>`;
    }).join('');
    const nota = (id) => todas.find((n) => String(n.id) === String(id));
    CC.$$('[data-nova-nf]', slot).forEach((b) => b.addEventListener('click', () => lancarNf(c, b.dataset.novaNf, recarregar)));
    CC.$$('[data-pdf]', slot).forEach((b) => b.addEventListener('click', () => { const n = nota(b.dataset.pdf); CC.abrirArquivo(`/centros-custo/notas-fiscais/${n.id}/arquivo`, n.nomeArquivo || `nota-fiscal-${n.id}.pdf`); }));
    CC.$$('[data-alternar]', slot).forEach((b) => b.addEventListener('click', async () => {
      const n = nota(b.dataset.alternar);
      try { await CC.api(`/centros-custo/notas-fiscais/${n.id}`, { method: 'PUT', body: { status: n.status === 'paga' ? 'nao_paga' : 'paga', dataEmissao: n.dataEmissao, valor: Number(n.valor), observacao: n.observacao || '' } }); } catch (error) { return CC.toast(error.message, 'warning-circle'); }
      return recarregar();
    }));
    CC.$$('[data-apagar]', slot).forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; CC.toast('Toque de novo na lixeira para excluir a nota', 'warning-circle'); return; }
      try { await CC.api(`/centros-custo/notas-fiscais/${nota(b.dataset.apagar).id}`, { method: 'DELETE' }); } catch (error) { CC.toast(error.message, 'warning-circle'); return; }
      CC.toast('Nota fiscal excluída');
      recarregar();
    }));
  };

  function lancarNf(c, tipo, aoSalvar) {
    const cli = tipo === 'cliente';
    const sh = CC.sheet('nf-nova', `${CC.sheetHead('receipt', `Lançar NF · ${cli ? 'Cliente final' : 'Fornecedor'}`)}
      <label class="field"><span>Número / observação</span><input id="nf-obs" maxlength="1000" placeholder="Ex.: NF 18.442"></label>
      <div class="grid2" style="margin-top:12px"><label class="field"><span>Emissão</span><input id="nf-data" type="date" value="${esc(CC.today())}"></label>
        <label class="field"><span>Valor</span><input id="nf-valor" inputmode="decimal" placeholder="0,00"></label></div>
      <label class="menu-item pref"><span>${cli ? 'Já recebida' : 'Já paga'}</span><input type="checkbox" id="nf-paga"></label>
      <label class="btn2" style="margin-top:4px">${icon('file-pdf', 18)}<span id="nf-arq-nome">PDF da nota (opcional, até 5 MB)</span><input class="sr" type="file" id="nf-arq" accept="application/pdf,.pdf"></label>
      <div id="nf-err"></div>
      <div class="grid2 od-acts"><button class="btn2" type="button" id="nf-cancel">Cancelar</button><button class="btn" type="button" id="nf-ok">${icon('check', 18)}Lançar NF</button></div>`);
    const $ = (id) => CC.$(`#${id}`, sh.el);
    const falha = (e) => { $('nf-err').innerHTML = CC.sheetErr(e); };
    $('nf-arq').addEventListener('change', () => { const f = $('nf-arq').files[0]; $('nf-arq-nome').textContent = f ? f.name : 'PDF da nota (opcional, até 5 MB)'; });
    $('nf-cancel').addEventListener('click', sh.close);
    $('nf-ok').addEventListener('click', async (e) => {
      const valor = CC.parseMoney($('nf-valor').value), data = $('nf-data').value, arquivo = $('nf-arq').files[0];
      if (!(valor > 0)) return falha({ message: 'Informe um valor maior que zero.' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return falha({ message: 'Informe a emissão.' });
      if (arquivo && arquivo.size > 5 * 1024 * 1024) return falha({ message: 'O PDF passa do limite de 5 MB.' });
      const b = e.currentTarget;
      CC.busy(b, 'Lançando…');
      try {
        const body = { tipo, status: $('nf-paga').checked ? 'paga' : 'nao_paga', dataEmissao: data, valor, observacao: $('nf-obs').value.trim() };
        if (arquivo) Object.assign(body, { nome: arquivo.name, conteudoBase64: await lerBase64(arquivo) });
        await CC.api(`/centros-custo/${c.id}/notas-fiscais`, { method: 'POST', body });
      } catch (error) { b.disabled = false; b.innerHTML = `${icon('check', 18)}Lançar NF`; return falha(error); }
      sh.close();
      CC.toast('Nota fiscal lançada');
      return aoSalvar();
    });
  }
})(window.CC = window.CC || {});
