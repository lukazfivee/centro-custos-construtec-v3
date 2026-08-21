const express = require('express');
const { autenticar } = require('../middleware/auth');
const { asyncRoute, httpError } = require('../lib/http');
const { buildTransactionFilters } = require('../lib/transactionFilters');
const { exportTransactions, importTransactions } = require('../services/sync');
const { getDb } = require('../db');

const router = express.Router();
router.use(autenticar);

router.get('/exportar.csv', asyncRoute(async (req, res) => {
  const reversalResult = await getDb().query(`
    SELECT COUNT(*)::int AS total
    FROM transactions
    WHERE deleted_at IS NULL AND (accounting_sign=-1 OR reversal_of IS NOT NULL)
  `);
  if (Number(reversalResult.rows[0]?.total || 0) > 0) {
    throw httpError(409,
      'Esta base possui estornos formais. A sincronização CSV antiga foi bloqueada para não perder o vínculo dos estornos. Use esta versão localmente até a próxima etapa de sincronização P3.'
    );
  }
  const filter = buildTransactionFilters(req.query,'t',req.query.sincronizar === '1');
  const csv = await exportTransactions(filter);
  const suffix = new Date().toISOString().slice(0,10);
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename="sincronizacao-${suffix}.csv"`);
  res.send(csv);
}));

router.post('/importar', asyncRoute(async (req, res) => {
  const result = await importTransactions({
    content:req.body.conteudo,filename:req.body.nomeArquivo,user:req.usuario,
  });
  res.json(result);
}));

router.get('/historico', asyncRoute(async (req, res) => {
  const { rows } = await getDb().query(`
    SELECT si.id,si.filename,si.source_instance_name,si.included_count,si.updated_count,
      si.ignored_count,si.conflict_count,si.error_count,si.created_at,u.name AS imported_by_name
    FROM sync_imports si JOIN users u ON u.id=si.imported_by
    ORDER BY si.created_at DESC LIMIT 30
  `);
  res.json(rows);
}));

router.get('/conflitos', asyncRoute(async (req, res) => {
  const { rows } = await getDb().query(`
    SELECT sc.id,sc.transaction_public_id,sc.reason,sc.status,sc.created_at,si.filename,
      sc.local_data,sc.incoming_data
    FROM sync_conflicts sc JOIN sync_imports si ON si.id=sc.import_id
    ORDER BY sc.created_at DESC LIMIT 100
  `);
  res.json(rows);
}));

router.post('/conflitos/:id/resolver', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ erro:'ID inválido.' });
  const escolha = String(req.body.escolha || '').trim();
  if (!['local','recebido'].includes(escolha)) return res.status(400).json({ erro:'Escolha "local" ou "recebido".' });
  const db = getDb();
  const { rows } = await db.query('SELECT * FROM sync_conflicts WHERE id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ erro:'Conflito não encontrado.' });
  const conflict = rows[0];
  if (conflict.status !== 'pending') return res.status(400).json({ erro:'Este conflito já foi resolvido.' });

  const data = escolha === 'local' ? conflict.local_data : conflict.incoming_data;
  if (!data) return res.status(400).json({ erro:'Dados da versão escolhida não disponíveis.' });

  const pubId = conflict.transaction_public_id;
  const existing = await db.query('SELECT id FROM transactions WHERE public_id = $1', [pubId]);
  const centerMap = await db.query('SELECT id, LOWER(code) AS key FROM cost_centers');
  const categoryMap = await db.query('SELECT id, LOWER(name) AS key, type FROM categories');
  const cMap = new Map(centerMap.rows.map(r => [r.key, r.id]));
  const catMap = new Map(categoryMap.rows.map(r => [r.key, r]));

  const code = (data.centro_codigo || data.center_code || '').toLowerCase();
  const catName = (data.categoria || data.category_name || '').toLowerCase();
  const centerId = cMap.get(code);
  const cat = catMap.get(catName);

  if (existing.rows[0]) {
    await db.query(
      `UPDATE transactions SET type=$1, cost_center_id=$2, category_id=$3, description=$4,
        counterparty=$5, amount=$6, transaction_date=$7, notes=$8, due_date=$9,
        settlement_date=$10, financial_status=$11, document_number=$12, payment_method=$13,
        revision=revision+1, updated_by=$14, updated_at=NOW(), deleted_at=$15
       WHERE public_id=$16`,
      [data.tipo || data.type, centerId || 1, cat?.id || 1,
        (data.descricao || data.description || '').slice(0,240),
        (data.cliente_fornecedor || data.counterparty || '').slice(0,160) || null,
        Number(String(data.valor || data.amount || 0).replace(',','.')),
        data.data || data.transaction_date,
        data.observacao || data.notes || null,
        data.vencimento || data.due_date || data.data || data.transaction_date,
        data.status_financeiro === 'liquidado' ? (data.data_liquidacao || data.settlement_date || data.data) : null,
        data.status_financeiro || data.financial_status || 'liquidado',
        (data.documento || data.document_number || '').slice(0,80) || null,
        (data.forma_pagamento || data.payment_method || '').slice(0,40) || null,
        req.usuario.id,
        data.excluido === 'sim' || data.deleted_at ? new Date() : null,
        pubId]
    );
  } else {
    if (!centerId || !cat) return res.status(400).json({ erro:'Centro ou categoria da versão escolhida não encontrado no cadastro local.' });
    await db.query(
      `INSERT INTO transactions
        (public_id, type, cost_center_id, category_id, description, counterparty, amount,
         transaction_date, notes, due_date, settlement_date, financial_status,
         document_number, payment_method, origin_instance_id, origin_instance_name,
         last_modified_instance_id, last_modified_instance_name, origin_user_name,
         revision, created_by, updated_by, updated_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
      [pubId, data.tipo || data.type, centerId, cat.id,
        (data.descricao || data.description || '').slice(0,240),
        (data.cliente_fornecedor || data.counterparty || '').slice(0,160) || null,
        Number(String(data.valor || data.amount || 0).replace(',','.')),
        data.data || data.transaction_date,
        data.observacao || data.notes || null,
        data.vencimento || data.due_date || data.data || data.transaction_date,
        data.status_financeiro === 'liquidado' ? (data.data_liquidacao || data.settlement_date || data.data) : null,
        data.status_financeiro || data.financial_status || 'liquidado',
        (data.documento || data.document_number || '').slice(0,80) || null,
        (data.forma_pagamento || data.payment_method || '').slice(0,40) || null,
        data.origem_id || data.origin_instance_id || '00000000-0000-0000-0000-000000000000',
        data.origem_nome || data.origin_instance_name || 'Desconhecida',
        data.alterado_na_instalacao_id || data.last_modified_instance_id || '00000000-0000-0000-0000-000000000000',
        data.alterado_na_instalacao_nome || data.last_modified_instance_name || 'Desconhecida',
        data.autor_original || data.origin_user_name || 'Sistema',
        data.revisao || data.revision || 1,
        req.usuario.id, req.usuario.id,
        data.alterado_em || data.updated_at || new Date(),
        data.excluido === 'sim' ? new Date() : null]
    );
  }

  await db.query("UPDATE sync_conflicts SET status='resolved' WHERE id=$1", [id]);
  res.json({ ok: true, mensagem: `Conflito resolvido. Versão ${escolha} aplicada.` });
}));

module.exports = router;
