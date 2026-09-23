const express = require('express');
const { getDb } = require('../db');
const { asyncRoute } = require('../lib/http');

const router = express.Router();
// Preferencia de tema da instalacao. Fica no banco (app_settings), e nao em
// arquivo: na nuvem o disco do Container e efemero.
const PREFS_KEY = 'appearance.preferences';

async function loadPrefs() {
  try {
    const { rows } = await getDb().query('SELECT value FROM app_settings WHERE key=$1', [PREFS_KEY]);
    return rows[0] ? JSON.parse(rows[0].value) : {};
  } catch {
    return {};
  }
}

async function savePrefs(prefs) {
  await getDb().query(
    'INSERT INTO app_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',
    [PREFS_KEY, JSON.stringify(prefs)],
  );
}

router.get('/', asyncRoute(async (req, res) => {
  const prefs = await loadPrefs();
  res.json({ darkMode: prefs.darkMode === true, configured:typeof prefs.darkMode === 'boolean' });
}));

router.post('/', asyncRoute(async (req, res) => {
  const prefs = await loadPrefs();
  if (typeof req.body.darkMode === 'boolean') prefs.darkMode = req.body.darkMode;
  await savePrefs(prefs);
  res.json({ ok: true });
}));

module.exports = router;
