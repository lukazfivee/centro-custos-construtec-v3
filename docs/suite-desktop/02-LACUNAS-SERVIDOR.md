# O que o servidor já tem e o que falta

Levantado em 27/09/2026 no código local (branch `codex/mobile-liquid-glass-nav`, commit `6d4b8c0`). **Confirme cada item no código antes de implementar**, porque o `main` pode ter andado.

Legenda:

- **Pronto:** a tela só consome a rota.
- **Ajuste:** a rota existe, mas precisa de um campo, filtro ou regra.
- **Novo:** não existe.

## Estrutura e topo

| Item | Situação | O que fazer |
|---|---|---|
| Sessão e papel do usuário | Pronto | `GET /api/auth/me`. |
| Tema por usuário | Pronto | `GET/POST /api/appearance`. |
| Selo de sincronização | Ajuste | Hoje `public/cloud-sync.js` sincroniza a cada 30 s e `GET /api/cloud-sync/status` só diz se está configurado. O selo precisa do horário da última sincronização, do resultado e do tamanho da fila. Guardar isso no cliente, a partir das respostas de `POST /api/cloud-sync/sincronizar` e do `navigator.onLine`, resolve sem rota nova. Se quiser mostrar a fila do celular, é rota nova. |
| Busca global | Pronto | A busca atual é no cliente (`public/global-search.js`). No app novo, use `GET /api/lancamentos?busca=` e `GET /api/centros-custo` com limite pequeno. |

## Início

| Item | Situação | O que fazer |
|---|---|---|
| KPIs, 12 meses, recentes, por centro, por categoria | Pronto | `GET /api/dashboard/resumo?mes=&centroId=` já devolve `tendencia` (12 meses), `porCentro`, `porCategoria` e `ultimosLancamentos`. |
| Barra orçado × realizado por obra | Ajuste | O formulário atual não envia `orcamento` (problema 3, `routes/costCenters.js`). Conferir se `POST/PUT /api/centros-custo` aceita e grava o campo. |

## Lançamentos

| Item | Situação | O que fazer |
|---|---|---|
| Lista, filtros, CSV, criar, editar, excluir, estornar | Pronto | `routes/transactions.js`, com `client_id` para reenvio sem duplicar. |
| Bloqueio de mês fechado | Pronto | O servidor já recusa criar, editar, excluir e estornar em competência fechada (403, com mensagem). A tela só precisa mostrar o cadeado e a faixa. |
| Anexos | Pronto | `routes/attachments.js`. Conferir o limite de 8 MB e a recusa de duplicados. |

## Obras

| Item | Situação | O que fazer |
|---|---|---|
| Carteira, detalhe, orçado × realizado, baselines, apropriações, medições, Curva S, proposta, NF | Pronto | `routes/costCenters*.js`, `routes/integracaoOrcamentos.js`. |
| Datas das medições | Ajuste | O período volta em ISO com hora. Formatar no cliente (dd/mm/aaaa) e, se possível, devolver só a data. |
| Revisão "REV010" | Ajuste | O erro está no cliente (`public/budget-view.js`). No app novo, formatar como `REV 10`. |

## Cobranças

| Item | Situação | O que fazer |
|---|---|---|
| Lista, rascunho, autorizar, enviar, clientes | Pronto | `routes/cloudSync.js` (`/cobrancas*`, `/clientes*`). |
| "Enviar" salva antes | Ajuste | No cliente: `PUT .../rascunho` e depois `POST .../enviar`. Se o servidor puder receber o rascunho no próprio `enviar`, melhor ainda. |
| Cobrança por medição, com 4 passos | Novo ou ajuste | Depende da decisão 3 do prompt. Se for por medição: ligar a cobrança à medição de contrato (`/:id/medicoes`) e guardar o passo atual e as datas de cada passo. |
| "Pedir autorização" (financeiro) | Novo | Registrar o pedido (auditoria) e avisar os gestores. Por e-mail já serve; a notificação no app entra com a Fase 4 do mobile. |

## Cadastros

| Item | Situação | O que fazer |
|---|---|---|
| Categorias: lista, criar, editar | Pronto | `routes/categories.js`. |
| Categorias: cor e descrição | Novo | Migração aditiva com `color` e `description` em `categories`. Aceitar e devolver os dois (`cor`, `descricao`). Paleta fixa validada no servidor. |
| Categorias: total do mês por categoria | Ajuste | A lista já traz `total_lancamentos`. Acrescentar o total em reais e a quantidade do mês (`?mes=`). |
| Categorias: nome repetido | Ajuste | Conferir se já dá 409. Se não, recusar nome igual (sem diferença de maiúsculas e acentos) no mesmo tipo. |
| Fornecedores: lista, criar, editar, CSV | Pronto | `routes/suppliers.js`. |
| Fornecedores: CPF/CNPJ | Novo | Validar 11 ou 14 dígitos (com dígito verificador) e recusar documento repetido com 409 e o nome do fornecedor que já tem o documento. Normalizar o documento só com dígitos para comparar. |
| Fornecedores: gasto do mês, lançamentos e categoria mais comum | Ajuste | Acrescentar à lista (`?mes=`) ou criar `GET /api/fornecedores/:id/resumo?mes=`. |
| Recorrentes: lista, criar, editar, excluir, gerar | Pronto | `routes/recurring.js`. O `/gerar` já tem idempotência. |
| Recorrentes: prévia antes de gerar | Novo | `POST /api/recorrentes/gerar?previa=1` (ou `GET /api/recorrentes/previa?mes=`): a mesma seleção do `/gerar`, sem gravar, devolvendo data, obra, valor e total. E um jeito de saber se o mês já foi gerado, para o botão "já gerado". |
| Recorrentes: quinzenal | Novo, se aprovado | Decisão 4 do prompt. O servidor aceita mensal, bimestral, trimestral, semestral e anual. |

## Usuários e permissões (D6)

| Item | Situação | O que fazer |
|---|---|---|
| Lista, criar com senha provisória, editar, status, excluir, e-mails externos | Pronto | `routes/users.js` (só `admin`). |
| Seis papéis | Novo | O `CHECK` da migração 001 aceita só `admin`, `gestor`, `supervisor`. Migração para aceitar `financeiro`, `engenharia`, `tecnico` e `comercial`, mapeando `supervisor` para `tecnico` (confirmar com o Lucas). Revisar todos os `exigirPapel(...)` das rotas: hoje são 53 chamadas. |
| Matriz de permissões | Novo | Tabela `role_permissions (role, permission, allowed)` com o padrão da seção 6 da espec. `GET/PUT /api/usuarios/permissoes`. Um `exigirPermissao('p3')` no `middleware/auth.js` substitui aos poucos o `exigirPapel`. O `admin` é sempre tudo, sem poder desligar. |
| Obras por usuário | Novo | Tabela `user_cost_centers`, ou "todas". Filtrar lançamentos, obras, painel e cobranças pelo que a pessoa vê. É a mudança mais arriscada: cobrir com testes. |
| Apps por usuário (Orçamentos, Centro de Custos) | Novo | Campo no usuário. O Orçamentos precisa respeitar isso no handoff da Suíte. |
| Convite por e-mail com código da empresa | Novo | Liga com a Fase 5 do mobile (cadastro com código da empresa e convite). Enviar pelo mesmo provedor de e-mail da recuperação de senha (Fase 1). Status "convite enviado", reenviar e expirar. |
| Último acesso | Novo | Gravar no login e no `me` (com limite de escrita, por exemplo uma vez a cada 5 min). |
| Usuários da nuvem | Atenção | `routes/users.js` espelha usuários da nuvem (`cloud_managed`). Qualquer papel novo precisa chegar também ao `cloudflare/center-container`. |

## Fechamento mensal e Histórico

| Item | Situação | O que fazer |
|---|---|---|
| Listar, fechar, reabrir | Pronto | `routes/monthlyClosing.js` (fechar e reabrir só `admin`). |
| Reabrir com motivo de 10 caracteres | Ajuste | Hoje aceita 5 e usa um texto padrão quando vem vazio. Passar a exigir 10 caracteres ou mais e recusar vazio. Ajustar os testes. |
| Totais por mês (receitas, despesas, resultado) | Ajuste | Dá para usar a `tendencia` do `GET /api/dashboard/resumo`. Se ficar pesado, criar `GET /api/fechamento-mensal/resumo?ano=`. |
| Checklist "Antes de fechar" | Novo | `GET /api/fechamento-mensal/checklist?ano=&mes=`, com: contas vencidas (quantidade e valor), despesas pagas sem anexo, cobranças sem NF ou sem envio, lançamentos em aberto, recorrentes do mês não gerados. A fila do celular vive no aparelho: mostre só "fila deste computador" ou tire o item. |
| Fechar com pendências | Ajuste | Aceitar `pendencias` no `POST` e gravar no fechamento e na auditoria. |
| Histórico: filtros | Pronto | `GET /api/historico?tipo=&busca=` com paginação. |
| Histórico: pessoa e período | Ajuste | Acrescentar `usuario=`, `de=` e `ate=`. |
| Histórico: antes → depois | Ajuste | A auditoria guarda `data` (o registro novo). Guardar também o anterior (`before`) em edições e mostrar o diff dos campos que mudaram. Migração aditiva, se precisar de coluna. |
| Histórico: origem | Novo | Gravar de onde veio a ação: computador, celular (`x-client` ou user agent `SuiteConstrutec/`) ou fila offline (lançamento com `client_id` reenviado). |
| Histórico: exportar CSV | Novo | `GET /api/historico/exportar.csv` com os mesmos filtros. |

## Reports e Configurações

| Item | Situação | O que fazer |
|---|---|---|
| Reports: lista, novo, reenviar, entrega | Pronto | `routes/bugReports.js`. |
| Reports: diagnóstico e print | Ajuste | Conferir se o `POST` aceita o diagnóstico e um anexo. O diagnóstico nunca leva senha, token ou valores. |
| Reports offline | Cliente | Fila no navegador, como a do celular. |
| Perfil: foto, senha, me | Pronto | `routes/auth.js`. |
| Perfil: nome e telefone | Ajuste ou novo | Conferir se existe rota para a pessoa editar o próprio nome. O telefone não existe no usuário: migração aditiva. |
| Trocar senha encerra outras sessões | Ajuste | No modo nuvem, usar a revogação de sessões da Fase 1 do mobile. Conferir o modo local. |
| Backup: status, baixar, restaurar | Pronto | `routes/backup.js` (só `admin`, restaurar pede RESTAURAR) e `routes/backupAuto.js`. |
| Backup: lista das cópias e cópia antes de restaurar | Ajuste | Conferir se `GET /api/backup/status` lista as cópias guardadas. Restaurar deve salvar antes uma cópia do estado atual. |
| Sistema: versão, banco, atualização | Pronto | `GET /api/sistema/status` e `/api/update/*`. A versão deve vir do `package.json` (problema 10). |
| Sistema: armazenamento e aparelhos | Novo, opcional | Só se for barato. Se não, a tela mostra o que tem. |

## Regras gerais para as rotas novas

- Toda rota nova tem teste em `test/` (sucesso, validação, permissão 403 e, quando couber, conflito 409).
- Toda escrita grava auditoria com `recordAudit`.
- Mensagens de erro em português, curtas, no campo `erro`, como as de hoje.
- Nada de `SELECT *`. Paginar listas que podem crescer.
- Lembre do achado da Fase 2: no PGlite, `rowCount` de `SELECT` vem 0. Conte linhas.
- Lembre do achado da Fase 2: "vencida" usa `CURRENT_DATE` em UTC. O checklist e os KPIs de vencidos devem usar a data de Brasília.
