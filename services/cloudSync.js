const os = require('os');
const { buildPackage, importPackage } = require('./smartSync');
const { getInstanceIdentity } = require('../db');

function configured() {
  return Boolean(process.env.SYNC_API_URL && process.env.SYNC_SHARED_KEY);
}

function corporateEmail(email) {
  return /^[^\s@]+@rcconstrutec\.com\.br$/i.test(String(email || '').trim());
}

function headersFor(user) {
  const instance = getInstanceIdentity();
  const pkg = require('../package.json');
  return {
    'content-type':'application/json',
    'x-sync-key':process.env.SYNC_SHARED_KEY,
    'x-user-email':String(user.email || '').trim().toLowerCase(),
    'x-instance-id':instance.id,
    'x-instance-name':instance.name,
    'x-app-version':pkg.version,
    'x-platform':`${process.platform} ${os.release()}`,
  };
}

async function request(path, options, user) {
  if (!configured()) throw new Error('Sincronização em nuvem ainda não configurada nesta instalação.');
  if (!corporateEmail(user?.email)) throw new Error('A sincronização compartilhada exige uma conta @rcconstrutec.com.br.');
  const base = String(process.env.SYNC_API_URL).replace(/\/+$/, '');
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
    if (!response.ok) throw new Error(data.error || `Cloud Sync HTTP ${response.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function syncNow(user) {
  const pack = await buildPackage();
  const cloud = await request('/v1/sync', { method:'POST', body:JSON.stringify(pack) }, user);
  if (!cloud.snapshot) throw new Error('A nuvem não devolveu o snapshot compartilhado.');
  const imported = await importPackage({
    content:JSON.stringify(cloud.snapshot),
    filename:`cloud-${new Date().toISOString().replace(/[:.]/g,'-')}.ccsync`,
    user,
  });
  return {
    ok:true,
    enviado:{
      categorias:pack.payload.categories.length,
      centros:pack.payload.costCenters.length,
      fornecedores:pack.payload.suppliers.length,
      lancamentos:pack.payload.transactions.length,
    },
    recebido:imported.resumo || null,
    cursor:Number(cloud.snapshot.cursor || 0),
  };
}

async function pullNow(user) {
  const cloud = await request('/v1/sync/snapshot', { method:'GET' }, user);
  if (!cloud.snapshot) throw new Error('A nuvem não devolveu o snapshot compartilhado.');
  const imported = await importPackage({
    content:JSON.stringify(cloud.snapshot),
    filename:`cloud-pull-${new Date().toISOString().replace(/[:.]/g,'-')}.ccsync`,
    user,
  });
  return { ok:true, recebido:imported.resumo || null, cursor:Number(cloud.snapshot.cursor || 0) };
}

module.exports = { configured, corporateEmail, syncNow, pullNow };
