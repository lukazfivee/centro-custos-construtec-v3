# Contexto dos repositórios (levantado em 24/09/2026)

Leitura feita com clone raso (`--depth 1`). Confirme tudo contra o `origin/main` atual antes de alterar: pode ter mudado.

## 1. `lukazfivee/centro-custos-construtec-v3` (onde começa a Fase 1)

- **Stack:** Node 20+, Express, PGlite ou PostgreSQL (`DATABASE_URL`), frontend em HTML/CSS/JS puro em `public/`, Electron (`desktop/main-unified.js`) para a Suíte desktop.
- **Regras do repo (`AGENTS.md`):** sem emojis no frontend; `MAX_LINES <= 350` por arquivo; dinheiro em centavos com HALF_UP; rodar `npm test` (e `npm run verify`) antes de dar como concluído; baselines e lançamentos liquidados são imutáveis.
- **Continuidade:** existe `CODEX_HANDOFF.md` com histórico. Atualize ao final, no mesmo formato (data/hora BRT, base, mudanças, validação, próximo passo).

### Nuvem

- Worker `centro-custos-api` em `cloudflare/center-container/` (`wrangler.jsonc`), com container do Express e **D1** (`centro-custos-producao`, binding `DB`).
- **Diretório central de contas** em `cloudflare/center-container/centralAuth.js` (298 linhas, perto do limite de 350):
  - `POST /v1/auth/login` com `{ email, password }` devolve `{ ok, sessionToken, expiresAt, user }`.
  - Sessões em `cloud_sessions` (guarda o `token_hash` em SHA-256, `expires_at`, `instance_id`, `instance_name`). Usuários em `cloud_users` (`org_id = 'rcconstrutec.com.br'`, senha em PBKDF2 com `password_iterations`, até 10000, por causa do Workers Free).
  - Também existem `POST /v1/auth/bootstrap`, `POST /v1/auth/change-password` e `/v1/auth/profile-photo`. A administração de identidades fica em `identityAdmin.js`.
  - Migrações D1 em `cloudflare/center-container/d1-migrations/` (última: `006-identidade-compartilhada.sql`).
- Outros Workers: `cloudflare-sync-worker/`, `cloudflare-report-worker/`.
- URLs vistas no código: `https://centro-custos-api.construtec-reports.workers.dev`, `https://construtec-orcamentos-cloud.construtec-reports.workers.dev`, `https://hub-sistemas-construtec.construtec-reports.workers.dev`.
- Testes existentes que tocam nesse assunto: `test/central-identity.test.js`, `test/cloud-login-no-fallback.test.js`, `test/cloud-session-check.test.js`, `test/cloud-user-mirror.test.js`, `test/iphone-pwa.test.js`.

### Frontend web

- `public/app.js` guarda a sessão em `localStorage` (`cc_token`, `cc_usuario`, `cc_instancia`) e manda `Authorization: Bearer`. Existe `public/sw.js` (PWA; há teste para iPhone).
- O resto do frontend ainda é pensado para computador. A adaptação para celular fica para a Fase 2.

### App Android existente

- `android/`: app Java nativo, sem AndroidX, `minSdk 26`, `targetSdk 35`, pacote `br.com.rcconstrutec.centrocustos`, `versionName 3.1.0-rc.15`.
- `MainActivity.java`: na primeira vez mostra a tela "Conecte este celular à instalação Windows da Construtec" (pede a URL do servidor e guarda em `SharedPreferences`) e depois abre a URL numa `WebView` (com seletor de arquivos). Cores atuais: navy `#021D26`, cyan `#32A9CD`.

### Lacunas para o protótipo

1. Não há tela de login nativa, nem PIN, nem biometria. Hoje o login acontece dentro da página web.
2. Não há **recuperação de senha por e-mail** no diretório central. O `nodemailer` do Express não serve dentro do Worker; o envio precisa de um provedor HTTP (por exemplo Resend, Mailchannels ou SES) configurado por segredo.
3. Não há **cadastro com código da empresa**: contas são criadas pelo administrador (`identityAdmin.js`, `users-authorized-emails.js`). Fica para uma fase posterior e depende de decisão do administrador.
4. Não há como **revogar todas as sessões** de um usuário, que é necessário ao trocar ou redefinir a senha. Verificar se o `change-password` já faz isso.
5. Não há mecanismo para entregar a sessão do app nativo às páginas web **sem pôr o token na URL**.

## 2. `lukazfivee/construtec-orcamentos` (entra nas fases seguintes)

- **Stack:** Electron Forge, Vite, React 19 e TypeScript no renderer (`src/renderer/`); Express em `src/server/`; PGlite localmente e PostgreSQL Neon na nuvem (`cloudflare/api-container/`, URL `construtec-orcamentos-cloud...workers.dev`). Tipos compartilhados em `src/shared/`.
- **Regras (`AGENTS.md`):** menor solução correta; preservar contratos de `src/shared/*`; nunca expor BDI, custos ou margens no PDF/Word do cliente; sem emojis; `npm run verify`; atualizar `CODEX_HANDOFF.md`.
- **Contas:** usa o diretório central do Centro de Custos (segredo `CONSTRUTEC_IDENTITY_KEY` igual nos dois Workers). Uma conta vale para os dois apps.
- **Celular:** a adaptação já está em andamento (`HANDOFF-MOBILE-ADAPT.md`, `src/mobile-responsive.css`, breakpoint 767px): itens em cartões com swipe, FAB, resumo como chip e folha, pílulas nas abas. O deep link para o Centro de Custos já existe (`#obra=<id>`, `centerDeepLinkUrl()`, `ProposalSyncDirectAction.tsx`).
- Já tem `NotificationsPopover.tsx` e `SuiteSwitcherPopover.tsx` no desktop, que servem de referência para as Fases 3 e 4.

## 3. Decisão de arquitetura recomendada

- **App "Suíte Construtec" no Android**, evoluído a partir de `centro-custos-construtec-v3/android`:
  - Telas de entrada (login de vidro, PIN, biometria, recuperar senha, bloqueio) feitas como **HTML/CSS/JS local empacotado no APK** (`android/app/src/main/assets/auth/`), aproveitando quase 1:1 o CSS do protótipo (a WebView do Android suporta `backdrop-filter`).
  - Ponte nativa mínima (`@JavascriptInterface`) **exposta só para a origem local** (`https://appassets.androidplatform.net/...` via `WebViewAssetLoader`, ou `file:///android_asset`), nunca para páginas remotas: biometria (`BiometricPrompt`), cofre (Android Keystore), cor da barra de status e vibração.
  - Depois de entrar, a WebView carrega os apps web na nuvem com a sessão já entregue.
- **iPhone:** por enquanto via PWA (já existe `sw.js` e teste). Se precisar de app de loja, migrar o shell para Capacitor na mesma estrutura de assets.
- Alternativa descartada por agora: reescrever tudo em React Native. Duplicaria as telas dos dois sistemas.
