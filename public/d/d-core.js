// Nucleo do desktop. Usa o /m/core.js (sessao, API, centavos HALF_UP, datas, UUID, aviso rapido)
// e acrescenta o que e so do desktop: icones Phosphor, papel e permissoes, tema e formatos.
(function (CC) {
  const D = CC.d = CC.d || {};

  // Icones pela fonte Phosphor embutida. "nome-fill" usa o estilo preenchido.
  CC.icon = function (name, size) {
    const fill = /-fill$/.test(name);
    const base = fill ? name.replace(/-fill$/, '') : name;
    const style = size ? ` style="font-size:${Number(size)}px"` : '';
    return `<i class="${fill ? 'ph-fill' : 'ph'} ph-${base}" aria-hidden="true"${style}></i>`;
  };
  D.ic = (name, size) => CC.icon(name, size);

  // Datas sempre em dd/mm/aaaa. Aceita "2026-09-14" e "2026-09-14T00:00:00.000Z".
  D.data = (iso) => {
    const s = String(iso || '');
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '';
  };
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  D.mesAno = (ym) => {
    const [a, m] = String(ym || CC.month()).split('-').map(Number);
    const nome = MESES[(m || 1) - 1] || '';
    return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${a}`;
  };
  // Valor com sinal: receita soma, despesa subtrai (sinal contabil do estorno ja vem do servidor).
  D.valorSinal = (l) => {
    const sinal = (l.tipo === 'receita' ? 1 : -1) * (Number(l.sinal_contabil) < 0 ? -1 : 1);
    return { texto: CC.signed(sinal * Math.abs(Number(l.valor) || 0)), entrada: sinal > 0 };
  };

  // Pessoa logada e papel. Hoje o banco aceita admin, gestor e supervisor (seis papeis entram na D6).
  const PAPEIS = { admin: 'Administrador', gestor: 'Gestor', supervisor: 'Supervisor' };
  D.usuario = () => CC.session.user() || {};
  D.papel = () => String(D.usuario().role || '');
  D.papelNome = (role) => PAPEIS[role || D.papel()] || 'Usuário';
  D.corporativo = () => /@rcconstrutec\.com\.br$/i.test(String(D.usuario().email || ''));
  D.iniciais = (nome) => String(nome || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';

  // O que cada tela exige. Mantem as regras de hoje: Cobrancas so para e-mail corporativo,
  // Recorrentes e Usuarios so para admin. Fechamento, Historico e Usuarios seguem o desenho (admin).
  // Na D6 isto passa a ler a matriz de permissoes do servidor.
  const REGRAS = {
    cobrancas: () => D.corporativo() && ['admin', 'gestor', 'supervisor'].includes(D.papel()),
    recorrentes: () => D.papel() === 'admin',
    fechamento: () => D.papel() === 'admin',
    usuarios: () => D.papel() === 'admin',
    historico: () => D.papel() === 'admin',
    cadastrar: () => ['admin', 'gestor'].includes(D.papel()),
  };
  D.pode = (chave) => (REGRAS[chave] ? REGRAS[chave]() : true);

  // Tema: aplica na hora o ultimo usado neste computador e depois confere com /api/appearance.
  const CHAVE_TEMA = 'cc_d_tema';
  D.tema = {
    atual: () => document.documentElement.dataset.theme || 'claro',
    aplicar(valor) {
      const tema = valor === 'escuro' ? 'escuro' : 'claro';
      document.documentElement.dataset.theme = tema;
      try { localStorage.setItem(CHAVE_TEMA, tema); } catch { /* segue sem guardar */ }
      document.dispatchEvent(new CustomEvent('d:tema', { detail: tema }));
    },
    inicial() {
      let salvo = '';
      try { salvo = localStorage.getItem(CHAVE_TEMA) || ''; } catch { /* sem armazenamento */ }
      D.tema.aplicar(salvo || (matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro'));
    },
    async sincronizar() {
      try {
        const { data } = await CC.api('/appearance');
        if (data && data.configured) D.tema.aplicar(data.darkMode ? 'escuro' : 'claro');
      } catch { /* fica o tema local */ }
    },
    async alternar() {
      const proximo = D.tema.atual() === 'escuro' ? 'claro' : 'escuro';
      D.tema.aplicar(proximo);
      try { await CC.api('/appearance', { method: 'POST', body: { darkMode: proximo === 'escuro' } }); } catch { /* guardado so aqui */ }
      return proximo;
    },
  };

  // Helpers de DOM usados pelas telas.
  D.el = (html) => {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };
  D.debounce = (fn, ms) => {
    let t = 0;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  };
  // Elementos que recebem foco pelo Tab (para prender o foco no painel e no dialogo).
  D.focaveis = (scope) => CC.$$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', scope)
    .filter((el) => el.offsetParent !== null || el === document.activeElement);
  D.prenderFoco = (scope, event) => {
    if (event.key !== 'Tab') return;
    const lista = D.focaveis(scope);
    if (!lista.length) return;
    const primeiro = lista[0];
    const ultimo = lista[lista.length - 1];
    if (event.shiftKey && document.activeElement === primeiro) { event.preventDefault(); ultimo.focus(); }
    else if (!event.shiftKey && document.activeElement === ultimo) { event.preventDefault(); primeiro.focus(); }
  };
})(window.CC = window.CC || {});
