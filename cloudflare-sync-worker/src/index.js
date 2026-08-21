const PASSWORD_ITERATIONS = 10000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function text(value) {
  return String(value ?? '').trim();
}

function validCorporateEmail(value) {
  return /^[^\s@]+@rcconstrutec\.com\.br$/i.test(text(value));
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(value));
}

function validRole(value) {
  return ['admin','gestor','supervisor'].includes(text(value));
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

function timingSafeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

async function sha256Text(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(value) {
  return sha256Text(JSON.stringify(value));
}

async function passwordHash(password, saltBase64, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(password)),
    { name:'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits({
    name:'PBKDF2',
    hash:'SHA-256',
    salt:base64ToBytes(saltBase64),
    iterations,
  }, key, 256);
  return bytesToBase64(new Uint8Array(bits));
}

async function makePasswordRecord(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = PASSWORD_ITERATIONS;
  return {
    salt:bytesToBase64(salt),
    hash:await passwordHash(password, bytesToBase64(salt), iterations),
    iterations,
  };
}

function dateValue(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : 0;
}

async function consumeRate(db, ip, scope = 'api', limit = 5000) {
  const now = Math.floor(Date.now() / 1000);
  const hour = Math.floor(now / 3600);
  const bucket = `${scope}:${ip || 'unknown'}:${hour}`;
  const current = await db.prepare('SELECT count FROM sync_rate_limits WHERE bucket=?').bind(bucket).first();
  if (!current) {
    await db.prepare('INSERT INTO sync_rate_limits(bucket,count,expires_at) VALUES(?,?,?)')
      .bind(bucket, 1, (hour + 2) * 3600).run();
    return true;
  }
  if (Number(current.count) >= limit) return false;
  await db.prepare('UPDATE sync_rate_limits SET count=count+1 WHERE bucket=?').bind(bucket).run();
  if (Math.random() < 0.03) {
    await db.prepare('DELETE FROM sync_rate_limits WHERE expires_at < ?').bind(now).run();
    await db.prepare('DELETE FROM cloud_sessions WHERE expires_at < ?').bind(now).run();
  }
  return true;
}

function publicUser(row) {
  return {
    id:row.id,
    name:row.name,
    email:row.email,
    role:row.role,
    active:Boolean(row.active),
    createdAt:row.created_at,
    updatedAt:row.updated_at,
    lastLoginAt:row.last_login_at || null,
  };
}

async function createSession(env, user, request) {
  const token = bytesToBase64(crypto.getRandomValues(new Uint8Array(32))).replace(/=+$/,'');
  const tokenHash = await sha256Text(token);
  const nowIso = new Date().toISOString();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 8 * 3600;
  const instanceId = text(request.headers.get('x-instance-id')) || null;
  const instanceName = text(request.headers.get('x-instance-name')) || null;
  await env.DB.prepare(`
    INSERT INTO cloud_sessions(token_hash,user_id,org_id,instance_id,instance_name,created_at,expires_at,last_seen_at)
    VALUES(?,?,?,?,?,?,?,?)
  `).bind(tokenHash,user.id,user.org_id,instanceId,instanceName,nowIso,expiresAt,nowIso).run();
  return { token, expiresAt };
}

async function sessionUser(request, env) {
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const tokenHash = await sha256Text(token);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(`
    SELECT s.token_hash,s.expires_at,u.*
    FROM cloud_sessions s
    JOIN cloud_users u ON u.id=s.user_id AND u.org_id=s.org_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.active=1
  `).bind(tokenHash,now).first();
  if (!row) return null;
  await env.DB.prepare('UPDATE cloud_sessions SET last_seen_at=? WHERE token_hash=?')
    .bind(new Date().toISOString(),tokenHash).run();
  return row;
}

async function requireSession(request, env, roles = []) {
  const user = await sessionUser(request, env);
  if (!user) return { error:'Sessao invalida ou expirada.', status:401 };
  if (roles.length && !roles.includes(user.role)) return { error:'Sem permissao para esta acao.', status:403 };
  return { user };
}

async function handleLogin(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ ok:false,error:'JSON invalido.' },400); }
  const email = text(body?.email).toLowerCase();
  const password = String(body?.password || '');
  if (!validCorporateEmail(email) || !password) return json({ ok:false,error:'E-mail ou senha invalidos.' },401);
  const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM cloud_users WHERE org_id=?').bind('rcconstrutec.com.br').first();
  if (Number(count?.total || 0) === 0) return json({ ok:false,error:'Diretorio corporativo ainda nao inicializado.',code:'DIRECTORY_EMPTY' },409);
  const user = await env.DB.prepare('SELECT * FROM cloud_users WHERE org_id=? AND email=?').bind('rcconstrutec.com.br',email).first();
  if (!user || !user.active) return json({ ok:false,error:'E-mail ou senha invalidos.' },401);
  const iterations = Number(user.password_iterations || PASSWORD_ITERATIONS);
  if (iterations > PASSWORD_ITERATIONS) {
    return json({ ok:false,error:'Credencial central precisa ser reinicializada para o Workers Free.',code:'PASSWORD_PROFILE_LEGACY' },409);
  }
  const hash = await passwordHash(password,user.password_salt,iterations);
  if (!timingSafeEqual(hash,user.password_hash)) return json({ ok:false,error:'E-mail ou senha invalidos.' },401);
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE cloud_users SET last_login_at=?,updated_at=updated_at WHERE id=?').bind(now,user.id).run();
  user.last_login_at = now;
  const session = await createSession(env,user,request);
  return json({ ok:true, sessionToken:session.token, expiresAt:session.expiresAt, user:publicUser(user) });
}

async function handleBootstrap(request, env) {
  const key = request.headers.get('x-sync-key') || '';
  if (!env.SYNC_SHARED_KEY || key !== env.SYNC_SHARED_KEY) return json({ ok:false,error:'Nao autorizado.' },401);
  const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM cloud_users WHERE org_id=?').bind('rcconstrutec.com.br').first();
  if (Number(count?.total || 0) > 0) return json({ ok:false,error:'Diretorio corporativo ja inicializado.' },409);
  let body;
  try { body = await request.json(); } catch { return json({ ok:false,error:'JSON invalido.' },400); }
  const name = text(body?.name).slice(0,120);
  const email = text(body?.email).toLowerCase();
  const password = String(body?.password || '');
  const role = validRole(body?.role) ? body.role : 'admin';
  if (!name || !validCorporateEmail(email) || password.length < 10) return json({ ok:false,error:'Dados de bootstrap invalidos.' },400);
  const record = await makePasswordRecord(password);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO cloud_users(id,org_id,name,email,password_salt,password_hash,password_iterations,role,active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,1,?,?)
  `).bind(id,'rcconstrutec.com.br',name,email,record.salt,record.hash,record.iterations,role,now,now).run();
  return json({ ok:true,user:{ id,name,email,role,active:true,createdAt:now,updatedAt:now,lastLoginAt:null } },201);
}

async function handleListUsers(request, env) {
  const auth = await requireSession(request,env,['admin']);
  if (auth.error) return json({ ok:false,error:auth.error },auth.status);
  const rows = (await env.DB.prepare(`
    SELECT id,name,email,role,active,created_at,updated_at,last_login_at
    FROM cloud_users WHERE org_id=? ORDER BY active DESC,name,email
  `).bind(auth.user.org_id).all()).results || [];
  return json({ ok:true, users:rows.map(publicUser) });
}

async function handleCreateUser(request, env) {
  const auth = await requireSession(request,env,['admin']);
  if (auth.error) return json({ ok:false,error:auth.error },auth.status);
  let body;
  try { body = await request.json(); } catch { return json({ ok:false,error:'JSON invalido.' },400); }
  const name = text(body?.name).slice(0,120);
  const email = text(body?.email).toLowerCase();
  const password = String(body?.password || '');
  const role = text(body?.role);
  if (!name || !validCorporateEmail(email) || password.length < 10 || !validRole(role)) {
    return json({ ok:false,error:'Preencha nome, e-mail corporativo, senha de 10+ caracteres e perfil valido.' },400);
  }
  const exists = await env.DB.prepare('SELECT id FROM cloud_users WHERE org_id=? AND email=?').bind(auth.user.org_id,email).first();
  if (exists) return json({ ok:false,error:'Ja existe um usuario com este e-mail.' },409);
  const record = await makePasswordRecord(password);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO cloud_users(id,org_id,name,email,password_salt,password_hash,password_iterations,role,active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,1,?,?)
  `).bind(id,auth.user.org_id,name,email,record.salt,record.hash,record.iterations,role,now,now).run();
  return json({ ok:true,user:{ id,name,email,role,active:true,createdAt:now,updatedAt:now,lastLoginAt:null } },201);
}

async function handleUserStatus(request, env) {
  const auth = await requireSession(request,env,['admin']);
  if (auth.error) return json({ ok:false,error:auth.error },auth.status);
  let body;
  try { body = await request.json(); } catch { return json({ ok:false,error:'JSON invalido.' },400); }
  const email = text(body?.email).toLowerCase();
  const active = body?.active === true ? 1 : 0;
  if (!validCorporateEmail(email)) return json({ ok:false,error:'E-mail invalido.' },400);
  if (email === auth.user.email && active === 0) return json({ ok:false,error:'Voce nao pode desativar o proprio acesso.' },400);
  const result = await env.DB.prepare('UPDATE cloud_users SET active=?,updated_at=? WHERE org_id=? AND email=?')
    .bind(active,new Date().toISOString(),auth.user.org_id,email).run();
  if (!result.meta?.changes) return json({ ok:false,error:'Usuario nao encontrado.' },404);
  if (!active) {
    await env.DB.prepare(`DELETE FROM cloud_sessions WHERE user_id IN (SELECT id FROM cloud_users WHERE org_id=? AND email=?)`)
      .bind(auth.user.org_id,email).run();
  }
  return json({ ok:true });
}

async function handleChangePassword(request, env) {
  const auth = await requireSession(request,env);
  if (auth.error) return json({ ok:false,error:auth.error },auth.status);
  let body;
  try { body = await request.json(); } catch { return json({ ok:false,error:'JSON invalido.' },400); }
  const currentPassword = String(body?.currentPassword || '');
  const newPassword = String(body?.newPassword || '');
  if (newPassword.length < 10) return json({ ok:false,error:'A nova senha precisa ter pelo menos 10 caracteres.' },400);
  const iterations = Number(auth.user.password_iterations || PASSWORD_ITERATIONS);
  if (iterations > PASSWORD_ITERATIONS) return json({ ok:false,error:'Credencial central precisa ser reinicializada.',code:'PASSWORD_PROFILE_LEGACY' },409);
  const currentHash = await passwordHash(currentPassword,auth.user.password_salt,iterations);
  if (!timingSafeEqual(currentHash,auth.user.password_hash)) return json({ ok:false,error:'Senha atual incorreta.' },401);
  const record = await makePasswordRecord(newPassword);
  const now = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE cloud_users SET password_salt=?,password_hash=?,password_iterations=?,updated_at=? WHERE id=?
  `).bind(record.salt,record.hash,record.iterations,now,auth.user.id).run();
  await env.DB.prepare('DELETE FROM cloud_sessions WHERE user_id=? AND token_hash<>?')
    .bind(auth.user.id,await sha256Text((request.headers.get('authorization') || '').slice(7).trim())).run();
  return json({ ok:true });
}

function packageEntities(pack) {
  const mapping = [
    ['categoria', pack.payload?.categories],
    ['obra', pack.payload?.costCenters],
    ['fornecedor', pack.payload?.suppliers],
    ['lancamento', pack.payload?.transactions],
  ];
  const entities = [];
  for (const [type, items] of mapping) {
    if (!Array.isArray(items)) throw new Error(`Secao ausente: ${type}`);
    for (const item of items) {
      if (!validUuid(item?.publicId)) throw new Error(`${type} com publicId invalido`);
      entities.push({ type, item });
    }
  }
  return entities;
}

async function recordEvent(env, meta, type, item, hash, revision, resolution) {
  const createdAt = new Date().toISOString();
  const inserted = await env.DB.prepare(`
    INSERT INTO sync_events(
      org_id,entity_type,public_id,revision,updated_at,payload,payload_hash,
      source_instance_id,source_instance_name,source_user_email,resolution,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id
  `).bind(
    meta.orgId, type, item.publicId, revision, item.updatedAt || createdAt,
    JSON.stringify(item), hash, meta.instanceId, meta.instanceName,
    meta.userEmail, resolution, createdAt
  ).first();
  return Number(inserted?.id || 0);
}

async function upsertEntity(env, meta, type, incomingItem) {
  const incoming = structuredClone(incomingItem);
  incoming.revision = Math.max(1, Number(incoming.revision || 1));
  const incomingHash = await sha256(incoming);
  const existing = await env.DB.prepare(`
    SELECT revision,updated_at,payload,payload_hash
    FROM sync_entities WHERE org_id=? AND entity_type=? AND public_id=?
  `).bind(meta.orgId, type, incoming.publicId).first();

  if (!existing) {
    const eventId = await recordEvent(env, meta, type, incoming, incomingHash, incoming.revision, 'created');
    const now = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO sync_entities(
        org_id,entity_type,public_id,revision,updated_at,payload,payload_hash,
        source_instance_id,source_instance_name,source_user_email,event_id,created_at,server_updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      meta.orgId,type,incoming.publicId,incoming.revision,incoming.updatedAt || now,
      JSON.stringify(incoming),incomingHash,meta.instanceId,meta.instanceName,meta.userEmail,
      eventId,now,now
    ).run();
    return { action:'created', publicId:incoming.publicId, revision:incoming.revision };
  }

  if (existing.payload_hash === incomingHash) {
    return { action:'unchanged', publicId:incoming.publicId, revision:Number(existing.revision) };
  }

  const localRevision = Number(existing.revision || 1);
  const incomingRevision = Number(incoming.revision || 1);
  let winner = incoming;
  let revision = incomingRevision;
  let resolution = 'incoming_newer';

  if (incomingRevision < localRevision) {
    return { action:'server_newer', publicId:incoming.publicId, revision:localRevision };
  }

  if (incomingRevision === localRevision) {
    if (dateValue(incoming.updatedAt) < dateValue(existing.updated_at)) {
      return { action:'server_newer', publicId:incoming.publicId, revision:localRevision };
    }
    revision = localRevision + 1;
    winner = { ...incoming, revision };
    resolution = 'same_revision_latest_wins';
  }

  const hash = await sha256(winner);
  const eventId = await recordEvent(env, meta, type, winner, hash, revision, resolution);
  const now = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE sync_entities SET revision=?,updated_at=?,payload=?,payload_hash=?,
      source_instance_id=?,source_instance_name=?,source_user_email=?,event_id=?,server_updated_at=?
    WHERE org_id=? AND entity_type=? AND public_id=?
  `).bind(
    revision,winner.updatedAt || now,JSON.stringify(winner),hash,
    meta.instanceId,meta.instanceName,meta.userEmail,eventId,now,
    meta.orgId,type,winner.publicId
  ).run();
  return { action:'updated', publicId:winner.publicId, revision };
}

async function buildSnapshot(env, orgId) {
  const rows = (await env.DB.prepare(`
    SELECT entity_type,payload,event_id FROM sync_entities
    WHERE org_id=? ORDER BY entity_type,public_id
  `).bind(orgId).all()).results || [];
  const payload = { categories:[], costCenters:[], suppliers:[], transactions:[] };
  let cursor = 0;
  for (const row of rows) {
    const item = JSON.parse(row.payload);
    if (row.entity_type === 'categoria') payload.categories.push(item);
    else if (row.entity_type === 'obra') payload.costCenters.push(item);
    else if (row.entity_type === 'fornecedor') payload.suppliers.push(item);
    else if (row.entity_type === 'lancamento') payload.transactions.push(item);
    cursor = Math.max(cursor, Number(row.event_id || 0));
  }
  return {
    formatVersion:3,
    packageId:crypto.randomUUID(),
    generatedAt:new Date().toISOString(),
    source:{ id:'00000000-0000-4000-8000-000000000001', name:'Construtec Cloud' },
    payload,
    payloadHash:await sha256(payload),
    cursor,
  };
}

async function authorizeSync(request, env) {
  const bearerUser = await sessionUser(request, env);
  const instanceId = text(request.headers.get('x-instance-id'));
  const instanceName = text(request.headers.get('x-instance-name')) || 'Instalacao';
  if (!validUuid(instanceId)) return { error:'Instalacao invalida.' };
  if (bearerUser) {
    return { orgId:bearerUser.org_id, userEmail:bearerUser.email, instanceId, instanceName };
  }
  const key = request.headers.get('x-sync-key') || '';
  if (!env.SYNC_SHARED_KEY || key !== env.SYNC_SHARED_KEY) return { error:'Nao autorizado.' };
  const userEmail = text(request.headers.get('x-user-email')).toLowerCase();
  if (!validCorporateEmail(userEmail)) return { error:'Use uma conta @rcconstrutec.com.br para sincronizar.' };
  return { orgId:'rcconstrutec.com.br', userEmail, instanceId, instanceName };
}

async function touchClient(env, meta, request) {
  const now = new Date().toISOString();
  const appVersion = text(request.headers.get('x-app-version'));
  const platform = text(request.headers.get('x-platform'));
  await env.DB.prepare(`
    INSERT INTO sync_clients(org_id,instance_id,instance_name,last_user_email,app_version,platform,first_seen_at,last_seen_at)
    VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(org_id,instance_id) DO UPDATE SET
      instance_name=excluded.instance_name,last_user_email=excluded.last_user_email,
      app_version=excluded.app_version,platform=excluded.platform,last_seen_at=excluded.last_seen_at
  `).bind(meta.orgId,meta.instanceId,meta.instanceName,meta.userEmail,appVersion,platform,now,now).run();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok:true, service:'centro-custos-sync', mode:'cloudflare-d1', auth:'central', passwordProfile:'workers-free' });
    }

    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const isLogin = request.method === 'POST' && url.pathname === '/v1/auth/login';
    const allowed = await consumeRate(env.DB, ip, isLogin ? 'login' : 'api', isLogin ? 60 : 5000);
    if (!allowed) return json({ ok:false, error:'Limite temporario de requisicoes atingido.' }, 429);

    if (request.method === 'POST' && url.pathname === '/v1/auth/login') return handleLogin(request, env);
    if (request.method === 'POST' && url.pathname === '/v1/auth/bootstrap') return handleBootstrap(request, env);
    if (request.method === 'POST' && url.pathname === '/v1/auth/change-password') return handleChangePassword(request, env);
    if (request.method === 'GET' && url.pathname === '/v1/users') return handleListUsers(request, env);
    if (request.method === 'POST' && url.pathname === '/v1/users') return handleCreateUser(request, env);
    if (request.method === 'POST' && url.pathname === '/v1/users/status') return handleUserStatus(request, env);

    const meta = await authorizeSync(request, env);
    if (meta.error) return json({ ok:false, error:meta.error }, 401);
    await touchClient(env, meta, request);

    if (request.method === 'GET' && url.pathname === '/v1/sync/snapshot') {
      return json({ ok:true, snapshot:await buildSnapshot(env, meta.orgId) });
    }

    if (request.method === 'POST' && url.pathname === '/v1/sync') {
      let body;
      try { body = await request.json(); } catch { return json({ ok:false,error:'JSON invalido.' },400); }
      if (Number(body?.formatVersion) !== 3 || !body?.payload) return json({ ok:false,error:'Pacote de sincronizacao invalido.' },400);
      let entities;
      try { entities = packageEntities(body); } catch (error) { return json({ ok:false,error:error.message },400); }
      const results = [];
      for (const entity of entities) results.push(await upsertEntity(env, meta, entity.type, entity.item));
      const snapshot = await buildSnapshot(env, meta.orgId);
      return json({ ok:true, results, snapshot });
    }

    return json({ ok:false, error:'Rota nao encontrada.' }, 404);
  },
};
