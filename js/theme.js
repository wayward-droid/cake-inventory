// Theme: remembers the user's light/dark choice; falls back to the OS setting.
import { icon } from './ui.js';

const STORAGE_KEY = 'csf-theme';
const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function savedTheme() {
  try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; }
}

export function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function updateToggle(button, theme) {
  const dark = theme === 'dark';
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  button.innerHTML = icon(dark ? 'sun' : 'moon', 19);
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
  button.setAttribute('aria-pressed', dark ? 'true' : 'false');
}

export function applyTheme(theme, { persist = false } = {}) {
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', next === 'dark' ? '#14100e' : '#8c3b4a');
  document.querySelectorAll('[data-theme-toggle]').forEach((button) => updateToggle(button, next));
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* storage may be disabled */ }
  }
  return next;
}

export function initTheme() {
  const initial = savedTheme() || document.documentElement.dataset.theme || (media?.matches ? 'dark' : 'light');
  applyTheme(initial);
  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    if (button.dataset.themeBound) return;
    button.dataset.themeBound = '1';
    button.addEventListener('click', () => {
      applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', { persist: true });
    });
  });
  media?.addEventListener?.('change', (event) => {
    if (!savedTheme()) applyTheme(event.matches ? 'dark' : 'light');
  });
}
