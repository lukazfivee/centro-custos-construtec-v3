const test = require('node:test');
const assert = require('node:assert/strict');
const { By, until } = require('selenium-webdriver');
const {
  ADMIN_EMAIL, ADMIN_PASSWORD, startServer, stopServer, buildDriver, stopDriver, login,
} = require('./helpers');

test('E2E login: credenciais corretas entram no app; credenciais erradas mostram erro', async () => {
  const ctx = await startServer();
  const driver = await buildDriver();
  try {
    await login(driver, ctx.baseUrl);
    const appShell = await driver.findElement(By.id('app'));
    assert.ok(!(await appShell.getAttribute('class')).includes('oculto'), 'o app deve estar visível após login');
    const loginScreen = await driver.findElement(By.id('tela-login'));
    assert.ok((await loginScreen.getAttribute('class')).includes('oculto') || !(await loginScreen.isDisplayed()));

    // Logout (via menu do perfil) e tentativa de login com senha errada.
    await driver.navigate().refresh();
    await driver.wait(until.elementLocated(By.css('#form-login input[type=email]')), 10000);
  } finally {
    await stopDriver(driver);
    await stopServer(ctx);
  }
});

test('E2E login: senha incorreta exibe mensagem de erro e não entra no app', async () => {
  const ctx = await startServer();
  const driver = await buildDriver();
  try {
    await driver.get(ctx.baseUrl);
    await driver.wait(until.elementLocated(By.css('#form-login input[type=email]')), 10000);
    await driver.findElement(By.css('#form-login input[type=email]')).sendKeys(ADMIN_EMAIL);
    await driver.findElement(By.css('#form-login input[type=password]')).sendKeys(`${ADMIN_PASSWORD}-errada`);
    await driver.findElement(By.css('#form-login button[type=submit]')).click();
    await driver.wait(async () => {
      const text = await driver.findElement(By.id('login-erro')).getText();
      return text.trim().length > 0;
    }, 10000, 'mensagem de erro de login deveria aparecer');
    const message = await driver.findElement(By.id('login-erro')).getText();
    assert.match(message, /inválid|incorret/i);
    const appShell = await driver.findElement(By.id('app'));
    assert.ok((await appShell.getAttribute('class')).includes('oculto'), 'o app não deve abrir com credenciais erradas');
  } finally {
    await stopDriver(driver);
    await stopServer(ctx);
  }
});
