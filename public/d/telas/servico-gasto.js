// Painel Lancar despesa do servico (28Dn a 28Ds): atalhos, valor, descricao e foto do recibo.
// Com internet: POST /api/servicos/:id/gastos (client_id torna o reenvio seguro).
// Sem internet: a despesa entra na fila deste computador (public/m/queue.js), como o lancamento do /d/,
// com a categoria escolhida pelo tipo (mesma regra do servidor) e o recibo como anexo.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const U = D.ui;
  const S = D.serv = D.serv || {};
  const LIMITE = 8 * 1024 * 1024;
  const CATEGORIA = { deslocamento: ['transporte'], combustivel: ['transporte'], material: ['material'], mao_de_obra: ['servicos terceirizados', 'mao de obra'], outros: ['outros'] };
  const normal = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  // Categoria de despesa pelo tipo (Transporte, Material, Servicos terceirizados, Outros; senao a primeira ativa).
  async function categoriaDoTipo(tipo) {
    const { data } = await CC.cached('categorias', '/categorias');
    const ativas = (Array.isArray(data) ? data : []).filter((c) => c.ativo !== false && (c.tipo === 'despesa' || c.tipo === 'ambos'));
    const nomes = CATEGORIA[tipo] || CATEGORIA.outros;
    const achada = ativas.find((c) => nomes.includes(normal(c.nome)));
    return achada || ativas[0] || null;
  }

  function formulario(e) {
    return `<form class="form-lanc form-gasto" novalidate>
      <div class="fld"><span>Tipo de gasto</span><div class="atalhos-sv" role="radiogroup" aria-label="Tipo de gasto">${S.ATALHOS.map((a) => `
        <button type="button" class="atalho" role="radio" data-atalho="${a.tipo}" aria-checked="${a.tipo === e.tipo ? 'true' : 'false'}">${D.ic(a.icone, 20)}<span>${esc(a.rotulo)}</span></button>`).join('')}</div></div>
      ${U.campo({ rotulo: 'Valor (R$)', name: 'valor', valor: e.valor, placeholder: '0,00' })}
      ${U.campo({ rotulo: 'Descrição', name: 'descricao', valor: e.descricao, placeholder: S.atalho(e.tipo).desc })}
      <div class="fld"><span>Foto do recibo</span>${e.foto
        ? `<div class="recibo-sv">${D.ic(e.foto.tipo === 'application/pdf' ? 'file-pdf' : 'image', 20)}<span class="duas-l"><b>${esc(e.foto.nome)}</b><span>${esc(`${Math.max(1, Math.round(e.foto.tamanho / 1024))} KB`)}</span></span><button type="button" class="btn btn-s" data-tirar-foto>Remover</button></div>`
        : `<label class="recibo-sv vazio">${D.ic('camera', 20)}<span class="duas-l"><b>Anexar foto do recibo</b><span>JPG, PNG, WEBP ou PDF até 8 MB (opcional)</span></span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" data-foto hidden></label>`}
        <span class="erro" role="alert"></span></div>
      ${CC.offline() ? U.faixa('warn', 'cloud-slash', 'Sem internet. A despesa fica na fila deste computador e sobe sozinha quando a conexão voltar.') : ''}
    </form>`;
  }

  // Guarda as categorias neste computador enquanto ha internet (para a fila funcionar sem ela).
  S.guardarCategorias = () => { if (!CC.offline()) CC.cached('categorias', '/categorias').catch(() => {}); };

  S.lancarDespesa = async function (sv, aoLancar) {
    S.guardarCategorias();
    const e = { tipo: 'deslocamento', valor: '', descricao: '', foto: null, clientId: CC.uuid() };
    let enviando = false;
    const rotulo = () => { const v = CC.parseMoney(e.valor); return v > 0 ? `Lançar ${CC.money(v)}` : 'Lançar despesa'; };
    const ler = (corpo) => { e.valor = CC.$('[name="valor"]', corpo).value; e.descricao = CC.$('[name="descricao"]', corpo).value; };
    const pintarBotao = (ctl) => { const b = CC.$('[data-salvar]', ctl.rodape); if (b && !enviando) b.innerHTML = `${D.ic('plus')}${esc(rotulo())}`; };
    const desenhar = (ctl) => {
      ctl.desenhar(formulario(e));
      const corpo = ctl.corpo;
      CC.$$('[data-atalho]', corpo).forEach((b) => b.addEventListener('click', () => { ler(corpo); e.tipo = b.dataset.atalho; ctl.sujo = true; desenhar(ctl); }));
      CC.$('[name="valor"]', corpo).addEventListener('input', (ev) => { e.valor = ev.target.value; pintarBotao(ctl); });
      const foto = CC.$('[data-foto]', corpo);
      if (foto) foto.addEventListener('change', async () => {
        const f = foto.files && foto.files[0];
        if (!f) return;
        ler(corpo);
        if (f.size > LIMITE) { ctl.erro('O recibo passa de 8 MB. Escolha um arquivo menor.'); return; }
        try { e.foto = { nome: f.name, tipo: f.type || 'image/jpeg', tamanho: f.size, conteudoBase64: await S.base64(f) }; } catch (err) { ctl.erro('Não foi possível ler o arquivo. Tente outro.'); return; }
        ctl.sujo = true;
        desenhar(ctl);
      });
      const tirar = CC.$('[data-tirar-foto]', corpo);
      if (tirar) tirar.addEventListener('click', () => { ler(corpo); e.foto = null; desenhar(ctl); });
      CC.$('form', corpo).addEventListener('submit', (ev) => { ev.preventDefault(); salvar(ctl); });
      pintarBotao(ctl);
    };

    async function paraFila(valor, descricao) {
      if (!CC.queue) throw Object.assign(new Error('Sem internet. Tente de novo quando a conexão voltar.'), { status: 0 });
      const cat = await categoriaDoTipo(e.tipo).catch(() => null);
      if (!cat) throw Object.assign(new Error('Sem internet e sem as categorias guardadas neste computador. Tente de novo quando a conexão voltar.'), { status: -1 });
      const hoje = CC.today();
      await CC.queue.add({
        client_id: e.clientId,
        servico: { id: sv.id, tipo: e.tipo },
        payload: { tipo: 'despesa', descricao, valor, cost_center_id: Number(sv.id), category_id: Number(cat.id), data: hoje, vencimento: hoje, status_financeiro: 'liquidado', data_liquidacao: hoje },
        foto: e.foto ? { nome: e.foto.nome, tipo: e.foto.tipo, categoria: 'recibo', observacao: 'Recibo do serviço', conteudoBase64: e.foto.conteudoBase64 } : null,
      });
    }

    async function salvar(ctl) {
      if (enviando) return;
      ler(ctl.corpo);
      const valor = CC.parseMoney(e.valor);
      const erros = {};
      if (!(valor > 0)) erros.valor = 'Informe um valor maior que zero.';
      ctl.errosCampos(erros);
      if (Object.keys(erros).length) { ctl.erro('Digite o valor da despesa.'); return; }
      ctl.erro('');
      enviando = true;
      const voltar = U.ocupar(CC.$('[data-salvar]', ctl.rodape), 'Lançando…');
      const descricao = e.descricao.trim() || S.atalho(e.tipo).desc;
      let naFila = false;
      try {
        if (CC.offline()) { await paraFila(valor, descricao); naFila = true; } else {
          try {
            await CC.api(`/servicos/${sv.id}/gastos`, { method: 'POST', body: { tipo: e.tipo, valor, descricao, client_id: e.clientId, recibo: e.foto ? { nome: e.foto.nome, tipo: e.foto.tipo, conteudoBase64: e.foto.conteudoBase64 } : undefined } });
          } catch (error) {
            if (error.status !== 0) throw error;
            await paraFila(valor, descricao);
            naFila = true;
          }
        }
        ctl.marcarSalvo();
        ctl.fechar(true);
        CC.toast(naFila ? 'Sem internet · despesa salva na fila, sobe sozinha' : `Despesa lançada · ${S.atalho(e.tipo).rotulo} ${CC.money(valor)}`, naFila ? 'cloud-arrow-up' : 'check-circle');
        if (aoLancar) aoLancar();
      } catch (error) {
        ctl.erro(`A despesa não foi lançada. O valor e a foto continuam aqui; tente de novo.${error.message ? ` ${error.message}` : ''}`);
        enviando = false;
        voltar();
        pintarBotao(ctl);
      } finally {
        enviando = false;
      }
    }

    const ctl = await D.painel.abrir({
      icone: 'receipt', titulo: 'Lançar despesa', sub: [sv.codigo, sv.nome].filter(Boolean).join(' · '),
      corpo: (_, c) => desenhar(c),
      rodape: `<button type="button" class="btn btn-s" data-fechar>Cancelar</button><button type="button" class="btn btn-p" data-salvar>${D.ic('plus')}Lançar despesa</button>`,
    });
    if (!ctl) return;
    pintarBotao(ctl);
    CC.$('[data-salvar]', ctl.rodape).addEventListener('click', () => salvar(ctl));
  };
})(window.CC);
