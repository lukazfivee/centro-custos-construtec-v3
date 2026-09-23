# Identidade compartilhada entre Centro de Custos e Construtec Orçamentos

## Contexto e objetivo

Hoje o Centro de Custos CONSTRUTEC e o Construtec Orçamentos são dois produtos
com sistemas de login completamente independentes:

- **Centro de Custos**: Cloudflare D1 (`centro-custos-producao`), hashing
  PBKDF2, sessão Bearer, rate limit — implementado em
  `cloudflare/center-container/centralAuth.js`. Corrigido e validado em
  produção nesta mesma sessão (`CC-LOGIN-CORPORATIVO-20260918`).
- **Construtec Orçamentos**: Postgres (local PGlite no desktop, Postgres na
  nuvem), hashing bcrypt, sessão JWT — implementado em
  `src/server/services/auth.ts` do repositório do Orçamentos.

O usuário quer que os dois produtos funcionem como um sistema só do ponto de
vista de conta: **um único login, uma única senha**, usável em qualquer um
dos dois. Cada produto continua com seu próprio controle de permissões
internas (papéis diferentes, ver abaixo).

Nenhum dos dois produtos tem usuário real em produção hoje (confirmado com o
usuário: "no momento os dados em centro de custo também são testes") — não há
necessidade de migrar contas existentes. Esta é a janela mais barata para
unificar, antes de existir qualquer conta real.

Este é o **sub-projeto 1** de uma iniciativa maior (ver
`docs/superpowers/specs/2026-09-19-sincronizacao-orcamentos-design.md`, no
repositório do Construtec Orçamentos, para o sub-projeto 2). Tudo o mais
depende deste.

## Decisão de propriedade (confirmada com o usuário)

**O Centro de Custos é o dono oficial da conta.** O Construtec Orçamentos
deixa de ter seu próprio sistema de senha e passa a delegar autenticação para
o Centro de Custos, tanto na nuvem quanto no desktop (via cache local, ver
"Login offline no desktop" abaixo).

Motivo dado pelo usuário: o login do Centro de Custos já foi testado e
corrigido em produção hoje; é a base mais estável das duas.

## Escopo

Dentro deste sub-projeto:

- Lista de e-mails externos autorizados (fora do domínio corporativo) no
  Centro de Custos, controlada por um admin.
- Construtec Orçamentos (nuvem) delegando login/criação de conta para o
  Centro de Custos, sem manter mais sua própria tabela de senha.
- Construtec Orçamentos (desktop) mantendo uma cópia local, somente-leitura,
  da lista de contas autorizadas, para permitir login **offline**.
- Migração do hashing de senha do Orçamentos de bcrypt para o formato PBKDF2
  já usado pelo Centro de Custos (corte limpo, sem período de transição —
  não há senha real para migrar).
- Papéis (roles) continuam **por produto**: a mesma conta pode ser "gestor"
  no Centro de Custos e "comercial" no Orçamentos; cada produto guarda e
  decide isso por conta própria.
- Um admin pode **excluir o login** de alguém a partir de qualquer um dos
  dois produtos. Confirmado com o usuário (respondeu inicialmente
  "desativar", depois corrigiu para isto, que é a versão final): a conta
  some da lista de logins e o e-mail fica **livre para ser usado numa
  conta nova** (com senha igual ou diferente, ID novo) — sem opção de
  desfazer a exclusão depois (se quiser a pessoa de volta, é uma conta
  nova). O histórico que a pessoa criou (propostas, lançamentos,
  auditoria) continua intacto e continua mostrando o nome dela
  normalmente — a exclusão nunca apaga nem desvincula esses registros.
  Mecanismo: a conta excluída **não é removida da tabela** (isso quebraria
  as referências do histórico); ela é marcada como excluída
  (`deleted_at`) e passa a ficar fora da restrição de e-mail único (índice
  único condicional a `deleted_at IS NULL`), liberando o e-mail para uma
  linha nova sem tocar na linha antiga.

Fora do escopo (fica para depois, por decisão consciente):

- Fundir os dois produtos num só código/interface (avaliado e descartado
  como escopo desta iniciativa — ver conversa: reescrever um dos dois
  seria um projeto de meses, tecnologias muito diferentes — React/Electron
  vs. Express + JS puro).
- Sincronização de dados de negócio do Orçamentos (propostas, catálogo,
  clientes, obras) — sub-projeto 2, depende deste.
- Presença em tempo real ("fulano está editando") e propostas
  privadas/rascunho — sub-projetos 4 e 5, mais adiante.

## Regras de negócio confirmadas com o usuário

- **Domínio corporativo por padrão**: conta normalmente precisa ser
  `@rcconstrutec.com.br` (regra que já existe no Centro de Custos hoje).
- **Exceção sob autorização**: um admin pode autorizar um e-mail específico
  fora do domínio corporativo (ex.: vendedor terceirizado) antes que essa
  pessoa possa se cadastrar com ele.
- **Criar conta sempre exige internet**, mesmo que o uso do dia a dia depois
  funcione offline — evita contas órfãs/duplicadas.
- **Papéis por produto, não um papel único global.**

## Arquitetura

```
                         ┌─────────────────────────────┐
                         │   Centro de Custos (dono)    │
                         │  D1 + centralAuth.js         │
                         │  - login / bootstrap         │
                         │  - criação de usuário        │
                         │  - lista de e-mails externos │
                         │    autorizados (novo)        │
                         └───────────┬──────────────────┘
                                     │ HTTPS server-to-server
                     ┌───────────────┴────────────────┐
                     │                                 │
        ┌────────────▼────────────┐      ┌────────────▼────────────┐
        │ Orçamentos — nuvem       │      │ Orçamentos — desktop     │
        │ (Cloudflare Worker)      │      │ (Electron, PGlite local) │
        │ delega login/criação     │      │ cache local (só leitura) │
        │ para o Centro de Custos  │      │ de contas + senha PBKDF2 │
        │ a cada requisição        │      │ sincronizada quando há   │
        │                          │      │ internet; login offline  │
        │                          │      │ valida contra esse cache │
        └──────────────────────────┘      └──────────────────────────┘
```

## Fluxos

### Login pela nuvem (Orçamentos web ou Centro de Custos)

1. Usuário informa e-mail/senha na tela do Orçamentos (nuvem).
2. O Worker do Orçamentos repassa a chamada para
   `POST /v1/auth/login` do Centro de Custos (já existe, sem mudança de
   contrato).
3. Centro de Custos valida e devolve um token de sessão Bearer.
4. Orçamentos guarda esse token como a sessão do usuário (mesmo mecanismo de
   token, só que emitido por outro serviço) e o usa em toda chamada
   subsequente para validar quem está logado
   (`GET /v1/auth/session` ou equivalente no Centro de Custos).
5. Papel (role) do usuário **dentro do Orçamentos** é resolvido pelo próprio
   Orçamentos, consultando sua própria tabela de papéis por usuário
   (chave: o `id` de usuário devolvido pelo Centro de Custos).

### Criar conta nova (sempre online, disparado de qualquer um dos dois apps)

1. Admin abre "novo usuário" no Centro de Custos **ou** no Orçamentos.
2. A requisição vai sempre para `POST /v1/users` do Centro de Custos
   (endpoint já existe; Orçamentos passa a chamá-lo em vez de escrever na
   própria tabela).
3. Se o e-mail não é do domínio corporativo, a criação só é aceita se esse
   e-mail já estiver na lista de autorizados externos (nova tabela D1,
   gerida por admin) — senão, erro claro pedindo para autorizar primeiro.
4. Conta criada no Centro de Custos propaga para o cache local de qualquer
   desktop do Orçamentos na próxima sincronização (pull).

### Login offline no desktop do Orçamentos

1. Sem internet, o Orçamentos desktop não tenta contatar o Centro de Custos.
2. Valida e-mail/senha contra a cópia local (tabela de cache, sincronizada da
   última vez que houve internet), usando o mesmo algoritmo PBKDF2 do Centro
   de Custos.
3. Sessão gerada localmente, válida só neste dispositivo, como hoje.
4. Se a pessoa nunca sincronizou antes (primeiro uso deste desktop sem nunca
   ter tido internet), não há cache — login falha com mensagem clara pedindo
   para conectar à internet pelo menos uma vez.

### Sincronização do cache local de contas (desktop)

- Só-leitura (pull), nunca push: o desktop nunca cria/edita conta sozinho.
- Roda junto com o mesmo ciclo de sincronização periódico do sub-projeto 2
  (a cada 15–30s quando há internet), buscando mudanças desde o último
  cursor conhecido.
- Campos armazenados localmente: `id`, `nome`, `email`, `password_hash`
  (formato PBKDF2), `ativo`. Papel (role) do Orçamentos fica em tabela
  própria do Orçamentos, não vem do Centro de Custos.

## Modelo de dados (mudanças)

**Centro de Custos (D1), nova tabela:**

```sql
CREATE TABLE authorized_external_emails (
  email TEXT PRIMARY KEY,
  authorized_by TEXT NOT NULL,      -- id do admin que autorizou
  authorized_at TEXT NOT NULL,
  note TEXT                          -- motivo/observação, opcional
);
```

**Construtec Orçamentos (Postgres, cloud e local via PGlite):**

- Tabela `users` existente perde as colunas de senha bcrypt; passa a ser
  populada só por sincronização (pull) a partir do Centro de Custos —
  `id`, `name`, `email`, `password_hash` (PBKDF2), `active`.
- Nova tabela `user_product_roles` (ou reaproveitar coluna `role` já
  existente em `users`, migrada para uma tabela própria): `user_id`, `role`
  (`admin` / `commercial` / `viewer`), específica do Orçamentos.
- Remoção do fluxo de cadastro/senha local (`setupFirstAdmin` deixa de criar
  senha própria; primeiro acesso do Orçamentos passa a ser "entre com uma
  conta do Centro de Custos" ou "peça pra um admin te autorizar").

## Tratamento de erro

- Centro de Custos inacessível durante uma tentativa de login **online**
  (mas há internet em geral): erro claro, não cai silenciosamente para o
  cache local (evitaria mascarar uma senha trocada recentemente).
- Criar usuário com o Centro de Custos fora do ar: falha explícita — essa
  operação sempre exige o serviço dono no ar.
- E-mail fora do domínio corporativo sem autorização prévia: erro específico
  "e-mail não autorizado; peça a um administrador para liberar".

## Testes

- Reaproveitar os testes já existentes de `centralAuth.js` no Centro de
  Custos (login, bootstrap, rate limit) sem alterar seu comportamento
  público, só adicionando a checagem da lista de autorizados.
- Novo teste de integração no Orçamentos: repositório do Orçamentos sobe um
  Centro de Custos "de mentira" (stub HTTP mínimo respondendo os mesmos
  contratos) para validar a delegação de login/criação, sem depender do
  Centro de Custos real rodando durante `test:critical`.
- Novo teste no Orçamentos para o cache local: sincroniza um usuário de
  exemplo, confirma que login offline funciona batendo contra o hash PBKDF2
  local, e que login com senha errada falha corretamente.

## Perguntas em aberto para quem for implementar

Nenhuma pendência bloqueante identificada nesta spec — os pontos abaixo são
detalhes de implementação que podem ser resolvidos durante o plano, sem
precisar de nova decisão de produto:

- Formato exato do token de sessão que o Orçamentos passa a aceitar do
  Centro de Custos (reaproveitar Bearer tal como está, mais simples).
- Onde fica o segredo compartilhado usado pela chamada servidor-a-servidor
  entre os dois Workers (variável de ambiente/secret do Cloudflare em cada
  lado, nunca no cliente).

## Atualização 2026-09-22 — decisões e implementação

### Arquitetura real (corrige a seção acima)

O Centro de Custos tem duas bases de usuários na nuvem:

- **D1 `centro-custos-producao` (`cloud_users`)**: a fonte da verdade das contas, servida
  pelo Worker `centro-custos-api` em `/v1/*` (`cloudflare/center-container/centralAuth.js`
  e `identityAdmin.js`).
- **PostgreSQL (Neon) `users`**: espelho local usado pela interface do Container
  (sessão JWT própria de 8h). A linha local é casada pelo id central (`cloud_user_id`).
  Como a sessão central é revalidada a cada 60s (`services/cloudSessionCheck.js`), um
  login excluído ou desativado pelo Orçamentos perde o acesso ao Centro em até 1 minuto.

### Decisões do usuário

- Admin do Centro = admin do Orçamentos. As demais contas entram no Orçamentos como
  `viewer` até um admin do Orçamentos mudar o papel.
- Admin de **qualquer** produto cria, desativa e exclui contas. O Orçamentos chama o
  diretório servidor a servidor com a chave `CONSTRUTEC_IDENTITY_KEY` (segredo nos dois
  Workers) e a sessão Bearer de quem agiu. Por essa via, o diretório só cria contas como
  `supervisor` no Centro e nunca altera nem exclui um admin do Centro.
- Login offline no desktop do Orçamentos fica **fora desta rodada**; o desktop passa a
  exigir internet para logar.
- As contas de teste do Orçamentos podem ser descartadas.

### Contrato `/v1` do diretório

| Rota | Quem | Efeito |
| --- | --- | --- |
| `POST /v1/auth/login` | qualquer | Aceita e-mail corporativo ou externo com conta criada |
| `GET /v1/auth/session` | Bearer | Valida a sessão e devolve o usuário central |
| `POST /v1/auth/logout` | Bearer | Encerra a sessão |
| `GET/POST /v1/users` | admin do Centro, ou chave de serviço + Bearer | Lista/cria contas |
| `POST /v1/users/status` | idem | Ativa/desativa |
| `POST /v1/users/delete` | idem | Exclui login (`deleted_at`), libera o e-mail |
| `GET/POST /v1/authorized-emails`, `POST /v1/authorized-emails/revoke` | idem | E-mails externos autorizados |

Com a chave de serviço, o limite de login usa o IP do usuário repassado em
`X-Construtec-Client-IP`, e as demais chamadas usam um balde próprio do Orçamentos.

Migrações: D1 `cloudflare/center-container/d1-migrations/006-identidade-compartilhada.sql` (aplicada com `wrangler d1 execute --remote --file`);
PostgreSQL `migrations/105_users_shared_identity.sql`.

Revogar a autorização de um e-mail externo não exclui a conta já criada; para
remover o acesso use "Excluir login".
