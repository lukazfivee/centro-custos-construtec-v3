// Fechamento mensal (D7, prints 70 a 75): numeros da competencia, lista dos meses do ano e a coluna
// do checklist. So quem tem p8 (administrador) abre a tela, fecha e reabre.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const U = D.ui;
  const F = D.fech = D.fech || {};

  const dois = (n) => String(n).padStart(2, '0');
  F.chave = (ano, mes) => `${ano}-${dois(mes)}`;
  F.nome = (ano, mes) => D.mesAno(F.chave(ano, mes)).toLowerCase(); // setembro de 2026
  F.mesNome = (ano, mes) => D.mesAno(F.chave(ano, mes)).split(' de ')[0]; // Setembro
  const quando = (iso) => new Date(iso).toLocaleDateString('pt-BR'); // horario local, nao UTC
  const dinheiro = (mes, valor) => (mes.lancamentos ? esc(CC.money(valor)) : '<span class="muted">—</span>');

  // Mes que abre selecionado: o atual, ou o anterior se ainda for comeco de mes e ele nao foi fechado.
  function escolher(meses, ano, hoje) {
    const [anoHoje, mesHoje] = hoje.split('-').map(Number);
    if (ano !== anoHoje) return (meses.filter((m) => m.lancamentos).pop() || meses[11]).mes;
    const anterior = meses[mesHoje - 2];
    return Number(CC.today().slice(8, 10)) <= 10 && anterior && !anterior.fechado && anterior.lancamentos ? anterior.mes : mesHoje;
  }

  // Aberto/atual primeiro, depois os anteriores do mais novo ao mais antigo, e por fim os futuros.
  function ordenar(meses, ano, hoje) {
    const [anoHoje, mesHoje] = hoje.split('-').map(Number);
    const posicao = (m) => (ano < anoHoje || (ano === anoHoje && m.mes < mesHoje) ? 1 : (ano === anoHoje && m.mes === mesHoje ? 0 : 2));
    return [...meses].sort((a, b) => posicao(a) - posicao(b) || (posicao(a) === 2 ? a.mes - b.mes : b.mes - a.mes));
  }

  function situacao(m, futuro) {
    if (m.fechado) return U.chip('Fechado', 'neutro', 'lock-simple');
    return futuro ? U.chip('Futuro', 'neutro', 'clock') : U.chip('Aberto', 'info', 'lock-simple-open');
  }

  function subtitulo(m, atual) {
    if (m.fechado) {
      const pend = m.pendencias.length ? `<span class="pend">${esc(F.plural(m.pendencias.length, 'pendência registrada', 'pendências registradas'))}</span>` : '';
      return `<span>${esc(`Por ${m.fechado_por} em ${quando(m.fechado_em)}`)}</span>${pend}${reaberto(m)}`;
    }
    return `<span>${esc(`${atual ? 'Competência atual · ' : ''}${F.plural(m.lancamentos, 'lançamento', 'lançamentos')}`)}</span>${reaberto(m)}`;
  }
  const reaberto = (m) => (m.reaberto ? `<span class="reab">${esc(`Reaberto em ${quando(m.reaberto.em)}${m.reaberto.motivo ? `: ${m.reaberto.motivo}` : ''}`)}</span>` : '');

  function linha(m, ctx) {
    const futuro = ctx.ano > ctx.anoHoje || (ctx.ano === ctx.anoHoje && m.mes > ctx.mesHoje);
    const atual = ctx.ano === ctx.anoHoje && m.mes === ctx.mesHoje;
    let acao = '';
    if (m.fechado) acao = `<button type="button" class="btn btn-g" data-reabrir="${m.mes}">${D.ic('lock-simple-open')}Reabrir</button>`;
    else if (!futuro) acao = `<button type="button" class="btn btn-g" data-fechar="${m.mes}">${D.ic('lock-simple')}Fechar</button>`;
    return {
      id: m.mes, clicavel: true,
      celulas: [`<div class="dois-tx"><b>${esc(F.mesNome(ctx.ano, m.mes))}</b>${subtitulo(m, atual)}</div>`, situacao(m, futuro),
        dinheiro(m, m.receitas), dinheiro(m, m.despesas), m.lancamentos ? `<b>${esc(CC.money(m.resultado))}</b>` : '<span class="muted">—</span>', `<span class="acoes-fech">${acao}</span>`],
    };
  }

  const COLUNAS = [{ rotulo: 'Mês' }, { rotulo: 'Situação' }, { rotulo: 'Receitas', num: true }, { rotulo: 'Despesas', num: true }, { rotulo: 'Resultado', num: true }, { rotulo: 'Ações', num: true }];

  function kpis(m) {
    const nome = F.mesNome(m.ano, m.mes).toLowerCase();
    return [
      U.kpi({ rotulo: `Receitas de ${nome}`, valor: CC.money(m.receitas), det: `competência ${dois(m.mes)}/${m.ano}`, icone: 'arrow-down-left', tom: 'ok' }),
      U.kpi({ rotulo: `Despesas de ${nome}`, valor: CC.money(m.despesas), det: F.plural(m.lancamentos, 'lançamento', 'lançamentos'), icone: 'arrow-up-right', tom: 'saida' }),
      U.kpi({ rotulo: 'Resultado', valor: CC.money(m.resultado), det: 'receitas − despesas', icone: 'scales', tom: 'info', tomValor: m.resultado >= 0 ? 'ok' : 'err' }),
      U.kpi({ rotulo: 'Em aberto', valor: String(m.em_aberto), det: m.em_aberto ? `${CC.money(m.valor_em_aberto)} a pagar ou a receber · seguem no caixa` : 'nada a pagar ou a receber', icone: 'hourglass', tom: 'warn' }),
    ].join('');
  }

  async function render(el, rota, vivo) {
    if (!D.pode('fechamento')) return D.telaEmConstrucao(el, rota, vivo);
    const hoje = CC.month();
    const [anoHoje, mesHoje] = hoje.split('-').map(Number);
    let ano = Number(rota.query.ano) || anoHoje;
    let selecionado = 0;
    el.innerHTML = `<div class="pagina fechamento">${U.cabecalho({ grupo: 'Ferramentas', titulo: 'Fechamento mensal', sub: 'Competência fechada fica bloqueada: ninguém edita, exclui ou estorna lançamentos daquele mês' })}
      <div data-corpo>${U.carregando('Carregando as competências…')}</div></div>`;
    const corpo = CC.$('[data-corpo]', el);
    const acoes = CC.$('.cab .acoes', el);

    const carregar = async (escolhido) => {
      let meses;
      try { meses = (await CC.api(`/fechamento-mensal/resumo?ano=${ano}`)).data.meses; } catch (error) {
        if (vivo()) corpo.innerHTML = U.faixa('err', error.status === 0 ? 'wifi-slash' : 'warning-circle', error.status === 0 ? 'Sem internet. O fechamento precisa da conexão.' : error.message);
        return;
      }
      if (!vivo()) return;
      selecionado = escolhido || selecionado || escolher(meses, ano, hoje);
      pintar(meses);
    };

    const concluir = async (texto) => {
      CC.toast(texto);
      if (D.lanc && D.lanc.esquecerApoio) D.lanc.esquecerApoio();
      await carregar();
    };
    const executar = async (botao, tarefa) => {
      botao.disabled = true;
      try { await tarefa(); } catch (error) { CC.toast(error.status === 0 ? 'Sem internet. Esta ação precisa da conexão.' : error.message, 'warning-circle'); }
      if (botao.isConnected) botao.disabled = false;
    };
    const fechar = (mes) => F.fechar(ano, mes).then((feito) => feito && concluir(`${F.mesNome(ano, mes)} de ${ano} fechado`));
    const reabrir = (m) => F.dialogoReabrir(ano, m.mes, m.fechamento_id).then((feito) => feito && concluir(`${F.mesNome(ano, m.mes)} de ${ano} reaberto`));

    function pintar(meses) {
      const m = meses[selecionado - 1];
      const anos = [anoHoje - 2, anoHoje - 1, anoHoje].map((a) => `<option value="${a}"${a === ano ? ' selected' : ''}>${a}</option>`).join('');
      const futuro = ano > anoHoje || (ano === anoHoje && m.mes > mesHoje);
      let destaque = '';
      if (m.fechado) destaque = `<span class="selo-fechado">${D.ic('lock-simple')}${esc(`${F.mesNome(ano, m.mes)} fechado · por ${m.fechado_por} em ${quando(m.fechado_em)}`)}</span>`;
      else if (!futuro) destaque = `<button type="button" class="btn btn-p" data-fechar="${m.mes}">${D.ic('lock-simple')}Fechar ${esc(F.nome(ano, m.mes))}</button>`;
      acoes.innerHTML = `<select class="inp" data-ano aria-label="Ano" style="width:100px">${anos}</select>${destaque}`;
      const fechados = meses.filter((x) => x.fechado).length;
      const aberto = ano === anoHoje ? `${F.mesNome(ano, mesHoje).toLowerCase()} aberto` : 'ano anterior';
      corpo.innerHTML = `<div class="fech-kpis">${kpis(m)}</div>
        <div class="fech-grade"><div class="card tabela fech-tabela"><div class="fech-topo"><b>Competências de ${ano}</b><span class="muted">${esc(`${fechados} fechados · ${aberto}`)}</span></div>
          ${U.tabela({ colunas: COLUNAS, linhas: ordenar(meses, ano, hoje).map((x) => linha(x, { ano, anoHoje, mesHoje })) })}</div>
          <aside class="card fech-lado" data-lado aria-label="Checklist do fechamento"></aside></div>`;
      const sel = CC.$(`tr.rw[data-id="${selecionado}"]`, corpo);
      if (sel) { sel.classList.add('sel'); sel.setAttribute('aria-current', 'true'); }
      const lado = CC.$('[data-lado]', corpo);
      if (m.fechado) F.painelRegistrado(lado, m);
      else if (futuro) lado.innerHTML = `<div class="topo"><b>Competência futura</b></div>${U.vazio('clock', 'Ainda não dá para fechar', 'O checklist aparece quando o mês começar.')}`;
      else F.painelChecklist(lado, ano, m.mes, vivo);

      CC.$('[data-ano]', acoes).addEventListener('change', (event) => { ano = Number(event.target.value); selecionado = 0; carregar(); });
      CC.$$('[data-fechar]', acoes).forEach((b) => b.addEventListener('click', () => executar(b, () => fechar(m.mes))));
      CC.$$('tr.rw', corpo).forEach((tr) => tr.addEventListener('click', (event) => {
        const alvo = Number(tr.dataset.id);
        const bf = event.target.closest('[data-fechar]');
        const br = event.target.closest('[data-reabrir]');
        if (bf) executar(bf, () => fechar(alvo));
        else if (br) executar(br, () => reabrir(meses[alvo - 1]));
        else if (alvo !== selecionado) { selecionado = alvo; pintar(meses); }
      }));
      CC.$$('tr.rw', corpo).forEach((tr) => tr.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && event.target === tr && Number(tr.dataset.id) !== selecionado) { selecionado = Number(tr.dataset.id); pintar(meses); }
      }));
    }
    await carregar(rota.query.mes ? Number(rota.query.mes) : 0);
    return undefined;
  }

  D.tela('fechamento', { render });
})(window.CC);
