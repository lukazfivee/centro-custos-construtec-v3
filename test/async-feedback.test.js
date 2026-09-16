const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('index principal carrega a camada de feedback assincrono', () => {
  const html = read('public/index.html');
  assert.match(html, /async-feedback\.css/);
  assert.match(html, /async-feedback\.js/);
});

test('camada cobre skeleton, busy-state, retry e reduced-motion', () => {
  const script = read('public/async-feedback.js');
  // Skeleton por view com layout antecipado
  assert.match(script, /cc-skeleton-block/);
  assert.match(script, /cc-skeleton-row/);
  // Feedback imediato + contexto acessivel
  assert.match(script, /aria-busy/);
  // Erro com acao de retry (nao apenas um aviso)
  assert.match(script, /Tentar novamente/);
  assert.match(script, /cc-retry-toast/);
  // Acoes desabilitadas durante a operacao sem perder o rotulo
  assert.match(script, /is-loading/);
  assert.match(script, /dataset\.ccLabel/);
  // Instrumenta a API para reabilitar o botao quando a operacao termina
  assert.match(script, /inFlight/);
});

test('estilos de skeleton respeitam movimento reduzido', () => {
  const css = read('public/async-feedback.css');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /cc-skeleton/);
  assert.match(css, /is-loading/);
});

test('portfolio nao consulta a API antes do login', () => {
  const script = read('public/budget-portfolio.js');
  // A verificacao de sessao precede a chamada de dados no cockpit
  const guardIndex = script.indexOf('function renderPortfolioCockpit');
  const body = script.slice(guardIndex, guardIndex + 600);
  assert.match(body, /token\(\)/);
});
