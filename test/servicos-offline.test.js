const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Checklist, fotos e aceite do servico sem internet no celular: roda o queue.js e o screen-servico-fila.js reais
// com um IndexedDB e uma API de mentira.
const ler = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

function fakeIndexedDB() {
  const stores = {};
  return {
    open() {
      const req = {};
      setTimeout(() => {
        const db = {
          objectStoreNames: { contains: (n) => n in stores },
          createObjectStore: (n, o) => { stores[n] = { kp: o.keyPath, rows: new Map() }; },
          transaction: (n) => {
            const st = stores[n], t = {};
            t.objectStore = () => ({
              put: (v) => { st.rows.set(v[st.kp], structuredClone(v)); return { result: undefined }; },
              get: (k) => ({ result: structuredClone(st.rows.get(k)) }),
              getAll: () => ({ result: [...st.rows.values()].sort((a, b) => String(a[st.kp]).localeCompare(String(b[st.kp]))).map((v) => structuredClone(v)) }),
              delete: (k) => { st.rows.delete(k); return { result: undefined }; },
            });
            setTimeout(() => t.oncomplete && t.oncomplete(), 0);
            return t;
          },
        };
        req.result = db;
        if (!stores.fila) req.onupgradeneeded && req.onupgradeneeded();
        req.onsuccess && req.onsuccess();
      }, 0);
      return req;
    },
  };
}

function ambiente() {
  const calls = [], falhas = [];
  let uuid = 0;
  const CC = {
    esc: (v) => String(v), icon: () => '', owner: () => 'u1', toast: () => {}, $: () => null,
    uuid: () => `id-${(uuid += 1)}`, session: { token: () => 'tok' }, sv: {},
    offline: () => CC.estado.offline, estado: { offline: false },
    api: async (rota, opts = {}) => {
      if (CC.estado.offline) throw Object.assign(new Error('Sem internet'), { status: 0 });
      calls.push({ rota, metodo: opts.method || 'GET', body: opts.body });
      const falha = falhas.shift();
      if (falha) throw Object.assign(new Error(falha.message), { status: falha.status });
      return { data: {} };
    },
  };
  const sandbox = { window: { CC, addEventListener() {} }, document: { getElementById: () => null, body: { classList: { toggle() {} } } },
    indexedDB: fakeIndexedDB(), setInterval() {}, setTimeout, structuredClone, Date, Math, String, Number, Promise, Map };
  vm.createContext(sandbox);
  vm.runInContext(ler('public/m/queue.js'), sandbox);
  vm.runInContext(ler('public/m/screen-servico-fila.js'), sandbox);
  return { CC, calls, falhas };
}

const S = { id: 7, nome: 'Troca de fiacao', checklist: [{ id: 'a1', texto: 'Fixar', feito: false }], fotos: [], aceite: null };
const toggle = (item, feito) => ({ client_id: `chk-7-${item}`, op: 'checklist', rotulo: 'Checklist', body: { item, feito } });

test('sem internet o item vai para a fila, fora da lista de lancamentos; com internet e nada pendente envia direto', async () => {
  const { CC, calls } = ambiente();
  let direto = 0;
  assert.equal(await CC.sv.enviar(S, toggle('a1', true), async () => { direto += 1; }), 'enviado');
  assert.equal(direto, 1);

  CC.estado.offline = true;
  assert.equal(await CC.sv.enviar(S, toggle('a1', true), async () => { direto += 1; }), 'fila');
  assert.equal(direto, 1, 'sem internet nao chama a API');
  assert.equal((await CC.queue.ops()).length, 1);
  assert.equal((await CC.queue.mine()).length, 0, 'operacao de campo nao aparece como lancamento');
  assert.equal(CC.queue.state.pending, 1);
  assert.equal(calls.length, 0);
});

test('com pendencia na frente o envio direto espera na fila (ordem das alteracoes)', async () => {
  const { CC, calls } = ambiente();
  CC.estado.offline = true;
  await CC.sv.enviar(S, toggle('a1', true), async () => {});
  CC.estado.offline = false;
  let direto = 0;
  // Ainda ha pendencia deste servico: nao pode ultrapassar a fila.
  CC.queue.run = async () => {}; // segura o envio automatico so neste teste
  assert.equal(await CC.sv.enviar(S, toggle('a2', true), async () => { direto += 1; }), 'fila');
  assert.equal(direto, 0);
  assert.equal(calls.length, 0);
});

test('ao voltar a internet sobe em ordem; marcar e desmarcar vira um envio so; aceite leva a hora de quando assinou', async () => {
  const { CC, calls } = ambiente();
  CC.estado.offline = true;
  await CC.sv.enviar(S, { client_id: 'add-n1', op: 'checklist-add', rotulo: 'Novo', body: { id: 'n1', texto: 'Testar' } }, async () => {});
  await CC.sv.enviar(S, toggle('n1', true), async () => {});
  await CC.sv.enviar(S, toggle('a1', true), async () => {});
  await CC.sv.enviar(S, toggle('a1', false), async () => {}); // ultimo valor vale
  await CC.sv.enviar(S, { client_id: 'f1', op: 'foto', rotulo: 'Foto', body: { fase: 'antes', nome: 'a.jpg', tipo: 'image/jpeg', conteudoBase64: 'AAAA' } }, async () => {});
  const hora = '2026-10-08T14:00:00.000Z';
  await CC.sv.enviar(S, { client_id: 'aceite-7', op: 'aceite', rotulo: 'Aceite', body: { nome: 'Joao', cargo: '', dataHora: hora, assinatura: { conteudoBase64: 'data:image/png;base64,BBBB' } } }, async () => {});
  assert.equal((await CC.queue.ops()).length, 5, 'a1 ocupa uma vaga so');

  CC.estado.offline = false;
  await CC.queue.run();
  assert.deepEqual(calls.map((c) => `${c.metodo} ${c.rota}`), [
    'POST /servicos/7/checklist', 'PATCH /servicos/7/checklist/n1', 'PATCH /servicos/7/checklist/a1', 'POST /servicos/7/fotos', 'PUT /servicos/7/aceite']);
  assert.equal(calls[2].body.feito, false);
  assert.equal(calls[4].body.dataHora, hora);
  assert.equal((await CC.queue.ops()).length, 0, 'fila vazia depois de enviar');
  assert.equal(CC.queue.state.pending, 0);
});

test('sem rede no meio do envio a fila para e guarda o resto; erro de dados marca o item e segue', async () => {
  const { CC, calls } = ambiente();
  CC.estado.offline = true;
  await CC.sv.enviar(S, toggle('a1', true), async () => {});
  await CC.sv.enviar(S, { client_id: 'f1', op: 'foto', rotulo: 'Foto', body: { fase: 'antes', nome: 'a.jpg', conteudoBase64: 'AAAA' } }, async () => {});
  await CC.sv.enviar(S, toggle('a2', true), async () => {});
  CC.estado.offline = false;
  // a1 ok, foto recusada (400), a2 ok
  const fila = [null, { status: 400, message: 'Foto invalida' }, null];
  let n = 0;
  const api = CC.api;
  CC.api = async (...args) => { const f = fila[n]; n += 1; if (f) throw Object.assign(new Error(f.message), { status: f.status }); return api(...args); };
  await CC.queue.run();
  const restante = await CC.queue.ops();
  assert.equal(restante.length, 1);
  assert.equal(restante[0].client_id, 'f1');
  assert.equal(restante[0].estado, 'erro');
  assert.equal(restante[0].erro, 'Foto invalida');
  assert.equal(CC.queue.state.errors, 1);
  assert.match(await CC.sv.opRows(), /Não aceito: Foto invalida/);
  assert.match(await CC.sv.opRows(), /data-retry="f1"/);

  // Tentar de novo: agora aceita.
  CC.api = api;
  await CC.queue.retry('f1');
  assert.equal((await CC.queue.ops()).length, 0);
  assert.ok(calls.some((c) => c.rota === '/servicos/7/fotos'));
});

test('rede cai no meio: o item fica na fila sem virar erro', async () => {
  const { CC } = ambiente();
  CC.estado.offline = true;
  await CC.sv.enviar(S, toggle('a1', true), async () => {});
  CC.estado.offline = false;
  const api = CC.api;
  CC.api = async () => { throw Object.assign(new Error('Sem internet'), { status: 0 }); };
  await CC.queue.run();
  const [item] = await CC.queue.ops();
  assert.equal(item.estado, 'fila');
  CC.api = api;
});

test('repetir o envio e inofensivo: item removido por outra pessoa e foto repetida contam como enviados; outros 409 nao', async () => {
  const { CC, falhas } = ambiente();
  const rodar = async (item, falha) => {
    CC.estado.offline = true;
    await CC.sv.enviar(S, item, async () => {});
    CC.estado.offline = false;
    falhas.push(falha);
    await CC.queue.run();
    return CC.queue.ops();
  };
  assert.equal((await rodar(toggle('sumiu', true), { status: 404, message: 'Item do checklist não encontrado.' })).length, 0);
  const foto = { client_id: 'f1', op: 'foto', rotulo: 'Foto', body: { fase: 'antes', nome: 'a.jpg', conteudoBase64: 'AAAA' } };
  assert.equal((await rodar(foto, { status: 409, message: 'Esta mesma foto já foi enviada.' })).length, 0);
  const cheio = await rodar({ ...foto, client_id: 'f2' }, { status: 409, message: 'O serviço já tem 40 fotos.' });
  assert.equal(cheio.length, 1);
  assert.equal(cheio[0].estado, 'erro');
});

test('outra conta no mesmo celular nao envia nem ve a fila alheia', async () => {
  const { CC, calls } = ambiente();
  CC.estado.offline = true;
  await CC.sv.enviar(S, toggle('a1', true), async () => {});
  CC.estado.offline = false;
  CC.owner = () => 'u2';
  assert.equal((await CC.queue.ops()).length, 0);
  await CC.queue.run();
  assert.equal(calls.length, 0);
});

test('a tela mostra o que ainda esta na fila: itens, checklist marcado, foto e aceite', async () => {
  const { CC } = ambiente();
  CC.estado.offline = true;
  await CC.sv.enviar(S, { client_id: 'add-n1', op: 'checklist-add', rotulo: 'Novo', body: { id: 'n1', texto: 'Testar' } }, async () => {});
  await CC.sv.enviar(S, toggle('a1', true), async () => {});
  await CC.sv.enviar(S, { client_id: 'f1', op: 'foto', rotulo: 'Foto', body: { fase: 'depois', nome: 'd.jpg', tipo: 'image/jpeg', conteudoBase64: 'AAAA' } }, async () => {});
  await CC.sv.enviar(S, { client_id: 'aceite-7', op: 'aceite', rotulo: 'Aceite', body: { nome: 'Joao', cargo: 'Sindico', dataHora: '2026-10-08T14:00:00.000Z', assinatura: { conteudoBase64: 'data:image/png;base64,BBBB' } } }, async () => {});
  const s = await CC.sv.overlay(JSON.parse(JSON.stringify(S)));
  assert.deepEqual(s.checklist.map((c) => [c.id, c.feito, !!c.pendente]), [['a1', true, true], ['n1', false, true]]);
  assert.equal(s.fotos[0].local, 'data:image/jpeg;base64,AAAA');
  assert.equal(s.fotos[0].pendente, true);
  assert.equal(s.aceite.nome, 'Joao');
  assert.equal(s.aceite.local, 'data:image/png;base64,BBBB');
  assert.equal(s.filaOps.length, 4);
  assert.match(CC.sv.avisoFila(s), /4 alterações sobem/);
  assert.equal(S.checklist[0].feito, false, 'o servico guardado nao e alterado');
});

test('telas: arquivo novo carregado no index e no cache offline, e o envio pela fila nas tres acoes', () => {
  const index = ler('public/m/index.html'), sw = ler('public/m/sw.js');
  assert.ok(index.indexOf('screen-servico.js') < index.indexOf('screen-servico-fila.js'), 'fila depois do servico (usa CC.sv)');
  assert.match(sw, /'screen-servico-fila\.js'/);
  assert.ok(Number((sw.match(/const CACHE = 'cc-celular-v(\d+)'/) || [])[1]) >= 14, 'cache trocado desde a fila do servico (v14)');
  const exec = ler('public/m/screen-servico-exec.js');
  for (const op of ["op: 'checklist-add'", "op: 'checklist'", "op: 'foto'", "op: 'aceite'"]) assert.ok(exec.includes(op), `${op} na tela de execucao`);
  assert.doesNotMatch(exec, /CC\.api\(`\/servicos\/\$\{s\.id\}\/checklist`, \{ method: 'PUT'/, 'incluir item nao reescreve a lista inteira');
  for (const rel of ['public/m/screen-servico-fila.js', 'public/m/screen-servico-exec.js']) {
    const txt = ler(rel);
    assert.ok(txt.split('\n').length <= 350, `${rel} passa de 350 linhas`);
    assert.doesNotMatch(txt, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, `${rel} tem emoji`);
  }
});
