// Recorrentes (D5, prints 56 a 59): modelos com frequencia, dia e parcelas, "Proximas geracoes" do mes
// seguinte e o botao "Gerar lancamentos do mes" com previa e o estado "ja gerado".
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const C = D.cad;
  const U = D.ui;

  function parcelas(m) {
    const feitas = Number(m.geradas) || 0;
    if (!m.total_parcelas) return `<div class="parcelas"><span>Sem fim · ${esc(String(feitas))} geradas</span></div>`;
    const pct = Math.min(100, (feitas / m.total_parcelas) * 100);
    return `<div class="parcelas"><span>${esc(String(feitas))} de ${esc(String(m.total_parcelas))} geradas</span><span class="bar"><span style="width:${pct.toFixed(0)}%"></span></span></div>`;
  }

  function linha(m) {
    const acoes = C.pode() ? `<div class="rec-acoes"><button type="button" class="ibtn" data-editar="${esc(m.id)}" aria-label="Editar ${esc(m.nome)}">${D.ic('pencil-simple')}</button>
      <button type="button" class="ibtn" data-pausar="${esc(m.id)}" aria-label="${m.ativo ? 'Pausar' : 'Reativar'} ${esc(m.nome)}">${D.ic(m.ativo ? 'pause' : 'play')}</button></div>` : '';
    return {
      id: m.id,
      celulas: [
        `<div class="dois-tx"><b>${esc(m.nome)}</b><span>${esc(m.centro_codigo)} · ${esc(m.centro_nome)}${m.favorecido ? ` · ${esc(m.favorecido)}` : ''}</span></div>`,
        `${esc(C.FREQUENCIAS[m.frequencia] || m.frequencia)} · dia ${esc(String(m.dia_mes || 1))}`,
        parcelas(m), esc(CC.money(m.valor)),
        m.ativo ? U.chip('Ativo', 'ok') : U.chip('Pausado', 'neutro'), acoes,
      ],
    };
  }

  function proximas(previa) {
    const nome = C.nomeMes(previa.mes);
    const itens = previa.itens.map((i) => `<div class="prox-item"><div class="dia"><b>${esc(i.data.slice(8, 10))}</b><span>${esc(C.mesAbrev(previa.mes))}</span></div>
      <div class="dois-tx"><b>${esc(i.nome)}</b><span>${esc(i.obra)}${i.favorecido ? ` · ${esc(i.favorecido)}` : ''}</span></div><span class="val">${esc(CC.money(i.valor))}</span></div>`).join('');
    return `<aside class="card prox" aria-label="Próximas gerações"><div class="topo"><b>Próximas gerações</b><span class="lbl">${esc(nome)}</span></div>
      ${itens || `<span class="muted">Nenhum recorrente cai em ${esc(nome)}.</span>`}
      ${previa.itens.length ? `<div class="prox-total"><span class="muted">${esc(C.plural(previa.total_itens, 'lançamento previsto', 'lançamentos previstos'))}</span><b>${esc(CC.money(previa.total_valor))}</b></div>` : ''}
      <span class="prox-nota">Os lançamentos entram como "A pagar" no dia de cada modelo. A geração é sempre por mês e não duplica.</span></aside>`;
  }

  // Rotulo e estado do botao principal, pelo que a previa do mes atual mostra.
  function botaoGerar(previa) {
    const nome = C.nomeMes(previa.mes);
    if (previa.itens.length) return `<button type="button" class="btn btn-p" data-gerar>${D.ic('lightning')}Gerar lançamentos de ${esc(nome)}</button>`;
    const feitos = previa.gerados.length;
    return `<button type="button" class="btn btn-s" disabled>${D.ic(feitos ? 'check-circle' : 'lightning')}${feitos ? `${esc(C.maiuscula(nome))} já gerado · ${esc(C.plural(feitos, 'lançamento', 'lançamentos'))}` : `Sem lançamentos para ${esc(nome)}`}</button>`;
  }

  async function render(el, rota, vivo) {
    const mes = CC.month();
    const seguinte = C.somarMes(mes, 1);
    el.innerHTML = `<div class="pagina">${U.cabecalho({ grupo: 'Cadastros', titulo: 'Recorrentes', sub: 'Modelos que viram lançamentos todo mês, com frequência, dia e parcelas' })}
      <div data-corpo>${U.carregando('Carregando os recorrentes…')}</div></div>`;
    const recarregar = () => render(el, rota, vivo);
    const [{ data: lista }, { data: atual }, { data: proxima }] = await Promise.all([
      CC.api('/recorrentes'), CC.api(`/recorrentes/previa?mes=${mes}`), CC.api(`/recorrentes/previa?mes=${seguinte}`),
    ]);
    if (!vivo()) return;
    const modelos = Array.isArray(lista) ? lista : [];
    const ativos = modelos.filter((m) => m.ativo).length;
    CC.$('.cab .acoes', el).innerHTML = C.pode() ? `<button type="button" class="btn btn-s" data-novo>${D.ic('plus')}Novo recorrente</button>${botaoGerar(atual)}` : '';
    CC.$('[data-corpo]', el).innerHTML = `<div class="rec-grade"><div class="card cad-tabela">${U.tabela({
      colunas: [{ rotulo: 'Modelo' }, { rotulo: 'Frequência' }, { rotulo: 'Parcelas' }, { rotulo: 'Valor', num: true }, { rotulo: 'Status' }, { rotulo: '' }],
      linhas: modelos.map(linha), vazio: 'Nenhum recorrente cadastrado ainda.',
    })}<div class="cad-rodape"><span>${esc(`${ativos} ativos de ${C.plural(modelos.length, 'modelo', 'modelos')}`)}</span></div></div>${proximas(proxima)}</div>`;

    const novo = CC.$('[data-novo]', el);
    if (novo) novo.addEventListener('click', () => C.recorrenteForm(null, recarregar));
    const gerar = CC.$('[data-gerar]', el);
    if (gerar) gerar.addEventListener('click', async () => {
      const feito = await C.gerarDialogo(atual);
      if (!feito) return;
      CC.toast(`${C.plural(feito.gerados, 'lançamento gerado', 'lançamentos gerados')} em ${C.nomeMes(mes)}`);
      if (D.lanc && D.lanc.esquecerApoio) D.lanc.esquecerApoio();
      recarregar();
    });
    CC.$$('[data-editar]', el).forEach((b) => b.addEventListener('click', () => C.recorrenteForm(modelos.find((m) => String(m.id) === b.dataset.editar), recarregar)));
    CC.$$('[data-pausar]', el).forEach((b) => b.addEventListener('click', async () => {
      const m = modelos.find((x) => String(x.id) === b.dataset.pausar);
      b.disabled = true;
      try {
        await CC.api(`/recorrentes/${m.id}`, { method: 'PUT', body: { nome: m.nome, tipo: m.tipo, cost_center_id: m.cost_center_id, category_id: m.category_id, favorecido: m.favorecido || '',
          valor: Number(m.valor), dia_mes: m.dia_mes, frequencia: m.frequencia, total_parcelas: m.total_parcelas, forma_pagamento: m.forma_pagamento || '', ativo: !m.ativo } });
        CC.toast(m.ativo ? 'Recorrente pausado' : 'Recorrente reativado');
        recarregar();
      } catch (error) { CC.toast(error.message, 'warning-circle'); b.disabled = false; }
    }));
  }

  D.tela('recorrentes', { render });
})(window.CC);
