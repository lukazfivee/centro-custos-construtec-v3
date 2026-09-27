# Centro de Custos: inventário das telas atuais (desktop)

Levantado em 26/09/2026, na nuvem (`centro-custos-api.construtec-reports.workers.dev`), em 1440 px, logado como `pcm` (administrador), sem alterar nenhum dado. A lógica foi conferida contra o código (`public/*.js`, `routes/*`) do `main` em `f9ad286`. Os prints estão em `prints-centro-custos/`. Os números entre colchetes, como [05], são os arquivos de print.

O Orçamentos ficou para depois: o login dele na nuvem está com erro.

---

## 0. Estrutura geral

- **Topbar:**
  - Logo "Centro de Custos".
  - Status "Offline · Dados locais". É texto fixo, sem lógica e sem refletir a sincronização real.
  - Busca global: a partir de 2 letras, procura lançamentos e obras, com até 8 resultados.
  - Suíte (Portal Hub, Orçamentos, Centro de Custos "Atual", Chamados) [04].
  - Webmail UOL.
  - Tema claro/escuro [48].
  - Menu do perfil: nome, e-mail, papel, "Sair" [47].
- **Barra lateral** com 10 itens: Início, Lançamentos, Obras/centros, Categorias, Fornecedores, Cobranças, Configurações, Recorrentes, Reports, Usuários.
  - Recorrentes e Usuários são só para admin (`.admin-only`).
  - Cobranças só aparece para e-mails `@rcconstrutec.com.br`.
- **Botão flutuante "Reportar bug"** em todas as telas.
- **Perfis:**
  - Administrador: tudo.
  - Gestor: cadastros, exclusões, estorno, medições, NF e cobranças.
  - Supervisor: cria e edita lançamentos e consulta.
  - Hoje vários botões aparecem para o supervisor e o servidor responde 403. No redesenho, esconder pelo perfil.
- **Sincronização em segundo plano:** a cada 30 s, no foco e ao voltar online, sem nenhum indicador na tela. No redesenho, vale mostrar esse estado; a faixa de "sem internet" do mobile serve de base.

## 1. Início / Painel financeiro [01-03]

- **Filtros:** obra/centro (todos ou um) e mês. Chama `GET /dashboard/resumo?mes=&centroId=`.
- **KPIs:** Recebido, Pago, Resultado (vermelho se negativo), A receber, A pagar, Vencidos (com contagem).
- **Blocos:**
  - Evolução mensal de 12 meses (barras receita × despesa).
  - Atividades recentes (8).
  - Obras com maior movimentação (barra comprometido ÷ orçamento).
  - Despesas por categoria (top 8).
- **Lançamento rápido** [06]:
  - Campos: tipo, situação, obra (só ativas), categoria (filtrada pelo tipo), descrição (obrigatória), cliente/fornecedor (sugere fornecedores) e valor.
  - Datas = hoje.
  - Chama `POST /lancamentos`.
- **Primeiro uso:** banner com checklist (obra, categoria, fornecedor, 2 usuários, foto).

## 2. Lançamentos [05, 07-10]

- **Filtros:** busca (Ctrl+K), obra, tipo, situação (pendente / liquidado / cancelado), categoria, competência de/até e "Limpar". Ficam salvos no navegador.
- **Ordenação:** competência, vencimento, valor, inclusão ou alteração, com o sentido. Páginas de 25, 50, 100 ou 200.
- **Colunas:** Competência, Vencimento, Situação (Vencido, Pago, Recebido, A pagar, A receber), Tipo, Obra, Descrição/categoria/favorecido, Valor, Ações.
- **Rodapé da lista:** "Total líquido (página)" e "Exportar CSV".
- **Ações da linha:**
  - Documentos.
  - Editar.
  - Estornar: só para lançamento liquidado, admin ou gestor.
  - Excluir: admin ou gestor, com confirmação.
  - Clicar na linha abre a edição.
- **Novo/Editar** [07-09]:
  - Campos: tipo, competência, centro, categoria, descrição, favorecido, valor, vencimento, situação, data de pagamento, NF/documento, forma de pagamento (Pix, Boleto, Transferência, Cartão, Dinheiro, Outro), observação.
  - Erros tratados: competência fechada, alguém editou antes (revisão), estorno não editável, rateio.
- **Estorno:** data (não pode ser antes da original) e motivo (5 ou mais letras). Depois disso o lançamento ganha os selos "Estorno" e "Estornado".
- **Documentos** [10]:
  - Tipo: comprovante, nota fiscal, boleto, recibo, contrato ou outro.
  - Arquivo PDF, JPG, PNG ou WEBP de até 8 MB, com observação opcional.
  - Lista com baixar e excluir.

## 3. Obras / centros de custo [11-31]

- **Cabeçalho:** Importar orçamento [14], Sincronizar obras e centros, + Novo centro [13].
- **Cockpit da carteira** [11]:
  - KPIs: obras (em execução), valor contratual total, realizado global, saldo, horas medidas/planejadas, faturado ao cliente.
  - Alerta de obras acima de 80% ou com orçamento estourado.
- **Cards** [12]: situação, código e nome, cliente, realizado, valor contratado, Detalhes, Editar.
- **Formulário da obra** [13, 20]:
  - Campos: código, situação (planejamento, em execução, pausado, concluído), nome, cliente, contrato, responsável, início, término, valor contratado, descrição.
  - O "ativo" só aparece na edição.
- **Detalhe do centro** (janela) [15-19]:
  - Topo: total, compras e valor contratado, com os botões Análise de orçamento e Editar centro e status.
  - **Aba Detalhamento:** cliente, escopo, datas e aprovação da proposta. A proposta em PDF pode ser anexada, baixada ou removida. Tabela de compras com filtro por categoria e ordenação por valor.
  - **Aba Notas fiscais:** blocos Fornecedor e Cliente final. Cada um lança NF com emissão, valor, "já paga" e PDF, e tem lista com alternar paga e excluir.
  - **Aba Orçado × Realizado:** material e mão de obra, estimado × realizado, com o botão "Ver detalhamento completo".
- **Análise de orçamento** [21-22]:
  - Contrato e revisão (baseline com selo), com "Atualizar revisão".
  - Saldo disponível e consumo em % (ok, atenção acima de 80, estourado acima de 100), com o maior desvio.
  - KPIs: realizado, horas, valor contratual, custo base, exposição.
  - Gastos não vinculados, com "Vincular a insumo".
  - Planilha analítica: código, insumo, tipo, quantidade, custo orçado, realizado, desvio, saldo e curva ABC, com filtro por tipo e exportação CSV.
- **Medições** [23-26]:
  - **Mão de obra:** horas planejadas, medidas e saldo. Para lançar: início, fim, horas e observações, com histórico.
  - **Contrato (cliente):** valor contratual, medido e saldo a faturar. Para lançar: número, período, valor e observações, com histórico e "Emitir boletim".
- **Curva S** [27-29]: BAC, AC, EV, CPI, EAC e VAC; gráfico previsto × realizado acumulado; tabela mensal; premissas da metodologia.
- **Relatório executivo** [30-31]: cabeçalho da empresa, resumo financeiro, curva ABC e planilha de itens, com Exportar CSV e Imprimir/PDF.
- **Importar orçamento** [14]: arquivo `.json` do Orçamentos, prévia com a proposta REV, cliente, obra, valores e aviso de substituição, e "Confirmar ingestão".

## 4. Categorias [32-33] e Fornecedores [34-35]

- **Categorias:**
  - Tabela: nome, tipo padrão (despesa, receita ou ambos), número de lançamentos, status, editar.
  - Formulário: nome, aplicação e ativa.
- **Fornecedores:**
  - Tabela: razão social, CPF/CNPJ, contato, e-mail/telefone, status, editar.
  - Formulário: razão social, documento, contato, e-mail, telefone, observação e ativo.

## 5. Cobranças [36-37]

- **KPIs:** finalizadas, aguardando pagamento, cobranças pendentes, a receber.
- **Tabela:** obra/cliente, operação (em execução, finalizada, entregue), financeiro (a faturar, NF emitida, enviada, aguardando pagamento, pago), NF, vencimento, a receber, com as ações Editar e E-mail.
- **Acompanhamento** [37]: cliente, e-mails, responsável, número da NF, as duas situações, valores, conclusão, vencimento e observações.
- **E-mail ao cliente:** rascunho com Para, CC, Assunto, Mensagem e anexos (até 5 MB). O fluxo é Salvar, depois Autorizar (admin ou gestor), depois Enviar.

## 6. Recorrentes [38-39] (admin)

- **Cards:** nome, obra, tipo, valor, frequência, parcela x/y ou "sem limite", Editar e Excluir.
- **Formulário:** nome, tipo, valor, centro, categoria, favorecido, frequência (mensal a anual), dia do mês, parcelas (0 = sem limite) e forma de pagamento.

## 7. Configurações [40-41]

- **Foto de perfil:** redimensionada para 512 px.
- **Alterar senha:** atual, nova e confirmação, com mínimo de 8 caracteres.
- **Backup:** baixar `.tar.gz`. Para restaurar é preciso digitar "RESTAURAR".
- **Acesso pelo celular:** QR code e rede local (só no app Windows).
- **Informações do sistema:** versão e banco.
- **Reports centralizados:** status de entrega e "tentar pendentes".

## 8. Reports [42-43]

- **Lista:** título, tipo, severidade, entrega (entregue, aceito, falhou, fila), autor, data, com Reenviar e Gerenciar.
- **Novo report:** título, tipo, prioridade e descrição.

## 9. Usuários [44-46] (admin)

- **Tabela:** nome, e-mail, papel, status, com Editar, Desativar e Excluir login.
- **Novo usuário** [46]: nome, e-mail, senha provisória (10 ou mais caracteres) e perfil (supervisor, gestor, administrador).
- **E-mails externos autorizados** [45]: e-mail e observação, com revogar.

## 10. Telas que existem no código mas não estão no menu

- **Sincronização** (pelo botão em Obras):
  - `.ccsync`: exportar, importar, histórico e conflitos.
  - CSV: exportar, importar e conflitos local × recebida.
- **Histórico de auditoria:** sem acesso pelo menu.
- **Fechamento mensal:** o servidor está pronto, mas não há tela para fechar ou reabrir a competência.
- **Atualizações do app:** código morto.
- **Rateio:** só no servidor.
- **Módulos não carregados:**
  - cockpit com bancos e conciliação, ações em massa e visões salvas (`chatgpt-final.js`);
  - tela de Clientes e "Conta e segurança" (`v3-1-refinements.js`);
  - consentimento de report.
- **Decisão para o redesenho:** o que entra e o que fica de fora.

## 11. Problemas vistos (bom resolver no redesenho)

1. **Travamento provável no início:** `startApp` procura `#usuario-papel`, que não existe no HTML (`app.js:198`). Com isso:
   - a foto, a versão e o nome da instalação não carregam;
   - as regras de "só admin" não se aplicam;
   - o painel inicial pode não carregar.
   - Precisa ser confirmado.
2. **Loop de requisições em Lançamentos:** p2 e p4 observam a tabela e buscam até 1000 lançamentos a cada mudança, e a própria decoração dispara uma nova mudança (`chatgpt-p2.js`).
3. **Barra "comprometido ÷ orçamento" do painel sempre em 0%:** o formulário de obra não envia o `orcamento` (`routes/costCenters.js:156`).
4. **Datas cruas:**
   - período das medições em ISO ("2026-09-14T00:00:00.000Z") [24];
   - vencimento das cobranças;
   - datas dos não vinculados no relatório.
5. **Busca global:** clicar num resultado não abre o item.
6. **Estorno:** o clique na linha ainda abre a edição, e o servidor responde 409.
7. **E-mail de cobrança:** "Enviar" não salva as edições antes de enviar.
8. **Recorrentes:** nada gera os lançamentos (não há botão nem rotina).
9. **Revisão "REV010" para a versão 10:** `budget-view.js` junta "0" na frente.
10. **Versão em Configurações fixa em "3.0.0".**
11. **Status "Offline · Dados locais" fixo**, mesmo com a nuvem sincronizando.
12. **Textos de desenvolvimento visíveis:** "P4 · Documentos", "P3 ·". Glifos Unicode no lugar de ícones: ✉ ↻ ↶ ✓ ◫.
13. **Confirmações misturadas:** `confirm`, `prompt` e `alert` nativos junto com o diálogo próprio.
14. **"Por página" aparece acima do título** em Obras e Recorrentes.
15. **Botões visíveis para quem não pode usar:** novo centro, categoria, fornecedor, medições, backup.
