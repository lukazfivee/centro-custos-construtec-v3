// Aba Notas fiscais da obra (print 35): Fornecedor e Cliente final, com lancar, marcar paga,
// baixar o PDF e excluir. O servidor nao tem campo de numero: o numero vai na observacao.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const O = D.obras = D.obras || {};
  const U = D.ui;
  O.abas = O.abas || {};
  const BLOCOS = [['fornecedor', 'Fornecedor', 'Notas recebidas de fornecedores'], ['cliente', 'Cliente final', 'Notas emitidas para o cliente']];
  const statusTexto = (tipo, st) => (st === 'paga' ? (tipo === 'cliente' ? 'Recebida' : 'Paga') : (tipo === 'cliente' ? 'A receber' : 'A pagar'));

  const lerBase64 = (arquivo) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || '').split(',').pop() || '');
    r.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    r.readAsDataURL(arquivo);
  });

  function bloco(tipo, titulo, sub, nfs) {
    const gerir = D.pode('cadastrar');
    const linhas = nfs.map((n) => ({ id: n.id, celulas: [
      esc(D.data(n.dataEmissao)), `<b>${esc(n.observacao || n.nomeArquivo || '—')}</b>`, esc(CC.money(n.valor)),
      gerir ? `<button type="button" class="chip-bt" data-alternar="${esc(n.id)}" title="Alternar situação">${U.chip(statusTexto(tipo, n.status), n.status === 'paga' ? 'ok' : 'warn')}</button>` : U.chip(statusTexto(tipo, n.status), n.status === 'paga' ? 'ok' : 'warn'),
      `<span class="acoes">${n.temArquivo ? `<button type="button" class="ibtn" data-baixar="${esc(n.id)}" aria-label="Baixar PDF">${D.ic('download-simple', 18)}</button>` : ''}
        ${gerir ? `<button type="button" class="ibtn" data-apagar="${esc(n.id)}" aria-label="Excluir nota">${D.ic('trash', 18)}</button>` : ''}</span>`,
    ] }));
    return `<section class="card tabela" data-bloco="${tipo}"><div class="bcab pad"><span class="duas-l"><b>${esc(titulo)}</b><span>${esc(sub)}</span></span>
      ${gerir ? `<button type="button" class="btn btn-s" data-lancar-nf="${tipo}">${D.ic('plus')}Lançar NF</button>` : ''}</div>
      ${U.tabela({ colunas: [{ rotulo: 'Emissão' }, { rotulo: 'Número' }, { rotulo: 'Valor', num: true }, { rotulo: 'Status' }, { rotulo: '', num: true }], linhas, vazio: 'Nenhuma nota lançada.' })}</section>`;
  }

  async function lancar(obra, tipo, aoSalvar) {
    let enviando = false;
    const ctl = await D.painel.abrir({
      icone: 'receipt', titulo: 'Lançar NF', sub: `${tipo === 'cliente' ? 'Cliente final' : 'Fornecedor'} · ${obra.nome}`,
      corpo: `<form class="form-lanc" novalidate>
        ${U.campo({ rotulo: 'Número / observação', name: 'observacao', placeholder: 'Ex.: NF 18.442' })}
        <div class="duas">${U.campo({ rotulo: 'Emissão', name: 'dataEmissao', tipo: 'date', valor: CC.today() })}${U.campo({ rotulo: 'Valor (R$)', name: 'valor', placeholder: '0,00' })}</div>
        <label class="check"><input type="checkbox" name="paga"> ${tipo === 'cliente' ? 'Já recebida' : 'Já paga'}</label>
        <label class="fld"><span>PDF da nota (opcional, até 5 MB)</span><input class="inp" type="file" name="arquivo" accept="application/pdf,.pdf"></label></form>`,
      rodape: `<button type="button" class="btn btn-s" data-fechar>Cancelar</button><button type="button" class="btn btn-p" data-salvar>${D.ic('check')}Lançar NF</button>`,
    });
    if (!ctl) return;
    CC.$('[data-salvar]', ctl.rodape).addEventListener('click', async () => {
      if (enviando) return;
      const c = ctl.corpo;
      const valor = CC.parseMoney(CC.$('[name="valor"]', c).value);
      const data = CC.$('[name="dataEmissao"]', c).value;
      const erros = {};
      if (!(valor > 0)) erros.valor = 'Informe um valor maior que zero.';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) erros.dataEmissao = 'Informe a emissão.';
      ctl.errosCampos(erros);
      if (Object.keys(erros).length) { ctl.erro(Object.values(erros)[0]); return; }
      ctl.erro('');
      enviando = true;
      try {
        const arquivo = CC.$('[name="arquivo"]', c).files[0];
        const body = { tipo, status: CC.$('[name="paga"]', c).checked ? 'paga' : 'nao_paga', dataEmissao: data, valor, observacao: CC.$('[name="observacao"]', c).value.trim() };
        if (arquivo) Object.assign(body, { nome: arquivo.name, conteudoBase64: await lerBase64(arquivo) });
        await CC.api(`/centros-custo/${obra.id}/notas-fiscais`, { method: 'POST', body });
        ctl.marcarSalvo();
        ctl.fechar(true);
        CC.toast('Nota fiscal lançada');
        aoSalvar();
      } catch (error) {
        ctl.erro(error.status === 0 ? 'Sem internet. Lançar NF precisa da conexão.' : error.message);
      } finally {
        enviando = false;
      }
    });
  }

  O.abas.nf = async function (corpo, obra, vivo) {
    corpo.innerHTML = U.carregando('Carregando as notas fiscais…');
    const ler = (tipo) => CC.api(`/centros-custo/${obra.id}/notas-fiscais?tipo=${tipo}`).then((r) => (Array.isArray(r.data) ? r.data : (r.data.itens || [])));
    const [forn, cli] = await Promise.all([ler('fornecedor'), ler('cliente')]);
    if (!vivo()) return;
    const todas = [...forn, ...cli];
    const recarregar = () => O.abas.nf(corpo, obra, vivo);
    corpo.innerHTML = `<div class="grade-nf">${bloco(...BLOCOS[0], forn)}${bloco(...BLOCOS[1], cli)}</div>`;
    CC.$$('[data-lancar-nf]', corpo).forEach((b) => b.addEventListener('click', () => lancar(obra, b.dataset.lancarNf, recarregar)));
    CC.$$('[data-baixar]', corpo).forEach((b) => b.addEventListener('click', () => {
      const n = todas.find((x) => String(x.id) === b.dataset.baixar);
      O.baixar(`/centros-custo/notas-fiscais/${n.id}/arquivo`, n.nomeArquivo || `nota-fiscal-${n.id}.pdf`);
    }));
    CC.$$('[data-alternar]', corpo).forEach((b) => b.addEventListener('click', async () => {
      const n = todas.find((x) => String(x.id) === b.dataset.alternar);
      try {
        await CC.api(`/centros-custo/notas-fiscais/${n.id}`, { method: 'PUT', body: { status: n.status === 'paga' ? 'nao_paga' : 'paga', dataEmissao: n.dataEmissao, valor: Number(n.valor), observacao: n.observacao || '' } });
        recarregar();
      } catch (error) { CC.toast(error.message, 'warning'); }
    }));
    CC.$$('[data-apagar]', corpo).forEach((b) => b.addEventListener('click', async () => {
      const n = todas.find((x) => String(x.id) === b.dataset.apagar);
      const sim = await D.confirmar({ titulo: 'Excluir esta nota fiscal?', texto: 'A nota sai da obra. A exclusão fica no histórico.', ok: 'Excluir', tom: 'perigo' });
      if (!sim) return;
      try { await CC.api(`/centros-custo/notas-fiscais/${n.id}`, { method: 'DELETE' }); CC.toast('Nota fiscal excluída'); recarregar(); } catch (error) { CC.toast(error.message, 'warning'); }
    }));
  };
})(window.CC);
