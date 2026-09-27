// Selo de sincronizacao real no topo (corrige o texto fixo "Offline · Dados locais").
// Roda a mesma sincronizacao do desktop atual (public/cloud-sync.js): a cada 30 s, no foco e ao voltar a rede.
(function (CC) {
  const D = CC.d;
  const INTERVALO = 30000;
  const CHAVE = 'cc_d_sync';
  const estado = { modo: 'local', ultima: 0, erro: '', elegivel: false, rodando: false };
  D.sync = estado;

  try { estado.ultima = Number(localStorage.getItem(CHAVE)) || 0; } catch { /* sem armazenamento */ }

  function ha(ms) {
    const min = Math.floor((Date.now() - ms) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    const h = Math.floor(min / 60);
    return h < 24 ? `há ${h} h` : `em ${D.data(new Date(ms).toISOString())}`;
  }

  function texto() {
    if (estado.modo === 'off') return 'Sem internet';
    if (estado.modo === 'enviando') return 'Enviando…';
    if (estado.modo === 'falha') return 'Falha ao sincronizar';
    if (estado.modo === 'ok') return `Sincronizado · ${ha(estado.ultima)}`;
    return 'Dados neste computador';
  }

  function dica() {
    if (estado.modo === 'falha') return `${estado.erro || 'O servidor não respondeu.'} Clique para tentar de novo.`;
    if (estado.modo === 'off') return 'Sem conexão. Os dados deste computador continuam disponíveis.';
    if (estado.modo === 'local') return 'A sincronização com a nuvem vale para e-mails @rcconstrutec.com.br com a nuvem configurada.';
    return 'Clique para sincronizar agora.';
  }

  function pintar() {
    const bt = CC.$('[data-selo]');
    if (!bt) return;
    bt.className = `selo ${estado.modo}`;
    CC.$('[data-selo-txt]', bt).textContent = texto();
    bt.title = dica();
    bt.setAttribute('aria-label', `${texto()}. ${dica()}`);
  }
  D.pintarSelo = pintar;

  async function verificar() {
    if (!D.corporativo()) return false;
    try {
      const { data } = await CC.api('/cloud-sync/status');
      return !!(data && data.configured && data.eligible);
    } catch (error) {
      if (error.status === 0) estado.modo = 'off';
      return false;
    }
  }

  async function sincronizar() {
    if (estado.rodando) return;
    if (navigator.onLine === false) { estado.modo = 'off'; pintar(); return; }
    if (!estado.elegivel) { estado.modo = 'local'; pintar(); return; }
    estado.rodando = true;
    estado.modo = 'enviando';
    pintar();
    try {
      await CC.api('/cloud-sync/sincronizar', { method: 'POST', body: {} });
      estado.modo = 'ok';
      estado.ultima = Date.now();
      estado.erro = '';
      try { localStorage.setItem(CHAVE, String(estado.ultima)); } catch { /* segue */ }
      document.dispatchEvent(new CustomEvent('d:sincronizado'));
    } catch (error) {
      estado.modo = error.status === 0 ? 'off' : 'falha';
      estado.erro = error.message || '';
    } finally {
      estado.rodando = false;
      pintar();
    }
  }
  D.sincronizar = sincronizar;

  D.iniciarSelo = async function () {
    const bt = CC.$('[data-selo]');
    bt.addEventListener('click', () => {
      if (estado.elegivel) sincronizar();
      else CC.toast(dica(), 'info');
    });
    if (navigator.onLine === false) estado.modo = 'off';
    pintar();
    estado.elegivel = await verificar();
    if (estado.modo !== 'off') estado.modo = estado.elegivel && estado.ultima ? 'ok' : 'local';
    pintar();
    window.addEventListener('offline', () => { estado.modo = 'off'; pintar(); });
    window.addEventListener('online', async () => {
      estado.modo = 'local';
      if (!estado.elegivel) estado.elegivel = await verificar();
      if (estado.elegivel) sincronizar(); else pintar();
    });
    if (!estado.elegivel) return;
    const seVelho = () => { if (Date.now() - estado.ultima > 10000) sincronizar(); };
    window.addEventListener('focus', seVelho);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) seVelho(); });
    setInterval(sincronizar, INTERVALO);
    setInterval(() => { if (estado.modo === 'ok') pintar(); }, 30000);
    setTimeout(sincronizar, 4000);
  };
})(window.CC);
