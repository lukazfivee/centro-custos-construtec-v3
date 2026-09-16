const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDb } = require('../db');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { parsePagination, wantsPagination, paginationMeta } = require('../lib/pagination');
const { recordAudit } = require('../services/audit');
const cloudAuth = require('../services/cloudAuth');

const router = express.Router();
router.use(autenticar, exigirPapel('admin'));

async function upsertRemoteUser(remote) {
  const email = String(remote.email || '').trim().toLowerCase();
  const existing = await getDb().query('SELECT id FROM users WHERE LOWER(email)=$1 LIMIT 1',[email]);
  if (existing.rows[0]) {
    const result = await getDb().query(`
      UPDATE users SET name=$1,email=$2,role=$3,active=$4,cloud_managed=TRUE,updated_at=NOW()
      WHERE id=$5 RETURNING id,name AS nome,email,role,active AS ativo,created_at
    `,[String(remote.name||email).slice(0,120),email,remote.role,remote.active !== false,existing.rows[0].id]);
    return result.rows[0];
  }
  const placeholder = await bcrypt.hash(crypto.randomBytes(48).toString('hex'),12);
  const result = await getDb().query(`
    INSERT INTO users (name,email,password_hash,role,active,cloud_managed)
    VALUES ($1,$2,$3,$4,$5,TRUE)
    RETURNING id,name AS nome,email,role,active AS ativo,created_at
  `,[String(remote.name||email).slice(0,120),email,placeholder,remote.role,remote.active !== false]);
  return result.rows[0];
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
    'SELECT id, LOWER(email) AS email FROM users WHERE LOWER(email) = ANY($1::text[])',
    [order]
  );
  const existingIdByEmail = new Map(existingRows.map(r => [r.email, r.id]));

  const toUpdate = [];
  const toInsert = [];
  for (const email of order) {
    const id = existingIdByEmail.get(email);
    if (id) toUpdate.push({ id, remote: byEmail.get(email), email });
    else toInsert.push({ remote: byEmail.get(email), email });
  }

  const resultByEmail = new Map();

  if (toUpdate.length) {
    const ids = toUpdate.map(u => u.id);
    const names = toUpdate.map(u => String(u.remote.name || u.email).slice(0,120));
    const emails = toUpdate.map(u => u.email);
    const roles = toUpdate.map(u => u.remote.role);
    const actives = toUpdate.map(u => u.remote.active !== false);
    const { rows } = await db.query(`
      UPDATE users AS u SET name=v.name,email=v.email,role=v.role,active=v.active,
        cloud_managed=TRUE,updated_at=NOW()
      FROM (
        SELECT * FROM unnest($1::int[],$2::text[],$3::text[],$4::text[],$5::boolean[])
          AS t(id,name,email,role,active)
      ) AS v
      WHERE u.id = v.id
      RETURNING u.id,u.name AS nome,u.email,u.role,u.active AS ativo,u.created_at
    `,[ids,names,emails,roles,actives]);
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
      const row = [String(remote.name||email).slice(0,120),email,hashes[i],remote.role,remote.active !== false];
      for (const v of row) { params.push(v); p++; }
      const placeholders = Array.from({ length: row.length }, (_, k) => `$${p - row.length + k + 1}`).join(',');
      values.push(`(${placeholders},TRUE)`);
    });
    const { rows } = await db.query(`
      INSERT INTO users (name,email,password_hash,role,active,cloud_managed)
      VALUES ${values.join(',')}
      RETURNING id,name AS nome,email,role,active AS ativo,created_at
    `,params);
    for (const row of rows) resultByEmail.set(row.email.toLowerCase(), row);
  }

  return order.map(email => resultByEmail.get(email)).filter(Boolean);
}

router.get('/', asyncRoute(async (req, res) => {
  if (req.usuario.cloud_managed && cloudAuth.corporateEmail(req.usuario.email) && req.usuario.cloud_session_token) {
    try {
      const remote = await cloudAuth.listUsers(req.usuario.cloud_session_token);
      const users = await upsertRemoteUsers(remote.users || []);
      return res.json(users);
    } catch (error) {
      if (error.status === 401) throw httpError(401,'Sua sessão corporativa expirou. Entre novamente.');
      throw httpError(503,'Não foi possível carregar os usuários corporativos agora.');
    }
  }

  const usersSelect = 'SELECT id, name AS nome, email, role, active AS ativo, created_at FROM users';
  const orderBy = 'active DESC, name';
  if (!wantsPagination(req.query)) {
    const { rows } = await getDb().query(`${usersSelect} ORDER BY ${orderBy} LIMIT 500`);
    res.setHeader('X-Result-Limit', '500');
    return res.json(rows);
  }
  const { page, limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
  const [dataResult, countResult] = await Promise.all([
    getDb().query(`${usersSelect} ORDER BY ${orderBy} LIMIT $1 OFFSET $2`, [limit, offset]),
    getDb().query('SELECT COUNT(*)::int AS total FROM users'),
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

  if (req.usuario.cloud_managed && cloudAuth.corporateEmail(req.usuario.email)) {
    if (!cloudAuth.corporateEmail(email)) throw httpError(400,'Usuários compartilhados precisam usar e-mail @rcconstrutec.com.br.');
    if (!req.usuario.cloud_session_token) throw httpError(401,'Entre novamente para gerenciar usuários corporativos.');
    let remote;
    try {
      remote = await cloudAuth.createUser(req.usuario.cloud_session_token,{ name,email,password,role });
    } catch (error) {
      if ([400,401,403,409].includes(error.status)) throw httpError(error.status,error.message);
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

router.put('/:id/status', asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id, 'Usuário');
  const active = req.body.ativo === true;
  if (id === req.usuario.id && !active) throw httpError(400, 'Você não pode desativar o próprio acesso.');

  const target = (await getDb().query('SELECT id,name,email,role,active,cloud_managed FROM users WHERE id=$1',[id])).rows[0];
  if (!target) throw httpError(404,'Usuário não encontrado.');

  if (target.cloud_managed && req.usuario.cloud_managed) {
    if (!req.usuario.cloud_session_token) throw httpError(401,'Entre novamente para gerenciar usuários corporativos.');
    try {
      await cloudAuth.setUserStatus(req.usuario.cloud_session_token,target.email,active);
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

module.exports = router;
