// Utilitarios de interface compartilhados pelas telas de entrada.
(function (root) {
  const { icon } = root.Icons;
  const app = () => document.getElementById('app');

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function render(html, className) {
    const el = app();
    el.innerHTML = `<main class="screen ${className || ''}">${html}</main>`;
    return el.firstElementChild;
  }

  function $(sel, scope) { return (scope || document).querySelector(sel); }
  function $$(sel, scope) { return Array.from((scope || document).querySelectorAll(sel)); }

  let shakeFlip = false;
  function shake(el) {
    if (!el) return;
    el.classList.remove('shake-a', 'shake-b');
    shakeFlip = !shakeFlip;
    el.classList.add(shakeFlip ? 'shake-a' : 'shake-b');
  }

  function alertLine(id) {
    return `<span class="alert" role="alert" id="${id}"></span>`;
  }

  function setAlert(el, message) {
    if (!el) return;
    el.innerHTML = message ? `${icon('warning-circle', 16)}<span>${esc(message)}</span>` : '';
  }

  function busy(button, on, label) {
    if (!button) return;
    if (on) {
      button.dataset.label = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${esc(label)}</span>`;
    } else if (button.dataset.label) {
      button.disabled = false;
      button.innerHTML = button.dataset.label;
    }
  }

  function primary(id, label, trailing) {
    return `<button class="btn" id="${id}" type="button"><span>${esc(label)}</span>${trailing ? icon(trailing, 18) : ''}</button>`;
  }

  function link(id, label, leading) {
    return `<button class="link" id="${id}" type="button">${leading ? icon(leading, 18) : ''}${esc(label)}</button>`;
  }

  function field(opts) {
    const eye = opts.password ? `<button class="eye" type="button" data-eye="${opts.id}" aria-label="Mostrar senha">${icon('eye', 18)}</button>` : '';
    const attrs = [
      `id="${opts.id}"`, `type="${opts.password ? 'password' : 'text'}"`, `placeholder="${esc(opts.placeholder || '')}"`,
      opts.inputmode ? `inputmode="${opts.inputmode}"` : '', opts.autocomplete ? `autocomplete="${opts.autocomplete}"` : '',
      opts.value ? `value="${esc(opts.value)}"` : '', 'autocapitalize="off"', 'spellcheck="false"',
    ].join(' ');
    return `<label class="field"><span>${esc(opts.label)}</span><span class="input${opts.password ? ' has-eye' : ''}">${icon(opts.icon, 18)}<input ${attrs}>${eye}</span></label>`;
  }

  function wireEyes(scope) {
    $$('[data-eye]', scope).forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.eye);
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.setAttribute('aria-label', show ? 'Esconder senha' : 'Mostrar senha');
        btn.innerHTML = icon(show ? 'eye-slash' : 'eye', 18);
      });
    });
  }

  function success(size, opts) {
    const s = size || 72;
    const k = s / 72;
    const parts = [];
    for (let i = 0; i < 10; i += 1) {
      const big = i % 2 === 0;
      parts.push(`<span class="p ${big ? 'big' : 'small'}" style="--r:${i * 36}deg;--d:-${Math.round((big ? 50 : 40) * k)}px"></span>`);
    }
    const label = esc((opts && opts.label) || 'Concluído');
    return `<span class="success${opts && opts.green ? ' green' : ''}" role="img" aria-label="${label}" style="--s:${s}px">`
      + `<span class="ring"></span>${parts.join('')}<span class="check">${icon('check-circle-fill', Math.round(44 * k))}</span>`
      + '<img class="logo" src="img/simbolo.png" alt=""></span>';
  }

  let toastTimer = 0;
  function toast(message, iconName) {
    const old = $('.toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.innerHTML = `${icon(iconName || 'check-circle', 18)}<span>${esc(message)}</span>`;
    document.body.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 3200);
  }

  function wireGlow() {
    const style = document.documentElement.style;
    root.addEventListener('pointermove', (event) => {
      style.setProperty('--gx', `${event.clientX}px`);
      style.setProperty('--gy', `${event.clientY}px`);
    }, { passive: true });
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  root.UI = { esc, render, $, $$, shake, alertLine, setAlert, busy, primary, link, field, wireEyes, success, toast, wireGlow, wait, icon };
})(window);
