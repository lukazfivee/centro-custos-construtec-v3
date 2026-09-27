const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dir = path.join(__dirname, '..', 'public', 'm');

// Carrega core.js e queue.js num contexto de navegador simulado, com store e API falsos.
function load({ online = true } = {}) {
  const storage = new Map();
  const listeners = {};
  const context = {
    console, Intl, Date, Math, Number, String, JSON, Promise, Array, Object, Error, Map, Set, URLSearchParams,
    setTimeout, clearTimeout, setInterval: () => 0, crypto: require('node:crypto').webcrypto,
    navigator: { onLine: online, userAgent: 'node' },
    localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ setAttribute() {}, remove() {} }), body: { appendChild() {}, classList: { toggle() {}, add() {}, remove() {} } } },
    matchMedia: () => ({ matches: false }),
    addEventListener: (name, fn) => { listeners[name] = fn; },
  };
  context.window = context;
  vm.createContext(context);
  for (const f of ['icons.js', 'core.js', 'queue.js']) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), context, { filename: f });
  const CC = context.CC;
  const db = new Map();
  CC.store = {
    put: async (store, v) => { db.set(`${store}:${v.client_id || v.key}`, JSON.parse(JSON.stringify(v))); },
    get: async (store, k) => db.get(`${store}:${k}`),
    all: async (store) => [...db.entries()].filter(([k]) => k.startsWith(`${store}:`)).map(([, v]) => v),
    del: async (store, k) => { db.delete(`${store}:${k}`); },
  };
  CC.toast = () => {};
  storage.set('cc_token', 'token-de-teste');
  storage.set('cc_usuario', JSON.stringify({ id: 1, nome: 'Marina' }));
  return { CC, db, context, listeners };
}

test('dinheiro: centavos HALF_UP e leitura no formato brasileiro', () => {
  const { CC } = load();
  assert.equal(CC.cents(0.125), 0.13);
  assert.equal(CC.cents(2.675), 2.68);
  assert.equal(CC.cents(-1.005), -1.01);
  assert.equal(CC.parseMoney('14.880,00'), 14880);
  assert.equal(CC.parseMoney('R$ 1.234,56'), 1234.56);
  assert.equal(CC.parseMoney('1234.5'), 1234.5);
  assert.equal(CC.parseMoney('1.234.567'), 1234567);
  assert.ok(Number.isNaN(CC.parseMoney('abc')));
  assert.match(CC.money(1234.5), /R\$\s1\.234,50/);
  assert.match(CC.signed(-10), /^− R\$/);
  assert.equal(CC.moneyShort(86000), 'R$ 86 mil');
});

test('fila: envia com client_id, anexa a foto e só então sai da fila', async () => {
  const { CC, db } = load();
  const calls = [];
  CC.api = async (route, opts) => { calls.push([route, opts && opts.body]); return route === '/lancamentos' ? { status: 201, data: { id: 42 } } : { status: 201, data: {} }; };
  await CC.queue.add({ client_id: 'a1', payload: { valor: 10, descricao: 'x' }, foto: { nome: 'n.jpg', tipo: 'image/jpeg', conteudoBase64: 'AAA' }, obra_nome: 'Obra' });
  assert.equal(calls[0][0], '/lancamentos');
  assert.equal(calls[0][1].client_id, 'a1');
  assert.equal(calls[1][0], '/anexos/lancamento/42');
  assert.equal(db.size, 0);
  assert.equal(CC.queue.state.pending, 0);
});

test('fila: 409 do anexo conta como já enviado; reenvio com lançamento já criado não repete o POST', async () => {
  const { CC, db } = load();
  const calls = [];
  CC.api = async (route) => {
    calls.push(route);
    if (route.startsWith('/anexos')) throw new CC.ApiError(409, 'Este mesmo arquivo já está anexado');
    return { status: 200, data: { id: 7, replayed: true } };
  };
  await CC.store.put('fila', { client_id: 'b2', payload: {}, foto: { conteudoBase64: 'A' }, estado: 'fila', lancamento_id: 7, criado_em: 1, owner: '1' });
  await CC.queue.run();
  assert.deepEqual(calls, ['/anexos/lancamento/7']);
  assert.equal(db.size, 0);
});

test('fila: sem rede o item continua; erro de dados fica marcado e não trava os outros', async () => {
  const { CC, db } = load();
  CC.api = async () => { throw new CC.ApiError(0, 'Sem internet.'); };
  await CC.queue.add({ client_id: 'c3', payload: {}, foto: null, obra_nome: 'Obra' });
  assert.equal(db.get('fila:c3').estado, 'fila');
  assert.equal(CC.queue.state.pending, 1);

  let n = 0;
  CC.api = async () => { n += 1; if (n === 1) throw new CC.ApiError(400, 'Centro de custo ou categoria não encontrado.'); return { status: 201, data: { id: 9 } }; };
  await CC.store.put('fila', { client_id: 'd4', payload: {}, foto: null, estado: 'fila', criado_em: Date.now() + 1000, owner: '1' });
  await CC.queue.run();
  assert.equal(db.get('fila:c3').estado, 'erro');
  assert.match(db.get('fila:c3').erro, /não encontrado/);
  assert.equal(db.has('fila:d4'), false, 'o item seguinte foi enviado');
  assert.equal(CC.queue.state.errors, 1);
  await CC.queue.discard('c3');
  assert.equal(CC.queue.state.errors, 0);
});

test('fila: offline não tenta enviar e 5xx para a fila para tentar depois', async () => {
  const off = load({ online: false });
  let called = false;
  off.CC.api = async () => { called = true; return { status: 201, data: { id: 1 } }; };
  await off.CC.queue.add({ client_id: 'e5', payload: {}, foto: null });
  assert.equal(called, false);

  const { CC, db } = load();
  CC.api = async () => { throw new CC.ApiError(503, 'Indisponível'); };
  await CC.queue.add({ client_id: 'f6', payload: {}, foto: null });
  assert.equal(db.get('fila:f6').estado, 'fila');
});

test('fila e cache separados por conta: outra conta não envia nem vê itens alheios', async () => {
  const { CC, db, context } = load();
  const sent = [];
  CC.api = async (route, opts) => { sent.push(opts && opts.body && opts.body.client_id); return { status: 201, data: { id: 5 } }; };
  await CC.store.put('fila', { client_id: 'de-outra-conta', owner: '2', payload: {}, foto: null, estado: 'fila', criado_em: 1 });
  await CC.store.put('fila', { client_id: 'sem-dono', payload: {}, foto: null, estado: 'fila', criado_em: 2 });
  await CC.queue.add({ client_id: 'minha', payload: {}, foto: null });
  assert.deepEqual(sent, ['minha']);
  assert.ok(db.has('fila:de-outra-conta'));
  assert.ok(db.has('fila:sem-dono'));
  assert.equal((await CC.queue.mine()).length, 0);
  // Cache com a chave da conta.
  CC.api = async () => ({ status: 200, data: { ok: 1 } });
  await CC.cached('obras', '/centros-custo');
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(db.has('cache:1|obras'));
  context.localStorage.setItem('cc_usuario', JSON.stringify({ id: 2 }));
  CC.api = async () => { throw new CC.ApiError(0, 'Sem internet.'); };
  await assert.rejects(CC.cached('obras', '/centros-custo'), (e) => e.status === 0);
});

test('falha ao gravar no celular sobe para a tela (nada é dado como salvo)', async () => {
  const { CC } = load();
  CC.store.put = async () => { throw new Error('QuotaExceededError'); };
  await assert.rejects(CC.queue.add({ client_id: 'g7', payload: {}, foto: { conteudoBase64: 'x' } }), /Quota/);
});
