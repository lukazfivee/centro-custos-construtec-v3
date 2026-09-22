# Auditoria de operações síncronas/pesadas e fila de jobs (2026-09-16)

## Objetivo

Auditar operações síncronas e pesadas rodando dentro do request principal
(processamento de arquivos, relatórios, importações, integrações externas,
e-mails) e, para as elegíveis, mover o trabalho para um mecanismo de
job/fila com status rastreável, progresso, retry idempotente, timeout,
observabilidade e consulta de resultado posterior — preservando o caminho
síncrono simples para operações pequenas.

## Levantamento

Sem infraestrutura de fila prévia (sem Redis/BullMQ/agenda/node-cron; app
Electron desktop com banco embutido pglite). Padrão já existente e
reaproveitável: `services/reportDelivery.js` (status rastreável, retry,
timeout) para entrega de bug reports — mas com um bug: `routes/bugReports.js`
ainda bloqueava a resposta com `await deliverReport()`.

Operações candidatas identificadas, por risco:

1. **Alto** — `services/smartSync.js` `importPackage()`: parse de JSON até
   20MB e uma única transação cobrindo potencialmente milhares de
   lançamentos, sem timeout/progresso/status.
2. **Médio-alto** (crítico financeiramente) — `services/budgets/budgetImportService.js`
   `confirmImport()`: já atômico e idempotente (hash + `FOR UPDATE`), mas
   escala mal para propostas grandes (loops de materiais/mão de obra).
3. **Médio** — `routes/backupAuto.js` `POST /executar`: disparo manual
   bloqueava o request fazendo dump+hash+escrita em disco de forma síncrona,
   duplicando um mecanismo de fundo que já existe (`services/autoBackup.js`,
   ciclo automático via `setInterval`).
4. **Baixo** — anexos (`routes/attachments.js`, `routes/costCenterInvoices.js`,
   limite 8MB), fechamento mensal (`routes/monthlyClosing.js`): mantidos
   síncronos deliberadamente — é a "alternativa simples" pedida.

`GET /sincronizacao-inteligente/exportar` (build do pacote de sync) também
foi identificado como potencialmente pesado (serialização JSON síncrona de
todo o histórico), mas **não foi convertido nesta rodada**: é uma rota de
download direto consumida pelo frontend deste mesmo app, e migrá-la para
job exigiria também mudar o fluxo de download no cliente (buscar o arquivo
pronto depois). Ficou fora de escopo por ser menos frequente/crítica que os
4 itens acima; registrado aqui como trabalho futuro.

## Decisões de arquitetura

### D-1: fila de jobs in-process, sem infraestrutura externa

Implementada em `lib/jobs.js` + tabela `jobs` (migração `103_jobs_queue.sql`).
Sem Redis/BullMQ — desproporcional para um app desktop single-instance com
banco embutido. Características:

- **Execução sequencial (concorrência 1).** O banco embutido (pglite) é de
  conexão única; processar jobs em paralelo arriscaria contenção de lock e
  comprometeria a atomicidade das operações financeiras. Como as operações
  pesadas são raras (importações, backups), a falta de paralelismo não é um
  gargalo real.
- **Status e progresso na tabela `jobs`**, consultável via
  `GET /api/jobs/:id` (`queued → running → succeeded|failed`).
- **Retry automático** com backoff (5s/30s/120s) até `max_attempts`; **retry
  manual idempotente** via `POST /api/jobs/:id/retry` — no-op se o job já
  está `succeeded`/`running`/`queued` (só reenfileira se `failed`).
- **Timeout cooperativo.** Handlers de loop chamam `ctx.checkDeadline()`
  periodicamente para abortar (e fazer rollback da transação) de forma
  limpa. Existe também um "safety net" externo (`Promise.race`) que marca o
  job como `failed` por timeout mesmo que o handler não coopere — mas ele
  **não cancela de fato** uma promise em andamento; é uma limitação inerente
  ao Node sem `worker_threads`. Documentado no topo de `lib/jobs.js`.
- **Idempotência de submissão** via `idempotency_key` (índice único
  `type+idempotency_key`): reenviar o mesmo pacote/payload retorna o job
  existente em vez de reprocessar.
- **Recuperação em reinício.** `startJobRunner()` (chamado só em `start()`,
  não em `createApp()`, para não afetar testes) marca jobs `running` de uma
  execução anterior como `failed` (não há como saber se concluíram, e a
  transação já foi revertida pelo próprio banco ao cair a conexão) e
  retoma jobs `queued`.
- **Observabilidade**: `lib/metrics.js` ganhou uma seção `jobs` (total,
  succeeded, failed, duração média/máxima, contagem por tipo, últimas
  falhas) exposta no mesmo `snapshot()` já usado por `requests`/`database`.

### D-2: progresso fino não é seguro dentro de uma transação atômica única

O pglite é single-connection. Escrever progresso via uma conexão separada
(`getDb().query(...)`) enquanto uma transação grande (`db.transaction(...)`)
está aberta arriscaria interferir com essa transação (ou, na melhor
hipótese, o UPDATE de progresso ficaria preso na mesma transação e só
seria visível após o commit — inútil para acompanhamento ao vivo).
Decisão: para `smart-sync-import`, o progresso reportado é por fase
(`queued → running → succeeded/failed`), não percentual item-a-item; dentro
do loop, `ctx.checkDeadline()` é chamado periodicamente (a cada 25
lançamentos, e uma vez após cada bloco de categorias/obras/fornecedores) —
seguro porque é só comparação de `Date.now()` em memória, sem I/O.

### D-3: `budgetImportService.confirmImport` permanece síncrono

Os 3 endpoints que usam `confirmImport` (`/previas/:id/confirmar`,
`/confirmar-direto`, `/sync-direto`) são consumidos por integração direta
com o sistema **Construtec Orçamentos** (contrato de resposta síncrona) e
pela UI de prévias deste app. Trocar a resposta por "202 + jobId" quebraria
esse contrato sem coordenar uma mudança no lado cliente, fora do escopo
desta auditoria (mudaria outro repositório). Decisão: manter 100% síncrono,
mas envolver a chamada em `confirmImportWithObservability()`
(`services/budgets/budgetImportService.js`), que adiciona:

- timeout configurável (`BUDGET_IMPORT_TIMEOUT_MS`, padrão 60s) via
  `Promise.race` — se estourar, o cliente recebe HTTP 504 com mensagem
  clara; a transação em si continua e conclui (ou reverte) normalmente no
  banco, e a idempotência existente (hash + `FOR UPDATE`) garante que uma
  nova tentativa com o mesmo payload não duplica nada;
- observabilidade via `metrics.recordJob({type:'budget-import',...})` e
  logs estruturados (`budget_import_confirmed`/`budget_import_failed`),
  reaproveitando a mesma seção `jobs` do snapshot de métricas.

### D-4: `smartSync.importPackage` — sync para pacotes pequenos, job para grandes

`ASYNC_ITEM_THRESHOLD = 200` (soma de categorias + obras + fornecedores +
lançamentos). Abaixo do limite (o caso comum — sincronizar uma obra por
vez), a resposta continua síncrona e idêntica à de antes (200 OK com
`resumo`). Acima, vira job (`type: 'smart-sync-import'`, `idempotencyKey:
pack.packageId`) e a rota responde 202 com `{async:true, jobId, status,
itens}`. O frontend (`public/chatgpt-p3.js`) usa o novo helper
`pollJob()` (`public/app.js`) para acompanhar o job até `succeeded`/`failed`
antes de mostrar o resultado final — fluxo completo validado em
`test/smart-sync-async-job.test.js` (disparo → 202 → consulta intermediária
→ conclusão → reenvio idempotente do mesmo pacote).

### D-5: backup manual vira job, reaproveitando o mecanismo automático

`POST /api/backup-automatico/executar` agora responde 202 imediatamente
com um `jobId` (`type: 'manual-backup'`) em vez de bloquear o request
fazendo dump+hash+escrita em disco. O handler do job é literalmente
`runAutoBackup(true)` — a mesma função já usada pelo ciclo automático
(`setInterval` em `services/autoBackup.js`), eliminando a duplicação de
lógica. Frontend (`public/chatgpt-final.js`) usa `pollJob()` para mostrar o
resultado. Validado em `test/backup-manual-job.test.js`.

### D-6: `bugReports` para de bloquear a resposta na entrega central

`routes/bugReports.js` `POST /` já tinha toda a infraestrutura de fila
pronta em `services/reportDelivery.js` (status `pending/sending/accepted
/delivered/failed`, retry automático via `setInterval`, timeout de 12s via
`AbortController`, endpoints `GET /delivery/status` e `POST /:id/retry` e
`/delivery/retry`) — mas a rota fazia `await deliverReport(report.id)`
antes de responder, bloqueando o request pelo tempo da chamada HTTP
central (até 12s). Correção: parar de aguardar (`deliverReport(...).catch(...)`),
deixando a entrega para o ciclo de fundo já existente. O report volta a
nascer com `delivery_status:'pending'` na resposta, coerente com o que o
teste `test/v3-1-reports.test.js` já esperava.

## Validação (disparo → conclusão)

- `test/jobs-queue.test.js`: núcleo de `lib/jobs.js` — criação, idempotência
  por chave, timeout cooperativo, falha permanente + retry manual
  idempotente, métricas por tipo.
- `test/smart-sync-async-job.test.js`: pacote grande (201 itens) → 202 +
  jobId → consulta intermediária → `flushQueue()` → succeeded com resultado
  → reenvio idempotente do mesmo pacote não duplica.
- `test/backup-manual-job.test.js`: disparo manual → 202 + jobId →
  succeeded → arquivo `.tar.gz` real criado em disco.
- `test/v3-1-reports.test.js` (pré-existente): confirma que bug reports
  continuam nascendo `pending`/`queued` sem bloquear a resposta.
- `test/budget-import.integration.test.js` (pré-existente, 8 testes):
  confirma que `confirmImportWithObservability` preserva 100% do
  comportamento/contrato original, incluindo os status codes de erro.

Gates finais: `node scripts/check-syntax.js` — 86 arquivos OK;
`node --test --test-reporter=spec` — **141 testes, 0 falhas** (134
anteriores + 7 novos).

## Limitações conhecidas / trabalho futuro

- Timeout de job é cooperativo; um handler que não chama
  `ctx.checkDeadline()` em loops longos (ex.: uma única chamada bloqueante
  como `db.dump()` no backup) não pode ser interrompido de fato — o
  "safety net" externo marca o job como falho para fins de status, mas a
  operação subjacente continua até terminar sozinha. Mitigar de verdade
  exigiria `worker_threads` ou processos separados, fora do escopo desta
  rodada.
- `GET /sincronizacao-inteligente/exportar` não foi convertido (ver seção
  de levantamento) — candidato a uma próxima rodada, junto com uma mudança
  no fluxo de download do frontend.
- A fila roda em memória (array + tabela `jobs` para persistência de
  estado); jobs `queued` sobrevivem a um reinício (retomados por
  `startJobRunner()`), mas o processamento em si não é distribuído — não
  há necessidade disso neste app single-instance.
