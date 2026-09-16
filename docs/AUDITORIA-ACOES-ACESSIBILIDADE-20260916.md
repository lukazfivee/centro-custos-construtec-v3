# Auditoria de botões e ações — 16/09/2026

## Escopo

Auditoria do Centro de Custos online e dos controles gerados pelos módulos da suíte de orçamento. Foram inspecionados controles estáticos, ações de tabelas/cards, diálogos e navegação responsiva.

## Problemas encontrados e correções

| Problema | Por que era ambíguo | Correção entregue |
|---|---|---|
| Ações repetidas `Editar` e `Excluir` em tabelas e recorrências | O leitor de tela anunciava somente o verbo; em uma lista com vários registros não informava qual seria alterado | Nome acessível e tooltip com o tipo e o nome/descrição do registro |
| `Gerenciar` em relatos | O texto não dizia se abriria, excluiria ou alteraria o relato | Nome acessível com número e título; tooltip explica que permite alterar status e resposta |
| `Reabrir` competência | O efeito contábil não era visível no botão e o símbolo de fechar era ambíguo | Botão textual `Reabrir`, nome com competência e tooltip explicando que libera alterações |
| `Manter local` / `Aceitar recebido` em conflitos | O resultado da escolha sobre a outra versão ficava implícito | Texto e tooltip explicam qual versão será preservada/substituída |
| Cards de obras dependiam de clique no card | O card não comunicava para teclado que abria detalhes; o efeito também não era evidente para leitor de tela | Ação `Ver detalhes` com nome incluindo código/nome e tooltip com o conteúdo aberto; card continua clicável |
| Ícones e controles sem descrição contextual | O foco não apresentava uma descrição consistente | `title` + tooltip acessível no foco/hover, referenciado por `aria-describedby` |
| Foco pouco visível em superfícies claras e escuras | O contorno anterior podia se perder no fundo da suíte | `:focus-visible` com contorno de 3px e contraste adaptado à barra/sidebar |

## Critérios de validação

- Teclado: foco visível, menu mobile abre e fecha com `Escape`, menu de perfil fecha com `Escape` e devolve foco ao acionador; diálogos mantêm o foco dentro do modal e devolvem foco ao acionador ao fechar.
- Leitor de tela: controles com texto mantêm o texto visível como nome; ações repetidas recebem nome específico do registro; SVGs decorativos não são usados como nome.
- Mobile: alvos de botão/controle recebem no mínimo 44px nas superfícies de toque; o tooltip não aparece como requisito exclusivo, pois o nome acessível permanece disponível.
- Tooltip: aparece ao foco do teclado e ao apontar, desaparece ao perder foco, sair do controle, pressionar `Escape`, clicar ou rolar; o foco permanece no acionador.

## Evidência

Teste automatizado com Selenium em servidor local isolado, viewport 390×844: 22 controles visíveis inventariados, nenhum controle sem nome acessível após considerar texto visível, `aria-label` ou `title`; nenhum alvo visível abaixo de 24px; menu mobile abriu com `aria-expanded="true"`, recebeu foco inicial e fechou com `Escape`.

Teste de sintaxe: `node --check` em `app.js`, `action-help.js`, `navigation.js` e `modal-compat.js`.

Testes do projeto: `npm test` — 116 testes aprovados, 0 falhas.
