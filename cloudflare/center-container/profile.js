import { json, text, timingSafeEqual, cleanSyncKey, validateProfilePhoto, ORG_ID } from './centralAuth.js';

// Perfil da conta central (nome, celular e foto) para o site do celular. Só a rota
// interna, chamada pelo Container com SYNC_SHARED_KEY e o id da conta central: a
// sessão aberta pelo app (handoff) guarda só o hash, que não serve de Bearer.
export function isProfileRoute(pathname) {
  return pathname === '/v1/internal/profile';
}

const fail = (error, status = 400) => json({ ok: false, error }, status);

function profile(row) {
  return {
    ok: true,
    profile: {
      name: row.name, email: row.email, role: row.role, phone: row.phone || '',
      photo: row.profile_photo_base64 && row.profile_photo_mime ? { mime: row.profile_photo_mime, contentBase64: row.profile_photo_base64 } : null,
    },
  };
}

async function load(env, id) {
  return env.DB.prepare(`SELECT id,name,email,role,phone,profile_photo_base64,profile_photo_mime FROM cloud_users
    WHERE id=? AND org_id=? AND active=1 AND deleted_at IS NULL`).bind(id, ORG_ID).first();
}

export async function handleProfile(request, env) {
  const expected = cleanSyncKey(env);
  if (request.method !== 'POST' || expected.length < 32 || !timingSafeEqual(request.headers.get('x-sync-key') || '', expected)) return fail('Sem permissão.', 403);
  let body;
  try { body = (await request.json()) || {}; } catch { body = {}; }
  const id = String(body.userId || '');
  const user = id ? await load(env, id) : null;
  if (!user) return fail('Conta não encontrada.', 404);
  const now = new Date().toISOString();

  if (body.action === 'get') return json(profile(user));
  if (body.action === 'update') {
    const name = text(body.name).replace(/\s+/g, ' ').slice(0, 120);
    const phone = String(body.phone ?? '').replace(/\D/g, '').slice(0, 13);
    if (name.length < 2) return fail('Informe seu nome completo.');
    if (phone && phone.length < 10) return fail('Informe o celular com DDD.');
    await env.DB.prepare('UPDATE cloud_users SET name=?,phone=?,updated_at=? WHERE id=?').bind(name, phone || null, now, id).run();
  } else if (body.action === 'setPhoto') {
    const photo = validateProfilePhoto(body);
    if (photo.error) return fail(photo.error, photo.status);
    await env.DB.prepare('UPDATE cloud_users SET profile_photo_base64=?,profile_photo_mime=?,updated_at=? WHERE id=?').bind(photo.contentBase64, photo.mime, now, id).run();
  } else if (body.action === 'removePhoto') {
    await env.DB.prepare('UPDATE cloud_users SET profile_photo_base64=NULL,profile_photo_mime=NULL,updated_at=? WHERE id=?').bind(now, id).run();
  } else {
    return fail('Ação desconhecida.', 404);
  }
  return json(profile(await load(env, id)));
}
