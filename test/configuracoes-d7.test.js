const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Desktop novo (D7): Configuracoes. Perfil com telefone, senha que encerra as outras sessoes (modo local),
// copias de seguranca guardadas (listar, baixar, fazer agora, restaurar com copia do estado atual) e sistema.
test('configuracoes: perfil, senha, copias de seguranca e sistema', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-custos-config-'));
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
  process.env.ADMIN_INITIAL_PASSWORD = 'senha-teste-123';
  process.env.ADMIN_INITIAL_EMAIL = 'admin@teste.local';
  delete process.env.DATABASE_URL;

  const { initializeDatabase, closeDatabase, getDb } = require('../db');
  const { createApp } = require('../server');
  await initializeDatabase();
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  context.after(async () => {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  async function chamar(token, url, method = 'GET', body) {
    const response = await fetch(`${base}${url}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const type = response.headers.get('content-type') || '';
    const data = type.includes('json') ? await response.json().catch(() => ({})) : Buffer.from(await response.arrayBuffer());
    return { status: response.status, data };
  }
  const login = async (email, senha) => (await chamar('', '/auth/login', 'POST', { email, senha })).data.token;
  const admin = await login('admin@teste.local', 'senha-teste-123');
  assert.ok(admin);

  // Perfil: nome e celular no modo local; e-mail nao muda.
  const perfil = await chamar(admin, '/perfil');
  assert.equal(perfil.status, 200);
  assert.equal(perfil.data.celular, '');
  assert.equal((await chamar(admin, '/perfil', 'PUT', { nome: 'A' })).status, 400);
  const curto = await chamar(admin, '/perfil', 'PUT', { nome: 'Marina Costa', celular: '123' });
  assert.equal(curto.status, 400);
  assert.match(curto.data.erro, /celular com DDD/);
  const salvo = await chamar(admin, '/perfil', 'PUT', { nome: 'Marina Costa', celular: '(11) 98765-4321' });
  assert.equal(salvo.status, 200);
  assert.equal(salvo.data.celular, '(11) 98765-4321');
  assert.equal(salvo.data.email, 'admin@teste.local');
  // Requisicao sem o campo celular (celular antigo) nao apaga o telefone.
  assert.equal((await chamar(admin, '/perfil', 'PUT', { nome: 'Marina C. Costa' })).data.celular, '(11) 98765-4321');
  const auditoria = (await getDb().query("SELECT COUNT(*)::int AS n FROM audit_log WHERE action='perfil_atualizado'")).rows[0].n;
  assert.ok(auditoria >= 2);

  // Senha: validacao, senha atual errada e sucesso que encerra as outras sessoes.
  const outraSessao = await login('admin@teste.local', 'senha-teste-123');
  assert.equal((await chamar(admin, '/auth/alterar-senha', 'POST', { senhaAtual: 'senha-teste-123', novaSenha: 'curta' })).status, 400);
  const errada = await chamar(admin, '/auth/alterar-senha', 'POST', { senhaAtual: 'errada-errada', novaSenha: 'nova-senha-456' });
  assert.equal(errada.status, 401);
  assert.equal(errada.data.erro, 'Senha atual incorreta.');
  const troca = await chamar(admin, '/auth/alterar-senha', 'POST', { senhaAtual: 'senha-teste-123', novaSenha: 'nova-senha-456' });
  assert.equal(troca.status, 200);
  assert.ok(troca.data.token);
  assert.equal((await chamar(outraSessao, '/auth/me')).status, 401);
  assert.equal((await chamar(admin, '/auth/me')).status, 401);
  const atual = troca.data.token;
  assert.equal((await chamar(atual, '/auth/me')).status, 200);
  assert.ok(await login('admin@teste.local', 'nova-senha-456'));
  assert.equal((await chamar('', '/auth/login', 'POST', { email: 'admin@teste.local', senha: 'senha-teste-123' })).status, 401);

  // Copias: sem permissao (403), lista vazia, fazer agora, baixar, nome invalido e inexistente.
  const gestor = await chamar(atual, '/usuarios', 'POST', { nome: 'Gestor', email: 'gestor@teste.local', senha: 'senha-gestor-123', role: 'gestor' });
  assert.equal(gestor.status, 201);
  const tokenGestor = await login('gestor@teste.local', 'senha-gestor-123');
  for (const [url, metodo] of [['/backup/copias', 'GET'], ['/backup/copias', 'POST'], ['/sistema/status', 'GET']]) {
    assert.equal((await chamar(tokenGestor, url, metodo)).status, 403, url);
  }
  const vazia = await chamar(atual, '/backup/copias');
  assert.equal(vazia.status, 200);
  assert.deepEqual(vazia.data.copias, []);
  const feita = await chamar(atual, '/backup/copias', 'POST', {});
  assert.equal(feita.status, 201);
  assert.match(feita.data.copia.nome, /^manual-.*\.tar\.gz$/);
  const lista = (await chamar(atual, '/backup/copias')).data;
  assert.equal(lista.resumo.total, 1);
  assert.equal(lista.copias[0].tipo, 'manual');
  assert.equal(lista.copias[0].sha256, feita.data.copia.sha256);
  const baixada = await chamar(atual, `/backup/copias/${feita.data.copia.nome}`);
  assert.equal(baixada.status, 200);
  assert.equal(baixada.data[0], 0x1f);
  assert.equal((await chamar(atual, '/backup/copias/arquivo.txt')).status, 400);
  assert.equal((await chamar(atual, '/backup/copias/nao-existe.tar.gz')).status, 404);

  // Restaurar: pede RESTAURAR, guarda antes uma copia do estado atual, agenda e recusa um segundo agendamento.
  assert.equal((await chamar(tokenGestor, '/backup/restaurar', 'POST', { confirmacao: 'RESTAURAR', copia: feita.data.copia.nome })).status, 403);
  const semConfirmar = await chamar(atual, '/backup/restaurar', 'POST', { copia: feita.data.copia.nome });
  assert.equal(semConfirmar.status, 400);
  assert.match(semConfirmar.data.erro, /RESTAURAR/);
  assert.equal((await chamar(atual, '/backup/restaurar', 'POST', { confirmacao: 'RESTAURAR', copia: '../x.tar.gz' })).status, 400);
  const agendada = await chamar(atual, '/backup/restaurar', 'POST', { confirmacao: 'RESTAURAR', copia: feita.data.copia.nome });
  assert.equal(agendada.status, 200, JSON.stringify(agendada.data));
  assert.equal(agendada.data.reinicioNecessario, true);
  assert.match(agendada.data.copiaAntes, /^antes-restaurar-.*\.tar\.gz$/);
  const depois = (await chamar(atual, '/backup/copias')).data;
  assert.ok(depois.copias.some((c) => c.tipo === 'antes_restaurar' && c.nome === agendada.data.copiaAntes));
  const duplicada = await chamar(atual, '/backup/restaurar', 'POST', { confirmacao: 'RESTAURAR', copia: feita.data.copia.nome });
  assert.equal(duplicada.status, 409);
  assert.equal((await chamar(atual, '/backup/status')).data.pendingRestore.filename, feita.data.copia.nome);
  const acoes = (await getDb().query("SELECT action FROM audit_log WHERE entity_type='backup' ORDER BY id")).rows.map((r) => r.action);
  assert.deepEqual(acoes.filter((a) => ['criado', 'baixado', 'agendado'].includes(a)), ['criado', 'baixado', 'agendado']);

  // Sistema: versao vem do package.json; fuso e moeda; backup automatico lido da configuracao.
  const sistema = (await chamar(atual, '/sistema/status')).data;
  assert.equal(sistema.application.version, require('../package.json').version);
  assert.deepEqual(sistema.regional, { timezone: 'America/Sao_Paulo', currency: 'BRL' });
  assert.equal(sistema.backup.automaticConfigured, false);
  assert.equal(typeof sistema.database.records.activeUsers, 'number');

  // A lista antiga de backups automaticos deixou de quebrar.
  assert.equal((await chamar(atual, '/backup-automatico')).status, 200);
});
