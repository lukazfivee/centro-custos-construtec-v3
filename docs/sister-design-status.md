Status: IMPLEMENTED — validação visual pendente
Responsável: LEAD-CODEX
Referência: Construtec orçamentos/construtec-orcamentos/src/index.css.
Escopo: proporções do shell, controles e superfícies; logo completo no login.
Registro local porque TASKS.md possui codificação incompatível com apply_patch.

Arquivos: public/suite-design.css e public/index.html.
Aplicado: shell 43px/118px, navegação 82px, botões de topo 34x32px,
perfil 27px, campos 38px, controles 36px, espaçamento interno 24x26px.
Logo completo no login desktop e móvel; símbolo no topo autenticado.
Validação: 80 arquivos JavaScript válidos. npm test: 113/116 aprovados.
Falhas em deep-link, código de suporte e mensagem de atualização; sem alterações
no JavaScript nesta tarefa. Comparação feita no código; não validada em navegador.

2026-09-14 15:35 BRT — Bolder global implementado nos dois sistemas.
Arquivos adicionais: public/suite-bolder.css e importação em public/index.html;
equivalente no Orçamentos em src/suite-bolder.css e src/renderer.tsx.
Hierarquia reforçada em títulos, ações, navegação, indicadores e tabelas.
Dimensões, logos e efeitos existentes preservados. Dashboard escuro conferido
no navegador; revisão visual completa das demais telas permanece pendente.
Testes Centro: 113/116; mesmas falhas de deep-link e mensagens registradas acima.
Orçamentos: typecheck e 20/20 testes críticos aprovados; lint bloqueado por
plugin import duplicado na configuração herdada da pasta superior.
