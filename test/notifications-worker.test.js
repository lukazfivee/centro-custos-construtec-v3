const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { setup, hasSQLite } = require('./password-reset-fixture.test');
const maybe = hasSQLite ? test : test.skip;
const worker = path.join(__dirname, '..', 'cloudflare', 'center-container');

// Conta de serviço de mentira (chave RSA gerada aqui) e Google simulado.
async function fakeFirebase(env) {
  const { privateKey } = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', privateKey)).toString('base64');
  env.FCM_SERVICE_ACCOUNT = `\uFEFF${JSON.stringify({ project_id: 'suite-teste', client_email: 'push@suite-teste.iam.gserviceaccount.com',
    private_key: `-----BEGIN PRIVATE KEY-----\n${der}\n-----END PRIVATE KEY-----\n`, token_uri: 'https://oauth2.googleapis.com/token' })}`;
  const sent = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'ya29.teste', expires_in: 3600 });
    if (target.startsWith('https://fcm.googleapis.com/v1/projects/suite-teste/messages:send')) {
      const message = JSON.parse(init.body).message;
      sent.push(message);
      if (message.token.startsWith('vencido')) return Response.json({ error: { details: [{ errorCode: 'UNREGISTERED' }] } }, { status: 404 });
      return Response.json({ name: 'projects/suite-teste/messages/1' });
    }
    return original(url, init);
  };
  return { sent, restore: () => { globalThis.fetch = original; } };
}

async function context() {
  const base = await setup();
  const notifications = await import(pathToFileURL(path.join(worker, 'notifications.js')).href);
  (await import(pathToFileURL(path.join(worker, 'fcm.js')).href)).resetFcmCacheForTests();
  const call = async (method, pathname, { body, token, headers: extra = {} } = {}) => {
    if (!notifications.isNotificationRoute(pathname)) return base.call(method, pathname, { body, token, headers: extra });
    const headers = { 'content-type': 'application/json', ...extra };
    if (token) headers.authorization = `Bearer ${token}`;
    const request = new Request(`https://centro.test${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const response = await notifications.handleNotifications(request, base.env, new URL(request.url));
    return { status: response.status, data: await response.json() };
  };
  const firebase = await fakeFirebase(base.env);
  const userId = base.env.DB.raw.prepare('SELECT id FROM cloud_users').get().id;
  const sync = { 'x-sync-key': base.env.SYNC_SHARED_KEY };
  return { ...base, call, firebase, notifications, userId, sync };
}

const device = { 'x-instance-id': 'android-a17', 'x-instance-name': 'Android · Samsung SM-A175F' };
const FCM_TOKEN = `fcm-${'x'.repeat(40)}`;

maybe('aparelho registrado recebe o teste e o aviso vai para a central', async () => {
  const { call, token, firebase, sync, userId } = await context();
  try {
    assert.equal((await call('POST', '/v1/push/register', { token, headers: device, body: { fcmToken: FCM_TOKEN } })).status, 200);
    const test = await call('POST', '/v1/notifications/test', { token });
    assert.deepEqual([test.data.pushed, test.data.devices], [1, 1]);
    assert.equal(firebase.sent[0].token, FCM_TOKEN);
    assert.equal(firebase.sent[0].android.notification.channel_id, 'avisos');
    const listed = await call('POST', '/v1/internal/notifications', { headers: sync, body: { action: 'list', userId } });
    assert.equal(listed.data.unread, 1);
    assert.equal(listed.data.items[0].title, 'Notificação de teste');
  } finally { firebase.restore(); }
});

maybe('aviso para todos não repete, respeita preferência e marca como lido', async () => {
  const { call, token, firebase, sync, userId } = await context();
  try {
    const event = { audience: 'all', type: 'conta_vencer', app: 'centro-custos', title: 'Contas a vencer', body: '2 contas vencem hoje.', link: 'centro-custos', dedupeKey: 'contas:2026-09-27' };
    assert.equal((await call('POST', '/v1/internal/notify', { body: event })).status, 403);
    assert.equal((await call('POST', '/v1/internal/notify', { headers: sync, body: event })).data.created, 1);
    assert.equal((await call('POST', '/v1/internal/notify', { headers: sync, body: event })).data.created, 0);
    await call('PUT', '/v1/notifications/prefs', { token, body: { type: 'acima_orcado', enabled: false } });
    const muted = await call('POST', '/v1/internal/notify', { headers: sync, body: { ...event, type: 'acima_orcado', dedupeKey: 'orcado:1:x' } });
    assert.equal(muted.data.created, 0);
    assert.deepEqual((await call('GET', '/v1/notifications/prefs', { token })).data.prefs,
      { proposta_aprovada: true, acima_orcado: false, conta_vencer: true, novo_acesso: true, pedido_acesso: true });
    const listed = await call('GET', '/v1/notifications', { token });
    assert.equal(listed.data.items[0].link, 'centro-custos');
    const read = await call('POST', '/v1/internal/notifications', { headers: sync, body: { action: 'read', userId, all: true } });
    assert.equal(read.data.unread, 0);
    const badLink = await call('POST', '/v1/internal/notify', { headers: sync, body: { ...event, link: 'javascript:alert(1)', dedupeKey: 'outra' } });
    assert.equal(badLink.data.created, 1);
    assert.equal((await call('GET', '/v1/notifications', { token })).data.items[0].link, null);
  } finally { firebase.restore(); }
});

maybe('novo aparelho avisa o dono; Sair desliga o push do aparelho', async () => {
  const { call, email, password, firebase, env } = await context();
  try {
    const first = await call('POST', '/v1/auth/login', { headers: device, body: { email, password } });
    let rows = env.DB.raw.prepare("SELECT type FROM notifications WHERE type='novo_acesso'").all();
    assert.equal(rows.length, 0, 'primeiro aparelho não gera aviso');
    await call('POST', '/v1/push/register', { token: first.data.sessionToken, headers: device, body: { fcmToken: FCM_TOKEN } });
    await call('POST', '/v1/auth/login', { headers: { 'x-instance-id': 'android-outro', 'x-instance-name': 'Android · Moto G' }, body: { email, password } });
    rows = env.DB.raw.prepare("SELECT body FROM notifications WHERE type='novo_acesso'").all();
    assert.equal(rows.length, 1);
    assert.match(rows[0].body, /Moto G/);
    assert.equal(firebase.sent.at(-1).token, FCM_TOKEN);
    await call('POST', '/v1/auth/logout', { token: first.data.sessionToken });
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM push_devices').get().n, 0);
  } finally { firebase.restore(); }
});

maybe('token que o Firebase não reconhece é apagado', async () => {
  const { call, token, firebase, env } = await context();
  try {
    await call('POST', '/v1/push/register', { token, headers: device, body: { fcmToken: `vencido-${'y'.repeat(40)}` } });
    assert.equal((await call('POST', '/v1/notifications/test', { token })).data.pushed, 0);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM push_devices').get().n, 0);
    assert.equal((await call('POST', '/v1/push/register', { token, body: { fcmToken: FCM_TOKEN } })).data.code, 'DEVICE_INVALID');
  } finally { firebase.restore(); }
});
