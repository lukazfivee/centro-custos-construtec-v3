// Barra de título da Suíte: acompanha a tela ativa, a janela em foco e o mouse (luz).
const barra = document.getElementById('barra');
const atual = document.getElementById('atual');
const NOMES = { centro: 'Centro de Custos', orcamentos: 'Orçamentos' };

barra.addEventListener('mousemove', (event) => {
  const rect = barra.getBoundingClientRect();
  barra.style.setProperty('--mx', `${event.clientX - rect.left}px`);
});
window.suiteBar?.onActive((target) => { atual.textContent = NOMES[target] || ''; });
window.suiteBar?.onFocus((focused) => { barra.classList.toggle('inativa', !focused); });
