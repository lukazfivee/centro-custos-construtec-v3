# P4 — Comprovantes e documentos

Esta etapa adiciona documentos diretamente aos lançamentos sem alterar a `main`.

## Incluído

- anexos vinculados ao lançamento;
- PDF, JPG, PNG e WEBP;
- limite de 8 MB por arquivo;
- categorias: comprovante, nota fiscal, boleto, recibo, contrato e outro;
- observação opcional;
- SHA-256 por arquivo;
- bloqueio de duplicata no mesmo lançamento;
- armazenamento dentro do banco, fazendo o conteúdo acompanhar o backup da base;
- download autenticado;
- exclusão restrita a administrador e gestor;
- auditoria de inclusão e remoção;
- interface P4 na tabela de lançamentos;
- testes automatizados e teste integrado real de upload/download.

## Decisão de arquitetura

Os binários são mantidos no banco nesta fase para que o backup local preserve lançamento e documento em conjunto e para evitar arquivos órfãos. O limite de 8 MB reduz crescimento descontrolado.

## Sincronização

O pacote `.ccsync` P3 continua sincronizando os dados financeiros e cadastrais, mas os binários dos anexos ainda não são transportados. A sincronização de anexos deve usar hash, envio único e retomada controlada em uma etapa posterior, evitando transformar todo pacote financeiro em um arquivo excessivamente grande.
