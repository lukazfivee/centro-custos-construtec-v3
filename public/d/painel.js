// Painel lateral (drawer) de 500 px: substitui os modais de formulario.
// Fecha com Esc, com clique fora e no X; se houver alteracao nao salva, pergunta antes.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  let atual = null;

  function montar(o) {
    const abas = (o.abas || []).map((a) => `<button type="button" class="tab" role="tab" data-aba="${esc(a.id)}" aria-selected="${a.id === o.aba ? 'true' : 'false'}">${esc(a.rotulo)}</button>`).join('');
    return D.el(`<div class="camada">
      <button type="button" class="fundo" aria-label="Fechar painel" tabindex="-1"></button>
      <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drw-tit">
        <div class="dcab">
          <span class="dic">${D.ic(o.icone || 'note-pencil')}</span>
          <span class="dtit"><b id="drw-tit">${esc(o.titulo || '')}</b>${o.sub ? `<span>${esc(o.sub)}</span>` : ''}</span>
          <button type="button" class="ibtn" data-fechar aria-label="Fechar">${D.ic('x', 19)}</button>
        </div>
        ${abas ? `<div class="dabas" role="tablist">${abas}</div>` : ''}
        <div class="dcorpo"></div>
        <div class="drod"${o.rodape ? '' : ' hidden'}>${o.rodape || ''}</div>
      </aside></div>`);
  }

  // CC.d.painel.abrir({ icone, titulo, sub, abas, aba, corpo, rodape, aoTrocarAba, aoFechar })
  // corpo: HTML ou funcao (elemento do corpo, controle) que desenha o conteudo.
  async function abrir(o) {
    if (atual && !(await fecharSePuder())) return null;
    const anterior = document.activeElement;
    const raiz = montar(o || {});
    const corpo = CC.$('.dcorpo', raiz);
    const ctl = {
      raiz, corpo,
      rodape: CC.$('.drod', raiz),
      sujo: false,
      marcarSalvo() { ctl.sujo = false; },
      erro(mensagem) {
        ctl.limparErro();
        if (!mensagem) return;
        corpo.prepend(D.el(`<span class="derro" role="alert">${D.ic('warning-circle')}${esc(mensagem)}</span>`));
        corpo.scrollTop = 0;
      },
      limparErro() { CC.$$('.derro', corpo).forEach((e) => e.remove()); },
      // Marca os campos que o servidor recusou: { campo: 'mensagem' } usando name="campo".
      errosCampos(mapa) {
        CC.$$('.fld.tem-erro', corpo).forEach((f) => f.classList.remove('tem-erro'));
        Object.entries(mapa || {}).forEach(([campo, msg]) => {
          const input = CC.$(`[name="${CSS.escape(campo)}"]`, corpo);
          const fld = input && input.closest('.fld');
          if (!fld) return;
          fld.classList.add('tem-erro');
          const alvo = CC.$('.erro', fld);
          if (alvo) alvo.innerHTML = `${D.ic('warning-circle', 14)}${esc(msg)}`;
        });
      },
      // Troca icone, titulo e subtitulo (ex.: o formulario vira "Lancamento registrado").
      cabecalho({ icone, titulo, sub }) {
        if (icone) CC.$('.dic', raiz).innerHTML = D.ic(icone);
        if (titulo != null) CC.$('#drw-tit', raiz).textContent = titulo;
        const alvo = CC.$('.dtit', raiz);
        CC.$$('.dtit > span', raiz).forEach((e) => e.remove());
        if (sub) alvo.appendChild(D.el(`<span>${esc(sub)}</span>`));
      },
      botoes(html) {
        ctl.rodape.innerHTML = html || '';
        ctl.rodape.hidden = !html;
      },
      desenhar(conteudo) {
        corpo.innerHTML = '';
        if (typeof conteudo === 'function') conteudo(corpo, ctl);
        else corpo.innerHTML = conteudo || '';
      },
      fechar: (forcar) => (forcar ? fecharJa() : fecharSePuder()),
    };
    const teclas = (event) => {
      if (document.querySelector('.dialogo-camada')) return;
      if (event.key === 'Escape') { event.preventDefault(); fecharSePuder(); return; }
      D.prenderFoco(CC.$('.drawer', raiz), event);
    };
    raiz.addEventListener('input', () => { ctl.sujo = true; });
    raiz.addEventListener('change', () => { ctl.sujo = true; });
    raiz.addEventListener('click', (event) => {
      if (event.target.closest('.fundo') || event.target.closest('[data-fechar]')) { fecharSePuder(); return; }
      const aba = event.target.closest('[data-aba]');
      if (aba) {
        CC.$$('[data-aba]', raiz).forEach((b) => b.setAttribute('aria-selected', b === aba ? 'true' : 'false'));
        if (o.aoTrocarAba) o.aoTrocarAba(aba.dataset.aba, ctl);
      }
    });
    document.addEventListener('keydown', teclas, true);
    atual = { raiz, ctl, anterior, teclas, aoFechar: o.aoFechar };
    document.body.appendChild(raiz);
    ctl.desenhar(o.corpo);
    const primeiro = D.focaveis(corpo)[0] || CC.$('[data-fechar]', raiz);
    if (primeiro) primeiro.focus();
    return ctl;
  }

  function fecharJa() {
    if (!atual) return true;
    const { raiz, anterior, teclas, aoFechar } = atual;
    atual = null;
    document.removeEventListener('keydown', teclas, true);
    raiz.remove();
    if (aoFechar) aoFechar();
    if (anterior && anterior.isConnected && anterior.focus) anterior.focus();
    return true;
  }

  async function fecharSePuder() {
    if (!atual) return true;
    if (atual.ctl.sujo) {
      const sim = await D.confirmar({
        titulo: 'Descartar as alterações?',
        texto: 'O que você mudou neste painel ainda não foi salvo.',
        ok: 'Descartar', cancelar: 'Continuar editando', tom: 'aviso', icone: 'warning',
      });
      if (!sim) return false;
    }
    return fecharJa();
  }

  D.painel = { abrir, fecharSePuder, fecharJa, aberto: () => !!atual };

  // Sucesso: check, estouro e simbolo da Construtec (lancamento registrado, convite enviado, usuario criado).
  D.sucesso = function (titulo, texto) {
    const partes = [];
    for (let i = 0; i < 10; i += 1) {
      const big = i % 2 === 0;
      partes.push(`<span class="p ${big ? 'big' : 'small'}" style="--r:${i * 36}deg;--d:-${big ? 50 : 40}px"></span>`);
    }
    return `<div class="ok-tela" role="status"><span class="success" style="--s:72px"><span class="ring"></span>${partes.join('')}`
      + `<span class="check">${D.ic('check-circle-fill')}</span><img class="logo" src="simbolo.png" alt=""></span>`
      + `<b>${esc(titulo)}</b>${texto ? `<span>${esc(texto)}</span>` : ''}</div>`;
  };
})(window.CC);
