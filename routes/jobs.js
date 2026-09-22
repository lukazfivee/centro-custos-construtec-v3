const express = require('express');
const { autenticar } = require('../middleware/auth');
const { asyncRoute, httpError } = require('../lib/http');
const jobs = require('../lib/jobs');

const router = express.Router();
router.use(autenticar);

function serialize(job) {
  return {
    id: job.id,
    tipo: job.type,
    status: job.status,
    progresso: {
      atual: job.progress_current,
      total: job.progress_total,
      mensagem: job.progress_message,
    },
    resultado: job.status === 'succeeded' ? job.result : null,
    erro: job.status === 'failed' ? job.error : null,
    tentativas: job.attempts,
    criadoEm: job.created_at,
    iniciadoEm: job.started_at,
    finalizadoEm: job.finished_at,
  };
}

function assertAccess(req, job) {
  const isAdminOrGestor = ['admin', 'gestor'].includes(req.usuario.role);
  if (!isAdminOrGestor && job.created_by !== req.usuario.id) throw httpError(403, 'Sem permissão para consultar este job.');
}

router.get('/:id', asyncRoute(async (req, res) => {
  if (!jobs.isValidId(req.params.id)) throw httpError(400, 'Identificador de job inválido.');
  const job = await jobs.getJob(req.params.id);
  if (!job) throw httpError(404, 'Job não encontrado.');
  assertAccess(req, job);
  res.json(serialize(job));
}));

router.post('/:id/retry', asyncRoute(async (req, res) => {
  if (!jobs.isValidId(req.params.id)) throw httpError(400, 'Identificador de job inválido.');
  const existing = await jobs.getJob(req.params.id);
  if (!existing) throw httpError(404, 'Job não encontrado.');
  assertAccess(req, existing);
  const updated = await jobs.retryJob(req.params.id);
  res.json(serialize(updated));
}));

module.exports = router;
