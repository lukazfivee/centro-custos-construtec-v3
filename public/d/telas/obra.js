// Detalhe da obra em pagina inteira (print 31): topo com acoes e abas.
// #/obras/12 (orcado x realizado), #/obras/12/lancamentos, /nf, /medicoes e /curva.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const O = D.obras = D.obras || {};
  const U = D.ui;
  const ABAS = [['orcado', 'Orçado × realizado'], ['lancamentos', 'Lançamentos'], ['nf', 'Notas fiscais'], ['medicoes', 'Medições'], ['curva', 'Curva S']];
  O.abas = O.abas || {};

  // "PROP-031 REV 02": revisao sempre com dois digitos (corrige o "REV010" do sistema atual).
  O.revisao = (p) => (p && p.numero ? `${p.numero} REV ${String(p.revisao == null ? 0 : p.revisao).padStart(2, '0')}` : '');

  function topo(c) {
    const periodo = c.data_inicio || c.data_fim ? `${D.data(c.data_inicio) || '—'} a ${D.data(c.data_fim) || '—'}` : '';
    const sub = [c.cliente, c.responsavel ? `Resp. ${c.responsavel}` : '', periodo].filter(Boolean).join(' · ');
    const olho = [c.codigo, O.revisao(c.proposta_origem)].filter(Boolean).join(' · ');
    return `<a class="voltar" href="#/obras">${D.ic('arrow-left')}Obras</a>
      <div class="cab cab-obra"><div class="tit">${olho ? `<span class="eyebrow">${esc(olho)}</span>` : ''}<h1>${esc(c.nome)}</h1>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div>
        <div class="acoes">${O.chipSituacao(c.situacao)}
          ${D.pode('cadastrar') ? `<button type="button" class="btn btn-s" data-editar-obra>${D.ic('pencil-simple')}Editar obra</button>` : ''}
          <button type="button" class="btn btn-p" data-lancar>${D.ic('plus')}Lançar despesa</button></div></div>`;
  }

  O.detalhe = async function (el, rota, vivo) {
    const aba = ABAS.some(([k]) => k === rota.aba) ? rota.aba : 'orcado';
    el.innerHTML = `<div class="pagina obra">${U.carregando('Abrindo a obra…')}</div>`;
    let data;
    try {
      ({ data } = await CC.api(`/centros-custo/${encodeURIComponent(rota.id)}/detalhes`));
    } catch (error) {
      if (!vivo()) return;
      el.innerHTML = `<div class="pagina">${U.cabecalho({ grupo: 'Operação', titulo: error.status === 404 ? 'Obra não encontrada' : 'Não foi possível abrir a obra' })}
        <div class="card">${U.vazio('buildings', error.status === 404 ? 'Esta obra não existe ou foi removida.' : error.message)}</div></div>`;
      return;
    }
    if (!vivo()) return;
    const c = data.centro;
    // A lista traz a revisao usada na edicao; /detalhes nao traz.
    const daLista = await CC.api('/centros-custo').then((r) => (r.data || []).find((x) => String(x.id) === String(c.id))).catch(() => null);
    if (!vivo()) return;
    const obra = { ...c, revision: daLista ? daLista.revision : c.revision };
    el.innerHTML = `<div class="pagina obra">${topo(obra)}
      <div class="abas-pagina" role="tablist">${ABAS.map(([k, t]) => `<a class="tab" role="tab" href="#/obras/${esc(c.id)}${k === 'orcado' ? '' : `/${k}`}" aria-selected="${k === aba ? 'true' : 'false'}">${esc(t)}</a>`).join('')}</div>
      <div data-aba-corpo></div></div>`;
    const editar = CC.$('[data-editar-obra]', el);
    if (editar) editar.addEventListener('click', () => O.formulario(obra, () => D.ir(location.hash.replace(/^#\/?/, ''))));
    CC.$('[data-lancar]', el).addEventListener('click', () => D.lanc.formulario(null, null, c.id));
    const corpo = CC.$('[data-aba-corpo]', el);
    const desenhar = O.abas[aba];
    if (desenhar) await desenhar(corpo, obra, vivo);
    else corpo.innerHTML = `<div class="card">${U.vazio('hammer', 'Esta aba chega na próxima parte da fase de Obras (D3b).', 'Enquanto isso, ela continua no sistema atual.')}</div>`;
  };

  // Aba Lancamentos: a mesma lista da tela de Lancamentos, filtrada pela obra.
  O.abas.lancamentos = (corpo, obra, vivo) => {
    const f = { ...D.lanc.padrao(), mes: '', obra: String(obra.id) };
    return D.lanc.montarLista(corpo, { f, vivo, obraFixa: obra.id });
  };
})(window.CC);
