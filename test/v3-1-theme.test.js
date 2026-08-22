const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('tema possui atalho flutuante acessivel e persistencia local', () => {
  const html = read('public/index.html');
  const script = read('public/app.js');

  assert.match(html, /id="fab-theme"[^>]+aria-pressed="false"/);
  assert.match(script, /api\('\/appearance',\{method:'POST'/);
  assert.match(script, /electronAPI\.setDarkMode/);
  assert.match(script, /themeButton\.setAttribute\('aria-pressed'/);
});

test('preferencia informa se o tema ja foi configurado', () => {
  assert.match(read('routes/appearance.js'), /configured:typeof prefs\.darkMode === 'boolean'/);
});

test('modal alto preserva rolagem dentro da janela', () => {
  const css = read('public/v3-1-figma.css');
  assert.match(css, /\.modal\{[\s\S]*?overflow:auto;[\s\S]*?overscroll-behavior:contain;/);
});
