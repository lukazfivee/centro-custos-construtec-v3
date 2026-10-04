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

## 2026-10-04 — Configurações do desktop (D7)

- A senha mínima continua em 10 caracteres (e não 8, como no desenho): o servidor local e o Worker central já exigem 10, e baixar só na tela criaria erro no envio.
- Trocar a senha no modo local encerra as outras sessões (coluna `sessions_valid_from`, migração 112) e devolve um token novo para a sessão atual; no modo nuvem a revogação já é feita pelo Worker.
- Restaurar uma cópia guardada salva antes uma cópia do estado atual e exige digitar RESTAURAR (só admin).
- O telefone do perfil passa a ser guardado no usuário local (migração 112).
