const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('interface respeita toque, movimento reduzido e troca de tema', () => {
  const css = read('public/v3-1-figma.css');
  const script = read('public/app.js');

  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css, /@media\(hover:none\)/);
  assert.match(css, /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\),select,textarea\{font-size:16px\}/);
  assert.match(css, /\.theme-changing \*,\.theme-changing \*::before,\.theme-changing \*::after\{animation:none!important;transition:none!important\}/);
  assert.match(script, /matchMedia\('\(hover:hover\) and \(pointer:fine\)'\)/);
  assert.match(script, /markStatusMessages\(\$\('#modal-corpo'\)\)/);
  assert.match(script, /classList\.add\('theme-changing'\)/);
});
