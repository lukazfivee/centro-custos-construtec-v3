# Migração da suíte para nuvem

Status: Centro de Custos e Orçamentos publicados em Cloudflare Containers.
Responsável: LEAD-CODEX. Escopo: Centro de Custos, Orçamentos e Portal Hub.

## Evidências verificadas

- `npm run suite:prepare` concluiu: frontend do Orçamentos em
  `modules/orcamentos` e API Node em `modules/orcamentos-api/index.cjs`.
- O servidor do Centro já monta `/orcamentos/` e `/orcamentos-api`.
- Centro aceita PostgreSQL remoto via DATABASE_URL; Orçamentos ainda usa
  PGlite com NodeFS e operações de backup específicas de disco local.
- A versão `cloudflare-sync-worker` é outra aplicação (PWA e API `/v1`),
  não o servidor completo da interface atual. Não substituir seus assets
  pelos arquivos locais sem implementar a compatibilidade das APIs.
- Portal Hub publicado ainda aponta os dois módulos para localhost.
- Conta Cloudflare indicada acessível. O plano Workers Paid está ativo: ambos
  os serviços de interface rodam como Containers.

## Caminho proposto, pendente de escolha de infraestrutura

Manter APIs Node em Cloudflare Containers e usar PostgreSQL gerenciado
persistente, com bancos separados por aplicação. Servir as interfaces atuais
e encaminhar as rotas do Hub para os serviços na nuvem. Não usar o disco
efêmero de Containers como armazenamento financeiro definitivo.

Antes da publicação: adaptar acesso PostgreSQL do Orçamentos e backup,
configurar origem HTTPS permitida e segredo de sessão estável, retirar URLs
localhost dos fluxos web, proteger primeiro cadastro administrativo, testar
autenticação, permissões, integração, reinicialização e persistência.
Migração de dados exige backup e validação; nenhum banco local foi enviado.

## Dependências externas
- Workers Paid ativo (US$ 5/mês base, uso excedente separado).
- PostgreSQL gerenciado (Neon) provisionado e conectado via `DATABASE_URL`.
- Definir se o Portal Hub passa a apontar para os Workers publicados.

Fontes: https://developers.cloudflare.com/containers/platform/pricing/
e https://developers.cloudflare.com/containers/concepts/architecture/

## Pipelines de publicação
Ambos os serviços são Cloudflare Containers publicados com `wrangler deploy`
a partir desta máquina. Nenhum dos dois é publicado por GitHub Actions — o
workflow `deploy-iphone-cloud.yml` publica o `cloudflare-sync-worker` (a PWA
legada de 7 arquivos), que é outra aplicação e não serve a interface atual.

| Serviço | Pasta de configuração | Dockerfile |
| --- | --- | --- |
| Centro de Custos | `cloudflare/center-container` | `../../Dockerfile` |
| Orçamentos | `Construtec orçamentos/construtec-orcamentos/cloudflare/api-container` | `../../Dockerfile` |

Requisito de ambiente: Docker Desktop em execução e o diretório
`resources/bin` do Docker no PATH. Sem isso o `wrangler` aborta com
`Docker CLI is needed to build the configured image`.

Scripts, a partir da raiz de cada projeto:

- `npm run deploy:cloud` valida e publica o serviço de interface.
- `npm run deploy:cloud:dry` apenas valida, sem publicar.

O Centro de Custos serve o `public/` desta raiz dentro do Container
(`COPY public ./public` no Dockerfile). O Orçamentos serve o `dist/` gerado
pelo Vite, e o `deploy` **não** roda o build: executar `npx vite build` antes,
sob risco de publicar HTML novo apontando para um hash de JS inexistente.

O Container mantém a instância viva por `sleepAfter` (10 minutos). Após um
deploy, a interface pode continuar servindo o conteúdo anterior por cerca de
um minuto, até a instância hibernar e reiniciar com a imagem nova.

### Segredos exigidos
Centro de Custos: `DATABASE_URL`, `SESSION_SECRET`, `JWT_SECRET`,
`ADMIN_INITIAL_*`, `CONSTRUTEC_ALLOWED_ORIGINS`, `SYNC_SHARED_KEY`,
`REPORT_API_URL`, `RESEND_API_KEY`, `MOBILE_APP_URL`.

Orçamentos: `DATABASE_URL`, `SESSION_SECRET`, `CONSTRUTEC_SETUP_TOKEN`,
`CONSTRUTEC_ALLOWED_ORIGINS`, `ADMIN_INITIAL_*`.

Os valores vivem apenas no Worker (`wrangler secret put`), nunca no frontend
nem no repositório.

## Atualização 2026-09-14

O Worker `centro-custos-api` foi publicado com sucesso em:
https://centro-custos-api.construtec-reports.workers.dev

Validação histórica desta etapa: `GET /health` retornou HTTP 200 e a raiz
retornou HTTP 200. Este deploy inicial usava assets PWA e o binding D1
`centro-custos-producao`; essa configuração foi substituída pela arquitetura
de Container descrita em `Pipelines de publicação`.

Interfaces publicadas nesta etapa:

- Orçamentos (Worker): https://construtec-orcamentos-cloud.construtec-reports.workers.dev
- Portal Hub: https://hub-sistemas-construtec.construtec-reports.workers.dev
O endereço anterior em Pages (https://4308101e.construtec-orcamentos.pages.dev)
foi descontinuado. A Suíte do Centro de Custos, local e em nuvem, aponta para a
URL do Worker acima.

O Hub aponta o Centro de Custos para a URL acima e mantém o Orçamentos como
local até que seu backend Node/PGlite seja migrado.

O backend do Orçamentos agora expõe apenas `GET /health` para diagnóstico;
suas rotas de dados continuam locais. O D1 remoto do Centro foi verificado e
contém o schema operacional, sem dados locais importados.

## Atualização 2026-09-17
Publicação dos dois serviços de interface em Cloudflare Containers, com
PostgreSQL gerenciado. Verificações feitas sobre as respostas de produção:

- Centro de Custos (`centro-custos-api`): o link da Suíte e o
  `iframe#orcamentos-frame` apontam para
  `https://construtec-orcamentos-cloud.construtec-reports.workers.dev/`.
  A URL `construtec-orcamentos.pages.dev` não aparece mais na página.
- Orçamentos (`construtec-orcamentos-cloud`): o bundle servido contém
  `CHAMADOPRO_URL = https://chamadopro-app.lucas-coelho5923.workers.dev/` e
  não contém mais a classe `disabled-system`. O item **Chamados & O.S.** da
  Suíte está ativo, em vez de exibir o estado `Em breve`.
- `public/budget-view.js` aceita envelopes de integração vindos das origens
  do Worker e do Pages, além de localhost. A lista é fechada e nomeada
  (`ORCAMENTOS_TRUSTED_ORIGINS`); não usar curinga `*.workers.dev`, que
  permitiria a qualquer Worker de terceiros injetar um envelope financeiro.
