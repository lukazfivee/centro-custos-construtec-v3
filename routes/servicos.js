// Servicos curtos (cost_centers.kind='servico'). Contrato: docs/suite-desktop/SERVICOS-API.md.
const crypto = require('crypto');
const express = require('express');
const { getDb } = require('../db');
const { autenticar } = require('../middleware/auth');
const { paramObra, obrasPermitidas, restringir } = require('../services/obraScope');
const { exigirPermissao, can } = require('../services/permissions');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { validDate } = require('../lib/dates');
const { roundDecimal } = require('../lib/decimal');
const { recordAudit } = require('../services/audit');
const core = require('../services/servicos/core');
const { quickExpense } = require('../services/servicos/gastos');
const { completeService, billService } = require('../services/servicos/fechamento');
const { serviceReportHtml } = require('../services/servicos/relatorio');

const router = express.Router();
router.use(autenticar);
router.param('id', paramObra);

const text = (value, max) => String(value ?? '').trim().slice(0, max) || null;

// Campos do servico; partial=true (editar) so valida o que veio.
function readFields(body, partial) {
  const out = {};
  const has = (k) => body[k] !== undefined;
  if (!partial || has('cliente')) { out.client = text(body.cliente, 160); if (!out.client) throw httpError(400, 'Informe o cliente.'); }
  if (!partial || has('valor')) {
    const v = Number(body.valor);
    if (body.valor === '' || body.valor == null || !Number.isFinite(v) || v < 0 || v > 999999999999.99) throw httpError(400, 'Informe o valor cobrado (zero ou mais).');
    out.amount = roundDecimal(String(v));
  }
  if (has('codigo')) out.code = text(body.codigo, 40);
  if (has('nome')) out.name = text(body.nome, 140);
  if (has('local')) out.location = text(body.local, 300);
  if (has('responsavel')) out.responsible = text(body.responsavel, 120);
  if (has('descricao')) out.description = text(body.descricao, 5000);
  if (has('data')) { out.startDate = text(body.data, 10); if (out.startDate && !validDate(out.startDate)) throw httpError(400, 'Data inválida.'); }
  return out;
}

async function assertFreeCode(db, code, exceptId) {
  const { rows } = await db.query('SELECT id FROM cost_centers WHERE LOWER(code)=LOWER($1) AND id<>$2', [code, exceptId || 0]);
  if (rows[0]) throw httpError(409, `O código ${code} já está em uso.`);
}

router.get('/proximo-codigo', asyncRoute(async (req, res) => {
  res.json({ codigo: await core.nextCode(getDb()) });
}));

router.get('/', asyncRoute(async (req, res) => {
  const situacao = req.query.situacao ? String(req.query.situacao) : null;
  if (situacao && !core.STATUSES.includes(situacao)) throw httpError(400, 'Situação inválida.');
  let where = "WHERE cc.kind='servico'";
  let values = [];
  if (situacao) { values.push(situacao); where += ` AND COALESCE(sj.status,'agendado')=$${values.length}`; }
  if (req.query.ativo === 'true' || req.query.ativo === 'false') { values.push(req.query.ativo === 'true'); where += ` AND cc.active=$${values.length}`; }
  ({ where, values } = restringir(where, values, await obrasPermitidas(req), 'cc.id'));
  const { rows } = await getDb().query(`SELECT cc.id,cc.code,cc.name,cc.client,cc.responsible,cc.start_date::text AS data,cc.contract_amount,cc.active,
      COALESCE(sj.status,'agendado') AS status,sj.location,
      COALESCE((SELECT SUM(t.amount*t.accounting_sign) FROM transactions t WHERE t.cost_center_id=cc.id AND t.type='despesa' AND t.deleted_at IS NULL),0) AS gastos
    FROM cost_centers cc LEFT JOIN service_jobs sj ON sj.cost_center_id=cc.id ${where}
    ORDER BY cc.start_date DESC NULLS LAST,cc.id DESC LIMIT 1000`, values);
  const money = await core.seesMoney(req.usuario);
  res.json(rows.map((r) => {
    const s = core.summarize(r.contract_amount, [{ tipo: 'outros', valor: core.money(r.gastos) }]);
    const item = { id: r.id, codigo: r.code, nome: r.name, cliente: r.client || '', local: r.location || '', data: r.data,
      responsavel: r.responsible || '', situacao: r.status, ativo: r.active, gastos: s.gastos };
    return money ? { ...item, valor: s.cobrado, resultado: s.resultado, margem: s.margem } : item;
  }));
}));

router.post('/', exigirPermissao('p5'), asyncRoute(async (req, res) => {
  const db = getDb();
  const f = readFields(req.body || {}, false);
  const code = f.code || await core.nextCode(db);
  if (!/^SV-/i.test(code)) throw httpError(400, 'O código do serviço começa com SV- (ex.: SV-1014).');
  await assertFreeCode(db, code);
  const name = f.name || (f.description ? f.description.split('\n')[0].slice(0, 140) : `Serviço ${f.client}`.slice(0, 140));
  const created = await db.transaction(async (tx) => {
    const row = (await tx.query(`INSERT INTO cost_centers (public_id,code,name,responsible,client,start_date,contract_amount,description,kind,project_status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'servico','planejamento') RETURNING id,public_id`,
    [crypto.randomUUID(), code, name, f.responsible || null, f.client, f.startDate || null, f.amount, f.description || null])).rows[0];
    await tx.query('INSERT INTO service_jobs (cost_center_id,location) VALUES ($1,$2)', [row.id, f.location || null]);
    await recordAudit({ entityType: 'servico', entityId: row.public_id, action: 'criado', summary: `Serviço criado: ${code}`, client: tx,
      data: { codigo: code, cliente: f.client, valor: f.amount }, user: req.usuario });
    return row;
  });
  res.status(201).json(await core.serviceDetail(db, created.id, req.usuario));
}));

router.get('/:id', asyncRoute(async (req, res) => {
  res.json(await core.serviceDetail(getDb(), positiveId(req.params.id), req.usuario));
}));

router.put('/:id', exigirPermissao('p5'), asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const db = getDb();
  const f = readFields(req.body || {}, true);
  const expected = req.body?.revisao == null || req.body.revisao === '' ? null : Number(req.body.revisao);
  await db.transaction(async (tx) => {
    const { center } = await core.loadService(tx, id, { lock: true });
    if (expected !== null && expected !== center.revision) throw httpError(409, 'Este serviço foi alterado por outra pessoa. Abra de novo para ver a versão atual.');
    if (f.code) { if (!/^SV-/i.test(f.code)) throw httpError(400, 'O código do serviço começa com SV-.'); await assertFreeCode(tx, f.code, id); }
    const cols = { code: 'code', name: 'name', client: 'client', responsible: 'responsible', startDate: 'start_date', amount: 'contract_amount', description: 'description' };
    const sets = []; const vals = [id];
    for (const [k, col] of Object.entries(cols)) if (k in f) { if ((k === 'code' || k === 'name') && !f[k]) continue; vals.push(f[k]); sets.push(`${col}=$${vals.length}`); }
    if (sets.length) await tx.query(`UPDATE cost_centers SET ${sets.join(',')},revision=revision+1,updated_at=NOW() WHERE id=$1`, vals);
    if ('location' in f) await tx.query('UPDATE service_jobs SET location=$2,updated_at=NOW() WHERE cost_center_id=$1', [id, f.location]);
    await recordAudit({ entityType: 'servico', entityId: center.public_id, action: 'atualizado', summary: `Serviço atualizado: ${f.code || center.code}`, client: tx, data: f, user: req.usuario });
  });
  res.json(await core.serviceDetail(db, id, req.usuario));
}));

// Agendado <-> em andamento (p2). Reabrir um concluido (volta a em andamento) exige p5. Faturado nao volta.
router.put('/:id/situacao', exigirPermissao('p2'), asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const target = String(req.body?.situacao || '');
  if (!['agendado', 'em_andamento'].includes(target)) throw httpError(400, 'Situação inválida. Use agendado ou em_andamento; para concluir ou faturar use as ações próprias.');
  const db = getDb();
  await db.transaction(async (tx) => {
    const { center, job } = await core.loadService(tx, id, { lock: true });
    if (job.status === 'faturado') throw httpError(409, 'Serviço faturado não muda de situação.');
    if (job.status === 'concluido') {
      if (!(await can(req.usuario, 'p5'))) throw httpError(403, 'Você não tem permissão para reabrir um serviço concluído.');
      await tx.query('UPDATE service_jobs SET completed_at=NULL,completed_by_name=NULL,completed_pending=NULL WHERE cost_center_id=$1', [id]);
    }
    await core.touch(tx, id, target);
    await recordAudit({ entityType: 'servico', entityId: center.public_id, action: 'situacao', summary: `Serviço ${center.code}: ${job.status} para ${target}`, client: tx, data: { de: job.status, para: target }, user: req.usuario });
  });
  res.json(await core.serviceDetail(db, id, req.usuario));
}));

router.get('/:id/resumo', asyncRoute(async (req, res) => {
  const d = await core.serviceDetail(getDb(), positiveId(req.params.id), req.usuario);
  res.json({ ...d.resumo, veValores: d.veValores });
}));

router.get('/:id/pendencias', asyncRoute(async (req, res) => {
  const d = await core.serviceDetail(getDb(), positiveId(req.params.id), req.usuario);
  res.json({ situacao: d.situacao, pendencias: d.pendencias });
}));

router.get('/:id/gastos', asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  await core.loadService(getDb(), id);
  res.json(await core.expensesOf(getDb(), id));
}));

router.post('/:id/gastos', exigirPermissao('p2'), asyncRoute(async (req, res) => {
  const out = await quickExpense(positiveId(req.params.id), req.body || {}, req.usuario);
  res.status(out.status).json(out.body);
}));

router.post('/:id/concluir', exigirPermissao('p2'), asyncRoute(async (req, res) => {
  res.json(await completeService(positiveId(req.params.id), req.body || {}, req.usuario));
}));

router.post('/:id/faturar', exigirPermissao('p6'), asyncRoute(async (req, res) => {
  res.json(await billService(positiveId(req.params.id), req.body || {}, req.usuario));
}));

router.get('/:id/relatorio', asyncRoute(async (req, res) => {
  const html = await serviceReportHtml(positiveId(req.params.id), req.usuario);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(html);
}));

module.exports = router;
