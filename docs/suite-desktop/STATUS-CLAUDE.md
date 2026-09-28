# Status: Claude Code (desktop do Centro de Custos)

Fase atual: D1 pronta, aguardando revisão do Lucas · Branch: `feat/desktop-inicio` (worktree `../wt-cc-desktop`)

## Última atualização

- Data e hora (BRT): 28/09/2026
- Commit base: `2401583` (`origin/main`, com a D0 mergeada pelo PR #57)

## Decisões do Lucas

Respostas às 6 perguntas do `PROMPT-CLAUDE-CODE.md` (27/09/2026, "ok para tudo recomendado"):

1. **Onde fica o desktop novo:** `public/d/`, servido em `/d/`. O `/` atual não muda até todas as fases estarem prontas.
2. **Papéis:** ficam para a D6. A migração vai mapear `supervisor` para `tecnico` e criar a tabela de permissões por papel. Até lá o menu usa os 3 papéis de hoje.
3. **Cobranças:** por obra, com os 4 passos montados a partir das situações que já existem (a faturar, NF emitida, enviada, aguardando pagamento, pago). Cobrança por medição fica para depois, se fizer falta.
4. **Recorrentes quinzenais:** saem do protótipo. Só voltam, na D5, se aparecerem custos quinzenais de verdade.
5. **Visibilidade por obra:** entra na D6, junto com os papéis e os testes de 403 por URL.
6. **Aba Sincronização:** sai do menu. As rotas `/api/sincronizacao*` continuam no servidor até a troca do `/` pelo novo.
7. **Lançamento rápido (D1, 28/09/2026):** segue o protótipo. Sem o campo de fornecedor, que volta pelo Editar na D2. Com competência e vencimento escolhidos pela pessoa.

## Feito

### D1 · Início (painel financeiro)

- **Servidor (`routes/dashboard.js`, sem migração):**
  - `qtdRecebidos` e `qtdPagos`: recebimentos e despesas liquidadas no mês, sem contar os estornos;
  - `ultimosLancamentos` passa a trazer favorecido, documento, data de pagamento e código da obra;
  - novo parâmetro opcional `meses=` (de 1 a 24). Sem ele continuam os 6 meses de sempre, para o painel atual não mudar; o desktop novo pede 12.
- **Telas (`public/d/telas/`):**
  - `inicio.js`: cabeçalho, filtro de obra (as ativas), filtro de mês (os últimos 24) guardados no endereço (`#/inicio?mes=&obra=`), e os 6 cartões com os tons do protótipo;
  - `inicio-graficos.js`: evolução de 12 meses em SVG, com eixo em "mil", mais as médias e a margem média;
  - `inicio-blocos.js`:
    - atividades recentes (6), e clicar numa abre o lançamento;
    - obras com realizado × orçado, nas cores da regra (até 80%, acima de 80%, acima de 100%);
    - despesas por categoria (top 8);
    - banner de primeiro uso com os mesmos passos e a mesma chave local do sistema atual;
  - `lancamento-rapido.js`:
    - o print 13, com validação e as mensagens do protótipo;
    - envia com `client_id`, sem duplicar no clique duplo;
    - erro do servidor no topo do painel, inclusive mês fechado;
    - tela de sucesso do print 16, com "Lançar outro";
    - o painel de baixo atualiza sozinho;
  - `lancamento-ver.js`: o painel de leitura do lançamento, agora usado pela busca e pelo Início.
- **Componentes:** o painel lateral ganhou `cabecalho()` e `botoes()`, e o KPI separa o tom do ícone do tom do valor.
- **CSS:** `css/inicio.css`.
- **Testes:**
  - `test/dashboard-desktop-inicio.test.js`: contagens com estorno, contagens por obra, campos das atividades, 6 e 12 meses, e 400 para `meses` fora do intervalo;
  - mais um teste de estrutura da D1 em `test/desktop-web-structure.test.js`.

### D0 · Base do app e estrutura

- **Servidor (`server.js`):** `/d` redireciona para `/d/`, e `/d/` entrega `public/d/index.html` sem cache, igual ao `/m/`. Nenhuma rota de API nova e nenhuma migração.
- **`public/d/`:**
  - `index.html`. Carrega o `/m/core.js` sem cópia (sessão `cc_token`, API, centavos HALF_UP, datas, UUID, aviso rápido). A fonte Plex vem de `/m/fonts/`.
  - `vendor/phosphor/` (regular e fill, com a licença MIT), `logo-fundo-escuro.png` e `simbolo.png`.
  - `d-core.js`: ícones, datas em dd/mm/aaaa, papel, `pode()`, tema e foco preso no painel e no diálogo.
  - `ui.js`: cabeçalho, KPI, chip de situação, segmentado, campo com erro, tabela, vazio e faixa.
  - `dialogo.js`: `CC.d.confirmar` e `CC.d.avisar`, no lugar de `alert`, `confirm` e `prompt`.
  - `painel.js`: painel lateral de 500 px. Fecha com Esc, clique fora e X, e pergunta antes se houver alteração não salva. Tem erro no topo, campos marcados e a animação de sucesso.
  - `router.js`: navegação por hash (`#/lancamentos`, `#/obras/12/medicoes`, `?id=`). Não desenha uma tela antiga por cima da nova.
  - `shell.js`: o menu lateral com os grupos, que só mostra o que o papel pode usar, a pessoa logada com foto ou iniciais, e Sair com confirmação.
  - `suite.js`: o menu Suíte, com os mesmos endereços de hoje e o Webmail UOL.
  - `busca.js`: Ctrl K, a partir de 2 letras. Obras (nome, código e cliente) e lançamentos (descrição e favorecido). Setas e Enter funcionam, e o resultado abre o item.
  - `selo.js`: o selo de sincronização real, rodando a mesma sincronização do `public/cloud-sync.js` (a cada 30 s, no foco e ao voltar a rede).
  - `telas/em-construcao.js`: cada tela ainda não feita mostra o que vai ter, a fase, e o link para o sistema atual. Também abre o lançamento (painel com os dados) e a obra vindos da busca, e mostra "Sem acesso" para quem não pode.
  - `app.js`: entrada. Faz o handoff da Suíte (`#handoff=`), manda para `/` quando não há sessão e confere o papel pelo `/api/auth/me`.
- **CSS:** `css/tokens.css`, `base.css`, `layout.css`, `componentes.css` e `anim.css`, a partir do `prototipo/desktop-base.css`. Abaixo de 1280 px o menu recolhe para ícones.
- **Menu por papel (regras de hoje mantidas):**
  - Cobranças: só e-mail `@rcconstrutec.com.br`.
  - Recorrentes e Usuários: só admin.
  - Fechamento mensal e Histórico: só admin, como no desenho. Hoje não estão no menu.
  - Reports e Configurações: todos, como hoje.
- **Testes novos:**
  - `test/desktop-web-structure.test.js` (7 testes): até 350 linhas, sem emoji ou glifo, sem `alert`, `confirm` ou `prompt`, sem CDN, todos os scripts carregados, núcleo reaproveitado, menu por papel, escape dos textos da API e rota no servidor.
  - `test/desktop-route.test.js`: `/d` dá 301, `/d/` sem cache, os arquivos do `/d/` e do `/m/` respondem, e o `/` continua o atual.

## Como validei

### D1

- `npm run check`: 138 arquivos. `npm test`: **285 testes, 285 passando**.
- **Números:** o Início novo bate com o painel atual nos 6 números, nos meses 09/2026, 08/2026 e 07/2026 com todas as obras. Com obra filtrada, bate com a API em 09/2026 nas obras 1 e 2, e em 08/2026 na obra 2. O filtro de obra do painel atual veio vazio (ver achados), por isso a comparação por obra foi contra a API.
- **Lançamento rápido:**
  - validação com descrição e valor vazios;
  - registrar como Pago mostra a animação e o resumo, e o painel atualiza;
  - num mês fechado (08/2026) aparece a mensagem do servidor no topo do painel;
  - Esc pergunta "Descartar as alterações?".
- **Prints:** 36 em `validacao/D1/` (1440 × 900 e 1280 × 800, claro e escuro): painel, painel rolado, uma obra, agosto, primeiro uso, lançamento rápido, validação, registrado e atividade aberta.
- Em 1280 × 800 os 6 cartões ficam em duas fileiras de 3, para os valores grandes não ficarem cortados.

### D0

- `npm run check`: 133 arquivos JavaScript verificados. `npm test`: **283 testes, 283 passando**.
- Servidor local com banco temporário e dados de exemplo, na porta 3391, no Chrome:
  - navegar pelos 11 itens do menu sem erro no console;
  - rota inexistente mostra "Esta tela não existe";
  - a busca "seg" lista 2 lançamentos, e Enter abre o painel com os dados em dd/mm/aaaa;
  - a busca "aurora" acha a obra e abre a página dela;
  - o tema troca entre claro e escuro;
  - a Suíte abre e fecha com Esc;
  - o selo mostra "Sem internet" quando a rede cai, e "Enviando…" seguido de "Sincronizado · agora" com a nuvem simulada. Aqui não há nuvem configurada, então sem ela o selo mostra "Dados neste computador";
  - no painel com alteração, Esc e clique fora perguntam "Descartar as alterações?", e Esc no diálogo volta ao painel sem perder o texto;
  - como gestor, Recorrentes, Fechamento, Usuários e Histórico somem do menu, e `#/usuarios` mostra "Sem acesso";
  - abaixo de 1280 px o menu recolhe para ícones.
- **Prints:** 32 em `validacao/D0/` (1440 × 900 e 1280 × 800, claro e escuro). Mostram o início, a busca, o lançamento aberto, a obra pela busca, a Suíte, a rede caída, a alteração não salva e o sucesso. Conferidos contra os prints 00, 01, 02, 03, 16 e 20 do protótipo.

## Falta

- O conteúdo real das telas, da D1 à D7.
- O contador de Cobranças no menu entra na D4. O sino fica escondido até existir algo real para contar, como no mobile.
- "Ver o sistema como" fica para a D6.
- **Selo "N na fila":** o desktop ainda não tem fila offline. A decisão sobre isso é da D2.

## Achados fora do escopo

- **D1 · evolução de 6 meses:** a evolução do `/api/dashboard/resumo` devolvia 6 meses, não 12 como diz o `02-LACUNAS-SERVIDOR.md`. O painel atual tem o título "Evolução mensal (12 meses)" e mostra 6. Resolvi com o parâmetro `meses=12`, sem mudar o atual. Se quiser, o painel atual pode passar a pedir 12 também (uma linha no `public/app.js`).
- **D1 · filtro de obra do painel atual vazio:** o seletor de obras do painel atual (`#dash-centro`) vem sem nenhuma obra. É provável que seja o problema 1 do inventário: o `startApp` trava em `#usuario-papel` antes de `loadReferences`. No desktop novo o filtro funciona.
- **D1 · Vencidos não segue o mês:** o valor de Vencidos soma tudo o que está vencido até hoje, não só o mês escolhido, e inclui receitas vencidas. É a regra atual do servidor e ficou igual.

- **Tema por instalação:** o `/api/appearance` guarda o tema da instalação inteira, não por usuário. A espec pede "por usuário". Hoje trocar o tema no `/d/` muda também o do sistema atual. Para ser por usuário, falta uma coluna ou chave por usuário no servidor.
- **Busca de lançamentos:** o `?busca=` de `/api/lancamentos` procura só na descrição e no favorecido (`lib/transactionFilters.js`). A espec pede também o número da NF (`documento`). Proponho acrescentar na D2.
- **Sem rota para um lançamento:** não existe `GET /api/lancamentos/:id`. O link direto `#/lancamentos?id=` só funciona vindo da busca. Proponho criar na D2.
- **Sem link direto no sistema atual:** o sistema atual não abre uma tela pelo endereço. Por isso "Abrir o sistema atual" leva ao `/` e diz o nome do menu.
- **Animação de sucesso:** o `public/m/anim.css` usa variáveis do celular (`--accent-900`, `--sat`). As regras da animação foram copiadas para `public/d/css/anim.css` com os tokens do desktop, sem mexer no `/m/`.

## Perguntas para o Lucas

- Revisar o PR da D0 e, se estiver ok, autorizar o push e o merge. Depois disso eu mando o plano da D1 (Início).
