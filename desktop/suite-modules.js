const path = require('path');

module.exports = function suiteModules(appRoot) {
  const workspace = path.dirname(appRoot);
  return {
    centro: {
      id: 'centro',
      route: '/',
      port: 3334,
    },
    orcamentos: {
      id: 'orcamentos',
      route: '/orcamentos/',
      apiPort: 5176,
      root: path.join(workspace, 'Construtec orçamentos', 'construtec-orcamentos'),
    },
    chamados: {
      id: 'chamados',
      route: '/chamados/',
      apiPort: 4555,
      root: path.join(workspace, 'chamadopro'),
    },
  };
};
