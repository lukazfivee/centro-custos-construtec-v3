// Detalhe do servico em pagina propria (#/servicos/12): topo com situacao e acoes, resumo e blocos.
// A obra continua em #/obras/12; um servico aberto por #/obras/12 vem para ca.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const U = D.ui;
  const S = D.serv = D.serv || {};
  const B = S.blocos;
  let recarregarAtual = null;
  // Ultimo servico aberto: sem internet, a tela continua com ele (e com as despesas na fila).
  const ultimos = new Map();

  function topo(sv, fila) {
    const meta = [sv.cliente, sv.local, D.data(sv.data), sv.responsavel ? `Resp. ${sv.responsavel}` : ''].filter(Boolean).join(' · ');
    const aberto = sv.situacao !== 'faturado';
    let proximo = '';
    if (sv.situacao === 'agendado' && D.tem('p2')) proximo = `<button type="button" class="btn btn-s" data-iniciar>${D.ic('play')}Iniciar serviço</button>`;
    else if (sv.situacao === 'em_andamento' && D.tem('p2')) proximo = `<button type="button" class="btn btn-s" data-concluir>${D.ic('check-circle')}Concluir</button>`;
    else if (sv.situacao === 'concluido' && D.tem('p6')) proximo = `<button type="button" class="btn btn-s" data-faturar>${D.ic('receipt')}Faturar · cobrança</button>`;
    return `<a class="voltar" href="#/obras">${D.ic('arrow-left')}Obras e serviços</a>
      <div class="tit-sv"><span class="eyebrow">${esc(sv.codigo)} · Serviço</span><h1>${esc(sv.nome)}</h1>${meta ? `<span class="sub">${esc(meta)}</span>` : ''}</div>
      <div class="acoes-sv">${S.chip(sv.situacao)}${sv.ativo === false ? U.chip('Inativo', 'neutro') : ''}${fila.length ? U.chip(`Na fila · ${fila.length}`, 'warn', 'cloud-arrow-up') : ''}<span class="espaco"></span>
        ${D.tem('p5') && aberto ? `<button type="button" class="btn btn-s" data-editar>${D.ic('pencil-simple')}Editar</button>` : ''}
        <button type="button" class="btn btn-s" data-relatorio>${D.ic('file-text')}Relatório do serviço</button>${proximo}
        ${D.tem('p2') && aberto ? `<button type="button" class="btn btn-p" data-lancar>${D.ic('plus')}Lançar despesa</button>` : ''}</div>`;
  }

  function erroAbrir(el, error, tentar) {
    const semRede = error.status === 0;
    const titulo = semRede ? 'Não deu para abrir o serviço' : (error.status === 404 ? 'Serviço não encontrado' : 'Não foi possível abrir o serviço');
    const texto = semRede ? 'O computador está sem internet. Os lançamentos feitos no celular continuam guardados e aparecem quando a conexão voltar.' : error.message;
    el.innerHTML = `<div class="pagina servico"><a class="voltar" href="#/obras">${D.ic('arrow-left')}Obras e serviços</a>
      <div class="card erro-sv"><span class="ic-erro">${D.ic(semRede ? 'cloud-slash' : 'warning-circle', 30)}</span><b>${esc(titulo)}</b><span class="muted">${esc(texto)}</span>
      <div class="bts">${semRede ? `<button type="button" class="btn btn-p" data-tentar>${D.ic('arrow-clockwise')}Tentar de novo</button>` : ''}<a class="btn btn-s" href="#/obras">Voltar para Obras e serviços</a></div></div></div>`;
    const b = CC.$('[data-tentar]', el);
    if (b) b.addEventListener('click', tentar);
  }

  S.detalhe = async function (el, rota, vivo) {
    const id = rota.id;
    const recarregar = () => S.detalhe(el, rota, vivo);
    recarregarAtual = () => { if (vivo()) recarregar(); };
    el.innerHTML = `<div class="pagina servico">${B.esqueleto()}</div>`;
    let sv;
    let semRede = false;
    let error = null;
    try {
      ({ data: sv } = await CC.api(`/servicos/${encodeURIComponent(id)}`));
      ultimos.set(String(id), sv);
    } catch (e) {
      error = e;
      if (e.status === 0 && ultimos.has(String(id))) { sv = ultimos.get(String(id)); semRede = true; }
    }
    if (!vivo()) return;
    if (!sv) {
      // Virou obra: abre como obra.
      if (error.status === 404 && /não é um serviço/i.test(error.message)) { D.ir(`obras/${id}`); return; }
      erroAbrir(el, error, recarregar);
      return;
    }
    const fila = await S.naFila(sv.id);
    if (!vivo()) return;
    el.innerHTML = `<div class="pagina servico">${topo(sv, fila)}
      ${semRede ? U.faixa('warn', 'cloud-slash', 'Sem internet. Você está vendo o que foi carregado antes; as despesas na fila sobem quando a conexão voltar.', `<button type="button" class="btn btn-s" data-tentar>${D.ic('arrow-clockwise')}Atualizar</button>`) : ''}
      <div class="grade-sv"><div class="principal">${B.kpis(sv, fila)}${B.porTipo(sv)}${B.lancamentos(sv, fila)}${B.anexos(sv)}</div>
        <div class="lado">${B.feito(sv)}${B.fotos(sv)}${B.aceite(sv)}${B.cobranca(sv)}</div></div></div>`;
    ligar(el, sv, recarregar);
    if (D.tem('p2')) S.guardarCategorias();
    carregarImagens(el, vivo);
  };

  function ligar(el, sv, recarregar) {
    const on = (sel, fn) => CC.$$(sel, el).forEach((b) => b.addEventListener('click', (ev) => fn(b, ev)));
    on('[data-lancar]', () => S.lancarDespesa(sv, recarregar));
    on('[data-tentar]', () => recarregar());
    on('[data-editar]', () => S.editar(sv, recarregar));
    on('[data-relatorio]', () => S.relatorio(sv));
    on('[data-iniciar]', (b) => S.iniciar(sv, b, recarregar));
    on('[data-concluir]', () => S.concluir(sv, recarregar));
    on('[data-faturar]', () => S.faturar(sv, recarregar));
    on('[data-lanc]', (b) => D.ir(`lancamentos?id=${b.dataset.lanc}`));
    CC.$$('[data-lanc]', el).forEach((tr) => tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') D.ir(`lancamentos?id=${tr.dataset.lanc}`); }));
    on('[data-ck]', async (b) => {
      const feito = b.getAttribute('aria-checked') !== 'true';
      b.disabled = true;
      try {
        await CC.api(`/servicos/${sv.id}/checklist/${encodeURIComponent(b.dataset.ck)}`, { method: 'PATCH', body: { feito } });
        recarregar();
      } catch (error) { b.disabled = false; CC.toast(S.erro(error, 'O checklist não mudou.'), 'warning'); }
    });
    const novo = CC.$('[data-ck-novo]', el);
    if (novo) novo.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const texto = novo.ck.value.trim();
      if (!texto) return;
      const voltar = U.ocupar(CC.$('button', novo), 'Incluindo…');
      try {
        await CC.api(`/servicos/${sv.id}/checklist`, { method: 'PUT', body: { itens: [...(sv.checklist || []), { texto, feito: false }] } });
        recarregar();
      } catch (error) { voltar(); CC.toast(S.erro(error, 'O item não foi incluído.'), 'warning'); }
    });
    CC.$$('[data-add-foto]', el).forEach((inp) => inp.addEventListener('change', async () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) { CC.toast('A foto passa de 8 MB. Escolha uma menor.', 'warning'); return; }
      CC.toast('Enviando a foto…', 'cloud-arrow-up');
      try {
        await CC.api(`/servicos/${sv.id}/fotos`, { method: 'POST', body: { fase: inp.dataset.addFoto, nome: file.name, tipo: file.type || undefined, conteudoBase64: await S.base64(file) } });
        CC.toast('Foto incluída');
        recarregar();
      } catch (error) { CC.toast(S.erro(error, 'A foto não foi enviada.'), 'warning'); }
    }));
  }

  // Fotos e assinatura vem com o token (fetch + URL de blob).
  function carregarImagens(el, vivo) {
    const pendentes = [...CC.$$('[data-url]', el).map((f) => [f, f.dataset.url]), ...CC.$$('[data-assinatura]', el).map((f) => [f, f.dataset.assinatura])];
    pendentes.forEach(async ([alvo, url]) => {
      try {
        const blob = await (await S.baixar(url)).blob();
        if (!vivo() || !alvo.isConnected) return;
        const img = document.createElement('img');
        img.alt = alvo.dataset.assinatura ? 'Assinatura do cliente' : 'Foto do serviço';
        img.src = URL.createObjectURL(blob);
        alvo.prepend(img);
      } catch (e) { alvo.classList.add('sem-img'); }
    });
  }

  // A fila deste computador mandou as despesas: atualiza o servico aberto.
  const anterior = CC.onQueueSent;
  CC.onQueueSent = (...a) => {
    if (typeof anterior === 'function') anterior(...a);
    if (D.lerRota().nome === 'servicos' && recarregarAtual) recarregarAtual();
  };

  D.tela('servicos', {
    render: (el, rota, vivo) => {
      if (rota.id) return S.detalhe(el, rota, vivo);
      D.ir('obras');
      return undefined;
    },
  });
})(window.CC);
