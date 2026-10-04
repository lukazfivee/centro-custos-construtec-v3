// Revalida no diretorio central a sessao de contas compartilhadas. Sem isso,
// um login excluido ou desativado pelo Orcamentos seguiria valido aqui ate o
// JWT local expirar (8h).
// - Resposta positiva fica guardada por 60s.
// - 401 derruba a sessao e fica guardado: uma falha posterior do diretorio
//   nao a ressuscita.
// - Falha transitoria (rede, 429, 5xx) so e tolerada para sessao ja
//   confirmada antes, e nao e guardada; sem historico, nega. Vale tambem
//   para a checagem por hash (sessao de app), que guarda o positivo por 60s.
const cloudAuth = require('./cloudAuth');
const logger = require('../lib/logger');

const ALIVE_TTL_MS = 60 * 1000;
const DEAD_TTL_MS = 12 * 3600 * 1000;
const MAX_ENTRIES = 1000;
const cache = new Map();

function remember(token, alive) {
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(token, { alive, until: Date.now() + (alive ? ALIVE_TTL_MS : DEAD_TTL_MS), confirmed: alive });
}

async function cloudSessionAlive(sessionToken, options = {}) {
  if (!process.env.DATABASE_URL) return true;
  if (!sessionToken) return false;
  if (options.hashed) {
    if (!options.userId) return false;
    const hashKey = `h:${options.userId}:${sessionToken}`;
    const hashed = cache.get(hashKey);
    if (hashed && !hashed.alive) return false;
    if (hashed && hashed.until > Date.now()) return true;
    try {
      await cloudAuth.sessionHash(sessionToken, options.userId);
      remember(hashKey, true);
      return true;
    } catch (error) {
      if (error.status === 401) { remember(hashKey, false); return false; }
      logger.warn('cloud_session_hash_check_unavailable', { status:error.status || null });
      return Boolean(hashed?.confirmed);
    }
  }
  const cached = cache.get(sessionToken);
  if (cached && !cached.alive) return false;
  if (cached && cached.until > Date.now()) return true;
  try {
    await cloudAuth.session(sessionToken);
    remember(sessionToken, true);
    return true;
  } catch (error) {
    if (error.status === 401) {
      remember(sessionToken, false);
      return false;
    }
    logger.warn('cloud_session_check_unavailable', { status: error.status || null });
    return Boolean(cached?.confirmed);
  }
}

function resetCloudSessionCache() { cache.clear(); }

module.exports = { cloudSessionAlive, resetCloudSessionCache };
