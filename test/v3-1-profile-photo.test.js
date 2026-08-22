const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('foto local usa bytes portateis e valida formato real', () => {
  const router = require('../routes/auth');
  const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);

  assert.equal(router.decodeProfilePhoto({ mime:'image/png', contentBase64:png.toString('base64') }).mime,'image/png');
  assert.throws(
    () => router.decodeProfilePhoto({ mime:'image/png', contentBase64:Buffer.from('arquivo falso').toString('base64') }),
    /não corresponde/
  );
  assert.match(read('migrations/016_user_profile_photo.sql'), /profile_photo BYTEA/);
});

test('Worker valida e persiste foto no diretorio corporativo', async () => {
  const source = read('cloudflare-sync-worker/src/index.js');
  const worker = await import(`data:text/javascript;base64,${Buffer.from(`${source}\nexport { validateProfilePhoto };`).toString('base64')}`);
  const jpeg = Buffer.from([0xff,0xd8,0xff,0xdb]);

  assert.equal(worker.validateProfilePhoto({ mime:'image/jpeg', contentBase64:jpeg.toString('base64') }).mime,'image/jpeg');
  assert.match(read('cloudflare-sync-worker/migrations/005-foto-perfil.sql'), /profile_photo_base64/);
  assert.match(source, /\/v1\/auth\/profile-photo/);
});

test('primeiro acesso e configuracoes oferecem foto com fallback de iniciais', () => {
  const html = read('public/index.html');
  const script = read('public/app.js');

  assert.match(html, /id="check-foto"/);
  assert.match(html, /id="profile-photo-input"/);
  assert.match(script, /function userInitials/);
  assert.match(script, /prepareProfilePhoto/);
  assert.match(script, /512\*1024/);
});
