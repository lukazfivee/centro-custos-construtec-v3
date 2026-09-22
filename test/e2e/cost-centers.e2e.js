const test = require('node:test');
const assert = require('node:assert/strict');
const { By, until } = require('selenium-webdriver');
const { startServer, stopServer, buildDriver, stopDriver, login } = require('./helpers');

test('E2E obras/centros: criar uma obra pela interface e vê-la na listagem', async () => {
  const ctx = await startServer();
  const driver = await buildDriver();
  try {
    await login(driver, ctx.baseUrl);
    await driver.findElement(By.css('.nav-item[data-view="centros"]')).click();
    await driver.wait(until.elementIsVisible(driver.findElement(By.id('view-centros'))), 10000);

    await driver.findElement(By.id('btn-novo-centro')).click();
    await driver.wait(until.elementLocated(By.id('center-form')), 10000);

    const codigo = `E2E-${Date.now()}`;
    await driver.findElement(By.id('cc-codigo')).sendKeys(codigo);
    await driver.findElement(By.id('cc-nome')).sendKeys('Obra de teste E2E');
    await driver.findElement(By.css('#center-form button[type=submit]')).click();

    // O modal fecha ao salvar com sucesso.
    await driver.wait(until.elementIsNotVisible(driver.findElement(By.id('modal-fundo'))), 10000);

    await driver.wait(async () => {
      const text = await driver.findElement(By.id('lista-centros-cards')).getText();
      return text.includes(codigo);
    }, 10000, `a obra ${codigo} deveria aparecer na listagem após salvar`);
  } finally {
    await stopDriver(driver);
    await stopServer(ctx);
  }
});
