const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Obra ou servico nas telas: desktop /d/ (abas, etiqueta, formulario, busca) e celular /m/ (filtro e etiqueta).
const ler = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('desktop: abas Obras / Servicos / Todos com escolha lembrada e totais por tipo', () => {
  const obras = ler('public/d/telas/obras.js');
  assert.match(obras, /rotulo: 'Obras'/);
  assert.match(obras, /rotulo: 'Serviços'/);
  assert.match(obras, /rotulo: 'Todos'/);
  assert.match(obras, /let tipo = 'obra'/, 'padrao e a aba Obras');
  assert.match(obras, /try \{ const salvo = localStorage\.getItem/);
  assert.match(obras, /try \{ localStorage\.setItem/);
  assert.match(obras, /portfolio-summary\$\{tipo === 'todos' \? '' : `\?kind=\$\{tipo\}`\}/, 'totais do topo seguem a aba');
  assert.match(obras, /U\.chip\('Serviço'/, 'etiqueta Servico no cartao');
  assert.match(obras, /Obras e centros de custo/);
});

test('desktop: formulario escolhe Obra ou Servico e envia o tipo', () => {
  const form = ler('public/d/telas/obra-form.js');
  assert.match(form, /rotulo: 'Obra ou serviço', name: 'tipo'/);
  assert.match(form, /tipo: v\('tipo'\) === 'servico' \? 'servico' : 'obra'/);
  assert.match(form, /Novo serviço/);
});

test('desktop: busca Ctrl K mostra Servico no subtitulo', () => {
  assert.match(ler('public/d/busca.js'), /o\.tipo === 'servico' \? 'Serviço' : ''/);
});

test('celular: filtro Obras / Servicos / Todos e etiqueta Servico na lista de obras', () => {
  const home = ler('public/m/screen-home.js');
  assert.match(home, /\['obra', 'Obras'\], \['servico', 'Serviços'\], \['todos', 'Todos'\]/);
  assert.match(home, /return 'obra';/, 'padrao Obras');
  assert.match(home, /try \{ const v = localStorage\.getItem/);
  assert.match(home, /<span class="tag">Serviço<\/span>/);
  assert.ok(home.split('\n').length <= 350);
  assert.match(ler('public/m/sw.js'), /const CACHE = 'cc-celular-v11'/);
});

test('migracao: coluna kind com obra como padrao e so obra ou servico', () => {
  const sql = ler('migrations/111_cost_center_kind.sql');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'obra'/);
  assert.match(sql, /CHECK \(kind IN \('obra','servico'\)\)/);
});

test('sincronismo leva o tipo: pacote inteligente, CSV de cadastros e descarte', () => {
  assert.match(ler('services/smartSync.js'), /'description','kind'\]/);
  assert.match(ler('routes/cadastroSync.js'), /r\.kind \|\| 'obra'/);
  assert.match(ler('services/costCenterArchive.js'), /kind: r\.kind === 'servico' \? 'servico' : 'obra'/);
});
