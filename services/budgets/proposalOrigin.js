// Proposta do Orcamentos que originou a obra (Suite mobile, passo 4: cartao
// "Ir direto para" no celular). Usa a baseline vigente do contrato ativo: o id
// e o da revisao vigente, que o Orcamentos abre por #proposta=<id>.
async function getProposalOrigin(db, costCenterId) {
  const { rows } = await db.query(`
    SELECT bi.source_proposal_id AS id, pc.number AS numero, bi.source_revision AS revisao
    FROM project_contracts pc
    JOIN budget_baselines b ON b.id = pc.current_baseline_id
    JOIN budget_imports bi ON bi.id = b.import_id
    WHERE pc.cost_center_id = $1 AND pc.status = 'active'
    ORDER BY pc.created_at DESC
    LIMIT 1
  `, [costCenterId]);
  return rows[0] || null;
}

module.exports = { getProposalOrigin };
