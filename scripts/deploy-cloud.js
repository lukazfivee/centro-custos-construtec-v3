/**
 * Publica o Centro de Custos na nuvem (Cloudflare Container `centro-custos-api`).
 *
 * Uso:
 *   node scripts/deploy-cloud.js            valida e publica
 *   node scripts/deploy-cloud.js --dry-run  apenas valida, sem publicar
 *
 * O Container serve o diretório `public/` desta raiz (COPY public ./public no
 * Dockerfile), portanto não há etapa de build antes do deploy.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const appRoot = path.join(__dirname, '..');
const configDir = path.join(appRoot, 'cloudflare', 'center-container');
const dryRun = process.argv.includes('--dry-run');

// Docker Desktop instalado por usuario fica em %LOCALAPPDATA%\Programs.
const DOCKER_HINTS = [
  ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, 'Programs', 'DockerDesktop', 'resources', 'bin')] : []),
  'C:\\Program Files\\Docker\\Docker\\resources\\bin',
  'C:\\Program Files\\Docker\\Docker\\resources',
  '/usr/local/bin',
  '/usr/bin',
];

const resolveDockerDir = () => {
  for (const dir of DOCKER_HINTS) {
    const candidate = path.join(dir, process.platform === 'win32' ? 'docker.exe' : 'docker');
    if (fs.existsSync(candidate)) return dir;
  }
  return null;
};

const withDockerOnPath = () => {
  const dockerDir = resolveDockerDir();
  if (!dockerDir) {
    console.error('Docker nao encontrado. Instale o Docker Desktop e inicie o servico.');
    process.exit(1);
  }
  if (process.env.PATH.split(path.delimiter).includes(dockerDir)) return dockerDir;
  process.env.PATH = `${dockerDir}${path.delimiter}${process.env.PATH}`;
  return dockerDir;
};

const dockerDir = withDockerOnPath();

const dockerBin = path.join(
  dockerDir,
  process.platform === 'win32' ? 'docker.exe' : 'docker',
);

const probe = spawnSync(dockerBin, ['version', '--format', '{{.Server.Version}}'], {
  encoding: 'utf8',
});
if (probe.status !== 0) {
  console.error('O daemon do Docker nao respondeu. Abra o Docker Desktop e tente novamente.');
  process.exit(1);
}
console.log(`Docker ${probe.stdout.trim()} detectado em ${dockerDir}`);

if (!fs.existsSync(configDir)) {
  console.error(`Configuracao ausente: ${configDir}`);
  process.exit(1);
}

const wrangler = path.join(appRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const wranglerArgs = fs.existsSync(wrangler)
  ? [wrangler]
  : ['--yes', 'wrangler@4.131.2'];

const args = [
  ...wranglerArgs,
  'deploy',
  `--config=${path.join(configDir, 'wrangler.jsonc')}`,
  ...(dryRun ? ['--dry-run'] : []),
];

console.log(`\n${dryRun ? 'Validando' : 'Publicando'} centro-custos-api...\n`);

const result = spawnSync(process.execPath, args, {
  cwd: configDir,
  stdio: 'inherit',
  shell: false,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);

if (dryRun) {
  console.log('\nValidacao concluida. Nada foi publicado.');
} else {
  console.log('\nPublicado. O Container troca a imagem somente apos hibernar');
  console.log('(sleepAfter de 10 minutos): aguarde cerca de um minuto antes');
  console.log('de concluir que a interface nao mudou.');
}
