// Mock do contrato docs/suite-mobile/04-CONTRATO-API.md, so para desenvolvimento local do app.
// Uso: node scripts/mock-central-auth.mjs [porta]  ->  abra http://localhost:8787/auth/index.html
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'auth');
const rules = require(path.join(ASSETS, 'rules.js'));

const MIN = 60 * 1000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

export const DEMO_USERS = [
  { id: 'u-demo', name: 'Maria Clara Souza', email: 'teste@rcconstrutec.com.br', role: 'engenharia', password: 'Construtec@2026' },
  { id: 'u-legado', name: 'Conta Antiga', email: 'legado@rcconstrutec.com.br', role: 'engenharia', password: 'Construtec@2026', legacy: true },
];

const sha = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');

export function createMockCentral(options = {}) {
  const now = options.now || (() => Date.now());
  const users = new Map(DEMO_USERS.map((user) => [user.email, { ...user }]));
  const sessions = new Map();
  const resets = new Map();
  const handoffs = new Map();
  const hits = { email: new Map(), ip: new Map(), lastSent: new Map() };
  const outbox = [];

  function hit(map, key, windowMs) {
    const list = (map.get(key) || []).filter((at) => now() - at < windowMs);
    list.push(now());
    map.set(key, list);
    return list.length;
  }

  function newSession(user, req) {
    const token = randomToken();
    const at = now();
    const expiresAt = Math.floor((at + 30 * 24 * 60 * MIN) / 1000);
    sessions.set(sha(token), { userId: user.id, instanceName: String(req.headers['x-instance-name'] || 'Desconhecido'), createdAt: at, lastSeenAt: at, expiresAt });
    return { token, expiresAt };
  }

  function publicUser(user) {
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  }

  function userById(id) {
    for (const user of users.values()) if (user.id === id) return user;
    return null;
  }

  function bearer(req) {
    const match = /^Bearer\s+(.+)$/.exec(String(req.headers.authorization || ''));
    if (!match) return { error: [401, 'SESSION_INVALID'] };
    const hash = sha(match[1]);
    const session = sessions.get(hash);
    if (!session) return { error: [401, 'SESSION_INVALID'] };
    if (session.expiresAt * 1000 <= now()) { sessions.delete(hash); return { error: [401, 'SESSION_EXPIRED'] }; }
    session.lastSeenAt = now();
    return { hash, session, user: userById(session.userId) };
  }

  const routes = {
    'POST /v1/auth/login': (req, body) => {
      const user = users.get(String(body.email || '').trim().toLowerCase());
      if (!user || user.password !== body.password) return [401, { ok: false, error: 'E-mail ou senha inválidos.', code: 'INVALID_CREDENTIALS' }];
      if (user.legacy) return [409, { ok: false, error: 'Conta legada.', code: 'PASSWORD_PROFILE_LEGACY' }];
      const { token, expiresAt } = newSession(user, req);
      return [200, { ok: true, sessionToken: token, expiresAt, user: publicUser(user) }];
    },
    'GET /v1/auth/session': (req) => {
      const auth = bearer(req);
      if (auth.error) return auth.error;
      return [200, { ok: true, user: publicUser(auth.user), expiresAt: auth.session.expiresAt }];
    },
    'POST /v1/auth/password-reset/request': (req, body) => {
      const email = String(body.email || '').trim().toLowerCase();
      const byEmail = hit(hits.email, email, 15 * MIN);
      const byIp = hit(hits.ip, req.socket.remoteAddress, 15 * MIN);
      const last = hits.lastSent.get(email) || 0;
      const user = users.get(email);
      if (!user || byEmail > 3 || byIp > 10 || now() - last < MIN) return [202, { ok: true }];
      for (const [hash, item] of resets) if (item.userId === user.id) resets.delete(hash);
      const token = randomToken();
      resets.set(sha(token), { userId: user.id, expiresAt: now() + 30 * MIN, used: false });
      hits.lastSent.set(email, now());
      outbox.push({ to: email, subject: 'Redefinir sua senha · Construtec', token });
      if (options.onMail) options.onMail({ to: email, token });
      return [202, { ok: true }];
    },
    'POST /v1/auth/password-reset/confirm': (req, body) => {
      const item = resets.get(sha(body.token || ''));
      if (!item || item.used) return [400, { ok: false, error: 'Link inválido.', code: 'TOKEN_INVALID' }];
      if (item.expiresAt <= now()) return [400, { ok: false, error: 'Link expirado.', code: 'TOKEN_EXPIRED' }];
      if (!rules.passwordAcceptable(body.password)) return [400, { ok: false, error: 'Senha fraca.', code: 'WEAK_PASSWORD' }];
      const user = userById(item.userId);
      user.password = String(body.password);
      item.used = true;
      let revokedSessions = 0;
      for (const [hash, session] of sessions) if (session.userId === user.id) { sessions.delete(hash); revokedSessions += 1; }
      return [200, { ok: true, revokedSessions }];
    },
    'POST /v1/auth/sessions/revoke-others': (req) => {
      const auth = bearer(req);
      if (auth.error) return auth.error;
      let revoked = 0;
      for (const [hash, session] of sessions) {
        if (session.userId === auth.user.id && hash !== auth.hash) { sessions.delete(hash); revoked += 1; }
      }
      return [200, { ok: true, revoked }];
    },
    'GET /v1/auth/sessions': (req) => {
      const auth = bearer(req);
      if (auth.error) return auth.error;
      const list = [...sessions.entries()].filter(([, s]) => s.userId === auth.user.id).map(([hash, s]) => ({
        instanceName: s.instanceName, createdAt: Math.floor(s.createdAt / 1000), lastSeenAt: Math.floor(s.lastSeenAt / 1000), current: hash === auth.hash,
      }));
      return [200, { ok: true, sessions: list }];
    },
    'POST /v1/auth/handoff': (req, body) => {
      const auth = bearer(req);
      if (auth.error) return auth.error;
      if (body.target !== 'centro-custos') return [400, { ok: false, error: 'Destino inválido.', code: 'HANDOFF_INVALID' }];
      const code = randomToken();
      const expiresAt = Math.floor((now() + MIN) / 1000);
      handoffs.set(sha(code), { userId: auth.user.id, expiresAt, instanceName: auth.session.instanceName });
      return [200, { ok: true, code, expiresAt }];
    },
    'POST /v1/auth/handoff/consume': (req, body) => {
      const hash = sha(body.code || '');
      const item = handoffs.get(hash);
      handoffs.delete(hash);
      if (!item || item.expiresAt * 1000 <= now()) return [400, { ok: false, error: 'Código inválido.', code: 'HANDOFF_INVALID' }];
      const user = userById(item.userId);
      // Formato real do login web (STATUS-CODEX): { token, usuario: { id, nome, email, role }, instancia: { id, name } }.
      return [200, { ok: true, token: randomToken(), usuario: { id: user.id, nome: user.name, email: user.email, role: user.role }, instancia: { id: 'mock', name: item.instanceName } }];
    },
  };

  function send(res, status, payload, type = 'application/json; charset=utf-8') {
    const body = typeof payload === 'string' || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload);
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  }

  function serveStatic(res, pathname) {
    const rel = decodeURIComponent(pathname.slice('/auth/'.length)) || 'index.html';
    const file = path.resolve(ASSETS, rel);
    if (!file.startsWith(ASSETS + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Não encontrado', 'text/plain; charset=utf-8');
    return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
  }

  const webHome = '<!doctype html><meta charset="utf-8"><title>Centro de Custos (mock)</title><body style="font:16px sans-serif;padding:24px">'
    + '<h1>Centro de Custos (mock)</h1><p id="s">Sem handoff.</p><script>const m=/handoff=([^&]+)/.exec(location.hash);'
    + 'if(m){fetch("/v1/auth/handoff/consume",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code:m[1]})})'
    + '.then(r=>r.json()).then(j=>{history.replaceState(null,"",location.pathname);document.getElementById("s").textContent=j.ok?"Entrou como "+j.usuario.nome:"Handoff recusado: "+j.code;});}</script>';
  const resetPage = '<!doctype html><meta charset="utf-8"><script>location.replace("/auth/index.html#reset&"+location.hash.slice(1))</script>';

  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://mock.local');
    if (req.method === 'GET' && pathname.startsWith('/auth/')) return serveStatic(res, pathname);
    if (req.method === 'GET' && pathname === '/') return send(res, 200, webHome, 'text/html; charset=utf-8');
    if (req.method === 'GET' && pathname === '/redefinir-senha') return send(res, 200, resetPage, 'text/html; charset=utf-8');
    const route = routes[`${req.method} ${pathname}`];
    if (!route) return send(res, 404, { ok: false, error: 'Rota não encontrada.', code: 'NOT_FOUND' });
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 64 * 1024) req.destroy(); });
    req.on('end', () => {
      try {
        const body = raw ? JSON.parse(raw) : {};
        const [status, payload] = route(req, body);
        const out = typeof payload === 'string' ? { ok: false, error: 'Sessão inválida.', code: payload } : payload;
        send(res, status, out);
      } catch {
        send(res, 500, { ok: false, error: 'Erro interno.', code: 'SERVER_ERROR' });
      }
    });
  });
  server.mock = { outbox, users, sessions };
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2]) || 8787;
  // So no mock: mostra o link para testar sem provedor de e-mail. O servidor real nunca registra o token.
  const server = createMockCentral({ onMail: ({ to, token }) => console.log(`[mock] link para ${to}: http://localhost:${port}/redefinir-senha#t=${token}`) });
  server.listen(port, () => console.log(`[mock] contrato da Fase 1 em http://localhost:${port}  (telas: /auth/index.html, conta: ${DEMO_USERS[0].email} / ${DEMO_USERS[0].password})`));
}
