// Revalida no diretorio central a sessao de contas compartilhadas. Sem isso,
// um login excluido ou desativado pelo Orcamentos seguiria valido aqui ate o
// JWT local expirar (8h). Resultado guardado por 60s para nao consultar o
// diretorio a cada requisicao. Falha de rede nao derruba a sessao: o
// diretorio roda no mesmo Worker que serve este app.
const cloudAuth = require('./cloudAuth');
const logger = require('../lib/logger');

const TTL_MS = 60 * 1000;
const MAX_ENTRIES = 1000;
const cache = new Map();

async function cloudSessionAlive(sessionToken) {
  if (!process.env.DATABASE_URL || !sessionToken) return true;
  const cached = cache.get(sessionToken);
  if (cached && cached.until > Date.now()) return cached.alive;
  let alive = true;
  try {
    await cloudAuth.session(sessionToken);
  } catch (error) {
    if (error.status === 401) alive = false;
    else logger.warn('cloud_session_check_unavailable', { status: error.status || null });
  }
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(sessionToken, { alive, until: Date.now() + TTL_MS });
  return alive;
}

function forgetCloudSession(sessionToken) {
  cache.delete(sessionToken);
}

module.exports = { cloudSessionAlive, forgetCloudSession };
