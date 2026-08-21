const { getDb, getInstanceIdentity } = require('../db');
const { parseCsv, csvLine, decimalBr } = require('../lib/csv');
const { validDate } = require('../lib/dates');
const { httpError } = require('../lib/http');
const { recordAudit } = require('./audit');

const FORMAT_VERSION = '2';
const BASE_HEADERS = [
  'formato_versao', 'id_lancamento', 'tipo', 'data', 'centro_codigo', 'centro_nome',
  'categoria', 'descricao', 'cliente_fornecedor', 'valor', 'observacao', 'origem_id',
  'origem_nome', 'alterado_na_instalacao_id', 'alterado_na_instalacao_nome',
  'autor_original', 'revisao', 'alterado_em', 'excluido',
];
const HEADERS = [
  'formato_versao', 'id_lancamento', 'tipo', 'data', 'vencimento', 'status_financeiro',
  'data_liquidacao', 'documento', 'forma_pagamento', 'centro_codigo', 'centro_nome',
  'categoria', 'descricao', 'cliente_fornecedor', 'valor', 'observacao', 'origem_id',
  'origem_nome', 'alterado_na_instalacao_id', 'alterado_na_instalacao_nome',
  'autor_original', 'revisao', 'alterado_em', 'excluido',
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function exportTransactions({ where, values }) {
  const { rows } = await getDb().query(`
    SELECT t.public_id, t.type, t.transaction_date::text AS transaction_date,
      t.due_date::text AS due_date,t.financial_status,t.settlement_date::text AS settlement_date,
      t.document_number,t.payment_method,
      cc.code AS center_code, cc.name AS center_name, c.name AS category_name,
      t.description, t.counterparty, t.amount, t.notes, t.origin_instance_id,
      t.origin_instance_name, t.last_modified_instance_id, t.last_modified_instance_name,
      t.origin_user_name, t.revision, t.updated_at, t.deleted_at
    FROM transactions t
    JOIN cost_centers cc ON cc.id = t.cost_center_id
    JOIN categories c ON c.id = t.category_id
    ${where}
    ORDER BY t.transaction_date, t.public_id
  `, values);

  const lines = [csvLine(HEADERS)];
  rows.forEach((row) => lines.push(csvLine([
    FORMAT_VERSION, row.public_id, row.type, row.transaction_date, row.due_date,
    row.financial_status, row.settlement_date, row.document_number, row.payment_method,
    row.center_code, row.center_name,
    row.category_name, row.description, row.counterparty, decimalBr(row.amount), row.notes,
    row.origin_instance_id, row.origin_instance_name, row.last_modified_instance_id,
    row.last_modified_instance_name, row.origin_user_name, row.revision,
    new Date(row.updated_at).toISOString(), row.deleted_at ? 'sim' : 'nao',
  ])));
  return `\uFEFF${lines.join('\r\n')}`;
}

async function importTransactions({ content, filename, user }) {
  if (typeof content !== 'string' || !content.trim()) throw httpError(400, 'Selecione um arquivo CSV válido.');
  if (Buffer.byteLength(content, 'utf8') > 8 * 1024 * 1024) throw httpError(413, 'O arquivo excede o limite de 8 MB.');

  let parsed;
  try {
    parsed = parseCsv(content);
  } catch (error) {
    throw httpError(400, error.message);
  }
  if (parsed.length < 2) throw httpError(400, 'A planilha não contém lançamentos.');
  if (parsed.length > 5001) throw httpError(400, 'Importe no máximo 5.000 lançamentos por arquivo.');

  const header = parsed[0].map((item) => item.trim());
  const missing = BASE_HEADERS.filter((name) => !header.includes(name));
  if (missing.length) throw httpError(400, `Planilha incompatível. Colunas ausentes: ${missing.join(', ')}.`);
  const index = Object.fromEntries(header.map((name, position) => [name, position]));
  const incoming = parsed.slice(1).map((cells, rowIndex) => {
    const record = {};
    HEADERS.forEach((name) => { record[name] = String(index[name] == null ? '' : cells[index[name]] ?? '').trim(); });
    record.line = rowIndex + 2;
    return record;
  });

  const db = getDb();
  const currentInstance = getInstanceIdentity();
  const result = { incluidos: 0, atualizados: 0, ignorados: 0, conflitos: 0, erros: 0, detalhes: [] };

  await db.transaction(async (tx) => {
    const centers = await tx.query('SELECT id, LOWER(code) AS key FROM cost_centers');
    const categories = await tx.query('SELECT id, LOWER(name) AS key, type FROM categories');
    const centerMap = new Map(centers.rows.map((item) => [item.key, item.id]));
    const categoryMap = new Map(categories.rows.map((item) => [item.key, item]));
    const sourceId = incoming.find((item) => UUID.test(item.origem_id))?.origem_id || null;
    const sourceName = incoming.find((item) => item.origem_nome)?.origem_nome || null;
    const importInsert = await tx.query(
      `INSERT INTO sync_imports (filename, source_instance_id, source_instance_name, imported_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [String(filename || 'importacao.csv').slice(0, 240), sourceId, sourceName?.slice(0, 120), user.id]
    );
    const importId = importInsert.rows[0].id;

    for (const raw of incoming) {
      const validation = validateIncoming(raw, centerMap, categoryMap);
      if (validation.error) {
        result.erros += 1;
        addDetail(result, raw.line, 'erro', validation.error, raw.id_lancamento);
        continue;
      }
      const row = validation.row;
      const existingResult = await tx.query(
        `SELECT t.*, cc.code AS center_code, c.name AS category_name
         FROM transactions t
         JOIN cost_centers cc ON cc.id = t.cost_center_id
         JOIN categories c ON c.id = t.category_id
         WHERE t.public_id = $1`,
        [row.publicId]
      );
      const existing = existingResult.rows[0];

      if (!existing) {
        await tx.query(
          `INSERT INTO transactions
            (public_id, type, cost_center_id, category_id, description, counterparty, amount,
             transaction_date, notes, due_date, settlement_date, financial_status,
             document_number, payment_method, origin_instance_id, origin_instance_name,
             last_modified_instance_id, last_modified_instance_name, origin_user_name,
             revision, created_by, updated_by, updated_at, deleted_at, last_imported_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$21,$22,$23,NOW())`,
          [row.publicId, row.type, row.centerId, row.categoryId, row.description, row.counterparty,
            row.amount, row.date, row.notes, row.dueDate, row.settlementDate, row.financialStatus,
            row.documentNumber, row.paymentMethod, row.originId, row.originName,
            row.modifiedInstanceId, row.modifiedInstanceName, row.originUserName, row.revision,
            user.id, row.updatedAt, row.deleted ? row.updatedAt : null]
        );
        result.incluidos += 1;
        continue;
      }

      if (sameBusinessData(existing, row)) {
        result.ignorados += 1;
        addDetail(result, raw.line, 'ignorado', 'O lançamento já existe com os mesmos dados.', row.publicId);
        continue;
      }

      const sameLineage = String(existing.last_modified_instance_id) === row.modifiedInstanceId;
      if (sameLineage && row.revision > Number(existing.revision)) {
        await tx.query(
          `UPDATE transactions SET type=$1, cost_center_id=$2, category_id=$3, description=$4,
             counterparty=$5, amount=$6, transaction_date=$7, notes=$8,
             due_date=$9,settlement_date=$10,financial_status=$11,document_number=$12,payment_method=$13,
             last_modified_instance_id=$14, last_modified_instance_name=$15, origin_user_name=$16,
             revision=$17, updated_by=$18, updated_at=$19, deleted_at=$20, last_imported_at=NOW()
           WHERE id=$21`,
          [row.type, row.centerId, row.categoryId, row.description, row.counterparty, row.amount,
            row.date, row.notes, row.dueDate, row.settlementDate, row.financialStatus,
            row.documentNumber, row.paymentMethod, row.modifiedInstanceId, row.modifiedInstanceName,
            row.originUserName, row.revision, user.id, row.updatedAt,
            row.deleted ? row.updatedAt : null, existing.id]
        );
        result.atualizados += 1;
        continue;
      }

      const reason = row.revision <= Number(existing.revision)
        ? 'A versão recebida é mais antiga ou tem a mesma revisão, mas dados diferentes.'
        : `O lançamento foi editado em duas instalações (${existing.last_modified_instance_name} e ${row.modifiedInstanceName}).`;
      await tx.query(
        `INSERT INTO sync_conflicts (import_id, transaction_public_id, reason, local_data, incoming_data)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
        [importId, row.publicId, reason, JSON.stringify(existing), JSON.stringify(raw)]
      );
      result.conflitos += 1;
      addDetail(result, raw.line, 'conflito', `${reason} O dado local foi preservado.`, row.publicId);
    }

    await tx.query(
      `UPDATE sync_imports SET included_count=$1, updated_count=$2, ignored_count=$3,
         conflict_count=$4, error_count=$5 WHERE id=$6`,
      [result.incluidos, result.atualizados, result.ignorados, result.conflitos, result.erros, importId]
    );
    await recordAudit({entityType:'sincronizacao',entityId:importId,action:'importada',
      summary:`Importação ${filename}: ${result.incluidos} incluído(s), ${result.atualizados} atualizado(s), ${result.conflitos} conflito(s).`,
      data:result,user,client:tx});
    result.importacaoId = importId;
  });

  result.instanciaAtual = currentInstance.name;
  result.total = incoming.length;
  return result;
}

function validateIncoming(raw, centerMap, categoryMap) {
  if (!['1',FORMAT_VERSION].includes(raw.formato_versao)) return { error: `Versão de formato não suportada: ${raw.formato_versao || 'vazia'}.` };
  if (!UUID.test(raw.id_lancamento)) return { error: 'Identificador único inválido.' };
  if (!['receita', 'despesa'].includes(raw.tipo)) return { error: 'Tipo deve ser receita ou despesa.' };
  if (!validDate(raw.data)) return { error: 'Data inválida; use AAAA-MM-DD.' };
  const legacy = raw.formato_versao === '1';
  const dueDate = legacy ? raw.data : (raw.vencimento || raw.data);
  const financialStatus = legacy ? 'liquidado' : raw.status_financeiro;
  if (!validDate(dueDate)) return { error: 'Vencimento inválido; use AAAA-MM-DD.' };
  if (!['pendente','liquidado'].includes(financialStatus)) return { error: 'Situação financeira deve ser pendente ou liquidado.' };
  const settlementDate = financialStatus === 'liquidado'
    ? (legacy ? raw.data : (raw.data_liquidacao || raw.data)) : null;
  if (settlementDate && !validDate(settlementDate)) return { error: 'Data de pagamento ou recebimento inválida.' };
  const centerId = centerMap.get(raw.centro_codigo.toLowerCase());
  if (!centerId) return { error: `Centro de custo não encontrado: ${raw.centro_codigo}. Cadastre-o e importe novamente.` };
  const category = categoryMap.get(raw.categoria.toLowerCase());
  if (!category) return { error: `Categoria não encontrada: ${raw.categoria}. Cadastre-a e importe novamente.` };
  if (category.type !== 'ambos' && category.type !== raw.tipo) return { error: 'A categoria não é compatível com o tipo do lançamento.' };
  const amount = parseMoney(raw.valor);
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Valor inválido.' };
  if (!raw.descricao) return { error: 'Descrição vazia.' };
  if (!UUID.test(raw.origem_id) || !UUID.test(raw.alterado_na_instalacao_id)) return { error: 'Identificador de origem inválido.' };
  const revision = Number(raw.revisao);
  if (!Number.isInteger(revision) || revision < 1) return { error: 'Revisão inválida.' };
  const updatedAt = new Date(raw.alterado_em);
  if (Number.isNaN(updatedAt.valueOf())) return { error: 'Data de alteração inválida.' };
  if (!['sim', 'nao', 'não'].includes(raw.excluido.toLowerCase())) return { error: 'A coluna excluido deve conter sim ou nao.' };
  return { row: {
    publicId: raw.id_lancamento.toLowerCase(), type: raw.tipo, date: raw.data, centerId,
    categoryId: category.id, description: raw.descricao.slice(0, 240),
    counterparty: raw.cliente_fornecedor.slice(0, 160) || null, amount,
    notes: raw.observacao || null,dueDate,financialStatus,settlementDate,
    documentNumber:raw.documento.slice(0,80) || null,paymentMethod:raw.forma_pagamento.slice(0,40) || null,
    originId: raw.origem_id.toLowerCase(),
    originName: raw.origem_nome.slice(0, 120) || 'Instalação desconhecida',
    modifiedInstanceId: raw.alterado_na_instalacao_id.toLowerCase(),
    modifiedInstanceName: raw.alterado_na_instalacao_nome.slice(0, 120) || 'Instalação desconhecida',
    originUserName: raw.autor_original.slice(0, 120) || 'Usuário não informado', revision,
    updatedAt: updatedAt.toISOString(), deleted: raw.excluido.toLowerCase() === 'sim',
  } };
}

function parseMoney(value) {
  const text = String(value || '').trim();
  if (/^-?\d+,\d{1,2}$/.test(text)) return Number(text.replace(',', '.'));
  if (/^-?\d+(\.\d{1,2})?$/.test(text)) return Number(text);
  return Number.NaN;
}

function sameBusinessData(existing, row) {
  const dateOnly = (value) => value instanceof Date ? value.toISOString().slice(0,10) : value ? String(value).slice(0,10) : null;
  const date = dateOnly(existing.transaction_date);
  const existingStatus = existing.financial_status || 'liquidado';
  const rowStatus = row.financialStatus || 'liquidado';
  const existingDue = dateOnly(existing.due_date) || date;
  const rowDue = row.dueDate || row.date;
  const existingSettlement = existingStatus === 'liquidado' ? (dateOnly(existing.settlement_date) || date) : null;
  const rowSettlement = rowStatus === 'liquidado' ? (row.settlementDate || row.date) : null;
  return existing.type === row.type
    && Number(existing.cost_center_id) === Number(row.centerId)
    && Number(existing.category_id) === Number(row.categoryId)
    && existing.description === row.description
    && (existing.counterparty || null) === row.counterparty
    && Number(existing.amount) === Number(row.amount)
    && date === row.date
    && (existing.notes || null) === row.notes
    && existingDue === rowDue
    && existingSettlement === rowSettlement
    && existingStatus === rowStatus
    && (existing.document_number || null) === (row.documentNumber || null)
    && (existing.payment_method || null) === (row.paymentMethod || null)
    && Boolean(existing.deleted_at) === row.deleted;
}

function addDetail(result, line, status, message, id) {
  if (result.detalhes.length < 200) result.detalhes.push({ linha: line, status, mensagem: message, id: id || null });
}

module.exports = { FORMAT_VERSION, HEADERS, exportTransactions, importTransactions, parseMoney, sameBusinessData };


