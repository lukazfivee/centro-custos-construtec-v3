// Ponte com o lado nativo (AuthBridge.java). Toda chamada e assincrona e devolve { ok, ... }.
(function (root) {
  const pending = new Map();
  const listeners = [];
  let seq = 0;

  function backend() {
    return root.AndroidAuth || root.DevAuth || null;
  }

  function call(method, args) {
    const target = backend();
    if (!target) return Promise.resolve({ ok: false, code: 'NO_BRIDGE' });
    const id = `c${Date.now().toString(36)}${(seq += 1)}`;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      try {
        target.call(id, method, JSON.stringify(args || {}));
      } catch (error) {
        pending.delete(id);
        resolve({ ok: false, code: 'BRIDGE_ERROR' });
      }
    });
  }

  root.__nativeReply = function (id, result) {
    const resolve = pending.get(id);
    if (!resolve) return;
    pending.delete(id);
    resolve(result && typeof result === 'object' ? result : { ok: false, code: 'BRIDGE_ERROR' });
  };

  root.__nativeEvent = function (name, data) {
    for (const fn of listeners) {
      try { fn(name, data || {}); } catch (error) { /* uma tela com erro nao derruba as outras */ }
    }
  };

  root.__setInsets = function (top, bottom) {
    const style = document.documentElement.style;
    style.setProperty('--sat', `${Math.max(0, Number(top) || 0)}px`);
    style.setProperty('--sab', `${Math.max(0, Number(bottom) || 0)}px`);
  };

  root.Native = { call, on: (fn) => listeners.push(fn), available: () => Boolean(backend()) };
})(window);
