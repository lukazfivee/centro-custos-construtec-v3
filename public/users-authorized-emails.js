/* E-mails externos autorizados (identidade compartilhada com o Orcamentos).
   Painel visivel so para admin com login corporativo; carrega quando a tela
   de Usuarios fica visivel. */
(function () {
  const panel = document.getElementById('emails-autorizados-panel');
  const view = document.getElementById('view-usuarios');
  if (!panel || !view) return;
  const list = document.getElementById('emails-autorizados-lista');
  const errorBox = document.getElementById('emails-autorizados-erro');
  const form = document.getElementById('email-autorizado-form');
  let loading = false;

  // So admin com login corporativo gerencia o diretorio compartilhado.
  function isAdmin() {
    return typeof usuario !== 'undefined' && usuario && usuario.role === 'admin'
      && /@rcconstrutec\.com\.br$/i.test(String(usuario.email || ''));
  }

  function render(emails) {
    list.innerHTML = emails.length
      ? emails.map((row) => `<li class="authorized-email-row"><div><strong>${esc(row.email)}</strong>${row.note ? `<small>${esc(row.note)}</small>` : ''}</div><button type="button" class="text-btn" data-revoke-email="${esc(row.email)}" aria-label="Revogar autorização de ${esc(row.email)}" title="Impedir novas contas com este e-mail">Revogar</button></li>`).join('')
      : '<li class="authorized-email-empty">Nenhum e-mail externo autorizado.</li>';
    list.querySelectorAll('[data-revoke-email]').forEach((button) => {
      button.addEventListener('click', async () => {
        const email = button.dataset.revokeEmail;
        if (!(await confirmDialog(`Revogar a autorização de ${email}? Uma conta já criada continua ativa; para remover o acesso, use Excluir login.`, { confirmLabel: 'Revogar' }))) return;
        button.disabled = true;
        try {
          await window.api('/usuarios/emails-autorizados/revogar', { method: 'POST', body: JSON.stringify({ email }) });
          window.toast('Autorização revogada.');
          await load();
        } catch (error) {
          button.disabled = false;
          window.toast(error.message, true);
        }
      });
    });
  }

  async function load() {
    if (loading || !isAdmin()) return;
    loading = true;
    errorBox.textContent = '';
    try {
      render(await window.api('/usuarios/emails-autorizados/lista'));
      panel.classList.remove('oculto');
    } catch (error) {
      // Instalacao sem login corporativo: o painel nao se aplica.
      if (error.message && /corporativo/i.test(error.message)) panel.classList.add('oculto');
      else { panel.classList.remove('oculto'); errorBox.textContent = error.message; }
    } finally {
      loading = false;
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    errorBox.textContent = '';
    try {
      await window.api('/usuarios/emails-autorizados', {
        method: 'POST',
        body: JSON.stringify({ email: document.getElementById('email-autorizado').value, observacao: document.getElementById('email-autorizado-obs').value }),
      });
      form.reset();
      window.toast('E-mail autorizado.');
      await load();
    } catch (error) {
      errorBox.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });

  new MutationObserver(() => {
    if (!view.classList.contains('oculto')) load();
  }).observe(view, { attributes: true, attributeFilter: ['class'] });
})();
