// Excluir de uma vez os lancamentos e os modelos recorrentes de uma obra (para poder descarta-la depois).
// Segue as mesmas regras da exclusao de um lancamento (routes/transactions.js): vai para a lixeira (deleted_at),
// estorno e lancamento estornado ficam no historico, e competencia fechada nao e mexida. O que nao sai e devolvido.
const { getInstanceIdentity } = require('../db');
const { isMonthClosed } = require('./financialPolicy');
const { recordAudit } = require('./audit');

async function clearCostCenterEntries(db, id, user) {
  const instance = getInstanceIdentity();
  const { rows } = await db.query(
    `SELECT id, public_id, description, transaction_date::text AS data, reversal_of, reversed_at, accounting_sign
     FROM transactions WHERE cost_center_id=$1 AND deleted_at IS NULL ORDER BY transaction_date, id`, [id]);
  let excluidos = 0;
  const ignorados = [];
  for (const t of rows) {
    let motivo = '';
    if (t.reversal_of || Number(t.accounting_sign || 1) === -1) motivo = 'estorno fica no histórico';
    else if (t.reversed_at) motivo = 'lançamento estornado fica no histórico';
    else if (await isMonthClosed(t.data)) motivo = 'competência fechada';
    if (motivo) { ignorados.push({ descricao: t.description, data: t.data, motivo }); continue; }
    const result = await db.query(
      `UPDATE transactions SET deleted_at=NOW(),updated_at=NOW(),revision=revision+1,
         last_modified_instance_id=$1,last_modified_instance_name=$2,updated_by=$3
       WHERE id=$4 AND deleted_at IS NULL AND reversal_of IS NULL AND reversed_at IS NULL`,
      [instance.id, instance.name, user?.id || null, t.id]);
    if (!result.rowCount) { ignorados.push({ descricao: t.description, data: t.data, motivo: 'mudou durante a exclusão' }); continue; }
    excluidos += 1;
    await recordAudit({ entityType: 'lancamento', entityId: t.public_id, action: 'excluido', summary: `Lançamento enviado para a lixeira (excluir todos da obra): ${t.description}`, user });
  }
  const rec = await db.query('DELETE FROM recurring_templates WHERE cost_center_id=$1 RETURNING id', [id]);
  for (const r of rec.rows) {
    await recordAudit({ entityType: 'recorrente', entityId: r.id, action: 'excluido', summary: 'Modelo recorrente excluído (excluir todos da obra).', user });
  }
  return { excluidos, recorrentes: rec.rows.length, ignorados };
}

module.exports = { clearCostCenterEntries };
