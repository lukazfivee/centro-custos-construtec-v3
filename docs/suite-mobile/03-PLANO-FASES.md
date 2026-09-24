# Plano por fases, dividido entre Codex e Claude Code

## Como a divisão funciona

- Cada agente trabalha **na sua própria branch** e **só nos arquivos que são dele** (tabela de cada fase). Isso evita conflito de merge e cada um lê menos código, o que gasta menos tokens.
- O que liga as duas partes é o contrato (`04-CONTRATO-API.md`). Nenhum dos dois o altera sozinho.
- Enquanto o servidor não estiver pronto, o Claude Code testa com um mock do contrato. O Codex testa as rotas com os testes do Node.
- Cada agente mantém seu status em `docs/suite-mobile/STATUS-CODEX.md` ou `STATUS-CLAUDE.md`, com o que fez, como validou, o que falta e as perguntas para o outro. O Lucas repassa as perguntas entre os dois.
- Durante a fase, **ninguém edita o `CODEX_HANDOFF.md`**. Quem fizer o último merge da fase acrescenta uma entrada consolidada.
- Ordem de merge: primeiro o PR do Codex (servidor), depois o do Claude (app). O PR do app precisa funcionar mesmo se a rota nova ainda der 404, só escondendo o "Esqueci a senha".

Divisão de perfil: o **Claude Code** fica com interface, visual, animação e o app Android. O **Codex** fica com servidor, banco, segurança das rotas, e-mail e testes de API.

---

## Fase 1: entrada no celular (login, PIN, biometria, recuperar senha)

| | Codex | Claude Code |
|---|---|---|
| Branch | `feat/auth-central-reset-handoff` | `feat/android-suite-auth` |
| Repositório | `centro-custos-construtec-v3` | `centro-custos-construtec-v3` |
| Arquivos que são dele | `cloudflare/center-container/**` (novos módulos em arquivos próprios, porque `centralAuth.js` está com 298 de 350 linhas), `cloudflare/center-container/d1-migrations/007-*.sql`, `public/app.js` (só o consumo de `#handoff`) ou um `public/mobile-handoff.js` novo, `test/password-reset*.test.js`, `test/session-handoff*.test.js`, `test/sessions-revoke*.test.js`, `docs/suite-mobile/STATUS-CODEX.md` | `android/**`, `android/app/src/main/assets/auth/**`, `scripts/mock-central-auth.mjs`, `test/mobile-auth-*.test.js` (lógica JS dos assets: PIN, força da senha, validações), `docs/suite-mobile/STATUS-CLAUDE.md` |
| Entrega | Seções 2 a 6 do contrato, página `/redefinir-senha`, `assetlinks.json`, limites de tentativa, e-mail por provedor HTTP com modo "sem segredo" seguro, testes | Telas [A] [B] [B2] [C] [D] [E], sobreposição biométrica, bloqueio automático, Segurança, barra de status transparente, cofre (Keystore, PIN e biometria), App Link de `/redefinir-senha`, handoff para o Centro de Custos web |
| Validação | `npm test` e `npm run verify` verdes, testes novos cobrindo sucesso, expiração, reuso, limite de tentativas e revogação de sessões | `./gradlew assembleDebug` (se o SDK estiver disponível) e `npm test` para os testes JS novos. Roteiro manual no `STATUS-CLAUDE.md` com prints do emulador ou do aparelho, se houver |

**Decisões que o Claude Code precisa confirmar com o Lucas antes de codar:**

- Subir o `minSdk` de 26 para 28 (Android 9+) para usar o `BiometricPrompt` nativo sem AndroidX, ou manter 26 e adicionar `androidx.biometric`.
- A troca da tela "Conecte este celular à instalação Windows" pelo login central quebra quem usa servidor local. Proposta: o login central vira o padrão, e a tela de URL fica escondida em "Configurar servidor local" (toque longo no logo).

## Fase 2: Centro de Custos no celular

| Codex | Claude Code |
|---|---|
| Idempotência para lançamentos feitos offline: UUID gerado no cliente, `POST` que pode ser repetido sem duplicar, upload de foto com retomada, resposta de conflito clara. Testes. | Telas web do Centro de Custos para celular (Início com sino, obras, despesa com foto, confirmação com a animação de check, faixa "Sem internet" e fila em IndexedDB no `public/`), seguindo as Rodadas 6, 7 e 15 do protótipo. |

## Fase 3: Suíte (Orçamentos dentro do app) e troca entre apps

| Codex | Claude Code |
|---|---|
| Handoff no servidor do Orçamentos (`src/server`): `consume` do código e sessão JWT local. Deep link de volta para a proposta. | Seletor "Suíte" no shell, que alterna entre as duas WebViews sem perder o estado, e o acabamento do Orçamentos no celular que ainda falta (ver `HANDOFF-MOBILE-ADAPT.md`). |

## Fase 4: Notificações

| Codex | Claude Code |
|---|---|
| Tabela de notificações, gatilhos (proposta aprovada, item acima do orçado, medição vencendo, novo acesso), preferências por usuário, envio pelo FCM (conta Firebase e `google-services.json` fornecidos pelo Lucas). | Central de notificações (Hoje e Ontem, filtro por app, marcar como lidas, preferências), sino com contador, banner de vidro no app, `FirebaseMessagingService` no Android abrindo a tela certa. Rodada 16 do protótipo. |

## Fase 5: Primeiro uso e cadastro

| Codex | Claude Code |
|---|---|
| Cadastro com código da empresa e convite por e-mail, com aprovação do administrador. Sem cadastro aberto sem aprovação. | Tour de 4 telas no primeiro acesso (Rodada 16), telas de cadastro no vidro (8i e 8j, 12f). |

---

## Prompts curtos para as fases 2 a 5

Use no início de cada fase, colando **para o agente certo**:

> Leia `docs/suite-mobile/LEIA-ME.md`, `03-PLANO-FASES.md` (Fase N, coluna "<Codex | Claude Code>"), `02-ESPEC-LOGIN-MOBILE.md` e o seu `STATUS-*.md`. Sincronize com `origin/main`, crie a branch indicada, trabalhe só nos arquivos da sua coluna, apresente um plano curto e espere o meu ok antes de implementar. Ao final, rode as validações, atualize o seu `STATUS-*.md` e abra o PR sem publicar.
