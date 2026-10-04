// Configuracoes, aba "Backup e restauracao" (prints 93 e 94): KPIs, tabela das copias, fazer agora e restaurar.
(function (CC) {
  const D = CC.d;
  const U = D.ui;
  const { esc } = CC;
  const C = D.cfg = D.cfg || {};
  const TIPOS = {
    automatica: ['Automática', 'neutro', 'clock'],
    manual: ['Manual', 'info', 'hand-pointing'],
    antes_restaurar: ['Antes de restaurar', 'warn', 'arrow-counter-clockwise'],
  };
  const FUSO = 'America/Sao_Paulo';

  C.bytes = (n) => {
    const v = Number(n) || 0;
    const f = (x) => x.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    if (v >= 1024 ** 3) return `${f(v / 1024 ** 3)} GB`;
    if (v >= 1024 ** 2) return `${f(v / 1024 ** 2)} MB`;
    return `${f(v / 1024)} KB`;
  };
  const partes = (iso) => {
    const fmt = (opcoes) => new Date(iso).toLocaleString('pt-BR', { timeZone: FUSO, ...opcoes });
    return { dia: fmt({ day: '2-digit', month: '2-digit', year: 'numeric' }), hora: fmt({ hour: '2-digit', minute: '2-digit', hour12: false }) };
  };

  // Dialogo que so libera o botao depois de digitar RESTAURAR (print 94).
  function confirmarRestaurar(copia) {
    const anterior = document.activeElement;
    return new Promise((resolve) => {
      const camada = D.el(`<div class="dialogo-camada"><div class="card dialogo perigo" role="alertdialog" aria-modal="true" aria-labelledby="rst-t" aria-describedby="rst-x">
        <span class="dic">${D.ic('arrow-counter-clockwise')}</span><b id="rst-t">Restaurar esta cópia?</b>
        <span class="txt" id="rst-x">Os dados atuais serão substituídos pelos de ${esc(partes(copia.modificadoEm).dia)} às ${esc(partes(copia.modificadoEm).hora)}. Antes disso, o sistema guarda uma cópia do estado de agora. Depois de confirmar, é preciso reiniciar o sistema.</span>
        <label class="fld cfg-digite"><span>Digite RESTAURAR para confirmar</span><input class="inp" data-digitado autocomplete="off" spellcheck="false"></label>
        <div class="bts"><button type="button" class="btn btn-s" data-r="0">Cancelar</button><button type="button" class="btn btn-d" data-r="1" disabled>Restaurar</button></div></div></div>`);
      const entrada = CC.$('[data-digitado]', camada);
      const ok = CC.$('[data-r="1"]', camada);
      const fechar = (valor) => {
        document.removeEventListener('keydown', teclas, true);
        camada.remove();
        if (anterior && anterior.focus) anterior.focus();
        resolve(valor);
      };
      const teclas = (event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); fechar(false); return; }
        D.prenderFoco(camada, event);
      };
      entrada.addEventListener('input', () => { ok.disabled = entrada.value.trim() !== 'RESTAURAR'; });
      camada.addEventListener('click', (event) => {
        const bt = event.target.closest('[data-r]');
        if (bt && !bt.disabled) fechar(bt.dataset.r === '1');
        else if (event.target === camada) fechar(false);
      });
      document.addEventListener('keydown', teclas, true);
      document.body.appendChild(camada);
      entrada.focus();
    });
  }

  async function baixar(copia) {
    const r = await fetch(`/api/backup/copias/${encodeURIComponent(copia.nome)}`, { headers: { Authorization: `Bearer ${CC.session.token()}` } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || 'Não foi possível baixar a cópia.');
    const url = URL.createObjectURL(await r.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: copia.nome });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function linha(c) {
    const [rotulo, tom, icone] = TIPOS[c.tipo] || TIPOS.manual;
    const t = partes(c.modificadoEm);
    return { id: c.nome, celulas: [
      `<b>${esc(t.dia)} ${esc(t.hora)}</b><span class="cfg-nome-arq">${esc(c.nome)}</span>`,
      U.chip(rotulo, tom, icone), esc(C.bytes(c.bytes)),
      c.sha256 ? `<span class="cfg-nota" title="SHA-256 ${esc(c.sha256)}">SHA-256 ${esc(c.sha256.slice(0, 10))}</span>` : '<span class="cfg-nota">Sem checksum</span>',
      `<div class="cfg-acoes"><button type="button" class="cfg-link" data-baixar="${esc(c.nome)}">${D.ic('download-simple')}Baixar</button>
        <button type="button" class="cfg-link perigo" data-restaurar="${esc(c.nome)}">${D.ic('arrow-counter-clockwise')}Restaurar</button></div>`,
    ] };
  }

  C.backup = async function (corpo, vivo) {
    corpo.innerHTML = U.carregando('Carregando as cópias…');
    const [{ data }, { data: estado }] = await Promise.all([CC.api('/backup/copias'), CC.api('/backup/status')]);
    if (!vivo()) return;
    if (data.modo !== 'local') {
      corpo.innerHTML = U.faixa('info', 'database', 'No modo PostgreSQL central, o backup é feito no servidor com pg_dump. Esta tela só guarda cópias do modo local.');
      return;
    }
    const recarregar = () => C.backup(corpo, vivo);
    const { resumo, copias } = data;
    const ultima = resumo.ultima ? partes(resumo.ultima.modificadoEm) : null;
    const auto = resumo.automatico;
    const pendente = estado.pendingRestore;
    corpo.innerHTML = `${pendente ? `<div data-pendente>${U.faixa('warn', 'warning', `Restauração agendada${pendente.filename ? ` de ${pendente.filename}` : ''}. Reinicie o sistema para aplicar.`,
      `<button type="button" class="btn btn-s" data-reiniciar>${D.ic('power')}Reiniciar agora</button>`)}</div><br>` : ''}
      <div class="cfg-kpis">
        ${U.kpi({ rotulo: 'Última cópia', valor: ultima ? ultima.dia : 'Nenhuma', det: ultima ? `${TIPOS[resumo.ultima.tipo]?.[0] || 'Manual'} às ${ultima.hora}` : 'Faça o primeiro backup', icone: 'database', tom: 'ok' })}
        ${U.kpi({ rotulo: 'Cópias guardadas', valor: String(resumo.total), det: auto.ativo ? `automáticas a cada ${auto.intervaloHoras} h, guarda ${auto.retencao}` : 'backup automático desligado', icone: 'stack', tom: 'info' })}
        ${U.kpi({ rotulo: 'Espaço dos backups', valor: C.bytes(resumo.bytes), det: 'nesta pasta do computador', icone: 'hard-drives', tom: 'info' })}
      </div>
      <section class="card cad-tabela" aria-labelledby="cfg-copias-t"><div class="cfg-lista-topo"><div><h2 id="cfg-copias-t">Cópias de segurança</h2>
        <span class="cfg-nota">As automáticas seguem a regra acima. A manual fica guardada até alguém excluir a pasta.</span></div>
        <button type="button" class="btn btn-p" data-agora>${D.ic('database')}Fazer backup agora</button></div>
        <div data-tabela></div></section>`;
    CC.$('[data-tabela]', corpo).innerHTML = U.tabela({
      colunas: [{ rotulo: 'Cópia' }, { rotulo: 'Tipo' }, { rotulo: 'Tamanho', num: true }, { rotulo: 'Verificação' }, { rotulo: 'Ações', num: true }],
      linhas: copias.map(linha), vazio: 'Nenhuma cópia guardada ainda.',
    });
    const reiniciar = CC.$('[data-reiniciar]', corpo);
    if (reiniciar) reiniciar.addEventListener('click', async () => {
      if (!await D.confirmar({ titulo: 'Reiniciar o sistema?', texto: 'O servidor será encerrado com segurança. Abra o Centro de Custos de novo em alguns segundos.', ok: 'Reiniciar', tom: 'aviso', icone: 'power' })) return;
      try { await CC.api('/backup/reiniciar', { method: 'POST', body: {} }); CC.toast('Reiniciando. Abra o sistema de novo em instantes.'); } catch (error) { CC.toast(error.message); }
    });
    CC.$('[data-agora]', corpo).addEventListener('click', async (event) => {
      const solto = U.ocupar(event.currentTarget, 'Fazendo backup…');
      try { await CC.api('/backup/copias', { method: 'POST', body: {} }); CC.toast('Backup guardado'); await recarregar(); } catch (error) { solto(); CC.toast(error.message); }
    });
    CC.$$('[data-baixar]', corpo).forEach((b) => b.addEventListener('click', async () => {
      try { await baixar(copias.find((c) => c.nome === b.dataset.baixar)); } catch (error) { CC.toast(error.message); }
    }));
    CC.$$('[data-restaurar]', corpo).forEach((b) => b.addEventListener('click', async () => {
      const copia = copias.find((c) => c.nome === b.dataset.restaurar);
      if (!await confirmarRestaurar(copia)) return;
      try {
        await CC.api('/backup/restaurar', { method: 'POST', body: { confirmacao: 'RESTAURAR', copia: copia.nome } });
        CC.toast('Restauração agendada. Reinicie o sistema para aplicar.');
        await recarregar();
      } catch (error) { CC.toast(error.message); }
    }));
  };
})(window.CC);
