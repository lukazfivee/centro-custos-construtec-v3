// Concluir e faturar um servico.
// Faturar grava o faturamento no servico, guarda a NFS-e em PDF como a NF vinculada da obra (cost_center_invoices,
// a mesma que Cobrancas anexa no envio) e atualiza o acompanhamento de Cobrancas na nuvem quando possivel.
const { getDb } = require('../../db');
const { httpError } = require('../../lib/http');
const { roundDecimal } = require('../../lib/decimal');
const { recordAudit } = require('../audit');
const cloud = require('../cloudSync');
const logger = require('../../lib/logger');
const { loadService, photosOf, pendingOf, touch, money, isoDate } = require('./core');
const { decodeNfse } = require('./files');

const METHODS = ['pix', 'boleto', 'transferencia'];
const METHOD_LABELS = { pix: 'Pix', boleto: 'Boleto', transferencia: 'Transferência' };

async function completeService(id, body, user) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const { center, job } = await loadService(tx, id, { lock: true });
    if (job.status === 'concluido' || job.status === 'faturado') throw httpError(409, 'Este serviço já foi concluído.');
    const pendencias = pendingOf(job, await photosOf(tx, id));
    if (pendencias.length && body?.comPendencias !== true) {
      const error = httpError(409, 'O serviço tem pendências. Confirme para concluir mesmo assim.');
      error.extra = { codigo: 'pendencias', pendencias };
      throw error;
    }
    await tx.query(`UPDATE service_jobs SET completed_at=NOW(),completed_by_name=$2,completed_pending=$3::jsonb
      WHERE cost_center_id=$1`, [id, user.name, JSON.stringify(pendencias)]);
    await touch(tx, id, 'concluido');
    await recordAudit({ entityType: 'servico', entityId: center.public_id, action: 'concluido', client: tx,
      summary: `Serviço ${center.code} concluído${pendencias.length ? ' com pendências' : ''}`, data: { pendencias: pendencias.map((p) => p.codigo) }, user });
    return { ok: true, situacao: 'concluido', pendencias };
  });
}

function readBilling(body, center) {
  const valor = body?.valor == null || body.valor === '' ? Number(center.contract_amount) : Number(body.valor);
  if (!Number.isFinite(valor) || valor <= 0) throw httpError(400, 'Informe o valor da cobrança (maior que zero).');
  const dias = body?.vencimentoDias == null || body.vencimentoDias === '' ? 0 : Number(body.vencimentoDias);
  if (!Number.isInteger(dias) || dias < 0 || dias > 365) throw httpError(400, 'Vencimento inválido: informe de 0 a 365 dias.');
  const forma = String(body?.forma || '').trim().toLowerCase();
  if (!METHODS.includes(forma)) throw httpError(400, 'Forma de pagamento inválida. Use pix, boleto ou transferencia.');
  const numero = String(body?.nfse?.numero || '').trim().slice(0, 60) || null;
  const arquivo = body?.nfse?.arquivo ? decodeNfse(body.nfse.arquivo) : null;
  const due = new Date(Date.now() - 3 * 3600 * 1000); // data de Brasilia
  due.setUTCDate(due.getUTCDate() + dias);
  return { valor: roundDecimal(String(valor)), dias, forma, numero, arquivo, vencimento: due.toISOString().slice(0, 10) };
}

// Atualiza o acompanhamento de Cobrancas (Worker comercial). Nunca impede o faturamento local.
async function syncCobranca(user, center, billing) {
  if (!cloud.corporateEmail(user?.email)) return { sincronizada: false, motivo: 'Cobranças na nuvem exigem uma conta @rcconstrutec.com.br.' };
  try {
    const list = await cloud.listClientFollowups(user);
    const item = (list?.items || []).find((i) => i.publicId === center.public_id);
    if (!item) return { sincronizada: false, motivo: 'O serviço ainda não está na nuvem. Sincronize e atualize a cobrança na tela de Cobranças.' };
    const notes = [item.notes, `Forma: ${METHOD_LABELS[billing.forma]}. Vencimento em ${billing.dias} dias.`].filter(Boolean).join('\n').slice(0, 2000);
    await cloud.saveClientFollowup(user, center.public_id, {
      ...item, operationalStatus: 'finalizada', financialStatus: billing.numero || billing.arquivo ? 'nf_emitida' : 'a_faturar',
      invoiceNumber: billing.numero || item.invoiceNumber || '', receivableAmount: billing.valor, dueDate: billing.vencimento, notes,
    });
    return { sincronizada: true, motivo: null };
  } catch (error) {
    logger.warn('servico_cobranca_nuvem_falhou', { status: error.statusCode || null });
    return { sincronizada: false, motivo: error.publicMessage || 'Não foi possível atualizar Cobranças na nuvem agora.' };
  }
}

async function billService(id, body, user) {
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const { center, job } = await loadService(tx, id, { lock: true });
    if (job.status === 'faturado') throw httpError(409, 'Este serviço já foi faturado.');
    if (job.status !== 'concluido') throw httpError(409, 'Conclua o serviço antes de faturar.');
    const billing = readBilling(body, center);
    await tx.query(`UPDATE service_jobs SET billed_at=NOW(),billed_by_name=$2,billing_amount=$3,billing_due_days=$4,
        billing_due_date=$5,billing_method=$6,nfse_number=$7 WHERE cost_center_id=$1`,
    [id, user.name, billing.valor, billing.dias, billing.vencimento, billing.forma, billing.numero]);
    if (billing.arquivo) {
      const f = billing.arquivo;
      await tx.query(`INSERT INTO cost_center_invoices (cost_center_id,original_name,mime_type,size_bytes,sha256,content,uploaded_by,uploaded_by_name)
        VALUES ($1,$2,'application/pdf',$3,$4,$5,$6,$7)
        ON CONFLICT (cost_center_id) DO UPDATE SET original_name=EXCLUDED.original_name,size_bytes=EXCLUDED.size_bytes,sha256=EXCLUDED.sha256,
          content=EXCLUDED.content,uploaded_by=EXCLUDED.uploaded_by,uploaded_by_name=EXCLUDED.uploaded_by_name,updated_at=NOW()`,
      [id, f.name, f.content.length, f.sha256, f.content, user.id, user.name]);
    }
    await touch(tx, id, 'faturado');
    await recordAudit({ entityType: 'servico', entityId: center.public_id, action: 'faturado', client: tx,
      summary: `Serviço ${center.code} faturado`, user,
      data: { valor: billing.valor, vencimento: billing.vencimento, forma: billing.forma, nfse: billing.numero, nfseArquivo: Boolean(billing.arquivo) } });
    return { center, billing };
  });
  const cobranca = await syncCobranca(user, result.center, result.billing);
  await db.query('UPDATE service_jobs SET billing_cloud_synced=$2 WHERE cost_center_id=$1', [id, cobranca.sincronizada]);
  const b = result.billing;
  return { ok: true, situacao: 'faturado', faturamento: { valor: money(b.valor), vencimentoDias: b.dias, vencimento: isoDate(b.vencimento),
    forma: b.forma, nfseNumero: b.numero || '', nfseArquivo: Boolean(b.arquivo) }, cobranca };
}

module.exports = { completeService, billService, METHODS };
