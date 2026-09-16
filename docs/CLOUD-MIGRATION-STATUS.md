# Migração da suíte para nuvem

Status: preparação parcial; publicação não realizada.
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
- Conta Cloudflare indicada acessível. Tela de Containers pede atualização
  para Workers Paid; nenhum plano foi comprado.

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

- Autorização para Workers Paid (US$ 5/mês base, uso excedente separado).
- Definir/provisionar PostgreSQL gerenciado e sua conexão segura.
- Confirmar destino/domínios antes da publicação dos novos serviços.

Fontes: https://developers.cloudflare.com/containers/platform/pricing/
e https://developers.cloudflare.com/containers/concepts/architecture/

## Atualização 2026-09-14

O Worker `centro-custos-api` foi publicado com sucesso em:
https://centro-custos-api.construtec-reports.workers.dev

Validação: `GET /health` retornou HTTP 200 e a raiz retornou HTTP 200. O
deploy inclui os assets PWA e o binding D1 `centro-custos-producao`.
Isso não conclui a publicação do Orçamentos e do Portal Hub; eles ainda
dependem da migração Node/PGlite para serviços compatíveis com a nuvem.

Interfaces publicadas nesta etapa:

- Orçamentos (Pages): https://4308101e.construtec-orcamentos.pages.dev
- Portal Hub: https://hub-sistemas-construtec.construtec-reports.workers.dev

O Hub aponta o Centro de Custos para a URL acima e mantém o Orçamentos como
local até que seu backend Node/PGlite seja migrado.

O backend do Orçamentos agora expõe apenas `GET /health` para diagnóstico;
suas rotas de dados continuam locais. O D1 remoto do Centro foi verificado e
contém o schema operacional, sem dados locais importados.
