const express = require('express');
const { getDb } = require('../db');
const { autenticar } = require('../middleware/auth');
const { bloquearEscopado } = require('../services/obraScope');
const { asyncRoute, httpError } = require('../lib/http');
const { parsePagination, wantsPagination, paginationMeta } = require('../lib/pagination');
const { validDate } = require('../lib/dates');
const { csvLine } = require('../lib/csv');

const router=express.Router();
router.use(autenticar);
router.use(bloquearEscopado);

const HISTORY_COLUMNS = `id,entity_type AS tipo,entity_id,action AS acao,summary AS resumo,data,before AS antes,
  COALESCE(origem,'computador') AS origem,user_id AS usuario_id,user_name AS usuario,instance_name AS instancia,created_at`;
const EXPORT_LIMIT = 5000;
const DIA_BR = "(created_at AT TIME ZONE 'America/Sao_Paulo')::date";

// Grupos da tela (Lançamentos, Cadastros...) em cima do entity_type e da ação gravados.
const GRUPOS = {
  lancamentos: "(entity_type IN ('lancamento','recorrente','conciliacao'))",
  cadastros: "(entity_type IN ('categoria','fornecedor','obra') AND action NOT LIKE 'nota_fiscal%' AND action NOT LIKE 'proposta%')",
  cobrancas: "(entity_type='cobranca' OR action LIKE 'nota_fiscal%' OR action LIKE 'proposta%')",
  fechamento: "(entity_type='fechamento')",
  usuarios: "(entity_type IN ('usuario','permissao'))",
};

function buildFilters(query) {
  const values=[];
  const clauses=[];
  const type=String(query.tipo||'').trim().toLowerCase();
  const search=String(query.busca||'').trim();
  const person=String(query.usuario||'').trim();
  const from=String(query.de||'').trim();
  const to=String(query.ate||'').trim();
  if(type && type!=='todos'){
    if(GRUPOS[type]) clauses.push(GRUPOS[type]);
    else {values.push(type.slice(0,40));clauses.push(`entity_type=$${values.length}`);}
  }
  if(person){
    if(/^\d+$/.test(person)){values.push(Number(person));clauses.push(`user_id=$${values.length}`);}
    else {values.push(`%${person.slice(0,100)}%`);clauses.push(`user_name ILIKE $${values.length}`);}
  }
  if(from && !validDate(from)) throw httpError(400,'Data inicial inválida. Use AAAA-MM-DD.');
  if(to && !validDate(to)) throw httpError(400,'Data final inválida. Use AAAA-MM-DD.');
  if(from && to && from>to) throw httpError(400,'A data inicial não pode ser depois da final.');
  if(from){values.push(from);clauses.push(`${DIA_BR}>=$${values.length}::date`);}
  if(to){values.push(to);clauses.push(`${DIA_BR}<=$${values.length}::date`);}
  if(search){
    values.push(`%${search.slice(0,100)}%`);
    clauses.push(`(summary ILIKE $${values.length} OR user_name ILIKE $${values.length} OR instance_name ILIKE $${values.length} OR entity_type ILIKE $${values.length} OR action ILIKE $${values.length} OR entity_id ILIKE $${values.length})`);
  }
  return { values, where: clauses.length?`WHERE ${clauses.join(' AND ')}`:'' };
}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Linhas de lançamento ganham lancamento_id (o id numérico) para o "Abrir lançamento" da tela.
async function anexarLancamentos(rows){
  const publicos=[...new Set(rows.filter((r)=>r.tipo==='lancamento'&&UUID.test(r.entity_id||'')).map((r)=>r.entity_id.toLowerCase()))];
  const mapa=new Map();
  if(publicos.length){
    const { rows:achados }=await getDb().query(
      'SELECT id,public_id::text AS public_id FROM transactions WHERE public_id = ANY($1::uuid[]) AND deleted_at IS NULL',[publicos]);
    achados.forEach((a)=>mapa.set(a.public_id.toLowerCase(),a.id));
  }
  return rows.map((r)=>({ ...r, lancamento_id:r.tipo==='lancamento'?(mapa.get(String(r.entity_id||'').toLowerCase())||null):null }));
}

router.get('/pessoas', asyncRoute(async (_req,res)=>{
  const { rows }=await getDb().query(`
    SELECT user_id AS id,MAX(user_name) AS nome FROM audit_log WHERE user_id IS NOT NULL
    GROUP BY user_id ORDER BY MAX(user_name) LIMIT 200`);
  res.json(rows);
}));

// Planilha trata =, +, - e @ no começo como fórmula: o texto livre ganha um apóstrofo na frente.
const PERIGOSO = /^[=+\-@\t\r]/;
function seguro(valor){
  const texto=valor==null?'':String(valor);
  return PERIGOSO.test(texto)?`'${texto}`:texto;
}

function textoJson(valor){
  if(valor==null) return '';
  return Object.entries(valor).map(([chave,item])=>`${chave}: ${item && typeof item==='object'?JSON.stringify(item):item}`).join(' | ');
}

router.get('/exportar.csv', asyncRoute(async (req,res)=>{
  const { values, where }=buildFilters(req.query);
  values.push(EXPORT_LIMIT);
  const { rows }=await getDb().query(
    `SELECT ${HISTORY_COLUMNS} FROM audit_log ${where} ORDER BY created_at DESC LIMIT $${values.length}`,values);
  const lines=[csvLine(['Quando','Usuário','Ação','Tipo','Registro','Resumo','Origem','Antes','Depois'])];
  rows.forEach((row)=>lines.push(csvLine([
    new Date(row.created_at).toISOString(),seguro(row.usuario),row.acao,row.tipo,seguro(row.entity_id),seguro(row.resumo),
    row.origem,seguro(textoJson(row.antes)),seguro(textoJson(row.data)),
  ])));
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="historico.csv"');
  res.send(`﻿${lines.join('\r\n')}\r\n`);
}));

router.get('/', asyncRoute(async (req,res)=>{
  const { values, where }=buildFilters(req.query);
  const countValues = values.slice();

  if(!wantsPagination(req.query)){
    const legacyLimit=Math.min(500,Math.max(20,Number(req.query.limite)||150));
    values.push(legacyLimit);
    const { rows }=await getDb().query(`
      SELECT ${HISTORY_COLUMNS} FROM audit_log ${where} ORDER BY created_at DESC LIMIT $${values.length}
    `,values);
    res.setHeader('X-Result-Limit', String(legacyLimit));
    return res.json(await anexarLancamentos(rows));
  }

  const { page, limit, offset } = parsePagination(req.query, { defaultLimit:50, maxLimit:200 });
  values.push(limit, offset);
  const [dataResult, countResult] = await Promise.all([
    getDb().query(`
      SELECT ${HISTORY_COLUMNS} FROM audit_log ${where}
      ORDER BY created_at DESC,id DESC LIMIT $${values.length-1} OFFSET $${values.length}
    `,values),
    getDb().query(`SELECT COUNT(*)::int AS total FROM audit_log ${where}`,countValues),
  ]);
  const total=Number(countResult.rows[0]?.total||0);
  res.setHeader('X-Total-Count',String(total));
  return res.json({ itens:await anexarLancamentos(dataResult.rows), paginacao:paginationMeta(total,page,limit) });
}));

module.exports=router;
