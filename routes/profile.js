// Meu perfil (site do celular e Configurações do desktop): nome, celular e foto. Com conta central,
// os dados ficam no Worker (rota interna, pelo id da conta) e o Centro guarda uma cópia do nome,
// do celular e da foto; instalação local sem conta central guarda tudo só no próprio banco.
const express = require('express');
const { getDb } = require('../db');
const { autenticar } = require('../middleware/auth');
const { asyncRoute, httpError } = require('../lib/http');
const { decodeProfilePhoto } = require('../lib/profilePhoto');
const { workerCall, notificationsConfigured } = require('../services/notify');
const { recordAudit } = require('../services/audit');

const router = express.Router();
router.use(autenticar);

const central = (req) => Boolean(req.usuario.cloud_user_id) && notificationsConfigured();

async function remote(req, action, extra = {}) {
  try {
    return (await workerCall('/v1/internal/profile', { ...extra, action, userId: req.usuario.cloud_user_id })).profile;
  } catch (error) {
    if ([400, 413].includes(error.upstream)) throw httpError(error.upstream, error.message);
    throw httpError(503, 'Não foi possível falar com a conta central agora. Verifique a internet e tente de novo.');
  }
}

// Cópia local do nome, do celular e da foto, usada no Centro web e sem internet.
async function mirror(req, p) {
  const photo = p.photo ? decodeProfilePhoto(p.photo) : null;
  await getDb().query('UPDATE users SET name=$1,profile_photo=$2,profile_photo_mime=$3,phone=COALESCE($4,phone),updated_at=NOW() WHERE id=$5',
    [p.name, photo ? photo.content : null, photo ? photo.mime : null, p.phone == null ? null : String(p.phone), req.usuario.id]);
}

async function local(req) {
  const row = (await getDb().query('SELECT name,email,role,phone,profile_photo,profile_photo_mime FROM users WHERE id=$1', [req.usuario.id])).rows[0];
  return { name: row.name, email: row.email, role: row.role, phone: row.phone || '',
    photo: row.profile_photo ? { mime: row.profile_photo_mime, contentBase64: Buffer.from(row.profile_photo).toString('base64') } : null };
}

const audit = (req, summary) => recordAudit({ entityType: 'usuario', entityId: req.usuario.id, action: 'perfil_atualizado',
  summary: `${req.usuario.name}: ${summary}`, user: req.usuario });

const out = (p, isCentral) => ({ nome: p.name, email: p.email, perfil: p.role, celular: p.phone || '', foto: p.photo, central: isCentral });

router.get('/', asyncRoute(async (req, res) => {
  if (!central(req)) return res.json(out(await local(req), false));
  const p = await remote(req, 'get');
  await mirror(req, p);
  res.json(out(p, true));
}));

router.put('/', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const name = String(body.nome || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (name.length < 2) throw httpError(400, 'Informe seu nome completo.');
  const phone = String(body.celular || '').trim().slice(0, 40);
  if (phone && phone.replace(/\D/g, '').length < 10) throw httpError(400, 'Informe o celular com DDD.');
  if (!central(req)) {
    // Sem o campo celular na requisição (site do celular antigo), o telefone guardado não muda.
    await getDb().query('UPDATE users SET name=$1,phone=CASE WHEN $2::boolean THEN $3 ELSE phone END,updated_at=NOW() WHERE id=$4',
      [name, body.celular !== undefined, phone, req.usuario.id]);
    await audit(req, 'Perfil atualizado.');
    return res.json(out(await local(req), false));
  }
  const p = await remote(req, 'update', { name, phone });
  await mirror(req, p);
  await audit(req, 'Perfil atualizado.');
  res.json(out(p, true));
}));

router.post('/foto', asyncRoute(async (req, res) => {
  const photo = decodeProfilePhoto(req.body);
  if (!central(req)) {
    await getDb().query('UPDATE users SET profile_photo=$1,profile_photo_mime=$2,updated_at=NOW() WHERE id=$3', [photo.content, photo.mime, req.usuario.id]);
    await audit(req, 'Foto de perfil trocada.');
    return res.json(out(await local(req), false));
  }
  const p = await remote(req, 'setPhoto', { mime: photo.mime, contentBase64: photo.contentBase64 });
  await mirror(req, p);
  await audit(req, 'Foto de perfil trocada.');
  res.json(out(p, true));
}));

router.delete('/foto', asyncRoute(async (req, res) => {
  if (!central(req)) {
    await getDb().query('UPDATE users SET profile_photo=NULL,profile_photo_mime=NULL,updated_at=NOW() WHERE id=$1', [req.usuario.id]);
    await audit(req, 'Foto de perfil removida.');
    return res.json(out(await local(req), false));
  }
  const p = await remote(req, 'removePhoto');
  await mirror(req, p);
  await audit(req, 'Foto de perfil removida.');
  res.json(out(p, true));
}));

module.exports = router;
