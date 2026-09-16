const { getInstanceIdentity } = require('../db');
const { httpError } = require('../lib/http');
const { validDate } = require('../lib/dates');
const { moneyCents, isMonthClosed } = require('./financialPolicy');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields={
  publicId:'public_id',type:'type',description:'description',counterparty:'counterparty',amount:'amount',
  accountingSign:'accounting_sign',reversalOf:'reversal_of',reversalReason:'reversal_reason',
  transactionDate:'transaction_date',dueDate:'due_date',settlementDate:'settlement_date',financialStatus:'financial_status',
  documentNumber:'document_number',paymentMethod:'payment_method',notes:'notes',
  originInstanceId:'origin_instance_id',originInstanceName:'origin_instance_name',originUserName:'origin_user_name',
  lastModifiedInstanceId:'last_modified_instance_id',lastModifiedInstanceName:'last_modified_instance_name',
  revision:'revision',createdAt:'created_at',updatedAt:'updated_at',deletedAt:'deleted_at',
  approvalStatus:'approval_status',approvedAt:'approved_at',approvedBy:'approval_provenance',
};
const businessFields=['type','costCenterPublicId','categoryPublicId','description','counterparty','amount',
  'accountingSign','reversalOf','reversalReason','transactionDate','dueDate','settlementDate','financialStatus',
  'documentNumber','paymentMethod','notes','deletedAt','approvalStatus','approvedAt','approvedBy','allocations'];
const iso=v=>v ? new Date(v).toISOString() : null;
const date=v=>v instanceof Date ? v.toISOString().slice(0,10) : v;
const money=v=>(moneyCents(v)/100).toFixed(2);

function normalizeTransaction(item) {
  if(!item || typeof item!=='object') throw httpError(400,'Lançamento inválido.');
  const row={...item};
  row.approvalStatus = row.approvalStatus || 'aprovado';
  row.accountingSign = Number(row.accountingSign) === -1 ? -1 : 1;
  row.revision = Number.isInteger(row.revision) && row.revision >= 1 ? row.revision : 1;
  if (row.allocations == null) row.allocations = [];
  row.originInstanceName = row.originInstanceName || 'Instalação de origem';
  row.lastModifiedInstanceName = row.lastModifiedInstanceName || row.originInstanceName;
  row.originUserName = row.originUserName || 'Usuário';
  for(const key of ['publicId','costCenterPublicId','categoryPublicId','originInstanceId','lastModifiedInstanceId']) {
    if(!UUID.test(String(row[key]||''))) throw httpError(400,`Identificador inválido: ${key}.`);
    row[key]=row[key].toLowerCase();
  }
  if(!['receita','despesa'].includes(row.type) || !['pendente','liquidado'].includes(row.financialStatus)
    || !['rascunho','pendente','aprovado','rejeitado'].includes(row.approvalStatus)) throw httpError(400,'Tipo ou situação financeira/aprovação inválida.');
  row.amount=money(row.amount);
  if(![1,-1].includes(row.accountingSign)) throw httpError(400,'Sinal contábil inválido.');
  if(row.reversalOf && !UUID.test(row.reversalOf)) throw httpError(400,'Estorno inválido.');
  for(const key of ['transactionDate','dueDate','settlementDate']) {
    if((row[key] || key==='transactionDate') && !validDate(row[key])) throw httpError(400,`Data inválida: ${key}.`);
    row[key]=row[key]||null;
  }
  for(const key of ['createdAt','updatedAt','deletedAt','reversedAt','approvedAt']) {
    if(row[key] && !Number.isFinite(Date.parse(row[key]))) throw httpError(400,`Data inválida: ${key}.`);
    row[key]=iso(row[key]);
  }
  if(!row.createdAt || !row.updatedAt) throw httpError(400,'Datas de autoria ausentes.');
  for(const [key,limit,required] of [['description',240,true],['counterparty',160],['notes',5000],
    ['documentNumber',80],['paymentMethod',40],['reversalReason',500],['originInstanceName',120,true],
    ['lastModifiedInstanceName',120,true],['originUserName',120,true]]) {
    if(row[key]!=null && typeof row[key]!=='string') throw httpError(400,`Texto inválido: ${key}.`);
    if((required && !row[key]?.trim()) || row[key]?.length>limit) throw httpError(400,`Texto ausente ou excessivo: ${key}.`);
    row[key]=row[key]||null;
  }
  row.reversalOf=row.reversalOf?.toLowerCase()||null;
  if(row.approvedBy!=null) {
    if(typeof row.approvedBy.name!=='string' || !row.approvedBy.name.trim() || row.approvedBy.name.length>160 || !UUID.test(row.approvedBy.instanceId)) throw httpError(400,'Autoria de aprovação inválida.');
    row.approvedBy={name:row.approvedBy.name,instanceId:row.approvedBy.instanceId.toLowerCase()};
  } else row.approvedBy=null;
  if(!Array.isArray(row.allocations) || row.allocations.length>200) throw httpError(400,'Rateios ausentes ou excessivos. Atualize a origem e exporte novamente.');
  row.allocations=row.allocations.map(a=>{
    if(!a || !UUID.test(a.costCenterPublicId)) throw httpError(400,'Obra do rateio inválida.');
    if(a.note!=null && (typeof a.note!=='string' || a.note.length>240)) throw httpError(400,'Observação do rateio inválida.');
    return {costCenterPublicId:a.costCenterPublicId.toLowerCase(),amount:money(a.amount),note:a.note||null};
  }).sort((a,b)=>a.costCenterPublicId.localeCompare(b.costCenterPublicId));
  if(new Set(row.allocations.map(a=>a.costCenterPublicId)).size!==row.allocations.length) throw httpError(400,'Obra repetida no rateio.');
  if(row.allocations.length && row.allocations.reduce((sum,a)=>sum+moneyCents(a.amount),0)!==moneyCents(row.amount)) throw httpError(400,'O rateio não fecha com o lançamento.');
  return row;
}

async function readTransactions(tx, publicId=null) {
  const {rows}=await tx.query(`SELECT t.*,cc.public_id AS center_public_id,c.public_id AS category_public_id,
    u.name AS approver_name,COALESCE((SELECT jsonb_agg(jsonb_build_object('costCenterPublicId',ac.public_id,
      'amount',a.amount::text,'note',a.note) ORDER BY ac.public_id) FROM transaction_allocations a
      JOIN cost_centers ac ON ac.id=a.cost_center_id WHERE a.transaction_id=t.id),'[]'::jsonb) AS allocations
    FROM transactions t JOIN cost_centers cc ON cc.id=t.cost_center_id JOIN categories c ON c.id=t.category_id
    LEFT JOIN users u ON u.id=t.approved_by WHERE ($1::uuid IS NULL OR t.public_id=$1) ORDER BY t.public_id`,[publicId]);
  return rows.map(r=>{
    const item=Object.fromEntries(Object.entries(fields).map(([key,col])=>[key,r[col]]));
    for(const key of ['transactionDate','dueDate','settlementDate']) item[key]=date(item[key]);
    item.costCenterPublicId=r.center_public_id;item.categoryPublicId=r.category_public_id;
    item.reversedAt=r.reversed_at;item.allocations=r.allocations;
    item.approvedBy=r.approval_provenance || (r.approver_name ? {name:r.approver_name,instanceId:getInstanceIdentity().id} : null);
    return normalizeTransaction(item);
  });
}

const sameBusiness=(a,b)=>businessFields.every(k=>JSON.stringify(a[k]??null)===JSON.stringify(b[k]??null));
async function mutationError(tx, local, incoming) {
  if(local && sameBusiness(local,incoming)) return null;
  if(local && (local.reversalOf || local.reversedAt || local.deletedAt ||
    (await tx.query('SELECT 1 FROM transactions WHERE reversal_of=$1',[local.publicId])).rows.length)) return 'Histórico excluído ou estornado não pode ser substituído.';
  if(await isMonthClosed(incoming.transactionDate,tx) || (local && await isMonthClosed(local.transactionDate,tx))) return 'Competência de origem ou destino fechada. Reabra o mês para aplicar a alteração.';
  return null;
}

async function writeTransaction(tx, incoming, user, {resolve=false}={}) {
  const item=normalizeTransaction(incoming);
  const local=(await readTransactions(tx,item.publicId))[0];
  const error=await mutationError(tx,local,item);
  if(error) throw httpError(409,error);
  const center=(await tx.query('SELECT id FROM cost_centers WHERE public_id=$1',[item.costCenterPublicId])).rows[0];
  const category=(await tx.query('SELECT id,type FROM categories WHERE public_id=$1',[item.categoryPublicId])).rows[0];
  if(!center || !category || !['ambos',item.type].includes(category.type)) throw httpError(400,'Obra/categoria ausente ou incompatível.');
  if(resolve) {
    const instance=getInstanceIdentity();
    item.revision=Math.max(item.revision,local?.revision||0)+1;
    item.lastModifiedInstanceId=instance.id;item.lastModifiedInstanceName=instance.name;item.updatedAt=new Date().toISOString();
  }
  const columns=Object.values(fields), values=Object.keys(fields).map(key=>key==='approvedBy' ? JSON.stringify(item[key]) : item[key]);
  columns.push('cost_center_id','category_id','updated_by');values.push(center.id,category.id,user.id);
  let saved;
  if(local) {
    saved=await tx.query(`UPDATE transactions SET ${columns.slice(1).map((c,i)=>`${c}=$${i+2}`).join(',')},approved_by=NULL WHERE public_id=$1 RETURNING id`,values);
  } else {
    columns.push('created_by');values.push(user.id);
    saved=await tx.query(`INSERT INTO transactions (${columns.join(',')}) VALUES(${values.map((_,i)=>`$${i+1}`).join(',')}) RETURNING id`,values);
  }
  const id=saved.rows[0].id;
  if(!local || JSON.stringify(local.allocations)!==JSON.stringify(item.allocations)) {
    if(local) await tx.query('DELETE FROM transaction_allocations WHERE transaction_id=$1',[id]);
    for(const part of item.allocations) {
      const target=(await tx.query('SELECT id FROM cost_centers WHERE public_id=$1',[part.costCenterPublicId])).rows[0];
      if(!target) throw httpError(400,'Obra do rateio não encontrada.');
      await tx.query('INSERT INTO transaction_allocations(transaction_id,cost_center_id,amount,note) VALUES($1,$2,$3,$4)',[id,target.id,part.amount,part.note]);
    }
  }
  if(item.reversedAt!==local?.reversedAt) await tx.query('UPDATE transactions SET reversed_at=$2 WHERE id=$1',[id,item.reversedAt]);
  return {id,created:!local};
}

module.exports={normalizeTransaction,readTransactions,sameBusiness,mutationError,writeTransaction};
