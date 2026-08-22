const os = require('os');
const { buildPackage, importPackage } = require('./smartSync');
const { getDb, getInstanceIdentity } = require('../db');
const { DEFAULT_API_URL } = require('./cloudAuth');

function configured() {
  return Boolean(process.env.SYNC_API_URL || DEFAULT_API_URL);
}

function corporateEmail(email) {
  return /^[^\s@]+@rcconstrutec\.com\.br$/i.test(String(email || '').trim());
}

function headersFor(user) {
  const instance = getInstanceIdentity();
  const pkg = require('../package.json');
  const headers = {
    'content-type':'application/json',
    'x-user-email':String(user.email || '').trim().toLowerCase(),
    'x-instance-id':instance.id,
    'x-instance-name':instance.name,
    'x-app-version':pkg.version,
    'x-platform':`${process.platform} ${os.release()}`,
  };
  if (user.cloud_session_token) headers.Authorization = `Bearer ${user.cloud_session_token}`;
  else if (process.env.SYNC_SHARED_KEY) headers['x-sync-key'] = process.env.SYNC_SHARED_KEY;
  return headers;
}

async function request(path, options, user) {
  if (!configured()) throw new Error('Sincronização em nuvem ainda não configurada nesta instalação.');
  if (!corporateEmail(user?.email)) throw new Error('A sincronização compartilhada exige uma conta @rcconstrutec.com.br.');
  if (!user?.cloud_session_token && !process.env.SYNC_SHARED_KEY) {
    throw new Error('Entre novamente com sua conta corporativa para sincronizar.');
  }
  const base = String(process.env.SYNC_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  timer.unref?.();
  try {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers:{...headersFor(user),...(options?.headers || {})},
      signal:controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `Cloud Sync HTTP ${response.status}`);
      error.statusCode = response.status >= 500 ? 502 : response.status;
      error.publicMessage = response.status >= 500
        ? 'O serviço corporativo não conseguiu concluir a operação. Tente novamente em instantes.'
        : error.message;
      error.code = data.code || '';
      throw error;
    }
    return data;
  } catch (error) {
    if (error.statusCode) throw error;
    const unavailable = new Error(error.name === 'AbortError'
      ? 'Tempo limite ao acessar o serviço corporativo.'
      : `Falha ao acessar o serviço corporativo: ${error.message}`);
    unavailable.statusCode = 503;
    unavailable.publicMessage = 'Não foi possível acessar o serviço corporativo agora. Verifique a internet e tente novamente.';
    unavailable.code = error.name === 'AbortError' ? 'CLOUD_TIMEOUT' : 'CLOUD_UNAVAILABLE';
    throw unavailable;
  } finally {
    clearTimeout(timer);
  }
}

function snapshotHasData(snapshot) {
  const payload = snapshot?.payload;
  if (!payload) return false;
  return ['categories','costCenters','suppliers','transactions']
    .some((key) => Array.isArray(payload[key]) && payload[key].length > 0);
}

async function alignNaturalKeys(snapshot) {
  const payload = snapshot?.payload;
  if (!payload) return;
  const db = getDb();
  await db.transaction(async (tx) => {
    for (const item of payload.categories || []) {
      const publicId = String(item?.publicId || '').trim();
      const name = String(item?.name || '').trim();
      if (!publicId || !name) continue;
      const sameId = await tx.query('SELECT id FROM categories WHERE public_id=$1 LIMIT 1', [publicId]);
      if (sameId.rows[0]) continue;
      const sameName = await tx.query('SELECT id,public_id FROM categories WHERE LOWER(name)=LOWER($1) LIMIT 1', [name]);
      if (sameName.rows[0] && String(sameName.rows[0].public_id) !== publicId) {
        await tx.query('UPDATE categories SET public_id=$1 WHERE id=$2', [publicId, sameName.rows[0].id]);
      }
    }
    for (const item of payload.costCenters || []) {
      const publicId = String(item?.publicId || '').trim();
      const code = String(item?.code || '').trim();
      if (!publicId || !code) continue;
      const sameId = await tx.query('SELECT id FROM cost_centers WHERE public_id=$1 LIMIT 1', [publicId]);
      if (sameId.rows[0]) continue;
      const sameCode = await tx.query('SELECT id,public_id FROM cost_centers WHERE LOWER(code)=LOWER($1) LIMIT 1', [code]);
      if (sameCode.rows[0] && String(sameCode.rows[0].public_id) !== publicId) {
        await tx.query('UPDATE cost_centers SET public_id=$1 WHERE id=$2', [publicId, sameCode.rows[0].id]);
      }
    }
  });
}

async function importSnapshot(snapshot, user, prefix) {
  if (!snapshot || !snapshotHasData(snapshot)) return null;
  await alignNaturalKeys(snapshot);
  return importPackage({
    content:JSON.stringify(snapshot),
    filename:`${prefix}-${new Date().toISOString().replace(/[:.]/g,'-')}.ccsync`,
    user,
  });
}

async function syncNow(user) {
  const before = await request('/v1/sync/snapshot', { method:'GET' }, user);
  const receivedBefore = before.snapshot ? await importSnapshot(before.snapshot, user, 'cloud-before-push') : null;
  const pack = await buildPackage();
  const cloud = await request('/v1/sync', { method:'POST', body:JSON.stringify(pack) }, user);
  if (!cloud.snapshot) throw new Error('A nuvem não devolveu o snapshot compartilhado.');
  const imported = await importSnapshot(cloud.snapshot, user, 'cloud') || receivedBefore;
  return {
    ok:true,
    enviado:{
      categorias:pack.payload.categories.length,
      centros:pack.payload.costCenters.length,
      fornecedores:pack.payload.suppliers.length,
      lancamentos:pack.payload.transactions.length,
    },
    recebido:imported?.resumo || null,
    cursor:Number(cloud.snapshot.cursor || 0),
  };
}

async function pullNow(user) {
  const cloud = await request('/v1/sync/snapshot', { method:'GET' }, user);
  if (!cloud.snapshot) throw new Error('A nuvem não devolveu o snapshot compartilhado.');
  const imported = await importSnapshot(cloud.snapshot, user, 'cloud-pull');
  return { ok:true, recebido:imported?.resumo || null, cursor:Number(cloud.snapshot.cursor || 0) };
}

async function activitySince(user, after = 0) {
  const cursor = Math.max(0, Number(after) || 0);
  return request(`/v1/activity?after=${cursor}&limit=50`, { method:'GET' }, user);
}

async function listClients(user) {
  return request('/v1/clients', { method:'GET' }, user);
}

async function createClient(user, payload) {
  return request('/v1/clients', { method:'POST', body:JSON.stringify(payload || {}) }, user);
}

async function updateClient(user, id, payload) {
  return request(`/v1/clients/${encodeURIComponent(id)}`, { method:'PUT', body:JSON.stringify(payload || {}) }, user);
}

async function setClientStatus(user, id, active) {
  return request(`/v1/clients/${encodeURIComponent(id)}/status`, { method:'POST', body:JSON.stringify({ active:Boolean(active) }) }, user);
}

async function listClientFollowups(user) {
  return request('/v1/client-followups', { method:'GET' }, user);
}

async function saveClientFollowup(user, publicId, payload) {
  return request(`/v1/client-followups/${encodeURIComponent(publicId)}`, { method:'PUT', body:JSON.stringify(payload || {}) }, user);
}

async function getClientDraft(user, publicId) {
  return request(`/v1/client-email-draft?costCenterPublicId=${encodeURIComponent(publicId)}`, { method:'GET' }, user);
}

async function saveClientDraft(user, payload) {
  return request('/v1/client-email-draft', { method:'PUT', body:JSON.stringify(payload || {}) }, user);
}

async function authorizeClientDraft(user, publicId) {
  return request('/v1/client-email-draft/authorize', { method:'POST', body:JSON.stringify({ costCenterPublicId:publicId, confirmar:true }) }, user);
}

async function sendClientDraft(user, publicId, attachments = []) {
  return request('/v1/client-email-draft/send', { method:'POST', body:JSON.stringify({ costCenterPublicId:publicId, attachments }) }, user);
}

module.exports = {
  configured,
  corporateEmail,
  syncNow,
  pullNow,
  activitySince,
  listClients,
  createClient,
  updateClient,
  setClientStatus,
  listClientFollowups,
  saveClientFollowup,
  getClientDraft,
  saveClientDraft,
  authorizeClientDraft,
  sendClientDraft,
};
