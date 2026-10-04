const express = require('express');
const { getDb } = require('../db');
const { autenticar } = require('../middleware/auth');
const { exigirPermissao } = require('../services/permissions');
const { asyncRoute, httpError } = require('../lib/http');
const { recordAudit } = require('../services/audit');
const { currentMonth } = require('../lib/dates');
const { resumoDoAno, checklistDoMes, plural } = require('../services/closingChecklist');

const router = express.Router();
router.use(autenticar);

const MOTIVO_MINIMO = 10;
const rotulo = (ano, mes) => `${String(mes).padStart(2, '0')}/${ano}`;

function lerAno(valor) {
  const ano = valor === undefined || valor === '' ? Number(currentMonth().slice(0, 4)) : Number(valor);
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) throw httpError(400, 'Ano inválido.');
  return ano;
}

function lerMes(valor) {
  const mes = Number(valor);
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) throw httpError(400, 'Mês inválido.');
  return mes;
}

// Pendencias que o administrador viu e aceitou ao fechar: [{ chave, titulo, quantidade, valor?, detalhe? }].
function lerPendencias(valor) {
  if (valor === undefined || valor === null) return [];
  if (!Array.isArray(valor) || valor.length > 20) throw httpError(400, 'Pendências inválidas.');
  return valor.map((p) => {
    const chave = String(p && p.chave || '').trim();
    const titulo = String(p && p.titulo || '').trim();
    const quantidade = Number(p && p.quantidade);
    if (!/^[a-z_]{1,40}$/.test(chave) || !titulo || titulo.length > 120 || !Number.isInteger(quantidade) || quantidade < 0 || quantidade > 1000000) {
      throw httpError(400, 'Pendência inválida: informe chave, título e quantidade.');
    }
    const saida = { chave, titulo, quantidade };
    if (p.valor !== undefined && p.valor !== null) {
      const valorPendencia = Number(p.valor);
      if (!Number.isFinite(valorPendencia) || valorPendencia < 0) throw httpError(400, 'Valor da pendência inválido.');
      saida.valor = Math.round(valorPendencia * 100) / 100;
    }
    const detalhe = String(p.detalhe || '').trim().slice(0, 240);
    if (detalhe) saida.detalhe = detalhe;
    return saida;
  });
}

router.get('/', asyncRoute(async (req, res) => {
  const { rows } = await getDb().query(`
    SELECT mc.id,mc.year,mc.month,mc.closed_at,mc.closed_by,u.name AS fechado_por,mc.pendencias
    FROM monthly_closings mc JOIN users u ON u.id=mc.closed_by
    ORDER BY mc.year DESC,mc.month DESC
  `);
  res.json(rows);
}));

// Totais, situacao, quem fechou e motivo da ultima reabertura de cada mes do ano.
router.get('/resumo', exigirPermissao('p8'), asyncRoute(async (req, res) => {
  const ano = lerAno(req.query.ano);
  res.json({ ano, meses: await resumoDoAno(ano) });
}));

router.get('/checklist', exigirPermissao('p8'), asyncRoute(async (req, res) => {
  res.json(await checklistDoMes(lerAno(req.query.ano), lerMes(req.query.mes), req.usuario));
}));

router.post('/', exigirPermissao('p8'), asyncRoute(async (req, res) => {
  const year = Number(req.body.ano);
  const month = Number(req.body.mes);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw httpError(400, 'Ano inválido.');
  if (!Number.isInteger(month) || month < 1 || month > 12) throw httpError(400, 'Mês inválido.');
  const pendencias = lerPendencias(req.body.pendencias);
  const db = getDb();
  const existing = await db.query('SELECT id FROM monthly_closings WHERE year=$1 AND month=$2', [year, month]);
  if (existing.rows[0]) throw httpError(409, 'Este mês já está fechado.');
  try {
    await db.query('INSERT INTO monthly_closings (year, month, closed_by, pendencias) VALUES ($1,$2,$3,$4::jsonb)',
      [year, month, req.usuario.id, pendencias.length ? JSON.stringify(pendencias) : null]);
  } catch (error) {
    if (error.code === '23505') throw httpError(409, 'Este mês já está fechado.');
    throw error;
  }
  const comPendencias = pendencias.length ? ` com ${plural(pendencias.length, 'pendência registrada', 'pendências registradas')}` : '';
  await recordAudit({
    entityType: 'fechamento', entityId: `${year}-${month}`, action: 'fechado',
    summary: `Competência ${rotulo(year, month)} fechada${comPendencias}.`,
    data: { year, month, pendencias }, user: req.usuario,
  });
  res.status(201).json({ ok: true, mensagem: `Competência ${rotulo(year, month)} fechada com sucesso.` });
}));

router.delete('/:id', exigirPermissao('p8'), asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'ID inválido.');
  const motivo = String(req.body?.motivo || '').trim();
  if (motivo.length < MOTIVO_MINIMO) throw httpError(400, `Informe o motivo da reabertura com pelo menos ${MOTIVO_MINIMO} caracteres.`);
  const db = getDb();
  const { rows } = await db.query('SELECT id,year,month,closed_at,closed_by,pendencias FROM monthly_closings WHERE id=$1', [id]);
  if (!rows[0]) throw httpError(404, 'Fechamento não encontrado.');
  await db.query('DELETE FROM monthly_closings WHERE id=$1', [id]);
  await recordAudit({
    entityType: 'fechamento', entityId: `${rows[0].year}-${rows[0].month}`, action: 'reaberto',
    summary: `Competência ${rotulo(rows[0].year, rows[0].month)} reaberta.`,
    data: { ...rows[0], motivo: motivo.slice(0, 500) }, user: req.usuario,
  });
  res.json({ ok: true, mensagem: 'Competência reaberta e registrada no histórico.' });
}));

module.exports = router;
