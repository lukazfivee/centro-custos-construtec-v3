const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// centralAuth.js e um modulo ESM (usa `export`), mas o package.json da raiz
// nao declara "type": "module", entao um `require`/`import` direto do
// caminho falharia com SyntaxError. Seguindo o padrao ja usado em
// test/v3-1-profile-photo.test.js e test/v3-1-cloud-worker.test.js, lemos o
// arquivo fonte e o importamos via data: URI com mime text/javascript, o que
// forca o parser ESM independente do "type" do package.json.
async function loadCentralAuth() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'center-container', 'centralAuth.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function fakeDbReturning(row) {
  return {
    prepare: () => ({
      bind: () => ({
        first: async () => row,
      }),
    }),
  };
}

test('isEmailAllowed aceita e-mail do dominio corporativo mesmo sem estar na lista', async () => {
  const { isEmailAllowed } = await loadCentralAuth();
  const env = { DB: { prepare: () => { throw new Error('nao deveria consultar o banco para dominio corporativo'); } } };
  assert.equal(await isEmailAllowed(env, 'pessoa@rcconstrutec.com.br'), true);
});

test('isEmailAllowed recusa e-mail externo nao autorizado', async () => {
  const { isEmailAllowed } = await loadCentralAuth();
  const env = { DB: fakeDbReturning(null) };
  assert.equal(await isEmailAllowed(env, 'fora@gmail.com'), false);
});

test('isEmailAllowed aceita e-mail externo presente na lista de autorizados', async () => {
  const { isEmailAllowed } = await loadCentralAuth();
  const env = { DB: fakeDbReturning({ email: 'fora@gmail.com' }) };
  assert.equal(await isEmailAllowed(env, 'fora@gmail.com'), true);
});
