// Guarda de regressão para a classe de bug que afetou a produção em
// 2026-09-17 (Service Worker obsoleto quebrando o carregamento do painel
// financeiro): navega por todas as seções principais e falha o teste se
// QUALQUER erro aparecer no console do navegador.
const test = require('node:test');
const assert = require('node:assert/strict');
const { By, until } = require('selenium-webdriver');
const { startServer, stopServer, buildDriver, stopDriver, login, collectConsoleErrors } = require('./helpers');

const SECTIONS = [
  'dashboard', 'lancamentos', 'centros', 'categorias', 'fornecedores',
  'config', 'sincronizacao', 'historico', 'chamados', 'orcamentos',
  'recorrentes', 'bugreports', 'usuarios',
];

test('E2E painel financeiro: carrega os KPIs sem erro de console', async () => {
  const ctx = await startServer();
  const driver = await buildDriver();
  try {
    await login(driver, ctx.baseUrl);
    await driver.wait(until.elementLocated(By.id('kpi-receitas')), 10000);
    // loadDashboard() é assíncrono; aguarda o texto do KPI deixar de ser vazio.
    await driver.wait(async () => (await driver.findElement(By.id('kpi-receitas')).getText()).trim().length > 0, 10000);

    const receitas = await driver.findElement(By.id('kpi-receitas')).getText();
    const saldo = await driver.findElement(By.id('kpi-saldo')).getText();
    assert.match(receitas, /R\$/, 'KPI de receitas deve mostrar um valor monetário');
    assert.match(saldo, /R\$/, 'KPI de saldo deve mostrar um valor monetário');

    const errors = await collectConsoleErrors(driver);
    if (errors !== null) {
      assert.deepEqual(errors.map((e) => e.message), [], 'não deve haver erros de console ao carregar o painel');
    }
  } finally {
    await stopDriver(driver);
    await stopServer(ctx);
  }
});

test('E2E navegação: todas as seções principais abrem sem erro de console', async () => {
  const ctx = await startServer();
  const driver = await buildDriver();
  try {
    await login(driver, ctx.baseUrl);
    await driver.wait(until.elementLocated(By.id('kpi-receitas')), 10000);

    for (const section of SECTIONS) {
      const nav = await driver.findElement(By.css(`.nav-item[data-view="${section}"]`));
      await nav.click();
      await driver.wait(until.elementIsVisible(driver.findElement(By.id(`view-${section}`))), 10000);
      // Pequena pausa para as chamadas assíncronas de carregamento da view concluírem.
      await driver.sleep(300);
    }

    const errors = await collectConsoleErrors(driver);
    if (errors !== null) {
      assert.deepEqual(
        errors.map((e) => e.message),
        [],
        `não deve haver erros de console ao navegar por: ${SECTIONS.join(', ')}`
      );
    }
  } finally {
    await stopDriver(driver);
    await stopServer(ctx);
  }
});
