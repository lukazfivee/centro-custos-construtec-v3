// Leitura das propostas do Orçamentos para o assistente do celular. O Centro pede um
// código de handoff (target orcamentos) ao Worker com a sessão central da pessoa e o
// troca no servidor do Orçamentos por uma sessão própria: cada um só vê o que o seu
// perfil no Orçamentos já permite. Sessões guardadas em memória por alguns minutos.
const cloudAuth = require('./cloudAuth');
const { httpError } = require('../lib/http');

const DEFAULT_URL = 'https://construtec-orcamentos-cloud.construtec-reports.workers.dev';
const TTL_MS = 20 * 60 * 1000;
const sessions = new Map();

const baseUrl = () => String(process.env.ORCAMENTOS_API_URL || DEFAULT_URL).replace(/\/+$/, '');

async function call(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  timer.unref?.();
  try {
    const response = await fetch(`${baseUrl()}${path}`, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  } catch {
    throw httpError(503, 'Não foi possível falar com o Orçamentos agora.');
  } finally {
    clearTimeout(timer);
  }
}

async function newSession(usuario) {
  let code;
  try {
    code = (await cloudAuth.handoff(usuario.cloud_session_token, 'orcamentos')).code;
  } catch {
    throw httpError(503, 'Não foi possível abrir o Orçamentos com a sua conta agora.');
  }
  const { status, data } = await call('/api/auth/handoff', { method: 'POST', body: JSON.stringify({ code }) });
  if (status !== 200 || !data.token) throw httpError(503, 'O Orçamentos não aceitou a sua conta agora.');
  return data.token;
}

async function sessionFor(usuario) {
  if (!usuario.cloud_managed || !usuario.cloud_session_token) {
    throw httpError(409, 'As propostas do Orçamentos só aparecem para contas corporativas.');
  }
  const key = String(usuario.cloud_session_token);
  const saved = sessions.get(key);
  if (saved && saved.expires > Date.now()) return saved.token;
  const token = await newSession(usuario);
  sessions.set(key, { token, expires: Date.now() + TTL_MS });
  if (sessions.size > 500) sessions.delete(sessions.keys().next().value);
  return token;
}

// GET na API do Orçamentos; uma nova sessão se a guardada tiver expirado lá.
async function get(usuario, path) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await sessionFor(usuario);
    const { status, data } = await call(path, { headers: { 'X-Construtec-Session': token } });
    if (status === 401 && attempt === 0) { sessions.delete(String(usuario.cloud_session_token)); continue; }
    if (status === 404) throw httpError(404, 'Proposta não encontrada no Orçamentos.');
    if (status === 403) throw httpError(403, data.error || 'Seu perfil no Orçamentos não permite esta consulta.');
    if (status !== 200) throw httpError(503, 'O Orçamentos não respondeu como esperado.');
    return data;
  }
  throw httpError(503, 'O Orçamentos não aceitou a sua conta agora.');
}

const STATUS = { draft: 'rascunho', review: 'em revisão', sent: 'enviada', approved: 'aprovada', rejected: 'recusada' };
const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : null);
const plain = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function summary(p) {
  return {
    id: p.id, numero: p.number, revisao: p.revision, cliente: p.clientName, obra: p.workName,
    status: STATUS[p.status] || p.status, valor_venda: num(p.totalSale), itens: p.itemCount,
    atualizada_em: p.updatedAt, validade: p.validUntil || null, tem_revisao_aprovada: Boolean(p.hasApprovedRevision),
  };
}

async function listProposals(usuario, { busca, status } = {}) {
  const all = ((await get(usuario, '/api/proposals')).proposals || []).filter((p) => p.isLatest !== false);
  const term = plain(busca).trim();
  const wanted = Object.keys(STATUS).find((k) => k === status || STATUS[k] === plain(status));
  const list = all
    .filter((p) => !wanted || p.status === wanted)
    .filter((p) => !term || plain(`${p.number} ${p.clientName} ${p.workName}`).includes(term))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const total = list.reduce((sum, p) => sum + (Number(p.totalSale) || 0), 0);
  return { total_encontradas: list.length, soma_valor_venda: num(total), propostas: list.slice(0, 30).map(summary) };
}

async function proposalDetail(usuario, id) {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(String(id || ''))) throw httpError(400, 'Proposta inválida.');
  const p = (await get(usuario, `/api/proposals/${encodeURIComponent(id)}`)).proposal || {};
  const t = p.totals || {};
  const items = (p.items || []).slice().sort((a, b) => (Number(b.totalSale) || 0) - (Number(a.totalSale) || 0));
  return {
    ...summary({ ...p, totalSale: t.finalValue ?? t.sale, itemCount: items.length }),
    escopo: String(p.scope || '').slice(0, 800), responsavel: p.responsibleName || null,
    bdi_multiplicador: num(p.bdiMultiplier), impostos_pct: num(p.taxPercentage), centro_custo_id: p.costCenterId || null,
    totais: {
      custo_base: num(t.baseCost ?? t.cost), materiais: num(t.materials ?? t.cost), mao_de_obra: num(t.labor),
      acrescimos: num(t.additions), impostos: num(t.taxAmount), valor_final: num(t.finalValue ?? t.sale),
      resultado_bruto: num(t.grossResult), margem_pct: num(t.marginPercent),
    },
    itens_principais: items.slice(0, 15).map((i) => ({
      descricao: i.description, categoria: i.category, quantidade: num(i.quantity), unidade: i.unit,
      custo_total: num(i.totalCost), venda_total: num(i.totalSale),
    })),
    mao_de_obra: (p.laborItems || []).slice(0, 10).map((l) => ({ descricao: l.description, profissionais: l.professionalCount, custo_total: num(l.totalCost) })),
  };
}

module.exports = { listProposals, proposalDetail, _sessions: sessions };
