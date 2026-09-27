# Status: Claude Code (app Android)

Fase atual: 5 (primeiro uso e cadastro), publicada em 27/09/2026 (RC19) · PR #47. Antes: Fase 4 (#45, RC18), passo 4 da Fase 3 (#41; Orçamentos #94), Fase 3 (#37, #38, #39; Orçamentos #90, #92, #93)

## Última atualização

- Data e hora (BRT): 27/09/2026 15:00
- Fase 5 feita pelo Claude Code, com migração D1, merge e deploy autorizados pelo Lucas.

## iPhone pelo site do celular (27/09/2026)

Pedido do Lucas: usar no iPhone sem app de loja (opção "rápida": /m/ como app da tela de início).
- `public/m/manifest.webmanifest` (escopo `/m/`, standalone), ícones `icon-180/192/512.png` (símbolo sobre navy), metas `apple-mobile-web-app-*` e `apple-touch-icon` no `index.html`.
- `public/m/screen-entrar.js`: tela de entrar própria (`/api/auth/login`), "Esqueci minha senha" (`/v1/auth/password-reset/request`) e dica "Adicionar à Tela de Início" só no Safari do iPhone. No iPhone o app da tela de início **não divide** o login com o Safari, por isso o /m/ precisa entrar sozinho.
- `app.js`: fora do app Android, sessão vencida ou ausente abre essa tela; no app continua `suite://entrar`. Sair no navegador volta para `/m/`.
- sw.js `cc-celular-v8`. Teste novo `test/mobile-web-iphone.test.js`; `npm run verify` 275/275; testado no navegador em 375x812 (login errado, login certo, sair, dica no iPhone, tema claro e escuro).
- Fica de fora (só no app Android): PIN/digital, cadastro, tour, push e Orçamentos na mesma tela.

## Fase 5 (27/09/2026): cadastro, convites, tour e tela de carregamento

Decisões do Lucas:
- cadastro no app com nome, e-mail, celular, código da empresa e senha forte, mais aceite;
- o pedido fica pendente e os admins aprovam, escolhendo o perfil (padrão Supervisor);
- convite por e-mail sai com a conta aprovada;
- aprovação no celular e no Centro web;
- código da empresa gerado pelo sistema, e o admin pode trocar;
- tour de 4 telas só para conta nova;
- tela de carregamento: a primeira versão (disciplinas em círculo) **não agradou**; ficou a versão "mais limpa e sóbria".

- **Worker:**
  - migração D1 `011-cadastro.sql` (aplicada em produção em 27/09);
  - `signup.js`: `POST /v1/signup/request` público, limitado a 10 por IP a cada 15 min; rotas de admin `/v1/signup/*`; rota interna `/v1/internal/signup` com `x-sync-key`;
  - aviso `pedido_acesso` só para admins;
  - e-mails pelo Resend: aprovado, recusado e convite;
  - `tour` no primeiro login (`tour_pending`), página `/cadastro` e `ANDROID_CERT_SHA256` nas vars;
  - aprovar e recusar só alteram pedido ainda pendente.
- **Centro:**
  - `/api/cadastros`; sem conta central, a lista responde `disponivel:false`, para não gerar erro no console da tela de Usuários;
  - no /m/: Menu › Pedidos de acesso (admin), aberto também pelo aviso `pedidos=1`;
  - no web: painel na tela de Usuários (`public/users-signups.js`).
- **App (RC19):**
  - `screen-signup.js`: formulário, "Pedido enviado" e "Conta criada";
  - App Link `/cadastro#convite=`;
  - `screen-tour.js`: 4 telas antes de abrir o app, revistas pelo Menu nativo ou pelo /m/ (`suite://tour`);
  - `assets/loading/index.html` sóbrio.
- **Validação:**
  - `npm run verify` 263 de 263; CI do PR, incluindo `assembleDebug` e `lintDebug`, passou;
  - navegador com Worker falso e mock: cadastro com código, convite, login, PIN, tour, e pedidos no /m/ e no web;
  - produção depois do deploy: `/cadastro` 200, `assetlinks.json` com a chave fixa, validação do cadastro e rotas de admin com 401 sem sessão.
- **Falta verificar no aparelho:**
  - cadastro real, com e-mail do Resend;
  - link do convite abrindo o app (App Link verificado);
  - tour;
  - tela de carregamento nova.

## Fase 4 (27/09/2026): notificações

Decisões do Lucas: os quatro avisos (proposta aprovada, item acima do orçado, conta a vencer, novo acesso); os avisos das obras vão para todos com acesso ao Centro, e o de novo acesso só para o dono da conta; tudo ligado, cada pessoa desliga nas preferências; push pelo Firebase (projeto `suite-construtec`, plano gratuito); até a produção (RC18).

- **Firebase:** o Lucas criou o projeto e gerou a chave da conta de serviço. A chave foi gravada por ele, com um `.bat`, como segredo `FCM_SERVICE_ACCOUNT` do Worker; o arquivo foi apagado de Downloads e não foi lido. O `android/app/google-services.json` (não é segredo) está no repositório.
- **Worker (#45):** migração D1 `010-notificacoes.sql` (aplicada em produção antes do deploy): `push_devices`, `known_devices`, `notifications` (com `dedupe_key` único por pessoa) e `notification_prefs`.
  - `notifications.js`: registro do aparelho, central, marcar como lidas, preferências, teste e as rotas internas para o Container (`x-sync-key`).
  - `fcm.js`: API HTTP v1 do FCM, com JWT RS256 por WebCrypto. Tokens que o Firebase recusa são apagados.
  - Novo acesso: no login, um aparelho novo numa conta que já tinha outro avisa o dono. "Sair" desliga o push do aparelho.
  - Cron `0 11 * * *` (08:00 de Brasília) pede os avisos diários ao Container. `/api/interno/*` é bloqueado ao público.
- **Centro:** aviso de proposta aprovada depois da importação; `services/dailyNotices.js` calcula as contas a pagar que vencem hoje ou amanhã (um aviso por dia) e os itens acima do orçado (um aviso por item, até 20 por dia); `/api/notificacoes` serve a central do site do celular pela conta central (`users.cloud_user_id`).
- **Site do celular:** sino com contador no cabeçalho (também na obra), central `screen-avisos.js` com Hoje/Ontem/Anteriores, filtro por app (Centro de Custos, Orçamentos, Conta), marcar como lidas, preferências e "Enviar notificação de teste". Cache do service worker em `cc-celular-v3`.
- **App:** `SuitePush` (Firebase Messaging): permissão no Android 13+ na primeira entrada, registro do token a cada entrada, aviso próprio com o app aberto e toque abrindo o destino validado (`SuiteViews.parse`). A validação do servidor local foi para o `LocalSetup` para abrir espaço no `MainActivity`. `android.useAndroidX=true` (o Firebase traz AndroidX). RC18.
- **Validação:** testes novos `notifications-worker` (4, com o Google simulado), `notificacoes-container` (5, com o Worker simulado) e `notifications-android` (2). `npm run verify` 255 de 256 com o PC carregado (a falha era o `database-lock`, que passa sozinho). Central conferida no navegador em 375x812 nos dois temas. Emulador com o APK do mock: o app pediu a permissão e registrou um token real do Firebase; o toque simulado abriu a proposta e a obra certas.
- **Produção:** Worker `c93c4c36`; rotas novas respondem 401 sem sessão e 403 sem a chave interna.
- **Falta:**
  - conferir o push de verdade no A17: instalar a RC18 (instala por cima), entrar, permitir as notificações e tocar em Notificações › "Enviar notificação de teste";
  - o primeiro aviso diário sai às 08:00 de 28/09;
  - o sino ainda não existe no Orçamentos (os avisos das propostas chegam pelo Centro).

## Passo 4 (27/09/2026): seletor Suíte, Ir direto para e comparativo no celular

Decisões do Lucas: a folha mostra Orçamentos, Centro de Custos e ChamadoPro (este no navegador), segue o tema do site; "Ir direto para" nos dois sentidos; comparativo como folha em tela cheia com cartões; tudo até a produção (RC17).

- **Centro (#41):**
  - site do celular: pílula "Suíte" no cabeçalho (também na obra) e folha "Esteira Operacional Construtec" (`public/m/suite.js`); saiu o item "Orçamentos" do Menu;
  - `/api/centros-custo/:id/detalhes` traz `proposta_origem` (`id`, `numero`, `revisao` da baseline vigente do contrato ativo; `services/budgets/proposalOrigin.js`). Na obra, a folha mostra "Proposta de origem · PA-xxxx";
  - link direto `#obra=<id>` na abertura (também junto do `#handoff=`) e por `hashchange`; cache do service worker em `cc-celular-v2`.
- **Orçamentos (#94):** folha no celular em portal no `body` (dentro da topbar ficava atrás do conteúdo), "Obra gerada desta proposta" (`proposal.costCenterId`), link direto `#proposta=<id>` (na carga e por `hashchange`; o `AuthGate` preserva o destino junto do `#handoff=`), comparativo de revisões em cartões e tela cheia. Saiu o item temporário do menu.
- **App (#41):** `suite://app/<id>?proposta=<uuid>` ou `?obra=<n>`, validados em `SuiteViews.parse`. Na primeira abertura, o destino vai junto do handoff; com a WebView aberta, o app troca só o fragmento (`location.hash`). RC17 (`versionCode 31017`).
- **Validação:** testes do Centro (móveis, versão e `budget-import.integration` com `proposta_origem`) e `npm run verify` do Orçamentos (38 de 39). Navegador em 375x812: folha do `/m/` nos dois temas com obra importada da fixture, folha e comparativo do Orçamentos com o servidor local isolado (`APPDATA` temporário) e o mock como diretório central, e troca de revisão pelo fragmento. Emulador com o APK do mock: ida direta nos dois sentidos, com a WebView nova e com a já aberta (sem recarregar), e destino inválido ignorado.
- **Produção:** Centro `206ba993`, Orçamentos `c6b3f62d`, pré-lançamento v3.1.0-rc.17.
- **A17:** a RC16 foi instalada por cima do app antigo (APK da CI reassinado com a chave de debug deste PC, a mesma do app no aparelho), mantendo PIN e digital. A RC17 ficou reassinada e pronta, mas o aparelho foi desconectado antes da instalação.
- **Falta:** o cartão "Obra gerada desta proposta" só aparece quando a proposta já foi enviada ao Centro (`costCenterId` vem do último envio entregue da revisão).

## Fase 3 (27/09/2026): Orçamentos dentro do app

Decisões do Lucas: revisar e publicar antes o #90 do Orçamentos (identidade compartilhada); §6 do contrato com o alvo `orcamentos`; seletor "Suíte" dentro de cada site (passo 4); até lá, troca por item de menu; comparativo de revisões e `#proposta=` ficam para o passo 4; produção do app = pré-lançamento RC16 no GitHub; A17 fica para depois.

- **Orçamentos #90 (identidade compartilhada):** revisado antes do merge. Corrigidos o typecheck da CI, o admin rebaixado no Centro que continuava admin (migração `013`: `centro_admin`, `local_role`) e a troca de e-mail que travava o login. Publicado.
- **Queda do login do Orçamentos (01:45 a 02:26 BRT):** o segredo `CONSTRUTEC_IDENTITY_KEY` do Orçamentos estava com BOM (U+FEFF) e o `fetch` recusava o cabeçalho. A chave agora é normalizada nos dois lados (Orçamentos #92, Centro #39), e as chamadas do Container ao Centro passam pelo service binding `CENTRO`. Não dava para voltar a versão: a migração 012 já tinha desativado as contas locais.
- **Servidor central (#37):** `POST /v1/auth/handoff` aceita `target: "orcamentos"`; migração D1 `009` (`session_handoffs.target`) aplicada em produção antes do deploy. O `consume` do Orçamentos exige `X-Construtec-Identity-Key` e devolve uma sessão central "Orçamentos web", filha da sessão do app. Contrato §6 atualizado.
- **Orçamentos (#93):** `POST /api/auth/handoff`, leitura do `#handoff=`, entrada e saída pelo app (`suite://entrar`, `suite://sair`), "Trocar para o Centro de Custos" no menu mobile (só no app) e `viewport-fit=cover`.
- **App (#38):** `SuiteViews.java` guarda uma WebView por app; a outra fica escondida sem recarregar. `suite://app/<id>` troca de app; "Orçamentos" no Menu do site do celular (só no app). `ORC_WEB_BASE` vem do Gradle (`-PorcWebBase`). RC16 (`versionCode 31016`).
- **CI:** job `android` (assembleDebug e lintDebug) com dois APKs de artefato: o de produção e o do mock (`-PcentralApiBase=http://10.0.2.2:8787 -PorcWebBase=http://10.0.2.2:8787/orc`). O mock ganhou a página `/orc/` e confere o destino do código.
- **Validação:** `npm run verify` 244/244 no Centro e 37/38 no Orçamentos (PostgreSQL real pulado). Emulador (AVD novo `Suite_Teste_API35`, sem trava de tela) com o APK do mock: handoff dos dois destinos, troca nos dois sentidos sem recarregar (anotação preservada) e `suite://sair` destruindo as duas WebViews. Produção: login do Orçamentos com senha errada responde 401; `consume` sem chave 403, destino inválido 400.
- **Produção (27/09):** Centro `centro-custos-api` versão `12ab2b17`; Orçamentos `construtec-orcamentos-cloud` versão `67361ddc`; pré-lançamento [v3.1.0-rc.16](https://github.com/lukazfivee/centro-custos-construtec-v3/releases/tag/v3.1.0-rc.16) com o APK Android e os instaladores Windows.
- **Falta:**
  - instalar a RC16 no Galaxy A17. O APK da CI é assinado com outra chave: é preciso desinstalar o app atual (perde PIN e digital) antes;
  - a chave de assinatura de debug da CI muda a cada execução, então uma RC não instala por cima da outra. Vale criar uma chave fixa como segredo do GitHub;
  - backup diário do Neon do Orçamentos falha desde pelo menos 24/09: faltam os segredos `ORCAMENTOS_BACKUP_DATABASE_URL` e `BACKUP_PASSPHRASE` no GitHub do Orçamentos;
  - conferir se o `CONSTRUTEC_INTEGRATION_KEY` do Orçamentos também tem BOM (a sincronização de propostas usaria o mesmo cabeçalho);

## Assistente de IA no celular (27/09/2026)

Decisões do Lucas: Firebase AI Logic com a Gemini Developer API (plano gratuito, aceita que o Google pode usar os dados); assistente no /m/ lendo Centro e propostas do Orçamentos; "reporte" = Reportar bug/falha.

- `public/m/ia-config.js` (app web "Suíte celular" do projeto `suite-construtec`, modelos `gemini-3.8-flash` e reserva `gemini-3.5-flash-lite`, instruções), `ia-tools.js` (10 ferramentas com a sessão de quem pergunta), `ia-chat.js` (folha de conversa; SDK 12.19.0 do gstatic só ao abrir; relato só envia pelo botão).
- Estrela no cabeçalho (`ia-btn`) e Menu › Assistente / Reportar problema. Cache do sw `cc-celular-v6`.
- `/api/assistente/orcamentos/propostas[/:id]`: handoff `target:orcamentos` pelo Worker e troca no servidor do Orçamentos (sem CORS); sessão guardada 20 min.
- 429 e 500/503 ("high demand") passam para o modelo reserva.
- Testado com Gemini real no servidor local. Pendente: App Check e voz.

## Fase 2 (26/09/2026)

Decisões do Lucas:
- foto da nota + campos digitados (sem leitura automática);
- categoria atual (não item do orçamento);
- Claude faz servidor e celular, porque o plugin do Codex não grava no repositório;
- sino escondido até a Fase 4.

- **Servidor (PR #33):**
  - `client_id` no `POST /api/lancamentos`: reenvio igual devolve 200 sem duplicar, dados diferentes dão 409. Migração `106` só aditiva.
  - O reenvio completa a auditoria e a alocação que faltaram.
  - Achado: `rowCount` de `SELECT` vem 0 no PGlite. A checagem de alocação existente contava errado e passou a contar linhas.
  - Contrato em `05-CONTRATO-FASE2.md`.
- **Site do celular em `public/m/`** (rota `/m/` no `server.js`), com arquivos de até 146 linhas:
  - Início: pendências do dia e resumo do mês;
  - Obras: lista com % gasto e detalhe (Resumo, Lançamentos, Caixa);
  - Nova despesa: foto pela câmera ou galeria, reduzida a JPEG de 1600 px, e campos digitados;
  - confirmação com a animação do login;
  - Lançamentos, com os itens do celular e os recusados ("Tentar de novo" e "Descartar");
  - Menu: tema, Segurança, versão completa e Sair.
- **Offline:**
  - faixa "Sem internet · N na fila" e "Enviando…";
  - fila no IndexedDB, separada por conta, com envio automático quando a internet volta ou a cada 30 s;
  - última resposta de cada tela guardada no celular;
  - service worker para abrir o site sem rede.
- **App Android:**
  - abre `/m/#handoff=`;
  - identifica-se com `SuiteConstrutec/<versão>` no user agent;
  - trata `suite://seguranca`, `suite://sair` e `suite://entrar`;
  - o botão de menu flutuante saiu, como decidido na Fase 1.
- **Revisão do Codex (plugin, `gpt-5.6-sol`):** 4 apontamentos, todos corrigidos:
  - fila e cache agora separados por conta;
  - falha ao gravar no celular deixou de ser silenciosa;
  - pós-processamento no reenvio;
  - estado `concluido`.
- **Segunda revisão do Codex:** 3 apontamentos, todos corrigidos:
  - "Sair" conta também os lançamentos recusados no aviso, e o app não apaga mais o armazenamento do site ao sair; só "esquecer o aparelho" apaga;
  - a atualização depois de enviar a fila mantém a obra aberta;
  - tela antiga que termina de carregar depois de trocar de aba é descartada (número de navegação).
- **Validação:**
  - `npm test` 242 de 242, `npm run check` ok;
  - `assembleDebug` e `lintDebug` com 0 erros;
  - navegador em 375x812 contra o servidor local: login da sessão, Início, Obras, detalhe, despesa online, despesa offline com foto, volta da internet enviando a fila, queda no meio sem duplicar, item recusado, tema claro e Menu.
- **Falta verificar:**
  - o service worker. O navegador interno do app recusa registrar service workers até em `localhost`; a verificação fica para o celular, em HTTPS, depois do deploy.
  - Achado fora do escopo: o servidor marca "vencida" pela data UTC (`CURRENT_DATE`). Depois das 21h de Brasília, uma conta que vence hoje já aparece vencida.

- **Publicação (26/09/2026, autorizada pelo Lucas):**
  - PR #34 no `main` (`2d51b8e`); o #33, substituído, foi fechado.
  - Deploy do `centro-custos-api`, versão `4ab62eba-328c-465a-bace-dddd1f10d730`. O Container assumiu a imagem nova em cerca de 1 min.
  - Verificado em produção:
    - `/m/` serve o site do celular e `/m` redireciona (301) para `/m/`;
    - `sw.js` sai como `application/javascript`;
    - `/api/lancamentos` sem token responde 401.
  - A migração 106 roda na inicialização do Container. O banco de produção não foi consultado diretamente; a confirmação vem no primeiro lançamento feito pelo celular.
- **Pendente (adiado pelo Lucas):** instalar o APK novo no celular, que abre `/m/`, e verificar lá a câmera, o service worker e o modo sem internet.

## Feito (Fase 1)

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
- **Build Android (26/09/2026):**
  - `gradle -p android assembleDebug` com JDK 17 (Temurin) e Gradle 8.9, as mesmas versões da CI: **BUILD SUCCESSFUL**, APK de 254 KB.
  - `lintDebug`: 0 erros depois de tipar `attachBridge(AuthBridge)`; antes, o lint não enxergava o `@JavascriptInterface` num parâmetro `Object`. Nenhum uso de API incompatível com o `minSdk 28`.
  - Os 15 avisos restantes são esperados: `commit()` proposital no cofre (o contador precisa ser gravado na hora), textos fixos em pt-BR e avisos que já existiam no app antigo.
  - O APK contém `assets/auth/*`, e o `dev-bridge.js` ficou de fora, como planejado.
- **Teste no aparelho (26/09/2026):** Samsung Galaxy A17 (SM-A175F), Android 16, contra o Worker de produção.
  - O APK antigo (rc.11, assinado pela CI) foi desinstalado com autorização do Lucas; o novo não instala por cima por causa da assinatura diferente.
  - Login de vidro com a barra de status transparente e margem real de 36px, lida pelo app.
  - A tela de entrada sai preta nos prints (`FLAG_SECURE`).
  - Login com `pcm@`, criação do PIN, ativação da digital e animação do símbolo.
  - Handoff: o Centro de Custos web abriu logado, sem pedir senha (`cc_token`, usuário `pcm`, fragmento limpo).
  - Cofre: `pin_iter` 150000, e `pin_blob`, `bio_blob`, `profile` e `attempts` cifrados.
  - O bloqueio "Na hora" pediu a digital ao voltar ao app.
- **Emulador (26/09/2026):** Pixel 7, Android 15, com digital simulada, contra o mock (`-PcentralApiBase=http://10.0.2.2:8787`). Todos os itens abaixo passaram:
  - login com senha errada ("E-mail ou senha incorretos.") e depois certa;
  - `123456` recusado, criação do PIN e oferta de biometria;
  - `BiometricPrompt` do sistema ("Ativar a digital") com `CryptoObject`, animação "Reconhecido" e handoff ("Entrou como Maria Clara Souza");
  - bloqueio "Na hora": o PIN e a digital aparecem por cima e o site **não recarrega** (a marca posta na página continuou lá);
  - 3 PINs errados, com as mensagens na ordem certa e a tela [B2]; o cofre apaga o PIN, a sessão e a digital;
  - entrada de novo por e-mail, com PIN novo;
  - Sair volta ao PIN e descarta o site; Sair e esquecer, com dupla confirmação, volta ao login com o cofre vazio;
  - Esqueci a senha abre "Confira seu e-mail", com reenvio em 60s, e o mock recebe o pedido.
- **Correções saídas desse teste:**
  - depois de "Sair e esquecer", as telas são recarregadas do zero; antes, o último e-mail ficava na memória da página;
  - as margens da barra de status são reaplicadas a cada carregamento da página local;
  - o mock passa a ler `x-instance-name` como UTF-8. O Worker de produção já gravava certo: "Android · Samsung SM-A175F".
- `npm test`: 215 de 215. Com o emulador ligado, o `test/database-lock.test.js` (de fora deste PR) falha por tempo: o `tasklist.exe` leva 1,4 s, perto do limite de 2 s do `db.js`. Sem o emulador, passa.

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
- **Confirmado no aparelho:** o botão de menu (44dp, canto superior direito) cobre o botão redondo do cabeçalho do site. Decisão do Lucas: resolver na Fase 2, levando "Segurança" para o Menu do site e retirando o botão flutuante.
- O App Link só abre o app depois que o `assetlinks.json` tiver a impressão digital do certificado de assinatura (`ANDROID_CERT_SHA256`). Com a chave de debug, vale só para testes.
- "Esqueci a senha" some sozinho quando a rota ainda dá 404, com a mensagem "A recuperação de senha ainda não está disponível…". Não fiz sondagem ao abrir o app, para não gastar o limite de 10 pedidos por IP.
- A WebView remota continua com a barra navy e margem. O Centro de Custos web ainda não trata a área segura (Fase 2).

- **Logout no servidor (26/09):** "Sair" e "Sair e esquecer" chamam `POST /v1/auth/logout` depois da saída local, sem travar a tela e ignorando falta de rede.
  - Com o #31 publicado, isso encerra também a sessão web criada pelo handoff.
  - Antes do #31, a rota antiga já apaga a sessão do app.
- **Produção (26/09):** #30 e #31 no `main`.
  - Migração `008-sessao-web-vinculada.sql` aplicada no D1: coluna e índice criados, as 5 sessões existentes intactas.
  - Deploy do `centro-custos-api`, versão `f0e6ee8c-41ae-4163-b987-0a53738509d5`.
  - Verificado: `POST /v1/auth/logout` sem token devolve 200 `{ ok: true, revoked: 0 }`; as demais rotas não mudaram.
  - A CI do `main` agora tem os jobs `test` (Node 20) e `test-node24`.

- **Barra Liquid Glass no WebView (27/09, branch `codex/mobile-liquid-glass-nav`):**
  - Emulador Pixel 7, Android 15, WebView 124, GPU do PC (`-gpu host`), dentro do próprio app em modo "Servidor local".
  - Página de teste com 120 cartões, rolagem automática de 6 s. Comparadas: barra atual, barra sem a distorção SVG e distorção desligada só durante a rolagem.
  - Com o emulador aquecido, as três ficam entre 57 e 59 fps, com diferença dentro do ruído. Desligar a distorção durante a rolagem não ajudou, então não entrou no código.
  - Visual conferido nos dois temas: o vidro, a lente e a refração aparecem certos.
  - Fallback sem `backdrop-filter` trocado de cor sólida para `rgba(…, .86)`.
  - Falta medir no Galaxy A17, porque a GPU do emulador não representa um celular intermediário.
- **Melhorar a tela de carregamento (pedido do Lucas, 27/09):** hoje, enquanto a página do site carrega, o app mostra só um `ProgressBar` nativo girando sobre fundo branco (`AppWebView.java`, linha 33), entre a barra de status navy e a barra de navegação. Destoa das telas de entrada de vidro. Ainda sem proposta de desenho.

- **Celular da Fase 1 (resolvido em 26/09):** APK final instalado no perfil principal, com cofre, PIN e digital intactos. A cópia do Dual App foi removida (`pm uninstall --user 95`) e ficou `installed=false`.

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
