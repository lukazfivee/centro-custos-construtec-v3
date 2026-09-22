const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('F2.2 & F2.3 - Ingestão Transacional e Idempotente de Baselines no Centro de Custos', async context => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-budget-import-test-'));
  process.env.DATABASE_URL = '';
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'budget-import-test-secret-at-least-32-chars';
  process.env.ADMIN_INITIAL_PASSWORD = 'budget-test-123';
  process.env.ADMIN_INITIAL_EMAIL = 'budget@teste.local';

  const { initializeDatabase, closeDatabase, getDb } = require('../db');
  const { createApp } = require('../server');

  let server;
  context.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await closeDatabase();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  await initializeDatabase();
  server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const db = getDb();

  async function request(route, method = 'GET', body, status = 200, token = auth, extraHeaders = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...extraHeaders,
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(base + route, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    assert.equal(response.status, status, text);
    return response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text;
  }

  let auth = (await request('/auth/login', 'POST', { email: 'budget@teste.local', senha: 'budget-test-123' }, 200, '')).token;

  // Carregar fixture normativa oficial
  const fixturePath = path.resolve(__dirname, 'fixtures/proposal-approved.v1.example.json');
  const officialEnvelope = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  let previewId = null;
  let confirmedHash = officialEnvelope.payloadSha256;

  await context.test('1. Prévia valida integridade, hash SHA-256 e propõe centro de custo planejamento', async () => {
    const preview = await request('/integracao/orcamentos/previas', 'POST', officialEnvelope, 200);

    assert.equal(preview.status, 'ready');
    assert.equal(preview.hash, confirmedHash);
    assert.equal(preview.isDuplicate, false);
    assert.equal(preview.isReplacement, false);
    assert.ok(preview.targetCostCenter.code.startsWith('CC-PA-1001'));
    assert.ok(preview.targetCostCenter.name.includes('PA-1001'));
    assert.equal(preview.materialsCount, 1);
    assert.equal(preview.laborCount, 1);
    assert.equal(preview.totals.contractValue, '3450.00');

    previewId = preview.previewId;
    assert.ok(previewId);
  });

  await context.test('2. Rejeição de hash adulterado na prévia (422)', async () => {
    const tampered = JSON.parse(JSON.stringify(officialEnvelope));
    tampered.payloadSha256 = '0000000000000000000000000000000000000000000000000000000000000000';
    await request('/integracao/orcamentos/previas', 'POST', tampered, 422);
  });

  let importResult = null;
  await context.test('3. Confirmação transacional cria obra, contrato, baseline e linhas de controle', async () => {
    importResult = await request(`/integracao/orcamentos/previas/${previewId}/confirmar`, 'POST', {
      hash: confirmedHash,
    }, 201);

    assert.equal(importResult.status, 'imported');
    assert.ok(importResult.importId);
    assert.ok(importResult.contractId);
    assert.ok(importResult.baselineId);
    assert.ok(importResult.costCenterId);

    // Verificar centro de custo criado
    const ccRes = await db.query('SELECT * FROM cost_centers WHERE id = $1', [importResult.costCenterId]);
    const cc = ccRes.rows[0];
    assert.equal(cc.project_status, 'planejamento');
    assert.equal(Number(cc.contract_amount), 3450.00);
    assert.equal(Number(cc.monthly_budget), 0);

    // Verificar que NENHUMA despesa realizada foi criada
    const txRes = await db.query('SELECT count(*)::int AS total FROM transactions WHERE cost_center_id = $1', [importResult.costCenterId]);
    assert.equal(txRes.rows[0].total, 0, 'Nenhuma transação financeira deve ser criada na importação do orçamento');

    // Verificar contrato
    const contractRes = await db.query('SELECT * FROM project_contracts WHERE id = $1', [importResult.contractId]);
    const contract = contractRes.rows[0];
    assert.equal(contract.number, 'PA-1001');
    assert.equal(contract.current_baseline_id, importResult.baselineId);

    // Verificar baseline e linhas
    const baselineRes = await db.query('SELECT * FROM budget_baselines WHERE id = $1', [importResult.baselineId]);
    const baseline = baselineRes.rows[0];
    assert.equal(Number(baseline.materials_cost), 1000.00);
    assert.equal(Number(baseline.labor_cost), 1760.00);
    assert.equal(Number(baseline.base_cost), 2760.00);
    assert.equal(Number(baseline.contract_value), 3450.00);

    const matLines = await db.query('SELECT count(*)::int AS total FROM budget_material_lines WHERE baseline_id = $1', [importResult.baselineId]);
    assert.equal(matLines.rows[0].total, 1);

    const laborLines = await db.query('SELECT count(*)::int AS total FROM budget_labor_lines WHERE baseline_id = $1', [importResult.baselineId]);
    assert.equal(laborLines.rows[0].total, 1);

    // Testar imutabilidade da baseline
    await assert.rejects(
      db.query("UPDATE budget_baselines SET materials_cost = 0 WHERE id = $1", [importResult.baselineId]),
      /BASELINE_LOCKED/,
    );
    await assert.rejects(
      db.query("DELETE FROM budget_baselines WHERE id = $1", [importResult.baselineId]),
      /BASELINE_LOCKED/,
    );
  });

  await context.test('4. Idempotência estrita: reimportar o mesmo envelope retorna recurso existente (200)', async () => {
    const directReimport = await request('/integracao/orcamentos/confirmar-direto', 'POST', officialEnvelope, 200);
    assert.equal(directReimport.status, 'already_imported');
    assert.equal(directReimport.isDuplicate, true);
    assert.equal(directReimport.importId, importResult.importId);
    assert.equal(directReimport.contractId, importResult.contractId);

    // Garantir que não duplicou obras nem baselines
    const ccCount = await db.query("SELECT count(*)::int AS total FROM cost_centers WHERE code LIKE 'CC-PA-1001%'");
    assert.equal(ccCount.rows[0].total, 1);

    const baselinesCount = await db.query('SELECT count(*)::int AS total FROM budget_baselines WHERE contract_id = $1', [importResult.contractId]);
    assert.equal(baselinesCount.rows[0].total, 1);
  });

  await context.test('5. Replacement (F2.5): rejeição quando predecessor não coincide com versão vigente (422)', async () => {
    const { canonicalJsonStringify, computeSha256 } = require('../services/budgets/budgetCanonical');
    const rev1 = JSON.parse(JSON.stringify(officialEnvelope));
    rev1.eventId = require('crypto').randomUUID();
    rev1.payload.proposal.id = require('crypto').randomUUID();
    rev1.payload.proposal.revision = 1;
    rev1.payload.proposal.change = {
      kind: 'replacement',
      baseRevision: 99, // Incorreto, vigente é 0
      basePayloadSha256: officialEnvelope.payloadSha256,
    };
    rev1.payloadSha256 = computeSha256(canonicalJsonStringify(rev1.payload));

    await request('/integracao/orcamentos/confirmar-direto', 'POST', rev1, 422);
  });

  await context.test('6. Replacement (F2.5): aplicação de REV01 preserva histórico, reconcilia itens e atualiza baseline vigente', async () => {
    const { canonicalJsonStringify, computeSha256 } = require('../services/budgets/budgetCanonical');
    const rev1 = JSON.parse(JSON.stringify(officialEnvelope));
    rev1.eventId = require('crypto').randomUUID();
    rev1.payload.proposal.id = require('crypto').randomUUID();
    rev1.payload.proposal.revision = 1;
    rev1.payload.proposal.change = {
      kind: 'replacement',
      baseRevision: 0,
      basePayloadSha256: officialEnvelope.payloadSha256,
    };
    // Modificar quantidade do material (de 100 para 150)
    rev1.payload.materials[0].quantity = '150.0000';
    rev1.payload.materials[0].totalCost = '1500.00';
    rev1.payload.materials[0].sourceTotalSale = '1875.00';
    rev1.payload.materials[0].allocatedSale = '1875.00';

    // Recalcular totais: baseCost = 1500 + 1760 = 3260, contractValue = 3260 * 1.25 = 4075, additions = 815
    rev1.payload.totals.materialsCost = '1500.00';
    rev1.payload.totals.baseCost = '3260.00';
    rev1.payload.totals.contractValue = '4075.00';
    rev1.payload.totals.additions = '815.00';
    rev1.payloadSha256 = computeSha256(canonicalJsonStringify(rev1.payload));

    // Prévia deve reconhecer replacement
    const previewRev1 = await request('/integracao/orcamentos/previas', 'POST', rev1, 200);
    assert.equal(previewRev1.isReplacement, true);
    assert.equal(previewRev1.targetCostCenter.id, importResult.costCenterId);

    // Confirmar REV01
    const confirmRev1 = await request('/integracao/orcamentos/confirmar-direto', 'POST', rev1, 201);
    assert.equal(confirmRev1.status, 'imported');
    assert.equal(confirmRev1.contractId, importResult.contractId, 'Deve manter o mesmo contrato');
    assert.equal(confirmRev1.costCenterId, importResult.costCenterId, 'Deve manter a mesma obra');
    assert.notEqual(confirmRev1.baselineId, importResult.baselineId, 'Deve criar uma nova baseline');

    // Verificar histórico de baselines
    const allBaselines = await db.query(
      'SELECT id, version, predecessor_id, contract_value FROM budget_baselines WHERE contract_id = $1 ORDER BY version ASC',
      [importResult.contractId]
    );
    assert.equal(allBaselines.rows.length, 2);
    assert.equal(allBaselines.rows[0].version, 0);
    assert.equal(allBaselines.rows[1].version, 1);
    assert.equal(allBaselines.rows[1].predecessor_id, allBaselines.rows[0].id);

    // Verificar ponteiro de baseline vigente
    const contractCheck = await db.query('SELECT current_baseline_id FROM project_contracts WHERE id = $1', [importResult.contractId]);
    assert.equal(contractCheck.rows[0].current_baseline_id, confirmRev1.baselineId);

    // Verificar reajuste do contract_amount na obra
    const ccCheck = await db.query('SELECT contract_amount FROM cost_centers WHERE id = $1', [importResult.costCenterId]);
    assert.equal(Number(ccCheck.rows[0].contract_amount), 4075.00);

    // Verificar reconciliação dos itens de controle (mesmo control_item_id reutilizado entre REV00 e REV01)
    const controlItems = await db.query('SELECT id, kind, name FROM budget_control_items WHERE contract_id = $1', [importResult.contractId]);
    assert.equal(controlItems.rows.length, 2, 'Não deve duplicar os itens de controle para o mesmo material e função');
  });

  await context.test('8. Sincronização direta via /sync-direto autenticada por X-Construtec-Integration-Key sem token JWT', async () => {
    // 1. Chave errada deve ser rejeitada com 401
    await request(
      '/integracao/orcamentos/sync-direto',
      'POST',
      officialEnvelope,
      401,
      '',
      { 'x-construtec-integration-key': 'chave-invalida' }
    );

    // 2. Chave válida com proposta já existente retorna 200 e status already_imported
    const directRes = await request(
      '/integracao/orcamentos/sync-direto',
      'POST',
      officialEnvelope,
      200,
      '',
      { 'x-construtec-integration-key': 'construtec-internal-integration-secret-2026' }
    );
    assert.equal(directRes.ok, true);
    assert.equal(directRes.status, 'already_imported');
    assert.equal(directRes.isDuplicate, true);
  });
});
