// Reports (D7): pecas comuns (tipo, situacao da entrega, data) e o detalhe do report no painel lateral (print 83).
(function (CC) {
  const D = CC.d;
  const U = D.ui;
  const { esc } = CC;
  const R = D.rep = D.rep || {};

  R.TIPOS = {
    bug: { rotulo: 'Erro', tom: 'err', icone: 'bug' },
    sugestao: { rotulo: 'Sugestão', tom: 'info', icone: 'lightbulb' },
    melhoria: { rotulo: 'Melhoria', tom: 'info', icone: 'lightbulb' },
    duvida: { rotulo: 'Dúvida', tom: 'warn', icone: 'question' },
  };
  R.tipo = (valor) => R.TIPOS[valor] || { rotulo: 'Outro', tom: 'neutro', icone: 'chat-circle' };

  // "26/09/2026 08:12", no horario de Brasilia.
  R.quando = (valor) => {
    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) return '';
    return data.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(', ', ' ');
  };
  R.mes = (valor) => {
    const data = new Date(valor);
    return Number.isNaN(data.getTime()) ? '' : data.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
  };

  const curto = (texto, n) => (String(texto || '').length > n ? `${String(texto).slice(0, n - 1).trim()}…` : String(texto || ''));

  // Situacao da entrega: { grupo: entregues | fila | falharam | outro, chip, nota, reenviar }.
  R.entrega = (r) => {
    if (r.local) {
      if (r.estado === 'erro') return { grupo: 'falharam', chip: U.chip('Recusado', 'err', 'warning'), nota: curto(r.erro || 'O servidor não aceitou o report.', 70), reenviar: true };
      return { grupo: 'fila', chip: U.chip('Na fila', 'warn', 'clock'), nota: 'Sai quando a internet voltar', reenviar: true };
    }
    const resposta = r.resposta_equipe ? curto(r.resposta_equipe, 60) : '';
    switch (r.delivery_status) {
      case 'delivered': return { grupo: 'entregues', chip: U.chip('Entregue', 'ok', 'check'), nota: resposta || 'Recebido pela equipe', reenviar: false };
      case 'accepted': return { grupo: 'entregues', chip: U.chip('Recebido', 'info', 'check'), nota: resposta || 'Confirmando a entrega', reenviar: false };
      case 'failed': return { grupo: 'falharam', chip: U.chip('Falhou', 'err', 'warning'), nota: `Falha no envio: ${curto(r.last_delivery_error || 'sem detalhe', 50)}`, reenviar: true };
      case 'pending': case 'sending':
        return { grupo: 'fila', chip: U.chip('Na fila', 'warn', 'clock'), nota: /configurad/i.test(r.last_delivery_error || '') ? 'Entrega central não configurada' : (r.delivery_status === 'sending' ? 'Enviando agora' : 'Aguardando envio'), reenviar: true };
      default: return { grupo: 'outro', chip: U.chip('Registrado', 'neutro', 'archive'), nota: 'Anterior ao controle de entrega', reenviar: false };
    }
  };

  const linha = (rotulo, valor) => `<dt>${esc(rotulo)}</dt><dd>${valor}</dd>`;

  async function carregarPrint(id, alvo) {
    try {
      const resposta = await fetch(`/api/bug-reports/${id}/anexo`, { headers: { Authorization: `Bearer ${CC.session.token()}` }, cache: 'no-store' });
      if (!resposta.ok) throw new Error('sem print');
      const url = URL.createObjectURL(await resposta.blob());
      alvo.innerHTML = `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="Print enviado junto com o report"></a>`;
    } catch {
      alvo.innerHTML = '<span class="muted">Não foi possível carregar o print.</span>';
    }
  }

  function corpo(r, diag, anexoHtml) {
    const t = R.tipo(r.tipo);
    const e = R.entrega(r);
    const acoes = diag && Array.isArray(diag.acoes) ? diag.acoes : [];
    return `<dl class="dados">
      ${linha('Tipo', U.chip(t.rotulo, t.tom, t.icone))}
      ${linha('Onde', esc(r.tela || 'Não informado'))}
      ${linha('Enviado por', esc(r.author_name || 'Você'))}
      ${linha('Quando', esc(R.quando(r.created_at || r.criado_em)))}
      ${linha('Entrega', `${e.chip} <span class="muted">${esc(e.nota)}</span>`)}
      ${r.local ? '' : linha('Tentativas', esc(String(r.delivery_attempts || 0)))}
      ${r.central_report_id ? linha('Código na equipe', esc(r.central_report_id)) : ''}
      ${linha('Diagnóstico', diag ? esc(`Incluído · ${D.diag.resumo(diag)}`) : 'Não incluído')}
    </dl>
    ${acoes.length ? `<details class="rep-acoes"><summary>Últimas ${acoes.length} ações</summary><ol>${acoes.map((a) => `<li>${esc(a.acao)}</li>`).join('')}</ol></details>` : ''}
    <div class="rep-caixa"><span class="eyebrow">Descrição</span><p><b>${esc(r.titulo)}</b></p><p>${esc(r.descricao)}</p></div>
    ${anexoHtml}
    ${r.resposta_equipe ? `<div class="rep-caixa resposta"><span class="eyebrow">Resposta da equipe do sistema</span><p>${esc(r.resposta_equipe)}</p></div>`
      : '<div class="rep-caixa vazia"><span class="eyebrow">Resposta da equipe do sistema</span><p class="muted">A equipe ainda não respondeu.</p></div>'}`;
  }

  // r: linha da lista (server) ou item da fila ({ local: true, ... }). aoMudar: recarrega a lista.
  R.ver = async function (r, aoMudar) {
    const local = !!r.local;
    let detalhe = r;
    if (!local) {
      try { detalhe = { ...r, ...(await CC.api(`/bug-reports/${r.id}`)).data }; } catch (error) { CC.toast(error.message, 'warning-circle'); return; }
    }
    const diag = local ? r.diagnostico : detalhe.diagnostico;
    const e = R.entrega(detalhe);
    const temPrint = local ? !!r.anexo : !!detalhe.tem_anexo;
    const ctl = await D.painel.abrir({
      icone: R.tipo(detalhe.tipo).icone, titulo: 'Report', sub: `${R.quando(detalhe.created_at || detalhe.criado_em)} · ${detalhe.author_name || 'Você'}`,
      corpo: corpo(detalhe, diag, temPrint ? '<div class="rep-print" data-print><span class="muted">Carregando o print…</span></div>' : ''),
      rodape: `<button type="button" class="btn ${e.reenviar ? 'btn-s' : 'btn-p'}" data-fechar>Fechar</button>${e.reenviar ? `<button type="button" class="btn btn-p" data-reenviar>${D.ic('arrow-clockwise')}Reenviar</button>` : ''}`,
    });
    if (!ctl) return;
    const alvo = CC.$('[data-print]', ctl.corpo);
    if (alvo && local) alvo.innerHTML = `<img src="data:${esc(r.anexo.tipo)};base64,${esc(r.anexo.dados)}" alt="Print que será enviado com o report">`;
    else if (alvo) carregarPrint(detalhe.id, alvo);
    const bt = CC.$('[data-reenviar]', ctl.rodape);
    if (bt) bt.addEventListener('click', async () => {
      await R.reenviar(detalhe, bt);
      ctl.fechar(true);
      if (aoMudar) aoMudar();
    });
  };
})(window.CC);
