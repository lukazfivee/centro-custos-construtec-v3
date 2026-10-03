// Descartar e recuperar obra sem movimento financeiro (so administrador). O conteudo fica guardado em
// discarded_cost_centers e a obra pode ser restaurada (services/costCenterArchive.js).
const express = require('express');
const { getDb } = require('../db');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { recordAudit } = require('../services/audit');
const { discardCostCenter, restoreCostCenter, listDiscarded, movementSummary } = require('../services/costCenterArchive');

const router = express.Router();
// Sem router.use: este roteador divide o prefixo /api/centros-custo com os outros e nao pode barrar as rotas deles.
const admin = [autenticar, exigirPapel('admin')];

router.get('/descartadas', admin, asyncRoute(async (req, res) => {
  res.json(await listDiscarded(getDb()));
}));

router.post('/descartadas/:id/restaurar', admin, asyncRoute(async (req, res) => {
  const { center } = await restoreCostCenter(getDb(), positiveId(req.params.id, 'Registro'), req.usuario);
  await recordAudit({ entityType: 'obra', entityId: center.id, action: 'restaurada', summary: `Obra / centro restaurado: ${center.name}`, data: { codigo: center.code }, user: req.usuario });
  res.json({ ok: true, id: center.id });
}));

// So leitura: quantos registros impedem o descarte (o celular lista antes de pedir o codigo).
router.get('/:id/impedimentos', admin, asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const db = getDb();
  if (!(await db.query('SELECT 1 FROM cost_centers WHERE id=$1', [id])).rows.length) throw httpError(404, 'Centro de custo não encontrado.');
  res.json(await movementSummary(db, id));
}));

// A confirmacao e o codigo da obra, digitado por quem descarta.
router.post('/:id/descartar', admin, asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const db = getDb();
  const current = (await db.query('SELECT code FROM cost_centers WHERE id=$1', [id])).rows[0];
  if (!current) throw httpError(404, 'Centro de custo não encontrado.');
  if (String(req.body?.confirmar || '').trim().toLowerCase() !== String(current.code).trim().toLowerCase()) {
    throw httpError(400, 'Digite o código da obra para confirmar o descarte.');
  }
  const motivo = String(req.body?.motivo || '').trim().slice(0, 300);
  const { discardId, center } = await discardCostCenter(db, id, req.usuario, motivo);
  await recordAudit({ entityType: 'obra', entityId: id, action: 'descartada', summary: `Obra / centro descartado: ${center.name}`, data: { codigo: center.code, motivo, descarte: discardId }, user: req.usuario });
  res.json({ ok: true, descarte: discardId });
}));

module.exports = router;
