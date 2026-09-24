const jwt = require('jsonwebtoken');
const { getDb } = require('../db');
const { cloudSessionAlive } = require('../services/cloudSessionCheck');

async function autenticar(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ erro: 'Não autenticado.' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await getDb().query(
      'SELECT id, name, email, role, cloud_managed, cloud_session_token, cloud_user_id FROM users WHERE id = $1 AND active = TRUE',
      [payload.sub]
    );
    if (!rows[0]) return res.status(401).json({ erro: 'Usuário inativo ou inexistente.' });
    if (rows[0].cloud_managed) {
      const handoffHash = typeof payload.centralSessionHash === 'string' ? payload.centralSessionHash : null;
      const sessionValid = handoffHash
        ? await cloudSessionAlive(handoffHash,{ hashed:true,userId:rows[0].cloud_user_id })
        : await cloudSessionAlive(rows[0].cloud_session_token);
      if (!sessionValid) return res.status(401).json({ erro: 'Sua sessão corporativa expirou. Entre novamente.' });
      if (handoffHash) rows[0].cloud_session_token = `hash:${handoffHash}`;
    }
    req.usuario = rows[0];
    return next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ erro: 'Sessão inválida ou expirada.' });
    }
    return next(error);
  }
}

function exigirPapel(...roles) {
  return (req, res, next) => {
    if (!req.usuario || !roles.includes(req.usuario.role)) {
      return res.status(403).json({ erro: 'Você não tem permissão para esta ação.' });
    }
    return next();
  };
}

module.exports = { autenticar, exigirPapel };
