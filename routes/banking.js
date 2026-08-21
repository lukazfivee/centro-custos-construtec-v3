const crypto=require('crypto');
const express=require('express');
const {getDb}=require('../db');
const {autenticar,exigirPapel}=require('../middleware/auth');
const {asyncRoute,httpError}=require('../lib/http');
const {recordAudit}=require('../services/audit');

const router=express.Router();
router.use(autenticar);

router.get('/contas',asyncRoute(async(req,res)=>{
  const {rows}=await getDb().query(`SELECT id,name AS nome,account_type AS tipo,institution AS instituicao,opening_balance AS saldo_inicial,active AS ativo FROM financial_accounts ORDER BY active DESC,name`);
  res.json(rows);
}));

router.post('/contas',exigirPapel('admin','gestor'),asyncRoute(async(req,res)=>{
  const nome=String(req.body.nome||'').trim(); if(!nome) throw httpError(400,'Informe o nome da conta.');
  const tipo=String(req.body.tipo||'banco'); if(!['banco','caixa','cartao','adiantamento'].includes(tipo)) throw httpError(400,'Tipo de conta inválido.');
  const instituicao=String(req.body.instituicao||'').trim()||null;
  const saldo=Number(req.body.saldo_inicial||0); if(!Number.isFinite(saldo)) throw httpError(400,'Saldo inicial inválido.');
  const {rows}=await getDb().query(`INSERT INTO financial_accounts(name,account_type,institution,opening_balance) VALUES($1,$2,$3,$4) RETURNING id`,[nome.slice(0,120),tipo,instituicao?.slice(0,100),saldo]);
  res.status(201).json(rows[0]);
}));

router.get('/movimentos',asyncRoute(async(req,res)=>{
  const status=String(req.query.status||''); const accountId=Number(req.query.account_id||0);
  const values=[]; const where=[];
  if(status){values.push(status);where.push(`bm.status=$${values.length}`);} if(accountId){values.push(accountId);where.push(`bm.account_id=$${values.length}`);}
  const {rows}=await getDb().query(`SELECT bm.id,bm.public_id,bm.account_id,fa.name AS conta,bm.movement_date::text AS data,bm.description AS descricao,bm.counterparty AS favorecido,bm.document_number AS documento,bm.amount AS valor,bm.status,bm.transaction_id,bm.source AS origem FROM bank_movements bm JOIN financial_accounts fa ON fa.id=bm.account_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY bm.movement_date DESC,bm.id DESC LIMIT 1000`,values);
  res.json(rows);
}));

router.post('/importar',exigirPapel('admin','gestor'),asyncRoute(async(req,res)=>{
  const accountId=Number(req.body.account_id); if(!accountId) throw httpError(400,'Selecione uma conta.');
  const rows=Array.isArray(req.body.movimentos)?req.body.movimentos:[]; if(!rows.length||rows.length>5000) throw httpError(400,'Envie entre 1 e 5000 movimentos.');
  let incluidos=0,ignorados=0;
  await getDb().transaction(async tx=>{
    for(const item of rows){
      const data=String(item.data||'').slice(0,10),descricao=String(item.descricao||'').trim().slice(0,240),fav=String(item.favorecido||'').trim().slice(0,180)||null,doc=String(item.documento||'').trim().slice(0,100)||null,valor=Number(item.valor);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(data)||!descricao||!Number.isFinite(valor)||valor===0){ignorados++;continue;}
      const hash=crypto.createHash('sha256').update([accountId,data,descricao,fav||'',doc||'',valor.toFixed(2)].join('|')).digest('hex');
      const exists=await tx.query('SELECT id FROM bank_movements WHERE source_hash=$1',[hash]); if(exists.rows[0]){ignorados++;continue;}
      await tx.query(`INSERT INTO bank_movements(public_id,account_id,movement_date,description,counterparty,document_number,amount,source,source_hash,imported_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[crypto.randomUUID(),accountId,data,descricao,fav,doc,valor,String(req.body.origem||'csv').slice(0,30),hash,req.usuario.id]); incluidos++;
    }
    await recordAudit({entityType:'conciliacao',action:'importada',summary:`Extrato importado: ${incluidos} novo(s), ${ignorados} ignorado(s).`,data:{accountId,incluidos,ignorados},user:req.usuario,client:tx});
  });
  res.json({ok:true,incluidos,ignorados});
}));

router.get('/sugestoes/:movementId',asyncRoute(async(req,res)=>{
  const id=Number(req.params.movementId);
  const movement=(await getDb().query('SELECT * FROM bank_movements WHERE id=$1',[id])).rows[0]; if(!movement) throw httpError(404,'Movimento não encontrado.');
  const abs=Math.abs(Number(movement.amount));
  const {rows}=await getDb().query(`SELECT t.id,t.description AS descricao,t.counterparty AS favorecido,t.amount AS valor,t.transaction_date::text AS data,t.financial_status AS status_financeiro,cc.name AS centro_nome,ABS(t.amount-$1) AS diferenca_valor,ABS(t.transaction_date-$2::date) AS diferenca_dias FROM transactions t JOIN cost_centers cc ON cc.id=t.cost_center_id WHERE t.deleted_at IS NULL AND t.reversal_of IS NULL AND t.type=$3 AND ABS(t.amount-$1)<=GREATEST(2,$1*0.03) AND t.transaction_date BETWEEN $2::date-INTERVAL '7 days' AND $2::date+INTERVAL '7 days' ORDER BY ABS(t.amount-$1),ABS(t.transaction_date-$2::date),t.id DESC LIMIT 10`,[abs,movement.movement_date,Number(movement.amount)<0?'despesa':'receita']);
  res.json(rows);
}));

router.post('/conciliar/:movementId',exigirPapel('admin','gestor'),asyncRoute(async(req,res)=>{
  const movementId=Number(req.params.movementId),transactionId=Number(req.body.transaction_id); if(!transactionId) throw httpError(400,'Selecione um lançamento.');
  const result=await getDb().query(`UPDATE bank_movements SET transaction_id=$1,status='conciliado',updated_at=NOW() WHERE id=$2 AND status='pendente'`,[transactionId,movementId]); if(!result.rowCount) throw httpError(409,'Movimento já conciliado ou inexistente.');
  await recordAudit({entityType:'conciliacao',entityId:movementId,action:'conciliada',summary:`Movimento bancário conciliado ao lançamento ${transactionId}.`,data:{transactionId},user:req.usuario});
  res.json({ok:true});
}));

router.post('/ignorar/:movementId',exigirPapel('admin','gestor'),asyncRoute(async(req,res)=>{
  const result=await getDb().query(`UPDATE bank_movements SET status='ignorado',updated_at=NOW() WHERE id=$1 AND status='pendente'`,[Number(req.params.movementId)]); if(!result.rowCount) throw httpError(404,'Movimento pendente não encontrado.'); res.json({ok:true});
}));

router.get('/resumo',asyncRoute(async(req,res)=>{
  const {rows}=await getDb().query(`SELECT fa.id,fa.name AS conta,fa.opening_balance+COALESCE(SUM(bm.amount),0) AS saldo_atual,COUNT(bm.id) FILTER(WHERE bm.status='pendente')::int AS pendentes FROM financial_accounts fa LEFT JOIN bank_movements bm ON bm.account_id=fa.id WHERE fa.active=TRUE GROUP BY fa.id,fa.name,fa.opening_balance ORDER BY fa.name`);
  res.json(rows);
}));

module.exports=router;
