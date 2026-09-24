# Worker `centro-custos-api`

As rotas de redefinição enviam e-mail pela API HTTP do Resend. Configurar no Worker:

- `EMAIL_PROVIDER_API_KEY`: segredo de autenticação do provedor.
- `EMAIL_FROM`: remetente verificado pelo provedor.
- `ANDROID_CERT_SHA256`: impressão digital SHA-256 do certificado Android para `/.well-known/assetlinks.json`.

Sem os dois primeiros valores, o pedido de redefinição continua com resposta genérica, não envia e registra somente `password_reset_email_unconfigured`. Sem `ANDROID_CERT_SHA256`, `assetlinks.json` responde 404.

O handoff usa também `SYNC_SHARED_KEY` (já utilizado pelo diretório, mínimo de 32 caracteres) no Worker e no Container. O Worker público bloqueia `/api/auth/handoff-bridge`; a chamada interna cria um JWT web e guarda somente o hash SHA-256 da sessão no D1. A revalidação do JWT do handoff ocorre por `/v1/auth/session-hash`, protegida pela mesma chave. `JWT_SECRET` permanece configurado apenas para o Container.

Aplicar `d1-migrations/007-mobile-auth.sql` no ambiente escolhido antes de usar as rotas. Não reaplicar `006` em produção.
