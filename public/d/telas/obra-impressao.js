// Folha para imprimir ou salvar em PDF (relatorio executivo e boletim de medicao).
// Abre por cima da tela; na impressao so a folha aparece (css/obras-ferramentas.css).
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const O = D.obras = D.obras || {};

  // conteudo: HTML ja escapado. acoes: botoes extras (HTML). aoAbrir(folha) liga os botoes extras.
  O.imprimir = function ({ titulo, conteudo, acoes, aoAbrir }) {
    const anterior = document.activeElement;
    const folha = D.el(`<div class="impressao" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
      <div class="imp-barra"><b>${esc(titulo)}</b><span class="espaco"></span>${acoes || ''}
        <button type="button" class="btn btn-p" data-imprimir>${D.ic('printer')}Imprimir / PDF</button>
        <button type="button" class="btn btn-s" data-fechar-folha>Fechar</button></div>
      <article class="folha">${conteudo}</article></div>`);
    const fechar = () => {
      document.removeEventListener('keydown', teclas, true);
      folha.remove();
      document.body.classList.remove('imprimindo');
      if (anterior && anterior.focus) anterior.focus();
    };
    const teclas = (e) => { if (e.key === 'Escape' && !document.querySelector('.dialogo-camada')) { e.preventDefault(); fechar(); } };
    CC.$('[data-imprimir]', folha).addEventListener('click', () => window.print());
    CC.$('[data-fechar-folha]', folha).addEventListener('click', fechar);
    document.addEventListener('keydown', teclas, true);
    document.body.classList.add('imprimindo');
    document.body.appendChild(folha);
    CC.$('[data-imprimir]', folha).focus();
    if (aoAbrir) aoAbrir(folha);
    return { fechar };
  };

  // Cabecalho padrao da folha: marca, titulo e linhas de identificacao.
  O.cabecalhoFolha = (titulo, linhas) => `<header class="folha-cab"><img src="simbolo.png" alt=""><div><span class="eyebrow">Construtec Engenharia</span><h2>${esc(titulo)}</h2>
    <span class="muted">Emitido em ${esc(new Date().toLocaleDateString('pt-BR'))}</span></div></header>
    <dl class="folha-id">${linhas.filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  O.numerosFolha = (itens) => `<div class="folha-nums">${itens.map(([k, v, cls]) => `<span><span class="lbl">${esc(k)}</span><b class="${cls || ''}">${esc(v)}</b></span>`).join('')}</div>`;
})(window.CC);
