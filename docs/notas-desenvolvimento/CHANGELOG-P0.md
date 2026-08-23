# P0 — Base sólida, lote 1

## Alterações implementadas

### Observabilidade

- Cada requisição recebe `X-Request-Id`.
- Logs são emitidos em JSON, com remoção de senha, token, cookie e conteúdo de backup.
- Requisições lentas e consultas lentas ficam registradas em memória para diagnóstico.
- O limite para alertas pode ser ajustado por `SLOW_REQUEST_MS` e `DB_SLOW_QUERY_MS`.

### Painel técnico

Endpoint administrativo: `GET /api/sistema/status`.

Exibe versão, Node.js, plataforma, modo do banco, tamanho da base local, migrações aplicadas, quantidade de registros, conflitos pendentes, memória, tempo de atividade e métricas de desempenho.

### Saúde da aplicação

- `GET /api/health/live`: confirma que o processo está ativo.
- `GET /api/health/ready`: confirma que o banco responde.
- `GET /api/health`: mantém compatibilidade e inclui latência do banco.

### Banco e consultas

- Instrumentação de consultas sem registrar parâmetros sensíveis.
- Pool PostgreSQL com limites e tempos configuráveis.
- Migração `010_performance_indexes.sql` com índices parciais para lançamentos ativos, vencimentos, centros de custo, categorias, auditoria e conflitos.
- Consultas independentes do dashboard executadas em paralelo.

### Lançamentos

A rota tradicional continua retornando uma lista para preservar o frontend atual.

A paginação pode ser ativada com:

```text
GET /api/lancamentos?paginar=1&pagina=1&limite=50
```

A resposta passa a conter `itens` e `paginacao`. O limite máximo é 200 registros por página. Também são aceitos `ordenarPor=data|vencimento|valor|criado|atualizado` e `ordem=asc|desc`.

Edições e exclusões agora respeitam também a competência original fechada. A exclusão de lançamento em mês fechado orienta a utilização de estorno.

### Backup

- O download recebe checksum SHA-256 nos cabeçalhos `X-Backup-SHA256` e `X-Backup-Size`.
- A auditoria registra tamanho e checksum.
- A restauração valida base64, assinatura gzip, tamanho, checksum opcional e espaço livre.
- Não é permitido substituir silenciosamente uma restauração já agendada.
- Novo endpoint administrativo: `GET /api/backup/status`.

### Atualizador desktop

- O `electron-updater` agora é carregado somente quando o aplicativo desktop realmente solicita atualização.
- O servidor e os testes podem iniciar sem baixar o binário completo do Electron.
- O comportamento do atualizador dentro do aplicativo instalado foi preservado.

### Entrega contínua

O workflow `.github/workflows/ci.yml` executa:

1. `npm ci`;
2. `npm run check`;
3. `npm run test:ci`.

As ações oficiais do workflow usam runtime Node.js 24, enquanto a aplicação continua sendo validada com Node.js 20.

## Compatibilidade

- Nenhuma dependência nova foi adicionada.
- A branch foi sincronizada com a versão `2.2.5` da `main`, preservando a correção SMTP mais recente.
- O frontend atual continua consumindo a resposta antiga de lançamentos quando não solicita paginação.
- A branch `main` não é alterada por este pacote.

## Validação

- 35 arquivos JavaScript passaram na verificação de sintaxe.
- 12 testes automatizados passaram, incluindo o fluxo integrado de banco, API, sincronização e backup.
- Resultado do GitHub Actions: aprovado.

## Próximo lote recomendado

1. Paginação visual no frontend;
2. fechamento mensal com estorno formal;
3. backup automático com retenção e teste de restauração;
4. ações em massa;
5. conciliação de PIX Cora;
6. anexos e comprovantes.
