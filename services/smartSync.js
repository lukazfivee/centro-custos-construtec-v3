const crypto = require('crypto');
const { getDb, getInstanceIdentity } = require('../db');
const { httpError } = require('../lib/http');
const { recordAudit } = require('./audit');

const FORMAT_VERSION = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function iso(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.valueOf()) ? null : d.toISOString();
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

async function buildPackage() {
  const db = getDb();
  const instance = getInstanceIdentity();
  const [categories, centers, suppliers, transactions] = await Promise.all([
    db.query(`SELECT public_id,name,type,active,revision,created_at,updated_at FROM categories ORDER BY public_id`),
    db.query(`SELECT public_id,code,name,responsible,monthly_budget,active,client,contract_number,start_date,end_date,
      contract_amount,project_status,description,revision,created_at,updated_at FROM cost_centers ORDER BY public_id`),
    db.query(`SELECT public_id,name,document,contact_name,email,phone,notes,active,revision,created_at,updated_at
      FROM suppliers ORDER BY public_id`),
    db.query(`SELECT t.public_id,t.type,t.description,t.counterparty,t.amount,t.accounting_sign,t.reversal_of,
      t.reversal_reason,t.reversed_at,t.transaction_date,t.due_date,t.settlement_date,t.financial_status,
      t.document_number,t.payment_method,t.notes,t.origin_instance_id,t.origin_instance_name,
      t.last_modified_instance_id,t.last_modified_instance_name,t.origin_user_name,t.revision,t.created_at,
      t.updated_at,t.deleted_at,cc.public_id AS cost_center_public_id,c.public_id AS category_public_id
      FROM transactions t JOIN cost_centers cc ON cc.id=t.cost_center_id
      JOIN categories c ON c.id=t.category_id ORDER BY t.public_id`),
  ]);

  const payload = {
    categories: categories.rows.map((r) => ({
      publicId:r.public_id,name:r.name,type:r.type,active:r.active,revision:Number(r.revision || 1),
      createdAt:iso(r.created_at),updatedAt:iso(r.updated_at),
    })),
    costCenters: centers.rows.map((r) => ({
      publicId:r.public_id,code:r.code,name:r.name,responsible:r.responsible,monthlyBudget:Number(r.monthly_budget || 0),
      active:r.active,client:r.client,contractNumber:r.contract_number,startDate:dateOnly(r.start_date),endDate:dateOnly(r.end_date),
      contractAmount:Number(r.contract_amount || 0),projectStatus:r.project_status,description:r.description,
      revision:Number(r.revision || 1),createdAt:iso(r.created_at),updatedAt:iso(r.updated_at),
    })),
    suppliers: suppliers.rows.map((r) => ({
      publicId:r.public_id,name:r.name,document:r.document,contactName:r.contact_name,email:r.email,phone:r.phone,
      notes:r.notes,active:r.active,revision:Number(r.revision || 1),createdAt:iso(r.created_at),updatedAt:iso(r.updated_at),
    })),
    transactions: transactions.rows.map((r) => ({
      publicId:r.public_id,type:r.type,costCenterPublicId:r.cost_center_public_id,categoryPublicId:r.category_public_id,
      description:r.description,counterparty:r.counterparty,amount:Number(r.amount),accountingSign:Number(r.accounting_sign || 1),
      reversalOf:r.reversal_of,reversalReason:r.reversal_reason,reversedAt:iso(r.reversed_at),transactionDate:dateOnly(r.transaction_date),
      dueDate:dateOnly(r.due_date),settlementDate:dateOnly(r.settlement_date),financialStatus:r.financial_status,
      documentNumber:r.document_number,paymentMethod:r.payment_method,notes:r.notes,originInstanceId:r.origin_instance_id,
      originInstanceName:r.origin_instance_name,lastModifiedInstanceId:r.last_modified_instance_id,
      lastModifiedInstanceName:r.last_modified_instance_name,originUserName:r.origin_user_name,
      revision:Number(r.revision || 1),createdAt:iso(r.created_at),updatedAt:iso(r.updated_at),deletedAt:iso(r.deleted_at),
    })),
  };
  const envelope = {
    formatVersion:FORMAT_VERSION,
    packageId:crypto.randomUUID(),
    generatedAt:new Date().toISOString(),
    source:{ id:instance.id,name:instance.name },
    payload,
    payloadHash:stableHash(payload),
  };
  return envelope;
}

function parsePackage(content) {
  if (typeof content !== 'string' || !content.trim()) throw httpError(400, 'Selecione um pacote de sincronização válido.');
  if (Buffer.byteLength(content, 'utf8') > 20 * 1024 * 1024) throw httpError(413, 'O pacote excede o limite de 20 MB.');
  let pack;
  try { pack = JSON.parse(content); } catch { throw httpError(400, 'O arquivo não contém um pacote JSON válido.'); }
  if (Number(pack.formatVersion) !== FORMAT_VERSION) throw httpError(400, `Versão de pacote incompatível. Esperado: ${FORMAT_VERSION}.`);
  if (!UUID.test(String(pack.packageId || ''))) throw httpError(400, 'Identificador do pacote inválido.');
  if (!UUID.test(String(pack.source?.id || ''))) throw httpError(400, 'Identificador da instalação de origem inválido.');
  if (!pack.payload || typeof pack.payload !== 'object') throw httpError(400, 'Conteúdo do pacote ausente.');
  const expected = stableHash(pack.payload);
  if (expected !== String(pack.payloadHash || '').toLowerCase()) throw httpError(400, 'A integridade do pacote falhou. O arquivo pode ter sido alterado ou corrompido.');
  for (const key of ['categories','costCenters','suppliers','transactions']) {
    if (!Array.isArray(pack.payload[key])) throw httpError(400, `Seção obrigatória ausente: ${key}.`);
  }
  return pack;
}

function sameJson(a, b, fields) {
  return fields.every((field) => JSON.stringify(a[field] ?? null) === JSON.stringify(b[field] ?? null));
}

async function addConflict(tx, packageImportId, type, publicId, reason, localData, incomingData, result) {
  await tx.query(`INSERT INTO sync_package_conflicts
    (package_import_id,entity_type,entity_public_id,reason,local_data,incoming_data)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
    [packageImportId,type,publicId,reason,JSON.stringify(localData || null),JSON.stringify(incomingData)]);
  result.conflitos += 1;
  result.porTipo[type].conflitos += 1;
}

function validRevision(item) {
  const rev = Number(item.revision);
  return Number.isInteger(rev) && rev >= 1 ? rev : 1;
}

async function importSimpleEntity(tx, options) {
  const { type, table, item, packageImportId, result, selectFields, insertSql, insertValues, updateSql, updateValues, businessFields } = options;
  if (!UUID.test(String(item.publicId || ''))) throw httpError(400, `${type}: publicId inválido.`);
  const existing = (await tx.query(`SELECT ${selectFields} FROM ${table} WHERE public_id=$1`, [item.publicId])).rows[0];
  if (!existing) {
    await tx.query(insertSql, insertValues(item));
    result.incluidos += 1; result.porTipo[type].incluidos += 1; return;
  }
  const local = options.normalizeExisting(existing);
  if (sameJson(local, item, businessFields)) {
    result.ignorados += 1; result.porTipo[type].ignorados += 1; return;
  }
  const incomingRevision = validRevision(item);
  const localRevision = Number(existing.revision || 1);
  if (incomingRevision > localRevision) {
    await tx.query(updateSql, updateValues(item));
    result.atualizados += 1; result.porTipo[type].atualizados += 1; return;
  }
  await addConflict(tx, packageImportId, type, item.publicId,
    'Há alterações diferentes com a mesma revisão ou com revisão local mais recente.', local, item, result);
}

async function importPackage({ content, filename, user }) {
  const pack = parsePackage(content);
  const db = getDb();
  const already = await db.query('SELECT id,summary FROM sync_package_imports WHERE package_id=$1', [pack.packageId]);
  if (already.rows[0]) return { ok:true, duplicado:true, mensagem:'Este pacote já foi importado anteriormente.', resumo:already.rows[0].summary };

  const result = {
    incluidos:0,atualizados:0,ignorados:0,conflitos:0,
    porTipo:{ categoria:{incluidos:0,atualizados:0,ignorados:0,conflitos:0},obra:{incluidos:0,atualizados:0,ignorados:0,conflitos:0},fornecedor:{incluidos:0,atualizados:0,ignorados:0,conflitos:0},lancamento:{incluidos:0,atualizados:0,ignorados:0,conflitos:0} },
  };

  await db.transaction(async (tx) => {
    const inserted = await tx.query(`INSERT INTO sync_package_imports
      (package_id,filename,source_instance_id,source_instance_name,package_hash,imported_by)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [pack.packageId,String(filename || 'sincronizacao.ccsync').slice(0,240),pack.source.id,
        String(pack.source.name || 'Instalação desconhecida').slice(0,120),pack.payloadHash,user.id]);
    const packageImportId = inserted.rows[0].id;

    for (const item of pack.payload.categories) {
      const clean = {...item,revision:validRevision(item),active:item.active !== false};
      await importSimpleEntity(tx, {
        type:'categoria',table:'categories',item:clean,packageImportId,result,
        selectFields:'public_id,name,type,active,revision,created_at,updated_at',
        businessFields:['name','type','active'],
        normalizeExisting:r=>({publicId:r.public_id,name:r.name,type:r.type,active:r.active,revision:Number(r.revision||1),createdAt:iso(r.created_at),updatedAt:iso(r.updated_at)}),
        insertSql:`INSERT INTO categories (public_id,name,type,active,revision,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        insertValues:i=>[i.publicId,String(i.name||'').slice(0,100),['receita','despesa','ambos'].includes(i.type)?i.type:'ambos',i.active,i.revision,i.createdAt||new Date(),i.updatedAt||new Date()],
        updateSql:`UPDATE categories SET name=$2,type=$3,active=$4,revision=$5,updated_at=$6 WHERE public_id=$1`,
        updateValues:i=>[i.publicId,String(i.name||'').slice(0,100),['receita','despesa','ambos'].includes(i.type)?i.type:'ambos',i.active,i.revision,i.updatedAt||new Date()],
      });
    }

    for (const item of pack.payload.costCenters) {
      const clean = {...item,revision:validRevision(item),active:item.active !== false};
      await importSimpleEntity(tx, {
        type:'obra',table:'cost_centers',item:clean,packageImportId,result,
        selectFields:'public_id,code,name,responsible,monthly_budget,active,client,contract_number,start_date,end_date,contract_amount,project_status,description,revision,created_at,updated_at',
        businessFields:['code','name','responsible','monthlyBudget','active','client','contractNumber','startDate','endDate','contractAmount','projectStatus','description'],
        normalizeExisting:r=>({publicId:r.public_id,code:r.code,name:r.name,responsible:r.responsible,monthlyBudget:Number(r.monthly_budget||0),active:r.active,client:r.client,contractNumber:r.contract_number,startDate:dateOnly(r.start_date),endDate:dateOnly(r.end_date),contractAmount:Number(r.contract_amount||0),projectStatus:r.project_status,description:r.description,revision:Number(r.revision||1),createdAt:iso(r.created_at),updatedAt:iso(r.updated_at)}),
        insertSql:`INSERT INTO cost_centers (public_id,code,name,responsible,monthly_budget,active,client,contract_number,start_date,end_date,contract_amount,project_status,description,revision,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        insertValues:i=>[i.publicId,String(i.code||'').slice(0,40),String(i.name||'').slice(0,140),i.responsible||null,Number(i.monthlyBudget||0),i.active,i.client||null,i.contractNumber||null,i.startDate||null,i.endDate||null,Number(i.contractAmount||0),['planejamento','execucao','pausado','concluido'].includes(i.projectStatus)?i.projectStatus:'planejamento',i.description||null,i.revision,i.createdAt||new Date(),i.updatedAt||new Date()],
        updateSql:`UPDATE cost_centers SET code=$2,name=$3,responsible=$4,monthly_budget=$5,active=$6,client=$7,contract_number=$8,start_date=$9,end_date=$10,contract_amount=$11,project_status=$12,description=$13,revision=$14,updated_at=$15 WHERE public_id=$1`,
        updateValues:i=>[i.publicId,String(i.code||'').slice(0,40),String(i.name||'').slice(0,140),i.responsible||null,Number(i.monthlyBudget||0),i.active,i.client||null,i.contractNumber||null,i.startDate||null,i.endDate||null,Number(i.contractAmount||0),['planejamento','execucao','pausado','concluido'].includes(i.projectStatus)?i.projectStatus:'planejamento',i.description||null,i.revision,i.updatedAt||new Date()],
      });
    }

    for (const item of pack.payload.suppliers) {
      const clean = {...item,revision:validRevision(item),active:item.active !== false};
      await importSimpleEntity(tx, {
        type:'fornecedor',table:'suppliers',item:clean,packageImportId,result,
        selectFields:'public_id,name,document,contact_name,email,phone,notes,active,revision,created_at,updated_at',
        businessFields:['name','document','contactName','email','phone','notes','active'],
        normalizeExisting:r=>({publicId:r.public_id,name:r.name,document:r.document,contactName:r.contact_name,email:r.email,phone:r.phone,notes:r.notes,active:r.active,revision:Number(r.revision||1),createdAt:iso(r.created_at),updatedAt:iso(r.updated_at)}),
        insertSql:`INSERT INTO suppliers (public_id,name,document,contact_name,email,phone,notes,active,revision,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        insertValues:i=>[i.publicId,String(i.name||'').slice(0,160),i.document||null,i.contactName||null,i.email||null,i.phone||null,i.notes||null,i.active,i.revision,i.createdAt||new Date(),i.updatedAt||new Date()],
        updateSql:`UPDATE suppliers SET name=$2,document=$3,contact_name=$4,email=$5,phone=$6,notes=$7,active=$8,revision=$9,updated_at=$10 WHERE public_id=$1`,
        updateValues:i=>[i.publicId,String(i.name||'').slice(0,160),i.document||null,i.contactName||null,i.email||null,i.phone||null,i.notes||null,i.active,i.revision,i.updatedAt||new Date()],
      });
    }

    const centerMap = new Map((await tx.query('SELECT public_id,id FROM cost_centers')).rows.map(r=>[String(r.public_id),r.id]));
    const categoryMap = new Map((await tx.query('SELECT public_id,id FROM categories')).rows.map(r=>[String(r.public_id),r.id]));

    const transactionItems = [...pack.payload.transactions].sort((a,b)=>Number(Boolean(a.reversalOf))-Number(Boolean(b.reversalOf)));
    for (const item of transactionItems) {
      if (!UUID.test(String(item.publicId||''))) throw httpError(400, 'Lançamento com publicId inválido.');
      const centerId = centerMap.get(String(item.costCenterPublicId));
      const categoryId = categoryMap.get(String(item.categoryPublicId));
      if (!centerId || !categoryId) throw httpError(400, `Lançamento ${item.publicId}: obra ou categoria de referência não encontrada.`);
      const existing = (await tx.query('SELECT * FROM transactions WHERE public_id=$1', [item.publicId])).rows[0];
      const incomingRevision = validRevision(item);
      const clean = {...item,revision:incomingRevision,accountingSign:Number(item.accountingSign) === -1 ? -1 : 1};
      if (clean.reversalOf && !UUID.test(String(clean.reversalOf))) throw httpError(400, `Lançamento ${clean.publicId}: vínculo de estorno inválido.`);
      const businessFields = ['type','description','counterparty','amount','accountingSign','reversalOf','reversalReason','transactionDate','dueDate','settlementDate','financialStatus','documentNumber','paymentMethod','notes','deletedAt'];
      const local = existing ? {
        publicId:existing.public_id,type:existing.type,description:existing.description,counterparty:existing.counterparty,amount:Number(existing.amount),accountingSign:Number(existing.accounting_sign||1),reversalOf:existing.reversal_of,reversalReason:existing.reversal_reason,transactionDate:dateOnly(existing.transaction_date),dueDate:dateOnly(existing.due_date),settlementDate:dateOnly(existing.settlement_date),financialStatus:existing.financial_status,documentNumber:existing.document_number,paymentMethod:existing.payment_method,notes:existing.notes,revision:Number(existing.revision||1),deletedAt:iso(existing.deleted_at),lastModifiedInstanceId:existing.last_modified_instance_id
      } : null;
      if (existing && sameJson(local, clean, businessFields)) {
        result.ignorados++; result.porTipo.lancamento.ignorados++; continue;
      }
      if (existing && incomingRevision <= Number(existing.revision||1)) {
        await addConflict(tx, packageImportId, 'lancamento', clean.publicId,
          'Lançamento divergente com revisão igual ou mais antiga que a versão local.', local, clean, result);
        continue;
      }
      if (existing && String(existing.last_modified_instance_id) !== String(clean.lastModifiedInstanceId) && Number(existing.revision||1) > 1) {
        await addConflict(tx, packageImportId, 'lancamento', clean.publicId,
          'O lançamento foi alterado em instalações diferentes.', local, clean, result);
        continue;
      }
      const values = [clean.publicId,clean.type,centerId,categoryId,String(clean.description||'').slice(0,240),clean.counterparty||null,Number(clean.amount),clean.accountingSign,clean.reversalOf||null,clean.reversalReason||null,clean.reversedAt||null,clean.transactionDate,clean.notes||null,clean.dueDate||clean.transactionDate,clean.settlementDate||null,clean.financialStatus,clean.documentNumber||null,clean.paymentMethod||null,clean.originInstanceId,clean.originInstanceName,clean.lastModifiedInstanceId,clean.lastModifiedInstanceName,clean.originUserName,clean.revision,clean.createdAt||new Date(),clean.updatedAt||new Date(),clean.deletedAt||null,user.id];
      if (!existing) {
        await tx.query(`INSERT INTO transactions
          (public_id,type,cost_center_id,category_id,description,counterparty,amount,accounting_sign,reversal_of,reversal_reason,reversed_at,
           transaction_date,notes,due_date,settlement_date,financial_status,document_number,payment_method,origin_instance_id,origin_instance_name,
           last_modified_instance_id,last_modified_instance_name,origin_user_name,revision,created_at,updated_at,deleted_at,created_by,updated_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$28)`, values);
        result.incluidos++; result.porTipo.lancamento.incluidos++;
      } else {
        await tx.query(`UPDATE transactions SET type=$2,cost_center_id=$3,category_id=$4,description=$5,counterparty=$6,amount=$7,
          accounting_sign=$8,reversal_of=$9,reversal_reason=$10,reversed_at=$11,transaction_date=$12,notes=$13,due_date=$14,
          settlement_date=$15,financial_status=$16,document_number=$17,payment_method=$18,origin_instance_id=$19,origin_instance_name=$20,
          last_modified_instance_id=$21,last_modified_instance_name=$22,origin_user_name=$23,revision=$24,updated_at=$26,deleted_at=$27,updated_by=$28
          WHERE public_id=$1`, values);
        result.atualizados++; result.porTipo.lancamento.atualizados++;
      }
    }

    await tx.query('UPDATE sync_package_imports SET summary=$1::jsonb WHERE id=$2', [JSON.stringify(result), packageImportId]);
    await recordAudit({entityType:'sincronizacao',entityId:pack.packageId,action:'pacote_importado',
      summary:`Pacote inteligente importado: ${result.incluidos} incluído(s), ${result.atualizados} atualizado(s), ${result.conflitos} conflito(s).`,
      data:{source:pack.source,result},user,client:tx});
  });

  return { ok:true,duplicado:false,pacoteId:pack.packageId,origem:pack.source,resumo:result };
}

async function listImports() {
  const { rows } = await getDb().query(`SELECT spi.id,spi.package_id,spi.filename,spi.source_instance_name,spi.package_hash,
    spi.summary,spi.created_at,u.name AS imported_by_name FROM sync_package_imports spi JOIN users u ON u.id=spi.imported_by
    ORDER BY spi.created_at DESC LIMIT 50`);
  return rows;
}

async function listConflicts() {
  const { rows } = await getDb().query(`SELECT c.id,c.entity_type,c.entity_public_id,c.reason,c.local_data,c.incoming_data,c.status,
    c.resolved_choice,c.created_at,c.resolved_at,p.filename,p.source_instance_name
    FROM sync_package_conflicts c JOIN sync_package_imports p ON p.id=c.package_import_id
    ORDER BY CASE WHEN c.status='pending' THEN 0 ELSE 1 END,c.created_at DESC LIMIT 200`);
  return rows;
}

async function resolveConflict({ id, choice, user }) {
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Conflito inválido.');
  if (!['local','recebido'].includes(choice)) throw httpError(400, 'Escolha local ou recebido.');
  const db = getDb();
  const conflict = (await db.query('SELECT * FROM sync_package_conflicts WHERE id=$1', [id])).rows[0];
  if (!conflict) throw httpError(404, 'Conflito não encontrado.');
  if (conflict.status !== 'pending') throw httpError(409, 'Este conflito já foi resolvido.');
  if (choice === 'recebido') {
    throw httpError(409, 'Aplicação automática da versão recebida ficará disponível no próximo lote. Nesta versão, revise o registro e use “manter local” ou ajuste manualmente.');
  }
  await db.query(`UPDATE sync_package_conflicts SET status='resolved',resolved_choice='local',resolved_by=$1,resolved_at=NOW() WHERE id=$2`, [user.id,id]);
  await recordAudit({entityType:'sincronizacao',entityId:id,action:'conflito_resolvido',summary:'Conflito de sincronização resolvido mantendo a versão local.',data:{choice},user});
  return { ok:true,mensagem:'Conflito resolvido mantendo a versão local.' };
}

module.exports = { FORMAT_VERSION, buildPackage, importPackage, listImports, listConflicts, resolveConflict, stableHash };
