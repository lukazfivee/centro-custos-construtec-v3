const express = require('express');
const { autenticar } = require('../middleware/auth');
const { asyncRoute } = require('../lib/http');
const { getDb, getInstanceIdentity } = require('../db');
const { parseCsv, csvLine } = require('../lib/csv');
const { httpError } = require('../lib/http');
const { recordAudit } = require('../services/audit');

const router = express.Router();
router.use(autenticar);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.get('/exportar.csv', asyncRoute(async (req, res) => {
  const db = getDb();
  const [suppliers, categories, centers] = await Promise.all([
    db.query(`SELECT public_id,name,document,contact_name,email,phone,notes,active,revision,updated_at FROM suppliers ORDER BY name`),
    db.query(`SELECT public_id,name,type,active,revision,updated_at FROM categories ORDER BY name`),
    db.query(`SELECT public_id,code,name,responsible,client,contract_number,monthly_budget,project_status,active,description,revision,updated_at FROM cost_centers ORDER BY name`),
  ]);

  const headers = ['secao','public_id','nome','tipo','codigo','documento','contato','email','telefone','observacoes','cliente','contrato','orcamento_mensal','situacao','ativo','revisao','alterado_em'];
  const lines = [csvLine(headers)];

  suppliers.rows.forEach(r => lines.push(csvLine([
    'fornecedores', r.public_id, r.name, '', '', r.document || '', r.contact_name || '',
    r.email || '', r.phone || '', r.notes || '', '', '', '', '',
    r.active ? 'sim' : 'nao', r.revision || 1, new Date(r.updated_at).toISOString(),
  ])));

  categories.rows.forEach(r => lines.push(csvLine([
    'categorias', r.public_id, r.name, r.type, '', '', '', '', '', '',
    '', '', '', '', r.active ? 'sim' : 'nao', r.revision || 1, new Date(r.updated_at).toISOString(),
  ])));

  centers.rows.forEach(r => lines.push(csvLine([
    'obras', r.public_id, r.name, '', r.code, '', '', '', '', r.description || '',
    r.client || '', r.contract_number || '', String(r.monthly_budget || 0),
    r.project_status, r.active ? 'sim' : 'nao', r.revision || 1, new Date(r.updated_at).toISOString(),
  ])));

  const suffix = new Date().toISOString().slice(0,10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="cadastros-${suffix}.csv"`);
  res.send(`\uFEFF${lines.join('\r\n')}`);
}));

router.post('/importar', asyncRoute(async (req, res) => {
  const content = String(req.body.conteudo || '');
  const filename = String(req.body.nomeArquivo || 'cadastros.csv');
  if (!content.trim()) throw httpError(400, 'Selecione um arquivo CSV válido.');
  if (Buffer.byteLength(content, 'utf8') > 8 * 1024 * 1024) throw httpError(413, 'O arquivo excede 8 MB.');

  let parsed;
  try { parsed = parseCsv(content); } catch (e) { throw httpError(400, e.message); }
  if (parsed.length < 2) throw httpError(400, 'A planilha está vazia.');

  const header = parsed[0].map(h => h.trim());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const rows = parsed.slice(1).map((cells, i) => {
    const r = {};
    headers.forEach(h => { r[h] = String(idx[h] == null ? '' : cells[idx[h]] ?? '').trim(); });
    r.line = i + 2;
    return r;
  });

  const db = getDb();
  const instance = getInstanceIdentity();
  const result = { fornecedores: { incluidos: 0, atualizados: 0, ignorados: 0, conflitos: 0 },
    categorias: { incluidos: 0, atualizados: 0, ignorados: 0, conflitos: 0 },
    obras: { incluidos: 0, atualizados: 0, ignorados: 0, conflitos: 0 }, erros: 0, detalhes: [] };

  await db.transaction(async (tx) => {
    for (const row of rows) {
      const secao = row.secao;
      if (!['fornecedores','categorias','obras'].includes(secao)) {
        result.erros++; addDetail(result, row.line, 'erro', `Seção inválida: ${secao || 'vazia'}`); continue;
      }
      if (!UUID.test(row.public_id)) { result.erros++; addDetail(result, row.line, 'erro', 'ID público inválido.'); continue; }

      if (secao === 'fornecedores') await importSupplier(tx, row, instance, result);
      else if (secao === 'categorias') await importCategory(tx, row, instance, result);
      else await importCostCenter(tx, row, instance, result);
    }
  });

  result.total = rows.length;
  await recordAudit({entityType:'sincronizacao',action:'cadastros_importados',
    summary:`Importação de cadastros ${filename}: ${result.total} linha(s).`,
    data:result,user:req.usuario});
  res.json(result);
}));

async function importSupplier(tx, row, instance, result) {
  const existing = (await tx.query('SELECT * FROM suppliers WHERE public_id = $1', [row.public_id])).rows[0];
  const name = row.nome.slice(0,160);
  if (!name) { result.erros++; addDetail(result, row.line, 'erro', 'Fornecedor sem nome.'); return; }
  const active = row.ativo !== 'nao';
  const revision = Number(row.revisao) || 1;
  const updatedAt = new Date(row.alterado_em) || new Date();
  if (!existing) {
    await tx.query(`INSERT INTO suppliers (public_id,name,document,contact_name,email,phone,notes,active,revision,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [row.public_id, name, row.documento.slice(0,30)||null, row.contato.slice(0,120)||null,
       row.email.slice(0,180)||null, row.telefone.slice(0,40)||null, row.observacoes||null,
       active, revision, updatedAt]);
    result.fornecedores.incluidos++; addDetail(result, row.line, 'incluido', `Fornecedor "${name}" incluído.`);
  } else if (Number(existing.revision) >= revision) {
    result.fornecedores.ignorados++;
  } else if (String(existing.updated_at) > String(updatedAt)) {
    result.fornecedores.conflitos++; addDetail(result, row.line, 'conflito', `Conflito de revisão: ${name}.`);
  } else {
    await tx.query(`UPDATE suppliers SET name=$1,document=$2,contact_name=$3,email=$4,phone=$5,
      notes=$6,active=$7,revision=$8,updated_at=$9 WHERE public_id=$10`,
      [name, row.documento.slice(0,30)||null, row.contato.slice(0,120)||null,
       row.email.slice(0,180)||null, row.telefone.slice(0,40)||null, row.observacoes||null,
       active, revision, updatedAt, row.public_id]);
    result.fornecedores.atualizados++;
  }
}

async function importCategory(tx, row, instance, result) {
  const existing = (await tx.query('SELECT * FROM categories WHERE public_id = $1', [row.public_id])).rows[0];
  const name = row.nome.slice(0,100);
  if (!name) { result.erros++; addDetail(result, row.line, 'erro', 'Categoria sem nome.'); return; }
  const type = ['receita','despesa','ambos'].includes(row.tipo) ? row.tipo : 'ambos';
  const active = row.ativo !== 'nao';
  const revision = Number(row.revisao) || 1;
  const updatedAt = new Date(row.alterado_em) || new Date();
  if (!existing) {
    await tx.query(`INSERT INTO categories (public_id,name,type,active,revision,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6)`, [row.public_id, name, type, active, revision, updatedAt]);
    result.categorias.incluidos++; addDetail(result, row.line, 'incluido', `Categoria "${name}" incluída.`);
  } else if (Number(existing.revision) >= revision) {
    result.categorias.ignorados++;
  } else {
    await tx.query(`UPDATE categories SET name=$1,type=$2,active=$3,revision=$4,updated_at=$5 WHERE public_id=$6`,
      [name, type, active, revision, updatedAt, row.public_id]);
    result.categorias.atualizados++;
  }
}

async function importCostCenter(tx, row, instance, result) {
  const existing = (await tx.query('SELECT * FROM cost_centers WHERE public_id = $1', [row.public_id])).rows[0];
  const name = row.nome.slice(0,140);
  const code = row.codigo.slice(0,40);
  if (!name || !code) { result.erros++; addDetail(result, row.line, 'erro', 'Obra sem código ou nome.'); return; }
  const active = row.ativo !== 'nao';
  const revision = Number(row.revisao) || 1;
  const updatedAt = new Date(row.alterado_em) || new Date();
  const status = ['planejamento','execucao','pausado','concluido'].includes(row.situacao) ? row.situacao : 'planejamento';
  const budget = Number(row.orcamento_mensal) || 0;
  if (!existing) {
    await tx.query(`INSERT INTO cost_centers (public_id,code,name,responsible,monthly_budget,client,contract_number,project_status,active,description,revision,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [row.public_id, code, name, null, budget, row.cliente.slice(0,160)||null,
       row.contrato.slice(0,80)||null, status, active, row.observacoes||null, revision, updatedAt]);
    result.obras.incluidos++; addDetail(result, row.line, 'incluido', `Obra "${name}" incluída.`);
  } else if (Number(existing.revision) >= revision) {
    result.obras.ignorados++;
  } else {
    await tx.query(`UPDATE cost_centers SET code=$1,name=$2,monthly_budget=$3,client=$4,contract_number=$5,
      project_status=$6,active=$7,description=$8,revision=$9,updated_at=$10 WHERE public_id=$11`,
      [code, name, budget, row.cliente.slice(0,160)||null, row.contrato.slice(0,80)||null,
       status, active, row.observacoes||null, revision, updatedAt, row.public_id]);
    result.obras.atualizados++;
  }
}

function addDetail(result, line, status, message) {
  if (result.detalhes.length < 200) result.detalhes.push({ linha: line, status, mensagem: message });
}

const headers = ['secao','public_id','nome','tipo','codigo','documento','contato','email','telefone','observacoes','cliente','contrato','orcamento_mensal','situacao','ativo','revisao','alterado_em'];

module.exports = router;
