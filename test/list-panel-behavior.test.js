const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const panelSource = fs.readFileSync(path.join(root, 'public/list-panel.js'), 'utf8');

// DOM mínimo suficiente para o painel: querySelector por id/classe/atributo,
// createElement com dataset/classList/innerHTML, addEventListener e appendChild.
function makeDom() {
  const registry = new Map(); // id → node
  const bySelector = new Map(); // seletor → node

  function matches(node, selector) {
    if (selector.startsWith('#')) return node.id === selector.slice(1);
    if (selector.startsWith('[') && selector.endsWith(']')) {
      const body = selector.slice(1, -1);
      const [attr, value] = body.split('=');
      const key = attr.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const actual = node.dataset ? node.dataset[key] : undefined;
      if (value === undefined) return actual !== undefined;
      return actual === value.replace(/["']/g, '');
    }
    if (selector.startsWith('.')) return node.className.split(' ').includes(selector.slice(1));
    return node.tagName === selector.toUpperCase();
  }

  function findDeep(node, selector, out = []) {
    if (matches(node, selector)) out.push(node);
    (node.children || []).forEach((child) => findDeep(child, selector, out));
    return out;
  }

  function parseAttrs(html) {
    // Cria nós vazios para cada elemento com atributos data-cc-* encontrado no
    // HTML — suficiente para o painel localizar e ligar seus controles.
    const nodes = [];
    const regex = /<([a-z0-9]+)([^>]*)>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const attrs = match[2];
      const node = createNode(match[1]);
      const dataAttrs = attrs.matchAll(/(data-cc-[a-z-]+)(?:="([^"]*)")?/gi);
      for (const attr of dataAttrs) {
        const key = attr[1].replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        node.dataset[key] = attr[2] ?? '';
      }
      const idMatch = attrs.match(/id="([^"]*)"/i);
      if (idMatch) node.id = idMatch[1];
      const classMatch = attrs.match(/class="([^"]*)"/i);
      if (classMatch) node.className = classMatch[1];
      nodes.push(node);
    }
    return nodes;
  }

  function createNode(tag = 'div') {
    const node = {
      tagName: tag.toUpperCase(),
      id: '',
      className: '',
      dataset: {},
      children: [],
      attributes: {},
      _innerHTML: '',
      textContent: '',
      listeners: {},
      disabled: false,
      set innerHTML(html) { this._innerHTML = String(html); this.children = parseAttrs(this._innerHTML); },
      get innerHTML() { return this._innerHTML; },
      setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'id') this.id = value; },
      getAttribute(key) { return this.attributes[key]; },
      removeAttribute(key) { delete this.attributes[key]; },
      addEventListener(type, handler) { (this.listeners[type] = this.listeners[type] || []).push(handler); },
      appendChild(child) { this.children.push(child); child.parent = this; return child; },
      prepend(child) { this.children.unshift(child); child.parent = this; return child; },
      insertBefore(child, ref) { const i = this.children.indexOf(ref); this.children.splice(i < 0 ? 0 : i, 0, child); child.parent = this; return child; },
      querySelector(selector) { return findDeep(this, selector)[0] || null; },
      querySelectorAll(selector) { return findDeep(this, selector); },
      click() { (this.listeners.click || []).forEach((fn) => fn({ target: this, preventDefault() {} })); },
      contains() { return true; },
    };
    node.classList = {
      add: (name) => { if (!node.className.split(' ').includes(name)) node.className = `${node.className} ${name}`.trim(); },
      contains: (name) => node.className.split(' ').includes(name),
    };
    return node;
  }

  const document = createNode('html');
  document.createElement = (tag) => createNode(tag);
  document.querySelector = (selector) => bySelector.get(selector) || findDeep(document, selector)[0] || registry.get(selector) || null;
  document.querySelectorAll = (selector) => findDeep(document, selector);
  document.readyState = 'complete';
  document.addEventListener = () => {};
  document.body = createNode('body');
  document.appendChild(document.body);
  document.documentElement = createNode('html');
  document.appendChild(document.documentElement);

  return { document, createNode, bySelector, registry };
}

function runPanel() {
  const dom = makeDom();
  const requests = [];
  const storage = {};
  const sandbox = {
    console,
    document: dom.document,
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    sessionStorage: {
      getItem: (k) => storage[k] ?? null,
      setItem: (k, v) => { storage[k] = v; },
    },
    URLSearchParams,
    Promise,
    window: {},
  };
  sandbox.window = sandbox;
  sandbox.window.document = dom.document;
  vm.createContext(sandbox);
  vm.runInContext(panelSource, sandbox);
  return { sandbox, dom, requests };
}

test('painel expõe a API de registro e adocao de listas', () => {
  const { sandbox } = runPanel();
  assert.equal(typeof sandbox.ccRegisterList, 'function');
  assert.equal(typeof sandbox.ccAdoptLists, 'function');
});

test('ao adotar uma lista, o loader envia paginar/pagina/limite e resolve do envelope', async () => {
  const { sandbox, dom } = runPanel();
  const tbody = dom.createNode('tbody');
  tbody.id = 'tabela-teste';
  dom.document.body.appendChild(tbody);
  const card = dom.createNode('div');
  card.className = 'table-card';
  card.appendChild(tbody);
  dom.document.body.appendChild(card);

  let capturedUrl = '';
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, nome: `Item ${i + 1}` }));
  sandbox.api = async (url) => {
    capturedUrl = url;
    return { itens: rows, paginacao: { pagina: 2, limite: 25, total: 120, totalPaginas: 5, temAnterior: true, temProxima: true } };
  };
  sandbox.loadTeste = async () => { throw new Error('loader original não deve ser chamado'); };

  sandbox.ccRegisterList({
    name: 'teste',
    loaderName: 'loadTeste',
    endpoint: '/teste',
    title: 'teste',
    itemNoun: 'itens',
    viewId: 'view-teste',
    container: () => tbody,
    paginationHost: () => card,
    colspan: 2,
    emptyMessage: 'Vazio',
    onItems: () => {},
    render: (items) => items.map((item) => `<tr><td>${item.nome}</td></tr>`).join(''),
    bind: () => {},
  });
  sandbox.ccAdoptLists();
  assert.equal(typeof sandbox.ccAdoptLists, 'function', 'ccAdoptLists deve existir');
  assert.equal(typeof sandbox.ccRegisterList, 'function', 'ccRegisterList deve existir');
  assert.equal(sandbox.loadTeste.__ccListWrapped, true, 'o loader deve estar envolvido');
  await sandbox.loadTeste();
  assert.ok(capturedUrl, 'o loader envolvido deve ter chamado a API');

  assert.match(capturedUrl, /paginar=1/);
  assert.match(capturedUrl, /pagina=1/);
  assert.match(capturedUrl, /limite=50/);
  assert.match(tbody.innerHTML, /Item 1/);
  const bar = card.querySelector('[data-cc-list-pagination]');
  assert.ok(bar, 'a barra de paginação deve existir');
});

test('erro de API renderiza estado de erro com botão de tentar novamente', async () => {
  const { sandbox, dom } = runPanel();
  const tbody = dom.createNode('tbody');
  tbody.id = 'tabela-teste2';
  dom.document.body.appendChild(tbody);
  const card = dom.createNode('div');
  card.className = 'table-card';
  card.appendChild(tbody);
  dom.document.body.appendChild(card);

  sandbox.api = async () => { throw new Error('Falha simulada na API.'); };
  sandbox.loadTeste2 = async () => {};
  sandbox.ccRegisterList({
    name: 'teste2',
    loaderName: 'loadTeste2',
    endpoint: '/teste2',
    title: 'teste2',
    itemNoun: 'itens',
    container: () => tbody,
    paginationHost: () => card,
    colspan: 2,
    render: () => '',
    onItems: () => {},
    bind: () => {},
  });
  sandbox.ccAdoptLists();
  await sandbox.loadTeste2().catch(() => {});
  assert.match(tbody.innerHTML, /cc-list-error/);
  assert.match(tbody.innerHTML, /Falha simulada na API\./);
  assert.match(tbody.innerHTML, /data-cc-list-retry/);
});

test('estado vazio e preservado quando a lista nao tem registros', async () => {
  const { sandbox, dom } = runPanel();
  const tbody = dom.createNode('tbody');
  tbody.id = 'tabela-teste3';
  dom.document.body.appendChild(tbody);
  const card = dom.createNode('div');
  card.className = 'table-card';
  card.appendChild(tbody);
  dom.document.body.appendChild(card);

  sandbox.api = async () => ({ itens: [], paginacao: { pagina: 1, limite: 50, total: 0, totalPaginas: 0, temAnterior: false, temProxima: false } });
  sandbox.loadTeste3 = async () => {};
  sandbox.ccRegisterList({
    name: 'teste3',
    loaderName: 'loadTeste3',
    endpoint: '/teste3',
    title: 'teste3',
    itemNoun: 'itens',
    container: () => tbody,
    paginationHost: () => card,
    colspan: 2,
    emptyMessage: 'Nenhum item encontrado.',
    render: () => '',
    onItems: () => {},
    bind: () => {},
  });
  sandbox.ccAdoptLists();
  await sandbox.loadTeste3();
  assert.match(tbody.innerHTML, /Nenhum item encontrado\./);
});
