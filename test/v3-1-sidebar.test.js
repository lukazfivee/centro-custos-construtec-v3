const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('sidebar desktop possui uma unica implementacao ativa', () => {
  const enhancementsCss = read('public/v3-1-enhancements.css');
  const enhancementsJs = read('public/v3-1-enhancements.js');
  const refinementsCss = read('public/v3-1-refinements.css');
  const refinementsJs = read('public/v3-1-refinements.js');

  assert.doesNotMatch(enhancementsCss, /sidebar-mini|sidebar-toggle/);
  assert.doesNotMatch(enhancementsJs, /setupSidebar|cc_sidebar_mini|sidebar-mini/);
  assert.doesNotMatch(enhancementsCss, /v31-settings-list/);
  assert.doesNotMatch(enhancementsJs, /setupSettingsList|v31-settings-list/);
  assert.doesNotMatch(refinementsCss, /grid-template-columns:10px|width:10px|opacity:0/);
  assert.match(refinementsJs, /classList\.add\('v31-hover-sidebar'\)/);
});

test('sidebar compacta preserva icones e revela menu e rolagem no hover', () => {
  const css = read('public/v3-1-figma.css');

  assert.match(css, /grid-template-columns:68px/);
  assert.match(css, /:has\(\.sidebar:hover\)[\s\S]*grid-template-columns:245px/);
  assert.match(css, /width:68px/);
  assert.match(css, /width:245px/);
  assert.match(css, /\.sidebar>\*\{opacity:1/);
  assert.match(css, /scrollbar-width:none/);
  assert.match(css, /scrollbar-width:thin/);
  assert.match(css, /position:fixed!important;[\s\S]*height:100dvh!important;/);
  assert.match(css, /\.main\{grid-column:2\}/);
});

test('configuracoes usam cards responsivos', () => {
  const css = read('public/v3-1-figma.css');

  assert.match(css, /#view-config \.settings-grid\{[^}]*grid-template-columns:repeat\(2/);
  assert.match(css, /@media\(max-width:1050px\)[^{]*\{[\s\S]*#view-config \.settings-grid\{grid-template-columns:1fr!important\}/);
  assert.match(css, /@media\(max-width:900px\)[\s\S]*\.mobile-header\{background:var\(--navy\)!important;color:#fff!important/);
  assert.match(css, /\.fab-theme\{right:70px\}/);
});
