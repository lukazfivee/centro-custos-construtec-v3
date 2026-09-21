const express = require('express');
const { getDb } = require('../db');
const { autenticar } = require('../middleware/auth');
const { asyncRoute } = require('../lib/http');
const { parsePagination, wantsPagination, paginationMeta } = require('../lib/pagination');

const router=express.Router();
router.use(autenticar);

const HISTORY_COLUMNS = `id,entity_type AS tipo,entity_id,action AS acao,summary AS resumo,data,
  user_name AS usuario,instance_name AS instancia,created_at`;

router.get('/', asyncRoute(async (req,res)=>{
  const type=String(req.query.tipo||'').trim();
  const search=String(req.query.busca||'').trim();
  const values=[];
  const clauses=[];
  if(type){values.push(type);clauses.push(`entity_type=$${values.length}`);}
  if(search){
    values.push(`%${search.slice(0,100)}%`);
    clauses.push(`(summary ILIKE $${values.length} OR user_name ILIKE $${values.length} OR instance_name ILIKE $${values.length} OR entity_type ILIKE $${values.length} OR action ILIKE $${values.length})`);
  }
  const where = clauses.length?`WHERE ${clauses.join(' AND ')}`:'';
  const countValues = values.slice();

  if(!wantsPagination(req.query)){
    const legacyLimit=Math.min(500,Math.max(20,Number(req.query.limite)||150));
    values.push(legacyLimit);
    const { rows }=await getDb().query(`
      SELECT ${HISTORY_COLUMNS} FROM audit_log ${where} ORDER BY created_at DESC LIMIT $${values.length}
    `,values);
    res.setHeader('X-Result-Limit', String(legacyLimit));
    return res.json(rows);
  }

  const { page, limit, offset } = parsePagination(req.query, { defaultLimit:50, maxLimit:200 });
  values.push(limit, offset);
  const [dataResult, countResult] = await Promise.all([
    getDb().query(`
      SELECT ${HISTORY_COLUMNS} FROM audit_log ${where}
      ORDER BY created_at DESC LIMIT $${values.length-1} OFFSET $${values.length}
    `,values),
    getDb().query(`SELECT COUNT(*)::int AS total FROM audit_log ${where}`,countValues),
  ]);
  const total=Number(countResult.rows[0]?.total||0);
  res.setHeader('X-Total-Count',String(total));
  return res.json({ itens:dataResult.rows, paginacao:paginationMeta(total,page,limit) });
}));

module.exports=router;
