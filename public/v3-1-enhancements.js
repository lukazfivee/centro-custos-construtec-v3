(() => {
  const $ = (s, root=document) => root.querySelector(s);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const token = () => localStorage.getItem('cc_token') || '';
  const user = () => { try { return JSON.parse(localStorage.getItem('cc_usuario') || 'null'); } catch { return null; } };
  const money = (n) => Number(n || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const fmtTime = (v) => { const d=new Date(v); return Number.isNaN(d.valueOf())?'':d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}); };
  const api = async (path, options={}) => {
    const response = await fetch(path, { ...options, headers:{ Authorization:`Bearer ${token()}`, 'Content-Type':'application/json', ...(options.headers||{}) } });
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw window.apiError ? window.apiError(response,data,`Erro ${response.status}`) : new Error(data.erro || data.error || `Erro ${response.status}`);
    return data;
  };

  function setupSettingsList() {
    const grid = $('#view-config .settings-grid');
    if (grid) grid.classList.add('v31-settings-list');
  }

  function liveStack() {
    let stack = $('#v31-live-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'v31-live-stack';
      stack.className = 'v31-live-stack';
      document.body.appendChild(stack);
    }
    return stack;
  }

  function showActivity(event) {
    const actor = event.sourceUserName || event.sourceUserEmail || 'Outro usuário';
    const popup = document.createElement('div');
    popup.className = 'v31-live-popup';
    popup.innerHTML = `<div class="v31-live-head"><strong>${esc(actor)}</strong><time>${esc(fmtTime(event.createdAt))}</time></div><p>${esc(event.summary || 'Dados atualizados.')}</p><small>${esc(event.sourceInstanceName || '')}</small>`;
    liveStack().appendChild(popup);
    setTimeout(() => popup.remove(), 8500);
  }

  let activityRunning = false;
  async function pollActivity() {
    if (activityRunning || !navigator.onLine || !token()) return;
    const current = user();
    if (!/@rcconstrutec\.com\.br$/i.test(String(current?.email || ''))) return;
    activityRunning = true;
    const key = `cc_activity_cursor_${current.email}`;
    const stored = localStorage.getItem(key);
    try {
      const data = await api(`/api/cloud-sync/atividade?after=${encodeURIComponent(stored || 0)}`);
      const events = Array.isArray(data.events) ? data.events : [];
      const cursor = Number(data.cursor || 0);
      if (stored) events.forEach(showActivity);
      if (cursor > 0) localStorage.setItem(key, String(cursor));
    } catch (_) {
      // Notificacoes nao interrompem o uso do app em caso de falha de rede.
    } finally { activityRunning = false; }
  }

  function ensureCollectionView() {
    if ($('#view-cobrancas')) return;
    const nav = $('.sidebar nav');
    if (nav) {
      const config = nav.querySelector('[data-view="config"]');
      const btn = document.createElement('button');
      btn.className = 'nav-item';
      btn.dataset.view = 'cobrancas';
      btn.innerHTML = '<span>✉</span>Cobranças';
      if (config) nav.insertBefore(btn, config); else nav.appendChild(btn);
      btn.addEventListener('click', () => openCollections());
    }
    const main = $('.main');
    const section = document.createElement('section');
    section.id = 'view-cobrancas';
    section.className = 'view oculto';
    section.innerHTML = `
      <div class="page-head"><div><p class="eyebrow">Acompanhamento comercial</p><h1>Obras e cobranças</h1><p class="muted">Acompanhe entrega, faturamento, vencimentos e comunicação com os clientes.</p></div><button id="v31-refresh-collections" class="btn secondary">Atualizar</button></div>
      <div class="v31-collection-kpis">
        <div class="v31-collection-kpi"><span>Finalizadas</span><strong id="v31-kpi-finalizadas">0</strong></div>
        <div class="v31-collection-kpi"><span>Aguardando pagamento</span><strong id="v31-kpi-aguardando">0</strong></div>
        <div class="v31-collection-kpi"><span>Cobranças pendentes</span><strong id="v31-kpi-pendentes">0</strong></div>
        <div class="v31-collection-kpi"><span>A receber</span><strong id="v31-kpi-receber">R$ 0,00</strong></div>
      </div>
      <div class="table-card v31-collection-table"><div class="table-scroll"><table><thead><tr><th>Obra / cliente</th><th>Operação</th><th>Financeiro</th><th>NF</th><th>Vencimento</th><th>A receber</th><th>Ações</th></tr></thead><tbody id="v31-collections-body"></tbody></table></div></div>`;
    main.appendChild(section);
    $('#v31-refresh-collections').addEventListener('click', loadCollections);
  }

  function activateOnly(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('oculto'));
    document.querySelectorAll('.nav-item').forEach(v => v.classList.remove('ativo'));
    const section = $(`#view-${view}`);
    const nav = $(`.nav-item[data-view="${view}"]`);
    if (section) section.classList.remove('oculto');
    if (nav) nav.classList.add('ativo');
  }

  async function openCollections() {
    ensureCollectionView();
    activateOnly('cobrancas');
    await loadCollections();
  }

  const OP = {em_execucao:'Em execução',finalizada:'Finalizada',entregue:'Entregue'};
  const FIN = {a_faturar:'A faturar',nf_emitida:'NF emitida',enviada:'Enviada',aguardando_pagamento:'Aguardando pagamento',pago:'Pago'};
  function chip(label, cls='') { return `<span class="status-chip ${cls}">${esc(label)}</span>`; }

  async function loadCollections() {
    const body = $('#v31-collections-body');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="7">Carregando...</td></tr>';
    try {
      const data = await api('/api/cloud-sync/cobrancas');
      const rows = Array.isArray(data.items) ? data.items : [];
      const summary = data.summary || {};
      $('#v31-kpi-finalizadas').textContent = summary.finalizadas ?? rows.filter(r=>r.operationalStatus==='finalizada').length;
      $('#v31-kpi-aguardando').textContent = summary.aguardandoPagamento ?? rows.filter(r=>r.financialStatus==='aguardando_pagamento').length;
      $('#v31-kpi-pendentes').textContent = summary.cobrancasPendentes ?? rows.filter(r=>['finalizada','entregue'].includes(r.operationalStatus)&&r.financialStatus!=='pago').length;
      $('#v31-kpi-receber').textContent = money(summary.totalReceber ?? rows.reduce((a,r)=>a+Number(r.receivableAmount||0),0));
      body.innerHTML = rows.length ? rows.map(r => {
        const pending = ['finalizada','entregue'].includes(r.operationalStatus) && r.financialStatus !== 'pago';
        const opClass = r.operationalStatus==='entregue' ? 'good' : (r.operationalStatus==='finalizada' ? 'warn':'');
        const finClass = r.financialStatus==='pago' ? 'good' : (pending ? 'bad':'');
        return `<tr><td><strong>${esc(r.code || '')} — ${esc(r.name || '')}</strong><div class="muted">${esc(r.clientName || r.client || 'Cliente não informado')}</div></td><td>${chip(OP[r.operationalStatus]||r.operationalStatus,opClass)}</td><td>${chip(FIN[r.financialStatus]||r.financialStatus,finClass)}</td><td>${esc(r.invoiceNumber||'—')}</td><td>${esc(r.dueDate||'—')}</td><td>${money(r.receivableAmount)}</td><td><div class="v31-collection-actions"><button class="text-btn" data-edit-followup="${esc(r.publicId)}">Editar</button><button class="text-btn" data-email-followup="${esc(r.publicId)}">E-mail</button></div></td></tr>`;
      }).join('') : '<tr><td colspan="7">Nenhuma obra disponível.</td></tr>';
      body.querySelectorAll('[data-edit-followup]').forEach(b=>b.addEventListener('click',()=>openFollowup(rows.find(r=>r.publicId===b.dataset.editFollowup))));
      body.querySelectorAll('[data-email-followup]').forEach(b=>b.addEventListener('click',()=>openEmailDraft(rows.find(r=>r.publicId===b.dataset.emailFollowup))));
    } catch (error) { body.innerHTML = `<tr><td colspan="7">${esc(error.message)}</td></tr>`; }
  }

  function modalShell(title, content) {
    $('#v31-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'v31-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.58);display:grid;place-items:center;padding:20px;';
    overlay.innerHTML = `<div class="modal" style="display:block;position:relative;max-height:90vh;overflow:auto;width:min(760px,100%);"><div class="modal-head"><h2>${esc(title)}</h2><button id="v31-close-modal" class="icon-btn">×</button></div><div style="padding:18px 22px">${content}</div></div>`;
    document.body.appendChild(overlay);
    $('#v31-close-modal').addEventListener('click',()=>overlay.remove());
    overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
    return overlay;
  }

  function emailsText(list) { return Array.isArray(list) ? list.join('; ') : String(list || ''); }
  function parseEmails(value) { return String(value||'').split(/[;,\n]+/).map(v=>v.trim()).filter(Boolean); }

  function openFollowup(item) {
    if (!item) return;
    const overlay = modalShell(`Acompanhamento — ${item.code || item.name}`, `
      <form id="v31-followup-form" class="v31-modal-grid">
        <div class="span-2"><label>Cliente</label><input id="v31-f-client" value="${esc(item.clientName||item.client||'')}"></div>
        <div class="span-2"><label>E-mails do cliente</label><input id="v31-f-emails" value="${esc(emailsText(item.clientEmails))}" placeholder="financeiro@cliente.com; contato@cliente.com"></div>
        <div><label>Responsável</label><input id="v31-f-responsible" value="${esc(item.responsible||'')}"></div>
        <div><label>Número da NF</label><input id="v31-f-invoice" value="${esc(item.invoiceNumber||'')}"></div>
        <div><label>Situação operacional</label><select id="v31-f-op">${Object.entries(OP).map(([v,l])=>`<option value="${v}" ${item.operationalStatus===v?'selected':''}>${l}</option>`).join('')}</select></div>
        <div><label>Situação financeira</label><select id="v31-f-fin">${Object.entries(FIN).map(([v,l])=>`<option value="${v}" ${item.financialStatus===v?'selected':''}>${l}</option>`).join('')}</select></div>
        <div><label>Valor do contrato</label><input id="v31-f-contract" type="number" step="0.01" min="0" value="${Number(item.contractAmount||0)}"></div>
        <div><label>Valor a receber</label><input id="v31-f-receivable" type="number" step="0.01" min="0" value="${Number(item.receivableAmount||0)}"></div>
        <div><label>Data de conclusão</label><input id="v31-f-completion" type="date" value="${esc(item.completionDate||'')}"></div>
        <div><label>Vencimento</label><input id="v31-f-due" type="date" value="${esc(item.dueDate||'')}"></div>
        <div class="span-2"><label>Observações</label><textarea id="v31-f-notes">${esc(item.notes||'')}</textarea></div>
        <div class="span-2" style="display:flex;justify-content:flex-end"><button class="btn primary" type="submit">Salvar acompanhamento</button></div>
      </form>`);
    $('#v31-followup-form').addEventListener('submit', async e => {
      e.preventDefault();
      const payload = {
        clientName:$('#v31-f-client').value.trim(), clientEmails:parseEmails($('#v31-f-emails').value), responsible:$('#v31-f-responsible').value.trim(),
        operationalStatus:$('#v31-f-op').value, financialStatus:$('#v31-f-fin').value, invoiceNumber:$('#v31-f-invoice').value.trim(),
        contractAmount:Number($('#v31-f-contract').value||0), receivableAmount:Number($('#v31-f-receivable').value||0),
        completionDate:$('#v31-f-completion').value||null, dueDate:$('#v31-f-due').value||null, notes:$('#v31-f-notes').value.trim(),
      };
      try { await api(`/api/cloud-sync/cobrancas/${encodeURIComponent(item.publicId)}`,{method:'PUT',body:JSON.stringify(payload)}); overlay.remove(); await loadCollections(); if(typeof toast==='function')toast('Acompanhamento salvo.'); }
      catch(error){ if(typeof toast==='function')toast(error.message,true); }
    });
  }

  async function filePayload(input) {
    const files = [...(input.files || [])];
    const total = files.reduce((n,f)=>n+f.size,0);
    if (total > 5*1024*1024) throw new Error('Os anexos somados devem ter no máximo 5 MB.');
    return Promise.all(files.map(file => new Promise((resolve,reject) => {
      const reader = new FileReader();
      reader.onerror = ()=>reject(new Error(`Não foi possível ler ${file.name}.`));
      reader.onload = ()=>resolve({filename:file.name,contentBase64:String(reader.result||'').split(',').pop(),contentType:file.type||'application/octet-stream'});
      reader.readAsDataURL(file);
    })));
  }

  async function openEmailDraft(item) {
    if (!item) return;
    let draftData;
    try { draftData = await api(`/api/cloud-sync/cobrancas/${encodeURIComponent(item.publicId)}/rascunho`); }
    catch(error){ if(typeof toast==='function')toast(error.message,true); return; }
    const draft = draftData.draft || {};
    const current = user();
    const canAuthorize = ['admin','gestor'].includes(current?.role);
    const status = draft.status || 'draft';
    const overlay = modalShell(`E-mail ao cliente — ${item.code || item.name}`, `
      <div id="v31-email-status" class="v31-auth-badge ${status==='authorized'?'authorized':''}">${status==='authorized'?'Envio autorizado'+(draft.authorizedByEmail?` por ${esc(draft.authorizedByEmail)}`:''):'Rascunho ainda não autorizado para envio'}</div>
      <form id="v31-email-form" class="v31-modal-grid">
        <div class="span-2"><label>Para</label><input id="v31-e-to" value="${esc(emailsText(draft.to))}" placeholder="financeiro@cliente.com"></div>
        <div class="span-2"><label>CC</label><input id="v31-e-cc" value="${esc(emailsText(draft.cc))}"></div>
        <div class="span-2"><label>Assunto</label><input id="v31-e-subject" value="${esc(draft.subject||'')}"></div>
        <div class="span-2"><label>Mensagem</label><textarea id="v31-e-body" class="v31-email-body">${esc(draft.bodyText||'')}</textarea></div>
        <div class="span-2"><label>Anexos</label><input id="v31-e-files" type="file" multiple><div class="v31-file-list">Até 5 MB no total. Os anexos só são enviados após autorização.</div></div>
        <div class="span-2" style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><button id="v31-save-draft" class="btn secondary" type="button">Salvar rascunho</button>${canAuthorize?'<button id="v31-authorize-draft" class="btn secondary" type="button">Autorizar envio</button><button id="v31-send-draft" class="btn primary" type="button">Enviar e-mail</button>':''}</div>
      </form>`);
    const save = async () => api(`/api/cloud-sync/cobrancas/${encodeURIComponent(item.publicId)}/rascunho`, {method:'PUT',body:JSON.stringify({to:parseEmails($('#v31-e-to').value),cc:parseEmails($('#v31-e-cc').value),subject:$('#v31-e-subject').value.trim(),bodyText:$('#v31-e-body').value})});
    $('#v31-save-draft').addEventListener('click',async()=>{try{await save();if(typeof toast==='function')toast('Rascunho salvo.');$('#v31-email-status').className='v31-auth-badge';$('#v31-email-status').textContent='Rascunho salvo. Autorize novamente antes do envio.';}catch(e){if(typeof toast==='function')toast(e.message,true);}});
    $('#v31-authorize-draft')?.addEventListener('click',async()=>{try{await save();if(!confirm('Autorizar este e-mail para envio ao cliente? Revise destinatários, assunto, mensagem e anexos antes de continuar.'))return;const r=await api(`/api/cloud-sync/cobrancas/${encodeURIComponent(item.publicId)}/autorizar`,{method:'POST',body:JSON.stringify({confirmar:true})});$('#v31-email-status').className='v31-auth-badge authorized';$('#v31-email-status').textContent=`Envio autorizado por ${r.authorizedByEmail||current?.email||'usuário autorizado'} às ${fmtTime(r.authorizedAt||new Date())}.`;if(typeof toast==='function')toast('Envio autorizado.');}catch(e){if(typeof toast==='function')toast(e.message,true);}});
    $('#v31-send-draft')?.addEventListener('click',async()=>{try{const attachments=await filePayload($('#v31-e-files'));if(!confirm('Enviar agora este e-mail ao cliente?'))return;const r=await api(`/api/cloud-sync/cobrancas/${encodeURIComponent(item.publicId)}/enviar`,{method:'POST',body:JSON.stringify({attachments})});if(typeof toast==='function')toast('E-mail enviado ao cliente.');overlay.remove();await loadCollections();}catch(e){if(typeof toast==='function')toast(e.message,true);}});
  }

  function init() {
    setupSettingsList();
    ensureCollectionView();
    setInterval(setupSettingsList, 2500);
    setInterval(pollActivity, 5000);
    setTimeout(pollActivity, 2500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
