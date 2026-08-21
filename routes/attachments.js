const crypto = require('crypto');
const express = require('express');
const { getDb } = require('../db');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { recordAudit } = require('../services/audit');

const router = express.Router();
router.use(autenticar);

const MAX_SIZE = 8 * 1024 * 1024;
const MIME = new Set(['application/pdf','image/jpeg','image/png','image/webp']);
const CATEGORIES = new Set(['comprovante','nota_fiscal','boleto','recibo','contrato','outro']);

router.get('/lancamento/:transactionId', asyncRoute(async (req, res) => {
  const transactionId = positiveId(req.params.transactionId);
  await ensureTransaction(transactionId);
  const { rows } = await getDb().query(`
    SELECT id,public_id,original_name AS nome,mime_type AS tipo,size_bytes AS tamanho,
      sha256,category AS categoria,notes AS observacao,created_by_name AS enviado_por,created_at
    FROM transaction_attachments
    WHERE transaction_id=$1
    ORDER BY created_at DESC,id DESC`, [transactionId]);
  res.json(rows);
}));

router.post('/lancamento/:transactionId', asyncRoute(async (req, res) => {
  const transactionId = positiveId(req.params.transactionId);
  const transaction = await ensureTransaction(transactionId);
  const name = safeName(req.body.nome);
  const mimeType = String(req.body.tipo || '').trim().toLowerCase();
  const category = CATEGORIES.has(String(req.body.categoria || '')) ? String(req.body.categoria) : 'comprovante';
  const notes = String(req.body.observacao || '').trim().slice(0, 500) || null;
  if (!MIME.has(mimeType)) throw httpError(400, 'Formato não permitido. Use PDF, JPG, PNG ou WEBP.');
  const base64 = String(req.body.conteudoBase64 || '').replace(/^data:[^;]+;base64,/, '').trim();
  if (!base64) throw httpError(400, 'Selecione um arquivo para anexar.');
  let content;
  try { content = Buffer.from(base64, 'base64'); } catch { throw httpError(400, 'Arquivo inválido.'); }
  if (!content.length) throw httpError(400, 'O arquivo está vazio.');
  if (content.length > MAX_SIZE) throw httpError(413, 'O arquivo ultrapassa o limite de 8 MB.');
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  const duplicate = await getDb().query(
    'SELECT id FROM transaction_attachments WHERE transaction_id=$1 AND sha256=$2', [transactionId, hash]
  );
  if (duplicate.rows[0]) throw httpError(409, 'Este mesmo arquivo já está anexado ao lançamento.');

  const publicId = crypto.randomUUID();
  const { rows } = await getDb().query(`
    INSERT INTO transaction_attachments
      (public_id,transaction_id,original_name,mime_type,size_bytes,sha256,content,category,notes,created_by,created_by_name)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING id,public_id,original_name AS nome,mime_type AS tipo,size_bytes AS tamanho,
      category AS categoria,notes AS observacao,created_by_name AS enviado_por,created_at`,
    [publicId,transactionId,name,mimeType,content.length,hash,content,category,notes,req.usuario.id,req.usuario.name]
  );
  await recordAudit({
    entityType:'lancamento',entityId:transaction.public_id,action:'anexo_adicionado',
    summary:`Documento anexado: ${name}`,data:{ anexoPublicId:publicId,nome:name,tamanho:content.length,categoria:category,sha256:hash },
    user:req.usuario,
  });
  res.status(201).json(rows[0]);
}));

router.get('/:id/arquivo', asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const { rows } = await getDb().query(`
    SELECT original_name,mime_type,size_bytes,content
    FROM transaction_attachments WHERE id=$1`, [id]);
  const file = rows[0];
  if (!file) throw httpError(404, 'Documento não encontrado.');
  res.setHeader('Content-Type', file.mime_type);
  res.setHeader('Content-Length', String(file.size_bytes));
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.original_name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(file.content));
}));

router.delete('/:id', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const { rows } = await getDb().query(`
    SELECT a.id,a.public_id,a.original_name,a.sha256,t.public_id AS transaction_public_id
    FROM transaction_attachments a JOIN transactions t ON t.id=a.transaction_id
    WHERE a.id=$1`, [id]);
  const item = rows[0];
  if (!item) throw httpError(404, 'Documento não encontrado.');
  await getDb().query('DELETE FROM transaction_attachments WHERE id=$1', [id]);
  await recordAudit({
    entityType:'lancamento',entityId:item.transaction_public_id,action:'anexo_removido',
    summary:`Documento removido: ${item.original_name}`,
    data:{ anexoPublicId:item.public_id,nome:item.original_name,sha256:item.sha256 },user:req.usuario,
  });
  res.json({ ok:true });
}));

async function ensureTransaction(id) {
  const { rows } = await getDb().query(
    'SELECT id,public_id,description,deleted_at FROM transactions WHERE id=$1', [id]
  );
  const transaction = rows[0];
  if (!transaction || transaction.deleted_at) throw httpError(404, 'Lançamento não encontrado.');
  return transaction;
}

function safeName(value) {
  const name = String(value || '').trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 240);
  if (!name) throw httpError(400, 'Nome do arquivo inválido.');
  return name;
}

module.exports = router;
