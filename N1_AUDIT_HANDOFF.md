# Handoff para auditoria de queries N+1
## Projeto
`C:\Users\Lucas\OneDrive\Documentos\ChatGPT\centro de custos CONSTRUTEC`

## Objetivo
Continuar a investigação de queries N+1. Não aceitar conclusão baseada apenas em percepção de velocidade: medir quantidade de queries e latência antes/depois, reproduzir com dados representativos e adicionar proteção contra regressão.

## Estado atual
A auditoria de listas/tabelas já foi concluída antes desta tarefa. Existem mudanças locais relacionadas a paginação em:

- `routes/categories.js`
- `routes/suppliers.js`
- `routes/costCenters.js`
- `routes/history.js`
- `routes/recurring.js`
- `routes/users.js`
- `public/list-panel.js`
- `public/list-panel-lists.js`
- `public/list-panel.css`
- `public/app.js`
- `public/index.html`
- `test/list-panel.test.js`
- `test/list-panel-behavior.test.js`

Os testes determinísticos do painel usam `vm` e um DOM mínimo simulado. O arquivo temporário `scripts/diag-panel.js`, usado durante a depuração, deve permanecer removido; não é parte da implementação.

Gates registrados antes da transição:

- `npm run check`: passou, 84 arquivos verificados.
- Suíte completa anterior: 131 testes passando.
- Testes novos do painel: 11/11 passando.
- Backend HTTP validado com página limitada e `X-Total-Count`.

Reexecute os gates após qualquer alteração.

## Instrumentação existente
`db.js` já envolve `query`/`exec` com `lib/metrics.js`:

- `recordQuery({ operation, durationMs, failed, statement })`
- `metrics.snapshot()` expõe `database.total`, `database.durationMs`, `database.averageDurationMs`, `database.recentSlow`.
- `metrics.resetForTests()` existe.

Aproveite esta instrumentação; não crie uma contagem paralela se puder evitar.

## Suspeitas prioritárias de N+1
### 1. `routes/recurring.js`, `POST /api/recorrentes/gerar`

Caminho:

```text
POST /api/recorrentes/gerar
  -> autenticar/exigirPapel
  -> routes/recurring.js
  -> getDb().query(SELECT * FROM recurring_templates ...)
  -> for (const tpl of templates)
       -> SELECT id FROM transactions ... por template
       -> possivelmente UPDATE recurring_templates ... por template
       -> INSERT transactions ... por template
       -> UPDATE recurring_templates ... por template quando parcelado
  -> res.json({ ok, gerados, mensagem })
```

Este é o candidato mais claro. O número de queries cresce com o número de templates. Corrigir com:

- seleção mínima de colunas, não `SELECT *`;
- uma consulta em lote para localizar transações existentes usando chaves compostas adequadas;
- depois de validar conflitos, batch insert/transaction quando a semântica contábil permitir;
- atualização de parcelas em lote;
- manter idempotência, auditoria e integridade contábil;
- não usar optimistic UI nesta mutação financeira.

Antes de alterar, confirme a chave de idempotência e os índices existentes. Não introduza `ON CONFLICT` sem confirmar a regra de negócio.

### 2. `routes/users.js`, GET /api/usuarios para usuários corporativos
Caminho:

```text
GET /api/usuarios
  -> cloudAuth.listUsers(sessionToken) [1 chamada HTTP]
  -> for (const item of remote.users)
       -> upsertRemoteUser(item)
            -> SELECT id FROM users WHERE LOWER(email)=$1 LIMIT 1
            -> UPDATE ou INSERT users
  -> res.json(users)
```

É N+1 de banco e ainda serializa chamadas. Corrigir com:

- normalização/deduplicação dos e-mails;
- uma única consulta `SELECT ... WHERE LOWER(email) = ANY($1)`;
- mapear existentes em memória;
- batch insert/update, respeitando índice único `users_email_unique` e condições de concorrência;
- não expor colunas que a tela não usa;
- testar caminho cloud-managed e caminho local separadamente.

### 3. Outros loops a revisar
Use busca por `for`, `forEach`, `Promise.all` e `getDb().query` dentro de loop em:

- `routes/*.js`
- `services/**/*.js`
- `routes/costCenters.js` e serviços de orçamento/medições/alocações
- sincronização e importação
- rotas de relatórios
Diferencie N+1 real de processamento em lote legítimo. Uma sequência de queries necessárias para uma única mutação não é automaticamente N+1; demonstre crescimento com N.

## Reprodução obrigatória
Para cada suspeita:

1. Criar dados representativos com `N = 1, 10, 50` entidades.
2. Resetar métricas antes da chamada.
3. Chamar a rota autenticada via HTTP ou testar o serviço diretamente.
4. Capturar:
   - `database.total` antes/depois;
   - `database.durationMs` e média;
   - latência da requisição;
   - tamanho da resposta;
   - quantidade de linhas retornadas.
5. Mostrar uma tabela antes/depois.
6. Adicionar teste que falha se a quantidade de queries crescer além do limite esperado.

Use `performance.now()`/`process.hrtime.bigint()` para latência. Não use apenas `console.time` sem contagem de queries.

## Cuidados
- Respeitar `MAX_LINES <= 350` para arquivos novos/modificados quando aplicável.
- Não alterar baselines, contratos selados, lançamentos liquidados ou fechamentos de forma destrutiva.
- Valores monetários permanecem em centavos e HALF_UP.
- Não inserir emojis no frontend. Os arquivos antigos podem conter ícones Unicode; não ampliar esse padrão.
- Preservar os estados loading, vazio, erro e retry já adicionados às listas.
- Não alterar endpoints CSV para paginação interativa: exportação precisa de política explícita de conjunto completo.

## Comandos
PowerShell:

```powershell
$env:Path = "C:\Program Files\nodejs;C:\Windows\System32;C:\Windows;" + $env:Path
Set-Location "C:\Users\Lucas\OneDrive\Documentos\ChatGPT\centro de custos CONSTRUTEC"
npm run check
npm run test:ci
```

Node absoluto, se necessário:

```powershell
& "C:\Program Files\nodejs\node.exe" --check routes\recurring.js
```

## Entrega esperada
Relatar:

- caminho completo rota -> serviço -> banco -> resposta;
- ocorrência confirmada e ocorrências descartadas, com motivo;
- contagem e latência antes/depois para N representativo;
- arquivos/endpoints alterados;
- testes/métricas anti-regressão;
- resultado de `npm run test:ci` e `npm run check`.
