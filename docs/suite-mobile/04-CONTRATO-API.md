# Contrato de API da Fase 1 (fonte única entre Codex e Claude Code)

**Dono da implementação:** Codex, no Worker `centro-custos-api` (`cloudflare/center-container/`).
**Consumidor:** Claude Code, no app Android (assets locais de `android/`).

Nenhum dos dois altera este arquivo sozinho. Se algo precisar mudar, o agente escreve a proposta no seu arquivo de status (`STATUS-CODEX.md` ou `STATUS-CLAUDE.md`) e o Lucas repassa para o outro.

Base: `https://centro-custos-api.construtec-reports.workers.dev`. O app lê a URL de uma configuração de build; não deixar a URL fixa no código.

Todas as respostas são JSON `{ ok: boolean, ... }`. Os erros trazem `error` (mensagem curta em pt-BR) e `code` (constante estável). O app decide o texto na tela pelo `code`, não pelo `error`.

Cabeçalhos que o app envia em todas as chamadas:

- `x-instance-id`: UUID do aparelho, gerado na primeira abertura e guardado;
- `x-instance-name`: "Android · <fabricante> <modelo>";
- `x-client`: `suite-android/<versionName>`.

---

## 1. Login (já existe, não muda)

`POST /v1/auth/login` com `{ email, password }`:

- 200: `{ ok: true, sessionToken, expiresAt /* epoch segundos */, user: { id, name, email, role, ... } }`;
- 401: `{ ok: false, error, code? }`. O app trata qualquer 401 como credencial inválida;
- 409: `DIRECTORY_EMPTY` ou `PASSWORD_PROFILE_LEGACY`. O app mostra "Conta precisa ser reativada pelo administrador.".

## 2. Validar sessão salva

`GET /v1/auth/session` com `Authorization: Bearer <sessionToken>`:

- 200: `{ ok: true, user, expiresAt }`. Se já existir rota equivalente (ver `test/cloud-session-check.test.js`), o Codex reaproveita e documenta aqui o caminho real;
- 401: `SESSION_INVALID` ou `SESSION_EXPIRED`. O app apaga o blob e vai para o login de e-mail e senha.

Com o PIN certo mas sem internet, o app entra em modo offline e valida quando a conexão voltar.

## 3. Pedir redefinição de senha

`POST /v1/auth/password-reset/request` com `{ email }`:

- Sempre 202: `{ ok: true }`, mesmo que o e-mail não exista.
- Limite de tentativas:
  - 3 por e-mail a cada 15 min e 10 por IP a cada 15 min;
  - quando passar do limite, também responde 202, mas não envia nada;
  - reenvio para o mesmo e-mail só depois de 60s.
- Gera um token de 32 bytes em base64url. No D1 guarda só o `sha256(token)`, com `expires_at` para 30 min e uso único. Pedir de novo invalida os tokens anteriores do mesmo usuário.
- E-mail:
  - assunto "Redefinir sua senha · Construtec";
  - link `https://<base>/redefinir-senha#t=<token>` (o token vai no fragmento, para não aparecer em logs de servidor);
  - provedor HTTP configurado por segredo (`EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM`);
  - **sem segredo configurado:** não envia e registra o evento sem o token.

## 4. Página e confirmação da redefinição

`GET /redefinir-senha` devolve uma página HTML do próprio Worker, no mesmo visual de vidro:

- lê o `#t` com JS, mostra o formulário de senha nova (medidor e checklist como na especificação) e faz o POST abaixo;
- quando o app tiver App Link configurado, o Android abre o app no lugar da página.

`GET /.well-known/assetlinks.json` devolve o App Link do pacote `br.com.rcconstrutec.centrocustos`. A impressão digital SHA-256 do certificado vem do segredo ou variável `ANDROID_CERT_SHA256`; sem ela, responde 404.

`POST /v1/auth/password-reset/confirm` com `{ token, password }`:

- 200: `{ ok: true, revokedSessions: <n> }`. Troca o hash (mesmo esquema PBKDF2 de hoje, ou seja `makePasswordRecord`), marca o token como usado e **apaga todas as `cloud_sessions` do usuário**;
- 400:
  - `TOKEN_INVALID`, quando o token não existe ou já foi usado;
  - `TOKEN_EXPIRED`;
  - `WEAK_PASSWORD`, quando a senha tem menos de 8 caracteres ou menos de 3 destes 4 critérios: 8+ caracteres, maiúscula, número, símbolo.

## 5. Sair dos outros aparelhos

`POST /v1/auth/sessions/revoke-others` (Bearer):

- 200: `{ ok: true, revoked: <n> }`. Apaga as sessões do usuário, menos a atual.

`GET /v1/auth/sessions` (Bearer):

- 200: `{ ok: true, sessions: [{ instanceName, createdAt, lastSeenAt, current: boolean }] }`. Nunca devolve hash nem token.

## 6. Entregar a sessão para as páginas web (handoff)

**Problema:** o app tem o `sessionToken`, e o Centro de Custos web precisa entrar sem pedir a senha de novo e sem o token aparecer na URL.

`POST /v1/auth/handoff` (Bearer) com `{ target: "centro-custos" }`:

- 200: `{ ok: true, code, expiresAt }`. O código é aleatório, de uso único e vale 60s; o D1 guarda só o hash.

O app abre então `https://<base>/#handoff=<code>`.

`POST /v1/auth/handoff/consume` com `{ code }`, sem autenticação:

- 200: exatamente o que o login web do Centro de Custos já devolve e o `public/app.js` já sabe guardar. O Codex investiga o formato real (`token`, `usuario`, `instancia`) e documenta aqui;
- 400: `HANDOFF_INVALID`.

No `public/app.js` (do Codex): ao iniciar, se houver `#handoff=`, consome o código, guarda a sessão como no login normal e limpa o fragmento com `history.replaceState`.

O alvo `orcamentos` fica para a Fase 3, com rota espelho no servidor do Orçamentos.

## 7. Erros comuns

- 429: não usar. Quando passar do limite, o request devolve 202 e o resto devolve 400 `RATE_LIMITED`.
- 5xx: `{ ok: false, code: "SERVER_ERROR" }`. O app mostra a mensagem genérica.
- CORS: o app chama de `https://appassets.androidplatform.net` (se usar `WebViewAssetLoader`) ou pela ponte nativa. O Codex libera só essa origem nas rotas `/v1/auth/*`, ou o Claude faz as chamadas pelo lado nativo (`HttpURLConnection`) e dispensa o CORS. **Decisão: as chamadas saem do lado nativo**, então não é preciso CORS.
