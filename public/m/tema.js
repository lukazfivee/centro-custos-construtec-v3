// Aplica o tema antes de desenhar a tela: sem faixa clara no escuro ao abrir (e vice-versa).
(function () {
  var t = 'claro';
  try { t = localStorage.getItem('cc_m_tema') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro'); } catch (e) { /* segue com o claro */ }
  document.documentElement.dataset.theme = t;
  var m = document.querySelector('meta[name="theme-color"]');
  if (m) m.content = t === 'escuro' ? '#031f29' : '#f2f8fa';
}());
