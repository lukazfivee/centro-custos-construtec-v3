const express = require('express');
const crypto = require('crypto');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { discardByContract, restoreByContract, findOpenDiscard, IntegrationError } = require('../services/budgets/budgetContractDiscard');
const { exigirPermissao } = require('../services/permissions');
const { bloquearEscopado, assertObra } = require('../services/obraScope');
const { asyncRoute, httpError } = require('../lib/http');
const { getDb } = require('../db');
const { previewImport, confirmImportWithObservability: confirmImport } = require('../services/budgets/budgetImportService');

function isLoopback(req) {
  const ip = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost';
}

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Chave padrao so vale no desktop (PGlite local). Na nuvem (DATABASE_URL
// definido) o valor e publico no repositorio, entao a chave deve vir do
// segredo CONSTRUTEC_INTEGRATION_KEY; sem ele a integracao fica desligada.
const DEFAULT_INTEGRATION_KEY = 'construtec-internal-integration-secret-2026';
const MIN_CLOUD_KEY_LENGTH = 32;

// Segredo colado com BOM (U+FEFF) ou espacos: compara os dois lados sem eles (o Orcamentos envia limpo).
const cleanKey = (value) => String(value || '').replace(/^\uFEFF/, '').trim();

function expectedIntegrationKey() {
  const configured = cleanKey(process.env.CONSTRUTEC_INTEGRATION_KEY);
  if (!process.env.DATABASE_URL) return configured || DEFAULT_INTEGRATION_KEY;
  if (configured.length < MIN_CLOUD_KEY_LENGTH || configured === DEFAULT_INTEGRATION_KEY) return null;
  return configured;
}

// No desktop (PGlite local) a chave padrao e publica no repositorio; por isso, la, a chave de
// integracao so vale vinda do proprio computador (loopback), salvo CONSTRUTEC_INTEGRATION_LOOPBACK_ONLY=false.
// Na nuvem a exigencia continua opcional ('true'): o trafego chega pelo Worker e a chave e forte.
function integrationRequiresLoopback() {
  const flag = String(process.env.CONSTRUTEC_INTEGRATION_LOOPBACK_ONLY || '').trim().toLowerCase();
  if (flag === 'true') return true;
  return !process.env.DATABASE_URL && flag !== 'false';
}

async function autenticarOuChaveIntegracao(req, res, next) {
  const integrationKey = req.headers['x-construtec-integration-key'];
  if (integrationKey) {
    if (integrationRequiresLoopback() && !isLoopback(req)) {
      return res.status(403).json({ erro: 'Acesso negado: sincronização direta restrita a loopback local (127.0.0.1).' });
    }
    const expectedKey = expectedIntegrationKey();
    if (!expectedKey) {
      return res.status(503).json({ erro: 'Integração com o Orçamentos não configurada neste servidor.' });
    }
    if (!safeCompare(cleanKey(integrationKey), expectedKey)) {
      return res.status(401).json({ erro: 'Chave de integração inválida.' });
    }
    req.usuario = { id: null, name: 'Sincronização Direta Orçamentos', role: 'admin' };
    req.viaChaveIntegracao = true;
    return next();
  }
  return autenticar(req, res, next);
}

const router = express.Router();
router.use(autenticarOuChaveIntegracao);

// Importar orcamento e escrita na obra: so admin e gestor (a chave de integracao entra como admin).
const podeImportar = exigirPermissao('p5');

router.post('/previas', podeImportar, asyncRoute(async (req, res) => {
  try {
    const preview = await previewImport(getDb(), req.body, req.usuario?.id, req.body.options);
    res.json(preview);
  } catch (error) {
    if (error.message && (error.message.startsWith('HASH_MISMATCH') || error.message.includes('INVALID') || error.message.includes('MISMATCH'))) {
      throw httpError(422, error.message);
    }
    throw error;
  }
}));

router.post('/previas/:id/confirmar', podeImportar, asyncRoute(async (req, res) => {
  try {
    const result = await confirmImport(getDb(), {
      previewId: req.params.id,
      confirmedHash: req.body.hash,
      costCenterId: req.body.costCenterId,
    }, req.usuario?.id);

    const status = result.status === 'already_imported' ? 200 : 201;
    res.status(status).json(result);
  } catch (error) {
    if (error.statusCode === 409 || error.message?.includes('CONFLICT')) {
      throw httpError(409, error.message);
    }
    if (error.message && (error.message.startsWith('PREVIEW_') || error.message.includes('MISMATCH'))) {
      throw httpError(422, error.message);
    }
    throw error;
  }
}));

const handleDirectSync = asyncRoute(async (req, res) => {
  try {
    const envelope = req.body?.envelope || req.body;
    const result = await confirmImport(getDb(), {
      envelope,
      confirmedHash: envelope?.payloadSha256,
      costCenterId: req.body?.costCenterId,
    }, req.usuario?.id);

    const status = result.status === 'already_imported' ? 200 : 201;
    res.status(status).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    if (error.statusCode === 409 || error.message?.includes('CONFLICT')) {
      throw httpError(409, error.message);
    }
    if (error.message && (error.message.startsWith('HASH_MISMATCH') || error.message.includes('INVALID') || error.message.includes('MISMATCH'))) {
      throw httpError(422, error.message);
    }
    throw error;
  }
});

router.post('/confirmar-direto', podeImportar, handleDirectSync);
router.post('/sync-direto', podeImportar, handleDirectSync);

// Leituras: a chave de integracao (servico do Orcamentos) passa direto; sessao de usuario precisa de p10
// e, nas rotas por contrato/importacao, ter acesso a obra.
const leituraPorSessao = (req, res, next) => (req.viaChaveIntegracao ? next() : exigirPermissao('p10')(req, res, next));
// O resumo da carteira soma todas as obras e nao tem filtro: usuario restrito a obras nao entra.
const leituraDaCarteira = [leituraPorSessao, (req, res, next) => (req.viaChaveIntegracao ? next() : bloquearEscopado(req, res, next))];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function conferirObraDoContrato(req, contractId) {
  if (req.viaChaveIntegracao) return;
  const found = UUID.test(String(contractId))
    ? await getDb().query('SELECT cost_center_id FROM project_contracts WHERE id=$1', [contractId])
    : { rows: [] };
  if (found.rows[0]) await assertObra(req, found.rows[0].cost_center_id);
}

router.get('/importacoes/:id', leituraPorSessao, asyncRoute(async (req, res) => {
  const result = await getDb().query(`
    SELECT bi.id, bi.source_system, bi.namespace_id, bi.series_id, bi.source_proposal_id,
      bi.source_revision, bi.payload_hash, bi.imported_at, bi.contract_id,
      pc.cost_center_id, pc.number AS contract_number, pc.current_baseline_id
    FROM budget_imports bi
    LEFT JOIN project_contracts pc ON pc.id = bi.contract_id
    WHERE bi.id = $1
  `, [req.params.id]);

  if (!result.rows[0]) throw httpError(404, 'Importação não encontrada');
  if (!req.viaChaveIntegracao && result.rows[0].cost_center_id) await assertObra(req, result.rows[0].cost_center_id);
  res.json(result.rows[0]);
}));

router.get('/contratos/:id/baselines', leituraPorSessao, asyncRoute(async (req, res) => {
  await conferirObraDoContrato(req, req.params.id);
  const result = await getDb().query(`
    SELECT b.id, b.contract_id, b.version, b.predecessor_id, b.materials_cost,
      b.labor_cost, b.base_cost, b.contract_value, b.additions, b.sealed_at,
      b.id = pc.current_baseline_id AS is_current
    FROM budget_baselines b
    JOIN project_contracts pc ON pc.id = b.contract_id
    WHERE b.contract_id = $1
    ORDER BY b.version DESC
  `, [req.params.id]);

  res.json(result.rows);
}));

// Acompanhamento da obra para a proposta integrada no Orcamentos.
router.get('/contratos/:id/resumo', leituraPorSessao, asyncRoute(async (req, res) => {
  await conferirObraDoContrato(req, req.params.id);
  const { getContractSummary } = require('../services/budgets/budgetContractSummary');
  const summary = await getContractSummary(getDb(), String(req.params.id));
  if (!summary) {
    // Obra descartada (sem restaurar): o Orcamentos volta a proposta para "Aprovada sem Centro de Custo".
    const gone = await findOpenDiscard(getDb(), String(req.params.id));
    if (gone) {
      return res.status(410).json({ code: 'CENTER_DISCARDED', discarded: true, discardedAt: gone.discarded_at, discardedBy: gone.discarded_by_name, costCenterCode: gone.code });
    }
  }
  if (!summary) throw httpError(404,'Contrato não encontrado');
  // Movimento da obra: o Orcamentos so descarta a proposta aprovada se nao houver nenhum.
  const { movementCount } = require('../services/costCenterArchive');
  res.json({ ...summary, movementCount: summary.costCenterId ? await movementCount(getDb(), summary.costCenterId) : 0 });
}));

// Descarte/recuperacao da obra pedidos pelo Orcamentos (so admin; a chave de integracao entra como admin).
const integrationRoute = (action) => [exigirPapel('admin'), async (req, res, next) => {
  try {
    res.json(await action(getDb(), String(req.params.id), req.body || {}, req.usuario));
  } catch (error) {
    if (!(error instanceof IntegrationError)) return next(error);
    res.status(error.statusCode).json({ code: error.code, erro: error.message, ...error.extra });
  }
}];
router.post('/contratos/:id/descartar', ...integrationRoute(discardByContract));
router.post('/contratos/:id/restaurar', ...integrationRoute(restoreByContract));

router.get('/portfolio-summary', leituraDaCarteira, asyncRoute(async (req, res) => {
  const { getPortfolioSummary } = require('../services/budgets/budgetPortfolio');
  res.json(await getPortfolioSummary(getDb()));
}));

module.exports = router;
module.exports.expectedIntegrationKey = expectedIntegrationKey;
module.exports.integrationRequiresLoopback = integrationRequiresLoopback;
