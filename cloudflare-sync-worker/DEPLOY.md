# V3.1 Multiusuário - Cloudflare Sync

Arquitetura:

- aplicativo Windows mantém PGlite local para continuar funcionando offline;
- Worker `centro-custos-api` recebe e distribui alterações;
- D1 `centro-custos-producao` guarda a base compartilhada;
- somente usuários autenticados localmente com e-mail `@rcconstrutec.com.br` participam da sincronização;
- sincronização automática a cada 30 segundos, ao voltar a internet e ao retornar para a janela.

## 1. Banco D1

Crie um banco D1 chamado:

`centro-custos-producao`

No Console do D1, execute o conteúdo de `schema.sql`.

## 2. Worker

Crie um Worker chamado:

`centro-custos-api`

Cole `src/index.js` como código do Worker.

Adicione o binding D1:

- variável: `DB`
- banco: `centro-custos-producao`

## 3. Segredo

Crie um segredo forte no Worker:

`SYNC_SHARED_KEY`

Use uma sequência aleatória longa. Nunca publique essa chave no GitHub.

## 4. Teste do Worker

Abra:

`https://SEU-WORKER.workers.dev/health`

Resposta esperada:

`{"ok":true,"service":"centro-custos-sync","mode":"cloudflare-d1"}`

## 5. Configurar cada instalação

No `desktop.env` de cada instalação, inclua:

`SYNC_API_URL=https://SEU-WORKER.workers.dev`

`SYNC_SHARED_KEY=O_MESMO_SEGREDO_DO_WORKER`

O arquivo fica dentro da pasta privada da V3 em AppData. A chave não deve ser colocada no instalador público.

## 6. Contas corporativas

Crie usuários normalmente no aplicativo usando e-mails como:

- `lucas@rcconstrutec.com.br`
- `financeiro@rcconstrutec.com.br`
- `diretoria@rcconstrutec.com.br`

Usuários com outros domínios continuam podendo trabalhar localmente, mas não enviam nem recebem dados compartilhados.

## 7. Funcionamento offline

Sem internet, cada PC continua operando em sua base local.

Quando a internet voltar, o aplicativo envia seu pacote local e recebe o snapshot compartilhado. Registros são comparados por `public_id`, `revision` e `updatedAt`. Quando duas instalações alteram a mesma revisão, o Worker cria uma nova revisão para a versão mais recente e a distribui aos demais computadores.

## Segurança

A V3.1 usa duas barreiras para o endpoint central: conta corporativa e `SYNC_SHARED_KEY`. Isso é adequado para o uso interno inicial, mas não substitui uma autenticação corporativa central completa. Como aplicações Electron podem ser inspecionadas por alguém com acesso ao computador, uma etapa futura poderá trocar a chave compartilhada por autenticação central com tokens curtos por usuário.
