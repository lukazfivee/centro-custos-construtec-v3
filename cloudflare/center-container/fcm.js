// Envio pelo Firebase Cloud Messaging (API HTTP v1). A conta de serviço vem do
// segredo FCM_SERVICE_ACCOUNT (JSON baixado do Firebase). O token OAuth dura 1h
// e fica em memória enquanto o isolate do Worker viver.
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
let cached = null;

function serviceAccount(env) {
  const raw = String(env.FCM_SERVICE_ACCOUNT || '').replace(/^\uFEFF/, '').trim();
  if (!raw) return null;
  try {
    const account = JSON.parse(raw);
    return account.client_email && account.private_key && account.project_id ? account : null;
  } catch { return null; }
}

export function fcmConfigured(env) { return Boolean(serviceAccount(env)); }

const base64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const base64urlText = (text) => base64url(new TextEncoder().encode(text));

function pemToDer(pem) {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

async function accessToken(env, account) {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.email === account.client_email && cached.expiresAt > now + 60) return cached.token;
  const header = base64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64urlText(JSON.stringify({
    iss: account.client_email, scope: SCOPE, aud: account.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(account.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`));
  const response = await fetch(account.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${base64url(signature)}` }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(`FCM_AUTH_${response.status}`);
  cached = { token: data.access_token, email: account.client_email, expiresAt: now + Number(data.expires_in || 3600) };
  return cached.token;
}

// Envia para cada token. Devolve os tokens que o Firebase diz não existirem mais,
// para o chamador apagar. Sem conta de serviço configurada, não envia nada.
export async function sendPush(env, tokens, message) {
  const account = serviceAccount(env);
  if (!account || !tokens.length) return { sent: 0, invalid: [] };
  const bearer = await accessToken(env, account);
  const url = `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`;
  let sent = 0;
  const invalid = [];
  for (const token of tokens) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: {
        token,
        notification: { title: message.title, body: message.body },
        data: { link: message.link || '', type: message.type || '', id: message.id || '' },
        android: { priority: 'HIGH', notification: { channel_id: 'avisos' } },
      } }),
    });
    if (response.ok) { sent += 1; continue; }
    const data = await response.json().catch(() => ({}));
    const code = JSON.stringify(data?.error?.details || '');
    if (response.status === 404 || code.includes('UNREGISTERED') || (response.status === 400 && code.includes('INVALID_ARGUMENT'))) invalid.push(token);
  }
  return { sent, invalid };
}

export function resetFcmCacheForTests() { cached = null; }
