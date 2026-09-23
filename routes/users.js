const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDb } = require('../db');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { parsePagination, wantsPagination, paginationMeta } = require('../lib/pagination');
const { recordAudit } = require('../services/audit');
const cloudAuth = require('../services/cloudAuth');
const { mirrorCloudUser, retire } = require('../services/cloudUserMirror');

const router = express.Router();
router.use(autenticar, exigirPapel('admin'));

const PUBLIC_COLUMNS = row => row && ({ id:row.id, nome:row.name, email:row.email, role:row.role, ativo:row.active, created_at:row.created_at });

async function upsertRemoteUser(remote) {
  return PUBLIC_COLUMNS(await mirrorCloudUser(getDb(), remote));
}

// Upsert em lote (evita N+1 quando ha muitos usuarios remotos): normaliza/dedup
// os e-mails, faz uma unica busca de existentes (WHERE email = ANY), depois
// um UPDATE em lote e um INSERT em lote, em vez de uma consulta por usuario.
async function upsertRemoteUsers(remoteList) {
  const byEmail = new Map();
  const order = [];
  for (const remote of remoteList) {
    const email = String(remote.email || '').trim().toLowerCase();
    if (!email) continue;
    if (!byEmail.has(email)) order.push(email);
    byEmail.set(email, remote);
  }
  if (!order.length) return [];

  const db = getDb();
  const { rows: existingRows } = await db.query(
    'SELECT id, LOWER(email) AS email, cloud_user_id FROM users WHERE LOWER(email) = ANY($1::text[]) AND deleted_at IS NULL',
    [order]
  );
  const existingByEmail = new Map(existingRows.map(r => [r.email, r]));

  const toUpdate = [];
  const toInsert = [];
  const toRetire = [];
  for (const email of order) {
    const remote = byEmail.get(email);
    const row = existingByEmail.get(email);
    const cloudId = remote.id ? String(remote.id) : null;
    if (row && cloudId && row.cloud_user_id && row.cloud_user_id !== cloudId) {
      toRetire.push(row.id);
      toInsert.push({ remote, email });
    } else if (row) toUpdate.push({ id: row.id, remote, email });
    else toInsert.push({ remote, email });
  }
  await retire(db, toRetire);

  const resultByEmail = new Map();

  if (toUpdate.length) {
    const ids = toUpdate.map(u => u.id);
    const names = toUpdate.map(u => String(u.remote.name || u.email).slice(0,120));
    const emails = toUpdate.map(u => u.email);
    const roles = toUpdate.map(u => u.remote.role);
    const actives = toUpdate.map(u => u.remote.active !== false);
    const cloudIds = toUpdate.map(u => (u.remote.id ? String(u.remote.id) : null));
    const { rows } = await db.query(`
      UPDATE users AS u SET name=v.name,email=v.email,role=v.role,active=v.active,
        cloud_managed=TRUE,cloud_user_id=COALESCE(v.cloud_user_id,u.cloud_user_id),updated_at=NOW()
      FROM (
        SELECT * FROM unnest($1::int[],$2::text[],$3::text[],$4::text[],$5::boolean[],$6::text[])
          AS t(id,name,email,role,active,cloud_user_id)
      ) AS v
      WHERE u.id = v.id AND u.deleted_at IS NULL
      RETURNING u.id,u.name AS nome,u.email,u.role,u.active AS ativo,u.created_at
    `,[ids,names,emails,roles,actives,cloudIds]);
    for (const row of rows) resultByEmail.set(row.email.toLowerCase(), row);
  }

  if (toInsert.length) {
    // Placeholder de senha inutilizavel (48 bytes aleatorios, nunca exposto e
    // nunca comparado a senha real - usuarios cloud_managed autenticam via
    // cloudAuth). Custo baixo evita que o hashing bcrypt vire o novo gargalo
    // ao inserir muitos usuarios de uma vez; a entropia do segredo aleatorio
    // ja torna forca bruta inviavel independente do custo do hash.
    const hashes = await Promise.all(
      toInsert.map(() => bcrypt.hash(crypto.randomBytes(48).toString('hex'),4))
    );
    const values = [];
    const params = [];
    let p = 0;
    toInsert.forEach(({ remote, email }, i) => {
      const row = [String(remote.name||email).slice(0,120),email,hashes[i],remote.role,remote.active !== false,remote.id ? String(remote.id) : null];
      for (const v of row) { params.push(v); p++; }
      const placeholders = Array.from({ length: row.length }, (_, k) => `$${p - row.length + k + 1}`).join(',');
      values.push(`(${placeholders},TRUE)`);
    });
    const { rows } = await db.query(`
      INSERT INTO users (name,email,password_hash,role,active,cloud_user_id,cloud_managed)
      VALUES ${values.join(',')}
      RETURNING id,name AS nome,email,role,active AS ativo,created_at
    `,params);
    for (const row of rows) resultByEmail.set(row.email.toLowerCase(), row);
  }

  return order.map(email => resultByEmail.get(email)).filter(Boolean);
}

router.get('/', asyncRoute(async (req, res) => {
  if (req.usuario.cloud_managed && req.usuario.cloud_session_token) {
    try {
      const remote = await cloudAuth.listUsers(req.usuario.cloud_session_token);
      const users = await upsertRemoteUsers(remote.users || []);
      return res.json(users);
    } catch (error) {
      if (error.status === 401) throw httpError(401,'Sua sessão corporativa expirou. Entre novamente.');
      throw httpError(503,'Não foi possível carregar os usuários corporativos agora.');
    }
  }

  const usersSelect = 'SELECT id, name AS nome, email, role, active AS ativo, created_at FROM users WHERE deleted_at IS NULL';
  const orderBy = 'active DESC, name';
  if (!wantsPagination(req.query)) {
    const { rows } = await getDb().query(`${usersSelect} ORDER BY ${orderBy} LIMIT 500`);
    res.setHeader('X-Result-Limit', '500');
    return res.json(rows);
  }
  const { page, limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
  const [dataResult, countResult] = await Promise.all([
    getDb().query(`${usersSelect} ORDER BY ${orderBy} LIMIT $1 OFFSET $2`, [limit, offset]),
    getDb().query('SELECT COUNT(*)::int AS total FROM users WHERE deleted_at IS NULL'),
  ]);
  const total = Number(countResult.rows[0]?.total || 0);
  res.setHeader('X-Total-Count', String(total));
  res.json({ itens: dataResult.rows, paginacao: paginationMeta(total, page, limit) });
}));

router.post('/', asyncRoute(async (req, res) => {
  const name = String(req.body.nome || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.senha || '');
  const role = String(req.body.role || '');
  if (!name || !email || !password) throw httpError(400, 'Preencha nome, e-mail e senha.');
  if (password.length < 10) throw httpError(400, 'A senha provisória precisa ter pelo menos 10 caracteres.');
  if (!['admin', 'gestor', 'supervisor'].includes(role)) throw httpError(400, 'Perfil inválido.');

  if (process.env.DATABASE_URL && !req.usuario.cloud_managed) {
    throw httpError(400,'Na nuvem, contas são criadas por um administrador com login corporativo.');
  }
  if (req.usuario.cloud_managed) {
    if (!req.usuario.cloud_session_token) throw httpError(401,'Entre novamente para gerenciar usuários corporativos.');
    let remote;
    try {
      remote = await cloudAuth.createUser(req.usuario.cloud_session_token,{ name,email,password,role });
    } catch (error) {
      if ([400,401,403,409].includes(error.status)) throw httpError(error.status,error.code === 'EMAIL_NOT_AUTHORIZED' ? 'E-mail não autorizado. Autorize o e-mail externo antes de criar a conta.' : error.message);
      throw httpError(503,'Não foi possível criar o usuário corporativo agora.');
    }
    const created = await upsertRemoteUser(remote.user);
    await recordAudit({entityType:'usuario',entityId:created.id,action:'criado',summary:`Usuário corporativo ${created.nome} criado com perfil ${role}.`,data:created,user:req.usuario});
    return res.status(201).json(created);
  }

  const { rows } = await getDb().query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id,name,email,role,active`,
    [name.slice(0, 120), email.slice(0, 180), await bcrypt.hash(password, 12), role]
  );
  await recordAudit({entityType:'usuario',entityId:rows[0].id,action:'criado',summary:`Usuário ${rows[0].name} criado com perfil ${role}.`,data:rows[0],user:req.usuario});
  res.status(201).json(rows[0]);
}));

router.put('/:id', asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id, 'Usuário');
  const name = String(req.body.nome || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const role = String(req.body.role || '');
  if (!name || !email) throw httpError(400, 'Preencha nome e e-mail.');
  if (!['admin', 'gestor', 'supervisor'].includes(role)) throw httpError(400, 'Perfil inválido.');

  const target = (await getDb().query('SELECT id,name,email,role,active,cloud_managed FROM users WHERE id=$1',[id])).rows[0];
  if (!target) throw httpError(404,'Usuário não encontrado.');

  if (target.cloud_managed) {
    throw httpError(400, 'Usuários corporativos são gerenciados pelo sistema central — edite pelo Construtec Orçamentos/sistema corporativo.');
  }

  const duplicate = (await getDb().query('SELECT id FROM users WHERE LOWER(email)=$1 AND id<>$2 AND deleted_at IS NULL LIMIT 1', [email, id])).rows[0];
  if (duplicate) throw httpError(409, 'Já existe um usuário cadastrado com este e-mail.');

  if (id === req.usuario.id && target.role === 'admin' && role !== 'admin') {
    const { rows: adminRows } = await getDb().query(
      "SELECT COUNT(*)::int AS total FROM users WHERE role='admin' AND active=TRUE AND id<>$1", [id]
    );
    if (Number(adminRows[0].total) === 0) {
      throw httpError(400, 'Você não pode remover o próprio perfil de administrador: você é o único administrador ativo.');
    }
  }

  const result = await getDb().query(
    'UPDATE users SET name=$1, email=$2, role=$3, updated_at=NOW() WHERE id=$4 RETURNING id,name,email,role,active',
    [name.slice(0, 120), email.slice(0, 180), role, id]
  );
  await recordAudit({entityType:'usuario',entityId:id,action:'atualizado',summary:`Usuário ${result.rows[0].name} atualizado.`,data:result.rows[0],user:req.usuario});
  res.json(result.rows[0]);
}));

router.put('/:id/status', asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id, 'Usuário');
  const active = req.body.ativo === true;
  if (id === req.usuario.id && !active) throw httpError(400, 'Você não pode desativar o próprio acesso.');

  const target = (await getDb().query('SELECT id,name,email,role,active,cloud_managed,cloud_user_id FROM users WHERE id=$1 AND deleted_at IS NULL',[id])).rows[0];
  if (!target) throw httpError(404,'Usuário não encontrado.');

  if (target.cloud_managed && req.usuario.cloud_managed) {
    if (!req.usuario.cloud_session_token) throw httpError(401,'Entre novamente para gerenciar usuários corporativos.');
    try {
      await cloudAuth.setUserStatus(req.usuario.cloud_session_token,target.email,active,target.cloud_user_id);
    } catch (error) {
      if ([400,401,403,404].includes(error.status)) throw httpError(error.status,error.message);
      throw httpError(503,'Não foi possível alterar o acesso corporativo agora.');
    }
  }

  const result = await getDb().query(
    'UPDATE users SET active=$1, updated_at=NOW() WHERE id=$2 RETURNING id,name,email,role,active', [active, id]
  );
  await recordAudit({entityType:'usuario',entityId:id,action:active?'ativado':'desativado',summary:`Usuário ${result.rows[0].name} ${active?'ativado':'desativado'}.`,data:result.rows[0],user:req.usuario});
  res.json({ ok: true });
}));

function requireCloudAdmin(req) {
  if (!req.usuario.cloud_managed || !req.usuario.cloud_session_token) {
    throw httpError(400,'Contas compartilhadas são gerenciadas por um administrador com login corporativo.');
  }
  return req.usuario.cloud_session_token;
}

function cloudFailure(error, fallback) {
  if ([400,401,403,404,409].includes(error.status)) return httpError(error.status,error.message);
  return httpError(503,fallback);
}

// Excluir login: a conta some do diretorio central e o e-mail fica livre para
// uma conta nova. A linha local fica (deleted_at) para o historico continuar
// mostrando o nome da pessoa; nada e apagado nem desvinculado.
router.delete('/:id', asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id, 'Usuário');
  if (id === req.usuario.id) throw httpError(400, 'Você não pode excluir o próprio acesso.');
  const target = (await getDb().query('SELECT id,name,email,cloud_managed,cloud_user_id FROM users WHERE id=$1 AND deleted_at IS NULL',[id])).rows[0];
  if (!target) throw httpError(404,'Usuário não encontrado.');
  if (target.cloud_managed) {
    const token = requireCloudAdmin(req);
    try { await cloudAuth.deleteUser(token,target.email,target.cloud_user_id); } catch (error) {
      if (error.status !== 404) throw cloudFailure(error,'Não foi possível excluir o login agora.');
    }
  }
  await retire(getDb(), [id]);
  await recordAudit({entityType:'usuario',entityId:id,action:'excluido',summary:`Login de ${target.name} excluído; e-mail liberado para nova conta.`,data:{ id, email:target.email },user:req.usuario});
  res.json({ ok: true });
}));

// Sem login central (instalacao local) o painel nao se aplica: responde
// disponivel=false em vez de erro, para a tela so esconder o painel.
router.get('/emails-autorizados/lista', asyncRoute(async (req, res) => {
  if (!req.usuario.cloud_managed || !req.usuario.cloud_session_token) return res.json({ disponivel:false, emails:[] });
  const token = req.usuario.cloud_session_token;
  try { res.json({ disponivel:true, emails:(await cloudAuth.listAuthorizedEmails(token)).emails || [] }); }
  catch (error) { throw cloudFailure(error,'Não foi possível carregar os e-mails autorizados agora.'); }
}));

router.post('/emails-autorizados', asyncRoute(async (req, res) => {
  const token = requireCloudAdmin(req);
  const email = String(req.body.email || '').trim().toLowerCase();
  const note = String(req.body.observacao || '').trim().slice(0,200);
  if (!email) throw httpError(400,'Informe o e-mail.');
  try { await cloudAuth.authorizeEmail(token,email,note); }
  catch (error) { throw cloudFailure(error,'Não foi possível autorizar o e-mail agora.'); }
  await recordAudit({entityType:'usuario',entityId:null,action:'email_autorizado',summary:`E-mail externo ${email} autorizado.`,data:{ email, note },user:req.usuario});
  res.status(201).json({ ok: true, email });
}));

router.post('/emails-autorizados/revogar', asyncRoute(async (req, res) => {
  const token = requireCloudAdmin(req);
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) throw httpError(400,'Informe o e-mail.');
  try { await cloudAuth.revokeEmail(token,email); }
  catch (error) { throw cloudFailure(error,'Não foi possível revogar a autorização agora.'); }
  await recordAudit({entityType:'usuario',entityId:null,action:'email_revogado',summary:`Autorização do e-mail externo ${email} revogada.`,data:{ email },user:req.usuario});
  res.json({ ok: true });
}));

module.exports = router;
