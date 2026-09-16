const { spawnSync } = require('child_process');
const path = require('path');

const appRoot = path.join(__dirname, '..');
const budgetsRoot = path.join(appRoot, '..', 'Construtec orçamentos', 'construtec-orcamentos');
const vite = path.join(budgetsRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const esbuild = path.join(budgetsRoot, 'node_modules', 'esbuild', 'bin', 'esbuild');
const rendererOutput = path.join(appRoot, 'modules', 'orcamentos');
const apiOutput = path.join(appRoot, 'modules', 'orcamentos-api', 'index.cjs');

const renderer = spawnSync(process.execPath, [
  vite,
  'build',
  '--config', path.join(budgetsRoot, 'vite.renderer.config.mjs'),
  '--outDir', rendererOutput,
  '--emptyOutDir',
], { cwd: budgetsRoot, stdio: 'inherit' });

if (renderer.error) throw renderer.error;
if (renderer.status !== 0) process.exit(renderer.status || 1);

const api = spawnSync(process.execPath, [
  esbuild,
  path.join(budgetsRoot, 'src', 'server', 'suite.ts'),
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--packages=external',
  `--outfile=${apiOutput}`,
], { cwd: budgetsRoot, stdio: 'inherit' });

if (api.error) throw api.error;
if (api.status !== 0) process.exit(api.status || 1);
