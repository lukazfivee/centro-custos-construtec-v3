# Prompt da Fase 1 para o Claude Code (app Android)

Cole no Claude Code, aberto na raiz de `centro-custos-construtec-v3`, com esta pasta em `docs/suite-mobile/`.

----- COPIAR A PARTIR DAQUI -----

Você vai implementar a **Fase 1 (parte do app Android)** da Suíte Construtec mobile: login de vidro, PIN, biometria, recuperação de senha e bloqueio automático. O visual e o comportamento foram aprovados num protótipo. Outra IA (Codex) está fazendo, em paralelo, a parte do servidor, em outra branch. Você **não** mexe no servidor.

## Leia primeiro, nesta ordem

1. `AGENTS.md` da raiz e siga as regras dele: sem emojis na interface; arquivos com no máximo 350 linhas; `npm test` verde.
2. `docs/suite-mobile/LEIA-ME.md`
3. `docs/suite-mobile/01-CONTEXTO-REPOSITORIOS.md`
4. `docs/suite-mobile/02-ESPEC-LOGIN-MOBILE.md`, a especificação que você vai implementar.
5. `docs/suite-mobile/04-CONTRATO-API.md`, as rotas que você consome. Não altere este arquivo.
6. `docs/suite-mobile/03-PLANO-FASES.md`, Fase 1, coluna Claude Code: os arquivos que são seus.
7. `docs/suite-mobile/design-tokens.json` e `docs/suite-mobile/prototipo/README-PROTOTIPO.md`. Consulte o `prototipo/Main.dc.html` só nos trechos indicados no README, porque o arquivo é grande.
8. `android/app/src/main/java/br/com/rcconstrutec/centrocustos/MainActivity.java` e `android/app/build.gradle`.

## Regras desta tarefa

- Sincronize com `origin/main`, preserve mudanças locais e crie a branch `feat/android-suite-auth`.
- Mexa **só** nos arquivos da sua coluna no plano: `android/**`, `scripts/mock-central-auth.mjs`, `test/mobile-auth-*.test.js` e `docs/suite-mobile/STATUS-CLAUDE.md`.
- Não edite `cloudflare/**`, `public/**`, `routes/**` nem o `CODEX_HANDOFF.md`. Se precisar de algo do servidor, escreva no `STATUS-CLAUDE.md`, na seção "Pedidos ao Codex", e siga com o mock.
- Não publique nada, não gere APK de release, não use segredos reais, não toque em banco de produção.
- Siga a arquitetura recomendada no `01-CONTEXTO`:
  - telas de entrada em HTML/CSS/JS local em `android/app/src/main/assets/auth/`, aproveitando o CSS do protótipo;
  - ponte `@JavascriptInterface` mínima, só para a origem local;
  - chamadas HTTP feitas pelo lado nativo;
  - cofre com Android Keystore, PIN com PBKDF2 e biometria com `BiometricPrompt` + `CryptoObject`, conforme a seção 5 da especificação.
- Barra de status transparente sobre o gradiente, com o conteúdo desenhando por baixo. Não pinte uma faixa de cor no topo.
- Em toda tela com check grande, faça a animação da seção 4 da especificação (check → estouro → símbolo da Construtec com fundo transparente). O símbolo está em `docs/suite-mobile/assets/simbolo-construtec.png`; copie para os assets do app.
- A lógica pura em JS (regras do PIN, força da senha, validação de e-mail, contador de tentativas) fica em módulos testáveis, cobertos por `test/mobile-auth-*.test.js` com `node --test`.
- Faça um `scripts/mock-central-auth.mjs` que implemente o contrato, para testar o app sem o servidor real.

## Antes de codar

Responda em português, curto, com:

1. o que você encontrou no `MainActivity` e no Gradle que muda o plano;
2. as duas decisões pendentes do plano (subir o `minSdk` para 28 ou usar `androidx.biometric`; o que fazer com a tela atual "Conecte este celular à instalação Windows"), com a sua recomendação;
3. a lista de arquivos que você vai criar ou alterar e a ordem das etapas.

**Espere o meu ok antes de implementar.**

## Ao terminar

- Rode `npm test` e, se houver Android SDK, `cd android && ./gradlew assembleDebug`. Se não houver SDK, diga isso claramente e não finja validação.
- Atualize `docs/suite-mobile/STATUS-CLAUDE.md` com: data e hora BRT, commit base, o que foi feito, como validou, roteiro de teste manual no aparelho, pendências e pedidos ao Codex.
- Commits pequenos e descritivos. Abra um PR para `main` com resumo, prints (se tiver) e roteiro de teste. Não faça merge.
