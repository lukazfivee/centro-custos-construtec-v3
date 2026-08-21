# Centro de Custos Construtec — local, offline e sem mensalidade

Aplicação web para a operação financeira da Construtec. Ela abre no navegador, mas o servidor e o banco rodam no computador da empresa. Depois da instalação dos componentes, o uso diário não depende de internet.

## O que o sistema faz

- painel mensal com recebido, pago, saldo, contas a receber, contas a pagar e vencidos;
- comparação de orçamento versus valor comprometido e realizado por obra/centro de custo;
- receitas e despesas com competência, vencimento, liquidação, documento e forma de pagamento;
- filtros por período, obra, categoria, tipo, situação financeira e texto;
- lançamento rápido a partir do painel;
- cadastros de obras/centros, clientes, contratos, responsáveis, categorias e fornecedores;
- relatórios CSV de lançamentos, obras e fornecedores, compatíveis com Excel;
- sincronização offline entre instalações por CSV, com UUID, revisão, origem e conflitos;
- perfis de administrador, gestor e supervisor;
- histórico de alterações, backup completo e restauração protegida;
- interface responsiva com identidade visual da Construtec.

## Custo, privacidade e funcionamento offline

O uso da aplicação tem custo zero:

- não usa ChatGPT, OpenAI ou qualquer inteligência artificial;
- não usa tokens, créditos, chave de API ou assinatura;
- não envia dados para serviços online;
- não precisa de internet durante a operação;
- não depende de SQLite nem de módulos nativos frágeis no Windows.

A internet é necessária apenas na primeira instalação para o `npm install` baixar os componentes gratuitos. Os arquivos visuais, o código e o banco ficam locais.

## Como iniciar no Windows

1. Na primeira vez, instale o Node.js LTS e reinicie o Windows.
2. Abra `iniciar-windows.bat` com dois cliques.
3. Se for a primeira execução, informe o nome da instalação, seu nome, e-mail e uma senha inicial.
4. Aguarde a mensagem de inicialização. O navegador abrirá em `http://localhost:3333`.
5. Nas próximas vezes, use o mesmo `iniciar-windows.bat` ou o atalho configurado no Windows.

Se o navegador mostrar `ERR_CONNECTION_REFUSED`, o servidor não está ativo. Feche a aba, execute `iniciar-windows.bat`, aguarde alguns segundos e abra novamente `http://localhost:3333`.

No Windows, o instalador guarda a base em `%LOCALAPPDATA%\Construtec\CentroCustos\pglite`. Ela fica fora do OneDrive para evitar travas e arquivos parcialmente sincronizados. Não apague nem mova essa pasta. O sistema pode rodar oculto por uma tarefa do Windows; nesse caso, fechar o navegador não encerra o servidor.

## Perfis de acesso

- **Administrador:** acesso total, usuários, cadastros, exclusões, backup e restauração.
- **Gestor:** lançamentos, exclusões, obras, categorias, fornecedores, relatórios e sincronização.
- **Supervisor:** cria e edita lançamentos, consulta painéis e relatórios e troca dados por CSV. Não gerencia usuários, cadastros estruturais, backup ou exclusões.

Cada pessoa deve usar seu próprio usuário. Senhas são armazenadas com hash bcrypt, nunca em texto aberto.

## Operação diária recomendada

1. Cadastre as obras e seus códigos em **Obras / centros**.
2. Cadastre categorias e fornecedores usados com frequência.
3. Use **+ Lançamento rápido** no painel para registrar uma movimentação.
4. Informe a data de competência e o vencimento.
5. Use **Pendente** enquanto a conta não foi paga/recebida; ao liquidar, altere para **Liquidado** e informe a data.
6. Confira o painel mensal e a tabela **Orçamento x comprometido**.
7. Use os filtros de **Lançamentos** e **Exportar relatório CSV** quando precisar prestar contas.

O orçamento exibido é o orçamento mensal cadastrado para a obra. **Comprometido** inclui todas as despesas do mês, pagas ou pendentes. **Pago/recebido** considera apenas lançamentos liquidados.

## Sincronização offline entre duas instalações

Use nomes diferentes para cada cópia, por exemplo `Financeiro - Lucas` e `Supervisão - Alberto`.

Antes da primeira troca, cadastre nas duas cópias os mesmos códigos de obras/centros e os mesmos nomes de categorias. O nome do fornecedor viaja como texto no lançamento; o cadastro completo de fornecedores não é mesclado pelo CSV nesta versão.

Fluxo seguro:

1. Lucas abre **Trocar dados** e exporta todos os lançamentos.
2. Leva o CSV por pendrive ou pasta de rede.
3. Alberto escolhe o arquivo e clica em **Validar e importar**.
4. Alberto confere o resumo e exporta a cópia dele.
5. Lucas importa o arquivo de volta.

O arquivo usa ponto e vírgula e datas `AAAA-MM-DD`. Ele abre no Excel, mas não altere as colunas técnicas. Faça correções dentro do sistema e exporte novamente.

A importação sempre informa:

- **Incluídos:** lançamentos que ainda não existiam;
- **Atualizados:** mesma linha de edição com revisão comprovadamente mais nova;
- **Ignorados:** duplicatas ou dados idênticos;
- **Conflitos:** duas instalações editaram o mesmo lançamento; o registro local foi preservado;
- **Erros:** linha inválida ou obra/categoria relacionada não encontrada.

Cada lançamento possui UUID, origem, revisão, instalação da última alteração e horário. Exclusões também são sincronizadas. Nenhum conflito sobrescreve silenciosamente o dado local. Resolva o conflito comparando as duas versões e confirme a versão correta no sistema antes de uma nova troca.

## Backup e restauração

Somente o administrador acessa **Configurações > Backup e restauração**.

- Faça um backup ao menos semanalmente e antes de atualizar o sistema.
- Guarde o `.tar.gz` em outro computador, pendrive ou pasta corporativa segura.
- Para restaurar, selecione um backup gerado pelo sistema e digite exatamente `RESTAURAR`.
- O servidor encerra para aplicar o arquivo. Abra `iniciar-windows.bat` novamente após alguns segundos.
- Antes de restaurar, o sistema renomeia e preserva automaticamente a base atual ao lado da pasta do banco, com o nome `pglite-antes-restauracao-...`.
- Se o arquivo falhar, a restauração é revertida e a base anterior volta a ser usada.

Nunca desligue a máquina durante a restauração.

## Limitações honestas da versão local

- Cada instalação possui sua própria base; a consolidação depende da troca de CSV.
- Duas edições divergentes exigem decisão humana.
- A máquina que hospeda uma cópia precisa estar ligada durante o uso daquela cópia.
- Acesso externo seguro exigirá VPN ou futura hospedagem. Nunca exponha a porta 3333 diretamente à internet.
- Backups precisam ser copiados para outro local; manter a única cópia no mesmo disco não protege contra falha da máquina.

## Arquitetura e migração futura

- frontend em HTML, CSS e JavaScript, servido localmente pelo Express;
- backend Node.js/Express com autenticação JWT;
- banco local PGlite, PostgreSQL compilado para WebAssembly e persistido em arquivos;
- SQL versionado em `migrations/`;
- entidades separadas para usuários, obras, categorias, fornecedores, lançamentos, auditoria, instalações, importações e conflitos;
- camada de banco compatível com PostgreSQL central por meio de `DATABASE_URL`.

Essa estrutura permite migrar futuramente para um servidor compartilhado ou banco PostgreSQL gerenciado, mantendo as regras de negócio e a maior parte do código. A migração futura precisará incluir HTTPS/VPN, rotina de backup e importação das bases locais.

## Desenvolvimento e validação

```powershell
Copy-Item .env.example .env
npm install
npm run check
npm test
npm start
```

Variáveis principais estão documentadas em `.env.example`. Para desenvolvimento isolado, use `PGLITE_DATA_DIR` e `RESTORE_ROOT_DIR` apontando para pastas temporárias.

