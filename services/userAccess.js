// Papel da Suite, apps e obras por usuario (D6): gravacao local e dados extras da lista.
const { SUITE_ROLES, SCOPED_ROLES, suiteRoleOf } = require('./permissions');
const { httpError } = require('../lib/http');

const APPS = ['centro', 'orcamentos'];

function legacyRoleFor(suiteRole) {
  if (suiteRole === 'admin') return 'admin';
  if (suiteRole === 'gestor') return 'gestor';
  return 'supervisor';
}

function parseApps(value) {
  if (Array.isArray(value)) return APPS.filter((app) => value.includes(app));
  if (!value) return [...APPS];
  try { return parseApps(JSON.parse(value)); } catch { return [...APPS]; }
}

// Valida o trecho de acesso de um corpo de requisicao. Devolve so o que veio.
function readAccess(body, { required = false } = {}) {
  const out = {};
  if (body.suiteRole !== undefined || required) {
    if (!SUITE_ROLES.includes(body.suiteRole)) throw httpError(400, 'Papel inválido.');
    out.suiteRole = body.suiteRole;
  }
  if (body.apps !== undefined) {
    const apps = Array.isArray(body.apps) ? APPS.filter((app) => body.apps.includes(app)) : [];
    if (!apps.length) throw httpError(400, 'Escolha ao menos um app.');
    out.apps = apps;
  }
  if (body.obras !== undefined) {
    if (body.obras === 'todas') out.obras = 'todas';
    else if (Array.isArray(body.obras) && body.obras.every((id) => Number.isInteger(id) && id > 0)) out.obras = [...new Set(body.obras)];
    else throw httpError(400, 'Obras inválidas. Use "todas" ou uma lista de identificadores.');
  }
  return out;
}

// Copia papel novo e apps do diretorio central para as linhas locais (lote).
async function applySuite(db, remoteList, newEmails = []) {
  const rows = remoteList.filter((r) => r.email && SUITE_ROLES.includes(r.suiteRole));
  if (!rows.length) return;
  await db.query(`
    UPDATE users AS u SET suite_role=v.suite_role, apps=COALESCE(v.apps,u.apps)
    FROM (SELECT * FROM unnest($1::text[],$2::text[],$3::text[]) AS t(email,suite_role,apps)) AS v
    WHERE LOWER(u.email)=v.email AND u.deleted_at IS NULL
  `, [rows.map((r) => String(r.email).toLowerCase()), rows.map((r) => r.suiteRole),
    rows.map((r) => (Array.isArray(r.apps) ? JSON.stringify(r.apps) : null))]);
  // Contas criadas agora como engenharia ou tecnico comecam sem obras.
  if (newEmails.length) {
    await db.query(`UPDATE users SET all_cost_centers=FALSE
      WHERE LOWER(email)=ANY($1::text[]) AND suite_role=ANY($2::text[]) AND deleted_at IS NULL`, [newEmails, SCOPED_ROLES]);
  }
}

// Define as obras de um usuario: 'todas' ou uma lista (so vale para engenharia e tecnico).
async function setObras(db, userId, obras) {
  if (obras === 'todas') {
    await db.query('UPDATE users SET all_cost_centers=TRUE WHERE id=$1', [userId]);
    await db.query('DELETE FROM user_cost_centers WHERE user_id=$1', [userId]);
    return;
  }
  if (obras.length) {
    const { rows } = await db.query('SELECT id FROM cost_centers WHERE id=ANY($1::int[])', [obras]);
    if (rows.length !== obras.length) throw httpError(400, 'Alguma das obras escolhidas não existe.');
  }
  await db.query('UPDATE users SET all_cost_centers=FALSE WHERE id=$1', [userId]);
  await db.query('DELETE FROM user_cost_centers WHERE user_id=$1', [userId]);
  if (obras.length) {
    await db.query('INSERT INTO user_cost_centers(user_id,cost_center_id) SELECT $1,unnest($2::int[])', [userId, obras]);
  }
}

// Acrescenta papel, apps e obras a cada usuario da lista (por id local).
async function decorate(db, users, remoteByEmail = new Map()) {
  if (!users.length) return users;
  const ids = users.map((u) => u.id);
  const { rows } = await db.query('SELECT id,role,suite_role,apps,all_cost_centers FROM users WHERE id=ANY($1::int[])', [ids]);
  const { rows: links } = await db.query('SELECT user_id,cost_center_id FROM user_cost_centers WHERE user_id=ANY($1::int[])', [ids]);
  const byUser = new Map();
  for (const link of links) byUser.set(link.user_id, [...(byUser.get(link.user_id) || []), link.cost_center_id]);
  const info = new Map(rows.map((r) => [r.id, r]));
  return users.map((u) => {
    const r = info.get(u.id) || {};
    const remote = remoteByEmail.get(String(u.email || '').toLowerCase());
    const suiteRole = suiteRoleOf(r);
    return {
      ...u, suiteRole, apps: parseApps(r.apps), todasObras: r.all_cost_centers !== false,
      obras: byUser.get(u.id) || [], ultimoAcesso: remote?.lastLoginAt || null,
    };
  });
}

module.exports = { APPS, legacyRoleFor, parseApps, readAccess, applySuite, setObras, decorate };
