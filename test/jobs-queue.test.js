const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.PGLITE_DATA_DIR = path.join(os.tmpdir(), 'centro-custos-jobs-queue');
process.env.RESTORE_ROOT_DIR = path.join(os.tmpdir(), 'centro-custos-jobs-restore');
process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
process.env.ADMIN_INITIAL_PASSWORD = 'Admin@123456';
process.env.ADMIN_INITIAL_EMAIL = 'admin@teste.local';
process.env.INSTANCE_NAME = 'Instalação de teste';
delete process.env.DATABASE_URL;

require('../server');
delete process.env.DATABASE_URL;

const { initializeDatabase, closeDatabase } = require('../db');
const jobs = require('../lib/jobs');
const metrics = require('../lib/metrics');

async function setup() {
  fs.rmSync(process.env.PGLITE_DATA_DIR, { recursive: true, force: true });
  await initializeDatabase();
}

test('job criado é processado pela fila e fica succeeded com o resultado do handler', async () => {
  await setup();
  jobs.registerHandler('teste-soma', async (job) => job.params.a + job.params.b);

  const { job, created } = await jobs.submitJob({ type: 'teste-soma', params: { a: 2, b: 3 } });
  assert.equal(created, true);
  assert.equal(job.status, 'queued');

  await jobs.flushQueue();

  const final = await jobs.getJob(job.id);
  assert.equal(final.status, 'succeeded');
  assert.equal(final.result, 5);
  assert.equal(final.attempts, 1);

  await closeDatabase();
});

test('idempotency_key evita reprocessar: mesma chave retorna o mesmo job', async () => {
  await setup();
  jobs.registerHandler('teste-idempotente', async () => 'ok');

  const first = await jobs.submitJob({ type: 'teste-idempotente', idempotencyKey: 'chave-1', params: {} });
  await jobs.flushQueue();
  const second = await jobs.submitJob({ type: 'teste-idempotente', idempotencyKey: 'chave-1', params: {} });

  assert.equal(second.created, false);
  assert.equal(second.job.id, first.job.id);
  assert.equal(second.job.status, 'succeeded');

  await closeDatabase();
});

test('job com falha permanente marca failed e respeita max_attempts; retry manual é idempotente', async () => {
  await setup();
  jobs.registerHandler('teste-falha', async () => { throw new Error('falha proposital'); });

  const { job } = await jobs.submitJob({ type: 'teste-falha', params: {}, maxAttempts: 1 });
  await jobs.flushQueue();

  const failed = await jobs.getJob(job.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.attempts, 1);
  assert.match(failed.error, /falha proposital/);

  // Retry manual: idempotente. Chamar novamente após succeeded/running não reprocessa;
  // aqui o job está failed, então o retry deve reenfileirar e reprocessar (falhando de novo).
  const retried = await jobs.retryJob(job.id);
  assert.equal(retried.status, 'queued');
  assert.equal(retried.attempts, 0);
  await jobs.flushQueue();
  const retriedFinal = await jobs.getJob(job.id);
  assert.equal(retriedFinal.status, 'failed');
  assert.equal(retriedFinal.attempts, 1);

  // Retry sobre um job já succeeded é no-op (idempotente): não reprocessa nem muda o resultado.
  jobs.registerHandler('teste-ok', async () => 'valor-original');
  const okSubmit = await jobs.submitJob({ type: 'teste-ok', params: {} });
  await jobs.flushQueue();
  const noop = await jobs.retryJob(okSubmit.job.id);
  assert.equal(noop.status, 'succeeded');
  assert.equal(noop.result, 'valor-original');

  await closeDatabase();
});

test('job com timeout curto é marcado failed por tempo limite excedido', async () => {
  await setup();
  jobs.registerHandler('teste-timeout', async (job, ctx) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    ctx.checkDeadline();
    return 'não deveria chegar aqui';
  });

  const { job } = await jobs.submitJob({ type: 'teste-timeout', params: {}, timeoutMs: 50, maxAttempts: 1 });
  await jobs.flushQueue();

  const final = await jobs.getJob(job.id);
  assert.equal(final.status, 'failed');
  assert.match(final.error, /Tempo limite/);

  await closeDatabase();
});

test('metrics.snapshot() expõe contadores de jobs por tipo', async () => {
  await setup();
  metrics.resetForTests();
  jobs.registerHandler('teste-metrica-ok', async () => 'ok');
  jobs.registerHandler('teste-metrica-falha', async () => { throw new Error('x'); });

  await jobs.submitJob({ type: 'teste-metrica-ok', params: {} });
  await jobs.submitJob({ type: 'teste-metrica-falha', params: {}, maxAttempts: 1 });
  await jobs.flushQueue();

  const snap = metrics.snapshot();
  assert.equal(snap.jobs.total, 2);
  assert.equal(snap.jobs.succeeded, 1);
  assert.equal(snap.jobs.failed, 1);
  assert.equal(snap.jobs.byType['teste-metrica-ok'].succeeded, 1);
  assert.equal(snap.jobs.byType['teste-metrica-falha'].failed, 1);

  await closeDatabase();
});
