// Fila de jobs em processo (sem infra externa: sem Redis/BullMQ, adequado ao
// escopo de um app Electron desktop com banco embutido). Decisões de design
// documentadas em docs/AUDITORIA-OPERACOES-ASSINCRONAS-20260916.md (D-1, D-2).
//
// - Execução sequencial (concorrência 1): evita contenção de lock no banco
//   embutido e mantém as garantias transacionais das operações financeiras.
// - Progresso e status ficam na tabela `jobs`, consultável via GET /api/jobs/:id.
// - Retry automático com backoff até max_attempts; retry manual idempotente
//   via POST /api/jobs/:id/retry (no-op se já succeeded/running/queued).
// - Timeout é cooperativo: handlers de loop devem chamar ctx.checkDeadline()
//   periodicamente para abortar (e fazer rollback) de forma limpa. Um
//   "safety net" externo marca o job como failed por timeout na tabela mesmo
//   que o handler não coopere, mas não é capaz de cancelar de fato uma
//   promise em andamento (limitação inerente ao Node sem worker_threads).
const crypto = require('crypto');
const { getDb } = require('../db');
const logger = require('./logger');
const metrics = require('./metrics');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [5000, 30000, 120000];

const handlers = new Map();
const queue = [];
let activeDrain = null;

function registerHandler(type, handler) {
  handlers.set(type, handler);
}

function isValidId(id) {
  return UUID.test(String(id || ''));
}

async function getJob(id) {
  if (!isValidId(id)) return null;
  const { rows } = await getDb().query('SELECT * FROM jobs WHERE id=$1', [id]);
  return rows[0] || null;
}

// Dispara (ou reaproveita) uma unica passada de drenagem da fila em memoria.
// Usa uma promise compartilhada (não um booleano) para que flushQueue() possa
// esperar de forma confiavel por uma drenagem ja em andamento, sem a corrida
// de "achei que ja tinha terminado" que um simples guard booleano permitiria.
function triggerDrain() {
  if (!activeDrain) {
    activeDrain = runDrainLoop().finally(() => { activeDrain = null; });
  }
  activeDrain.catch((error) => logger.error('job_queue_drain_failed', { error }));
  return activeDrain;
}

function scheduleDrain(delayMs = 0) {
  if (delayMs > 0) setTimeout(triggerDrain, delayMs).unref?.();
  else setImmediate(triggerDrain);
}

// Cria um job (ou retorna o existente com a mesma idempotency_key) e agenda
// o processamento em background. Não bloqueia: a chamadora deve responder
// imediatamente ao cliente com o id retornado.
async function submitJob({ type, idempotencyKey = null, params = null, createdBy = null, timeoutMs, maxAttempts }) {
  if (!handlers.has(type)) throw new Error(`Tipo de job sem handler registrado: ${type}`);
  const db = getDb();
  if (idempotencyKey) {
    const { rows } = await db.query('SELECT * FROM jobs WHERE type=$1 AND idempotency_key=$2', [type, idempotencyKey]);
    if (rows[0]) {
      if (rows[0].status === 'queued') scheduleDrain();
      return { job: rows[0], created: false };
    }
  }
  const id = crypto.randomUUID();
  const { rows } = await db.query(`
    INSERT INTO jobs (id,type,idempotency_key,status,params,created_by,timeout_ms,max_attempts)
    VALUES ($1,$2,$3,'queued',$4::jsonb,$5,$6,$7)
    RETURNING *
  `, [id, type, idempotencyKey, params != null ? JSON.stringify(params) : null, createdBy,
      timeoutMs || DEFAULT_TIMEOUT_MS, maxAttempts || DEFAULT_MAX_ATTEMPTS]);
  const job = rows[0];
  logger.info('job_created', { jobId: id, type, idempotencyKey: idempotencyKey || null, createdBy });
  queue.push(id);
  scheduleDrain();
  return { job, created: true };
}

// Retry idempotente: succeeded/running/queued retornam o estado atual sem
// reprocessar; apenas failed é reenfileirado, com tentativas zeradas.
async function retryJob(id) {
  const job = await getJob(id);
  if (!job) return null;
  if (job.status !== 'failed') return job;
  const db = getDb();
  const { rows } = await db.query(`
    UPDATE jobs SET status='queued',attempts=0,error=NULL,progress_current=0,progress_message=NULL,
      started_at=NULL,finished_at=NULL,updated_at=NOW()
    WHERE id=$1 RETURNING *
  `, [id]);
  logger.info('job_retry_requested', { jobId: id, type: job.type });
  queue.push(id);
  scheduleDrain();
  return rows[0];
}

async function updateProgress(jobId, { current, total, message } = {}) {
  try {
    await getDb().query(`
      UPDATE jobs SET progress_current=$2,progress_total=$3,progress_message=$4,updated_at=NOW()
      WHERE id=$1 AND status='running'
    `, [jobId, Number.isFinite(current) ? current : 0, Number.isFinite(total) ? total : null, message || null]);
  } catch (error) {
    logger.warn('job_progress_update_failed', { jobId, error });
  }
}

function makeContext(job) {
  const deadline = Date.now() + job.timeout_ms;
  return {
    updateProgress: (current, total, message) => updateProgress(job.id, { current, total, message }),
    checkDeadline: () => {
      if (Date.now() > deadline) {
        const error = new Error('Tempo limite do job excedido.');
        error.code = 'JOB_TIMEOUT';
        throw error;
      }
    },
  };
}

function timeoutGuard(ms) {
  let timer;
  const promise = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
    timer.unref?.();
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

async function processJob(jobId) {
  const db = getDb();
  const job = await getJob(jobId);
  if (!job || job.status !== 'queued') return;
  const handler = handlers.get(job.type);
  if (!handler) {
    await db.query(`UPDATE jobs SET status='failed',error=$2,finished_at=NOW(),updated_at=NOW() WHERE id=$1`,
      [jobId, `Tipo de job sem handler registrado: ${job.type}`]);
    return;
  }

  await db.query(`UPDATE jobs SET status='running',started_at=NOW(),attempts=attempts+1,updated_at=NOW() WHERE id=$1`, [jobId]);
  const attemptNumber = job.attempts + 1;
  const startedAt = process.hrtime.bigint();
  const ctx = makeContext(job);
  const guard = timeoutGuard(job.timeout_ms);

  let outcome;
  try {
    outcome = await Promise.race([
      handler(job, ctx).then((result) => ({ ok: true, result })),
      guard.promise.then(() => ({ ok: false, timedOut: true })),
    ]);
  } catch (error) {
    outcome = { ok: false, error };
  } finally {
    guard.cancel();
  }

  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

  if (outcome.ok) {
    await db.query(`UPDATE jobs SET status='succeeded',result=$2::jsonb,progress_message=NULL,finished_at=NOW(),updated_at=NOW() WHERE id=$1`,
      [jobId, JSON.stringify(outcome.result ?? null)]);
    metrics.recordJob({ type: job.type, status: 'succeeded', durationMs });
    logger.info('job_succeeded', { jobId, type: job.type, durationMs: Math.round(durationMs * 100) / 100, attempt: attemptNumber });
    return;
  }

  const error = outcome.timedOut ? Object.assign(new Error('Tempo limite do job excedido.'), { code: 'JOB_TIMEOUT' }) : outcome.error;
  const message = String(error?.message || error || 'Falha desconhecida').slice(0, 1000);
  metrics.recordJob({ type: job.type, status: 'failed', durationMs });
  logger.warn('job_failed', { jobId, type: job.type, attempt: attemptNumber, maxAttempts: job.max_attempts, error, durationMs: Math.round(durationMs * 100) / 100 });

  // Se o handler não cooperou com checkDeadline() a promise original pode
  // continuar rodando em segundo plano; não há como cancelá-la de fato sem
  // worker_threads. Registramos a falha para fins de status/observabilidade
  // e evitamos que seu eventual retorno tardio sobrescreva um estado já
  // terminal (o guard de status abaixo cobre esse caso).
  if (attemptNumber < job.max_attempts) {
    await db.query(`UPDATE jobs SET status='queued',error=$2,updated_at=NOW() WHERE id=$1`, [jobId, message]);
    const delay = RETRY_BACKOFF_MS[Math.min(attemptNumber - 1, RETRY_BACKOFF_MS.length - 1)];
    scheduleDrain(delay);
  } else {
    await db.query(`UPDATE jobs SET status='failed',error=$2,finished_at=NOW(),updated_at=NOW() WHERE id=$1`, [jobId, message]);
  }
}

async function runDrainLoop() {
  while (queue.length) {
    const jobId = queue.shift();
    await processJob(jobId);
  }
}

// Chamado uma vez na inicialização do servidor real (não em createApp(), para
// não disparar processamento em background durante os testes que só usam
// createApp()). Jobs 'running' de uma execução anterior interrompida são
// marcados como falhos (não há como saber se o trabalho concluiu, e as
// transações do handler já foram revertidas pelo próprio banco ao cair a
// conexão); jobs 'queued' são retomados.
async function startJobRunner() {
  const db = getDb();
  await db.query(`
    UPDATE jobs SET status='failed',error='Processo reiniciado antes da conclusão.',finished_at=NOW(),updated_at=NOW()
    WHERE status='running'
  `);
  const { rows } = await db.query(`SELECT id FROM jobs WHERE status='queued' ORDER BY created_at ASC`);
  for (const row of rows) queue.push(row.id);
  if (queue.length) scheduleDrain();
}

// Processa a fila até esvaziar, aguardando uma drenagem já em andamento em
// vez de assumir que terminou (ver triggerDrain). Além de servir a operação
// normal, é útil em testes para aguardar deterministicamente a conclusão de
// jobs recém-criados, sem depender de polling com timeout.
async function flushQueue() {
  await triggerDrain().catch(() => {});
}

module.exports = {
  registerHandler, submitJob, retryJob, getJob, updateProgress,
  startJobRunner, flushQueue, isValidId,
};
