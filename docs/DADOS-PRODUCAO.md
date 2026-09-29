# Mapa dos dados de produção do Centro de Custos

Verificado em 29/09/2026. Este mapa descreve a interface atual do Centro,
inclusive `/d/`. Não use o nome do projeto Neon para inferir qual aplicativo
usa a base.

| Fluxo | Serviço | Armazenamento |
| --- | --- | --- |
| Centros de custo, fornecedores, lançamentos e demais dados da interface atual | Container Express atrás de `centro-custos-api` | PostgreSQL `neondb`, branch `production`, projeto Neon `construtec-orcamentos`, via segredo `DATABASE_URL` do Worker |
| Contas corporativas e Cobranças em `/v1` | Rotas do Worker `centro-custos-api` | D1 `centro-custos-producao`, binding `DB` |

## Como a localização do PostgreSQL foi confirmada

- A base `neondb` contém as tabelas `cost_centers`, `suppliers` e
  `transactions`.
- O `app_settings.instance_id` dessa base corresponde ao `instancia.id`
  devolvido por `GET /api/health/ready` do Centro em produção.
- O Container exige `DATABASE_URL` antes de encaminhar as rotas da interface
  atual; o binding D1 é usado nas rotas `/v1`.

Não copiar a conexão nem qualquer senha para este documento. A URL do
PostgreSQL fica no segredo do Worker; a conexão de leitura para o dump fica
no segredo `CENTRO_BACKUP_DATABASE_URL` do repositório GitHub.

## Recuperação

- PostgreSQL: workflow `Backup PostgreSQL (nuvem)` gera dump criptografado e
  artifact de 30 dias. A frase `BACKUP_PASSPHRASE` deve permanecer recuperável
  fora do GitHub. Um branch Neon criado antes de uma publicação serve como
  ponto de retorno daquela publicação, mas não substitui o dump diário.
- D1: use o Time Travel do banco `centro-custos-producao` para incidentes nas
  rotas `/v1`. O dump PostgreSQL não contém esses dados.

Procedimentos detalhados: [Backup e restauração na nuvem](BACKUP-NUVEM.md).
Qualquer separação ou renomeação do projeto Neon exige verificar antes a
conexão efetiva do Worker do Orçamentos e planejar a migração das duas APIs.
