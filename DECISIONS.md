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

## 2026-10-04 — Revisão de segurança do Centro

- Sincronização e cadastros: exportar e importar passam a exigir permissão (p9 para ler pacote, histórico e conflitos do pacote inteligente; p5 para importar pacote e cadastros; p3 para a troca CSV de lançamentos e a resolução de conflitos). Histórico, update e POST de aparência exigem p9.
- Integração com o Orçamentos: as leituras por sessão de usuário exigem p10 e acesso à obra do contrato; a chave de serviço continua entrando como admin. A chave de integração padrão é pública no repositório, então no modo local ela só vale vinda do loopback; `CONSTRUTEC_INTEGRATION_LOOPBACK_ONLY=false` (valor explícito) desliga a exigência. Na nuvem a exigência segue opcional (`true`), pois o tráfego chega pelo Worker e a chave é forte.
- Handoff por app: o Worker envia `suiteRole` e `apps` ao Container e ao Orçamentos. No espelho, conta nova sem papel da Suíte é tratada como o papel antigo (supervisor = técnico) e nasce sem acesso a todas as obras; contas antigas não mudam.
- CSV: células de texto que começam com = + - @ (ou tab/CR) ganham apóstrofo; números, inclusive negativos, não são alterados.
- Aviso de resposta do cliente (Orçamentos): a chave de deduplicação passa a usar o minuto, e não o instante, para que um reenvio não duplique o aviso.

Pendências registradas (exigem decisão de produto ou de desenho, fora desta correção):

- A4: limite de tentativas de login do Worker conta pelo IP do Container; precisa definir o que contar (IP do cliente repassado ou limite por conta).
- M1: aplicar a lista `apps` (quem pode entrar em qual app) nas rotas.
- M4: fornecedores por obra (hoje o cadastro é global; escopo de obra não se aplica).
- M5 e M8: itens da revisão independente que dependem de decisão de produto; detalhar antes de implementar.
