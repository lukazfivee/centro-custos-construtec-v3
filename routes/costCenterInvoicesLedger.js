const crypto = require('crypto');
const express = require('express');
const { getDb } = require('../db');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { recordAudit } = require('../services/audit');

const router = express.Router();
router.use(autenticar);

const MAX_SIZE = 5 * 1024 * 1024;
const TIPOS = ['fornecedor', 'cliente'];
const STATUSES = ['paga', 'nao_paga'];

async function centerById(id) {
  const { rows } = await getDb().query('SELECT id,public_id,code,name FROM cost_centers WHERE id=$1', [id]);
  if (!rows[0]) throw httpError(404, 'Centro de custo não encontrado.');
  return rows[0];
}

function validTipo(value) {
  const tipo = String(value || '').trim().toLowerCase();
  if (!TIPOS.includes(tipo)) throw httpError(400, 'Informe o tipo da nota fiscal: fornecedor ou cliente.');
  return tipo;
}

function validStatus(value) {
  const status = String(value || 'nao_paga').trim().toLowerCase();
  if (!STATUSES.includes(status)) throw httpError(400, 'Status inválido. Use paga ou nao_paga.');
  return status;
}

function validDate(value) {
  if (value == null || value === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw httpError(400, 'Data de emissão inválida.');
  return value;
}

function validValor(value) {
  const valor = Number(value);
  if (!Number.isFinite(valor) || valor < 0) throw httpError(400, 'Valor inválido.');
  return valor;
}

function decodeOptionalPdf(body) {
  const base64 = String(body?.conteudoBase64 || '').replace(/^data:[^;]+;base64,/, '').trim();
  if (!base64) return null;
  const name = String(body?.nome || '').trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 240);
  if (!name || !/\.pdf$/i.test(name)) throw httpError(400, 'O arquivo da nota fiscal deve ser um PDF.');
  const mime = String(body?.tipoArquivo || '').trim().toLowerCase();
  if (mime && mime !== 'application/pdf') throw httpError(400, 'O arquivo da nota fiscal deve ser um PDF.');
  let content;
  try { content = Buffer.from(base64, 'base64'); } catch { throw httpError(400, 'Arquivo PDF inválido.'); }
  if (!content.length) throw httpError(400, 'O arquivo está vazio.');
  if (content.length > MAX_SIZE) throw httpError(413, 'A nota fiscal em PDF deve ter no máximo 5 MB.');
  if (content.slice(0, 5).toString('ascii') !== '%PDF-') throw httpError(400, 'O arquivo selecionado não parece ser um PDF válido.');
  return { name, content, hash: crypto.createHash('sha256').update(content).digest('hex') };
}

function publicLedgerEntry(row) {
  return {
    id: row.id,
    tipo: row.tipo,
    nomeArquivo: row.original_name || null,
    temArquivo: Boolean(row.original_name),
    dataEmissao: row.data_emissao,
    valor: Number(row.valor || 0),
    status: row.status,
    observacao: row.observacao || '',
    enviadoPor: row.uploaded_by_name || null,
    criadoEm: row.created_at,
    atualizadoEm: row.updated_at,
  };
}

router.get('/:id/notas-fiscais', asyncRoute(async (req, res) => {
  const center = await centerById(positiveId(req.params.id));
  const tipoFilter = req.query.tipo ? validTipo(req.query.tipo) : null;
  const params = [center.id];
  let sql = `SELECT id,tipo,original_name,data_emissao::text AS data_emissao,valor,status,observacao,uploaded_by_name,created_at,updated_at
    FROM cost_center_invoices_ledger WHERE cost_center_id=$1`;
  if (tipoFilter) { sql += ' AND tipo=$2'; params.push(tipoFilter); }
  sql += ' ORDER BY data_emissao DESC NULLS LAST, id DESC';
  const { rows } = await getDb().query(sql, params);
  res.json(rows.map(publicLedgerEntry));
}));

router.post('/:id/notas-fiscais', exigirPapel('admin', 'gestor'), asyncRoute(async (req, res) => {
  const center = await centerById(positiveId(req.params.id));
  const tipo = validTipo(req.body?.tipo);
  const status = validStatus(req.body?.status);
  const dataEmissao = validDate(req.body?.dataEmissao);
  const valor = validValor(req.body?.valor);
  const file = decodeOptionalPdf(req.body);
  const observacao = String(req.body?.observacao || '').slice(0, 1000);
  const now = new Date();
  const { rows } = await getDb().query(`
    INSERT INTO cost_center_invoices_ledger
      (cost_center_id,tipo,original_name,mime_type,size_bytes,sha256,content,data_emissao,valor,status,observacao,uploaded_by,uploaded_by_name,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
    RETURNING id,tipo,original_name,data_emissao::text AS data_emissao,valor,status,observacao,uploaded_by_name,created_at,updated_at`,
    [
      center.id, tipo,
      file?.name || null, file ? 'application/pdf' : null, file ? file.content.length : null,
      file ? file.hash : null, file ? file.content : null,
      dataEmissao, valor, status, observacao, req.usuario.id, req.usuario.name, now,
    ]
  );
  await recordAudit({
    entityType: 'obra', entityId: center.public_id, action: 'nota_fiscal_ledger_criada',
    summary: `Nota fiscal (${tipo}) lançada no centro ${center.code}`,
    data: { tipo, valor, status, dataEmissao }, user: req.usuario,
  });
  res.status(201).json(publicLedgerEntry(rows[0]));
}));

async function ledgerById(nfId) {
  const { rows } = await getDb().query(`
    SELECT l.*, cc.public_id AS center_public_id, cc.code AS center_code
    FROM cost_center_invoices_ledger l JOIN cost_centers cc ON cc.id=l.cost_center_id
    WHERE l.id=$1`, [nfId]);
  if (!rows[0]) throw httpError(404, 'Nota fiscal não encontrada.');
  return rows[0];
}

router.put('/notas-fiscais/:nfId', exigirPapel('admin', 'gestor'), asyncRoute(async (req, res) => {
  const nfId = positiveId(req.params.nfId, 'Identificador da nota fiscal');
  const existing = await ledgerById(nfId);
  const status = req.body?.status !== undefined ? validStatus(req.body.status) : existing.status;
  const dataEmissao = req.body?.dataEmissao !== undefined ? validDate(req.body.dataEmissao) : existing.data_emissao;
  const valor = req.body?.valor !== undefined ? validValor(req.body.valor) : Number(existing.valor);
  const observacao = req.body?.observacao !== undefined ? String(req.body.observacao).slice(0, 1000) : existing.observacao;
  const now = new Date();
  const { rows } = await getDb().query(`
    UPDATE cost_center_invoices_ledger SET status=$1,data_emissao=$2,valor=$3,observacao=$4,updated_at=$5
    WHERE id=$6
    RETURNING id,tipo,original_name,data_emissao::text AS data_emissao,valor,status,observacao,uploaded_by_name,created_at,updated_at`,
    [status, dataEmissao, valor, observacao, now, nfId]
  );
  await recordAudit({
    entityType: 'obra', entityId: existing.center_public_id, action: 'nota_fiscal_ledger_atualizada',
    summary: `Nota fiscal (${existing.tipo}) atualizada no centro ${existing.center_code}`,
    data: { status, valor, dataEmissao }, user: req.usuario,
  });
  res.json(publicLedgerEntry(rows[0]));
}));

router.delete('/notas-fiscais/:nfId', exigirPapel('admin', 'gestor'), asyncRoute(async (req, res) => {
  const nfId = positiveId(req.params.nfId, 'Identificador da nota fiscal');
  const existing = await ledgerById(nfId);
  await getDb().query('DELETE FROM cost_center_invoices_ledger WHERE id=$1', [nfId]);
  await recordAudit({
    entityType: 'obra', entityId: existing.center_public_id, action: 'nota_fiscal_ledger_removida',
    summary: `Nota fiscal (${existing.tipo}) removida do centro ${existing.center_code}`,
    data: { valor: Number(existing.valor), status: existing.status }, user: req.usuario,
  });
  res.json({ ok: true });
}));

module.exports = router;
