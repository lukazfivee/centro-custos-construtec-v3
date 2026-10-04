// D7: Reports (prints 80 a 83). KPIs, filtros, tabela com a entrega de cada report, novo report e fila offline.
(function (CC) {
  const D = CC.d;
  const U = D.ui;
  const R = D.rep;
  const { esc } = CC;
  let filtro = 'todos';
  let busca = '';

  const FILTROS = [{ valor: 'todos', rotulo: 'Todos' }, { valor: 'entregues', rotulo: 'Entregues' }, { valor: 'fila', rotulo: 'Na fila' }, { valor: 'falharam', rotulo: 'Falharam' }];

  // Item da fila deste navegador vira uma linha como as do servidor.
  const doNavegador = (i) => ({
    local: true, id: `l:${i.client_id}`, client_id: i.client_id, estado: i.estado, erro: i.erro, created_at: new Date(i.criado_em).toISOString(),
    titulo: i.payload.titulo, descricao: i.payload.descricao, tipo: i.payload.tipo, tela: i.payload.tela, diagnostico: i.payload.diagnostico, anexo: i.payload.anexo,
    author_name: (D.usuario().nome || ''),
  });

  // Reenvia pelo servidor (report ja gravado) ou pela fila do navegador.
  R.reenviar = async function (r, botao) {
    const livre = botao ? U.ocupar(botao, 'Reenviando…') : null;
    try {
      if (r.local) {
        if (CC.offline()) { CC.toast('Ainda sem internet · o report segue guardado neste computador', 'cloud-slash'); return; }
        const n = await R.fila.tentar(r.client_id);
        CC.toast(n ? 'Report enviado' : 'Ainda não foi possível enviar · tentaremos de novo', n ? 'paper-plane-tilt' : 'clock');
        return;
      }
      const { data } = await CC.api(`/bug-reports/${r.id}/retry`, { method: 'POST', body: {} });
      if (data.ok) CC.toast('Report entregue à equipe', 'check-circle');
      else if (data.reason === 'not_configured') CC.toast('A entrega central não está configurada neste computador · o report fica guardado', 'info');
      else CC.toast('Sem resposta do servidor central · o report segue na fila', 'clock');
    } catch (error) {
      CC.toast(error.status === 0 ? 'Sem internet · tente de novo quando voltar' : error.message, 'warning-circle');
    } finally {
      if (livre) livre();
    }
  };

  function linhaTabela(r) {
    const t = R.tipo(r.tipo);
    const e = R.entrega(r);
    return {
      id: r.id, clicavel: true,
      celulas: [
        `<span class="dois-tx rep-titulo"><b>${esc(r.titulo)}</b><span>${esc(r.author_name || '')}${r.author_name ? ' · ' : ''}${esc(r.descricao)}</span></span>`,
        U.chip(t.rotulo, t.tom, t.icone),
        esc(r.tela || '—'),
        esc(R.quando(r.created_at)),
        `<span class="dois-tx">${e.chip}<span class="rep-nota">${esc(e.nota)}</span></span>`,
        e.reenviar ? `<div class="usu-acoes"><button type="button" class="btn btn-t" data-reenviar="${esc(r.id)}">${D.ic('arrow-clockwise')}Reenviar</button></div>` : '',
      ],
    };
  }

  function kpis(todos) {
    const mes = CC.month();
    const doMes = todos.filter((r) => R.mes(r.created_at) === mes);
    const grupo = (lista, g) => lista.filter((r) => R.entrega(r).grupo === g).length;
    return `<div class="usu-kpis">
      ${U.kpi({ rotulo: 'Enviados no mês', valor: String(doMes.length), det: 'erros, sugestões e dúvidas', icone: 'paper-plane-tilt', tom: 'info' })}
      ${U.kpi({ rotulo: 'Entregues', valor: String(grupo(doMes, 'entregues')), det: 'recebidos pela equipe', icone: 'check-circle', tom: 'ok' })}
      ${U.kpi({ rotulo: 'Na fila', valor: String(grupo(todos, 'fila')), det: 'esperando internet ou envio', icone: 'clock', tom: 'warn' })}
      ${U.kpi({ rotulo: 'Falharam', valor: String(grupo(todos, 'falharam')), det: 'reenvie pela linha', icone: 'warning', tom: 'err' })}
    </div>`;
  }

  async function render(el, rota, vivo) {
    el.innerHTML = `<div class="pagina">${U.cabecalho({ grupo: 'Administração', titulo: 'Reports', sub: 'Problemas e sugestões enviados à equipe do sistema, com a situação da entrega.',
      acoes: `<button type="button" class="btn btn-p" data-novo>${D.ic('plus')}Novo report</button>` })}<div data-corpo>${U.carregando('Carregando os reports…')}</div></div>`;
    CC.$('[data-novo]', el).addEventListener('click', () => R.novo(carregar));
    const corpo = CC.$('[data-corpo]', el);

    async function carregar() {
      if (!vivo()) return;
      let servidor = [];
      let aviso = '';
      try { servidor = (await CC.api('/bug-reports')).data; } catch (error) {
        if (!vivo()) return;
        if (error.status !== 0) { corpo.innerHTML = U.faixa('err', 'warning-circle', error.message); return; }
        aviso = 'Sem internet. Aparecem só os reports guardados neste computador.';
      }
      const locais = (await R.fila.minha()).map(doNavegador);
      if (!vivo()) return;
      pintar([...locais, ...servidor].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))), aviso);
    }

    function pintar(todos, aviso) {
      corpo.innerHTML = `${aviso ? U.faixa('warn', 'wifi-slash', aviso) : ''}${kpis(todos)}
        <div class="card usu-barra"><label class="campo-busca">${D.ic('magnifying-glass')}<input class="inp" type="search" data-busca value="${esc(busca)}" placeholder="Título ou descrição" aria-label="Buscar report"></label>
          ${U.seg('filtro', FILTROS, filtro, 'Situação da entrega')}</div>
        <div class="card cad-tabela"><div data-tabela></div><div class="rep-rodape" data-rodape></div></div>`;
      const lista = () => {
        const q = busca.trim().toLowerCase();
        return todos.filter((r) => (filtro === 'todos' || R.entrega(r).grupo === filtro) && (!q || [r.titulo, r.descricao].join(' ').toLowerCase().includes(q)));
      };
      const tabela = () => {
        const visiveis = lista();
        CC.$('[data-tabela]', corpo).innerHTML = U.tabela({
          colunas: [{ rotulo: 'Report' }, { rotulo: 'Tipo' }, { rotulo: 'Tela' }, { rotulo: 'Enviado' }, { rotulo: 'Entrega' }, { rotulo: 'Ações' }],
          linhas: visiveis.map(linhaTabela), vazio: todos.length ? 'Nenhum report neste filtro.' : 'Nenhum report enviado ainda.',
        });
        CC.$('[data-rodape]', corpo).textContent = `${visiveis.length} de ${todos.length} reports`;
        const achar = (id) => todos.find((r) => String(r.id) === String(id));
        CC.$$('tr.rw', corpo).forEach((tr) => {
          const abrir = () => R.ver(achar(tr.dataset.id), carregar);
          tr.addEventListener('click', (event) => { if (!event.target.closest('button')) abrir(); });
          tr.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.target.closest('button')) abrir(); });
        });
        CC.$$('[data-reenviar]', corpo).forEach((b) => b.addEventListener('click', async (event) => {
          event.stopPropagation();
          await R.reenviar(achar(b.dataset.reenviar), b);
          carregar();
        }));
      };
      CC.$('[data-busca]', corpo).addEventListener('input', (event) => { busca = event.target.value; tabela(); });
      CC.$$('[data-seg="filtro"]', corpo).forEach((b) => b.addEventListener('click', () => { filtro = b.dataset.valor; U.segEscolher(b.parentElement, b); tabela(); }));
      tabela();
    }

    // A fila mudou (enviou, descartou, voltou a conexao): atualiza enquanto esta tela estiver aberta.
    const aoMudarFila = () => { if (vivo()) carregar(); else document.removeEventListener('d:reports', aoMudarFila); };
    document.addEventListener('d:reports', aoMudarFila);
    await carregar();
    return undefined;
  }

  D.tela('reports', { render });
})(window.CC);
