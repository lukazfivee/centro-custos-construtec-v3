const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const M = path.join(__dirname, '..', 'public', 'm');
const read = (file) => fs.readFileSync(path.join(M, file), 'utf8');
const css = () => `${read('m.css')}\n${read('anim.css')}\n${read('barra.css')}`;

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function tokens(block) {
  const out = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2];
  return out;
}
function themes() {
  const m = read('m.css');
  const light = tokens(m.slice(m.indexOf(':root {'), m.indexOf('html[data-theme="escuro"]')));
  const dark = { ...light, ...tokens(m.slice(m.indexOf('html[data-theme="escuro"]'), m.indexOf('* {'))) };
  return { light, dark };
}

test('fundo do html e do body segue o tema e a barra inferior fica sobre uma faixa opaca', () => {
  const all = css();
  assert.match(all, /html, body \{[^}]*background: var\(--bg\)/);
  assert.match(all, /body \{ padding-bottom: calc\(96px \+ var\(--sab\)\)/);
  assert.match(all, /--sab: env\(safe-area-inset-bottom, 0px\)/);
  assert.match(all, /\.tabs \{[^}]*bottom: calc\(12px \+ var\(--sab\)\)/);
  const faixa = read('barra.css').match(/body::after \{[^}]*\}/);
  assert.ok(faixa, 'falta a faixa opaca atras da barra de abas');
  assert.match(faixa[0], /position: fixed/);
  assert.match(faixa[0], /bottom: 0/);
  assert.match(faixa[0], /var\(--sab\)/);
  assert.match(faixa[0], /var\(--bg\)/);
  assert.match(all, /body\.no-tabs::after \{ display: none/);
});

test('viewport cobre o notch e o tema vale antes da primeira pintura', () => {
  const html = read('index.html');
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /<meta name="color-scheme" content="light dark">/);
  assert.match(html, /<meta name="theme-color" content="#f2f8fa">/);
  assert.ok(html.indexOf('tema.js') < html.indexOf('<body>'), 'tema.js precisa carregar no head');
  const tema = read('tema.js');
  assert.match(tema, /dataset\.theme = t/);
  assert.match(tema, /#031f29/);
  assert.match(read('core.js'), /#031f29' : '#f2f8fa'/);
});

test('contraste dos pares de cor usados pelo celular, claro e escuro', () => {
  const { light, dark } = themes();
  const pares = [
    // [tema, texto, fundo, minimo]
    ['light', 'text', 'bg', 4.5], ['dark', 'text', 'bg', 4.5],
    ['light', 'n300', 'bg', 4.5], ['light', 'n300', 'surface', 4.5], ['light', 'n300', 'n800', 4.5], ['dark', 'n300', 'n800', 4.5], ['dark', 'n300', 'bg', 4.5],
    ['light', 'warn', 'bg', 4.5], ['light', 'warn', 'warn-soft', 4.5], ['light', 'warn', 'surface', 4.5], ['dark', 'warn', 'bg', 4.5], ['dark', 'warn', 'warn-soft', 4.5],
    ['light', 'accent-300', 'bg', 4.5], ['light', 'accent-300', 'accent-900', 4.5], ['dark', 'accent-300', 'accent-900', 4.5], ['dark', 'accent-300', 'surface', 4.5],
    ['light', 'danger-ink', 'bg', 4.5], ['light', 'danger-ink', 'surface', 4.5], ['dark', 'danger-ink', 'bg', 4.5], ['dark', 'danger-ink', 'surface', 4.5],
    ['light', 'tab-ink', 'bg', 4.5], ['dark', 'tab-ink', 'bg', 4.5],
  ];
  for (const [theme, fg, bg, min] of pares) {
    const t = theme === 'light' ? light : dark;
    assert.ok(t[fg] && t[bg], `token ausente: ${fg}/${bg}`);
    assert.ok(ratio(t[fg], t[bg]) >= min, `${theme}: ${fg} sobre ${bg} = ${ratio(t[fg], t[bg]).toFixed(2)}`);
  }
  // Botao preenchido com texto branco e badge de perigo com texto branco
  for (const t of [light, dark]) {
    assert.ok(ratio('#ffffff', t.fill) >= 4.5, `fill ${ratio('#ffffff', t.fill).toFixed(2)}`);
    assert.ok(ratio('#ffffff', t.danger) >= 4.5, `danger ${ratio('#ffffff', t.danger).toFixed(2)}`);
  }
  assert.doesNotMatch(read('m.css'), /\.btn \{[^}]*background: #12a9d1/);
});

test('alvos de toque de 44 px e animacao que nao alarga a pagina', () => {
  const all = css();
  assert.match(all, /\.seg button \{ min-height: 44px/);
  assert.match(all, /\.ia-sheet \.chip-act \{ min-height: 44px/);
  assert.match(all, /\.login-show \{[^}]*height: 44px/);
  assert.match(all, /\.netbar button \{ min-height: 44px/);
  assert.match(all, /\.screen\.inner \{ animation: scrIn[^}]*backwards/);
  assert.match(all, /html \{ overflow-x: clip/);
  assert.match(all, /::placeholder \{ color: var\(--n300\)/);
  assert.match(all, /--side: max\(20px, env\(safe-area-inset-left/);
});
