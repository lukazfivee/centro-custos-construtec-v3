const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('notas de atualização convertem HTML em texto simples', () => {
  const { formatReleaseNotes } = require('../services/updater');
  const notes = formatReleaseNotes('<p>Melhorias gerais</p><ul><li>Envio de cobranças</li><li>Menu &amp; estabilidade</li></ul>');

  assert.equal(notes,'Melhorias gerais\n• Envio de cobranças\n• Menu & estabilidade');
  assert.doesNotMatch(notes, /<[^>]+>/);
});

test('interface usa textContent e mensagem legível em português', () => {
  const script = read('public/app.js');
  const availableBlock = script.slice(script.indexOf("status.status === 'available'"),script.indexOf("status.status === 'downloading'"));

  assert.match(availableBlock, /msg\.textContent=/);
  assert.doesNotMatch(availableBlock, /innerHTML/);
  assert.match(availableBlock, /O que mudou/);
  assert.match(availableBlock, /Recomendamos atualizar/);
});
