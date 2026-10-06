const express = require('express');
const router = express.Router();
const { autenticar } = require('../middleware/auth');
const { exigirPermissao } = require('../services/permissions');
const updater = require('../services/updater');

function falha(res, error) {
  res.status(error.statusCode || 500).json({ erro: error.message || 'Não foi possível concluir agora.' });
}

// A verificacao pode demorar (rede): responde logo e o app acompanha por /status.
router.get('/check', autenticar, exigirPermissao('p9'), (req, res) => {
  try {
    Promise.resolve(updater.check()).catch(() => {});
    res.json({ ok: true });
  } catch (error) {
    falha(res, error);
  }
});

router.get('/status', autenticar, exigirPermissao('p9'), (req, res) => {
  res.json(updater.getState());
});

router.post('/download', autenticar, exigirPermissao('p9'), (req, res) => {
  try {
    updater.download();
    res.json({ ok: true });
  } catch (error) {
    falha(res, error);
  }
});

router.post('/install', autenticar, exigirPermissao('p9'), (req, res) => {
  try {
    const estado = updater.getState();
    if (estado.status !== 'downloaded') {
      res.status(409).json({ erro: 'A atualização ainda não foi baixada.' });
      return;
    }
    res.json({ ok: true, mensagem: 'Instalando atualização. O aplicativo vai fechar e abrir de novo.' });
    setTimeout(() => { updater.install().catch(() => {}); }, 500);
  } catch (error) {
    falha(res, error);
  }
});

module.exports = router;
