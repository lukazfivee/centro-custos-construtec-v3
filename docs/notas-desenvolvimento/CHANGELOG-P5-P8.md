# P5-P8 — Suíte final de evolução

## P5 — Produtividade
- sugestões por histórico de fornecedor/favorecido;
- categoria, centro e forma de pagamento mais usados;
- média, mínimo e máximo histórico;
- ações em massa para categoria, centro e situação financeira;
- visões salvas por usuário;
- rateio de um lançamento entre vários centros de custo;
- manutenção dos modelos recorrentes e parcelamentos existentes.

## P6 — Bancos e conciliação
- contas financeiras do tipo banco, caixa, cartão e adiantamento;
- importação de movimentos de extrato em lote;
- uso recomendado para exportação CSV da Cora;
- hash para impedir duplicidade de movimento importado;
- fila de conciliação;
- sugestões por valor, data e natureza;
- vínculo movimento bancário → lançamento.

## P7 — Gestão e inteligência local
- central de atenção;
- contas vencidas;
- lançamentos sem documento;
- possíveis duplicidades;
- centros acima do orçamento;
- pendências de conciliação;
- fluxo de caixa projetado em 7, 15, 30, 60 e 90 dias;
- Curva ABC de despesas;
- tendência por obra;
- histórico resumido de preços por fornecedor.

## P8 — Operação
- backup automático local;
- intervalo configurável entre 1 e 168 horas;
- retenção configurável entre 3 e 180 arquivos;
- SHA-256 para cada backup;
- execução manual sob demanda;
- encerramento seguro do agendador junto com o servidor.

## Interface de teste
A versão `teste-chatgpt.html` carrega um botão flutuante **Cockpit inteligente** com acesso às funções P5-P8, preservando a interface principal enquanto esta suíte permanece em validação.

## Limites conscientes
- o importador bancário espera movimentos já normalizados pela interface; integrações bancárias diretas via API não foram ativadas;
- inteligência é baseada em regras e estatística local, sem enviar dados financeiros para serviços externos;
- rateio está implementado na API e pode ganhar uma tela dedicada na integração definitiva;
- permissões por obra e aprovação por alçada têm base de dados preparada, mas não foram habilitadas como regra obrigatória para não alterar o fluxo atual sem validação dos usuários.
