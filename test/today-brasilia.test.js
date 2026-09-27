const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { todaySql } = require('../lib/dates');
const { brasiliaDates } = require('../services/dailyNotices');

// Conta "vencida" usa o hoje de Brasília, não o do servidor (UTC): depois das 21h
// uma conta que vence hoje ainda está em aberto.
test('todaySql devolve o dia de Brasília e ignora fuso inválido', async () => {
  assert.equal(todaySql(), "(now() AT TIME ZONE 'America/Sao_Paulo')::date");
  assert.equal(todaySql("UTC'; DROP TABLE x; --"), "(now() AT TIME ZONE 'America/Sao_Paulo')::date");
  assert.equal(todaySql('America/Manaus'), "(now() AT TIME ZONE 'America/Manaus')::date");
  const db = new PGlite();
  const { rows } = await db.query(`SELECT ${todaySql()}::text AS hoje,
    (TIMESTAMPTZ '2026-09-28 01:30:00+00' AT TIME ZONE 'America/Sao_Paulo')::date::text AS noite`);
  assert.equal(rows[0].hoje, brasiliaDates().today);
  assert.equal(rows[0].noite, '2026-09-27', '22h30 de Brasília ainda é o dia 27');
  await db.close();
});

test('todayIso: data padrão (estorno, liquidação) segue o dia de Brasília', () => {
  const { todayIso } = require('../lib/dates');
  const night = new Date('2026-09-28T01:30:00Z'); // 22h30 do dia 27 em Brasília
  assert.equal(todayIso('America/Sao_Paulo', night), '2026-09-27');
  assert.equal(todayIso('America/Sao_Paulo', new Date('2026-09-28T03:05:00Z')), '2026-09-28');
  assert.equal(todayIso(), brasiliaDates().today);
});
