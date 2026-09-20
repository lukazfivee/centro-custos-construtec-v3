---
name: "Centro de Custos CONSTRUTEC"
description: "Painel operacional de obras, orçamentos e lançamentos financeiros da Construtec."
colors:
  navy: "#122036"
  navy-2: "#1b2c45"
  ink: "#172033"
  muted: "#596579"
  line: "#e4e6ea"
  control-border: "#8b96a7"
  canvas: "#f7f8fa"
  white: "#fefefe"
  surface-muted: "#f7f8fa"
  accent: "#085ce5"
  accent-dark: "#064bbd"
  green: "#14783c"
  red: "#b62e38"
  focus-ring: "#085ce5"
  budget-ink: "#0f172a"
  budget-slate: "#64748b"
  budget-slate-light: "#cbd5e1"
  budget-danger: "#dc2626"
  budget-success: "#059669"
  budget-info: "#0284c7"
  budget-warning: "#d97706"
typography:
  headline:
    fontFamily: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif'
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "normal"
  title:
    fontFamily: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif'
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif'
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  full: "50%"
spacing:
  xs: "5px"
  sm: "10px"
  md: "14px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#fff"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "7px 12px"
    height: "34px"
  button-secondary:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "7px 12px"
    height: "34px"
  kpi-card:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "15px 16px"
  table-card:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.md}"
---

# Design System: Centro de Custos CONSTRUTEC

## Overview

**Creative North Star: "Painel Operacional Construtec"** (mundo compartilhado com o Construtec Orçamentos)

A interface é um painel de gestão denso, orientado a tabelas e KPIs: navegação petróleo (`#122036`) fixa, área de trabalho quase branca e um único azul de ação (`#085ce5`) reservado para botões primários, seleção e foco. Este sistema foi alinhado intencionalmente ao Construtec Orçamentos numa auditoria anterior (`docs/IMPECCABLE-AUDIT-DESIGN-20260914.md`): mesma família tipográfica (IBM Plex Sans), mesma superfície plana sem sombra, mesmos raios discretos. Este DESIGN.md documenta esse mundo já existente no código (extensão, não redesign) e acrescenta o padrão mobile introduzido nesta sessão.

**Key Characteristics:**

- Operar > expressar: tabelas, KPIs e formulários densos são o produto; nada compete com a tarefa.
- Navegação petróleo escura persistente (topbar + sidebar), área de trabalho em papel quase branco.
- Azul Construtec (`#085ce5`) é a única cor de ação; verde e vermelho são estritamente semânticos (receita/despesa, ativo/inativo).
- Plano por padrão: sem sombra em superfícies permanentes; profundidade vem de linha e contraste tonal.
- Em telas até 800px, listas que eram tabelas largas virem cartões tocáveis (ver Layout e Components) — nunca alteram a versão desktop.

## Colors

### Primary
- **Azul Construtec** (`#085ce5`, hover `#064bbd`): ações primárias, item de navegação ativo, foco de teclado, links.

### Secondary
- **Verde de Integridade** (`#14783c`): receita, ativo, status positivo.
- **Vermelho de Alerta** (`#b62e38`): despesa, inativo, ação destrutiva.

### Neutral
- **Petróleo** (`#122036` / `#1b2c45`): topbar e sidebar.
- **Tinta** (`#172033`): texto de alta prioridade.
- **Cinza de Apoio** (`#596579`): rótulos, texto secundário.
- **Linha** (`#e4e6ea`) / **Borda de controle** (`#8b96a7`): divisores e bordas de input.
- **Papel** (`#f7f8fa`) / **Branco** (`#fefefe`): fundo de app e superfícies elevadas (cards, tabelas, painéis).

### Extensão: Módulo de Orçamento (paleta própria, documentada em 2026-09-20)
As telas do módulo de Orçamento (`budget-curves.css`, `budget-measurements.css`, `budget-portfolio.css`, `budget-reports.css`, `budget-view.css` — Curva S, Medições, Portfólio, Boletim/Relatório e Análise de Orçamento) usam uma paleta Tailwind própria, consistente entre si mas independente do sistema petróleo/azul acima. Auditoria de 2026-09-20 confirmou: não é bagunça de valores soltos, é um segundo sistema coerente, só que nunca documentado até agora.
- **Ardósia** (`#0f172a` escuro / `#64748b` médio / `#cbd5e1` claro): texto, ícones e bordas neutras dessas telas — equivalente funcional ao Tinta/Cinza de Apoio/Linha do sistema principal, mas em outra escala de cor.
- **Vermelho de Orçamento** (`#dc2626`): estouro de orçamento, variação negativa, exclusão.
- **Verde de Orçamento** (`#059669`): dentro do orçamento, variação positiva, curva ABC "C".
- **Azul de Orçamento** (`#0284c7`): informação neutra, curva ABC "A", medições em andamento.
- **Âmbar de Orçamento** (`#d97706`): atenção, curva ABC "B", pendências.

### Named Rules
**The One Action Rule.** O azul de ação aparece só em botão primário, seleção, foco e item de navegação ativo — nunca como preenchimento decorativo.
**The Budget Module Exception Rule.** A paleta "de Orçamento" acima só vale dentro dos arquivos `budget-*`. Nunca usar essas cores em telas do app principal, e nunca "corrigir" os arquivos `budget-*` para a paleta petróleo/azul sem uma decisão de design explícita — são dois sistemas cônscios coexistindo, não um erro a unificar por padrão.

## Typography

**Body Font:** IBM Plex Sans (com Segoe UI e system-ui como fallback), com numerais tabulares para valores monetários.

### Hierarchy
- **Headline** (700, 28px): título de página (`.page-head h1`).
- **Title** (700, 14px): títulos de painel e cartão.
- **Body** (400, 12px): tabelas, formulários, navegação.
- **Label** (700, 11px, uppercase): cabeçalho de tabela, rótulos de cartão mobile.

**Fontes fora do IBM Plex Sans (auditoria 2026-09-20):**
- `budget-reports.css` (Relatório Executivo/Boletim, documento de impressão — já fora de escopo operacional, ver Layout): usa pilha de fonte de sistema (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`) e monoespaçada (`ui-monospace, SFMono-Regular, ...`) para colunas numéricas/código — **intencional**, no espírito de um PDF exportado.
- `budget-measurements.css:28` (modal "Medições", tela operacional ao vivo, **não** é impressão): usa a mesma pilha de fonte de sistema em vez de IBM Plex Sans — **isso é deriva real, não uma exceção documentada**. Foi encontrado na auditoria de 2026-09-20 e ainda não corrigido; ver `docs/notas-desenvolvimento` para tratar como item de `/impeccable harden` ou `/impeccable typeset` numa próxima passada.

## Layout

Casca fixa de desktop (≥801px): topbar de 43px, sidebar de 118px (94px/80px em telas menores), área principal com scroll próprio. Em ≤800px, a casca vira coluna única: topbar de 60px, sidebar torna-se drawer (`position:fixed`, oculta por padrão), navegação inferior fixa.

**Listas e tabelas mobile (extensão, 2 rodadas nesta sessão):** qualquer tabela larga recebe a classe `cc-mobile-table` no `<table>`; dentro de `@media (max-width: 800px)`, cada `<tr>` vira um cartão (`border-radius: 10px`, borda `var(--line)`, fundo `var(--white)`) e cada `<td>` com `data-label` mostra um rótulo maiúsculo em cima e o valor embaixo (bloco simples, não lado-a-lado — respeita `<br>` e conteúdo de largura variável sem vazar) — o mesmo princípio de "tabela → cartão" usado no Construtec Orçamentos para a tela de itens da proposta. Aplicado em: `fornecedores`, `categorias`, `histórico`, `usuários`, `lançamentos` (list-panel), a "Planilha Analítica" do modal Orçado vs. Realizado, as duas tabelas do modal de Medições e a tabela de evolução mensal da Curva S. `centros-custo`, `recorrentes` e o dashboard de portfólio já usavam cartão/grid nativo (`.center-card`, `grid-template-columns: repeat(auto-fit, minmax(...))`) e não precisaram de conversão.
**Armadilha de flexbox a evitar:** um contêiner com `overflow: hidden` dentro de uma coluna flex com altura máxima definida (ex.: `.budget-curves-modal`) perde a proteção `min-height: auto` do flexbox e pode encolher para ~0px quando o conteúdo do cartão fica mais alto que a tabela original — a correção é `flex-shrink: 0` no contêiner afetado, dentro do media query mobile.
Fora de escopo (documento de impressão/exportação, não tela operacional): Relatório Executivo e Boletim de Medição (`budget-reports`) mantêm suas tabelas largas com scroll horizontal próprio, no mesmo espírito do PDF exportado do Orçamentos.

**Recursos ativados em 2026-09-18 (P2, P3, P4, Cobranças, Report V2, cloud-sync):** vários módulos tinham backend real, montado e testado, mas nenhum `<script src>` em `index.html` — por isso nunca apareciam na interface. Ativados nesta sessão: estorno de lançamento (P2, `chatgpt-p2.js`), painel de sincronização em pacote único (P3, `chatgpt-p3.js`), documentos/anexos por lançamento (P4, `chatgpt-p4.js`), tela "Cobranças" (`v3-1-enhancements.js`, exige conta `@rcconstrutec.com.br` — degrada com mensagem clara para outras contas), confirmação de entrega de bug reports (`report-v2.js`, substitui o `loadBugReports` original) e sincronização em segundo plano (`cloud-sync.js`). Todas as tabelas novas seguem o mesmo padrão `cc-mobile-table`/`data-label`. **Bug real corrigido na ativação:** essas telas chamavam sua API imediatamente ao carregar o script (antes do login), gerando erro 401 no console em qualquer página — corrigido com uma guarda `localStorage.getItem('cc_token')` antes de cada chamada eager.
**Não ativado, por instrução explícita do usuário:** o "Cockpit inteligente" (P5-P8, `chatgpt-final.js/css`) — backend real e testado, mas o botão flutuante foi removido de `index.html` a pedido do usuário; o arquivo continua no repositório, só não carregado.
**Não ativado, decisão de design pendente:** `v3-1-refinements.js/css` (tela "Clientes" + refinamentos de configurações) depende parcialmente de `v3-1-figma.css`, que é um re-skin visual completo do app (cantos arredondados 12px em cards/tabelas, navegação em pílula, sombra no hover) — conflita com a regra "Structure Before Softness" acima. Usuário viu um preview ao vivo (CSS injetado numa instância descartável) e decidiu manter o visual atual.

**The No-Scroll List Rule.** Nenhuma lista mobile força scroll horizontal; o conteúdo empilha verticalmente dentro do cartão.

## Elevation & Depth

Plano por padrão, igual ao Orçamentos: sem `box-shadow` em painéis, tabelas ou cartões permanentes. Os únicos elementos com sombra real são popover de perfil e menus flutuantes.

**Exceção do Módulo de Orçamento (2026-09-20):** os modais `budget-*` (Curva S, Medições, Portfólio, Relatório, Análise de Orçamento) usam sombras reais e pronunciadas nos seus cartões flutuantes (ex.: `0 25px 50px -12px rgba(0,0,0,.25)` em `budget-measurements.css`/`budget-reports.css`, `0 16px 40px rgba(0,0,0,.25)` em `budget-curves.css`) — consistente com a paleta e tipografia próprias desse módulo, tratado como overlay/modal (não superfície permanente), então não viola a regra acima, mas está fora da lista "popover/menu" já documentada; adicionado aqui para não ser confundido com deriva.

## Shapes

Raios discretos: `6px` em botões, inputs e cabeçalho de tabela; `8–10px` em painéis, KPIs, cartões de centro de custo e nos novos cartões de lista mobile; `50%` em avatares.

**Exceção do Módulo de Orçamento (2026-09-20):** os modais `budget-*` usam raios maiores e mais variados — `12px`/`14px` no contêiner do modal e cartões internos, até `9999px` (pill) em badges e chips de status (`budget-view.css`, `budget-portfolio.css`). Escopo isolado aos próprios arquivos `budget-*`, mesma regra do Módulo de Orçamento em Colors.

## Components

### Buttons
- **Shape:** raio de 6px, altura de 34px (desktop) / mínimo 44px de toque em ≤800px.
- **Primary:** fundo azul Construtec, texto branco; hover escurece para `#064bbd`.
- **Secondary:** fundo branco, borda `--control-border`.

### Pills / Status
- `.pill.success` (verde), `.pill.warning` (âmbar), `.pill.danger` (vermelho): status de lançamento, fornecedor e usuário.

### Table (desktop)
- Cabeçalho fixo em `--surface-muted`, linhas com hover leve, números com `font-variant-numeric: tabular-nums`.

### List Card (mobile, novo)
- Cartão por registro: borda 1px `--line`, raio 10px, fundo `--white`, padding 12–14px.
- Primeira coluna (nome/título do registro) sem rótulo, tamanho 14px — funciona como cabeçalho do cartão.
- Demais colunas: rótulo maiúsculo (11px, `--muted`) à esquerda, valor à direita.
- Ações: botões com altura mínima de 40px, alinhados à direita do cartão.

### KPI Cards
- Fundo branco, raio 8px, padding 15–16px; valor positivo em verde, negativo em vermelho.

## Do's and Don'ts

### Do:
- **Do** reservar o azul `#085ce5` só para ação primária, foco e navegação ativa.
- **Do** manter tabelas planas (sem sombra) no desktop.
- **Do** converter listas largas em cartões apenas dentro de `@media (max-width: 800px)`, nunca alterando o HTML/CSS lido pelo desktop.
- **Do** usar `data-label` nos `<td>` para dar rótulo acessível ao cartão mobile.

### Don't:
- **Don't** introduzir sombra em superfícies permanentes.
- **Don't** usar verde/vermelho fora do contexto semântico (receita/despesa, ativo/inativo).
- **Don't** aplicar a classe `cc-mobile-table` a tabelas ainda não revisadas linha a linha (módulo de orçamento/medições/contratos) sem antes conferir a estrutura de cada `<td>`.
- **Don't** misturar a paleta/tipografia/raios do Módulo de Orçamento (`budget-*`) com o resto do app, nem o contrário — são dois sistemas documentados, não uma inconsistência a resolver.
