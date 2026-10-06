// Menu › Atualização do aplicativo (só dentro do app Android). A página consulta a versão mais nova
// no Worker (GET /v1/app/android/latest) e, ao tocar em "Atualizar agora", pede ao app por
// suite://atualizacao/instalar: o app baixa, confere o hash e abre o instalador do Android.
// No navegador e no iPhone o item do Menu não aparece e a tela só explica.
(function (CC) {
  const { esc, icon } = CC;
  const top = (title) => `<div class="top"><button class="back" type="button" id="voltar" aria-label="Voltar">${icon('caret-left', 20)}</button>
    <span class="grow"><h1>${esc(title)}</h1></span></div>`;

  // Versão instalada, lida do identificador que o app acrescenta ao navegador embutido.
  CC.appBuild = function () {
    const ua = navigator.userAgent || '';
    const name = /SuiteConstrutec\/(\S+)/.exec(ua);
    const code = /SuiteBuild\/(\d+)/.exec(ua);
    return { inApp: !!name, name: name ? name[1] : '', code: code ? Number(code[1]) : 0 };
  };

  // Há versão nova quando o código dela for maior que o instalado.
  CC.hasNewerBuild = (installedCode, remoteCode) => Number(remoteCode) > Number(installedCode) && Number(installedCode) > 0;

  async function fetchLatest() {
    const control = new AbortController();
    const timer = setTimeout(() => control.abort(), 12000);
    try {
      const response = await fetch('/v1/app/android/latest', { cache: 'no-store', signal: control.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Não foi possível consultar a versão mais nova agora.');
      return data;
    } catch (error) {
      if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('Sem conexão com a internet. Tente de novo.');
      throw error;
    } finally { clearTimeout(timer); }
  }

  CC.screens.atualizacao = function (params) {
    const build = CC.appBuild();
    const el = CC.render(`${top('Atualização do aplicativo')}
      <div class="card" style="margin-top:12px">
        <span class="label">Versão instalada</span>
        <b style="font-size:20px">${esc(build.name || 'Não é o aplicativo Android')}</b>
      </div>
      <div id="upd-box" style="margin-top:12px"></div>`, true, params);
    CC.$('#voltar', el).addEventListener('click', () => CC.go('menu'));
    const box = CC.$('#upd-box', el);

    const paint = (html) => { box.innerHTML = html; };
    const idle = (message) => {
      paint(`${message ? `<p class="muted" role="status">${message}</p>` : ''}
        <button class="btn2" type="button" id="upd-check" style="width:100%">${icon('arrow-counter-clockwise', 20)}Verificar atualização</button>`);
      CC.$('#upd-check', box).addEventListener('click', check);
    };
    async function check() {
      paint(`<p class="muted" role="status">${icon('circle-notch', 18)} Verificando...</p>`);
      let latest;
      try { latest = await fetchLatest(); } catch (error) { return idle(esc(error.message)); }
      if (!CC.hasNewerBuild(build.code, latest.versionCode)) {
        return idle(`${icon('check-circle', 18)} Você está na versão mais recente (${esc(build.name)}).`);
      }
      paint(`<div class="card"><span class="label">Nova versão disponível</span>
          <b style="font-size:17px">${esc(latest.versionName)}</b>
          ${latest.notes ? `<p class="muted" style="white-space:pre-line;margin:8px 0 0">${esc(latest.notes)}</p>` : ''}</div>
        <button class="btn" type="button" id="upd-go" style="width:100%;margin-top:12px">${icon('arrow-right', 20)}Atualizar agora</button>
        <p class="muted" id="upd-hint" style="margin-top:8px">O download e a instalação são feitos pelo aplicativo. O Android pode pedir permissão para instalar.</p>`);
      CC.$('#upd-go', box).addEventListener('click', () => { location.href = 'suite://atualizacao/instalar'; });
    }

    if (!build.inApp) {
      paint('<p class="muted">A atualização por dentro do aplicativo só existe no app Android. No navegador e no iPhone, nada precisa ser instalado.</p>');
    } else if (!build.code) {
      paint('<p class="muted">Este aplicativo é antigo demais para atualizar sozinho. Instale a versão mais nova pelo link da versão (GitHub Releases) uma última vez.</p>');
    } else {
      idle('');
      check();
    }
  };
})(window.CC = window.CC || {});
