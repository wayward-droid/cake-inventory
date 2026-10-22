// ---------------------------------------------------------------------------
// UI toolkit: escaping, formatting, toasts, modals, forms, charts, CSV.
// No framework, no build step.
// ---------------------------------------------------------------------------

import { CURRENCY, LOCALE, ORDER_STATUSES } from './config.js';

let currencySymbol = CURRENCY;

export function setCurrencySymbol(sym) {
  if (sym) currencySymbol = sym;
}

// ---------------------------------------------------------------------------
// Escaping & formatting
// ---------------------------------------------------------------------------
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function money(n, { decimals = 2, symbol = true } = {}) {
  const v = Number(n || 0);
  const formatted = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(v);
  return symbol ? `${currencySymbol}${formatted}` : formatted;
}

export function compactMoney(n) {
  const v = Number(n || 0);
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${currencySymbol}${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  if (abs >= 1_000) return `${currencySymbol}${(v / 1_000).toFixed(0)}k`;
  return money(v, { decimals: 0 });
}

export function num(n, digits = 0) {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(Number(n || 0));
}

function parseDateValue(value) {
  if (!value) return null;
  let d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, day] = value.split('-').map(Number);
    d = new Date(y, m - 1, day);
  } else {
    d = new Date(value);
  }
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(value, { withTime = false } = {}) {
  const d = parseDateValue(value);
  if (!d) return '—';
  const date = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  if (!withTime) return date;
  const time = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' }).format(d);
  return `${date} · ${time}`;
}

export function fmtDayMonth(value) {
  const d = parseDateValue(value);
  if (!d) return { day: '—', month: '' };
  return {
    day: String(d.getDate()).padStart(2, '0'),
    month: new Intl.DateTimeFormat(LOCALE, { month: 'short' }).format(d),
  };
}

export function fmtDateTime(value) {
  return fmtDate(value, { withTime: true });
}

export function relativeTime(value) {
  if (!value) return '';
  const then = new Date(value).getTime();
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return fmtDate(value);
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(days, from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function monthStart(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

export function titleCase(s = '') {
  return String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function labelFor(options, value) {
  const found = (options || []).find((o) => (typeof o === 'string' ? o : o.value) === value);
  return found ? (typeof found === 'string' ? found : found.label) : titleCase(value || '—');
}

export function pct(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `${Number(n).toFixed(1)}%`;
}

export function initials(name = '') {
  return String(name).trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || 'CS';
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-7h6v7"/>',
  bag: '<path d="M6 7h12l1.5 14h-15L6 7Z"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  cake: '<path d="M4 21h16"/><path d="M4 21v-8a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v8"/><path d="M7 10V8a2 2 0 0 1 4 0v2"/><path d="M13 10V8a2 2 0 0 1 4 0v2"/><path d="M4 15c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 4 0"/>',
  flour: '<path d="M12 3v6"/><path d="M12 9c-3.5 0-6 2.5-6 6v6h12v-6c0-3.5-2.5-6-6-6Z"/><path d="M8 15h8"/><path d="M9 18h6"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/><path d="M8 7h8"/><path d="M8 11h6"/>',
  truck: '<path d="M3 6h11v10H3z"/><path d="M14 9h4l3 3v4h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  oven: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18"/><circle cx="8" cy="6.5" r=".6"/><circle cx="12" cy="6.5" r=".6"/><path d="M8 14c1.5-2 2.5 2 4 0s2.5 2 4 0"/>',
  box: '<path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  wallet: '<path d="M20 7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 7v12a2 2 0 0 0 2 2h16V7"/><path d="M16 13h3"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15v3"/><path d="M12 9v9"/><path d="M17 5v13"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  menu: '<path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  whatsapp: '<path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.5L3 21l2-5.3A8.5 8.5 0 1 1 21 11.5Z"/><path d="M8.5 9.5c.5 3 3 5.5 6 6l1.5-1.5-2-2-1 1c-1-.5-1.5-1-2-2l1-1-2-2-1.5 1.5Z"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  filter: '<path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.4 2.1L8.1 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  sparkles: '<path d="m12 3 1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3Z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/>',
  layers: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M8 12h8"/><path d="M8 16h5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4"/><path d="M8 3v4"/><path d="M3 11h18"/><path d="M8 15h.01"/><path d="M12 15h.01"/><path d="M16 15h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  wifi: '<path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8.5 16a5 5 0 0 1 7 0"/><path d="M12 20h.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.3 17.7-1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/>',
  moon: '<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8Z"/>',
};

export function icon(name, size = 20, cls = '') {
  const body = ICONS[name] || ICONS.sparkles;
  return `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

// ---------------------------------------------------------------------------
// Badges & empty states
// ---------------------------------------------------------------------------
export function badge(text, tone = 'muted') {
  return `<span class="badge badge--${esc(tone)}">${esc(text)}</span>`;
}

export function statusBadge(status) {
  const s = ORDER_STATUSES.find((x) => x.value === status);
  return badge(s?.label || titleCase(status || '—'), s?.tone || 'muted');
}

export function emptyState({ iconName = 'sparkles', title, text, action = '' } = {}) {
  return `<div class="empty">
    <div class="empty__icon">${icon(iconName, 28)}</div>
    <h3>${esc(title || 'Nothing here yet')}</h3>
    <p>${esc(text || '')}</p>
    ${action}
  </div>`;
}

export function spinner(label = 'Loading…') {
  return `<div class="loading"><span class="spinner"></span><span>${esc(label)}</span></div>`;
}

export function skeleton(rows = 5) {
  return `<div class="skeleton-list">${Array.from({ length: rows }, () => '<div class="skeleton"></div>').join('')}</div>`;
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
export function toast(message, type = 'ok', ms = 4200) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `<span class="toast__icon">${icon(type === 'error' ? 'alert' : type === 'warn' ? 'alert' : 'check', 18)}</span>
    <span class="toast__msg">${esc(message)}</span>
    <button class="toast__close" aria-label="Dismiss">${icon('close', 15)}</button>`;
  el.querySelector('.toast__close').onclick = () => el.remove();
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  setTimeout(() => {
    el.classList.remove('is-in');
    setTimeout(() => el.remove(), 250);
  }, ms);
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
let openOverlays = 0;

export function openModal({ title, body = '', footer = '', wide = false, onOpen, closable = true }) {
  const root = document.getElementById('modal-root');
  if (!root) return { close() {} };

  const previous = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal ${wide ? 'modal--wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title || 'Dialog')}">
    <header class="modal__head">
      <h2>${esc(title || '')}</h2>
      ${closable ? `<button class="icon-btn" data-close aria-label="Close">${icon('close', 18)}</button>` : ''}
    </header>
    <div class="modal__body">${body}</div>
    ${footer ? `<footer class="modal__foot">${footer}</footer>` : ''}
  </div>`;
  root.appendChild(backdrop);
  document.body.classList.add('no-scroll');
  openOverlays += 1;

  const close = () => {
    if (!backdrop.isConnected) return;
    backdrop.classList.remove('is-in');
    setTimeout(() => backdrop.remove(), 160);
    openOverlays -= 1;
    if (openOverlays <= 0) document.body.classList.remove('no-scroll');
    if (previous && previous.focus) previous.focus();
  };

  const onKey = (e) => {
    if (e.key === 'Escape' && closable) { close(); document.removeEventListener('keydown', onKey); }
    if (e.key === 'Tab') {
      const focusables = [...backdrop.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')];
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', onKey);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && closable) close();
    if (e.target.closest('[data-close]')) close();
  });

  requestAnimationFrame(() => {
    backdrop.classList.add('is-in');
    const auto = backdrop.querySelector('[data-autofocus]') ||
      backdrop.querySelector('input:not([type=hidden]), select, textarea, button');
    auto?.focus();
    onOpen?.(backdrop, close);
  });

  return { el: backdrop, close };
}

export function confirmDialog({
  title = 'Are you sure?',
  message = '',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const m = openModal({
      title,
      body: `<p class="confirm-text">${esc(message)}</p>`,
      footer: `<button class="btn btn--ghost" data-cancel>${esc(cancelText)}</button>
               <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-ok>${esc(confirmText)}</button>`,
      onOpen: (el, close) => {
        el.querySelector('[data-cancel]').onclick = () => { done(false); close(); };
        el.querySelector('[data-ok]').onclick = () => { done(true); close(); };
        // closing by ESC/backdrop should resolve false
        const obs = new MutationObserver(() => {
          if (!el.isConnected) { done(false); obs.disconnect(); }
        });
        obs.observe(document.getElementById('modal-root'), { childList: true });
      },
    });
    void m;
  });
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------
function optionList(options) {
  return (options || []).map((o) => (typeof o === 'string' ? { value: o, label: titleCase(o) } : o));
}

export function fieldHTML(field, values = {}) {
  const name = field.name;
  const raw = values[name];
  const value = raw == null ? (field.default ?? '') : raw;
  const id = `f_${name}`;
  const span = field.span === 2 ? ' field--wide' : '';
  const req = field.required ? 'required' : '';
  const reqMark = field.required ? '<span class="req" aria-hidden="true">*</span>' : '';
  const help = field.help ? `<small class="field__help">${esc(field.help)}</small>` : '';
  const disabled = field.disabled ? 'disabled' : '';
  const readonly = field.readonly ? 'readonly' : '';
  const common = `id="${id}" name="${esc(name)}" ${req} ${disabled} ${readonly}`;
  let control = '';

  switch (field.type) {
    case 'textarea':
      control = `<textarea ${common} rows="${field.rows || 3}" placeholder="${esc(field.placeholder || '')}">${esc(value)}</textarea>`;
      break;
    case 'select': {
      const opts = optionList(field.options);
      control = `<select ${common}>
        <option value="">${esc(field.placeholder || 'Select…')}</option>
        ${opts.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
      </select>`;
      break;
    }
    case 'checkbox':
      return `<div class="field field--check${span}">
        <label class="switch-row" for="${id}">
          <input type="checkbox" ${common} ${value ? 'checked' : ''}>
          <span class="switch"></span>
          <span>${esc(field.label)}</span>
        </label>
        ${help}
      </div>`;
    case 'number':
    case 'money':
      control = `<div class="input-prefix">
        ${field.type === 'money' ? `<span>${esc(currencySymbol)}</span>` : ''}
        <input type="number" ${common} value="${esc(value)}"
          step="${field.step || (field.type === 'money' ? '0.01' : 'any')}"
          min="${field.min ?? (field.type === 'money' ? '0' : '')}"
          max="${field.max ?? ''}"
          placeholder="${esc(field.placeholder || '0')}">
      </div>`;
      break;
    case 'date':
      control = `<input type="date" ${common} value="${esc(value)}">`;
      break;
    case 'file':
      control = `<input type="file" ${common} accept="${esc(field.accept || 'image/*,.pdf')}">`;
      break;
    case 'password':
    case 'email':
    case 'tel':
    case 'url':
      control = `<input type="${field.type}" ${common} value="${esc(value)}" placeholder="${esc(field.placeholder || '')}" autocomplete="${esc(field.autocomplete || 'off')}">`;
      break;
    default:
      control = `<input type="text" ${common} value="${esc(value)}" placeholder="${esc(field.placeholder || '')}">`;
  }

  return `<div class="field${span}">
    <label for="${id}">${esc(field.label)}${reqMark}</label>
    ${control}
    ${help}
  </div>`;
}

export function fieldsHTML(fields, values = {}) {
  return `<div class="form-grid">${fields.map((f) => fieldHTML(f, values)).join('')}</div>`;
}

export function collectForm(form, fields) {
  const values = {};
  for (const f of fields) {
    const el = form.elements[f.name];
    if (!el) continue;
    if (f.type === 'checkbox') values[f.name] = !!el.checked;
    else if (f.type === 'file') values[f.name] = el.files?.[0] || null;
    else if (f.type === 'number' || f.type === 'money') {
      values[f.name] = el.value === '' ? null : Number(el.value);
    } else {
      const v = String(el.value ?? '').trim();
      values[f.name] = v === '' ? null : v;
    }
    if (f.required && (values[f.name] == null || values[f.name] === '')) {
      el.focus();
      throw new Error(`${f.label} is required.`);
    }
    if (f.validate && values[f.name] != null) {
      const msg = f.validate(values[f.name], values);
      if (msg) { el.focus(); throw new Error(msg); }
    }
  }
  return values;
}

export function formModal({
  title,
  fields,
  values = {},
  submitLabel = 'Save',
  wide = false,
  intro = '',
  onSubmit,
  onOpen,
  extraFooter = '',
}) {
  const body = `${intro ? `<p class="form-intro">${esc(intro)}</p>` : ''}
    <form id="modal-form" novalidate>
      ${fieldsHTML(fields, values)}
      <div class="form-error" role="alert" hidden></div>
    </form>`;
  const footer = `${extraFooter}
    <button class="btn btn--ghost" type="button" data-close>Cancel</button>
    <button class="btn btn--primary" type="submit" form="modal-form" data-submit>${esc(submitLabel)}</button>`;

  const m = openModal({ title, body, footer, wide, onOpen: (el, close) => {
    const form = el.querySelector('#modal-form');
    const errBox = el.querySelector('.form-error');
    const btn = el.querySelector('[data-submit]');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.hidden = true;
      if (btn.disabled) return;
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = 'Saving…';
      try {
        const data = collectForm(form, fields);
        const result = await onSubmit?.(data, { close, form, el });
        if (result !== false) close();
      } catch (err) {
        errBox.textContent = err.message || String(err);
        errBox.hidden = false;
        btn.disabled = false;
        btn.textContent = original;
      }
    });
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) close();
    });
    onOpen?.(el, close);
  } });
  return m;
}

export function setBusy(button, busy, label = 'Working…') {
  if (!button) return;
  if (busy) {
    if (!button.dataset.busyHtml) button.dataset.busyHtml = button.innerHTML;
    button.disabled = true;
    button.textContent = label;
  } else {
    button.disabled = false;
    if (button.dataset.busyHtml) {
      button.innerHTML = button.dataset.busyHtml;
      delete button.dataset.busyHtml;
    }
  }
}

// ---------------------------------------------------------------------------
// Tables, pagination, charts
// ---------------------------------------------------------------------------
export function table({ columns, rows, empty = 'No records yet.', rowKey = 'id', onRowAttrs } = {}) {
  if (!rows?.length) return emptyState({ title: 'No records yet', text: empty, iconName: 'layers' });
  return `<div class="table-wrap"><table class="data-table">
    <thead><tr>${columns.map((c) => `<th class="${c.className || ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>
      ${rows.map((r) => {
        const attrs = onRowAttrs ? onRowAttrs(r) : '';
        return `<tr data-id="${esc(r[rowKey] ?? '')}" ${attrs}>${columns.map((c) => {
          const v = c.render ? c.render(r) : r[c.key];
          return `<td class="${c.className || ''}">${v == null ? '—' : (c.raw || c.render ? v : esc(v))}</td>`;
        }).join('')}</tr>`;
      }).join('')}
    </tbody>
  </table></div>`;
}

export function pager(page, total, pageSize) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return '';
  return `<div class="pager">
    <span>Page ${page} of ${pages} · ${num(total)} record${total === 1 ? '' : 's'}</span>
    <div>
      <button class="btn btn--sm btn--ghost" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Previous</button>
      <button class="btn btn--sm btn--ghost" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Next</button>
    </div>
  </div>`;
}

export function lineChart({ points = [], height = 180, color = '#b23a5b', fill = 'rgba(178,58,91,.12)', valueFormat = (v) => money(v, { decimals: 0 }) } = {}) {
  if (!points.length) return emptyState({ title: 'No trend yet', text: 'Completed orders will appear here.', iconName: 'chart' });
  const w = 720;
  const h = height;
  const pad = { l: 10, r: 12, t: 16, b: 26 };
  const max = Math.max(...points.map((p) => Number(p.value) || 0), 1);
  const min = 0;
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const x = (i) => pad.l + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v) => pad.t + innerH - ((Number(v) - min) / (max - min || 1)) * innerH;
  const coords = points.map((p, i) => [x(i), y(p.value)]);
  const path = coords.map(([cx, cy], i) => `${i ? 'L' : 'M'}${cx.toFixed(1)},${cy.toFixed(1)}`).join(' ');
  const area = `${path} L${coords[coords.length - 1][0].toFixed(1)},${(pad.t + innerH).toFixed(1)} L${coords[0][0].toFixed(1)},${(pad.t + innerH).toFixed(1)} Z`;
  const step = Math.max(1, Math.ceil(points.length / 7));
  return `<div class="chart">
    <svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Sales trend">
      <defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${fill}"/><stop offset="100%" stop-color="rgba(255,255,255,0)"/>
      </linearGradient></defs>
      ${[0.25, 0.5, 0.75, 1].map((f) => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${pad.t + innerH * f}" y2="${pad.t + innerH * f}" class="chart__grid"/>`).join('')}
      <path d="${area}" fill="url(#chartFill)"/>
      <path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${coords.map(([cx, cy], i) => `<circle cx="${cx}" cy="${cy}" r="3" fill="#fff" stroke="${color}" stroke-width="2"><title>${esc(points[i].label)}: ${esc(valueFormat(points[i].value))}</title></circle>`).join('')}
      ${points.map((p, i) => (i % step === 0 || i === points.length - 1) ? `<text x="${x(i)}" y="${h - 6}" text-anchor="${i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}" class="chart__label">${esc(p.label)}</text>` : '').join('')}
    </svg>
  </div>`;
}

export function barList(items, { format = (v) => money(v, { decimals: 0 }) } = {}) {
  if (!items.length) return emptyState({ title: 'Nothing to rank yet', iconName: 'chart' });
  const max = Math.max(...items.map((i) => Number(i.value) || 0), 1);
  return `<div class="bar-list">${items.map((i) => `
    <div class="bar-row">
      <div class="bar-row__top"><span>${esc(i.label)}</span><strong>${esc(format(i.value))}</strong></div>
      <div class="bar"><span style="width:${Math.max(2, (Number(i.value) / max) * 100)}%"></span></div>
      ${i.sub ? `<small>${esc(i.sub)}</small>` : ''}
    </div>`).join('')}</div>`;
}

// ---------------------------------------------------------------------------
// CSV / Excel / Word / PDF / print
// ---------------------------------------------------------------------------
function columnValue(row, column) {
  return column.value ? column.value(row) : row[column.key];
}

export function toCSV(rows, columns) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => cell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => cell(columnValue(r, c))).join(',')).join('\n');
  return `\uFEFF${head}\n${body}`;
}

export function downloadFile(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ensureExtension(filename, extension) {
  const base = String(filename || 'export').replace(/\.(csv|xls|xlsx|doc|docx|pdf)$/i, '');
  return `${base}.${extension}`;
}

export function downloadCSV(filename, rows, columns) {
  downloadFile(ensureExtension(filename, 'csv'), toCSV(rows, columns), 'text/csv;charset=utf-8');
}

function xmlEsc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function toXLS(rows, columns, title = 'Export', meta = '') {
  const sheetName = String(title || 'Export').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Export';
  const cell = (value, style = '') => {
    const numeric = typeof value === 'number' && Number.isFinite(value);
    return `<Cell${style ? ` ss:StyleID="${style}"` : ''}><Data ss:Type="${numeric ? 'Number' : 'String'}">${xmlEsc(value)}</Data></Cell>`;
  };
  const header = columns.map((c) => cell(c.label, 'sHead')).join('');
  const body = rows.map((r) => `<Row>${columns.map((c, i) => {
    const raw = columnValue(r, c);
    const numeric = (typeof raw === 'number' && Number.isFinite(raw)) || (c.className || '').includes('num');
    return cell(raw, numeric && typeof raw !== 'number' ? 'sNum' : '');
  }).join('')}</Row>`).join('');

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="sTitle"><Font ss:Bold="1" ss:Size="14"/></Style>
  <Style ss:ID="sMeta"><Font ss:Color="#6D554C" ss:Size="10"/></Style>
  <Style ss:ID="sHead"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#8C3B4A" ss:Pattern="Solid"/><Alignment ss:Vertical="Bottom"/></Style>
  <Style ss:ID="sNum"><Alignment ss:Horizontal="Right"/></Style>
 </Styles>
 <Worksheet ss:Name="${xmlEsc(sheetName)}">
  <Table>
   <Row><Cell ss:StyleID="sTitle"><Data ss:Type="String">${xmlEsc(title)}</Data></Cell></Row>
   ${meta ? `<Row><Cell ss:StyleID="sMeta"><Data ss:Type="String">${xmlEsc(meta)}</Data></Cell></Row>` : ''}
   <Row></Row>
   <Row>${header}</Row>
   ${body}
  </Table>
 </Worksheet>
</Workbook>`;
}

export function downloadXLS(filename, rows, columns, title = 'Export', meta = '') {
  downloadFile(ensureExtension(filename, 'xls'), toXLS(rows, columns, title, meta), 'application/vnd.ms-excel;charset=utf-8');
}

export function toWordHTML(rows, columns, title = 'Export', meta = '') {
  const landscape = columns.length > 5;
  const body = rows.map((r) => `<tr>${columns.map((c) => {
    const raw = columnValue(r, c);
    const numeric = (typeof raw === 'number') || (c.className || '').includes('num');
    return `<td${numeric ? ' align="right"' : ''}>${esc(raw)}</td>`;
  }).join('')}</tr>`).join('');

  return `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:w="urn:schemas-microsoft-com:office:word"
 xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 12mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #33211c; font-size: 10pt; }
  h1 { font-family: Georgia, serif; font-size: 18pt; margin: 0 0 3mm; color: #8c3b4a; }
  p.meta { color: #6d554c; font-size: 9pt; margin: 0 0 6mm; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #8c3b4a; color: #fff; text-align: left; font-size: 8.5pt; padding: 5pt; border: 1px solid #8c3b4a; }
  td { font-size: 8.5pt; padding: 4pt 5pt; border: 1px solid #e9dcd1; vertical-align: top; }
  tr:nth-child(even) td { background: #fdf9f4; }
</style>
</head>
<body>
  <h1>${esc(title)}</h1>
  ${meta ? `<p class="meta">${esc(meta)}</p>` : ''}
  <table>
    <thead><tr>${columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${body || `<tr><td colspan="${Math.max(1, columns.length)}">No rows</td></tr>`}</tbody>
  </table>
</body>
</html>`;
}

export async function downloadWord(filename, rows, columns, title = 'Export', meta = '') {
  try {
    const docx = await import('https://cdn.jsdelivr.net/npm/docx@8.5.0/+esm');
    const {
      Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
      WidthType, AlignmentType,
    } = docx;
    const cellText = (value) => String(value ?? '');
    const header = new TableRow({
      tableHeader: true,
      children: columns.map((c) => new TableCell({
        shading: { fill: '8C3B4A' },
        children: [new Paragraph({
          children: [new TextRun({ text: c.label, bold: true, color: 'FFFFFF', size: 18 })],
        })],
      })),
    });
    const body = rows.map((r) => new TableRow({
      children: columns.map((c) => {
        const raw = columnValue(r, c);
        const numeric = (typeof raw === 'number') || (c.className || '').includes('num');
        return new TableCell({
          children: [new Paragraph({
            alignment: numeric ? AlignmentType.RIGHT : AlignmentType.LEFT,
            children: [new TextRun({ text: cellText(raw), size: 18 })],
          })],
        });
      }),
    }));
    const children = [
      new Paragraph({ children: [new TextRun({ text: title, bold: true, color: '8C3B4A', size: 32 })] }),
      ...(meta ? [new Paragraph({ children: [new TextRun({ text: meta, color: '6D554C', size: 18 })] })] : []),
      new Paragraph({ text: '' }),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [header, ...body],
      }),
    ];
    const document = new Document({
      sections: [{
        properties: {
          page: {
            size: { orientation: 'landscape' },
            margin: { top: 720, right: 720, bottom: 720, left: 720 },
          },
        },
        children,
      }],
    });
    const blob = await Packer.toBlob(document);
    downloadFile(ensureExtension(filename, 'docx'), blob, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    return 'docx';
  } catch (error) {
    console.warn('Word engine unavailable, using HTML .doc fallback.', error);
    downloadFile(ensureExtension(filename, 'doc'), toWordHTML(rows, columns, title, meta), 'application/msword;charset=utf-8');
    return 'doc';
  }
}

function pdfText(value) {
  return String(value ?? '')
    .replace(/\u20A6/g, 'NGN ')
    .replace(/[—–]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...');
}

export async function downloadPDF(filename, rows, columns, title = 'Export', meta = '') {
  try {
    const [jspdfModule, autoTableModule] = await Promise.all([
      import('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm'),
      import('https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/+esm'),
    ]);
    const { jsPDF } = jspdfModule;
    const autoTable = autoTableModule?.default?.default || autoTableModule?.default || autoTableModule?.applyPlugin;
    if (!jsPDF || typeof autoTable !== 'function') throw new Error('PDF engine unavailable.');

    const landscape = columns.length > 5;
    const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(51, 33, 28);
    const titleLines = doc.splitTextToSize(pdfText(title), pageWidth - 72);
    doc.text(titleLines, 36, 42);
    let startY = 46 + titleLines.length * 18;
    if (meta) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(120, 100, 90);
      doc.text(pdfText(meta), 36, startY);
      startY += 16;
    }
    autoTable(doc, {
      startY: startY + 8,
      head: [columns.map((c) => pdfText(c.label))],
      body: rows.map((r) => columns.map((c) => pdfText(columnValue(r, c)))),
      theme: 'grid',
      styles: {
        font: 'helvetica', fontSize: columns.length > 7 ? 7 : 8, cellPadding: 4,
        overflow: 'linebreak', textColor: [51, 33, 28],
        lineColor: [235, 225, 215], lineWidth: 0.5, valign: 'middle',
      },
      headStyles: { fillColor: [140, 59, 74], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: [253, 249, 244] },
      margin: { top: 70, left: 36, right: 36, bottom: 38 },
    });
    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i += 1) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(150, 135, 125);
      doc.text(`Page ${i} of ${pages}`, pageWidth - 85, doc.internal.pageSize.getHeight() - 18);
    }
    doc.save(ensureExtension(filename, 'pdf'));
    return 'pdf';
  } catch (error) {
    console.warn('PDF engine unavailable, opening print view.', error);
    printData({ rows, columns, title, meta });
    toast('PDF engine could not load. Use "Save as PDF" in the print dialog.', 'warn');
    return 'print';
  }
}

export function printData({ rows, columns, title = 'Export', meta = '' }) {
  printHTML(toWordHTML(rows, columns, title, meta), title);
}

export function exportModal({ title = 'Export', filename = 'export', rows = [], columns = [], meta = '' } = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safeColumns = Array.isArray(columns) ? columns : [];
  const options = [
    { format: 'csv', label: 'CSV', hint: 'Open in any spreadsheet app', iconName: 'download' },
    { format: 'excel', label: 'Excel', hint: 'Formatted .xls workbook', iconName: 'download' },
    { format: 'word', label: 'Word', hint: 'Editable .docx document', iconName: 'file' },
    { format: 'pdf', label: 'PDF', hint: 'Polished, ready to share', iconName: 'file' },
    { format: 'print', label: 'Print', hint: 'Paper or Save as PDF', iconName: 'print' },
  ];
  openModal({
    title: `Export ${title}`,
    body: `<div class="export-summary">
        <span class="export-summary__icon">${icon('download', 20)}</span>
        <div><strong>${num(safeRows.length)} row${safeRows.length === 1 ? '' : 's'}</strong>
        <small>${safeColumns.length} column${safeColumns.length === 1 ? '' : 's'}${meta ? ` · ${esc(meta)}` : ''}</small></div>
      </div>
      <div class="export-options">
        ${options.map((option) => `<button type="button" class="export-option" data-export-format="${option.format}">
          <span class="export-option__icon">${icon(option.iconName, 19)}</span>
          <span><strong>${option.label}</strong><small>${option.hint}</small></span>
        </button>`).join('')}
      </div>
      <p class="muted small export-note">PDF and Word are generated in your browser. If the document engine cannot load, the app falls back to a print-ready file.</p>`,
    onOpen: (el, close) => {
      const buttons = [...el.querySelectorAll('[data-export-format]')];
      buttons.forEach((button) => button.addEventListener('click', async () => {
        const format = button.dataset.exportFormat;
        const label = options.find((o) => o.format === format)?.label || format;
        const original = button.innerHTML;
        buttons.forEach((b) => { b.disabled = true; });
        button.classList.add('is-busy');
        button.innerHTML = `<span class="export-option__icon"><span class="spinner"></span></span><span><strong>Preparing…</strong><small>Please wait</small></span>`;
        try {
          let fallback = false;
          if (format === 'csv') downloadCSV(filename, safeRows, safeColumns);
          else if (format === 'excel') downloadXLS(filename, safeRows, safeColumns, title, meta);
          else if (format === 'word') fallback = (await downloadWord(filename, safeRows, safeColumns, title, meta)) === 'doc';
          else if (format === 'pdf') fallback = (await downloadPDF(filename, safeRows, safeColumns, title, meta)) === 'print';
          else printData({ rows: safeRows, columns: safeColumns, title, meta });

          if (format !== 'print') close();
          if (!fallback && format !== 'print') toast(`${label} download ready.`);
        } catch (error) {
          toast(error.message || 'The export failed.', 'error');
        } finally {
          buttons.forEach((b) => { b.disabled = false; });
          button.classList.remove('is-busy');
          button.innerHTML = original;
        }
      }));
    },
  });
}

export function printHTML(html, title = 'Document') {
  const win = window.open('', '_blank', 'width=900,height=760');
  if (!win) { toast('Allow pop-ups to print this document.', 'warn'); return; }
  win.document.open();
  win.document.write(html);
  win.document.title = title;
  win.document.close();
  win.addEventListener('load', () => {
    win.focus();
    setTimeout(() => win.print(), 250);
  });
  // Safari may already be loaded
  setTimeout(() => { try { win.focus(); } catch { /* ignore */ } }, 400);
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function qs(sel, root = document) { return root.querySelector(sel); }
export function qsa(sel, root = document) { return [...root.querySelectorAll(sel)]; }

export function highlight(text, needle) {
  const t = String(text ?? '');
  if (!needle) return esc(t);
  const i = t.toLowerCase().indexOf(String(needle).toLowerCase());
  if (i < 0) return esc(t);
  return `${esc(t.slice(0, i))}<mark>${esc(t.slice(i, i + needle.length))}</mark>${esc(t.slice(i + needle.length))}`;
}
