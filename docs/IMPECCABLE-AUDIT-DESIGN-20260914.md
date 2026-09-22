# Auditoria de design — CC-AUDIT-DESIGN-20260914

## Referência

Comparação somente leitura com `Construtec orçamentos/construtec-orcamentos`, usando `DESIGN.md` e `src/index.css`. O padrão é IBM Plex Sans, bancada plana, azul/ciano reservado a ações, estados semânticos e numerais tabulares.

## Achados e correções

- `public/style.css`: consolidada a camada visual compartilhada (tokens, tipografia, foco, raios e superfícies) e neutralizados gradientes/sombras legados em navegação, modal e login.
- `public/style-base.css`: regras antigas continuam como fallback, mas os seletores divergentes mais visíveis são sobrescritos pela folha final carregada no HTML.
- `public/index.html` / `public/app.js`: controles de tema e reporte deixaram símbolos emoji; navegação móvel usa um único sincronizador.
- `public/list-filters.js`: soma de lançamentos respeita `sinal_contabil`, mantendo o total exibido coerente com reversões.

## Validação

- `npm test`: suíte completa aprovada (116/116).
- `npm run check`: 80 arquivos sem erros.
- `node --check`: scripts alterados válidos.
- `impeccable detect`: executado uma vez sobre os alvos finais; achados restantes são de baixo impacto e dependem de componentes legados fora do escopo funcional.
- Prévia visual local conferida em login e dashboard com o referencial Construtec.

Rotas, serviços, banco de dados, Electron e lógica de negócio não foram alterados.
