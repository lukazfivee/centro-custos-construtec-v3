const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db');
const { autenticar } = require('../middleware/auth');
const { exigirPermissao } = require('../services/permissions');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { parsePagination, wantsPagination, paginationMeta } = require('../lib/pagination');
const { csvLine } = require('../lib/csv');
const { currentMonth, monthRange, validMonth } = require('../lib/dates');
const { digits, documentoValido, formatarDocumento } = require('../lib/documento');
const { recordAudit } = require('../services/audit');
const { obrasPermitidas } = require('../services/obraScope');

const router = express.Router();
router.use(autenticar);

// $1 e $2 = inicio e fim do mes; $3 = obras permitidas, so para usuario escopado (`scope`).
// O lancamento so liga ao fornecedor pelo nome (counterparty).
const suppliersSelect = (scope) => `
  SELECT s.id,s.name AS nome,s.document AS documento,s.contact_name AS contato,s.email,s.phone AS telefone,
    s.notes AS observacao,s.active AS ativo,s.revision,s.default_category_id AS categoria_id,c.name AS categoria,
    s.created_at,s.updated_at,COALESCE(m.gasto,0) AS gasto_mes,COALESCE(m.qtd,0) AS lancamentos_mes
  FROM suppliers s
  LEFT JOIN categories c ON c.id=s.default_category_id
  LEFT JOIN (
    SELECT LOWER(TRIM(counterparty)) AS chave,
      SUM(amount*accounting_sign) FILTER (WHERE type='despesa') AS gasto,
      COUNT(*) FILTER (WHERE accounting_sign=1) AS qtd
    FROM transactions
    WHERE deleted_at IS NULL AND counterparty IS NOT NULL AND transaction_date >= $1 AND transaction_date < $2${scope}
    GROUP BY 1
  ) m ON m.chave=LOWER(TRIM(s.name))`;

function periodo(query) {
  const mes = String(query.mes || currentMonth());
  if (!validMonth(mes)) throw httpError(400, 'Mês inválido. Use o formato AAAA-MM.');
  return monthRange(mes);
}

router.get('/', asyncRoute(async (req,res) => {
  const { start, end } = periodo(req.query);
  const orderBy = 's.active DESC,s.name';
  // Usuario escopado soma so as obras permitidas (sem nenhuma, tudo zera); o cadastro em si e global.
  const obras = await obrasPermitidas(req);
  const values = obras ? [start, end, obras] : [start, end];
  const select = suppliersSelect(obras ? ' AND cost_center_id = ANY($3::int[])' : '');
  const search = searchTerm(req.query);
  const dataValues = search ? [...values, search] : values;
  const where = search ? searchWhere(dataValues.length) : '';
  if (!wantsPagination(req.query)) {
    const { rows } = await getDb().query(`${select} ${where} ORDER BY ${orderBy} LIMIT 500`, dataValues);
    res.setHeader('X-Result-Limit', '500');
    return res.json(rows);
  }
  const { page, limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
  const [dataResult, countResult] = await Promise.all([
    getDb().query(`${select} ${where} ORDER BY ${orderBy} LIMIT $${dataValues.length + 1} OFFSET $${dataValues.length + 2}`, [...dataValues, limit, offset]),
    getDb().query(`SELECT COUNT(*)::int AS total FROM suppliers s ${search ? searchWhere(1) : ''}`, search ? [search] : []),
  ]);
  const total = Number(countResult.rows[0]?.total || 0);
  res.setHeader('X-Total-Count', String(total));
  return res.json({ itens: dataResult.rows, paginacao: paginationMeta(total, page, limit) });
}));

function searchTerm(query) {
  if (!query.busca || !String(query.busca).trim()) return null;
  return `%${String(query.busca).trim().slice(0, 100)}%`;
}

function searchWhere(n) {
  return `WHERE (s.name ILIKE $${n} OR COALESCE(s.document, '') ILIKE $${n} OR COALESCE(s.contact_name, '') ILIKE $${n})`;
}

router.get('/exportar.csv', asyncRoute(async (req,res) => {
  const { rows } = await getDb().query(`SELECT name,document,contact_name,email,phone,notes,active FROM suppliers ORDER BY active DESC,name`);
  const lines=[csvLine(['Fornecedor','Documento','Contato','E-mail','Telefone','Observação','Status'])];
  rows.forEach((row)=>lines.push(csvLine([row.name,row.document,row.contact_name,row.email,row.phone,row.notes,row.active?'Ativo':'Inativo'])));
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="fornecedores.csv"');
  res.send(`﻿${lines.join('\r\n')}`);
}));

// Painel do fornecedor: lancamentos do mes (mais recentes primeiro) e a soma.
router.get('/:id/resumo', asyncRoute(async (req,res) => {
  const id = positiveId(req.params.id);
  const { start, end } = periodo(req.query);
  const supplier = await getDb().query('SELECT id,name FROM suppliers WHERE id=$1', [id]);
  if (!supplier.rows.length) throw httpError(404,'Fornecedor não encontrado.');
  const db = getDb();
  const obras = await obrasPermitidas(req);
  const values = [supplier.rows[0].name, start, end];
  if (obras) values.push(obras);
  const [lista, totais] = await Promise.all([db.query(
    `SELECT t.id,t.description AS descricao,t.type AS tipo,t.amount AS valor,t.accounting_sign AS sinal,
       t.transaction_date::text AS data,t.financial_status AS status,cc.code AS obra_codigo,c.name AS categoria
     FROM transactions t JOIN cost_centers cc ON cc.id=t.cost_center_id JOIN categories c ON c.id=t.category_id
     WHERE t.deleted_at IS NULL AND LOWER(TRIM(t.counterparty))=LOWER(TRIM($1))
       AND t.transaction_date >= $2 AND t.transaction_date < $3${obras ? ' AND t.cost_center_id = ANY($4::int[])' : ''}
     ORDER BY t.transaction_date DESC,t.id DESC LIMIT 50`,
    values
  ), db.query(
    `SELECT COALESCE(SUM(amount*accounting_sign) FILTER (WHERE type='despesa'),0) AS gasto,
       COUNT(*) FILTER (WHERE accounting_sign=1) AS qtd
     FROM transactions WHERE deleted_at IS NULL AND LOWER(TRIM(counterparty))=LOWER(TRIM($1))
       AND transaction_date >= $2 AND transaction_date < $3${obras ? ' AND cost_center_id = ANY($4::int[])' : ''}`,
    values
  )]);
  res.json({ lancamentos: lista.rows, gasto_mes: Number(totais.rows[0].gasto), lancamentos_mes: Number(totais.rows[0].qtd) });
}));

router.post('/', exigirPermissao('p5'), asyncRoute(async (req,res) => {
  const data=validate(req.body);
  await assertDocumentoLivre(data.document);
  await assertCategoria(data.categoryId);
  const publicId = crypto.randomUUID();
  let rows;
  try {
    ({ rows }=await getDb().query(
      `INSERT INTO suppliers (public_id,name,document,contact_name,email,phone,notes,default_category_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [publicId,data.name,data.document,data.contact,data.email,data.phone,data.notes,data.categoryId]
    ));
  } catch (error) { await rethrowDocumentConflict(error, data.document); }
  await recordAudit({entityType:'fornecedor',entityId:rows[0].id,action:'criado',summary:`Fornecedor criado: ${data.name}`,data,user:req.usuario});
  res.status(201).json(rows[0]);
}));

router.put('/:id', exigirPermissao('p5'), asyncRoute(async (req,res) => {
  const id=positiveId(req.params.id);
  const current = await getDb().query('SELECT document FROM suppliers WHERE id=$1', [id]);
  if(!current.rows.length) throw httpError(404,'Fornecedor não encontrado.');
  // Documento antigo, mal digitado, nao trava a edicao de outros campos: so vale a regra se mudou.
  const unchanged = digits(current.rows[0].document) === digits(req.body.documento);
  const data=validate(req.body, { skipDocument: unchanged });
  await assertDocumentoLivre(data.document, id);
  await assertCategoria(data.categoryId);
  let result;
  try {
    result=await getDb().query(
      `UPDATE suppliers SET name=$1,document=$2,contact_name=$3,email=$4,phone=$5,notes=$6,
         active=$7,default_category_id=$8,revision=revision+1,updated_at=NOW() WHERE id=$9 RETURNING revision`,
      [data.name,data.document,data.contact,data.email,data.phone,data.notes,req.body.ativo!==false,data.categoryId,id]
    );
  } catch (error) { await rethrowDocumentConflict(error, data.document); }
  await recordAudit({entityType:'fornecedor',entityId:id,action:'atualizado',summary:`Fornecedor atualizado: ${data.name}`,data:{...data,revision:result.rows[0].revision},user:req.usuario});
  res.json({ok:true,revisao:result.rows[0].revision});
}));

async function assertDocumentoLivre(document, ignoreId = 0) {
  const numero = digits(document);
  if (!numero) return;
  const { rows } = await getDb().query(
    `SELECT name FROM suppliers WHERE id <> $1 AND regexp_replace(COALESCE(document,''),'\\D','','g') = $2 LIMIT 1`,
    [ignoreId, numero]
  );
  if (rows.length) throw httpError(409, `Já existe um fornecedor com esse ${numero.length === 11 ? 'CPF' : 'CNPJ'}: ${rows[0].name}.`);
}

async function rethrowDocumentConflict(error, document) {
  if (error.code !== '23505' || !String(error.constraint || error.message).includes('suppliers_document_digits_unique')) throw error;
  await assertDocumentoLivre(document);
  throw httpError(409, 'Já existe um fornecedor com esse CPF/CNPJ.');
}

async function assertCategoria(categoryId) {
  if (!categoryId) return;
  const { rows } = await getDb().query('SELECT 1 FROM categories WHERE id=$1', [categoryId]); // PGlite: rowCount de SELECT vem 0
  if (!rows.length) throw httpError(400, 'Categoria não encontrada.');
}

function normalizeDocument(value, skip) {
  const raw = String(value || '').trim().slice(0, 30);
  if (!raw || skip) return raw || null;
  const numero = digits(raw);
  if (numero.length !== 11 && numero.length !== 14) throw httpError(400, 'Informe um CPF com 11 dígitos ou um CNPJ com 14 dígitos.');
  if (!documentoValido(numero)) throw httpError(400, numero.length === 11 ? 'CPF inválido.' : 'CNPJ inválido.');
  return formatarDocumento(numero);
}

function validate(body, { skipDocument = false } = {}) {
  const name=String(body.nome||'').trim();
  if(!name) throw httpError(400,'Informe o nome do fornecedor.');
  const optional=(value,limit)=>String(value||'').trim().slice(0,limit)||null;
  const email=optional(body.email,180);
  if(email && !/^\S+@\S+\.\S+$/.test(email)) throw httpError(400,'E-mail inválido.');
  const categoryId = body.categoria_id ? Number(body.categoria_id) : null;
  if (categoryId !== null && (!Number.isInteger(categoryId) || categoryId <= 0)) throw httpError(400,'Categoria inválida.');
  return {name:name.slice(0,160),document:normalizeDocument(body.documento, skipDocument),contact:optional(body.contato,120),
    email,phone:optional(body.telefone,40),notes:optional(body.observacao,2000),categoryId};
}

module.exports = router;
