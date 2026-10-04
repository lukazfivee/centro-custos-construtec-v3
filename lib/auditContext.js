'use strict';
// Origem da ação para a auditoria: computador, celular ou fila (lançamento reenviado da fila offline).
// Um contexto por requisição evita mexer em cada chamada de recordAudit.
const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();
const ORIGENS = new Set(['computador', 'celular', 'fila']);

function detectarOrigem(req) {
  const cliente = String(req.get('x-client') || '').toLowerCase();
  const agente = String(req.get('user-agent') || '');
  if (/^(suite|celular|mobile|android|ios)/.test(cliente) || /SuiteConstrutec\//.test(agente)) return 'celular';
  const caminho = String(req.get('referer') || '').replace(/^https?:\/\/[^/]+/, '');
  if (/^\/m(\/|\?|$)/.test(caminho)) return 'celular';
  return 'computador';
}

function auditContext(req, _res, next) {
  storage.run({ origem: detectarOrigem(req) }, next);
}

function origemAtual() {
  return storage.getStore()?.origem || 'computador';
}

// Lançamento que chega com client_id vem da fila do celular (a fila reenvia com o mesmo client_id).
function marcarOrigem(origem) {
  const store = storage.getStore();
  if (store && ORIGENS.has(origem)) store.origem = origem;
}

module.exports = { auditContext, origemAtual, marcarOrigem, detectarOrigem };
