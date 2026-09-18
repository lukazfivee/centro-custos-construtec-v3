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

### Named Rules
**The One Action Rule.** O azul de ação aparece só em botão primário, seleção, foco e item de navegação ativo — nunca como preenchimento decorativo.

## Typography

**Body Font:** IBM Plex Sans (com Segoe UI e system-ui como fallback), com numerais tabulares para valores monetários.

### Hierarchy
- **Headline** (700, 28px): título de página (`.page-head h1`).
- **Title** (700, 14px): títulos de painel e cartão.
- **Body** (400, 12px): tabelas, formulários, navegação.
- **Label** (700, 11px, uppercase): cabeçalho de tabela, rótulos de cartão mobile.

## Layout

Casca fixa de desktop (≥801px): topbar de 43px, sidebar de 118px (94px/80px em telas menores), área principal com scroll próprio. Em ≤800px, a casca vira coluna única: topbar de 60px, sidebar torna-se drawer (`position:fixed`, oculta por padrão), navegação inferior fixa.

**Listas e tabelas mobile (extensão, 2 rodadas nesta sessão):** qualquer tabela larga recebe a classe `cc-mobile-table` no `<table>`; dentro de `@media (max-width: 800px)`, cada `<tr>` vira um cartão (`border-radius: 10px`, borda `var(--line)`, fundo `var(--white)`) e cada `<td>` com `data-label` mostra um rótulo maiúsculo em cima e o valor embaixo (bloco simples, não lado-a-lado — respeita `<br>` e conteúdo de largura variável sem vazar) — o mesmo princípio de "tabela → cartão" usado no Construtec Orçamentos para a tela de itens da proposta. Aplicado em: `fornecedores`, `categorias`, `histórico`, `usuários`, `lançamentos` (list-panel), a "Planilha Analítica" do modal Orçado vs. Realizado, as duas tabelas do modal de Medições e a tabela de evolução mensal da Curva S. `centros-custo`, `recorrentes` e o dashboard de portfólio já usavam cartão/grid nativo (`.center-card`, `grid-template-columns: repeat(auto-fit, minmax(...))`) e não precisaram de conversão.
**Armadilha de flexbox a evitar:** um contêiner com `overflow: hidden` dentro de uma coluna flex com altura máxima definida (ex.: `.budget-curves-modal`) perde a proteção `min-height: auto` do flexbox e pode encolher para ~0px quando o conteúdo do cartão fica mais alto que a tabela original — a correção é `flex-shrink: 0` no contêiner afetado, dentro do media query mobile.
Fora de escopo (documento de impressão/exportação, não tela operacional): Relatório Executivo e Boletim de Medição (`budget-reports`) mantêm suas tabelas largas com scroll horizontal próprio, no mesmo espírito do PDF exportado do Orçamentos.

**The No-Scroll List Rule.** Nenhuma lista mobile força scroll horizontal; o conteúdo empilha verticalmente dentro do cartão.

## Elevation & Depth

Plano por padrão, igual ao Orçamentos: sem `box-shadow` em painéis, tabelas ou cartões permanentes. Os únicos elementos com sombra real são popover de perfil e menus flutuantes.

## Shapes

Raios discretos: `6px` em botões, inputs e cabeçalho de tabela; `8–10px` em painéis, KPIs, cartões de centro de custo e nos novos cartões de lista mobile; `50%` em avatares.

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
