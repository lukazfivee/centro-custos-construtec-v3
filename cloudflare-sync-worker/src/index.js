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

async function sha256(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function dateValue(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : 0;
}

async function consumeRate(db, ip) {
  const now = Math.floor(Date.now() / 1000);
  const hour = Math.floor(now / 3600);
  const bucket = `${ip || 'unknown'}:${hour}`;
  const current = await db.prepare('SELECT count FROM sync_rate_limits WHERE bucket=?').bind(bucket).first();
  if (!current) {
    await db.prepare('INSERT INTO sync_rate_limits(bucket,count,expires_at) VALUES(?,?,?)')
      .bind(bucket, 1, (hour + 2) * 3600).run();
    return true;
  }
  if (Number(current.count) >= 240) return false;
  await db.prepare('UPDATE sync_rate_limits SET count=count+1 WHERE bucket=?').bind(bucket).run();
  if (Math.random() < 0.03) {
    await db.prepare('DELETE FROM sync_rate_limits WHERE expires_at < ?').bind(now).run();
  }
  return true;
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
    const current = JSON.parse(existing.payload);
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

async function authorize(request, env) {
  const key = request.headers.get('x-sync-key') || '';
  if (!env.SYNC_SHARED_KEY || key !== env.SYNC_SHARED_KEY) return { error:'Nao autorizado.' };
  const userEmail = text(request.headers.get('x-user-email')).toLowerCase();
  const instanceId = text(request.headers.get('x-instance-id'));
  const instanceName = text(request.headers.get('x-instance-name')) || 'Instalacao';
  if (!validCorporateEmail(userEmail)) return { error:'Use uma conta @rcconstrutec.com.br para sincronizar.' };
  if (!validUuid(instanceId)) return { error:'Instalacao invalida.' };
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
      return json({ ok:true, service:'centro-custos-sync', mode:'cloudflare-d1' });
    }

    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    if (!(await consumeRate(env.DB, ip))) return json({ ok:false, error:'Limite temporario de sincronizacao atingido.' }, 429);

    const meta = await authorize(request, env);
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
