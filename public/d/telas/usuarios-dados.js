// D6: papeis, permissoes e leitura da matriz (compartilhado pelas abas de Usuarios).
(function (CC) {
  const D = CC.d;
  const U = D.usu = D.usu || {};

  U.PAPEIS = [
    { valor: 'admin', rotulo: 'Administrador', nota: 'tudo' },
    { valor: 'gestor', rotulo: 'Gestor', nota: 'obras e equipe' },
    { valor: 'financeiro', rotulo: 'Financeiro', nota: 'caixa e cobranças' },
    { valor: 'engenharia', rotulo: 'Engenharia', nota: 'orçamento e obra' },
    { valor: 'tecnico', rotulo: 'Técnico de campo', nota: 'celular em obra' },
    { valor: 'comercial', rotulo: 'Comercial', nota: 'propostas' },
  ];
  // Quem so ve as obras escolhidas (as demais veem todas).
  U.ESCOPADOS = ['engenharia', 'tecnico'];
  U.APPS = [
    { valor: 'orcamentos', rotulo: 'Orçamentos', icone: 'file-text' },
    { valor: 'centro', rotulo: 'Centro de Custos', icone: 'chart-bar' },
  ];
  U.GRUPOS = [
    ['Centro de Custos', [['p1', 'Ver painel financeiro', 'Indicadores, evolução mensal e resultado'], ['p2', 'Lançar despesas', 'Inclusive pela câmera do celular, com NF'], ['p3', 'Editar e excluir lançamentos', 'Fica registrado no histórico'], ['p4', 'Estornar lançamentos', 'Cria o lançamento inverso'], ['p12', 'Registrar horas e medições', 'Apontamento da equipe e boletins']]],
    ['Financeiro e cadastros', [['p5', 'Cadastros', 'Categorias, fornecedores e recorrentes'], ['p6', 'Cobranças', 'Acompanhar e preparar e-mails ao cliente'], ['p7', 'Autorizar envio de cobrança', 'Libera o e-mail para o cliente'], ['p8', 'Fechamento mensal', 'Fechar e reabrir competências']]],
    ['Orçamentos e administração', [['p10', 'Ver custo, BDI e margem', 'No detalhe das propostas'], ['p11', 'Enviar e aprovar propostas', 'Gerar PDF e registrar aprovação'], ['p9', 'Usuários, permissões e configurações', 'Esta tela, backup e dados da empresa']]],
  ];
  U.nomePapel = (valor) => U.PAPEIS.find((p) => p.valor === valor)?.rotulo || 'Usuário';
  U.nomePermissao = (id) => { for (const [, itens] of U.GRUPOS) { const i = itens.find((x) => x[0] === id); if (i) return i[1]; } return id; };

  // Matriz atual do servidor (papeis x permissoes), guardada ate a proxima leitura.
  let cache = null;
  U.matriz = async (forcar) => {
    if (!cache || forcar) cache = (await CC.api('/usuarios/permissoes')).data;
    return cache;
  };
  U.guardarMatriz = (dados) => { cache = dados; };
})(window.CC);
