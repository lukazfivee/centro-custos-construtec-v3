const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const worker = path.join(__dirname, '..', 'cloudflare', 'center-container', 'androidUpdate.js');
const SHA = 'a'.repeat(64);
const SHA_SIDECAR = 'b'.repeat(64);
const TOKEN = 'ghp_segredo_que_nao_pode_vazar_0123456789';
const APK_BYTES = Buffer.from('conteudo-do-apk');

const asset = (name, extra = {}) => ({ name, url: `https://api.github.test/assets/${name}`, browser_download_url: `https://github.test/dl/${name}`, size: 15, ...extra });
const release = (tag, date, assets, extra = {}) => ({ tag_name: tag, published_at: date, draft: false, prerelease: true, body: `## ${tag}\n- **Novo**: item`, assets, ...extra });

function memoryCaches() {
  const store = new Map();
  return {
    default: {
      async match(key) { const hit = store.get(key); return hit ? new Response(hit) : undefined; },
      async put(key, response) { store.set(key, await response.text()); },
    },
    store,
  };
}

// Falso GitHub: lista de releases, arquivos pequenos e o APK.
function fakeGithub(releases, files = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} });
    const u = String(url);
    if (u.includes('/releases?')) return Response.json(releases);
    const name = decodeURIComponent(u.split('/').pop());
    if (name.endsWith('.apk')) return new Response(APK_BYTES, { headers: { 'content-length': String(APK_BYTES.length) } });
    return name in files ? new Response(files[name]) : new Response('nao achei', { status: 404 });
  };
  return calls;
}

async function load() {
  return import(pathToFileURL(worker).href + `?t=${Math.random()}`);
}

test('versionCode: rc soma ao 31000 e a versao final fica acima das rc', async () => {
  const { versionCodeFor } = await load();
  assert.equal(versionCodeFor('3.1.0-rc.19'), 31019);
  assert.equal(versionCodeFor('v3.1.0-rc.20'.replace(/^v/, '')), 31020);
  assert.equal(versionCodeFor('3.1.0'), 31099);
  assert.equal(versionCodeFor('3.2.0-rc.1'), 32001);
  assert.ok(versionCodeFor('3.1.0') > versionCodeFor('3.1.0-rc.98'));
  assert.equal(versionCodeFor('lixo'), 0);
});

test('latest: escolhe a release mais recente por data, com pre-lancamento, hash do json e rota do APK', async () => {
  const { handleAndroidUpdate, isAndroidUpdateRoute } = await load();
  const original = { fetch: globalThis.fetch, caches: globalThis.caches };
  globalThis.caches = memoryCaches();
  try {
    const meta = JSON.stringify({ versionName: '3.1.0-rc.21', versionCode: 31021, sha256: SHA, notes: 'Atualização pelo app.', minVersionCode: 31019 });
    fakeGithub([
      release('v3.1.0-rc.19', '2026-09-27T10:00:00Z', [asset('Centro-de-Custos-Construtec-Android-3.1.0-rc.19.apk')]),
      release('v3.1.0-rc.21', '2026-10-09T10:00:00Z', [asset('Centro-de-Custos-Construtec-Android-3.1.0-rc.21.apk'), asset('latest-android.json')]),
      release('v3.1.0-rc.20', '2026-10-06T10:00:00Z', [asset('Centro-de-Custos-Construtec-Android-3.1.0-rc.20.apk')]),
      release('v9.9.9', '2026-12-01T10:00:00Z', [asset('so-instalador.exe')]),
      release('v8.0.0', '2026-12-02T10:00:00Z', [asset('x.apk')], { draft: true }),
    ], { 'latest-android.json': meta });
    assert.equal(isAndroidUpdateRoute('/v1/app/android/latest'), true);
    assert.equal(isAndroidUpdateRoute('/v1/app/android/outra'), false);

    const url = new URL('https://centro.test/v1/app/android/latest');
    const response = await handleAndroidUpdate(new Request(url), {}, url);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(
      { ok: data.ok, name: data.versionName, code: data.versionCode, sha: data.sha256, min: data.minVersionCode, notes: data.notes },
      { ok: true, name: '3.1.0-rc.21', code: 31021, sha: SHA, min: 31019, notes: 'Atualização pelo app.' },
    );
    assert.equal(data.apkUrl, 'https://centro.test/v1/app/android/apk?v=31021');
  } finally { Object.assign(globalThis, original); }
});

test('latest: sem json usa o .sha256 ao lado do APK, deriva o codigo da tag e limpa as notas', async () => {
  const { handleAndroidUpdate } = await load();
  const original = { fetch: globalThis.fetch, caches: globalThis.caches };
  globalThis.caches = memoryCaches();
  try {
    const name = 'Centro-de-Custos-Construtec-Android-3.1.0-rc.20.apk';
    fakeGithub([release('v3.1.0-rc.20', '2026-10-06T10:00:00Z', [asset(name), asset(`${name}.sha256`)])], { [`${name}.sha256`]: `﻿${SHA_SIDECAR}  ${name}\n` });
    const url = new URL('https://centro.test/v1/app/android/latest');
    const data = await (await handleAndroidUpdate(new Request(url), {}, url)).json();
    assert.equal(data.sha256, SHA_SIDECAR);
    assert.equal(data.versionCode, 31020);
    assert.equal(data.versionName, '3.1.0-rc.20');
    assert.equal(data.notes, 'v3.1.0-rc.20\n- Novo: item');
  } finally { Object.assign(globalThis, original); }
});

test('latest: sem nenhum hash a versao nao e oferecida (o app nunca instala sem conferir)', async () => {
  const { handleAndroidUpdate } = await load();
  const original = { fetch: globalThis.fetch, caches: globalThis.caches };
  globalThis.caches = memoryCaches();
  try {
    fakeGithub([release('v3.1.0-rc.20', '2026-10-06T10:00:00Z', [asset('app.apk')])]);
    const url = new URL('https://centro.test/v1/app/android/latest');
    const response = await handleAndroidUpdate(new Request(url), {}, url);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).ok, false);
    // O digest que o proprio GitHub calcula tambem vale.
    fakeGithub([release('v3.1.0-rc.20', '2026-10-06T10:00:00Z', [asset('app.apk', { digest: `sha256:${SHA.toUpperCase()}` })])]);
    const ok = await (await handleAndroidUpdate(new Request(url), {}, url)).json();
    assert.equal(ok.sha256, SHA);
  } finally { Object.assign(globalThis, original); }
});

test('cache curto: a segunda consulta nao vai ao GitHub e, se ele cair, vale a ultima copia boa', async () => {
  const { handleAndroidUpdate } = await load();
  const original = { fetch: globalThis.fetch, caches: globalThis.caches };
  const caches = memoryCaches();
  globalThis.caches = caches;
  try {
    const calls = fakeGithub([release('v3.1.0-rc.20', '2026-10-06T10:00:00Z', [asset('app.apk', { digest: `sha256:${SHA}` })])]);
    const url = new URL('https://centro.test/v1/app/android/latest');
    const ask = () => handleAndroidUpdate(new Request(url), {}, url);
    await ask(); await ask(); await ask();
    assert.equal(calls.filter((c) => c.url.includes('/releases?')).length, 1);

    caches.store.delete('https://cache.internal/android-update/fresh'); // expirou
    globalThis.fetch = async () => new Response('limite', { status: 403 });
    const stale = await ask();
    assert.equal(stale.status, 200);
    assert.equal((await stale.json()).versionCode, 31020);

    caches.store.clear();
    assert.equal((await ask()).status, 502, 'sem copia e sem GitHub: erro claro');
  } finally { Object.assign(globalThis, original); }
});

test('apk: entrega o arquivo da release mais nova; o token fica so no pedido ao GitHub, nunca na resposta', async () => {
  const { handleAndroidUpdate } = await load();
  const original = { fetch: globalThis.fetch, caches: globalThis.caches };
  globalThis.caches = memoryCaches();
  try {
    const calls = fakeGithub([release('v3.1.0-rc.20', '2026-10-06T10:00:00Z', [asset('Suite App.apk', { digest: `sha256:${SHA}` })])]);
    const env = { GITHUB_RELEASES_TOKEN: TOKEN };

    const latestUrl = new URL('https://centro.test/v1/app/android/latest');
    const latest = await handleAndroidUpdate(new Request(latestUrl), env, latestUrl);
    const latestText = await latest.text();
    assert.ok(!latestText.includes(TOKEN), 'latest nao vaza o token');
    assert.ok(![...latest.headers.values()].some((v) => v.includes(TOKEN)));
    assert.ok(!latestText.includes('api.github.test'), 'o app so conhece o endereco do Worker');

    const apkUrl = new URL('https://centro.test/v1/app/android/apk?v=31020');
    const apk = await handleAndroidUpdate(new Request(apkUrl), env, apkUrl);
    assert.equal(apk.status, 200);
    assert.equal(apk.headers.get('content-type'), 'application/vnd.android.package-archive');
    assert.equal(apk.headers.get('content-length'), String(APK_BYTES.length));
    assert.match(apk.headers.get('content-disposition'), /filename="Suite_App\.apk"/);
    assert.ok(![...apk.headers.values()].some((v) => v.includes(TOKEN)));
    assert.deepEqual(Buffer.from(await apk.arrayBuffer()), APK_BYTES);

    // O token vai ao GitHub (API do asset), e so a ele.
    const toGithub = calls.filter((c) => c.headers.Authorization);
    assert.ok(toGithub.length >= 2);
    assert.ok(toGithub.every((c) => c.headers.Authorization === `Bearer ${TOKEN}` && /^https:\/\/api\.github\.(test|com)\//.test(c.url)));

    // Sem token: link publico, sem cabecalho de autorizacao.
    globalThis.caches = memoryCaches();
    const before = calls.length;
    await handleAndroidUpdate(new Request(apkUrl), {}, apkUrl);
    assert.ok(calls.slice(before).every((c) => !c.headers.Authorization));
    assert.ok(calls.slice(before).some((c) => c.url === 'https://github.test/dl/Suite App.apk'));
  } finally { Object.assign(globalThis, original); }
});

test('rotas so aceitam leitura e a integracao no index do Worker existe', async () => {
  const { handleAndroidUpdate } = await load();
  const url = new URL('https://centro.test/v1/app/android/latest');
  assert.equal((await handleAndroidUpdate(new Request(url, { method: 'POST' }), {}, url)).status, 405);
  const index = require('node:fs').readFileSync(path.join(__dirname, '..', 'cloudflare', 'center-container', 'index.js'), 'utf8');
  assert.match(index, /isAndroidUpdateRoute\(url\.pathname\)\) return handleAndroidUpdate\(request, env, url\)/);
  assert.ok(index.indexOf('isAndroidUpdateRoute(url.pathname)') < index.indexOf("url.pathname.startsWith('/v1/')"), 'antes da rota geral /v1/');
});
