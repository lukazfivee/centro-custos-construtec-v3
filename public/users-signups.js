/* Pedidos de acesso da Suite (Fase 5): codigo da empresa, pedidos feitos pelo
   app (aprovar com o perfil escolhido ou recusar) e convites por e-mail. Painel
   so para admin com login central; carrega quando a tela de Usuarios fica
   visivel. Os dados ficam no Worker central (rota /api/cadastros). */
(function () {
  const view = document.getElementById('view-usuarios');
  if (!view) return;
  const PERFIS = [['supervisor', 'Supervisor'], ['gestor', 'Gestor'], ['admin', 'Admin']];
  const options = (value) => PERFIS.map(([k, l]) => `<option value="${k}"${k === value ? ' selected' : ''}>${l}</option>`).join('');
  const nome = (p) => (PERFIS.find(([k]) => k === p) || [p, p])[1];
  const fone = (d) => String(d || '').replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3');
  const quando = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const panel = document.createElement('div');
  panel.className = 'panel oculto';
  panel.id = 'pedidos-acesso-panel';
  panel.innerHTML = `<h2>Pedidos de acesso</h2>
    <p>Quem se cadastra pelo app Suíte Construtec informa o código da empresa. O pedido fica aqui até um administrador aprovar ou recusar; a pessoa recebe um e-mail com a decisão.</p>
    <p>Código da empresa: <strong id="pedidos-codigo" style="letter-spacing:.06em"></strong>
      <button type="button" class="text-btn" id="pedidos-trocar" title="Gerar um código novo; o atual deixa de valer">Trocar código</button></p>
    <div id="pedidos-erro" class="form-error" role="status"></div>
    <ul id="pedidos-lista" class="authorized-emails" aria-live="polite"></ul>
    <h2 style="margin-top:22px">Convidar por e-mail</h2>
    <p>O link do convite vale 7 dias e abre o cadastro no app com o código preenchido; a conta já sai aprovada.</p>
    <form id="convite-form">
      <label for="convite-email">E-mail</label>
      <input id="convite-email" type="email" required maxlength="200">
      <label for="convite-perfil">Perfil</label>
      <select id="convite-perfil">${options('supervisor')}</select>
      <button class="btn primary" type="submit">Enviar convite</button>
    </form>
    <ul id="convites-lista" class="authorized-emails"></ul>`;
  const emails = document.getElementById('emails-autorizados-panel');
  view.insertBefore(panel, emails || null);
  const $ = (id) => document.getElementById(id);
  let loading = false;

  const isAdmin = () => typeof usuario !== 'undefined' && usuario && usuario.role === 'admin';

  function render(data) {
    $('pedidos-codigo').textContent = data.code || '';
    const reqs = data.requests || [];
    $('pedidos-lista').innerHTML = reqs.length
      ? reqs.map((r) => `<li class="authorized-email-row" data-id="${esc(r.id)}"><div><strong>${esc(r.name)}</strong><small>${esc(r.email)}${r.phone ? ` · ${esc(fone(r.phone))}` : ''} · pedido em ${esc(quando(r.createdAt))}</small></div>
          <div style="display:flex;gap:8px;align-items:center"><select aria-label="Perfil de ${esc(r.name)}">${options('supervisor')}</select>
          <button type="button" class="btn primary" data-aprovar>Aprovar</button><button type="button" class="text-btn" data-recusar>Recusar</button></div></li>`).join('')
      : '<li class="authorized-email-empty">Nenhum pedido pendente.</li>';
    const invites = data.invites || [];
    $('convites-lista').innerHTML = invites.map((i) => `<li class="authorized-email-row"><div><strong>${esc(i.email)}</strong><small>Convite pendente · ${esc(nome(i.role))}</small></div></li>`).join('');
    $('pedidos-lista').querySelectorAll('[data-id]').forEach((row) => {
      const id = encodeURIComponent(row.dataset.id);
      const who = row.querySelector('strong').textContent;
      row.querySelector('[data-aprovar]').addEventListener('click', (e) => act(e.currentTarget, `/cadastros/${id}/aprovar`, { perfil: row.querySelector('select').value }, 'Acesso aprovado.'));
      row.querySelector('[data-recusar]').addEventListener('click', async (e) => {
        const button = e.currentTarget;
        if (!(await confirmDialog(`Recusar o pedido de ${who}? A pessoa recebe um e-mail avisando.`, { confirmLabel: 'Recusar' }))) return;
        act(button, `/cadastros/${id}/recusar`, {}, 'Pedido recusado.');
      });
    });
  }

  async function act(button, path, body, message) {
    button.disabled = true;
    $('pedidos-erro').textContent = '';
    try {
      render(await window.api(path, { method: 'POST', body: JSON.stringify(body) }));
      window.toast(message);
      return true;
    } catch (error) {
      button.disabled = false;
      $('pedidos-erro').textContent = error.message;
      return false;
    }
  }

  async function load() {
    if (loading || !isAdmin()) return;
    loading = true;
    try {
      const data = await window.api('/cadastros');
      if (data.disponivel === false) { panel.classList.add('oculto'); return; }
      render(data);
      panel.classList.remove('oculto');
    } catch (error) {
      // Sem conta central ou Worker nao configurado: o painel nao se aplica.
      if (error.status === 409 || error.status === 503) panel.classList.add('oculto');
      else { panel.classList.remove('oculto'); $('pedidos-erro').textContent = error.message; }
    } finally {
      loading = false;
    }
  }

  $('pedidos-trocar').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    if (!(await confirmDialog('Gerar um código novo? O código atual deixa de valer para novos cadastros.', { confirmLabel: 'Trocar código' }))) return;
    await act(button, '/cadastros/codigo/trocar', {}, 'Código trocado.');
    button.disabled = false;
  });
  $('convite-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    const email = $('convite-email').value.trim();
    if (await act(submit, '/cadastros/convites', { email, perfil: $('convite-perfil').value }, `Convite enviado para ${email}.`)) event.target.reset();
    submit.disabled = false;
  });

  new MutationObserver(() => {
    if (!view.classList.contains('oculto')) load();
  }).observe(view, { attributes: true, attributeFilter: ['class'] });
})();
