# P2 — Estorno formal e fechamento seguro

## Objetivo

Preservar o histórico financeiro quando um pagamento ou recebimento precisa ser cancelado, evitando apagar lançamentos já realizados e mantendo o efeito financeiro correto nos painéis.

## Estorno formal

- Administradores e gestores podem estornar lançamentos liquidados.
- O lançamento original permanece no banco e no histórico.
- O estorno cria um segundo movimento vinculado ao original, com o mesmo tipo, centro, categoria e valor.
- O novo campo `accounting_sign` controla o efeito financeiro: lançamento normal = `1`; estorno = `-1`.
- Apenas um estorno ativo é permitido por lançamento original.
- Um estorno não pode ser editado, excluído ou estornado novamente.
- Depois de estornado, o lançamento original também fica protegido contra edição e exclusão.
- O motivo e a data do estorno ficam registrados na auditoria.

## Indicadores

Dashboard, totais por obra e exportações gerenciais passam a considerar `valor × sinal contábil`. Assim, um estorno compensa o movimento original sem removê-lo da rastreabilidade.

## Competências fechadas

- O lançamento original pode estar em uma competência fechada.
- O estorno deve ser registrado em uma competência aberta.
- Criação, edição e exclusão continuam bloqueadas em meses fechados.
- Reaberturas permanecem restritas ao administrador e são registradas na auditoria com motivo.

## Interface de teste

A entrada `public/teste-chatgpt.html` carrega as melhorias P1 e P2 sem alterar o `index.html` principal.

Na tela de lançamentos:

- movimentos reversores aparecem com o selo `Estorno`;
- originais já compensados aparecem com o selo `Estornado`;
- pagamentos e recebimentos elegíveis recebem o botão `Estornar`;
- o usuário informa data e motivo antes da confirmação.

## Sincronização offline

O formato CSV de sincronização atual ainda não transporta o vínculo de estorno. Para evitar corrupção silenciosa, a exportação de sincronização é bloqueada quando a base contém estornos formais.

Essa proteção é intencional. A próxima evolução deverá criar um novo formato de sincronização que transporte sinal contábil, vínculo do estorno e demais metadados.

## Segurança dos dados

- A versão de teste continua usando porta `3334` e a pasta isolada `dados-chatgpt`.
- Nenhuma dependência nova foi adicionada.
- A branch principal `main` não é alterada por esta etapa.
