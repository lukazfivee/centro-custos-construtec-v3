const path = require('path');

// Onde cada tela da Suíte vive. Os arquivos do Orçamentos (modules/) são gerados por
// scripts/build-suite-modules.js a partir do repositório do Orçamentos e não ficam no Git.
module.exports = function suiteModules(appRoot) {
  const orcamentos = path.join(appRoot, 'modules');
  return {
    centro: {
      id: 'centro',
      port: 3333,
    },
    orcamentos: {
      id: 'orcamentos',
      apiPort: Number(process.env.CONSTRUTEC_API_PORT || 5176),
      entry: path.join(orcamentos, 'orcamentos-main', 'index.cjs'),
      preload: path.join(orcamentos, 'orcamentos-main', 'preload.cjs'),
      renderer: path.join(orcamentos, 'orcamentos', 'index.html'),
    },
  };
};
