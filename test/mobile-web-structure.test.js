const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const M = path.join(ROOT, 'public', 'm');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const mFiles = fs.readdirSync(M).filter((f) => /\.(js|css|html)$/.test(f));

test('site do celular: arquivos com até 350 linhas e sem emojis', () => {
  for (const f of mFiles) {
    const source = fs.readFileSync(path.join(M, f), 'utf8');
    assert.ok(source.split('\n').length <= 350, `${f} passou de 350 linhas`);
    assert.doesNotMatch(source, /\p{Extended_Pictographic}/u, `${f} tem emoji`);
  }
});

test('service worker guarda todos os arquivos carregados pela página e nunca a API', () => {
  const html = read('public/m/index.html');
  const sw = read('public/m/sw.js');
  const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  for (const asset of assets) assert.ok(sw.includes(`'${asset}'`), `${asset} fora do cache do service worker`);
  for (const f of mFiles.filter((x) => x !== 'sw.js')) assert.ok(sw.includes(`'${f}'`), `${f} fora do cache`);
  assert.match(sw, /url\.pathname\.startsWith\('\/m\/'\)/);
  assert.doesNotMatch(sw, /\/api\//);
});

test('fila no IndexedDB com client_id; foto reduzida; câmera traseira', () => {
  const queue = read('public/m/queue.js');
  const lancar = read('public/m/screen-lancar.js');
  assert.match(queue, /indexedDB\.open\('cc-celular'/);
  assert.match(queue, /client_id: item\.client_id/);
  assert.match(queue, /error\.status !== 409/);
  assert.doesNotMatch(queue, /localStorage/);
  assert.match(lancar, /capture="environment"/);
  assert.match(lancar, /toDataURL\('image\/jpeg', 0\.72\)/);
  assert.match(lancar, /1600 \/ Math\.max/);
  assert.match(read('public/m/core.js'), /Math\.round\(Math\.abs\(n\) \* 100 \+ 1e-7\)/);
});

test('textos da tela passam por escape (sem HTML vindo da API)', () => {
  for (const f of mFiles.filter((x) => x.startsWith('screen-'))) {
    const source = fs.readFileSync(path.join(M, f), 'utf8');
    const raw = [...source.matchAll(/\$\{(?:c|t|i|p|item|dash|user)\.(?:nome|descricao|favorecido|cliente|erro|obra_nome|email)\b(?!\s*(?:\?|&&|\|\|))/g)];
    assert.equal(raw.length, 0, `${f} insere texto da API sem esc(): ${raw.map((m) => m[0]).join(', ')}`);
  }
});

test('servidor abre /m/ e o app Android usa o site do celular', () => {
  const server = read('server.js');
  assert.match(server, /app\.get\(\['\/m', '\/m\/'\]/);
  assert.match(server, /path\.join\(publicDir, 'm', 'index\.html'\)/);
  const main = read('android/app/src/main/java/br/com/rcconstrutec/centrocustos/MainActivity.java');
  assert.match(main, /"\/m\/#handoff="/);
  assert.match(main, /SuiteConstrutec\//);
  assert.doesNotMatch(main, /addMenuButton/);
  const web = read('android/app/src/main/java/br/com/rcconstrutec/centrocustos/AppWebView.java');
  assert.match(web, /"suite"\.equals\(target\.getScheme\(\)\)/);
  const bridge = read('android/app/src/main/java/br/com/rcconstrutec/centrocustos/AuthBridge.java');
  assert.match(bridge, /"seguranca"\.equals\(action\) && auth\.unlocked\(\)/);
  assert.match(read('public/m/screen-misc.js'), /suite:\/\/seguranca/);
});
