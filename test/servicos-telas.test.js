const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Servicos curtos no desktop /d/ (Rodada 28D): lista, novo/editar, detalhe, lancar despesa, concluir, faturar e relatorio.
const ler = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const ARQUIVOS = ['servico-base', 'servico-blocos', 'servico-form', 'servico-gasto', 'servico-acoes', 'servico'].map((n) => `public/d/telas/${n}.js`);

test('servicos: arquivos carregados no index, ate 350 linhas e sem emojis', () => {
  const index = ler('public/d/index.html');
  assert.match(index, /css\/servicos\.css/);
  let ultimo = index.indexOf('telas/obra-importar.js');
  for (const rel of ARQUIVOS) {
    const pos = index.indexOf(rel.replace('public/d/', ''));
    assert.ok(pos > ultimo, `${rel} no index, na ordem`);
    ultimo = pos;
  }
  assert.ok(index.indexOf('telas/lancamentos.js') < index.indexOf('telas/servico.js'), 'servico.js depois de lancamentos.js (encadeia onQueueSent)');
  for (const rel of [...ARQUIVOS, 'public/d/css/servicos.css', 'public/d/telas/obras.js']) {
    const txt = ler(rel);
    assert.ok(txt.split('\n').length <= 350, `${rel} passa de 350 linhas`);
    assert.doesNotMatch(txt, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, `${rel} tem emoji`);
  }
});

test('lista: Novo em qualquer aba, filtro por situacao, Todos na mesma grade e servico abre na rota propria', () => {
  const obras = ler('public/d/telas/obras.js');
  assert.match(obras, /data-nova>\$\{D\.ic\('plus'\)\}Novo</);
  assert.match(obras, /D\.serv\.novo\(tipo === 'servico' \? 'servico' : 'obra'/);
  assert.match(obras, /\['em_andamento', 'Em andamento'\], \['concluido', 'Concluídos'\], \['faturado', 'Faturados'\]/);
  assert.match(obras, /CC\.api\('\/servicos'\)/);
  assert.match(obras, /todos \? obras\.map\(\(o\) => cartao\(o, numeros\)\) : \[\]\)\.concat\(vis\.map\(S\.cartao\)\)/);
  const base = ler('public/d/telas/servico-base.js');
  assert.match(base, /href="#\/servicos\/\$\{esc\(v\.id\)\}"/);
  assert.match(base, /if \(!D\.tem\('p1'\)\)/, 'tecnico sem cobrado, resultado nem margem');
  assert.match(base, /faturado: \['Faturado', 'vio'/);
  assert.match(ler('public/d/busca.js'), /r\.tipo === 'servico' \? `servicos\/\$\{r\.id\}`/);
  assert.match(ler('public/d/telas/obra.js'), /c\.tipo === 'servico' && D\.serv\) \{ D\.ir\(`servicos\/\$\{c\.id\}`\)/);
});

test('novo e editar: obra ou servico primeiro, cliente e valor obrigatorios, codigo sugerido e virar obra', () => {
  const form = ler('public/d/telas/servico-form.js');
  assert.match(form, /CC\.api\('\/servicos\/proximo-codigo'\)/);
  assert.match(form, /Informe o cliente\./);
  assert.match(form, /Informe o valor cobrado\./);
  assert.match(form, /U\.ocupar\(bt, edita \? 'Salvando…' : 'Criando…'\)/);
  assert.match(form, /importe o orçamento aprovado/);
  assert.match(form, /lançamentos continuam ligados a ele/);
  assert.match(form, /CC\.api\(`\/centros-custo\/\$\{sv\.id\}`, \{ method: 'PUT'/, 'virar obra pela rota comum com tipo');
  assert.match(form, /revisao: sv\.revisao/);
});

test('detalhe: acoes por situacao e papel, blocos, esqueleto e erro sem internet', () => {
  const sv = ler('public/d/telas/servico.js');
  assert.match(sv, /D\.tela\('servicos'/);
  assert.match(sv, /Iniciar serviço/);
  assert.match(sv, /sv\.situacao === 'em_andamento' && D\.tem\('p2'\)\) proximo = .*Concluir/);
  assert.match(sv, /sv\.situacao === 'concluido' && D\.tem\('p6'\)\) proximo = .*Faturar/);
  assert.match(sv, /Não deu para abrir o serviço/);
  assert.match(sv, /Tentar de novo/);
  assert.match(sv, /S\.baixar\(url\)/, 'fotos e assinatura com o token');
  assert.match(sv, /\/checklist\/\$\{encodeURIComponent\(b\.dataset\.ck\)\}`, \{ method: 'PATCH'/);
  const b = ler('public/d/telas/servico-blocos.js');
  for (const t of ['Gastos por tipo', 'Lançamentos do serviço', 'Notas fiscais e anexos', 'O que foi feito', 'Checklist', 'Fotos', 'Aceite do cliente', 'Cobrança', 'Nenhum gasto lançado', 'Abrindo o serviço…']) assert.ok(b.includes(t), t);
  assert.match(b, /U\.chip\('Na fila', 'warn', 'cloud-arrow-up'\)/);
  assert.match(b, /if \(!S\.veValores\(sv\)\)/);
});

test('lancar despesa: atalhos, recibo, Lancando, erro mantendo o que foi digitado e fila sem internet', () => {
  const g = ler('public/d/telas/servico-gasto.js');
  for (const t of ['deslocamento', 'combustivel', 'material', 'mao_de_obra', 'outros']) assert.ok(ler('public/d/telas/servico-base.js').includes(`tipo: '${t}'`), t);
  assert.match(g, /CC\.api\(`\/servicos\/\$\{sv\.id\}\/gastos`, \{ method: 'POST'/);
  assert.match(g, /client_id: e\.clientId/);
  assert.match(g, /U\.ocupar\(CC\.\$\('\[data-salvar\]', ctl\.rodape\), 'Lançando…'\)/);
  assert.match(g, /O valor e a foto continuam aqui/);
  assert.match(g, /CC\.queue\.add\(/);
  assert.match(g, /categoria: 'recibo'/);
  assert.match(g, /if \(error\.status !== 0\) throw error;/, 'so cai na fila quando falta rede');
  assert.match(g, /LIMITE = 8 \* 1024 \* 1024/);
});

test('concluir, faturar e relatorio seguem o contrato', () => {
  const a = ler('public/d/telas/servico-acoes.js');
  assert.match(a, /comPendencias: pendencias\.length > 0/);
  assert.match(a, /Concluir com pendências/);
  assert.match(a, /\/faturar`, \{ method: 'POST', body: \{ vencimentoDias: Number\(f\.venc\), forma: f\.forma, nfse \}/);
  assert.match(a, /'Gerando a cobrança…'/);
  assert.match(a, /Sem internet\. Nada foi alterado\./);
  assert.match(a, /sincronizada === false/);
  assert.match(a, /S\.baixar\(`\/api\/servicos\/\$\{sv\.id\}\/relatorio`\)/);
  assert.match(a, /contentWindow\.print\(\)/);
});
