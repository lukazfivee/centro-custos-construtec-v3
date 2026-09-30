const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { setup, hasSQLite } = require('./password-reset-fixture.test');
const maybe = hasSQLite ? test : test.skip;
const worker = path.join(__dirname, '..', 'cloudflare', 'center-container');

// Fase 5: cadastro pelo app com código da empresa e aprovação, convite e tour.
async function context() {
  const base = await setup();
  const signup = await import(pathToFileURL(path.join(worker, 'signup.js')).href);
  const mails = [];
  base.env.EMAIL_PROVIDER_API_KEY = 're_teste';
  base.env.EMAIL_FROM = 'Construtec <no-reply@teste>';
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) === 'https://api.resend.com/emails') { mails.push(JSON.parse(init.body)); return Response.json({ id: 'm1' }); }
    return original(url, init);
  };
  const call = async (method, pathname, { body, token, headers: extra = {} } = {}) => {
    if (!signup.isSignupRoute(pathname)) return base.call(method, pathname, { body, token, headers: extra });
    const headers = { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.20', ...extra };
    if (token) headers.authorization = `Bearer ${token}`;
    const request = new Request(`https://centro.test${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const response = await signup.handleSignup(request, base.env, new URL(request.url));
    return { status: response.status, data: await response.json() };
  };
  return { ...base, call, mails, restore: () => { globalThis.fetch = original; } };
}

const person = { name: 'Paula Técnica', email: 'paula@parceira.com.br', phone: '(71) 99999-1234', password: 'Obra2026!', acceptTerms: true };

maybe('pedido com código fica pendente, avisa o admin e só entra depois de aprovado', async () => {
  const { call, token, env, mails, restore } = await context();
  try {
    const listed = await call('GET', '/v1/signup/requests', { token });
    const code = listed.data.code;
    assert.match(code, /^CONST-[A-Z2-9]{6}$/);
    assert.equal((await call('POST', '/v1/signup/request', { body: { ...person, companyCode: 'errado' } })).data.code, 'CODE_INVALID');
    assert.equal((await call('POST', '/v1/signup/request', { body: { ...person, companyCode: code, password: 'fraca' } })).data.code, 'PASSWORD_WEAK');
    assert.equal((await call('POST', '/v1/signup/request', { body: { ...person, companyCode: code, acceptTerms: false } })).data.code, 'TERMS_REQUIRED');
    const sent = await call('POST', '/v1/signup/request', { body: { ...person, companyCode: code.toLowerCase().replace('-', ' ') } });
    assert.deepEqual(sent.data, { ok: true, status: 'pending' });
    const notice = env.DB.raw.prepare("SELECT title,link FROM notifications WHERE type='pedido_acesso'").get();
    assert.deepEqual({ ...notice }, { title: 'Novo pedido de acesso', link: 'centro-custos?pedidos=1' });
    assert.equal((await call('POST', '/v1/auth/login', { body: { email: person.email, password: person.password } })).status, 401);

    const pending = (await call('GET', '/v1/signup/requests', { token })).data.requests;
    assert.equal(pending.length, 1);
    assert.equal(pending[0].phone, '71999991234');
    await call('POST', '/v1/signup/approve', { token, body: { id: pending[0].id, role: 'gestor' } });
    assert.match(mails.at(-1).subject, /aprovado/);
    const first = await call('POST', '/v1/auth/login', { body: { email: person.email, password: person.password } });
    assert.equal(first.status, 200);
    assert.equal(first.data.user.role, 'gestor');
    assert.equal(first.data.tour, true);
    assert.equal((await call('POST', '/v1/auth/login', { body: { email: person.email, password: person.password } })).data.tour, false);
    assert.equal((await call('POST', '/v1/signup/request', { body: { ...person, companyCode: code } })).data.code, 'EMAIL_IN_USE');
  } finally { restore(); }
});

maybe('recusa apaga a senha do pedido; trocar o código invalida o antigo', async () => {
  const { call, token, env, restore } = await context();
  try {
    const code = (await call('GET', '/v1/signup/requests', { token })).data.code;
    await call('POST', '/v1/signup/request', { body: { ...person, companyCode: code } });
    const id = (await call('GET', '/v1/signup/requests', { token })).data.requests[0].id;
    await call('POST', '/v1/signup/reject', { token, body: { id } });
    assert.equal(env.DB.raw.prepare('SELECT password_hash FROM signup_requests WHERE id=?').get(id).password_hash, '-');
    const rotated = (await call('POST', '/v1/signup/code/rotate', { token })).data.code;
    assert.notEqual(rotated, code);
    assert.equal((await call('POST', '/v1/signup/request', { body: { ...person, companyCode: code } })).data.code, 'CODE_INVALID');
  } finally { restore(); }
});

maybe('convite por e-mail cria a conta aprovada, uma vez, só para o e-mail convidado', async () => {
  const { call, token, env, mails, restore } = await context();
  try {
    await call('POST', '/v1/signup/invite', { token, body: { email: 'novo@rcconstrutec.com.br', role: 'supervisor' } });
    const link = mails.at(-1).text.match(/https:\/\/\S+\/cadastro#\S+/)[0];
    const fragment = new URLSearchParams(link.split('#')[1]);
    assert.equal(fragment.get('email'), 'novo@rcconstrutec.com.br');
    const inviteToken = fragment.get('convite');
    const other = await call('POST', '/v1/signup/request', { body: { ...person, inviteToken } });
    assert.equal(other.data.code, 'INVITE_INVALID', 'convite só vale para o e-mail convidado');
    const ok = await call('POST', '/v1/signup/request', { body: { ...person, email: 'novo@rcconstrutec.com.br', inviteToken } });
    assert.deepEqual(ok.data, { ok: true, status: 'approved' });
    assert.equal(env.DB.raw.prepare("SELECT role FROM cloud_users WHERE email='novo@rcconstrutec.com.br'").get().role, 'supervisor');
    // Sem papel novo no convite, a conta nasce como tecnico (explicito, para entrar sem obras).
    assert.equal(env.DB.raw.prepare("SELECT suite_role FROM cloud_users WHERE email='novo@rcconstrutec.com.br'").get().suite_role, 'tecnico');

    const again = await call('POST', '/v1/signup/request', { body: { ...person, email: 'outro@rcconstrutec.com.br', inviteToken } });
    assert.equal(again.data.code, 'INVITE_INVALID');
  } finally { restore(); }
});

maybe('convite e aprovacao com papel novo e apps', async () => {
  const { call, token, env, mails, restore } = await context();
  try {
    await call('POST', '/v1/signup/invite', { token, body: { email: 'eng@rcconstrutec.com.br', suiteRole: 'engenharia', apps: ['orcamentos'] } });
    const inviteToken = new URLSearchParams(mails.at(-1).text.match(/https:\/\/\S+\/cadastro#\S+/)[0].split('#')[1]).get('convite');
    const listed = await call('GET', '/v1/signup/requests', { token });
    assert.equal(listed.data.invites[0].suiteRole, 'engenharia');
    assert.equal((await call('POST', '/v1/signup/request', { body: { ...person, email: 'eng@rcconstrutec.com.br', inviteToken } })).status, 200);
    const row = env.DB.raw.prepare("SELECT role,suite_role,apps FROM cloud_users WHERE email='eng@rcconstrutec.com.br'").get();
    assert.deepEqual({ ...row }, { role: 'supervisor', suite_role: 'engenharia', apps: '["orcamentos"]' });

    await call('POST', '/v1/signup/request', { body: { ...person, email: 'com@rcconstrutec.com.br', companyCode: (await call('GET', '/v1/signup/requests', { token })).data.code } });
    const pending = (await call('GET', '/v1/signup/requests', { token })).data.requests[0];
    await call('POST', '/v1/signup/approve', { token, body: { id: pending.id, suiteRole: 'comercial' } });
    assert.deepEqual({ ...env.DB.raw.prepare("SELECT role,suite_role FROM cloud_users WHERE email='com@rcconstrutec.com.br'").get() }, { role: 'supervisor', suite_role: 'comercial' });
  } finally { restore(); }
});

maybe('rota interna exige a chave e um admin; quem não é admin não gerencia', async () => {
  const { call, token, env, restore } = await context();
  try {
    const adminId = env.DB.raw.prepare("SELECT id FROM cloud_users WHERE role='admin'").get().id;
    assert.equal((await call('POST', '/v1/internal/signup', { body: { action: 'list', actorId: adminId } })).status, 403);
    const listed = await call('POST', '/v1/internal/signup', { headers: { 'x-sync-key': env.SYNC_SHARED_KEY }, body: { action: 'list', actorId: adminId } });
    assert.equal(listed.status, 200);
    assert.match(listed.data.code, /^CONST-/);
    assert.equal((await call('GET', '/v1/signup/requests')).status, 401);
    assert.ok(token);
  } finally { restore(); }
});
