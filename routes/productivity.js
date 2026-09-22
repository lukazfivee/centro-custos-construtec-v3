const { assertMutableTransaction, moneyCents } = require('../services/financialPolicy');
const { validDate } = require('../lib/dates');
const express = require('express');
const { getDb, getInstanceIdentity } = require('../db');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { recordAudit } = require('../services/audit');

const router = express.Router();
router.use(autenticar);

router.get('/sugestoes', asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const favorecido = String(req.query.favorecido || '').trim();
  const db = getDb();
  const values=[]; const clauses=['t.deleted_at IS NULL','t.reversal_of IS NULL'];
  if (favorecido) { values.push(`%${favorecido}%`); clauses.push(`COALESCE(t.counterparty,'') ILIKE $${values.length}`); }
  if (q) { values.push(`%${q}%`); clauses.push(`(t.description ILIKE $${values.length} OR COALESCE(t.counterparty,'') ILIKE $${values.length})`); }
  const { rows } = await db.query(`
    SELECT t.counterparty AS favorecido,t.category_id,c.name AS categoria,t.cost_center_id,cc.name AS centro_nome,
      t.payment_method AS forma_pagamento,COUNT(*)::int AS usos,
      ROUND(AVG(t.amount)::numeric,2) AS valor_medio,
      ROUND(MIN(t.amount)::numeric,2) AS menor_valor,
      ROUND(MAX(t.amount)::numeric,2) AS maior_valor,
      MAX(t.transaction_date)::text AS ultima_data
    FROM transactions t
    JOIN categories c ON c.id=t.category_id
    JOIN cost_centers cc ON cc.id=t.cost_center_id
    WHERE ${clauses.join(' AND ')}
    GROUP BY t.counterparty,t.category_id,c.name,t.cost_center_id,cc.name,t.payment_method
    ORDER BY usos DESC,MAX(t.transaction_date) DESC
    LIMIT 8`, values);
  res.json(rows);
}));

router.post('/acoes-em-massa', exigirPapel('admin','gestor'), asyncRoute(async (req,res) => {
  const ids = Array.isArray(req.body.ids) ? [...new Set(req.body.ids.map(Number).filter(Number.isInteger).filter(v=>v>0))] : [];
  if (!ids.length || ids.length > 200) throw httpError(400,'Selecione entre 1 e 200 lançamentos.');
  const action=String(req.body.acao||'');
  const allowed=['categoria','centro','liquidar','pendente'];
  if (!allowed.includes(action)) throw httpError(400,'Ação em massa inválida.');
  const db=getDb(); const instance=getInstanceIdentity();
  let updated=0;
  await db.transaction(async tx => {
    // Stable lock order makes the entire batch fail together on a closed entry.
    for (const id of ids.sort((a,b)=>a-b)) {
      const row=(await tx.query('SELECT * FROM transactions WHERE id=$1 FOR UPDATE',[id])).rows[0];
      await assertMutableTransaction(row,tx);
      let result;
      if (action==='categoria') {
        const categoryId=Number(req.body.category_id); if(!categoryId) throw httpError(400,'Categoria inválida.');
        result=await tx.query(`UPDATE transactions SET category_id=$1,revision=revision+1,updated_by=$2,updated_at=NOW(),last_modified_instance_id=$3,last_modified_instance_name=$4 WHERE id=$5 AND deleted_at IS NULL AND reversal_of IS NULL AND reversed_at IS NULL`,[categoryId,req.usuario.id,instance.id,instance.name,id]);
      } else if (action==='centro') {
        const centerId=positiveId(req.body.cost_center_id,'Centro de custo');
        if((await tx.query('SELECT 1 FROM transaction_allocations WHERE transaction_id=$1 LIMIT 1',[id])).rows.length) throw httpError(409,'Edite o rateio para alterar as obras deste lançamento.');
        result=await tx.query(`UPDATE transactions SET cost_center_id=$1,revision=revision+1,updated_by=$2,updated_at=NOW(),last_modified_instance_id=$3,last_modified_instance_name=$4 WHERE id=$5 AND deleted_at IS NULL AND reversal_of IS NULL AND reversed_at IS NULL`,[centerId,req.usuario.id,instance.id,instance.name,id]);
      } else if (action==='liquidar') {
        const date=String(req.body.data_liquidacao||new Date().toISOString().slice(0,10));
        if(!validDate(date)) throw httpError(400,'Data de liquidação inválida.');
        if(row.approval_status!=='aprovado') throw httpError(409,'Aprove o lançamento antes de liquidar.');
        result=await tx.query(`UPDATE transactions SET financial_status='liquidado',settlement_date=$1,revision=revision+1,updated_by=$2,updated_at=NOW(),last_modified_instance_id=$3,last_modified_instance_name=$4 WHERE id=$5 AND deleted_at IS NULL AND reversal_of IS NULL AND reversed_at IS NULL`,[date,req.usuario.id,instance.id,instance.name,id]);
      } else {
        result=await tx.query(`UPDATE transactions SET financial_status='pendente',settlement_date=NULL,revision=revision+1,updated_by=$1,updated_at=NOW(),last_modified_instance_id=$2,last_modified_instance_name=$3 WHERE id=$4 AND deleted_at IS NULL AND reversal_of IS NULL AND reversed_at IS NULL`,[req.usuario.id,instance.id,instance.name,id]);
      }
      updated += result.rowCount || 0;
    }
    await recordAudit({entityType:'lancamento',action:'acao_em_massa',summary:`${updated} lançamento(s) alterado(s) em massa.`,data:{acao:action,ids},user:req.usuario,client:tx});
  });
  res.json({ok:true,atualizados:updated});
}));

router.get('/visoes', asyncRoute(async (req,res)=>{
  const {rows}=await getDb().query(`SELECT id,name AS nome,scope AS escopo,filters AS filtros,created_at FROM saved_views WHERE user_id=$1 ORDER BY name`,[req.usuario.id]);
  res.json(rows);
}));

router.post('/visoes', asyncRoute(async (req,res)=>{
  const name=String(req.body.nome||'').trim(); if(!name) throw httpError(400,'Informe um nome para a visão.');
  const scope=String(req.body.escopo||'lancamentos').slice(0,30);
  const filters=req.body.filtros && typeof req.body.filtros==='object' ? req.body.filtros : {};
  const {rows}=await getDb().query(`INSERT INTO saved_views(user_id,name,scope,filters) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(user_id,scope,name) DO UPDATE SET filters=EXCLUDED.filters,updated_at=NOW() RETURNING id`,[req.usuario.id,name.slice(0,100),scope,JSON.stringify(filters)]);
  res.status(201).json(rows[0]);
}));

router.delete('/visoes/:id', asyncRoute(async(req,res)=>{
  const result=await getDb().query('DELETE FROM saved_views WHERE id=$1 AND user_id=$2',[Number(req.params.id),req.usuario.id]);
  if(!result.rowCount) throw httpError(404,'Visão não encontrada.'); res.json({ok:true});
}));

router.get('/rateio/:transactionId', asyncRoute(async(req,res)=>{
  const {rows}=await getDb().query(`SELECT a.id,a.cost_center_id,cc.code AS centro_codigo,cc.name AS centro_nome,a.amount AS valor,a.note AS observacao FROM transaction_allocations a JOIN cost_centers cc ON cc.id=a.cost_center_id WHERE a.transaction_id=$1 ORDER BY a.id`,[Number(req.params.transactionId)]);
  res.json(rows);
}));

router.put('/rateio/:transactionId', exigirPapel('admin','gestor'), asyncRoute(async(req,res)=>{
  const transactionId=positiveId(req.params.transactionId);
  if(!Array.isArray(req.body.rateios) || req.body.rateios.length>200) throw httpError(400,'Informe até 200 rateios.');
  const normalized=req.body.rateios.map(x=>({
    costCenterId:positiveId(x?.cost_center_id,'Centro de custo'),
    cents:moneyCents(x?.valor),note:String(x?.observacao||'').trim().slice(0,240),
  }));
  if(new Set(normalized.map(x=>x.costCenterId)).size!==normalized.length) throw httpError(400,'Cada obra deve aparecer uma única vez no rateio.');
  const totalCents=normalized.reduce((sum,x)=>sum+x.cents,0);
  if(!Number.isSafeInteger(totalCents)) throw httpError(400,'Total do rateio inválido.');
  const instance=getInstanceIdentity();
  let revision;
  await getDb().transaction(async tx=>{
    const row=(await tx.query('SELECT * FROM transactions WHERE id=$1 FOR UPDATE',[transactionId])).rows[0];
    await assertMutableTransaction(row,tx);
    if(normalized.length && totalCents!==moneyCents(row.amount)) throw httpError(400,`O rateio precisa somar exatamente R$ ${Number(row.amount).toFixed(2)}.`);
    for(const item of normalized) {
      if(!(await tx.query('SELECT id FROM cost_centers WHERE id=$1 AND active=TRUE',[item.costCenterId])).rows[0]) throw httpError(400,'Use uma obra ativa em cada rateio.');
    }
    await tx.query('DELETE FROM transaction_allocations WHERE transaction_id=$1',[transactionId]);
    for(const item of normalized) await tx.query('INSERT INTO transaction_allocations(transaction_id,cost_center_id,amount,note) VALUES($1,$2,$3,$4)',[transactionId,item.costCenterId,(item.cents/100).toFixed(2),item.note||null]);
    const result=await tx.query(`UPDATE transactions SET revision=revision+1,updated_at=NOW(),updated_by=$2,
      last_modified_instance_id=$3,last_modified_instance_name=$4 WHERE id=$1 RETURNING revision`,[transactionId,req.usuario.id,instance.id,instance.name]);
    revision=result.rows[0].revision;
    await recordAudit({entityType:'lancamento',entityId:transactionId,action:'rateado',summary:`Rateio atualizado: ${row.description}`,data:{rateios:normalized,total:totalCents/100},user:req.usuario,client:tx});
  });
  res.json({ok:true,total:totalCents/100,revisao:revision});
}));

module.exports=router;
