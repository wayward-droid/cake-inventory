// Expenses: day-to-day spending, receipts and monthly totals.
import { sb, errText, dataChanged } from '../supabase.js';
import {
  esc, money, num, fmtDate, titleCase, badge, icon, toast, formModal, confirmDialog,
  emptyState, spinner, table, pager, today, monthStart, labelFor, exportModal,
} from '../ui.js';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from '../config.js';

const PAGE_SIZE = 25;

export async function render(root, params, ctx) {
  root.innerHTML = `<div class="route-loading">${spinner('Loading expenses…')}</div>`;

  let vendors = [], attachments = [];
  try {
    const [vRes, aRes] = await Promise.all([
      sb.from('vendors').select('*').is('deleted_at', null).order('name'),
      sb.from('attachments').select('*').eq('entity', 'expense'),
    ]);
    if (vRes.error) throw new Error(errText(vRes.error));
    if (aRes.error) throw new Error(errText(aRes.error));
    vendors = vRes.data || [];
    attachments = aRes.data || [];
  } catch (e) {
    root.innerHTML = `<div class="notice notice--danger">${icon('alert', 18)} ${esc(e.message)}</div>`;
    return;
  }
  const vendorMap = new Map(vendors.map((v) => [v.id, v]));
  const attachCount = new Map();
  for (const a of attachments) attachCount.set(a.entity_id, (attachCount.get(a.entity_id) || 0) + 1);

  const state = { page: 1, category: '', month: '', search: '', rows: [], total: 0 };
  const thisMonth = monthStart();

  root.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">Operations</p>
        <h1>Expenses</h1>
        <p class="page-sub">Rent, salaries, riders, power — everything that is not a cake.</p>
      </div>
      <div class="page-actions">
        <button class="btn btn--ghost" data-export>${icon('download', 17)} Export</button>
        <button class="btn btn--primary" data-new>${icon('plus', 17)} New expense</button>
      </div>
    </div>
    <div id="expense-summary"></div>
    <div class="expense-layout">
      <section class="card">
        <div class="toolbar">
          <div class="search-box">${icon('search', 17)}
            <input type="search" placeholder="Search description…" data-search>
          </div>
          <div class="toolbar__filters">
            <select data-filter="category" aria-label="Category">
              <option value="">Category: all</option>
              ${EXPENSE_CATEGORIES.map((c) => `<option value="${c.value}">${esc(c.label)}</option>`).join('')}
            </select>
            <input type="month" data-filter="month" aria-label="Month">
            <button class="icon-btn" data-refresh title="Refresh">${icon('refresh', 17)}</button>
          </div>
        </div>
        <div id="expense-table">${spinner()}</div>
        <div id="expense-pager"></div>
      </section>
      <aside id="expense-breakdown" class="expense-side"></aside>
    </div>`;

  const tableEl = root.querySelector('#expense-table');
  const pagerEl = root.querySelector('#expense-pager');
  const summaryEl = root.querySelector('#expense-summary');
  const breakdownEl = root.querySelector('#expense-breakdown');

  async function load() {
    tableEl.innerHTML = spinner();
    try {
      let q = sb.from('expenses').select('*', { count: 'exact' }).is('deleted_at', null);
      if (state.category) q = q.eq('category', state.category);
      if (state.month) {
        const [y, m] = state.month.split('-').map(Number);
        const start = `${state.month}-01`;
        const end = new Date(y, m, 0);
        const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
        q = q.gte('spent_on', start).lte('spent_on', endStr);
      }
      if (state.search) q = q.ilike('description', `%${state.search.replace(/[%,]/g, ' ')}%`);
      q = q.order('spent_on', { ascending: false });
      const from = (state.page - 1) * PAGE_SIZE;
      q = q.range(from, from + PAGE_SIZE - 1);
      const { data, error, count } = await q;
      if (error) throw new Error(errText(error));
      state.rows = data || [];
      state.total = count ?? state.rows.length;
      drawTable();
      pagerEl.innerHTML = pager(state.page, state.total, PAGE_SIZE);
      pagerEl.querySelectorAll('[data-page]').forEach((b) => {
        b.onclick = () => { state.page = Number(b.dataset.page); load(); };
      });
    } catch (e) {
      tableEl.innerHTML = `<div class="notice notice--danger">${icon('alert', 17)} ${esc(e.message)}</div>`;
    }
  }

  async function loadSummary() {
    try {
      const [allRes, monthRes] = await Promise.all([
        sb.from('expenses').select('*').is('deleted_at', null),
        sb.from('expenses').select('*').is('deleted_at', null).gte('spent_on', thisMonth),
      ]);
      if (allRes.error) throw new Error(errText(allRes.error));
      if (monthRes.error) throw new Error(errText(monthRes.error));
      const all = allRes.data || [];
      const month = monthRes.data || [];
      const monthTotal = month.reduce((s, e) => s + Number(e.amount), 0);
      const allTotal = all.reduce((s, e) => s + Number(e.amount), 0);

      const byCat = new Map();
      for (const e of month) byCat.set(e.category, (byCat.get(e.category) || 0) + Number(e.amount));
      const top = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];

      summaryEl.innerHTML = `<div class="mini-stats">
        <div class="mini-stat mini-stat--berry">
          <span class="mini-stat__icon">${icon('wallet', 17)}</span>
          <span><small>Spent this month</small><strong>${money(monthTotal, { decimals: 0 })}</strong></span>
        </div>
        <div class="mini-stat mini-stat--cocoa">
          <span class="mini-stat__icon">${icon('chart', 17)}</span>
          <span><small>All recorded</small><strong>${money(allTotal, { decimals: 0 })}</strong></span>
        </div>
        <div class="mini-stat mini-stat--caramel">
          <span class="mini-stat__icon">${icon('layers', 17)}</span>
          <span><small>Biggest category</small><strong>${esc(top ? labelFor(EXPENSE_CATEGORIES, top[0]) : '—')}</strong></span>
        </div>
        <div class="mini-stat mini-stat--purple">
          <span class="mini-stat__icon">${icon('clipboard', 17)}</span>
          <span><small>Entries this month</small><strong>${num(month.length)}</strong></span>
        </div>
      </div>`;

      const sorted = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
      const max = sorted[0]?.[1] || 1;
      breakdownEl.innerHTML = `<section class="card card--pad">
        <div class="card-head"><div><h2>This month</h2><p class="muted">By category</p></div>${icon('chart', 18)}</div>
        ${sorted.length ? `<div class="bar-list">${sorted.map(([cat, amount]) => `
          <div class="bar-row">
            <div class="bar-row__top"><span>${esc(labelFor(EXPENSE_CATEGORIES, cat))}</span><strong>${money(amount, { decimals: 0 })}</strong></div>
            <div class="bar"><span style="width:${Math.max(2, (amount / max) * 100)}%"></span></div>
          </div>`).join('')}</div>` : '<p class="muted">No expenses this month.</p>'}
      </section>
      <section class="card card--pad">
        <div class="card-head"><div><h2>Note</h2></div>${icon('sparkles', 18)}</div>
        <p class="muted small">Ingredient purchases are tracked under Purchases so stock and cost stay in sync. This page covers overheads and other spending.</p>
      </section>`;
    } catch (e) {
      summaryEl.innerHTML = `<div class="notice notice--danger">${icon('alert', 16)} ${esc(e.message)}</div>`;
    }
  }

  function drawTable() {
    if (!state.rows.length) {
      tableEl.innerHTML = emptyState({
        iconName: 'wallet', title: 'No expenses', text: 'Record rent, salaries, power, riders or packaging.',
        action: '<button class="btn btn--primary" data-new>New expense</button>',
      });
      tableEl.querySelector('[data-new]')?.addEventListener('click', () => openForm());
      return;
    }
    tableEl.innerHTML = table({
      columns: [
        { key: 'spent_on', label: 'Date', render: (e) => `<div class="cell-main"><strong>${esc(fmtDate(e.spent_on))}</strong><small>${esc(relativeMonth(e.spent_on))}</small></div>` },
        { key: 'description', label: 'Description', render: (e) => `<div class="cell-main"><strong>${esc(e.description)}</strong><small>${esc(e.note || '')}</small></div>` },
        { key: 'category', label: 'Category', render: (e) => badge(labelFor(EXPENSE_CATEGORIES, e.category), categoryTone(e.category)) },
        { key: 'vendor_id', label: 'Vendor', render: (e) => esc(vendorMap.get(e.vendor_id)?.name || '—') },
        { key: 'paid_via', label: 'Paid via', render: (e) => esc(labelFor(PAYMENT_METHODS, e.paid_via || 'cash')) },
        { key: 'amount', label: 'Amount', className: 'num', render: (e) => `<strong>${money(e.amount)}</strong>` },
        {
          key: '_receipt', label: 'Receipt', className: 'td-center',
          render: (e) => attachCount.get(e.id) ? `<span class="text-sage" title="Receipt attached">${icon('check', 16)}</span>` : '<span class="muted">—</span>',
        },
        {
          key: '_actions', label: '', className: 'td-actions', raw: true,
          render: (e) => `<div class="row-actions">
            <button class="icon-btn" data-edit="${esc(e.id)}" title="Edit">${icon('edit', 16)}</button>
            <button class="icon-btn icon-btn--danger" data-del="${esc(e.id)}" title="Archive">${icon('trash', 16)}</button>
          </div>`,
        },
      ],
      rows: state.rows,
    });
    tableEl.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openForm(state.rows.find((r) => r.id === b.dataset.edit))));
    tableEl.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => remove(state.rows.find((r) => r.id === b.dataset.del))));
  }

  function openForm(row = null) {
    const fields = [
      { name: 'description', label: 'Description', type: 'text', required: true, span: 2, placeholder: 'What was it for?' },
      { name: 'category', label: 'Category', type: 'select', options: EXPENSE_CATEGORIES, required: true },
      { name: 'amount', label: 'Amount', type: 'money', required: true, min: 0.01 },
      { name: 'spent_on', label: 'Date', type: 'date', required: true, default: today() },
      { name: 'paid_via', label: 'Paid via', type: 'select', options: PAYMENT_METHODS, default: 'cash' },
      { name: 'vendor_id', label: 'Vendor', type: 'select', options: vendors.map((v) => ({ value: v.id, label: v.name })) },
      { name: 'note', label: 'Note', type: 'text', span: 2 },
      { name: 'receipt', label: row ? 'Replace receipt' : 'Receipt', type: 'file', span: 2, accept: 'image/*,.pdf', help: 'Optional photo or PDF, stored with the expense.' },
    ];

    formModal({
      title: row ? 'Edit expense' : 'New expense',
      wide: true,
      fields,
      values: row || {},
      submitLabel: row ? 'Save changes' : 'Record expense',
      onSubmit: async (data) => {
        const payload = {
          description: data.description, category: data.category,
          amount: Number(data.amount), spent_on: data.spent_on,
          paid_via: data.paid_via, vendor_id: data.vendor_id || null,
          note: data.note, created_by: ctx.profile.id,
        };
        let saved;
        if (row) {
          const { data: updated, error } = await sb.from('expenses').update(payload).eq('id', row.id).select().single();
          if (error) throw new Error(errText(error));
          saved = updated;
        } else {
          const { data: inserted, error } = await sb.from('expenses').insert(payload).select().single();
          if (error) throw new Error(errText(error));
          saved = inserted;
        }
        if (data.receipt) {
          const file = data.receipt;
          const path = `expense/${saved.id}/${Date.now()}-${file.name.replace(/\s+/g, '-')}`;
          const { error: upErr } = await sb.storage.from('cake-files').upload(path, file);
          if (upErr) throw new Error(`Receipt upload failed: ${errText(upErr)}`);
          const { error: attErr } = await sb.from('attachments').insert({
            entity: 'expense', entity_id: saved.id, file_path: path,
            file_name: file.name, mime_type: file.type, size_bytes: file.size,
          });
          if (attErr) throw new Error(errText(attErr));
          attachCount.set(saved.id, (attachCount.get(saved.id) || 0) + 1);
        }
        dataChanged('expenses');
        toast(row ? 'Expense updated.' : 'Expense recorded.');
        await Promise.all([load(), loadSummary()]);
      },
    });
  }

  async function remove(row) {
    if (!row) return;
    const ok = await confirmDialog({
      title: 'Archive this expense?',
      message: 'It disappears from lists and totals but stays in the audit log. The owner can restore it from Admin → Trash.',
      confirmText: 'Archive', danger: true,
    });
    if (!ok) return;
    const { error } = await sb.from('expenses').update({ deleted_at: new Date().toISOString() }).eq('id', row.id);
    if (error) { toast(errText(error), 'error'); return; }
    dataChanged('expenses');
    toast('Expense archived.');
    await Promise.all([load(), loadSummary()]);
  }

  let timer;
  root.querySelector('[data-search]').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.search = e.target.value.trim(); state.page = 1; load(); }, 260);
  });
  root.querySelectorAll('[data-filter]').forEach((el) => el.addEventListener('change', () => {
    state[el.dataset.filter] = el.value;
    state.page = 1;
    load();
  }));
  root.querySelector('[data-refresh]').addEventListener('click', () => { load(); loadSummary(); });
  root.querySelector('[data-new]').addEventListener('click', () => openForm());
  root.querySelector('[data-export]').addEventListener('click', async () => {
    try {
      const { data, error } = await sb.from('expenses').select('*').is('deleted_at', null).order('spent_on', { ascending: false });
      if (error) throw new Error(errText(error));
      exportModal({
        title: 'Expenses',
        filename: `expenses-${today()}`,
        rows: data || [],
        columns: [
          { key: 'spent_on', label: 'Date', value: (r) => fmtDate(r.spent_on) },
          { key: 'description', label: 'Description' },
          { key: 'category', label: 'Category', value: (r) => labelFor(EXPENSE_CATEGORIES, r.category) },
          { key: 'amount', label: 'Amount', className: 'num' },
          { key: 'paid_via', label: 'Paid via', value: (r) => labelFor(PAYMENT_METHODS, r.paid_via) },
          { key: 'note', label: 'Note' },
        ],
        meta: 'All recorded expenses',
      });
    } catch (e) { toast(e.message, 'error'); }
  });

  await Promise.all([load(), loadSummary()]);
}

function relativeMonth(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-NG', { month: 'short', year: 'numeric' });
}

function categoryTone(category) {
  switch (category) {
    case 'ingredients': return 'sage';
    case 'logistics': return 'info';
    case 'salaries': return 'purple';
    case 'rent': return 'cocoa';
    case 'utilities': return 'warn';
    case 'marketing': return 'berry';
    case 'equipment': return 'danger';
    default: return 'muted';
  }
}
