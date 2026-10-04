// Historico: detalhe de um registro no painel lateral (print 78). So leitura: nada aqui edita ou apaga.
(function (CC) {
  const D = CC.d;
  const H = D.hist = D.hist || {};
  const { esc } = CC;

  H.quando = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return { dia: '', hora: '' };
    return { dia: d.toLocaleDateString('pt-BR'), hora: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) };
  };

  function linha(rotulo, valor) {
    return `<div class="hist-par"><span>${esc(rotulo)}</span><b>${valor}</b></div>`;
  }

  function tabela(item) {
    const mudancas = H.mudancas(item);
    if (!mudancas.length) {
      return `<div class="hist-vazio">${D.ic('info')}<span>${item.antes ? 'Nenhum campo mudou nesta ação.' : 'Esta ação não guardou o detalhe dos campos.'}</span></div>`;
    }
    const corpo = mudancas.map((m) => `<tr><th scope="row">${esc(m.campo)}</th>
      <td class="${m.antes === '—' ? 'sem' : 'antes'}">${esc(m.antes)}</td><td class="depois">${esc(m.depois)}</td></tr>`).join('');
    return `<div class="hist-diff"><table><thead><tr><th scope="col">Campo</th><th scope="col">Antes</th><th scope="col">Depois</th></tr></thead><tbody>${corpo}</tbody></table></div>`;
  }

  H.abrirDetalhe = async function (item) {
    const a = H.acao(item.acao);
    const o = H.origem(item.origem);
    const q = H.quando(item.created_at);
    const motivo = item.data && typeof item.data === 'object' ? item.data.motivo : '';
    const registro = item.resumo || H.tipoNome(item.tipo);
    const onde = [H.tipoNome(item.tipo), item.entity_id && String(item.entity_id).length <= 14 ? item.entity_id : ''].filter(Boolean).join(' · ');
    const corpo = `<div class="hist-det">
      ${linha('Quando', esc(`${q.dia} ${q.hora}`))}${linha('Quem', esc(item.usuario || 'Sistema'))}
      ${linha('Ação', D.ui.chip(a.rotulo, a.tom, a.icone))}${linha('Registro', esc(registro))}
      ${linha('Onde', esc(onde))}${linha('Origem', `<span class="hist-origem">${D.ic(o.icone, 15)}${esc(o.rotulo)}</span>`)}
      ${motivo ? linha('Motivo', esc(motivo)) : ''}
      ${tabela(item)}
      <p class="hist-nota">${D.ic('shield-check', 15)}O histórico não pode ser editado nem apagado, nem por administrador.</p></div>`;
    const abrirLanc = item.lancamento_id
      ? `<button type="button" class="btn btn-p" data-abrir-lanc>${D.ic('arrow-square-out')}Abrir lançamento</button>` : '';
    const ctl = await D.painel.abrir({
      icone: 'clock-counter-clockwise', titulo: `${a.rotulo} · ${registro}`, sub: `${q.dia} ${q.hora} · ${item.usuario || 'Sistema'}`,
      corpo, rodape: `<button type="button" class="btn btn-s" data-fechar>Fechar</button>${abrirLanc}`,
    });
    const botao = ctl && CC.$('[data-abrir-lanc]', ctl.rodape);
    if (botao) botao.addEventListener('click', async () => { await ctl.fechar(true); location.hash = `#/lancamentos?id=${item.lancamento_id}`; });
  };
})(window.CC);
