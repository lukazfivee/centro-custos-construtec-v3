// Tres pontos do detalhe da obra: copiar codigo, proposta de origem, excluir (obra sem vinculo)
// e descartar (obra de orcamento aprovado, so admin). Prototipo: Rodada 26 (omLinked, omFree, odExc*, odDesc*, odBlk).
// Ao descartar, a proposta de origem volta a "Aprovada sem Centro de Custo" no Orcamentos (ele le o 410 do resumo).
(function (CC) {
  const { esc, icon } = CC;
  const role = () => ((CC.session.user() || {}).role || '');
  const NET = ['Sem internet', 'Nada foi alterado. Conecte o celular e tente de novo.'];
  const BLOCKS = [['lancamentos', 'receipt', 'lançamento', 'lançamentos', true], ['rateios', 'list-bullets', 'rateio', 'rateios'],
    ['recorrentes', 'calendar-blank', 'recorrente', 'recorrentes'], ['medicoes', 'trend-up', 'medição', 'medições'], ['notas', 'file-text', 'nota fiscal', 'notas fiscais']];

  // Folha que sobe de baixo. Devolve o elemento e a funcao de fechar.
  CC.sheet = function (id, html) {
    CC.closeSheet(id);
    const el = document.createElement('div');
    el.id = id;
    el.className = 'sheet-backdrop';
    el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-handle"></div>${html}</div>`;
    const close = () => CC.closeSheet(id);
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('.sheet-x')) close(); });
    document.body.appendChild(el);
    return { el, close, set: (inner) => { CC.$('.sheet', el).innerHTML = `<div class="sheet-handle"></div>${inner}`; } };
  };
  CC.closeSheet = (id) => { const old = document.getElementById(id); if (old) old.remove(); };
  CC.sheetHead = (ic, title) => `<div class="sheet-head"><b>${icon(ic, 18)}${esc(title)}</b><button type="button" class="sheet-x" aria-label="Fechar">${icon('x', 20)}</button></div>`;
  CC.sheetErr = (error) => {
    const [t, s] = error && error.status === 0 ? NET : ['Não foi possível concluir', (error && error.message) || 'Tente de novo.'];
    return `<div class="od-err" role="alert">${icon(error && error.status === 0 ? 'wifi-slash' : 'warning-circle', 20)}<span><b>${esc(t)}</b><small>${esc(s)}</small></span></div>`;
  };
  CC.sheetDone = (title, sub, actions) => `<div class="od-done">${CC.success(72, title)}<b>${esc(title)}</b><small>${esc(sub)}</small></div>${actions}`;
  CC.busy = (btn, label) => { btn.disabled = true; btn.innerHTML = `${icon('circle-notch', 18, 'spin')}${esc(label)}`; };

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); } catch {
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch { /* sem area de transferencia */ }
      t.remove();
    }
    CC.toast(`${text} copiado`);
  }

  // Menu de tres pontos. c = centro (detalhes da obra).
  CC.obraMenu = function (c) {
    const linked = !!(c.proposta_origem && c.proposta_origem.id);
    const r = role();
    const canDel = !linked && (r === 'admin' || r === 'gestor');
    const canDesc = linked && r === 'admin';
    const propLabel = linked ? (c.proposta_origem.numero || 'proposta aprovada') : '';
    const item = (id, ic, t, s, cls) => `<button type="button" class="suite-item om-item${cls ? ` ${cls}` : ''}" id="${id}">${icon(ic, 22)}<span><b>${esc(t)}</b><small>${esc(s)}</small></span></button>`;
    const sh = CC.sheet('obra-menu', `${CC.sheetHead('buildings', c.nome)}
      <p class="sheet-sec">${esc(c.codigo)}</p>
      ${item('om-copy', 'copy', 'Copiar código da obra', c.codigo)}
      ${linked ? `<a class="suite-item om-item" id="om-prop" href="${esc(CC.suite.orcLink(c.proposta_origem.id))}"${/SuiteConstrutec\//.test(navigator.userAgent) ? '' : ' target="_blank" rel="noopener"'}>${icon('file-text', 22)}<span><b>Proposta de origem</b><small>${esc(propLabel)} · no Orçamentos</small></span></a>` : ''}
      ${canDel ? item('om-del', 'trash', 'Excluir obra', 'Obra sem vínculo com orçamento · apaga de vez', 'danger') : ''}
      ${canDesc ? item('om-desc', 'trash', 'Descartar obra', `Ligada à ${propLabel} · fica guardada`, 'danger') : ''}`);
    CC.$('#om-copy', sh.el).addEventListener('click', () => { sh.close(); copy(c.codigo); });
    const prop = CC.$('#om-prop', sh.el);
    if (prop) prop.addEventListener('click', () => setTimeout(sh.close, 0));
    const del = CC.$('#om-del', sh.el);
    if (del) del.addEventListener('click', () => excluir(c));
    const desc = CC.$('#om-desc', sh.el);
    if (desc) desc.addEventListener('click', () => descartar(c));
  };

  function excluir(c, error) {
    const sh = CC.sheet('obra-menu', `${CC.sheetHead('trash', `Excluir ${c.codigo}?`)}
      <p class="muted od-sub">${esc([c.nome, c.cliente].filter(Boolean).join(' · '))}</p>
      <p class="od-txt">A obra não tem vínculo com orçamento nem lançamentos. Ela é apagada de vez; não dá para desfazer.</p>
      ${error ? CC.sheetErr(error) : ''}
      <div class="grid2 od-acts"><button class="btn2" type="button" id="od-cancel">Cancelar</button>
        <button class="btn danger" type="button" id="od-go">${icon('trash', 18)}Excluir obra</button></div>`);
    CC.$('#od-cancel', sh.el).addEventListener('click', sh.close);
    CC.$('#od-go', sh.el).addEventListener('click', async (e) => {
      CC.busy(e.currentTarget, 'Excluindo…');
      CC.$('#od-cancel', sh.el).disabled = true;
      try { await CC.api(`/centros-custo/${c.id}`, { method: 'DELETE' }); } catch (err) { return excluir(c, err); }
      sh.close();
      CC.toast(`${c.codigo} excluída`);
      CC.go('obras');
    });
  }

  function blockList(counts) {
    const rows = BLOCKS.filter(([k]) => Number(counts[k]) > 0);
    if (!rows.length) return '';
    return `<div class="od-blk"><b>${icon('warning-circle', 18)}O que impede o descarte</b>
      <small>Exclua ou estorne estes registros antes. A obra só pode ser descartada sem movimento.</small>
      ${rows.map(([k, ic, one, many, link]) => { const n = Number(counts[k]); return `<div class="od-blk-row">${icon(ic, 18)}<span>${n} ${n === 1 ? one : many}</span>${link ? '<button type="button" class="od-link" id="od-lanc">Ver</button>' : ''}</div>`; }).join('')}</div>`;
  }

  async function descartar(c, error) {
    const sh = CC.sheet('obra-menu', `${CC.sheetHead('trash', `Descartar ${c.codigo}?`)}<div class="skeleton"></div>`);
    let counts = {};
    try { counts = (await CC.api(`/centros-custo/${c.id}/impedimentos`)).data || {}; } catch (err) {
      if (!document.body.contains(sh.el)) return;
      return sh.set(`${CC.sheetHead('trash', `Descartar ${c.codigo}?`)}${CC.sheetErr(err)}
        <div class="od-acts"><button class="btn2" type="button" id="od-retry" style="width:100%">Tentar de novo</button></div>`), CC.$('#od-retry', sh.el).addEventListener('click', () => descartar(c));
    }
    if (!document.body.contains(sh.el)) return;
    const blocked = BLOCKS.some(([k]) => Number(counts[k]) > 0);
    const prop = (c.proposta_origem && c.proposta_origem.numero) || 'proposta de origem';
    const form = (err) => {
      sh.set(`${CC.sheetHead('trash', `Descartar ${c.codigo}?`)}
        <p class="muted od-sub">${esc([c.nome, c.cliente].filter(Boolean).join(' · '))}</p>
        <p class="od-txt">A obra sai da lista com o contrato e a base de custo, e fica guardada com quem descartou e quando. A ${esc(prop)} volta a "Aprovada sem Centro de Custo" no Orçamentos e volta a apontar para a obra se ela for recuperada. Um administrador pode recuperar em Menu › Obras descartadas.</p>
        ${blocked ? blockList(counts) : `<label class="field"><span>Motivo (opcional)</span><input id="od-motivo" maxlength="300" autocomplete="off" placeholder="Ex.: obra de teste"></label>
        <label class="field od-code"><span>Código da obra</span><input id="od-code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="digite ${esc(c.codigo)} para liberar"></label>`}
        ${err ? CC.sheetErr(err) : ''}
        <div class="grid2 od-acts"><button class="btn2" type="button" id="od-cancel">Cancelar</button>
          <button class="btn danger" type="button" id="od-go" disabled>${icon('trash', 18)}Descartar obra</button></div>`);
      const go = CC.$('#od-go', sh.el), code = CC.$('#od-code', sh.el);
      CC.$('#od-cancel', sh.el).addEventListener('click', sh.close);
      const lanc = CC.$('#od-lanc', sh.el);
      if (lanc) lanc.addEventListener('click', () => { sh.close(); CC.screens.obra({ id: c.id, tab: 'lanc' }); });
      if (!code) return;
      const ok = () => code.value.trim().toLowerCase() === String(c.codigo).trim().toLowerCase();
      code.addEventListener('input', () => { go.disabled = !ok(); code.parentElement.classList.toggle('bad', !!code.value.trim() && !ok()); });
      go.addEventListener('click', async () => {
        if (!ok()) return;
        const motivo = CC.$('#od-motivo', sh.el).value.trim();
        CC.busy(go, 'Descartando…');
        CC.$('#od-cancel', sh.el).disabled = true;
        code.disabled = true;
        try { await CC.api(`/centros-custo/${c.id}/descartar`, { method: 'POST', body: { confirmar: code.value.trim(), motivo } }); } catch (e2) { return form(e2); }
        CC.descartadasCount = undefined;
        CC.toast(`${c.codigo} descartada · fica em Obras descartadas`);
        sh.set(CC.sheetDone(`${c.codigo} descartada`, 'A obra, o contrato e a base de custo ficam guardados em Menu › Obras descartadas.',
          `<div class="grid2 od-acts"><button class="btn2" type="button" id="od-obras">Obras</button><button class="btn" type="button" id="od-see">${icon('archive', 18)}Ver descartadas</button></div>`));
        CC.$('#od-obras', sh.el).addEventListener('click', () => { sh.close(); CC.go('obras'); });
        CC.$('#od-see', sh.el).addEventListener('click', () => { sh.close(); CC.go('descartadas'); });
        CC.go('obras'); // a obra ja saiu; a lista por tras fica atualizada
      });
    };
    form(error);
  }
})(window.CC = window.CC || {});
