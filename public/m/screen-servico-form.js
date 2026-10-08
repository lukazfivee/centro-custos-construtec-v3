// Novo centro de custo (Obra ou Servico) e editar servico, numa folha. Prototipo: Rodada 28 (sSvNovo, 28k a 28q).
// Servico: POST/PUT /api/servicos. Obra: POST /api/centros-custo. Servico que vira obra: PUT /api/centros-custo/:id com tipo.
(function (CC) {
  const { esc, icon } = CC;
  const TIPOS = [['obra', 'Obra', 'Orçamento, medições e Curva S', 'buildings'], ['servico', 'Serviço', 'Curto, poucos gastos e um valor cobrado', 'wrench']];

  // Codigo da obra nova: maior OB-<n> da lista + 1 (o servidor nao sugere codigo de obra).
  async function proximoCodigoObra() {
    const { data } = await CC.cached('obras', `/centros-custo?mes=${CC.month()}`);
    const max = (data || []).reduce((m, c) => { const r = /^OB-(\d+)$/i.exec(c.codigo || ''); return r ? Math.max(m, Number(r[1])) : m; }, 100);
    return `OB-${max + 1}`;
  }

  async function virarObra(s, f) {
    const { data } = await CC.api(`/centros-custo/${s.id}/detalhes?mes=${CC.month()}`);
    const c = data.centro;
    await CC.api(`/centros-custo/${s.id}`, { method: 'PUT', body: {
      codigo: c.codigo, nome: c.nome, responsavel: f.resp || c.responsavel, orcamento: c.orcamento, cliente: f.cli || c.cliente,
      contrato: c.contrato, data_inicio: f.data || c.data_inicio, data_fim: c.data_fim, valor_contrato: CC.parseMoney(f.valor) || 0,
      situacao: c.situacao === 'concluido' ? 'concluido' : 'execucao', descricao: f.desc || c.descricao, ativo: c.ativo !== false, tipo: 'obra', revisao: c.revision,
    } });
  }

  CC.sv.form = function abrir(opts, prev, error) {
    const ed = opts.servico || null;
    const f = prev || (ed
      ? { tipo: 'servico', cli: ed.cliente || '', local: ed.local || '', data: ed.data || '', resp: ed.responsavel || '', valor: ed.valor != null ? CC.money(ed.valor).replace(/^R\$\s*/, '') : '', desc: ed.descricao || '', nome: '' }
      : { tipo: opts.tipo === 'obra' ? 'obra' : 'servico', cli: '', local: '', data: CC.today(), resp: '', valor: '', desc: '', nome: '' });
    const falta = error && error.falta ? error.falta : [];
    const bad = (k) => (falta.includes(k) ? ' bad' : '');
    const nomes = { cli: 'cliente', valor: 'valor cobrado', nome: 'nome da obra' };
    const servFields = `
      <label class="field${bad('cli')}"><span>Cliente</span><input id="n-cli" maxlength="160" autocomplete="off" placeholder="Ex.: Clínica Do'r Canela" value="${esc(f.cli)}"></label>
      <label class="field"><span>Local · opcional</span><input id="n-local" maxlength="200" autocomplete="off" placeholder="Endereço ou setor" value="${esc(f.local)}"></label>
      <div class="grid2"><label class="field"><span>Data</span><input id="n-data" type="date" value="${esc(f.data)}"></label>
        <label class="field"><span>Responsável</span><input id="n-resp" maxlength="120" autocomplete="off" placeholder="Técnico" value="${esc(f.resp)}"></label></div>
      <label class="field money${bad('valor')}"><span>Valor cobrado do cliente (R$)</span><input id="n-valor" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(f.valor)}"></label>
      <label class="field"><span>O que foi feito ou vai ser feito</span><textarea id="n-desc" rows="4" maxlength="2000" placeholder="Ex.: remanejar o rack e reorganizar o CFTV">${esc(f.desc)}</textarea></label>
      ${f.tipo === 'obra' ? '' : `<div class="sv-note">${icon('info', 16)}<span>Serviço não tem orçamento importado, Curva S nem medições: só o valor cobrado e os gastos.</span></div>`}`;
    const obraFields = ed
      ? `<div class="note off">${icon('arrows-left-right', 18)}<span>O ${esc(ed.codigo)} vira obra: ganha planilha de orçamento, medições e Curva S. ${(ed.gastos || []).length ? `Os ${(ed.gastos || []).length} lançamentos continuam ligados a ele.` : 'Ele ainda não tem lançamentos.'} Checklist, fotos e aceite ficam guardados e voltam se ele virar serviço de novo.</span></div>${servFields}`
      : `<label class="field${bad('nome')}"><span>Nome da obra</span><textarea id="n-nome" rows="2" maxlength="140" placeholder="Ex.: Hospital São Lucas · Ala D">${esc(f.nome)}</textarea></label>
        <label class="field${bad('cli')}"><span>Cliente</span><input id="n-cli" maxlength="160" autocomplete="off" placeholder="Ex.: Rede São Lucas Saúde" value="${esc(f.cli)}"></label>
        <div class="sv-note">${icon('file-arrow-down', 16)}<span>Depois de criar, importe o orçamento em Obras › Importar orçamento para ter orçado, medições e Curva S.</span></div>`;
    const label = ed ? (f.tipo === 'obra' ? 'Salvar como obra' : 'Salvar') : (f.tipo === 'obra' ? 'Criar obra' : 'Criar serviço');
    const sh = CC.sheet('sv-sheet', `${CC.sheetHead(ed ? 'pencil-simple' : 'plus-circle', ed ? `Editar ${ed.codigo}` : 'Novo centro de custo')}
      <p class="muted od-sub">${esc(ed ? ed.nome : 'Obra ou serviço')}</p>
      ${falta.length ? `<div class="od-err sv-err bad" role="alert">${icon('warning-circle', 20)}<span><b>Falta preencher</b><small>Preencha ${esc(falta.map((k) => nomes[k]).join(' e '))} para ${ed ? 'salvar' : 'criar'}.</small></span></div>`
        : (error ? CC.sheetErr(error) : '')}
      <p class="sheet-sec">Tipo</p>
      <div class="sv-tipos" role="radiogroup" aria-label="Tipo">${TIPOS.map(([k, t, sub, ic]) => `<button type="button" class="sv-tipo" role="radio" aria-checked="${f.tipo === k}" data-tipo="${k}">
        ${icon(ic, 22)}<span><b>${t}</b><small>${sub}</small></span></button>`).join('')}</div>
      <div class="sv-form">${f.tipo === 'obra' ? obraFields : servFields}</div>
      <button class="btn sv-full" type="button" id="n-ok">${icon('check', 18)}${esc(label)}</button>`);
    const v = (id) => { const x = CC.$(`#${id}`, sh.el); return x ? x.value : undefined; };
    const ler = () => ({ ...f, cli: v('n-cli') ?? f.cli, local: v('n-local') ?? f.local, data: v('n-data') ?? f.data, resp: v('n-resp') ?? f.resp,
      valor: v('n-valor') ?? f.valor, desc: v('n-desc') ?? f.desc, nome: v('n-nome') ?? f.nome });
    CC.$$('[data-tipo]', sh.el).forEach((b) => b.addEventListener('click', () => { if (b.dataset.tipo !== f.tipo) abrir(opts, { ...ler(), tipo: b.dataset.tipo }); }));
    CC.$('#n-ok', sh.el).addEventListener('click', async (e) => {
      const d = ler();
      const val = CC.parseMoney(d.valor);
      const servLike = d.tipo === 'servico' || ed;
      const miss = servLike ? [!d.cli.trim() && 'cli', !(val >= 0) && 'valor'].filter(Boolean) : [!d.nome.trim() && 'nome', !d.cli.trim() && 'cli'].filter(Boolean);
      if (miss.length) return abrir(opts, d, { falta: miss });
      CC.busy(e.currentTarget, ed ? 'Salvando…' : 'Criando…');
      CC.$$('input, textarea, [data-tipo]', sh.el).forEach((x) => { x.disabled = true; });
      const corpo = { cliente: d.cli.trim(), valor: val, local: d.local.trim(), data: d.data || undefined, responsavel: d.resp.trim(), descricao: d.desc.trim() };
      try {
        if (ed && d.tipo === 'obra') {
          await virarObra(ed, d);
          sh.close();
          CC.toast(`${ed.codigo} agora é obra · confira o orçamento`, 'buildings');
          return CC.go('obra', { id: ed.id });
        }
        if (ed) {
          await CC.api(`/servicos/${ed.id}`, { method: 'PUT', body: { ...corpo, revisao: ed.revisao } });
          sh.close();
          CC.toast('Serviço salvo');
          return CC.sv.reload(ed.id, 'resumo');
        }
        if (d.tipo === 'obra') {
          const codigo = await proximoCodigoObra();
          const { data } = await CC.api('/centros-custo', { method: 'POST', body: { codigo, nome: d.nome.trim(), cliente: d.cli.trim(), tipo: 'obra', situacao: 'planejamento' } });
          sh.close();
          CC.toast('Obra criada · importe o orçamento quando tiver', 'buildings');
          return CC.go('obra', { id: data.id });
        }
        const { data } = await CC.api('/servicos', { method: 'POST', body: corpo });
        sh.close();
        CC.toast(`${data.codigo} criado · agendado${data.data ? ` para ${CC.dateFull(data.data)}` : ''}`);
        return CC.go('servico', { id: data.id });
      } catch (err) {
        return abrir(opts, d, err);
      }
    });
  };
})(window.CC = window.CC || {});
