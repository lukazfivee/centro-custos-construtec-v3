# Status: Claude Code (app Android)

Fase atual: 1 · Branch: `feat/android-suite-auth`

## Última atualização

- Data e hora (BRT): 24/09/2026 18:58
- Commit base: `8980682` (origin/main, "docs: pacote da Suite mobile (fase 1)")
- Trabalho feito na worktree `../wt-cc-android`, porque a pasta principal do repositório estava na branch do Codex.

## Feito

- **Telas de entrada locais** em `android/app/src/main/assets/auth/` (HTML, CSS e JS sem framework, fonte IBM Plex Sans e ícones Phosphor embutidos):
  - [A] login de vidro, [B] PIN, [B2] PIN bloqueado, [C] criar e trocar PIN, [D] oferta de biometria;
  - sobreposição de leitura biométrica, [E] recuperar senha em 4 passos, Segurança e menu do shell;
  - animação de sucesso (check, estouro, símbolo da Construtec sem fundo) na biometria e na senha alterada;
  - `prefers-reduced-motion` desliga as animações e deixa o símbolo parado.
- **Regras puras** em `rules.js` (PIN, tentativas, e-mail, força da senha, mensagens por `code`), cobertas por `test/mobile-auth-rules.test.js`.
- **Shell nativo** (Java, sem AndroidX, `minSdk 28`):
  - `AuthWebView`: serve os assets em `https://appassets.androidplatform.net/auth/`, recusa qualquer outro endereço e é a única WebView com a ponte `AndroidAuth`;
  - `AuthBridge` e `AuthController`: login, PIN, biometria, redefinição, aparelhos e handoff; a ponte só responde se a página carregada for a local;
  - `CentralApi`: chamadas do contrato por `HttpURLConnection`, com os cabeçalhos `x-instance-*` e `x-client`;
  - `SessionVault`: a sessão é cifrada com PBKDF2-SHA256 (150 mil iterações) do PIN e depois embrulhada por AES-GCM do Keystore;
    - a cópia biométrica guarda a chave do PIN numa chave do Keystore com `setUserAuthenticationRequired(true)` e `setInvalidatedByBiometricEnrollment(true)`;
    - o contador de tentativas é cifrado e conta antes de conferir o PIN; no 3º erro, apaga o PIN, a sessão e a digital;
  - `BiometricGate`: `BiometricPrompt` do sistema com `CryptoObject` e `BIOMETRIC_STRONG`;
  - `MainActivity`: barra de status transparente com o conteúdo por baixo (`SystemBars`), `FLAG_SECURE` enquanto as telas de entrada aparecem, bloqueio automático ao voltar ao app sem recarregar a WebView;
    - também faz o handoff `/#handoff=<code>`, o App Link `/redefinir-senha#t=` e a validação da sessão quando a internet volta;
  - `LocalSetup`: a tela antiga "Conecte este celular à instalação Windows" virou "Servidor local", aberta por toque longo no logo. Quem já tinha um servidor salvo continua no modo local.
- **URLs** vêm do `build.gradle` (`-PcentralApiBase`, `-PcentralWebBase`). O host do App Link também vem daí, por `manifestPlaceholders`.
- **Mock** `scripts/mock-central-auth.mjs`: implementa as seções 1 a 6 do contrato e serve as telas em `/auth/`. Coberto por `test/mobile-auth-mock.test.js`.
- `test/mobile-auth-android.test.js`: garantias estáticas, como a ponte só na WebView local, Keystore e PBKDF2, `FLAG_SECURE`, nenhum log, nenhuma URL fixa no Java, limite de 350 linhas e nenhum emoji.

## Como validei

- `npm test`: 200 de 200 passando, incluindo os 20 testes novos (`mobile-auth-*`) e o `v3-1-android-settings` existente.
- `npm run check`: sintaxe ok.
- Navegador com o mock e a ponte de desenvolvimento (`dev-bridge.js`, que não vai para o APK), em viewport de 375x812. Fluxos conferidos:
  - erro de validação e 401 no login;
  - criar PIN, com recusa de `123456`;
  - oferta de biometria, animação de sucesso e handoff: o mock mostrou "Entrou como Maria Clara Souza";
  - 3 PINs errados, que levam à tela [B2];
  - recuperar senha nos 4 passos, com o link lido do fragmento `#t=`;
  - tela Segurança.
- **Não validado:** este computador não tem JDK nem Android SDK. `./gradlew assembleDebug` não rodou e o Java não foi compilado. A biometria real, o Keystore e as barras do sistema só foram revisados no código. O primeiro build pode apontar erro de compilação.

## Roteiro de teste manual no aparelho

1. Rodar o mock no computador:

   ```bash
   node scripts/mock-central-auth.mjs
   ```

2. Gerar o APK de depuração apontando para o mock. No emulador o endereço é `10.0.2.2`; no aparelho, use o IP do computador:

   ```bash
   cd android && ./gradlew assembleDebug -PcentralApiBase=http://10.0.2.2:8787
   ```

3. Abrir o app. A barra de status deve estar transparente sobre o gradiente, sem faixa de cor.
4. Tocar em Entrar vazio: o cartão treme e aparece "Digite seu e-mail.". Com senha errada, aparece "E-mail ou senha incorretos.".
5. Entrar com `teste@rcconstrutec.com.br` / `Construtec@2026`. Aparece "Senha certa · agora crie seu PIN".
6. Tentar `123456` (é recusado). Criar `284615` e confirmar.
7. Ativar a biometria. O prompt do sistema aparece; depois do dedo, a animação vira o símbolo e o app abre em "Entrou como Maria Clara Souza".
8. Tirar um print numa tela de PIN: a imagem deve sair preta, por causa do `FLAG_SECURE`.
9. Em Menu, Segurança, escolher bloqueio "Na hora". Sair para a tela inicial e voltar: o PIN aparece por cima e, ao desbloquear, o app está na mesma tela.
10. Errar o PIN 3 vezes. Aparece [B2]; entrar por e-mail leva de volta a criar PIN.
11. Em Esqueci a senha, enviar. O terminal do mock mostra o link. Trocar `localhost` pelo endereço do mock e abri-lo no navegador do aparelho. Sem App Link, abre a página do mock.
12. Cadastrar uma digital nova no Android e voltar ao app. A digital deve ser recusada com o aviso para ativar de novo.
13. Tocar e segurar o logo no login: abre "Servidor local"; "Usar o login central da Construtec" volta.
14. Menu, Sair: volta ao PIN. Menu, "Sair e esquecer este aparelho", tocando duas vezes: volta ao login.

## Pendências

- Compatibilidade com o #28 final, conferida em 24/09: cada `consume` cria uma sessão central "Centro de Custos web", com duração de 8h. Por isso, depois de "Sair de todos os outros aparelhos", o app descarta a WebView do site e, em "Voltar ao app", reabre o site com um handoff novo. Essas sessões aparecem em "Aparelhos conectados".

- Compilar e rodar no aparelho (roteiro acima). Sem SDK aqui, esse é o primeiro passo.
- O botão de menu (44dp, canto superior direito) fica por cima do site. Conferir se não cobre algum botão do Centro de Custos web; se cobrir, mudar de lugar na Fase 2.
- O App Link só abre o app depois que o `assetlinks.json` tiver a impressão digital do certificado de assinatura (`ANDROID_CERT_SHA256`). Com a chave de debug, vale só para testes.
- "Esqueci a senha" some sozinho quando a rota ainda dá 404, com a mensagem "A recuperação de senha ainda não está disponível…". Não fiz sondagem ao abrir o app, para não gastar o limite de 10 pedidos por IP.
- A WebView remota continua com a barra navy e margem. O Centro de Custos web ainda não trata a área segura (Fase 2).

## Pedidos ao Codex

1. **`expiresAt` sempre em epoch segundos**, também em `/v1/auth/session` e `/v1/auth/handoff`. O app assume segundos.
2. **`code` obrigatório em todo erro**, inclusive no 401 do login. O app trata qualquer 401 do login como credencial inválida, mas usa o `code` nas outras rotas.
3. **Modo offline:** o app aceita o PIN sem internet até o `expiresAt` da sessão salva. Depois disso, pede e-mail e senha. Se o servidor quiser outro limite, é preciso avisar.
4. **Handoff:** o app abre `CENTRAL_WEB_BASE + "/#handoff=<code>"` e usa por padrão a mesma base da API, como no `resolveMobileAppUrl`. Se o `consume` devolver outro formato, o app não é afetado; só o `public/app.js` precisa entender.
5. **Rotas ausentes:** o app trata 404 como "ainda não disponível" em redefinição, sessões, `revoke-others` e handoff. Sem handoff, abre o site sem sessão e o login é feito na página.
6. **`/v1/auth/session`:** o app só chama essa rota para validar quando a internet volta depois de entrar offline. Se o caminho real for outro, é preciso documentar no contrato.

## Decisões confirmadas com o Lucas

- `minSdk` sobe de 26 para 28 (Android 9+), para usar o `BiometricPrompt` do sistema sem AndroidX.
- O login central vira o padrão. A tela "Conecte este celular à instalação Windows" passa a ser "Servidor local", aberta por toque longo no logo.
- Segurança é aberta por um botão nativo de menu sobre a WebView do app, com as opções Segurança, Sair e Sair e esquecer este aparelho.
