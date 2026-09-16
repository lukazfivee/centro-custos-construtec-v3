# Auditoria de acessibilidade — ações de orçamento

Escopo: controles e semântica de diálogo em `public/budget-*.js`. A aparência, os handlers e a lógica de negócio foram preservados.

## Problemas encontrados e correções

| Grupo | Arquivos | Problema | Correção aplicada |
| --- | --- | --- | --- |
| Fechamento de diálogos | `budget-curves.js`, `budget-measurements.js`, `budget-reports.js` | Controles somente por ícone tinham nomes genéricos ou não tinham dica visual; os diálogos não tinham título associado de forma consistente. | Rótulos ARIA específicos, `title` útil, `role="dialog"` no painel real, `aria-modal` e `aria-labelledby`; foco inicial no botão de fechamento. |
| Ações repetidas por registro | `budget-measurements.js` | Vários botões “Emitir Boletim” eram indistinguíveis para leitor de tela. | Cada botão informa número e período da medição, mantendo o texto visível e o mesmo handler. |
| Ações repetidas por lançamento | `budget-view.js` | Vários botões “Vincular a Insumo” não identificavam qual lançamento seria alterado. | Nome acessível com a descrição da despesa e `title` explicando que o item do orçamento será escolhido. |
| Exportação e impressão | `budget-view.js`, `budget-reports.js` | O efeito de baixar CSV, imprimir/salvar PDF e abrir relatórios era pouco explícito para tecnologia assistiva. | `aria-label` e `title` descrevem formato e efeito da ação. |
| Importação e confirmação | `budget-view.js` | “Confirmar Ingestão”, “Confirmar integração” e seleção de arquivo não explicavam claramente a consequência. | `type="button"`, `aria-label`/`title` contextuais para selecionar, cancelar e confirmar a importação. |
| Navegação de medições | `budget-measurements.js` | Abas tinham estado visual, mas não expunham o padrão de tabs ao leitor de tela. | `role="tablist"`, `role="tab"`, `aria-selected` inicial e atualização do estado ao trocar de aba. |
| Botões criados por script | `budget-view.js` | Ações injetadas dependiam apenas do texto e não declaravam explicitamente tipo/objetivo. | `type="button"` e `title` contextual nos botões de detalhe e importação. |

## Verificações

- `npm run check` — aprovado: 80 arquivos JavaScript verificados.
- Todos os arquivos `public/budget-*.js` permanecem com menos de 350 linhas.
- A revisão do diff ficou limitada aos cinco arquivos de orçamento e este relatório; alterações concorrentes preexistentes nos arquivos-alvo foram preservadas.
