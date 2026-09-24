# Especificação: entrada da Suíte Construtec no celular

Fonte da verdade visual: `prototipo/Main.dc.html` (ver `prototipo/README-PROTOTIPO.md`). Quando esta especificação e o protótipo divergirem, vale esta especificação. Tokens em `design-tokens.json`.

Idioma pt-BR, tom direto e sóbrio. Sem emojis. Ícones: Phosphor (o protótipo usa as classes `ph ph-*`); no Android pode ser SVG embutido.

---

## 1. Fluxo geral

```
Abrir app
 ├─ Sem sessão salva no aparelho ─────────► [A] Login de vidro (e-mail + senha)
 │                                            ├─ Esqueci a senha ─► [E] Recuperar senha (4 passos)
 │                                            └─ Entrar ok ─► tem PIN? ── não ─► [C] Criar PIN ─► [D] Oferta de biometria ─► App
 │                                                                     └─ sim ──► App
 └─ Sessão salva + PIN definido ──────────► [B] PIN (teclado grande, digital no canto)
                                              ├─ PIN certo ou digital ─► App
                                              ├─ 3 PINs errados ─► [B2] PIN bloqueado ─► [A]
                                              ├─ Esqueci o PIN ─► [A] (depois cria PIN novo)
                                              └─ Entrar com e-mail ─► [A]
App em uso
 └─ Volta ao app após o tempo de bloqueio ─► [B] por cima, e continua na mesma tela
```

"Sair" no menu do app apaga a sessão local e volta para [B] se o PIN continuar definido. Se o usuário escolher "sair e esquecer este aparelho", volta para [A].

---

## 2. Fundo comum: vidro sobre gradiente

Todas as telas de entrada usam o mesmo fundo:

- Base `#021820`.
- Três manchas desfocadas animadas, em loop `alternate`:
  - A: 300px, `#12a9d1`, opacidade 0.55, blur 60, `blobA 14s`, canto superior esquerdo (-80, -60);
  - B: 320px, `#0b5a70`, opacidade 0.8, blur 64, `blobB 17s`, à direita (right -110, top 180);
  - C: 300px, `#1a4da1`, opacidade 0.45, blur 70, `blobC 19s`, embaixo (left -40, bottom -120).
- Brilho que segue o dedo: `radial-gradient(180px circle at x y, rgba(95,208,238,.22), transparent 70%)`, atualizado no `pointermove`.
- Grade de pontos: `radial-gradient(rgba(255,255,255,.07) 1px, transparent 1px)` a cada 18px.
- Cartão de vidro:
  - fundo `rgba(255,255,255,.07)`, `backdrop-filter: blur(18px) saturate(140%)`, raio 22;
  - borda interna `inset 0 0 0 1px rgba(255,255,255,.16)`, sombra `0 20px 50px rgba(0,0,0,.35)`, padding 18.
- **Barra de status transparente**: o conteúdo desenha por baixo dela, com ícones claros. Nunca pintar uma faixa de cor diferente no topo. O conteúdo começa a 60px do topo (30px da barra mais o respiro).
- `prefers-reduced-motion`: desliga todas as animações.

Campos:

- altura 48, raio 12, fundo `rgba(255,255,255,.08)`, borda `inset 1px rgba(255,255,255,.18)`;
- ícone à esquerda em `#5fd0ee`, rótulo 12px/600 em `#b9d4dd`;
- foco com `inset 0 0 0 2px #12a9d1` e fundo `rgba(18,169,209,.08)`.

Botões:

- **Principal:** altura 52, raio 12, gradiente `100deg #12a9d1 → #0d7f9f`, texto branco 15px/600, sombra `0 10px 24px rgba(18,169,209,.28)`, brilho `shimmer` passando a cada 3,2s.
- **Secundário:** altura 48, vidro `rgba(255,255,255,.08)` com borda `.2`.
- **Links** (Esqueci a senha, Criar cadastro): altura mínima 44, cor `#5fd0ee`.
- Alvo mínimo de toque: 44px.

Erro:

- O cartão treme (`shakeA`/`shakeB`, alternando para reiniciar a animação, 0,42s).
- Mensagem com `role="alert"`, 12,5px/600, cor `#f2b544`, com ícone `warning-circle` e posicionada logo acima do botão principal.

---

## 3. Telas

### [A] Login de vidro (e-mail e senha)

- Topo: logo completo, com "TEC" branco (`assets/logo-construtec-fundo-escuro.png`), 40px de altura, e a legenda "Sistemas especiais · do orçamento à obra" (13px, `#b9d4dd`).
- Faixa com 6 ícones de sistemas em vidro de 44px e raio 13, flutuando (`bob 3.2s`, com atraso de 0,35s entre um e outro): CFTV `video-camera`, SDAI `fire`, Acesso `fingerprint`, Alarme `shield-check`, Pânico `siren`, Enfermagem `bell-ringing`.
- Cartão com:
  - título "Bem-vinda de volta" (usar "Bem-vindo(a)" ou o primeiro nome se já conhecido);
  - campo E-mail (`inputmode=email`, `autocomplete=username`);
  - campo Senha com botão de mostrar/esconder (`aria-label` "Mostrar senha" / "Esconder senha");
  - botão principal "Entrar", que durante o envio vira "Verificando…" com spinner;
  - dois botões lado a lado: "Biometria" (`fingerprint`) e "Usar PIN" (`dots-nine`), que só aparecem se já existirem neste aparelho.
- Abaixo do cartão: "Esqueci a senha" à esquerda e "Criar cadastro" à direita. Na Fase 1, "Criar cadastro" mostra: "Peça seu acesso ao administrador da Construtec".
- Validação local, antes de chamar o servidor:
  - "Digite seu e-mail.";
  - "Esse e-mail não parece válido.";
  - "Digite sua senha para entrar.".
- Respostas do servidor:
  - 401: "E-mail ou senha incorretos.";
  - sem internet: "Sem internet. Entre com o PIN ou tente de novo quando conectar.";
  - outros erros: "Não foi possível entrar agora. Tente de novo.".
- Sucesso sem PIN no aparelho: vai para [C] com o aviso "Senha certa · agora crie seu PIN". Com PIN: entra no app.

### [B] PIN (entrada do dia a dia)

- Avatar de 64px com as iniciais sobre o gradiente `135deg #5fd0ee → #12a9d1`, título "Olá, <primeiro nome>" e o texto "Digite seu PIN de 6 dígitos".
- Seis pontos de 14px: vazios com borda `rgba(255,255,255,.35)`; preenchidos em `#5fd0ee`, com escala 1.15.
- Linha de status (`role="status"`), por padrão "O PIN vale só para este aparelho" em `#6f8f9b`. Mostra "Entrando…" em `#5fd0ee` e os erros em `#f2b544`.
- Teclado 3×4:
  - teclas de 64px de altura, raio 20, vidro `rgba(255,255,255,.07)`, espaço de 12 entre elas;
  - número em 26px/500 com as letras embaixo (ABC, DEF…);
  - última linha: [digital] [0] [apagar]. A tecla de digital só aparece se a biometria estiver ativa.
- Rodapé: "Esqueci o PIN" à esquerda e "Entrar com e-mail" à direita.
- Ao completar 6 dígitos, confere na hora, sem botão de confirmar.
- Erro:
  - 1º: "PIN incorreto. Restam 2 tentativas.";
  - 2º: "PIN incorreto. Resta 1 tentativa antes do bloqueio.";
  - os pontos tremem e o PIN digitado é limpo.
- Sem internet: o PIN funciona mesmo assim, e a linha de status diz "Sem internet · o PIN funciona mesmo assim".

### [B2] PIN bloqueado (3º erro)

- O teclado some. O avatar vira um cadeado sobre `rgba(242,181,68,.16)`. Título "PIN bloqueado" e o texto "Foram 3 tentativas erradas".
- Cartão de vidro com:
  - ícone `shield-warning` em `#f2b544` e o texto "Por segurança, o PIN foi bloqueado neste aparelho. Entre com e-mail e senha para liberar e criar um PIN novo.";
  - a linha "Suas propostas e lançamentos continuam salvos";
  - o botão principal "Entrar com e-mail e senha".
- Rodapé: "Não foi você? Avise o administrador da Construtec."
- Efeito técnico: a sessão cifrada e o PIN são apagados do aparelho. A digital também é desativada até criar um PIN novo.

### [C] Criar PIN (2 passos)

- Passo 1: título "Crie seu PIN", texto "6 dígitos para entrar rápido neste aparelho" e a dica "Evite datas e sequências como 123456".
  - Recusa 6 dígitos iguais e sequências crescentes ou decrescentes (`012345`, `123456`, `987654`...), com a mensagem "Evite números repetidos ou em sequência.".
- Passo 2: título "Confirme o PIN" e o texto "Digite o mesmo PIN mais uma vez".
  - Se não conferir: "Os PINs não conferem. Crie de novo." e volta ao passo 1.
- O botão de digital fica escondido. Rodapé com "Agora não, entrar sem PIN" (entra sem PIN; no próximo uso vai para [A]).
- Quando é troca de PIN a partir de Segurança, há um passo 0: "Trocar PIN", "Digite o PIN atual". O rodapé passa a ser "Cancelar".

### [D] Oferta de biometria (só no primeiro acesso, e só se o aparelho tiver)

- Círculo de vidro de 132px com a digital de 64px, anel pulsando (`nodePulse 2.4s`) e linha de varredura (`scanY 1.4s`).
- Título "Entrar com a digital?" e o texto "PIN criado. Quer entrar ainda mais rápido na próxima vez?".
- Cartão com 3 benefícios (ícone em quadrado de 30px):
  - "Mais rápido que digitar o PIN" (`lightning`);
  - "Funciona com a mão livre, sem teclado" (`hand`);
  - "O PIN continua valendo como alternativa" (`dots-nine`).
- Botão principal "Ativar biometria", que chama o `BiometricPrompt`. Ao reconhecer, mostra a animação de check (seção 4) e entra, com o aviso "Biometria ativada · bem-vinda, <nome>".
- "Agora não" entra direto, com o aviso "Dá para ativar depois em Menu → Segurança".

### Sobreposição de leitura biométrica

- Fundo `rgba(2,16,22,.78)` com blur 8.
- Círculo de 112px com a digital e a linha de varredura, e o texto "Toque no sensor".
- Ao reconhecer: animação de check (seção 4) no lugar do círculo e o texto "Reconhecido".
- Entra no app cerca de 1,5s depois, para dar tempo de ver o símbolo.

### [E] Recuperar senha (4 passos, mesmo vidro)

1. **E-mail:**
   - "Voltar ao login" no topo;
   - cartão com ícone `key` num quadrado de 48px, título "Esqueceu a senha?" e o texto "Digite o e-mail da empresa. Mandamos um link para você criar uma senha nova.";
   - campo de e-mail já preenchido com o que foi digitado no login e botão "Enviar link".
   - A resposta é sempre genérica, mesmo se o e-mail não existir.
2. **Confira seu e-mail:**
   - envelope aberto de 120px flutuando, com um selo de check verde `#3ccf8e`;
   - texto "Enviamos o link para <e-mail>. Ele vale por 30 minutos. Veja também a caixa de spam.";
   - botões "Reenviar e-mail" (espera de 60s entre reenvios) e "Voltar ao login".
3. **Senha nova** (aberta pelo link, que leva ao app ou a uma página web com o mesmo visual):
   - dois campos de senha e o medidor de força com 4 barras e rótulo: vazio "Digite uma senha"; 1 "Fraca" e 2 "Razoável" em `#f2b544`; 3 "Boa" em `#5fd0ee`; 4 "Forte" em `#3ddc84`;
   - checklist em 2 colunas: 8+ caracteres, letra maiúscula, um número, um símbolo;
   - só salva com **8 ou mais caracteres e pelo menos 3 dos 4 critérios**, e com as duas senhas iguais. Erros: "A senha ainda está fraca. Siga a lista acima." e "As duas senhas não são iguais.".
4. **Senha alterada:**
   - animação de check em verde (seção 4);
   - texto "Por segurança, encerramos as sessões nos outros aparelhos. Entre com a senha nova para continuar.";
   - botão "Entrar com a senha nova" volta para [A] com a senha preenchida.

### Bloqueio automático

- Configurável em Segurança: "Na hora", "1 min", "5 min" (padrão) ou "15 min".
- Ao voltar ao app depois do tempo, [B] aparece por cima com o texto "O app ficou fora da tela · digite o PIN". Ao desbloquear, o app continua na mesma tela, sem recarregar a WebView.

### Segurança (Menu → Segurança) — Fase 1 só no shell nativo

- Linhas:
  - "PIN de acesso", com "Definido · 6 dígitos" e o botão "Trocar";
  - "Entrar com biometria", com um switch que funciona como `role=switch`;
  - "Bloqueio automático", com 4 opções em botões `aria-pressed`;
  - "Bloqueio após 3 erros", informativo;
  - "Aparelhos conectados";
  - botão "Sair de todos os outros aparelhos".
- Na Fase 1 pode ser uma tela nativa (assets locais) aberta por um item de menu que o shell injeta, ou por um gesto definido no plano. Decidir no plano.

---

## 4. Animação de sucesso (obrigatória em toda tela com check grande)

Tamanho de referência: 72px. Escale tudo proporcionalmente, com a biometria em 112 e a senha alterada em 104.

1. **Check** (`ctCheck 1.05s cubic-bezier(.2,.8,.2,1)`, começa em 0s): círculo com fundo `rgba(18,169,209,.16)` e ícone `check-circle` preenchido de 44px em `#12a9d1`. Aparece com escala 0 → 1.14 → 1, fica, e aos 74% estoura para escala 1.35 com opacidade 0.
2. **Anel** (`ctRing .55s ease-out`, atraso 0,70s): `box-shadow 0 0 0 3px` na cor do tema, de escala 0.85 a 1.8, apagando.
3. **Partículas** (`ctBurst .6s`, atraso 0,74s): 10 pontos, alternando 7px `#12a9d1` e 5px `#5fd0ee`, a cada 36°. Partem do centro e vão 50px e 40px para fora.
4. **Símbolo da Construtec** (`ctLogo .5s`, atraso 0,80s): `assets/simbolo-construtec.png`, **com fundo transparente e sem círculo atrás**, com largura de 72% do tamanho e `drop-shadow(0 6px 14px rgba(18,169,209,.4))`. Entra de escala 0.3 girado -30° até 1.12 e +5°, e assenta em 1 e 0°.
5. Variante verde (senha alterada): anel e partículas grandes em `#3ccf8e`, e o fundo do check em `rgba(60,207,142,.16)`.

Keyframes exatos estão em `design-tokens.json > motion.keyframes`.

---

## 5. Regras de segurança (não negociáveis)

- A senha nunca é guardada no aparelho.
- O token de sessão fica cifrado:
  - **Com PIN:** a chave vem do PIN (PBKDF2-SHA256 com sal aleatório e pelo menos 150 mil iterações) e é embrulhada por uma chave AES-GCM do Android Keystore, que não pode ser exportada. Sem o aparelho, adivinhar o PIN por força bruta não funciona.
  - **Com biometria:** uma segunda cópia é cifrada com uma chave do Keystore `setUserAuthenticationRequired(true)` e liberada pelo `BiometricPrompt` com `CryptoObject`. Essa chave é invalidada se o usuário cadastrar uma digital nova.
- O contador de tentativas fica no armazenamento cifrado. Não é zerado ao reinstalar o WebView nem ao matar o app.
- No 3º erro, apaga o blob do PIN e a cópia biométrica.
- A ponte JavaScript ↔ nativo só é injetada quando a origem carregada for a dos assets locais. Páginas remotas nunca recebem a ponte.
- O token nunca vai na URL das páginas web. A entrega para a web usa um código de uso único (contrato em `04-CONTRATO-API.md`).
- `FLAG_SECURE` nas telas de PIN e senha, para que o conteúdo não apareça no print nem na lista de apps recentes.
- Sem logs com token, PIN, senha ou e-mail completo.
