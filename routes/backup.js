const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { getDb, getInstanceIdentity } = require('../db');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute, httpError } = require('../lib/http');
const { recordAudit } = require('../services/audit');

const router = express.Router();
router.use(autenticar, exigirPapel('admin'));

function restoreRootDir() {
  return path.resolve(process.env.RESTORE_ROOT_DIR || path.join(__dirname, '..', 'dados'));
}

function markerPath() {
  return path.join(restoreRootDir(), 'restauracao-pendente.json');
}

router.get('/status', asyncRoute(async (req, res) => {
  const pending = readPendingMarker();
  const restoreDirectory = path.join(restoreRootDir(), 'restauracoes');
  let storedArchives = 0;
  let latestArchive = null;
  if (fs.existsSync(restoreDirectory)) {
    const entries = fs.readdirSync(restoreDirectory, { withFileTypes:true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.tar.gz'));
    storedArchives = entries.length;
    for (const entry of entries) {
      const stat = fs.statSync(path.join(restoreDirectory, entry.name));
      if (!latestArchive || stat.mtimeMs > latestArchive.mtimeMs) {
        latestArchive = { name:entry.name, bytes:stat.size, modifiedAt:stat.mtime.toISOString(), mtimeMs:stat.mtimeMs };
      }
    }
  }
  if (latestArchive) delete latestArchive.mtimeMs;
  res.json({
    mode:getDb().dump ? 'local' : 'postgres',
    automaticBackupConfigured:false,
    pendingRestore:pending,
    storedRestoreArchives:storedArchives,
    latestRestoreArchive:latestArchive,
  });
}));

router.get('/', asyncRoute(async (req, res) => {
  const db = getDb();
  if (!db.dump) throw httpError(501, 'No modo PostgreSQL central, faça o backup com pg_dump.');
  const dump = await db.dump();
  const buffer = Buffer.from(await dump.arrayBuffer());
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const name = getInstanceIdentity().name.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase();
  const date = new Date().toISOString().replace(/[:.]/g, '-');
  await recordAudit({
    entityType:'backup',action:'criado',summary:'Backup local gerado e verificado pelo administrador.',
    data:{ bytes:buffer.length, sha256 },user:req.usuario,
  });
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="backup-${name}-${date}.tar.gz"`);
  res.setHeader('X-Backup-SHA256', sha256);
  res.setHeader('X-Backup-Size', String(buffer.length));
  res.send(buffer);
}));

router.post('/restaurar', asyncRoute(async (req, res) => {
  const db = getDb();
  if (!db.dump) throw httpError(501, 'A restauração por arquivo é exclusiva do modo local.');
  if (String(req.body.confirmacao || '') !== 'RESTAURAR') {
    throw httpError(400, 'Digite RESTAURAR para confirmar.');
  }
  if (fs.existsSync(markerPath())) {
    throw httpError(409, 'Já existe uma restauração agendada. Reinicie o sistema ou remova o agendamento antes de enviar outro arquivo.');
  }
  const filename = String(req.body.nomeArquivo || '').slice(0, 240);
  if (!/\.tar\.gz$/i.test(filename)) throw httpError(400, 'Selecione um backup .tar.gz gerado pelo sistema.');
  const buffer = decodeBase64(req.body.conteudoBase64);
  if (buffer.length < 1024 || buffer.length > 80 * 1024 * 1024) {
    throw httpError(400, 'O backup deve ter entre 1 KB e 80 MB.');
  }
  if (buffer[0] !== 0x1f || buffer[1] !== 0x8b) {
    throw httpError(400, 'O arquivo não parece ser um backup compactado válido.');
  }
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const expectedSha = String(req.body.sha256 || '').trim().toLowerCase();
  if (expectedSha && !/^[a-f0-9]{64}$/.test(expectedSha)) {
    throw httpError(400, 'O checksum SHA-256 informado é inválido.');
  }
  if (expectedSha && expectedSha !== sha256) {
    throw httpError(400, 'O checksum do arquivo não confere. O backup pode estar corrompido.');
  }
  ensureFreeSpace(restoreRootDir(), buffer.length * 3);

  const directory = path.join(restoreRootDir(), 'restauracoes');
  fs.mkdirSync(directory, { recursive:true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archivePath = path.join(directory, `restauracao-${stamp}.tar.gz`);
  fs.writeFileSync(archivePath, buffer, { flag:'wx' });
  const marker = {
    archivePath,filename,bytes:buffer.length,sha256,
    requestedAt:new Date().toISOString(),requestedBy:req.usuario.name,
  };
  const tempMarker = `${markerPath()}.tmp-${process.pid}`;
  fs.mkdirSync(restoreRootDir(), { recursive:true });
  fs.writeFileSync(tempMarker, JSON.stringify(marker, null, 2), { flag:'wx' });
  fs.renameSync(tempMarker, markerPath());
  await recordAudit({
    entityType:'backup',action:'agendado',summary:`Restauração agendada a partir de ${filename}.`,
    data:{ filename,bytes:buffer.length,sha256 },user:req.usuario,
  });
  res.json({
    ok:true,reinicioNecessario:true,sha256,
    mensagem:'Backup validado e agendado. Reinicie o sistema para aplicar. A base atual será preservada automaticamente.',
  });
}));

router.post('/reiniciar', asyncRoute(async (req, res) => {
  if (!fs.existsSync(markerPath())) throw httpError(400, 'Não existe uma restauração agendada.');
  res.json({ ok:true, mensagem:'O servidor será encerrado com segurança. Abra iniciar-windows.bat novamente em alguns segundos.' });
  setTimeout(() => req.app.locals.requestShutdown?.(), 600);
}));

function decodeBase64(value) {
  const encoded = String(value || '').replace(/^data:[^,]+,/, '').replace(/\s+/g, '');
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw httpError(400, 'Arquivo de backup inválido.');
  }
  const buffer = Buffer.from(encoded, 'base64');
  const normalizedInput = encoded.replace(/=+$/, '');
  const normalizedOutput = buffer.toString('base64').replace(/=+$/, '');
  if (!buffer.length || normalizedInput !== normalizedOutput) {
    throw httpError(400, 'Arquivo de backup inválido.');
  }
  return buffer;
}

function ensureFreeSpace(directory, requiredBytes) {
  if (typeof fs.statfsSync !== 'function') return;
  fs.mkdirSync(directory, { recursive:true });
  const stats = fs.statfsSync(directory);
  const available = Number(stats.bavail) * Number(stats.bsize);
  if (Number.isFinite(available) && available < requiredBytes) {
    throw httpError(507, 'Não há espaço livre suficiente para restaurar o backup com segurança.');
  }
}

function readPendingMarker() {
  if (!fs.existsSync(markerPath())) return null;
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath(), 'utf8'));
    return {
      filename:marker.filename || null,
      bytes:Number(marker.bytes || 0) || null,
      sha256:marker.sha256 || null,
      requestedAt:marker.requestedAt || null,
      requestedBy:marker.requestedBy || null,
    };
  } catch {
    return { invalidMarker:true };
  }
}

module.exports = router;
