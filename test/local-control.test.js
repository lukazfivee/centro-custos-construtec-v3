const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { registerControl } = require('../lib/localControl');

test('Controle local rejeita segredo incorreto e aciona somente o serviço registrado', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-control-test-'));
  process.env.CONSTRUTEC_RUNTIME_DIR = directory;
  let called = 0;
  const close = await registerControl('centro-custos', () => { called++; });
  try {
    const record = JSON.parse(fs.readFileSync(path.join(directory, `centro-custos-${process.pid}.json`), 'utf8'));
    const send = token => new Promise((resolve, reject) => {
      const socket = net.connect(record.pipe);
      let response = '';
      socket.on('error', reject);
      socket.on('connect', () => socket.write(token + '\n'));
      socket.on('data', chunk => { response += chunk; });
      socket.on('end', () => resolve(response.trim()));
    });
    assert.equal(await send('invalid'), 'denied');
    assert.equal(called, 0);
    assert.equal(await send(record.token), 'stopping:centro-custos');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(called, 1);
  } finally {
    close();
    fs.rmdirSync(directory);
  }
});
