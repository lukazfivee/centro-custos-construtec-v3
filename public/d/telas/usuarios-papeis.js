// D6: aba "Papeis e permissoes" (matriz de 12 permissoes por 6 papeis).
(function (CC) {
  const D = CC.d;
  const U = D.usu;
  const { esc } = CC;

  function celula(papel, id, dados, somenteLeitura) {
    const ligado = !!dados.matriz[papel.valor]?.[id];
    const fixo = papel.valor === 'admin';
    const rotulo = `${U.nomePermissao(id)} · ${papel.rotulo}`;
    if (fixo) return `<td class="usu-mx"><span class="usu-tk trava" title="O administrador fica sempre com tudo" aria-label="${esc(rotulo)}: sempre liberado">${D.ic('lock-simple')}</span></td>`;
    return `<td class="usu-mx"><button type="button" class="usu-tk${ligado ? ' on' : ''}" data-perm="${esc(id)}" data-papel="${esc(papel.valor)}" data-liga="${ligado ? '0' : '1'}" role="switch" aria-checked="${ligado}" aria-label="${esc(rotulo)}"${somenteLeitura ? ' disabled' : ''}>${ligado ? D.ic('check-bold') : '<span aria-hidden="true">—</span>'}</button></td>`;
  }

  function tabela(dados, contagem) {
    const cab = U.PAPEIS.map((p) => `<th scope="col" class="usu-mx"><b>${esc(p.rotulo)}</b><span>${contagem[p.valor] || 0} · ${esc(p.nota)}</span></th>`).join('');
    const corpo = U.GRUPOS.map(([grupo, itens]) => `<tr class="usu-grp"><th colspan="7" scope="colgroup">${esc(grupo)}</th></tr>${itens.map(([id, nome, nota]) =>
      `<tr><th scope="row"><b>${esc(nome)}</b><span>${esc(nota)}</span></th>${U.PAPEIS.map((p) => celula(p, id, dados, dados.somenteLeitura)).join('')}</tr>`).join('')}`).join('');
    return `<table class="tbl usu-matriz"><thead><tr><th scope="col">Permissão</th>${cab}</tr></thead><tbody>${corpo}</tbody></table>`;
  }

  // Quantas pessoas ativas em cada papel, para o cabecalho das colunas.
  function contar(usuarios) {
    const out = {};
    for (const u of usuarios) if (u.ativo !== false) out[u.suiteRole] = (out[u.suiteRole] || 0) + 1;
    return out;
  }

  D.usu.abaPapeis = async function (corpo, vivo, usuarios) {
    corpo.innerHTML = D.ui.carregando('Carregando as permissões…');
    let dados = await U.matriz(true);
    if (!vivo()) return;
    const pintar = () => {
      corpo.innerHTML = `<div class="card usu-papeis"><div class="usu-papeis-topo"><div><b>O que cada papel pode fazer</b>
        <span class="muted">${dados.somenteLeitura ? 'Sem conta corporativa, a matriz padrão é só para consulta.' : 'Clique para ligar ou desligar. Administrador tem tudo e não pode ser alterado. Vale para o celular e para o computador.'}</span></div>
        <button type="button" class="btn btn-s" data-restaurar${dados.somenteLeitura ? ' disabled' : ''}>${D.ic('arrow-counter-clockwise')}Restaurar padrão</button></div>
        <div class="usu-scroll">${tabela(dados, contar(usuarios))}</div></div>`;
      CC.$$('[data-perm]', corpo).forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          dados = await CC.api('/usuarios/permissoes', { method: 'POST', body: { papel: b.dataset.papel, permissao: b.dataset.perm, permitido: b.dataset.liga === '1' } }).then((r) => r.data);
          U.guardarMatriz(dados);
          pintar();
        } catch (error) { CC.toast(error.message); b.disabled = false; }
      }));
      CC.$('[data-restaurar]', corpo).addEventListener('click', async () => {
        const sim = await D.confirmar({ titulo: 'Restaurar as permissões padrão?', texto: 'Todas as alterações da matriz serão desfeitas para o celular e para o computador.', ok: 'Restaurar', icone: 'arrow-counter-clockwise', tom: 'aviso' });
        if (!sim) return;
        try { dados = (await CC.api('/usuarios/permissoes/restaurar', { method: 'POST', body: {} })).data; U.guardarMatriz(dados); pintar(); CC.toast('Padrão restaurado'); }
        catch (error) { CC.toast(error.message); }
      });
    };
    pintar();
  };
})(window.CC);
