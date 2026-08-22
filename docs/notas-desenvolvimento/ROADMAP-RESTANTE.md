# Melhorias restantes

Este documento registra o lote final de evolução do Centro de Custos Construtec após P0-P4.

## P5 - produtividade financeira
- ações em massa em lançamentos;
- sugestões inteligentes de categoria/centro/fornecedor com base no histórico;
- detecção simples de valor fora do padrão;
- modelos recorrentes e parcelamentos já existentes consolidados na interface;
- rateio de uma despesa entre centros de custo;
- visões salvas no navegador.

## P6 - bancos e conciliação
- contas bancárias/caixas;
- importação de extrato CSV genérico e perfil Cora;
- fila de movimentações sem conciliação;
- sugestão de correspondência por valor/data/favorecido;
- vínculo com lançamento existente;
- criação de lançamento a partir de movimento bancário;
- alerta de possíveis duplicidades.

## P7 - gestão e inteligência local
- central de atenção;
- fluxo de caixa projetado 7/15/30/60/90 dias;
- tendência por obra;
- curva ABC de despesas;
- histórico de preços por fornecedor;
- indicadores de documentação pendente;
- resumo gerencial local sem API externa.

## P8 - operação e segurança
- backup automático agendável;
- retenção configurável;
- verificação de backup;
- exportação de diagnóstico;
- verificação de espaço livre;
- permissões por obra e limite de aprovação como base de expansão.

As entregas são mantidas em branches separadas da `main` e validadas pelo GitHub Actions antes de integração.
