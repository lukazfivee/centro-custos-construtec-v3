(function() {
      const initSuiteAndTheme = () => {
        // Sincronização do tema da topbar com o FAB de tema
        const topbarToggle = document.getElementById('topbar-theme-toggle');
        topbarToggle?.addEventListener('click', () => {
          const nextDark = !document.documentElement.classList.contains('dark');
          if (typeof window.changeDarkMode === 'function') {
            window.changeDarkMode(nextDark);
            updateThemeText();
            return;
          }
          document.documentElement.classList.toggle('dark', nextDark);
          localStorage.setItem('cc_dark', String(nextDark));
          updateThemeText();
        });
        const updateThemeText = () => {
          const isDark = document.documentElement.classList.contains('dark');
          if (!topbarToggle) return;
          const label = isDark ? 'Ativar modo claro' : 'Ativar modo noturno';
          const icon = isDark
            ? '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>'
            : '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
          topbarToggle.innerHTML = `${icon}<span>${isDark ? 'Claro' : 'Tema'}</span>`;
          topbarToggle.setAttribute('aria-label', label);
          topbarToggle.setAttribute('title', label);
          topbarToggle.setAttribute('aria-pressed', String(isDark));
        };
        updateThemeText();
        const observer = new MutationObserver(updateThemeText);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

        // Gerenciamento do App Switcher / Suíte Construtec
        const suiteBtn = document.getElementById('btn-suite-switcher');
        const suiteMenu = document.getElementById('suite-dropdown-menu');
        if (!suiteBtn || !suiteMenu) return;
        const menuItems = () => [...suiteMenu.querySelectorAll('[role="menuitem"]')].filter(item => !item.hidden && item.getAttribute('aria-disabled') !== 'true');

        const fecharMenu = () => {
          suiteMenu.classList.add('oculto');
          suiteBtn.setAttribute('aria-expanded', 'false');
        };

        const abrirMenu = () => {
          suiteMenu.classList.remove('oculto');
          suiteBtn.setAttribute('aria-expanded', 'true');
        };

        const alternarMenu = (e) => {
          if (e) {
            e.preventDefault();
            e.stopPropagation();
          }
          if (suiteMenu.classList.contains('oculto')) {
            abrirMenu();
          } else {
            fecharMenu();
          }
        };

        // Suporte a clique e toque no botão Suíte
        suiteBtn.addEventListener('click', alternarMenu);

        suiteBtn.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (suiteMenu.classList.contains('oculto')) abrirMenu();
            menuItems()[0]?.focus();
          }
        });

        // Fechar ao tocar ou clicar fora do botão e do menu
        const fecharSeFora = (e) => {
          if (suiteMenu.classList.contains('oculto')) return;
          if (!suiteMenu.contains(e.target) && !suiteBtn.contains(e.target)) {
            fecharMenu();
          }
        };

        document.addEventListener('click', fecharSeFora);
        document.addEventListener('pointerdown', fecharSeFora);
        document.addEventListener('touchstart', fecharSeFora, { passive: true });

        // Fechar com tecla Escape
        document.addEventListener('keydown', (e) => {
          if (suiteMenu.classList.contains('oculto')) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            fecharMenu();
            suiteBtn.focus();
            return;
          }
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
          const items = menuItems();
          const current = items.indexOf(document.activeElement);
          if (!items.length) return;
          e.preventDefault();
          const next = e.key === 'Home' ? 0
            : e.key === 'End' ? items.length - 1
            : (current + (e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
          items[next].focus();
        });

        // Fechar ao clicar em qualquer item dentro do menu
        suiteMenu.querySelectorAll('a, button, .suite-dropdown-item').forEach(item => {
          item.addEventListener('click', () => {
            fecharMenu();
          });
        });
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSuiteAndTheme);
      } else {
        initSuiteAndTheme();
      }
    })();
