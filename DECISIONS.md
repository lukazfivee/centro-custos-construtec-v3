# Decisões técnicas

## 2026-09-29 — Exclusão de centros de custo

- A exclusão física é permitida somente para administrador e para centros sem dados vinculados. O servidor verifica todos os vínculos diretos conhecidos dentro de uma transação e mantém o bloqueio por chave estrangeira como proteção adicional.
- A exclusão grava um tombstone pelo `public_id` na mesma transação. Importações CSV e pacotes de sincronização antigos não podem recriar esse centro nesta instalação, inclusive pela resolução manual de conflitos.
- A exclusão não é propagada para outras instalações. As duas interfaces informam esse alcance antes da confirmação; centros com histórico devem ser inativados.
