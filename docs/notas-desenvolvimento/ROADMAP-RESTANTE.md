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

**Nota de 2026-09-18:** o backend de P5-P8 já existe, está montado (`routes/productivity.js`, `routes/banking.js`, `routes/insights.js`, `routes/backupAuto.js`) e é validado por teste automatizado (`test/p5-p8-final.test.js`). Existe também uma interface pronta ("Cockpit inteligente", `public/chatgpt-final.js/css`) cobrindo as 5 sub-áreas (P5 produtividade/ações em massa, P6 bancos/conciliação, P7 fluxo de caixa/ABC/tendência, P8 backup automático) — mas ela não está referenciada em `index.html`, então nunca aparece no app real. Nesta sessão o usuário viu o Cockpit funcionando numa instância de teste e pediu para não ativá-lo; ele continua no repositório, pronto para ativação futura caso o usuário decida (bastam duas linhas em `index.html`: `<link>` do CSS e `<script>` do JS).

## P9 - acesso móvel
- concluído na RC10: interface responsiva (casca: topbar, sidebar/drawer, dashboard), navegação inferior e aplicativo Android;
- concluído na RC10: conexão na rede local com ativação explícita e autenticação normal do sistema;
- concluído na RC10: cliente aceita endereço HTTPS protegido para acesso remoto;
- concluído em 2026-09-18: listas que ainda eram tabelas largas no mobile (fornecedores, categorias, histórico, usuários, lançamentos) convertidas em cartões tocáveis, sem scroll horizontal forçado; obras/centros de custo e recorrências já usavam cartão nativo;
- pendente: telas de orçamento, medições e contratos (módulo `budget-view`) ainda não adaptadas para mobile — mesmo levantamento em `HANDOFF-MOBILE-PARIDADE-DUPLA.md` (raiz do workspace);
- futuro: hospedagem centralizada para funcionar sem depender do computador da empresa ligado.

As entregas são mantidas em branches separadas da `main` e validadas pelo GitHub Actions antes de integração.
