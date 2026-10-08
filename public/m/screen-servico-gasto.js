// Lancamento rapido de despesa do servico (folha): atalhos de Uber, combustivel e miscelanea, valor, descricao e recibo.
// Prototipo: Rodada 28 (svGasto, 28y a 28ae). Sem internet a despesa entra na fila do celular (queue.js) com client_id.
(function (CC) {
  const { esc, icon, money } = CC;
  const GRANDES = ['deslocamento', 'combustivel', 'material'];
  const MENORES = ['mao_de_obra', 'outros'];
  const DICA = { deslocamento: 'Uber · ida e volta', combustivel: 'Combustível', material: 'Miscelânea · parafusos, abraçadeiras e conectores', mao_de_obra: 'Mão de obra terceirizada', outros: 'Outro gasto' };

  function lerArquivo(file) {
    return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
  }

  CC.sv.gasto = function abrir(s, prev, error) {
    const g = prev || { tipo: 'deslocamento', valor: '', desc: '', recibo: null };
    const T = CC.sv.TIPOS;
    const val = CC.parseMoney(g.valor);
    const ok = val > 0;
    const sh = CC.sheet('sv-sheet', `${CC.sheetHead('plus-circle', 'Lançar despesa')}<p class="muted od-sub">${esc(s.codigo)} · ${esc(s.nome)}</p>
      ${error ? `<div class="od-err sv-err" role="alert">${icon('warning-circle', 20)}<span><b>${error.status === 0 ? 'Sem conexão' : 'Não foi possível lançar'}</b>
        <small>${esc(error.status === 0 ? 'A despesa não foi lançada. Confira a conexão e tente de novo; o valor e a foto continuam aqui.' : error.message)}</small></span></div>` : ''}
      ${CC.offline() ? `<div class="note off sv-gap">${icon('cloud-slash', 18)}<span>Sem internet: a despesa fica na fila do celular e sobe sozinha quando a conexão voltar.</span></div>` : ''}
      <p class="sheet-sec">Atalhos</p>
      <div class="sv-atalhos">${GRANDES.map((k) => `<button type="button" class="sv-atalho" data-tipo="${k}" aria-pressed="${g.tipo === k}">${icon(T[k][1], 24)}${esc(T[k][0])}</button>`).join('')}</div>
      <div class="sv-menores">${MENORES.map((k) => `<button type="button" class="sv-chip-b" data-tipo="${k}" aria-pressed="${g.tipo === k}">${esc(T[k][0])}</button>`).join('')}</div>
      <label class="field money sv-gap"><span>Valor (R$)</span><input id="g-valor" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(g.valor)}"></label>
      <label class="field sv-gap"><span>Descrição · opcional</span><input id="g-desc" maxlength="240" autocomplete="off" placeholder="${esc(DICA[g.tipo])}" value="${esc(g.desc)}"></label>
      <p class="sheet-sec">Foto do recibo</p>
      ${g.recibo ? `<div class="sv-recibo">${g.recibo.tipo === 'application/pdf' ? `<span class="th">${icon('file-pdf', 20)}</span>` : `<span class="th" style="background-image:url('${g.recibo.conteudoBase64}')"></span>`}
          <span class="grow"><b>${esc(g.recibo.nome)}</b><small>Foto do recibo · fica no anexo</small></span><button type="button" class="sv-link" id="g-trocar">Trocar</button></div>`
        : `<div class="grid2"><label class="btn2">${icon('camera', 18)}Câmera<input class="sr" type="file" id="g-cam" accept="image/*" capture="environment"></label>
          <label class="btn2">${icon('paperclip', 18)}Arquivo<input class="sr" type="file" id="g-arq" accept="image/jpeg,image/png,image/webp,application/pdf"></label></div>`}
      <button class="btn sv-full" type="button" id="g-ok"${ok ? '' : ' disabled'}>${icon('plus', 18)}${ok ? `Lançar ${esc(money(val))}` : 'Digite o valor'}</button>`);
    const ler = () => ({ ...g, valor: CC.$('#g-valor', sh.el).value, desc: CC.$('#g-desc', sh.el).value });
    const btn = CC.$('#g-ok', sh.el);
    CC.$$('[data-tipo]', sh.el).forEach((b) => b.addEventListener('click', () => abrir(s, { ...ler(), tipo: b.dataset.tipo })));
    CC.$('#g-valor', sh.el).addEventListener('input', (e) => {
      const v = CC.parseMoney(e.target.value);
      btn.disabled = !(v > 0);
      btn.innerHTML = `${icon('plus', 18)}${v > 0 ? `Lançar ${esc(money(v))}` : 'Digite o valor'}`;
    });
    const trocar = CC.$('#g-trocar', sh.el);
    if (trocar) trocar.addEventListener('click', () => abrir(s, { ...ler(), recibo: null }));
    for (const id of ['g-cam', 'g-arq']) {
      const input = CC.$(`#${id}`, sh.el);
      if (!input) continue;
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const atual = ler();
        try {
          const pdf = file.type === 'application/pdf';
          const conteudoBase64 = pdf ? await lerArquivo(file) : await CC.shrink(file);
          abrir(s, { ...atual, recibo: { nome: pdf ? file.name.slice(0, 120) : `recibo-${atual.tipo}-${CC.today()}.jpg`, tipo: pdf ? 'application/pdf' : 'image/jpeg', conteudoBase64 } });
        } catch {
          CC.toast('Não foi possível ler o arquivo. Tente outro.', 'warning-circle');
        }
      });
    }
    btn.addEventListener('click', async () => {
      const d = ler();
      const valor = CC.parseMoney(d.valor);
      if (!(valor > 0)) return;
      const clientId = CC.uuid();
      const payload = { tipo: d.tipo, valor, data: CC.today(), descricao: d.desc.trim() || CC.sv.TIPOS[d.tipo][0] };
      CC.busy(btn, 'Lançando…');
      CC.$$('button, input', sh.el).forEach((x) => { if (x !== btn) x.disabled = true; });
      if (CC.offline()) return naFila(s, sh, { client_id: clientId, servicoId: s.id, obra_nome: s.nome, payload, recibo: d.recibo }, d);
      let data;
      try {
        ({ data } = await CC.api(`/servicos/${s.id}/gastos`, { method: 'POST', body: { ...payload, client_id: clientId, ...(d.recibo ? { recibo: d.recibo } : {}) } }));
      } catch (err) {
        return abrir(s, d, err);
      }
      sh.close();
      CC.toast(`Despesa lançada · ${CC.sv.TIPOS[d.tipo][0]} ${money(valor)}`);
      CC.sv.reload(s.id, 'lanc', { novo: data.id });
    });
  };

  async function naFila(s, sh, item, d) {
    try {
      await CC.queue.add(item);
    } catch {
      return CC.sv.gasto(s, d, { status: -1, message: 'Não foi possível salvar no celular. Libere espaço ou tente sem a foto.' });
    }
    sh.close();
    CC.toast('Sem internet · despesa salva na fila, sobe sozinha', 'cloud-slash');
    return CC.sv.reload(s.id, 'lanc');
  }
})(window.CC = window.CC || {});
