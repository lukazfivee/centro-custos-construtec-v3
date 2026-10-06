import { json } from './centralAuth.js';

// Atualizacao do app Android por dentro do app. A fonte e o GitHub Releases do
// repositorio (publico): o Worker escolhe a release mais recente (inclui
// pre-lancamentos), le o hash SHA-256 e entrega duas rotas publicas, sem login:
//   GET /v1/app/android/latest  -> versao, notas, hash e o endereco do APK
//   GET /v1/app/android/apk     -> o APK da mesma release (proxy)
// O token GITHUB_RELEASES_TOKEN e opcional (evita o limite anonimo da API do GitHub
// e permite repositorio privado); ele so sai deste Worker para o GitHub, nunca na resposta.
const REPO = 'lukazfivee/centro-custos-construtec-v3';
const API = `https://api.github.com/repos/${REPO}/releases?per_page=20`;
const FRESH_SECONDS = 600;
const STALE_SECONDS = 7 * 24 * 3600;
const FRESH_KEY = 'https://cache.internal/android-update/fresh';
const STALE_KEY = 'https://cache.internal/android-update/stale';
const APK_TYPE = 'application/vnd.android.package-archive';
const SHA256 = /^[0-9a-f]{64}$/;

export function isAndroidUpdateRoute(pathname) {
  return pathname === '/v1/app/android/latest' || pathname === '/v1/app/android/apk';
}

/** 3.1.0-rc.19 -> 31019; 3.1.0 (final) -> 31099; 3.2.0-rc.1 -> 32001. Igual ao calculo do workflow. */
export function versionCodeFor(versionName) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(String(versionName || '').trim());
  if (!m) return 0;
  const rc = m[4] === undefined ? 99 : Math.min(Number(m[4]), 98);
  return Number(m[1]) * 10000 + Number(m[2]) * 1000 + Number(m[3]) * 100 + rc;
}

const fail = (message, status) => json({ ok: false, error: message }, status);
const cache = () => globalThis.caches && globalThis.caches.default;

function githubHeaders(env, accept) {
  const headers = { Accept: accept, 'User-Agent': 'centro-custos-api', 'X-GitHub-Api-Version': '2022-11-28' };
  if (env.GITHUB_RELEASES_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_RELEASES_TOKEN}`;
  return headers;
}

// Com token, o asset sai pela API (serve repositorio privado); sem token, pelo link publico.
function assetRequest(env, asset) {
  return env.GITHUB_RELEASES_TOKEN
    ? [asset.url, { headers: githubHeaders(env, 'application/octet-stream'), redirect: 'follow' }]
    : [asset.browser_download_url, { headers: { 'User-Agent': 'centro-custos-api' }, redirect: 'follow' }];
}

async function readAsset(env, asset, limit = 20000) {
  if (!asset) return '';
  const [url, init] = assetRequest(env, asset);
  const response = await fetch(url, init);
  if (!response.ok) return '';
  return (await response.text()).replace(/^﻿/, '').slice(0, limit);
}

function plainNotes(text) {
  return String(text || '').replace(/\r/g, '').split('\n')
    .map((line) => line.replace(/^#+\s*/, '').replace(/^\s*[-*]\s+/, '- ').replace(/[*_`]/g, '').trimEnd())
    .join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1500);
}

const stamp = (release) => Date.parse(release.published_at || release.created_at || '') || 0;

/** Escolhe a release mais recente (por data) que tenha um APK; rascunhos nao entram. */
export function pickRelease(releases) {
  return (Array.isArray(releases) ? releases : [])
    .filter((r) => r && !r.draft && Array.isArray(r.assets) && r.assets.some((a) => /\.apk$/i.test(a.name || '')))
    .sort((a, b) => stamp(b) - stamp(a))[0] || null;
}

async function buildInfo(env, release) {
  const apk = release.assets.find((a) => /\.apk$/i.test(a.name));
  const meta = release.assets.find((a) => a.name === 'latest-android.json');
  const sidecar = release.assets.find((a) => a.name === `${apk.name}.sha256`);
  let info = {};
  try { info = JSON.parse(await readAsset(env, meta)) || {}; } catch { info = {}; }
  const versionName = String(info.versionName || release.tag_name || '').replace(/^v/i, '');
  let sha256 = String(info.sha256 || '').trim().toLowerCase();
  if (!SHA256.test(sha256)) sha256 = ((await readAsset(env, sidecar, 400)).match(/\b[0-9a-fA-F]{64}\b/) || [''])[0].toLowerCase();
  if (!SHA256.test(sha256)) sha256 = String(apk.digest || '').replace(/^sha256:/i, '').toLowerCase();
  if (!SHA256.test(sha256)) return null; // sem hash o app nao instala
  return {
    versionName,
    versionCode: Number(info.versionCode) > 0 ? Number(info.versionCode) : versionCodeFor(versionName),
    minVersionCode: Number(info.minVersionCode) > 0 ? Number(info.minVersionCode) : 0,
    sha256,
    size: Number(apk.size) || 0,
    notes: plainNotes(info.notes || release.body),
    publishedAt: release.published_at || release.created_at || null,
    asset: { url: apk.url, browser_download_url: apk.browser_download_url, name: apk.name },
  };
}

async function fetchLatest(env) {
  const response = await fetch(API, { headers: githubHeaders(env, 'application/vnd.github+json') });
  if (!response.ok) throw new Error(`GitHub ${response.status}`);
  const release = pickRelease(await response.json());
  if (!release) throw new Error('Nenhuma versão publicada.');
  const info = await buildInfo(env, release);
  if (!info || !info.versionCode) throw new Error('Versão sem verificação de integridade.');
  return info;
}

async function stored(key) {
  const c = cache();
  const hit = c ? await c.match(key) : null;
  return hit ? hit.json() : null;
}

async function save(info) {
  const c = cache();
  if (!c) return;
  const put = (key, seconds) => c.put(key, new Response(JSON.stringify(info), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${seconds}` } }));
  await Promise.all([put(FRESH_KEY, FRESH_SECONDS), put(STALE_KEY, STALE_SECONDS)]);
}

/** Cache curto; se o GitHub falhar, entrega a ultima copia boa em vez de derrubar a atualizacao. */
export async function loadLatest(env) {
  const fresh = await stored(FRESH_KEY);
  if (fresh) return fresh;
  try {
    const info = await fetchLatest(env);
    await save(info);
    return info;
  } catch (error) {
    const old = await stored(STALE_KEY);
    if (old) return old;
    throw error;
  }
}

export async function handleAndroidUpdate(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return fail('Método não permitido.', 405);
  let info;
  try { info = await loadLatest(env); } catch { return fail('Não foi possível consultar a versão mais nova agora.', 502); }

  if (url.pathname === '/v1/app/android/latest') {
    const body = {
      ok: true,
      versionName: info.versionName,
      versionCode: info.versionCode,
      minVersionCode: info.minVersionCode,
      sha256: info.sha256,
      size: info.size,
      notes: info.notes,
      publishedAt: info.publishedAt,
      apkUrl: `${url.origin}/v1/app/android/apk?v=${info.versionCode}`,
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' } });
  }

  let upstream = null;
  try { const [target, init] = assetRequest(env, info.asset); upstream = await fetch(target, init); } catch { upstream = null; }
  if (!upstream || !upstream.ok || !upstream.body) return fail('Não foi possível baixar o aplicativo agora.', 502);
  const headers = new Headers({
    'content-type': APK_TYPE,
    'content-disposition': `attachment; filename="${info.asset.name.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  const length = upstream.headers.get('content-length');
  if (length) headers.set('content-length', length);
  return new Response(request.method === 'HEAD' ? null : upstream.body, { status: 200, headers });
}
