Status: IMPLEMENTED — revisão visual completa pendente
Responsável: LEAD-CODEX
Escopo: feedback de preenchimento e avisos nos dois sistemas, apenas CSS.
Arquivos: public/suite-bolder.css e equivalente src/suite-bolder.css no Orçamentos.
Registro local: TASKS.md e STATUS.md possuem codificação incompatível com apply_patch.

Aplicado: seleção azul, caret e foco de campos, avisos com quebra segura e
entrada de 160ms sem atraso; movimento removido com prefers-reduced-motion.
Não altera mensagens, duração dos avisos, botões, logos ou regras financeiras.
Validação: PostCSS parse aprovado, CSS idêntico nos dois sistemas.
Centro: npm test 113/116, mesmas três falhas anteriores.
Orçamentos: typecheck aprovado; test:critical 20/20; lint bloqueado pelo
plugin import duplicado. Centro recarregado no navegador; conferência dos
avisos em todos os fluxos, temas e dimensões ainda pendente.
