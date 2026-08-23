# Centro de Custos no iPhone — modo completo

## Objetivo

O modo completo transforma o Centro de Custos em uma PWA corporativa hospedada no Cloudflare. Ela abre por HTTPS no Safari, pode ser adicionada à Tela de Início e funciona de qualquer lugar sem depender de um computador Windows ligado.

Windows, Android, iPhone e navegador passam a compartilhar o mesmo diretório corporativo de usuários e o mesmo estado central no Cloudflare D1.

## Experiência no iPhone

1. Abrir o endereço HTTPS do Centro de Custos no Safari.
2. Entrar com a mesma conta `@rcconstrutec.com.br` usada pela V3.1.
3. Consultar o painel financeiro, lançamentos, centros de custo, categorias, fornecedores e clientes.
4. Criar e editar registros conforme o perfil do usuário.
5. Alterar a própria senha e foto de perfil.
6. Administradores podem criar, ativar e desativar usuários.
7. Em **Compartilhar > Adicionar à Tela de Início**, instalar a PWA como aplicativo.

## Arquitetura

### Cloudflare Worker

O `cloudflare-sync-worker` continua sendo a API central. As rotas `/v1/*` e `/health` executam o código do Worker. O restante é servido como Static Assets.

### D1

O banco `centro-custos-producao` continua guardando:

- usuários e sessões corporativas;
- entidades sincronizadas e eventos de sincronização;
- clientes e acompanhamentos;
- dados necessários às funções comerciais já existentes.

A PWA usa o mesmo formato de pacote V3 da V3.1. Portanto, uma alteração feita no iPhone entra no mesmo fluxo de `public_id`, `revision` e `updatedAt` usado pelo Windows.

### PWA

Os arquivos ficam em `cloudflare-sync-worker/public`:

- `index.html`: shell do aplicativo e metadados do iOS;
- `styles.css`: interface mobile-first com suporte às safe areas do iPhone;
- `app-v2.js`: login, leitura, gravação, cadastros, usuários e perfil;
- `manifest.webmanifest`: instalação como aplicativo;
- `sw.js`: cache somente do shell e arquivos estáticos;
- `icon.svg`: ícone do aplicativo.

## Fluxo de autenticação

1. A PWA envia e-mail e senha a `/v1/auth/login`.
2. O Worker valida a credencial corporativa no D1.
3. O servidor cria uma sessão de oito horas.
4. A PWA usa o token Bearer nas chamadas seguintes.
5. Quando o servidor retorna `401`, apenas a sessão da PWA é encerrada e o usuário volta à tela de login.

## Fluxo dos dados financeiros

### Leitura

A PWA chama `/v1/sync/snapshot` e recebe categorias, centros de custo, fornecedores e lançamentos.

### Alteração

Ao salvar um registro, a PWA:

1. aumenta sua `revision`;
2. atualiza `updatedAt`;
3. gera um pacote `formatVersion: 3`;
4. calcula o SHA-256 do payload;
5. envia a `/v1/sync`;
6. recebe o snapshot central atualizado.

Isso permite que o dado seja distribuído para outras instalações da V3.1 pelo mecanismo já existente.

## Segurança adotada

- acesso externo somente por HTTPS do Cloudflare;
- Content Security Policy restritiva na PWA;
- nenhuma chave administrativa ou token da Cloudflare é gravado no frontend;
- respostas de `/v1/*` não entram no cache do service worker;
- sessões expiram no servidor;
- perfis `admin`, `gestor` e `supervisor` continuam sendo respeitados;
- fotos são reduzidas no aparelho e limitadas pelo backend a 512 KB;
- segredos de deploy ficam no GitHub Actions / Cloudflare, não no repositório.

## Funcionamento sem internet

A primeira entrega é **online-first**. A estrutura visual já aberta pode permanecer disponível pelo cache, mas novas gravações exigem internet. Dados financeiros autenticados não são armazenados pelo service worker.

Uma fila offline transacional pode ser adicionada depois, com criptografia local e resolução de conflitos.

## Deploy

A configuração de referência está em `cloudflare-sync-worker/wrangler.toml.example` e usa:

- Worker `centro-custos-api`;
- D1 `centro-custos-producao` com binding `DB`;
- Static Assets em `./public`;
- `run_worker_first` para `/v1/*` e `/health`;
- fallback SPA para `index.html`.

O workflow `.github/workflows/deploy-iphone-cloud.yml` valida o JavaScript e executa o deploy via Wrangler.

### Segredos necessários no GitHub

Em **Settings > Secrets and variables > Actions**:

- `CLOUDFLARE_API_TOKEN`;
- `CLOUDFLARE_ACCOUNT_ID`;
- `CLOUDFLARE_D1_DATABASE_ID`.

O token precisa de permissão para editar Workers e usar o D1 da aplicação.

## Domínio recomendado

Após a validação em `workers.dev`, o ideal é usar um endereço corporativo curto, por exemplo:

`https://custos.rcconstrutec.com.br`

O domínio pode apontar para o mesmo Worker. Isso melhora a experiência de instalação e permite adicionar outras políticas de acesso do Cloudflare no futuro.

## Implantação segura

1. Mesclar a branch da PWA.
2. Configurar os três secrets do GitHub.
3. Executar o workflow de deploy.
4. Testar login no Safari.
5. Criar um lançamento de teste no iPhone.
6. Confirmar que ele aparece no Windows V3.1.
7. Alterar um registro no Windows e confirmar que aparece no iPhone após atualizar.
8. Testar foto de perfil, troca de senha e administração de usuários.
9. Só então liberar o endereço para toda a equipe.

## Evoluções recomendadas

- domínio corporativo próprio;
- notificações push de vencimentos;
- anexos/comprovantes pelo iPhone;
- fila offline criptografada;
- autenticação adicional para ações administrativas;
- monitoramento de disponibilidade e erros do Worker;
- eventual wrapper nativo para App Store, caso haja necessidade futura.
