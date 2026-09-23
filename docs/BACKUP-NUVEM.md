# Backup e restauração na nuvem

Vale para os dois serviços publicados em Cloudflare Containers: Centro de
Custos (`centro-custos-api`) e Construtec Orçamentos
(`construtec-orcamentos-cloud`). O disco do Container é efêmero; nenhum
backup fica nele. Os botões de backup por arquivo dos apps só funcionam no
desktop (PGlite). Na nuvem, as rotas respondem 501.

## Camadas

| Dado | Onde vive | Proteção |
| --- | --- | --- |
| Financeiro do Centro | Neon (PostgreSQL), `DATABASE_URL` do Worker `centro-custos-api` | Restauração do Neon + dump diário |
| Dados do Orçamentos | Neon (PostgreSQL), `DATABASE_URL` do Worker `construtec-orcamentos-cloud` | Restauração do Neon + dump diário |
| Contas corporativas e Cobranças (`/v1`) | D1 `centro-custos-producao` | Time Travel do D1 |

### 1. Restauração do Neon (PITR)

É a primeira opção para qualquer incidente. No console do Neon, confira em
cada projeto a janela de histórico do plano (*Settings → Storage/History
retention*). Ela define até quando é possível voltar.

Para restaurar:

1. No projeto, crie um branch a partir de um instante anterior ao incidente
   (*Branches → Create branch → Point in time*).
2. Valide o branch com uma conexão somente leitura (contagens, último
   lançamento, última proposta).
3. Promova o branch a principal (*Restore* / *Set as default*) ou troque a
   `DATABASE_URL` do Worker pela do branch com `wrangler secret put
   DATABASE_URL` e reinicie com um novo deploy.

### 2. Dump diário criptografado (GitHub Actions)

O workflow `.github/workflows/backup-postgres.yml` existe nos dois
repositórios. Ele roda todo dia e também pode ser disparado à mão. Gera um
`pg_dump --format=custom`, confere o arquivo com `pg_restore --list`,
criptografa com GPG (AES256) e guarda como artifact por 30 dias.

Segredos (*Settings → Secrets and variables → Actions*):

| Repositório | Segredo | Conteúdo |
| --- | --- | --- |
| centro-custos-construtec-v3 | `CENTRO_BACKUP_DATABASE_URL` | URL do Neon do Centro, de preferência com usuário somente leitura |
| construtec-orcamentos | `ORCAMENTOS_BACKUP_DATABASE_URL` | URL do Neon do Orçamentos, idem |
| ambos | `BACKUP_PASSPHRASE` | Frase longa e aleatória, guardada também fora do GitHub |

Os repositórios são públicos e artifacts podem ser baixados por qualquer
usuário logado no GitHub. Por isso o arquivo nunca é publicado sem
criptografia. Sem a `BACKUP_PASSPHRASE` o backup é irrecuperável: guarde uma
cópia dela num cofre de senhas.

Usuário somente leitura sugerido (executar no SQL Editor do Neon, como dono
do banco):

```sql
CREATE ROLE backup_ro LOGIN PASSWORD '<gerar no cofre>';
GRANT pg_read_all_data TO backup_ro;
```

Restaurar um dump:

1. Baixe o artifact da execução desejada (*Actions → Backup PostgreSQL*).
2. Confira e descriptografe:

   ```bash
   sha256sum -c centro-AAAAMMDDTHHMMSSZ.dump.gpg.sha256
   gpg --output centro.dump --decrypt centro-AAAAMMDDTHHMMSSZ.dump.gpg
   ```

3. Crie um branch vazio no Neon e restaure nele, nunca direto no principal:

   ```bash
   pg_restore --no-owner --no-privileges --dbname="$URL_DO_BRANCH_NOVO" centro.dump
   ```

4. Valide e só então aponte a `DATABASE_URL` do Worker para ele.

### 3. D1 (contas e Cobranças)

O D1 mantém histórico próprio (Time Travel). Para voltar a um instante:

```bash
npx wrangler d1 time-travel info centro-custos-producao
npx wrangler d1 time-travel restore centro-custos-producao --timestamp=<ISO-8601>
```

Cópia manual, quando necessário:

```bash
npx wrangler d1 export centro-custos-producao --remote --output=d1-centro.sql
```

## Teste periódico

Uma vez por mês, restaure o dump mais recente num branch descartável do Neon
e confira as contagens principais. Backup sem teste de restauração não conta
como backup.
