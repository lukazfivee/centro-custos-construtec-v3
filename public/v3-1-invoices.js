(() => {
  const q = (s, root=document) => root.querySelector(s);
  const token = () => localStorage.getItem('cc_token') || '';
  const user = () => { try { return JSON.parse(localStorage.getItem('cc_usuario') || 'null'); } catch { return null; } };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let lastCenterId = null;
  let lastBillingPublicId = null;

  function injectStyle() {
    if (q('#v31-invoice-style')) return;
    const style = document.createElement('style');
    style.id = 'v31-invoice-style';
    style.textContent = `
      .v31-center-invoice{margin:18px 0;padding:16px;border:1px solid var(--line);border-radius:12px;background:rgba(50,169,205,.06)}
      .v31-center-invoice-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
      .v31-center-invoice-title{display:flex;gap:10px;align-items:center}.v31-center-invoice-title strong{display:block}.v31-center-invoice-title small{display:block;color:var(--muted);margin-top:3px}
      .v31-center-invoice-icon{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;background:rgba(50,169,205,.14);font-size:19px}
      .v31-center-invoice-actions{display:flex;gap:8px;flex-wrap:wrap}.v31-center-invoice-actions .btn{min-height:36px}
      .v31-center-invoice-file{margin-top:12px;padding:11px 12px;border:1px dashed rgba(50,169,205,.5);border-radius:10px;color:var(--muted);font-size:11px}
      .v31-center-invoice-file.ready{color:var(--green);font-weight:700;border-style:solid}
      .v31-billing-linked-nf{margin-top:8px;padding:9px 11px;border-radius:8px;background:rgba(30,166,114,.1);color:var(--green);font-size:11px;font-weight:700}
      .v31-auto-cc{padding:12px;border:1px solid var(--line);border-radius:10px;background:rgba(50,169,205,.05)}
      .v31-auto-cc-label{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px;font-size:11px;font-weight:700}
      .v31-auto-cc-label small{font-weight:400;color:var(--muted)}
      .v31-auto-cc-chips{display:flex;gap:6px;flex-wrap:wrap}.v31-auto-cc-chip{display:inline-flex;align-items:center;min-height:28px;padding:5px 9px;border-radius:999px;background:rgba(50,169,205,.12);border:1px solid rgba(50,169,205,.28);font-size:10px;font-weight:700}
      html.dark .v31-center-invoice,html.dark .v31-auto-cc{background:rgba(50,169,205,.045)}
      @media(max-width:640px){.v31-center-invoice-actions{width:100%}.v31-center-invoice-actions .btn{flex:1 1 140px}.v31-auto-cc-label{align-items:flex-start;flex-direction:column}}
    `;
    document.head.appendChild(style);
  }

  async function api(path, options={}) {
    const response = await fetch(path, {
      ...options,
      headers:{ Authorization:`Bearer ${token()}`, 'Content-Type':'application/json', ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw window.apiError ? window.apiError(response,data,`Erro ${response.status}`) : new Error(data.erro || data.error || `Erro ${response.status}`);
    return data;
  }

  function toast(message, error=false) {
    if (typeof window.toast === 'function') return window.toast(message, error);
    const el = q('#toast');
    if (!el) return;
    el.textContent = message;
    el.className = `toast${error?' error':''}`;
    setTimeout(() => el.classList.add('oculto'), 3500);
  }

  function sizeText(bytes) {
    const n = Number(bytes || 0);
    if (n < 1024) return `${n} B`;
    if (n < 1024*1024) return `${(n/1024).toFixed(1)} KB`;
    return `${(n/1024/1024).toFixed(2)} MB`;
  }

  async function downloadInvoice(centerId, filename) {
    const response = await fetch(`/api/notas-fiscais-centro/${centerId}/arquivo`, { headers:{ Authorization:`Bearer ${token()}` } });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.erro || 'Não foi possível baixar a nota fiscal.');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename || 'nota-fiscal.pdf';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  async function renderCenterInvoice(centerId) {
    const detail = q('.center-detail-header');
    if (!detail || !centerId) return;
    let panel = q('#v31-center-invoice');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'v31-center-invoice';
      panel.className = 'v31-center-invoice';
      const budget = q('.center-detail-budget');
      const filters = q('.center-detail-filters');
      const anchor = budget || filters || q('.center-detail-actions') || detail.nextElementSibling;
      if (anchor?.parentNode) anchor.parentNode.insertBefore(panel, anchor.nextSibling);
      else detail.parentNode.appendChild(panel);
    }
    panel.innerHTML = '<div class="v31-center-invoice-file">Carregando nota fiscal...</div>';
    try {
      const data = await api(`/api/notas-fiscais-centro/${centerId}`);
      const nf = data.notaFiscal;
      const canManage = ['admin','gestor'].includes(user()?.role);
      panel.innerHTML = `
        <div class="v31-center-invoice-head">
          <div class="v31-center-invoice-title"><div class="v31-center-invoice-icon">PDF</div><div><strong>Nota fiscal da cobrança</strong><small>Fica vinculada a este centro e é reutilizada automaticamente em Cobranças.</small></div></div>
          <div class="v31-center-invoice-actions">
            ${nf ? `<button type="button" class="btn secondary" id="v31-invoice-download">Baixar NF</button>` : ''}
            ${canManage ? `<button type="button" class="btn primary" id="v31-invoice-select">${nf?'Substituir NF':'Anexar NF'}</button>${nf?'<button type="button" class="btn secondary" id="v31-invoice-remove">Remover</button>':''}` : ''}
          </div>
        </div>
        <input id="v31-invoice-file" type="file" accept=".pdf,application/pdf" hidden>
        <div class="v31-center-invoice-file ${nf?'ready':''}">${nf ? `NF vinculada: ${esc(nf.nome)} · ${sizeText(nf.tamanho)}${nf.enviadoPor?` · por ${esc(nf.enviadoPor)}`:''}` : 'Nenhuma nota fiscal vinculada a este centro.'}</div>`;
      q('#v31-invoice-download')?.addEventListener('click', () => downloadInvoice(centerId, nf?.nome).catch(e => toast(e.message,true)));
      q('#v31-invoice-select')?.addEventListener('click', () => q('#v31-invoice-file')?.click());
      q('#v31-invoice-file')?.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf')) return toast('Selecione uma nota fiscal em PDF.', true);
        if (file.size > 5*1024*1024) return toast('A nota fiscal deve ter no máximo 5 MB.', true);
        const reader = new FileReader();
        reader.onerror = () => toast('Não foi possível ler o PDF.', true);
        reader.onload = async () => {
          try {
            await api(`/api/notas-fiscais-centro/${centerId}`, { method:'POST', body:JSON.stringify({ nome:file.name, tipo:'application/pdf', conteudoBase64:String(reader.result||'').split(',').pop() }) });
            toast('Nota fiscal vinculada ao centro de custo.');
            await renderCenterInvoice(centerId);
          } catch (e) { toast(e.message, true); }
        };
        reader.readAsDataURL(file);
      });
      q('#v31-invoice-remove')?.addEventListener('click', async () => {
        if (!confirm('Remover a nota fiscal vinculada a este centro de custo?')) return;
        try { await api(`/api/notas-fiscais-centro/${centerId}`, { method:'DELETE' }); toast('Nota fiscal removida.'); await renderCenterInvoice(centerId); }
        catch (e) { toast(e.message,true); }
      });
    } catch (e) {
      panel.innerHTML = `<div class="v31-center-invoice-file">${esc(e.message)}</div>`;
    }
  }

  function base64ToFile(payload) {
    const binary = atob(payload.contentBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i=0;i<binary.length;i+=1) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], payload.filename, { type:'application/pdf' });
  }

  async function attachLinkedInvoiceToBilling(publicId) {
    const input = q('#v31-e-files');
    if (!input || !publicId || input.dataset.v31LinkedChecked === 'true') return;
    input.dataset.v31LinkedChecked = 'true';
    try {
      const meta = await api(`/api/notas-fiscais-centro/public/${encodeURIComponent(publicId)}`);
      if (!meta.notaFiscal) return;
      const content = await api(`/api/notas-fiscais-centro/public/${encodeURIComponent(publicId)}/conteudo`);
      const file = base64ToFile(content);
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles:true }));
      input.dataset.v31LinkedInvoice = 'true';
      const holder = input.parentElement;
      if (holder && !holder.querySelector('.v31-billing-linked-nf')) {
        const info = document.createElement('div');
        info.className = 'v31-billing-linked-nf';
        info.textContent = `NF carregada automaticamente do Centro de Custo: ${meta.notaFiscal.nome}`;
        holder.appendChild(info);
      }
    } catch (e) {
      // Ausência de NF vinculada não bloqueia o formulário de cobrança.
    }
  }

  function decorateCorporateCc() {
    const input = q('#v31-e-cc');
    const form = q('#v31-email-form');
    if (!input || !form || input.dataset.v31CorporateCc === 'true') return;
    input.dataset.v31CorporateCc = 'true';
    const emails = String(input.value || '').split(/[;,\n]+/).map(v => v.trim()).filter(Boolean);
    const wrapper = document.createElement('div');
    wrapper.className = 'span-2 v31-auto-cc';
    wrapper.innerHTML = `<div class="v31-auto-cc-label"><span>Cópias corporativas automáticas</span><small>Aplicadas pelo sistema; o usuário que envia não é copiado para si mesmo.</small></div><div class="v31-auto-cc-chips">${emails.map(email => `<span class="v31-auto-cc-chip">${esc(email)}</span>`).join('') || '<span class="muted">As cópias serão aplicadas ao salvar o rascunho.</span>'}</div>`;
    const holder = input.parentElement;
    holder.style.display = 'none';
    holder.insertAdjacentElement('afterend', wrapper);
  }

  function captureContext(event) {
    const billing = event.target.closest?.('[data-email-followup]');
    if (billing) lastBillingPublicId = billing.dataset.emailFollowup || null;
    const card = event.target.closest?.('.center-card[data-center-id]');
    if (card && !event.target.closest?.('[data-edit-center]')) lastCenterId = Number(card.dataset.centerId) || null;
  }

  function watch() {
    document.addEventListener('click', captureContext, true);
    const observer = new MutationObserver(() => {
      if (q('.center-detail-header') && lastCenterId) renderCenterInvoice(lastCenterId);
      if (q('#v31-email-form') && lastBillingPublicId) {
        attachLinkedInvoiceToBilling(lastBillingPublicId);
        decorateCorporateCc();
      }
    });
    observer.observe(document.body, { childList:true, subtree:true });
  }

  injectStyle();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
})();
