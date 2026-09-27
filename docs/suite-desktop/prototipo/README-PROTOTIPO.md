# Protótipo do desktop

Cópia do protótipo aprovado no canvas "App mobile Construtec" (Rodadas 17 a 20), preparada para abrir sem internet.

- `Desktop.dc.html`: o protótipo completo, com todos os estados, textos, validações e dados de exemplo. É a fonte dos textos exatos.
- `Rodada17.dc.html` a `Rodada20.dc.html`: os quadros de cada rodada, com a explicação de cada estado.
- `estado.html`: abre um estado direto, por exemplo `estado.html?start=cobMail` ou `estado.html?start=painel&tema=escuro`.
- `desktop-base.css`: tokens (claro e escuro), componentes e animações, extraídos do protótipo para servir de ponto de partida.
- `support.js`: o runtime que faz o protótipo funcionar. **Não use no app.**
- `vendor/`: fonte IBM Plex Sans, ícones Phosphor (regular, fill e bold), logo para fundo escuro e símbolo da Construtec.

## Como abrir

O protótipo precisa de um servidor local (o runtime lê o próprio arquivo):

```
cd docs/suite-desktop/prototipo
python -m http.server 8791
```

Depois, abra `http://localhost:8791/estado.html?start=painel`. Tudo é clicável: o menu, as abas, os painéis e os botões. O selo de sincronização alterna os estados ao clicar.

## Como achar a regra de uma tela

Procure no `Desktop.dc.html` pelo texto que aparece na tela (um rótulo, uma mensagem de erro). A lógica fica no `<script type="text/x-dc">` do fim do arquivo, em métodos como `openDrawer`, `openX`, `xSubmit`, `closeMonth`, `askGen` e `doGen`.

- As permissões padrão estão em `permDefaults()` e os papéis em `ROLES`.
- Os dados de exemplo são fictícios.

Observação: no tema claro, o token `--c-warn` do protótipo aponta para ele mesmo (`var(--c-warn)`). No `desktop-base.css` ele já foi corrigido para `#8a5200`.

## Estados e prints

| `start` | Print |
|---|---|
| `painel` | `../prints/00-painel.jpg` |
| `busca` | `../prints/01-busca-global.jpg` |
| `suite` | `../prints/02-suite-aberta.jpg` |
| `painel` com `tema=escuro` | `../prints/03-painel-tema-escuro.jpg` |
| `lanc` | `../prints/10-lancamentos.jpg` |
| `filtro` | `../prints/11-lancamentos-filtro-a-pagar.jpg` |
| `offline` | `../prints/12-lancamentos-sem-internet.jpg` |
| `rapido` | `../prints/13-lancamento-rapido.jpg` |
| `novo` | `../prints/14-novo-lancamento.jpg` |
| `erro` | `../prints/15-novo-lancamento-validacao.jpg` |
| `ok` | `../prints/16-lancamento-registrado.jpg` |
| `editar` | `../prints/17-editar-lancamento.jpg` |
| `docs` | `../prints/18-documentos.jpg` |
| `estorno` | `../prints/19-estorno.jpg` |
| `excluir` | `../prints/20-excluir-confirmacao.jpg` |
| `obras` | `../prints/30-obras-carteira.jpg` |
| `obra` | `../prints/31-obra-orcado-realizado.jpg` |
| `med` | `../prints/32-obra-medicoes-mao-de-obra.jpg` |
| `medCt` | `../prints/33-obra-medicoes-contrato.jpg` |
| `curva` | `../prints/34-obra-curva-s.jpg` |
| `nf` | `../prints/35-obra-notas-fiscais.jpg` |
| `cob` | `../prints/40-cobrancas.jpg` |
| `cobTrack` | `../prints/41-cobranca-acompanhar.jpg` |
| `cobMail` | `../prints/42-cobranca-email.jpg` |
| `cobVenc` | `../prints/43-cobranca-vencida.jpg` |
| `comoFin` | `../prints/44-cobranca-como-financeiro.jpg` |
| `cat` | `../prints/50-categorias.jpg` |
| `catNova` | `../prints/51-categoria-nova.jpg` |
| `catEdit` | `../prints/52-categoria-editar.jpg` |
| `forn` | `../prints/53-fornecedores.jpg` |
| `fornView` | `../prints/54-fornecedor-detalhe.jpg` |
| `fornErr` | `../prints/55-fornecedor-duplicado.jpg` |
| `rec` | `../prints/56-recorrentes.jpg` |
| `recNovo` | `../prints/57-recorrente-novo.jpg` |
| `recGerar` | `../prints/58-recorrentes-gerar.jpg` |
| `recFeito` | `../prints/59-recorrentes-gerados.jpg` |
| `usu` | `../prints/60-usuarios.jpg` |
| `convite` | `../prints/61-convidar-usuario.jpg` |
| `conviteOk` | `../prints/62-convite-enviado.jpg` |
| `senhaProv` | `../prints/63-usuario-senha-provisoria.jpg` |
| `usuEdit` | `../prints/64-editar-acesso.jpg` |
| `perms` | `../prints/65-papeis-permissoes.jpg` |
| `ext` | `../prints/66-emails-externos.jpg` |
| `comoTec` | `../prints/67-ver-como-tecnico.jpg` |
| `fech` | `../prints/70-fechamento-mensal.jpg` |
| `fechConf` | `../prints/71-fechar-com-pendencias.jpg` |
| `fechOk` | `../prints/72-mes-fechado.jpg` |
| `lancLocked` | `../prints/73-lancamentos-mes-fechado.jpg` |
| `novoFechado` | `../prints/74-lancar-em-mes-fechado.jpg` |
| `reabrir` | `../prints/75-reabrir-com-motivo.jpg` |
| `hist` | `../prints/76-historico.jpg` |
| `histFech` | `../prints/77-historico-fechamentos.jpg` |
| `histDet` | `../prints/78-historico-detalhe.jpg` |
| `histVivo` | `../prints/79-historico-apos-acoes.jpg` |
| `rep` | `../prints/80-reports.jpg` |
| `repNovo` | `../prints/81-report-novo.jpg` |
| `repFila` | `../prints/82-report-na-fila.jpg` |
| `repView` | `../prints/83-report-detalhe.jpg` |
| `cfg` | `../prints/90-config-perfil.jpg` |
| `cfgFoto` | `../prints/91-config-perfil-com-foto.jpg` |
| `cfgSenhaErr` | `../prints/92-config-senha-erro.jpg` |
| `cfgBackup` | `../prints/93-config-backup.jpg` |
| `cfgRestore` | `../prints/94-config-restaurar.jpg` |
| `cfgSis` | `../prints/95-config-sistema.jpg` |
