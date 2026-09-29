const crypto = require('crypto');
const { getDb, getInstanceIdentity } = require('../db');
const { currentMonth, todayIso } = require('../lib/dates');

// Modelos recorrentes por mes: a parcela k cai em inicio + (k-1) x intervalo, no dia do modelo
// (limitado ao ultimo dia do mes). Nao depende de contador, entao gerar duas vezes nao duplica
// e um mes pulado nao trava o modelo.
const INTERVALO = { mensal: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 };

const indice = (mes) => Number(mes.slice(0, 4)) * 12 + Number(mes.slice(5, 7)) - 1;
const doIndice = (n) => `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
const somarMeses = (mes, n) => doIndice(indice(mes) + n);
const diasDoMes = (mes) => new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate();
const centavos = (valor) => Math.round(Number(valor) * 100);

// Parcela e data do modelo em um mes, ou null se o modelo nao cai nesse mes.
function ocorrencia(modelo, mes) {
  const passo = INTERVALO[modelo.frequency] || 1;
  const diff = indice(mes) - indice(modelo.inicio);
  if (diff < 0 || diff % passo !== 0) return null;
  const parcela = diff / passo + 1;
  if (modelo.total_installments && parcela > modelo.total_installments) return null;
  const dia = Math.min(Number(modelo.day_of_month) || 1, diasDoMes(mes));
  return { parcela, data: `${mes}-${String(dia).padStart(2, '0')}` };
}

// Descricao do lancamento gerado: tambem e a chave que impede gerar o mesmo lancamento duas vezes.
const descricao = (modelo, parcela) => `${modelo.name}${modelo.total_installments ? ` (${parcela}/${modelo.total_installments})` : ''}`;

// Mes da primeira parcela de um modelo novo: este mes se o dia ainda nao passou, senao o proximo.
function inicioPadrao(diaDoMes, hoje = todayIso()) {
  const mes = hoje.slice(0, 7);
  return diaDoMes && diaDoMes < Number(hoje.slice(8, 10)) ? somarMeses(mes, 1) : mes;
}

// Proxima data em que o modelo gera lancamento (de hoje em diante), ou null se ja terminou.
function proximaGeracao(modelo, hoje = todayIso()) {
  const mes = hoje.slice(0, 7);
  for (let i = 0; i <= 24; i += 1) {
    const ocorre = ocorrencia(modelo, somarMeses(mes, i));
    if (ocorre && ocorre.data >= hoje) return ocorre.data;
  }
  return null;
}

const MODELOS_SELECT = `
  SELECT rt.id,rt.name,rt.type,rt.cost_center_id,rt.category_id,rt.counterparty,rt.amount,rt.payment_method,
    rt.day_of_month,rt.frequency,rt.total_installments,rt.current_installment,
    to_char(COALESCE(rt.starts_on, date_trunc('month', rt.created_at AT TIME ZONE 'America/Sao_Paulo')::date),'YYYY-MM') AS inicio,
    cc.code AS centro_codigo,cc.name AS centro_nome
  FROM recurring_templates rt JOIN cost_centers cc ON cc.id=rt.cost_center_id
  WHERE rt.active = TRUE ORDER BY rt.id`;

// O que o mes tem para gerar (itens) e o que ja foi gerado (gerados), sem gravar nada.
async function planoDoMes(db, mes) {
  const { rows: modelos } = await db.query(MODELOS_SELECT);
  const candidatos = [];
  for (const modelo of modelos) {
    const ocorre = ocorrencia(modelo, mes);
    if (ocorre) candidatos.push({ modelo, ...ocorre, descricao: descricao(modelo, ocorre.parcela) });
  }
  const existentes = new Set();
  if (candidatos.length) {
    const { rows } = await db.query(
      `SELECT description, cost_center_id, transaction_date::text AS data FROM transactions
       WHERE deleted_at IS NULL AND (description, cost_center_id, transaction_date) IN (
         SELECT unnest($1::text[]), unnest($2::int[]), unnest($3::date[]))`,
      [candidatos.map((c) => c.descricao), candidatos.map((c) => c.modelo.cost_center_id), candidatos.map((c) => c.data)]
    );
    rows.forEach((row) => existentes.add(`${row.description}|${row.cost_center_id}|${row.data}`));
  }
  const itens = [];
  const gerados = [];
  for (const c of candidatos) {
    const existe = existentes.has(`${c.descricao}|${c.modelo.cost_center_id}|${c.data}`);
    (existe ? gerados : itens).push(c);
  }
  const ordem = (a, b) => a.data.localeCompare(b.data) || a.modelo.id - b.modelo.id;
  return { itens: itens.sort(ordem), gerados: gerados.sort(ordem) };
}

function formatarItem(c) {
  return {
    id: c.modelo.id, nome: c.modelo.name, descricao: c.descricao, data: c.data, valor: Number(c.modelo.amount),
    parcela: c.parcela, total_parcelas: c.modelo.total_installments,
    obra: `${c.modelo.centro_codigo} · ${c.modelo.centro_nome}`, favorecido: c.modelo.counterparty,
  };
}

async function previaDoMes(mes) {
  const { itens, gerados } = await planoDoMes(getDb(), mes);
  const total = itens.reduce((soma, c) => soma + centavos(c.modelo.amount), 0) / 100;
  return { mes, itens: itens.map(formatarItem), gerados: gerados.map(formatarItem), total_itens: itens.length, total_valor: total };
}

// Gera os lancamentos do mes como "A pagar" (ou "A receber"), tudo ou nada.
async function gerarMes(mes, usuario) {
  const instancia = getInstanceIdentity();
  return getDb().transaction(async (tx) => {
    const { itens } = await planoDoMes(tx, mes);
    if (!itens.length) return { gerados: 0, itens: [] };
    const params = [];
    const linhas = itens.map((c) => {
      const m = c.modelo;
      const linha = [crypto.randomUUID(), m.type, m.cost_center_id, m.category_id, c.descricao, m.counterparty, m.amount, c.data, c.data,
        'pendente', instancia.id, instancia.name, instancia.id, instancia.name, usuario.name, usuario.id];
      params.push(...linha);
      return `(${linha.map((_, i) => `$${params.length - linha.length + i + 1}`).join(',')})`;
    });
    await tx.query(
      `INSERT INTO transactions (public_id,type,cost_center_id,category_id,description,counterparty,
         amount,transaction_date,due_date,financial_status,
         origin_instance_id,origin_instance_name,last_modified_instance_id,last_modified_instance_name,
         origin_user_name,created_by)
       VALUES ${linhas.join(',')}`,
      params
    );
    // "Geradas" na lista: a proxima parcela nunca fica atras da ultima gerada.
    await tx.query(
      `UPDATE recurring_templates rt SET current_installment = GREATEST(rt.current_installment, v.parcela + 1), updated_at = NOW()
       FROM (SELECT unnest($1::int[]) AS id, unnest($2::int[]) AS parcela) v WHERE rt.id = v.id`,
      [itens.map((c) => c.modelo.id), itens.map((c) => c.parcela)]
    );
    return { gerados: itens.length, itens: itens.map(formatarItem) };
  });
}

module.exports = { INTERVALO, ocorrencia, inicioPadrao, proximaGeracao, previaDoMes, gerarMes, somarMeses, currentMonth };
