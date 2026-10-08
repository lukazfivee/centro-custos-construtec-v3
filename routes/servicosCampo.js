// Execucao do servico em campo: checklist, fotos antes e depois e aceite do cliente. Montado em /api/servicos.
const crypto = require('crypto');
const express = require('express');
const { getDb } = require('../db');
const { autenticar } = require('../middleware/auth');
const { paramObra } = require('../services/obraScope');
const { exigirPermissao, can } = require('../services/permissions');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { recordAudit } = require('../services/audit');
const core = require('../services/servicos/core');
const { decodePhoto, decodeSignature, sendFile } = require('../services/servicos/files');

const router = express.Router();
router.use(autenticar);
router.param('id', paramObra);

const MAX_ITEMS = 100;
const MAX_PHOTOS = 40;

function assertEditable(job) {
  if (job.status === 'faturado') throw httpError(409, 'Serviço faturado não pode ser alterado.');
}

function readChecklist(items) {
  if (!Array.isArray(items)) throw httpError(400, 'Envie itens como uma lista.');
  if (items.length > MAX_ITEMS) throw httpError(400, `O checklist aceita até ${MAX_ITEMS} itens.`);
  return items.map((item) => {
    const texto = String(item?.texto || '').trim().slice(0, 200);
    if (!texto) throw httpError(400, 'Todo item do checklist precisa de texto.');
    const id = /^[0-9a-f-]{8,36}$/i.test(String(item?.id || '')) ? String(item.id) : crypto.randomUUID();
    return { id, texto, feito: item?.feito === true };
  });
}

async function saveChecklist(tx, id, list) {
  await tx.query('UPDATE service_jobs SET checklist=$2::jsonb,updated_at=NOW() WHERE cost_center_id=$1', [id, JSON.stringify(list)]);
}

// Substitui a lista inteira (incluir, remover, reordenar, renomear).
router.put('/:id/checklist', exigirPermissao('p2'), asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const list = readChecklist(req.body?.itens);
  await getDb().transaction(async (tx) => {
    const { center, job } = await core.loadService(tx, id, { lock: true });
    assertEditable(job);
    await saveChecklist(tx, id, list);
    await recordAudit({ entityType: 'servico', entityId: center.public_id, action: 'checklist', client: tx,
      summary: `Checklist do serviço ${center.code}: ${list.filter((i) => i.feito).length}/${list.length} feitos`, data: { itens: list.length }, user: req.usuario });
  });
  res.json({ itens: list });
}));

// Inclui um item. O id vem do celular (criado sem internet), entao repetir o envio nao duplica.
router.post('/:id/checklist', exigirPermissao('p2'), asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const [item] = readChecklist([{ id: req.body?.id, texto: req.body?.texto, feito: false }]);
  let list;
  await getDb().transaction(async (tx) => {
    const { center, job } = await core.loadService(tx, id, { lock: true });
    assertEditable(job);
    list = Array.isArray(job.checklist) ? job.checklist : [];
    if (list.some((i) => i.id === item.id)) return;
    if (list.length >= MAX_ITEMS) throw httpError(400, `O checklist aceita até ${MAX_ITEMS} itens.`);
    list.push(item);
    await saveChecklist(tx, id, list);
    await recordAudit({ entityType: 'servico', entityId: center.public_id, action: 'checklist_item_incluido', client: tx,
      summary: `Checklist do serviço ${center.code}: item "${item.texto}" incluído`, data: { item: item.id }, user: req.usuario });
  });
  res.status(201).json({ itens: list });
}));

// Marca ou desmarca um item.
router.patch('/:id/checklist/:itemId', exigirPermissao('p2'), asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  if (typeof req.body?.feito !== 'boolean') throw httpError(400, 'Informe feito como true ou false.');
  let list;
  await getDb().transaction(async (tx) => {
    const { center, job } = await core.loadService(tx, id, { lock: true });
    assertEditable(job);
    list = Array.isArray(job.checklist) ? job.checklist : [];
    const item = list.find((i) => i.id === req.params.itemId);
    if (!item) throw httpError(404, 'Item do checklist não encontrado.');
    item.feito = req.body.feito;
    await saveChecklist(tx, id, list);
    await recordAudit({ entityType: 'servico', entityId: center.public_id, action: 'checklist_item', client: tx,
      summary: `Checklist do serviço ${center.code}: "${item.texto}" ${item.feito ? 'feito' : 'não feito'}`, data: { item: item.id, feito: item.feito }, user: req.usuario });
  });
  res.json({ itens: list });
}));

router.get('/:id/fotos', asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  await core.loadService(getDb(), id);
  res.json(await core.photosOf(getDb(), id));
}));

router.post('/:id/fotos', exigirPermissao('p2'), asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const fase = String(req.body?.fase || '');
  if (!['antes', 'depois'].includes(fase)) throw httpError(400, 'Informe a fase da foto: antes ou depois.');
  const file = decodePhoto(req.body);
  const caption = String(req.body?.legenda || '').trim().slice(0, 200) || null;
  const db = getDb();
  const row = await db.transaction(async (tx) => {
    const { center, job } = await core.loadService(tx, id, { lock: true });
    assertEditable(job);
    const count = (await tx.query('SELECT COUNT(*)::int AS n FROM service_photos WHERE cost_center_id=$1', [id])).rows[0].n;
    if (count >= MAX_PHOTOS) throw httpError(409, `O serviço já tem ${MAX_PHOTOS} fotos.`);
    const dup = await tx.query('SELECT 1 FROM service_photos WHERE cost_center_id=$1 AND sha256=$2 AND phase=$3', [id, file.sha256, fase]);
    if (dup.rows.length) throw httpError(409, 'Esta mesma foto já foi enviada.');
    const inserted = (await tx.query(`INSERT INTO service_photos (cost_center_id,phase,original_name,mime_type,size_bytes,sha256,content,caption,created_by,created_by_name)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [id, fase, file.name, file.mime, file.content.length, file.sha256, file.content, caption, req.usuario.id, req.usuario.name])).rows[0];
    await core.touch(tx, id);
    await recordAudit({ entityType: 'servico', entityId: center.public_id, action: 'foto_adicionada', client: tx,
      summary: `Foto (${fase}) no serviço ${center.code}`, data: { foto: inserted.id, fase, tamanho: file.content.length, sha256: file.sha256 }, user: req.usuario });
    return inserted;
  });
  res.status(201).json((await core.photosOf(db, id)).find((p) => p.id === row.id));
}));

router.get('/:id/fotos/:fotoId/arquivo', asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const { rows } = await getDb().query('SELECT original_name,mime_type,content FROM service_photos WHERE id=$1 AND cost_center_id=$2', [positiveId(req.params.fotoId, 'Foto'), id]);
  if (!rows[0]) throw httpError(404, 'Foto não encontrada.');
  sendFile(res, { name: rows[0].original_name, mime: rows[0].mime_type, content: rows[0].content });
}));

// Quem enviou a foto pode apagar; outros precisam de p3.
router.delete('/:id/fotos/:fotoId', exigirPermissao('p2'), asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const fotoId = positiveId(req.params.fotoId, 'Foto');
  await getDb().transaction(async (tx) => {
    const { center, job } = await core.loadService(tx, id, { lock: true });
    assertEditable(job);
    const photo = (await tx.query('SELECT id,phase,created_by,sha256 FROM service_photos WHERE id=$1 AND cost_center_id=$2', [fotoId, id])).rows[0];
    if (!photo) throw httpError(404, 'Foto não encontrada.');
    if (Number(photo.created_by) !== Number(req.usuario.id) && !(await can(req.usuario, 'p3'))) throw httpError(403, 'Só quem enviou a foto pode removê-la.');
    await tx.query('DELETE FROM service_photos WHERE id=$1', [fotoId]);
    await core.touch(tx, id);
    await recordAudit({ entityType: 'servico', entityId: center.public_id, action: 'foto_removida', client: tx,
      summary: `Foto (${photo.phase}) removida do serviço ${center.code}`, data: { foto: fotoId, sha256: photo.sha256 }, user: req.usuario });
  });
  res.json({ ok: true });
}));

// Aceite: assinatura PNG desenhada no aparelho, nome, cargo e data/hora (padrao: agora).
router.put('/:id/aceite', exigirPermissao('p2'), asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const nome = String(req.body?.nome || '').trim().slice(0, 160);
  if (!nome) throw httpError(400, 'Informe o nome de quem aceitou.');
  const cargo = String(req.body?.cargo || '').trim().slice(0, 120) || null;
  const when = req.body?.dataHora ? new Date(req.body.dataHora) : new Date();
  if (Number.isNaN(when.getTime())) throw httpError(400, 'Data e hora do aceite inválidas.');
  const signature = decodeSignature(req.body?.assinatura || {});
  const db = getDb();
  await db.transaction(async (tx) => {
    const { center, job } = await core.loadService(tx, id, { lock: true });
    assertEditable(job);
    await tx.query(`UPDATE service_jobs SET accept_name=$2,accept_role=$3,accept_at=$4,accept_signature=$5,accept_by_name=$6,updated_at=NOW()
      WHERE cost_center_id=$1`, [id, nome, cargo, when.toISOString(), signature.content, req.usuario.name]);
    await recordAudit({ entityType: 'servico', entityId: center.public_id, action: 'aceite_registrado', client: tx,
      summary: `Aceite do cliente no serviço ${center.code}: ${nome}`, data: { nome, cargo, dataHora: when.toISOString(), sha256: signature.sha256 }, user: req.usuario });
  });
  res.json((await core.serviceDetail(db, id, req.usuario)).aceite);
}));

router.get('/:id/aceite/assinatura', asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  await core.loadService(getDb(), id);
  const { rows } = await getDb().query('SELECT accept_signature FROM service_jobs WHERE cost_center_id=$1', [id]);
  if (!rows[0]?.accept_signature) throw httpError(404, 'Aceite ainda não registrado.');
  sendFile(res, { name: `assinatura-${id}.png`, mime: 'image/png', content: rows[0].accept_signature });
}));

router.delete('/:id/aceite', exigirPermissao('p2'), asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  await getDb().transaction(async (tx) => {
    const { center, job } = await core.loadService(tx, id, { lock: true });
    assertEditable(job);
    await tx.query(`UPDATE service_jobs SET accept_name=NULL,accept_role=NULL,accept_at=NULL,accept_signature=NULL,accept_by_name=NULL,updated_at=NOW()
      WHERE cost_center_id=$1`, [id]);
    await recordAudit({ entityType: 'servico', entityId: center.public_id, action: 'aceite_removido', client: tx, summary: `Aceite removido do serviço ${center.code}`, user: req.usuario });
  });
  res.json({ ok: true });
}));

module.exports = router;
