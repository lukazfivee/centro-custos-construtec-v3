// Espelho local (PostgreSQL/PGlite) das contas do diretorio central (D1).
// A linha local e casada primeiro pelo id da conta central; sem ele, pelo
// e-mail entre as linhas nao excluidas. Se o e-mail pertence a uma conta
// central antiga (excluida e recriada com id novo), a linha antiga e
// aposentada (deleted_at) e uma nova e criada, preservando o historico.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const RETURNING = 'id,name,email,role,suite_role,all_cost_centers,active,cloud_managed,cloud_session_token,cloud_user_id';

// Papel novo e apps vindos do diretorio; Worker antigo nao os envia (fica NULL).
function suiteFields(remote) {
  const roles = ['admin', 'gestor', 'financeiro', 'engenharia', 'tecnico', 'comercial'];
  const suiteRole = roles.includes(remote.suiteRole) ? remote.suiteRole : null;
  const apps = Array.isArray(remote.apps) ? JSON.stringify(remote.apps) : null;
  return { suiteRole, apps };
}

async function findLive(db, remote, email) {
  if (remote.id) {
    const byId = (await db.query('SELECT id,cloud_user_id FROM users WHERE cloud_user_id=$1 AND deleted_at IS NULL LIMIT 1', [String(remote.id)])).rows[0];
    if (byId) return byId;
  }
  return (await db.query('SELECT id,cloud_user_id FROM users WHERE LOWER(email)=$1 AND deleted_at IS NULL LIMIT 1', [email])).rows[0] || null;
}

async function retire(db, ids) {
  if (!ids.length) return;
  await db.query('UPDATE users SET deleted_at=NOW(),active=FALSE,cloud_session_token=NULL,updated_at=NOW() WHERE id = ANY($1::int[])', [ids]);
}

// Upsert de uma conta central. sessionToken e opcional (login grava a sessao).
// Dois logins simultaneos podem disputar o indice unico; a segunda tentativa
// encontra a linha criada pela primeira.
async function mirrorCloudUser(db, remote, options = {}) {
  try {
    return await mirrorOnce(db, remote, options);
  } catch (error) {
    if (error.code !== '23505' && !/duplicate key|unique/i.test(String(error.message))) throw error;
    return mirrorOnce(db, remote, options);
  }
}

// Papel efetivo de uma conta nova: o suiteRole do diretorio ou, sem ele, o mapeamento do papel antigo
// (supervisor vira tecnico). Usado so para decidir o escopo de obras: na duvida, falha fechada.
function escopavel(suiteRole, legacyRole) {
  const efetivo = suiteRole || (legacyRole === 'admin' || legacyRole === 'gestor' ? legacyRole : 'tecnico');
  return ['engenharia', 'tecnico'].includes(efetivo);
}

async function mirrorOnce(db, remote, { sessionToken } = {}) {
  const email = String(remote.email || '').trim().toLowerCase();
  const name = String(remote.name || email).slice(0, 120);
  const active = remote.active !== false;
  const cloudId = remote.id ? String(remote.id) : null;
  let existing = await findLive(db, remote, email);
  if (existing && cloudId && existing.cloud_user_id && existing.cloud_user_id !== cloudId) {
    await retire(db, [existing.id]);
    existing = null;
  }
  const { suiteRole, apps } = suiteFields(remote);
  if (existing) {
    const updated = await db.query(`
      UPDATE users SET name=$1,email=$2,role=$3,active=$4,cloud_managed=TRUE,
        cloud_user_id=COALESCE($5,cloud_user_id),
        cloud_session_token=COALESCE($6,cloud_session_token),
        suite_role=COALESCE($8,suite_role),apps=COALESCE($9,apps),updated_at=NOW()
      WHERE id=$7 AND deleted_at IS NULL RETURNING ${RETURNING}
    `, [name, email, remote.role, active, cloudId, sessionToken || null, existing.id, suiteRole, apps]);
    if (updated.rows[0]) return updated.rows[0];
  }
  const unusablePassword = await bcrypt.hash(crypto.randomBytes(48).toString('hex'), 4);
  const inserted = await db.query(`
    INSERT INTO users (name,email,password_hash,role,active,cloud_managed,cloud_user_id,cloud_session_token,suite_role,apps,all_cost_centers)
    VALUES ($1,$2,$3,$4,$5,TRUE,$6,$7,$8,$9,$10) RETURNING ${RETURNING}
  `, [name, email, unusablePassword, remote.role, active, cloudId, sessionToken || null, suiteRole, apps,
    // Engenharia e tecnico novos (inclusive quando o diretorio nao enviou o papel) comecam sem obras
    // ate o admin atribuir; as contas antigas ficam como estao.
    !escopavel(suiteRole, remote.role)]);
  return inserted.rows[0];
}

// Marca como excluida a linha local de uma conta central excluida.
async function retireCloudUser(db, localId) {
  await retire(db, [Number(localId)]);
}

module.exports = { mirrorCloudUser, retireCloudUser, retire };
