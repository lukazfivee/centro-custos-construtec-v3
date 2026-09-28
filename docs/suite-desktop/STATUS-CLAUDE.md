# Status: Claude Code (desktop do Centro de Custos)

Fase atual: D0 pronta, aguardando revisão do Lucas · Branch: `feat/desktop-base` (worktree `../wt-cc-desktop`)

## Última atualização

- Data e hora (BRT): 27/09/2026, 20:50
- Commit base: `e1e0996` (`origin/main`)

## Decisões do Lucas

Respostas às 6 perguntas do `PROMPT-CLAUDE-CODE.md` (27/09/2026, "ok para tudo recomendado"):

1. **Onde fica o desktop novo:** `public/d/`, servido em `/d/`. O `/` atual não muda até todas as fases estarem prontas.
2. **Papéis:** ficam para a D6. A migração vai mapear `supervisor` para `tecnico` e criar a tabela de permissões por papel. Até lá o menu usa os 3 papéis de hoje.
3. **Cobranças:** por obra, com os 4 passos montados a partir das situações que já existem (a faturar, NF emitida, enviada, aguardando pagamento, pago). Cobrança por medição fica para depois, se fizer falta.
4. **Recorrentes quinzenais:** saem do protótipo. Só voltam, na D5, se aparecerem custos quinzenais de verdade.
5. **Visibilidade por obra:** entra na D6, junto com os papéis e os testes de 403 por URL.
6. **Aba Sincronização:** sai do menu. As rotas `/api/sincronizacao*` continuam no servidor até a troca do `/` pelo novo.

## Feito

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

- **Tema por instalação:** o `/api/appearance` guarda o tema da instalação inteira, não por usuário. A espec pede "por usuário". Hoje trocar o tema no `/d/` muda também o do sistema atual. Para ser por usuário, falta uma coluna ou chave por usuário no servidor.
- **Busca de lançamentos:** o `?busca=` de `/api/lancamentos` procura só na descrição e no favorecido (`lib/transactionFilters.js`). A espec pede também o número da NF (`documento`). Proponho acrescentar na D2.
- **Sem rota para um lançamento:** não existe `GET /api/lancamentos/:id`. O link direto `#/lancamentos?id=` só funciona vindo da busca. Proponho criar na D2.
- **Sem link direto no sistema atual:** o sistema atual não abre uma tela pelo endereço. Por isso "Abrir o sistema atual" leva ao `/` e diz o nome do menu.
- **Animação de sucesso:** o `public/m/anim.css` usa variáveis do celular (`--accent-900`, `--sat`). As regras da animação foram copiadas para `public/d/css/anim.css` com os tokens do desktop, sem mexer no `/m/`.

## Perguntas para o Lucas

- Revisar o PR da D0 e, se estiver ok, autorizar o push e o merge. Depois disso eu mando o plano da D1 (Início).
