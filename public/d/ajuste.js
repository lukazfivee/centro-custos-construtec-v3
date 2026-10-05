// Acabamento visual: encolhe valores grandes ate caberem e poe title nos textos cortados com reticencias.
(function (CC) {
  const D = CC.d;
  const VALORES = '.kpi .val, .resumo-cob b, .resumo-lanc b, .media b';
  const MINIMO = 12;
  let agendado = false;

  function ajustarValor(el) {
    el.style.fontSize = '';
    let tamanho = parseFloat(getComputedStyle(el).fontSize);
    el.dataset.ajustado = '';
    while (el.scrollWidth > el.clientWidth + 1 && tamanho > MINIMO) {
      tamanho -= 1;
      el.style.fontSize = `${tamanho}px`;
    }
    if (el.scrollWidth <= el.clientWidth + 1) delete el.dataset.ajustado;
  }

  // Valores da mesma fileira ficam todos com o menor tamanho, para a fileira nao parecer desigual.
  function igualar() {
    const grupos = new Map();
    document.querySelectorAll(VALORES).forEach((el) => {
      const pai = el.closest('.kpis, .fech-kpis, .usu-kpis, .cfg-kpis, .medias, .resumo-cob') || el.parentElement;
      if (!grupos.has(pai)) grupos.set(pai, []);
      grupos.get(pai).push(el);
    });
    grupos.forEach((lista) => {
      if (lista.length < 2) return;
      const menor = Math.min(...lista.map((el) => parseFloat(getComputedStyle(el).fontSize)));
      lista.forEach((el) => { el.style.fontSize = `${menor}px`; });
    });
  }

  function legendar(raiz) {
    raiz.querySelectorAll('b, span, p, a, h1, h2, h3, small').forEach((el) => {
      if (el.children.length || el.title || !el.textContent.trim()) return;
      if (el.scrollWidth <= el.clientWidth + 1) return;
      if (getComputedStyle(el).textOverflow === 'ellipsis') el.title = el.textContent.trim();
    });
  }

  function rodar() {
    agendado = false;
    document.querySelectorAll(VALORES).forEach(ajustarValor);
    igualar();
    legendar(document.getElementById('app') || document.body);
  }

  function agendar() {
    if (agendado) return;
    agendado = true;
    requestAnimationFrame(rodar);
  }

  D.ajustarTela = agendar;
  window.addEventListener('resize', agendar);
  document.addEventListener('DOMContentLoaded', () => {
    const todos = document.getElementsByTagName('*');
    let antes = -1;
    // Sem observar o DOM: confere a quantidade de elementos e so entao refaz o ajuste.
    setInterval(() => { if (todos.length !== antes) { antes = todos.length; agendar(); } }, 400);
    agendar();
    if (document.fonts && document.fonts.ready) { document.fonts.ready.then(agendar); document.fonts.addEventListener('loadingdone', agendar); }
  });
})(window.CC);
