# Detalhamento do Centro de Custo em 3 abas

## Contexto e objetivo

O modal "Centro de custo" (aberto ao clicar num centro na tela Obras/centros,
`openCenterDetail` em `public/app.js`) hoje mostra um cabeçalho, 3 KPIs, uma
barra de orçamento e a lista de lançamentos do centro — sem exibir vários
campos que já existem no cadastro (cliente, descrição, datas) e sem nenhum
controle de notas fiscais.

O usuário pediu para reestruturar esse modal em 3 abas:

1. **Detalhamento** — dados cadastrais e comerciais do centro/obra.
2. **Notas fiscais** — anexar e acompanhar NFs de fornecedor e de cliente.
3. **Orçado x Realizado** — resumo de 2 números (Material, Mão de obra),
   estimado vs. realizado.

## Levantamento (o que já existe vs. o que é novo)

Investigação no schema e nas rotas mostrou que a maior parte da Aba 1 e toda
a Aba 3 já tem os dados prontos no backend — só faltava exibição:

| Campo pedido | Fonte | Status |
|---|---|---|
| Nome do cliente | `cost_centers.client` | Já existe e já é editável (form "Editar centro"); só não aparece no detalhe. |
| Nome da obra | `cost_centers.name` | Já exibido no cabeçalho do modal atual. |
| Escopo do serviço | `cost_centers.description` | Já existe (campo "Descrição" no form de edição); reexibido como "Escopo do serviço" na Aba 1. |
| Data início / término do serviço | `cost_centers.start_date` / `end_date` | Já existem e já são editáveis; só não aparecem no detalhe. |
| Data de aprovação da proposta | `budget_baselines` → `project_contracts.current_baseline_id` (via `GET /centros-custo/:id/orcado-realizado`, campo a adicionar) | Só existe quando há baseline importada do Orçamentos; ver decisão abaixo. |
| Baixar proposta anexada | — | **Novo.** Nenhum PDF é transferido pela integração hoje (só JSON). Upload manual, por decisão do usuário. |
| Notas fiscais (fornecedor/cliente, data, valor, status) | — | **Novo.** Existe um mecanismo similar mas insuficiente (`cost_center_invoices`, 1 arquivo por centro, sem data/valor/status) — não será tocado nem reaproveitado; fica como está, por instrução do usuário. |
| Valor estimado Material / Mão de obra | `budget_baselines.materials_cost` / `labor_cost`, já expostos em `contract.materialsCost` / `contract.laborCost` na resposta de `GET /centros-custo/:id/orcado-realizado` | Já existe, zero trabalho novo. |
| Valor realizado Material / Mão de obra | `items[].kind` + `items[].realizedCost` na mesma resposta, já vem por item de controle (`budget_control_items.kind IN ('material','labor')`) | Já existe — basta somar `realizedCost` agrupado por `kind` no frontend. **Confirmado com o usuário: não haverá mudança na categorização dos lançamentos** (`categories`/`category_id` continuam como estão); o vínculo lançamento → material/mão-de-obra já é feito hoje pelo sistema de apropriação (`cost_center_allocations`, rotas `/centros-custo/:id/apropriacoes`). |

Data de aprovação da proposta: a rota `orcado-realizado` hoje não devolve essa
data. Ela será adicionada ao objeto `contract` da resposta
(`approvedAt`, lida de `project_contracts` → baseline → payload do import,
campo `proposal.approval.approvedAt` já gravado em `budget_imports.payload`).
Quando não há baseline (`hasBudget: false`), o campo simplesmente não existe
e a Aba 1 mostra "—".

## Decisões confirmadas com o usuário

- Aba 3 reaproveita o sistema de apropriação existente; **nenhuma mudança**
  em `categories`/`category_id` dos lançamentos.
- Aba 2 suporta **várias** NFs de fornecedor e **várias** NFs de cliente por
  centro de custo (não um slot único).
- NF de cliente tem os mesmos campos que NF de fornecedor: arquivo, data de
  emissão, valor, status (paga/não paga).
- "Baixar proposta anexada" é upload manual de PDF (sem geração automática).
- O mecanismo órfão `cost_center_invoices` / `/api/notas-fiscais-centro` /
  `public/v3-1-invoices.js` (nunca carregado em `index.html`) fica como está,
  sem ser tocado ou reaproveitado, para não confundir com a Aba 2 nova.
- O modal detalhado "Orçado vs. Realizado" que já existe (`budget-view.js`,
  tabela por item + Curva ABC + Medições + Curva S) **não é substituído**:
  a Aba 3 nova é um resumo enxuto com um botão "Ver detalhamento completo"
  que abre o modal existente por cima.

## Modelo de dados (1 migração nova)

Duas tabelas novas. Nenhuma coluna nova em `cost_centers` (os campos de data
e descrição já existem).

```sql
-- 104_cost_center_documents.sql

CREATE TABLE IF NOT EXISTS cost_center_proposals (
  cost_center_id INTEGER PRIMARY KEY REFERENCES cost_centers(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  size_bytes BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  content BYTEA NOT NULL,
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cost_center_invoices_ledger (
  id SERIAL PRIMARY KEY,
  cost_center_id INTEGER NOT NULL REFERENCES cost_centers(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('fornecedor', 'cliente')),
  original_name TEXT,
  mime_type TEXT DEFAULT 'application/pdf',
  size_bytes BIGINT,
  sha256 TEXT,
  content BYTEA,
  data_emissao DATE,
  valor NUMERIC(14, 2),
  status TEXT NOT NULL DEFAULT 'nao_paga' CHECK (status IN ('paga', 'nao_paga')),
  observacao TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cc_invoices_ledger_center ON cost_center_invoices_ledger(cost_center_id, tipo);
```

`cost_center_proposals` segue exatamente o padrão já usado em
`cost_center_invoices` (migração 015, `routes/costCenterInvoices.js`): 1 PDF,
até 5 MB, validação de assinatura `%PDF-`, hash SHA-256, auditoria via
`recordAudit`. O nome `cost_center_invoices_ledger` (em vez de reusar
`cost_center_invoices`) evita colisão com a tabela/rota antiga que fica
intocada.

O arquivo é opcional em `cost_center_invoices_ledger` (uma NF pode ser
registrada com data/valor/status antes de o PDF ser anexado, ou o usuário
pode preferir só anotar os dados sem anexar nada ainda) — mas `data_emissao`,
`valor` e `status` são preenchidos no formulário de criação.

## Backend

Novo arquivo `routes/costCenterProposals.js` (mesma estrutura de
`costCenterInvoices.js`, adaptada para `cost_center_proposals`):
- `GET /api/centros-custo/:id/proposta` — metadados (sem conteúdo).
- `GET /api/centros-custo/:id/proposta/arquivo` — download do PDF.
- `POST /api/centros-custo/:id/proposta` — upload/substituição (admin/gestor).
- `DELETE /api/centros-custo/:id/proposta` — remoção (admin/gestor).

Novo arquivo `routes/costCenterInvoicesLedger.js` (CRUD sobre
`cost_center_invoices_ledger`):
- `GET /api/centros-custo/:id/notas-fiscais?tipo=fornecedor|cliente` — lista.
- `POST /api/centros-custo/:id/notas-fiscais` — cria (tipo, data_emissao,
  valor, status, arquivo opcional em base64, mesma validação de PDF/5MB de
  `costCenterInvoices.js`).
- `PUT /api/centros-custo/notas-fiscais/:nfId` — edita status/valor/data
  (ex.: marcar como paga).
- `DELETE /api/centros-custo/notas-fiscais/:nfId` — remove.

Ambas as rotas registradas em `server.js`, protegidas por `autenticar`, com
`recordAudit` nas mutações (mesmo padrão do resto do projeto).

Ajuste em `services/budgets/budgetComparison.js`: adicionar `approvedAt` ao
objeto `contract` retornado (lido do `payload` do `budget_imports` vinculado
à baseline atual — `proposal.approval.approvedAt`). Sem mudança de shape em
mais nada.

## Frontend

`openCenterDetail` em `public/app.js` ganha navegação por abas (padrão
simples: 3 botões estilo `.measurements-tab-btn` já usado no modal de
Medições, sem nova lib):

- **Detalhamento**: cliente, obra, escopo (descrição), datas de
  início/término (já formatadas como hoje), data de aprovação da proposta
  (quando existir baseline), botão "Baixar proposta" (ou "Anexar proposta"
  para admin/gestor quando não houver arquivo ainda) — reaproveita o padrão
  de `chatgpt-p4.js` para o input de arquivo e mensagens de erro. A lista de
  lançamentos atual (`#center-detail-transactions`) permanece nesta aba,
  abaixo dos dados cadastrais, sem mudança de comportamento.
- **Notas fiscais**: duas seções (Fornecedor / Cliente final), cada uma com
  formulário de novo registro (arquivo opcional, data, valor, toggle
  paga/não paga) e lista das NFs já lançadas em formato de cartão mobile
  (`cc-mobile-table`/`data-label`, mesmo padrão desta sessão) — cada cartão
  com ação "Marcar como paga"/"Não paga" e "Excluir".
- **Orçado x Realizado**: chama a mesma `GET /centros-custo/:id/orcado-realizado`
  que `budget-view.js` já usa. Mostra 4 números (Material estimado, Mão de
  obra estimado, Material realizado, Mão de obra realizado — os dois
  realizados somando `items` por `kind`) e um botão "Ver detalhamento
  completo" que aciona o botão já injetado por `budget-view.js`
  (`document.getElementById('btn-ver-orcado-realizado')?.click()` — o mesmo
  botão "Orçado vs. Realizado" que hoje aparece em `.center-detail-actions`;
  `openBudgetViewModal` é função interna daquele arquivo, não exposta em
  `window`, por isso a Aba 3 aciona o botão em vez de chamar a função
  direto). Quando
  `hasBudget` é `false`, mostra a mensagem que a API já devolve
  (`message`) em vez dos números.

Nenhuma rota de navegação principal muda; isso é só a reestruturação interna
do conteúdo de um modal que já existe.

## Fora de escopo (confirmado)

- Mudar a categorização de lançamentos (`categories`).
- Tocar em `cost_center_invoices` / `routes/costCenterInvoices.js` /
  `public/v3-1-invoices.js`.
- Geração automática de PDF da proposta a partir dos dados importados.
- Qualquer mudança no modal detalhado "Orçado vs. Realizado" existente
  (`budget-view.js`) além de ser aberto a partir da nova Aba 3.

## Testes

- `node --test` novo para as duas rotas novas (upload/download/CRUD,
  validação de PDF e tamanho, papéis admin/gestor), seguindo o padrão de
  `test/p4-attachments.test.js` (que testa `attachments.js` de forma
  análoga).
- Teste do ajuste em `budgetComparison.js` (campo `approvedAt` presente
  quando há baseline, ausente quando não há).
- `node scripts/check-syntax.js` e suíte completa (`node --test`) antes de
  qualquer commit, mesmo padrão desta sessão.
- QA visual mobile + desktop via portal Maestri em instância descartável
  (mesmo padrão desta sessão), confirmando que o modal "Centro de custo"
  continua funcionando nas 3 abas em ambos os tamanhos de tela.
