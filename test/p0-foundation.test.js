const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePagination, wantsPagination, paginationMeta } = require('../lib/pagination');
const { normalizeRequestId } = require('../middleware/observability');
const metrics = require('../lib/metrics');

test('paginação aplica padrões, limite máximo e metadados consistentes', () => {
  assert.deepEqual(parsePagination({}, { defaultLimit:50, maxLimit:200 }), { page:1, limit:50, offset:0 });
  assert.deepEqual(parsePagination({ pagina:'3', limite:'500' }, { defaultLimit:50, maxLimit:200 }), {
    page:3, limit:200, offset:400,
  });
  assert.equal(wantsPagination({}), false);
  assert.equal(wantsPagination({ paginar:'1' }), true);
  assert.deepEqual(paginationMeta(451, 3, 200), {
    pagina:3, limite:200, total:451, totalPaginas:3, temAnterior:true, temProxima:false,
  });
});

test('paginação rejeita página inválida com erro HTTP 400', () => {
  assert.throws(
    () => parsePagination({ pagina:'0' }),
    (error) => error.statusCode === 400 && /Página inválido/.test(error.message),
  );
});

test('identificador de requisição só aceita formato seguro', () => {
  assert.equal(normalizeRequestId('cliente-12345678'), 'cliente-12345678');
  const generated = normalizeRequestId('../valor-inseguro');
  assert.match(generated, /^[0-9a-f-]{36}$/i);
});

test('métricas registram requisições e consultas sem expor parâmetros', () => {
  metrics.resetForTests();
  metrics.beginRequest('GET');
  metrics.finishRequest({
    method:'GET',path:'/api/teste',statusCode:200,durationMs:1250,
    requestId:'teste-12345678',slowMs:1000,
  });
  metrics.recordQuery({ operation:'query',durationMs:650,failed:false,statement:'SELECT 1',slowMs:500 });
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.requests.total, 1);
  assert.equal(snapshot.requests.active, 0);
  assert.equal(snapshot.requests.slow, 1);
  assert.equal(snapshot.requests.byStatus['200'], 1);
  assert.equal(snapshot.database.total, 1);
  assert.equal(snapshot.database.slow, 1);
  assert.equal(snapshot.database.recentSlow[0].statement, 'SELECT 1');
});

test('atualizador pode ser carregado no modo servidor sem inicializar o Electron', () => {
  const updater = require('../services/updater');
  assert.equal(updater.getState().status, 'idle');
});
