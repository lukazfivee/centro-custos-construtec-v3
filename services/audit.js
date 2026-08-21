const { getDb, getInstanceIdentity } = require('../db');

async function recordAudit({ entityType, entityId = null, action, summary, data = null, user, client = null }) {
  const db = client || getDb();
  const instance = getInstanceIdentity();
  await db.query(
    `INSERT INTO audit_log
      (entity_type,entity_id,action,summary,data,user_id,user_name,instance_id,instance_name)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)`,
    [entityType,String(entityId || '') || null,action,String(summary).slice(0,300),
      data == null ? null : JSON.stringify(data),user?.id || null,user?.name || 'Sistema',
      instance.id,instance.name]
  );
}

module.exports = { recordAudit };
