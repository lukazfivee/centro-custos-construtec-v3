# Prompt para o Claude — continuar auditoria N+1
Projeto: `C:\Users\Lucas\OneDrive\Documentos\ChatGPT\centro de custos CONSTRUTEC`

Leia primeiro `N1_AUDIT_HANDOFF.md` na mesma pasta.

Investigue e corrija queries N+1. Mapeie cada caminho completo:

```text
rota HTTP -> middleware -> serviço -> ORM/driver -> SQL -> resposta JSON
```

Para cada ocorrência confirmada:

1. Reproduza com dados representativos em N=1, 10 e 50.
2. Meça contagem de queries com `lib/metrics.js` e `metrics.snapshot()`.
3. Meça latência usando `process.hrtime.bigint()` ou `performance.now()`.
4. Registre queries e latência antes.
5. Corrija com JOIN, batch, eager loading ou DataLoader conforme adequado.
6. Evite `SELECT *` e relações/colunas que a tela não usa.
7. Preserve idempotência, integridade contábil e regras de imutabilidade.
8. Adicione teste ou métrica anti-regressão.
9. Registre queries e latência depois.

Não aceite “parece mais rápido” como validação.

## Prioridades
### 1. `POST /api/recorrentes/gerar`
Arquivo: `routes/recurring.js`.

Há um loop sobre `recurring_templates` que executa queries por template:

- `SELECT id FROM transactions ...`;
- possivelmente `UPDATE recurring_templates ...`;
- `INSERT INTO transactions ...`;
- possivelmente outro `UPDATE recurring_templates ...`.

Confirme a chave de idempotência, índices e regras antes de alterar. Faça a consulta de existentes em lote. Só faça batch insert/update se a semântica da mutação for preservada.

### 2. `GET /api/usuarios` no modo corporativo
Arquivo: `routes/users.js`.

`cloudAuth.listUsers()` retorna usuários remotos e o código chama `upsertRemoteUser()` em série. Cada item faz SELECT por e-mail e depois UPDATE/INSERT.

Use normalização de e-mails, uma consulta `ANY($1)` e operações em lote seguras. Preserve o índice único `users_email_unique` e teste concorrência/conflitos.

### 3. Busca ampla
Procure queries dentro de loops em:

- `routes/*.js`;
- `services/**/*.js`;
- orçamento, alocações, medições, importação, sincronização;
- relatórios e integrações.

Demonstre crescimento com N para classificar como N+1 real.

## Instrumentação já existente
`db.js` instrumenta queries através de `lib/metrics.js`:

- `metrics.resetForTests()`;
- `metrics.snapshot()`;
- `snapshot.database.total`;
- `snapshot.database.durationMs`;
- `snapshot.database.averageDurationMs`;
- `snapshot.database.recentSlow`.

Reutilize essa instrumentação.

## Gates obrigatórios
```powershell
$env:Path = "C:\Program Files\nodejs;C:\Windows\System32;C:\Windows;" + $env:Path
Set-Location "C:\Users\Lucas\OneDrive\Documentos\ChatGPT\centro de custos CONSTRUTEC"
npm run check
npm run test:ci
```

Use PowerShell; não use comandos Unix.

## Resposta final obrigatória
Entregue esta tabela:

| Ocorrência | N | Queries antes | Latência antes | Queries depois | Latência depois |
|---|---:|---:|---:|---:|---:|

Informe também:

- endpoints alterados;
- serviços e arquivos alterados;
- testes adicionados;
- métricas utilizadas;
- ocorrências descartadas e justificativa;
- resultado de `npm run check`;
- resultado de `npm run test:ci`.

Não declare conclusão sem evidência numérica.
