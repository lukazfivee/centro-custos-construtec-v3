// Servicos curtos: leitura, resumo financeiro, pendencias e quem ve valores.
// Um servico e um cost_center com kind='servico' + uma linha em service_jobs (criada sob demanda).
const { httpError } = require('../../lib/http');
const { sumDecimal, roundDecimal } = require('../../lib/decimal');
const { can } = require('../permissions');

const STATUSES = ['agendado', 'em_andamento', 'concluido', 'faturado'];
const EXPENSE_KINDS = ['deslocamento', 'combustivel', 'material', 'mao_de_obra', 'outros'];
const KIND_LABELS = {
  deslocamento: 'Deslocamento', combustivel: 'Combustível', material: 'Material e miscelânea',
  mao_de_obra: 'Mão de obra terceirizada', outros: 'Outros',
};
// Categoria usada no lancamento rapido (por nome; se nao existir, a primeira categoria de despesa ativa).
const KIND_CATEGORY = {
  deslocamento: 'Transporte', combustivel: 'Transporte', material: 'Material',
  mao_de_obra: 'Serviços terceirizados', outros: 'Outros',
};
// Lancamento sem expense_kind (feito pela tela comum): o tipo vem do nome da categoria.
const CATEGORY_KIND = {
  transporte: 'deslocamento', material: 'material', 'serviços terceirizados': 'mao_de_obra', 'mão de obra': 'mao_de_obra',
};
// cost_centers.project_status acompanha a situacao (Cobrancas e telas antigas leem project_status).
const PROJECT_STATUS = { agendado: 'planejamento', em_andamento: 'execucao', concluido: 'concluido', faturado: 'concluido' };

const money = (value) => roundDecimal(String(value ?? 0));
const isoDate = (value) => (value == null ? null : value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));

// Quem ve valor cobrado, resultado e margem: quem tem p1 (admin, gestor, financeiro, engenharia). Tecnico nao.
async function seesMoney(user) {
  return can(user, 'p1');
}

async function ensureJob(db, costCenterId) {
  await db.query('INSERT INTO service_jobs (cost_center_id) VALUES ($1) ON CONFLICT (cost_center_id) DO NOTHING', [costCenterId]);
}

// Carrega o servico (404 se nao existe ou se o centro nao e servico).
async function loadService(db, id, { lock = false } = {}) {
  const center = (await db.query(`SELECT id,public_id,code,name,client,responsible,start_date,contract_amount,description,
      active,kind,revision FROM cost_centers WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id])).rows[0];
  if (!center) throw httpError(404, 'Serviço não encontrado.');
  if (center.kind !== 'servico') throw httpError(404, 'Este centro de custo não é um serviço.');
  await ensureJob(db, id);
  const job = (await db.query(`SELECT status,location,checklist,completed_at,completed_by_name,completed_pending,
      accept_name,accept_role,accept_at,accept_by_name,(accept_signature IS NOT NULL) AS has_signature,
      billed_at,billed_by_name,billing_amount,billing_due_days,billing_due_date,billing_method,nfse_number,billing_cloud_synced,updated_at
    FROM service_jobs WHERE cost_center_id=$1`, [id])).rows[0];
  return { center, job };
}

async function photosOf(db, id) {
  const { rows } = await db.query(`SELECT id,phase,original_name,mime_type,size_bytes,caption,created_by_name,created_at
    FROM service_photos WHERE cost_center_id=$1 ORDER BY created_at,id`, [id]);
  return rows.map((r) => ({ id: r.id, fase: r.phase, nome: r.original_name, tipo: r.mime_type, tamanho: r.size_bytes,
    legenda: r.caption || '', enviadoPor: r.created_by_name, criadoEm: r.created_at, url: `/api/servicos/${id}/fotos/${r.id}/arquivo` }));
}

function kindOf(row) {
  if (EXPENSE_KINDS.includes(row.expense_kind)) return row.expense_kind;
  return CATEGORY_KIND[String(row.categoria || '').trim().toLowerCase()] || 'outros';
}

// Despesas ativas (nao excluidas; estorno entra com sinal negativo) do servico.
async function expensesOf(db, id) {
  const { rows } = await db.query(`SELECT t.id,t.public_id,t.description,t.counterparty,t.amount,t.accounting_sign,
      t.transaction_date::text AS data,t.expense_kind,t.payment_method,c.name AS categoria,t.origin_user_name,
      (SELECT COUNT(*)::int FROM transaction_attachments ta WHERE ta.transaction_id=t.id) AS anexos
    FROM transactions t JOIN categories c ON c.id=t.category_id
    WHERE t.cost_center_id=$1 AND t.type='despesa' AND t.deleted_at IS NULL
    ORDER BY t.transaction_date DESC,t.id DESC`, [id]);
  return rows.map((r) => ({
    id: r.id, publicId: r.public_id, tipo: kindOf(r), descricao: r.description, favorecido: r.counterparty || '',
    valor: money(Number(r.amount) * Number(r.accounting_sign || 1)), data: r.data, categoria: r.categoria,
    formaPagamento: r.payment_method || '', lancadoPor: r.origin_user_name || '', anexos: r.anexos,
  }));
}

function summarize(charged, expenses) {
  const byKind = EXPENSE_KINDS.map((tipo) => {
    const items = expenses.filter((e) => e.tipo === tipo);
    return { tipo, rotulo: KIND_LABELS[tipo], total: sumDecimal(items.map((e) => String(e.valor))), quantidade: items.length };
  });
  const gastos = sumDecimal(expenses.map((e) => String(e.valor)));
  const cobrado = money(charged);
  const resultado = sumDecimal([String(cobrado), String(-gastos)]);
  const margem = cobrado > 0 ? roundDecimal(String((resultado / cobrado) * 100), 1) : null;
  return { cobrado, gastos, resultado, margem, gastosPorTipo: byKind };
}

function pendingOf(job, photos) {
  const list = Array.isArray(job.checklist) ? job.checklist : [];
  const open = list.filter((item) => !item.feito);
  const out = [];
  if (open.length) out.push({ codigo: 'checklist_incompleto', mensagem: `Checklist com ${open.length} de ${list.length} itens não feitos.`, itens: open.map((i) => i.texto) });
  if (!photos.some((p) => p.fase === 'antes')) out.push({ codigo: 'sem_foto_antes', mensagem: 'Sem foto de antes.' });
  if (!photos.some((p) => p.fase === 'depois')) out.push({ codigo: 'sem_foto_depois', mensagem: 'Sem foto de depois.' });
  if (!job.has_signature) out.push({ codigo: 'sem_aceite', mensagem: 'Sem aceite do cliente.' });
  return out;
}

function acceptOf(id, job) {
  if (!job.has_signature) return null;
  return { nome: job.accept_name, cargo: job.accept_role || '', dataHora: job.accept_at, registradoPor: job.accept_by_name || '',
    assinaturaUrl: `/api/servicos/${id}/aceite/assinatura` };
}

function billingOf(job) {
  if (!job.billed_at) return null;
  return { valor: money(job.billing_amount), vencimentoDias: job.billing_due_days, vencimento: isoDate(job.billing_due_date),
    forma: job.billing_method, nfseNumero: job.nfse_number || '', faturadoEm: job.billed_at, faturadoPor: job.billed_by_name || '',
    cobrancaSincronizada: job.billing_cloud_synced === true };
}

// Detalhe completo. Sem p1, saem valor cobrado, resultado, margem e o valor faturado.
async function serviceDetail(db, id, user) {
  const { center, job } = await loadService(db, id);
  const [photos, expenses, money_] = [await photosOf(db, id), await expensesOf(db, id), await seesMoney(user)];
  const summary = summarize(center.contract_amount, expenses);
  const out = {
    id: center.id, publicId: center.public_id, codigo: center.code, nome: center.name, cliente: center.client || '',
    local: job.location || '', data: isoDate(center.start_date), responsavel: center.responsible || '',
    descricao: center.description || '', ativo: center.active, revisao: center.revision, situacao: job.status,
    checklist: Array.isArray(job.checklist) ? job.checklist : [],
    fotos: photos, aceite: acceptOf(id, job), gastos: expenses,
    resumo: summary, pendencias: pendingOf(job, photos),
    conclusao: job.completed_at ? { concluidoEm: job.completed_at, concluidoPor: job.completed_by_name || '', pendenciasNaConclusao: job.completed_pending || [] } : null,
    faturamento: billingOf(job), veValores: money_, atualizadoEm: job.updated_at,
  };
  if (!money_) {
    delete out.resumo.cobrado; delete out.resumo.resultado; delete out.resumo.margem;
    if (out.faturamento) delete out.faturamento.valor;
  } else out.valor = summary.cobrado;
  return out;
}

async function nextCode(db) {
  const { rows } = await db.query("SELECT code FROM cost_centers WHERE code ~* '^SV-[0-9]+$'");
  const max = rows.reduce((m, r) => Math.max(m, Number(r.code.slice(3))), 1000);
  return `SV-${max + 1}`;
}

async function touch(db, id, status) {
  if (status) {
    await db.query('UPDATE service_jobs SET status=$2,updated_at=NOW() WHERE cost_center_id=$1', [id, status]);
    await db.query('UPDATE cost_centers SET project_status=$2,revision=revision+1,updated_at=NOW() WHERE id=$1', [id, PROJECT_STATUS[status]]);
  } else await db.query('UPDATE service_jobs SET updated_at=NOW() WHERE cost_center_id=$1', [id]);
}

module.exports = {
  STATUSES, EXPENSE_KINDS, KIND_LABELS, KIND_CATEGORY, PROJECT_STATUS, money, isoDate, seesMoney, ensureJob, loadService,
  photosOf, expensesOf, summarize, pendingOf, serviceDetail, nextCode, touch,
};
