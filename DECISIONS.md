# Decisões técnicas

## 2026-09-29 — Recorrências da D5

- Cada lançamento recorrente registra o ID do modelo e o primeiro dia do mês gerado. Um índice único nesse par impede repetição mesmo sob concorrência; o nome visível não serve como identidade.
- A geração confere novamente o token da prévia dentro da transação e serializa geradores antes de calcular o plano.
- Modelos anteriores à migração guardam o último número de parcela já consumido. O histórico sem proveniência não é inferido pela descrição, e meses pulados após a migração continuam elegíveis.
- O índice único de CPF/CNPJ exige conciliar documentos legados duplicados antes de aplicar a migração 107 em uma base real.

## 2026-09-29 — Exclusão de centros de custo

- A exclusão física é permitida somente para administrador e para centros sem dados vinculados. O servidor verifica todos os vínculos diretos conhecidos dentro de uma transação e mantém o bloqueio por chave estrangeira como proteção adicional.
- A exclusão grava um tombstone pelo `public_id` na mesma transação. Importações CSV e pacotes de sincronização antigos não podem recriar esse centro nesta instalação, inclusive pela resolução manual de conflitos.
- A exclusão não é propagada para outras instalações. As duas interfaces informam esse alcance antes da confirmação; centros com histórico devem ser inativados.
