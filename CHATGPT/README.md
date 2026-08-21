# Área de trabalho do ChatGPT

Esta pasta identifica as melhorias desenvolvidas pelo ChatGPT para o projeto **Centro de Custos Construtec**.

## Isolamento

- Branch de desenvolvimento: `chatgpt/p0-base-solida`
- Branch principal preservada: `main`
- As alterações só devem chegar à `main` após revisão, testes e aprovação.

## Objetivo desta etapa

Construir uma base mais rápida, observável e segura antes da inclusão de módulos maiores. O primeiro pacote adiciona:

- métricas de requisições e banco de dados;
- identificação de requisições e logs estruturados;
- painel técnico administrativo;
- paginação opt-in na API de lançamentos;
- índices de desempenho;
- melhoria do dashboard por consultas paralelas;
- verificação SHA-256 dos backups;
- proteção adicional no fechamento mensal;
- testes automatizados e GitHub Actions.

Consulte `CHANGELOG-P0.md` para o detalhamento técnico e os critérios de validação.
