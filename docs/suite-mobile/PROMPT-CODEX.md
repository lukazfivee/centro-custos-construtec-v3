# Prompt da Fase 1 para o Codex (servidor)

Cole no Codex, aberto na raiz de `centro-custos-construtec-v3`, com esta pasta em `docs/suite-mobile/`.

----- COPIAR A PARTIR DAQUI -----

Tarefa: implementar a **Fase 1 (parte do servidor)** da Suíte Construtec mobile, no Worker `centro-custos-api` (diretório central de contas). Outra IA (Claude Code) está fazendo o app Android, em paralelo, em outra branch. Você **não** mexe em `android/`.

## Leia primeiro

1. `AGENTS.md` da raiz: `MAX_LINES <= 350`, `npm test` verde, sem emojis na interface.
2. `docs/suite-mobile/01-CONTEXTO-REPOSITORIOS.md`
3. `docs/suite-mobile/04-CONTRATO-API.md`: é o que você implementa. Não altere o contrato por conta própria.
4. `docs/suite-mobile/03-PLANO-FASES.md`, Fase 1, coluna Codex: os arquivos que são seus.
5. `docs/suite-mobile/02-ESPEC-LOGIN-MOBILE.md`, só a seção [E] e a seção 2, para o visual da página `/redefinir-senha`.
6. Código: `cloudflare/center-container/centralAuth.js`, `identityAdmin.js`, `index.js`, `wrangler.jsonc`, `d1-migrations/006-identidade-compartilhada.sql`, `public/app.js` (login e `localStorage`) e os testes `test/central-identity.test.js`, `test/cloud-session-check.test.js` e `test/cloud-login-no-fallback.test.js`.

## Regras

- Sincronize com `origin/main`, preserve mudanças locais e crie a branch `feat/auth-central-reset-handoff`.
- Só os arquivos da sua coluna:
  - `cloudflare/center-container/**`, com módulos novos em arquivos próprios (o `centralAuth.js` está com 298 de 350 linhas; nele, só registre as rotas);
  - `d1-migrations/007-*.sql`;
  - `public/app.js` ou `public/mobile-handoff.js`, só para consumir o `#handoff`;
  - `test/password-reset*.test.js`, `test/session-handoff*.test.js`, `test/sessions-revoke*.test.js`;
  - `docs/suite-mobile/STATUS-CODEX.md`.
- Não edite `android/**`, nem o `CODEX_HANDOFF.md`, nem o contrato. Dúvidas ou propostas de mudança vão no `STATUS-CODEX.md`, em "Pedidos ao Claude / Lucas".
- Segurança:
  - tokens e códigos guardados só como hash SHA-256;
  - uso único, com expiração (30 min para a redefinição, 60 s para o handoff);
  - resposta genérica no pedido de redefinição;
  - limite de tentativas como no contrato;
  - redefinir a senha revoga todas as sessões do usuário;
  - sem token, e-mail completo ou senha em log.
- E-mail por provedor HTTP, configurado por segredo (`EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM`). Sem segredo, não envia e registra sem dados sensíveis. Documente no `.env.example` e no README do container os nomes dos segredos, sem valores.
- `GET /redefinir-senha`: HTML/CSS/JS inline do próprio Worker, no visual de vidro da especificação. O token é lido do `#t`, com medidor de força e as mesmas regras do contrato (8+ caracteres e 3 de 4 critérios).
- `/.well-known/assetlinks.json` usando `ANDROID_CERT_SHA256`. Sem a variável, responde 404.
- Handoff: descubra o formato exato que o login web do Centro de Custos na nuvem entrega ao `public/app.js` (`token`, `usuario`, `instancia`) e faça o `consume` devolver o mesmo formato. Documente o formato real no `STATUS-CODEX.md`, para o Claude conferir.
- Não publique (`wrangler deploy`), não rode migrações no D1 de produção, não use segredos reais.

## Antes de codar

Responda curto, em português:

1. como a sessão web do Centro de Custos na nuvem é criada hoje (qual rota, qual formato);
2. se o `change-password` atual já revoga sessões;
3. a lista de arquivos e a ordem das etapas.

**Espere o meu ok.**

## Ao terminar

- `npm run verify` verde, com testes novos para: pedido genérico, limite de tentativas, reenvio antes de 60 s, confirmação válida, token expirado, token reutilizado, senha fraca, revogação de sessões, `revoke-others` mantendo a sessão atual, handoff válido, handoff expirado e handoff reutilizado.
- Atualize o `STATUS-CODEX.md` com: data e hora BRT, commit base, rotas entregues (com os caminhos reais), formato do handoff, segredos necessários, validação e pendências.
- Abra o PR para `main`, sem merge e sem deploy.
