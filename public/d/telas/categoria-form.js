// Nova e editar categoria no painel lateral (prints 51 e 52): nome, tipo, descricao, cor e ativa.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const C = D.cad;
  const U = D.ui;
  // Mesma paleta que o servidor aceita (routes/categories.js).
  const CORES = ['#12a9d1', '#0b4a5c', '#e0a33a', '#8a5cd0', '#c2692a', '#1d7a4f', '#5d7480'];
  const TIPOS = [{ valor: 'despesa', rotulo: 'Despesa' }, { valor: 'receita', rotulo: 'Receita' }, { valor: 'ambos', rotulo: 'Receita e despesa' }];

  function campos(cat) {
    const cor = cat.cor || (cat.id ? '' : CORES[0]);
    return `<form class="form-lanc" novalidate>
      ${U.campo({ rotulo: 'Nome da categoria', name: 'nome', valor: cat.nome, placeholder: 'Ex.: Licenças de software' })}
      <div class="fld"><span>Tipo padrão</span>${U.seg('tipo', TIPOS, cat.tipo || 'despesa', 'Tipo padrão')}</div>
      ${U.campo({ rotulo: 'Descrição · opcional', name: 'descricao', tipo: 'textarea', valor: cat.descricao, placeholder: 'Ex.: Softwares de gestão de vídeo e de alarme' })}
      <div class="fld"><span>Cor no painel</span><div class="paleta" role="group" aria-label="Cor no painel">${CORES.map((c) =>
        `<button type="button" data-cor="${c}" style="background:${c};--cor-atual:${c}" aria-label="Cor ${c}" aria-pressed="${c === cor ? 'true' : 'false'}"></button>`).join('')}</div></div>
      ${C.troca({ titulo: 'Categoria ativa', texto: 'Inativa não aparece em lançamentos novos; os antigos ficam como estão.', ligado: cat.ativo !== false })}
      ${cat.id && Number(cat.lancamentos_mes) ? U.faixa('info', 'info', `${C.plural(Number(cat.lancamentos_mes), 'lançamento deste mês usa', 'lançamentos deste mês usam')} esta categoria.`) : ''}
    </form>`;
  }

  // cat: linha da lista (null para nova). aoSalvar: recarrega a lista.
  C.categoriaForm = async function (cat, aoSalvar) {
    const c = cat || {};
    let enviando = false;
    const ctl = await D.painel.abrir({
      icone: 'tag', titulo: cat ? 'Editar categoria' : 'Nova categoria', sub: cat ? cat.nome : 'Usada para agrupar lançamentos e no painel',
      corpo: campos(c),
      rodape: `<button type="button" class="btn btn-s" data-fechar>Cancelar</button><button type="button" class="btn btn-p" data-salvar>${D.ic('check')}${cat ? 'Salvar alterações' : 'Cadastrar'}</button>`,
    });
    if (!ctl) return;
    const ativa = C.ligarTroca(ctl.corpo, ctl);
    let cor = c.cor || (cat ? null : CORES[0]);
    CC.$$('[data-cor]', ctl.corpo).forEach((b) => b.addEventListener('click', () => {
      cor = b.dataset.cor;
      CC.$$('[data-cor]', ctl.corpo).forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      ctl.sujo = true;
    }));
    CC.$$('[data-seg="tipo"]', ctl.corpo).forEach((b) => b.addEventListener('click', () => { U.segEscolher(b.parentElement, b); ctl.sujo = true; }));

    const salvar = async () => {
      if (enviando) return;
      const nome = CC.$('[name="nome"]', ctl.corpo).value.trim();
      const tipoBtn = CC.$('[data-seg="tipo"][aria-pressed="true"]', ctl.corpo);
      ctl.errosCampos(nome ? {} : { nome: 'Informe o nome da categoria.' });
      if (!nome) { ctl.erro('Informe o nome da categoria.'); return; }
      ctl.erro('');
      enviando = true;
      const body = { nome, tipo: tipoBtn ? tipoBtn.dataset.valor : 'despesa', descricao: CC.$('[name="descricao"]', ctl.corpo).value.trim(), cor, ativo: ativa() };
      try {
        if (cat) await CC.api(`/categorias/${cat.id}`, { method: 'PUT', body });
        else await CC.api('/categorias', { method: 'POST', body });
        ctl.marcarSalvo();
        ctl.fechar(true);
        CC.toast(cat ? 'Categoria atualizada' : 'Categoria cadastrada');
        if (D.lanc && D.lanc.esquecerApoio) D.lanc.esquecerApoio();
        if (aoSalvar) aoSalvar();
      } catch (error) {
        C.mostrarErro(ctl, error, (texto) => (/nome/.test(texto) ? 'nome' : ''));
      } finally {
        enviando = false;
      }
    };
    CC.$('[data-salvar]', ctl.rodape).addEventListener('click', salvar);
    CC.$('form', ctl.corpo).addEventListener('submit', (e) => { e.preventDefault(); salvar(); });
  };
})(window.CC);
