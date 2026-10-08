// Gera modules/ (Orçamentos: renderer, processo principal e preload) para o app Suíte do Windows.
// O código do Orçamentos vive em outro repositório: informe a pasta em ORCAMENTOS_REPO ou deixe-o ao lado
// deste (../construtec-orcamentos). Precisa de `npm ci` feito lá.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const appRoot = path.join(__dirname, '..');
const candidates = [
  process.env.ORCAMENTOS_REPO,
  path.join(appRoot, '..', 'construtec-orcamentos'),
  path.join(appRoot, 'orcamentos-src'),
].filter(Boolean);
const repo = candidates.find((dir) => fs.existsSync(path.join(dir, 'scripts', 'build-suite-bundle.mjs')));
if (!repo) {
  console.error('Repositório do Orçamentos não encontrado (precisa de scripts/build-suite-bundle.mjs). Defina ORCAMENTOS_REPO.');
  process.exit(1);
}

const result = spawnSync(process.execPath, [
  path.join(repo, 'scripts', 'build-suite-bundle.mjs'),
  '--out', path.join(appRoot, 'modules'),
], { cwd: repo, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status === null ? 1 : result.status);
