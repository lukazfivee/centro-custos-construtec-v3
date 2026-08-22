# P1 — Lista de lançamentos mais fluida

## Objetivo

Reduzir o peso da tela de lançamentos e tornar a consulta mais rápida e confortável, especialmente quando a base crescer para milhares de registros.

## Alterações implementadas

### Paginação visual

- A tela passa a consultar a API paginada já criada no P0.
- O usuário pode exibir 25, 50, 100 ou 200 lançamentos por página.
- Foram adicionados botões para primeira, anterior, próxima e última página.
- A faixa exibida e o total de registros aparecem no rodapé da tabela.
- A página atual é corrigida automaticamente quando a última linha de uma página é excluída.

### Ordenação

A lista pode ser ordenada por:

- competência;
- vencimento;
- valor;
- data de inclusão;
- última alteração.

O sentido crescente ou decrescente pode ser alternado por um botão ao lado do seletor.

### Filtros mais rápidos

- A pesquisa textual é executada após uma pequena pausa na digitação, evitando uma requisição a cada tecla.
- Os filtros de tipo, situação, obra, categoria e período são aplicados ao serem alterados.
- Foi incluído o botão **Limpar filtros**.
- Ao mudar qualquer filtro, a lista retorna automaticamente à primeira página.
- `Ctrl+K` posiciona o cursor na pesquisa quando a tela de lançamentos está aberta.

### Experiência visual

- Cabeçalho da tabela fixo durante a rolagem.
- Área de tabela com rolagem própria em telas grandes.
- Indicador visual durante o carregamento.
- Controles responsivos para telas menores.
- Estado de paginação, limite e ordenação preservado no navegador.

### Isolamento do teste

A nova experiência é carregada por `public/teste-chatgpt.html`, sem alterar o `public/index.html` principal nesta etapa. O inicializador `TESTAR-VERSAO-CHATGPT.bat` abre automaticamente essa entrada na porta 3334 e continua usando o banco `dados-chatgpt`.

## Compatibilidade

- Nenhuma dependência nova.
- O comportamento da API antiga continua disponível.
- Exportação CSV permanece baseada em todos os registros filtrados, não apenas na página visível.
- Criação, edição e exclusão continuam usando as mesmas regras do sistema.
- A versão principal e o banco real não são modificados.

## Validação

O pacote adiciona testes estáticos para confirmar:

- carregamento dos recursos P1;
- uso da paginação da API;
- limites de página permitidos;
- abertura na porta isolada 3334.

A verificação completa continua executando sintaxe e todos os testes de integração existentes.
