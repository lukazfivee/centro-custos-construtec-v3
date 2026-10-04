// Quem pode entrar em qual app da Suite (lista `apps` da conta; revisao de seguranca de 04/10/2026, M1).
// Conta antiga, sem `apps` definido, vale como todos os apps.
const { parseApps } = require('./userAccess');

const APP_DENIED_MESSAGE = 'Sua conta não tem acesso ao Centro de Custos. Peça a um administrador para liberar.';

function appAllowed(user, app) {
  return parseApps(user?.apps).includes(app);
}

module.exports = { appAllowed, APP_DENIED_MESSAGE };
