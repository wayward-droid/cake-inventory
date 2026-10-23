// Searchable product picker used by the order item editor.
//
// The input itself is the item description, so staff can always keep typing
// and turn a line into a custom item. Choosing a suggestion also attaches the
// catalogue product id and fills in its current price.
import { esc, money, num, icon } from './ui.js';

const MAX_RESULTS = 9;

function normalise(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function productText(product) {
  return normalise([
    product.name, product.category, product.flavour, product.size, product.sku,
  ].filter(Boolean).join(' '));
}

function stockText(product) {
  if (!product.track_stock) return 'Made to order';
  const qty = Number(product.stock_qty || 0);
  if (qty <= 0) return 'Out of stock';
  return `${num(qty, 0)} in stock`;
}

function matches(product, terms) {
  if (!terms.length) return true;
  const haystack = productText(product);
  return terms.every((term) => haystack.includes(term));
}

function score(product, query) {
  if (!query) return 0;
  const name = normalise(product.name);
  const q = normalise(query);
  if (name === q) return 4;
  if (name.startsWith(q)) return 3;
  if (name.includes(q)) return 2;
  return 1;
}

export function filterProducts(products, query) {
  const q = normalise(query).trim();
  const terms = q.split(/\s+/).filter(Boolean);
  return (products || [])
    .filter((product) => matches(product, terms))
    .sort((a, b) => score(b, q) - score(a, q) || String(a.name).localeCompare(String(b.name)))
    .slice(0, MAX_RESULTS);
}

function optionHTML(product) {
  const meta = [product.category, product.flavour, product.size].filter(Boolean).join(' · ');
  return `<button type="button" class="item-picker__option" role="option" tabindex="-1" aria-selected="false" data-pick="${esc(product.id)}">
    <span class="item-picker__avatar" aria-hidden="true">${esc(String(product.name || '?').trim().charAt(0).toUpperCase())}</span>
    <span class="item-picker__copy">
      <strong>${esc(product.name)}</strong>
      <small>${esc(meta || 'Catalogue item')} · ${esc(stockText(product))}</small>
    </span>
    <span class="item-picker__price">${esc(money(product.price, { decimals: 0 }))}</span>
  </button>`;
}

function menuHTML(products, query) {
  const list = filterProducts(products, query);
  if (!list.length) {
    return `<div class="item-picker__empty">${icon('search', 16)}
      <span>No product matches “${esc(query)}”. Keep it as a custom line.</span></div>`;
  }
  return `<div class="item-picker__label">${query ? 'Matching products' : 'Products'}<span>${list.length}${list.length === MAX_RESULTS ? '+' : ''}</span></div>
    ${list.map(optionHTML).join('')}`;
}

function hintFor(product) {
  if (!product) return 'Search by name, category or flavour';
  return [product.category, stockText(product)].filter(Boolean).join(' · ');
}

export function itemPickerHTML(line, products = []) {
  const product = line.product_id ? products.find((p) => p.id === line.product_id) : null;
  const hint = product ? hintFor(product) : (line.item_name ? 'Custom line' : hintFor(null));
  return `<div class="item-picker" data-picker>
    <input class="item-picker__input" type="search" data-f="item_name" value="${esc(line.item_name || '')}"
      placeholder="Search products or type a custom item…" aria-label="Search products or type a custom item"
      autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false">
    <input type="hidden" data-f="product_id" value="${esc(line.product_id || '')}">
    <div class="item-picker__menu" data-menu role="listbox" hidden></div>
  </div>
  <small class="item-picker__hint" data-hint>${esc(hint)}</small>`;
}

function closeMenu(row) {
  const menu = row?.querySelector('[data-menu]');
  const input = row?.querySelector('[data-f="item_name"]');
  if (!menu) return;
  menu.hidden = true;
  menu.innerHTML = '';
  menu.dataset.active = '-1';
  input?.setAttribute('aria-expanded', 'false');
}

function closeOthers(container, activeRow) {
  container.querySelectorAll('.item-row').forEach((row) => {
    if (row !== activeRow) closeMenu(row);
  });
}

function openMenu(row, products, { reset = false } = {}) {
  const menu = row.querySelector('[data-menu]');
  const input = row.querySelector('[data-f="item_name"]');
  const hidden = row.querySelector('[data-f="product_id"]');
  if (!menu || !input) return;
  closeOthers(row.parentElement, row);

  const chosen = hidden?.value ? products.find((p) => p.id === hidden.value) : null;
  let query = input.value.trim();
  if (chosen && normalise(query) === normalise(chosen.name)) query = '';
  if (reset === false && menu.dataset.rendered === query && !menu.hidden) return;

  menu.innerHTML = menuHTML(products, query);
  menu.hidden = false;
  menu.dataset.active = '-1';
  menu.dataset.rendered = query;
  input.setAttribute('aria-expanded', 'true');
}

function choose(row, products, id, onSelect) {
  const product = products.find((p) => p.id === id);
  if (!product) return;
  const input = row.querySelector('[data-f="item_name"]');
  const hidden = row.querySelector('[data-f="product_id"]');
  const price = row.querySelector('[data-f="unit_price"]');
  const hint = row.querySelector('[data-hint]');
  if (hidden) hidden.value = product.id;
  if (input) input.value = product.name;
  if (price) price.value = Number(product.price || 0).toFixed(2);
  if (hint) hint.textContent = hintFor(product);
  closeMenu(row);
  input?.focus();
  onSelect?.(product, row);
}

function moveActive(menu, direction) {
  const options = [...menu.querySelectorAll('[data-pick]')];
  if (!options.length) return;
  let index = Number(menu.dataset.active ?? -1);
  index = direction === 'down'
    ? (index + 1) % options.length
    : (index <= 0 ? options.length - 1 : index - 1);
  menu.dataset.active = String(index);
  options.forEach((option, i) => {
    option.classList.toggle('is-active', i === index);
    option.setAttribute('aria-selected', i === index ? 'true' : 'false');
  });
  options[index].scrollIntoView({ block: 'nearest' });
}

function activeOption(menu) {
  const index = Number(menu.dataset.active ?? -1);
  return index >= 0 ? menu.querySelectorAll('[data-pick]')[index] : null;
}

/**
 * Wire a list of item rows to the catalogue. Call once per editor.
 * `onChange(product | null, row)` runs whenever a product is chosen or the
 * description is edited, so the caller can refresh totals.
 */
export function wireItemPicker(container, products, { onSelect, onInput } = {}) {
  const list = products || [];

  container.addEventListener('focusin', (event) => {
    const input = event.target.closest('[data-f="item_name"]');
    if (!input) return;
    const row = input.closest('.item-row');
    if (!row) return;
    openMenu(row, list, { reset: true });
  });

  container.addEventListener('input', (event) => {
    const input = event.target.closest('[data-f="item_name"]');
    if (!input) return;
    const row = input.closest('.item-row');
    if (!row) return;
    const hidden = row.querySelector('[data-f="product_id"]');
    const hint = row.querySelector('[data-hint]');
    if (hidden) hidden.value = '';
    if (hint) hint.textContent = input.value.trim() ? 'Custom line' : hintFor(null);
    openMenu(row, list, { reset: true });
    onInput?.(row);
  });

  container.addEventListener('keydown', (event) => {
    const input = event.target.closest('[data-f="item_name"]');
    if (!input) return;
    const row = input.closest('.item-row');
    const menu = row?.querySelector('[data-menu]');
    if (!menu) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (menu.hidden) openMenu(row, list, { reset: true });
      moveActive(menu, event.key === 'ArrowDown' ? 'down' : 'up');
      return;
    }
    if (event.key === 'Enter') {
      // Never let Enter inside the item search submit the whole order form.
      event.preventDefault();
      if (menu.hidden) {
        openMenu(row, list, { reset: true });
        return;
      }
      const option = activeOption(menu) || menu.querySelector('[data-pick]');
      if (option) choose(row, list, option.dataset.pick, onSelect);
      else closeMenu(row);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(row);
    }
  });

  container.addEventListener('pointerdown', (event) => {
    const option = event.target.closest('[data-pick]');
    if (!option) return;
    event.preventDefault();
    const row = option.closest('.item-row');
    choose(row, list, option.dataset.pick, onSelect);
  });

  // Fallback for assistive technology that activates an option with click.
  container.addEventListener('click', (event) => {
    const option = event.target.closest('[data-pick]');
    if (!option) return;
    const row = option.closest('.item-row');
    choose(row, list, option.dataset.pick, onSelect);
  });

  container.addEventListener('focusout', (event) => {
    const picker = event.target.closest('[data-picker]');
    if (!picker) return;
    const row = picker.closest('.item-row');
    window.setTimeout(() => {
      if (!picker.contains(document.activeElement)) closeMenu(row);
    }, 120);
  });
}
