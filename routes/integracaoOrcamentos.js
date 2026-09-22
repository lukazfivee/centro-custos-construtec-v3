const express = require('express');
const crypto = require('crypto');
const { autenticar } = require('../middleware/auth');
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

const DEFAULT_INTEGRATION_KEY = 'construtec-internal-integration-secret-2026';

async function autenticarOuChaveIntegracao(req, res, next) {
  const integrationKey = req.headers['x-construtec-integration-key'];
  if (integrationKey) {
    const requireLoopback = process.env.CONSTRUTEC_INTEGRATION_LOOPBACK_ONLY === 'true';
    if (requireLoopback && !isLoopback(req)) {
      return res.status(403).json({ erro: 'Acesso negado: sincronização direta restrita a loopback local (127.0.0.1).' });
    }
    const expectedKey = process.env.CONSTRUTEC_INTEGRATION_KEY || DEFAULT_INTEGRATION_KEY;
    if (!safeCompare(integrationKey, expectedKey)) {
      return res.status(401).json({ erro: 'Chave de integração inválida.' });
    }
    req.usuario = { id: null, name: 'Sincronização Direta Orçamentos', role: 'admin' };
    return next();
  }
  return autenticar(req, res, next);
}

const router = express.Router();
router.use(autenticarOuChaveIntegracao);

router.post('/previas', asyncRoute(async (req, res) => {
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

router.post('/previas/:id/confirmar', asyncRoute(async (req, res) => {
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

router.post('/confirmar-direto', handleDirectSync);
router.post('/sync-direto', handleDirectSync);

router.get('/importacoes/:id', asyncRoute(async (req, res) => {
  const result = await getDb().query(`
    SELECT bi.id, bi.source_system, bi.namespace_id, bi.series_id, bi.source_proposal_id,
      bi.source_revision, bi.payload_hash, bi.imported_at, bi.contract_id,
      pc.cost_center_id, pc.number AS contract_number, pc.current_baseline_id
    FROM budget_imports bi
    LEFT JOIN project_contracts pc ON pc.id = bi.contract_id
    WHERE bi.id = $1
  `, [req.params.id]);

  if (!result.rows[0]) throw httpError(404, 'Importação não encontrada');
  res.json(result.rows[0]);
}));

router.get('/contratos/:id/baselines', asyncRoute(async (req, res) => {
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

router.get('/portfolio-summary', asyncRoute(async (req, res) => {
  const { getPortfolioSummary } = require('../services/budgets/budgetPortfolio');
  res.json(await getPortfolioSummary(getDb()));
}));

module.exports = router;
