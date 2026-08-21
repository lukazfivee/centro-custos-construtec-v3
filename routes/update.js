const express = require('express');
const router = express.Router();
const { autenticar } = require('../middleware/auth');
const updater = require('../services/updater');

router.get('/check', autenticar, (req, res) => {
  try {
    updater.check();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
});

router.get('/status', autenticar, (req, res) => {
  res.json(updater.getState());
});

router.post('/download', autenticar, (req, res) => {
  try {
    updater.download();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
});

router.post('/install', autenticar, (req, res) => {
  try {
    res.json({ ok: true, mensagem: 'Instalando atualização...' });
    setTimeout(() => updater.install(), 500);
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
});

module.exports = router;
