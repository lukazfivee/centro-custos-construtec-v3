// Assistente no desktop (/d/): reaproveita a configuracao, as ferramentas e a conversa do celular
// (../m/ia-config.js, ia-tools.js e ia-chat.js, que tambem cria o botao flutuante) e troca so o que
// e do desktop: os destinos de "abrir tela", as instrucoes da IA e o nome da tela aberta.
(function (CC) {
  const D = CC.d;
  const IA = CC.ia;
  if (!D || !IA || !IA.telas) return;
  const ORCAMENTOS = 'https://construtec-orcamentos-cloud.construtec-reports.workers.dev/';
  const PROPOSTA = /^[A-Za-z0-9-]{1,64}$/;

  // Nome da tela (rota) que a IA e o relato de problema contam como "tela aberta".
  CC.current = () => D.lerRota().nome;
  const ROTULOS = { inicio: 'Início', lancamentos: 'Lançamentos', obras: 'Obras', servicos: 'detalhe de um serviço', cobrancas: 'Cobranças', categorias: 'Categorias',
    fornecedores: 'Fornecedores', recorrentes: 'Recorrentes', fechamento: 'Fechamento mensal', usuarios: 'Usuários', historico: 'Histórico', reports: 'Reports', config: 'Configurações' };

  // No app Windows o Orçamentos é a outra tela da mesma janela; no navegador abre em outra aba.
  const orcamentos = (hash) => {
    if (window.electronAPI && window.electronAPI.suiteSwitch) window.electronAPI.suiteSwitch('orcamentos', hash || undefined);
    else window.open(`${ORCAMENTOS}${hash ? `#${hash}` : ''}`, '_blank', 'noopener');
  };
  const tela = (chave, caminho) => () => (D.podeTela(chave) ? () => D.ir(caminho || chave) : 'O perfil desta pessoa não acessa essa tela.');

  // Mesmos nomes de tela do celular quando existem; o resto não existe no desktop e sai da lista da IA.
  Object.keys(IA.telas).forEach((k) => { delete IA.telas[k]; delete IA.nomes[k]; });
  Object.assign(IA.telas, {
    inicio: tela('inicio'),
    lancamentos: tela('lancamentos'),
    nova_despesa: tela('lancamentos', 'lancamentos?novo=1'),
    obras: tela('obras'),
    obra: (a) => (a.obra_id > 0 ? () => D.ir(`obras/${Number(a.obra_id)}`) : 'Informe obra_id (use listar_obras).'),
    cobrancas: tela('cobrancas'),
    categorias: tela('categorias'),
    fornecedores: tela('fornecedores'),
    recorrentes: tela('recorrentes'),
    fechamento: tela('fechamento'),
    usuarios: tela('usuarios'),
    historico: tela('historico'),
    reports: tela('reports'),
    configuracoes: tela('config'),
    orcamentos: () => () => orcamentos(),
    proposta: (a) => (PROPOSTA.test(String(a.proposta_id || '')) ? () => orcamentos(`proposta=${encodeURIComponent(a.proposta_id)}`) : 'Informe proposta_id (use listar_propostas).'),
  });
  Object.assign(IA.nomes, { inicio: 'Início', lancamentos: 'Lançamentos', nova_despesa: 'Novo lançamento', obras: 'Obras', obra: 'a obra', cobrancas: 'Cobranças', categorias: 'Categorias',
    fornecedores: 'Fornecedores', recorrentes: 'Recorrentes', fechamento: 'Fechamento mensal', usuarios: 'Usuários', historico: 'Histórico', reports: 'Reports', configuracoes: 'Configurações',
    orcamentos: 'Orçamentos', proposta: 'a proposta' });

  if (IA.sugestoes) {
    IA.sugestoes.splice(0, IA.sugestoes.length, 'Quais obras estão acima do orçado?', 'Quanto tenho a pagar este mês?', 'Como crio um novo lançamento?', 'Resumo das propostas enviadas', 'Quero reportar um problema');
  }

  CC.iaPrompt = function () {
    const u = CC.session.user() || {};
    const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    const aberta = ROTULOS[CC.current()] || 'Início';
    return `Você é o assistente da Suíte Construtec (RC Construtec, empresa de engenharia e instalações), dentro do Centro de Custos do computador.
Hoje é ${hoje} (horário de Brasília). Quem fala com você: ${u.nome || u.name || 'usuário'}, papel ${D.papelNome()}. Tela aberta agora: ${aberta}.

Como responder:
- Português do Brasil, frases curtas e diretas, sem emojis. Use listas curtas com "- " e **negrito** só no que importa.
- Números, valores, nomes de obras e propostas vêm SÓ das ferramentas. Nunca invente nem estime. Se uma ferramenta der erro, diga o motivo em uma frase.
- Valores em reais no formato R$ 1.234,56; datas em dd/mm/aaaa.
- Se não souber qual obra ou proposta a pessoa quer, procure com listar_obras ou listar_propostas; se houver mais de uma parecida, pergunte qual.
- Você só consulta e abre telas. Não cria, edita nem exclui lançamentos, obras ou propostas: explique o passo a passo ou abra a tela certa com abrir_tela.
- Ao abrir uma tela, diga numa frase o que vai abrir e o que a pessoa faz lá.

O sistema no computador:
- Menu lateral: Início, Lançamentos, Obras, Cobranças, Categorias, Fornecedores, Recorrentes, Fechamento mensal, Usuários, Histórico, Reports e Configurações. Cada pessoa só vê o que o papel dela permite.
- Início: pendências, gráficos e o resumo do mês.
- Lançamentos: lista com filtros e busca; "Novo lançamento" abre um painel lateral (obra, categoria, fornecedor, descrição, valor, data, pagamento, documentos).
- Obras: lista de obras (centros de custo). No detalhe da obra, abas Orçado × realizado, Lançamentos, Notas fiscais, Medições e Curva S, com impressão do relatório.
- Cobranças (e-mail corporativo), Categorias, Fornecedores e Recorrentes (lançamentos que se repetem); Fechamento mensal (checklist e bloqueio do mês); Usuários (papéis, e-mails autorizados, só administradores); Histórico (auditoria); Reports (relatos de bugs, melhorias e sugestões da equipe).
- Topo: busca global, botão Suíte (troca para o Orçamentos e o ChamadoPro), tema claro ou escuro e o selo que mostra se os dados estão neste computador ou na nuvem.

Conceitos:
- Obra = centro de custo. Custo orçado = custo base do orçamento aprovado. Gasto comprometido = despesas lançadas (pagas e a pagar). Resultado = recebido menos pago.
- Conta vencida = a pagar ou a receber com vencimento antes de hoje.
- Proposta (no Orçamentos): rascunho, em revisão, enviada, aprovada ou recusada. Tem custo, venda, BDI (multiplicador), impostos e margem. Aprovada, ela vira contrato no Centro e dá o orçado por item da obra (use orcado_realizado).
- Papéis: admin (tudo), gestor (cadastros e financeiro), financeiro, engenharia, técnico de campo, comercial e supervisor.

Relatar problema (bug, melhoria ou sugestão):
- Descubra em no máximo duas perguntas o que a pessoa fazia, o que esperava e o que aconteceu, e em que tela.
- Depois chame preparar_reporte com título curto e descrição organizada. Severidade: critica só se impede o trabalho ou perde dados; alta se atrapalha muito; media no resto; baixa para detalhes. O envio é a pessoa quem faz, no cartão.`;
  };
})(window.CC);
