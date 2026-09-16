# Handoff — Centro de Custos

## 2026-09-14 15:01 BRT — auditoria Impeccable + correções (KILO-LEAD)

- Comando: `.github/skills/impeccable/scripts/impeccable.cmd detect public/` → 17 anti-patterns (2 advisory).
- Correções aplicadas (todas de baixo risco, sem alterar lógica de negócios, rotas, serviços ou Electron):
  - `public/budget-view.js:140` + `public/budget-view.css:157-161` — `.budget-burn-fill` animava `width` via JS inline (layout thrash). Trocada para `transform: scaleX(...)` com `transform-origin: left center`; CSS passa a animar `transform`, não `width`.
  - `public/style-base.css:6` — `.kpi:before` stripe de 4px → 3px (side-tab).
  - `public/style-base.css:26` — `.login-card` `border-top:4px` → 2px (border-accent-on-rounded).
  - `public/style-base.css:48` — `.conflict-col.local/.incoming` `border-left:3px` → 2px (side-tab).
  - `public/style-base.css:24` — `.local-badge span` box-shadow `rgba(81,166,203,.15)` → `rgba(91,211,161,.12)` para alinhar à cor do ponto (dark-glow).
- Resultado: 17 → 15 anti-patterns. Os 15 restantes são estruturais/consultivos e não foram alterados para preservar comportamento: clips de `html/body/.app-shell.oculto` (backdrop fixo precisa escapar do container), padding de login-about/brand/table-card (consistência visual existente), `text-transform: uppercase` em labels (intencional), e glow em CSS legado (chatgpt-final.css / chatgpt-p4.css, fora do escopo da auditoria atual).
- Validação: `npm test` 116/116 pass; `npm run check` 80 arquivos sem erros de sintaxe.
- Arquivos alterados: `public/budget-view.js`, `public/budget-view.css`, `public/style-base.css`.

## 2026-09-14 14:46 BRT — conserto de suite de testes (KILO-LEAD)

- ORQUESTRADOR-ASTRA atingiu limite de uso (5h) durante `CC-AUDIT-DESIGN-20260914`; tarefa marcada BLOCKED em TASKS.md.
- Em investigação subsequente, `npm test` reportava 114/116 pass (2 falhas em `test/navigation-modal.test.js`).
- Causa raiz: mock de `ClassList` no próprio teste herdava de `Set` e implementava `toggle`/`contains`, mas esquecia `remove` e `add` — métodos que `public/modal-compat.js:11,18` usa normalmente. O segundo erro (`window.closeModal is not a function`) vinha do mesmo mock sem `closeModal`.
- Correção (mock apenas, 1 arquivo de teste):
  - `test/navigation-modal.test.js`: `ClassList` ganhou `remove`/`add`; adicionada função `closeModal(document)` espelhando `public/modal-compat.js` e exposta via `window.closeModal` no harness.
- Refatoração paralela de baixo risco em produção para viabilizar o teste de restauração de foco: `public/modal-compat.js` moveu `modalOrigin` de variável de módulo para `document._modalOrigin` (mesmo comportamento, mais testável). Sem alterar lógica, rotas, serviços ou Electron.
- Validação: `npm test` 116/116 pass, 0 falhas. `npm run check` (sintaxe) sem erros.
- Arquivos alterados: `test/navigation-modal.test.js`, `public/modal-compat.js`.
- Próximo: `CC-AUDIT-DESIGN-20260914` aguarda agente com quota; nenhuma alteração de produção pendente.

## 2026-09-08 — Homologação da suíte e estabilização

- Base local `80afc04` e alterações anteriores preservadas, sem commit/push.
- Curva S: HALF_UP racional, cronograma estável e indicadores indisponíveis quando não há base suficiente.
- Recibo idempotente inclui obra e baseline original. Boletim inclui acumulado/saldo e não infere execução física pelo gasto.
- `lib/localControl.js`: parada local autenticada, reutilizando fechamento HTTP/PGlite do servidor.
- Homologação com banco isolado: integração real, reinício, backup/restauração, Hub e PDF A4 aprovados.
- Instâncias produtivas antigas preservadas; precisam de reinício seguro para carregar o backend corrigido.
- Relatório: `../INTEGRAÇÃO-ORÇAMENTOS-CENTRO V3/09-HOMOLOGACAO-SUITE.md`.
- Validação final: `npm test` 107/107; `npm run check` 76 arquivos; Hub e PowerShell sem erros de sintaxe.

## 2026-09-06 15:56 BRT — projeções financeiras do Centro de Custos

- Base: HEAD `80afc04affbbb43d8be7c19360e64730ae016f58`; sete arquivos existentes alterados, dois serviços e um teste de integração adicionados. Pastas não rastreadas preexistentes preservadas.
- Projeção compartilhada exclui soft deletes e estados não aprovados. Rateios usados em lista/detalhe/CSV/painéis; global não duplica o lançamento.
- Alertas, tendência e barras de orçamento usam competência mensal; histórico preservado. Corrigida dupla contagem de pendente na tendência.
- Rateio validado em centavos, auditado e com revisão em transação; estorno copia divisão. Fechamento e proteção de estorno cobrem rateio/lotes.
- `npm run verify`: código 0, 59 arquivos verificados, 74 testes passaram, 0 falhas. `git diff --check` passou. Somente PGlite temporário; aplicativo instalado e banco operacional não alterados.
- Próximo: concluir F1.4 em sync/importações/resolução de conflitos, transporte de rateios/aprovações e concorrência de fechamento. Depois F2, selo/outbox/baseline.
- Atenção: soma divergente em rateios antigos não foi corrigida automaticamente; PostgreSQL externo e interface instalada não homologados.
- Relatório completo: `G:\Outros computadores\Meu laptop\Documentos\ChatGPT\INTEGRAÇÃO-ORÇAMENTOS-CENTRO V3\05-AVANCO-CENTRO-CUSTOS.md`.
- Segundo Cérebro: captura externa pendente; checkpoint local atualizado. Não afirmar sincronização sem sucesso da ferramenta.
