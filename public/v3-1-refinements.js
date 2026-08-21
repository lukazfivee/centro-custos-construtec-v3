(() => {
  const q = (selector, root=document) => root.querySelector(selector);
  const qa = (selector, root=document) => [...root.querySelectorAll(selector)];
  const escHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const authToken = () => localStorage.getItem('cc_token') || '';
  const currentUser = () => { try { return JSON.parse(localStorage.getItem('cc_usuario') || 'null'); } catch { return null; } };

  async function api(path, options={}) {
    const response = await fetch(path, {
      ...options,
      headers:{ Authorization:`Bearer ${authToken()}`, 'Content-Type':'application/json', ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.erro || data.error || `Erro ${response.status}`);
    return data;
  }

  function activateView(name) {
    qa('.view').forEach((view) => view.classList.add('oculto'));
    qa('.nav-item').forEach((button) => button.classList.remove('ativo'));
    q(`#view-${name}`)?.classList.remove('oculto');
    q(`.nav-item[data-view="${name}"]`)?.classList.add('ativo');
  }

  function setupHoverSidebar() {
    const app = q('#app');
    const sidebar = q('.sidebar');
    if (!app || !sidebar) return;
    q('#v31-sidebar-toggle')?.remove();
    app.classList.remove('sidebar-mini');
    app.classList.add('v31-hover-sidebar');
    localStorage.removeItem('cc_sidebar_mini');
    const brand = sidebar.querySelector('.brand');
    if (brand && !brand.querySelector('.v31-rail-logo')) {
      const logo = document.createElement('img');
      logo.className = 'v31-rail-logo';
      logo.src = 'assets/construtec-favicon.png';
      logo.alt = 'Construtec';
      brand.prepend(logo);
    }
  }

  function modal(title, html) {
    q('#v31-refine-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'v31-refine-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10020;background:rgba(0,0,0,.58);display:grid;place-items:center;padding:20px';
    overlay.innerHTML = `<div class="modal" style="display:block;position:relative;width:min(620px,100%);max-height:90vh;overflow:auto"><div class="modal-head"><h2>${escHtml(title)}</h2><button type="button" class="icon-btn" data-v31-close>×</button></div><div style="padding:20px 22px">${html}</div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-v31-close]').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
    return overlay;
  }

  function setupProfessionalPassword() {
    const form = q('#form-senha');
    const panel = form?.closest('article');
    if (!panel || panel.dataset.v31Security === 'true') return;
    panel.dataset.v31Security = 'true';
    const u = currentUser();
    panel.innerHTML = `
      <div class="v31-setting-row">
        <div class="v31-setting-main">
          <div class="v31-security-icon">⌁</div>
          <div class="v31-setting-copy">
            <h2>Conta e segurança</h2>
            <p>${escHtml(u?.email || 'Conta atual')} · Proteja seu acesso com uma senha exclusiva.</p>
          </div>
        </div>
        <div class="v31-setting-action"><button id="v31-change-password" type="button" class="btn secondary">Alterar senha</button></div>
      </div>`;
    q('#v31-change-password').addEventListener('click', () => {
      const overlay = modal('Alterar senha', `
        <form id="v31-password-form">
          <p class="muted" style="margin-top:0">A alteração será aplicada à sua conta corporativa e valerá nos outros computadores em que você utilizar este login.</p>
          <label for="v31-current-password">Senha atual</label>
          <input id="v31-current-password" type="password" autocomplete="current-password" required>
          <label for="v31-new-password">Nova senha</label>
          <input id="v31-new-password" type="password" autocomplete="new-password" minlength="10" required>
          <label for="v31-confirm-password">Confirmar nova senha</label>
          <input id="v31-confirm-password" type="password" autocomplete="new-password" minlength="10" required>
          <div class="v31-password-rules">Use no mínimo 10 caracteres. Evite reutilizar a mesma senha de outros sistemas.</div>
          <div id="v31-password-error" class="form-error"></div>
          <div style="display:flex;justify-content:flex-end;gap:8px"><button type="button" class="btn secondary" data-v31-cancel>Cancelar</button><button id="v31-password-submit" class="btn primary" type="submit">Salvar nova senha</button></div>
        </form>`);
      overlay.querySelector('[data-v31-cancel]').addEventListener('click', () => overlay.remove());
      overlay.querySelector('#v31-password-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const current = q('#v31-current-password').value;
        const next = q('#v31-new-password').value;
        const confirm = q('#v31-confirm-password').value;
        const error = q('#v31-password-error');
        if (next !== confirm) { error.textContent = 'A confirmação não corresponde à nova senha.'; return; }
        const button = q('#v31-password-submit');
        button.disabled = true;
        error.textContent = '';
        try {
          await api('/api/auth/alterar-senha', { method:'POST', body:JSON.stringify({ senhaAtual:current, novaSenha:next }) });
          overlay.remove();
          if (typeof window.toast === 'function') window.toast('Senha alterada com sucesso.');
          else alert('Senha alterada com sucesso.');
        } catch (e) {
          error.textContent = e.message;
          button.disabled = false;
        }
      });
    });
  }

  function moveReportsToReportsTab() {
    const panel = q('#report-v2-config');
    const view = q('#view-bugreports');
    const list = q('#lista-bugreports');
    if (!panel || !view || panel.closest('#view-bugreports')) return;
    panel.classList.add('v31-reports-central-panel');
    if (list) view.insertBefore(panel, list); else view.appendChild(panel);
  }

  let clientsCache = [];
  async function loadClients(force=false) {
    if (!force && clientsCache.length) return clientsCache;
    const data = await api('/api/cloud-sync/clientes');
    clientsCache = Array.isArray(data.clients) ? data.clients : [];
    return clientsCache;
  }

  function ensureClientsView() {
    if (q('#view-clientes')) return;
    const nav = q('.sidebar nav');
    if (nav && !nav.querySelector('[data-view="clientes"]')) {
      const button = document.createElement('button');
      button.className = 'nav-item';
      button.dataset.view = 'clientes';
      button.innerHTML = '<span>♧</span>Clientes';
      const cobrancas = nav.querySelector('[data-view="cobrancas"]');
      const config = nav.querySelector('[data-view="config"]');
      nav.insertBefore(button, cobrancas || config || null);
      button.addEventListener('click', async () => {
        activateView('clientes');
        await renderClients();
      });
    }
    const main = q('.main');
    if (!main) return;
    const section = document.createElement('section');
    section.id = 'view-clientes';
    section.className = 'view oculto';
    section.innerHTML = `
      <div class="page-head">
        <div><p class="eyebrow">Cadastro comercial</p><h1>Clientes</h1><p class="muted">Cadastre o contato e o hospital/empresa uma vez para reutilizar nas cobranças e nos e-mails de NF.</p></div>
        <div class="v31-clients-toolbar"><button id="v31-refresh-clients" class="btn secondary">Atualizar</button><button id="v31-new-client" class="btn primary">+ Novo cliente</button></div>
      </div>
      <div class="table-card"><div class="table-scroll"><table><thead><tr><th>Empresa / hospital</th><th>Contato</th><th>E-mail</th><th>Status</th><th></th></tr></thead><tbody id="v31-clients-body"></tbody></table></div></div>`;
    main.appendChild(section);
    q('#v31-refresh-clients').addEventListener('click', () => renderClients(true));
    q('#v31-new-client').addEventListener('click', () => openClientForm());
    const u = currentUser();
    if (!['admin','gestor'].includes(u?.role)) q('#v31-new-client').classList.add('oculto');
  }

  async function renderClients(force=false) {
    ensureClientsView();
    const tbody = q('#v31-clients-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5">Carregando...</td></tr>';
    try {
      const clients = await loadClients(force);
      const canManage = ['admin','gestor'].includes(currentUser()?.role);
      tbody.innerHTML = clients.length ? clients.map((client) => `
        <tr>
          <td><span class="v31-client-company">${escHtml(client.company)}</span></td>
          <td>${escHtml(client.name)}</td>
          <td>${escHtml(client.email)}</td>
          <td><span class="pill ${client.active ? 'ativo':'inativo'}">${client.active ? 'Ativo':'Inativo'}</span></td>
          <td><div class="row-actions">${canManage ? `<button data-v31-client-edit="${escHtml(client.id)}">Editar</button><button data-v31-client-status="${escHtml(client.id)}">${client.active?'Desativar':'Ativar'}</button>`:''}</div></td>
        </tr>`).join('') : '<tr><td colspan="5"><div class="empty">Nenhum cliente cadastrado.</div></td></tr>';
      tbody.querySelectorAll('[data-v31-client-edit]').forEach((button) => button.addEventListener('click', () => openClientForm(clients.find((c) => c.id === button.dataset.v31ClientEdit))));
      tbody.querySelectorAll('[data-v31-client-status]').forEach((button) => button.addEventListener('click', async () => {
        const client = clients.find((c) => c.id === button.dataset.v31ClientStatus);
        if (!client) return;
        try {
          await api(`/api/cloud-sync/clientes/${encodeURIComponent(client.id)}/status`, { method:'POST', body:JSON.stringify({ active:!client.active }) });
          clientsCache = [];
          await renderClients(true);
        } catch (e) { if (typeof window.toast === 'function') window.toast(e.message, true); }
      }));
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5">${escHtml(e.message)}</td></tr>`;
    }
  }

  function openClientForm(client=null) {
    const overlay = modal(client ? 'Editar cliente' : 'Novo cliente', `
      <form id="v31-client-form">
        <label for="v31-client-company">Empresa / hospital</label>
        <input id="v31-client-company" required maxlength="180" value="${escHtml(client?.company || '')}" placeholder="Ex.: Hospital Ortopédico da Bahia">
        <label for="v31-client-name">Nome do contato</label>
        <input id="v31-client-name" required maxlength="140" value="${escHtml(client?.name || '')}" placeholder="Nome da pessoa responsável">
        <label for="v31-client-email">E-mail</label>
        <input id="v31-client-email" type="email" required maxlength="200" value="${escHtml(client?.email || '')}" placeholder="financeiro@hospital.com.br">
        <div id="v31-client-error" class="form-error"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px"><button type="button" class="btn secondary" data-v31-cancel>Cancelar</button><button id="v31-client-save" type="submit" class="btn primary">Salvar cliente</button></div>
      </form>`);
    overlay.querySelector('[data-v31-cancel]').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#v31-client-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = q('#v31-client-save');
      const error = q('#v31-client-error');
      button.disabled = true; error.textContent = '';
      const payload = { company:q('#v31-client-company').value.trim(), name:q('#v31-client-name').value.trim(), email:q('#v31-client-email').value.trim() };
      try {
        await api(client ? `/api/cloud-sync/clientes/${encodeURIComponent(client.id)}` : '/api/cloud-sync/clientes', { method:client?'PUT':'POST', body:JSON.stringify(payload) });
        clientsCache = [];
        overlay.remove();
        await renderClients(true);
        if (typeof window.toast === 'function') window.toast(client ? 'Cliente atualizado.' : 'Cliente cadastrado.');
      } catch (e) { error.textContent = e.message; button.disabled = false; }
    });
  }

  async function enhanceBillingClientPicker(form) {
    if (!form || form.dataset.v31ClientPicker === 'true') return;
    form.dataset.v31ClientPicker = 'true';
    const clientInput = form.querySelector('#v31-f-client');
    const emailInput = form.querySelector('#v31-f-emails');
    if (!clientInput || !emailInput) return;
    let clients = [];
    try { clients = (await loadClients()).filter((c) => c.active); } catch { return; }
    const wrapper = document.createElement('div');
    wrapper.className = 'span-2 v31-client-picker';
    wrapper.innerHTML = `<label for="v31-client-directory-picker">Cliente cadastrado</label><select id="v31-client-directory-picker"><option value="">Selecionar cliente...</option>${clients.map((c) => `<option value="${escHtml(c.id)}">${escHtml(c.company)} — ${escHtml(c.name)}</option>`).join('')}</select><small>Ao selecionar, o hospital/empresa e o e-mail são preenchidos automaticamente.</small>`;
    form.prepend(wrapper);
    const select = wrapper.querySelector('select');
    select.addEventListener('change', () => {
      const client = clients.find((c) => c.id === select.value);
      if (!client) return;
      clientInput.value = client.company;
      emailInput.value = client.email;
      wrapper.querySelector('small').textContent = `Contato: ${client.name} · ${client.email}`;
    });
  }

  function enhanceNfPdf(form) {
    if (!form || form.dataset.v31NfPdf === 'true') return;
    form.dataset.v31NfPdf = 'true';
    const input = form.querySelector('#v31-e-files');
    if (!input) return;
    input.accept = '.pdf,application/pdf';
    input.removeAttribute('multiple');
    const holder = input.parentElement;
    holder.classList.add('v31-nf-box');
    const label = holder.querySelector('label');
    if (label) label.textContent = 'Nota fiscal (PDF)';
    const oldInfo = holder.querySelector('.v31-file-list');
    if (oldInfo) oldInfo.textContent = 'Anexe a NF referente a esta obra. Somente PDF, até 5 MB.';
    const filename = document.createElement('div');
    filename.className = 'v31-nf-file';
    filename.textContent = 'Nenhuma NF selecionada.';
    holder.appendChild(filename);
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) { filename.className='v31-nf-file'; filename.textContent='Nenhuma NF selecionada.'; return; }
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      if (!isPdf) {
        input.value = '';
        filename.className='v31-nf-file';
        filename.textContent='Selecione um arquivo PDF.';
        if (typeof window.toast === 'function') window.toast('A nota fiscal deve estar em PDF.', true);
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        input.value=''; filename.className='v31-nf-file'; filename.textContent='O PDF ultrapassa 5 MB.';
        if (typeof window.toast === 'function') window.toast('A NF em PDF deve ter no máximo 5 MB.', true);
        return;
      }
      filename.className='v31-nf-file ready';
      filename.textContent=`NF pronta para anexar: ${file.name}`;
    });
  }

  function watchDynamicModals() {
    const observer = new MutationObserver(() => {
      enhanceBillingClientPicker(q('#v31-followup-form'));
      enhanceNfPdf(q('#v31-email-form'));
    });
    observer.observe(document.body, { childList:true, subtree:true });
  }

  function init() {
    setupHoverSidebar();
    setupProfessionalPassword();
    ensureClientsView();
    moveReportsToReportsTab();
    watchDynamicModals();
    setTimeout(moveReportsToReportsTab, 300);
    setTimeout(moveReportsToReportsTab, 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
