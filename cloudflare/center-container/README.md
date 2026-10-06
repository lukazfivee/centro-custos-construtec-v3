# Worker `centro-custos-api`

As rotas de redefinição enviam e-mail pela API HTTP do Resend. Configurar no Worker:

- `EMAIL_PROVIDER_API_KEY`: segredo de autenticação do provedor.
- `EMAIL_FROM`: remetente verificado pelo provedor.
- `ANDROID_CERT_SHA256`: impressão digital SHA-256 do certificado Android para `/.well-known/assetlinks.json`.

Sem os dois primeiros valores, o pedido de redefinição continua com resposta genérica, não envia e registra somente `password_reset_email_unconfigured`. Sem `ANDROID_CERT_SHA256`, `assetlinks.json` responde 404.

O handoff usa também `SYNC_SHARED_KEY` (já utilizado pelo diretório, mínimo de 32 caracteres) no Worker e no Container. O Worker público bloqueia `/api/auth/handoff-bridge`; a chamada interna cria um JWT web e guarda somente o hash SHA-256 da sessão no D1. A revalidação do JWT do handoff ocorre por `/v1/auth/session-hash`, protegida pela mesma chave. `JWT_SECRET` permanece configurado apenas para o Container.

Aplicar `d1-migrations/007-mobile-auth.sql` no ambiente escolhido antes de usar as rotas. Não reaplicar `006` em produção.

## Atualização do app Android (`androidUpdate.js`)

Rotas públicas, sem login: `GET /v1/app/android/latest` (versionName, versionCode, minVersionCode, sha256, size, notes, apkUrl) e `GET /v1/app/android/apk` (proxy do APK da release mais recente, incluindo pré-lançamentos, escolhida pela data). A fonte é a API de releases do repositório público `lukazfivee/centro-custos-construtec-v3`; o hash vem de `latest-android.json`, do arquivo `.sha256` ao lado do APK ou do `digest` do GitHub, e sem hash a versão não é oferecida. A resposta fica em cache por 10 minutos e, se o GitHub falhar, vale a última cópia boa (até 7 dias).

- `GITHUB_RELEASES_TOKEN` (opcional): token do GitHub só de leitura de releases, criado com `npx wrangler secret put GITHUB_RELEASES_TOKEN`. Evita o limite anônimo da API e serviria a um repositório privado. Nunca é gravado em arquivo nem devolvido nas respostas.
- `versionCode` = `3.1.0-rc.N` -> `31000 + N` (versão final `3.1.0` -> `31099`); o workflow `publish-v3-1.yml` calcula o mesmo valor.
