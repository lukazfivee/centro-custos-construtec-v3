const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { setup, hasSQLite } = require('./password-reset-fixture.test');
const maybe = hasSQLite ? test : test.skip;
const worker = path.join(__dirname, '..', 'cloudflare', 'center-container');

// Perfil (nome, celular e foto) pela rota interna do Container, com a chave e o id da conta.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64');

maybe('perfil: lê, edita nome e celular, troca e remove a foto; exige a chave', async () => {
  const base = await setup();
  const profile = await import(pathToFileURL(path.join(worker, 'profile.js')).href);
  const userId = base.env.DB.raw.prepare('SELECT id FROM cloud_users WHERE email=?').get(base.email).id;
  const call = async (body, key = base.env.SYNC_SHARED_KEY) => {
    const request = new Request('https://centro.test/v1/internal/profile', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-key': key }, body: JSON.stringify(body) });
    const response = await profile.handleProfile(request, base.env);
    return { status: response.status, data: await response.json() };
  };
  assert.equal(profile.isProfileRoute('/v1/internal/profile'), true);
  assert.equal((await call({ action: 'get', userId }, 'x'.repeat(40))).status, 403);
  assert.equal((await call({ action: 'get', userId: 'nao-existe' })).status, 404);

  const read = await call({ action: 'get', userId });
  assert.equal(read.data.profile.email, base.email);
  assert.equal(read.data.profile.photo, null);

  const updated = await call({ action: 'update', userId, name: '  Maria   Clara  ', phone: '(71) 99999-1234' });
  assert.equal(updated.data.profile.name, 'Maria Clara');
  assert.equal(updated.data.profile.phone, '71999991234');
  assert.equal((await call({ action: 'update', userId, name: 'M' })).status, 400);
  assert.equal((await call({ action: 'update', userId, name: 'Maria Clara', phone: '1234' })).data.error, 'Informe o celular com DDD.');
  assert.equal((await call({ action: 'update', userId, name: 'Maria Clara', phone: '' })).data.profile.phone, '', 'celular é opcional');

  assert.equal((await call({ action: 'setPhoto', userId, mime: 'image/jpeg', contentBase64: PNG })).status, 400, 'conteúdo tem de bater com o formato');
  const photo = await call({ action: 'setPhoto', userId, mime: 'image/png', contentBase64: PNG });
  assert.deepEqual(photo.data.profile.photo, { mime: 'image/png', contentBase64: PNG });
  assert.equal((await call({ action: 'removePhoto', userId })).data.profile.photo, null);
  assert.equal((await call({ action: 'apagar', userId })).status, 404);
});
