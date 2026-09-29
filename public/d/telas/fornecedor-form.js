// Novo e editar fornecedor no painel lateral (prints 54 e 55): dados, categoria mais comum e
// lancamentos do mes. O servidor confere o CPF/CNPJ e recusa documento repetido com o nome de quem ja tem.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const C = D.cad;
  const U = D.ui;

  function campos(f, categorias) {
    const opcoes = [{ valor: '', rotulo: 'Nenhuma' }, ...categorias.map((c) => ({ valor: c.id, rotulo: c.nome }))];
    return `<form class="form-lanc" novalidate>
      ${U.campo({ rotulo: 'Nome ou razão social', name: 'nome', valor: f.nome, placeholder: 'Ex.: Seg Distribuidora' })}
      <div class="duas">${U.campo({ rotulo: 'CPF ou CNPJ', name: 'documento', valor: f.documento, placeholder: '00.000.000/0000-00' })}
        ${U.campo({ rotulo: 'Categoria mais comum', name: 'categoria_id', tipo: 'select', valor: f.categoria_id || '', opcoes })}</div>
      <div class="duas">${U.campo({ rotulo: 'Contato', name: 'contato', valor: f.contato })}${U.campo({ rotulo: 'Telefone', name: 'telefone', valor: f.telefone, placeholder: '(11) 90000-0000' })}</div>
      ${U.campo({ rotulo: 'E-mail', name: 'email', tipo: 'email', valor: f.email })}
      <div class="dica">${D.ic('magic-wand')}<span>Guardada no cadastro. A sugestão de categoria nos lançamentos entra numa próxima etapa.</span></div>
      ${f.id ? `<label class="check"><input type="checkbox" name="ativo"${f.ativo !== false ? ' checked' : ''}> Fornecedor ativo</label>` : ''}
      ${f.id ? '<div class="mes-lista" data-mes></div>' : ''}
    </form>`;
  }

  async function lancamentosDoMes(ctl, f, mes) {
    const alvo = CC.$('[data-mes]', ctl.corpo);
    if (!alvo) return;
    try {
      const { data } = await CC.api(`/fornecedores/${f.id}/resumo?mes=${mes}`);
      if (!CC.$('[data-mes]', ctl.corpo)) return;
      alvo.innerHTML = `<div class="topo"><span class="lbl">Lançamentos em ${esc(C.nomeMes(mes))}</span><b>${esc(CC.money(data.gasto_mes))}</b></div>`
        + (data.lancamentos.length ? data.lancamentos.map((l) => {
          const v = D.valorSinal({ tipo: l.tipo, valor: l.valor, sinal_contabil: l.sinal });
          return `<div class="mes-item"><div class="dois-tx"><b>${esc(l.descricao)}</b><span>${esc(l.obra_codigo)} · ${esc(D.data(l.data))}</span></div>
            ${U.situacao({ tipo: l.tipo, status_financeiro: l.status })}<span class="valor">${esc(v.texto)}</span></div>`;
        }).join('') : '<span class="muted">Nenhum lançamento neste mês.</span>');
    } catch { alvo.innerHTML = ''; }
  }

  function validar(d) {
    const erros = {};
    if (!d.nome) erros.nome = 'Informe o nome do fornecedor.';
    const n = d.documento.replace(/\D/g, '');
    if (d.documento && n.length !== 11 && n.length !== 14) erros.documento = 'CPF precisa de 11 dígitos e CNPJ de 14.';
    if (d.email && !/^\S+@\S+\.\S+$/.test(d.email)) erros.email = 'E-mail inválido.';
    return erros;
  }

  // f: linha da lista (null para novo). aoSalvar: recarrega a lista.
  C.fornecedorForm = async function (f, aoSalvar) {
    const forn = f || {};
    const mes = CC.month();
    let enviando = false;
    const categorias = await CC.api('/categorias').then((r) => (Array.isArray(r.data) ? r.data : []).filter((c) => c.ativo !== false && c.tipo !== 'receita')).catch(() => []);
    const ctl = await D.painel.abrir({
      icone: 'truck', titulo: f ? f.nome : 'Novo fornecedor', sub: f ? [f.documento, f.contato].filter(Boolean).join(' · ') : 'Quem recebe os pagamentos',
      corpo: campos(forn, categorias),
      rodape: `<button type="button" class="btn btn-s" data-fechar>Cancelar</button><button type="button" class="btn btn-p" data-salvar>${D.ic('check')}${f ? 'Salvar alterações' : 'Cadastrar'}</button>`,
    });
    if (!ctl) return;
    if (f) lancamentosDoMes(ctl, f, mes);
    const salvar = async () => {
      if (enviando) return;
      const v = (n) => (CC.$(`[name="${n}"]`, ctl.corpo) || {}).value || '';
      const ativo = CC.$('[name="ativo"]', ctl.corpo);
      const d = { nome: v('nome').trim(), documento: v('documento').trim(), contato: v('contato').trim(), telefone: v('telefone').trim(), email: v('email').trim() };
      const erros = validar(d);
      ctl.errosCampos(erros);
      if (Object.keys(erros).length) { ctl.erro(Object.values(erros)[0]); return; }
      ctl.erro('');
      enviando = true;
      const body = { ...d, categoria_id: v('categoria_id') || null, ativo: ativo ? ativo.checked : true };
      try {
        if (f) await CC.api(`/fornecedores/${f.id}`, { method: 'PUT', body });
        else await CC.api('/fornecedores', { method: 'POST', body });
        ctl.marcarSalvo();
        ctl.fechar(true);
        CC.toast(f ? 'Fornecedor atualizado' : 'Fornecedor cadastrado');
        if (aoSalvar) aoSalvar();
      } catch (error) {
        C.mostrarErro(ctl, error, (texto) => (/CPF|CNPJ|documento/i.test(texto) ? 'documento' : (/e-mail/i.test(texto) ? 'email' : (/nome/i.test(texto) ? 'nome' : ''))));
      } finally {
        enviando = false;
      }
    };
    CC.$('[data-salvar]', ctl.rodape).addEventListener('click', salvar);
    CC.$('form', ctl.corpo).addEventListener('submit', (e) => { e.preventDefault(); salvar(); });
  };
})(window.CC);
