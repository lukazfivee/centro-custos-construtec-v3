const express = require('express');
const { getDb } = require('../db');
const { autenticar } = require('../middleware/auth');
const { asyncRoute, httpError } = require('../lib/http');

const router = express.Router();

async function safeCount(db, table) {
  try {
    const { rows } = await db.query(`SELECT COUNT(*)::int AS total FROM ${table}`);
    return rows[0].total;
  } catch { return 0; }
}

router.get('/status', autenticar, asyncRoute(async (req, res) => {
  const db = getDb();
  const [obras, categorias, fornecedores, usuarios] = await Promise.all([
    safeCount(db, 'cost_centers'),
    safeCount(db, 'categories'),
    safeCount(db, 'suppliers'),
    safeCount(db, 'users'),
  ]);
  const setting = await db.query("SELECT value FROM app_settings WHERE key = 'first_use_completed'");
  const profile = await db.query('SELECT profile_photo IS NOT NULL AS configured FROM users WHERE id=$1',[req.usuario.id]);
  const completed = setting.rows[0]?.value === 'true';
  res.json({
    completed,
    counts: { obras, categorias, fornecedores, usuarios, foto:profile.rows[0]?.configured ? 1 : 0 },
  });
}));

router.post('/complete', autenticar, asyncRoute(async (req, res) => {
  if (req.usuario.role !== 'admin') throw httpError(403, 'Somente administradores podem finalizar o assistente.');
  const db = getDb();
  const existing = await db.query("SELECT value FROM app_settings WHERE key = 'first_use_completed'");
  if (existing.rows[0]) {
    await db.query("UPDATE app_settings SET value = 'true' WHERE key = 'first_use_completed'");
  } else {
    await db.query("INSERT INTO app_settings (key, value) VALUES ('first_use_completed', 'true')");
  }
  res.json({ ok: true });
}));

module.exports = router;
