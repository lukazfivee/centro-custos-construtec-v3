# Serviços curtos: contrato da API (servidor)

Base: `/api/servicos`. Todas as rotas exigem `Authorization: Bearer <token>`. Corpo e respostas em JSON (exceto arquivos e relatório).
Erros sempre no formato `{ "erro": "mensagem em português", "requestId": "..." }` (com campos extras quando indicado).

Código: `routes/servicos.js` (cadastro, situação, gastos, concluir, faturar, relatório), `routes/servicosCampo.js` (checklist, fotos, aceite),
`services/servicos/*`. Migração `migrations/116_servicos.sql`. Testes: `test/servicos.integration.test.js`, `test/servicos-faturar.integration.test.js`.

## Modelo

Um serviço é um centro de custo com `cost_centers.kind = 'servico'` mais uma linha em `service_jobs` (criada sob demanda, então um centro
marcado como serviço pela tela comum também funciona aqui). Campos e onde ficam:

| Campo da API | Onde fica |
|---|---|
| `codigo` (SV-xxxx) | `cost_centers.code` |
| `nome` | `cost_centers.name` (se não vier, 1a linha da descrição, ou "Serviço <cliente>") |
| `cliente` (obrigatório) | `cost_centers.client` |
| `valor` cobrado (obrigatório, >= 0) | `cost_centers.contract_amount` (é o que Cobranças mostra como valor a receber) |
| `data` (AAAA-MM-DD) | `cost_centers.start_date` |
| `responsavel` (técnico) | `cost_centers.responsible` |
| `descricao` (o que foi feito) | `cost_centers.description` |
| `local` | `service_jobs.location` |
| `situacao` | `service_jobs.status`: `agendado`, `em_andamento`, `concluido`, `faturado` |
| checklist | `service_jobs.checklist` (JSON `[{id,texto,feito}]`) |
| aceite | `service_jobs.accept_*` (assinatura PNG em `accept_signature`) |
| faturamento | `service_jobs.billing_*`, `nfse_number`; PDF da NFS-e em `cost_center_invoices` |
| fotos | tabela `service_photos` (fase `antes` ou `depois`) |
| gastos | `transactions` normais (despesas) do centro, com `transactions.expense_kind` |

`cost_centers.project_status` acompanha a situação: agendado=planejamento, em_andamento=execucao, concluido/faturado=concluido.

Mudar serviço para obra (e volta) continua pelo `PUT /api/centros-custo/:id` com `tipo`. Os lançamentos ficam. Enquanto for obra,
`/api/servicos/:id` responde 404; ao voltar para serviço, checklist, fotos, aceite e situação reaparecem.

### Tipos de gasto

`deslocamento` (Uber/transporte), `combustivel`, `material` (material e miscelânea), `mao_de_obra` (mão de obra terceirizada), `outros`.

Decisão: coluna nova `transactions.expense_kind` (nula nos lançamentos comuns) e, no lançamento rápido, a categoria é escolhida pelo tipo
(deslocamento e combustível: Transporte; material: Material; mão de obra: Serviços terceirizados; outros: Outros; se a categoria não
existir, a primeira categoria de despesa ativa). Relatórios existentes continuam lendo a categoria, nada muda para eles.
Despesa lançada pela tela comum (sem `expense_kind`) entra no resumo pelo nome da categoria (Transporte: deslocamento; Material: material;
Serviços terceirizados ou Mão de obra: mao_de_obra; demais: outros). A coluna não é enviada na sincronização entre instalações
(lá o lançamento chega com a categoria e cai no tipo deduzido).

## Papéis

| Ação | Permissão |
|---|---|
| Ler lista, detalhe, resumo, gastos, fotos, assinatura, relatório | autenticado, com acesso à obra (`assertObra`) |
| Criar e editar dados do serviço | p5 (admin, gestor) |
| Mudar situação agendado/em andamento, checklist, fotos, aceite, lançar gasto, concluir | p2 (inclui técnico) |
| Reabrir serviço concluído (voltar a em andamento) | p5 |
| Remover foto de outra pessoa | p3 (quem enviou pode remover a sua com p2) |
| Faturar | p6 (admin, gestor, financeiro) |

Valores: quem **não** tem p1 (técnico e comercial) recebe `veValores: false` e o servidor **omite** `valor`, `resumo.cobrado`,
`resumo.resultado`, `resumo.margem`, `faturamento.valor` e, na lista, `valor`, `resultado`, `margem`. No relatório, o bloco "Valor" some.
Os gastos (`resumo.gastos`, `gastosPorTipo`, `gastos`) continuam visíveis para todos.

Escopo por obra: engenharia e técnico com `all_cost_centers = false` só veem serviços atribuídos em `user_cost_centers`;
fora disso as rotas com `:id` respondem 403 `Você não tem acesso a esta obra.` e a lista vem filtrada.

## Objeto Serviço (detalhe)

```json
{
  "id": 12, "publicId": "uuid", "codigo": "SV-1014", "nome": "Instalar 2 câmeras na portaria",
  "cliente": "Condomínio Sol", "local": "Rua A, 10", "data": "2026-10-02", "responsavel": "Carlos",
  "descricao": "Instalar 2 câmeras na portaria", "ativo": true, "revisao": 3, "situacao": "em_andamento",
  "valor": 1500,
  "checklist": [{ "id": "uuid", "texto": "Fixar câmeras", "feito": true }],
  "fotos": [{ "id": 5, "fase": "antes", "nome": "antes.jpg", "tipo": "image/jpeg", "tamanho": 81234, "legenda": "",
              "enviadoPor": "Carlos", "criadoEm": "2026-10-03T12:00:00.000Z", "url": "/api/servicos/12/fotos/5/arquivo" }],
  "aceite": { "nome": "Síndico João", "cargo": "Síndico", "dataHora": "2026-10-03T18:30:00.000Z", "registradoPor": "Carlos",
              "assinaturaUrl": "/api/servicos/12/aceite/assinatura" },
  "gastos": [{ "id": 90, "publicId": "uuid", "tipo": "deslocamento", "descricao": "Uber ida e volta", "favorecido": "",
               "valor": 42.5, "data": "2026-10-03", "categoria": "Transporte", "formaPagamento": "", "lancadoPor": "Carlos", "anexos": 1 }],
  "resumo": { "cobrado": 1500, "gastos": 350, "resultado": 1150, "margem": 76.7,
              "gastosPorTipo": [{ "tipo": "deslocamento", "rotulo": "Deslocamento", "total": 42.5, "quantidade": 1 }, "...5 tipos, sempre nesta ordem"] },
  "pendencias": [{ "codigo": "sem_aceite", "mensagem": "Sem aceite do cliente." }],
  "conclusao": null,
  "faturamento": null,
  "veValores": true,
  "atualizadoEm": "2026-10-03T18:31:00.000Z"
}
```

- `aceite`, `conclusao` e `faturamento` são `null` enquanto não existem.
- `conclusao`: `{ concluidoEm, concluidoPor, pendenciasNaConclusao: [pendência...] }`.
- `faturamento`: `{ valor, vencimentoDias, vencimento: "AAAA-MM-DD", forma: "pix"|"boleto"|"transferencia", nfseNumero, faturadoEm, faturadoPor, cobrancaSincronizada }`.
- Valores em reais (número com até 2 casas, arredondamento HALF_UP). `gastos` soma as despesas não excluídas; estorno entra negativo.
- `resultado = cobrado - gastos`; `margem = resultado / cobrado * 100` com 1 casa, `null` se cobrado = 0.
- Códigos de pendência: `checklist_incompleto` (traz `itens`: textos não feitos), `sem_foto_antes`, `sem_foto_depois`, `sem_aceite`.
  Checklist vazio não gera pendência.

## Rotas

### GET /api/servicos/proximo-codigo
`200 { "codigo": "SV-1015" }`: maior `SV-<número>` existente + 1 (começa em SV-1001). Só sugestão; não reserva.

### GET /api/servicos
Query opcional: `situacao` (um dos 4; outro valor: 400), `ativo=true|false`. Até 1000 itens, mais recentes (data) primeiro.
`200 [{ id, codigo, nome, cliente, local, data, responsavel, situacao, ativo, gastos, valor?, resultado?, margem? }]`.

### POST /api/servicos (p5)
Corpo: `{ cliente*, valor*, codigo?, nome?, local?, data?, responsavel?, descricao? }`. Sem `codigo`, usa o próximo livre.
`201` objeto Serviço (situação `agendado`). Erros: 400 `Informe o cliente.`, 400 `Informe o valor cobrado (zero ou mais).`,
400 código sem prefixo `SV-`, 400 `Data inválida.`, 409 `O código SV-1013 já está em uso.`, 403 sem p5.

### GET /api/servicos/:id
`200` objeto Serviço. 404 `Serviço não encontrado.` ou `Este centro de custo não é um serviço.`; 403 fora do escopo.

### PUT /api/servicos/:id (p5)
Edição parcial: só os campos enviados mudam (`codigo, nome, cliente, valor, local, data, responsavel, descricao`). `cliente` e `valor`,
se enviados, seguem as mesmas regras do POST. `revisao` opcional: se diferente da atual, 409
`Este serviço foi alterado por outra pessoa...`. `200` objeto Serviço. Não muda situação.

### PUT /api/servicos/:id/situacao (p2)
`{ "situacao": "agendado" | "em_andamento" }`. `200` objeto Serviço. 400 para outros valores (concluir e faturar têm rota própria).
De `concluido` para `em_andamento`/`agendado` = reabrir (exige p5, senão 403; limpa a conclusão). `faturado`: 409.

### GET /api/servicos/:id/resumo
`200 { cobrado?, gastos, resultado?, margem?, gastosPorTipo, veValores }`.

### GET /api/servicos/:id/pendencias
`200 { situacao, pendencias: [...] }`.

### GET /api/servicos/:id/gastos
`200` lista de gastos (mesmo formato de `gastos` no detalhe).

### POST /api/servicos/:id/gastos (p2): lançamento rápido
```json
{ "tipo": "deslocamento", "valor": 42.5, "data": "2026-10-03", "descricao": "Uber ida e volta",
  "favorecido": "Uber", "formaPagamento": "Pix", "observacao": "", "statusFinanceiro": "liquidado",
  "categoriaId": null, "client_id": "uuid-v4 opcional",
  "recibo": { "nome": "uber.jpg", "tipo": "image/jpeg", "conteudoBase64": "..." } }
```
Obrigatórios: `tipo`, `valor` (> 0, até 2 casas). Padrões: `data` = hoje, `descricao` = rótulo do tipo, `statusFinanceiro` = `liquidado`
(ou `pendente`). `recibo` opcional: JPG, PNG, WEBP ou PDF até 8 MB (conteúdo conferido), gravado em `transaction_attachments`
com categoria `recibo` (aparece em `/api/anexos/lancamento/:transactionId`). `client_id` torna o reenvio idempotente (fila offline).
Cria uma despesa normal em `transactions` (aparece na lista de lançamentos e nos relatórios).
`201 { id, public_id, tipo, categoriaId, anexoId }`; reenvio com o mesmo `client_id`: `200 { id, public_id, replayed: true, excluido, tipo }`.
Erros: 400 tipo/valor/data/recibo inválidos, 400 serviço inativo, 403 competência fechada, 409 `client_id` usado em outro lançamento,
409 sem categoria de despesa cadastrada, 413 recibo grande.
Editar ou excluir o gasto: rotas comuns de lançamentos (`/api/lancamentos/:id`, p3).

### PUT /api/servicos/:id/checklist (p2)
`{ "itens": [{ "id"?: "uuid", "texto": "Fixar câmeras", "feito"?: false }] }`: substitui a lista toda (incluir, remover, reordenar).
Item sem `id` ganha um. Até 100 itens, texto até 200 caracteres. `200 { itens }`. 409 se faturado.

### POST /api/servicos/:id/checklist (p2)
`{ "id": "uuid", "texto": "Fixar câmeras" }`: inclui um item no fim da lista, sem reescrever a lista. O `id` vem do cliente (o celular cria o
item sem internet); repetir o mesmo `id` não duplica e também responde `201 { itens }`. 400 texto vazio ou lista cheia (100). 409 se faturado.

### PATCH /api/servicos/:id/checklist/:itemId (p2)
`{ "feito": true }` (boolean obrigatório). `200 { itens }`. 404 item não encontrado. 409 se faturado.

### GET /api/servicos/:id/fotos
`200` lista de fotos (formato do detalhe).

### POST /api/servicos/:id/fotos (p2)
`{ "fase": "antes" | "depois", "nome": "antes.jpg", "tipo"?: "image/jpeg", "legenda"?: "", "conteudoBase64": "..." }`.
JPG, PNG ou WEBP até 8 MB (conteúdo conferido; `tipo`, se vier, precisa bater). Até 40 fotos por serviço.
`201` foto. Erros: 400 fase/formato, 409 mesma foto na mesma fase, 409 limite, 409 faturado, 413 grande.

### GET /api/servicos/:id/fotos/:fotoId/arquivo
Devolve a imagem (`Content-Type` da foto, `inline`). Use com o token (fetch + blob/URL.createObjectURL). 404 se não existe.

### DELETE /api/servicos/:id/fotos/:fotoId (p2)
`200 { ok: true }`. 403 se a foto é de outra pessoa e falta p3. 409 se faturado.

### PUT /api/servicos/:id/aceite (p2)
`{ "nome": "Síndico João", "cargo"?: "Síndico", "dataHora"?: "2026-10-03T15:30:00-03:00", "assinatura": { "conteudoBase64": "<PNG>" } }`.
Assinatura desenhada com o dedo exportada em **PNG** (até 512 KB; `canvas.toDataURL('image/png')` serve, o prefixo `data:` é aceito).
`dataHora` padrão: agora. Substitui um aceite anterior. `200` objeto `aceite`. Erros: 400 sem nome, 400 assinatura não PNG, 409 faturado.

### GET /api/servicos/:id/aceite/assinatura
PNG da assinatura. 404 `Aceite ainda não registrado.`

### DELETE /api/servicos/:id/aceite (p2)
`200 { ok: true }`. 409 se faturado.

### POST /api/servicos/:id/concluir (p2)
`{ "comPendencias"?: false }`.
- Sem pendências: `200 { ok: true, situacao: "concluido", pendencias: [] }`.
- Com pendências e sem `comPendencias: true`: **409** `{ "erro": "O serviço tem pendências. Confirme para concluir mesmo assim.", "codigo": "pendencias", "pendencias": [...] }`.
  A tela mostra a lista e, se a pessoa confirmar, reenvia com `comPendencias: true`.
- Com `comPendencias: true`: `200 { ok, situacao: "concluido", pendencias: [...] }` (gravadas em `conclusao.pendenciasNaConclusao`).
- Já concluído ou faturado: 409 `Este serviço já foi concluído.`

### POST /api/servicos/:id/faturar (p6)
```json
{ "valor"?: 820, "vencimentoDias": 10, "forma": "pix" | "boleto" | "transferencia",
  "nfse"?: { "numero"?: "NFS-e 77", "arquivo"?: { "nome": "nfse-77.pdf", "conteudoBase64": "<PDF>" } } }
```
- Só para serviço `concluido` (senão 409 `Conclua o serviço antes de faturar.`; já faturado: 409).
- `valor` padrão = valor cobrado do serviço; precisa ser > 0. `vencimentoDias` 0 a 365 (padrão 0); vencimento = hoje (Brasília) + dias.
- NFS-e: número e PDF opcionais (PDF até 5 MB, conteúdo conferido). O PDF vira a **NF vinculada da obra** (`cost_center_invoices`),
  a mesma que o envio de Cobranças anexa automaticamente.
- O serviço vira `faturado` (não muda mais: checklist, fotos, aceite e situação respondem 409).
- Cobranças (D4) é o acompanhamento no Worker comercial, uma linha por obra/serviço sincronizado. O servidor tenta atualizar essa linha
  (`PUT /v1/client-followups/:publicId`): `operationalStatus = finalizada`, `financialStatus = nf_emitida` (se veio NFS-e) ou `a_faturar`,
  `invoiceNumber`, `receivableAmount = valor`, `dueDate = vencimento`, forma e prazo acrescentados em `notes`.
  O e-mail de cobrança continua na tela de Cobranças (rascunho, autorizar, enviar).
- Resposta `200`:
```json
{ "ok": true, "situacao": "faturado",
  "faturamento": { "valor": 820, "vencimentoDias": 10, "vencimento": "2026-10-14", "forma": "boleto", "nfseNumero": "NFS-e 77", "nfseArquivo": true },
  "cobranca": { "sincronizada": true, "motivo": null } }
```
  `cobranca.sincronizada = false` com `motivo` quando a conta não é @rcconstrutec.com.br, o serviço ainda não está na nuvem ou a nuvem
  falhou. O faturamento local vale assim mesmo; a tela deve mostrar o motivo e sugerir atualizar em Cobranças.
- Erros: 400 forma, vencimento, valor, NFS-e não PDF; 403 sem p6; 409 situação; 413 PDF grande.

Limitação conhecida: o módulo de Cobranças não tem campo de forma de pagamento (vai em `notes`) e só lista serviços já sincronizados
com a nuvem. Faturar não cria lançamento de receita; o recebimento continua sendo lançado como hoje.

### GET /api/servicos/:id/relatorio
HTML de 1 página (A4) pronto para imprimir/salvar em PDF: código, cliente, local, data, responsável, o que foi feito, itens feitos
do checklist, até 8 fotos (antes primeiro, embutidas), valor (só para quem tem p1; usa o valor faturado se houver) e aceite
(assinatura, nome, cargo, data/hora). **Nunca** traz gastos, resultado nem margem. Abra com fetch + token e mostre o HTML num
iframe/janela (`blob:`), depois `window.print()`.

## Serviço vindo do Orçamentos

Na importação (`/api/integracao/orcamentos/...`) com `costCenterKind = 'servico'` (raiz ou `options`), o centro novo recebe código
`SV-1` + dígitos do número da proposta com 3 casas (PROP-038 = SV-1038); se a proposta já tem 4 ou mais dígitos, `SV-` + dígitos
(PA-1003 = SV-1003). Código já usado: acrescenta `-2`, `-3`... Valor cobrado = valor final da proposta (`totals.contractValue`).
Código: `services/servicos/codigoProposta.js`.

## Descarte, restauração e sincronização

- `service_jobs` e `service_photos` entram no descarte/restauração da obra (`services/costCenterArchive.js`, STRUCTURE).
  Um serviço com gasto ativo ou NFS-e vinculada continua impedido de descartar (regra de movimento existente).
- Excluir o centro (rota antiga, só sem vínculos) apaga em cascata checklist, fotos e aceite.
- Sincronização entre instalações: só os campos de `cost_centers` (código, cliente, valor etc.) e os lançamentos viajam;
  situação, checklist, fotos, aceite e faturamento ficam na instalação onde foram feitos (no servidor central, que é o caso normal).

## Auditoria

`audit_log` com `entity_type = 'servico'` e `entity_id = publicId`: `criado`, `atualizado`, `situacao`, `checklist`, `checklist_item`,
`foto_adicionada`, `foto_removida`, `aceite_registrado`, `aceite_removido`, `gasto_lancado` (mais o `criado` do lançamento),
`concluido`, `faturado`.

## Celular sem internet (checklist, fotos e aceite)

O celular guarda estas alterações numa fila (`public/m/screen-servico-fila.js`, `queue.js`) e as envia em ordem quando a conexão volta. O servidor
precisa aceitar o mesmo envio mais de uma vez: `PATCH` do checklist grava o valor final, `POST` do checklist ignora `id` repetido, `POST` de foto
responde `409 Esta mesma foto já foi enviada.` para a foto repetida (o celular conta como enviada) e `PUT` do aceite substitui o anterior; o aceite
leva `dataHora` de quando o cliente assinou, não de quando o envio aconteceu.
