# Como ler o protótipo

`Main.dc.html` é um único componente (formato "Design Component" do canvas), com cerca de 445 KB. **Não leia inteiro**: vá direto aos trechos abaixo. As outras `RodadaN.dc.html` só montam aparelhos com estados diferentes do `Main` (atributo `start="..."`) e trazem legendas que explicam cada tela.

## Formato em 30 segundos

- O HTML fica dentro de `<x-dc>`. `{{ nome }}` é um valor calculado em `renderVals()`, no `<script type="text/x-dc">` do fim do arquivo.
- `<sc-if value="{{ cond }}">` é uma tela ou estado condicional. `<sc-for list="{{ lista }}" as="x">` é uma repetição.
- `style-active` e `style-focus` são estilos de `:active` e `:focus`.
- Classes `ph ph-*` são ícones Phosphor.
- As keyframes ficam no `<helmet>` do topo (também em `design-tokens.json`).
- Os endereços `/_blob/<id>` são imagens do canvas:
  - `e1fc8242b71e7c25c04314a84fafdbde` é `assets/simbolo-construtec.png`;
  - `9839c5240748d1ca34f7c37e87a1cec4` é `assets/logo-construtec-fundo-escuro.png`.

## Onde está cada tela (linhas aproximadas; confira com `grep`)

| Tela | Como achar |
|---|---|
| Barra de status transparente | `grep -n "sbPos\|sbBg\|sbFg" Main.dc.html` |
| [A] Login de vidro | `grep -n 'sc-if value="{{ sLoginB }}"'` (linha ~151) |
| [B] PIN, [B2] bloqueado, [C] criar e trocar PIN | `sc-if value="{{ sLoginH3 }}"` (~152); a lógica está em `const pinKey` (~797) |
| [D] Oferta de biometria | `sc-if value="{{ sLoginBioAsk }}"` (~153); `const bioActivate` (~807) |
| [E] Recuperar senha (4 passos) | `sc-if value="{{ sLoginRec }}"` (~154); `recSend`, `recSave`, `recDone` (~845) |
| Cadastro de vidro | `sc-if value="{{ sCadB }}"` (~156) |
| Sobreposição biométrica | `grep -n 'aria-label="Reconhecido"'` |
| Animação de sucesso | `grep -n "animation:ctCheck"` (há 5 ocorrências) |
| Segurança (PIN, biometria, bloqueio automático) | `sc-if value="{{ sSeg }}"` (~26) |
| Faixa sem internet (Fase 2) | `sc-if value="{{ netBar }}"` (~29); `const goOnline` (~762) |
| Notificações e banner (Fase 4) | `sc-if value="{{ sNotif }}"` (~27) e `pushShow` (~24) |
| Tour (Fase 5) | `sc-if value="{{ sTour }}"` (~28) |
| Estados de exemplo | `const M = {` (~202), por exemplo `pinEnter`, `pinTry2`, `pinLocked`, `pinNew`, `pinConfirm`, `bioAsk`, `rec1` a `rec4`, `segLock`, `appLock` |
| Regras de senha | `const pw = S.cSenha` (~810) |
| Login e erros | `const lSubmit` e `const loginOk` (~789) |

## Legendas das rodadas (o que cada estado quer mostrar)

- `Rodada8.dc.html`: direções A (rede de dispositivos) e B (vidro sobre gradiente); a **B foi a escolhida**.
- `Rodada12.dc.html`: login escolhido, PIN + vidro.
- `Rodada13.dc.html`: bloqueio, biometria e Segurança.
- `Rodada14.dc.html`: recuperar senha e bloqueio automático.
- `Rodada15.dc.html`: sem internet em campo (Fase 2).
- `Rodada16.dc.html`: tour e notificações (Fases 4 e 5).
