const crypto = require('crypto');

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function canonicalJsonStringify(object) {
  if (object === null || typeof object !== 'object') {
    return JSON.stringify(object);
  }
  if (Array.isArray(object)) {
    return '[' + object.map(item => canonicalJsonStringify(item)).join(',') + ']';
  }
  const keys = Object.keys(object).sort();
  const pairs = keys.map(key => `${JSON.stringify(key)}:${canonicalJsonStringify(object[key])}`);
  return '{' + pairs.join(',') + '}';
}

function computeSha256(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function validateProposalEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    throw new Error('ENVELOPE_INVALID: Envelope deve ser um objeto JSON');
  }
  if (envelope.schemaVersion !== '1.0.0') {
    throw new Error(`SCHEMA_VERSION_UNSUPPORTED: Versão ${envelope.schemaVersion} não suportada`);
  }
  if (!envelope.payloadSha256 || typeof envelope.payloadSha256 !== 'string') {
    throw new Error('HASH_MISSING: payloadSha256 é obrigatório');
  }
  if (!envelope.payload || typeof envelope.payload !== 'object') {
    throw new Error('PAYLOAD_MISSING: payload é obrigatório');
  }

  // Verificar hash SHA-256 canônico
  const canonical = canonicalJsonStringify(envelope.payload);
  const computedHash = computeSha256(canonical);
  if (computedHash.toLowerCase() !== envelope.payloadSha256.toLowerCase()) {
    throw new Error(`HASH_MISMATCH: Hash calculado (${computedHash}) diverge do anunciado (${envelope.payloadSha256})`);
  }

  const { source, proposal, client, work, pricing, totals, materials, labor } = envelope.payload;

  if (!source?.system || !source?.namespaceId) {
    throw new Error('SOURCE_INVALID: source.system e source.namespaceId são obrigatórios');
  }
  if (!proposal?.id || !proposal?.seriesId || !proposal?.number || proposal.revision == null) {
    throw new Error('PROPOSAL_IDENTITY_INVALID: id, seriesId, number e revision são obrigatórios');
  }
  if (proposal.status !== 'approved') {
    throw new Error(`PROPOSAL_STATUS_INVALID: Apenas propostas aprovadas podem ser integradas (atual: ${proposal.status})`);
  }
  if (!client?.sourceId || (!client?.legalName && !client?.tradeName)) {
    throw new Error('CLIENT_INVALID: Cliente deve possuir identificação e nome');
  }
  if (!work?.name) {
    throw new Error('WORK_INVALID: Obra deve possuir nome');
  }
  if (!totals || typeof totals !== 'object') {
    throw new Error('TOTALS_MISSING: Totais financeiros são obrigatórios');
  }

  // Validação aritmética de materiais
  let sumMaterialsCost = 0;
  let sumMaterialsAllocated = 0;
  if (Array.isArray(materials)) {
    for (const item of materials) {
      const qty = Number(item.quantity);
      const cost = Number(item.unitCost);
      const totCost = Number(item.totalCost);
      if (qty <= 0) throw new Error(`MATERIAL_QTY_INVALID: Quantidade deve ser positiva no item ${item.position || item.code}`);
      if (cost < 0) throw new Error(`MATERIAL_COST_INVALID: Custo unitário não pode ser negativo no item ${item.position || item.code}`);
      const expectedTotCost = roundMoney(qty * cost);
      if (Math.abs(expectedTotCost - totCost) > 0.05) {
        throw new Error(`MATERIAL_ARITHMETIC_MISMATCH: Total do item ${item.code} (${totCost}) difere de qtd * custo (${expectedTotCost})`);
      }
      sumMaterialsCost = roundMoney(sumMaterialsCost + totCost);
      sumMaterialsAllocated = roundMoney(sumMaterialsAllocated + Number(item.allocatedSale || 0));
    }
  }

  // Validação aritmética de mão de obra
  let sumLaborCost = 0;
  let sumLaborAllocated = 0;
  if (Array.isArray(labor)) {
    for (const l of labor) {
      const count = Number(l.professionalCount);
      const hoursPerProf = Number(l.plannedHoursPerProfessional);
      const totCost = Number(l.totalCost);
      if (count <= 0) throw new Error(`LABOR_COUNT_INVALID: Contagem de profissionais deve ser positiva na função ${l.roleName}`);
      if (hoursPerProf < 0) throw new Error(`LABOR_HOURS_INVALID: Horas planejadas não podem ser negativas na função ${l.roleName}`);
      sumLaborCost = roundMoney(sumLaborCost + totCost);
      sumLaborAllocated = roundMoney(sumLaborAllocated + Number(l.allocatedSale || 0));
    }
  }

  // Validação de subtotais e valor contratual
  const materialsCostDeclared = Number(totals.materialsCost || 0);
  const laborCostDeclared = Number(totals.laborCost || 0);
  const baseCostDeclared = Number(totals.baseCost || 0);
  const contractValueDeclared = Number(totals.contractValue || 0);
  const additionsDeclared = Number(totals.additions || 0);
  const taxAmountDeclared = Number(totals.taxAmount || 0);

  if (Math.abs(sumMaterialsCost - materialsCostDeclared) > 0.05) {
    throw new Error(`MATERIALS_TOTAL_MISMATCH: Soma dos materiais (${sumMaterialsCost}) difere do total declarado (${materialsCostDeclared})`);
  }
  if (Math.abs(sumLaborCost - laborCostDeclared) > 0.05) {
    throw new Error(`LABOR_TOTAL_MISMATCH: Soma da mão de obra (${sumLaborCost}) difere do total declarado (${laborCostDeclared})`);
  }
  if (Math.abs(roundMoney(materialsCostDeclared + laborCostDeclared) - baseCostDeclared) > 0.05) {
    throw new Error('BASE_COST_MISMATCH: baseCost deve ser igual a materialsCost + laborCost');
  }
  if (Math.abs(roundMoney(baseCostDeclared + additionsDeclared + taxAmountDeclared) - contractValueDeclared) > 0.05) {
    throw new Error('CONTRACT_VALUE_MISMATCH: contractValue deve ser igual a baseCost + additions + taxAmount');
  }

  return {
    computedHash,
    sumMaterialsCost,
    sumLaborCost,
    baseCost: baseCostDeclared,
    contractValue: contractValueDeclared,
  };
}

module.exports = {
  roundMoney,
  canonicalJsonStringify,
  computeSha256,
  validateProposalEnvelope,
};
