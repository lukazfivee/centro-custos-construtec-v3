const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

function getDataRoot() {
  return process.env.RESTORE_ROOT_DIR || path.join(process.env.APPDATA || '', 'Construtec', 'CentroCustos', 'dados');
}

function getPrefsPath() {
  return path.join(getDataRoot(), 'preferences.json');
}

function loadPrefs() {
  try {
    const p = getPrefsPath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {}
  return {};
}

function savePrefs(prefs) {
  const dir = getDataRoot();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getPrefsPath(), JSON.stringify(prefs, null, 2), 'utf8');
}

router.get('/', (req, res) => {
  const prefs = loadPrefs();
  res.json({ darkMode: prefs.darkMode === true, configured:typeof prefs.darkMode === 'boolean' });
});

router.post('/', (req, res) => {
  const prefs = loadPrefs();
  if (typeof req.body.darkMode === 'boolean') prefs.darkMode = req.body.darkMode;
  savePrefs(prefs);
  res.json({ ok: true });
});

module.exports = router;
