// Atualizacao do app Windows dentro do desktop novo. So existe no Electron (window.electronAPI) e
// para quem administra (p9, como no servidor). Verifica em segundo plano no maximo 1 vez a cada 6 h
// e mostra um aviso discreto no topo; o painel (atualizacao-painel.js) baixa e instala.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const CHAVE = 'cc_d_upd_ultima';
  const SEIS_HORAS = 6 * 60 * 60 * 1000;
  const CONFERIR_A_CADA = 30 * 60 * 1000;
  const U = D.upd = { estado: null, INTERVALO: SEIS_HORAS };
  const ouvintes = [];

  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  U.disponivel = () => !!window.electronAPI && D.tem('p9');
  U.aoMudar = (fn) => { ouvintes.push(fn); return () => { const i = ouvintes.indexOf(fn); if (i >= 0) ouvintes.splice(i, 1); }; };

  function ultima() {
    try { return Number(localStorage.getItem(CHAVE)) || 0; } catch { return 0; }
  }
  function marcar() {
    try { localStorage.setItem(CHAVE, String(Date.now())); } catch { /* sem armazenamento */ }
  }
  U.ultimaVerificacao = () => {
    const doServidor = U.estado && U.estado.lastCheckedAt ? Date.parse(U.estado.lastCheckedAt) : 0;
    return Math.max(doServidor || 0, ultima());
  };
  U.venceu = () => Date.now() - U.ultimaVerificacao() >= SEIS_HORAS;
  U.ha = (ms) => {
    if (!ms) return 'ainda não verificado';
    const min = Math.floor((Date.now() - ms) / 60000);
    if (min < 1) return 'agora há pouco';
    if (min < 60) return `há ${min} min`;
    const h = Math.floor(min / 60);
    return h < 24 ? `há ${h} h` : `em ${D.data(new Date(ms).toISOString())}`;
  };

  U.pintar = () => {
    const bt = CC.$('[data-upd-aviso]');
    if (!bt) return;
    const e = U.estado || {};
    const v = e.info && e.info.version ? e.info.version : '';
    const textos = {
      available: [`Nova versão ${v} disponível`, 'arrow-circle-up'],
      downloading: [`Baixando atualização ${e.progress ? e.progress.percent : 0}%`, 'download-simple'],
      downloaded: ['Reiniciar para instalar', 'arrow-clockwise'],
      installing: ['Instalando atualização', 'arrow-clockwise'],
    };
    const t = U.disponivel() ? textos[e.status] : null;
    bt.hidden = !t;
    if (!t) return;
    bt.innerHTML = `${D.ic(t[1], 16)}<span>${esc(t[0])}</span>`;
    bt.setAttribute('aria-label', `${t[0]}. Abrir detalhes da atualização.`);
  };

  U.ler = async () => {
    const { data } = await CC.api('/update/status');
    U.estado = data;
    U.pintar();
    ouvintes.slice().forEach((fn) => fn(data));
    return data;
  };

  // Pede a verificacao e acompanha ate sair de "checking" (no maximo ~50 s).
  U.verificar = async () => {
    if (!U.disponivel()) return null;
    await CC.api('/update/check');
    let e = await U.ler();
    for (let i = 0; i < 60 && ['idle', 'checking'].includes(e.status); i += 1) {
      await espera(800);
      e = await U.ler();
    }
    if (e.status !== 'error') marcar();
    return e;
  };

  // Segundo plano: erros nao incomodam (o botao manual em Configuracoes mostra o motivo).
  async function silenciosa() {
    if (!U.disponivel() || !U.venceu()) return;
    if (U.estado && ['checking', 'downloading', 'downloaded', 'installing'].includes(U.estado.status)) return;
    try { await U.verificar(); } catch { /* sem rede ou sem permissao: tenta de novo mais tarde */ }
  }

  U.iniciar = () => {
    const bt = CC.$('[data-upd-aviso]');
    if (bt) bt.addEventListener('click', () => U.abrirPainel());
    if (!U.disponivel()) return;
    U.ler().catch(() => {}).finally(() => { setTimeout(silenciosa, 6000); });
    setInterval(silenciosa, CONFERIR_A_CADA);
  };
})(window.CC);
