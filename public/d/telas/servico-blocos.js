// Blocos do detalhe do servico (28Dk, 28Dl, 28Dy, 28Dab): numeros, gastos por tipo, lancamentos,
// notas e anexos, o que foi feito com checklist, fotos, aceite e cobranca.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const U = D.ui;
  const S = D.serv = D.serv || {};
  const B = S.blocos = {};
  const qtd = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const dataHora = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`; };
  B.dataHora = dataHora;

  B.kpis = (sv, fila) => {
    const r = sv.resumo || {};
    const n = (sv.gastos || []).length + fila.length;
    const card = (l, v, s, cls) => `<div class="card kpi-sv"><span class="lbl">${esc(l)}</span><b class="${cls || ''}">${esc(v)}</b><span class="muted">${esc(s)}</span></div>`;
    const gastos = card('Gastos', CC.money(r.gastos), n ? qtd(n, 'lançamento', 'lançamentos') : 'nenhum ainda');
    if (!S.veValores(sv)) {
      const fotos = sv.fotos || [];
      const antes = fotos.filter((f) => f.fase === 'antes').length;
      return `<div class="kpis-sv dois">${gastos}${card('Fotos', String(fotos.length), `${antes} antes · ${fotos.length - antes} depois`)}</div>`;
    }
    const res = Number(r.resultado || 0);
    return `<div class="kpis-sv">${card('Cobrado', CC.money(r.cobrado), 'valor do serviço')}${gastos}
      ${card('Resultado', CC.money(res), 'cobrado − gastos', res < 0 ? 'err' : 'ok')}${card('Margem', S.pct(r.margem), 'do valor cobrado', res < 0 ? 'err' : 'ok')}</div>`;
  };

  B.porTipo = (sv) => {
    const r = sv.resumo || {};
    const total = Number(r.gastos || 0);
    const grupos = r.gastosPorTipo || [];
    const corpo = total || (sv.gastos || []).length ? `<div class="por-tipo">${grupos.map((g) => {
      const a = S.atalho(g.tipo);
      const w = total > 0 ? Math.max(0, Math.min(100, (Number(g.total) / total) * 100)) : 0;
      return `<div class="pt${Number(g.total) ? '' : ' apagado'}"><div class="pt-l">${D.ic(a.icone, 18)}<span><b>${esc(g.rotulo || S.ROTULO_GRUPO[g.tipo] || g.tipo)}</b><span class="muted">${g.quantidade ? qtd(g.quantidade, 'lançamento', 'lançamentos') : 'Nenhum gasto'}</span></span><b>${Number(g.total) ? esc(CC.money(g.total)) : '—'}</b></div>
        <span class="bar"><span style="width:${w.toFixed(1)}%"></span></span></div>`;
    }).join('')}</div>` : `<div class="sem-gasto"><span class="ic-q">${D.ic('receipt', 22)}</span><span><b>Nenhum gasto lançado</b><span class="muted">Uber, combustível e miscelânea aparecem aqui assim que alguém lançar, no celular ou aqui.</span></span>
        ${D.tem('p2') && sv.situacao !== 'faturado' ? `<button type="button" class="btn btn-s" data-lancar>${D.ic('plus')}Lançar despesa</button>` : ''}</div>`;
    return `<section class="card bloco-sv"><div class="bcab-sv"><b>Gastos por tipo</b><b>${esc(CC.money(total))}</b></div>${corpo}</section>`;
  };

  B.lancamentos = (sv, fila) => {
    const linhas = [
      ...fila.map((i) => ({ fila: true, data: i.payload.data, tipo: i.servico.tipo, descricao: i.payload.descricao, quem: 'Neste computador', valor: i.payload.valor, recibo: !!i.foto })),
      ...(sv.gastos || []).map((g) => ({ id: g.id, data: g.data, tipo: g.tipo, descricao: g.descricao, quem: g.lancadoPor || g.favorecido || '', valor: g.valor, recibo: Number(g.anexos) > 0 })),
    ];
    const tabela = linhas.length ? `<table class="tbl"><thead><tr><th scope="col">Data</th><th scope="col">Tipo</th><th scope="col">Descrição</th><th scope="col">Recibo</th><th scope="col" class="num">Valor</th></tr></thead><tbody>
      ${linhas.map((l) => {
        const a = S.atalho(l.tipo);
        const recibo = l.fila ? U.chip('Na fila', 'warn', 'cloud-arrow-up') : (l.recibo ? U.chip('Foto', 'info', 'image') : U.chip('Sem recibo', 'neutro'));
        return `<tr${l.id ? ` class="rw" tabindex="0" data-lanc="${esc(l.id)}"` : ''}><td class="nw">${esc(D.data(l.data))}</td><td class="nw"><span class="tp">${D.ic(a.icone, 17)}${esc(a.rotulo)}</span></td>
          <td><span class="duas-l"><b>${esc(l.descricao)}</b>${l.quem ? `<span>${esc(l.quem)}</span>` : ''}</span></td><td class="nw">${recibo}</td><td class="num"><b>${esc(CC.money(l.valor))}</b></td></tr>`;
      }).join('')}</tbody></table>` : `<div class="vazio-sv">${D.ic('receipt', 28)}Nenhuma despesa lançada neste serviço.</div>`;
    return `<section class="card bloco-sv tabela"><div class="bcab-sv pad"><b>Lançamentos do serviço</b><span class="muted">Todos os gastos aqui também aparecem em Lançamentos</span></div>${tabela}</section>`;
  };

  B.anexos = (sv) => {
    const f = sv.faturamento;
    const itens = [];
    if (f && (f.nfseNumero || f.nfseArquivo)) itens.push(['receipt', `${f.nfseNumero || 'NFS-e'}${f.valor != null ? ` · ${CC.money(f.valor)}` : ''}`, `Emitida em ${D.data(String(f.faturadoEm || '').slice(0, 10))}${f.nfseArquivo || f.nfseNumero ? ' · NF vinculada do serviço' : ''}`]);
    (sv.gastos || []).filter((g) => Number(g.anexos) > 0).forEach((g) => itens.push(['image', `Recibo · ${g.descricao}`, `${D.data(g.data)} · ${qtd(Number(g.anexos), 'anexo', 'anexos')}`]));
    const lista = itens.length ? `<div class="lista-anexos">${itens.map(([ic, t, s]) => `<div>${D.ic(ic, 19)}<span class="duas-l"><b>${esc(t)}</b><span>${esc(s)}</span></span></div>`).join('')}</div>`
      : '<span class="muted">Sem notas nem anexos. A NFS-e entra aqui quando o serviço for faturado.</span>';
    return `<section class="card bloco-sv"><div class="bcab-sv"><b>Notas fiscais e anexos</b><button type="button" class="btn btn-s" data-relatorio>${D.ic('file-text')}Relatório</button></div>${lista}</section>`;
  };

  B.feito = (sv) => {
    const itens = sv.checklist || [];
    const feitos = itens.filter((i) => i.feito).length;
    const pode = D.tem('p2') && sv.situacao !== 'faturado';
    return `<section class="card bloco-sv"><div class="bcab-sv"><b>O que foi feito</b></div>
      <span class="${sv.descricao ? 'texto-sv' : 'muted'}">${esc(sv.descricao || 'Ainda sem descrição. Quem estiver em campo conta o que foi feito no celular.')}</span>
      <div class="bcab-sv"><span class="lbl">Checklist</span><span class="muted">${itens.length ? `${feitos} de ${itens.length}` : 'Sem itens'}</span></div>
      <div class="checklist">${itens.map((i) => `<button type="button" class="ck" role="checkbox" aria-checked="${i.feito ? 'true' : 'false'}" data-ck="${esc(i.id)}"${pode ? '' : ' disabled'}>
        <span class="caixa">${i.feito ? D.ic('check', 13) : ''}</span>${esc(i.texto)}</button>`).join('')}</div>
      ${pode ? '<form class="ck-novo" data-ck-novo><input class="inp" name="ck" maxlength="200" placeholder="Novo item do checklist" aria-label="Novo item do checklist"><button type="submit" class="btn btn-s">Incluir</button></form>' : ''}</section>`;
  };

  B.fotos = (sv) => {
    const fotos = sv.fotos || [];
    const antes = fotos.filter((f) => f.fase === 'antes');
    const depois = fotos.filter((f) => f.fase !== 'antes');
    const pode = D.tem('p2') && sv.situacao !== 'faturado';
    const grade = fotos.length ? `<div class="fotos-sv">${antes.concat(depois).map((f) => `<figure class="foto-sv" data-foto="${esc(f.id)}" data-url="${esc(f.url)}">
        <span class="fase">${f.fase === 'antes' ? 'Antes' : 'Depois'}</span><span class="hora">${esc(new Date(f.criadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))}</span></figure>`).join('')}</div>`
      : '<span class="muted">Ainda sem fotos. O técnico tira antes e depois pelo celular.</span>';
    return `<section class="card bloco-sv"><div class="bcab-sv"><b>Fotos</b><span class="muted">${antes.length} antes · ${depois.length} depois</span></div>${grade}
      ${pode ? `<div class="bts-foto"><label class="btn btn-s">${D.ic('camera')}Foto de antes<input type="file" accept="image/jpeg,image/png,image/webp" data-add-foto="antes" hidden></label>
        <label class="btn btn-s">${D.ic('camera')}Foto de depois<input type="file" accept="image/jpeg,image/png,image/webp" data-add-foto="depois" hidden></label></div>` : ''}</section>`;
  };

  B.aceite = (sv) => {
    const a = sv.aceite;
    const corpo = a ? `<div class="assinatura" data-assinatura="${esc(a.assinaturaUrl)}"></div>
      <span class="duas-l"><b>${esc([a.nome, a.cargo].filter(Boolean).join(' · '))}</b><span>Assinou em ${esc(dataHora(a.dataHora))}${a.registradoPor ? ` · registrado por ${esc(a.registradoPor)}` : ''}</span></span>`
      : '<span class="muted">O cliente assina com o dedo no celular do técnico quando o serviço termina. O aceite sai no relatório.</span>';
    return `<section class="card bloco-sv"><div class="bcab-sv"><b>Aceite do cliente</b></div>${corpo}</section>`;
  };

  B.cobranca = (sv) => {
    if (!S.veValores(sv)) {
      return `<div class="nota-tec">${D.ic('eye-slash', 17)}<span>Seu perfil (${esc(D.papelNome())}) lança despesas, fotos e o aceite. Valor cobrado, resultado e margem ficam com o escritório.</span></div>`;
    }
    const f = sv.faturamento;
    const FORMAS = { pix: 'Pix', boleto: 'Boleto', transferencia: 'Transferência' };
    let t; let s;
    if (f) { t = 'Faturado'; s = [f.nfseNumero || 'Sem nota', `vence ${D.data(f.vencimento)}`, FORMAS[f.forma] || f.forma].join(' · '); }
    else if (sv.situacao === 'concluido') { t = 'Pronto para faturar'; s = `${CC.money(sv.valor)} para ${sv.cliente}`; }
    else { t = 'Fatura depois de concluir'; s = `Conclua o serviço para gerar a cobrança de ${CC.money(sv.valor)}`; }
    const aviso = f && f.cobrancaSincronizada === false ? U.faixa('warn', 'warning', 'A cobrança não foi atualizada na nuvem. Confira e atualize em Cobranças.') : '';
    return `<section class="card bloco-sv"><div class="bcab-sv"><b>Cobrança</b></div><span class="duas-l"><b>${esc(t)}</b><span>${esc(s)}</span></span>${aviso}
      ${sv.situacao === 'concluido' && D.tem('p6') ? `<button type="button" class="btn btn-p" data-faturar>${D.ic('receipt')}Faturar · gerar cobrança</button>` : ''}</section>`;
  };

  // Esqueleto do carregando (28Dz).
  B.esqueleto = () => `<div class="carregando" role="status"><span class="spin" aria-hidden="true"></span>Abrindo o serviço…</div>
    <div class="grade-sv esq"><div class="principal"><div class="kpis-sv">${'<span class="sk" style="height:86px"></span>'.repeat(4)}</div>
      <span class="sk" style="height:150px"></span><span class="sk" style="height:220px"></span></div>
      <div class="lado"><span class="sk" style="height:230px"></span><span class="sk" style="height:160px"></span></div></div>`;
})(window.CC);
