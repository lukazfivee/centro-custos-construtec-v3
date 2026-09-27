const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const J = 'android/app/src/main/java/br/com/rcconstrutec/centrocustos/';

// Fase 4: garantias estaticas do push no app Android.
test('app registra o token do Firebase e o toque abre o destino validado', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android\.permission\.POST_NOTIFICATIONS/);
  assert.match(manifest, /<service android:name="\.SuitePush" android:exported="false">/);
  assert.match(manifest, /com\.google\.firebase\.MESSAGING_EVENT/);
  const push = read(`${J}SuitePush.java`);
  assert.match(push, /extends FirebaseMessagingService/);
  assert.match(push, /auth\.api\.registerPush\(session, token\)/);
  assert.match(push, /SuiteViews\.parse\(link\)/);
  assert.match(push, /PendingIntent\.FLAG_IMMUTABLE/);
  assert.match(read(`${J}CentralApi.java`), /"\/v1\/push\/register"/);
  assert.match(read(`${J}AuthBridge.java`), /SuitePush\.onEnter\(activity, auth, worker\)/);
  const main = read(`${J}MainActivity.java`);
  assert.match(main, /pushTarget = SuitePush\.target\(getIntent\(\)\)/);
  const gradle = read('android/app/build.gradle');
  assert.match(gradle, /com\.google\.gms\.google-services/);
  assert.match(gradle, /firebase-messaging/);
  const services = JSON.parse(read('android/app/google-services.json'));
  assert.ok(services.client.some((c) => c.client_info.android_client_info.package_name === 'br.com.rcconstrutec.centrocustos'));
  assert.match(read('android/gradle.properties'), /android\.useAndroidX=true/);
});

test('site do celular tem o sino e a central de notificacoes', () => {
  const avisos = read('public/m/screen-avisos.js');
  assert.match(avisos, /CC\.screens\.avisos = async function/);
  assert.match(avisos, /\/notificacoes\/teste/);
  assert.match(read('public/m/screen-home.js'), /CC\.bellBtn/);
  assert.match(read('public/m/icons.js'), /"bell":/);
  assert.match(read('cloudflare/center-container/wrangler.jsonc'), /"crons": \["0 11 \* \* \*"\]/);
  assert.match(read('cloudflare/center-container/index.js'), /url\.pathname\.startsWith\('\/api\/interno\/'\)/);
});
