/* Especificações das listas paginadas do Centro de Custos.
   Registra categorias, fornecedores, centros de custo, histórico,
   recorrentes e usuários no componente list-panel. */
(() => {
  if (window.__ccListsRegistered) return;
  if (typeof window.ccRegisterList !== 'function') return;
  window.__ccListsRegistered = true;

  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[c]));
  const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const dateBr = (value) => (value ? String(value).slice(0, 10).split('-').reverse().join('/') : '—');
  const dateTimeBr = (value) => (value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const roleName = { admin: 'Administrador', gestor: 'Gestor', supervisor: 'Supervisor' };
  const freqLabels = { mensal: 'Mensal', bimestral: 'Bimestral', trimestral: 'Trimestral', semestral: 'Semestral', anual: 'Anual' };
  const canEdit = () => ['admin', 'gestor'].includes(window.usuario?.role);
  const isAdmin = () => window.usuario?.role === 'admin';

  /* ------------------------------- Categorias ----------------------------- */
  window.ccRegisterList({
    name: 'categorias',
    loaderName: 'loadCategories',
    endpoint: '/categorias',
    title: 'categorias',
    itemNoun: 'categoria(s)',
    viewId: 'view-categorias',
    container: () => document.querySelector('#tabela-categorias'),
    toolbarHost: () => document.querySelector('#view-categorias .table-meta'),
    paginationHost: () => document.querySelector('#view-categorias .table-card'),
    colspan: 5,
    emptyMessage: 'Nenhuma categoria encontrada.',
    skeleton: () => Array.from({ length: 5 }).map(() => '<tr class="cc-skeleton-row"><td><div class="cc-skeleton-line"></div></td><td><div class="cc-skeleton-line"></div></td><td><div class="cc-skeleton-line is-short"></div></td><td><div class="cc-skeleton-line is-short"></div></td><td><div class="cc-skeleton-line is-short"></div></td></tr>').join(''),
    onItems: (items) => { window.categorias = items; },
    render: (items) => items.map((item) => `<tr>
      <td><strong>${esc(item.nome)}</strong></td>
      <td data-label="Tipo padrão"><span class="pill">${esc(item.tipo)}</span></td>
      <td data-label="Lançamentos">${Number(item.total_lancamentos || 0)}</td>
      <td data-label="Status"><span class="pill ${item.ativo ? 'ativo' : 'inativo'}">${item.ativo ? 'Ativa' : 'Inativa'}</span></td>
      <td data-label="Ações"><div class="row-actions">${canEdit() ? `<button data-edit-category="${item.id}" aria-label="Editar categoria: ${esc(item.nome)}" title="Editar categoria: ${esc(item.nome)}">Editar</button>` : ''}</div></td>
    </tr>`).join(''),
    bind: (container, items) => {
      if (!canEdit()) return;
      container.querySelectorAll('[data-edit-category]').forEach((button) => {
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          const item = items.find((entry) => entry.id === Number(button.dataset.editCategory));
          if (item) window.openCategory(item);
        });
      });
    },
  });

  /* ------------------------------ Fornecedores ---------------------------- */
  window.ccRegisterList({
    name: 'fornecedores',
    loaderName: 'loadSuppliers',
    endpoint: '/fornecedores',
    title: 'fornecedores',
    itemNoun: 'fornecedor(es)',
    viewId: 'view-fornecedores',
    container: () => document.querySelector('#tabela-fornecedores'),
    toolbarHost: () => document.querySelector('#view-fornecedores .table-meta'),
    paginationHost: () => document.querySelector('#view-fornecedores .table-card'),
    colspan: 6,
    emptyMessage: 'Nenhum fornecedor cadastrado.',
    skeleton: () => Array.from({ length: 5 }).map(() => '<tr class="cc-skeleton-row"><td><div class="cc-skeleton-line"></div></td><td><div class="cc-skeleton-line is-short"></div></td><td><div class="cc-skeleton-line is-medium"></div></td><td><div class="cc-skeleton-line is-medium"></div></td><td><div class="cc-skeleton-line is-short"></div></td><td><div class="cc-skeleton-line is-short"></div></td></tr>').join(''),
    onItems: (items) => { window.fornecedores = items; },
    render: (items) => items.map((item) => `<tr>
      <td><strong>${esc(item.nome)}</strong></td>
      <td data-label="CPF / CNPJ">${esc(item.documento || '—')}</td>
      <td data-label="Contato">${esc(item.contato || '—')}</td>
      <td data-label="E-mail / telefone">${esc(item.email || '—')}${item.telefone ? `<br><span class="muted">${esc(item.telefone)}</span>` : ''}</td>
      <td data-label="Status"><span class="pill ${item.ativo ? 'ativo' : 'inativo'}">${item.ativo ? 'Ativo' : 'Inativo'}</span></td>
      <td data-label="Ações"><div class="row-actions">${canEdit() ? `<button data-edit-supplier="${item.id}" aria-label="Editar fornecedor: ${esc(item.nome)}" title="Editar fornecedor: ${esc(item.nome)}">Editar</button>` : ''}</div></td>
    </tr>`).join(''),
    bind: (container, items) => {
      container.querySelectorAll('[data-edit-supplier]').forEach((button) => {
        button.addEventListener('click', () => {
          const item = items.find((entry) => entry.id === Number(button.dataset.editSupplier));
          if (item) window.openSupplier(item);
        });
      });
    },
  });

  /* --------------------------- Centros de custo --------------------------- */
  window.ccRegisterList({
    name: 'centros',
    loaderName: 'loadCenters',
    endpoint: '/centros-custo',
    title: 'obras / centros de custo',
    itemNoun: 'obra(s)',
    viewId: 'view-centros',
    container: () => document.querySelector('#lista-centros-cards'),
    toolbarHost: () => document.querySelector('#view-centros .table-meta'),
    paginationHost: () => document.querySelector('#view-centros'),
    colspan: 1,
    search: false,
    emptyMessage: 'Nenhuma obra ou centro de custo cadastrado.',
    onItems: (items) => { window.centros = items; },
    render: (items) => items.map((item) => {
      const statusLabel = item.ativo?(item.situacao==='execucao'?'Em aberto':item.situacao==='pausado'?'Pausado':item.situacao==='concluido'?'Concluído':'Ativo'):'Inativo';
      const statusClass = item.ativo?(item.situacao==='execucao'?'em-aberto':item.situacao==='pausado'?'pausado':item.situacao==='concluido'?'concluido':'ativo'):'inativo';
      return `<article class="center-card" data-center-id="${item.id}">
      <div class="center-card-head"><div class="center-card-icon">◫</div><span class="pill center-status-pill ${statusClass}">${statusLabel}</span></div>
      <h3 class="center-card-title">${esc(item.codigo)} — ${esc(item.nome)}</h3>
      <p class="center-card-client">${esc(item.cliente || 'Sem cliente informado')}</p>
      <div class="center-card-stats"><div><span class="center-stat-label">Realizado</span><strong>${money(item.total_despesas)}</strong></div><div><span class="center-stat-label">Valor contratado</span><strong>${money(item.valor_contrato)}</strong></div></div>
      <div class="center-card-footer"><button class="text-btn" data-center-detail="${item.id}" aria-label="Abrir detalhes da obra ${esc(item.nome)}" title="Abrir detalhes">Detalhes</button>${canEdit() ? `<button class="text-btn" data-edit-center="${item.id}" aria-label="Editar obra ${esc(item.nome)}" title="Editar obra">Editar</button>` : ''}</div>
    </article>`;
    }).join(''),
    bind: (container, items) => {
      container.querySelectorAll('[data-center-detail]').forEach((button) => {
        button.addEventListener('click', () => window.openCenterDetail(Number(button.dataset.centerDetail)));
      });
      container.querySelectorAll('[data-edit-center]').forEach((button) => {
        button.addEventListener('click', () => {
          const item = items.find((entry) => entry.id === Number(button.dataset.editCenter));
          if (item) window.openCenter(item);
        });
      });
    },
  });

  /* -------------------------------- Histórico ----------------------------- */
  window.ccRegisterList({
    name: 'historico',
    loaderName: 'loadHistory',
    endpoint: '/historico',
    title: 'histórico de alterações',
    itemNoun: 'registro(s)',
    viewId: 'view-historico',
    container: () => document.querySelector('#tabela-historico'),
    toolbarHost: () => document.querySelector('#view-historico .table-meta'),
    paginationHost: () => document.querySelector('#view-historico .table-card'),
    colspan: 5,
    search: false,
    emptyMessage: 'Nenhuma alteração registrada ainda.',
    skeleton: () => Array.from({ length: 5 }).map(() => '<tr class="cc-skeleton-row"><td><div class="cc-skeleton-line is-short"></div></td><td><div class="cc-skeleton-line"></div></td><td><div class="cc-skeleton-line is-medium"></div></td><td><div class="cc-skeleton-line is-short"></div></td><td><div class="cc-skeleton-line is-short"></div></td></tr>').join(''),
    render: (items) => items.map((item) => `<tr>
      <td data-label="Data/hora">${dateTimeBr(item.created_at)}</td>
      <td data-label="Tipo / ação"><span class="pill">${esc(item.tipo)} · ${esc(item.acao)}</span></td>
      <td data-label="Resumo">${esc(item.resumo)}</td>
      <td data-label="Usuário">${esc(item.usuario)}</td>
      <td data-label="Instalação">${esc(item.instancia)}</td>
    </tr>`).join(''),
    bind: () => {},
  });

  /* ------------------------------- Recorrentes ---------------------------- */
  window.ccRegisterList({
    name: 'recorrentes',
    loaderName: 'loadRecurring',
    endpoint: '/recorrentes',
    title: 'modelos recorrentes',
    itemNoun: 'modelo(s)',
    viewId: 'view-recorrentes',
    container: () => document.querySelector('#lista-recorrentes'),
    paginationHost: () => document.querySelector('#view-recorrentes'),
    colspan: 1,
    emptyMessage: 'Nenhum modelo recorrente cadastrado.',
    onItems: (items) => { window.__recorrentesItems = items; },
    render: (items) => items.map((item) => {
      const parcela = item.total_parcelas ? `Parcela ${item.parcela_atual}/${item.total_parcelas}` : 'Sem limite';
      return `<article class="center-card" data-recurring-id="${item.id}" tabindex="0" role="button" aria-label="Editar recorrência: ${esc(item.nome)}">
        <div class="center-card-head"><div class="center-card-icon">↻</div><span class="pill center-status-pill ${item.ativo ? 'ativo' : 'inativo'}">${item.ativo ? 'Ativa' : 'Inativa'}</span></div>
        <h3 class="center-card-title">${esc(item.nome)}</h3>
        <p class="center-card-client">${esc(item.centro_codigo)} — ${esc(item.centro_nome)}</p>
        <div class="center-card-stats"><div><span class="center-stat-label">Tipo</span><strong>${esc(item.tipo)}</strong></div><div><span class="center-stat-label">Valor</span><strong>${money(item.valor)}</strong></div></div>
        <div class="center-card-stats"><div><span class="center-stat-label">Frequência</span><strong>${freqLabels[item.frequencia] || esc(item.frequencia)}</strong></div><div><span class="center-stat-label">Parcela</span><strong>${parcela}</strong></div></div>
        <div class="center-card-footer">${canEdit() ? `<button class="text-btn" data-edit-recurring="${item.id}" aria-label="Editar recorrência: ${esc(item.nome)}" title="Editar recorrência: ${esc(item.nome)}">Editar</button><button class="text-btn danger" data-delete-recurring="${item.id}" aria-label="Excluir recorrência: ${esc(item.nome)}" title="Excluir recorrência: ${esc(item.nome)}">Excluir</button>` : ''}</div>
      </article>`;
    }).join(''),
    bind: (container, items) => {
      const openItem = (id) => {
        const item = items.find((entry) => entry.id === id);
        if (item) window.openRecurring(item);
      };
      container.querySelectorAll('[data-recurring-id]').forEach((card) => {
        const id = Number(card.dataset.recurringId);
        const open = (event) => {
          if (event.target.closest('button')) return;
          openItem(id);
        };
        card.addEventListener('click', open);
        card.addEventListener('keydown', (event) => {
          if (event.target.closest('button')) return;
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openItem(id); }
        });
      });
      container.querySelectorAll('[data-edit-recurring]').forEach((button) => {
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          const item = items.find((entry) => entry.id === Number(button.dataset.editRecurring));
          if (item) window.openRecurring(item);
        });
      });
      container.querySelectorAll('[data-delete-recurring]').forEach((button) => {
        button.addEventListener('click', async (event) => {
          event.stopPropagation();
          if (!confirm('Excluir este modelo?')) return;
          try {
            await window.api(`/recorrentes/${button.dataset.deleteRecurring}`, { method: 'DELETE' });
            window.toast('Modelo excluído.');
            await window.loadRecurring();
          } catch (error) { window.toast(error.message, true); }
        });
      });
    },
  });

  /* --------------------------------- Usuários ----------------------------- */
  window.ccRegisterList({
    name: 'usuarios',
    loaderName: 'loadUsers',
    endpoint: '/usuarios',
    title: 'usuários',
    itemNoun: 'usuário(s)',
    viewId: 'view-usuarios',
    container: () => document.querySelector('#tabela-usuarios'),
    toolbarHost: () => document.querySelector('#view-usuarios .table-meta'),
    paginationHost: () => document.querySelector('#view-usuarios .table-card'),
    colspan: 5,
    search: false,
    emptyMessage: 'Nenhum usuário cadastrado.',
    skeleton: () => Array.from({ length: 4 }).map(() => '<tr class="cc-skeleton-row"><td><div class="cc-skeleton-line"></div></td><td><div class="cc-skeleton-line is-medium"></div></td><td><div class="cc-skeleton-line is-short"></div></td><td><div class="cc-skeleton-line is-short"></div></td><td><div class="cc-skeleton-line is-short"></div></td></tr>').join(''),
    render: (items) => items.map((item) => `<tr>
      <td><strong>${esc(item.nome)}</strong></td>
      <td data-label="E-mail">${esc(item.email)}</td>
      <td data-label="Papel"><span class="pill">${esc(roleName[item.role] || item.role)}</span></td>
      <td data-label="Status"><span class="pill ${item.ativo ? 'ativo' : 'inativo'}">${item.ativo ? 'Ativo' : 'Inativo'}</span></td>
      <td data-label="Ações"><div class="row-actions">${isAdmin() ? `<button data-user-edit="${item.id}" aria-label="Editar usuário: ${esc(item.nome)}" title="Editar nome, e-mail e perfil deste usuário">Editar</button><button data-user-status="${item.id}" data-user-active="${item.ativo ? 'false' : 'true'}" aria-label="${item.ativo ? 'Desativar' : 'Ativar'} usuário: ${esc(item.nome)}" title="${item.ativo ? 'Bloquear o acesso deste usuário ao sistema' : 'Permitir que este usuário acesse o sistema'}">${item.ativo ? 'Desativar' : 'Ativar'}</button>` : ''}</div></td>
    </tr>`).join(''),
    bind: (container, items) => {
      if (!isAdmin()) return;
      container.querySelectorAll('[data-user-edit]').forEach((button) => {
        button.addEventListener('click', () => {
          const item = items.find((entry) => entry.id === Number(button.dataset.userEdit));
          if (item) openUserEdit(item);
        });
      });
      container.querySelectorAll('[data-user-status]').forEach((button) => {
        button.addEventListener('click', async () => {
          const item = items.find((entry) => entry.id === Number(button.dataset.userStatus));
          if (!item) return;
          const active = button.dataset.userActive === 'true';
          button.disabled = true;
          try {
            await window.api(`/usuarios/${item.id}/status`, { method: 'PUT', body: JSON.stringify({ ativo: active }) });
            window.toast(active ? 'Usuário ativado.' : 'Usuário desativado.');
            await window.loadUsers();
          } catch (error) {
            button.disabled = false;
            window.toast(error.message, true);
          }
        });
      });
    },
  });

  function openUserEdit(item) {
    modal('Editar usuário', `<form id="user-edit-form">
      <label for="us-edit-nome">Nome</label>
      <input id="us-edit-nome" required maxlength="120" value="${esc(item.nome)}">
      <label for="us-edit-email">E-mail</label>
      <input id="us-edit-email" type="email" required maxlength="180" value="${esc(item.email)}">
      <label for="us-edit-role">Perfil</label>
      <select id="us-edit-role">
        <option value="supervisor" ${item.role === 'supervisor' ? 'selected' : ''}>Supervisor — lançamentos e consultas</option>
        <option value="gestor" ${item.role === 'gestor' ? 'selected' : ''}>Gestor — também gerencia cadastros</option>
        <option value="admin" ${item.role === 'admin' ? 'selected' : ''}>Administrador — acesso total</option>
      </select>
      <div id="modal-error" class="form-error"></div>
      <button class="btn primary" type="submit">Salvar usuário</button>
    </form>`);
    document.getElementById('user-edit-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await window.api(`/usuarios/${item.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            nome: document.getElementById('us-edit-nome').value,
            email: document.getElementById('us-edit-email').value,
            role: document.getElementById('us-edit-role').value,
          }),
        });
        closeModal();
        window.toast('Usuário atualizado.');
        await window.loadUsers();
      } catch (error) {
        document.getElementById('modal-error').textContent = error.message;
        window.toast(error.message, true);
      }
    });
  }
})();
