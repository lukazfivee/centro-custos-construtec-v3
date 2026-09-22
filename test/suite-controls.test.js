const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('topbar alterna uma vez e sincroniza estado acessível', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'suite-controls.js'), 'utf8');
  const listeners = {};
  const classes = new Set();
  const topbar = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    setAttribute: (name, value) => { topbar[name] = value; },
    get innerHTML() { return topbar.html; },
    set innerHTML(value) { topbar.html = value; }
  };
  const element = (id) => id === 'topbar-theme-toggle' ? topbar : null;
  const context = {
    document: {
      readyState: 'complete',
      documentElement: { classList: { contains: (name) => classes.has(name), toggle: (name, value) => value ? classes.add(name) : classes.delete(name) } },
      getElementById: element,
      addEventListener: () => {}
    },
    window: { changeDarkMode: (value) => { calls++; context.document.documentElement.classList.toggle('dark', value); } },
    MutationObserver: class { observe() {} },
    localStorage: { setItem() {} }
  };
  let calls = 0;
  vm.runInNewContext(source, context);
  assert.equal(topbar['aria-pressed'], 'false');
  assert.equal(topbar['aria-label'], 'Ativar modo noturno');
  assert.match(topbar.html, /<svg/);
  listeners.click();
  assert.equal(calls, 1);
  assert.equal(topbar['aria-pressed'], 'true');
  assert.equal(topbar['aria-label'], 'Ativar modo claro');
  assert.match(topbar.html, /<svg/);
});
