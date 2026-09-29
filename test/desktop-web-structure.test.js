const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DDIR = path.join(ROOT, 'public', 'd');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

// Arquivos do app (a pasta vendor/ guarda os icones Phosphor de terceiros e fica de fora das regras de tamanho).
function arquivos(dir, base = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = path.posix.join(base, e.name);
    if (e.isDirectory()) return e.name === 'vendor' ? [] : arquivos(path.join(dir, e.name), rel);
    return /\.(js|css|html)$/.test(e.name) ? [rel] : [];
  });
}
const dFiles = arquivos(DDIR);
const src = (f) => fs.readFileSync(path.join(DDIR, f), 'utf8');

test('desktop novo: arquivos com até 350 linhas, sem emojis e sem glifos no lugar de ícones', () => {
  assert.ok(dFiles.length >= 10);
  for (const f of dFiles) {
    const source = src(f);
    assert.ok(source.split('\n').length <= 350, `${f} passou de 350 linhas`);
    assert.doesNotMatch(source, /\p{Extended_Pictographic}/u, `${f} tem emoji`);
    assert.doesNotMatch(source, /[←-⇿─-➿]/u, `${f} tem glifo Unicode no lugar de ícone`);
  }
});

test('desktop novo: sem alert, confirm e prompt do navegador', () => {
  for (const f of dFiles.filter((x) => x.endsWith('.js'))) {
    assert.doesNotMatch(src(f), /(?:^|[^.\w])(?:window\.)?(?:alert|confirm|prompt)\s*\(/m, `${f} usa diálogo do navegador`);
  }
});

test('desktop novo: fontes e ícones embutidos, sem CDN, e a página carrega todos os scripts', () => {
  const html = src('index.html');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  for (const ref of refs) {
    assert.doesNotMatch(ref, /^(?:https?:)?\/\//, `${ref} vem de fora`);
    assert.ok(fs.existsSync(path.join(DDIR, ref)), `${ref} não existe`);
  }
  for (const f of dFiles.filter((x) => x.endsWith('.js'))) assert.ok(refs.includes(f), `${f} não é carregado pelo index.html`);
  for (const f of dFiles.filter((x) => x.endsWith('.css'))) {
    assert.doesNotMatch(src(f), /url\(\s*['"]?(?:https?:)?\/\//, `${f} carrega algo de fora`);
    assert.ok(refs.includes(f), `${f} não é carregado pelo index.html`);
  }
  assert.ok(fs.existsSync(path.join(DDIR, 'vendor/phosphor/regular/Phosphor.woff2')));
  assert.ok(fs.existsSync(path.join(DDIR, 'vendor/phosphor/fill/Phosphor-Fill.woff2')));
  assert.match(src('css/tokens.css'), /url\(\.\.\/\.\.\/m\/fonts\/plex-400\.woff2\)/);
  for (const peso of [400, 500, 600, 700]) assert.ok(fs.existsSync(path.join(ROOT, `public/m/fonts/plex-${peso}.woff2`)));
});

test('desktop novo: reaproveita o núcleo do celular (sessão cc_token e centavos HALF_UP)', () => {
  const html = src('index.html');
  assert.ok(html.indexOf('../m/core.js') < html.indexOf('d-core.js'));
  assert.match(read('public/m/core.js'), /localStorage\.getItem\('cc_token'\)/);
  assert.match(read('public/m/core.js'), /Math\.round\(Math\.abs\(n\) \* 100 \+ 1e-7\)/);
});

test('desktop novo: menu esconde o que o papel não pode usar (regras de hoje)', () => {
  const core = src('d-core.js');
  assert.match(core, /cobrancas: \(\) => D\.corporativo\(\)/);
  assert.match(core, /recorrentes: \(\) => D\.papel\(\) === 'admin'/);
  assert.match(core, /usuarios: \(\) => D\.papel\(\) === 'admin'/);
  const shell = src('shell.js');
  assert.match(shell, /filter\(\(i\) => !i\[3\] \|\| D\.pode\(i\[3\]\)\)/);
  assert.match(src('telas/em-construcao.js'), /if \(!D\.podeTela\(rota\.nome\)\) return semAcesso\(el\)/);
  assert.doesNotMatch(shell, /sincroniza/i, 'a aba Sincronização saiu do menu (decisão 6)');
});

test('desktop novo: textos vindos da API passam por escape', () => {
  for (const f of dFiles.filter((x) => x.endsWith('.js'))) {
    const source = src(f);
    const raw = [...source.matchAll(/\$\{(?:l|o|r|u|data|item)\.(?:nome|name|descricao|favorecido|cliente|codigo|centro_nome|categoria|documento|observacao|email|titulo|sub)\b(?!\s*(?:\?|&&|\|\|))/g)];
    assert.equal(raw.length, 0, `${f} insere texto sem esc(): ${raw.map((m) => m[0]).join(', ')}`);
  }
});

test('servidor abre /d/ sem cache, ao lado do /m/', () => {
  const server = read('server.js');
  assert.match(server, /app\.get\(\['\/d', '\/d\/'\]/);
  assert.match(server, /path\.join\(publicDir, 'd', 'index\.html'\)/);
});

test('D1 Início: lançamento rápido com client_id e painel com 12 meses', () => {
  const rapido = src('telas/lancamento-rapido.js');
  assert.match(rapido, /clientId: CC\.uuid\(\)/);
  assert.match(rapido, /client_id: estado\.clientId/);
  assert.match(rapido, /CC\.parseMoney\(estado\.valor\)/);
  assert.match(rapido, /if \(enviando\) return;/);
  assert.match(rapido, /D\.painel\.abrir\(/);
  const inicio = src('telas/inicio.js');
  assert.match(inicio, /\/dashboard\/resumo\?mes=\$\{mes\}&meses=12/);
  assert.match(src('telas/inicio-blocos.js'), /cc_first_use_dismissed/);
  assert.match(src('telas/inicio-blocos.js'), /p > 1 \? 'estourado' : \(p > 0\.8 \? 'alerta' : 'normal'\)/);
});

test('D2 Lançamentos: sem loop de requisições, fila offline e client_id', () => {
  // O problema 2 do sistema atual vinha de observar a tabela; aqui nenhum arquivo observa o DOM.
  for (const f of dFiles.filter((x) => x.endsWith('.js'))) assert.doesNotMatch(src(f), /MutationObserver/, f);
  const filtros = src('telas/lancamentos-filtros.js');
  assert.match(filtros, /D\.debounce\(mudar, 300\)/);
  assert.match(src('index.html'), /<script src="\.\.\/m\/queue\.js"><\/script>/);
  const form = src('telas/lancamento-form.js');
  assert.match(form, /client_id: clientId/);
  assert.match(form, /CC\.queue\.add\(\{ client_id: clientId, payload: body \}\)/);
  assert.match(form, /revisao: Number\(l\.revision\)/);
  assert.match(form, /L\.abrir = async/);
  const lista = src('telas/lancamentos.js');
  assert.match(lista, /L\.soLeitura = \(l\) => !!\(l\.estorno_de \|\| l\.estornado \|\| L\.fechamento\(l\.data\)\)/);
  assert.match(lista, /const podeGerir = \(\) => D\.pode\('cadastrar'\)/);
  assert.match(src('telas/lancamento-acoes.js'), /motivo\.length < 5/);
});

test('D3a Obras: carteira, detalhe com abas, orçamento no formulário e revisão', () => {
  const form = src('telas/obra-form.js');
  assert.match(form, /name: 'orcamento'/);
  assert.match(form, /revisao: Number\(o\.revision\)/);
  const obra = src('telas/obra.js');
  assert.match(obra, /padStart\(2, '0'\)/, 'REV com dois dígitos (problema 9)');
  assert.match(obra, /D\.lanc\.formulario\(null, null, c\.id\)/);
  assert.match(obra, /obraFixa: obra\.id/);
  assert.match(src('telas/obras.js'), /portfolio-summary/);
  assert.match(src('telas/obra-nf.js'), /notas-fiscais\/\$\{n\.id\}\/arquivo/);
});

test('D3b Obras: medições, Curva S, relatório, importar e vincular', () => {
  const med = src('telas/obra-medicoes.js');
  assert.match(med, /type: 'labor'/);
  assert.match(med, /type: 'contract'/);
  assert.match(med, /centavos\(contrato\) - centavos\(medido\)/);
  assert.match(src('telas/obra-curva.js'), /\/curva-s/);
  assert.match(src('telas/obra-impressao.js'), /window\.print\(\)/);
  const imp = src('telas/obra-importar.js');
  assert.match(imp, /\/integracao\/orcamentos\/previas/);
  assert.match(imp, /hash: previa\.hash/);
  assert.match(imp, /allocationId: card\.dataset\.gasto/);
  assert.match(src('css/obras-ferramentas.css'), /@media print/);
});
