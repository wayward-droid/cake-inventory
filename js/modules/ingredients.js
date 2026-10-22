// Raw ingredient stock.
import { sb, errText, dataChanged } from '../supabase.js';
import { defineCrudModule } from '../crud.js';
import {
  esc, money, num, badge, icon, toast, openModal, setBusy, confirmDialog,
} from '../ui.js';

export const ingredients = defineCrudModule({
  table: 'ingredients',
  title: 'Ingredients',
  singular: 'ingredient',
  eyebrow: 'Inventory',
  subtitle: 'What goes into the cakes — stock, cost and reorder points.',
  ownerOnly: true,
  exportable: true,
  searchFields: ['name', 'category', 'unit'],
  searchPlaceholder: 'Search ingredients…',
  order: { column: 'name', ascending: true },
  defaults: { unit: 'kg', cost_per_unit: 0 },
  fields: [
    { name: 'name', label: 'Ingredient', type: 'text', required: true, span: 2, placeholder: 'e.g. Plain flour' },
    { name: 'category', label: 'Category', type: 'text', placeholder: 'Baking, dairy, packaging…' },
    { name: 'unit', label: 'Base unit', type: 'text', required: true, placeholder: 'kg, litre, piece' },
    { name: 'cost_per_unit', label: 'Cost per base unit', type: 'money' },
    { name: 'opening_stock', label: 'Opening stock', type: 'number', createOnly: true, min: 0, help: 'Written to the stock ledger so reports reconcile.' },
    { name: 'low_stock_at', label: 'Low-stock level', type: 'number', min: 0 },
    { name: 'vendor_id', label: 'Preferred vendor', type: 'select', optionsFrom: { table: 'vendors', label: 'name' } },
    { name: 'notes', label: 'Notes', type: 'textarea', span: 2, rows: 2 },
  ],
  columns: [
    {
      key: 'name', label: 'Ingredient',
      render: (r) => `<div class="cell-main"><strong>${esc(r.name)}</strong><small>${esc(r.category || 'Uncategorised')}</small></div>`,
    },
    {
      key: 'stock_qty', label: 'In stock',
      render: (r) => {
        const low = Number(r.stock_qty) <= Number(r.low_stock_at ?? 5);
        return `<span class="stock-cell ${low ? 'is-low' : ''}">${num(r.stock_qty, 2)} <small>${esc(r.unit)}</small></span>
          ${low ? badge('Low', 'danger') : ''}`;
      },
    },
    { key: 'cost_per_unit', label: 'Cost / unit', render: (r) => `${money(r.cost_per_unit, { decimals: 2 })}<small class="cell-sub">per ${esc(r.unit)}</small>` },
    { key: 'value', label: 'Stock value', render: (r) => money(Number(r.stock_qty) * Number(r.cost_per_unit), { decimals: 0 }) },
    {
      key: 'vendor_id', label: 'Vendor',
      render: (r) => r.vendor_id ? `<span data-vendor="${esc(r.vendor_id)}">…</span>` : '<span class="muted">—</span>',
    },
    {
      key: 'reorder', label: 'Reorder at',
      render: (r) => r.low_stock_at == null ? '<span class="muted">—</span>' : `${num(r.low_stock_at, 2)} ${esc(r.unit)}`,
    },
  ],
  async onLoad({ rows, root, lookups }) {
    const vendors = lookups.vendors || [];
    const map = new Map(vendors.map((v) => [v.id, v.name]));
    root.querySelectorAll('[data-vendor]').forEach((el) => {
      el.textContent = map.get(el.dataset.vendor) || '—';
    });
    const totalValue = rows.reduce((s, r) => s + Number(r.stock_qty) * Number(r.cost_per_unit), 0);
    const low = rows.filter((r) => Number(r.stock_qty) <= Number(r.low_stock_at ?? 5)).length;
    const summary = root.querySelector('#crud-summary');
    if (summary) {
      summary.innerHTML = `<div class="mini-stats">
        <div><span>Page stock value</span><strong>${money(totalValue, { decimals: 0 })}</strong></div>
        <div><span>Low on this page</span><strong>${low}</strong></div>
        <div><span>Ingredients on this page</span><strong>${rows.length}</strong></div>
      </div>`;
    }
  },
  beforeSave: (payload) => { delete payload.opening_stock; },
  async onAfterSave(saved, values, mode) {
    if (mode === 'create' && Number(values.opening_stock) > 0) {
      const { error } = await sb.rpc('adjust_stock', {
        p_ingredient: saved.id, p_product: null, p_qty: Number(values.opening_stock),
        p_reason: 'adjustment', p_note: 'Opening stock',
      });
      if (error) throw new Error(errText(error));
      dataChanged('stock_movements');
    }
  },
  rowActions: [
    {
      key: 'adjust', label: 'Adjust', icon: 'layers', title: 'Adjust stock',
      async run(row, { reload, openModal }) {
        openAdjustModal(row, reload, openModal);
        return false;
      },
    },
    {
      key: 'units', label: 'Units', icon: 'layers', title: 'Unit conversions',
      async run(row, { reload, openModal }) {
        openUnitsModal(row, reload, openModal);
        return false;
      },
    },
  ],
});

function openAdjustModal(row, reload, openModalFn) {
  openModalFn({
    title: `Adjust stock · ${row.name}`,
    body: `<form id="ing-adjust" class="form-grid">
      <div class="field field--wide"><label>Current stock</label>
        <div class="static-value">${num(row.stock_qty, 2)} ${esc(row.unit)}</div></div>
      <div class="field"><label for="ia_qty">Change quantity</label>
        <input id="ia_qty" name="qty" type="number" step="0.01" required placeholder="e.g. 5 or -1.5">
        <small class="field__help">Minus reduces stock. Every change is ledgered.</small></div>
      <div class="field"><label for="ia_reason">Reason</label>
        <select id="ia_reason" name="reason">
          <option value="adjustment">Stock adjustment</option>
          <option value="wasted">Waste / spoilage</option>
          <option value="returned">Return to stock</option>
        </select></div>
      <div class="field field--wide"><label for="ia_note">Note</label>
        <input id="ia_note" name="note" type="text" placeholder="What happened?"></div>
      <div class="form-error" role="alert" hidden></div>
    </form>`,
    footer: `<button class="btn btn--ghost" data-close>Cancel</button>
      <button class="btn btn--primary" type="submit" form="ing-adjust" data-ok>Apply</button>`,
    onOpen: (el, close) => {
      const form = el.querySelector('#ing-adjust');
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
            p_ingredient: row.id, p_product: null, p_qty: qty,
            p_reason: form.elements.reason.value,
            p_note: form.elements.note.value || null,
          });
          if (error) throw new Error(errText(error));
          toast('Stock adjusted.');
          dataChanged('ingredients');
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
}

async function openUnitsModal(row, reload, openModalFn) {
  const renderBody = async () => {
    const { data, error } = await sb.from('unit_conversions').select('*').eq('ingredient_id', row.id).order('from_unit');
    if (error) throw new Error(errText(error));
    return `<div class="form-grid">
      <div class="field field--wide">
        <label>Conversions for ${esc(row.name)}</label>
        <p class="field__help">Buy in bags or cartons, consume in ${esc(row.unit)}. Purchases store the converted base quantity.</p>
      </div>
      <div class="field field--wide">
        ${(data || []).length ? `<div class="unit-list">${(data || []).map((u) => `
          <div class="unit-row">
            <span>1 <strong>${esc(u.from_unit)}</strong> = <strong>${num(u.factor, 3)} ${esc(u.to_unit)}</strong></span>
            <button class="icon-btn icon-btn--danger" data-del="${esc(u.id)}" title="Remove">${icon('trash', 15)}</button>
          </div>`).join('')}</div>` : '<div class="notice">No conversions yet. Add one below.</div>'}
      </div>
      <div class="field"><label for="uc_from">Buy in</label><input id="uc_from" value="bag" placeholder="bag"></div>
      <div class="field"><label for="uc_factor">Equals</label><input id="uc_factor" type="number" step="any" value="50"></div>
      <div class="field"><label for="uc_to">Base unit</label><input id="uc_to" value="${esc(row.unit)}" readonly></div>
      <div class="form-error" role="alert" hidden></div>
    </div>`;
  };

  const body = await renderBody();
  openModalFn({
    title: `Unit conversions · ${row.name}`,
    body,
    footer: `<button class="btn btn--ghost" data-close>Close</button>
      <button class="btn btn--primary" data-add>Add conversion</button>`,
    onOpen: async (el, close) => {
      const errBox = el.querySelector('.form-error');
      el.querySelectorAll('[data-del]').forEach((b) => {
        b.onclick = async () => {
          if (!(await confirmDialog({ title: 'Remove conversion?', message: 'Past purchases are not affected.', confirmText: 'Remove', danger: true }))) return;
          const { error } = await sb.from('unit_conversions').delete().eq('id', b.dataset.del);
          if (error) { toast(errText(error), 'error'); return; }
          close();
          await reload();
        };
      });
      el.querySelector('[data-add]').onclick = async (e) => {
        errBox.hidden = true;
        const from = el.querySelector('#uc_from').value.trim();
        const to = el.querySelector('#uc_to').value.trim();
        const factor = Number(el.querySelector('#uc_factor').value);
        if (!from || !to || !factor) { errBox.textContent = 'Fill in the unit and factor.'; errBox.hidden = false; return; }
        setBusy(e.target, true, 'Adding…');
        const { error } = await sb.from('unit_conversions').insert({
          ingredient_id: row.id, from_unit: from, to_unit: to, factor,
        });
        if (error) {
          errBox.textContent = errText(error); errBox.hidden = false; setBusy(e.target, false); return;
        }
        toast('Conversion added.');
        close();
        await reload();
      };
    },
  });
}
