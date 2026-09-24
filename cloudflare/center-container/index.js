import { Container } from '@cloudflare/containers';
import { env } from 'cloudflare:workers';
import { handleCentralAuth } from './centralAuth.js';
import { handleCommercialSync } from './commercialSync.js';
import { assetLinks, resetPage } from './resetPage.js';

// O Container passa cada valor de envVars pelo ambiente do processo, que so
// aceita string — um valor `undefined` (secret nunca configurado no Worker)
// vira a string literal "undefined" dentro do container, o que quebra
// qualquer `process.env.X || fallback` no server.js (X nunca fica "vazio",
// fica com o texto "undefined", que e verdadeiro). Omitir as chaves nao
// definidas deixa o fallback do lado do app funcionar como pretendido.
function definedEnv(vars) {
  return Object.fromEntries(Object.entries(vars).filter(([, value]) => value !== undefined));
}

export class CentroCustosApi extends Container {
  defaultPort = 8080;
  sleepAfter = '10m';
  enableInternet = true;
  envVars = definedEnv({
    DATABASE_URL: env.DATABASE_URL,
    DB_SSL: env.DB_SSL,
    DB_POOL_MAX: env.DB_POOL_MAX,
    SESSION_SECRET: env.SESSION_SECRET,
    JWT_SECRET: env.JWT_SECRET,
    ADMIN_INITIAL_NAME: env.ADMIN_INITIAL_NAME,
    ADMIN_INITIAL_EMAIL: env.ADMIN_INITIAL_EMAIL,
    ADMIN_INITIAL_PASSWORD: env.ADMIN_INITIAL_PASSWORD,
    INSTANCE_NAME: env.INSTANCE_NAME,
    REPORT_API_URL: env.REPORT_API_URL,
    REPORT_INGEST_KEY: env.REPORT_INGEST_KEY,
    SYNC_API_URL: env.SYNC_API_URL,
    SYNC_SHARED_KEY: env.SYNC_SHARED_KEY,
    CONSTRUTEC_INTEGRATION_KEY: env.CONSTRUTEC_INTEGRATION_KEY,
    MOBILE_APP_URL: env.MOBILE_APP_URL,
    NODE_ENV: env.NODE_ENV,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/redefinir-senha') return resetPage();
    if (request.method === 'GET' && url.pathname === '/.well-known/assetlinks.json') return assetLinks(env);
    if (url.pathname.startsWith('/v1/')) {
      const central = await handleCentralAuth(request, env);
      if (central) return central;
      return handleCommercialSync(request, env);
    }
    // Sem DATABASE_URL o servidor cairia no PGlite, em disco efemero e com
    // a chave de integracao padrao (publica). Nunca subir o Container assim.
    if (!env.DATABASE_URL || !env.JWT_SECRET) {
      return Response.json({ erro: 'Serviço aguardando configuração.' }, { status: 503 });
    }
    return env.API.getByName('production').fetch(request);
  },
};
