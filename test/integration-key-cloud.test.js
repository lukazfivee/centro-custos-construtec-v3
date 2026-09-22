const test = require('node:test');
const assert = require('node:assert/strict');
const { expectedIntegrationKey } = require('../routes/integracaoOrcamentos');

function withEnv(vars, fn) {
  const saved = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key]; else process.env[key] = vars[key];
  }
  try { return fn(); } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  }
}

const PUBLIC_DEFAULT = 'construtec-internal-integration-secret-2026';
const STRONG = 'k'.repeat(48);

test('desktop sem segredo usa a chave padrao local', () => {
  withEnv({ DATABASE_URL: undefined, CONSTRUTEC_INTEGRATION_KEY: undefined }, () => {
    assert.equal(expectedIntegrationKey(), PUBLIC_DEFAULT);
  });
});

test('nuvem sem segredo desliga a integracao', () => {
  withEnv({ DATABASE_URL: 'postgres://x', CONSTRUTEC_INTEGRATION_KEY: undefined }, () => {
    assert.equal(expectedIntegrationKey(), null);
  });
});

test('nuvem recusa a chave publica e chaves curtas', () => {
  withEnv({ DATABASE_URL: 'postgres://x', CONSTRUTEC_INTEGRATION_KEY: PUBLIC_DEFAULT }, () => {
    assert.equal(expectedIntegrationKey(), null);
  });
  withEnv({ DATABASE_URL: 'postgres://x', CONSTRUTEC_INTEGRATION_KEY: 'curta' }, () => {
    assert.equal(expectedIntegrationKey(), null);
  });
});

test('nuvem usa o segredo configurado', () => {
  withEnv({ DATABASE_URL: 'postgres://x', CONSTRUTEC_INTEGRATION_KEY: STRONG }, () => {
    assert.equal(expectedIntegrationKey(), STRONG);
  });
});

test('nuvem: limite de 32 caracteres e string vazia', () => {
  withEnv({ DATABASE_URL: 'postgres://x', CONSTRUTEC_INTEGRATION_KEY: 'k'.repeat(31) }, () => {
    assert.equal(expectedIntegrationKey(), null);
  });
  withEnv({ DATABASE_URL: 'postgres://x', CONSTRUTEC_INTEGRATION_KEY: 'k'.repeat(32) }, () => {
    assert.equal(expectedIntegrationKey(), 'k'.repeat(32));
  });
  withEnv({ DATABASE_URL: 'postgres://x', CONSTRUTEC_INTEGRATION_KEY: '' }, () => {
    assert.equal(expectedIntegrationKey(), null);
  });
});

test('Worker nao encaminha ao Container sem DATABASE_URL', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'cloudflare', 'center-container', 'index.js'), 'utf8');
  assert.match(source, /CONSTRUTEC_INTEGRATION_KEY: env\.CONSTRUTEC_INTEGRATION_KEY/);
  assert.match(source, /if \(!env\.DATABASE_URL \|\| !env\.JWT_SECRET\)/);
});
