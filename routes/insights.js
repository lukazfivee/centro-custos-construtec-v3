const express=require('express');
const {getDb}=require('../db');
const {autenticar}=require('../middleware/auth');
const {asyncRoute}=require('../lib/http');

const router=express.Router();
router.use(autenticar);

router.get('/atencao',asyncRoute(async(req,res)=>{
  const db=getDb();
  const [overdue,noAttachment,duplicate,budget,bank]=await Promise.all([
    db.query(`SELECT COUNT(*)::int AS quantidade,COALESCE(SUM(amount*accounting_sign),0) AS valor FROM transactions WHERE deleted_at IS NULL AND reversal_of IS NULL AND financial_status='pendente' AND due_date<CURRENT_DATE`),
    db.query(`SELECT COUNT(*)::int AS quantidade FROM transactions t WHERE t.deleted_at IS NULL AND t.reversal_of IS NULL AND NOT EXISTS(SELECT 1 FROM transaction_attachments a WHERE a.transaction_id=t.id)`),
    db.query(`SELECT COUNT(*)::int AS quantidade FROM (SELECT type,counterparty,amount,transaction_date,COUNT(*) FROM transactions WHERE deleted_at IS NULL AND reversal_of IS NULL GROUP BY type,counterparty,amount,transaction_date HAVING COUNT(*)>1) d`),
    db.query(`SELECT COUNT(*)::int AS quantidade FROM (SELECT cc.id,cc.monthly_budget,COALESCE(SUM(t.amount*t.accounting_sign) FILTER(WHERE t.type='despesa' AND t.deleted_at IS NULL),0) gasto FROM cost_centers cc LEFT JOIN transactions t ON t.cost_center_id=cc.id GROUP BY cc.id,cc.monthly_budget HAVING cc.monthly_budget>0 AND COALESCE(SUM(t.amount*t.accounting_sign) FILTER(WHERE t.type='despesa' AND t.deleted_at IS NULL),0)>cc.monthly_budget) q`),
    db.query(`SELECT COUNT(*)::int AS quantidade FROM bank_movements WHERE status='pendente'`),
  ]);
  const items=[];
  const ov=overdue.rows[0]; if(ov.quantidade)items.push({tipo:'vencidos',nivel:'alto',titulo:`${ov.quantidade} conta(s) vencida(s)`,detalhe:`R$ ${Number(ov.valor).toFixed(2)} em pendências vencidas.`});
  if(noAttachment.rows[0].quantidade)items.push({tipo:'sem_documento',nivel:'medio',titulo:`${noAttachment.rows[0].quantidade} lançamento(s) sem documento`,detalhe:'Inclua comprovante, nota, boleto ou recibo quando aplicável.'});
  if(duplicate.rows[0].quantidade)items.push({tipo:'duplicidades',nivel:'alto',titulo:`${duplicate.rows[0].quantidade} grupo(s) possivelmente duplicado(s)`,detalhe:'Mesmo tipo, favorecido, valor e data foram encontrados mais de uma vez.'});
  if(budget.rows[0].quantidade)items.push({tipo:'orcamento',nivel:'alto',titulo:`${budget.rows[0].quantidade} centro(s) acima do orçamento`,detalhe:'Revise custos e orçamento aprovado.'});
  if(bank.rows[0].quantidade)items.push({tipo:'conciliacao',nivel:'medio',titulo:`${bank.rows[0].quantidade} movimento(s) bancário(s) pendente(s)`,detalhe:'Concilie o extrato com os lançamentos.'});
  res.json({total:items.length,itens:items});
}));

router.get('/fluxo-caixa',asyncRoute(async(req,res)=>{
  const horizons=[7,15,30,60,90];
  const {rows}=await getDb().query(`SELECT type,due_date::text AS vencimento,SUM(amount*accounting_sign) AS valor FROM transactions WHERE deleted_at IS NULL AND financial_status='pendente' AND due_date IS NOT NULL GROUP BY type,due_date ORDER BY due_date`);
  const today=new Date();
  const result=horizons.map(days=>{
    const end=new Date(today);end.setDate(end.getDate()+days);
    let entradas=0,saidas=0;
    for(const row of rows){const d=new Date(`${row.vencimento}T12:00:00`);if(d>=today&&d<=end){if(row.type==='receita')entradas+=Number(row.valor);else saidas+=Number(row.valor);}}
    return {dias:days,entradas,saidas,saldo:entradas-saidas};
  });
  res.json(result);
}));

router.get('/curva-abc',asyncRoute(async(req,res)=>{
  const {rows}=await getDb().query(`SELECT c.name AS categoria,SUM(t.amount*t.accounting_sign) AS total FROM transactions t JOIN categories c ON c.id=t.category_id WHERE t.deleted_at IS NULL AND t.type='despesa' GROUP BY c.id,c.name HAVING SUM(t.amount*t.accounting_sign)>0 ORDER BY total DESC`);
  const total=rows.reduce((s,r)=>s+Number(r.total),0);let acumulado=0;
  res.json(rows.map(r=>{const valor=Number(r.total),percentual=total?valor/total*100:0;acumulado+=percentual;return{categoria:r.categoria,valor,percentual,acumulado,classe:acumulado<=80?'A':acumulado<=95?'B':'C'};}));
}));

router.get('/fornecedores-precos',asyncRoute(async(req,res)=>{
  const {rows}=await getDb().query(`SELECT counterparty AS fornecedor,COUNT(*)::int AS compras,ROUND(AVG(amount)::numeric,2) AS media,MIN(amount) AS menor,MAX(amount) AS maior,MAX(transaction_date)::text AS ultima_compra FROM transactions WHERE deleted_at IS NULL AND reversal_of IS NULL AND type='despesa' AND counterparty IS NOT NULL GROUP BY counterparty ORDER BY compras DESC,MAX(transaction_date) DESC LIMIT 100`);
  res.json(rows);
}));

router.get('/tendencia-obras',asyncRoute(async(req,res)=>{
  const {rows}=await getDb().query(`SELECT cc.id,cc.code AS codigo,cc.name AS obra,cc.monthly_budget AS orcamento,cc.contract_amount AS contrato,COALESCE(SUM(t.amount*t.accounting_sign) FILTER(WHERE t.type='despesa' AND t.deleted_at IS NULL),0) AS realizado,COALESCE(SUM(t.amount*t.accounting_sign) FILTER(WHERE t.type='despesa' AND t.deleted_at IS NULL AND t.financial_status='pendente'),0) AS comprometido_pendente FROM cost_centers cc LEFT JOIN transactions t ON t.cost_center_id=cc.id WHERE cc.active=TRUE GROUP BY cc.id,cc.code,cc.name,cc.monthly_budget,cc.contract_amount ORDER BY cc.name`);
  res.json(rows.map(r=>{const realizado=Number(r.realizado),pendente=Number(r.comprometido_pendente),orcamento=Number(r.orcamento);return{...r,realizado,comprometido_pendente:pendente,tendencia:realizado+pendente,saldo_orcamento:orcamento-(realizado+pendente),desvio_percentual:orcamento?((realizado+pendente-orcamento)/orcamento*100):0};}));
}));

module.exports=router;
