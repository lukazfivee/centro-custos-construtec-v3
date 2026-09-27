# Plano de fases do desktop

Uma fase por branch e por PR, nesta ordem. Cada fase só começa depois do merge da anterior, ou partindo da branch dela, se o Lucas pedir. Os caminhos abaixo supõem a decisão 1 do prompt (app novo em `public/d/`). Se o Lucas escolher outra, ajuste os caminhos e mantenha a divisão.

Em todas as fases, para dar como pronta:

- `npm test` e `npm run check` verdes, com testes novos para o que mudou no servidor;
- cada tela da fase conferida contra o print, em 1440 × 900 e 1280 × 800, tema claro e escuro;
- teclado: Tab chega em tudo, Esc fecha painel e diálogo, foco visível;
- nenhum arquivo acima de 350 linhas, nenhum emoji ou glifo no lugar de ícone, nenhuma data ISO na tela;
- `STATUS-CLAUDE.md` atualizado.

---

## D0 · Base do app e estrutura

**Branch:** `feat/desktop-base`

**Entrega:**

- **Rota e arquivos:**
  - rota `/d/` no `server.js`, igual à do `/m/`;
  - `public/d/index.html` com a fonte IBM Plex e os ícones Phosphor embutidos (copie de `public/m/fonts/` e de `docs/suite-desktop/prototipo/vendor/`).
- **Núcleo `public/d/core.js`:**
  - reaproveite ou compartilhe com `public/m/core.js` as funções de sessão, API, dinheiro (HALF_UP), datas, tema e UUID;
  - se compartilhar, mova para `public/shared/` sem quebrar o `/m/`, com teste.
- **CSS:** a partir de `prototipo/desktop-base.css`, dividido em arquivos pequenos (tokens, base, componentes, animações).
- **Estrutura da tela:**
  - menu lateral com grupos e a função `pode()`;
  - barra do topo com busca global que abre o item, selo de sincronização real, Suíte, tema e sair;
  - roteador por hash (`#/lancamentos`, `#/obras/12/medicoes`).
- **Componentes:**
  - painel lateral, com Esc, clique fora e aviso de alteração não salva;
  - diálogo de confirmação;
  - toast;
  - animação de sucesso (reaproveite `public/m/anim.css`);
  - cartão de KPI, tabela, segmentado, chip de situação, campo com erro.
- **Sessão:** login e handoff com a mesma sessão do Centro de Custos web (`cc_token`). Sem sessão, mandar para o login atual.
- **Telas ainda não feitas:** abrem uma página "em construção" com o link para a tela equivalente do sistema antigo.

**Pronto quando:** navegar por todo o menu sem erro no console, trocar o tema, a busca abrir um lançamento e uma obra, e o selo mudar ao desligar a rede.

## D1 · Início

**Branch:** `feat/desktop-inicio`

- Painel financeiro completo (seção 1 da espec), com os filtros de obra e mês.
- Lançamento rápido no painel lateral (print 13), com a animação de sucesso.
- Banner de primeiro uso.
- Conferir que o campo `orcamento` da obra chega no painel (problema 3).

**Pronto quando:** os números batem com o painel atual para o mesmo mês e a mesma obra, em pelo menos três combinações.

## D2 · Lançamentos

**Branch:** `feat/desktop-lancamentos`

- Lista com todos os filtros (os do print e os de hoje), ordenação, paginação, total e CSV, sem loop de requisições.
- Novo, editar, documentos, estorno e excluir (prints 14 a 20).
- Mês fechado (prints 73 e 74), usando o 403 do servidor e a lista de fechamentos.
- Sem internet: decisão com o Lucas (fila como no celular ou salvar desabilitado).

**Pronto quando:** criar, editar, anexar, estornar e excluir funcionam contra o servidor local, e os erros do servidor aparecem no topo do painel, com os campos marcados.

## D3 · Obras

**Branch:** `feat/desktop-obras`

- Carteira com KPIs, alerta, filtro e cartões (print 30). Nova e editar obra no painel.
- Detalhe em página com as 5 abas (prints 31 a 35), mais o relatório executivo e a importação do orçamento.
- Vincular gastos sem vínculo a insumos.

**Pronto quando:** uma obra importada do Orçamentos mostra planilha, medições e Curva S com os mesmos valores do sistema atual.

## D4 · Cobranças

**Branch:** `feat/desktop-cobrancas`

- Depende da decisão 3 (por medição ou por obra).
- Lista, acompanhar em 4 passos, e-mail ao cliente com "Enviar" salvando antes, vencida, e financeiro pedindo autorização (prints 40 a 44).
- Servidor: o que a decisão pedir, mais o "pedir autorização".

**Pronto quando:** o fluxo rascunho, autorizar e enviar funciona de ponta a ponta com o provedor de e-mail em modo de teste, e um e-mail sem NF é barrado com o aviso.

## D5 · Cadastros

**Branch:** `feat/desktop-cadastros`

- **Telas:** Categorias, Fornecedores e Recorrentes (prints 50 a 59).
- **Servidor:**
  - cor e descrição na categoria;
  - validação e duplicidade de CPF/CNPJ;
  - resumo do mês por categoria e por fornecedor;
  - prévia do "gerar recorrentes";
  - quinzenal, se aprovado.
- **Botão "Gerar lançamentos do mês"** com a prévia e o estado "já gerado".

**Pronto quando:** gerar duas vezes no mesmo mês não duplica, e um CNPJ repetido é recusado com o nome de quem já tem o documento.

## D6 · Usuários, papéis e permissões

**Branch:** `feat/desktop-usuarios`

- **Primeiro o servidor:**
  - seis papéis;
  - matriz de permissões com `exigirPermissao`;
  - obras por usuário;
  - apps por usuário;
  - convite por e-mail com o código da empresa;
  - último acesso.
- Migrações só aditivas, com o mapeamento de `supervisor` aprovado pelo Lucas.
- **Depois as telas** (prints 60 a 67), incluindo "Ver o sistema como".
- **Teste por papel:** para cada um dos seis, o que aparece no menu e o que o servidor recusa.

**Pronto quando:** um técnico de campo com duas obras só vê essas duas no painel, na lista e nas obras, e recebe 403 ao tentar outra por URL.

## D7 · Fechamento, Histórico, Reports e Configurações

**Branch:** `feat/desktop-ferramentas`

- **Fechamento mensal (prints 70 a 75):**
  - checklist;
  - fechar com pendências;
  - reabrir com motivo de 10 ou mais caracteres.
- **Histórico (prints 76 a 79):** filtros por pessoa e período, antes → depois, origem e CSV.
- **Reports (prints 80 a 83):** fila offline e diagnóstico.
- **Configurações (prints 90 a 95):**
  - perfil com foto e telefone;
  - senha que encerra as outras sessões;
  - backup com a cópia antes de restaurar;
  - sistema com a versão real.

**Pronto quando:** fechar setembro, tentar editar um lançamento de setembro (recusado), reabrir com motivo e ver as três ações no Histórico, com a origem.

## Depois de D7: troca do padrão

- Rodar o roteiro completo de todas as telas com o Lucas.
- `/` passa a abrir o desktop novo, e o antigo fica em `/classico/` durante um período combinado.
- O app Windows (Electron) abre `/` como hoje, então passa a usar o novo sem mudança.
- Conferir a versão na nuvem (`cloudflare/center-container`) servindo o `public/d/`.
- Remover do novo qualquer link para `/classico/`, quando o Lucas decidir.

## Orçamentos

O desktop do Orçamentos ainda não foi desenhado: o login dele na nuvem estava com erro na captura. Fica para uma rodada própria do canvas, depois destas fases.
