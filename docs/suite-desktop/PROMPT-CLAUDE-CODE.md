# Prompt para o Claude Code: desktop novo do Centro de Custos

Abra o Claude Code na raiz do repositório `centro-custos-construtec-v3` e cole o texto abaixo, a partir da linha "COPIAR A PARTIR DAQUI".

---

COPIAR A PARTIR DAQUI

Você vai levar para o código o desktop novo do Centro de Custos, aprovado no canvas de design "App mobile Construtec", nas Rodadas 17 a 20. Tudo o que você precisa está em `docs/suite-desktop/`. Leia nesta ordem, antes de escrever qualquer código:

1. `AGENTS.md` (regras do repositório) e `docs/suite-mobile/STATUS-CLAUDE.md`, para saber como o site do celular (`public/m/`) foi feito na Fase 2.
2. `docs/suite-desktop/01-ESPEC-TELAS.md`: tela por tela, com o print de cada estado, o que o sistema faz hoje e o que muda.
3. `docs/suite-desktop/02-LACUNAS-SERVIDOR.md`: o que o servidor já tem e o que falta criar ou ajustar.
4. `docs/suite-desktop/03-PLANO-FASES.md`: a ordem de entrega (D0 a D7), com o critério de pronto de cada fase.
5. `docs/suite-desktop/referencia-atual/INVENTARIO-CENTRO-CUSTOS.md`: a lógica atual, os campos, as permissões e os 15 problemas conhecidos. Nenhuma regra de negócio que existe hoje pode se perder.

## Fontes de verdade

- **Visual e comportamento:** os prints em `docs/suite-desktop/prints/` (1440 × 900) e o protótipo em `docs/suite-desktop/prototipo/`.
  - O arquivo `prototipo/Desktop.dc.html` traz os textos exatos, as validações, os estados e os dados de exemplo. Procure nele o texto de um botão ou de uma mensagem para achar a regra.
  - Para ver qualquer estado funcionando, sirva a pasta (`npx http-server docs/suite-desktop/prototipo -p 8791` ou `python -m http.server 8791` dentro dela) e abra `estado.html?start=<estado>`. A lista de estados está em `prototipo/README-PROTOTIPO.md`. `Desktop.dc.html` sozinho abre no Início, clicável.
  - O protótipo é referência. **Não copie o runtime dele** (`support.js`, `<x-dc>`, `{{ }}`) para o app.
- **Tokens e base visual:** `prototipo/desktop-base.css` (cores claro e escuro, cartões, botões, campos, tabela, menu, animações) e `docs/suite-mobile/design-tokens.json`. Fonte IBM Plex Sans e ícones Phosphor, os dois embutidos no app, sem CDN (como já é feito em `public/m/fonts/`).
- **Regras de negócio:** o servidor atual (`routes/`, `services/`, `migrations/`) e o inventário. Se o protótipo e o servidor discordarem numa regra de dinheiro, datas, fechamento ou permissão, **pare e pergunte ao Lucas**, sem escolher sozinho.

## Regras que não mudam

- Sem emojis e sem glifos Unicode no lugar de ícones. Só ícones SVG ou a fonte de ícones.
- Arquivos com até 350 linhas (`MAX_LINES`). Divida por tela e por componente, como em `public/m/`.
- Dinheiro em centavos com arredondamento HALF_UP. Datas na tela sempre em dd/mm/aaaa. Nunca mostre data ISO crua.
- Nada de `alert`, `confirm` ou `prompt` do navegador. Use o diálogo próprio do protótipo (prints 20, 71, 94).
- Esconder o que o papel não pode usar, além de o servidor recusar (403). Hoje vários botões aparecem e dão erro.
- `npm test` e `npm run check` verdes antes de dar qualquer fase por pronta. Crie testes para cada rota nova ou alterada.
- Migrações só aditivas, numeradas a partir da última existente (hoje `106_transaction_client_id.sql`).
- Não mexa em `public/m/` nem em `android/`, a não ser para reaproveitar código de forma compatível (ver D0).
- Commit só na branch da fase. Não faça push nem merge sem o Lucas pedir.

## Atenção antes de começar

- **A pasta de trabalho tem cerca de 420 arquivos marcados como alterados** com o mesmo número de linhas adicionadas e removidas. Isso é quase certamente troca de final de linha (CRLF e LF). Rode `git diff --ignore-all-space --stat` para confirmar. Não inclua esses arquivos nos seus commits. Se for o caso, avise o Lucas e sugira `git config core.autocrlf` ou um `.gitattributes`, sem aplicar por conta própria.
- A branch atual é `codex/mobile-liquid-glass-nav`. Crie a sua a partir do `origin/main` atualizado, de preferência numa worktree (`../wt-cc-desktop`), como foi feito na Fase 2.

## Decisões para confirmar com o Lucas antes de codar

Pergunte tudo de uma vez, com a sua recomendação em cada uma:

1. **Onde fica o desktop novo.** Recomendação: um app novo em `public/d/`, servido em `/d/` como o `/m/`, sem tocar no `public/index.html` atual. Quando todas as telas estiverem prontas e testadas, `/` passa a abrir o novo e o antigo fica em `/classico/` por um tempo. O motivo: o front atual tem camadas sobrepostas (`chatgpt-p*.js`, `v3-1-*.js`) e os problemas 1, 2 e 13 do inventário.
2. **Papéis.** O banco aceita só `admin`, `gestor` e `supervisor`. O protótipo tem seis (Administrador, Gestor, Financeiro, Engenharia, Técnico de campo, Comercial) e uma matriz de 12 permissões editável. Recomendação: fazer em D6, com migração que mapeia `supervisor` para `tecnico` e uma tabela de permissões por papel; até lá, a tela de Usuários mostra os três papéis atuais.
3. **Cobranças.** Hoje a cobrança é por obra (`/api/cloud-sync/cobrancas/:publicId`). O protótipo mostra uma cobrança por medição, com 4 passos (medição aprovada, NF emitida, e-mail enviado, pagamento). Confirmar se cada medição de contrato vira uma cobrança ou se o painel mostra os 4 passos com os dados que já existem por obra.
4. **Recorrentes quinzenais.** O protótipo tem "Quinzenal · dias 5 e 20". O servidor aceita mensal, bimestral, trimestral, semestral e anual. Adicionar quinzenal ou tirar do protótipo.
5. **Visibilidade por obra** ("obras que a pessoa vê", print 64). Não existe no servidor. Confirmar se entra em D6 junto com os papéis.
6. **Aba Sincronização.** Foi descontinuada no desenho (Rodada 20). O selo no topo continua mostrando o estado da sincronização. Confirmar se as rotas de sincronização por arquivo (`/api/sincronizacao*`) podem sair do menu de vez.

## Como trabalhar

- Siga o `03-PLANO-FASES.md`: uma fase por branch e por PR, na ordem.
- No início de cada fase, responda com um plano curto (arquivos que vai criar e alterar, rotas novas, testes) e espere o ok do Lucas.
- Valide cada tela no navegador em 1440 × 900 e em 1280 × 800, nos temas claro e escuro, contra o print correspondente. Guarde seus prints em `docs/suite-desktop/validacao/<fase>/`.
- Mantenha `docs/suite-desktop/STATUS-CLAUDE.md` atualizado ao fim de cada fase: o que fez, como validou, o que falta, os achados fora do escopo e as perguntas.
- Se achar um problema no protótipo (um texto, uma regra que não fecha), anote no STATUS e siga a regra do servidor.

Comece lendo os arquivos da lista acima e me mande o plano da fase D0 e as perguntas.
