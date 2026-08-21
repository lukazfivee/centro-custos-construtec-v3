const express = require('express');
const { getDb } = require('../db');
const { autenticar } = require('../middleware/auth');
const { asyncRoute } = require('../lib/http');

const router=express.Router();
router.use(autenticar);

router.get('/', asyncRoute(async (req,res)=>{
  const limit=Math.min(500,Math.max(20,Number(req.query.limite)||150));
  const type=String(req.query.tipo||'').trim();
  const values=[];
  const clauses=[];
  if(type){values.push(type);clauses.push(`entity_type=$${values.length}`);}
  values.push(limit);
  const { rows }=await getDb().query(`
    SELECT id,entity_type AS tipo,entity_id,action AS acao,summary AS resumo,data,
      user_name AS usuario,instance_name AS instancia,created_at
    FROM audit_log ${clauses.length?`WHERE ${clauses.join(' AND ')}`:''}
    ORDER BY created_at DESC LIMIT $${values.length}
  `,values);
  res.json(rows);
}));

module.exports=router;
