const { getDb, getInstanceIdentity } = require('../db');
const { origemAtual } = require('../lib/auditContext');

// Nada que seja segredo vai para a auditoria nem para o "antes": senha, token, hash, chave.
const SEGREDO = /(senha|password|passwd|token|hash|secret|segredo|api[_-]?key|chave|authorization|cookie)/i;

function limpar(valor, nivel = 0) {
  if (valor == null) return null;
  if (nivel > 6) return '[omitido]';
  if (Array.isArray(valor)) return valor.slice(0, 200).map((item) => limpar(item, nivel + 1));
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === 'object') {
    const saida = {};
    for (const [chave, item] of Object.entries(valor)) {
      if (!SEGREDO.test(chave)) saida[chave] = limpar(item, nivel + 1);
    }
    return saida;
  }
  return valor;
}

async function recordAudit({ entityType, entityId = null, action, summary, data = null, before = null, origem = null, user, client = null }) {
  const db = client || getDb();
  const instance = getInstanceIdentity();
  await db.query(
    `INSERT INTO audit_log
      (entity_type,entity_id,action,summary,data,before,origem,user_id,user_name,instance_id,instance_name)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11)`,
    [entityType,String(entityId || '') || null,action,String(summary).slice(0,300),
      data == null ? null : JSON.stringify(limpar(data)),
      before == null ? null : JSON.stringify(limpar(before)),
      origem || origemAtual(),user?.id || null,user?.name || 'Sistema',
      instance.id,instance.name]
  );
}

module.exports = { recordAudit, limparAuditoria: limpar };
