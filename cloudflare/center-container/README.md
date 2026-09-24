# Worker `centro-custos-api`

As rotas de redefinição enviam e-mail pela API HTTP do Resend. Configurar no Worker:

- `EMAIL_PROVIDER_API_KEY`: segredo de autenticação do provedor.
- `EMAIL_FROM`: remetente verificado pelo provedor.
- `ANDROID_CERT_SHA256`: impressão digital SHA-256 do certificado Android para `/.well-known/assetlinks.json`.

Sem os dois primeiros valores, o pedido de redefinição continua com resposta genérica, não envia e registra somente `password_reset_email_unconfigured`. Sem `ANDROID_CERT_SHA256`, `assetlinks.json` responde 404.

Aplicar `d1-migrations/007-mobile-auth.sql` no ambiente escolhido antes de usar as rotas. Não reaplicar `006` em produção.
