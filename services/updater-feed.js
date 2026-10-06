// Descoberta da versao publicada e traducao de erros do atualizador para portugues.
// O repositorio publica pre-lancamentos (v3.1.0-rc.N). O provedor "github" do electron-updater
// segue o canal "rc" e nunca enxerga uma versao final (3.1.0) depois do ultimo rc. Por isso o app
// le a lista de releases (atom, publica e sem limite de API), escolhe a mais recente que tenha o
// latest.yml e aponta o provedor "generic" para a pasta de downloads dessa release.
const path = require('path');

const PADRAO = 'lukazfivee/centro-custos-construtec-v3';
const SLUG = /^[\w.-]+\/[\w.-]+$/;
const TENTATIVAS = 5;

function erro(codigo, mensagem, causa) {
  const e = new Error(mensagem);
  e.code = codigo;
  if (causa) e.cause = causa;
  return e;
}

function repositorio(env = process.env) {
  const informado = String(env.GITHUB_REPO || '').trim();
  if (SLUG.test(informado)) return informado;
  try {
    const publish = require(path.join(__dirname, '..', 'package.json')).build.publish;
    const slug = `${publish.owner}/${publish.repo}`;
    if (SLUG.test(slug)) return slug;
  } catch { /* usa o padrao */ }
  return PADRAO;
}

async function buscar(fetchImpl, url, opcoes, ms) {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), ms);
  try { return await fetchImpl(url, { redirect: 'follow', ...opcoes, signal: controle.signal }); } finally { clearTimeout(timer); }
}

async function listarTags(fetchImpl, slug, ms) {
  const resposta = await buscar(fetchImpl, `https://github.com/${slug}/releases.atom`, { headers: { accept: 'application/atom+xml, application/xml' } }, ms);
  if (!resposta.ok) throw erro('FEED_HTTP', `GitHub respondeu ${resposta.status}`);
  const xml = await resposta.text();
  const tags = [];
  for (const m of xml.matchAll(/releases\/tag\/([^"'<>\s]+)/g)) {
    const tag = decodeURIComponent(m[1]);
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

// Devolve { provider: 'generic', url, tag } para o electron-updater.
async function resolverFeed({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const fixo = String(env.UPDATE_FEED_URL || '').trim().replace(/\/+$/, '');
  if (/^https:\/\//i.test(fixo)) return { provider: 'generic', url: fixo, tag: null };
  if (typeof fetchImpl !== 'function') throw erro('NO_FETCH', 'Rede indisponível neste ambiente.');
  const slug = repositorio(env);
  const tags = (await listarTags(fetchImpl, slug, timeoutMs)).slice(0, TENTATIVAS);
  for (const tag of tags) {
    const base = `https://github.com/${slug}/releases/download/${encodeURIComponent(tag)}`;
    const r = await buscar(fetchImpl, `${base}/latest.yml`, { method: 'HEAD' }, timeoutMs);
    if (r.ok) return { provider: 'generic', url: base, tag };
  }
  throw erro('NO_RELEASE', 'Nenhuma versão publicada com instalador do Windows.');
}

const REDE = /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ERR_INTERNET_DISCONNECTED|ERR_NETWORK|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_TIMED_OUT|fetch failed|network|socket hang up|aborted|AbortError/i;

// Mensagem curta e clara para quem usa o app. O detalhe tecnico fica em errorDetail.
function mensagemAmigavel(error) {
  const bruto = String((error && error.message) || error || '');
  const codigo = String((error && (error.code || error.name)) || '');
  const texto = `${codigo} ${bruto} ${error && error.cause ? error.cause.code || error.cause.message || '' : ''}`;
  if (codigo === 'UPDATER_UNAVAILABLE' || codigo === 'UPDATER_NOT_PACKAGED') return bruto;
  if (REDE.test(texto)) return 'Sem conexão com a internet ou o servidor de atualizações não respondeu. Verifique a rede e tente de novo.';
  if (/NO_RELEASE|ERR_UPDATER_CHANNEL_FILE_NOT_FOUND|ERR_UPDATER_NO_PUBLISHED_VERSIONS|HttpError: 404|\b404\b/.test(texto)) return 'Não há uma versão com instalador publicada no servidor de atualizações.';
  if (/\b(401|403|429)\b|rate limit/i.test(texto)) return 'O servidor de atualizações recusou o acesso agora. Tente de novo mais tarde.';
  if (/sha512|checksum|ERR_UPDATER_INVALID|corrupt/i.test(texto)) return 'O arquivo baixado está incompleto ou corrompido. Baixe de novo.';
  if (/EACCES|EPERM|EBUSY/.test(texto)) return 'Sem permissão para gravar a atualização neste computador. Feche outros programas e tente de novo.';
  if (/ENOSPC/.test(texto)) return 'Sem espaço em disco para baixar a atualização.';
  if (/signature|assinatura|publisher/i.test(texto)) return 'A assinatura do instalador não confere. A atualização foi recusada por segurança.';
  return 'Não foi possível atualizar agora. Tente de novo em instantes.';
}

module.exports = { resolverFeed, mensagemAmigavel, repositorio, listarTags };
