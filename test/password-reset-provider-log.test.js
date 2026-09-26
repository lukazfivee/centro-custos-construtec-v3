const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, hasSQLite } = require('./password-reset-fixture.test');
const maybe = hasSQLite ? test : test.skip;

maybe('falha do provedor registra só status e tipo do erro, sem dados sensíveis', async (t) => {
  const { env, call, email } = await setup();
  env.EMAIL_PROVIDER_API_KEY = 're_chave_secreta_de_teste';
  env.EMAIL_FROM = 'no-reply@reports.rcconstrutec.com.br';
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  const warnings = [];
  global.fetch = async () => Response.json({ statusCode: 400, name: 'validation_error', message: `destinatario ${email} invalido` }, { status: 400 });
  console.warn = (...args) => warnings.push(args);
  t.after(() => { global.fetch = originalFetch; console.warn = originalWarn; });
  assert.equal((await call('POST', '/v1/auth/password-reset/request', { body: { email } })).status, 202);
  assert.deepEqual(warnings, [['password_reset_email_delivery_failed', 400, 'validation_error']]);
  const logged = JSON.stringify(warnings);
  for (const secret of [email, env.EMAIL_PROVIDER_API_KEY, 'redefinir-senha']) assert.equal(logged.includes(secret), false, secret);
});

maybe('falha do provedor sem JSON registra tipo desconhecido', async (t) => {
  const { env, call, email } = await setup();
  env.EMAIL_PROVIDER_API_KEY = 're_chave';
  env.EMAIL_FROM = 'no-reply@reports.rcconstrutec.com.br';
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  const warnings = [];
  global.fetch = async () => new Response('gateway', { status: 502 });
  console.warn = (...args) => warnings.push(args);
  t.after(() => { global.fetch = originalFetch; console.warn = originalWarn; });
  await call('POST', '/v1/auth/password-reset/request', { body: { email } });
  assert.deepEqual(warnings, [['password_reset_email_delivery_failed', 502, 'unknown']]);
});
