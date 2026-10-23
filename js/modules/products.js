// Finished goods: menu catalogue items and made-to-order designs.
import { sb, errText, dataChanged } from '../supabase.js';
import { defineCrudModule } from '../crud.js';
import { PRODUCT_KINDS, PRODUCT_CATEGORIES } from '../config.js';
import {
  esc, money, num, badge, icon, toast, openModal, setBusy, pct,
} from '../ui.js';

export const products = defineCrudModule({
  table: 'products',
  title: 'Products',
  singular: 'product',
  eyebrow: 'Catalogue',
  subtitle: 'Cakes, slices, jars, breads and drinks you sell — catalogue items and made-to-order designs.',
  ownerOnly: true,
  exportable: true,
  searchFields: ['name', 'sku', 'category', 'flavour'],
  searchPlaceholder: 'Search name, SKU, category, flavour…',
  formWide: true,
  order: { column: 'name', ascending: true },
  defaults: { kind: 'ready_made', unit: 'cake', track_stock: true, status: 'active' },
  filters: [
    { name: 'kind', label: 'Type', options: PRODUCT_KINDS },
    { name: 'category', label: 'Category', options: PRODUCT_CATEGORIES },
    { name: 'status', label: 'Status', options: ['active', 'draft', 'discontinued'] },
  ],
  fields: [
    { name: 'name', label: 'Product name', type: 'text', required: true, span: 2, placeholder: 'e.g. Vanilla Celebration Cake 6"' },
    { name: 'sku', label: 'SKU', type: 'text', placeholder: 'VAN6' },
    { name: 'kind', label: 'Item type', type: 'select', options: PRODUCT_KINDS, required: true },
    { name: 'category', label: 'Category', type: 'text', placeholder: 'Cakes' },
    { name: 'flavour', label: 'Flavour', type: 'text', placeholder: 'Vanilla' },
    { name: 'size', label: 'Size', type: 'text', placeholder: '6 inch' },
    { name: 'unit', label: 'Sold by', type: 'text', default: 'cake' },
    { name: 'price', label: 'Selling price', type: 'money', required: true },
    { name: 'cost_price', label: 'Cost price', type: 'money', help: 'Leave at 0 and recalculate from the recipe later.' },
    { name: 'opening_stock', label: 'Opening stock', type: 'number', createOnly: true, min: 0, help: 'Recorded in the stock ledger.' },
    { name: 'low_stock_at', label: 'Low-stock level', type: 'number', min: 0 },
    { name: 'status', label: 'Status', type: 'select', options: ['active', 'draft', 'discontinued'] },
    { name: 'track_stock', label: 'Track finished stock', type: 'checkbox', help: 'Custom cakes are made to order, so they normally do not hold stock.' },
    { name: 'image_url', label: 'Image URL', type: 'url', span: 2, placeholder: 'https://…' },
    { name: 'description', label: 'Description', type: 'textarea', span: 2, rows: 3 },
  ],
  columns: [
    {
      key: 'name', label: 'Product',
      render: (r) => `<div class="cell-main cell-product">
        ${r.image_url
          ? `<img src="${esc(r.image_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
          : `<span class="cell-product__placeholder">${icon('cake', 17)}</span>`}
        <span><strong>${esc(r.name)}</strong><small>${esc([r.sku, r.category, r.flavour].filter(Boolean).join(' · '))}</small></span>
      </div>`,
    },
    {
      key: 'kind', label: 'Type',
      value: (r) => r.kind === 'custom' ? 'Custom' : 'Catalogue',
      render: (r) => badge(r.kind === 'custom' ? 'Custom' : 'Catalogue', r.kind === 'custom' ? 'purple' : 'info'),
    },
    { key: 'category', label: 'Category' },
    { key: 'price', label: 'Price', className: 'num', render: (r) => money(r.price, { decimals: 0 }) },
    { key: 'cost_price', label: 'Cost', className: 'num', render: (r) => money(r.cost_price, { decimals: 0 }) },
    {
      key: 'margin', label: 'Margin',
      render: (r) => {
        const m = Number(r.price) > 0 ? ((Number(r.price) - Number(r.cost_price)) / Number(r.price)) * 100 : null;
        return m == null ? '<span class="muted">—</span>' : badge(pct(m), m >= 40 ? 'success' : m >= 20 ? 'warn' : 'danger');
      },
    },
    {
      key: 'stock_qty', label: 'Stock',
      render: (r) => {
        if (!r.track_stock) return badge('Made to order', 'purple');
        const low = Number(r.stock_qty) <= Number(r.low_stock_at ?? 5);
        return `<span class="stock-cell ${low ? 'is-low' : ''}">${num(r.stock_qty, 2)} <small>${esc(r.unit)}</small></span>`;
      },
    },
    {
      key: 'status', label: 'Status',
      render: (r) => badge(r.status || 'active', r.status === 'active' ? 'success' : r.status === 'draft' ? 'muted' : 'danger'),
    },
  ],
  beforeSave: (payload) => {
    if (payload.kind === 'custom') payload.track_stock = false;
    if (payload.opening_stock != null) delete payload.opening_stock;
  },
  async onAfterSave(saved, values, mode) {
    if (mode === 'create' && saved.track_stock && Number(values.opening_stock) > 0) {
      const { error } = await sb.rpc('adjust_stock', {
        p_ingredient: null,
        p_product: saved.id,
        p_qty: Number(values.opening_stock),
        p_reason: 'adjustment',
        p_note: 'Opening stock',
      });
      if (error) throw new Error(errText(error));
      dataChanged('stock_movements');
    }
  },
  rowActions: [
    {
      key: 'adjust',
      label: 'Adjust',
      icon: 'layers',
      title: 'Adjust stock',
      async run(row, { reload, openModal }) {
        openStockModal(row, reload, openModal);
        return false;
      },
    },
    {
      key: 'recalc',
      label: 'Recost',
      icon: 'refresh',
      title: 'Recalculate cost from recipe',
      show: (row) => row.kind === 'ready_made',
      async run(row) {
        const { error } = await sb.rpc('recalc_product_cost', { p_product: row.id });
        if (error) throw new Error(errText(error));
        toast(`Cost recalculated from the recipe.`);
        return true;
      },
    },
  ],
});

function openStockModal(row, reload, openModalFn) {
  let ref;
  const body = `<form id="stock-form" class="form-grid">
    <div class="field field--wide">
      <label>Current stock</label>
      <div class="static-value">${num(row.stock_qty, 2)} ${esc(row.unit)}</div>
    </div>
    <div class="field">
      <label for="stock_qty">Change quantity</label>
      <input id="stock_qty" name="qty" type="number" step="0.01" required placeholder="e.g. 6 or -2">
      <small class="field__help">Use a minus sign to reduce stock.</small>
    </div>
    <div class="field">
      <label for="stock_reason">Reason</label>
      <select id="stock_reason" name="reason">
        <option value="adjustment">Stock adjustment</option>
        <option value="wasted">Waste / spoilage</option>
        <option value="returned">Customer return</option>
      </select>
    </div>
    <div class="field field--wide">
      <label for="stock_note">Note</label>
      <input id="stock_note" name="note" type="text" placeholder="What happened?">
    </div>
    <div class="form-error" role="alert" hidden></div>
  </form>`;

  ref = openModalFn({
    title: `Adjust stock · ${row.name}`,
    body,
    footer: `<button class="btn btn--ghost" data-close>Cancel</button>
      <button class="btn btn--primary" type="submit" form="stock-form" data-ok>Apply</button>`,
    onOpen: (el, close) => {
      const form = el.querySelector('#stock-form');
      const btn = el.querySelector('[data-ok]');
      form.onsubmit = async (e) => {
        e.preventDefault();
        const err = el.querySelector('.form-error');
        err.hidden = true;
        const qty = Number(form.elements.qty.value);
        if (!qty) { err.textContent = 'Enter a non-zero quantity.'; err.hidden = false; return; }
        setBusy(btn, true, 'Applying…');
        try {
          const { error } = await sb.rpc('adjust_stock', {
            p_ingredient: null, p_product: row.id, p_qty: qty,
            p_reason: form.elements.reason.value,
            p_note: form.elements.note.value || null,
          });
          if (error) throw new Error(errText(error));
          toast('Stock adjusted and written to the ledger.');
          dataChanged('products');
          close();
          await reload();
        } catch (error) {
          err.textContent = error.message;
          err.hidden = false;
          setBusy(btn, false);
        }
      };
    },
  });
  return ref;
}
