# STATUS-CODEX — Fase 1 servidor

- Atualizado: 24/09/2026, 20:08 BRT.
- Commit base: `8980682312853d6a4cf785f05d075dfdb01606b3` (`origin/main`).
- Branch: `feat/auth-central-reset-handoff`.

## Rotas entregues

- `GET /v1/auth/session`: rota existente, agora com `SESSION_INVALID` no 401.
- `POST /v1/auth/password-reset/request`: resposta genérica 202, limites de 3 por e-mail e 10 por IP em 15 minutos, intervalo de 60 segundos, token de 30 minutos e envio HTTP pelo Resend quando configurado.
- `POST /v1/auth/password-reset/confirm`: valida token e força da senha, troca PBKDF2 e revoga todas as sessões centrais.
- `GET /v1/auth/sessions` e `POST /v1/auth/sessions/revoke-others`: lista sem credenciais e preserva a sessão atual ao revogar as demais.
- `GET /redefinir-senha`: página inline, token no fragmento, checklist e medidor.
- `GET /.well-known/assetlinks.json`: depende de `ANDROID_CERT_SHA256`; sem ela retorna 404.
- `POST /v1/auth/handoff`: emite código aleatório de 60 segundos, com somente hash no D1.
- `POST /v1/auth/handoff/consume`: valida código, expiração, uso e sessão de origem; marca o código como usado uma vez, cria sessão web cujo hash fica no D1 e devolve o mesmo formato do login web. Se a ponte falhar, remove a nova sessão e devolve 503.
- Internas: `POST /api/auth/handoff-bridge` no Express recebe somente chamadas do Container protegidas por `SYNC_SHARED_KEY` (o Worker público responde 404 nesse caminho); `POST /v1/auth/session-hash` revalida o hash da sessão no D1 com a mesma chave.

## Formato real da sessão web

O login de `public/app.js` chama `POST /api/auth/login` com `{ email, senha }`. `routes/auth.js` responde `{ token, usuario: { id, nome, email, role }, instancia: { id, name } }`. O `token` é um JWT assinado com `JWT_SECRET`, cujo `sub` é o ID numérico do usuário espelhado no PostgreSQL. O `consume` agora devolve exatamente esses três campos. O navegador salva `cc_token`, `cc_usuario` e `cc_instancia` em `localStorage`. O login central `POST /v1/auth/login` retorna `{ ok, sessionToken, expiresAt, user }`, com outro token e ID UUID do D1. O `public/app.js` detecta `#handoff`, chama o `consume`, grava os três campos web e remove o fragmento. O JWT do handoff leva uma referência assinada ao hash da sessão D1; o Express a valida sem guardar token bruto no PostgreSQL.

## Segredos e variáveis

- `EMAIL_PROVIDER_API_KEY` e `EMAIL_FROM`: envio HTTP pelo Resend. Sem ambos, não envia; registra apenas evento sem dados sensíveis.
- `ANDROID_CERT_SHA256`: impressão digital do certificado Android para o App Link.
- `SYNC_SHARED_KEY`: segredo existente, com 32 ou mais caracteres, disponível no Worker e no Container para a ponte interna e para validar a referência hash. `JWT_SECRET` continua sendo o segredo existente usado pelo Express para assinar o JWT.

## Validação

- Testes novos isolados: 14 passaram. Cobrem redefinição, sessões, handoff válido, expirado e reutilizado, falha da ponte, validação da chave interna, ciclo de troca de senha/logout da sessão referenciada e um fluxo integrado Worker → Express → JWT → rota web → revogação no D1.
- `npm run verify`: verde, 195 testes passaram e 94 arquivos JavaScript verificados.
- CI usa Node 20 sem `node:sqlite`; os testes novos dependentes de D1 seguem o mesmo padrão de skip dos testes de identidade já existentes nessa versão. Foram executados localmente no Node 24 (14/14). O teste de HTML/App Links continua rodando no Node 20.
- `npm test -- --test-concurrency=1`: antes da ponte, verde com 191 testes. A primeira execução paralela de `npm test` teve três falhas E2E de Chrome (sessão encerrada/tempo de espera); os mesmos casos passaram na execução sequencial e no `verify`.
- Migração D1 de produção e deploy: executados em 24/09 (seção "Produção"). Provedor HTTP real: ainda sem segredo configurado.

Uma segunda revisão corrigiu a resolução de `Bearer hash:<sha256>` em `change-password` e `logout`. Antes, essas rotas calculavam SHA-256 sobre a referência textual e poderiam preservar ou excluir a sessão errada; agora usam diretamente o hash validado com `SYNC_SHARED_KEY`.

## Produção (24/09/2026, feito pelo Claude Code com autorização do Lucas)

- **Merge:** PR #28 no `main`, commit `5b8d7672e5f797f1d06a41b17b26c703f3d1c67b`.
- **Migração D1:** `007-mobile-auth.sql` aplicada com `wrangler d1 execute centro-custos-producao --remote --file`. Antes da aplicação, conferi que as tabelas não existiam.
  - Depois da aplicação, existem `password_reset_tokens`, `mobile_auth_limits` e `session_handoffs`, com os índices `password_reset_tokens_user` e `session_handoffs_user`.
  - 11 linhas gravadas, 14 tabelas no banco. Nenhuma tabela existente foi alterada.
- **Deploy:** `node scripts/deploy-cloud.js`, que publicou o Worker e a imagem do Container `sha256:68ddbdb1...`.
  - Version ID `41a31aa4-0125-4812-9480-e98998e7900a`, em `https://centro-custos-api.construtec-reports.workers.dev`.
  - O Container troca a imagem depois de hibernar (cerca de 10 min).
- **Verificações em produção:**
  - `GET /v1/auth/session`, `GET /v1/auth/sessions` e `POST /v1/auth/handoff` sem token devolvem 401 `SESSION_INVALID`;
  - `POST /v1/auth/handoff/consume` com `{"code":"x"}` devolve 400 `HANDOFF_INVALID`;
  - `POST /v1/auth/password-reset/confirm` com token inválido devolve 400 `TOKEN_INVALID`;
  - `GET /redefinir-senha` devolve 200 HTML;
  - `GET /.well-known/assetlinks.json` devolve 404 (sem `ANDROID_CERT_SHA256`);
  - `POST /api/auth/handoff-bridge` pelo Worker público devolve 404.
  - `password-reset/request` não foi chamado, para não gastar o limite.
- **Segredos:** nada foi alterado.
  - `SYNC_SHARED_KEY` e `JWT_SECRET` existem.
  - `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM` e `ANDROID_CERT_SHA256` ainda não existem. Já existe um `RESEND_API_KEY` antigo, mas o código novo lê `EMAIL_PROVIDER_API_KEY`; o Lucas decide se reaproveita a mesma chave.
  - Até isso, o pedido de redefinição responde 202 e não envia e-mail.
- **E-mail configurado em 25/09/2026:**
  - `EMAIL_FROM` = `Construtec <no-reply@reports.rcconstrutec.com.br>`, domínio verificado no Resend.
  - `EMAIL_PROVIDER_API_KEY` = chave nova `centro-custos-login` (Sending access), salva pelo Lucas no painel da Cloudflare. A primeira tentativa de salvar a chave gerou 400 no Resend.
  - `pcm@rcconstrutec.com.br` estava na lista de bloqueio do Resend (bounce de agosto) e foi removido. Os reportes de 18/09 para esse endereço também tinham sido bloqueados.
  - Teste real: o pedido de redefinição para `pcm@` foi entregue ("Delivered") e recebido pelo Lucas.

## Pós Fase 1 (26/09/2026, feito pelo Claude Code com autorização do Lucas, branch `feat/auth-logout-cascade`)

O Codex pelo plugin não conseguiu gravar no repositório (`.git` só leitura na sandbox). Por isso o Lucas pediu que o Claude fizesse.

- **Migração `008-sessao-web-vinculada.sql`**, só aditiva: `cloud_sessions.parent_session_hash` e o índice `cloud_sessions_parent`.
  - **Aplicar antes do deploy**, porque o `consume` passa a gravar essa coluna.
  - Não é idempotente: é `ALTER TABLE ADD COLUMN`, então só deve rodar uma vez.
- **`consume`:** a sessão "Centro de Custos web" guarda o hash da sessão do app que pediu o handoff.
- **`POST /v1/auth/logout`:** a rota já existia (`identityAdmin.js`) e foi ampliada, sem quebrar clientes antigos.
  - Além da sessão atual, apaga as sessões web filhas e os códigos de handoff pendentes dela.
  - Continua 200 mesmo sem token, agora com `{ ok: true, revoked: <n> }`.
- **`revoke-others`:** passa a preservar as sessões web filhas da sessão atual. Antes derrubava o site aberto no próprio aparelho. As filhas das sessões revogadas caem junto.
- **Log do Resend:** `password_reset_email_delivery_failed <status> <name>`, em que `name` é o tipo do erro do provedor (ex.: `invalid_api_key`, `validation_error`). Nunca registra e-mail, token, link nem chave.
- **CI:** matriz Node 20 e 24; no 24 rodam os testes do D1.
- **Testes novos:** `test/auth-logout.test.js` (4) e `test/password-reset-provider-log.test.js` (2).
- **`test/central-identity.test.js`:** passa a aplicar as migrações 007 e 008. O `batch` simulado agora devolve os resultados, como o D1 real.

**Contrato** (`04-CONTRATO-API.md`, seção 5): texto aprovado pelo Lucas em 26/09 e já incluído no contrato:

> `POST /v1/auth/logout` (Bearer): 200 `{ ok: true, revoked: <n> }`. Encerra a sessão atual e as sessões web criadas por handoff a partir dela; sem token válido, responde 200 com `revoked: 0`. O app chama no "Sair" e no "Sair e esquecer" e segue com a saída local mesmo se falhar.
>
> `revoke-others` preserva as sessões web criadas pela sessão atual.

## Pedidos ao Claude / Lucas

- **Claude:** o `consume` agora devolve o formato web descrito acima. O app pode seguir o contrato original; o código no fragmento dura 60 segundos e funciona uma vez.
