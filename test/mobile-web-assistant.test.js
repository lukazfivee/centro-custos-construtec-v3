const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Assistente do celular (Firebase AI Logic): garantias do código e das ferramentas.
const M = path.join(__dirname, '..', 'public', 'm');
const read = (f) => fs.readFileSync(path.join(M, f), 'utf8');

function loadTools(apiImpl) {
  const location = { href: '', search: '' };
  const CC = { cents: (v) => Math.round(v * 100) / 100, month: () => '2026-09', api: apiImpl, go: (...a) => { CC.went = a; }, suite: { orcLink: (id) => `suite://app/orcamentos${id ? `?proposta=${id}` : ''}` } };
  const context = { window: { CC }, navigator: { userAgent: 'SuiteConstrutec/3.1.0' }, location, URLSearchParams, JSON, Number, String, Object, Math };
  vm.runInNewContext(read('ia-tools.js'), context);
  return { CC, location };
}

test('assistente: SDK do Firebase em segundo plano, com App Check, sem chave de API do Gemini no código', () => {
  const chat = read('ia-chat.js');
  const config = read('ia-config.js');
  assert.match(chat, /import\(`\$\{base\}firebase-ai\.js`\)/);
  assert.match(chat, /new ai\.GoogleAIBackend\(\)/);
  assert.match(config, /https:\/\/www\.gstatic\.com\/firebasejs\/\d+\.\d+\.\d+\//);
  assert.doesNotMatch(chat + config + read('ia-tools.js'), /generativelanguage\.googleapis|x-goog-api-key|localStorage|indexedDB/);
  // App Check (reCAPTCHA v3) antes de usar o Gemini, só quando a chave do site existe.
  assert.match(chat, /if \(CC\.iaConfig\.recaptcha\) \{[\s\S]*new check\.ReCaptchaV3Provider\(CC\.iaConfig\.recaptcha\)[\s\S]*\}\s*return \{ ai, backend: ai\.getAI/);
  // Pré-carga só com sessão; resposta em streaming, sem repetir depois de texto parcial.
  assert.match(chat, /if \(CC\.session\.token\(\)\) IA\.warm\(\)/);
  assert.match(chat, /sendMessageStream\(content\)/);
  assert.match(chat, /if \(state\.live \|\| \(!quota\(error\) && !busy\(error\)\)\) throw error;/);
  // Sem configuração web do Firebase, o botão não aparece.
  assert.match(chat, /IA\.ready = \(\) => Boolean\(CC\.iaConfig && CC\.iaConfig\.firebase\)/);
  assert.match(read('screen-home.js'), /CC\.iaBtn \? CC\.iaBtn\(\) : ''/);
  // Texto do modelo passa por esc() antes de virar HTML.
  assert.match(chat, /const inline = \(s\) => esc\(s\)/);
  // A conversa some ao sair e quando a sessão cai.
  assert.match(read('screen-misc.js'), /CC\.ia\.reset\(\);\r?\n\s+CC\.session\.clear\(\)/);
  assert.match(read('app.js'), /CC\.ia\.reset\(\); signedOut/);
});

test('assistente: relato só vai para o servidor pelo botão Enviar', () => {
  const chat = read('ia-chat.js');
  assert.equal((chat.match(/CC\.api\('\/bug-reports'/g) || []).length, 1);
  assert.match(chat, /form\.addEventListener\('submit'/);
  assert.doesNotMatch(read('ia-tools.js'), /bug-reports/);
});

test('assistente: ferramentas resumem os dados e navegam depois da resposta', async () => {
  const seen = [];
  const { CC, location } = loadTools(async (p) => {
    seen.push(p);
    if (p.startsWith('/centros-custo?')) return { data: [{ id: 7, codigo: 'OB-7', nome: 'Hospital Sao Lucas', orcamento: '1000', total_comprometido: '1200.555', total_despesas: '900', total_receitas: '1500', ativo: true }, { id: 8, codigo: 'OB-8', nome: 'Escola', orcamento: 0, total_comprometido: 10 }] };
    if (p.startsWith('/lancamentos?')) return { data: { itens: [{ id: 1, tipo: 'despesa', descricao: 'Cimento', valor: '10.10' }, { id: 2, tipo: 'despesa', descricao: 'Areia', valor: '5.05' }], paginacao: { total: 40 } } };
    const error = new Error('Você não tem permissão para esta ação.'); error.status = 403; throw error;
  });
  const obras = await CC.ia.run({ name: 'listar_obras', args: { busca: 'são lucas' } });
  assert.equal(obras.total, 1);
  assert.equal(obras.obras[0].pct_do_orcado, 120);
  assert.equal(obras.obras[0].acima_do_orcado, true);
  assert.equal(obras.obras[0].gasto_comprometido, 1200.56);

  const lanc = await CC.ia.run({ name: 'buscar_lancamentos', args: { obra_id: 7, situacao: 'pago', mes: '2026-08' } });
  assert.equal(lanc.total, 40);
  assert.equal(lanc.soma_mostrados, 15.15);
  assert.match(seen.at(-1), /centroId=7/);
  assert.doesNotMatch(seen.at(-1), /situacao=/, 'situação fora da lista não vai para a API');
  assert.match(seen.at(-1), /mes=2026-08/);

  const erro = await CC.ia.run({ name: 'resumo_geral', args: {} });
  assert.deepEqual({ ...erro }, { erro: 'Você não tem permissão para esta ação.' });
  assert.equal((await CC.ia.run({ name: 'apagar_tudo', args: {} })).erro, 'Ferramenta desconhecida.');

  // Navegação: nada muda antes da resposta; a ação fica guardada.
  const nav = await CC.ia.run({ name: 'abrir_tela', args: { tela: 'obra', obra_id: 7 } });
  assert.equal(nav.ok, true);
  assert.equal(CC.went, undefined);
  CC.ia.pendingNav();
  assert.equal(JSON.stringify(CC.went), JSON.stringify(['obra', { id: 7 }]));
  assert.ok((await CC.ia.run({ name: 'abrir_tela', args: { tela: 'obra' } })).erro);
  assert.ok((await CC.ia.run({ name: 'abrir_tela', args: { tela: 'pedidos_acesso' } })).erro, 'pedidos só para admin');
  await CC.ia.run({ name: 'abrir_tela', args: { tela: 'proposta', proposta_id: 'p1' } });
  CC.ia.pendingNav();
  assert.equal(location.href, 'suite://app/orcamentos?proposta=p1');
});

test('assistente: declarações cobrem todas as ferramentas', () => {
  const { CC } = loadTools(async () => ({ data: {} }));
  const S = new Proxy({}, { get: (_, kind) => (spec) => ({ kind, ...spec }) });
  const names = [...CC.ia.declarations(S)[0].functionDeclarations].map((d) => d.name).sort();
  const source = read('ia-tools.js');
  const runs = [...source.slice(source.indexOf('const RUN = {'), source.indexOf('IA.run =')).matchAll(/^ {4}async (\w+)\(/gm)].map((m) => m[1]).sort();
  assert.deepEqual(names, runs);
});
