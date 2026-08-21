const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const express = require('express');
const { getDb, getDatabaseInfo, getInstanceIdentity } = require('../db');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute } = require('../lib/http');
const { snapshot } = require('../lib/metrics');

const router = express.Router();
router.use(autenticar, exigirPapel('admin'));

router.get('/status', asyncRoute(async (req, res) => {
  const pkg = require('../package.json');
  const db = getDb();
  const database = getDatabaseInfo();
  const [countsResult, migrationsResult, storage] = await Promise.all([
    db.query(`
      SELECT
        (SELECT COUNT(*)::int FROM transactions WHERE deleted_at IS NULL) AS lancamentos_ativos,
        (SELECT COUNT(*)::int FROM transactions WHERE deleted_at IS NOT NULL) AS lancamentos_excluidos,
        (SELECT COUNT(*)::int FROM cost_centers) AS centros_custo,
        (SELECT COUNT(*)::int FROM suppliers) AS fornecedores,
        (SELECT COUNT(*)::int FROM users WHERE active=TRUE) AS usuarios_ativos,
        (SELECT COUNT(*)::int FROM sync_conflicts WHERE status='pending') AS conflitos_pendentes
    `),
    db.query('SELECT filename,applied_at FROM schema_migrations ORDER BY filename DESC'),
    inspectStorage(database.dataDir),
  ]);
  const pendingRestore = pendingRestoreInfo();
  const counts = countsResult.rows[0] || {};
  const metrics = snapshot();
  res.json({
    status: 'ok',
    generatedAt: new Date().toISOString(),
    application: {
      name: pkg.productName || pkg.name,
      version: pkg.version,
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      environment: process.env.NODE_ENV || 'development',
      pid: process.pid,
      hostname: os.hostname(),
      instance: getInstanceIdentity(),
    },
    database: {
      mode: database.mode,
      storage,
      migrations: {
        total: migrationsResult.rows.length,
        latest: migrationsResult.rows[0] || null,
      },
      records: {
        activeTransactions: Number(counts.lancamentos_ativos || 0),
        deletedTransactions: Number(counts.lancamentos_excluidos || 0),
        costCenters: Number(counts.centros_custo || 0),
        suppliers: Number(counts.fornecedores || 0),
        activeUsers: Number(counts.usuarios_ativos || 0),
        pendingSyncConflicts: Number(counts.conflitos_pendentes || 0),
      },
    },
    backup: {
      automaticConfigured: false,
      pendingRestore,
    },
    metrics,
  });
}));

async function inspectStorage(dataDir) {
  if (!dataDir) return { kind:'remote', sizeBytes:null, sizeMb:null, files:null, truncated:false };
  if (!fs.existsSync(dataDir)) return { kind:'local', available:false, sizeBytes:0, sizeMb:0, files:0, truncated:false };
  const result = await directorySize(dataDir, 20000);
  return {
    kind:'local', available:true,
    sizeBytes:result.bytes,
    sizeMb:Math.round((result.bytes / 1024 / 1024) * 100) / 100,
    files:result.files,
    truncated:result.truncated,
  };
}

async function directorySize(root, maxFiles) {
  let bytes = 0;
  let files = 0;
  let truncated = false;
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try { entries = await fsp.readdir(current, { withFileTypes:true }); }
    catch { continue; }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile()) {
        files += 1;
        try { bytes += (await fsp.stat(fullPath)).size; } catch {}
        if (files >= maxFiles) { truncated = true; pending.length = 0; break; }
      }
    }
  }
  return { bytes, files, truncated };
}

function restoreRootDir() {
  return path.resolve(process.env.RESTORE_ROOT_DIR || path.join(__dirname, '..', 'dados'));
}

function pendingRestoreInfo() {
  const markerPath = path.join(restoreRootDir(), 'restauracao-pendente.json');
  if (!fs.existsSync(markerPath)) return null;
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    return {
      filename: marker.filename || null,
      requestedAt: marker.requestedAt || null,
      requestedBy: marker.requestedBy || null,
      bytes: Number(marker.bytes || 0) || null,
      sha256: marker.sha256 || null,
    };
  } catch {
    return { invalidMarker:true };
  }
}

module.exports = router;
