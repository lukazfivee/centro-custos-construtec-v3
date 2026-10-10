# Decisões técnicas

## 2026-09-29 — Recorrências da D5

- Cada lançamento recorrente registra o ID do modelo e o primeiro dia do mês gerado. Um índice único nesse par impede repetição mesmo sob concorrência; o nome visível não serve como identidade.
- A geração confere novamente o token da prévia dentro da transação e serializa geradores antes de calcular o plano.
- Modelos anteriores à migração guardam o último número de parcela já consumido. O histórico sem proveniência não é inferido pela descrição, e meses pulados após a migração continuam elegíveis.
- O índice único de CPF/CNPJ exige conciliar documentos legados duplicados antes de aplicar a migração 107 em uma base real.

## 2026-09-29 — Exclusão de centros de custo

- A exclusão física é permitida somente para administrador e para centros sem dados vinculados. O servidor verifica todos os vínculos diretos conhecidos dentro de uma transação e mantém o bloqueio por chave estrangeira como proteção adicional.
- A exclusão grava um tombstone pelo `public_id` na mesma transação. Importações CSV e pacotes de sincronização antigos não podem recriar esse centro nesta instalação, inclusive pela resolução manual de conflitos.
- A exclusão não é propagada para outras instalações. As duas interfaces informam esse alcance antes da confirmação; centros com histórico devem ser inativados.

## 2026-10-04 — Configurações do desktop (D7)

- A senha mínima continua em 10 caracteres (e não 8, como no desenho): o servidor local e o Worker central já exigem 10, e baixar só na tela criaria erro no envio.
- Trocar a senha no modo local encerra as outras sessões (coluna `sessions_valid_from`, migração 112) e devolve um token novo para a sessão atual; no modo nuvem a revogação já é feita pelo Worker.
- Restaurar uma cópia guardada salva antes uma cópia do estado atual e exige digitar RESTAURAR (só admin).
- O telefone do perfil passa a ser guardado no usuário local (migração 112).

## 2026-10-04 — Revisão de segurança do Centro

- Sincronização e cadastros: exportar e importar passam a exigir permissão (p9 para ler pacote, histórico e conflitos do pacote inteligente; p5 para importar pacote e cadastros; p3 para a troca CSV de lançamentos e a resolução de conflitos). Histórico, update e POST de aparência exigem p9.
- Integração com o Orçamentos: as leituras por sessão de usuário exigem p10 e acesso à obra do contrato; a chave de serviço continua entrando como admin. A chave de integração padrão é pública no repositório, então no modo local ela só vale vinda do loopback; `CONSTRUTEC_INTEGRATION_LOOPBACK_ONLY=false` (valor explícito) desliga a exigência. Na nuvem a exigência segue opcional (`true`), pois o tráfego chega pelo Worker e a chave é forte.
- Handoff por app: o Worker envia `suiteRole` e `apps` ao Container e ao Orçamentos. No espelho, conta nova sem papel da Suíte é tratada como o papel antigo (supervisor = técnico) e nasce sem acesso a todas as obras; contas antigas não mudam.
- CSV: células de texto que começam com = + - @ (ou tab/CR) ganham apóstrofo; números, inclusive negativos, não são alterados.
- Aviso de resposta do cliente (Orçamentos): a chave de deduplicação passa a usar o minuto, e não o instante, para que um reenvio não duplique o aviso.

## 2026-10-04 — Pendências da revisão de segurança resolvidas (A4, M1, M4, M5, M8)

- A4: o Express do Centro repassa o IP real do cliente ao Worker (`X-Construtec-Client-IP`, vindo de `CF-Connecting-IP` na nuvem) junto com `X-Construtec-Identity-Key` e `X-Construtec-App: centro`, só no login. O Container passa a receber `CONSTRUTEC_IDENTITY_KEY` (mesmo valor do Orçamentos). O Worker limita o login a 60 por hora por IP real (o cabeçalho só vale com a chave de serviço válida e formato de IP) e a 10 falhas por hora por e-mail; só falha conta no limite por e-mail. Sem a chave no Container, tudo segue como antes (limite pelo IP de saída).
- M1: `apps` vale no login do Centro (Worker e Express), em cada requisição autenticada do Express, na ponte do handoff e no handoff do Worker (emissão e troca: `centro-custos` exige `centro`; `orcamentos` exige `orcamentos`). Ausência de `apps` = todos. O login com a chave de serviço sem `X-Construtec-App` é tratado como Orçamentos e não é barrado no Worker (o Orçamentos aplica o próprio app).
- M4: lista de fornecedores (gasto e quantidade do mês) e `/:id/resumo` somam e listam só as obras permitidas ao usuário escopado; sem obra, zeros e lista vazia. O cadastro de fornecedores continua global.
- M5: medição só entra em contrato da obra da rota (`project_contracts.cost_center_id`); caso contrário, 404.
- M8: bloqueio de login por e-mail + IP (5 falhas = 15 min) e limite global por e-mail (30 falhas = 15 min), em memória, com janela, varredura a cada 5 minutos e teto de 5000 chaves por controle.

## 2026-10-06 — Atualização do app Windows por dentro do app

- O repositório é público e as releases saem como pré-lançamento (v3.1.0-rc.N). O provedor "github" do electron-updater segue o canal "rc" do app instalado e nunca enxerga a versão final (3.1.0) depois do último rc. Por isso o app lê a lista pública de releases (releases.atom, sem token e sem limite de API), escolhe a mais recente que tem latest.yml e aponta o provedor "generic" para a pasta de downloads dessa release. Não há segredo embutido e o Worker não entra no caminho. `UPDATE_FEED_URL` (https) troca o feed por outro endereço, caso o repositório um dia vire privado (um proxy no Worker com secret próprio serviria latest.yml e instalador).
- Instalação silenciosa (`quitAndInstall(true, true)`): antes de rodar o instalador o app encerra o Express do Centro, o banco (PGlite), o Orçamentos e o ChamadoPro (`encerrarServicos`, também usado no before-quit). Sem isso o instalador encontrava arquivos do banco em uso.
- O instalador NSIS não é assinado e o app não define `publisherName`, então o electron-updater não exige assinatura. Se um dia houver certificado, defina `build.win.publisherName`. A versão portátil não se atualiza.
- Verificação em segundo plano no desktop novo: só no Electron, só para quem tem p9, no máximo uma vez a cada 6 horas.

## 2026-10-10 — Suíte: Orçamentos recebe a sessão do Centro, não um código de uso único

- Sintoma: na Suíte instalada, a tela de login do Orçamentos mostrava "Integração de contas com o Centro de Custos não configurada neste servidor". A troca do código de uso único (`/v1/auth/handoff/consume`) exige a chave de serviço `CONSTRUTEC_IDENTITY_KEY`, segredo do servidor que não existe no app instalado. A prova de 09/10 só tinha rodado contra uma central simulada.
- A chave não pode ir no instalador (repositório e releases públicos). Dentro da Suíte os servidores do Centro e do Orçamentos rodam no mesmo processo: o processo principal gera uma chave interna por execução (`CONSTRUTEC_SUITE_INTERNAL_KEY`, em memória, enviada no cabeçalho `x-suite-internal`) e `POST /api/auth/suite-handoff` devolve a sessão corporativa da própria conta só a quem a apresenta (comparação em tempo constante). Sem o cabeçalho, a rota segue emitindo código como antes.
- O Orçamentos valida essa sessão no Centro só com o Bearer (`/v1/auth/session`, que não exige a chave) e aplica `apps` e permissões pelo `suiteGuard`. Os dois apps passam a compartilhar a mesma sessão central: sair de um encerra a do outro, como já era a intenção.
