// Assistente do celular: folha de conversa com o Gemini (Firebase AI Logic). O SDK
// e o App Check carregam em segundo plano logo depois da abertura do site; a resposta
// aparece enquanto e escrita (streaming). A conversa fica na memoria da pagina; nada e
// guardado no celular. Ferramentas em ia-tools.js, instrucoes em ia-config.js.
(function (CC) {
  const { esc, icon } = CC;
  const IA = CC.ia = CC.ia || {};
  const SUGESTOES = ['Quais obras estão acima do orçado?', 'Quanto tenho a pagar este mês?', 'Como lanço uma despesa com foto?', 'Resumo das propostas enviadas', 'Quero reportar um problema'];
  IA.sugestoes = SUGESTOES; // o desktop troca as sugestões do celular (public/d/ia-desktop.js)
  const PASSOS = { listar_obras: 'Procurando as obras', ver_obra: 'Abrindo a obra', orcado_realizado: 'Comparando orçado e realizado', resumo_geral: 'Somando o mês',
    buscar_lancamentos: 'Procurando lançamentos', listar_categorias: 'Lendo as categorias', listar_propostas: 'Consultando o Orçamentos', ver_proposta: 'Abrindo a proposta',
    abrir_tela: 'Preparando a tela', preparar_reporte: 'Montando o relato' };
  const state = { chat: null, sdk: null, model: 0, busy: false, log: [], cards: [], live: '', screen: '' };

  IA.ready = () => Boolean(CC.iaConfig && CC.iaConfig.firebase);

  // Botao flutuante: um so, fora das telas, por isso aparece em todas depois do login.
  // Sobe quando a tela tem barra de acoes fixa embaixo, para nao cobrir o botao principal.
  function mountFab() {
    if (!IA.ready() || document.getElementById('ia-fab')) return;
    const fab = document.createElement('button');
    fab.id = 'ia-fab'; fab.className = 'ia-fab'; fab.type = 'button'; fab.hidden = true;
    fab.setAttribute('data-ia', ''); fab.setAttribute('aria-label', 'Assistente');
    fab.innerHTML = icon('sparkle-fill', 24);
    document.body.appendChild(fab);
    const sync = () => {
      fab.hidden = !CC.session.token() || Boolean(document.querySelector('.login'));
      const bar = document.querySelector('#view .actions');
      fab.style.setProperty('--fab-lift', `${bar ? bar.offsetHeight + (document.body.classList.contains('no-tabs') ? 0 : 20) : 0}px`);
    };
    const observer = new MutationObserver(sync);
    const root = document.getElementById('view') || document.getElementById('app'); // #app: desktop (/d/)
    if (root) observer.observe(root, { childList: true });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    sync();
  }

  // App Check (reCAPTCHA) so vale em site https de verdade; no app do Windows (127.0.0.1) ele nao se aplica.
  const secureOrigin = () => location.protocol === 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname);

  function sdk() {
    if (!state.sdk) state.sdk = load().catch((error) => { state.sdk = null; throw error; });
    return state.sdk;
  }
  async function load() {
    const base = CC.iaConfig.sdk;
    const [app, ai] = await Promise.all([import(`${base}firebase-app.js`), import(`${base}firebase-ai.js`)]);
    const fb = app.getApps()[0] || app.initializeApp(CC.iaConfig.firebase);
    // App Check (reCAPTCHA v3): so este site consegue usar a cota do Gemini do projeto.
    if (CC.iaConfig.recaptcha && secureOrigin()) {
      const check = await import(`${base}firebase-app-check.js`);
      check.initializeAppCheck(fb, { provider: new check.ReCaptchaV3Provider(CC.iaConfig.recaptcha), isTokenAutoRefreshEnabled: true });
    }
    return { ai, backend: ai.getAI(fb, { backend: new ai.GoogleAIBackend() }) };
  }
  // Pre-carrega o SDK e o token do App Check para a primeira pergunta nao esperar por eles.
  IA.warm = () => { if (IA.ready() && !CC.offline()) sdk().catch(() => {}); };

  async function newChat(history) {
    const { ai, backend } = await sdk();
    const m = CC.iaConfig.modelos[state.model];
    const model = ai.getGenerativeModel(backend, {
      model: m.nome, systemInstruction: CC.iaPrompt(), tools: IA.declarations(ai.Schema),
      generationConfig: { temperature: 0.3, maxOutputTokens: 1200, thinkingConfig: { thinkingLevel: m.pensar } },
    });
    state.chat = model.startChat({ history: history || [] });
    state.screen = CC.current ? CC.current() : '';
  }

  const quota = (e) => /\b429\b|quota|RESOURCE_EXHAUSTED|rate.?limit/i.test(`${e && e.message} ${e && e.customErrorData && e.customErrorData.status}`);

  // Modelo sobrecarregado no Google (500/503 "high demand"): passageiro.
  const busy = (e) => /\b50[03]\b|high demand|overloaded|UNAVAILABLE/i.test(`${e && e.message} ${e && e.customErrorData && e.customErrorData.status}`);

  // Limite gratuito ou modelo sobrecarregado: segue no reserva com a mesma conversa;
  // no ultimo modelo, tenta mais uma vez depois de uma pausa curta.
  // Texto parcial vai para a bolha ao vivo; devolve a resposta completa (com as chamadas de ferramenta).
  async function stream(content) {
    state.live = '';
    const r = await state.chat.sendMessageStream(content);
    for await (const chunk of r.stream) {
      let t = '';
      try { t = chunk.text(); } catch { t = ''; }
      if (t) { state.live += t; live(); }
    }
    return { response: await r.response };
  }

  async function send(content) {
    if (!state.chat) await newChat();
    else if (CC.current && state.screen !== CC.current()) await newChat(await state.chat.getHistory()); // a instrucao conta a tela aberta agora
    try {
      return await stream(content);
    } catch (error) {
      if (state.live || (!quota(error) && !busy(error))) throw error;
      if (state.model + 1 < CC.iaConfig.modelos.length) {
        state.model += 1;
        await newChat(await state.chat.getHistory());
      } else if (busy(error)) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      } else throw error;
      return stream(content);
    }
  }

  function friendly(error) {
    IA.lastError = error; // para diagnóstico pelo console
    if (CC.offline()) return 'O assistente precisa de internet.';
    if (/api-not-enabled|SERVICE_DISABLED/.test(String(error && error.message))) return 'O assistente ainda não foi ativado no Firebase (AI Logic). Avise o administrador.';
    if (quota(error)) return 'O limite gratuito do assistente acabou por agora. Tente de novo em alguns minutos.';
    if (busy(error)) return 'O serviço de IA do Google está sobrecarregado agora. Tente de novo em instantes.';
    if (/import|Failed to fetch|NetworkError/i.test(String(error && error.message))) return 'Não foi possível carregar o assistente. Verifique a internet.';
    return 'O assistente não conseguiu responder agora. Tente de novo.';
  }

  function md(text) {
    const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    const out = [];
    let list = null;
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trim();
      const item = line.match(/^(?:[-*]|\d+[.)])\s+(.*)$/);
      if (item) { list = list || []; list.push(`<li>${inline(item[1])}</li>`); continue; }
      if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; }
      if (line) out.push(`<p>${inline(line.replace(/^#+\s*/, ''))}</p>`);
    }
    if (list) out.push(`<ul>${list.join('')}</ul>`);
    return out.join('');
  }

  const body = () => CC.$('#ia-log');
  function paint() {
    const el = body();
    if (!el) return;
    el.innerHTML = state.log.length ? state.log.map((m) => (m.report ? reportHtml(m.report) : `<div class="ia-msg ${m.who}">${m.who === 'ia' ? md(m.text) : esc(m.text)}${m.go ? `<button type="button" class="chip-act ia-go" data-go-ia="${state.log.indexOf(m)}">${icon('arrow-right', 16)}Ir para ${esc(m.label || 'a tela')}</button>` : ''}</div>`)).join('')
      : `<div class="ia-hello">${icon('sparkle-fill', 28)}<b>Como posso ajudar?</b><span>Pergunte sobre obras, custos, orçado x realizado e propostas, peça para abrir uma tela ou relate um problema.</span>
        <div class="ia-sug">${SUGESTOES.map((s) => `<button type="button" class="chip-act" data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`;
    if (state.busy && state.live) el.insertAdjacentHTML('beforeend', `<div class="ia-msg ia" id="ia-live">${md(state.live)}</div>`);
    else if (state.busy) el.insertAdjacentHTML('beforeend', `<div class="ia-msg ia busy" role="status"><span class="ia-dots"><i></i><i></i><i></i></span><small id="ia-step">${esc(state.step || 'Pensando')}</small></div>`);
    CC.$$('[data-sug]', el).forEach((b) => b.addEventListener('click', () => ask(b.dataset.sug)));
    wireReports(el);
    CC.$$('[data-go-ia]', el).forEach((b) => b.addEventListener('click', () => { const m = state.log[Number(b.dataset.goIa)]; close(); if (m && m.go) m.go(); }));
    el.scrollTop = el.scrollHeight;
  }

  function live() {
    const el = CC.$('#ia-live');
    if (!el) return paint();
    el.innerHTML = md(state.live);
    const log = body(); if (log) log.scrollTop = log.scrollHeight;
  }

  async function ask(text) {
    const q = String(text || '').trim();
    if (!q || state.busy) return;
    state.log.push({ who: 'eu', text: q });
    if (CC.offline()) { state.log.push({ who: 'erro', text: 'O assistente precisa de internet.' }); return paint(); }
    state.busy = true; state.step = 'Pensando'; state.cards = []; IA.pendingNav = null;
    paint();
    try {
      let result = await send(q);
      for (let round = 0; round < 6; round += 1) {
        const calls = result.response.functionCalls() || [];
        if (!calls.length) break;
        state.step = PASSOS[calls[0].name] || 'Consultando';
        if (state.live) { state.live = ''; paint(); } // texto antes da consulta ("vou verificar") sai
        const step = CC.$('#ia-step'); if (step) step.textContent = state.step;
        const parts = [];
        for (const call of calls) parts.push({ functionResponse: { name: call.name, response: await IA.run(call) } });
        result = await send(parts);
      }
      let answer = '';
      try { answer = result.response.text(); } catch { answer = ''; }
      const reply = { who: 'ia', text: answer || (IA.pendingNav ? 'Abrindo.' : 'Não tenho uma resposta para isso. Pode explicar de outro jeito?') };
      // Resposta longa fica para ler, com o botao da tela; curta ("abrindo...") ja vai.
      if (IA.pendingNav && reply.text.length > 160) { reply.go = IA.pendingNav; reply.label = IA.pendingLabel; IA.pendingNav = null; }
      state.log.push(reply);
    } catch (error) {
      state.log.push({ who: 'erro', text: friendly(error) });
    } finally {
      state.log.push(...state.cards); // o cartão do relato vem depois do texto que o apresenta
      state.busy = false; state.live = '';
      paint();
    }
    if (IA.pendingNav) {
      const go = IA.pendingNav;
      IA.pendingNav = null;
      setTimeout(() => { close(); go(); }, 900);
    }
  }

  // Cartao do relato: a IA preenche, a pessoa confere e envia (POST /api/bug-reports).
  const TIPOS = [['bug', 'Bug ou falha'], ['melhoria', 'Melhoria'], ['sugestao', 'Sugestão']];
  const SEVS = [['baixa', 'Baixa'], ['media', 'Média'], ['alta', 'Alta'], ['critica', 'Crítica']];
  const opts = (list, sel) => list.map(([v, l]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${l}</option>`).join('');
  // Os campos ficam em state.log: redesenhar a conversa nao perde o que a pessoa editou.
  IA.showReport = function (a) {
    state.cards.push({ report: { id: `r${Date.now()}`, titulo: String(a.titulo || '').slice(0, 200), descricao: String(a.descricao || '').slice(0, 9000),
      tipo: TIPOS.some(([v]) => v === a.tipo) ? a.tipo : 'bug', severidade: SEVS.some(([v]) => v === a.severidade) ? a.severidade : 'media' } });
  };
  const reportHtml = (r) => `<form class="card ia-report" data-report="${r.id}">
      <span class="label">${icon('bug', 16)} Relato para a equipe</span>
      <label class="field"><span>Título</span><input name="titulo" maxlength="200" value="${esc(r.titulo)}"></label>
      <span class="grid2"><label class="field"><span>Tipo</span><select name="tipo">${opts(TIPOS, r.tipo)}</select></label>
        <label class="field"><span>Gravidade</span><select name="severidade">${opts(SEVS, r.severidade)}</select></label></span>
      <label class="field"><span>Descrição</span><textarea name="descricao" rows="5" maxlength="9000">${esc(r.descricao)}</textarea></label>
      <p class="sub" data-msg${r.erro ? '' : ' hidden'}>${esc(r.erro || '')}</p>
      <span class="grid2"><button class="btn2" type="button" data-cancel>Cancelar</button><button class="btn" type="submit"${r.sending ? ' disabled' : ''}>${icon('paper-plane-right', 18)}Enviar</button></span></form>`;

  function wireReports(el) {
    CC.$$('form[data-report]', el).forEach((form) => {
      const entry = state.log.find((m) => m.report && m.report.id === form.dataset.report);
      if (!entry) return;
      const r = entry.report;
      const done = (who, text) => { delete entry.report; entry.who = who; entry.text = text; paint(); };
      form.addEventListener('input', (event) => { if (event.target.name) r[event.target.name] = event.target.value; });
      CC.$('[data-cancel]', form).addEventListener('click', () => done('erro', 'Relato cancelado.'));
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const titulo = r.titulo.trim(), descricao = r.descricao.trim();
        if (titulo.length < 3 || descricao.length < 5) { r.erro = 'Preencha o título e a descrição.'; return paint(); }
        r.erro = ''; r.sending = true; paint();
        const contexto = `\n\n---\nEnviado pelo assistente do celular. Tela: ${(CC.current && CC.current()) || 'home'}. ${navigator.userAgent.match(/SuiteConstrutec\/\S+/) || 'navegador'}.`;
        try {
          await CC.api('/bug-reports', { method: 'POST', body: { titulo, descricao: (descricao + contexto).slice(0, 10000), tipo: r.tipo, severidade: r.severidade } });
          done('ia', `**Relato enviado.** A equipe recebeu "${titulo}". Obrigado por avisar.`);
        } catch (error) {
          r.sending = false; r.erro = error.message || 'Não foi possível enviar agora.'; paint();
        }
      });
    });
  }

  function onKey(event) { if (event.key === 'Escape') close(); }
  function close() {
    const el = document.getElementById('ia-sheet');
    if (el) el.remove();
    document.removeEventListener('keydown', onKey);
  }

  IA.open = function (starter) {
    if (!IA.ready()) return;
    close();
    const el = document.createElement('div');
    el.id = 'ia-sheet';
    el.className = 'sheet-backdrop';
    el.innerHTML = `<div class="sheet ia-sheet" role="dialog" aria-modal="true" aria-labelledby="ia-title">
      <div class="sheet-handle"></div>
      <div class="sheet-head"><b id="ia-title">${icon('sparkle', 18)}Assistente</b><span class="grow"></span>
        <button type="button" class="chip-act" id="ia-new">Nova conversa</button><button type="button" class="sheet-x" aria-label="Fechar">${icon('x', 20)}</button></div>
      <div class="ia-log" id="ia-log" aria-live="polite"></div>
      <form class="ia-input" id="ia-form"><textarea id="ia-q" rows="1" maxlength="1500" placeholder="Pergunte ou peça uma tela" aria-label="Mensagem para o assistente"></textarea>
        <button class="ia-send" type="submit" aria-label="Enviar">${icon('paper-plane-right', 20)}</button></form>
      <small class="ia-note">A IA pode errar. Confira os valores nas telas.${CC.iaConfig.recaptcha && secureOrigin() ? ' Protegido pelo reCAPTCHA (<a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Privacidade</a>, <a href="https://policies.google.com/terms" target="_blank" rel="noopener">Termos</a>).' : ''}</small></div>`;
    el.addEventListener('click', (event) => { if (event.target === el || event.target.closest('.sheet-x')) close(); });
    document.body.appendChild(el);
    document.addEventListener('keydown', onKey);
    const input = CC.$('#ia-q', el);
    const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(120, input.scrollHeight)}px`; };
    input.addEventListener('input', grow);
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); CC.$('#ia-form', el).requestSubmit(); } });
    CC.$('#ia-form', el).addEventListener('submit', (event) => { event.preventDefault(); const q = input.value; input.value = ''; grow(); ask(q); });
    CC.$('#ia-new', el).addEventListener('click', () => { if (state.busy) return; state.log = []; state.chat = null; state.model = 0; paint(); input.focus(); });
    paint();
    if (starter) ask(starter); else input.focus();
  };

  // A conversa pertence a conta: sair ou trocar de conta comeca do zero.
  IA.reset = () => { state.log = []; state.chat = null; state.model = 0; close(); };
  document.addEventListener('click', (event) => { if (event.target.closest('[data-ia]')) IA.open(); });
  window.addEventListener('load', () => setTimeout(() => { if (CC.session.token()) IA.warm(); }, 2500));
  mountFab();
})(window.CC = window.CC || {});
