# Especificação das telas do desktop

Tela por tela do desktop aprovado (Rodadas 17 a 20 do canvas). Cada seção tem:

- **Prints:** arquivos em `prints/`, em 1440 × 900.
- **Estado no protótipo:** o valor de `start` para abrir em `prototipo/estado.html?start=`.
- **Hoje:** o que o sistema atual faz (resumo do `referencia-atual/INVENTARIO-CENTRO-CUSTOS.md`, com os prints antigos em `referencia-atual/prints/`).
- **Novo:** o que muda.
- **API:** rotas que já existem. O que falta está em `02-LACUNAS-SERVIDOR.md`.

Textos, rótulos e mensagens exatos estão no `prototipo/Desktop.dc.html`. Use-o como fonte dos textos.

---

## 0. Estrutura (vale para todas as telas)

**Prints:** `00-painel`, `01-busca-global`, `02-suite-aberta`, `03-painel-tema-escuro`, `12-lancamentos-sem-internet`, `67-ver-como-tecnico`.

- **Tela base:** 1440 × 900 como referência, funcionando a partir de 1280 px de largura. Abaixo disso, o menu lateral recolhe só para ícones.
- **Menu lateral** (236 px, fundo petróleo `#031f29`):
  - no topo, logo Construtec para fundo escuro e "Centro de Custos";
  - grupos de itens:
    - Visão geral: Início;
    - Operação: Lançamentos, Obras, Cobranças (com contador de pendências);
    - Cadastros: Categorias, Fornecedores, Recorrentes;
    - Ferramentas: Fechamento mensal;
    - Administração: Usuários, Histórico, Reports, Configurações;
  - no rodapé, a pessoa logada (foto ou iniciais, nome, papel) e o botão Sair;
  - **cada item só aparece para quem tem a permissão** (ver seção 9): `p6` Cobranças, `p8` Fechamento, `p9` Usuários, Histórico, Reports e Configurações.
  - A Sincronização saiu do menu (Rodada 20).
- **Barra do topo** (64 px, superfície clara):
  - **Busca global**:
    - atalho Ctrl K; procura a partir de 2 letras em obras (nome, código, cliente) e lançamentos (descrição, favorecido, NF);
    - clicar num resultado **abre o item**: a obra no detalhe, o lançamento no painel lateral de edição. Isso corrige o problema 5 do inventário.
    - Mostra "Nada encontrado para …" quando não acha.
  - **Selo de sincronização real**, no lugar do texto fixo "Offline · Dados locais" (problema 11):
    - "Sincronizado · há N min" (verde);
    - "Sem internet · N na fila" (âmbar);
    - "Enviando…" (azul, com animação).
    - Vem do estado real da sincronização, não de clique. O clique no protótipo só simula.
  - **Suíte:** Portal Hub, Orçamentos, Centro de Custos (marcado "Atual") e Chamados e O.S. O Webmail UOL, que existe hoje, pode ficar nesse menu.
  - **Sino** com contador. Na Fase 4 do mobile ele ganha a central de notificações; até lá, mostre só se houver algo real para contar, ou esconda como no mobile.
  - **Tema claro/escuro** (lua/sol), guardado por usuário (`/api/appearance`).
- **Conteúdo:** fundo `--color-bg`, com padding de 28 × 32 px. Cabeçalho de página com sobretítulo (grupo), título, subtítulo e ações à direita.
- **Painel lateral (drawer)** à direita, com 500 px:
  - substitui todos os modais de formulário;
  - estrutura: cabeçalho com ícone, título, subtítulo e fechar; abas quando houver; corpo com rolagem; rodapé com os botões;
  - fecha com Esc e com clique fora, **pedindo confirmação se houver alteração não salva**.
- **Diálogo de confirmação próprio** (prints 20, 71, 94): substitui `alert`, `confirm` e `prompt` (problema 13).
- **Aviso rápido (toast)** embaixo, no centro, por 2,6 s: "Lançamento excluído", "Rascunho salvo" etc.
- **Animação de sucesso** (check, estouro, símbolo da Construtec com fundo transparente): em lançamento registrado, convite enviado e usuário criado. Reaproveite `public/m/anim.css`.
- **"Ver o sistema como"** (print 67, só para o administrador):
  - simula outro papel na interface;
  - uma faixa âmbar avisa que é simulação;
  - não muda nada no servidor.
- **Reportar problema:** fica em Configurações → Sistema e em Reports. O botão flutuante atual sai.

## 1. Início / Painel financeiro

**Prints:** `00-painel`, `03-painel-tema-escuro`. **Estado:** `painel`, `escuro`.

- **Hoje:** filtros por obra e mês, 6 KPIs, evolução de 12 meses, atividades recentes (8), obras com maior movimentação e despesas por categoria (top 8). Também tem o lançamento rápido e o banner de primeiro uso.
- **Novo:**
  - **Cabeçalho:** "Painel financeiro", o mês e a obra no subtítulo. Filtros de obra e mês e o botão "Lançamento rápido".
  - **6 KPIs com ícone:**
    - Recebido e Pago, com a contagem;
    - Resultado, em verde ou vermelho;
    - A receber e A pagar;
    - Vencidos, em vermelho, com a contagem.
  - **Evolução mensal (12 meses):**
    - barras de receitas × despesas, com eixo em "mil";
    - embaixo, média mensal de receitas, média mensal de despesas e margem média.
  - **Atividades recentes:** 6 itens, com ícone de entrada ou saída, obra, data, situação e valor com sinal. Clicar abre o lançamento. "Ver todos" leva a Lançamentos.
  - **Obras · realizado × orçado:** barra com as cores da regra do orçamento (até 80%, acima de 80%, acima de 100%). Corrige o problema 3 (barra sempre em 0%).
  - **Despesas por categoria.**
  - O banner de primeiro uso continua (`/api/first-use`), no mesmo visual de cartão.
- **API:** `GET /api/dashboard/resumo?mes=&centroId=`, `GET /api/insights/*`, `GET /api/first-use/status`.

## 2. Lançamentos

**Prints:** `10` a `20`, `73`, `74`. **Estados:** `lanc`, `filtro`, `offline`, `rapido`, `novo`, `erro`, `ok`, `editar`, `docs`, `estorno`, `excluir`, `lancLocked`, `novoFechado`.

- **Hoje:** filtros, ordenação, paginação, CSV, e as ações Documentos, Editar, Estornar e Excluir. Tem os problemas 2 (loop de requisições) e 6 (o clique na linha de um estorno abre a edição).
- **Novo, lista (print 10):**
  - **Filtros:**
    - busca;
    - segmentado de tipo (Todos, Despesas, Receitas);
    - segmentado de situação (Todas, A pagar, Vencidos, Pagos, A receber, Recebidos);
    - obra e "Limpar filtros".
  - Mantenha os filtros que existem hoje e não aparecem no print (categoria, competência de/até, ordenação, tamanho da página). Eles vão num "Mais filtros" ou na mesma linha, e continuam salvos no navegador.
  - **Colunas:**
    - Competência e Vencimento (vencido em vermelho);
    - Situação (chip);
    - Obra (código e nome);
    - Descrição (com categoria e favorecido embaixo);
    - Valor, com sinal e cor;
    - Ações: documentos com contador, estornar e excluir.
  - **Rodapé:** "Exibindo N de M" e o total líquido. Exportar CSV no cabeçalho.
  - Clicar na linha abre a edição. Num estorno ou num lançamento estornado, abre só a leitura e os documentos (problema 6).
  - **A lista não pode fazer requisição em loop** (problema 2): uma busca por mudança de filtro, com debounce na busca.
- **Novo lançamento (prints 14 e 15):**
  - painel lateral com os campos: tipo (despesa ou receita), obra/centro, descrição, categoria (filtrada pelo tipo), valor, fornecedor (ou cliente, na receita, com sugestão dos cadastrados), competência, vencimento, situação (a pagar ou pago; a receber ou recebido), NF/documento e observação;
  - com Pago ou Recebido, aparecem a data do pagamento e a forma (Pix, Boleto, Transferência, Cartão, Dinheiro, Outro);
  - erro no topo do painel, com os campos marcados em vermelho: "Preencha a descrição e um valor maior que zero.";
  - **mantenha os erros que o servidor já trata:** competência fechada, revisão (alguém editou antes), estorno não editável, rateio.
- **Lançamento rápido (print 13):** o mesmo painel, só com tipo, obra, descrição, categoria, valor, datas e situação. Uma nota explica que fornecedor, NF, observação e anexos ficam para o Editar.
- **Registrado (print 16):** a animação, o resumo (obra, valor, situação) e os botões "Fechar" e "Lançar outro".
- **Editar (print 17):** abas Dados e Documentos no mesmo painel. "Salvar alterações".
- **Documentos (print 18):**
  - tipo (comprovante, nota fiscal, boleto, recibo, contrato, outro);
  - área de arrastar ou clicar (PDF, JPG, PNG, WEBP, até 8 MB, com duplicados bloqueados);
  - lista com baixar e excluir.
- **Estorno (print 19):**
  - aviso de que o estorno cria o lançamento inverso e mantém o original ligado a ele;
  - resumo do original, data do estorno (não antes da original) e motivo (obrigatório; o servidor pede 5 caracteres ou mais).
  - Toast: "Estorno registrado · o original ficou marcado como estornado".
- **Excluir (print 20):** diálogo próprio: "Excluir este lançamento?", informando que a exclusão fica no histórico.
- **Mês fechado (prints 73 e 74):**
  - faixa no topo da lista avisando que o mês está fechado, com quem e quando fechou;
  - cadeado na competência, e somem excluir e estornar;
  - clicar abre só os documentos, que continuam liberados;
  - no novo lançamento com competência fechada, o painel recusa com o motivo e sugere trocar a data ou pedir a reabertura.
- **Sem internet (print 12):** o selo do topo mostra a fila. No desktop web, decida com o Lucas se o lançamento offline entra na fila como no celular (`public/m/queue.js`) ou se o botão salvar fica desabilitado com o aviso. Recomendação: reaproveitar a fila do celular.
- **API:**
  - `GET/POST /api/lancamentos`, `PUT/DELETE /api/lancamentos/:id`, `POST /api/lancamentos/:id/estornar`, `GET /api/lancamentos/exportar.csv`;
  - anexos: `GET/POST /api/anexos/lancamento/:id`, `GET /api/anexos/:id/arquivo`, `DELETE /api/anexos/:id`;
  - fechamento: `GET /api/fechamento-mensal`.

## 3. Obras

**Prints:** `30` a `35`. **Estados:** `obras`, `obra`, `med`, `medCt`, `curva`, `nf`.

- **Hoje:** cockpit da carteira, cards, formulário da obra, detalhe em janela (Detalhamento, NF, Orçado × Realizado), Análise de orçamento, Medições, Curva S, Relatório executivo e Importar orçamento.
- **Novo, carteira (print 30):**
  - **KPIs:** obras na carteira (em execução), valor contratual, realizado (% do orçado), saldo da carteira, horas medidas (de planejadas) e faturado (% do contratado);
  - **alerta âmbar:** obras acima de 80% ou estouradas, com "Abrir obra";
  - **filtro por situação:** Todas, Em execução, Planejamento, Pausadas, Concluídas;
  - **cartões:** código, situação, nome, cliente, barras de consumo do orçado e de medido ao cliente, realizado, contratado, e os botões "Abrir obra" e "Editar";
  - ações do cabeçalho: Importar orçamento, Sincronizar (a sincronização com o Orçamentos, não a de arquivos) e Nova obra.
  - Nova e Editar obra num painel lateral, com os campos de hoje: código, situação, nome, cliente, contrato, responsável, início, término, valor contratado, **orçamento** (corrige o problema 3), descrição e ativo (só na edição).
- **Detalhe da obra (print 31):** página inteira, não mais janela.
  - **Topo:**
    - voltar para Obras;
    - código e revisão da proposta, nome, cliente, responsável e período;
    - chip de situação;
    - Editar obra, Relatório executivo e Lançar despesa (abre o novo lançamento já com a obra).
  - **Abas:** Orçado × realizado, Lançamentos, Notas fiscais, Medições, Curva S.
  - **Orçado × realizado:**
    - saldo disponível e barra de consumo (ok, atenção acima de 80, estourado acima de 100), com o maior desvio;
    - KPIs: realizado, horas da equipe, contrato, custo orçado, faturado;
    - planilha analítica: insumo (com código e tipo), quantidade, orçado, realizado, desvio, consumo e ABC; filtro Todos, Materiais, Mão de obra; CSV;
    - ao lado:
      - cartão do contrato, com a proposta aprovada em PDF;
      - orçado × realizado por tipo;
      - cartão "N gastos sem vínculo", com "Vincular a insumos".
    - Essa aba junta o "Orçado × Realizado" e a "Análise de orçamento" de hoje. O "Atualizar revisão" da baseline continua.
  - **Lançamentos:** a mesma tabela da tela de Lançamentos, filtrada pela obra.
  - **Notas fiscais (print 35):**
    - dois blocos, Fornecedor e Cliente final, com emissão, número, valor, status e download;
    - "Lançar NF" com emissão, valor, "já paga" e PDF.
  - **Medições (prints 32 e 33):**
    - segmentado Mão de obra ou Contrato (cliente);
    - **Mão de obra:** KPIs de horas planejadas, medidas e saldo; formulário de início, fim, horas e frente de trabalho; histórico com período, frente, horas e quem registrou;
    - **Contrato:** KPIs de contrato, medido e saldo a faturar; formulário de número, período, valor e observações; histórico com "Boletim";
    - **datas em dd/mm/aaaa** (problema 4).
  - **Curva S (print 34):**
    - KPIs BAC, AC, EV, CPI, EAC e VAC, com a explicação curta de cada um;
    - gráfico acumulado previsto (tracejado), realizado e medido;
    - "Como ler" embaixo;
    - mantenha a tabela mensal e as premissas que existem hoje, abaixo do gráfico.
  - **Relatório executivo:** continua (exportar CSV e imprimir/PDF), no visual novo.
  - **Importar orçamento:** continua (arquivo do Orçamentos, prévia e confirmação), no painel lateral.
- **API:**
  - `GET /api/centros-custo`, `/portfolio-summary`, `/:id/detalhes`, `/:id/orcado-realizado` (e `/csv`), `/:id/baselines`, `/:id/apropriacoes` (e desmapear), `/:id/medicoes`, `/:id/curva-s`, `/:id/proposta`, `/:id/notas-fiscais`;
  - `PUT /api/centros-custo/notas-fiscais/:nfId`;
  - `/api/integracao/orcamentos/*`.

## 4. Cobranças

**Prints:** `40` a `44`. **Estados:** `cob`, `cobTrack`, `cobMail`, `cobVenc`, `comoFin`.

- **Hoje:** KPIs; tabela por obra com operação, financeiro, NF, vencimento e valor; acompanhamento; e-mail com rascunho, autorização e envio. Aparece só para e-mails `@rcconstrutec.com.br`. Tem os problemas 4 (vencimento cru) e 7 ("Enviar" não salva as edições).
- **Novo:**
  - **KPIs:** finalizadas, aguardando pagamento (com as vencidas), pendentes (aprovação, NF ou envio) e a receber;
  - **filtros:** Todas, Pendentes, Aguardando, Vencidas, Pagas;
  - **tabela:** obra, medição (com o período), situação operacional, situação financeira (com a data do e-mail), NF, vencimento em dd/mm/aaaa, valor e ações. Um ponto âmbar no envelope marca rascunho salvo;
  - **Acompanhar (print 41):**
    - painel lateral com o andamento em 4 passos: medição aprovada, NF emitida, e-mail enviado, pagamento;
    - o botão "Próximo passo" muda conforme o estado: marcar aprovada, emitir NF, preparar e-mail ou registrar pagamento;
    - vencida (print 43): o último passo fica em vermelho com a data, e dá para reenviar ou registrar o pagamento;
  - **E-mail ao cliente (print 42):**
    - rascunho já escrito (para, cópia, assunto, mensagem), com a NF e o boletim anexados;
    - **"Enviar" salva antes de enviar** (problema 7);
    - sem NF ou sem autorização, o envio para com o aviso no topo;
  - **Financeiro (print 44):** prepara o e-mail, mas o envio depende de um gestor. No lugar do interruptor aparece "Pedir autorização".
- **Decisão pendente:** cobrança por medição ou por obra (pergunta 3 do prompt).
- **API:** `GET /api/cloud-sync/cobrancas`, `PUT /cobrancas/:publicId`, `GET/PUT /cobrancas/:publicId/rascunho`, `POST /cobrancas/:publicId/autorizar`, `POST /cobrancas/:publicId/enviar`, `/api/cloud-sync/clientes`.

## 5. Cadastros

### 5.1 Categorias

**Prints:** `50` a `52`. **Estados:** `cat`, `catNova`, `catEdit`.

- **Lista:**
  - busca e filtro Todas, Despesas, Receitas, Receita e despesa;
  - colunas: categoria (com a cor e a descrição), tipo padrão, lançamentos no mês, total no mês, status e editar.
- **Tipo:** "Receita e despesa" no lugar do antigo "ambos". O valor no banco continua `ambos`; só o rótulo muda.
- **Painel:**
  - nome, tipo, descrição, cor (paleta fixa) e "Categoria ativa";
  - nome repetido é recusado;
  - inativa some dos lançamentos novos sem mexer nos antigos;
  - na edição, aviso de quantos lançamentos do mês usam a categoria.
- **API:** `GET/POST /api/categorias`, `PUT /api/categorias/:id`. Cor e descrição são lacunas.

### 5.2 Fornecedores

**Prints:** `53` a `55`. **Estados:** `forn`, `fornView`, `fornErr`.

- **Lista:**
  - busca por nome, CPF/CNPJ ou contato;
  - colunas: fornecedor (com o documento), contato, e-mail, telefone, gasto do mês, lançamentos e editar;
  - rodapé com o total no mês.
- **Painel:**
  - nome ou razão social, CPF ou CNPJ, categoria mais comum, contato, telefone e e-mail;
  - na edição, os lançamentos do mês desse fornecedor;
  - CPF precisa de 11 dígitos e CNPJ de 14;
  - documento já cadastrado dá o erro "Já existe um fornecedor com esse CNPJ: <nome>" (print 55);
  - a categoria mais comum vira sugestão no lançamento pelo celular.
- **API:** `GET/POST /api/fornecedores`, `PUT /api/fornecedores/:id`, `GET /api/fornecedores/exportar.csv`. A validação e a duplicidade são lacunas.

### 5.3 Recorrentes

**Prints:** `56` a `59`. **Estados:** `rec`, `recNovo`, `recGerar`, `recFeito`.

- **Lista:**
  - colunas: modelo (com obra e favorecido), frequência e dia, parcelas (com barra "3 de 6 geradas" ou "Sem fim · N geradas"), valor, status (ativo ou pausado) e ações;
  - ao lado, "Próximas gerações" do mês seguinte, com data, obra, valor e o total.
- **Novo e editar:**
  - descrição, obra, categoria, favorecido, valor, frequência, dia e parcelas (vazio para sem fim);
  - uma prévia diz a próxima geração.
- **Gerar lançamentos do mês (prints 58 e 59):** o botão que falta hoje (problema 8).
  - Mostra o que vai ser criado, com data e valor.
  - Gera tudo como "A pagar".
  - Depois, o botão vira "Outubro já gerado · N lançamentos" para não duplicar. O servidor já tem idempotência.
- **API:** `GET/POST /api/recorrentes`, `PUT/DELETE /api/recorrentes/:id`, `POST /api/recorrentes/gerar`. A prévia (dry-run) é lacuna.

## 6. Usuários e permissões

**Prints:** `60` a `67`. **Estados:** `usu`, `convite`, `conviteOk`, `senhaProv`, `usuEdit`, `perms`, `ext`, `comoTec`.

- **Hoje:** tabela de usuários (nome, e-mail, papel, status); novo usuário com senha provisória de 10 ou mais caracteres; e-mails externos autorizados.
- **Novo:**
  - **Abas:** Usuários, Papéis e permissões, E-mails externos.
  - **KPIs:** ativos, convites pendentes, desativados, papéis em uso.
  - **Tabela:**
    - usuário (com as iniciais), papel e obras que vê, apps (Orçamentos, Centro de Custos), último acesso e status (ativo, convite enviado, desativado);
    - ações: reenviar convite e desativar. Desativar pede confirmação e mantém o histórico.
  - **Convidar (prints 61 a 63):**
    - nome, e-mail, papel, apps, obras (todas ou algumas) e método: convite por e-mail com o código da empresa (o mesmo do cadastro no app, Fase 5 do mobile) ou senha provisória;
    - embaixo, o que o papel pode fazer;
    - sucesso com a animação e a prévia do e-mail, com o código; na senha provisória, a senha para copiar.
  - **Editar acesso (print 64):** papel, apps, obras e o que o papel pode fazer.
  - **Papéis e permissões (print 65):**
    - matriz de 12 permissões por 6 papéis, em três grupos;
    - clicar liga ou desliga; o administrador fica travado com tudo;
    - "Restaurar padrão". Vale para o celular e para o computador.
  - **E-mails externos (print 66):** a lista que existe hoje, no visual novo.
  - **Ver o sistema como (print 67):** ver seção 0.
- **Os papéis e a matriz padrão do protótipo:**

| Permissão | admin | gestor | financeiro | engenharia | técnico | comercial |
|---|---|---|---|---|---|---|
| p1 Ver painel financeiro | sim | sim | sim | sim | | |
| p2 Lançar despesas | sim | sim | sim | sim | sim | |
| p3 Editar e excluir lançamentos | sim | sim | sim | | | |
| p4 Estornar lançamentos | sim | | sim | | | |
| p5 Cadastros | sim | sim | | | | |
| p6 Cobranças | sim | sim | sim | | | |
| p7 Autorizar envio de cobrança | sim | sim | | | | |
| p8 Fechamento mensal | sim | | | | | |
| p9 Usuários, permissões e configurações | sim | | | | | |
| p10 Ver custo, BDI e margem (Orçamentos) | sim | sim | | sim | | sim |
| p11 Enviar e aprovar propostas (Orçamentos) | sim | sim | | | | sim |
| p12 Registrar horas e medições | sim | sim | | sim | sim | |

- **Até os papéis novos existirem no servidor:** a tela mostra os três papéis de hoje (`admin`, `gestor`, `supervisor`) e as regras atuais: gestor faz cadastros, exclusões, estorno, medições, NF e cobranças; supervisor cria e edita lançamentos e consulta.
- **API:** `GET/POST /api/usuarios`, `PUT /api/usuarios/:id`, `PUT /api/usuarios/:id/status`, `DELETE /api/usuarios/:id`, `/api/usuarios/emails-autorizados*`. Papéis, matriz, obras por usuário, apps, convite e último acesso são lacunas.

## 7. Fechamento mensal e Histórico

### 7.1 Fechamento mensal

**Prints:** `70` a `75`. **Estados:** `fech`, `fechConf`, `fechOk`, `lancLocked`, `novoFechado`, `reabrir`.

- **Hoje:** só o servidor. Não há tela.
- **Novo:**
  - **KPIs da competência aberta:** receitas, despesas, resultado e em aberto;
  - **lista dos meses do ano:**
    - o aberto no topo, depois os fechados e os futuros;
    - cada mês com situação, receitas, despesas, resultado, quem fechou e quando, e o motivo quando foi reaberto;
  - **checklist "Antes de fechar":**
    - contas a pagar vencidas;
    - despesas pagas sem documento;
    - cobranças sem NF ou sem envio;
    - fila do celular vazia;
    - lançamentos em aberto;
    - recorrentes do mês gerados;
    - cada item com "Ver", que leva para a lista já filtrada;
  - **fechar com pendências (print 71):** a confirmação lista o que falta. Dá para fechar mesmo assim, e as pendências ficam registradas no mês e no Histórico;
  - **reabrir (print 75):** pede um motivo de pelo menos 10 caracteres (hoje o servidor aceita 5). O motivo aparece na lista e no Histórico;
  - só o administrador (`p8`) vê fechar e reabrir.
- **API:** `GET /api/fechamento-mensal`, `POST /api/fechamento-mensal`, `DELETE /api/fechamento-mensal/:id` (com `motivo`). O checklist, os totais por mês e as pendências gravadas são lacunas.

### 7.2 Histórico

**Prints:** `76` a `79`. **Estados:** `hist`, `histFech`, `histDet`, `histVivo`.

- **Hoje:** existe no código, sem acesso pelo menu.
- **Novo:**
  - **filtros:** tipo (Todos, Lançamentos, Cadastros, Cobranças, Fechamento, Usuários), pessoa, período e busca; Exportar CSV;
  - **colunas:** quando, usuário, ação (chip), registro, detalhe (antes → depois) e origem (computador, celular, fila offline);
  - **detalhe (print 78):**
    - tabela de antes e depois, a origem e o motivo quando houver;
    - "Abrir lançamento" leva ao registro;
    - o histórico não pode ser editado nem apagado.
- **API:** `GET /api/historico?tipo=&busca=&pagina=&limite=`. Filtro por pessoa e período, antes → depois e origem são lacunas.

## 8. Reports e Configurações

### 8.1 Reports

**Prints:** `80` a `83`. **Estados:** `rep`, `repNovo`, `repFila`, `repView`.

- **KPIs:** enviados no mês, entregues, na fila, falharam.
- **Filtros:** Todos, Entregues, Na fila, Falharam.
- **Tabela:** report (título e autor), tipo, tela, enviado, entrega e ações. "Reenviar" fica na linha do que não chegou.
- **Novo report (print 81):**
  - título, tipo (Erro, Sugestão, Dúvida), onde aconteceu e o que aconteceu;
  - "Incluir diagnóstico", ligado por padrão: versão, navegador, conexão e últimas ações, **nunca senhas ou valores**;
  - "Anexar um print".
- **Sem internet (print 82):** o report entra na fila e sai sozinho quando a conexão volta.
- **Detalhe (print 83):** dados do envio, o diagnóstico, a descrição e a resposta da equipe.
- **API:** `GET/POST /api/bug-reports`, `GET /api/bug-reports/:id`, `POST /api/bug-reports/:id/retry`, `GET /api/bug-reports/delivery/status`, `POST /api/bug-reports/delivery/retry`.

### 8.2 Configurações

**Prints:** `90` a `95`. **Estados:** `cfg`, `cfgFoto`, `cfgSenhaErr`, `cfgBackup`, `cfgRestore`, `cfgSis`.

- **Abas:** Meu perfil, Backup e restauração, Sistema.
- **Meu perfil:**
  - foto (enviar, trocar, remover; PNG ou JPG até 2 MB, redimensionada para 512 px), nome e telefone editáveis; e-mail só leitura;
  - a foto aparece no menu lateral assim que é salva.
- **Senha:**
  - senha atual, nova (com a barra de força) e confirmação, com mínimo de 8 caracteres;
  - os erros aparecem no topo do cartão e marcam o campo;
  - trocar a senha encerra as sessões nos outros aparelhos.
- **Backup e restauração:**
  - KPIs: última cópia, cópias guardadas, espaço;
  - tabela das cópias (automáticas diárias e manuais) com baixar e restaurar;
  - "Fazer backup agora";
  - restaurar (print 94) pede para digitar RESTAURAR e salva antes uma cópia do estado atual.
- **Sistema:**
  - versão lida do próprio sistema (corrige o problema 10, versão fixa em "3.0.0"), servidor, banco, usuários ativos, aparelhos, fuso e moeda;
  - "Verificar atualização";
  - uso do armazenamento;
  - atalho para Reports.
- **Acesso pelo celular** (QR code e rede local, só no app Windows): continua, dentro de Sistema, só quando rodar no Electron.
- **API:**
  - `GET/POST/DELETE /api/auth/foto-perfil`, `POST /api/auth/alterar-senha`, `GET /api/auth/me`;
  - `GET /api/backup/status`, `GET /api/backup`, `POST /api/backup/restaurar`, `/api/backup-automatico`;
  - `GET /api/sistema/status`, `/api/update/*`.

## 9. Permissões na interface

- Toda ação e todo item de menu passa por uma função única, `pode(permissao)`, alimentada pelo `GET /api/auth/me`.
- Até D6, `pode` traduz os três papéis atuais para as permissões da tabela da seção 6:
  - admin: tudo;
  - gestor: p1 a p7 e p10 a p12;
  - supervisor: p1, p2 e a edição de lançamentos (sem excluir nem estornar), como hoje.
  - Confira cada regra contra os `exigirPapel` das rotas antes de fechar o mapeamento.
- Botões sem permissão **não aparecem** (problema 15). O 403 do servidor mostra o aviso padrão, sem quebrar a tela.

## 10. Problemas do inventário que o desktop novo resolve

| Nº | Problema | Onde |
|---|---|---|
| 1 | `#usuario-papel` ausente trava o início | D0 (app novo não depende do HTML antigo) |
| 2 | Loop de requisições em Lançamentos | D2 |
| 3 | Barra comprometido ÷ orçamento em 0% | D1 e D3 (campo orçamento na obra) |
| 4 | Datas ISO cruas | Todas (formatador único) |
| 5 | Busca global não abre o item | D0 |
| 6 | Clique em estorno abre edição e dá 409 | D2 |
| 7 | "Enviar" do e-mail não salva antes | D4 |
| 8 | Recorrentes nunca geram | D5 |
| 9 | "REV010" | D3 (formatador de revisão) |
| 10 | Versão fixa "3.0.0" | D7 |
| 11 | "Offline · Dados locais" fixo | D0 |
| 12 | Textos de desenvolvimento e glifos Unicode | Todas |
| 13 | `alert`, `confirm` e `prompt` nativos | D0 (diálogo próprio) |
| 14 | "Por página" acima do título | D2 e D3 |
| 15 | Botões para quem não pode usar | D0 (função `pode`) |
