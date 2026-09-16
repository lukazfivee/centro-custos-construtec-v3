const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseCsv } = require('../lib/csv');

test('projeções financeiras e integridade do rateio em HTTP/PGlite', async context => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-financial-test-'));
  process.env.DATABASE_URL = '';
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'financial-projection-test-secret-at-least-32-chars';
  process.env.ADMIN_INITIAL_PASSWORD = 'financial-test-123';
  process.env.ADMIN_INITIAL_EMAIL = 'finance@teste.local';
  const { initializeDatabase, closeDatabase, getDb } = require('../db');
  const { createApp } = require('../server');
  let server;
  context.after(async () => {
    if(server) await new Promise(resolve => server.close(resolve));
    await closeDatabase();
    assert.equal(path.dirname(path.resolve(tempRoot)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(tempRoot).startsWith('cc-financial-test-'));
    fs.rmSync(tempRoot, { recursive:true, force:true });
  });
  await initializeDatabase();
  server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const db = getDb();
  let auth;
  async function request(route, method='GET', body, status=200) {
    const response = await fetch(base+route, { method,
      headers:{ Authorization:`Bearer ${auth || ''}`, 'Content-Type':'application/json' },
      body:body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    assert.equal(response.status,status,text);
    return response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text;
  }
  auth = (await request('/auth/login','POST',{email:'finance@teste.local',senha:'financial-test-123'})).token;
  const category = (await request('/categorias')).find(x=>x.nome==='Material').id;
  let sequence=0;
  async function center(budget=0) {
    sequence++;
    return (await request('/centros-custo','POST',{codigo:`TEST-${sequence}`,nome:`Obra ${sequence}`,orcamento:budget},201)).id;
  }
  async function entry(centerId, amount=100, date='2026-09-06', status='liquidado') {
    const body={tipo:'despesa',cost_center_id:centerId,category_id:category,descricao:`Despesa ${++sequence}`,
      valor:amount,data:date,status_financeiro:status};
    const row=await request('/lancamentos','POST',body,201);
    return {...row,body};
  }
  const split=(id,rateios,status=200)=>request(`/produtividade/rateio/${id}`,'PUT',{rateios},status);
  const detail=id=>request(`/centros-custo/${id}/detalhes`);
  const dashboard=(id,month='2026-09')=>request(`/dashboard/resumo?mes=${month}${id ? `&centroId=${id}` : ''}`);
  const batch=(ids,acao,extra={},status=200)=>request('/produtividade/acoes-em-massa','POST',{ids,acao,...extra},status);

  await context.test('R$ 100 em 60/40 fecha em resumo, lista, detalhe, categoria e CSV sem duplicar', async () => {
    const original=await center(), a=await center(), b=await center();
    const item=await entry(original);
    await split(item.id,[{cost_center_id:a,valor:60},{cost_center_id:b,valor:40}]);
    const all=await dashboard();
    assert.equal(all.despesas,100);
    assert.equal(all.qtdLancamentos,1);
    assert.equal(all.porCentro.reduce((s,r)=>s+Number(r.despesas),0),100);
    assert.equal(all.porCategoria.reduce((s,r)=>s+Number(r.total),0),100);
    const list=await request('/centros-custo');
    for(const [id,amount] of [[original,0],[a,60],[b,40]]) {
      const result=await detail(id), panel=await dashboard(id);
      assert.equal(Number(result.centro.total_comprometido),amount);
      assert.equal(Number(list.find(x=>x.id===id).total_despesas),amount);
      assert.equal(panel.despesas,amount);
      assert.equal(panel.comprometido,amount);
      assert.equal(Number(result.centro.total_lancamentos),amount?1:0);
      if(amount) {
        assert.equal(Number(result.lancamentos[0].valor),amount);
        assert.equal(Number(result.lancamentos[0].valor_original),100);
        assert.equal(Number(panel.ultimosLancamentos[0].valor),amount);
        assert.equal(Number(panel.tendencia.at(-1).despesas),amount);
      }
    }
    const csv=parseCsv(await request('/centros-custo/exportar.csv'));
    assert.equal(csv.find(r=>r[1]===list.find(x=>x.id===a).nome)[10],'60,00');
  });

  await context.test('excluídos, rascunhos, pendentes de aprovação e rejeitados não compõem totais', async () => {
    const a=await center(), b=await center();
    const deleted=await entry(a,100);
    await split(deleted.id,[{cost_center_id:a,valor:60},{cost_center_id:b,valor:40}]);
    await request(`/lancamentos/${deleted.id}`,'DELETE');
    for(const approval of ['rascunho','pendente','rejeitado']) {
      const row=await entry(a,500);
      await db.query('UPDATE transactions SET approval_status=$1 WHERE id=$2',[approval,row.id]);
      await split(row.id,[{cost_center_id:b,valor:500}]);
      await batch([row.id],'liquidar',{},409);
      await request(`/lancamentos/${row.id}/estornar`,'POST',{motivo:'Teste de aprovação'},409);
    }
    for(const id of [a,b]) {
      assert.equal(Number((await detail(id)).centro.total_comprometido),0);
      assert.equal((await detail(id)).lancamentos.length,0);
      assert.equal((await dashboard(id)).despesas,0);
    }
  });

  await context.test('alerta e tendência usam competência mensal e contam a pendência uma vez', async () => {
    const a=await center(60);
    await entry(a,1000,'2026-12-31');
    await entry(a,20,'2027-01-01');
    await entry(a,30,'2027-01-31','pendente');
    await entry(a,1000,'2027-02-01');
    let attention=await request('/insights/atencao?mes=2027-01');
    assert.equal(attention.mes,'2027-01');
    assert.equal(attention.itens.some(x=>x.tipo==='orcamento'),false);
    const trend=(await request('/insights/tendencia-obras?mes=2027-01')).find(x=>x.id===a);
    assert.equal(trend.realizado,20);
    assert.equal(trend.comprometido_pendente,30);
    assert.equal(trend.tendencia,50);
    assert.equal(trend.saldo_orcamento,10);
    assert.equal((await dashboard(a,'2027-01')).comprometido,50);
    const detailMonth=(await request(`/centros-custo/${a}/detalhes?mes=2027-01`)).centro;
    const listMonth=(await request('/centros-custo?mes=2027-01')).find(x=>x.id===a);
    assert.equal(Number(detailMonth.total_comprometido_mes),50);
    assert.equal(Number(listMonth.total_comprometido_mes),50);
    assert.equal(Number(detailMonth.total_comprometido),2050);
    assert.equal(listMonth.mes_orcamento,'2027-01');
    await entry(a,11,'2027-01-15','pendente');
    attention=await request('/insights/atencao?mes=2027-01');
    assert.equal(attention.itens.filter(x=>x.tipo==='orcamento').length,1);
    await request('/insights/atencao?mes=2027-13','GET',undefined,400);
    await request('/insights/tendencia-obras?mes=erro','GET',undefined,400);
  });

  await context.test('estorno copia 60/40 e neutraliza as mesmas obras; legado herda o rateio', async () => {
    const a=await center(), b=await center();
    const row=await entry(a,100,'2026-10-06');
    await split(row.id,[{cost_center_id:a,valor:60},{cost_center_id:b,valor:40}]);
    const reversed=await request(`/lancamentos/${row.id}/estornar`,'POST',{motivo:'Correção fictícia',data_estorno:'2026-10-07'},201);
    assert.equal((await request(`/produtividade/rateio/${reversed.estorno.id}`)).length,2);
    for(const id of [a,b]) assert.equal((await dashboard(id,'2026-10')).despesas,0);
    await split(row.id,[],409);
    await split(reversed.estorno.id,[],409);
    // Represents old reversals, created before the atomic allocation copy existed.
    await db.query('DELETE FROM transaction_allocations WHERE transaction_id=$1',[reversed.estorno.id]);
    for(const id of [a,b]) assert.equal((await dashboard(id,'2026-10')).despesas,0);
  });

  await context.test('rateio exige centavos exatos, obras únicas e preserva dados após falha', async () => {
    const a=await center(), b=await center();
    const row=await entry(a);
    const rateios=[{cost_center_id:a,valor:60},{cost_center_id:b,valor:40}];
    await split(row.id,rateios);
    for(const invalid of [
      [{cost_center_id:a,valor:99.99}],
      [{cost_center_id:a,valor:100.01}],
      [{cost_center_id:a,valor:100.001}],
      [{cost_center_id:a,valor:60},{cost_center_id:a,valor:40}],
      [{cost_center_id:999999,valor:100}],
    ]) await split(row.id,invalid,400);
    assert.deepEqual((await request(`/produtividade/rateio/${row.id}`)).map(x=>Number(x.valor)),[60,40]);
    const revision=(await db.query('SELECT revision FROM transactions WHERE id=$1',[row.id])).rows[0].revision;
    await request(`/lancamentos/${row.id}`,'PUT',{...row.body,revisao:revision,valor:200},409);
    await batch([row.id],'centro',{cost_center_id:b},409);
    await split(row.id,[]);
    assert.equal(Number((await detail(a)).centro.total_despesas),100);
    assert.equal(Number((await detail(b)).centro.total_despesas),0);
    const audit=await db.query("SELECT COUNT(*)::int AS count FROM audit_log WHERE action='rateado' AND entity_id=$1",[String(row.id)]);
    assert.equal(audit.rows[0].count,2);
  });

  await context.test('fechamento bloqueia rateio, remoção e lote inteiro sem alteração parcial', async () => {
    const a=await center();
    const open=await entry(a,50,'2027-12-01','pendente');
    const closed=await entry(a,100,'2028-01-01','pendente');
    await split(closed.id,[{cost_center_id:a,valor:100}]);
    await request('/fechamento-mensal','POST',{ano:2028,mes:1},201);
    await split(closed.id,[],403);
    await split(closed.id,[{cost_center_id:a,valor:100}],403);
    await batch([open.id,closed.id],'liquidar',{},403);
    const persisted=(await db.query('SELECT financial_status,revision FROM transactions WHERE id=$1',[open.id])).rows[0];
    assert.equal(persisted.financial_status,'pendente');
    assert.equal(persisted.revision,1);
    assert.equal((await request(`/produtividade/rateio/${closed.id}`)).length,1);
  });
});
