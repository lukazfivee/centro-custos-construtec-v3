// Bloqueio de login por falhas, em memoria (revisao de seguranca de 04/10/2026, M8).
// Cada instancia guarda no maximo `maxEntries` chaves: expiradas saem na varredura e, se ainda assim
// estourar o teto, a chave mais antiga e descartada. Falhas antigas (fora da janela) nao acumulam.

function createLoginThrottle({ maxFailures, windowMs, blockMs, maxEntries = 5000, clock = Date.now }) {
  const entries = new Map();

  function live(key) {
    const entry = entries.get(key);
    if (!entry) return null;
    const now = clock();
    const expired = entry.blockedUntil ? entry.blockedUntil <= now : entry.windowStart + windowMs <= now;
    if (expired) { entries.delete(key); return null; }
    return entry;
  }

  function sweep() {
    for (const key of [...entries.keys()]) live(key);
  }

  // Minutos restantes de bloqueio; 0 quando a chave esta liberada.
  function blockedMinutes(key) {
    const entry = live(key);
    if (!entry?.blockedUntil) return 0;
    return Math.max(1, Math.ceil((entry.blockedUntil - clock()) / 60000));
  }

  function fail(key) {
    if (!key) return;
    const current = live(key) || { count: 0, windowStart: clock(), blockedUntil: null };
    const count = current.count + 1;
    const isNew = !entries.has(key);
    if (isNew && entries.size >= maxEntries) {
      sweep();
      if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
    }
    entries.set(key, {
      count,
      windowStart: current.windowStart,
      blockedUntil: count >= maxFailures ? clock() + blockMs : null,
    });
  }

  return { blockedMinutes, fail, clear: (key) => entries.delete(key), sweep, size: () => entries.size };
}

module.exports = { createLoginThrottle };
