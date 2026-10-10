// Detalhe de um lancamento: dados, documentos e acoes (marcar como pago, editar, estornar, excluir).
// Mesmas rotas e regras do desktop (public/d/telas/lancamento-*.js); o servidor confere tudo de novo.
(function (CC) {
  const { esc, icon, money } = CC;
  const FORMAS = ['Pix', 'Boleto', 'Transferência', 'Cartão', 'Dinheiro', 'Outro'];
  let fech = null, fechEm = 0;

  CC.lanc = {
    FORMAS,
    // Meses fechados (GET /fechamento-mensal), guardados por um minuto.
    async fechamentos() {
      if (fech && Date.now() - fechEm < 60000) return fech;
      try { fech = (await CC.cached('fechamentos', '/fechamento-mensal')).data || []; fechEm = Date.now(); } catch { fech = fech || []; }
      return fech;
    },
    fechado(data) {
      if (!fech || !data) return null;
      const [a, m] = String(data).split('-').map(Number);
      return fech.find((f) => Number(f.year) === a && Number(f.month) === m) || null;
    },
    // Corpo do PUT a partir do lancamento como veio do servidor, com as mudancas por cima.
    corpo(l, mudar) {
      return {
        tipo: l.tipo, descricao: l.descricao, valor: Number(l.valor), cost_center_id: l.cost_center_id, category_id: l.category_id,
        favorecido: l.favorecido || '', data: l.data, vencimento: l.vencimento || l.data, status_financeiro: l.status_financeiro,
        data_liquidacao: l.data_liquidacao || '', forma_pagamento: l.forma_pagamento || '', documento: l.documento || '',
        observacao: l.observacao || '', revisao: Number(l.revision), ...(mudar || {}),
      };
    },
    mesAno: (data) => new Date(`${String(data).slice(0, 7)}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
  };

  const receita = (l) => l.tipo === 'receita';
  function situacao(l) {
    if (l.estorno_de) return 'Estorno';
    if (l.status_financeiro === 'liquidado') return `${receita(l) ? 'Recebido' : 'Pago'}${l.data_liquidacao ? ` em ${CC.dateFull(l.data_liquidacao)}` : ''}`;
    const base = l.situacao === 'vencido' ? 'Vencido' : (receita(l) ? 'A receber' : 'A pagar');
    return l.vencimento ? `${base} · vence ${CC.dateFull(l.vencimento)}` : base;
  }
  const soLeitura = (l) => !!(l.estorno_de || l.estornado || CC.lanc.fechado(l.data));
  const can = (p) => (CC.sv ? CC.sv.can(p) : false);

  function aviso(l) {
    const fe = CC.lanc.fechado(l.data);
    const txt = l.estorno_de ? 'Movimento de estorno: não pode ser editado nem excluído.'
      : (l.estornado ? 'Este lançamento foi estornado e fica no histórico, só para leitura.'
        : (fe ? `${CC.mesNome(String(l.data).slice(0, 7))} está fechado. O lançamento fica só para leitura; anexar documento continua liberado.` : ''));
    return txt ? `<div class="note off">${icon('lock-simple', 18)}<span>${esc(txt)}</span></div>` : '';
  }

  function dados(l) {
    const linha = (k, v) => (v ? `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>` : '');
    return `<div class="card">${linha('Situação', situacao(l))}${linha('Obra', [l.centro_codigo, l.centro_nome].filter(Boolean).join(' · '))}
      ${linha('Categoria', l.categoria)}${linha(receita(l) ? 'Cliente / pagador' : 'Fornecedor', l.favorecido)}
      ${linha('Competência', CC.dateFull(l.data))}${linha('Vencimento', CC.dateFull(l.vencimento))}
      ${linha('Forma de pagamento', l.forma_pagamento)}${linha('Nota fiscal / documento', l.documento)}
      ${linha('Motivo do estorno', l.motivo_estorno)}${linha('Lançado por', l.criado_por_nome)}</div>
      ${l.observacao ? `<div class="card"><span class="label">Observação</span><p class="lanc-obs">${esc(l.observacao)}</p></div>` : ''}`;
  }

  CC.screens.lanc = async function (params) {
    const id = Number(params && params.id);
    const from = (params && params.from) || ['lancamentos'];
    const voltar = () => CC.go(from[0], from[1]);
    const el = CC.render(`<div class="top"><button class="back" type="button" id="voltar" aria-label="Voltar">${icon('caret-left', 20)}</button><h1>Lançamento</h1></div><div class="skeleton"></div>`, true);
    CC.$('#voltar', el).addEventListener('click', voltar);
    let result;
    try {
      [result] = await Promise.all([CC.cached(`lanc-${id}`, `/lancamentos/${id}`), CC.lanc.fechamentos(), CC.sv ? CC.sv.loadPerms() : null]);
    } catch (error) {
      if (error.status === 404) { CC.toast('Este lançamento não existe mais.', 'warning-circle'); return voltar(); }
      return CC.errorScreen(el, error, () => CC.screens.lanc(params));
    }
    const l = result.data;
    const valor = Number(l.valor) * Number(l.sinal_contabil || 1) * (receita(l) ? 1 : -1);
    const ro = soLeitura(l);
    const podePagar = !ro && can('p3') && l.status_financeiro === 'pendente';
    const podeEditar = !ro && can('p3');
    const podeEstornar = !ro && can('p4') && l.status_financeiro === 'liquidado' && (l.aprovacao || 'aprovado') === 'aprovado';
    const podeExcluir = !ro && can('p3');
    const mais = podeEditar || podeEstornar || podeExcluir;
    const page = CC.render(`<div class="top"><button class="back" type="button" id="voltar" aria-label="Voltar">${icon('caret-left', 20)}</button>
        <span class="grow"><h1>${esc(l.descricao)}</h1><small class="muted">${esc(receita(l) ? 'Receita' : 'Despesa')}</small></span>
        ${mais ? `<button class="back" type="button" id="lanc-mais" aria-label="Mais ações" aria-haspopup="dialog">${icon('dots-three', 22)}</button>` : ''}</div>
      ${CC.staleNote(result)}
      <div class="lanc-valor ${valor > 0 ? 'in' : ''}">${esc(CC.signed(valor))}</div>
      ${aviso(l)}${dados(l)}
      <div id="lanc-docs"></div>
      ${podePagar ? `<div class="actions"><button class="btn" type="button" id="pagar">${icon('check', 18)}${receita(l) ? 'Marcar como recebido' : 'Marcar como pago'}</button></div>` : ''}`, true, params);
    document.body.classList.add('no-tabs');
    CC.$('#voltar', page).addEventListener('click', voltar);
    const recarregar = () => CC.screens.lanc({ id, from });
    if (CC.lancDocs) CC.lancDocs(CC.$('#lanc-docs', page), l, recarregar);
    const pagar = CC.$('#pagar', page);
    if (pagar) pagar.addEventListener('click', () => pagarSheet(l, recarregar));
    const m = CC.$('#lanc-mais', page);
    if (m) m.addEventListener('click', () => menu(l, { podeEditar, podeEstornar, podeExcluir }, from, recarregar, voltar));
  };

  function menu(l, pode, from, recarregar, voltar) {
    const item = (id, ic, t, s, cls) => `<button type="button" class="suite-item om-item${cls ? ` ${cls}` : ''}" id="${id}">${icon(ic, 22)}<span><b>${esc(t)}</b><small>${esc(s)}</small></span></button>`;
    const sh = CC.sheet('lanc-menu', `${CC.sheetHead('receipt', l.descricao)}
      ${pode.podeEditar ? item('lm-edit', 'pencil-simple', 'Editar lançamento', 'Valor, datas, obra, categoria e situação') : ''}
      ${pode.podeEstornar ? item('lm-est', 'arrow-counter-clockwise', 'Estornar', 'Cria um movimento contrário e mantém o original') : ''}
      ${pode.podeExcluir ? item('lm-del', 'trash', 'Excluir lançamento', 'Sai da lista e dos totais; fica no histórico', 'danger') : ''}`);
    const on = (id, fn) => { const b = CC.$(`#${id}`, sh.el); if (b) b.addEventListener('click', fn); };
    on('lm-edit', () => { sh.close(); CC.go('lancar', { editar: l, from: ['lanc', { id: l.id, from }] }); });
    on('lm-est', () => estornarSheet(l, recarregar));
    on('lm-del', () => excluirSheet(l, voltar));
  }

  const err = (sh, error) => { const slot = CC.$('.lanc-err', sh.el); if (slot) slot.innerHTML = error ? CC.sheetErr(error) : ''; };

  function pagarSheet(l, recarregar) {
    const rec = receita(l);
    const sh = CC.sheet('lanc-menu', `${CC.sheetHead('check', rec ? 'Marcar como recebido' : 'Marcar como pago')}
      <p class="muted od-sub">${esc(l.descricao)} · ${esc(money(l.valor))}</p>
      <div class="grid2"><label class="field"><span>${rec ? 'Data do recebimento' : 'Data do pagamento'}</span><input id="lp-data" type="date" value="${esc(CC.today())}"></label>
        <label class="field"><span>Forma de pagamento</span><select id="lp-forma"><option value="">Escolha</option>${FORMAS.map((f) => `<option${l.forma_pagamento === f ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select></label></div>
      <div class="lanc-err"></div>
      <div class="grid2 od-acts"><button class="btn2" type="button" id="lp-cancel">Cancelar</button><button class="btn" type="button" id="lp-ok">${icon('check', 18)}Confirmar</button></div>`);
    CC.$('#lp-cancel', sh.el).addEventListener('click', sh.close);
    CC.$('#lp-ok', sh.el).addEventListener('click', async (e) => {
      const data = CC.$('#lp-data', sh.el).value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return err(sh, { message: 'Informe a data.' });
      const b = e.currentTarget;
      CC.busy(b, 'Salvando…');
      try {
        await CC.api(`/lancamentos/${l.id}`, { method: 'PUT', body: CC.lanc.corpo(l, { status_financeiro: 'liquidado', data_liquidacao: data, forma_pagamento: CC.$('#lp-forma', sh.el).value }) });
      } catch (error) { b.disabled = false; b.innerHTML = `${icon('check', 18)}Confirmar`; return err(sh, error); }
      sh.close();
      CC.toast(rec ? 'Marcado como recebido' : 'Marcado como pago');
      recarregar();
    });
  }

  function estornarSheet(l, recarregar) {
    const hoje = CC.today();
    const sh = CC.sheet('lanc-menu', `${CC.sheetHead('arrow-counter-clockwise', 'Estornar lançamento')}
      <p class="od-txt">O estorno cria um lançamento de sentido contrário e mantém o original, com vínculo entre os dois. O original deixa de ser editável.</p>
      <label class="field"><span>Data do estorno</span><input id="le-data" type="date" min="${esc(l.data)}" value="${esc(l.data > hoje ? l.data : hoje)}"></label>
      <label class="field" style="margin-top:12px"><span>Motivo</span><textarea id="le-motivo" maxlength="500" placeholder="Ex.: pagamento em duplicidade"></textarea></label>
      <div class="lanc-err"></div>
      <div class="grid2 od-acts"><button class="btn2" type="button" id="le-cancel">Cancelar</button><button class="btn" type="button" id="le-ok">${icon('arrow-counter-clockwise', 18)}Confirmar estorno</button></div>`);
    CC.$('#le-cancel', sh.el).addEventListener('click', sh.close);
    CC.$('#le-ok', sh.el).addEventListener('click', async (e) => {
      const data = CC.$('#le-data', sh.el).value, motivo = CC.$('#le-motivo', sh.el).value.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return err(sh, { message: 'Informe a data do estorno.' });
      if (data < l.data) return err(sh, { message: 'A data do estorno não pode ser anterior à do lançamento.' });
      if (motivo.length < 5) return err(sh, { message: 'Informe o motivo com pelo menos 5 caracteres.' });
      const b = e.currentTarget;
      CC.busy(b, 'Estornando…');
      try { await CC.api(`/lancamentos/${l.id}/estornar`, { method: 'POST', body: { motivo, data_estorno: data } }); } catch (error) {
        b.disabled = false; b.innerHTML = `${icon('arrow-counter-clockwise', 18)}Confirmar estorno`; return err(sh, error);
      }
      sh.close();
      CC.toast('Estorno registrado · o original ficou marcado como estornado');
      recarregar();
    });
  }

  function excluirSheet(l, voltar) {
    const sh = CC.sheet('lanc-menu', `${CC.sheetHead('trash', 'Excluir este lançamento?')}
      <p class="od-txt">"${esc(l.descricao)}" sai da lista e dos totais. A exclusão fica no histórico.</p>
      <div class="lanc-err"></div>
      <div class="grid2 od-acts"><button class="btn2" type="button" id="lx-cancel">Cancelar</button><button class="btn danger" type="button" id="lx-ok">${icon('trash', 18)}Excluir</button></div>`);
    CC.$('#lx-cancel', sh.el).addEventListener('click', sh.close);
    CC.$('#lx-ok', sh.el).addEventListener('click', async (e) => {
      const b = e.currentTarget;
      CC.busy(b, 'Excluindo…');
      try { await CC.api(`/lancamentos/${l.id}`, { method: 'DELETE' }); } catch (error) { b.disabled = false; b.innerHTML = `${icon('trash', 18)}Excluir`; return err(sh, error); }
      sh.close();
      CC.toast('Lançamento excluído');
      voltar();
    });
  }
})(window.CC = window.CC || {});
