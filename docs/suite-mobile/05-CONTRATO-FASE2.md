# Contrato da Fase 2: lançamentos feitos no celular (inclusive offline)

Base: o Centro de Custos web (Express), atrás do Worker `centro-custos-api`. Autenticação `Authorization: Bearer <cc_token>`, o mesmo token do site. Os erros do Express vêm como `{ requestId, erro }`, com a mensagem em pt-BR.

Decidido com o Lucas em 26/09/2026:
- a foto da nota é anexada e os campos são digitados (sem leitura automática da nota);
- a despesa usa a categoria atual, não o item do orçamento.

## 1. Criar lançamento sem duplicar

`POST /api/lancamentos` aceita um campo opcional `client_id`, um UUID gerado no celular quando a despesa é salva.

- **Primeiro envio:** 201 `{ id, public_id }`, como antes.
- **Reenvio com o mesmo `client_id` e os mesmos dados** (tipo, obra, valor, data e descrição): 200 `{ id, public_id, replayed: true, excluido: false }`. O lançamento não é duplicado.
  - Se o lançamento tiver sido excluído depois, responde 200 com `excluido: true` e não recria.
- **Mesmo `client_id` com dados diferentes:** 409 "Este identificador já foi usado em outro lançamento."
- **`client_id` inválido:** 400.
- **Sem `client_id`:** tudo funciona como antes.
- O identificador vale por usuário (`created_by`). O banco garante isso com o índice único `transactions_client_id_unique` (migração `106_transaction_client_id.sql`).

## 2. Anexar a foto sem duplicar

`POST /api/anexos/lancamento/:id` já existia, com o mesmo formato (`{ nome, tipo, categoria, observacao, conteudoBase64 }`, até 8 MB, pdf/jpeg/png/webp).

- Reenviar o mesmo arquivo responde **409 "Este mesmo arquivo já está anexado"**, por causa do sha256. A fila do celular trata esse 409 como "já enviado".
- O celular reduz a foto antes de guardar, para ficar bem abaixo do limite.

## 3. Ordem da fila no celular

Cada item da fila guarda o `client_id`, os dados da despesa e a foto já reduzida.

1. `POST /api/lancamentos` com o `client_id`. Tanto 201 quanto 200 devolvem o `id`.
2. Se houver foto, `POST /api/anexos/lancamento/:id`. Tanto 201 quanto 409 contam como sucesso.
3. Só então o item sai da fila.

Se o app cair no meio, o reenvio refaz a partir do passo 1 sem duplicar nada.

Tratamento de erros:
- **409 de conflito, 400 ou 403** (por exemplo, competência fechada): o item fica marcado com erro para a pessoa corrigir; não há nova tentativa automática.
- **401:** a fila espera o próximo login.
- **Falha de rede e 5xx:** o celular tenta de novo mais tarde.
