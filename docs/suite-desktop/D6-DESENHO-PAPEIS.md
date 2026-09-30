# D6 — Desenho: papéis, permissões e obras por usuário

Rascunho de 29/09/2026 para aprovação do Lucas. Nada disto foi implementado.

## Problema

- O papel do usuário vive no diretório central (D1, tabela `cloud_users.role`, valores `admin|gestor|supervisor`) e é **compartilhado com o Orçamentos**.
- O Centro copia esse papel para `users.role` a cada login/listagem (`services/cloudUserMirror.js`). Qualquer papel novo gravado só no banco local seria sobrescrito.
- O servidor decide acesso com `exigirPapel(...)`: 54 usos (30+10 `admin,gestor`; 8 `admin`; 6 `admin,gestor,supervisor`).
- Não existe hoje restrição por obra nem tabela `user_cost_centers`.

## Proposta

### 1. Papel de 6 valores sem quebrar o papel antigo
- Manter `role` (3 valores) como está: o Orçamentos e o Worker continuam funcionando.
- Acrescentar no D1 (migração `012`, aditiva) `cloud_users.suite_role` (`admin|gestor|financeiro|engenharia|tecnico|comercial`), `cloud_users.apps` (JSON: `["centro","orcamentos"]`) e `last_seen_at`.
- Preenchimento inicial: `admin→admin`, `gestor→gestor`, `supervisor→tecnico`. Sempre que `suite_role` for definido, `role` é derivado dele para compatibilidade (admin→admin, gestor→gestor, demais→supervisor).
- O Worker devolve `suite_role` e `apps` junto com o usuário; o espelho do Centro grava em colunas novas (`users.suite_role`, `users.apps`), sem tocar em `users.role`.

### 2. Matriz de permissões
- Tabela `role_permissions(role, permission, allowed)` no D1 (fonte única para celular e desktop), com os 12 valores padrão de `01-ESPEC-TELAS.md` §6. Admin travado com tudo. "Restaurar padrão" regrava o padrão.
- O Centro busca a matriz do Worker, guarda em cache (TTL curto) e usa `exigirPermissao('p3')` no servidor.
- Migração das rotas em etapas: cada `exigirPapel('admin','gestor')` passa a uma permissão específica (cadastros → p5, cobranças → p6, edição de lançamento → p3 etc.), mapeadas rota a rota em tabela no código, com teste por papel. Enquanto uma rota não migrar, `exigirPapel` continua valendo, usando o papel legado derivado.

### 3. Obras por usuário
- Fica no banco do Centro (os IDs de obra são locais): `user_cost_centers(user_id, cost_center_id)` e `users.all_cost_centers BOOLEAN DEFAULT TRUE`.
- Middleware `escopoObras` injeta a lista permitida. Aplicar em painel, obras, lançamentos, cobranças, medições, documentos e busca; acesso por URL a obra fora da lista devolve 403.
- Admin, gestor, financeiro e comercial: todas as obras por padrão. Engenharia e técnico: só as atribuídas (decisão a confirmar).

### 4. Convite e último acesso
- Convite por e-mail já existe (Fase 5 mobile, `signup_invites`); acrescentar `apps` e `suite_role` ao convite.
- `last_seen_at`: atualizado no login e no refresh de sessão.

## Riscos e decisões que precisam do Lucas

1. **`supervisor→tecnico` tira poderes.** Hoje o supervisor cria **e edita** lançamentos e consulta tudo. O técnico só lança (p2), não edita (p3) e, pela regra de obras, só vê obras atribuídas. Sugestão: na migração, todo supervisor existente recebe "todas as obras" (`all_cost_centers=TRUE`) para não perder acesso, e o Lucas ajusta depois. A edição de lançamento passa a p3 e o supervisor a perde. Aceita?
2. **Onde mora a matriz:** central (recomendado, vale para o Orçamentos p10/p11) ou só no Centro (mais simples, mas Orçamentos ignoraria p10–p12).
3. **Técnico/engenharia sem obras atribuídas:** ver nada (recomendado) ou ver todas até o admin restringir.
4. **Deploy:** exige publicar o Worker (D1 `012`) **antes** do Container do Centro, e compatibilidade nos dois sentidos durante a troca (Centro novo tolera Worker sem `suite_role`, caindo no mapeamento do papel legado).

## Ordem de execução sugerida

1. Worker: migração `012` + `suite_role`/`apps` nas respostas + matriz (testes no Worker).
2. Centro: colunas locais + espelho + `exigirPermissao` + matriz em cache; rotas migradas por grupo, cada grupo com teste por papel.
3. Centro: `user_cost_centers` + `escopoObras` + testes de 403 por URL.
4. Telas: papéis, permissões, obras, apps, "Ver o sistema como".
5. Só então PR, migração e publicação (Worker primeiro).
