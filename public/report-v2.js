(() => {
  const deliveryLabel = {
    delivered: 'Entregue',
    accepted: 'Aceito pelo provedor',
    failed: 'Falhou',
    pending: 'Na fila',
    sending: 'Enviando',
    legacy: 'Local antigo',
  };

  const deliveryClass = {
    delivered: 'pill ativo',
    accepted: 'pill projeto-execucao',
    failed: 'pill vencido',
    pending: 'pill pendente',
    sending: 'pill projeto-execucao',
    legacy: 'pill inativo',
  };

  function removeOldReportUi() {
    const settingsGrid = document.querySelector('#view-config .settings-grid');
    if (settingsGrid && !document.querySelector('#report-v2-config')) {
      const panel = document.createElement('article');
      panel.className = 'panel';
      panel.id = 'report-v2-config';
      panel.innerHTML = `
        <h2>Reports centralizados</h2>
        <p>Problemas, melhorias e sugestões são enviados para a central da Construtec e entregues em <strong>pcm@rcconstrutec.com.br</strong>.</p>
        <p class="hint">O sistema agora confirma a entrega com o provedor. Se a internet cair, o report fica na fila e é reenviado automaticamente.</p>
        <div id="report-v2-status" class="form-error" style="margin-top:10px"></div>
        <button class="btn secondary wide" type="button" id="report-v2-retry">Atualizar status e tentar pendentes</button>
      `;
      settingsGrid.appendChild(panel);
      panel.querySelector('#report-v2-retry').addEventListener('click', retryAllReports);
      loadReportDeliveryStatus();
    }

    const loginFoot = document.querySelector('.login-foot');
    if (loginFoot) loginFoot.textContent = 'Aplicação local • conexão externa usada somente para Reports e atualizações';

    const about = document.querySelector('#view-config article dl');
    if (about) {
      [...about.querySelectorAll('dt')].forEach((dt) => {
        if (dt.textContent.trim() === 'Serviços externos') {
          const dd = dt.nextElementSibling;
          if (dd) dd.textContent = 'Reports centralizados e atualizações';
        }
      });
    }
  }

  async function loadReportDeliveryStatus() {
    const el = document.querySelector('#report-v2-status');
    if (!el) return;
    try {
      const data = await api('/bug-reports/delivery/status');
      el.style.color = data.configured ? 'var(--green)' : 'var(--orange)';
      el.textContent = data.configured
        ? `Central conectada. ${data.delivered || 0} entregue(s), ${data.accepted || 0} aguardando confirmação, ${data.pending || 0} pendente(s), ${data.failed || 0} falha(s).`
        : `Central ainda não ativada nesta versão. ${data.pending || 0} report(s) ficará(ão) salvo(s) na fila.`;
    } catch (error) {
      el.style.color = 'var(--red)';
      el.textContent = error.message;
    }
  }

  async function retryAllReports() {
    const button = document.querySelector('#report-v2-retry');
    if (button) button.disabled = true;
    try {
      const result = await api('/bug-reports/delivery/retry', { method: 'POST' });
      toast(`Atualização concluída: ${result.delivered || 0} report(s) entregue(s).`);
      await loadReportDeliveryStatus();
      await loadBugReportsV2();
    } catch (error) {
      toast(error.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function loadBugReportsV2() {
    const items = await api('/bug-reports');
    const el = document.querySelector('#lista-bugreports');
    if (!el) return;
    if (!items.length) {
      el.innerHTML = '<div class="empty">Nenhum report cadastrado.</div>';
      return;
    }

    const isAdminOrGestor = ['admin', 'gestor'].includes(usuario.role);
    el.innerHTML = `
      <div class="table-meta"><span>${items.length} report(s)</span><span class="muted">Destino: pcm@rcconstrutec.com.br</span></div>
      <div class="table-scroll"><table>
        <thead><tr><th>#</th><th>Título</th><th>Tipo</th><th>Severidade</th><th>Entrega</th><th>Autor</th><th>Data</th><th>Ações</th></tr></thead>
        <tbody>${items.map((r) => `
          <tr>
            <td><strong>${r.central_report_id ? esc(r.central_report_id) : r.id}</strong></td>
            <td>${esc(r.titulo)}</td>
            <td><span class="pill">${bugTipoLabel[r.tipo] || esc(r.tipo)}</span></td>
            <td><span class="${bugSeveridadeClass[r.severidade] || 'pill'}">${bugSeveridadeLabel[r.severidade] || esc(r.severidade)}</span></td>
            <td><span class="${deliveryClass[r.delivery_status] || 'pill'}">${deliveryLabel[r.delivery_status] || esc(r.delivery_status || 'local')}</span>${r.last_delivery_error ? `<br><small class="muted">${esc(r.last_delivery_error)}</small>` : ''}</td>
            <td>${esc(r.author_name)}</td>
            <td>${dateTimeBr(r.created_at)}</td>
            <td><div class="row-actions">
              ${['pending','failed'].includes(r.delivery_status) ? `<button data-retry-report="${r.id}">Reenviar</button>` : ''}
              ${isAdminOrGestor ? `<button data-manage-report="${r.id}">Gerenciar</button>` : ''}
            </div></td>
          </tr>`).join('')}</tbody>
      </table></div>`;

    el.querySelectorAll('[data-retry-report]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const result = await api(`/bug-reports/${button.dataset.retryReport}/retry`, { method: 'POST' });
        if (result.ok) toast('Report enviado para a central.');
        else toast('Sem conexão com a central. O report continua salvo na fila.', true);
        await loadBugReportsV2();
      } catch (error) {
        toast(error.message, true);
      } finally {
        button.disabled = false;
      }
    }));

    el.querySelectorAll('[data-manage-report]').forEach((button) => button.addEventListener('click', () => {
      const item = items.find((r) => r.id === Number(button.dataset.manageReport));
      if (item) openBugDetail(item);
    }));
  }

  function openReportModalV2() {
    modal('Enviar report para a Construtec', `
      <form id="report-v2-form">
        <p class="hint">O report será identificado com seu usuário, instalação, versão do aplicativo e sistema operacional. O destino é pcm@rcconstrutec.com.br.</p>
        <label for="report-v2-title">Título</label>
        <input id="report-v2-title" required maxlength="200" placeholder="Resuma o que aconteceu">
        <div class="form-grid">
          <div><label for="report-v2-type">Tipo</label><select id="report-v2-type"><option value="bug">Erro / problema</option><option value="melhoria">Melhoria</option><option value="sugestao">Sugestão</option></select></div>
          <div><label for="report-v2-severity">Prioridade</label><select id="report-v2-severity"><option value="baixa">Baixa</option><option value="media" selected>Média</option><option value="alta">Alta</option><option value="critica">Crítica</option></select></div>
        </div>
        <label for="report-v2-description">O que aconteceu?</label>
        <textarea id="report-v2-description" required rows="6" maxlength="10000" placeholder="Explique o problema, o que você estava fazendo e o que esperava que acontecesse."></textarea>
        <div id="modal-error" class="form-error"></div>
        <button class="btn primary wide" id="report-v2-send" type="submit" style="margin-top:14px">Enviar report</button>
      </form>
    `);

    document.querySelector('#report-v2-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = document.querySelector('#report-v2-send');
      const errorEl = document.querySelector('#modal-error');
      button.disabled = true;
      button.textContent = 'Enviando...';
      errorEl.textContent = '';
      try {
        const result = await api('/bug-reports', {
          method: 'POST',
          body: JSON.stringify({
            titulo: document.querySelector('#report-v2-title').value,
            tipo: document.querySelector('#report-v2-type').value,
            severidade: document.querySelector('#report-v2-severity').value,
            descricao: document.querySelector('#report-v2-description').value,
          }),
        });
        closeModal();
        if (result.delivery?.status === 'delivered') {
          toast(`Report enviado com sucesso${result.delivery.centralReportId ? ` — ${result.delivery.centralReportId}` : ''}.`);
        } else if (result.delivery?.status === 'accepted') {
          toast('Report recebido pela central. A entrega ao e-mail será confirmada em seguida.');
        } else {
          toast('Report salvo. Sem conexão com a central agora; o sistema tentará novamente automaticamente.');
        }
        await loadBugReportsV2().catch(() => {});
        await loadReportDeliveryStatus().catch(() => {});
      } catch (error) {
        errorEl.textContent = error.message;
        button.disabled = false;
        button.textContent = 'Enviar report';
      }
    });
  }

  function replaceReportButton(selector) {
    const oldButton = document.querySelector(selector);
    if (!oldButton) return;
    const newButton = oldButton.cloneNode(true);
    oldButton.replaceWith(newButton);
    newButton.addEventListener('click', openReportModalV2);
  }

  removeOldReportUi();
  replaceReportButton('#btn-novo-bugreport');
  replaceReportButton('#fab-bugreport');

  try { loadBugReports = loadBugReportsV2; } catch {}
  window.loadBugReportsV2 = loadBugReportsV2;
})();
