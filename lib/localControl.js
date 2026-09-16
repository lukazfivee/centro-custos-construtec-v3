const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

function runtimeDir() {
  return process.env.CONSTRUTEC_RUNTIME_DIR || path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'Construtec', 'Suite', 'runtime');
}

async function registerControl(service, shutdown) {
  if (!['centro-custos', 'portal-hub'].includes(service)) throw new Error('Serviço inválido');
  const directory = runtimeDir();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const token = crypto.randomBytes(32).toString('hex');
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\construtec-${service}-${process.pid}`
    : path.join(directory, `${service}-${process.pid}.sock`);
  const recordPath = path.join(directory, `${service}-${process.pid}.json`);
  let stopping = false;
  const control = net.createServer(socket => {
    let input = '';
    socket.setTimeout(2000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', chunk => {
      input += chunk;
      if (input.length > 256) return socket.destroy();
      if (!input.includes('\n')) return;
      const received = Buffer.from(input.trim());
      const expected = Buffer.from(token);
      if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
        socket.end('denied\n');
        return;
      }
      socket.end(`stopping:${service}\n`);
      if (!stopping) {
        stopping = true;
        control.close();
        fs.rmSync(recordPath, { force: true });
        setImmediate(() => shutdown());
      }
    });
  });
  await new Promise((resolve, reject) => {
    control.once('error', reject);
    control.listen(pipe, resolve);
  });
  fs.writeFileSync(recordPath, JSON.stringify({ service, pid: process.pid, pipe, token }), { flag: 'wx', mode: 0o600 });
  const cleanup = () => { control.close(); fs.rmSync(recordPath, { force: true }); };
  process.once('exit', cleanup);
  return cleanup;
}

async function stopServices() {
  const directory = runtimeDir();
  if (!fs.existsSync(directory)) throw new Error('Nenhum serviço com controle seguro. Use a versão atual do launcher.');
  const records = fs.readdirSync(directory).filter(name => /^(centro-custos|portal-hub)-\d+\.json$/.test(name));
  if (!records.length) throw new Error('Nenhum serviço registrado para encerramento seguro.');
  for (const name of records) {
    const record = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
    if (!['centro-custos', 'portal-hub'].includes(record.service) || !Number.isSafeInteger(record.pid)
      || !/^[a-f0-9]{64}$/.test(record.token)) throw new Error('Registro de controle inválido');
    await new Promise((resolve, reject) => {
      const socket = net.connect(record.pipe);
      let response = '';
      socket.setTimeout(5000, () => socket.destroy(new Error('Controle local não respondeu')));
      socket.on('error', reject);
      socket.on('connect', () => socket.write(record.token + '\n'));
      socket.on('data', chunk => { response += chunk; });
      socket.on('end', () => response.trim() === `stopping:${record.service}` ? resolve() : reject(new Error('Controle recusado')));
    });
    const deadline = Date.now() + 15000;
    let exited = false;
    while (Date.now() < deadline) {
      try { process.kill(record.pid, 0); }
      catch (error) { if (error.code !== 'ESRCH') throw error; exited = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!exited) throw new Error(`${record.service}: encerramento ainda pendente`);
    console.log(`${record.service}: encerrado.`);
  }
}

if (require.main === module) stopServices().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { registerControl, stopServices };
