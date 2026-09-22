const crypto = require('crypto');
const { getDb, getInstanceIdentity } = require('../db');
const { httpError } = require('../lib/http');
const { recordAudit } = require('./audit');
const { readTransactions, normalizeTransaction, sameBusiness, mutationError, writeTransaction } = require('./syncTransactions');
const jobs = require('../lib/jobs');

const FORMAT_VERSION = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINANCIAL_STATUSES = new Set(['pendente','liquidado']);

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

function financialStatusError(item, label) {
  if (!Object.prototype.hasOwnProperty.call(item || {}, 'financialStatus')) return null;
  const value = String(item.financialStatus || '');
  if (FINANCIAL_STATUSES.has(value)) return null;
  return `${label}: situação financeira inválida "${value || '(vazia)'}". Use "pendente" ou "liquidado".`;
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
    readTransactions(db),
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
    transactions: transactions.map((t) => ({
      publicId:t.publicId,type:t.type,costCenterPublicId:t.costCenterPublicId,categoryPublicId:t.categoryPublicId,
      description:t.description,counterparty:t.counterparty,amount:Number(t.amount),
      accountingSign:Number(t.accountingSign || 1), // accounting_sign
      reversalOf:t.reversalOf, // reversal_of
      reversalReason:t.reversalReason,reversedAt:iso(t.reversedAt),transactionDate:dateOnly(t.transactionDate),
      dueDate:dateOnly(t.dueDate),settlementDate:dateOnly(t.settlementDate),financialStatus:t.financialStatus,
      documentNumber:t.documentNumber,paymentMethod:t.paymentMethod,notes:t.notes,originInstanceId:t.originInstanceId,
      originInstanceName:t.originInstanceName,lastModifiedInstanceId:t.lastModifiedInstanceId,
      lastModifiedInstanceName:t.lastModifiedInstanceName,originUserName:t.originUserName,
      revision:Number(t.revision || 1),createdAt:iso(t.createdAt),updatedAt:iso(t.updatedAt),deletedAt:iso(t.deletedAt),
      approvalStatus:t.approvalStatus,approvedAt:iso(t.approvedAt),approvedBy:t.approvedBy,
      allocations:t.allocations || [],
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
  const domainError = financialStatusError(item, `${type} ${item.publicId}`);
  if (domainError) {
    await addConflict(tx, packageImportId, type, item.publicId, domainError, null, item, result);
    return;
  }
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

// Pacotes pequenos (o caso comum: sincronizar uma obra por vez) continuam
// respondendo de forma sincrona, como sempre - ver "alternativa simples" em
// DECISIONS.md. Acima do limite, a importacao vira um job em segundo plano.
const ASYNC_ITEM_THRESHOLD = 200;

function packageItemCount(pack) {
  const p = pack.payload;
  return (p.categories?.length || 0) + (p.costCenters?.length || 0) + (p.suppliers?.length || 0) + (p.transactions?.length || 0);
}

const noopJobContext = { updateProgress: async () => {}, checkDeadline: () => {} };

async function runImport(pack, filename, user, ctx = noopJobContext) {
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
    ctx.checkDeadline();

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
    ctx.checkDeadline();

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

    ctx.checkDeadline();
    const centerMap = new Map((await tx.query('SELECT public_id,id FROM cost_centers')).rows.map(r=>[String(r.public_id),r.id]));
    const categoryMap = new Map((await tx.query('SELECT public_id,id FROM categories')).rows.map(r=>[String(r.public_id),r.id]));

    const transactionItems = [...pack.payload.transactions].sort((a,b)=>Number(Boolean(a.reversalOf))-Number(Boolean(b.reversalOf)));
    for (let idx = 0; idx < transactionItems.length; idx++) {
      const item = transactionItems[idx];
      if (idx % 25 === 0) ctx.checkDeadline();
      if (!UUID.test(String(item.publicId||''))) throw httpError(400, 'Lançamento com publicId inválido.');
      const domainError = financialStatusError(item, `Lançamento ${item.publicId}`);
      if (domainError) {
        await addConflict(tx, packageImportId, 'lancamento', item.publicId, domainError, null, item, result);
        continue;
      }
      let clean;
      try {
        clean = normalizeTransaction(item);
      } catch (err) {
        await addConflict(tx, packageImportId, 'lancamento', item.publicId, err.message || 'Lançamento inválido.', null, item, result);
        continue;
      }
      const centerId = centerMap.get(String(clean.costCenterPublicId));
      const categoryId = categoryMap.get(String(clean.categoryPublicId));
      if (!centerId || !categoryId) {
        await addConflict(tx, packageImportId, 'lancamento', clean.publicId,
          `Lançamento ${clean.publicId}: obra ou categoria de referência não encontrada.`, null, clean, result);
        continue;
      }
      if (clean.allocations && clean.allocations.length > 0) {
        const missing = clean.allocations.some(a => !centerMap.has(String(a.costCenterPublicId)));
        if (missing) {
          await addConflict(tx, packageImportId, 'lancamento', clean.publicId,
            `Lançamento ${clean.publicId}: obra de rateio não encontrada no destino.`, null, clean, result);
          continue;
        }
      }
      const local = (await readTransactions(tx, clean.publicId))[0] || null;
      if (local && sameBusiness(local, clean)) {
        result.ignorados++; result.porTipo.lancamento.ignorados++; continue;
      }
      const mutError = await mutationError(tx, local, clean);
      if (mutError) {
        await addConflict(tx, packageImportId, 'lancamento', clean.publicId, mutError, local, clean, result);
        continue;
      }
      if (local && clean.revision <= Number(local.revision || 1)) {
        await addConflict(tx, packageImportId, 'lancamento', clean.publicId,
          'Lançamento divergente com revisão igual ou mais antiga que a versão local.', local, clean, result);
        continue;
      }
      if (local && String(local.lastModifiedInstanceId) !== String(clean.lastModifiedInstanceId) && Number(local.revision || 1) > 1) {
        await addConflict(tx, packageImportId, 'lancamento', clean.publicId,
          'O lançamento foi alterado em instalações diferentes.', local, clean, result);
        continue;
      }
      const { created } = await writeTransaction(tx, clean, user);
      if (created) {
        result.incluidos++; result.porTipo.lancamento.incluidos++;
      } else {
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

// Entrada publica: decide entre executar a importacao de forma sincrona
// (pacotes pequenos, o caso comum de sincronizar uma obra) ou como job em
// segundo plano (pacotes grandes, ex.: migracao inicial com anos de
// lancamentos). Ver ASYNC_ITEM_THRESHOLD e DECISIONS.md.
async function importPackage({ content, filename, user }) {
  const pack = parsePackage(content);
  if (packageItemCount(pack) <= ASYNC_ITEM_THRESHOLD) {
    return runImport(pack, filename, user);
  }
  const { job } = await jobs.submitJob({
    type: 'smart-sync-import',
    idempotencyKey: pack.packageId,
    params: { content, filename, userId: user.id, userName: user.name },
    createdBy: user.id,
    timeoutMs: 10 * 60 * 1000,
  });
  return { ok:true, async:true, jobId:job.id, status:job.status, itens:packageItemCount(pack) };
}

jobs.registerHandler('smart-sync-import', async (job, ctx) => {
  const { content, filename, userId, userName } = job.params || {};
  const pack = parsePackage(content);
  return runImport(pack, filename, { id:userId, name:userName }, ctx);
});

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

async function applyIncomingConflict(tx, conflict, user) {
  const item = conflict.incoming_data;
  if (!item || typeof item !== 'object') throw httpError(400, 'A versão recebida deste conflito não está disponível.');
  if (!UUID.test(String(item.publicId || conflict.entity_public_id || ''))) throw httpError(400, 'A versão recebida possui identificador inválido.');
  const publicId = String(item.publicId || conflict.entity_public_id);

  if (conflict.entity_type === 'categoria') {
    const values = [publicId,String(item.name||'').slice(0,100),['receita','despesa','ambos'].includes(item.type)?item.type:'ambos',item.active !== false,validRevision(item),item.createdAt||new Date(),item.updatedAt||new Date()];
    const existing = (await tx.query('SELECT id FROM categories WHERE public_id=$1',[publicId])).rows[0];
    if (existing) {
      await tx.query('UPDATE categories SET name=$2,type=$3,active=$4,revision=$5,updated_at=$7 WHERE public_id=$1',values);
    } else {
      await tx.query('INSERT INTO categories (public_id,name,type,active,revision,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',values);
    }
    return;
  }

  if (conflict.entity_type === 'obra') {
    const values = [publicId,String(item.code||'').slice(0,40),String(item.name||'').slice(0,140),item.responsible||null,Number(item.monthlyBudget||0),item.active !== false,item.client||null,item.contractNumber||null,item.startDate||null,item.endDate||null,Number(item.contractAmount||0),['planejamento','execucao','pausado','concluido'].includes(item.projectStatus)?item.projectStatus:'planejamento',item.description||null,validRevision(item),item.createdAt||new Date(),item.updatedAt||new Date()];
    const existing = (await tx.query('SELECT id FROM cost_centers WHERE public_id=$1',[publicId])).rows[0];
    if (existing) {
      await tx.query(`UPDATE cost_centers SET code=$2,name=$3,responsible=$4,monthly_budget=$5,active=$6,client=$7,contract_number=$8,start_date=$9,end_date=$10,contract_amount=$11,project_status=$12,description=$13,revision=$14,updated_at=$16 WHERE public_id=$1`,values);
    } else {
      await tx.query(`INSERT INTO cost_centers (public_id,code,name,responsible,monthly_budget,active,client,contract_number,start_date,end_date,contract_amount,project_status,description,revision,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,values);
    }
    return;
  }

  if (conflict.entity_type === 'fornecedor') {
    const values = [publicId,String(item.name||'').slice(0,160),item.document||null,item.contactName||null,item.email||null,item.phone||null,item.notes||null,item.active !== false,validRevision(item),item.createdAt||new Date(),item.updatedAt||new Date()];
    const existing = (await tx.query('SELECT id FROM suppliers WHERE public_id=$1',[publicId])).rows[0];
    if (existing) {
      await tx.query('UPDATE suppliers SET name=$2,document=$3,contact_name=$4,email=$5,phone=$6,notes=$7,active=$8,revision=$9,updated_at=$11 WHERE public_id=$1',values);
    } else {
      await tx.query('INSERT INTO suppliers (public_id,name,document,contact_name,email,phone,notes,active,revision,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',values);
    }
    return;
  }

  if (conflict.entity_type === 'lancamento') {
    const item = conflict.incoming_data;
    if (!item || typeof item !== 'object') throw httpError(400, 'Dados do lançamento ausentes.');
    const clean = normalizeTransaction(item);
    await writeTransaction(tx, clean, user, { resolve: true });
    return;
  }

  throw httpError(400, `Tipo de conflito não suportado: ${conflict.entity_type}.`);
}

async function resolveConflict({ id, choice, user }) {
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Conflito inválido.');
  if (!['local','recebido'].includes(choice)) throw httpError(400, 'Escolha local ou recebido.');
  const db = getDb();
  let message = '';

  await db.transaction(async (tx) => {
    const conflict = (await tx.query('SELECT * FROM sync_package_conflicts WHERE id=$1', [id])).rows[0];
    if (!conflict) throw httpError(404, 'Conflito não encontrado.');
    if (conflict.status !== 'pending') throw httpError(409, 'Este conflito já foi resolvido.');

    if (choice === 'recebido') {
      await applyIncomingConflict(tx, conflict, user);
      await tx.query(`UPDATE sync_package_conflicts SET status='resolved',resolved_choice='recebido',resolved_by=$1,resolved_at=NOW() WHERE id=$2`, [user.id,id]);
      message = 'Conflito resolvido aplicando a versão recebida.';
    } else {
      await tx.query(`UPDATE sync_package_conflicts SET status='resolved',resolved_choice='local',resolved_by=$1,resolved_at=NOW() WHERE id=$2`, [user.id,id]);
      message = 'Conflito resolvido mantendo a versão local.';
    }

    await recordAudit({
      entityType:'sincronizacao',entityId:id,action:'conflito_resolvido',summary:message,
      data:{choice,entityType:conflict.entity_type,entityPublicId:conflict.entity_public_id},user,client:tx,
    });
  });

  return { ok:true,mensagem:message };
}

module.exports = { FORMAT_VERSION, buildPackage, importPackage, listImports, listConflicts, resolveConflict, stableHash };
