const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Assistente de IA no desktop (/d/): reaproveita config, ferramentas e conversa do celular (public/m)
// e troca destinos de tela, instruções e nome da tela. Garantias de carga, de destinos e de estilo.
const PUBLIC = path.join(__dirname, '..', 'public');
const read = (rel) => fs.readFileSync(path.join(PUBLIC, rel), 'utf8');

function load({ electron } = {}) {
  const went = [];
  const opened = [];
  const switched = [];
  const location = { href: '', search: '' };
  const D = {
    lerRota: () => ({ nome: 'obras' }), ir: (caminho) => went.push(caminho),
    podeTela: (chave) => chave !== 'usuarios', papelNome: () => 'Gestor',
  };
  const CC = {
    d: D, cents: (v) => Math.round(v * 100) / 100, api: async () => ({ data: {} }), month: () => '2026-10', go: () => {},
    session: { user: () => ({ nome: 'Ana Teste', role: 'gestor' }) }, suite: { orcLink: () => '' },
  };
  const window = { CC, open: (...a) => opened.push(a), ...(electron ? { electronAPI: { suiteSwitch: (...a) => switched.push(a) } } : {}) };
  const context = { window, navigator: { userAgent: 'Mozilla' }, location, URLSearchParams, JSON, Number, String, Object, Math, encodeURIComponent };
  vm.runInNewContext(read('m/ia-tools.js'), context);
  vm.runInNewContext(read('d/ia-desktop.js'), context);
  return { CC, went, opened, switched };
}

test('desktop: página carrega o assistente do celular e o adaptador, antes do app.js, com o estilo próprio', () => {
  const html = read('d/index.html');
  const order = ['../m/ia-config.js', '../m/ia-tools.js', '../m/ia-chat.js', 'ia-desktop.js', 'app.js'].map((f) => html.indexOf(`<script src="${f}">`));
  assert.ok(order.every((i) => i > 0) && [...order].sort((a, b) => a - b).join() === order.join(), 'ordem dos scripts');
  assert.ok(html.indexOf('telas/reports.js') < order[0], 'depois das telas');
  assert.match(html, /<link rel="stylesheet" href="css\/ia\.css">/);
  for (const ref of ['m/ia-config.js', 'm/ia-tools.js', 'm/ia-chat.js', 'd/ia-desktop.js', 'd/css/ia.css']) assert.ok(fs.existsSync(path.join(PUBLIC, ref)), ref);
});

test('desktop: botão flutuante fica abaixo de painéis e diálogos e sai quando eles abrem', () => {
  const css = read('d/css/ia.css');
  assert.match(css, /\.ia-fab \{[^}]*position: fixed;[^}]*z-index: 40;/);
  assert.match(css, /body:has\(\.camada, \.dialogo-camada, \.impressao\) \.ia-fab \{ display: none; \}/);
  assert.match(css, /#ia-sheet \{[^}]*pointer-events: none;/);
  const base = read('d/css/componentes.css');
  assert.match(base, /\.camada \{[^}]*z-index: 50;/);
  assert.match(base, /\.dialogo-camada \{[^}]*z-index: 60;/);
  // O JS do celular aceita o desktop (#app no lugar de #view) e só liga o App Check em https de verdade.
  const chat = read('m/ia-chat.js');
  assert.match(chat, /document\.getElementById\('view'\) \|\| document\.getElementById\('app'\)/);
  assert.match(chat, /const secureOrigin = \(\) => location\.protocol === 'https:'/);
});

test('desktop: destinos de tela são os do desktop e respeitam o papel', async () => {
  const { CC, went, opened } = load();
  const S = new Proxy({}, { get: (_, kind) => (spec) => ({ kind, ...spec }) });
  const enumTela = CC.ia.declarations(S)[0].functionDeclarations.find((d) => d.name === 'abrir_tela').parameters.properties.tela.enum;
  assert.deepEqual([...enumTela].sort(), ['categorias', 'cobrancas', 'configuracoes', 'fechamento', 'fornecedores', 'historico', 'inicio', 'lancamentos', 'nova_despesa', 'obra', 'obras',
    'orcamentos', 'proposta', 'recorrentes', 'reports', 'usuarios'].sort());

  assert.equal((await CC.ia.run({ name: 'abrir_tela', args: { tela: 'obra', obra_id: 7 } })).ok, true);
  assert.equal(went.length, 0, 'nada muda antes da resposta');
  CC.ia.pendingNav();
  assert.deepEqual(went, ['obras/7']);
  await CC.ia.run({ name: 'abrir_tela', args: { tela: 'nova_despesa' } });
  CC.ia.pendingNav();
  assert.equal(went.at(-1), 'lancamentos?novo=1');
  await CC.ia.run({ name: 'abrir_tela', args: { tela: 'configuracoes' } });
  CC.ia.pendingNav();
  assert.equal(went.at(-1), 'config');
  assert.ok((await CC.ia.run({ name: 'abrir_tela', args: { tela: 'usuarios' } })).erro, 'papel sem acesso');
  assert.ok((await CC.ia.run({ name: 'abrir_tela', args: { tela: 'obra' } })).erro, 'sem obra_id');
  assert.ok((await CC.ia.run({ name: 'abrir_tela', args: { tela: 'seguranca' } })).erro, 'tela do celular não existe aqui');
  assert.ok((await CC.ia.run({ name: 'abrir_tela', args: { tela: 'proposta', proposta_id: '../x' } })).erro, 'id inválido');

  // Sem o app Windows, o Orçamentos abre em outra aba, já na proposta.
  await CC.ia.run({ name: 'abrir_tela', args: { tela: 'proposta', proposta_id: 'p-1' } });
  CC.ia.pendingNav();
  assert.equal(opened.length, 1);
  assert.match(opened[0][0], /^https:\/\/construtec-orcamentos-cloud\.construtec-reports\.workers\.dev\/#proposta=p-1$/);
});

test('desktop: no app Windows o Orçamentos é a outra tela da mesma janela', async () => {
  const { CC, switched, opened } = load({ electron: true });
  await CC.ia.run({ name: 'abrir_tela', args: { tela: 'proposta', proposta_id: 'p-1' } });
  CC.ia.pendingNav();
  await CC.ia.run({ name: 'abrir_tela', args: { tela: 'orcamentos' } });
  CC.ia.pendingNav();
  assert.deepEqual(switched, [['orcamentos', 'proposta=p-1'], ['orcamentos', undefined]]);
  assert.equal(opened.length, 0);
});

test('desktop: instruções falam do computador e da tela aberta', () => {
  const { CC } = load();
  assert.equal(CC.current(), 'obras');
  const prompt = CC.iaPrompt();
  assert.match(prompt, /Tela aberta agora: Obras\./);
  assert.match(prompt, /papel Gestor/);
  assert.match(prompt, /Centro de Custos do computador/);
  assert.doesNotMatch(prompt, /celular|barra de abas|Lançar \(botão/);
  // As sugestões do celular (foto da nota) saem; o desktop põe as dele.
  assert.match(read('m/ia-chat.js'), /IA\.sugestoes = SUGESTOES;/);
  assert.match(read('d/ia-desktop.js'), /IA\.sugestoes\.splice\(0, IA\.sugestoes\.length,[^)]*Como crio um novo lançamento\?/);
});
