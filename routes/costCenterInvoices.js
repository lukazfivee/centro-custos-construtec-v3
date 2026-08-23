const crypto = require('crypto');
const express = require('express');
const { getDb } = require('../db');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { recordAudit } = require('../services/audit');

const router = express.Router();
router.use(autenticar);

const MAX_SIZE = 5 * 1024 * 1024;

async function centerById(id) {
  const { rows } = await getDb().query('SELECT id,public_id,code,name FROM cost_centers WHERE id=$1', [id]);
  if (!rows[0]) throw httpError(404, 'Centro de custo não encontrado.');
  return rows[0];
}

async function centerByPublicId(publicId) {
  const { rows } = await getDb().query('SELECT id,public_id,code,name FROM cost_centers WHERE public_id=$1', [String(publicId || '').trim()]);
  if (!rows[0]) throw httpError(404, 'Centro de custo não encontrado nesta instalação.');
  return rows[0];
}

function safeName(value) {
  const name = String(value || '').trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 240);
  if (!name || !/\.pdf$/i.test(name)) throw httpError(400, 'A nota fiscal deve ser um arquivo PDF.');
  return name;
}

function decodePdf(body) {
  const name = safeName(body?.nome);
  const mime = String(body?.tipo || '').trim().toLowerCase();
  if (mime && mime !== 'application/pdf') throw httpError(400, 'A nota fiscal deve ser um arquivo PDF.');
  const base64 = String(body?.conteudoBase64 || '').replace(/^data:[^;]+;base64,/, '').trim();
  if (!base64) throw httpError(400, 'Selecione a nota fiscal em PDF.');
  let content;
  try { content = Buffer.from(base64, 'base64'); } catch { throw httpError(400, 'Arquivo PDF inválido.'); }
  if (!content.length) throw httpError(400, 'O arquivo está vazio.');
  if (content.length > MAX_SIZE) throw httpError(413, 'A nota fiscal em PDF deve ter no máximo 5 MB.');
  if (content.slice(0, 5).toString('ascii') !== '%PDF-') throw httpError(400, 'O arquivo selecionado não parece ser um PDF válido.');
  return { name, content, hash:crypto.createHash('sha256').update(content).digest('hex') };
}

function publicInvoice(row) {
  if (!row) return null;
  return {
    nome:row.original_name,
    tipo:row.mime_type,
    tamanho:Number(row.size_bytes || 0),
    sha256:row.sha256,
    enviadoPor:row.uploaded_by_name || null,
    criadoEm:row.created_at,
    atualizadoEm:row.updated_at,
  };
}

async function invoiceRow(centerId, includeContent=false) {
  const fields = includeContent
    ? 'original_name,mime_type,size_bytes,sha256,content,uploaded_by_name,created_at,updated_at'
    : 'original_name,mime_type,size_bytes,sha256,uploaded_by_name,created_at,updated_at';
  const { rows } = await getDb().query(`SELECT ${fields} FROM cost_center_invoices WHERE cost_center_id=$1`, [centerId]);
  return rows[0] || null;
}

router.get('/:id', asyncRoute(async (req, res) => {
  const center = await centerById(positiveId(req.params.id));
  const invoice = await invoiceRow(center.id);
  res.json({ centroPublicId:center.public_id, notaFiscal:publicInvoice(invoice) });
}));

router.get('/public/:publicId', asyncRoute(async (req, res) => {
  const center = await centerByPublicId(req.params.publicId);
  const invoice = await invoiceRow(center.id);
  res.json({ centroId:center.id, centroPublicId:center.public_id, notaFiscal:publicInvoice(invoice) });
}));

router.get('/public/:publicId/conteudo', asyncRoute(async (req, res) => {
  const center = await centerByPublicId(req.params.publicId);
  const invoice = await invoiceRow(center.id, true);
  if (!invoice) throw httpError(404, 'Nenhuma nota fiscal vinculada a este centro de custo.');
  res.json({
    filename:invoice.original_name,
    contentType:'application/pdf',
    contentBase64:Buffer.from(invoice.content).toString('base64'),
    sizeBytes:Number(invoice.size_bytes || 0),
  });
}));

router.get('/:id/arquivo', asyncRoute(async (req, res) => {
  const center = await centerById(positiveId(req.params.id));
  const invoice = await invoiceRow(center.id, true);
  if (!invoice) throw httpError(404, 'Nenhuma nota fiscal vinculada a este centro de custo.');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(invoice.size_bytes));
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(invoice.original_name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(invoice.content));
}));

router.post('/:id', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  const center = await centerById(positiveId(req.params.id));
  const file = decodePdf(req.body);
  const now = new Date();
  const { rows } = await getDb().query(`
    INSERT INTO cost_center_invoices
      (cost_center_id,original_name,mime_type,size_bytes,sha256,content,uploaded_by,uploaded_by_name,created_at,updated_at)
    VALUES ($1,$2,'application/pdf',$3,$4,$5,$6,$7,$8,$8)
    ON CONFLICT (cost_center_id) DO UPDATE SET
      original_name=excluded.original_name,mime_type='application/pdf',size_bytes=excluded.size_bytes,
      sha256=excluded.sha256,content=excluded.content,uploaded_by=excluded.uploaded_by,
      uploaded_by_name=excluded.uploaded_by_name,updated_at=excluded.updated_at
    RETURNING original_name,mime_type,size_bytes,sha256,uploaded_by_name,created_at,updated_at`,
    [center.id,file.name,file.content.length,file.hash,file.content,req.usuario.id,req.usuario.name,now]
  );
  await recordAudit({
    entityType:'obra',entityId:center.public_id,action:'nota_fiscal_vinculada',
    summary:`Nota fiscal vinculada ao centro ${center.code}: ${file.name}`,
    data:{ nome:file.name,tamanho:file.content.length,sha256:file.hash },user:req.usuario,
  });
  res.status(201).json({ notaFiscal:publicInvoice(rows[0]) });
}));

router.delete('/:id', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  const center = await centerById(positiveId(req.params.id));
  const invoice = await invoiceRow(center.id);
  if (!invoice) throw httpError(404, 'Nenhuma nota fiscal vinculada a este centro de custo.');
  await getDb().query('DELETE FROM cost_center_invoices WHERE cost_center_id=$1', [center.id]);
  await recordAudit({
    entityType:'obra',entityId:center.public_id,action:'nota_fiscal_removida',
    summary:`Nota fiscal removida do centro ${center.code}: ${invoice.original_name}`,
    data:{ nome:invoice.original_name,sha256:invoice.sha256 },user:req.usuario,
  });
  res.json({ ok:true });
}));

module.exports = router;
