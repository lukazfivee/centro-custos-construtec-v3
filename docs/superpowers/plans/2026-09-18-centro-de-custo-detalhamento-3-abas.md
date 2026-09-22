# Detalhamento do Centro de Custo em 3 Abas — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reestruturar o modal "Centro de custo" (`openCenterDetail` em `public/app.js`) em 3 abas — Detalhamento, Notas Fiscais, Orçado x Realizado — expondo dados que já existem no backend e adicionando upload de proposta comercial e lançamento de notas fiscais de fornecedor/cliente.

**Architecture:** Duas tabelas novas no Postgres (`cost_center_proposals`, `cost_center_invoices_ledger`) seguindo exatamente o padrão já usado por `cost_center_invoices`/`routes/costCenterInvoices.js`. Dois novos routers Express (`routes/costCenterProposals.js`, `routes/costCenterInvoicesLedger.js`) montados em `/api/centros-custo`, ao lado do router `costCenters.js` já existente. Um ajuste de uma linha em `services/budgets/budgetComparison.js` para expor a data de aprovação da proposta (já persistida em `budget_baselines.sealed_at`, descoberto durante este planejamento — mais simples que reabrir o payload de `budget_imports`). No frontend, `openCenterDetail` passa a renderizar um cabeçalho/KPIs/ações fixos (inalterados) seguidos de navegação por abas reaproveitando as classes CSS já existentes `.measurements-tabs`/`.measurements-tab-btn` (de `budget-measurements.css`, já carregado globalmente).

**Tech Stack:** Express + node-postgres (`getDb().query`), PGlite para testes de integração (`node --test`), JS vanilla no frontend (sem framework), CSS puro.

**Spec:** `docs/superpowers/specs/2026-09-18-centro-de-custo-detalhamento-design.md`

## Global Constraints

- Nenhuma mudança na categorização de lançamentos (`categories`/`category_id`) — confirmado no spec.
- Não tocar em `cost_center_invoices` / `routes/costCenterInvoices.js` / `public/v3-1-invoices.js` — mecanismo antigo fica intocado.
- Sem geração automática de PDF de proposta — só upload manual.
- Não substituir o modal "Orçado vs. Realizado" existente (`budget-view.js`) — a Aba 3 nova só abre esse modal por cima, via o botão que `budget-view.js` já injeta em `.center-detail-actions`.
- PDFs limitados a 5 MB, assinatura `%PDF-` obrigatória (mesmo padrão de `costCenterInvoices.js`/`attachments.js`).
- Toda rota protegida por `autenticar`; mutações (upload/editar/excluir) exigem `exigirPapel('admin','gestor')`; leitura permitida a qualquer usuário autenticado (mesmo padrão de `costCenterInvoices.js`).
- `node scripts/check-syntax.js` e `node --test` (suíte completa) devem passar antes de qualquer commit.
- QA visual mobile + desktop via portal Maestri em instância descartável antes de considerar o trabalho concluído (regra de sessão para mudanças de frontend).

---

## Arquivos que serão criados ou modificados

| Arquivo | Responsabilidade |
|---|---|
| `migrations/104_cost_center_documents.sql` | Cria `cost_center_proposals` (1 PDF por centro) e `cost_center_invoices_ledger` (N notas fiscais por centro). |
| `routes/costCenterProposals.js` | CRUD da proposta comercial (metadados, download, upload/substituição, remoção). |
| `routes/costCenterInvoicesLedger.js` | CRUD das notas fiscais de fornecedor/cliente. |
| `server.js` | Registra os dois routers novos em `/api/centros-custo`. |
| `services/budgets/budgetComparison.js` | Expõe `contract.approvedAt` (de `budget_baselines.sealed_at`). |
| `public/app.js` | Reescreve `openCenterDetail` com as 3 abas. |
| `public/style-base.css` | Estilos novos para campos de detalhamento, bloco de proposta e seções de notas fiscais. |
| `test/cost-center-proposals.integration.test.js` | Testa o CRUD da proposta. |
| `test/cost-center-invoices-ledger.integration.test.js` | Testa o CRUD das notas fiscais. |
| `test/budget-comparison-approved-at.test.js` | Testa a exposição de `contract.approvedAt`. |

---

### Task 1: Migração + backend da proposta comercial

**Files:**
- Create: `migrations/104_cost_center_documents.sql`
- Create: `routes/costCenterProposals.js`
- Modify: `server.js:86` (adicionar registro do router logo após `costCenterInvoices`)
- Test: `test/cost-center-proposals.integration.test.js`

**Interfaces:**
- Consumes: `getDb()` e `initializeDatabase()`/`closeDatabase()` de `db.js`; `autenticar`/`exigirPapel` de `middleware/auth.js`; `asyncRoute`/`httpError`/`positiveId` de `lib/http.js`; `recordAudit` de `services/audit.js`. Tabela `cost_centers(id, public_id, code, name)` já existente.
- Produces: rotas `GET /api/centros-custo/:id/proposta`, `GET /api/centros-custo/:id/proposta/arquivo`, `POST /api/centros-custo/:id/proposta`, `DELETE /api/centros-custo/:id/proposta`. Formato de resposta `{ proposta: { nome, tipo, tamanho, sha256, enviadoPor, criadoEm, atualizadoEm } | null }` — Task 4 (frontend) consome exatamente esse formato.

- [ ] **Step 1: Criar a migração**

```sql
-- migrations/104_cost_center_documents.sql

CREATE TABLE IF NOT EXISTS cost_center_proposals (
  cost_center_id BIGINT PRIMARY KEY REFERENCES cost_centers(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  size_bytes BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  content BYTEA NOT NULL,
  uploaded_by BIGINT,
  uploaded_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cost_center_invoices_ledger (
  id SERIAL PRIMARY KEY,
  cost_center_id BIGINT NOT NULL REFERENCES cost_centers(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('fornecedor', 'cliente')),
  original_name TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  sha256 TEXT,
  content BYTEA,
  data_emissao DATE,
  valor NUMERIC(14, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'nao_paga' CHECK (status IN ('paga', 'nao_paga')),
  observacao TEXT,
  uploaded_by BIGINT,
  uploaded_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cc_invoices_ledger_center ON cost_center_invoices_ledger(cost_center_id, tipo);
```

- [ ] **Step 2: Escrever o teste (vai falhar — as rotas ainda não existem)**

```js
// test/cost-center-proposals.integration.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('Proposta do centro de custo: envia, consulta, baixa, substitui e remove', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-custos-proposta-'));
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'segredo-proposta-com-mais-de-trinta-e-dois-caracteres';
  process.env.ADMIN_INITIAL_PASSWORD = 'senha-teste-proposta-123';
  process.env.ADMIN_INITIAL_EMAIL = 'admin-proposta@teste.local';
  process.env.INSTANCE_NAME = 'Instalação Proposta';
  delete process.env.DATABASE_URL;

  const { initializeDatabase, closeDatabase } = require('../db');
  const { createApp } = require('../server');
  await initializeDatabase();
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  context.after(async () => {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  async function request(route, options = {}) {
    const response = await fetch(base + route, {
      method: options.method || 'GET',
      headers: { ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  const login = await request('/auth/login', { method: 'POST', body: { email: 'admin-proposta@teste.local', senha: 'senha-teste-proposta-123' } });
  assert.equal(login.response.ok, true);
  const token = login.data.token;
  const center = await request('/centros-custo', { method: 'POST', token, body: { codigo: 'PROP-001', nome: 'Obra Proposta', orcamento: 1000, situacao: 'execucao' } });
  assert.equal(center.response.status, 201);
  const centerId = center.data.id;

  const empty = await request(`/centros-custo/${centerId}/proposta`, { token });
  assert.equal(empty.response.ok, true);
  assert.equal(empty.data.proposta, null);

  const bytes = Buffer.from('%PDF-1.4\n% proposta original\n%%EOF\n');
  const uploadBody = { nome: 'proposta-comercial.pdf', tipo: 'application/pdf', conteudoBase64: bytes.toString('base64') };
  const uploaded = await request(`/centros-custo/${centerId}/proposta`, { method: 'POST', token, body: uploadBody });
  assert.equal(uploaded.response.status, 201);
  assert.equal(uploaded.data.proposta.nome, 'proposta-comercial.pdf');
  assert.equal(uploaded.data.proposta.tamanho, bytes.length);

  const metadata = await request(`/centros-custo/${centerId}/proposta`, { token });
  assert.equal(metadata.data.proposta.nome, 'proposta-comercial.pdf');

  const fileResponse = await fetch(base + `/centros-custo/${centerId}/proposta/arquivo`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(fileResponse.ok, true);
  assert.equal(fileResponse.headers.get('content-type'), 'application/pdf');
  assert.deepEqual(Buffer.from(await fileResponse.arrayBuffer()), bytes);

  const invalidUpload = await request(`/centros-custo/${centerId}/proposta`, { method: 'POST', token, body: { nome: 'nao-e-pdf.txt', tipo: 'application/pdf', conteudoBase64: Buffer.from('nao e pdf').toString('base64') } });
  assert.equal(invalidUpload.response.status, 400);

  const oversized = await request(`/centros-custo/${centerId}/proposta`, { method: 'POST', token, body: { nome: 'grande.pdf', tipo: 'application/pdf', conteudoBase64: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(5 * 1024 * 1024)]).toString('base64') } });
  assert.equal(oversized.response.status, 413);

  const replacementBytes = Buffer.from('%PDF-1.4\n% proposta revisada\n%%EOF\n');
  const replaced = await request(`/centros-custo/${centerId}/proposta`, { method: 'POST', token, body: { nome: 'proposta-revisada.pdf', tipo: 'application/pdf', conteudoBase64: replacementBytes.toString('base64') } });
  assert.equal(replaced.response.status, 201);
  assert.equal(replaced.data.proposta.nome, 'proposta-revisada.pdf');

  const semPermissao = await request('/auth/login', { method: 'POST', body: { email: 'admin-proposta@teste.local', senha: 'senha-teste-proposta-123' } });
  assert.equal(semPermissao.response.ok, true);

  const removed = await request(`/centros-custo/${centerId}/proposta`, { method: 'DELETE', token });
  assert.equal(removed.response.ok, true);
  const afterRemoval = await request(`/centros-custo/${centerId}/proposta`, { token });
  assert.equal(afterRemoval.data.proposta, null);
});
```

Run: `node --test test/cost-center-proposals.integration.test.js`
Expected: FAIL (`routes/costCenterProposals.js` ainda não existe / rota 404)

- [ ] **Step 3: Implementar o router**

```js
// routes/costCenterProposals.js
const crypto = require('crypto');
const express = require('express');
const { getDb } = require('../db');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { recordAudit } = require('../services/audit');

const router = express.Router();
router.use(autenticar);

const MAX_SIZE = 5 * 1024 * 1024;

async function centerById(id) {
  const { rows } = await getDb().query('SELECT id,public_id,code,name FROM cost_centers WHERE id=$1', [id]);
  if (!rows[0]) throw httpError(404, 'Centro de custo não encontrado.');
  return rows[0];
}

function safeName(value) {
  const name = String(value || '').trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 240);
  if (!name || !/\.pdf$/i.test(name)) throw httpError(400, 'A proposta deve ser um arquivo PDF.');
  return name;
}

function decodePdf(body) {
  const name = safeName(body?.nome);
  const mime = String(body?.tipo || '').trim().toLowerCase();
  if (mime && mime !== 'application/pdf') throw httpError(400, 'A proposta deve ser um arquivo PDF.');
  const base64 = String(body?.conteudoBase64 || '').replace(/^data:[^;]+;base64,/, '').trim();
  if (!base64) throw httpError(400, 'Selecione a proposta em PDF.');
  let content;
  try { content = Buffer.from(base64, 'base64'); } catch { throw httpError(400, 'Arquivo PDF inválido.'); }
  if (!content.length) throw httpError(400, 'O arquivo está vazio.');
  if (content.length > MAX_SIZE) throw httpError(413, 'A proposta em PDF deve ter no máximo 5 MB.');
  if (content.slice(0, 5).toString('ascii') !== '%PDF-') throw httpError(400, 'O arquivo selecionado não parece ser um PDF válido.');
  return { name, content, hash: crypto.createHash('sha256').update(content).digest('hex') };
}

function publicProposal(row) {
  if (!row) return null;
  return {
    nome: row.original_name,
    tipo: row.mime_type,
    tamanho: Number(row.size_bytes || 0),
    sha256: row.sha256,
    enviadoPor: row.uploaded_by_name || null,
    criadoEm: row.created_at,
    atualizadoEm: row.updated_at,
  };
}

async function proposalRow(centerId, includeContent = false) {
  const fields = includeContent
    ? 'original_name,mime_type,size_bytes,sha256,content,uploaded_by_name,created_at,updated_at'
    : 'original_name,mime_type,size_bytes,sha256,uploaded_by_name,created_at,updated_at';
  const { rows } = await getDb().query(`SELECT ${fields} FROM cost_center_proposals WHERE cost_center_id=$1`, [centerId]);
  return rows[0] || null;
}

router.get('/:id/proposta', asyncRoute(async (req, res) => {
  const center = await centerById(positiveId(req.params.id));
  const proposal = await proposalRow(center.id);
  res.json({ centroPublicId: center.public_id, proposta: publicProposal(proposal) });
}));

router.get('/:id/proposta/arquivo', asyncRoute(async (req, res) => {
  const center = await centerById(positiveId(req.params.id));
  const proposal = await proposalRow(center.id, true);
  if (!proposal) throw httpError(404, 'Nenhuma proposta anexada a este centro de custo.');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(proposal.size_bytes));
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(proposal.original_name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(proposal.content));
}));

router.post('/:id/proposta', exigirPapel('admin', 'gestor'), asyncRoute(async (req, res) => {
  const center = await centerById(positiveId(req.params.id));
  const file = decodePdf(req.body);
  const now = new Date();
  const { rows } = await getDb().query(`
    INSERT INTO cost_center_proposals
      (cost_center_id,original_name,mime_type,size_bytes,sha256,content,uploaded_by,uploaded_by_name,created_at,updated_at)
    VALUES ($1,$2,'application/pdf',$3,$4,$5,$6,$7,$8,$8)
    ON CONFLICT (cost_center_id) DO UPDATE SET
      original_name=excluded.original_name,mime_type='application/pdf',size_bytes=excluded.size_bytes,
      sha256=excluded.sha256,content=excluded.content,uploaded_by=excluded.uploaded_by,
      uploaded_by_name=excluded.uploaded_by_name,updated_at=excluded.updated_at
    RETURNING original_name,mime_type,size_bytes,sha256,uploaded_by_name,created_at,updated_at`,
    [center.id, file.name, file.content.length, file.hash, file.content, req.usuario.id, req.usuario.name, now]
  );
  await recordAudit({
    entityType: 'obra', entityId: center.public_id, action: 'proposta_vinculada',
    summary: `Proposta vinculada ao centro ${center.code}: ${file.name}`,
    data: { nome: file.name, tamanho: file.content.length, sha256: file.hash }, user: req.usuario,
  });
  res.status(201).json({ proposta: publicProposal(rows[0]) });
}));

router.delete('/:id/proposta', exigirPapel('admin', 'gestor'), asyncRoute(async (req, res) => {
  const center = await centerById(positiveId(req.params.id));
  const proposal = await proposalRow(center.id);
  if (!proposal) throw httpError(404, 'Nenhuma proposta anexada a este centro de custo.');
  await getDb().query('DELETE FROM cost_center_proposals WHERE cost_center_id=$1', [center.id]);
  await recordAudit({
    entityType: 'obra', entityId: center.public_id, action: 'proposta_removida',
    summary: `Proposta removida do centro ${center.code}: ${proposal.original_name}`,
    data: { nome: proposal.original_name, sha256: proposal.sha256 }, user: req.usuario,
  });
  res.json({ ok: true });
}));

module.exports = router;
```

- [ ] **Step 4: Registrar o router em `server.js`**

Modify `server.js:86` — logo após a linha existente:
```js
  app.use('/api/notas-fiscais-centro', require('./routes/costCenterInvoices'));
```
adicionar:
```js
  app.use('/api/centros-custo', require('./routes/costCenterProposals'));
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `node --test test/cost-center-proposals.integration.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add migrations/104_cost_center_documents.sql routes/costCenterProposals.js server.js test/cost-center-proposals.integration.test.js
git commit -m "feat: adiciona upload de proposta comercial ao centro de custo"
```

---

### Task 2: Backend das notas fiscais (fornecedor/cliente)

**Files:**
- Create: `routes/costCenterInvoicesLedger.js`
- Modify: `server.js` (adicionar registro do router, logo após o de `costCenterProposals`)
- Test: `test/cost-center-invoices-ledger.integration.test.js`

**Interfaces:**
- Consumes: mesma tabela `cost_centers`; tabela `cost_center_invoices_ledger` criada na Task 1 (migração já aplicada — não recriar).
- Produces: `GET /api/centros-custo/:id/notas-fiscais?tipo=fornecedor|cliente`, `POST /api/centros-custo/:id/notas-fiscais`, `PUT /api/centros-custo/notas-fiscais/:nfId`, `DELETE /api/centros-custo/notas-fiscais/:nfId`. Formato de cada item: `{ id, tipo, nomeArquivo, temArquivo, dataEmissao, valor, status, observacao, enviadoPor, criadoEm, atualizadoEm }` — Task 4 (frontend) consome exatamente esse formato. Download do arquivo anexado à NF fica **fora de escopo** desta task (spec não pede rota de download aqui — só indicador `temArquivo`).

- [ ] **Step 1: Escrever o teste (vai falhar — a rota ainda não existe)**

```js
// test/cost-center-invoices-ledger.integration.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('Notas fiscais do centro de custo: lança, lista, atualiza status e remove', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-custos-nf-ledger-'));
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'segredo-nf-ledger-com-mais-de-trinta-e-dois-caracteres';
  process.env.ADMIN_INITIAL_PASSWORD = 'senha-teste-nf-ledger-123';
  process.env.ADMIN_INITIAL_EMAIL = 'admin-nf-ledger@teste.local';
  process.env.INSTANCE_NAME = 'Instalação NF Ledger';
  delete process.env.DATABASE_URL;

  const { initializeDatabase, closeDatabase } = require('../db');
  const { createApp } = require('../server');
  await initializeDatabase();
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  context.after(async () => {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  async function request(route, options = {}) {
    const response = await fetch(base + route, {
      method: options.method || 'GET',
      headers: { ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  const login = await request('/auth/login', { method: 'POST', body: { email: 'admin-nf-ledger@teste.local', senha: 'senha-teste-nf-ledger-123' } });
  assert.equal(login.response.ok, true);
  const token = login.data.token;
  const center = await request('/centros-custo', { method: 'POST', token, body: { codigo: 'NFL-001', nome: 'Obra NF Ledger', orcamento: 1000, situacao: 'execucao' } });
  assert.equal(center.response.status, 201);
  const centerId = center.data.id;

  const emptyList = await request(`/centros-custo/${centerId}/notas-fiscais`, { token });
  assert.equal(emptyList.response.ok, true);
  assert.deepEqual(emptyList.data, []);

  const fornecedor = await request(`/centros-custo/${centerId}/notas-fiscais`, {
    method: 'POST', token,
    body: { tipo: 'fornecedor', dataEmissao: '2026-09-10', valor: 1500.5, status: 'nao_paga', observacao: 'Cimento e areia' },
  });
  assert.equal(fornecedor.response.status, 201);
  assert.equal(fornecedor.data.tipo, 'fornecedor');
  assert.equal(fornecedor.data.status, 'nao_paga');
  assert.equal(fornecedor.data.temArquivo, false);

  const bytes = Buffer.from('%PDF-1.4\n% nf cliente\n%%EOF\n');
  const cliente = await request(`/centros-custo/${centerId}/notas-fiscais`, {
    method: 'POST', token,
    body: { tipo: 'cliente', dataEmissao: '2026-09-12', valor: 8000, status: 'paga', nome: 'nf-cliente.pdf', tipoArquivo: 'application/pdf', conteudoBase64: bytes.toString('base64') },
  });
  assert.equal(cliente.response.status, 201);
  assert.equal(cliente.data.temArquivo, true);
  assert.equal(cliente.data.nomeArquivo, 'nf-cliente.pdf');

  const invalidTipo = await request(`/centros-custo/${centerId}/notas-fiscais`, { method: 'POST', token, body: { tipo: 'invalido', valor: 10 } });
  assert.equal(invalidTipo.response.status, 400);

  const listaFornecedor = await request(`/centros-custo/${centerId}/notas-fiscais?tipo=fornecedor`, { token });
  assert.equal(listaFornecedor.data.length, 1);
  assert.equal(listaFornecedor.data[0].tipo, 'fornecedor');

  const listaCompleta = await request(`/centros-custo/${centerId}/notas-fiscais`, { token });
  assert.equal(listaCompleta.data.length, 2);

  const atualizado = await request(`/centros-custo/notas-fiscais/${fornecedor.data.id}`, { method: 'PUT', token, body: { status: 'paga' } });
  assert.equal(atualizado.response.status, 200);
  assert.equal(atualizado.data.status, 'paga');
  assert.equal(atualizado.data.valor, 1500.5);

  const removido = await request(`/centros-custo/notas-fiscais/${cliente.data.id}`, { method: 'DELETE', token });
  assert.equal(removido.response.status, 200);
  const listaFinal = await request(`/centros-custo/${centerId}/notas-fiscais`, { token });
  assert.equal(listaFinal.data.length, 1);
});
```

Note: as rotas de mutação `PUT`/`DELETE` são montadas em `/api/centros-custo/notas-fiscais/:nfId` (o router é montado em `/api/centros-custo`, e a rota interna é `/notas-fiscais/:nfId`) — por isso o teste chama `request('/centros-custo/notas-fiscais/...')` (a base já inclui só `/api`).

Run: `node --test test/cost-center-invoices-ledger.integration.test.js`
Expected: FAIL (rota ainda não existe)

- [ ] **Step 2: Implementar o router**

```js
// routes/costCenterInvoicesLedger.js
const crypto = require('crypto');
const express = require('express');
const { getDb } = require('../db');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { recordAudit } = require('../services/audit');

const router = express.Router();
router.use(autenticar);

const MAX_SIZE = 5 * 1024 * 1024;
const TIPOS = ['fornecedor', 'cliente'];
const STATUSES = ['paga', 'nao_paga'];

async function centerById(id) {
  const { rows } = await getDb().query('SELECT id,public_id,code,name FROM cost_centers WHERE id=$1', [id]);
  if (!rows[0]) throw httpError(404, 'Centro de custo não encontrado.');
  return rows[0];
}

function validTipo(value) {
  const tipo = String(value || '').trim().toLowerCase();
  if (!TIPOS.includes(tipo)) throw httpError(400, 'Informe o tipo da nota fiscal: fornecedor ou cliente.');
  return tipo;
}

function validStatus(value) {
  const status = String(value || 'nao_paga').trim().toLowerCase();
  if (!STATUSES.includes(status)) throw httpError(400, 'Status inválido. Use paga ou nao_paga.');
  return status;
}

function validDate(value) {
  if (value == null || value === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw httpError(400, 'Data de emissão inválida.');
  return value;
}

function validValor(value) {
  const valor = Number(value);
  if (!Number.isFinite(valor) || valor < 0) throw httpError(400, 'Valor inválido.');
  return valor;
}

function decodeOptionalPdf(body) {
  const base64 = String(body?.conteudoBase64 || '').replace(/^data:[^;]+;base64,/, '').trim();
  if (!base64) return null;
  const name = String(body?.nome || '').trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 240);
  if (!name || !/\.pdf$/i.test(name)) throw httpError(400, 'O arquivo da nota fiscal deve ser um PDF.');
  const mime = String(body?.tipoArquivo || '').trim().toLowerCase();
  if (mime && mime !== 'application/pdf') throw httpError(400, 'O arquivo da nota fiscal deve ser um PDF.');
  let content;
  try { content = Buffer.from(base64, 'base64'); } catch { throw httpError(400, 'Arquivo PDF inválido.'); }
  if (!content.length) throw httpError(400, 'O arquivo está vazio.');
  if (content.length > MAX_SIZE) throw httpError(413, 'A nota fiscal em PDF deve ter no máximo 5 MB.');
  if (content.slice(0, 5).toString('ascii') !== '%PDF-') throw httpError(400, 'O arquivo selecionado não parece ser um PDF válido.');
  return { name, content, hash: crypto.createHash('sha256').update(content).digest('hex') };
}

function publicLedgerEntry(row) {
  return {
    id: row.id,
    tipo: row.tipo,
    nomeArquivo: row.original_name || null,
    temArquivo: Boolean(row.original_name),
    dataEmissao: row.data_emissao,
    valor: Number(row.valor || 0),
    status: row.status,
    observacao: row.observacao || '',
    enviadoPor: row.uploaded_by_name || null,
    criadoEm: row.created_at,
    atualizadoEm: row.updated_at,
  };
}

router.get('/:id/notas-fiscais', asyncRoute(async (req, res) => {
  const center = await centerById(positiveId(req.params.id));
  const tipoFilter = req.query.tipo ? validTipo(req.query.tipo) : null;
  const params = [center.id];
  let sql = `SELECT id,tipo,original_name,data_emissao::text AS data_emissao,valor,status,observacao,uploaded_by_name,created_at,updated_at
    FROM cost_center_invoices_ledger WHERE cost_center_id=$1`;
  if (tipoFilter) { sql += ' AND tipo=$2'; params.push(tipoFilter); }
  sql += ' ORDER BY data_emissao DESC NULLS LAST, id DESC';
  const { rows } = await getDb().query(sql, params);
  res.json(rows.map(publicLedgerEntry));
}));

router.post('/:id/notas-fiscais', exigirPapel('admin', 'gestor'), asyncRoute(async (req, res) => {
  const center = await centerById(positiveId(req.params.id));
  const tipo = validTipo(req.body?.tipo);
  const status = validStatus(req.body?.status);
  const dataEmissao = validDate(req.body?.dataEmissao);
  const valor = validValor(req.body?.valor);
  const file = decodeOptionalPdf(req.body);
  const observacao = String(req.body?.observacao || '').slice(0, 1000);
  const now = new Date();
  const { rows } = await getDb().query(`
    INSERT INTO cost_center_invoices_ledger
      (cost_center_id,tipo,original_name,mime_type,size_bytes,sha256,content,data_emissao,valor,status,observacao,uploaded_by,uploaded_by_name,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
    RETURNING id,tipo,original_name,data_emissao::text AS data_emissao,valor,status,observacao,uploaded_by_name,created_at,updated_at`,
    [
      center.id, tipo,
      file?.name || null, file ? 'application/pdf' : null, file ? file.content.length : null,
      file ? file.hash : null, file ? file.content : null,
      dataEmissao, valor, status, observacao, req.usuario.id, req.usuario.name, now,
    ]
  );
  await recordAudit({
    entityType: 'obra', entityId: center.public_id, action: 'nota_fiscal_ledger_criada',
    summary: `Nota fiscal (${tipo}) lançada no centro ${center.code}`,
    data: { tipo, valor, status, dataEmissao }, user: req.usuario,
  });
  res.status(201).json(publicLedgerEntry(rows[0]));
}));

async function ledgerById(nfId) {
  const { rows } = await getDb().query(`
    SELECT l.*, cc.public_id AS center_public_id, cc.code AS center_code
    FROM cost_center_invoices_ledger l JOIN cost_centers cc ON cc.id=l.cost_center_id
    WHERE l.id=$1`, [nfId]);
  if (!rows[0]) throw httpError(404, 'Nota fiscal não encontrada.');
  return rows[0];
}

router.put('/notas-fiscais/:nfId', exigirPapel('admin', 'gestor'), asyncRoute(async (req, res) => {
  const nfId = positiveId(req.params.nfId, 'Identificador da nota fiscal');
  const existing = await ledgerById(nfId);
  const status = req.body?.status !== undefined ? validStatus(req.body.status) : existing.status;
  const dataEmissao = req.body?.dataEmissao !== undefined ? validDate(req.body.dataEmissao) : existing.data_emissao;
  const valor = req.body?.valor !== undefined ? validValor(req.body.valor) : Number(existing.valor);
  const observacao = req.body?.observacao !== undefined ? String(req.body.observacao).slice(0, 1000) : existing.observacao;
  const now = new Date();
  const { rows } = await getDb().query(`
    UPDATE cost_center_invoices_ledger SET status=$1,data_emissao=$2,valor=$3,observacao=$4,updated_at=$5
    WHERE id=$6
    RETURNING id,tipo,original_name,data_emissao::text AS data_emissao,valor,status,observacao,uploaded_by_name,created_at,updated_at`,
    [status, dataEmissao, valor, observacao, now, nfId]
  );
  await recordAudit({
    entityType: 'obra', entityId: existing.center_public_id, action: 'nota_fiscal_ledger_atualizada',
    summary: `Nota fiscal (${existing.tipo}) atualizada no centro ${existing.center_code}`,
    data: { status, valor, dataEmissao }, user: req.usuario,
  });
  res.json(publicLedgerEntry(rows[0]));
}));

router.delete('/notas-fiscais/:nfId', exigirPapel('admin', 'gestor'), asyncRoute(async (req, res) => {
  const nfId = positiveId(req.params.nfId, 'Identificador da nota fiscal');
  const existing = await ledgerById(nfId);
  await getDb().query('DELETE FROM cost_center_invoices_ledger WHERE id=$1', [nfId]);
  await recordAudit({
    entityType: 'obra', entityId: existing.center_public_id, action: 'nota_fiscal_ledger_removida',
    summary: `Nota fiscal (${existing.tipo}) removida do centro ${existing.center_code}`,
    data: { valor: Number(existing.valor), status: existing.status }, user: req.usuario,
  });
  res.json({ ok: true });
}));

module.exports = router;
```

- [ ] **Step 3: Registrar o router em `server.js`**

Adicionar logo após a linha de `costCenterProposals` (inserida na Task 1):
```js
  app.use('/api/centros-custo', require('./routes/costCenterInvoicesLedger'));
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node --test test/cost-center-invoices-ledger.integration.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add routes/costCenterInvoicesLedger.js server.js test/cost-center-invoices-ledger.integration.test.js
git commit -m "feat: adiciona lançamento de notas fiscais de fornecedor e cliente ao centro de custo"
```

---

### Task 3: Expor a data de aprovação da proposta em Orçado x Realizado

**Files:**
- Modify: `services/budgets/budgetComparison.js:12-19` (query) e `:182-191` (objeto `contract` retornado)
- Test: `test/budget-comparison-approved-at.test.js`

**Interfaces:**
- Consumes: coluna `budget_baselines.sealed_at` (já existe desde a migração `101_budget_baselines.sql`; já recebe `proposal.approval?.approvedAt || new Date().toISOString()` na importação, ver `services/budgets/budgetImportService.js:244`). Nenhuma migração nova necessária.
- Produces: campo `contract.approvedAt` (string ISO) na resposta de `GET /api/centros-custo/:id/orcado-realizado`, presente apenas quando `hasBudget: true` — Task 4 (frontend) consome esse campo na Aba 1.

- [ ] **Step 1: Escrever o teste (vai falhar — o campo ainda não existe)**

```js
// test/budget-comparison-approved-at.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('Orçado vs. Realizado expõe a data de aprovação da proposta em contract.approvedAt', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-approved-at-'));
  process.env.DATABASE_URL = '';
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'approved-at-test-secret-com-mais-de-32-caracteres';
  process.env.ADMIN_INITIAL_PASSWORD = 'approved-at-teste-123';
  process.env.ADMIN_INITIAL_EMAIL = 'approved-at@teste.local';

  const { initializeDatabase, closeDatabase } = require('../db');
  const { createApp } = require('../server');

  let server;
  context.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  await initializeDatabase();
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  async function request(route, method = 'GET', body, token = '') {
    const response = await fetch(base + route, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null };
  }

  const login = await request('/auth/login', 'POST', { email: 'approved-at@teste.local', senha: 'approved-at-teste-123' });
  assert.equal(login.status, 200);
  const token = login.data.token;

  const withoutBudget = await request('/centros-custo', 'POST', { codigo: 'APR-000', nome: 'Obra sem orçamento', orcamento: 0, situacao: 'execucao' }, token);
  assert.equal(withoutBudget.status, 201);
  const comparisonWithoutBudget = await request(`/centros-custo/${withoutBudget.data.id}/orcado-realizado`, 'GET', undefined, token);
  assert.equal(comparisonWithoutBudget.data.hasBudget, false);
  assert.equal(comparisonWithoutBudget.data.contract, undefined);

  const fixturePath = path.resolve(__dirname, '../../INTEGRAÇÃO-ORÇAMENTOS-CENTRO V3/contracts/proposal-approved.v1.example.json');
  const officialEnvelope = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const imported = await request('/integracao/orcamentos/confirmar-direto', 'POST', officialEnvelope, token);
  assert.equal(imported.status, 201);

  const comparison = await request(`/centros-custo/${imported.data.costCenterId}/orcado-realizado`, 'GET', undefined, token);
  assert.equal(comparison.status, 200);
  assert.equal(comparison.data.hasBudget, true);
  assert.ok(comparison.data.contract.approvedAt, 'contract.approvedAt deveria estar presente');
  assert.ok(
    String(comparison.data.contract.approvedAt).startsWith('2026-09-06T15:00:00'),
    `esperado prefixo 2026-09-06T15:00:00, recebido ${comparison.data.contract.approvedAt}`
  );
});
```

Run: `node --test test/budget-comparison-approved-at.test.js`
Expected: FAIL (`contract.approvedAt` é `undefined`)

- [ ] **Step 2: Adicionar a coluna à query do contrato**

Modify `services/budgets/budgetComparison.js` (dentro de `contractQuery`, por volta da linha 12-19):

Old:
```js
  let contractQuery = `
    SELECT pc.id AS contract_id, pc.number AS contract_number, pc.current_baseline_id,
           bb.id AS baseline_id, bb.version AS baseline_version,
           bb.materials_cost, bb.labor_cost, bb.base_cost, bb.contract_value
    FROM project_contracts pc
```

New:
```js
  let contractQuery = `
    SELECT pc.id AS contract_id, pc.number AS contract_number, pc.current_baseline_id,
           bb.id AS baseline_id, bb.version AS baseline_version,
           bb.materials_cost, bb.labor_cost, bb.base_cost, bb.contract_value, bb.sealed_at
    FROM project_contracts pc
```

- [ ] **Step 3: Expor `approvedAt` no objeto `contract` retornado**

Modify `services/budgets/budgetComparison.js` (por volta da linha 182-191):

Old:
```js
    contract: {
      id: contract.contract_id,
      number: contract.contract_number,
      baselineId: contract.baseline_id,
      baselineVersion: contract.baseline_version,
      contractValue: roundMoney(contract.contract_value),
      baseCost: roundMoney(contract.base_cost),
      materialsCost: roundMoney(contract.materials_cost),
      laborCost: roundMoney(contract.labor_cost),
    },
```

New:
```js
    contract: {
      id: contract.contract_id,
      number: contract.contract_number,
      baselineId: contract.baseline_id,
      baselineVersion: contract.baseline_version,
      contractValue: roundMoney(contract.contract_value),
      baseCost: roundMoney(contract.base_cost),
      materialsCost: roundMoney(contract.materials_cost),
      laborCost: roundMoney(contract.labor_cost),
      approvedAt: contract.sealed_at,
    },
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node --test test/budget-comparison-approved-at.test.js`
Expected: PASS

- [ ] **Step 5: Rodar a suíte de orçamento existente para garantir que nada quebrou**

Run: `node --test test/budget-comparison.integration.test.js test/budget-export.integration.test.js`
Expected: PASS (o campo novo é aditivo, nenhuma asserção existente deveria depender da ausência dele)

- [ ] **Step 6: Commit**

```bash
git add services/budgets/budgetComparison.js test/budget-comparison-approved-at.test.js
git commit -m "feat: expoe data de aprovacao da proposta em orcado-vs-realizado"
```

---

### Task 4: Frontend — 3 abas em `openCenterDetail`

**Files:**
- Modify: `public/app.js:357-424` (substituir toda a função `openCenterDetail`)
- Modify: `public/style-base.css` (adicionar regras novas, mesmo padrão minificado de uma linha já usado no arquivo)

**Interfaces:**
- Consumes: `GET /api/centros-custo/:id/detalhes` (já existente), `GET /api/centros-custo/:id/orcado-realizado` (já existente + `contract.approvedAt` da Task 3), `GET /api/centros-custo/:id/proposta` (Task 1), `POST`/`DELETE /api/centros-custo/:id/proposta` (Task 1), `GET/POST /api/centros-custo/:id/notas-fiscais` e `PUT/DELETE /api/centros-custo/notas-fiscais/:nfId` (Task 2). Helpers globais já existentes em `app.js`: `api(path, options)`, `modal(title, html)`, `closeModal()`, `esc(value)`, `money(value)`, `toast(msg, isError)`, `usuario` (objeto da sessão com `.role`), `centros` (array carregado por `loadCenters`), `openCenter(item)` (form de edição, inalterado).
- Produces: `.center-detail-actions` continua presente e é o **primeiro** bloco fixo do modal (fora da área de abas) — é nele que `budget-view.js` já injeta o botão `#btn-ver-orcado-realizado` via `document.querySelector('.center-detail-actions')`; isso precisa continuar funcionando mesmo trocando de aba, por isso essa div NÃO fica dentro do conteúdo trocável por aba. `#center-detail-transactions` continua sendo o `id` da tabela de lançamentos (usado por `renderList()`), agora dentro da Aba 1.

- [ ] **Step 1: Substituir `openCenterDetail` em `public/app.js`**

Substituir todo o bloco de `public/app.js:357` (`async function openCenterDetail(id) {`) até `public/app.js:424` (a linha `}` que fecha a função, logo antes de `async function loadCategories(){...`) pelo código abaixo:

```js
async function openCenterDetail(id) {
  try {
    const [data, orcado, propostaData] = await Promise.all([
      api(`/centros-custo/${id}/detalhes`),
      api(`/centros-custo/${id}/orcado-realizado`).catch(() => ({ hasBudget: false, message: 'Não foi possível carregar o orçado vs. realizado.' })),
      api(`/centros-custo/${id}/proposta`).catch(() => ({ proposta: null })),
    ]);
    const c = data.centro;
    const lancamentos = data.lancamentos;
    let proposta = propostaData.proposta;
    const canManage = ['admin', 'gestor'].includes(usuario.role);
    const statusLabel = c.ativo?(c.situacao==='execucao'?'Em aberto':c.situacao==='pausado'?'Pausado':c.situacao==='concluido'?'Concluído':'Ativo'):'Inativo';
    const statusClass = c.ativo?(c.situacao==='execucao'?'em-aberto':c.situacao==='pausado'?'pausado':c.situacao==='concluido'?'concluido':'ativo'):'inativo';
    const fmtMoney = (v) => Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
    const fmtDate = (v) => v ? String(v).slice(0,10).split('-').reverse().join('/') : '—';
    const financialLabel = (item) => {
      if (item.situacao === 'vencido') return 'Vencido';
      if (item.status_financeiro === 'liquidado') return item.tipo === 'receita' ? 'Recebido' : 'Pago';
      return item.tipo === 'receita' ? 'A receber' : 'A pagar';
    };
    const nfTipoLabel = { fornecedor: 'Fornecedor', cliente: 'Cliente final' };

    const catOptions = [...new Set(lancamentos.map(l=>l.categoria))];
    let filtered = [...lancamentos];
    let sortDesc = true;
    let activeTab = 'detalhamento';
    let nfLoaded = false;
    let nfPorTipo = { fornecedor: [], cliente: [] };

    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
        reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
        reader.readAsDataURL(file);
      });
    }

    function renderList() {
      filtered.sort((a,b) => sortDesc ? Number(b.valor)-Number(a.valor) : Number(a.valor)-Number(b.valor));
      $('#center-detail-transactions').innerHTML = filtered.length ? filtered.map(l => `
        <tr>
          <td><strong>${esc(l.descricao)}</strong><br><span class="muted">${esc(l.categoria)} · ${fmtDate(l.data)}</span></td>
          <td data-label="Centro de custo">${esc(c.codigo)} — ${esc(c.nome)}</td>
          <td data-label="Documento">${esc(l.documento||'—')}</td>
          <td data-label="Status"><span class="pill ${esc(l.situacao)}">${esc(financialLabel(l))}</span></td>
          <td data-label="Valor" class="money" style="color:var(--${l.tipo==='receita'?'green':'red'})">${l.tipo==='receita'?'+':'-'} ${fmtMoney(l.valor)}</td>
        </tr>`).join('') : `<tr><td colspan="5"><div class="empty">Nenhum lançamento para este centro.</div></td></tr>`;
      $('#center-detail-count').textContent = `${filtered.length} lançamento(s)`;
    }

    function tabDetalhamentoHtml() {
      const aprovacao = orcado.hasBudget && orcado.contract?.approvedAt ? fmtDate(orcado.contract.approvedAt) : '—';
      return `
        <div class="center-detail-fields">
          <div><span class="center-stat-label">Cliente</span><strong>${esc(c.cliente || '—')}</strong></div>
          <div><span class="center-stat-label">Escopo do serviço</span><strong>${esc(c.descricao || '—')}</strong></div>
          <div><span class="center-stat-label">Data de início do serviço</span><strong>${fmtDate(c.data_inicio)}</strong></div>
          <div><span class="center-stat-label">Data de término</span><strong>${fmtDate(c.data_fim)}</strong></div>
          <div><span class="center-stat-label">Aprovação da proposta</span><strong>${aprovacao}</strong></div>
        </div>
        <div class="center-detail-proposal">
          <div class="center-detail-proposal-info">
            <span class="center-stat-label">Proposta comercial</span>
            <strong>${proposta ? esc(proposta.nome) : 'Nenhuma proposta anexada'}</strong>
          </div>
          <div class="center-detail-proposal-actions">
            ${proposta ? `<button type="button" class="text-btn" id="btn-baixar-proposta">Baixar</button>` : ''}
            ${canManage ? `<label class="btn secondary" id="lbl-anexar-proposta">${proposta ? 'Substituir' : 'Anexar'} proposta<input type="file" id="input-proposta" accept="application/pdf" hidden></label>` : ''}
            ${canManage && proposta ? `<button type="button" class="text-btn danger" id="btn-remover-proposta">Remover</button>` : ''}
          </div>
          <div id="proposta-erro" class="form-error"></div>
        </div>
        <div class="table-card"><div class="table-meta"><span id="center-detail-count">${lancamentos.length} lançamento(s)</span></div>
          ${catOptions.length ? `<div class="center-detail-filters">
            <select id="center-detail-cat-filter"><option value="">Todas as categorias</option>${catOptions.map(cat=>`<option value="${esc(cat)}">${esc(cat)}</option>`).join('')}</select>
            <select id="center-detail-sort"><option value="desc">Maior para menor</option><option value="asc">Menor para maior</option></select>
          </div>` : ''}
          <div class="table-scroll"><table class="cc-mobile-table"><thead><tr><th>Compra</th><th>Centro de custo</th><th>Documento</th><th>Status</th><th>Valor</th></tr></thead><tbody id="center-detail-transactions"></tbody></table></div>
        </div>
      `;
    }

    function nfCardsHtml(tipo) {
      const items = nfPorTipo[tipo];
      if (!items.length) return `<div class="empty">Nenhuma nota fiscal de ${nfTipoLabel[tipo].toLowerCase()} lançada.</div>`;
      return `<div class="table-scroll"><table class="cc-mobile-table"><thead><tr><th>Emissão</th><th>Valor</th><th>Status</th><th>Arquivo</th><th>Ações</th></tr></thead><tbody>
        ${items.map(nf => `<tr>
          <td>${fmtDate(nf.dataEmissao)}${nf.observacao?`<br><span class="muted">${esc(nf.observacao)}</span>`:''}</td>
          <td data-label="Valor" class="money">${fmtMoney(nf.valor)}</td>
          <td data-label="Status"><span class="pill ${nf.status==='paga'?'ativo':'vencido'}">${nf.status==='paga'?'Paga':'Não paga'}</span></td>
          <td data-label="Arquivo">${nf.temArquivo ? 'PDF anexado' : '—'}</td>
          <td data-label="Ações"><div class="row-actions">${canManage?`<button type="button" data-nf-toggle="${nf.id}" data-nf-tipo="${tipo}">${nf.status==='paga'?'Marcar não paga':'Marcar como paga'}</button><button type="button" data-nf-delete="${nf.id}" data-nf-tipo="${tipo}">Excluir</button>`:''}</div></td>
        </tr>`).join('')}
      </tbody></table></div>`;
    }

    function nfFormHtml(tipo) {
      return `<form class="nf-form" data-nf-form="${tipo}">
        <div><label>Data de emissão</label><input type="date" data-nf-field="dataEmissao"></div>
        <div><label>Valor (R$)</label><input type="number" min="0" step="0.01" required data-nf-field="valor"></div>
        <div><label class="check-label"><input type="checkbox" data-nf-field="paga"> Já paga</label></div>
        <div><label>Arquivo (PDF, opcional)</label><input type="file" accept="application/pdf" data-nf-field="arquivo"></div>
        <div id="nf-erro-${tipo}" class="form-error"></div>
        <button class="btn secondary" type="submit">Lançar NF de ${nfTipoLabel[tipo].toLowerCase()}</button>
      </form>`;
    }

    function tabNotasFiscaisHtml() {
      return `
        <div class="nf-section">
          <div class="nf-section-head"><h3>Fornecedor</h3></div>
          ${canManage ? nfFormHtml('fornecedor') : ''}
          <div id="nf-list-fornecedor">${nfCardsHtml('fornecedor')}</div>
        </div>
        <div class="nf-section">
          <div class="nf-section-head"><h3>Cliente final</h3></div>
          ${canManage ? nfFormHtml('cliente') : ''}
          <div id="nf-list-cliente">${nfCardsHtml('cliente')}</div>
        </div>
      `;
    }

    function tabOrcadoRealizadoHtml() {
      if (!orcado.hasBudget) {
        return `<div class="empty">${esc(orcado.message || 'Nenhum orçamento/baseline vigente encontrado para este centro de custo.')}</div>`;
      }
      const materialRealizado = orcado.items.filter(i=>i.kind==='material').reduce((s,i)=>s+Number(i.realizedCost||0),0);
      const laborRealizado = orcado.items.filter(i=>i.kind==='labor').reduce((s,i)=>s+Number(i.realizedCost||0),0);
      return `
        <div class="center-detail-kpis">
          <div class="center-detail-kpi"><span>Material estimado</span><strong>${fmtMoney(orcado.contract.materialsCost)}</strong></div>
          <div class="center-detail-kpi"><span>Mão de obra estimado</span><strong>${fmtMoney(orcado.contract.laborCost)}</strong></div>
          <div class="center-detail-kpi"><span>Material realizado</span><strong>${fmtMoney(materialRealizado)}</strong></div>
          <div class="center-detail-kpi"><span>Mão de obra realizado</span><strong>${fmtMoney(laborRealizado)}</strong></div>
        </div>
        <div class="center-detail-actions">
          <button type="button" class="btn primary" id="btn-ver-detalhamento-completo">Ver detalhamento completo</button>
        </div>
      `;
    }

    async function loadNf(tipo) {
      nfPorTipo[tipo] = await api(`/centros-custo/${id}/notas-fiscais?tipo=${tipo}`);
    }

    function bindNfSection(tipo) {
      const list = $(`#nf-list-${tipo}`);
      if (list) {
        list.innerHTML = nfCardsHtml(tipo);
        list.querySelectorAll(`[data-nf-toggle]`).forEach(btn => btn.addEventListener('click', async () => {
          const nf = nfPorTipo[tipo].find(item => item.id === Number(btn.dataset.nfToggle));
          try {
            await api(`/centros-custo/notas-fiscais/${btn.dataset.nfToggle}`, { method: 'PUT', body: JSON.stringify({ status: nf.status === 'paga' ? 'nao_paga' : 'paga' }) });
            await loadNf(tipo);
            bindNfSection(tipo);
            toast('Nota fiscal atualizada.');
          } catch (error) { toast(error.message, true); }
        }));
        list.querySelectorAll(`[data-nf-delete]`).forEach(btn => btn.addEventListener('click', async () => {
          if (!confirm('Excluir esta nota fiscal?')) return;
          try {
            await api(`/centros-custo/notas-fiscais/${btn.dataset.nfDelete}`, { method: 'DELETE' });
            await loadNf(tipo);
            bindNfSection(tipo);
            toast('Nota fiscal excluída.');
          } catch (error) { toast(error.message, true); }
        }));
      }
      const form = document.querySelector(`[data-nf-form="${tipo}"]`);
      if (form) form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const errorEl = $(`#nf-erro-${tipo}`);
        errorEl.textContent = '';
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        try {
          const fileInput = form.querySelector('[data-nf-field="arquivo"]');
          const file = fileInput.files[0] || null;
          const body = {
            tipo,
            dataEmissao: form.querySelector('[data-nf-field="dataEmissao"]').value || null,
            valor: Number(form.querySelector('[data-nf-field="valor"]').value),
            status: form.querySelector('[data-nf-field="paga"]').checked ? 'paga' : 'nao_paga',
          };
          if (file) {
            body.nome = file.name;
            body.tipoArquivo = file.type || 'application/pdf';
            body.conteudoBase64 = await fileToBase64(file);
          }
          await api(`/centros-custo/${id}/notas-fiscais`, { method: 'POST', body: JSON.stringify(body) });
          form.reset();
          await loadNf(tipo);
          bindNfSection(tipo);
          toast('Nota fiscal lançada.');
        } catch (error) { errorEl.textContent = error.message; }
        finally { submitBtn.disabled = false; }
      });
    }

    async function renderTab() {
      const body = $('#center-detail-tab-body');
      if (activeTab === 'detalhamento') {
        body.innerHTML = tabDetalhamentoHtml();
        renderList();
        const catFilter = $('#center-detail-cat-filter');
        const sortSelect = $('#center-detail-sort');
        if (catFilter) catFilter.addEventListener('change', () => {
          const val = catFilter.value;
          filtered = val ? lancamentos.filter(l => l.categoria === val) : [...lancamentos];
          renderList();
        });
        if (sortSelect) sortSelect.addEventListener('change', () => {
          sortDesc = sortSelect.value === 'desc';
          renderList();
        });
        $('#btn-baixar-proposta')?.addEventListener('click', () => download(`/centros-custo/${id}/proposta/arquivo`, proposta.nome));
        $('#input-proposta')?.addEventListener('change', async (event) => {
          const file = event.target.files[0];
          if (!file) return;
          const errorEl = $('#proposta-erro');
          errorEl.textContent = '';
          try {
            const conteudoBase64 = await fileToBase64(file);
            const result = await api(`/centros-custo/${id}/proposta`, { method: 'POST', body: JSON.stringify({ nome: file.name, tipo: file.type || 'application/pdf', conteudoBase64 }) });
            proposta = result.proposta;
            toast('Proposta anexada.');
            await renderTab();
          } catch (error) { errorEl.textContent = error.message; }
        });
        $('#btn-remover-proposta')?.addEventListener('click', async () => {
          if (!confirm('Remover a proposta anexada a este centro?')) return;
          try {
            await api(`/centros-custo/${id}/proposta`, { method: 'DELETE' });
            proposta = null;
            toast('Proposta removida.');
            await renderTab();
          } catch (error) { toast(error.message, true); }
        });
      } else if (activeTab === 'notas-fiscais') {
        if (!nfLoaded) { await Promise.all([loadNf('fornecedor'), loadNf('cliente')]); nfLoaded = true; }
        body.innerHTML = tabNotasFiscaisHtml();
        bindNfSection('fornecedor');
        bindNfSection('cliente');
      } else if (activeTab === 'orcado-realizado') {
        body.innerHTML = tabOrcadoRealizadoHtml();
        $('#btn-ver-detalhamento-completo')?.addEventListener('click', () => {
          document.getElementById('btn-ver-orcado-realizado')?.click();
        });
      }
    }

    modal('Centro de custo', `
      <div class="center-detail-header">
        <div><p class="eyebrow">Centro de custo</p><h2>${esc(c.codigo)} — ${esc(c.nome)}</h2><p class="muted">${esc(c.cliente||c.contrato||'—')}</p></div>
        <span class="pill center-status-pill ${statusClass}">${statusLabel}</span>
      </div>
      <div class="center-detail-kpis">
        <div class="center-detail-kpi"><span>Total do centro</span><strong>${fmtMoney(c.total_despesas)}</strong></div>
        <div class="center-detail-kpi"><span>Compras registradas</span><strong>${c.total_lancamentos}</strong></div>
        <div class="center-detail-kpi"><span>Orçamento</span><strong>${fmtMoney(c.orcamento)}</strong></div>
      </div>
      ${Number(c.orcamento)>0?`<div class="center-detail-budget"><div class="center-budget-header"><span>Uso do orçamento</span><strong>${Math.min(100,Math.round(Number(c.total_despesas)/Number(c.orcamento)*100))}%</strong></div><div class="center-progress"><div class="center-progress-bar" style="width:${Math.min(100,Number(c.total_despesas)/Number(c.orcamento)*100)}%"></div></div></div>`:''}
      <div class="center-detail-actions">
        ${canManage?`<button class="btn secondary" onclick="closeModal();openCenter(centros.find(x=>x.id===${c.id}))">Editar centro e status</button>`:''}
      </div>
      <nav class="measurements-tabs" role="tablist" aria-label="Detalhamento do centro de custo">
        <button type="button" role="tab" class="measurements-tab-btn active" data-cc-tab="detalhamento" aria-selected="true">Detalhamento</button>
        <button type="button" role="tab" class="measurements-tab-btn" data-cc-tab="notas-fiscais" aria-selected="false">Notas fiscais</button>
        <button type="button" role="tab" class="measurements-tab-btn" data-cc-tab="orcado-realizado" aria-selected="false">Orçado x Realizado</button>
      </nav>
      <div id="center-detail-tab-body"></div>
    `);

    document.querySelectorAll('[data-cc-tab]').forEach(btn => btn.addEventListener('click', async () => {
      document.querySelectorAll('[data-cc-tab]').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      activeTab = btn.dataset.ccTab;
      await renderTab();
    }));

    await renderTab();
  } catch (error) { toast(error.message, true); }
}
```

- [ ] **Step 2: Adicionar CSS novo em `public/style-base.css`**

Append ao final do arquivo (mesmo padrão de uma linha por bloco já usado no arquivo):

```css
.center-detail-fields{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:16px;background:#f7f9f9;border-radius:10px;padding:16px;border:1px solid var(--line)}.center-detail-proposal{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;margin-bottom:16px;padding:14px 16px;background:#fff;border:1px solid var(--line);border-radius:10px}.center-detail-proposal-info{display:flex;flex-direction:column;gap:2px;flex:1;min-width:180px}.center-detail-proposal-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.center-detail-proposal-actions label.btn{cursor:pointer;margin:0}.nf-section{margin-bottom:24px}.nf-section-head h3{margin:0 0 10px;font-size:15px}.nf-form{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;align-items:end;margin-bottom:14px;padding:14px;background:#f7f9f9;border-radius:10px;border:1px solid var(--line)}.nf-form label{display:block;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:4px}.nf-form .form-error{grid-column:1/-1}.nf-form button{grid-column:1/-1;justify-self:start}
@media (max-width: 800px){.center-detail-fields{grid-template-columns:1fr}.nf-form{grid-template-columns:1fr}}
```

- [ ] **Step 3: Verificar a sintaxe**

Run: `node scripts/check-syntax.js`
Expected: sem erros (87+ arquivos, incluindo `public/app.js`)

- [ ] **Step 4: QA visual em instância descartável**

Seguir o padrão já usado nesta sessão: `node scripts/start-visual-demo.js` (login `admin@construtec.local` / `admin-demo-123`), abrir portal Maestri em mobile (390x844) e desktop (1600x900), abrir um centro de custo existente e confirmar:
- Aba "Detalhamento" mostra os campos novos e o bloco de proposta; upload/baixar/remover funcionam.
- Aba "Notas fiscais" lista/cria/marca como paga/exclui em ambos os grupos (fornecedor/cliente).
- Aba "Orçado x Realizado" mostra os 4 números quando há baseline, e a mensagem quando não há; o botão "Ver detalhamento completo" abre o modal existente de orçado vs. realizado.
- Desktop permanece pixel-a-pixel igual fora do modal (nenhuma tela de lista foi tocada).

Encerrar a instância descartável ao final.

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/style-base.css
git commit -m "feat: reestrutura detalhamento de centro de custo em 3 abas"
```

---

### Task 5: Regressão completa e fechamento

**Files:** nenhum arquivo novo — só validação.

- [ ] **Step 1: Rodar a suíte completa**

Run: `node --test`
Expected: todos os testes passam, incluindo os 3 arquivos novos das Tasks 1-3 e a suíte de orçamento/E2E existente.

- [ ] **Step 2: Rodar o checador de sintaxe**

Run: `node scripts/check-syntax.js`
Expected: sem erros em nenhum arquivo do projeto.

- [ ] **Step 3: QA visual final (se ainda não feito na Task 4)**

Confirmar mobile (390x844) e desktop (1600x900) via portal Maestri em instância descartável, cobrindo os 3 fluxos completos: detalhamento+proposta, notas fiscais (ambos os tipos), orçado x realizado (com e sem baseline). Encerrar a instância ao final.

- [ ] **Step 4: Atualizar `docs/notas-desenvolvimento/ROADMAP-RESTANTE.md` e `TASKS.md`/`STATUS.md` do workspace**

Registrar a conclusão da tarefa (arquivos alterados, commits, resultado da QA) seguindo o padrão já usado nas entradas anteriores desta sessão.

- [ ] **Step 5: Perguntar ao usuário se deve publicar (deploy) e, se sim, publicar**

Este projeto é servido tanto localmente quanto via `cloudflare/center-container` (Cloudflare Container). Antes de publicar, mostrar ao usuário o resumo do que muda e pedir confirmação explícita — mesmo padrão desta sessão (nunca fazer deploy sem confirmação).

---

## Self-Review

**Cobertura do spec:**
- Aba 1 (cliente, obra, escopo, datas, aprovação, proposta) → Task 4, `tabDetalhamentoHtml()`. ✓
- Aba 2 (NF fornecedor/cliente, várias por centro, arquivo opcional, data/valor/status) → Tasks 2 e 4. ✓
- Aba 3 (4 números + botão para detalhamento completo) → Tasks 3 e 4. ✓
- Reaproveitar apropriação existente, sem mudar categorização → nenhuma task toca `categories`/`category_id`. ✓
- `cost_center_invoices` intocado → nenhuma task o referencia. ✓
- Upload manual da proposta, sem geração automática → Task 1 só implementa upload. ✓
- Modal "Orçado vs. Realizado" existente não é substituído → Task 4 aciona `#btn-ver-orcado-realizado` em vez de recriar a lógica. ✓

**Simplificação encontrada durante o planejamento:** o spec original previa ler `approvedAt` de dentro do payload JSON de `budget_imports`; a Task 3 usa a coluna `budget_baselines.sealed_at`, que já armazena exatamente esse valor desde a importação (`services/budgets/budgetImportService.js:244`) — uma linha a mais na query em vez de descompactar JSON.

**Placeholders:** nenhum "TBD"/"implementar depois" — todo código de cada step está completo e poderia ser copiado e colado diretamente.

**Consistência de tipos/nomes:** `publicProposal`/`publicLedgerEntry` (backend) → `proposta`/`nfPorTipo` (frontend) usam exatamente os mesmos nomes de campo (`nome`, `tamanho`, `temArquivo`, `dataEmissao`, `valor`, `status`, `observacao`) em todas as tasks.
