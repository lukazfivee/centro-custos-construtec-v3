# Pacote de continuação: Suíte Construtec mobile

Este pacote leva o protótipo aprovado no canvas "App mobile Construtec" para o código real, com o trabalho **dividido entre o Codex e o Claude Code**. Cada um cuida de uma parte e mexe só nos seus arquivos, então os dois trabalham ao mesmo tempo sem conflito e cada um lê menos código.

## Como usar

1. Descompacte esta pasta dentro do repositório do Centro de Custos, em `centro-custos-construtec-v3/docs/suite-mobile/`.
2. Faça commit dessa pasta no `main` (ou numa branch `docs/suite-mobile` com merge rápido), para que as duas IAs partam da mesma base.
3. **Codex** (servidor): abra na raiz do repositório e cole o conteúdo de `PROMPT-CODEX.md`, a partir da linha "COPIAR A PARTIR DAQUI".
4. **Claude Code** (app Android): abra na raiz do repositório e cole o conteúdo de `PROMPT-CLAUDE-CODE.md`, também a partir da linha "COPIAR A PARTIR DAQUI".
5. Os dois vão responder com um plano curto e perguntas. Responda cada um, dando o ok.
6. Enquanto trabalham, cada um escreve no seu `STATUS-*.md`. Se um pedir algo ao outro (seção "Pedidos ao..."), copie o pedido para o outro agente.
7. Faça o merge do PR do **Codex primeiro**, depois o do **Claude Code**.
8. Para as próximas fases, use o prompt curto no fim de `03-PLANO-FASES.md`, colando para cada agente com a coluna certa.

## Quem faz o quê na Fase 1

| Codex (servidor, `cloudflare/center-container`) | Claude Code (app, `android/`) |
|---|---|
| Recuperar senha (pedido, e-mail, página, confirmação) | Login de vidro, PIN, biometria, bloqueio, recuperar senha no app |
| Revogar sessões e listar aparelhos | Tela de Segurança e bloqueio automático |
| Handoff da sessão para o Centro de Custos web | Cofre no Keystore, barra de status transparente, animação de sucesso |
| App Link (`assetlinks.json`) e testes de API | Mock do servidor e testes da lógica JS |

O contrato entre os dois está em `04-CONTRATO-API.md`.

## O que tem aqui

| Arquivo | Para que serve |
|---|---|
| `PROMPT-CODEX.md` | Prompt da Fase 1 para o Codex. |
| `PROMPT-CLAUDE-CODE.md` | Prompt da Fase 1 para o Claude Code. |
| `01-CONTEXTO-REPOSITORIOS.md` | O que já existe nos dois repositórios e as lacunas. |
| `02-ESPEC-LOGIN-MOBILE.md` | Telas, textos, regras, animações e segurança do login escolhido. |
| `03-PLANO-FASES.md` | Divisão das fases 1 a 5 entre os dois, e o prompt curto das próximas. |
| `04-CONTRATO-API.md` | Rotas que o Codex entrega e o Claude Code consome. |
| `STATUS-CODEX.md`, `STATUS-CLAUDE.md` | Onde cada agente registra o que fez, o que falta e os pedidos ao outro. |
| `design-tokens.json` | Cores, fontes, raios, sombras, tempos de animação e regras (PIN, senha). |
| `prototipo/` | Fonte do protótipo e um guia de onde está cada tela. |
| `assets/` | Símbolo da Construtec (fundo transparente) e logo completo para fundo escuro. |

## Decisões já tomadas

- Login visual: **vidro sobre gradiente** (8h do canvas).
- Dia a dia: **PIN de 6 dígitos com teclado grande** (11d), com a digital no teclado.
- Primeiro acesso ou PIN esquecido: e-mail e senha, depois criar o PIN, depois a oferta de biometria.
- PIN bloqueado depois de 3 erros; recuperação de senha por e-mail com link de 30 min; bloqueio automático por tempo.
- Toda tela com check grande: o check aparece, estoura e vira o símbolo da Construtec com fundo transparente.
- A barra de notificação do Android fica integrada ao gradiente (transparente), nunca uma faixa de outra cor.

## Decisões que ainda vão te perguntar

- Android mínimo: subir para o Android 9 (mais simples) ou manter o Android 8 (mais código).
- O que fazer com a tela atual "Conecte este celular à instalação Windows".
- Qual provedor de e-mail usar (a conta e a chave são suas).
