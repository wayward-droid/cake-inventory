// Vendors / suppliers.
import { sb, errText } from '../supabase.js';
import { defineCrudModule } from '../crud.js';
import { esc, money, badge, icon } from '../ui.js';

export const vendors = defineCrudModule({
  table: 'vendors',
  title: 'Vendors',
  singular: 'vendor',
  eyebrow: 'Purchasing',
  subtitle: 'Who supplies your flour, dairy, packaging and equipment.',
  ownerOnly: true,
  exportable: true,
  searchFields: ['name', 'contact_person', 'phone', 'supplies'],
  searchPlaceholder: 'Search vendors…',
  order: { column: 'name', ascending: true },
  fields: [
    { name: 'name', label: 'Vendor name', type: 'text', required: true, span: 2 },
    { name: 'contact_person', label: 'Contact person', type: 'text' },
    { name: 'phone', label: 'Phone', type: 'tel' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'address', label: 'Address', type: 'text' },
    { name: 'supplies', label: 'What they supply', type: 'text', span: 2, placeholder: 'Flour, sugar, cocoa' },
    { name: 'notes', label: 'Notes', type: 'textarea', span: 2, rows: 2 },
  ],
  columns: [
    {
      key: 'name', label: 'Vendor',
      render: (r) => `<div class="cell-main"><strong>${esc(r.name)}</strong><small>${esc(r.supplies || r.contact_person || '')}</small></div>`,
    },
    { key: 'contact_person', label: 'Contact' },
    { key: 'phone', label: 'Phone', render: (r) => r.phone ? `<a class="link" href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : '—' },
    { key: 'email', label: 'Email', render: (r) => r.email ? `<a class="link" href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : '—' },
    { key: 'balance', label: 'Owed', render: (r) => `<span data-owed="${esc(r.id)}">…</span>` },
  ],
  async onLoad({ rows, root }) {
    try {
      const { data } = await sb.from('v_vendor_payables').select('*');
      const map = new Map((data || []).map((x) => [x.id, Number(x.balance || 0)]));
      root.querySelectorAll('[data-owed]').forEach((el) => {
        const bal = map.get(el.dataset.owed) ?? 0;
        el.innerHTML = bal > 0 ? `<span class="text-danger">${money(bal, { decimals: 0 })}</span>` : '<span class="muted">Settled</span>';
      });
      const total = [...map.values()].reduce((s, v) => s + v, 0);
      const summary = root.querySelector('#crud-summary');
      if (summary) {
        summary.innerHTML = `<div class="mini-stats">
          <div><span>Total owed to vendors</span><strong>${money(total, { decimals: 0 })}</strong></div>
          <div><span>Vendors on this page</span><strong>${rows.length}</strong></div>
        </div>`;
      }
    } catch { /* the payable view is optional */ }
  },
});
