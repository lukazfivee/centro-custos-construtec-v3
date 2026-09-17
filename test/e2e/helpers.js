// Infraestrutura compartilhada para os testes E2E com Selenium (Chrome
// headless). Cada teste sobe uma instância isolada do servidor (pglite em
// diretório temporário, porta efêmera) e um WebDriver próprio, para não
// interferir com a suíte de testes de API (test/*.test.js) nem entre si.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Builder, Browser, until, logging } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

const ADMIN_EMAIL = 'admin@teste.local';
const ADMIN_PASSWORD = 'Admin@123456';

async function startServer() {
  const suffix = crypto.randomBytes(4).toString('hex');
  process.env.PGLITE_DATA_DIR = path.join(os.tmpdir(), `cc-e2e-${suffix}`);
  process.env.RESTORE_ROOT_DIR = path.join(os.tmpdir(), `cc-e2e-restore-${suffix}`);
  process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
  process.env.ADMIN_INITIAL_PASSWORD = ADMIN_PASSWORD;
  process.env.ADMIN_INITIAL_EMAIL = ADMIN_EMAIL;
  process.env.INSTANCE_NAME = 'E2E';
  delete process.env.DATABASE_URL;

  // Usa createApp() + listen manual (o mesmo padrao ja comprovado por toda a
  // suite de testes de API), em vez de server.start(). start() liga os
  // ciclos de fundo (backup automatico, retry de reports, fila de jobs) que
  // nao interessam a um teste de UI e, combinados com um browser real,
  // deixaram um handle preso impedindo o processo Node de terminar.
  const { initializeDatabase, closeDatabase } = require('../../db');
  const { createApp } = require('../../server');
  delete process.env.DATABASE_URL;
  await initializeDatabase();
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  return { server, closeDatabase, baseUrl: `http://127.0.0.1:${port}` };
}

// server.close() so espera o callback depois que TODAS as conexoes (incluindo
// keep-alive do Chrome) terminarem, o que pode nunca acontecer sozinho. Um
// timeout de seguranca evita que isso trave a suite inteira.
async function stopServer(ctx) {
  if (!ctx) return;
  await Promise.race([
    new Promise((resolve) => ctx.server.close(resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  ctx.server.closeAllConnections?.();
  await ctx.closeDatabase();
  fs.rmSync(process.env.PGLITE_DATA_DIR, { recursive: true, force: true });
}

async function buildDriver() {
  const options = new chrome.Options();
  options.addArguments('--headless=new', '--disable-gpu', '--window-size=1440,1000', '--no-sandbox');
  const prefs = new logging.Preferences();
  prefs.setLevel(logging.Type.BROWSER, logging.Level.ALL);
  options.setLoggingPrefs(prefs);
  return new Builder().forBrowser(Browser.CHROME).setChromeOptions(options).build();
}

async function stopDriver(driver) {
  if (!driver) return;
  await Promise.race([
    driver.quit(),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
}

// Loga via UI (preenchendo o formulario), como um usuario real faria -
// preferido a chamar a API diretamente, ja que o objetivo do E2E e validar
// o fluxo completo pelo navegador.
async function login(driver, baseUrl, email = ADMIN_EMAIL, password = ADMIN_PASSWORD) {
  await driver.get(baseUrl);
  await driver.wait(until.elementLocated({ css: '#form-login input[type=email]' }), 10000);
  await driver.findElement({ css: '#form-login input[type=email]' }).sendKeys(email);
  await driver.findElement({ css: '#form-login input[type=password]' }).sendKeys(password);
  await driver.findElement({ css: '#form-login button[type=submit]' }).click();
  await driver.wait(until.elementLocated({ id: 'app' }), 10000);
  await driver.wait(async () => {
    const el = await driver.findElement({ id: 'app' });
    return !(await el.getAttribute('class')).includes('oculto');
  }, 10000);
}

// Coleta erros de console (level SEVERE) acumulados durante a navegacao.
// Chrome expõe isso via o log driver-level "browser". Em algumas versões do
// Chrome/chromedriver headless essa chamada pode não responder; protegida
// com timeout para nunca travar a suíte inteira.
async function collectConsoleErrors(driver) {
  try {
    const entries = await Promise.race([
      driver.manage().logs().get('browser'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('logs().get timeout')), 5000)),
    ]);
    return entries.filter((entry) => entry.level.name === 'SEVERE');
  } catch {
    return null; // indica que a coleta não é suportada/disponível neste ambiente
  }
}

module.exports = {
  ADMIN_EMAIL, ADMIN_PASSWORD,
  startServer, stopServer,
  buildDriver, stopDriver,
  login, collectConsoleErrors,
};
