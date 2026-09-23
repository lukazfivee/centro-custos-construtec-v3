const test = require('node:test');
const assert = require('node:assert/strict');

const cloudAuth = require('../services/cloudAuth');
const { cloudSessionAlive } = require('../services/cloudSessionCheck');

function failWith(status) {
  return async () => { const error = new Error('falha'); error.status = status; throw error; };
}

test('revalidacao da sessao central na nuvem', async (t) => {
  const original = cloudAuth.session;
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://teste';
  t.after(() => {
    cloudAuth.session = original;
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  });

  assert.equal(await cloudSessionAlive(null), false, 'conta central sem token nao entra');

  cloudAuth.session = failWith(503);
  assert.equal(await cloudSessionAlive('tok-novo'), false, 'falha transitoria sem historico nega');

  cloudAuth.session = async () => ({ ok: true });
  assert.equal(await cloudSessionAlive('tok-ok'), true);

  cloudAuth.session = failWith(401);
  assert.equal(await cloudSessionAlive('tok-morto'), false);
  cloudAuth.session = failWith(503);
  assert.equal(await cloudSessionAlive('tok-morto'), false, '401 anterior nao e ressuscitado por falha');
});

test('fora da nuvem a revalidacao nao se aplica', async () => {
  const previousUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try { assert.equal(await cloudSessionAlive(null), true); }
  finally { if (previousUrl !== undefined) process.env.DATABASE_URL = previousUrl; }
});
