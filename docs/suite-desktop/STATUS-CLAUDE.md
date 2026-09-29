# Status: Claude Code (desktop do Centro de Custos)

## D6 em andamento — 29/09/2026

O Lucas autorizou o CODEX a iniciar a D6 sem Maestri e pediu um gancho para o
Claude continuar caso o contexto termine. Branch local
`feat/desktop-usuarios` em
`C:\Users\Suporte\Documents\PROJETOS LUCAS\_worktrees\centro\wt-cc-desktop`,
criada de `origin/main` no commit `a492a63`. Não houve push nem deploy.

Primeira entrega em andamento: `public/d/telas/usuarios.js` e
`public/d/css/usuarios.css` implementam a lista de usuários, cadastro com
senha provisória, convite pelo endpoint da Fase 5, ativação/desativação e
e-mails externos. `public/d/index.html` os carrega. `routes/users.js`
informa `cloud_managed` na lista para impedir edição local de perfil
corporativo. A interface usa apenas os três papéis atuais; ainda não há
migração, matriz, restrição por obra ou seis papéis.

Validação desta entrega parcial: `npm run check` passou (172 arquivos),
`node --test test/desktop-web-structure.test.js
test/users-n1-regression.test.js` passou (14/14) e `npm test` passou
(308/308). A tela ainda precisa de conferência visual em 1440 × 900 e
1280 × 800, nos temas claro e escuro. Os fluxos de convite exigem a conta
central real para validação de ponta a ponta.

**Atenção para continuar:** o diretório central D1 ainda usa
`admin/gestor/supervisor`. `services/cloudUserMirror.js` e o upsert em
`routes/users.js` regravam `users.role` com o papel remoto a cada
login/listagem. Migrar a coluna local isoladamente para seis papéis causaria
reversão de acesso. Implementar D6 em conjunto com o contrato do Worker
central e os fluxos de login/handoff. Revisar as 53 chamadas de
`exigirPapel` e proteger leitura por obra no servidor antes de expor
`user_cost_centers` na tela. O plano e a matriz estão em
`03-PLANO-FASES.md` e `01-ESPEC-TELAS.md`, seção 6.

**Passo 1 concluído (29/09/2026):** a tela de Usuários foi conferida no navegador (servidor de demonstração local) em 1440×900 escuro e 1280×800 escuro e claro: lista, gaveta de novo usuário e aba de e-mails externos, sem erros no console. Sem prints salvos.

**Decisões da D6 (29/09/2026, Lucas: "sigo suas recomendações"):** desenho em `D6-DESENHO-PAPEIS.md`. Supervisor vira técnico, mas todo supervisor existente fica com todas as obras; matriz no central; técnico e engenharia sem obra atribuída não veem nada.

**Passo 2, etapa A (Worker) feita, sem commit/deploy:** `cloudflare/center-container/d1-migrations/012-papeis-suite.sql` (colunas `suite_role` e `apps`, tabela `role_permission_overrides`), `suiteRoles.js` (6 papéis, matriz padrão, papel efetivo, apps), `publicUser` devolve `suiteRole` e `apps`, e as rotas `POST /v1/users/access`, `GET/POST /v1/permissions`, `POST /v1/permissions/reset`; criar usuário aceita `suiteRole` e `apps`. Testes: 2 novos em `test/central-identity.test.js`; `npm test` 310/310. Falta no Worker: `suite_role`/`apps` em convites e cadastros (`signup.js`), e `last_seen_at`. A migração 012 ainda **não** foi aplicada no D1 de produção.

Próximos passos: (1) validar a primeira tela em navegador nos dois temas;
(2) conferir os testes e corrigir regressões; (3) desenhar migração 109
aditiva, modelo de papéis e matriz no diretório central e no banco local;
(4) aplicar filtros de obra em dashboard, obras, lançamentos e cobranças com
testes de 403 por URL; (5) completar telas de papéis, permissões, apps,
obras e simulação; (6) só então avaliar PR, migração e publicação.

Estado atual em 29/09/2026: D4 (PR #63), D5 e exclusão de centro de custo
(PR #64) mescladas; o Container do Centro foi publicado e as migrações 107 e
108 foram aplicadas em produção. O PR #65 registrou o mapa dos bancos. As
seções abaixo preservam o histórico da validação anterior ao deploy.

Os worktrees do Centro agora ficam em `../_worktrees/centro/`, exceto
`../wt-cc-cadastros`, mantido temporariamente na raiz por um bloqueio de
movimentação do Windows. Confirme os caminhos com `git worktree list`.

## Última atualização

- Data e hora (BRT): 29/09/2026
- Commit base: `27d5edd` (`origin/main`, após o merge da D4 pelo PR #63)

## Decisões do Lucas

Respostas às 6 perguntas do `PROMPT-CLAUDE-CODE.md` (27/09/2026, "ok para tudo recomendado"):

1. **Onde fica o desktop novo:** `public/d/`, servido em `/d/`. O `/` atual não muda até todas as fases estarem prontas.
2. **Papéis:** ficam para a D6. A migração vai mapear `supervisor` para `tecnico` e criar a tabela de permissões por papel. Até lá o menu usa os 3 papéis de hoje.
3. **Cobranças:** por obra, com os 4 passos montados a partir das situações que já existem (a faturar, NF emitida, enviada, aguardando pagamento, pago). Cobrança por medição fica para depois, se fizer falta.
4. **Recorrentes quinzenais:** saem do protótipo. Só voltam, na D5, se aparecerem custos quinzenais de verdade.
5. **Visibilidade por obra:** entra na D6, junto com os papéis e os testes de 403 por URL.
6. **Aba Sincronização:** sai do menu. As rotas `/api/sincronizacao*` continuam no servidor até a troca do `/` pelo novo.
10. **Cobranças (D4, 29/09/2026):** e-mail sem NF é barrado no servidor (vale para a tela atual também); "Pedir autorização" (print 44) fica para a D6; só a NF vai anexada, sem o boletim.
11. **Recorrentes por mês (D5, 29/09/2026):** o `/gerar` antigo escolhia o mês pela parcela (a parcela k caía no k-ésimo mês do ano corrente), então um modelo criado em setembro gerava primeiro um lançamento datado de janeiro. O Lucas aprovou corrigir: cada modelo tem o mês da primeira parcela (`starts_on`), a parcela k cai em início + (k−1) × intervalo e a geração é por mês.
9. **Obras (D3, 28/09/2026):** a fase foi dividida em D3a (carteira, detalhe, orçado × realizado, lançamentos e NF) e D3b (medições, Curva S, relatório, importar e vincular). Importar orçamento passa a ser só para admin e gestor (na D3b). A edição da obra confere a revisão quando a tela a envia.
8. **Sem internet (D2, 28/09/2026):** opção 1. O novo lançamento entra na fila do celular (`public/m/queue.js`), guardada neste navegador, e sai quando a conexão volta.
7. **Lançamento rápido (D1, 28/09/2026):** segue o protótipo. Sem o campo de fornecedor, que volta pelo Editar na D2. Com competência e vencimento escolhidos pela pessoa.

## Feito

### D4 · Cobranças

- **Revisão do PR #63 (29/09):** os dois Workers rejeitam envio direto sem NF em PDF (409). O rascunho não pode ser salvo durante `sending`; autorização e primeira tentativa de envio usam atualização condicional. O Resend recebe uma chave de idempotência por autorização. Uma falha sem confirmação pode ser retomada após um minuto, com a mesma NF e chave, até 23 horas após a primeira tentativa; depois exige conferência manual. Após aceitar o e-mail, o Worker só muda situações elegíveis para `aguardando_pagamento`, sem sobrescrever pagamento ou valores de outra sessão. A tela pública do Worker passou a exigir o PDF. Se o histórico ou a situação não puder ser atualizado, a tela avisa para conferir antes de reenviar. `npm test` no Node 24: 295/295; `npm run check`: 160 arquivos; teste direcionado: 7/7. Os dois testes com `node:sqlite` são ignorados no Node 20, onde esse módulo não existe. Nenhum e-mail real foi enviado.
- **Servidor (sem migração):**
  - `POST /cloud-sync/cobrancas/:id/enviar` passa a barrar o envio quando não há NF em PDF (nem anexada nem vinculada à obra), com a mensagem "Anexe a nota fiscal em PDF antes de enviar…" (409). Antes, o e-mail saía sem anexo;
  - `scripts/dev/fake-commercial-worker.js`: um Worker comercial de mentira, em memória, que reproduz as regras do real (acompanhamento com padrões, salvar o rascunho zera a autorização, enviar só o autorizado) e **não envia e-mail**. Serve aos testes e ao servidor de teste.
- **Telas (`public/d/telas/`):**
  - `cobrancas-regras.js`: as regras. Situações operacional e financeira; "vencida" usa a data de Brasília; os 4 passos (medição aprovada, NF emitida, e-mail enviado e pagamento); os indicadores em centavos com HALF_UP; os filtros e o CSV;
  - `cobrancas.js`: a lista do print 40, com 4 indicadores, busca, filtros, tabela, rodapé "Em aberto", Exportar CSV, e o contador de pendências no menu (pendentes mais vencidas, como no desenho);
  - `cobranca-painel.js`: o painel de acompanhamento dos prints 41 e 43, com o andamento, o "Próximo passo" (marcar aprovada, emitir NF, preparar e-mail, registrar pagamento com confirmação) e a troca de aba perguntando antes de descartar;
  - `cobranca-dados.js`: editar os dados do acompanhamento, com os campos e as validações do Worker (até 15 e-mails, valores, datas) e a escolha de cliente cadastrado;
  - `cobranca-email.js`: o print 42. **Enviar salva antes** (problema 7): como salvar o rascunho zera a autorização no Worker, o botão faz salvar, autorizar (com a caixa "Autorizo o envio…" marcada) e enviar. A cópia obrigatória de faturamento aparece travada. O anexo é a NF do cliente da obra (aba Notas fiscais da D3), a NF vinculada da obra (cadastro antigo) ou um PDF do computador, com até 5 MB. A data crua do rascunho padrão vira dd/mm/aaaa. Supervisor vê tudo em leitura, sem botões. Erros no topo do painel.
- **Depois de enviar**, o Worker muda a situação financeira para "Aguardando pagamento" se estava em a faturar, NF emitida ou enviada.
- **CSS:** `css/cobrancas.css`.
- **Testes:** `test/cobrancas-desktop.test.js`, contra o Worker de mentira: fluxo rascunho, autorização e envio; sem autorização dá 409, sem NF dá 409, arquivo que não é PDF dá 400; editar o rascunho depois de enviar exige autorizar de novo; a NF vinculada à obra vale como anexo; supervisor recebe 403 ao salvar, autorizar e enviar; e-mail fora da empresa recebe 403. Mais um teste de estrutura da D4.

### D5 · Cadastros (Categorias, Fornecedores e Recorrentes)

Branch `feat/desktop-cadastros` (worktree `../wt-cc-cadastros`), rebaseada sobre o `main` após a D4 (PR #63). Sem push.

- **Servidor (migração `107_desktop_cadastros.sql`, só aditiva):**
  - `categories.color` e `description`; o servidor aceita só as 7 cores da paleta do painel. Nome repetido dá 409 com o nome de quem já usa, sem diferença de maiúsculas, acentos e espaços. A lista traz `lancamentos_mes` e `total_mes` (`?mes=AAAA-MM`; estorno não conta como lançamento);
  - `suppliers.default_category_id` (a "categoria mais comum" do painel). CPF e CNPJ conferem o dígito verificador, ficam formatados e o repetido dá 409 com o nome ("Já existe um fornecedor com esse CNPJ: …"). Documento antigo mal digitado não trava a edição de outros campos: a regra só vale se o documento mudou. A lista traz `gasto_mes` e `lancamentos_mes`; `GET /fornecedores/:id/resumo?mes=` traz os lançamentos do mês. O lançamento só liga ao fornecedor pelo nome (`counterparty`), então os números casam por nome;
  - `recurring_templates.starts_on` (decisão 11). Modelos existentes: a próxima parcela cai no mês em que foram criados. Rotas novas: `GET /recorrentes/previa?mes=` (o que será criado e o que já foi criado, sem gravar), `GET /recorrentes/proxima` (data da próxima geração, para o formulário) e `POST /recorrentes/gerar` com `mes` (só até o mês atual, tudo ou nada, idempotente). A lista traz `inicio`, `geradas` e `proxima_geracao`. A identidade do lançamento gerado agora é modelo + mês, com índice único; lançamentos manuais e modelos homônimos não colidem. A prévia envia um token conferido antes de gerar. Um limite migrado de `current_installment` protege parcelas históricas de modelos legados, sem impedir meses pulados após a migração;
  - `lib/documento.js`, `lib/texto.js`, `services/recurringSchedule.js`.
- **Telas** (`public/d/telas/`): `categorias.js` e `categoria-form.js`, `fornecedores.js` e `fornecedor-form.js`, `recorrentes.js`, `recorrente-form.js` e `recorrente-gerar.js`, com `cadastros-base.js` e `css/cadastros.css`. O botão "Gerar lançamentos de <mês>" mostra o diálogo com a lista e depois vira "<Mês> já gerado · N lançamentos". "Próximas gerações" é a prévia do mês seguinte. Menu e regras de papel iguais aos de hoje (Recorrentes só para admin).
- **Fora desta fase:** recorrentes quinzenais (decisão 4); a sugestão da categoria do fornecedor no lançamento pelo celular (`public/m/` não foi alterado); escolher outro mês para gerar pela tela (a API aceita `mes`, a tela usa o mês atual).
- **Testes:** `test/cadastros-d5.test.js` (12/12: documento, agenda, categorias, fornecedores, concorrência, recorrentes por mês, legado e estrutura). `test/api.integration.test.js` passou a usar um CNPJ válido. `npm run check`: 171 arquivos; `npm test`: 307/307, sem falhas (29/09/2026).
- **Gate de migração:** antes de aplicar em uma base real, verificar CPFs/CNPJs legados duplicados pela consulta comentada em `migrations/107_desktop_cadastros.sql`. O índice único interrompe a migração se houver duplicidade; não há limpeza automática. Nenhuma migração foi aplicada à base real nesta validação.
- **Prints:** 40 em `docs/suite-desktop/validacao/D5/` (10 estados, 1440×900 e 1280×800, claro e escuro). Em 1280 a coluna "Próximas gerações" passa para baixo da tabela.

### Exclusão de centros de custo (sistema atual e `/d/`)

- Botão **Excluir** visível somente a admin nas duas interfaces. A carteira `/d/` permite listar obras ativas e inativas.
- O servidor aceita a exclusão apenas de centro sem vínculos; dados financeiros, contratos, medições, notas, propostas e recorrências são preservados. A ação é auditada na mesma transação.
- A migração `108_cost_center_tombstones.sql` registra o `public_id` excluído. CSV e pacote inteligente antigos não recriam esse centro nesta instalação; a resolução manual de conflito também respeita a exclusão. A confirmação informa que outras instalações não são alteradas.
- Teste direcionado: `test/cost-center-delete.integration.test.js`; `npm test` na branch isolada: 296/296. Na branch combinada com D5, os testes direcionados passaram 13/13, `npm run check` verificou 171 arquivos e `npm test` passou 308/308.

### D3b · Obras (medições, Curva S e ferramentas)

- **Servidor (sem migração):**
  - **regra de papel:** importar orçamento (`/integracao/orcamentos/previas`, `/previas/:id/confirmar`, `/confirmar-direto` e `/sync-direto`) passa a ser só para admin e gestor. Antes, qualquer pessoa logada importava. A chave de integração continua entrando como admin;
  - as medições devolvem o período como `AAAA-MM-DD`, sem hora (problema 4). O sistema atual também passa a mostrar a data sem hora. Cada medição traz também `created_by_name`, com quem registrou.
- **Telas (`public/d/telas/`):**
  - `obra-medicoes.js`: os prints 32 e 33.
    - Mão de obra: horas planejadas, medidas e saldo, com o formulário (semana atual, mínimo de 0,5 h e vírgula aceita) e o histórico com quem registrou.
    - Contrato: o número sugerido, o valor e o histórico.
    - Boletim de medição com o acumulado em centavos e o saldo a medir;
  - `obra-curva.js`: o print 34, com BAC, AC, EV, CPI, EAC e VAC, o gráfico (previsto tracejado, realizado e medido, com um ponto quando só há um mês), o "Como ler", a tabela mês a mês e as premissas;
  - `obra-relatorio.js`: o relatório executivo, com a identificação, os 6 números, a curva ABC, os gastos sem vínculo e a planilha, além de CSV e Imprimir/PDF;
  - `obra-impressao.js`: a folha de impressão do relatório e do boletim. Na impressão só a folha aparece;
  - `obra-importar.js`:
    - importar orçamento, com o arquivo .json, a prévia (já importada, conflito ou pronta, e o aviso de substituição da baseline) e a confirmação;
    - "Atualizar revisão" pelo detalhe da obra;
    - mensagens do servidor em português claro;
    - vincular os gastos sem vínculo a insumos.
- **Botões:** "Importar orçamento" na carteira; "Relatório executivo" no detalhe; "Atualizar revisão" e "Vincular a insumos" na aba Orçado × realizado.
- **Sincronizar:** o botão "Sincronizar" da tela de obras atual abre a sincronização por arquivo, que saiu do menu (decisão 6). Por isso ele não entrou na carteira nova.
- **CSS:** `css/obras-ferramentas.css`.
- **Testes:**
  - `test/obras-d3b.test.js`: supervisor recebe 403 na prévia, na importação direta e na confirmação; admin importa; datas puras e autor nas medições; supervisor continua sem registrar medição;
  - mais um teste de estrutura da D3b.

### D3a · Obras (carteira e detalhe)

- **Servidor (sem migração):**
  - `routes/costCenters.js` tinha 369 linhas. Baselines, orçado × realizado, apropriações e medições foram para `routes/costCenterBudget.js`, no mesmo `/api/centros-custo`;
  - `PUT /centros-custo/:id` confere a `revisao` quando ela vem e responde 409 se outra pessoa alterou. Sem `revisao`, o sistema atual continua como hoje;
  - **falha corrigida:** vincular e desvincular um gasto (`/apropriacoes` e `/apropriacoes/:id/desmapear`) agora exige que ele seja da obra do endereço. Antes, aceitava gasto de outra obra;
  - `portfolio-summary` ganha `porObra`, com custo base, realizado, consumo e medido ao cliente de cada obra. O resumo geral não muda;
  - nova rota `GET /centros-custo/notas-fiscais/:nfId/arquivo`: o PDF da NF era gravado, mas não havia como baixar.
- **Telas (`public/d/telas/`):**
  - `obras.js`: a carteira do print 30, com os 6 indicadores do cockpit atual, o alerta das obras acima de 80%, o filtro por situação e os cartões com consumo do orçado e medido ao cliente;
  - `obra-form.js`: nova e editar no painel lateral, com o **orçamento** (problema 3) e a revisão;
  - `obra.js`: o detalhe em página inteira, com "REV 02" em dois dígitos (problema 9), Editar obra, e "Lançar despesa" que já vem com a obra. A aba Lançamentos reaproveita a lista da D2 com a obra fixa;
  - `obra-orcado.js`: a aba do print 31, com saldo, consumo, maior desvio, os 5 indicadores, a planilha com filtro e CSV, o contrato com o PDF da proposta, os totais por tipo e o cartão de gastos sem vínculo;
  - `obra-nf.js`: o print 35, com Fornecedor e Cliente final, lançar com PDF, alternar a situação, baixar e excluir;
  - a lista de Lançamentos virou `L.montarLista`, usada pela tela e pela aba da obra. O total líquido negativo sai como "− R$".
- **CSS:** `css/obras.css`.
- **Testes:**
  - `test/cost-centers-desktop.test.js`: revisão (200, 409, sem revisão, 400, 404), rotas movidas respondendo, gasto de outra obra com 404, `porObra`, e o PDF da NF (200 e 404 sem PDF);
  - mais um teste de estrutura da D3a.

### D2 · Lançamentos

- **Servidor (sem migração):**
  - a busca procura também no documento, o número da NF (`lib/transactionFilters.js`);
  - cada item da lista traz `qtd_anexos` e `aprovacao`;
  - a lista paginada devolve `totalLiquido` do filtro inteiro;
  - nova rota `GET /api/lancamentos/:id`;
  - a validação e a ordenação saíram de `routes/transactions.js` para `lib/transactionPayload.js`, sem mudar regras, porque a rota estava com 346 de 350 linhas.
- **Telas (`public/d/telas/`):**
  - `lancamentos-filtros.js`:
    - busca com espera de 300 ms, e segmentados de tipo e de situação (a situação acerta o tipo);
    - obra, competência (os últimos 24 meses ou todos), e "Mais filtros" com categoria, de/até, ordenação e tamanho da página;
    - "Limpar filtros", e tudo fica salvo no navegador;
  - `lancamentos.js`:
    - tabela do print 10, com o vencido em vermelho, o cadeado nos meses fechados e o contador de documentos;
    - estornar e excluir só para admin e gestor, e só quando o servidor aceita;
    - rodapé "Exibindo N–M de T", total líquido e páginas;
    - Exportar CSV com os filtros;
    - faixa do mês fechado (print 73);
    - `#/lancamentos?id=` e `?novo=1`;
  - `lancamento-form.js`:
    - novo e editar (prints 14, 15 e 17), com sugestão de fornecedor, e data e forma de pagamento quando está Pago ou Recebido;
    - revisão no PUT, e os erros do servidor no topo do painel com os campos marcados;
    - competência fechada recusada antes de enviar, com a frase do print 74;
    - sem internet, o novo vai para a fila ("Guardado na fila");
    - estorno, estornado e mês fechado abrem só a leitura e os documentos (problema 6);
  - `lancamento-docs.js`: o print 18, com tipo, arrastar ou clicar, 8 MB, duplicado recusado pelo servidor, baixar, e excluir para admin e gestor;
  - `lancamento-acoes.js`: estorno (print 19), com data não anterior e motivo de 5 caracteres ou mais, e excluir (print 20) com o diálogo próprio.
- **Topo:** o selo mostra "Sem internet · N na fila" e "Enviando N lançamentos…" a partir da fila.
- **Início:** clicar numa atividade recente abre o lançamento de verdade (editar ou só leitura).
- **CSS:** `css/lancamentos.css`. Os títulos das colunas numéricas ficam alinhados à direita (`base.css`).
- **Testes:**
  - `test/transactions-desktop-lista.test.js`: NF na busca, documentos, aprovação, total líquido com estorno, lista sem paginação continua array, GET por id, 404 depois de excluir e 400 com id inválido;
  - mais um teste de estrutura da D2.

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

### D4

- `npm run check`: 160 arquivos. `npm test`: **293 testes, 293 passando**.
- **Nada foi enviado de verdade.** Tudo rodou contra o Worker de mentira. O envio real (Resend) só pode ser conferido com a nuvem e as chaves reais.
- No navegador, com 4 cobranças de exemplo e uma gestora da empresa:
  - **Indicadores** batem com a conta à mão: finalizadas R$ 84.000, aguardando R$ 64.200 (1 vencida), 2 pendentes, a receber R$ 186.500. O contador do menu mostra 3 (2 pendentes e 1 vencida).
  - **Filtros e busca:** pendentes 2, aguardando 0, vencidas 1, pagas 1, e "paulista" acha 1.
  - **Fluxo:** "Emitir NF" sem número leva ao formulário com o foco no campo; ao salvar a NF o andamento avança; o e-mail abre já com o destinatário e a cópia fixa; o botão Enviar começa desligado; o e-mail inválido é recusado; a mensagem editada e não salva foi salva e enviada (problema 7); a situação foi para Aguardando pagamento; o rascunho passa a mostrar "Enviado em …" e o botão "Reenviar".
  - **Sem NF:** a obra sem PDF de NF mostra o aviso do servidor no topo do painel.
  - **Vencida:** o último passo fica em vermelho, com "cobrar de novo". Registrar pagamento confirma no diálogo, e a lista, os indicadores e o contador atualizam.
  - **Supervisor:** só lê. Vê o menu, o painel e o e-mail sem botões e com os campos desligados.
- **Prints:** 36 em `validacao/D4/`: lista, filtro de vencidas, acompanhar, vencida, editar dados, e-mail, sem NF, validação e supervisor.
- Uma falha isolada em `test/jobs-queue.test.js` apareceu durante as rodadas: ele usa uma pasta temporária de nome fixo e colide quando outra execução de testes roda ao mesmo tempo (a outra sessão também roda `npm test`). Passou 5 de 5 na tentativa seguinte e na suíte completa.

### D3b

- `npm run check`: 155 arquivos. `npm test`: **291 testes, 291 passando**.
- **Critério de pronto da D3**: uma obra importada do Orçamentos, a proposta de exemplo do repositório, mostra os mesmos valores nas duas telas.
  - **Curva S:** AC R$ 630,00, EV R$ 960,00, CPI 1,52, VAC R$ 948,75, e a mesma linha de 09/2026 na tabela.
  - **Medições:** 88 h planejadas, 44 h medidas e saldo de 44 h.
  - **Planilha:** vem da mesma rota do sistema atual.
- **No navegador:**
  - registrar horas (a validação recusa menos de 0,5 h; "8,5" é aceito);
  - registrar medição ao cliente (o número sugerido é o seguinte);
  - boletim com o acumulado de R$ 2.000,00 e o saldo de R$ 1.450,00;
  - relatório executivo e CSV;
  - vincular o gasto sem vínculo: o realizado do insumo vai de R$ 450 para R$ 630 e o cartão some;
  - importar: arquivo inválido é recusado, o arquivo já importado mostra "já foi importada", e o arquivo alterado mostra a mensagem de assinatura que não confere.
- **Prints:** 32 em `validacao/D3b/`: medições (mão de obra e contrato), boletim, Curva S, relatório, importar e vincular.

### D3a

- `npm run check`: 150 arquivos. `npm test`: **289 testes, 289 passando**.
- No navegador, com a proposta de exemplo do repositório (`test/fixtures/proposal-approved.v1.example.json`) importada no servidor de teste, um gasto vinculado, um sem vínculo e duas medições:
  - **Obra nova:** a validação pede o código e recusa término antes do início. O orçamento de R$ 20.000,00 é gravado.
  - **Conflito de revisão:** "Esta obra foi alterada por outra pessoa…".
  - **Lançar despesa:** o painel abre já com "OB-900 · Galpão Teste".
  - **Orçado × realizado:** os números batem com a mesma rota que o sistema atual usa (saldo R$ 2.130,00, 23% de consumo, 36 de 88 h, 1 gasto sem vínculo de R$ 180,00).
  - **NF:** lançar com PDF, baixar (200, application/pdf), alternar para Paga e excluir com o diálogo.
- **Prints:** 52 em `validacao/D3a/`:
  - carteira, filtro e nova e editar obra;
  - orçado × realizado (rolado e só mão de obra);
  - lançamentos da obra, notas fiscais e lançar NF;
  - lançar despesa, obra sem orçamento e a aba de medições (D3b).

### D2

- `npm run check`: 144 arquivos. `npm test`: **286 testes, 286 passando**.
  - Numa rodada com o servidor de teste aberto, `test/database-lock.test.js` falhou uma vez. Passou 3 vezes sozinho e na rodada completa seguinte. Parece instabilidade do teste de PID quando a máquina está carregada.
- No navegador, contra o servidor local:
  - **Filtros:** cada mudança de filtro faz 1 chamada. Digitar "alarme" faz 1 chamada, e nenhuma depois (sem loop). O total líquido confere com a conta à mão.
  - **Criar, editar e documentos:**
    - criar: validação, Pago com forma Pix, e a tela de sucesso;
    - editar: salva e mostra "Alterações salvas";
    - anexar um PDF, com o contador indo de 0 para 1 na aba e na linha;
    - anexar o mesmo arquivo de novo mostra "Este mesmo arquivo já está anexado ao lançamento.".
  - **Conflito de revisão:** "Este lançamento foi alterado. Atualize a lista antes de editar novamente.".
  - **Estorno:** o motivo curto é recusado. Depois do estorno, o original aparece como "Estornado" e o estorno como "Estorno", com o sinal contrário. Os dois só mostram documentos e abrem só para leitura.
  - **Excluir:** o diálogo próprio e o toast "Lançamento excluído".
  - **Mês fechado (08/2026):**
    - aparecem a faixa com quem fechou e quando, e o cadeado;
    - ficam só os documentos, e a linha abre só para leitura;
    - o novo lançamento é recusado com a frase do print 74 e o campo marcado.
  - **Sem internet (simulado):** "Guardado na fila" e o selo "Sem internet · 1 na fila". Com a volta da rede, o lançamento chega ao servidor e a fila zera.
  - **Supervisor:** só vê documentos, sem estornar, excluir ou apagar anexo.
- **Prints:** 52 em `validacao/D2/` (1440 × 900 e 1280 × 800, claro e escuro):
  - lista, filtro A pagar e mais filtros;
  - novo, validação e novo Pago;
  - editar, documentos, estorno e excluir;
  - mês fechado, lançar em mês fechado, e sem internet com fila.

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
- **Fila, itens recusados:** um lançamento da fila que o servidor recusar (por exemplo, mês fechado) fica marcado como erro no navegador. O celular mostra esses itens na tela de fila. O desktop ainda não tem essa tela: entra junto com Reports, na D7, que também tem fila.
- **Editar e anexar sem internet:** não entram na fila, por decisão de escopo. O painel avisa e mantém o que foi digitado.

## Achados fora do escopo

- **D4 · situação ao enviar:** o Worker agora muda apenas situações elegíveis para Aguardando pagamento após aceitar o e-mail; uma cobrança já paga permanece paga. A tela atual e a nova usam a mesma regra.
- **D4 · rascunho no envelope:** o desenho marca com um ponto o envelope de quem tem rascunho salvo. O Worker só informa o rascunho obra por obra, e isso custaria uma chamada por linha. Ficou de fora da lista; o rascunho aparece ao abrir o e-mail.
- **D4 · datas dos passos:** o desenho mostra "Em 24/09/2026" em cada passo. O Worker só guarda a data de conclusão e o vencimento. Cada passo mostra o que existe.
- **D4 · a coluna "Medição":** virou "Conclusão" porque a cobrança é por obra (decisão 3).
- **D4 · a autorização fica gravada quando o envio falha** (por exemplo, sem NF). Ao corrigir e tentar de novo, o sistema salva e autoriza outra vez.
- **D4 · teste de trava:** `test/jobs-queue.test.js` usa uma pasta temporária de nome fixo e falha se duas execuções de testes rodarem juntas. Vale trocar por uma pasta única por execução.

- **D3b · AC da Curva S:** a Curva S conta só os gastos já vinculados a insumos. O realizado do orçado × realizado soma também os sem vínculo. Por isso os dois números diferem enquanto houver gastos sem vínculo. É a regra atual do servidor e ficou igual.
- **D3b · limite de login no teste:** capturar os prints fazendo muitos logins seguidos esbarrou no limite de tentativas do servidor de teste. É proteção esperada, não um erro do app.

- **D3a · realizado da carteira:** o `portfolio-summary` soma o realizado de **todas** as obras, mas divide pelo orçado só das obras com orçamento importado. Com obras sem orçamento, o "% do orçado total" e o "Saldo da carteira" ficam distorcidos (no teste deu 45.174%). O cockpit atual mostra a mesma conta. Vale decidir se o realizado deve contar só as obras importadas.
- **D3a · número da NF:** as notas fiscais da obra não têm campo de número. A coluna "Número" mostra a observação, e o formulário chama o campo de "Número / observação". Um campo próprio seria uma migração aditiva.
- **D3a · detalhe sem revisão:** o `/detalhes` da obra não devolve a `revision`. A tela a lê da lista. Não é um problema, mas custa uma chamada a mais.

- **D2 · fila compartilhada:** a fila usa o mesmo banco do navegador do celular (IndexedDB `cc-celular`). No mesmo navegador e no mesmo endereço, `/m/` e `/d/` enxergam a mesma fila da mesma conta. Isso é o esperado, e cada item só é enviado uma vez por causa do `client_id`.
- **D2 · aprovação:** o banco tem `approval_status` (rascunho, pendente, aprovado, rejeitado). A lista agora traz o campo, mas a tela ainda não mostra um selo para "pendente" ou "rejeitado". Hoje o estorno já some quando o lançamento não está aprovado. Vale decidir se entra um chip.

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
