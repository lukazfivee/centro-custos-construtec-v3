// Fechamento mensal: resumo por mes e checklist "Antes de fechar". Tudo na competencia (data do
// lancamento), no mesmo recorte do painel: so lancamentos aprovados e sem exclusao.
const { getDb } = require('../db');
const { financialTransactionsSql } = require('./financialProjection');
const { monthRange, todaySql } = require('../lib/dates');
const { previaDoMes } = require('./recurringSchedule');
const cloud = require('./cloudSync');

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const dinheiro = (valor) => Math.round(Number(valor || 0) * 100) / 100;
const brl = (valor) => dinheiro(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const chaveMes = (ano, mes) => `${ano}-${mes}`;

// Receitas e despesas liquidadas e o que segue em aberto, mes a mes do ano.
async function resumoDoAno(ano) {
  const db = getDb();
  const { rows } = await db.query(`
    SELECT EXTRACT(MONTH FROM t.transaction_date)::int AS mes,
      COALESCE(SUM(t.amount * t.accounting_sign) FILTER (WHERE t.type='receita' AND t.financial_status='liquidado'),0) AS receitas,
      COALESCE(SUM(t.amount * t.accounting_sign) FILTER (WHERE t.type='despesa' AND t.financial_status='liquidado'),0) AS despesas,
      COUNT(*)::int AS lancamentos,
      COUNT(*) FILTER (WHERE t.financial_status='pendente' AND t.accounting_sign=1)::int AS em_aberto,
      COALESCE(SUM(t.amount) FILTER (WHERE t.financial_status='pendente' AND t.accounting_sign=1),0) AS valor_em_aberto
    FROM ${financialTransactionsSql} t
    WHERE t.transaction_date >= $1 AND t.transaction_date < $2
    GROUP BY 1`, [`${ano}-01-01`, `${ano + 1}-01-01`]);
  const fechamentos = await db.query(`
    SELECT mc.id,mc.month,mc.closed_at,u.name AS fechado_por,mc.pendencias
    FROM monthly_closings mc JOIN users u ON u.id=mc.closed_by WHERE mc.year=$1`, [ano]);
  // Ultima reabertura de cada mes (mesmo que ele tenha sido fechado de novo depois).
  const reaberturas = await db.query(`
    SELECT DISTINCT ON (entity_id) entity_id,user_name,created_at,data->>'motivo' AS motivo
    FROM audit_log WHERE entity_type='fechamento' AND action='reaberto' AND entity_id LIKE $1
    ORDER BY entity_id,created_at DESC,id DESC`, [`${ano}-%`]);
  const porMes = new Map(rows.map((r) => [r.mes, r]));
  const fechado = new Map(fechamentos.rows.map((r) => [r.month, r]));
  const reaberto = new Map(reaberturas.rows.map((r) => [r.entity_id, r]));
  return Array.from({ length: 12 }, (_, i) => {
    const mes = i + 1;
    const dados = porMes.get(mes) || {};
    const fech = fechado.get(mes);
    const reab = reaberto.get(chaveMes(ano, mes));
    const receitas = dinheiro(dados.receitas);
    const despesas = dinheiro(dados.despesas);
    return {
      ano, mes, fechado: Boolean(fech), fechamento_id: fech ? fech.id : null,
      fechado_em: fech ? fech.closed_at : null, fechado_por: fech ? fech.fechado_por : null,
      pendencias: fech && Array.isArray(fech.pendencias) ? fech.pendencias : [],
      reaberto: reab ? { em: reab.created_at, por: reab.user_name, motivo: reab.motivo || '' } : null,
      receitas, despesas, resultado: dinheiro(receitas - despesas),
      lancamentos: Number(dados.lancamentos || 0), em_aberto: Number(dados.em_aberto || 0), valor_em_aberto: dinheiro(dados.valor_em_aberto),
    };
  });
}

async function contagensDoMes(ano, mes) {
  const range = monthRange(`${ano}-${String(mes).padStart(2, '0')}`);
  const { rows } = await getDb().query(`
    SELECT
      COUNT(*) FILTER (WHERE t.type='despesa' AND t.financial_status='pendente' AND t.due_date < ${todaySql()})::int AS vencidas,
      COALESCE(SUM(t.amount) FILTER (WHERE t.type='despesa' AND t.financial_status='pendente' AND t.due_date < ${todaySql()}),0) AS valor_vencidas,
      COUNT(*) FILTER (WHERE t.type='despesa' AND t.financial_status='liquidado' AND NOT EXISTS
        (SELECT 1 FROM transaction_attachments ta WHERE ta.transaction_id=t.id))::int AS sem_documento,
      COUNT(*) FILTER (WHERE t.financial_status='pendente')::int AS em_aberto,
      COALESCE(SUM(t.amount) FILTER (WHERE t.financial_status='pendente'),0) AS valor_em_aberto
    FROM ${financialTransactionsSql} t
    WHERE t.transaction_date >= $1 AND t.transaction_date < $2 AND t.accounting_sign=1 AND t.reversed_at IS NULL`,
  [range.start, range.end]);
  return rows[0];
}

// Cobrancas ficam no servico corporativo: sem ele (ou sem conta corporativa) o item vira "indisponivel".
async function cobrancasPendentes(usuario) {
  try {
    const dados = await cloud.listClientFollowups(usuario);
    const lista = Array.isArray(dados.items) ? dados.items : [];
    const pendentes = lista.filter((i) => ['a_faturar', 'nf_emitida'].includes(i.financialStatus)
      && i.operationalStatus !== 'em_execucao');
    return { quantidade: pendentes.length, valor: dinheiro(pendentes.reduce((s, i) => s + Math.round(Number(i.receivableAmount || 0) * 100), 0) / 100) };
  } catch {
    return null;
  }
}

async function checklistDoMes(ano, mes, usuario) {
  const nome = `${String(mes).padStart(2, '0')}/${ano}`;
  const [c, recorrentes, cobrancas, fechado] = await Promise.all([
    contagensDoMes(ano, mes),
    previaDoMes(`${ano}-${String(mes).padStart(2, '0')}`),
    cobrancasPendentes(usuario),
    getDb().query('SELECT id FROM monthly_closings WHERE year=$1 AND month=$2', [ano, mes]),
  ]);
  const item = (chave, quantidade, situacao, titulo, detalhe, valor) => ({ chave, quantidade, situacao, titulo, detalhe, ...(valor == null ? {} : { valor }) });
  const itens = [
    c.vencidas > 0
      ? item('vencidas', c.vencidas, 'pendente', `${plural(c.vencidas, 'conta a pagar vencida', 'contas a pagar vencidas')}`,
        `${brl(c.valor_vencidas)} em atraso. Pague ou ajuste o vencimento.`, dinheiro(c.valor_vencidas))
      : item('vencidas', 0, 'ok', 'Nenhuma conta a pagar vencida', `Todas as contas de ${nome} estão em dia.`),
    c.sem_documento > 0
      ? item('sem_documento', c.sem_documento, 'pendente', plural(c.sem_documento, 'despesa paga sem documento', 'despesas pagas sem documento'),
        'Anexe a NF ou o comprovante antes de fechar.')
      : item('sem_documento', 0, 'ok', 'Despesas pagas com documento', 'Todas as despesas pagas têm anexo.'),
    cobrancas === null
      ? item('cobrancas', 0, 'indisponivel', 'Cobranças sem NF ou sem envio', 'Não foi possível consultar as cobranças agora. Confira na tela Cobranças.')
      : cobrancas.quantidade > 0
        ? item('cobrancas', cobrancas.quantidade, 'pendente', plural(cobrancas.quantidade, 'cobrança sem NF ou sem envio', 'cobranças sem NF ou sem envio'),
          'Medições aprovadas que ainda não viraram cobrança.', cobrancas.valor)
        : item('cobrancas', 0, 'ok', 'Cobranças em dia', 'Toda medição aprovada tem NF e e-mail enviado.'),
    c.em_aberto > 0
      ? item('em_aberto', c.em_aberto, 'info', plural(c.em_aberto, 'lançamento em aberto', 'lançamentos em aberto'),
        'A pagar e a receber seguem no caixa; o fechamento trava só a competência.', dinheiro(c.valor_em_aberto))
      : item('em_aberto', 0, 'ok', 'Nenhum lançamento em aberto', `Tudo de ${nome} está liquidado.`),
    recorrentes.total_itens > 0
      ? item('recorrentes', recorrentes.total_itens, 'pendente', plural(recorrentes.total_itens, 'recorrente do mês não gerado', 'recorrentes do mês não gerados'),
        'Gere os lançamentos em Recorrentes antes de fechar.', dinheiro(recorrentes.total_valor))
      : recorrentes.gerados.length
        ? item('recorrentes', 0, 'ok', `Recorrentes de ${nome} gerados`, `${plural(recorrentes.gerados.length, 'modelo gerou', 'modelos geraram')} os lançamentos do mês.`)
        : item('recorrentes', 0, 'ok', `Nenhum recorrente previsto em ${nome}`, 'Nenhum modelo ativo cai neste mês.'),
  ];
  return {
    ano, mes, fechado: fechado.rows.length > 0, itens,
    total_pendencias: itens.filter((i) => i.situacao === 'pendente').length,
  };
}

module.exports = { resumoDoAno, checklistDoMes, plural };
