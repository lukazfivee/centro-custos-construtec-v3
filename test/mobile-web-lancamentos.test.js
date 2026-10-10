// Celular igual ao desktop nos lancamentos: detalhe, pagar, editar, estornar, excluir, documentos,
// receita, filtros da lista, alterar senha e "Versao completa" que abre o /d/.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', 'm', file), 'utf8');

test('celular: detalhe do lancamento usa as mesmas rotas do desktop', () => {
  const lanc = read('screen-lanc.js');
  assert.match(lanc, /CC\.cached\(`lanc-\$\{id\}`, `\/lancamentos\/\$\{id\}`\)/);
  assert.match(lanc, /`\/lancamentos\/\$\{l\.id\}`, \{ method: 'PUT'/);
  assert.match(lanc, /revisao: Number\(l\.revision\)/); // o servidor recusa edicao sem a revisao atual
  assert.match(lanc, /`\/lancamentos\/\$\{l\.id\}\/estornar`, \{ method: 'POST', body: \{ motivo, data_estorno: data \} \}/);
  assert.match(lanc, /`\/lancamentos\/\$\{l\.id\}`, \{ method: 'DELETE' \}/);
  assert.match(lanc, /'\/fechamento-mensal'/);
  // Estorno, estornado ou mes fechado ficam so para leitura.
  assert.match(lanc, /const soLeitura = \(l\) => !!\(l\.estorno_de \|\| l\.estornado \|\| CC\.lanc\.fechado\(l\.data\)\)/);
  assert.match(lanc, /can\('p4'\) && l\.status_financeiro === 'liquidado'/);
  const docs = read('screen-lanc-docs.js');
  assert.match(docs, /`\/anexos\/lancamento\/\$\{l\.id\}`, \{ method: 'POST', body \}/);
  assert.match(docs, /`\/anexos\/\$\{doc\.id\}`, \{ method: 'DELETE' \}/);
  assert.match(docs, /8 \* 1024 \* 1024/);
});

test('celular: lancar receita, editar e campos de pagamento', () => {
  const lancar = read('screen-lancar.js');
  assert.match(lancar, /data-tipo="receita"/);
  assert.match(lancar, /tipo: d\.tipo, cost_center_id/);
  assert.match(lancar, /forma_pagamento: paid \?/);
  assert.match(lancar, /observacao: d\.observacao\.trim\(\) \|\| null/);
  assert.match(lancar, /list="f-forn-lista"/);
  assert.match(lancar, /`\/lancamentos\/\$\{d\.id\}`, \{ method: 'PUT', body: \{ \.\.\.payload, revisao: d\.revisao \} \}/);
  assert.match(lancar, /CC\.lanc\.fechado\(d\.data\)/);
  assert.doesNotMatch(lancar, /tipo: 'despesa', cost_center_id/);
});

test('celular: lista de lancamentos com mes, busca, tipo, pagos, total e carregar mais', () => {
  const lista = read('screen-lancamentos.js');
  for (const k of ['&situacao=', '&tipo=', '&busca=', '&pagina=', '&mes=']) assert.ok(lista.includes(k), k);
  assert.match(lista, /\['liquidado', 'Pagos'\]/);
  assert.match(lista, /totalLiquido/);
  assert.match(lista, /id="l-mais"/);
  assert.match(lista, /CC\.wireTx\(page/);
  // As contas vencidas do Inicio somam todos os meses: a lista abre sem filtro de mes.
  assert.match(read('screen-home.js'), /\['lancamentos', \{ situacao: 'vencido', mes: '' \}\]/);
  assert.match(read('screen-obra.js'), /data-tx="\$\{Number\(t\.id\)\}"/);
});

test('celular: alterar senha sem derrubar a sessao e versao completa no /d/', () => {
  const perfil = read('screen-perfil.js');
  assert.match(perfil, /fetch\('\/api\/auth\/alterar-senha'/);
  assert.doesNotMatch(perfil, /CC\.api\('\/auth\/alterar-senha'/); // 401 de senha errada nao pode deslogar
  const menu = read('screen-misc.js');
  assert.match(menu, /href="\/d\/" id="m-web"/);
  assert.doesNotMatch(menu, /href="\/" id="m-web"/); // a raiz manda celular de volta para /m/
  assert.match(menu, /CC\.senhaSheet\(\)/);
});
