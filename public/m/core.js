// Nucleo do site do celular: sessao, API, formatos, avisos e tema. Sem dependencias.
(function (CC) {
  const app = () => document.getElementById('view');

  CC.esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  CC.$ = (sel, scope) => (scope || document).querySelector(sel);
  CC.$$ = (sel, scope) => Array.from((scope || document).querySelectorAll(sel));

  // Centavos com arredondamento HALF_UP (regra do repositorio).
  CC.cents = (value) => {
    const n = Number(value) || 0;
    return Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-7) / 100;
  };
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  CC.money = (value) => brl.format(CC.cents(value));
  CC.moneyShort = (value) => {
    const n = Math.abs(Number(value) || 0);
    if (n >= 1e6) return `R$ ${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
    if (n >= 1e3) return `R$ ${(n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
    return CC.money(n);
  };
  CC.signed = (value) => `${Number(value) < 0 ? '− ' : '+ '}${CC.money(Math.abs(Number(value) || 0))}`;
  // Aceita "14.880,00", "14880,5", "14880.50" e "R$ 1.234,56".
  CC.parseMoney = (text) => {
    let s = String(text || '').replace(/[^\d,.-]/g, '');
    if (!/\d/.test(s)) return NaN;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
    const n = Number(s);
    return Number.isFinite(n) ? CC.cents(n) : NaN;
  };
  CC.today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  CC.month = () => CC.today().slice(0, 7);
  CC.dateBr = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
  CC.dateFull = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
  CC.monthName = () => new Date().toLocaleDateString('pt-BR', { month: 'long' });
  CC.greeting = () => {
    const h = new Date().getHours();
    return h < 12 ? 'Bom dia' : (h < 18 ? 'Boa tarde' : 'Boa noite');
  };
  CC.uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  }));

  // Sessao do site (mesmas chaves do Centro de Custos web).
  CC.session = {
    token: () => localStorage.getItem('cc_token') || '',
    user: () => { try { return JSON.parse(localStorage.getItem('cc_usuario') || 'null'); } catch { return null; } },
    save(data) {
      localStorage.setItem('cc_token', data.token);
      localStorage.setItem('cc_usuario', JSON.stringify(data.usuario));
      localStorage.setItem('cc_instancia', JSON.stringify(data.instancia));
    },
    clear() { ['cc_token', 'cc_usuario', 'cc_instancia'].forEach((k) => localStorage.removeItem(k)); },
  };
  // Dono dos dados guardados no celular: a fila e o cache nunca passam de uma conta para outra.
  CC.owner = () => {
    const u = CC.session.user() || {};
    return String(u.id != null ? u.id : (u.email || ''));
  };

  class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }
  CC.ApiError = ApiError;
  CC.offline = () => navigator.onLine === false;

  // status 0 = sem rede. 401 limpa a sessao e mostra a tela de entrar de novo.
  CC.api = async function (path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const token = CC.session.token();
    if (token) headers.Authorization = `Bearer ${token}`;
    let response;
    try {
      response = await fetch(`/api${path}`, { method: options.method || 'GET', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), cache: 'no-store' });
    } catch {
      throw new ApiError(0, 'Sem internet.');
    }
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      CC.session.clear();
      if (CC.onUnauthorized) CC.onUnauthorized();
      throw new ApiError(401, 'Sua sessão terminou. Entre de novo.');
    }
    if (!response.ok) throw new ApiError(response.status, data.erro || 'Não foi possível concluir agora.');
    return { status: response.status, data };
  };

  // Le da API e guarda a ultima resposta para usar sem internet.
  CC.cached = async function (key, path) {
    try {
      const { data } = await CC.api(path);
      CC.store.put('cache', { key: `${CC.owner()}|${key}`, data, at: Date.now() }).catch(() => {});
      return { data, stale: false };
    } catch (error) {
      if (error.status !== 0) throw error;
      const saved = await CC.store.get('cache', `${CC.owner()}|${key}`).catch(() => null);
      if (!saved) throw error;
      return { data: saved.data, stale: true, at: saved.at };
    }
  };

  // Tela antiga que termina de carregar depois de trocar de aba nao desenha por cima da nova.
  class Stale extends Error {}
  CC.Stale = Stale;
  CC.render = function (html, inner, params) {
    if (params && params.__nav && params.__nav !== CC.nav) throw new Stale();
    const el = app();
    el.innerHTML = `<main class="screen${inner ? ' inner' : ''}">${html}</main>`;
    window.scrollTo(0, 0);
    return el.firstElementChild;
  };

  let toastTimer = 0;
  CC.toast = function (message, iconName) {
    CC.$$('.toast').forEach((t) => t.remove());
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.innerHTML = `${CC.icon(iconName || 'check-circle', 18)}<span>${CC.esc(message)}</span>`;
    document.body.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 2600);
  };

  CC.theme = {
    get: () => localStorage.getItem('cc_m_tema') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro'),
    apply(value) {
      document.documentElement.dataset.theme = value;
      const meta = CC.$('meta[name="theme-color"]');
      if (meta) meta.content = value === 'escuro' ? '#031f29' : '#f2f8fa';
    },
    toggle() {
      const next = CC.theme.get() === 'escuro' ? 'claro' : 'escuro';
      localStorage.setItem('cc_m_tema', next);
      CC.theme.apply(next);
      return next;
    },
  };

  CC.success = function (size, label) {
    const k = (size || 72) / 72;
    const parts = [];
    for (let i = 0; i < 10; i += 1) {
      const big = i % 2 === 0;
      parts.push(`<span class="p ${big ? 'big' : 'small'}" style="--r:${i * 36}deg;--d:-${Math.round((big ? 50 : 40) * k)}px"></span>`);
    }
    return `<span class="success" role="img" aria-label="${CC.esc(label)}" style="--s:${size || 72}px"><span class="ring"></span>${parts.join('')}`
      + `<span class="check">${CC.icon('check-circle-fill', Math.round(44 * k))}</span><img class="logo" src="simbolo.png" alt=""></span>`;
  };
})(window.CC = window.CC || {});
