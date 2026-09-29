// Aba Medicoes da obra (prints 32 e 33): mao de obra (horas) e contrato (cliente), com formulario,
// historico e boletim. Mesmas regras do sistema atual (public/budget-measurements.js).
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const O = D.obras = D.obras || {};
  const U = D.ui;
  O.abas = O.abas || {};
  let tipo = 'mo';
  const horas = (x) => Number(x || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const periodo = (m) => `${D.data(m.period_start)} a ${D.data(m.period_end)}`;
  const centavos = (x) => Math.round(Number(x || 0) * 100);

  // Segunda a sabado da semana atual (como o formulario de hoje).
  function semana() {
    const d = new Date();
    const seg = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
    const sab = new Date(seg.getFullYear(), seg.getMonth(), seg.getDate() + 5);
    const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    return [iso(seg), iso(sab)];
  }

  function boletim(obra, cmp, m, todas) {
    const acumulado = todas.filter((x) => x.status === 'approved' && x.measurement_number <= m.measurement_number).reduce((s, x) => s + centavos(x.measured_amount), 0) / 100;
    const contrato = Number(cmp.summary.contractValue || 0);
    const itens = (cmp.items || []).map((i) => `<tr><td>${esc(i.code || '—')}</td><td>${esc(i.name || i.description)}</td><td>${esc(i.unit || '')}</td><td class="num">${esc(Number(i.budgetedQuantity || 0).toLocaleString('pt-BR'))}</td></tr>`).join('');
    O.imprimir({
      titulo: `Boletim da medição ${m.measurement_number}`,
      conteudo: `${O.cabecalhoFolha('Boletim de medição contratual', [
        ['Medição nº', String(m.measurement_number)], ['Contrato', [cmp.contract.number, cmp.contract.baselineVersion != null ? `REV ${String(cmp.contract.baselineVersion).padStart(2, '0')}` : ''].filter(Boolean).join(' ')],
        ['Obra', [obra.codigo, obra.nome].filter(Boolean).join(' · ')], ['Cliente', obra.cliente], ['Período', periodo(m)], ['Responsável', obra.responsavel]])}
        ${O.numerosFolha([['Valor contratual', CC.money(contrato)], ['Valor desta medição', CC.money(m.measured_amount)], ['Acumulado até esta medição', CC.money(acumulado)],
          ['Saldo contratual a medir', CC.money((centavos(contrato) - centavos(acumulado)) / 100)], ['Situação', m.status === 'approved' ? 'Aprovada p/ faturamento' : m.status]])}
        ${m.notes ? `<p class="folha-obs"><b>Observações:</b> ${esc(m.notes)}</p>` : ''}
        <h3>Itens contratados (referência)</h3><table class="tbl"><thead><tr><th>Item</th><th>Descrição</th><th>Unidade</th><th class="num">Qtd contratada</th></tr></thead><tbody>${itens}</tbody></table>
        <p class="muted folha-obs">O valor medido refere-se ao avanço aprovado no período; as quantidades acima são as do orçamento contratado.</p>
        <div class="assinaturas"><span>Construtec Engenharia</span><span>${esc(obra.cliente || 'Cliente')}</span></div>`,
    });
  }

  function formMo(p) {
    return `<form class="form-lanc" data-form="mo" novalidate><b class="bt">Registrar horas da equipe</b>
      <div class="duas">${U.campo({ rotulo: 'Início', name: 'periodStart', tipo: 'date', valor: p[0] })}${U.campo({ rotulo: 'Fim', name: 'periodEnd', tipo: 'date', valor: p[1] })}</div>
      ${U.campo({ rotulo: 'Horas da equipe', name: 'teamHours', placeholder: 'Ex.: 8,5' }).replace('<input ', '<input inputmode="decimal" ')}
      ${U.campo({ rotulo: 'Frente de trabalho / observações', name: 'notes', placeholder: 'Ex.: instalação da central SDAI' })}
      <button type="submit" class="btn btn-p">Registrar horas</button></form>`;
  }
  function formCt(n, p) {
    return `<form class="form-lanc" data-form="ct" novalidate><b class="bt">Registrar medição ao cliente</b>
      ${U.campo({ rotulo: 'Nº da medição', name: 'measurementNumber', tipo: 'number', valor: n })}
      <div class="duas">${U.campo({ rotulo: 'Início', name: 'periodStart', tipo: 'date', valor: p[0] })}${U.campo({ rotulo: 'Fim', name: 'periodEnd', tipo: 'date', valor: p[1] })}</div>
      ${U.campo({ rotulo: 'Valor medido (R$)', name: 'measuredAmount', placeholder: '0,00' })}
      ${U.campo({ rotulo: 'Boletim / observações', name: 'notes', placeholder: 'Ex.: aprovado pela fiscalização' })}
      <button type="submit" class="btn btn-p">Registrar medição</button></form>`;
  }

  O.abas.medicoes = async function (corpo, obra, vivo) {
    corpo.innerHTML = U.carregando('Carregando as medições…');
    const [med, cmp] = await Promise.all([
      CC.api(`/centros-custo/${obra.id}/medicoes`).then((r) => r.data),
      CC.api(`/centros-custo/${obra.id}/orcado-realizado`).then((r) => r.data),
    ]);
    if (!vivo()) return;
    if (!med.contractId || !cmp.hasBudget) {
      corpo.innerHTML = `<div class="card">${U.vazio('ruler', 'Esta obra ainda não tem contrato ativo.', 'As medições começam depois de importar o orçamento aprovado do Orçamentos.')}</div>`;
      return;
    }
    const pode = D.pode('cadastrar');
    const recarregar = () => O.abas.medicoes(corpo, obra, vivo);
    const lab = med.labor || [];
    const cts = (med.contracts || []).slice().sort((a, b) => b.measurement_number - a.measurement_number);
    const planejadas = Number((cmp.laborHours || {}).planned || 0);
    const medidas = lab.reduce((s, m) => s + Number(m.team_hours || 0), 0);
    const contrato = Number(cmp.summary.contractValue || 0);
    const medido = cts.filter((m) => m.status === 'approved').reduce((s, m) => s + centavos(m.measured_amount), 0) / 100;
    const k = U.kpi;
    const kpisMo = [k({ rotulo: 'Horas planejadas', valor: `${horas(planejadas)} h`, det: 'do orçamento aprovado', icone: 'clock' }),
      k({ rotulo: 'Horas medidas', valor: `${horas(medidas)} h`, det: planejadas ? `${Math.round((medidas / planejadas) * 100)}% do planejado` : '', icone: 'check', tom: 'ok' }),
      k({ rotulo: 'Saldo de horas', valor: `${horas(planejadas - medidas)} h`, det: planejadas - medidas < 0 ? 'acima do planejado' : 'a executar', icone: 'hourglass', tomValor: planejadas - medidas < 0 ? 'err' : '' })].join('');
    const kpisCt = [k({ rotulo: 'Contrato', valor: CC.money(contrato), det: cmp.contract.number || '', icone: 'handshake' }),
      k({ rotulo: 'Medido ao cliente', valor: CC.money(medido), det: contrato ? `${Math.round((medido / contrato) * 100)}% do contrato` : '', icone: 'check', tom: 'ok' }),
      k({ rotulo: 'Saldo a faturar', valor: CC.money((centavos(contrato) - centavos(medido)) / 100), det: 'para as próximas medições', icone: 'hourglass' })].join('');
    const histMo = U.tabela({ colunas: [{ rotulo: 'Período' }, { rotulo: 'Frente / observações' }, { rotulo: 'Horas', num: true }, { rotulo: 'Registrado por' }],
      linhas: lab.map((m) => ({ id: m.id, celulas: [`<b>${esc(periodo(m))}</b>`, esc(m.notes || '—'), esc(`${horas(m.team_hours)} h`), esc(m.created_by_name || '—')] })), vazio: 'Nenhuma medição de horas ainda.' });
    const histCt = U.tabela({ colunas: [{ rotulo: 'Medição' }, { rotulo: 'Período' }, { rotulo: 'Valor', num: true }, { rotulo: 'Status' }, { rotulo: '', num: true }],
      linhas: cts.map((m) => ({ id: m.id, celulas: [`<b>Medição ${esc(m.measurement_number)}</b>`, esc(periodo(m)), `<b class="valor-medido">${esc(CC.money(m.measured_amount))}</b>`, esc(m.status === 'approved' ? 'Aprovada' : m.status),
        `<button type="button" class="btn btn-g" data-boletim="${esc(m.id)}">${D.ic('file-text')}Boletim</button>`] })), vazio: 'Nenhuma medição ao cliente ainda.' });
    const mo = tipo === 'mo';
    corpo.innerHTML = `${U.seg('med', [{ valor: 'mo', rotulo: 'Mão de obra' }, { valor: 'ct', rotulo: 'Contrato (cliente)' }], tipo, 'Tipo de medição')}
      <div class="kpis tres">${mo ? kpisMo : kpisCt}</div>
      <div class="grade-med">${pode ? `<section class="card bloco">${mo ? formMo(semana()) : formCt(cts.length ? cts[0].measurement_number + 1 : 1, semana())}</section>` : ''}
        <section class="card tabela"><div class="bcab pad"><b>Histórico</b></div>${mo ? histMo : histCt}</section></div>`;
    CC.$$('[data-seg="med"]', corpo).forEach((b) => b.addEventListener('click', () => { tipo = b.dataset.valor; recarregar(); }));
    CC.$$('[data-boletim]', corpo).forEach((b) => b.addEventListener('click', () => boletim(obra, cmp, cts.find((m) => m.id === b.dataset.boletim), cts)));
    const form = CC.$('form[data-form]', corpo);
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = (n) => (CC.$(`[name="${n}"]`, form) || {}).value || '';
      const erros = {};
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v('periodStart'))) erros.periodStart = 'Informe o início.';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v('periodEnd'))) erros.periodEnd = 'Informe o fim.';
      else if (v('periodEnd') < v('periodStart')) erros.periodEnd = 'O fim não pode ser antes do início.';
      let body;
      if (mo) {
        const h = Number(String(v('teamHours')).replace(',', '.'));
        if (!(h >= 0.5)) erros.teamHours = 'Informe pelo menos 0,5 hora.';
        body = { type: 'labor', periodStart: v('periodStart'), periodEnd: v('periodEnd'), teamHours: h, notes: v('notes').trim() || null };
      } else {
        const n = Number(v('measurementNumber'));
        const valor = CC.parseMoney(v('measuredAmount'));
        if (!(Number.isInteger(n) && n >= 1)) erros.measurementNumber = 'Número inválido.';
        if (!(valor >= 0.01)) erros.measuredAmount = 'Informe o valor medido.';
        body = { type: 'contract', measurementNumber: n, periodStart: v('periodStart'), periodEnd: v('periodEnd'), measuredAmount: valor, notes: v('notes').trim() || null };
      }
      CC.$$('.fld.tem-erro', form).forEach((f) => f.classList.remove('tem-erro'));
      Object.entries(erros).forEach(([nome, msg]) => { const fld = CC.$(`[name="${nome}"]`, form).closest('.fld'); fld.classList.add('tem-erro'); CC.$('.erro', fld).textContent = msg; });
      if (Object.keys(erros).length) return;
      const bt = CC.$('button[type=submit]', form);
      bt.disabled = true;
      try {
        await CC.api(`/centros-custo/${obra.id}/medicoes`, { method: 'POST', body });
        CC.toast(mo ? 'Horas registradas' : 'Medição registrada');
        recarregar();
      } catch (error) {
        bt.disabled = false;
        CC.toast(error.status === 0 ? 'Sem internet. Registrar precisa da conexão.' : error.message, 'warning');
      }
    });
  };
})(window.CC);
