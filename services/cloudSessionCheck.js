// Revalida no diretorio central a sessao de contas compartilhadas. Sem isso,
// um login excluido ou desativado pelo Orcamentos seguiria valido aqui ate o
// JWT local expirar (8h).
// - Resposta positiva fica guardada por 60s.
// - 401 derruba a sessao e fica guardado: uma falha posterior do diretorio
//   nao a ressuscita.
// - Falha transitoria (rede, 429, 5xx) so e tolerada para sessao ja
//   confirmada antes, e nao e guardada; sem historico, nega.
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

async function cloudSessionAlive(sessionToken) {
  if (!process.env.DATABASE_URL) return true;
  if (!sessionToken) return false;
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

module.exports = { cloudSessionAlive };
