# Pacote de continuação: desktop do Centro de Custos

Este pacote leva para o código o desktop novo do Centro de Custos, aprovado no canvas "App mobile Construtec" nas Rodadas 17 a 20. Ele é para o **Claude Code**.

## Como usar

1. Esta pasta já está no repositório, em `docs/suite-desktop/`. Faça commit dela no `main` antes de começar, para o Claude Code partir de uma base com o pacote (veja o aviso sobre os finais de linha no prompt).
2. Abra o Claude Code na raiz do repositório e cole o texto do `PROMPT-CLAUDE-CODE.md`, a partir da linha "COPIAR A PARTIR DAQUI".
3. Ele vai ler tudo e responder com o plano da fase D0 e 6 perguntas. Responda e dê o ok.
4. Cada fase (D0 a D7) é uma branch e um PR. Ao fim de cada uma, ele atualiza o `STATUS-CLAUDE.md`.
5. Para a fase seguinte, basta dizer: "Leia `docs/suite-desktop/STATUS-CLAUDE.md` e `03-PLANO-FASES.md` e comece a fase Dn: me mande o plano."

## O que tem aqui

| Arquivo ou pasta | Para que serve |
|---|---|
| `PROMPT-CLAUDE-CODE.md` | O prompt para colar, com as regras, as fontes de verdade e as 6 decisões a confirmar. |
| `01-ESPEC-TELAS.md` | Tela por tela: prints, estado no protótipo, como é hoje, o que muda e as rotas. |
| `02-LACUNAS-SERVIDOR.md` | O que o servidor já tem e o que falta criar ou ajustar. |
| `03-PLANO-FASES.md` | As fases D0 a D7, com o critério de pronto de cada uma. |
| `STATUS-CLAUDE.md` | Onde o Claude Code registra o andamento. |
| `prints/` | 64 prints do protótipo, um por estado, em 1440 × 900. |
| `prototipo/` | O protótipo completo, que abre sem internet, com `estado.html` para ver cada estado e `desktop-base.css` com tokens e componentes. |
| `referencia-atual/` | O inventário do sistema atual (campos, regras, permissões, 15 problemas) e os 49 prints de como ele é hoje. |

## Decisões já tomadas no desenho

- **Mesma identidade do mobile:** IBM Plex Sans, petróleo e ciano, e tema claro e escuro com os mesmos tokens.
- **Estrutura:**
  - menu lateral escuro fixo;
  - busca global que abre o item;
  - Suíte;
  - selo de sincronização real no topo.
- **Formulários:** todos num painel lateral, no lugar dos modais. Confirmações num diálogo próprio, nunca o do navegador.
- **Telas que hoje ficam escondidas:** Fechamento mensal e Histórico entram no menu. A aba Sincronização saiu.
- **Animação de sucesso:** o check aparece, estoura e vira o símbolo da Construtec. Vale para lançamento registrado, convite enviado e usuário criado.
- **Seis papéis e matriz de permissões** editável, com "Ver o sistema como" para o administrador.

## Decisões que o Claude Code vai te perguntar

1. Se o desktop novo fica em `/d/`, sem mexer no atual até estar pronto (recomendado).
2. Como criar os seis papéis a partir dos três de hoje.
3. Se a cobrança é por medição ou por obra.
4. Se entra a frequência quinzenal nos recorrentes.
5. Se a visibilidade por obra entra junto com os papéis.
6. Se a sincronização por arquivo sai do menu de vez.
