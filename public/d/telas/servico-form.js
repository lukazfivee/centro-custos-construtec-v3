// Painel Novo / Editar (28Dg a 28Dj): Obra ou Servico primeiro. Servico pede cliente e valor (o resto e opcional)
// e sugere o codigo de /api/servicos/proximo-codigo. Obra usa os campos de obra e lembra de importar o orcamento.
// Editar um servico permite virar obra: os lancamentos continuam ligados ao centro.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const U = D.ui;
  const S = D.serv = D.serv || {};
  const valorBr = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const TIPOS = [
    { valor: 'obra', titulo: 'Obra', sub: 'Orçamento importado, medições e Curva S', icone: 'buildings' },
    { valor: 'servico', titulo: 'Serviço', sub: 'Curto, poucos gastos e um valor cobrado', icone: 'wrench' },
  ];

  function escolha(tipo) {
    return `<div class="fld"><span>Obra ou serviço</span><div class="tipo-cc" role="radiogroup" aria-label="Obra ou serviço">${TIPOS.map((t) => `
      <button type="button" class="tipo-op" role="radio" data-tipo-cc="${t.valor}" aria-checked="${t.valor === tipo ? 'true' : 'false'}">
        ${D.ic(t.icone, 22)}<span><b>${esc(t.titulo)}</b><span class="muted">${esc(t.sub)}</span></span></button>`).join('')}</div></div>`;
  }

  function camposServico(e) {
    return `<div class="duas">${U.campo({ rotulo: 'Cliente *', name: 'cliente', valor: e.cliente, placeholder: 'Ex.: Clínica Do\'r Canela' })}
        ${U.campo({ rotulo: 'Valor cobrado (R$) *', name: 'valor', valor: e.valor, placeholder: '0,00' })}</div>
      <div class="duas">${U.campo({ rotulo: 'Código', name: 'codigo', valor: e.codigo, placeholder: 'SV-1001', ajuda: e.id ? '' : 'Sugerido; pode trocar' })}
        ${U.campo({ rotulo: 'Data', name: 'data', tipo: 'date', valor: e.data })}</div>
      ${U.campo({ rotulo: 'Local', name: 'local', valor: e.local, placeholder: 'Endereço ou sala (opcional)' })}
      ${U.campo({ rotulo: 'Responsável (técnico)', name: 'responsavel', valor: e.responsavel, placeholder: 'Quem vai a campo (opcional)' })}
      ${U.campo({ rotulo: 'O que foi feito', name: 'descricao', tipo: 'textarea', valor: e.descricao, placeholder: 'Ex.: Instalar 2 câmeras na portaria (vira o nome do serviço)' })}
      <small class="muted">* Só cliente e valor são obrigatórios.</small>`;
  }

  function camposObra(e, mudando) {
    const aviso = mudando
      ? U.faixa('warn', 'warning', `${e.codigo || 'Este serviço'} vira obra: ganha planilha de orçamento, medições e Curva S. Checklist, fotos e aceite ficam guardados e voltam se ele virar serviço de novo. ${e.qtdGastos ? `Os ${e.qtdGastos} lançamentos continuam ligados a ele.` : 'Ele ainda não tem lançamentos.'}`)
      : U.faixa('info', 'file-arrow-up', 'Depois de criar, importe o orçamento aprovado do Orçamentos para ter orçado × realizado, medições e Curva S.');
    return `${aviso}
      ${U.campo({ rotulo: 'Nome da obra *', name: 'nome', valor: e.nome, placeholder: 'Ex.: Residencial Aurora' })}
      <div class="duas">${U.campo({ rotulo: 'Cliente *', name: 'cliente', valor: e.cliente })}${U.campo({ rotulo: 'Código *', name: 'codigo', valor: e.codigo, placeholder: 'Ex.: CC-031' })}</div>
      <div class="duas">${U.campo({ rotulo: 'Responsável', name: 'responsavel', valor: e.responsavel })}${U.campo({ rotulo: 'Valor contratado (R$)', name: 'valor', valor: e.valor, placeholder: '0,00' })}</div>
      <div class="duas">${U.campo({ rotulo: 'Início', name: 'data', tipo: 'date', valor: e.data })}${U.campo({ rotulo: 'Término previsto', name: 'data_fim', tipo: 'date', valor: e.data_fim })}</div>`;
  }

  function ler(corpo, e) {
    CC.$$('[name]', corpo).forEach((i) => { e[i.name] = i.value; });
  }

  function validar(e) {
    const erros = {};
    const v = String(e.valor || '').trim();
    const num = v === '' ? NaN : CC.parseMoney(v);
    if (!String(e.cliente || '').trim()) erros.cliente = 'Informe o cliente.';
    if (e.tipo === 'servico') {
      if (!(num >= 0)) erros.valor = 'Informe o valor cobrado.';
      if (e.codigo && !/^SV-/i.test(e.codigo.trim())) erros.codigo = 'O código do serviço começa com SV-.';
    } else {
      if (!String(e.nome || '').trim()) erros.nome = 'Informe o nome da obra.';
      if (!String(e.codigo || '').trim()) erros.codigo = 'Informe o código da obra.';
      if (v !== '' && !(num >= 0)) erros.valor = 'Valor inválido.';
    }
    return { erros, num: Number.isFinite(num) ? num : 0 };
  }

  const faltando = (erros) => {
    const nomes = { cliente: 'cliente', valor: 'valor cobrado', nome: 'nome da obra', codigo: 'código' };
    const f = Object.keys(erros).filter((k) => nomes[k]).map((k) => nomes[k]);
    return f.length ? `Preencha ${f.join(' e ')}.` : Object.values(erros)[0];
  };

  // Linha da lista /centros-custo (para o PUT completo de obra, com revisao).
  const linhaCentro = (id) => CC.api('/centros-custo').then((r) => (r.data || []).find((x) => String(x.id) === String(id)));

  // tipoPadrao: 'obra' ou 'servico'. sv: servico ja carregado (editar) ou nada (novo).
  S.novo = (tipoPadrao, aoSalvar) => abrir(null, tipoPadrao, aoSalvar);
  S.editar = (sv, aoSalvar) => abrir(sv, 'servico', aoSalvar);

  async function abrir(sv, tipoPadrao, aoSalvar) {
    const edita = !!sv;
    const e = edita
      ? { id: sv.id, tipo: 'servico', codigo: sv.codigo, cliente: sv.cliente, valor: valorBr(sv.valor), data: sv.data || '', local: sv.local || '', responsavel: sv.responsavel || '', descricao: sv.descricao || '', nome: sv.nome, qtdGastos: (sv.gastos || []).length, revisao: sv.revisao }
      : { tipo: tipoPadrao === 'servico' ? 'servico' : 'obra', codigo: '', cliente: '', valor: '', data: CC.today(), local: '', responsavel: '', descricao: '', nome: '' };
    if (edita && !S.veValores(sv)) e.valor = '';
    let enviando = false;
    let sugerido = '';
    const rotuloBotao = () => (edita ? (e.tipo === 'obra' ? 'Salvar como obra' : 'Salvar') : (e.tipo === 'obra' ? 'Criar obra' : 'Criar serviço'));
    const desenhar = (ctl) => {
      ctl.desenhar(`<form class="form-lanc form-servico" novalidate>${escolha(e.tipo)}${e.tipo === 'servico' ? camposServico(e) : camposObra(e, edita)}</form>`);
      CC.$$('[data-tipo-cc]', ctl.corpo).forEach((b) => b.addEventListener('click', () => {
        if (b.dataset.tipoCc === e.tipo) return;
        ler(ctl.corpo, e);
        e.tipo = b.dataset.tipoCc;
        if (e.tipo === 'obra' && !edita && /^SV-/.test(e.codigo || '')) e.codigo = '';
        if (e.tipo === 'servico' && !e.codigo) e.codigo = sugerido;
        if (e.tipo === 'obra' && !e.nome) e.nome = String(e.descricao || '').split(/[.\n]/)[0].slice(0, 70);
        ctl.sujo = true;
        desenhar(ctl);
        const bt = CC.$('[data-salvar]', ctl.rodape);
        if (bt) bt.innerHTML = `${D.ic('check')}${esc(rotuloBotao())}`;
      }));
      CC.$('form', ctl.corpo).addEventListener('submit', (ev) => { ev.preventDefault(); salvar(ctl); });
    };
    const ctl = await D.painel.abrir({
      icone: edita ? 'pencil-simple' : 'plus', titulo: edita ? `Editar ${sv.codigo}` : 'Novo centro de custo', sub: edita ? sv.nome : 'Obra ou serviço',
      corpo: (_, c) => desenhar(c),
      rodape: `<button type="button" class="btn btn-s" data-fechar>Cancelar</button><button type="button" class="btn btn-p" data-salvar>${D.ic('check')}${esc(rotuloBotao())}</button>`,
    });
    if (!ctl) return;
    if (!edita) {
      CC.api('/servicos/proximo-codigo').then(({ data }) => {
        sugerido = data.codigo;
        if (!e.codigo && e.tipo === 'servico') e.codigo = data.codigo;
        const inp = CC.$('[name="codigo"]', ctl.corpo);
        if (inp && !inp.value && e.tipo === 'servico') inp.value = data.codigo;
      }).catch(() => {});
    }

    async function salvar(c) {
      if (enviando) return;
      ler(c.corpo, e);
      const { erros, num } = validar(e);
      c.errosCampos(erros);
      if (Object.keys(erros).length) { c.erro(`${faltando(erros).replace(/\.$/, '')} para ${edita ? 'salvar' : 'criar'}.`); return; }
      c.erro('');
      enviando = true;
      const bt = CC.$('[data-salvar]', c.rodape);
      const voltar = U.ocupar(bt, edita ? 'Salvando…' : 'Criando…');
      try {
        let destino = null;
        if (e.tipo === 'servico') {
          const body = { cliente: e.cliente.trim(), codigo: (e.codigo || '').trim() || undefined, local: e.local.trim(), data: e.data || undefined, responsavel: e.responsavel.trim(), descricao: e.descricao.trim() };
          if (!edita || S.veValores(sv)) body.valor = num;
          if (edita) {
            const { data } = await CC.api(`/servicos/${sv.id}`, { method: 'PUT', body: { ...body, revisao: sv.revisao } });
            destino = `servicos/${data.id}`;
            CC.toast('Serviço salvo');
          } else {
            const { data } = await CC.api('/servicos', { method: 'POST', body });
            destino = `servicos/${data.id}`;
            CC.toast(data.codigo + ` criado · ${S.SITUACAO.agendado[0].toLowerCase()}${data.data ? ` para ${D.data(data.data)}` : ''}`);
          }
        } else {
          const base = {
            tipo: 'obra', codigo: (e.codigo || '').trim(), nome: e.nome.trim(), cliente: e.cliente.trim(), responsavel: e.responsavel.trim(),
            data_inicio: e.data || null, data_fim: e.data_fim || null, valor_contrato: num,
          };
          if (edita) {
            const row = await linhaCentro(sv.id);
            if (!row) throw new Error('Não foi possível ler o centro de custo. Recarregue e tente de novo.');
            await CC.api(`/centros-custo/${sv.id}`, { method: 'PUT', body: { situacao: row.situacao || 'planejamento', contrato: row.contrato || '', orcamento: Number(row.orcamento || 0), descricao: row.descricao || '', ativo: row.ativo !== false, ...base, revisao: Number(row.revision) } });
            destino = `obras/${sv.id}`;
            CC.toast(`${base.codigo || 'Serviço'} agora é obra · confira o orçamento`);
          } else {
            const { data } = await CC.api('/centros-custo', { method: 'POST', body: { ...base, situacao: 'planejamento', orcamento: 0, descricao: '' } });
            destino = data && data.id ? `obras/${data.id}` : null;
            CC.toast('Obra criada · importe o orçamento quando tiver');
          }
        }
        c.marcarSalvo();
        c.fechar(true);
        if (D.lanc && D.lanc.esquecerApoio) D.lanc.esquecerApoio();
        if (destino) D.ir(destino);
        else if (aoSalvar) aoSalvar();
      } catch (error) {
        const campos = {};
        if (/cliente/i.test(error.message)) campos.cliente = error.message;
        if (/valor/i.test(error.message)) campos.valor = error.message;
        if (/código/i.test(error.message)) campos.codigo = error.message;
        c.errosCampos(campos);
        c.erro(S.erro(error, 'Nada foi salvo; o que você digitou continua aqui.'));
        voltar();
      } finally {
        enviando = false;
      }
    }
    CC.$('[data-salvar]', ctl.rodape).addEventListener('click', () => salvar(ctl));
  }
})(window.CC);
