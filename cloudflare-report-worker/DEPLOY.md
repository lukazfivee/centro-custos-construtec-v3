# Deploy do Report V2 no Cloudflare

## Arquitetura

- Cloudflare Worker: endpoint publico `POST /v1/reports`
- Cloudflare D1: armazenamento central dos reports
- Resend: envio do e-mail para `pcm@rcconstrutec.com.br`
- Aplicativo Windows: envia para o Worker e mantem fila local quando estiver sem internet

## 1. Criar o banco D1

No painel da Cloudflare:

1. Workers & Pages > D1 SQL Database.
2. Create database.
3. Nome: `centro-custos-reports`.
4. Copie o Database ID.
5. Abra o console SQL do banco e execute o conteudo de `schema.sql`.

## 2. Criar o Worker

1. Workers & Pages > Create > Worker.
2. Nome: `centro-custos-reports`.
3. Use o codigo de `src/index.js`.
4. Em Bindings, adicione um D1 binding:
   - Variable name: `DB`
   - Database: `centro-custos-reports`

## 3. Variaveis publicas do Worker

Configure:

- `REPORT_TO=pcm@rcconstrutec.com.br`
- `REPORT_FROM=Centro de Custos <no-reply@reports.rcconstrutec.com.br>`

## 4. Segredo do Resend

Crie uma secret chamada `RESEND_API_KEY` no Worker e cole a chave de envio do Resend. Nunca coloque essa chave no GitHub, no `.env` distribuido ou no instalador Windows.

Opcionalmente, configure `REPORT_INGEST_KEY`. Essa chave reduz abuso do endpoint, mas nao deve ser tratada como segredo absoluto porque um aplicativo Electron pode ser inspecionado.

## 5. Publicar e testar

Depois do deploy, abra:

`https://SEU-WORKER.workers.dev/health`

Resposta esperada:

```json
{"ok":true,"service":"centro-custos-reports"}
```

## 6. Conectar o aplicativo

Na configuracao usada para gerar o instalador, defina:

`REPORT_API_URL=https://SEU-WORKER.workers.dev`

Se `REPORT_INGEST_KEY` tiver sido configurada no Worker, use o mesmo valor no aplicativo.

O aplicativo nao recebe a chave do Resend. A credencial de e-mail permanece somente no Cloudflare Worker.

## 7. Teste final

1. Abra o Centro de Custos.
2. Entre com um usuario comum.
3. Crie um report simples de teste.
4. Confirme que o status local muda para entregue.
5. Confirme que `pcm@rcconstrutec.com.br` recebeu o e-mail.
6. Verifique no D1 se o report foi armazenado.

## Seguranca

O report envia apenas os dados do proprio report e metadados de diagnostico: usuario, instalacao, versao e plataforma. Nao envia automaticamente banco financeiro, senhas, JWT, anexos financeiros ou logs completos.
