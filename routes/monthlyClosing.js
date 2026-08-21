const express = require('express');
const { getDb } = require('../db');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute, httpError } = require('../lib/http');
const { recordAudit } = require('../services/audit');

const router = express.Router();
router.use(autenticar);

router.get('/', asyncRoute(async (req, res) => {
  const { rows } = await getDb().query(`
    SELECT mc.id,mc.year,mc.month,mc.closed_at,mc.closed_by,u.name AS fechado_por
    FROM monthly_closings mc JOIN users u ON u.id=mc.closed_by
    ORDER BY mc.year DESC,mc.month DESC
  `);
  res.json(rows);
}));

router.post('/', exigirPapel('admin'), asyncRoute(async (req, res) => {
  const year = Number(req.body.ano);
  const month = Number(req.body.mes);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw httpError(400, 'Ano inválido.');
  if (!Number.isInteger(month) || month < 1 || month > 12) throw httpError(400, 'Mês inválido.');
  const db = getDb();
  const existing = await db.query('SELECT id FROM monthly_closings WHERE year=$1 AND month=$2', [year, month]);
  if (existing.rows[0]) throw httpError(409, 'Este mês já está fechado.');
  await db.query('INSERT INTO monthly_closings (year, month, closed_by) VALUES ($1,$2,$3)', [year, month, req.usuario.id]);
  await recordAudit({entityType:'fechamento',entityId:`${year}-${month}`,action:'fechado',summary:`Competência ${String(month).padStart(2,'0')}/${year} fechada.`,data:{year,month},user:req.usuario});
  res.status(201).json({ ok: true, mensagem: `Competência ${String(month).padStart(2,'0')}/${year} fechada com sucesso.` });
}));

router.delete('/:id', exigirPapel('admin'), asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const suppliedReason = String(req.body?.motivo || '').trim();
  const reason = suppliedReason || 'Reabertura solicitada pela interface do sistema.';
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'ID inválido.');
  if (suppliedReason && suppliedReason.length < 5) throw httpError(400, 'Informe um motivo de reabertura com pelo menos 5 caracteres.');
  const db = getDb();
  const { rows } = await db.query('SELECT * FROM monthly_closings WHERE id=$1', [id]);
  if (!rows[0]) throw httpError(404, 'Fechamento não encontrado.');
  await db.query('DELETE FROM monthly_closings WHERE id=$1', [id]);
  await recordAudit({
    entityType:'fechamento',entityId:`${rows[0].year}-${rows[0].month}`,action:'reaberto',
    summary:`Competência ${String(rows[0].month).padStart(2,'0')}/${rows[0].year} reaberta.`,
    data:{...rows[0],motivo:reason.slice(0,500)},user:req.usuario,
  });
  res.json({ ok: true, mensagem: 'Competência reaberta e registrada no histórico.' });
}));

module.exports = router;
