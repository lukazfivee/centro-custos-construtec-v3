const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function closeModal(document) {
  const backdrop = document.getElementById('modal-fundo');
  if (!backdrop || backdrop.classList.contains('oculto')) return;
  backdrop.classList.add('oculto');
  backdrop.style.display = 'none';
  backdrop.querySelector('.modal').classList.remove('budget-modal-wide');
  document.getElementById('modal-corpo').innerHTML = '';
  document.getElementById('app').inert = false;
  const origin = document._modalOrigin;
  if (origin?.isConnected) origin.focus();
  document._modalOrigin = null;
}

class ClassList extends Set {
  toggle(name, force) { const next = force === undefined ? !this.has(name) : force; if (next) this.add(name); else this.delete(name); return next; }
  contains(name) { return this.has(name); }
  remove(name) { this.delete(name); }
  add(name) { super.add(name); return this; }
}

class Element {
  constructor(id = '', classes = []) {
    this.id = id;
    this.classList = new ClassList(classes);
    this.dataset = {};
    this.listeners = {};
    this.attrs = {};
    this.children = [];
    this.style = {};
    this.disabled = false;
    this.isConnected = true;
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type, event = {}) { for (const fn of this.listeners[type] || []) fn({ currentTarget: this, target: this, preventDefault() { event.defaultPrevented = true; }, ...event }); }
  focus() { this.owner.activeElement = this; }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return this.attrs[name]; }
  getClientRects() { return [{}]; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
}

function harness() {
  const app = new Element('app');
  const sidebar = new Element('sidebar', ['sidebar']);
  const mobileMenu = new Element('mobile-menu');
  const mobileMore = new Element('mobile-more');
  const scrim = new Element('mobile-nav-scrim');
  const nav = new Element('nav-item'); nav.classList.add('nav-item', 'ativo'); nav.dataset.view = 'dashboard';
  const modal = new Element('modal-fundo', ['oculto']);
  const modalBox = new Element('modal-box'); modalBox.classList.add('modal');
  const modalClose = new Element('modal-fechar');
  const modalBody = new Element('modal-corpo');
  modal.children = [modalBox, modalClose, modalBody];
  const title = new Element('modal-titulo');
  const documentListeners = {};
  const all = [mobileMenu, mobileMore, scrim, nav];
  const document = {
    activeElement: null,
    documentElement: new Element(),
    addEventListener(type, fn) { (documentListeners[type] ||= []).push(fn); },
    dispatch(type, event) { for (const fn of documentListeners[type] || []) fn({ preventDefault() { event.defaultPrevented = true; }, ...event }); },
    getElementById(id) { return { app, sidebar, 'mobile-menu': mobileMenu, 'mobile-more': mobileMore, 'mobile-nav-scrim': scrim, 'modal-fundo': modal, 'modal-fechar': modalClose, 'modal-corpo': modalBody, 'modal-titulo': title }[id] || null; },
    querySelector(selector) {
      if (selector === '.sidebar' || selector === '.sidebar.open') return selector.endsWith('.open') && !sidebar.classList.has('open') ? null : sidebar;
      if (selector === '#budget-measurements-backdrop, #budget-report-backdrop, #budget-curves-backdrop') return null;
      if (selector === '#modal-fundo .modal') return modalBox;
      if (selector === '.sidebar.open') return sidebar.classList.has('open') ? sidebar : null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '#mobile-menu, #mobile-more') return [mobileMenu, mobileMore];
      if (selector === '.nav-item') return [nav];
      if (selector === '[data-view], [data-mobile-view]') return [nav];
      if (selector.includes('.cc-')) return [];
      return [];
    },
  };
  sidebar.querySelectorAll = (selector) => selector.includes('.nav-item') ? [nav] : [];
  sidebar.querySelector = (selector) => selector.includes('.nav-item') ? nav : null;
  sidebar.contains = (node) => node === sidebar || node === nav;
  modalBody.querySelectorAll = () => [];
  modal.querySelectorAll = () => [modalClose];
  modal.querySelector = (selector) => selector === '.modal' ? modalBox : null;
  for (const element of [...all, sidebar, modal, modalBox, modalClose, modalBody, title, app]) element.owner = document;
  const context = {
    document,
    window: { electronAPI: null, closeModal: () => closeModal(document) },
    matchMedia: () => ({ addEventListener() {} }),
    showView() {},
    console,
  };
  return { context, document, app, sidebar, mobileMenu, mobileMore, scrim, nav, modal, modalClose, modalBody, modalBox, documentListeners };
}

function run(file, fixture) {
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), fixture.context, { filename: file });
}

test('menu abre, fecha por Escape/scrim e mantém foco com ciclo Tab', () => {
  const f = harness();
  run('public/navigation.js', f);
  f.mobileMore.focus();
  f.mobileMore.dispatch('click');
  assert.equal(f.sidebar.classList.has('open'), true);
  assert.equal(f.mobileMenu.attrs['aria-expanded'], 'true');
  assert.equal(f.nav.owner.activeElement, f.nav);
  f.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(f.sidebar.classList.has('open'), false);
  assert.equal(f.document.activeElement, f.mobileMore);
  f.mobileMenu.dispatch('click');
  f.document.activeElement = f.nav;
  f.document.dispatch('keydown', { key: 'Tab', shiftKey: false });
  assert.equal(f.document.activeElement, f.nav);
  f.scrim.dispatch('click');
  assert.equal(f.sidebar.classList.has('open'), false);
});

test('modal define inert, fecha por botão/scrim/Escape e restaura foco', () => {
  const f = harness();
  run('public/modal-compat.js', f);
  const origin = new Element('origin'); origin.owner = f.document; origin.focus();
  f.context.modal('Título', '<input>');
  assert.equal(f.modal.classList.has('oculto'), false);
  assert.equal(f.app.inert, true);
  assert.equal(f.document.activeElement, f.modalClose);
  f.modalClose.dispatch('click');
  assert.equal(f.modal.classList.has('oculto'), true);
  assert.equal(f.app.inert, false);
  assert.equal(f.document.activeElement, origin);
  f.context.modal('Outro', 'conteúdo');
  f.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(f.modal.classList.has('oculto'), true);
  f.context.modal('Terceiro', 'conteúdo');
  f.modal.dispatch('click', { target: f.modal });
  assert.equal(f.modal.classList.has('oculto'), true);
});

test('modal envolve foco no ciclo Tab', () => {
  const f = harness();
  run('public/modal-compat.js', f);
  const first = new Element('first'); const last = new Element('last');
  first.owner = f.document; last.owner = f.document;
  f.modal.querySelectorAll = () => [first, last];
  f.context.modal('Título', 'conteúdo');
  last.focus();
  f.document.dispatch('keydown', { key: 'Tab', shiftKey: false });
  assert.equal(f.document.activeElement, first);
  first.focus();
  f.document.dispatch('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(f.document.activeElement, last);
});
