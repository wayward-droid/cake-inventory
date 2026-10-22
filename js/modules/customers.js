// Customers: directory, history and privacy controls.
import { sb, errText, dataChanged } from '../supabase.js';
import {
  esc, money, num, fmtDate, relativeTime, titleCase, badge, icon, toast, openModal,
  formModal, confirmDialog, emptyState, spinner, table, exportModal, today,
} from '../ui.js';
import { CHANNELS } from '../config.js';

export async function render(root, params, ctx) {
  if (params[0]) return renderDetail(root, params[0], ctx);
  return renderList(root, ctx);
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
async function renderList(root, ctx) {
  root.innerHTML = `<div class="route-loading">${spinner('Loading customers…')}</div>`;

  let rows = [];
  try {
    const { data, error } = await sb.from('v_customer_history').select('*');
    if (error) throw new Error(errText(error));
    rows = data || [];
  } catch (e) {
    root.innerHTML = `<div class="notice notice--danger">${icon('alert', 18)} ${esc(e.message)}</div>`;
    return;
  }

  let search = '';
  let sort = 'spent';

  function draw() {
    const filtered = rows
      .filter((r) => !search || [r.name, r.phone, r.city, r.state].some((v) => String(v || '').toLowerCase().includes(search.toLowerCase())))
      .sort((a, b) => {
        if (sort === 'name') return String(a.name).localeCompare(String(b.name));
        if (sort === 'recent') return String(b.last_order_at || '').localeCompare(String(a.last_order_at || ''));
        if (sort === 'orders') return Number(b.orders) - Number(a.orders);
        return Number(b.lifetime_spend) - Number(a.lifetime_spend);
      });

    const spend = rows.reduce((s, r) => s + Number(r.lifetime_spend || 0), 0);
    const repeat = rows.filter((r) => Number(r.orders) > 1).length;

    root.innerHTML = `
      <div class="page-head">
        <div>
          <p class="eyebrow">Relationships</p>
          <h1>Customers</h1>
          <p class="page-sub">Who buys, what they spend and when they last ordered.</p>
        </div>
        <div class="page-actions">
          <button class="btn btn--ghost" data-export>${icon('download', 17)} Export</button>
          <a class="btn btn--primary" href="#/orders/new">${icon('plus', 17)} New order</a>
        </div>
      </div>

      <div class="mini-stats">
        <div class="mini-stat mini-stat--berry">
          <span class="mini-stat__icon">${icon('users', 17)}</span>
          <span><small>Customers</small><strong>${num(rows.length)}</strong></span>
        </div>
        <div class="mini-stat mini-stat--sage">
          <span class="mini-stat__icon">${icon('wallet', 17)}</span>
          <span><small>Lifetime spend</small><strong>${money(spend, { decimals: 0 })}</strong></span>
        </div>
        <div class="mini-stat mini-stat--purple">
          <span class="mini-stat__icon">${icon('refresh', 17)}</span>
          <span><small>Repeat buyers</small><strong>${num(repeat)}</strong></span>
        </div>
        <div class="mini-stat mini-stat--caramel">
          <span class="mini-stat__icon">${icon('chart', 17)}</span>
          <span><small>Average spend</small><strong>${money(rows.length ? spend / rows.length : 0, { decimals: 0 })}</strong></span>
        </div>
      </div>

      <section class="card">
        <div class="toolbar">
          <div class="search-box">
            ${icon('search', 17)}
            <input type="search" placeholder="Search name, phone, city…" data-search value="${esc(search)}">
          </div>
          <div class="toolbar__filters">
            <select data-sort aria-label="Sort">
              <option value="spent" ${sort === 'spent' ? 'selected' : ''}>Top spend</option>
              <option value="recent" ${sort === 'recent' ? 'selected' : ''}>Most recent</option>
              <option value="orders" ${sort === 'orders' ? 'selected' : ''}>Most orders</option>
              <option value="name" ${sort === 'name' ? 'selected' : ''}>Name A–Z</option>
            </select>
            <button class="icon-btn" data-refresh title="Refresh">${icon('refresh', 17)}</button>
          </div>
        </div>
        <div id="customers-table">
          ${filtered.length ? table({
            columns: [
              {
                key: 'name', label: 'Customer',
                render: (r) => `<div class="cell-main"><strong>${esc(r.name)}</strong><small>${esc(r.phone || 'No phone')}</small></div>`,
              },
              {
                key: 'location', label: 'Location',
                render: (r) => esc([r.city, r.state].filter(Boolean).join(', ') || '—'),
              },
              {
                key: 'channel', label: 'Channel',
                render: (r) => badge(titleCase(r.channel || 'walk_in'), 'muted'),
              },
              { key: 'orders', label: 'Orders', className: 'num', render: (r) => num(r.orders) },
              {
                key: 'lifetime_spend', label: 'Lifetime spend', className: 'num',
                render: (r) => `<strong>${money(r.lifetime_spend, { decimals: 0 })}</strong>`,
              },
              {
                key: 'last_order_at', label: 'Last order',
                render: (r) => r.last_order_at ? `<span title="${esc(fmtDate(r.last_order_at))}">${esc(relativeTime(r.last_order_at))}</span>` : '<span class="muted">Never</span>',
              },
            ],
            rows: filtered,
            rowKey: 'customer_id',
            empty: 'No customers match that search.',
            onRowAttrs: (r) => `data-href="#/customers/${esc(r.customer_id)}" tabindex="0" style="cursor:pointer"`,
          }) : emptyState({
            iconName: 'users', title: search ? 'No matches' : 'No customers yet',
            text: search ? 'Try a different name or phone number.' : 'Customers are created automatically with their first order.',
            action: '<a class="btn btn--primary" href="#/orders/new">New order</a>',
          })}
        </div>
      </section>`;

    const searchEl = root.querySelector('[data-search]');
    searchEl.addEventListener('input', () => {
      search = searchEl.value;
      const pos = searchEl.selectionStart;
      draw();
      const el = root.querySelector('[data-search]');
      el.focus();
      el.setSelectionRange(pos, pos);
    });
    root.querySelector('[data-sort]').addEventListener('change', (e) => { sort = e.target.value; draw(); });
    root.querySelector('[data-refresh]').addEventListener('click', () => renderList(root, ctx));
    root.querySelector('[data-export]').addEventListener('click', () => {
      exportModal({
        title: 'Customers',
        filename: `customers-${today()}`,
        rows: filtered,
        columns: [
          { key: 'name', label: 'Customer' },
          { key: 'phone', label: 'Phone' },
          { key: 'city', label: 'City' },
          { key: 'state', label: 'State' },
          { key: 'orders', label: 'Orders', className: 'num' },
          { key: 'lifetime_spend', label: 'Lifetime spend', className: 'num' },
          { key: 'last_order_at', label: 'Last order', value: (r) => r.last_order_at ? fmtDate(r.last_order_at) : 'Never' },
        ],
        meta: filtered.length === rows.length ? 'All customers' : 'Filtered customer list',
      });
    });

    root.querySelectorAll('tr[data-href]').forEach((tr) => {
      const go = () => { location.hash = tr.dataset.href; };
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    });
  }

  draw();
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------
async function renderDetail(root, id, ctx) {
  root.innerHTML = `<div class="route-loading">${spinner('Loading customer…')}</div>`;
  const { isOwner } = ctx;

  let customer, orders = [], balances = [];
  try {
    const cRes = await sb.from('customers').select('*').eq('id', id).single();
    if (cRes.error) throw new Error(errText(cRes.error));
    customer = cRes.data;
    const [oRes, bRes] = await Promise.all([
      sb.from('orders').select('*').eq('customer_id', id).is('deleted_at', null).order('created_at', { ascending: false }),
      sb.from('v_order_balances').select('*'),
    ]);
    if (oRes.error) throw new Error(errText(oRes.error));
    if (bRes.error) throw new Error(errText(bRes.error));
    orders = oRes.data || [];
    balances = (bRes.data || []).filter((b) => orders.some((o) => o.id === b.id));
  } catch (e) {
    root.innerHTML = `<div class="notice notice--danger">${icon('alert', 18)} ${esc(e.message)}</div>`;
    return;
  }

  function draw() {
    const completed = orders.filter((o) => o.status === 'completed');
    const spend = completed.reduce((s, o) => s + Number(o.total), 0);
    const outstanding = balances.reduce((s, b) => s + Number(b.balance), 0);
    const avg = completed.length ? spend / completed.length : 0;
    const last = orders[0];
    const anonymised = !!customer.anonymized_at;

    root.innerHTML = `
      <div class="page-head">
        <div>
          <p class="eyebrow"><a class="link" href="#/customers">${icon('arrow', 13)} All customers</a> · Profile</p>
          <h1>${esc(customer.name)}</h1>
          <p class="page-sub">${esc(customer.phone || 'No phone')}${customer.email ? ` · ${esc(customer.email)}` : ''}${anonymised ? ' · anonymised' : ''}</p>
        </div>
        <div class="page-actions">
          ${!anonymised ? `<a class="btn btn--primary" href="#/orders/new?customer=${esc(customer.id)}">${icon('plus', 17)} New order</a>` : ''}
          <button class="btn btn--ghost" data-edit>${icon('edit', 17)} Edit</button>
          ${isOwner && !anonymised ? `<button class="btn btn--ghost" data-anonymise>${icon('lock', 17)} Anonymise</button>` : ''}
        </div>
      </div>

      ${anonymised ? `<div class="notice">${icon('lock', 17)} Personal details were anonymised on ${esc(fmtDate(customer.anonymized_at))}. Order history is retained for accounting.</div>` : ''}

      <div class="mini-stats">
        <div class="mini-stat mini-stat--sage">
          <span class="mini-stat__icon">${icon('wallet', 17)}</span>
          <span><small>Lifetime spend</small><strong>${money(spend, { decimals: 0 })}</strong></span>
        </div>
        <div class="mini-stat mini-stat--berry">
          <span class="mini-stat__icon">${icon('bag', 17)}</span>
          <span><small>Orders</small><strong>${num(orders.length)}</strong></span>
        </div>
        <div class="mini-stat mini-stat--caramel">
          <span class="mini-stat__icon">${icon('chart', 17)}</span>
          <span><small>Average order</small><strong>${money(avg, { decimals: 0 })}</strong></span>
        </div>
        <div class="mini-stat mini-stat--${outstanding > 0 ? 'danger' : 'purple'}">
          <span class="mini-stat__icon">${icon('clock', 17)}</span>
          <span><small>Outstanding</small><strong>${money(outstanding, { decimals: 0 })}</strong></span>
        </div>
      </div>

      <div class="customer-layout">
        <section class="card">
          <div class="card-head card-head--pad">
            <div><h2>Order history</h2><p class="muted">${orders.length} order${orders.length === 1 ? '' : 's'} · newest first</p></div>
          </div>
          ${orders.length ? `<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Order</th><th>Placed</th><th>Due</th><th class="num">Total</th><th class="num">Balance</th><th>Status</th></tr></thead>
            <tbody>${orders.map((o) => {
              const bal = Number(o.total) - Number(o.amount_paid);
              return `<tr data-href="#/orders/${esc(o.id)}" tabindex="0" style="cursor:pointer">
                <td><strong>${esc(o.order_no)}</strong></td>
                <td>${esc(fmtDate(o.created_at))}</td>
                <td>${esc(fmtDate(o.delivery_date))}</td>
                <td class="num">${money(o.total, { decimals: 0 })}</td>
                <td class="num">${bal > 0.004 ? `<span class="text-danger">${money(bal, { decimals: 0 })}</span>` : '<span class="text-sage">Settled</span>'}</td>
                <td>${badge(titleCase(o.status), o.status === 'completed' ? 'success' : o.status === 'cancelled' ? 'danger' : 'info')}</td>
              </tr>`;
            }).join('')}</tbody></table></div>`
            : emptyState({ iconName: 'bag', title: 'No orders yet', text: 'Create their first order to start a history.', action: anonymised ? '' : `<a class="btn btn--primary" href="#/orders/new?customer=${esc(customer.id)}">New order</a>` })}
        </section>

        <aside class="customer-side">
          <section class="card card--pad">
            <div class="card-head"><div><h2>Contact</h2></div>${icon('phone', 18)}</div>
            <dl class="detail-list">
              <div><dt>Phone</dt><dd>${esc(customer.phone || '—')}</dd></div>
              <div><dt>Email</dt><dd>${esc(customer.email || '—')}</dd></div>
              <div><dt>Channel</dt><dd>${esc(titleCase(customer.channel || 'walk_in'))}</dd></div>
              <div><dt>Address</dt><dd>${esc([customer.address, customer.city, customer.state].filter(Boolean).join(', ') || '—')}</dd></div>
              <div><dt>Customer since</dt><dd>${esc(fmtDate(customer.created_at))}</dd></div>
              ${last ? `<div><dt>Last order</dt><dd>${esc(fmtDate(last.created_at))}</dd></div>` : ''}
            </dl>
            ${customer.phone && !anonymised ? `<a class="btn btn--ghost btn--block" href="tel:${esc(customer.phone)}">${icon('phone', 16)} Call</a>` : ''}
          </section>

          <section class="card card--pad">
            <div class="card-head"><div><h2>Notes</h2></div><button class="icon-btn" data-edit title="Edit">${icon('edit', 16)}</button></div>
            ${customer.notes ? `<p class="prose">${esc(customer.notes).replace(/\n/g, '<br>')}</p>` : '<p class="muted">No notes yet. Add preferences, allergies or delivery quirks.</p>'}
          </section>

          ${outstanding > 0 ? `<section class="card card--pad">
            <div class="card-head"><div><h2>Outstanding</h2></div>${icon('clock', 18)}</div>
            <div class="balance-list">${balances.map((b) => `<a class="balance-row" href="#/orders/${esc(b.id)}">
              <span><strong>${esc(b.order_no)}</strong><small>Balance</small></span>
              <strong class="text-danger">${money(b.balance, { decimals: 0 })}</strong>
            </a>`).join('')}</div>
          </section>` : ''}
        </aside>
      </div>`;

    root.querySelectorAll('tr[data-href]').forEach((tr) => {
      const go = () => { location.hash = tr.dataset.href; };
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    });
    root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', editCustomer));
    root.querySelector('[data-anonymise]')?.addEventListener('click', anonymiseCustomer);
  }

  function editCustomer() {
    formModal({
      title: `Edit ${customer.name}`,
      wide: true,
      fields: [
        { name: 'name', label: 'Full name', type: 'text', required: true, span: 2 },
        { name: 'phone', label: 'Phone', type: 'tel' },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'channel', label: 'Preferred channel', type: 'select', options: CHANNELS },
        { name: 'notes', label: 'Notes', type: 'textarea', span: 2, rows: 3 },
        { name: 'address', label: 'Address', type: 'text', span: 2 },
        { name: 'city', label: 'City', type: 'text' },
        { name: 'state', label: 'State', type: 'text' },
      ],
      values: customer,
      submitLabel: 'Save changes',
      onSubmit: async (data) => {
        const { error } = await sb.from('customers').update(data).eq('id', customer.id);
        if (error) throw new Error(errText(error));
        dataChanged('customers');
        toast('Customer updated.');
        Object.assign(customer, data);
        draw();
      },
    });
  }

  async function anonymiseCustomer() {
    const ok = await confirmDialog({
      title: 'Anonymise this customer?',
      message: 'Name, phone, email and address are replaced with neutral values. Orders and totals stay for accounting. This cannot be undone.',
      confirmText: 'Anonymise', danger: true,
    });
    if (!ok) return;
    const { error } = await sb.from('customers').update({
      name: 'Anonymised customer',
      phone: null, email: null, address: null, city: null, state: null,
      notes: null, anonymized_at: new Date().toISOString(),
    }).eq('id', customer.id);
    if (error) { toast(errText(error), 'error'); return; }
    dataChanged('customers');
    toast('Customer anonymised.');
    renderDetail(root, id, ctx);
  }

  draw();
}
