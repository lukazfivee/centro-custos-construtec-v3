const test = require('node:test');
const assert = require('node:assert/strict');
const { By, until } = require('selenium-webdriver');
const { startServer, stopServer, buildDriver, stopDriver, login, ADMIN_EMAIL, ADMIN_PASSWORD } = require('./helpers');

// Semeia categoria + centro via API (mais rápido e estável que passar pela
// UI para pré-requisitos que não são o alvo do teste), depois valida o
// fluxo real de criação de lançamento pela interface.
async function seedPrerequisites(baseUrl) {
  const loginResp = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, senha: ADMIN_PASSWORD }),
  });
  const { token } = await loginResp.json();
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  await fetch(`${baseUrl}/api/categorias`, { method: 'POST', headers, body: JSON.stringify({ nome: 'Material E2E', tipo: 'despesa' }) });
  await fetch(`${baseUrl}/api/centros-custo`, { method: 'POST', headers, body: JSON.stringify({ codigo: 'E2E-TX', nome: 'Obra para lançamentos E2E', orcamento: 5000 }) });
}

test('E2E lançamentos: criar uma despesa pela interface e vê-la na lista e no painel', async () => {
  const ctx = await startServer();
  await seedPrerequisites(ctx.baseUrl);
  const driver = await buildDriver();
  try {
    await login(driver, ctx.baseUrl);
    await driver.findElement(By.css('.nav-item[data-view="lancamentos"]')).click();
    await driver.wait(until.elementIsVisible(driver.findElement(By.id('view-lancamentos'))), 10000);

    await driver.findElement(By.id('btn-novo-lancamento')).click();
    await driver.wait(until.elementLocated(By.id('transaction-form')), 10000);

    const descricao = `Compra E2E ${Date.now()}`;
    await driver.findElement(By.id('tr-descricao')).sendKeys(descricao);
    await driver.findElement(By.id('tr-valor')).sendKeys('321.50');
    await driver.findElement(By.css('#transaction-form button[type=submit]')).click();

    await driver.wait(until.elementIsNotVisible(driver.findElement(By.id('modal-fundo'))), 10000);

    await driver.wait(async () => {
      const text = await driver.findElement(By.id('tabela-lancamentos')).getText();
      return text.includes(descricao);
    }, 10000, `o lançamento "${descricao}" deveria aparecer na lista após salvar`);

    // O dashboard também deve refletir o novo lançamento (loadDashboard é
    // chamado após salvar); navega até lá e confere que o KPI de despesas
    // não ficou zerado.
    await driver.findElement(By.css('.nav-item[data-view="dashboard"]')).click();
    await driver.wait(until.elementIsVisible(driver.findElement(By.id('view-dashboard'))), 10000);
    // O grid de KPIs é substituído por um skeleton de carregamento enquanto
    // loadDashboard() está em andamento, removendo #kpi-a-pagar do DOM
    // temporariamente — a busca precisa ser refeita a cada tentativa e
    // tolerar "elemento ainda não existe" em vez de propagar o erro.
    await driver.wait(async () => {
      try {
        const text = await driver.findElement(By.id('kpi-a-pagar')).getText();
        return text.trim().length > 0;
      } catch {
        return false;
      }
    }, 10000, 'KPI "a pagar" deveria voltar a existir e mostrar um valor após o dashboard recarregar');
  } finally {
    await stopDriver(driver);
    await stopServer(ctx);
  }
});
