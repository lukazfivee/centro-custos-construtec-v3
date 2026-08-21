require('dotenv').config();
const express = require('express');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { initializeDatabase, closeDatabase, getDb, getInstanceIdentity } = require('./db');
const { observability } = require('./middleware/observability');
const logger = require('./lib/logger');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', 'strong');
  app.use(observability);
  app.use(express.json({ limit:process.env.JSON_BODY_LIMIT || '110mb', strict:true }));

  app.get('/api/health/live', (req, res) => {
    res.json({ status:'ok', service:'centro-custos', uptimeSeconds:Math.round(process.uptime()) });
  });
  app.get('/api/health/ready', async (req, res, next) => {
    try {
      const started = process.hrtime.bigint();
      await getDb().query('SELECT 1');
      const databaseLatencyMs = Number(process.hrtime.bigint() - started) / 1e6;
      res.json({ status:'ok', database:'connected', databaseLatencyMs:Math.round(databaseLatencyMs * 100) / 100, instancia:getInstanceIdentity() });
    } catch (error) { next(error); }
  });
  app.get('/api/health', async (req, res, next) => {
    try {
      const started = process.hrtime.bigint();
      await getDb().query('SELECT 1');
      const pkg = require('./package.json');
      const databaseLatencyMs = Number(process.hrtime.bigint() - started) / 1e6;
      res.json({ status:'ok', database:'connected', version:pkg.version, uptimeSeconds:Math.round(process.uptime()), databaseLatencyMs:Math.round(databaseLatencyMs * 100) / 100, instancia:getInstanceIdentity(), reportDeliveryConfigured:Boolean(process.env.REPORT_API_URL) });
    } catch (error) { next(error); }
  });
  app.get('/api/version', (req, res) => {
    const pkg = require('./package.json');
    res.json({ version:pkg.version, updateUrl:process.env.UPDATE_URL || '', githubRepo:process.env.GITHUB_REPO || '' });
  });

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/usuarios', require('./routes/users'));
  app.use('/api/centros-custo', require('./routes/costCenters'));
  app.use('/api/categorias', require('./routes/categories'));
  app.use('/api/fornecedores', require('./routes/suppliers'));
  app.use('/api/historico', require('./routes/history'));
  app.use('/api/lancamentos', require('./routes/transactions'));
  app.use('/api/anexos', require('./routes/attachments'));
  app.use('/api/produtividade', require('./routes/productivity'));
  app.use('/api/bancos', require('./routes/banking'));
  app.use('/api/insights', require('./routes/insights'));
  app.use('/api/dashboard', require('./routes/dashboard'));
  app.use('/api/sincronizacao', require('./routes/sync'));
  app.use('/api/sincronizacao-inteligente', require('./routes/smartSync'));
  app.use('/api/backup', require('./routes/backup'));
  app.use('/api/backup-automatico', require('./routes/backupAuto'));
  app.use('/api/first-use', require('./routes/firstUse'));
  app.use('/api/cadastro-sync', require('./routes/cadastroSync'));
  app.use('/api/fechamento-mensal', require('./routes/monthlyClosing'));
  app.use('/api/recorrentes', require('./routes/recurring'));
  app.use('/api/update', require('./routes/update'));
  app.use('/api/bug-reports', require('./routes/bugReports'));
  app.use('/api/appearance', require('./routes/appearance'));
  app.use('/api/sistema', require('./routes/system'));

  const publicDir = path.join(__dirname, 'public');
  const indexPath = path.join(publicDir, 'index.html');
  const sendIndex = (req, res, next) => {
    try {
      let html = fs.readFileSync(indexPath, 'utf8');
      if (!html.includes('report-v2.js')) {
        html = html.replace('</body>', '  <script src="report-v2.js"></script>\n</body>');
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.type('html').send(html);
    } catch (error) { next(error); }
  };

  app.get('/', sendIndex);
  app.use(express.static(publicDir, {
    etag:true,
    index:false,
    setHeaders(res, filePath) {
      if (/\.(?:woff2?|png|jpe?g|gif|svg|ico)$/i.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=604800');
      else if (/\.(?:js|css|html)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  app.use('/api', (req, res) => res.status(404).json({ erro:'Rota da API não encontrada.', requestId:req.requestId }));
  app.get('*', sendIndex);

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const payload = { requestId:req.requestId };
    if (error.type === 'entity.too.large') return res.status(413).json({ ...payload, erro:'O arquivo ou conteúdo enviado ultrapassa o limite permitido.' });
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) return res.status(400).json({ ...payload, erro:'O conteúdo JSON enviado é inválido.' });
    if (error.statusCode) return res.status(error.statusCode).json({ ...payload, erro:error.message });
    if (error.code === '23505') return res.status(409).json({ ...payload, erro:'Já existe um cadastro com estes dados.' });
    if (error.code === '23503') return res.status(409).json({ ...payload, erro:'O registro está sendo usado e não pode ser removido.' });
    logger.error('unhandled_request_error', { requestId:req.requestId, method:req.method, path:req.originalUrl?.split('?')[0], error });
    return res.status(500).json({ ...payload, erro:'Não foi possível concluir a operação.' });
  });
  return app;
}

function localIPv4s() {
  return Object.values(os.networkInterfaces()).flat().filter((item) => item && item.family === 'IPv4' && !item.internal).map((item) => item.address);
}

function positiveEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function start() {
  const t0 = Date.now();
  const secret = process.env.JWT_SECRET || '';
  if (secret.length < 32) throw new Error('Defina JWT_SECRET no .env com pelo menos 32 caracteres.');
  const t1 = Date.now();
  const info = await initializeDatabase();
  const t2 = Date.now();
  const port = Number(process.env.PORT || 3333);
  const host = process.env.HOST || '127.0.0.1';
  let server;
  const app = createApp();
  const t3 = Date.now();
  try {
    server = await new Promise((resolve, reject) => {
      const candidate = app.listen(port, host, () => resolve(candidate));
      candidate.once('error', reject);
    });
  } catch (error) {
    await closeDatabase();
    throw error;
  }
  server.keepAliveTimeout = positiveEnv('HTTP_KEEP_ALIVE_TIMEOUT_MS', 5000);
  server.headersTimeout = Math.max(positiveEnv('HTTP_HEADERS_TIMEOUT_MS', 6500), server.keepAliveTimeout + 1000);
  server.requestTimeout = positiveEnv('HTTP_REQUEST_TIMEOUT_MS', 120000);

  const { startAutoBackup, stopAutoBackup } = require('./services/autoBackup');
  const { startReportDelivery, stopReportDelivery } = require('./services/reportDelivery');
  startAutoBackup();
  startReportDelivery();

  const t4 = Date.now();
  logger.info('application_started', { performanceMs:{env:t1-t0,database:t2-t1,app:t3-t2,listen:t4-t3,total:t4-t0}, databaseMode:info.mode, instance:info.instance.name, host, port, reportDeliveryConfigured:Boolean(process.env.REPORT_API_URL) });
  console.log(`\nCentro de Custos — ${info.instance.name}`);
  console.log(`Banco: ${info.mode === 'pglite' ? `local (${info.dataDir})` : 'PostgreSQL central'}`);
  console.log(`Abrir no navegador: http://localhost:${port}`);
  if (host === '0.0.0.0') localIPv4s().forEach((ip) => console.log(`Rede local: http://${ip}:${port}`));
  console.log(`Reports: ${process.env.REPORT_API_URL ? 'entrega central habilitada' : 'fila local aguardando configuração central'}.\n`);

  let shuttingDown = false;
  async function shutdown(reason = 'manual') {
    if (shuttingDown) return;
    shuttingDown = true;
    stopAutoBackup();
    stopReportDelivery();
    logger.info('application_shutdown_started', { reason });
    const forceTimer = setTimeout(() => { logger.error('application_shutdown_forced', { reason }); process.exit(1); }, positiveEnv('SHUTDOWN_TIMEOUT_MS', 10000));
    forceTimer.unref();
    server.close(async () => {
      try { await closeDatabase(); clearTimeout(forceTimer); logger.info('application_shutdown_completed', { reason }); process.exit(0); }
      catch (error) { logger.error('application_shutdown_failed', { reason, error }); process.exit(1); }
    });
  }
  app.locals.requestShutdown = () => shutdown('requested_by_application');
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (error) => logger.error('unhandled_rejection', { error }));
  return server;
}

if (require.main === module) {
  start().catch((error) => { logger.error('application_start_failed', { error }); console.error(`\nFalha ao iniciar: ${error.message}`); process.exit(1); });
}
module.exports = { createApp, start };
