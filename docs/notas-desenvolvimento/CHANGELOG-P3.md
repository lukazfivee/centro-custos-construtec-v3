# P3 — Sincronização inteligente

## Objetivo

Substituir a troca fragmentada de CSV por um pacote completo, íntegro e rastreável entre instalações locais do Centro de Custos.

## O que entrou

- arquivo `.ccsync` em JSON versionado (formato 3);
- SHA-256 do conteúdo para detectar arquivo alterado ou corrompido;
- UUID único por pacote para impedir reimportação duplicada;
- exportação conjunta de categorias, obras/centros, fornecedores e lançamentos;
- transporte dos campos de estorno (`accounting_sign`, `reversal_of`, motivo e datas);
- importação transacional: se ocorrer erro estrutural, o pacote inteiro é desfeito;
- histórico dos pacotes importados;
- fila própria de conflitos por entidade;
- botão para manter a versão local em conflitos pendentes;
- revisão de categorias, fornecedores e obras passa a incrementar quando o cadastro é editado;
- painel P3 dentro da tela Trocar dados;
- base de teste permanece isolada na porta 3334.

## Regras de segurança

- pacote acima de 20 MB é recusado;
- formato diferente da versão 3 é recusado;
- hash inválido é recusado;
- pacote já importado retorna como duplicado sem inserir novamente;
- referências de lançamentos são feitas pelos `public_id` de obra e categoria, não por IDs numéricos locais;
- conflitos não substituem silenciosamente a versão local;
- nesta etapa a resolução automática de conflito recebido ainda não é habilitada: a opção segura é manter local ou revisar manualmente.

## Como testar

1. Abra a versão P3 pelo `TESTAR-VERSAO-CHATGPT.bat`.
2. Vá em **Trocar dados**.
3. No painel **P3 · sincronização inteligente**, clique em **Exportar pacote inteligente**.
4. Será baixado um `.ccsync`.
5. Para simular outra instalação, use uma segunda cópia do projeto com outro diretório de dados ou importe o pacote em uma base de teste limpa.
6. Selecione o `.ccsync` e clique em **Validar e importar**.
7. Confira os contadores de incluídos, atualizados, ignorados e conflitos.
8. Importe o mesmo pacote novamente: o sistema deve informar que ele já foi processado sem duplicar registros.
9. Gere um estorno na origem, exporte novo pacote e confirme que o movimento de estorno chega junto.
