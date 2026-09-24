# STATUS-CODEX — Fase 1 servidor

- Atualizado: 24/09/2026, 18:48 BRT.
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
- `POST /v1/auth/handoff/consume`: valida código, expiração, uso e sessão de origem; **um código válido ainda retorna 503 `SERVER_ERROR`**, pois falta a ponte com o Express. Não marca o código como usado nem devolve uma sessão web inválida.

## Formato real da sessão web

O login de `public/app.js` chama `POST /api/auth/login` com `{ email, senha }`. `routes/auth.js` responde `{ token, usuario: { id, nome, email, role }, instancia: { id, name } }`. O `token` é um JWT assinado com `JWT_SECRET`, cujo `sub` é o ID numérico do usuário espelhado no PostgreSQL. O navegador salva `cc_token`, `cc_usuario` e `cc_instancia` em `localStorage`. O login central `POST /v1/auth/login` retorna `{ ok, sessionToken, expiresAt, user }`, com outro token e ID UUID do D1. O `public/app.js` já detecta `#handoff`, chama o `consume`, grava os três campos web quando houver resposta válida e remove o fragmento.

## Segredos e variáveis

- `EMAIL_PROVIDER_API_KEY` e `EMAIL_FROM`: envio HTTP pelo Resend. Sem ambos, não envia; registra apenas evento sem dados sensíveis.
- `ANDROID_CERT_SHA256`: impressão digital do certificado Android para o App Link.
- A ponte pendente deve usar um segredo já compartilhado pelo Worker e Container; não registrar valores neste arquivo.

## Validação

- Testes novos isolados: 10 passaram. Cobrem resposta genérica, limites por e-mail e IP, reenvio, confirmação, expiração e reuso do token, senha fraca, revogação total, `revoke-others`, emissão e expiração do handoff e o bloqueio seguro de handoff válido sem a ponte.
- `npm run verify`: verde, 191 testes passaram e 94 arquivos JavaScript verificados.
- `npm test -- --test-concurrency=1`: verde, 191 testes passaram. A primeira execução paralela de `npm test` teve três falhas E2E de Chrome (sessão encerrada/tempo de espera); os mesmos casos passaram na execução sequencial e no `verify`.
- Migração D1 de produção, deploy e provedor HTTP real: não executados.

## Pedidos ao Claude / Lucas

- **Lucas:** autorizar um ajuste de escopo em `routes/auth.js` para uma rota interna de ponte. Ela deve validar uma credencial de serviço do Worker, espelhar a conta central no PostgreSQL, gravar uma sessão central nova para validação posterior e emitir o JWT e `instancia` reais do Express. Sem esse ajuste, `consume` não pode cumprir o 200 do contrato dentro dos arquivos atribuídos ao Codex. O contrato pode ficar intacto. Após autorização, o Codex conclui a ponte, os testes de handoff válido e reutilizado e atualiza o PR.
- **Claude:** o formato web real é o descrito acima. Até a ponte ser concluída, tratar 503 de `consume` como falha de entrada no web; o código no fragmento não é uma sessão.
