(() => {
  const view = document.querySelector('#view-sincronizacao');
  if (!view || document.querySelector('#smart-sync-panel')) return;

  const panel = document.createElement('article');
  panel.id = 'smart-sync-panel';
  panel.className = 'panel';
  panel.style.marginBottom = '18px';
  panel.innerHTML = `
    <div class="panel-head">
      <div><p class="eyebrow">P3 · sincronização inteligente</p><h2>Pacote completo e protegido</h2></div>
      <span class="pill ativo">Recomendado</span>
    </div>
    <p class="muted">Transfere obras, categorias, fornecedores, lançamentos e estornos em um único arquivo. O pacote possui verificação SHA-256 e não é importado duas vezes.</p>
    <div class="sync-grid" style="margin-top:14px">
      <div class="sync-card">
        <h3>1. Exportar pacote</h3>
        <p>Gera um arquivo <strong>.ccsync</strong> com os dados desta instalação.</p>
        <button id="smart-sync-export" class="btn primary wide">Exportar pacote inteligente</button>
      </div>
      <div class="sync-card">
        <h3>2. Importar pacote</h3>
        <p>Selecione o arquivo recebido da outra instalação.</p>
        <input id="smart-sync-file" type="file" accept=".ccsync,application/json" style="margin-bottom:10px">
        <button id="smart-sync-import" class="btn secondary wide" disabled>Validar e importar</button>
      </div>
    </div>
    <div id="smart-sync-result" class="muted" style="margin-top:12px"></div>
    <div style="margin-top:16px"><button id="smart-sync-refresh" class="text-btn">Atualizar histórico e conflitos</button></div>
    <div id="smart-sync-history" style="margin-top:12px"></div>
    <div id="smart-sync-conflicts" style="margin-top:12px"></div>
  `;
  const intro = view.querySelector('.sync-intro');
  view.insertBefore(panel, intro || view.firstChild);

  let selected = null;
  const file = panel.querySelector('#smart-sync-file');
  const importBtn = panel.querySelector('#smart-sync-import');
  file.addEventListener('change', () => { selected = file.files[0] || null; importBtn.disabled = !selected; });
  panel.querySelector('#smart-sync-export').addEventListener('click', () => download('/sincronizacao-inteligente/exportar', 'sincronizacao-inteligente.ccsync'));

  importBtn.addEventListener('click', async () => {
    if (!selected) return;
    importBtn.disabled = true;
    importBtn.textContent = 'Importando…';
    try {
      const result = await api('/sincronizacao-inteligente/importar', { method:'POST', body:JSON.stringify({ nomeArquivo:selected.name, conteudo:await selected.text() }) });
      const r = result.resumo || {};
      panel.querySelector('#smart-sync-result').innerHTML = result.duplicado
        ? '<strong>Este pacote já havia sido importado. Nenhuma duplicidade foi criada.</strong>'
        : `<strong>Importação concluída.</strong> ${r.incluidos||0} incluído(s), ${r.atualizados||0} atualizado(s), ${r.ignorados||0} ignorado(s), ${r.conflitos||0} conflito(s).`;
      toast('Pacote inteligente processado.');
      await Promise.all([loadReferences(), loadDashboard(), loadTransactions(), refreshSmartSync()]);
    } catch (error) {
      panel.querySelector('#smart-sync-result').textContent = error.message;
      toast(error.message, true);
    } finally {
      importBtn.disabled = false;
      importBtn.textContent = 'Validar e importar';
    }
  });

  panel.querySelector('#smart-sync-refresh').addEventListener('click', refreshSmartSync);

  async function refreshSmartSync() {
    try {
      const [history, conflicts] = await Promise.all([
        api('/sincronizacao-inteligente/historico'),
        api('/sincronizacao-inteligente/conflitos'),
      ]);
      panel.querySelector('#smart-sync-history').innerHTML = history.length
        ? `<h3>Últimos pacotes</h3><div class="table-scroll"><table><thead><tr><th>Quando</th><th>Arquivo</th><th>Origem</th><th>Incluídos</th><th>Atualizados</th><th>Conflitos</th></tr></thead><tbody>${history.map(h=>`<tr><td>${dateTimeBr(h.created_at)}</td><td>${esc(h.filename)}</td><td>${esc(h.source_instance_name||'—')}</td><td>${h.summary?.incluidos||0}</td><td>${h.summary?.atualizados||0}</td><td>${h.summary?.conflitos||0}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted">Nenhum pacote inteligente importado ainda.</p>';
      const pending = conflicts.filter(c=>c.status==='pending');
      panel.querySelector('#smart-sync-conflicts').innerHTML = pending.length
        ? `<h3>Conflitos pendentes</h3>${pending.map(c=>`<div class="conflict-card"><div class="conflict-header"><strong>${esc(c.entity_type)} · ${esc(c.entity_public_id)}</strong><span class="pill vencido">Pendente</span></div><p>${esc(c.reason)}</p><button class="btn secondary" data-smart-local="${c.id}">Manter versão local</button></div>`).join('')}`
        : '<p class="muted">Nenhum conflito pendente na sincronização inteligente.</p>';
      panel.querySelectorAll('[data-smart-local]').forEach(btn=>btn.addEventListener('click',async()=>{
        try {
          await api(`/sincronizacao-inteligente/conflitos/${btn.dataset.smartLocal}/resolver`, {method:'POST',body:JSON.stringify({escolha:'local'})});
          toast('Conflito resolvido mantendo a versão local.');
          refreshSmartSync();
        } catch(error) { toast(error.message,true); }
      }));
    } catch (error) {
      panel.querySelector('#smart-sync-result').textContent = error.message;
    }
  }

  refreshSmartSync();
})();
