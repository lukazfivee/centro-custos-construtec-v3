require('dotenv').config();
if (process.env.REPORT_API_URL === undefined) process.env.REPORT_API_URL = 'https://centro-custos-reports.construtec-reports.workers.dev';
if (!process.env.SYNC_API_URL) process.env.SYNC_API_URL = 'https://centro-custos-api.construtec-reports.workers.dev';
if (process.env.MOBILE_APP_URL === undefined) process.env.MOBILE_APP_URL = 'https://centro-custos-api.construtec-reports.workers.dev';
const express = require('express');
const os = require('os');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { initializeDatabase, closeDatabase, getDb, getInstanceIdentity } = require('./db');
const { observability } = require('./middleware/observability');
const logger = require('./lib/logger');

function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function createApp({ orcamentosApp } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', 'strong');
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    next();
  });
  app.use(observability);
  app.use(express.json({
    limit:process.env.JSON_BODY_LIMIT || '110mb',
    strict:true,
    verify: (req, _res, buf) => { req.rawBody = buf; },
  }));

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
      res.json({
        status:'ok',database:'connected',version:pkg.version,uptimeSeconds:Math.round(process.uptime()),
        databaseLatencyMs:Math.round(databaseLatencyMs * 100) / 100,instancia:getInstanceIdentity(),
        reportDeliveryConfigured:Boolean(process.env.REPORT_API_URL),
        cloudSyncConfigured:Boolean(process.env.SYNC_API_URL),
      });
    } catch (error) { next(error); }
  });
  app.get('/api/version', (req, res) => {
    const pkg = require('./package.json');
    const port = Number(process.env.PORT || 3333);
    const mobileUrls = process.env.HOST === '0.0.0.0' ? localIPv4s().map((ip) => `http://${ip}:${port}`) : [];
    res.json({ version:pkg.version, updateUrl:process.env.UPDATE_URL || '', githubRepo:process.env.GITHUB_REPO || '', mobileAppUrl:resolveMobileAppUrl(), mobileUrls });
  });
  app.get('/api/mobile-qr', async (req, res, next) => {
    try {
      const url = resolveMobileAppUrl();
      if (!url) return res.status(503).json({ erro:'A versão mobile HTTPS não está configurada.' });
      const svg = await QRCode.toString(url, { type:'svg', width:240, margin:1, color:{ dark:'#021D26', light:'#FFFFFF' } });
      res.setHeader('Cache-Control', 'no-store');
      return res.type('svg').send(svg);
    } catch (error) { return next(error); }
  });

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/usuarios', require('./routes/users'));
  app.use('/api/centros-custo', require('./routes/costCenters'));
  app.use('/api/notas-fiscais-centro', require('./routes/costCenterInvoices'));
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
  app.use('/api/integracao/orcamentos', require('./routes/integracaoOrcamentos'));
  app.use('/api/cloud-sync', require('./routes/cloudSync'));
  app.use('/api/backup', require('./routes/backup'));
  app.use('/api/backup-automatico', require('./routes/backupAuto'));
  app.use('/api/first-use', require('./routes/firstUse'));
  app.use('/api/cadastro-sync', require('./routes/cadastroSync'));
  app.use('/api/fechamento-mensal', require('./routes/monthlyClosing'));
  app.use('/api/recorrentes', require('./routes/recurring'));
  app.use('/api/update', require('./routes/update'));
  app.use('/api/bug-reports', require('./routes/bugReports'));
  app.use('/api/jobs', require('./routes/jobs'));
  app.use('/api/appearance', require('./routes/appearance'));
  app.use('/api/sistema', require('./routes/system'));

  const CHAMADOPRO_URL = process.env.CHAMADOPRO_URL || 'http://127.0.0.1:4555';
  const ORCAMENTOS_API_URL = process.env.ORCAMENTOS_API_URL || 'http://127.0.0.1:5176';
  const ORCAMENTOS_RENDERER_DIR = path.join(__dirname, 'modules', 'orcamentos');

  async function proxyPass(req, res, baseUrl, stripHeaders) {
    try {
      const target = `${baseUrl}${req.url}`;
      const headers = { ...req.headers, host: new URL(baseUrl).host };
      if (stripHeaders) { delete headers['x-frame-options']; delete headers['content-security-policy']; }
      const init = { method: req.method, headers };
      if (['POST','PUT','PATCH'].includes(req.method)) {
        if (req.rawBody?.length) {
          init.body = req.rawBody;
          delete headers['content-length'];
        } else if (req.body !== undefined) {
          init.body = JSON.stringify(req.body);
          delete headers['content-length'];
        } else init.body = await rawBody(req);
      }
      const resp = await fetch(target, init);
      for (const [k, v] of resp.headers) {
        const lk = k.toLowerCase();
        if (stripHeaders && (lk === 'x-frame-options' || lk === 'content-security-policy')) continue;
        if (lk === 'transfer-encoding') continue;
        res.setHeader(k, v);
      }
      res.status(resp.status);
      const { Readable } = require('stream');
      Readable.fromWeb(resp.body).pipe(res);
    } catch (err) {
      res.status(502).json({ erro: 'Serviço indisponível', detalhe: err.message });
    }
  }

  app.use('/chamados-proxy', (req, res) => proxyPass(req, res, CHAMADOPRO_URL, true));
  if (orcamentosApp) app.use('/orcamentos-api', orcamentosApp);
  else app.use('/orcamentos-api', (req, res) => proxyPass(req, res, ORCAMENTOS_API_URL, false));
  app.use('/orcamentos', express.static(ORCAMENTOS_RENDERER_DIR, { index:'index.html', etag:true }));
  app.get('/orcamentos/*', (req, res) => res.sendFile(path.join(ORCAMENTOS_RENDERER_DIR, 'index.html')));

  const publicDir = path.join(__dirname, 'public');
  const indexPath = path.join(publicDir, 'index.html');
  const sendIndex = (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexPath);
  };

  app.get('/', sendIndex);
  app.use(express.static(publicDir, {
    etag:true,index:false,
    setHeaders(res, filePath) {
      if (/\.(?:woff2?|png|jpe?g|gif|svg|ico)$/i.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=604800');
      else if (/\.(?:js|css|html)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  // Embedded Orçamentos uses relative /api URLs; proxy only requests coming from that renderer.
  app.use('/api', (req, res) => {
    if (req.get('referer')?.includes('/orcamentos/')) {
      req.url = `/api${req.url}`;
      return proxyPass(req, res, ORCAMENTOS_API_URL, false);
    }
    return res.status(404).json({ erro:'Rota da API não encontrada.', requestId:req.requestId });
  });
  app.get('*', sendIndex);

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const payload = { requestId:req.requestId };
    if (error.type === 'entity.too.large') return res.status(413).json({ ...payload, erro:'O arquivo ou conteúdo enviado ultrapassa o limite permitido.' });
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) return res.status(400).json({ ...payload, erro:'O conteúdo JSON enviado é inválido.' });
    if (error.statusCode) {
      if (error.statusCode >= 500) logger.error('request_failed', { requestId:req.requestId, method:req.method, path:req.originalUrl?.split('?')[0], error });
      return res.status(error.statusCode).json({ ...payload, erro:error.publicMessage || error.message });
    }
    if (error.code === '23505') return res.status(409).json({ ...payload, erro:'Já existe um cadastro com estes dados.' });
    if (error.code === '23503') return res.status(409).json({ ...payload, erro:'O registro está sendo usado e não pode ser removido.' });
    logger.error('unhandled_request_error', { requestId:req.requestId, method:req.method, path:req.originalUrl?.split('?')[0], error });
    return res.status(500).json({ ...payload, erro:'Não foi possível concluir a operação.' });
  });
  return app;
}

function localIPv4s() {
  const privateIp = (address) => /^10\./.test(address) || /^192\.168\./.test(address) || /^172\.(1[6-9]|2\d|3[01])\./.test(address);
  return Object.values(os.networkInterfaces()).flat().filter((item) => item && item.family === 'IPv4' && !item.internal && privateIp(item.address)).map((item) => item.address).sort((a, b) => Number(b.startsWith('192.168.')) - Number(a.startsWith('192.168.')));
}

function resolveMobileAppUrl(value = process.env.MOBILE_APP_URL) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:') return '';
    url.hash = '';
    return url.href.replace(/\/$/, '');
  } catch {
    return '';
  }
}

function positiveEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function start(options = {}) {
  const t0 = Date.now();
  const secret = process.env.JWT_SECRET || '';
  if (secret.length < 32) throw new Error('Defina JWT_SECRET no .env com pelo menos 32 caracteres.');
  const t1 = Date.now();
  const info = await initializeDatabase();
  const t2 = Date.now();
  const port = Number(process.env.PORT || 3333);
  const host = process.env.HOST || '127.0.0.1';
  let server;
  const app = createApp(options);
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
  const { startJobRunner } = require('./lib/jobs');
  startAutoBackup();
  startReportDelivery();
  await startJobRunner();

  const t4 = Date.now();
  logger.info('application_started', { performanceMs:{env:t1-t0,database:t2-t1,app:t3-t2,listen:t4-t3,total:t4-t0}, databaseMode:info.mode, instance:info.instance.name, host, port, reportDeliveryConfigured:Boolean(process.env.REPORT_API_URL), cloudSyncConfigured:Boolean(process.env.SYNC_API_URL) });
  console.log(`\nCentro de Custos — ${info.instance.name}`);
  console.log(`Banco: ${info.mode === 'pglite' ? `local (${info.dataDir})` : 'PostgreSQL central'}`);
  console.log(`Abrir no navegador: http://localhost:${port}`);
  if (host === '0.0.0.0') localIPv4s().forEach((ip) => console.log(`Rede local: http://${ip}:${port}`));
  console.log(`Reports: ${process.env.REPORT_API_URL ? 'entrega central habilitada' : 'fila local aguardando configuração central'}.`);
  console.log(`Cloud Sync: ${process.env.SYNC_API_URL ? 'API corporativa configurada' : 'aguardando configuração'}.\n`);

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
  await require('./lib/localControl').registerControl('centro-custos', app.locals.requestShutdown);
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (error) => logger.error('unhandled_rejection', { error }));
  process.on('uncaughtException', (error) => {
    logger.error('uncaught_exception', { error });
    void shutdown('uncaughtException');
  });
  return server;
}

if (require.main === module) {
  start().catch((error) => { logger.error('application_start_failed', { error }); console.error(`\nFalha ao iniciar: ${error.message}`); process.exit(1); });
}
module.exports = { createApp, start, resolveMobileAppUrl };
