// [G] Tour do primeiro uso (Fase 5): quatro telas, só para quem acabou de criar a
// conta (o servidor manda tour:true no primeiro login). Dá para rever pelo Menu.
(function (root) {
  const { UI, App, Native } = root;
  const { icon, esc } = UI;
  const SLIDES = [
    { img: true, title: (name) => (name ? `Bem-vindo(a), ${name}` : 'Bem-vindo(a) à Suíte'),
      text: 'Orçamentos e Centro de Custos no mesmo app, com uma conta só. Troque de sistema pelo botão Suíte.' },
    { ico: 'file-text', title: () => 'Propostas no bolso',
      text: 'Consulte propostas, itens e o comparativo do Orçamentos de qualquer lugar, direto da obra.' },
    { ico: 'chart-bar', title: () => 'O custo de cada obra',
      text: 'Acompanhe o orçado e o gasto de cada obra e receba um aviso quando um item passar do orçado.' },
    { ico: 'camera', title: () => 'Despesa com foto',
      text: 'Fotografe a nota e preencha os campos. Sem internet, o lançamento fica no celular e é enviado sozinho depois.' },
  ];
  let index = 0;
  let options = {};

  function finish() {
    if (options.review) return Native.call('close');
    return App.enterNow(options.notice || '');
  }

  function paint() {
    const s = SLIDES[index];
    const last = index === SLIDES.length - 1;
    const art = s.img ? '<img src="img/simbolo.png" alt="" class="tour-logo">' : icon(s.ico, 44);
    const el = UI.render(`
      <div class="tour-top"><span class="subtle">${index + 1} de ${SLIDES.length}</span>
        ${last ? '<span></span>' : UI.link('pular', 'Pular')}</div>
      <span class="spacer"></span>
      <div class="center fade-up tour-slide" style="gap:16px" id="slide">
        <span class="tour-art" aria-hidden="true">${art}</span>
        <h1 class="hero">${esc(s.title(App.name()))}</h1>
        <span class="muted" style="max-width:300px">${esc(s.text)}</span>
      </div>
      <span class="spacer"></span>
      <div class="tour-dots" aria-hidden="true">${SLIDES.map((_, i) => `<span class="${i === index ? 'on' : ''}"></span>`).join('')}</div>
      <div class="row">${index ? `<button class="btn2" id="antes" type="button">${icon('arrow-left', 18)}Voltar</button>` : ''}
        <button class="btn" id="proximo" type="button" style="flex:1"><span>${last ? 'Começar' : 'Continuar'}</span>${icon(last ? 'check-circle' : 'arrow-right', 18)}</button></div>`, 'step');
    UI.$('#proximo', el).addEventListener('click', () => (last ? finish() : go(index + 1)));
    const before = UI.$('#antes', el);
    if (before) before.addEventListener('click', () => go(index - 1));
    const skip = UI.$('#pular', el);
    if (skip) skip.addEventListener('click', finish);
    // Deslizar para os lados também troca de tela.
    let startX = null;
    el.addEventListener('pointerdown', (e) => { startX = e.clientX; });
    el.addEventListener('pointerup', (e) => {
      if (startX === null) return;
      const dx = e.clientX - startX;
      startX = null;
      if (Math.abs(dx) < 60) return;
      if (dx < 0 && !last) go(index + 1);
      if (dx > 0 && index) go(index - 1);
    });
  }

  function go(i) { index = Math.max(0, Math.min(SLIDES.length - 1, i)); paint(); }

  function tour(params) {
    options = params || {};
    index = 0;
    paint();
  }
  tour.back = () => (index ? go(index - 1) : finish());

  root.Screens.tour = tour;
})(window);
