// Ponte de DESENVOLVIMENTO: imita o AuthBridge.java no navegador, contra scripts/mock-central-auth.mjs.
// Nao vai para o APK (ignoreAssetsPattern no build.gradle). Aqui o "cofre" e o localStorage, sem cifra.
(function (root) {
  const KEY = 'dev-vault';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const save = (v) => localStorage.setItem(KEY, JSON.stringify(v));
  let active = null;
  let pending = null;
  let reason = 'start';

  const headers = (token) => {
    const h = { 'content-type': 'application/json', 'x-instance-id': 'dev-browser', 'x-instance-name': 'Android · Navegador de desenvolvimento', 'x-client': 'suite-android/dev' };
    if (token) h.authorization = `Bearer ${token}`;
    return h;
  };

  async function api(method, route, body, token) {
    try {
      const res = await fetch(route, { method, headers: headers(token), body: body ? JSON.stringify(body) : undefined });
      if (res.status === 404) return { ok: false, code: 'NOT_AVAILABLE', status: 404 };
      const json = await res.json().catch(() => ({ ok: false, code: 'SERVER_ERROR' }));
      if (res.status === 401 && route.endsWith('/login')) return { ok: false, code: 'INVALID_CREDENTIALS' };
      if (res.status === 409) return { ok: false, code: 'ACCOUNT_LEGACY' };
      return { ...json, status: res.status };
    } catch {
      return { ok: false, code: 'OFFLINE' };
    }
  }

  function fail(v) {
    v.failures = (v.failures || 0) + 1;
    if (v.failures >= 3) { delete v.pin; delete v.session; v.bio = false; v.pinLocked = true; save(v); return { ok: false, code: 'PIN_LOCKED' }; }
    save(v);
    return { ok: false, code: 'PIN_WRONG', failures: v.failures };
  }

  function useSession(v, session) {
    if (pending) { v.session = pending; pending = null; save(v); }
    active = v.session || session;
    return { ok: true, user: active && active.user };
  }

  const methods = {
    async state() {
      const v = load();
      return {
        ok: true, reason, hasPin: Boolean(v.pin), hasSession: Boolean(v.session), pinLocked: Boolean(v.pinLocked),
        bioEnabled: Boolean(v.bio), bioAvailable: true, profile: v.profile || null, autoLock: v.autoLock ?? 300, online: navigator.onLine,
      };
    },
    async login({ email, password }) {
      const r = await api('POST', '/v1/auth/login', { email, password });
      if (!r.ok) return r;
      const v = load();
      pending = { sessionToken: r.sessionToken, expiresAt: r.expiresAt, user: r.user };
      v.profile = { name: r.user.name, email: r.user.email };
      delete v.pinLocked;
      save(v);
      if (!v.pin) active = pending;
      return { ok: true, user: r.user };
    },
    async createPin({ pin }) {
      const v = load();
      v.pin = pin; v.failures = 0; v.session = pending || active; pending = null; save(v);
      active = v.session;
      return { ok: true };
    },
    async checkPin({ pin }) {
      const v = load();
      if (v.pin === pin) { v.failures = 0; save(v); return { ok: true }; }
      return fail(v);
    },
    async unlockPin({ pin }) {
      const v = load();
      if (!v.pin) return { ok: false, code: 'PIN_LOCKED' };
      if (v.pin !== pin) return fail(v);
      v.failures = 0; save(v);
      return useSession(v);
    },
    async bioEnroll() { await new Promise((r) => setTimeout(r, 700)); const v = load(); v.bio = true; save(v); return { ok: true }; },
    async bioUnlock() { await new Promise((r) => setTimeout(r, 700)); const v = load(); return v.bio ? useSession(v) : { ok: false, code: 'BIO_UNAVAILABLE' }; },
    async bioDisable() { const v = load(); v.bio = false; save(v); return { ok: true }; },
    async forgetPin() { const v = load(); delete v.pin; delete v.session; v.bio = false; save(v); return { ok: true }; },
    async resetRequest({ email }) { return api('POST', '/v1/auth/password-reset/request', { email }); },
    async resetConfirm({ token, password }) { return api('POST', '/v1/auth/password-reset/confirm', { token, password }); },
    async sessions() { return active ? api('GET', '/v1/auth/sessions', null, active.sessionToken) : { ok: false, code: 'SESSION_INVALID' }; },
    async revokeOthers() { return active ? api('POST', '/v1/auth/sessions/revoke-others', {}, active.sessionToken) : { ok: false, code: 'SESSION_INVALID' }; },
    async setAutoLock({ seconds }) { const v = load(); v.autoLock = seconds; save(v); return { ok: true }; },
    async enterApp({ notice }) {
      const token = active && active.sessionToken;
      const r = token ? await api('POST', '/v1/auth/handoff', { target: 'centro-custos' }, token) : { ok: false };
      if (notice) console.info('[dev] aviso nativo:', notice);
      location.href = r.ok ? `/#handoff=${r.code}` : '/';
      return { ok: true };
    },
    async logout({ forget }) { if (forget) localStorage.removeItem(KEY); active = null; reason = 'start'; location.reload(); return { ok: true }; },
    async close() { location.href = '/'; return { ok: true }; },
    async moveToBack() { return { ok: true }; },
    async openLocalSetup() { alert('No app: abre "Configurar servidor local".'); return { ok: true }; },
  };

  // Atalhos para simular o nativo: ?reason=lock | security | menu
  const q = new URLSearchParams(location.search).get('reason');
  if (q) reason = q;

  root.DevAuth = {
    call(id, method, argsJson) {
      const fn = methods[method];
      const run = fn ? fn(JSON.parse(argsJson || '{}')) : Promise.resolve({ ok: false, code: 'UNKNOWN_METHOD' });
      run.then((result) => root.__nativeReply(id, result), () => root.__nativeReply(id, { ok: false, code: 'BRIDGE_ERROR' }));
    },
  };
})(window);
