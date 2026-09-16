const crypto = require('crypto');
const { validateProposalEnvelope } = require('./budgetCanonical');

async function previewImport(db, envelope, userId, options = {}) {
  const { computedHash } = validateProposalEnvelope(envelope);
  const payload = envelope.payload;
  const { source, proposal, client, work, totals, materials, labor } = payload;

  // 1. Checar se já foi importado
  const existingImport = await db.query(`
    SELECT id, contract_id, payload_hash
    FROM budget_imports
    WHERE source_system = $1 AND namespace_id = $2 AND series_id = $3 AND source_revision = $4
  `, [source.system, source.namespaceId, proposal.seriesId, proposal.revision]);

  if (existingImport.rows[0]) {
    const row = existingImport.rows[0];
    if (row.payload_hash === computedHash) {
      return {
        status: 'already_imported',
        isDuplicate: true,
        hash: computedHash,
        importId: row.id,
        contractId: row.contract_id,
        proposal: { number: proposal.number, revision: proposal.revision },
        client: { name: client.tradeName || client.legalName },
        message: 'Esta revisão de proposta já foi importada previamente.',
      };
    }
    return {
      status: 'conflict',
      isConflict: true,
      hash: computedHash,
      proposal: { number: proposal.number, revision: proposal.revision },
      client: { name: client.tradeName || client.legalName },
      message: 'Conflito: esta revisão já foi importada com conteúdo/hash diferente.',
    };
  }

  // 2. Checar contrato existente para a série
  const contractResult = await db.query(`
    SELECT id, cost_center_id, current_baseline_id
    FROM project_contracts
    WHERE source_system = $1 AND namespace_id = $2 AND series_id = $3
  `, [source.system, source.namespaceId, proposal.seriesId]);

  let isReplacement = false;
  let targetCostCenterId = options.costCenterId || null;
  let targetCostCenter = null;

  if (contractResult.rows[0]) {
    isReplacement = true;
    const contract = contractResult.rows[0];
    targetCostCenterId = contract.cost_center_id;
    const ccRes = await db.query('SELECT id, code, name FROM cost_centers WHERE id = $1', [targetCostCenterId]);
    targetCostCenter = ccRes.rows[0] || null;
  } else if (targetCostCenterId) {
    const ccRes = await db.query('SELECT id, code, name FROM cost_centers WHERE id = $1', [targetCostCenterId]);
    targetCostCenter = ccRes.rows[0] || null;
  } else {
    // Propor novo centro de custo
    const baseCode = `CC-${proposal.number}`;
    let code = baseCode;
    const checkCode = await db.query('SELECT id FROM cost_centers WHERE LOWER(code) = LOWER($1)', [code]);
    if (checkCode.rows[0]) {
      code = `${baseCode}-${String(Date.now()).slice(-4)}`;
    }
    const clientName = client.tradeName || client.legalName;
    const fullName = `${proposal.number} - ${clientName} - ${work.name}`.slice(0, 140);
    targetCostCenter = {
      isNew: true,
      code,
      name: fullName,
    };
  }

  // 3. Salvar prévia temporária com TTL de 24h
  const previewId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

  await db.query(`
    INSERT INTO budget_import_previews
      (id, payload, hash, mappings, status, created_by, expires_at)
    VALUES ($1, $2::jsonb, $3, $4::jsonb, 'ready', $5, $6)
  `, [
    previewId,
    JSON.stringify(payload),
    computedHash,
    JSON.stringify(options.mappings || {}),
    userId || null,
    expiresAt,
  ]);

  return {
    previewId,
    hash: computedHash,
    status: 'ready',
    isDuplicate: false,
    isReplacement,
    proposal: { number: proposal.number, revision: proposal.revision },
    client: { name: client.tradeName || client.legalName },
    targetCostCenter,
    totals,
    materialsCount: Array.isArray(materials) ? materials.length : 0,
    laborCount: Array.isArray(labor) ? labor.length : 0,
    expiresAt,
  };
}

module.exports = {
  previewImport,
};
