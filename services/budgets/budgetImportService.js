const crypto = require('crypto');
const { validateProposalEnvelope, computeSha256, canonicalJsonStringify } = require('./budgetCanonical');
const { previewImport } = require('./budgetImportPreview');
const { recordAudit } = require('../audit');
const logger = require('../../lib/logger');
const metrics = require('../../lib/metrics');

async function confirmImport(db, params, userId) {
  const { previewId, confirmedHash, costCenterId, envelope } = params;

  let payload = null;
  let eventId = null;

  if (previewId) {
    const previewRes = await db.query(
      'SELECT id, payload, hash, status, expires_at FROM budget_import_previews WHERE id = $1',
      [previewId]
    );
    const preview = previewRes.rows[0];
    if (!preview) throw new Error('PREVIEW_NOT_FOUND: Prévia não encontrada');
    if (preview.status !== 'ready') throw new Error(`PREVIEW_NOT_READY: Status da prévia é ${preview.status}`);
    if (new Date(preview.expires_at) < new Date()) throw new Error('PREVIEW_EXPIRED: Prévia expirada');
    if (confirmedHash && preview.hash.toLowerCase() !== confirmedHash.toLowerCase()) {
      throw new Error('CONFIRMED_HASH_MISMATCH: Hash confirmado não coincide com o da prévia');
    }
    payload = typeof preview.payload === 'string' ? JSON.parse(preview.payload) : preview.payload;
  } else if (envelope) {
    const { computedHash } = validateProposalEnvelope(envelope);
    if (confirmedHash && computedHash.toLowerCase() !== confirmedHash.toLowerCase()) {
      throw new Error('CONFIRMED_HASH_MISMATCH: Hash confirmado não coincide com o envelope');
    }
    payload = envelope.payload;
    eventId = envelope.eventId || null;
  } else {
    throw new Error('PARAM_MISSING: previewId ou envelope é obrigatório para confirmação');
  }

  const { source, proposal, client, work, pricing, totals, materials, labor } = payload;
  const hash = confirmedHash || computeSha256(canonicalJsonStringify(payload));

  return db.transaction(async (tx) => {
    // 1. Idempotência / Lock de Importação
    const checkImport = await tx.query(`
      SELECT id, contract_id, payload_hash,
        (SELECT cost_center_id FROM project_contracts WHERE id = budget_imports.contract_id) AS cost_center_id,
        (SELECT id FROM budget_baselines WHERE import_id = budget_imports.id) AS baseline_id
      FROM budget_imports
      WHERE source_system = $1 AND namespace_id = $2 AND series_id = $3 AND source_revision = $4
      FOR UPDATE
    `, [source.system, source.namespaceId, proposal.seriesId, proposal.revision]);

    if (checkImport.rows[0]) {
      const existing = checkImport.rows[0];
      if (existing.payload_hash === hash) {
        return {
          status: 'already_imported', isDuplicate: true,
          costCenterId: existing.cost_center_id,
          baselineId: existing.baseline_id,
          importId: existing.id,
          contractId: existing.contract_id,
        };
      }
      const err = new Error('CONFLICT_REVISION_HASH_MISMATCH: Revisão já importada com hash diferente');
      err.statusCode = 409;
      throw err;
    }

    // 2. Resolver Contrato e Centro de Custo
    const contractRes = await tx.query(`
      SELECT id, cost_center_id, current_baseline_id
      FROM project_contracts
      WHERE source_system = $1 AND namespace_id = $2 AND series_id = $3
      FOR UPDATE
    `, [source.system, source.namespaceId, proposal.seriesId]);

    let contractId;
    let resolvedCostCenterId;
    let predecessorBaselineId = null;

    if (contractRes.rows[0]) {
      contractId = contractRes.rows[0].id;
      resolvedCostCenterId = contractRes.rows[0].cost_center_id;
      predecessorBaselineId = contractRes.rows[0].current_baseline_id;

      if (proposal.change?.kind === 'replacement' && predecessorBaselineId) {
        const predRes = await tx.query(
          'SELECT b.version, bi.payload_hash FROM budget_baselines b JOIN budget_imports bi ON bi.id = b.import_id WHERE b.id = $1',
          [predecessorBaselineId]
        );
        const pred = predRes.rows[0];
        if (pred) {
          if (proposal.change.baseRevision != null && pred.version !== proposal.change.baseRevision) {
            const err = new Error(`PREDECESSOR_VERSION_MISMATCH: A versão vigente (${pred.version}) difere da anunciada (${proposal.change.baseRevision})`);
            err.statusCode = 422;
            throw err;
          }
          if (proposal.change.basePayloadSha256 && pred.payload_hash.toLowerCase() !== proposal.change.basePayloadSha256.toLowerCase()) {
            const err = new Error('PREDECESSOR_HASH_MISMATCH: O hash da versão base não confere com o histórico');
            err.statusCode = 422;
            throw err;
          }
        }
      }
    } else {
      if (costCenterId) {
        const ccCheck = await tx.query('SELECT id FROM cost_centers WHERE id = $1 FOR UPDATE', [costCenterId]);
        if (!ccCheck.rows[0]) throw new Error('COST_CENTER_NOT_FOUND');
        resolvedCostCenterId = costCenterId;
      } else {
        const baseCode = `CC-${proposal.number}`;
        let code = baseCode;
        const checkCode = await tx.query('SELECT id FROM cost_centers WHERE LOWER(code) = LOWER($1)', [code]);
        if (checkCode.rows[0]) {
          code = `${baseCode}-${String(Date.now()).slice(-4)}`;
        }
        const clientName = client.tradeName || client.legalName;
        const name = `${proposal.number} - ${clientName} - ${work.name}`.slice(0, 140);
        const newCc = await tx.query(`
          INSERT INTO cost_centers
            (public_id, code, name, responsible, monthly_budget, active, client, contract_number, contract_amount, project_status)
          VALUES ($1, $2, $3, $4, 0, true, $5, $6, $7, 'planejamento')
          RETURNING id
        `, [
          crypto.randomUUID(),
          code,
          name,
          proposal.responsibleName || null,
          clientName,
          proposal.number,
          Number(totals.contractValue),
        ]);
        resolvedCostCenterId = newCc.rows[0].id;
      }

      contractId = crypto.randomUUID();
      await tx.query(`
        INSERT INTO project_contracts
          (id, cost_center_id, source_system, namespace_id, series_id, number, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'active')
      `, [contractId, resolvedCostCenterId, source.system, source.namespaceId, proposal.seriesId, proposal.number]);
    }

    // 3. Registrar importação
    const importId = crypto.randomUUID();
    await tx.query(`
      INSERT INTO budget_imports
        (id, source_system, namespace_id, series_id, source_proposal_id, source_revision, payload_hash, payload, imported_by, contract_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
    `, [
      importId,
      source.system,
      source.namespaceId,
      proposal.seriesId,
      proposal.id,
      proposal.revision,
      hash,
      JSON.stringify(payload),
      userId || null,
      contractId,
    ]);

    if (eventId) {
      await tx.query(`
        INSERT INTO budget_import_events
          (id, namespace_id, event_id, import_id, payload_hash)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (namespace_id, event_id) DO NOTHING
      `, [crypto.randomUUID(), source.namespaceId, eventId, importId, hash]);
    }

    // 4. Mapear / Criar Itens de Controle
    const controlItemMap = new Map();

    for (const item of (materials || [])) {
      const key = `material:${item.code}:${item.description}`;
      if (!controlItemMap.has(key)) {
        const existing = await tx.query(`
          SELECT id FROM budget_control_items
          WHERE contract_id = $1 AND kind = 'material' AND (canonical_code = $2 OR name = $3)
          LIMIT 1
        `, [contractId, item.code, item.description]);

        let controlItemId;
        if (existing.rows[0]) {
          controlItemId = existing.rows[0].id;
        } else {
          controlItemId = crypto.randomUUID();
          await tx.query(`
            INSERT INTO budget_control_items
              (id, contract_id, kind, canonical_code, name, unit, active)
            VALUES ($1, $2, 'material', $3, $4, $5, true)
          `, [controlItemId, contractId, item.code, item.description, item.unit]);
        }
        controlItemMap.set(key, controlItemId);
      }
    }

    for (const l of (labor || [])) {
      const key = `labor:${l.roleName}`;
      if (!controlItemMap.has(key)) {
        const existing = await tx.query(`
          SELECT id FROM budget_control_items
          WHERE contract_id = $1 AND kind = 'labor' AND name = $2
          LIMIT 1
        `, [contractId, l.roleName]);

        let controlItemId;
        if (existing.rows[0]) {
          controlItemId = existing.rows[0].id;
        } else {
          controlItemId = crypto.randomUUID();
          await tx.query(`
            INSERT INTO budget_control_items
              (id, contract_id, kind, canonical_code, name, unit, active)
            VALUES ($1, $2, 'labor', null, $3, 'h', true)
          `, [controlItemId, contractId, l.roleName]);
        }
        controlItemMap.set(key, controlItemId);
      }
    }

    // 5. Inserir Baseline
    const baselineId = crypto.randomUUID();
    await tx.query(`
      INSERT INTO budget_baselines
        (id, contract_id, import_id, version, predecessor_id, client_snapshot, work_snapshot,
         pricing, materials_cost, labor_cost, base_cost, contract_value, additions, sales_rounding_adjustment, sealed_at)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13, $14, $15)
    `, [
      baselineId,
      contractId,
      importId,
      proposal.revision,
      predecessorBaselineId,
      JSON.stringify(client),
      JSON.stringify(work),
      JSON.stringify(pricing),
      totals.materialsCost,
      totals.laborCost,
      totals.baseCost,
      totals.contractValue,
      totals.additions,
      totals.salesRoundingAdjustment,
      proposal.approval?.approvedAt || new Date().toISOString(),
    ]);

    // 6. Inserir Linhas de Materiais
    for (const item of (materials || [])) {
      const controlItemId = controlItemMap.get(`material:${item.code}:${item.description}`);
      await tx.query(`
        INSERT INTO budget_material_lines
          (id, baseline_id, control_item_id, source_line_id, position, code, description,
           category, unit, quantity, unit_cost, total_cost, source_unit_sale, source_total_sale, allocated_sale)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `, [
        crypto.randomUUID(),
        baselineId,
        controlItemId,
        item.id,
        item.position,
        item.code,
        item.description,
        item.category || 'Geral',
        item.unit,
        item.quantity,
        item.unitCost,
        item.totalCost,
        item.sourceUnitSale || null,
        item.sourceTotalSale || null,
        item.allocatedSale,
      ]);
    }

    // 7. Inserir Linhas de Mão de Obra
    for (const l of (labor || [])) {
      const controlItemId = controlItemMap.get(`labor:${l.roleName}`);
      const comp = l.compensation || {};
      await tx.query(`
        INSERT INTO budget_labor_lines
          (id, baseline_id, control_item_id, source_line_id, position, role_name, cost_basis,
           professional_count, planned_hours_per_professional, planned_team_hours,
           monthly_salary, monthly_food, monthly_transport, monthly_other_costs,
           standard_monthly_hours, hourly_rate, total_cost, allocated_sale)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      `, [
        crypto.randomUUID(),
        baselineId,
        controlItemId,
        l.id,
        l.position,
        l.roleName,
        l.costBasis || 'composition',
        l.professionalCount,
        l.plannedHoursPerProfessional,
        l.plannedTeamHours,
        comp.monthlySalary || l.monthlySalary || null,
        comp.monthlyFood || l.monthlyFood || null,
        comp.monthlyTransport || l.monthlyTransport || null,
        comp.monthlyOtherCosts || l.monthlyOtherCosts || null,
        comp.standardMonthlyHours || l.standardMonthlyHours || null,
        l.hourlyRate,
        l.totalCost,
        l.allocatedSale,
      ]);
    }

    // 8. Atualizar ponteiro vigente do contrato
    await tx.query('UPDATE project_contracts SET current_baseline_id = $1 WHERE id = $2', [baselineId, contractId]);

    // 9. Atualizar contract_amount do centro de custo
    await tx.query(`
      UPDATE cost_centers
      SET contract_amount = (
        SELECT COALESCE(SUM(b.contract_value), 0)
        FROM project_contracts pc
        JOIN budget_baselines b ON b.id = pc.current_baseline_id
        WHERE pc.cost_center_id = $1 AND pc.status = 'active'
      ), updated_at = now()
      WHERE id = $1
    `, [resolvedCostCenterId]);

    // 10. Atualizar prévia se existir
    if (previewId) {
      await tx.query("UPDATE budget_import_previews SET status = 'applied' WHERE id = $1", [previewId]);
    }

    // 11. Auditoria
    await recordAudit({
      entityType: 'budget_import',
      entityId: importId,
      action: 'confirmed',
      summary: `Importada revisão ${proposal.revision} da proposta ${proposal.number}`,
      data: { importId, contractId, baselineId, costCenterId: resolvedCostCenterId, hash },
      user: { id: userId, name: 'Sistema' },
      client: tx,
    });

    return {
      status: 'imported',
      importId,
      contractId,
      baselineId,
      costCenterId: resolvedCostCenterId,
      isDuplicate: false,
    };
  });
}

// Mantém confirmImport() 100% síncrono (contrato usado pela integração
// direta com o Construtec Orçamentos e pela UI de prévias — ver DECISIONS.md
// sobre por que essa rota não virou fila/job), mas adiciona timeout e
// observabilidade (log + metrics.recordJob, reaproveitando a mesma seção
// "jobs" do snapshot de métricas) para importações de propostas grandes que
// escalam mal (loops de materiais/mão de obra descritos na auditoria).
const CONFIRM_IMPORT_TIMEOUT_MS = Number(process.env.BUDGET_IMPORT_TIMEOUT_MS || 60_000);

async function confirmImportWithObservability(db, params, userId) {
  const startedAt = process.hrtime.bigint();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('TIMEOUT: A confirmação da importação excedeu o tempo limite.');
      error.statusCode = 504;
      reject(error);
    }, CONFIRM_IMPORT_TIMEOUT_MS);
    timer.unref?.();
  });
  try {
    const result = await Promise.race([confirmImport(db, params, userId), timeout]);
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    metrics.recordJob({ type: 'budget-import', status: 'succeeded', durationMs });
    logger.info('budget_import_confirmed', {
      durationMs: Math.round(durationMs * 100) / 100, status: result.status, importId: result.importId,
    });
    return result;
  } catch (error) {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    metrics.recordJob({ type: 'budget-import', status: 'failed', durationMs });
    logger.warn('budget_import_failed', { durationMs: Math.round(durationMs * 100) / 100, error });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  previewImport,
  confirmImport,
  confirmImportWithObservability,
};
