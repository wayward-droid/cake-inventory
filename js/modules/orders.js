// Orders: quotes, sales, payments, documents and the fulfilment pipeline.
import { sb, errText, dataChanged } from '../supabase.js';
import {
  esc, money, num, fmtDate, fmtDateTime, relativeTime, titleCase, statusBadge, badge,
  icon, toast, openModal, formModal, confirmDialog, emptyState, spinner, pager,
  setBusy, printHTML, today, addDays, labelFor, exportModal,
} from '../ui.js';
import {
  CHANNELS, ORDER_STATUSES, STATUS_FLOW, FULFILMENTS, PAYMENT_METHODS, ORDER_KINDS,
} from '../config.js';
import { itemPickerHTML, wireItemPicker } from '../item-picker.js';

const PAGE_SIZE = 20;

export async function render(root, params, ctx) {
  if (params[0] === 'new') return renderNew(root, ctx);
  if (params[0]) return renderDetail(root, params[0], ctx);
  return renderList(root, ctx);
}

export async function renderQuotes(root, params, ctx) {
  return renderList(root, ctx, {
    status: 'quote',
    title: 'Quotes',
    eyebrow: 'Sales',
    subtitle: 'Open enquiries and priced proposals waiting for a yes.',
    newLabel: 'New quote',
    newHref: '#/orders/new?quote=1',
    searchPlaceholder: 'Search quote number or note…',
  });
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
async function renderList(root, ctx, options = {}) {
  const q = new URLSearchParams((location.hash.split('?')[1] || ''));
  const state = {
    page: 1, status: options.status ?? (q.get('status') || ''), channel: q.get('channel') || '',
    fulfilment: q.get('fulfilment') || '', search: q.get('q') || '', rows: [], total: 0,
  };
  let customers = [];
  let paymentsByOrder = new Map();

  root.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">${esc(options.eyebrow || 'Sales')}</p>
        <h1>${esc(options.title || 'Orders')}</h1>
        <p class="page-sub">${esc(options.subtitle || 'Every quote, cake and deposit in one place.')}</p>
      </div>
      <div class="page-actions">
        <button class="btn btn--ghost" data-export>${icon('download', 17)} Export</button>
        <a class="btn btn--primary" href="${esc(options.newHref || '#/orders/new')}">${icon('plus', 17)} ${esc(options.newLabel || 'New order')}</a>
      </div>
    </div>
    <div id="order-stats" class="mini-stats"></div>
    <section class="card">
      <div class="toolbar">
        <div class="search-box">
          ${icon('search', 17)}
          <input type="search" placeholder="${esc(options.searchPlaceholder || 'Search order number or note…')}" data-search value="${esc(state.search)}">
        </div>
        <div class="toolbar__filters">
          ${options.status ? '' : `<select data-filter="status" aria-label="Status">
            <option value="">Status: all</option>
            ${ORDER_STATUSES.map((s) => `<option value="${s.value}" ${state.status === s.value ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
          </select>`}
          <select data-filter="channel" aria-label="Channel">
            <option value="">Channel: all</option>
            ${CHANNELS.map((c) => `<option value="${c.value}" ${state.channel === c.value ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
          </select>
          <select data-filter="fulfilment" aria-label="Fulfilment">
            <option value="">Fulfilment: all</option>
            ${FULFILMENTS.map((f) => `<option value="${f.value}" ${state.fulfilment === f.value ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}
          </select>
          <button class="icon-btn" data-refresh title="Refresh">${icon('refresh', 17)}</button>
        </div>
      </div>
      <div id="orders-table">${spinner('Loading orders…')}</div>
      <div id="orders-pager"></div>
    </section>`;

  const tableEl = root.querySelector('#orders-table');
  const pagerEl = root.querySelector('#orders-pager');
  const statsEl = root.querySelector('#order-stats');

  try {
    const { data, error } = await sb.from('customers').select('id,name,phone').is('deleted_at', null).order('name');
    if (error) throw new Error(errText(error));
    customers = data || [];
  } catch (e) {
    tableEl.innerHTML = `<div class="notice notice--danger">${icon('alert', 17)} ${esc(e.message)}</div>`;
    return;
  }
  const customerMap = new Map(customers.map((c) => [c.id, c]));

  async function load() {
    tableEl.innerHTML = spinner('Loading orders…');
    try {
      let query = sb.from('orders').select('*', { count: 'exact' }).is('deleted_at', null);
      if (state.status) query = query.eq('status', state.status);
      if (state.channel) query = query.eq('channel', state.channel);
      if (state.fulfilment) query = query.eq('fulfilment', state.fulfilment);
      if (state.search) {
        const t = state.search.replace(/[%,]/g, ' ');
        query = query.or(`order_no.ilike.%${t}%,notes.ilike.%${t}%`);
      }
      query = query.order('created_at', { ascending: false });
      const from = (state.page - 1) * PAGE_SIZE;
      query = query.range(from, from + PAGE_SIZE - 1);

      const { data, error, count } = await query;
      if (error) throw new Error(errText(error));
      state.rows = data || [];
      state.total = count ?? state.rows.length;

      const ids = state.rows.map((o) => o.id);
      const [itemRes, payRes] = await Promise.all([
        ids.length ? sb.from('order_items').select('order_id,qty').in('order_id', ids) : { data: [] },
        ids.length ? sb.from('payments').select('order_id,amount').in('order_id', ids).is('deleted_at', null) : { data: [] },
      ]);
      const itemCount = new Map();
      for (const it of itemRes.data || []) itemCount.set(it.order_id, (itemCount.get(it.order_id) || 0) + Number(it.qty));
      paymentsByOrder = new Map();
      for (const p of payRes.data || []) paymentsByOrder.set(p.order_id, (paymentsByOrder.get(p.order_id) || 0) + Number(p.amount));

      draw(itemCount, customerMap);
      pagerEl.innerHTML = pager(state.page, state.total, PAGE_SIZE);
      pagerEl.querySelectorAll('[data-page]').forEach((b) => {
        b.onclick = () => { state.page = Number(b.dataset.page); load(); };
      });
    } catch (e) {
      tableEl.innerHTML = `<div class="notice notice--danger">${icon('alert', 17)} ${esc(e.message)}</div>`;
    }
  }

  async function loadStats() {
    try {
      if (options.status === 'quote') {
        const { data, error } = await sb.from('orders')
          .select('id,total,customer_id').eq('status', 'quote').is('deleted_at', null);
        if (error) throw new Error(errText(error));
        const quotes = data || [];
        const value = quotes.reduce((sum, q) => sum + Number(q.total || 0), 0);
        const customers = new Set(quotes.map((q) => q.customer_id).filter(Boolean)).size;
        statsEl.innerHTML = `
          ${miniStat('Open quotes', num(quotes.length), 'file', 'purple')}
          ${miniStat('Quote value', money(value, { decimals: 0 }), 'wallet', 'berry')}
          ${miniStat('Average quote', money(quotes.length ? value / quotes.length : 0, { decimals: 0 }), 'chart', 'caramel')}
          ${miniStat('Customers', num(customers), 'users', 'sage')}`;
        return;
      }
      const [open, balances, done] = await Promise.all([
        sb.from('orders').select('id', { count: 'exact', head: true }).is('deleted_at', null)
          .in('status', ['quote', 'confirmed', 'in_production', 'ready', 'out_for_delivery']),
        sb.from('v_order_balances').select('balance'),
        sb.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'completed').is('deleted_at', null),
      ]);
      const outstanding = (balances.data || []).reduce((s, b) => s + Number(b.balance), 0);
      statsEl.innerHTML = `
        ${miniStat('Open orders', num(open.count || 0), 'bag', 'berry')}
        ${miniStat('Outstanding', money(outstanding, { decimals: 0 }), 'clock', 'caramel')}
        ${miniStat('Completed', num(done.count || 0), 'check', 'sage')}
        ${miniStat('Customers', num(customers.length), 'users', 'purple')}`;
    } catch (e) {
      statsEl.innerHTML = '';
    }
  }

  function draw(itemCount, cmap) {
    if (!state.rows.length) {
      tableEl.innerHTML = emptyState({
        iconName: options.status === 'quote' ? 'file' : 'bag',
        title: options.status === 'quote' ? 'No quotes yet' : 'No orders here',
        text: state.search || state.status || state.channel || state.fulfilment
          ? 'Nothing matches those filters. Try clearing them.'
          : 'Record your first walk-in order in under a minute.',
        action: `<a class="btn btn--primary" href="#/orders/new">${esc(options.newLabel || 'New order')}</a>`,
      });
      return;
    }

    const rows = state.rows.map((o) => {
      const customer = cmap.get(o.customer_id);
      const balance = Number(o.total) - Number(o.amount_paid);
      return `<tr data-href="#/orders/${esc(o.id)}" tabindex="0" style="cursor:pointer">
        <td><div class="cell-main"><strong>${esc(o.order_no)}</strong><small>${esc(relativeTime(o.created_at))}</small></div></td>
        <td><div class="cell-main"><strong>${esc(customer?.name || 'Walk-in')}</strong><small>${esc(customer?.phone || titleCase(o.channel))}</small></div></td>
        <td><span class="qty-chip">${num(itemCount.get(o.id) || 0)}</span></td>
        <td>${o.delivery_date ? esc(fmtDate(o.delivery_date)) : '<span class="muted">No date</span>'}</td>
        <td>
          <div class="cell-main"><strong>${esc(money(o.total, { decimals: 0 }))}</strong>
          <small>${o.fulfilment === 'delivery' ? 'Delivery' : 'Pick-up'} · ${esc(labelFor(CHANNELS, o.channel))}</small></div>
        </td>
        <td>${balance > 0.004
          ? `<span class="text-danger">${esc(money(balance, { decimals: 0 }))}</span>`
          : '<span class="text-sage">Settled</span>'}</td>
        <td>${statusBadge(o.status)}</td>
      </tr>`;
    }).join('');

    tableEl.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Due</th><th>Total</th><th>Balance</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;

    tableEl.querySelectorAll('tr[data-href]').forEach((tr) => {
      const go = () => { location.hash = tr.dataset.href; };
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    });
  }

  let timer;
  root.querySelector('[data-search]').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.search = e.target.value.trim();
      state.page = 1;
      load();
    }, 260);
  });
  root.querySelectorAll('[data-filter]').forEach((sel) => {
    sel.addEventListener('change', () => {
      state[sel.dataset.filter] = sel.value;
      state.page = 1;
      load();
    });
  });
  root.querySelector('[data-refresh]').addEventListener('click', () => { load(); loadStats(); });
  root.querySelector('[data-export]').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    setBusy(button, true, 'Preparing…');
    try {
      let query = sb.from('orders').select('*').is('deleted_at', null);
      if (state.status) query = query.eq('status', state.status);
      if (state.channel) query = query.eq('channel', state.channel);
      if (state.fulfilment) query = query.eq('fulfilment', state.fulfilment);
      if (state.search) {
        const t = state.search.replace(/[%,]/g, ' ');
        query = query.or(`order_no.ilike.%${t}%,notes.ilike.%${t}%`);
      }
      const { data, error } = await query.order('created_at', { ascending: false }).limit(5000);
      if (error) throw new Error(errText(error));
      const rows = data || [];
      exportModal({
        title: options.status === 'quote' ? 'Quotes' : 'Orders',
        filename: `${options.status === 'quote' ? 'quotes' : 'orders'}-${today()}`,
        rows,
        columns: [
          { key: 'order_no', label: 'Order' },
          { key: 'created_at', label: 'Created', value: (o) => fmtDate(o.created_at) },
          { key: 'customer', label: 'Customer', value: (o) => customerMap.get(o.customer_id)?.name || 'Walk-in' },
          { key: 'phone', label: 'Phone', value: (o) => customerMap.get(o.customer_id)?.phone || '' },
          { key: 'delivery_date', label: 'Due', value: (o) => fmtDate(o.delivery_date) },
          { key: 'fulfilment', label: 'Fulfilment', value: (o) => titleCase(o.fulfilment) },
          { key: 'channel', label: 'Channel', value: (o) => labelFor(CHANNELS, o.channel) },
          { key: 'status', label: 'Status', value: (o) => titleCase(o.status) },
          { key: 'total', label: 'Total', className: 'num' },
          { key: 'amount_paid', label: 'Paid', className: 'num' },
          { key: 'balance', label: 'Balance', className: 'num', value: (o) => Number(o.total) - Number(o.amount_paid) },
        ],
        meta: options.status === 'quote' ? 'Quote pipeline' : 'Order register',
      });
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(button, false);
    }
  });

  await Promise.all([load(), loadStats()]);
}

function miniStat(label, value, iconName, tone) {
  return `<div class="mini-stat mini-stat--${tone}">
    <span class="mini-stat__icon">${icon(iconName, 17)}</span>
    <span><small>${esc(label)}</small><strong>${esc(value)}</strong></span>
  </div>`;
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------
async function renderDetail(root, id, ctx) {
  root.innerHTML = `<div class="route-loading">${spinner('Loading order…')}</div>`;
  const { isOwner, settings } = ctx;

  let order, customer, items, payments, docs, history, attachments;
  try {
    const [oRes, iRes, pRes, dRes, hRes, aRes] = await Promise.all([
      sb.from('orders').select('*').eq('id', id).single(),
      sb.from('order_items').select('*').eq('order_id', id).order('id'),
      sb.from('payments').select('*').eq('order_id', id).is('deleted_at', null).order('created_at'),
      sb.from('documents').select('*').eq('order_id', id),
      sb.from('order_status_history').select('*').eq('order_id', id).order('created_at', { ascending: false }),
      sb.from('attachments').select('*').eq('entity', 'order').eq('entity_id', id),
    ]);
    for (const r of [oRes, iRes, pRes, dRes, hRes, aRes]) if (r.error) throw new Error(errText(r.error));
    order = oRes.data;
    items = iRes.data || [];
    payments = pRes.data || [];
    docs = dRes.data || [];
    history = hRes.data || [];
    attachments = aRes.data || [];
    if (order.customer_id) {
      const { data, error } = await sb.from('customers').select('*').eq('id', order.customer_id).maybeSingle();
      if (error) throw new Error(errText(error));
      customer = data;
    }
  } catch (e) {
    root.innerHTML = `<div class="notice notice--danger">${icon('alert', 18)} ${esc(e.message)}</div>`;
    return;
  }

  const balance = Number(order.total) - Number(order.amount_paid);
  const next = nextStatus(order.status);
  const canAdvance = next && order.status !== 'cancelled';
  const docMap = new Map(docs.map((d) => [d.doc_type, d]));
  const customerName = customer?.name || 'Walk-in customer';

  root.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow"><a class="link" href="#/orders">${icon('arrow', 13)} All orders</a> · ${esc(labelFor(CHANNELS, order.channel))}</p>
        <h1>${esc(order.order_no)} ${statusBadge(order.status)}</h1>
        <p class="page-sub">${esc(customerName)} · created ${esc(fmtDateTime(order.created_at))}${order.delivery_date ? ` · due ${esc(fmtDate(order.delivery_date))}` : ''}</p>
      </div>
      <div class="page-actions">
        <button class="btn btn--ghost" data-print>${icon('print', 17)} Print</button>
        <button class="btn btn--ghost" data-wa>${icon('whatsapp', 17)} WhatsApp</button>
        <button class="btn btn--ghost" data-docs>${icon('clipboard', 17)} Documents</button>
        ${canAdvance ? `<button class="btn btn--primary" data-advance>${icon('arrow', 17)} Mark ${esc(labelFor(ORDER_STATUSES, next).toLowerCase())}</button>` : ''}
      </div>
    </div>

    ${order.status === 'cancelled' ? `<div class="notice notice--danger">${icon('alert', 17)} This order was cancelled${order.void_reason ? `: ${esc(order.void_reason)}` : ''}. Stock was returned to the shelf.</div>` : ''}
    ${order.status === 'quote' ? `<div class="notice">${icon('clipboard', 17)} This is a quote. Confirm it to start production and take a deposit.</div>` : ''}

    <div class="order-layout">
      <div class="order-main">
        <section class="card">
          <div class="card-head card-head--pad">
            <div><h2>Items</h2><p class="muted">${items.length} line${items.length === 1 ? '' : 's'} · prices captured at time of sale</p></div>
            ${!order.stock_deducted && order.status !== 'cancelled' ? `<button class="btn btn--sm btn--ghost" data-edit-items>${icon('edit', 15)} Edit items</button>` : ''}
          </div>
          ${items.length ? `<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Line total</th></tr></thead>
            <tbody>${items.map((it) => `
              <tr>
                <td><div class="cell-main"><strong>${esc(it.item_name)}</strong><small>${it.product_id ? 'Catalogue product' : 'Custom line'}</small></div></td>
                <td class="num">${num(it.qty, 2)}</td>
                <td class="num">${esc(money(it.unit_price))}</td>
                <td class="num"><strong>${esc(money(it.line_total))}</strong></td>
              </tr>`).join('')}</tbody>
          </table></div>` : emptyState({ iconName: 'bag', title: 'No items yet', text: 'Add at least one cake before confirming this order.' })}
          ${order.custom_details ? `<div class="order-note"><strong>Custom design brief</strong><p>${esc(order.custom_details).replace(/\n/g, '<br>')}</p></div>` : ''}
          ${order.notes ? `<div class="order-note"><strong>Internal note</strong><p>${esc(order.notes).replace(/\n/g, '<br>')}</p></div>` : ''}
        </section>

        <section class="card">
          <div class="card-head card-head--pad">
            <div><h2>Payments</h2><p class="muted">Deposits, balances and refunds</p></div>
            <button class="btn btn--sm btn--primary" data-add-payment>${icon('plus', 15)} Add payment</button>
          </div>
          ${payments.length ? `<div class="table-wrap"><table class="data-table data-table--tight">
            <thead><tr><th>Date</th><th>Method</th><th>Note</th><th class="num">Amount</th><th></th></tr></thead>
            <tbody>${payments.map((p) => `
              <tr>
                <td>${esc(fmtDate(p.paid_on))}</td>
                <td>${badge(labelFor(PAYMENT_METHODS, p.method), 'info')}</td>
                <td>${esc(p.note || '—')}</td>
                <td class="num ${Number(p.amount) < 0 ? 'text-danger' : ''}"><strong>${esc(money(p.amount))}</strong></td>
                <td class="td-actions">${isOwner ? `<button class="icon-btn icon-btn--danger" data-del-payment="${esc(p.id)}" title="Reverse payment">${icon('undo', 15)}</button>` : ''}</td>
              </tr>`).join('')}</tbody>
          </table></div>` : emptyState({ iconName: 'wallet', title: 'No payments recorded', text: 'Take a deposit now or collect on pick-up.' })}
        </section>

        <section class="card">
          <div class="card-head card-head--pad">
            <div><h2>Status history</h2><p class="muted">Who moved this order, and when</p></div>
          </div>
          <ol class="timeline">
            ${history.length ? history.map((h) => `<li class="timeline__item">
              <span class="timeline__dot"></span>
              <div><strong>${esc(h.from_status ? `${labelFor(ORDER_STATUSES, h.from_status)} → ${labelFor(ORDER_STATUSES, h.to_status)}` : labelFor(ORDER_STATUSES, h.to_status))}</strong>
              <small>${esc(fmtDateTime(h.created_at))}${h.note ? ` · ${esc(h.note)}` : ''}</small></div>
            </li>`).join('') : '<li class="muted">No history yet.</li>'}
          </ol>
        </section>
      </div>

      <aside class="order-side">
        <section class="card card--pad">
          <div class="card-head"><div><h2>Summary</h2></div>${icon('wallet', 18)}</div>
          <dl class="totals">
            <div><dt>Subtotal</dt><dd>${esc(money(order.subtotal))}</dd></div>
            ${Number(order.discount) > 0 ? `<div class="is-discount"><dt>Discount${order.discount_reason ? `<small>${esc(order.discount_reason)}</small>` : ''}</dt><dd>−${esc(money(order.discount))}</dd></div>` : ''}
            ${Number(order.delivery_fee) > 0 ? `<div><dt>Delivery fee</dt><dd>${esc(money(order.delivery_fee))}</dd></div>` : ''}
            ${Number(order.tax_amount) > 0 ? `<div><dt>${esc(settings.tax_label || 'Tax')}</dt><dd>${esc(money(order.tax_amount))}</dd></div>` : ''}
            <div class="totals__grand"><dt>Total</dt><dd>${esc(money(order.total))}</dd></div>
            <div><dt>Paid</dt><dd class="text-sage">${esc(money(order.amount_paid))}</dd></div>
            <div class="totals__balance ${balance > 0.004 ? 'is-owing' : ''}"><dt>Balance</dt><dd>${esc(money(balance))}</dd></div>
          </dl>
          ${Number(settings.deposit_required_above) > 0 && Number(order.total) >= Number(settings.deposit_required_above) && Number(order.amount_paid) === 0 && order.status !== 'cancelled'
            ? `<div class="notice notice--warn">${icon('alert', 15)} A deposit is normally required above ${esc(money(settings.deposit_required_above, { decimals: 0 }))}.</div>` : ''}
          <button class="btn btn--primary btn--block" data-add-payment>${icon('card', 16)} Record payment</button>
        </section>

        <section class="card card--pad">
          <div class="card-head"><div><h2>Customer</h2></div>${icon('user', 18)}</div>
          ${customer ? `<a class="customer-card" href="#/customers/${esc(customer.id)}">
            <span class="avatar">${esc(initials(customer.name))}</span>
            <span><strong>${esc(customer.name)}</strong><small>${esc(customer.phone || customer.email || 'No contact')}</small></span>
            ${icon('chevron', 16)}
          </a>` : '<p class="muted">No customer linked.</p>'}
          <dl class="detail-list">
            <div><dt>Channel</dt><dd>${esc(labelFor(CHANNELS, order.channel))}</dd></div>
            <div><dt>Fulfilment</dt><dd>${esc(labelFor(FULFILMENTS, order.fulfilment))}</dd></div>
            ${order.delivery_date ? `<div><dt>Due</dt><dd>${esc(fmtDate(order.delivery_date))}</dd></div>` : ''}
            ${order.fulfilment === 'delivery' ? `<div><dt>Address</dt><dd>${esc([order.delivery_address, order.delivery_city, order.delivery_state].filter(Boolean).join(', ') || '—')}</dd></div>` : ''}
            ${order.rider_name ? `<div><dt>Rider</dt><dd>${esc(order.rider_name)}${order.rider_phone ? ` · ${esc(order.rider_phone)}` : ''}</dd></div>` : ''}
          </dl>
          ${customer?.phone ? `<a class="btn btn--ghost btn--block" href="tel:${esc(customer.phone)}">${icon('phone', 16)} Call customer</a>` : ''}
        </section>

        <section class="card card--pad">
          <div class="card-head"><div><h2>Documents</h2></div><button class="icon-btn" data-docs title="Manage">${icon('settings', 16)}</button></div>
          ${['quote', 'invoice', 'receipt'].map((t) => {
            const d = docMap.get(t);
            return `<div class="doc-row">
              <span class="doc-row__icon">${icon(t === 'receipt' ? 'card' : t === 'invoice' ? 'clipboard' : 'book', 16)}</span>
              <span class="doc-row__text"><strong>${esc(labelFor(ORDER_STATUSES, t))}${d ? ` · ${esc(d.doc_no)}` : ''}</strong><small>${d ? esc(fmtDate(d.issued_on)) : 'Not issued'}</small></span>
              ${d
                ? `<button class="btn btn--sm btn--ghost" data-print-doc="${esc(t)}">${icon('print', 14)}</button>`
                : `<button class="btn btn--sm btn--ghost" data-issue="${esc(t)}">Issue</button>`}
            </div>`;
          }).join('')}
        </section>

        <section class="card card--pad">
          <div class="card-head"><div><h2>Attachments</h2></div><label class="icon-btn" title="Upload">${icon('plus', 16)}<input type="file" hidden data-upload></label></div>
          ${attachments.length ? `<div class="attach-list">${attachments.map((a) => `
            <button class="attach-row" data-attach="${esc(a.id)}" data-path="${esc(a.file_path)}">
              ${icon('clipboard', 15)}<span>${esc(a.file_name || 'File')}</span>
            </button>`).join('')}</div>` : '<p class="muted">No photos or files yet. Add a reference image or receipt.</p>'}
        </section>

        <section class="card card--pad">
          <div class="card-head"><div><h2>Manage</h2></div></div>
          <div class="stack">
            <button class="btn btn--ghost btn--block" data-edit-order>${icon('edit', 16)} Edit order details</button>
            ${canAdvance ? `<button class="btn btn--ghost btn--block" data-advance>${icon('arrow', 16)} Advance status</button>` : ''}
            ${order.status !== 'cancelled' ? `<button class="btn btn--danger btn--block" data-cancel-order>${icon('close', 16)} Cancel order</button>` : ''}
            ${isOwner ? `<button class="btn btn--ghost btn--block" data-archive>${icon('trash', 16)} Archive order</button>` : ''}
          </div>
        </section>
      </aside>
    </div>`;

  // -- bindings ------------------------------------------------------------
  const reload = () => renderDetail(root, id, ctx);
  root.querySelectorAll('[data-advance]').forEach((b) => b.addEventListener('click', () => advanceStatus(order, next, reload)));
  root.querySelectorAll('[data-add-payment]').forEach((b) => b.addEventListener('click', () => paymentModal(order, payments, reload)));
  root.querySelector('[data-edit-order]')?.addEventListener('click', () => editOrder(order, reload));
  root.querySelector('[data-edit-items]')?.addEventListener('click', () => editItems(order, items, reload));
  root.querySelector('[data-cancel-order]')?.addEventListener('click', () => cancelOrder(order, reload));
  root.querySelector('[data-archive]')?.addEventListener('click', () => archiveOrder(order, ctx));
  root.querySelector('[data-print]')?.addEventListener('click', () => printOrder(order, customer, items, payments, settings, docMap));
  root.querySelector('[data-wa]')?.addEventListener('click', () => whatsappOrder(order, customer, settings));
  root.querySelector('[data-docs]')?.addEventListener('click', () => documentsModal(order, docs, reload));
  root.querySelectorAll('[data-issue]').forEach((b) => b.addEventListener('click', async () => {
    setBusy(b, true, 'Issuing…');
    try {
      await issueDoc(order.id, b.dataset.issue);
      toast('Document issued.');
      await reload();
    } catch (e) { toast(e.message, 'error'); setBusy(b, false); }
  }));
  root.querySelectorAll('[data-print-doc]').forEach((b) => b.addEventListener('click', async () => {
    const d = docMap.get(b.dataset.printDoc);
    printDoc(d, order, customer, items, payments, settings);
  }));
  root.querySelectorAll('[data-del-payment]').forEach((b) => b.addEventListener('click', () => deletePayment(b.dataset.delPayment, reload)));
  root.querySelectorAll('[data-attach]').forEach((b) => b.addEventListener('click', () => openAttachment(b.dataset.path)));
  root.querySelector('[data-upload]')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const path = `order/${order.id}/${Date.now()}-${file.name.replace(/\s+/g, '-')}`;
      const { error: upErr } = await sb.storage.from('cake-files').upload(path, file);
      if (upErr) throw new Error(errText(upErr));
      const { error } = await sb.from('attachments').insert({
        entity: 'order', entity_id: order.id, file_path: path,
        file_name: file.name, mime_type: file.type, size_bytes: file.size,
      });
      if (error) throw new Error(errText(error));
      toast('Attachment uploaded.');
      await reload();
    } catch (err) { toast(err.message, 'error'); }
  });
}

function nextStatus(current) {
  const i = STATUS_FLOW.indexOf(current);
  if (i < 0 || i >= STATUS_FLOW.length - 1) return null;
  return STATUS_FLOW[i + 1];
}

async function advanceStatus(order, next, reload) {
  if (!next) return;
  const label = labelFor(ORDER_STATUSES, next);
  const ok = await confirmDialog({
    title: `Move to ${label.toLowerCase()}?`,
    message: next === 'completed'
      ? 'Completing an order deducts finished stock once. It cannot be reopened — cancel it to return stock.'
      : `This updates the order pipeline to “${label}”.`,
    confirmText: `Mark ${label.toLowerCase()}`,
  });
  if (!ok) return;
  const { error } = await sb.from('orders').update({ status: next }).eq('id', order.id);
  if (error) { toast(errText(error), 'error'); return; }
  dataChanged('orders');
  toast(`Order marked ${label.toLowerCase()}.`);
  reload();
}

function paymentModal(order, payments, reload) {
  const balance = Number(order.total) - Number(order.amount_paid);
  formModal({
    title: `Payment · ${order.order_no}`,
    intro: `Outstanding balance ${money(balance)}. Record a deposit, balance or refund.`,
    fields: [
      { name: 'amount', label: 'Amount', type: 'money', required: true, default: Math.max(0, balance).toFixed(2), help: 'Use a negative amount to record a refund.' },
      { name: 'method', label: 'Method', type: 'select', options: PAYMENT_METHODS, required: true, default: 'cash' },
      { name: 'paid_on', label: 'Date received', type: 'date', required: true, default: today() },
      { name: 'note', label: 'Note', type: 'text', span: 2, placeholder: 'Deposit, balance, refund…' },
    ],
    submitLabel: 'Record payment',
    onSubmit: async (data) => {
      if (!Number(data.amount)) throw new Error('Amount cannot be zero.');
      const { error } = await sb.from('payments').insert({
        order_id: order.id, amount: Number(data.amount), method: data.method,
        paid_on: data.paid_on, note: data.note,
      });
      if (error) throw new Error(errText(error));
      dataChanged('payments');
      toast('Payment recorded.');
      reload();
    },
  });
}

async function deletePayment(paymentId, reload) {
  const ok = await confirmDialog({
    title: 'Reverse this payment?',
    message: 'It is soft-deleted and the order balance recalculates. The audit log keeps a copy.',
    confirmText: 'Reverse', danger: true,
  });
  if (!ok) return;
  const { error } = await sb.from('payments').update({ deleted_at: new Date().toISOString() }).eq('id', paymentId);
  if (error) { toast(errText(error), 'error'); return; }
  dataChanged('payments');
  toast('Payment reversed.');
  reload();
}

function editOrder(order, reload) {
  formModal({
    title: `Edit ${order.order_no}`,
    wide: true,
    fields: [
      { name: 'channel', label: 'Channel', type: 'select', options: CHANNELS, required: true },
      { name: 'fulfilment', label: 'Fulfilment', type: 'select', options: FULFILMENTS, required: true },
      { name: 'delivery_date', label: 'Due date', type: 'date' },
      { name: 'rider_name', label: 'Rider name', type: 'text' },
      { name: 'delivery_address', label: 'Delivery address', type: 'text', span: 2 },
      { name: 'delivery_city', label: 'City', type: 'text' },
      { name: 'delivery_state', label: 'State', type: 'text' },
      { name: 'rider_phone', label: 'Rider phone', type: 'tel' },
      { name: 'delivery_fee', label: 'Delivery fee', type: 'money', min: 0 },
      { name: 'discount', label: 'Discount', type: 'money', min: 0 },
      { name: 'discount_reason', label: 'Discount reason', type: 'text', span: 2, help: 'Required whenever a discount is applied.' },
      { name: 'custom_details', label: 'Custom design brief', type: 'textarea', span: 2, rows: 3 },
      { name: 'notes', label: 'Internal notes', type: 'textarea', span: 2, rows: 2 },
    ],
    values: order,
    submitLabel: 'Save changes',
    onSubmit: async (data) => {
      if (Number(data.discount) > 0 && !String(data.discount_reason || '').trim()) {
        throw new Error('A discount requires a reason.');
      }
      const { error } = await sb.from('orders').update({
        channel: data.channel, fulfilment: data.fulfilment, delivery_date: data.delivery_date,
        rider_name: data.rider_name, rider_phone: data.rider_phone,
        delivery_address: data.delivery_address, delivery_city: data.delivery_city,
        delivery_state: data.delivery_state, delivery_fee: Number(data.delivery_fee || 0),
        discount: Number(data.discount || 0), discount_reason: data.discount_reason,
        custom_details: data.custom_details, notes: data.notes,
      }).eq('id', order.id);
      if (error) throw new Error(errText(error));
      dataChanged('orders');
      toast('Order updated.');
      reload();
    },
  });
}

async function editItems(order, items, reload) {
  let lines = items.map((i) => ({
    product_id: i.product_id, item_name: i.item_name,
    qty: Number(i.qty), unit_price: Number(i.unit_price),
  }));
  let products = [];
  try {
    const { data, error } = await sb.from('products').select('*').is('deleted_at', null).order('name');
    if (error) throw new Error(errText(error));
    products = data || [];
  } catch (e) { toast(e.message, 'error'); return; }

  const body = `<div class="items-editor" id="items-editor">
    <div class="items-editor__head"><span>Item</span><span>Qty</span><span>Unit price</span><span></span></div>
    <div id="items-body"></div>
    <button class="btn btn--sm btn--ghost" type="button" data-add-line>${icon('plus', 15)} Add line</button>
    <div class="form-error" role="alert" hidden></div>
  </div>`;

  openModal({
    title: `Edit items · ${order.order_no}`,
    body,
    wide: true,
    footer: `<button class="btn btn--ghost" data-close>Cancel</button>
      <button class="btn btn--primary" data-save-items>Save items</button>`,
    onOpen: (el, close) => {
      const bodyEl = el.querySelector('#items-body');
      const err = el.querySelector('.form-error');

      const draw = () => {
        bodyEl.innerHTML = lines.map((l, i) => `<div class="item-row" data-i="${i}">
          <div class="item-row__name">${itemPickerHTML(l, products)}</div>
          <input type="number" data-f="qty" min="0.01" step="any" value="${esc(l.qty)}" aria-label="Quantity">
          <div class="input-prefix"><span>₦</span><input type="number" data-f="unit_price" min="0" step="0.01" value="${esc(l.unit_price)}" aria-label="Unit price"></div>
          <button class="icon-btn icon-btn--danger" type="button" data-remove-line="${i}" title="Remove">${icon('trash', 15)}</button>
        </div>`).join('');
      };

      const read = () => {
        [...bodyEl.querySelectorAll('.item-row')].forEach((row, i) => {
          const f = (name) => row.querySelector(`[data-f="${name}"]`);
          lines[i] = {
            product_id: f('product_id').value || null,
            item_name: f('item_name').value.trim(),
            qty: Number(f('qty').value || 0),
            unit_price: Number(f('unit_price').value || 0),
          };
        });
      };

      wireItemPicker(bodyEl, products);
      bodyEl.addEventListener('click', (e) => {
        const rm = e.target.closest('[data-remove-line]');
        if (rm) { read(); lines.splice(Number(rm.dataset.removeLine), 1); draw(); }
      });
      el.querySelector('[data-add-line]').onclick = () => {
        read();
        lines.push({ product_id: null, item_name: '', qty: 1, unit_price: 0 });
        draw();
        bodyEl.querySelector('.item-row:last-child [data-f="item_name"]')?.focus();
      };
      el.querySelector('[data-save-items]').onclick = async (e) => {
        read();
        err.hidden = true;
        if (!lines.length) { err.textContent = 'Keep at least one line.'; err.hidden = false; return; }
        if (lines.some((l) => !l.item_name || l.qty <= 0)) { err.textContent = 'Every line needs a name and a quantity above zero.'; err.hidden = false; return; }
        const btn = e.currentTarget;
        setBusy(btn, true, 'Saving…');
        try {
          const keepIds = new Set();
          for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            const existing = items[i];
            const p = l.product_id ? products.find((x) => x.id === l.product_id) : null;
            const payload = {
              order_id: order.id, product_id: l.product_id, item_name: l.item_name,
              qty: l.qty, unit_price: l.unit_price, unit_cost: p ? Number(p.cost_price || 0) : Number(existing?.unit_cost || 0),
            };
            if (existing) {
              const { error } = await sb.from('order_items').update(payload).eq('id', existing.id);
              if (error) throw new Error(errText(error));
              keepIds.add(existing.id);
            } else {
              const { data, error } = await sb.from('order_items').insert(payload).select().single();
              if (error) throw new Error(errText(error));
              keepIds.add(data.id);
            }
          }
          for (const it of items) {
            if (!keepIds.has(it.id)) {
              const { error } = await sb.from('order_items').delete().eq('id', it.id);
              if (error) throw new Error(errText(error));
            }
          }
          dataChanged('order_items');
          toast('Order items updated.');
          close();
          reload();
        } catch (error) {
          err.textContent = error.message;
          err.hidden = false;
          setBusy(btn, false);
        }
      };
      draw();
    },
  });
}

async function cancelOrder(order, reload) {
  formModal({
    title: `Cancel ${order.order_no}?`,
    intro: 'Cancelling reverses any stock this order consumed. This is recorded in the audit log.',
    fields: [{ name: 'void_reason', label: 'Reason', type: 'textarea', required: true, span: 2, rows: 2 }],
    values: { void_reason: '' },
    submitLabel: 'Cancel order',
    onSubmit: async (data) => {
      const { error } = await sb.from('orders').update({
        status: 'cancelled', void_reason: data.void_reason,
        voided_at: new Date().toISOString(),
      }).eq('id', order.id);
      if (error) throw new Error(errText(error));
      dataChanged('orders');
      toast('Order cancelled. Stock returned where needed.');
      reload();
    },
  });
}

async function archiveOrder(order, ctx) {
  const ok = await confirmDialog({
    title: 'Archive this order?',
    message: 'It leaves the sales lists but stays in reports and audit history. The owner can restore it from Admin → Trash.',
    confirmText: 'Archive', danger: true,
  });
  if (!ok) return;
  const { error } = await sb.from('orders').update({ deleted_at: new Date().toISOString() }).eq('id', order.id);
  if (error) { toast(errText(error), 'error'); return; }
  dataChanged('orders');
  toast('Order archived.');
  ctx.navigate('#/orders');
}

// ---------------------------------------------------------------------------
// Documents, printing and sharing
// ---------------------------------------------------------------------------
async function issueDoc(orderId, type) {
  const { data, error } = await sb.rpc('issue_document', { p_order: orderId, p_doc_type: type });
  if (error) throw new Error(errText(error));
  return data;
}

function documentsModal(order, docs, reload) {
  openModal({
    title: `Documents · ${order.order_no}`,
    body: `<p class="form-intro">Documents are immutable snapshots — they keep the prices, customer and totals from the moment they were issued.</p>
      <div class="doc-list">${['quote', 'invoice', 'receipt'].map((t) => {
        const d = docs.find((x) => x.doc_type === t);
        return `<div class="doc-row doc-row--lg">
          <span class="doc-row__icon">${icon(t === 'receipt' ? 'card' : t === 'invoice' ? 'clipboard' : 'book', 18)}</span>
          <span class="doc-row__text"><strong>${esc(titleCase(t))}</strong><small>${d ? `${esc(d.doc_no)} · ${esc(fmtDate(d.issued_on))}` : 'Not issued yet'}</small></span>
          ${d ? `<button class="btn btn--sm btn--ghost" data-modal-print="${esc(t)}">${icon('print', 14)} Print</button>` : `<button class="btn btn--sm btn--primary" data-modal-issue="${esc(t)}">Issue</button>`}
        </div>`;
      }).join('')}</div>`,
    footer: '<button class="btn btn--ghost" data-close>Done</button>',
    onOpen: (el, close) => {
      el.querySelectorAll('[data-modal-issue]').forEach((b) => b.addEventListener('click', async () => {
        setBusy(b, true, 'Issuing…');
        try { await issueDoc(order.id, b.dataset.modalIssue); toast('Document issued.'); close(); reload(); }
        catch (e) { toast(e.message, 'error'); setBusy(b, false); }
      }));
      el.querySelectorAll('[data-modal-print]').forEach((b) => b.addEventListener('click', async () => {
        const { data, error } = await sb.from('documents').select('*').eq('order_id', order.id).eq('doc_type', b.dataset.modalPrint).maybeSingle();
        if (error) { toast(errText(error), 'error'); return; }
        printDoc(data, null, null, null, null);
      }));
    },
  });
}

function printOrder(order, customer, items, payments, settings, docMap) {
  const inv = docMap.get('invoice') || docMap.get('quote');
  if (inv?.snapshot) printDoc(inv, order, customer, items, payments, settings);
  else printDoc(
    { doc_type: order.status === 'quote' ? 'quote' : 'invoice', doc_no: order.order_no, issued_on: today(), snapshot: null },
    order, customer, items, payments, settings,
  );
}

export function printDoc(doc, order, customer, items, payments, settings) {
  const snap = doc?.snapshot || null;
  const o = snap?.order || order;
  const c = snap?.customer || customer;
  const lines = snap?.items || items || [];
  const pays = snap?.payments || payments || [];
  const s = snap?.settings || settings || {};
  if (!o) { toast('This document has no data to print.', 'error'); return; }

  const docType = doc.doc_type;
  const balance = Number(o.total) - Number(o.amount_paid);
  const rows = lines.map((it) => `<tr>
    <td>${esc(it.item_name)}</td>
    <td class="r">${num(it.qty, 2)}</td>
    <td class="r">${money(it.unit_price)}</td>
    <td class="r">${money(it.line_total)}</td>
  </tr>`).join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.doc_no || docType)}</title>
    <style>
      @page { margin: 18mm; }
      * { box-sizing: border-box; }
      body { font-family: "Segoe UI", Arial, sans-serif; color: #2c1d1a; margin: 0; font-size: 13px; }
      header { display: flex; justify-content: space-between; gap: 30px; border-bottom: 3px solid #8c3b4a; padding-bottom: 14px; }
      h1 { margin: 0 0 4px; font-size: 21px; }
      .muted { color: #7a6a63; }
      .doc-type { text-transform: uppercase; letter-spacing: .12em; font-size: 12px; color: #8c3b4a; font-weight: 700; }
      .grid { display: flex; justify-content: space-between; gap: 30px; margin: 22px 0; }
      .grid > div { flex: 1; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #7a6a63; border-bottom: 1px solid #e2d5cb; padding: 8px 6px; }
      td { padding: 9px 6px; border-bottom: 1px solid #f0e7df; }
      .r { text-align: right; }
      .totals { margin-left: auto; width: 280px; margin-top: 18px; }
      .totals div { display: flex; justify-content: space-between; padding: 5px 0; }
      .totals .grand { border-top: 2px solid #2c1d1a; margin-top: 6px; padding-top: 9px; font-weight: 700; font-size: 16px; }
      .totals .balance { color: #a3303b; font-weight: 700; }
      footer { margin-top: 34px; border-top: 1px solid #e2d5cb; padding-top: 12px; color: #7a6a63; font-size: 11px; }
      .badge { display: inline-block; background: #f6ece4; border-radius: 20px; padding: 3px 10px; font-size: 11px; }
    </style></head><body>
    <header>
      <div>
        <h1>${esc(s.business_name || 'Cake Slice Factory')}</h1>
        <div class="muted">${esc(s.address || '')}</div>
        <div class="muted">${[s.phone, s.email].filter(Boolean).map(esc).join(' · ')}</div>
      </div>
      <div style="text-align:right">
        <div class="doc-type">${esc(docType)}</div>
        <div style="font-weight:700;font-size:15px">${esc(doc.doc_no || '—')}</div>
        <div class="muted">${esc(fmtDate(doc.issued_on || today()))}</div>
      </div>
    </header>

    <div class="grid">
      <div>
        <div class="doc-type" style="color:#7a6a63;margin-bottom:5px">Billed to</div>
        <strong>${esc(c?.name || 'Walk-in customer')}</strong>
        <div class="muted">${esc(c?.phone || '')}</div>
        <div class="muted">${esc([c?.address, c?.city, c?.state].filter(Boolean).join(', '))}</div>
      </div>
      <div style="text-align:right">
        <div><span class="muted">Order</span> <strong>${esc(o.order_no)}</strong></div>
        <div><span class="muted">Due</span> ${esc(fmtDate(o.delivery_date))}</div>
        <div><span class="muted">Fulfilment</span> ${esc(titleCase(o.fulfilment))}</div>
        ${o.delivery_address ? `<div class="muted">${esc([o.delivery_address, o.delivery_city].filter(Boolean).join(', '))}</div>` : ''}
      </div>
    </div>

    <table>
      <thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" class="muted">No items</td></tr>'}</tbody>
    </table>

    <div class="totals">
      <div><span>Subtotal</span><span>${money(o.subtotal)}</span></div>
      ${Number(o.discount) > 0 ? `<div><span>Discount</span><span>−${money(o.discount)}</span></div>` : ''}
      ${Number(o.delivery_fee) > 0 ? `<div><span>Delivery</span><span>${money(o.delivery_fee)}</span></div>` : ''}
      ${Number(o.tax_amount) > 0 ? `<div><span>${esc(s.tax_label || 'Tax')}</span><span>${money(o.tax_amount)}</span></div>` : ''}
      <div class="grand"><span>Total</span><span>${money(o.total)}</span></div>
      <div><span>Paid</span><span>${money(o.amount_paid)}</span></div>
      <div class="balance"><span>Balance due</span><span>${money(balance)}</span></div>
    </div>

    ${pays.length ? `<div style="margin-top:22px">
      <div class="doc-type" style="color:#7a6a63;margin-bottom:4px">Payments received</div>
      <table><tbody>${pays.map((p) => `<tr><td>${esc(fmtDate(p.paid_on))} · ${esc(titleCase(p.method))}</td><td>${esc(p.note || '')}</td><td class="r">${money(p.amount)}</td></tr>`).join('')}</tbody></table>
    </div>` : ''}

    ${o.custom_details ? `<div style="margin-top:20px"><div class="doc-type" style="color:#7a6a63;margin-bottom:4px">Design brief</div><p>${esc(o.custom_details).replace(/\n/g, '<br>')}</p></div>` : ''}

    <footer>${esc(s.invoice_footer || 'Thank you for your order.')}</footer>
    </body></html>`;

  printHTML(html, `${titleCase(docType)} ${doc.doc_no || ''}`.trim());
}

function whatsappOrder(order, customer, settings) {
  if (!customer?.phone) { toast('This order has no customer phone number.', 'warn'); return; }
  const balance = Number(order.total) - Number(order.amount_paid);
  const lines = [
    `Hello ${customer.name.split(' ')[0]},`,
    `Here are the details for your order ${order.order_no} at ${settings.business_name || 'Cake Slice Factory'}:`,
    `Total: ${money(order.total)}`,
    `Paid: ${money(order.amount_paid)}`,
    balance > 0.004 ? `Balance due: ${money(balance)}` : 'Balance: fully settled',
    order.delivery_date ? `${order.fulfilment === 'delivery' ? 'Delivery' : 'Pick-up'} date: ${fmtDate(order.delivery_date)}` : '',
    '',
    'Thank you!',
  ].filter(Boolean).join('\n');
  const phone = normalisePhone(customer.phone);
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(lines)}`, '_blank', 'noopener');
}

function normalisePhone(phone) {
  let p = String(phone).replace(/\D/g, '');
  if (p.startsWith('0')) p = `234${p.slice(1)}`;
  return p;
}

async function openAttachment(path) {
  try {
    const { data, error } = await sb.storage.from('cake-files').createSignedUrl(path, 3600);
    if (error) throw new Error(errText(error));
    const url = data?.signedUrl || data?.publicUrl;
    if (!url) { toast('Could not create a link for this file.', 'warn'); return; }
    window.open(url, '_blank', 'noopener');
  } catch (e) { toast(e.message, 'error'); }
}

function initials(name = '') {
  return String(name).trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || 'CS';
}

// ---------------------------------------------------------------------------
// New order
// ---------------------------------------------------------------------------
async function renderNew(root, ctx) {
  const { isOwner, settings } = ctx;
  root.innerHTML = `<div class="route-loading">${spinner('Opening a new order…')}</div>`;

  let customers = [];
  let products = [];
  try {
    const [cRes, pRes] = await Promise.all([
      sb.from('customers').select('*').is('deleted_at', null).order('name'),
      sb.from('products').select('*').is('deleted_at', null).eq('status', 'active').order('name'),
    ]);
    if (cRes.error) throw new Error(errText(cRes.error));
    if (pRes.error) throw new Error(errText(pRes.error));
    customers = cRes.data || [];
    products = pRes.data || [];
  } catch (e) {
    root.innerHTML = `<div class="notice notice--danger">${icon('alert', 18)} ${esc(e.message)}</div>`;
    return;
  }

  const lines = [{ product_id: null, item_name: '', qty: 1, unit_price: 0 }];
  const params = new URLSearchParams((location.hash.split('?')[1] || ''));
  const preselect = params.get('customer');
  const presetCustomer = preselect ? customers.find((c) => c.id === preselect) : null;
  const wantQuote = params.get('quote') === '1';

  root.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow"><a class="link" href="${wantQuote ? '#/quotes' : '#/orders'}">${icon('arrow', 13)} ${wantQuote ? 'All quotes' : 'All orders'}</a> · ${wantQuote ? 'New quote' : 'New sale'}</p>
        <h1>${wantQuote ? 'New quote' : 'New order'}</h1>
        <p class="page-sub">${wantQuote ? 'Price the cake and save it as a proposal. No stock moves until it is confirmed.' : 'Capture the customer, the cake and the deposit in one go.'}</p>
      </div>
      <div class="page-actions">
        <a class="btn btn--ghost" href="${wantQuote ? '#/quotes' : '#/orders'}">Cancel</a>
      </div>
    </div>

    <form id="order-form" novalidate>
      <div class="order-layout">
        <div class="order-main">
          <section class="card card--pad">
            <div class="card-head"><div><h2>Customer</h2><p class="muted">Search a repeat customer or add a new one.</p></div>${icon('users', 18)}</div>
            <div class="form-grid">
              <div class="field field--wide">
                <label for="customer_pick">Existing customer</label>
                <select id="customer_pick" name="customer_pick">
                  <option value="">＋ New customer</option>
                  ${customers.map((c) => `<option value="${esc(c.id)}" ${presetCustomer?.id === c.id ? 'selected' : ''}>${esc(c.name)}${c.phone ? ` · ${esc(c.phone)}` : ''}</option>`).join('')}
                </select>
              </div>
              <div class="new-customer-fields" id="new-customer" hidden>
                <div class="field"><label for="cust_name">Full name <span class="req">*</span></label><input id="cust_name" type="text" placeholder="Ada Okafor"></div>
                <div class="field"><label for="cust_phone">Phone <span class="req">*</span></label><input id="cust_phone" type="tel" placeholder="0803 123 4567"></div>
                <div class="field"><label for="cust_email">Email</label><input id="cust_email" type="email" placeholder="optional"></div>
                <div class="field"><label for="cust_city">City</label><input id="cust_city" type="text" placeholder="Lagos"></div>
                <div class="field"><label for="cust_state">State</label><input id="cust_state" type="text" placeholder="Lagos"></div>
                <div class="field"><label for="cust_address">Address</label><input id="cust_address" type="text" placeholder="Street address"></div>
              </div>
            </div>
          </section>

          <section class="card card--pad">
            <div class="card-head"><div><h2>Order details</h2><p class="muted">How this cake reaches the customer.</p></div>${icon('bag', 18)}</div>
            <div class="form-grid">
              <div class="field"><label for="channel">Channel</label>
                <select id="channel" name="channel">${CHANNELS.map((c) => `<option value="${c.value}" ${c.value === 'walk_in' ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select>
              </div>
              <div class="field"><label for="fulfilment">Fulfilment</label>
                <select id="fulfilment" name="fulfilment">${FULFILMENTS.map((f) => `<option value="${f.value}">${esc(f.label)}</option>`).join('')}</select>
              </div>
              <div class="field"><label for="delivery_date">Due date</label><input id="delivery_date" name="delivery_date" type="date" value="${esc(addDays(2))}"></div>
              <div class="field"><label for="kind">Order type</label>
                <select id="kind" name="kind">${ORDER_KINDS.map((k) => `<option value="${esc(k.value)}">${esc(k.label)}</option>`).join('')}</select>
              </div>
              <div class="delivery-fields" id="delivery-fields" hidden>
                <div class="field field--wide"><label for="delivery_address">Delivery address</label><input id="delivery_address" name="delivery_address" type="text" placeholder="Street, estate, landmark"></div>
                <div class="field"><label for="delivery_city">City</label><input id="delivery_city" name="delivery_city" type="text"></div>
                <div class="field"><label for="delivery_state">State</label><input id="delivery_state" name="delivery_state" type="text"></div>
              </div>
              <div class="field field--wide"><label for="custom_details">Custom design brief</label>
                <textarea id="custom_details" name="custom_details" rows="3" placeholder="Tiers, flavours, colours, message on cake…"></textarea></div>
              <div class="field field--wide"><label for="notes">Internal note</label><input id="notes" name="notes" type="text" placeholder="Anything the kitchen should know"></div>
            </div>
          </section>

          <section class="card card--open">
            <div class="card-head card-head--pad"><div><h2>Items</h2><p class="muted">Search the catalogue or type a custom line.</p></div>${icon('cake', 18)}</div>
            <div class="items-editor items-editor--page">
              <div class="items-editor__head"><span>Item</span><span>Qty</span><span>Unit price</span><span></span></div>
              <div id="items-body"></div>
              <button class="btn btn--sm btn--ghost" type="button" id="add-line">${icon('plus', 15)} Add line</button>
            </div>
          </section>
        </div>

        <aside class="order-side">
          <section class="card card--pad order-summary" id="order-summary"></section>

          <section class="card card--pad">
            <div class="card-head"><div><h2>Deposit</h2><p class="muted">Optional — record it with the order.</p></div>${icon('card', 18)}</div>
            <div class="form-grid form-grid--single">
              <div class="field"><label for="deposit">Amount received</label>
                <div class="input-prefix"><span>₦</span><input id="deposit" type="number" min="0" step="0.01" placeholder="0.00"></div>
              </div>
              <div class="field"><label for="deposit_method">Method</label>
                <select id="deposit_method">${PAYMENT_METHODS.map((m) => `<option value="${m.value}">${esc(m.label)}</option>`).join('')}</select>
              </div>
            </div>
            ${!isOwner ? `<div class="notice">${icon('lock', 15)} Staff discounts are capped at ${esc(settings.discount_limit_pct)}%.</div>` : ''}
          </section>

          <section class="card card--pad">
            <div class="form-error" id="order-error" role="alert" hidden></div>
            <button class="btn ${wantQuote ? 'btn--ghost' : 'btn--primary'} btn--block" type="submit" data-save="confirmed">${icon('check', 17)} Create order</button>
            <button class="btn ${wantQuote ? 'btn--primary' : 'btn--ghost'} btn--block" type="submit" data-save="quote">${icon('file', 17)} ${wantQuote ? 'Save quote' : 'Save as quote'}</button>
          </section>
        </aside>
      </div>
    </form>`;

  const form = root.querySelector('#order-form');
  const bodyEl = root.querySelector('#items-body');
  const summaryEl = root.querySelector('#order-summary');
  const errEl = root.querySelector('#order-error');
  let target = wantQuote ? 'quote' : 'confirmed';

  function readLines() {
    [...bodyEl.querySelectorAll('.item-row')].forEach((row, i) => {
      const f = (n) => row.querySelector(`[data-f="${n}"]`);
      lines[i] = {
        product_id: f('product_id').value || null,
        item_name: f('item_name').value.trim(),
        qty: Number(f('qty').value || 0),
        unit_price: Number(f('unit_price').value || 0),
      };
    });
  }

  function drawLines(focusIndex = -1) {
    bodyEl.innerHTML = lines.map((l, i) => `<div class="item-row" data-i="${i}">
      <div class="item-row__name">
        ${itemPickerHTML(l, products)}
      </div>
      <input type="number" data-f="qty" min="0.01" step="any" value="${esc(l.qty)}" aria-label="Quantity">
      <div class="input-prefix"><span>₦</span><input type="number" data-f="unit_price" min="0" step="0.01" value="${esc(l.unit_price)}" aria-label="Unit price"></div>
      <button class="icon-btn icon-btn--danger" type="button" data-remove="${i}" title="Remove">${icon('trash', 15)}</button>
    </div>`).join('');
    if (focusIndex >= 0) {
      const row = bodyEl.querySelector(`.item-row[data-i="${focusIndex}"]`);
      row?.querySelector('[data-f="item_name"]')?.focus();
    }
    updateSummary();
  }

  function summarySkeleton() {
    return `
      <div class="card-head"><div><h2>Summary</h2><p class="muted">Live totals</p></div>${icon('wallet', 18)}</div>
      <dl class="totals">
        <div><dt>Subtotal</dt><dd id="sum-subtotal">${money(0)}</dd></div>
        <div class="totals__input"><dt><label for="discount">Discount</label></dt>
          <dd><div class="input-prefix input-prefix--sm"><span>₦</span><input id="discount" type="number" min="0" step="0.01" placeholder="0.00"></div></dd></div>
        <div class="field field--tight"><label for="discount_reason">Discount reason</label>
          <input id="discount_reason" type="text" placeholder="e.g. repeat customer"></div>
        <div class="totals__input"><dt><label for="delivery_fee">Delivery fee</label></dt>
          <dd><div class="input-prefix input-prefix--sm"><span>₦</span><input id="delivery_fee" type="number" min="0" step="0.01" placeholder="0.00"></div></dd></div>
        <div id="sum-tax-row" hidden><dt id="sum-tax-label">${esc(settings.tax_label || 'Tax')}</dt><dd id="sum-tax">${money(0)}</dd></div>
        <div class="totals__grand"><dt>Total</dt><dd id="sum-total">${money(0)}</dd></div>
        <div id="sum-deposit-row" hidden><dt>Deposit</dt><dd class="text-sage" id="sum-deposit">${money(0)}</dd></div>
        <div id="sum-balance-row" class="totals__balance" hidden><dt>Balance</dt><dd id="sum-balance">${money(0)}</dd></div>
      </dl>
      <div id="sum-notices"></div>
      <p class="muted small">Final totals are recalculated by the database when the order is saved.</p>`;
  }

  function updateSummary() {
    readLines();
    if (!summaryEl.querySelector('#discount')) return;
    const subtotal = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
    const discInput = root.querySelector('#discount');
    const feeInput = root.querySelector('#delivery_fee');
    const discount = Number(discInput?.value || 0);
    const fee = Number(feeInput?.value || 0);
    const base = Math.max(0, subtotal - discount + fee);
    const rate = Number(settings.tax_rate || 0);
    let tax = 0; let total = base;
    if (rate > 0) {
      if (settings.tax_inclusive) { tax = base * rate / (100 + rate); total = base; }
      else { tax = base * rate / 100; total = base + tax; }
    }
    const deposit = Number(root.querySelector('#deposit')?.value || 0);
    const limited = !isOwner && discount > subtotal * Number(settings.discount_limit_pct || 0) / 100;

    summaryEl.querySelector('#sum-subtotal').textContent = money(subtotal);
    const taxRow = summaryEl.querySelector('#sum-tax-row');
    taxRow.hidden = !(tax > 0);
    summaryEl.querySelector('#sum-tax').textContent = money(tax);
    summaryEl.querySelector('#sum-total').textContent = money(total);
    const depRow = summaryEl.querySelector('#sum-deposit-row');
    const balRow = summaryEl.querySelector('#sum-balance-row');
    depRow.hidden = !(deposit > 0);
    balRow.hidden = !(deposit > 0);
    if (deposit > 0) {
      summaryEl.querySelector('#sum-deposit').textContent = money(deposit);
      const balance = Math.max(0, total - deposit);
      summaryEl.querySelector('#sum-balance').textContent = money(balance);
      balRow.classList.toggle('is-owing', balance > 0.004);
    }
    discInput?.classList.toggle('is-invalid', !!limited);
    summaryEl.querySelector('#sum-notices').innerHTML = `
      ${limited ? `<div class="notice notice--danger">${icon('alert', 15)} Discount exceeds the ${esc(settings.discount_limit_pct)}% staff limit. Ask an owner.</div>` : ''}
      ${Number(settings.deposit_required_above) > 0 && total >= Number(settings.deposit_required_above) && deposit === 0
        ? `<div class="notice notice--warn">${icon('alert', 15)} A deposit is expected above ${esc(money(settings.deposit_required_above, { decimals: 0 }))}.</div>` : ''}`;
  }

  summaryEl.innerHTML = summarySkeleton();
  summaryEl.querySelector('#discount').addEventListener('input', updateSummary);
  summaryEl.querySelector('#delivery_fee').addEventListener('input', updateSummary);
  summaryEl.querySelector('#discount').addEventListener('change', updateSummary);
  summaryEl.querySelector('#delivery_fee').addEventListener('change', updateSummary);

  bodyEl.addEventListener('input', (e) => {
    if (e.target.dataset.f === 'qty' || e.target.dataset.f === 'unit_price') updateSummary();
  });
  bodyEl.addEventListener('change', (e) => {
    if (e.target.dataset.f === 'qty' || e.target.dataset.f === 'unit_price') updateSummary();
  });
  bodyEl.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      readLines();
      lines.splice(Number(rm.dataset.remove), 1);
      if (!lines.length) lines.push({ product_id: null, item_name: '', qty: 1, unit_price: 0 });
      drawLines();
    }
  });
  wireItemPicker(bodyEl, products, {
    onSelect: () => updateSummary(),
    onInput: () => updateSummary(),
  });
  root.querySelector('#add-line').addEventListener('click', () => {
    readLines();
    lines.push({ product_id: null, item_name: '', qty: 1, unit_price: 0 });
    drawLines(lines.length - 1);
  });

  const pick = root.querySelector('#customer_pick');
  const newCustomer = root.querySelector('#new-customer');
  pick.addEventListener('change', () => {
    newCustomer.hidden = !!pick.value;
    if (pick.value) {
      const c = customers.find((x) => x.id === pick.value);
      if (c) {
        root.querySelector('#delivery_address').value = c.address || '';
        root.querySelector('#delivery_city').value = c.city || '';
        root.querySelector('#delivery_state').value = c.state || '';
      }
    }
  });
  // A blank select means "+ New customer", so its fields must start visible.
  newCustomer.hidden = !!pick.value;

  const fulfilment = root.querySelector('#fulfilment');
  const deliveryFields = root.querySelector('#delivery-fields');
  fulfilment.addEventListener('change', () => {
    deliveryFields.hidden = fulfilment.value !== 'delivery';
  });

  if (presetCustomer) {
    newCustomer.hidden = true;
    root.querySelector('#delivery_address').value = presetCustomer.address || '';
    root.querySelector('#delivery_city').value = presetCustomer.city || '';
    root.querySelector('#delivery_state').value = presetCustomer.state || '';
  }

  root.querySelector('#deposit').addEventListener('input', updateSummary);

  root.querySelectorAll('[data-save]').forEach((btn) => {
    btn.addEventListener('click', () => { target = btn.dataset.save; });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.hidden = true;
    readLines();

    const existing = pick.value;
    const isQuote = target === 'quote';
    const date = root.querySelector('#delivery_date').value;
    const items = lines.filter((l) => l.item_name && l.qty > 0);
    const discount = Number(root.querySelector('#discount').value || 0);
    const discountReason = root.querySelector('#discount_reason').value.trim();
    const fee = Number(root.querySelector('#delivery_fee').value || 0);
    const deposit = Number(root.querySelector('#deposit').value || 0);

    try {
      if (!existing) {
        if (!root.querySelector('#cust_name').value.trim()) throw new Error('Enter the customer name.');
        if (!root.querySelector('#cust_phone').value.trim()) throw new Error('Enter the customer phone number.');
      }
      if (!items.length) throw new Error('Add at least one item.');
      if (!isQuote && !date) throw new Error('Choose a delivery or pick-up date.');
      if (discount > 0 && !discountReason) throw new Error('A discount requires a reason.');
      if (fulfilment.value === 'delivery' && !isQuote && !root.querySelector('#delivery_address').value.trim()) {
        throw new Error('A delivery order needs an address.');
      }

      const saveBtn = root.querySelector(`[data-save="${target}"]`);
      setBusy(saveBtn, true, 'Saving…');

      let customerId = existing;
      if (!customerId) {
        const { data, error } = await sb.from('customers').insert({
          name: root.querySelector('#cust_name').value.trim(),
          phone: root.querySelector('#cust_phone').value.trim(),
          email: root.querySelector('#cust_email').value.trim() || null,
          city: root.querySelector('#cust_city').value.trim() || null,
          state: root.querySelector('#cust_state').value.trim() || null,
          address: root.querySelector('#cust_address').value.trim() || null,
          channel: root.querySelector('#channel').value,
        }).select().single();
        if (error) throw new Error(errText(error));
        customerId = data.id;
      }

      const { data: created, error } = await sb.rpc('create_order', {
        p_customer: customerId,
        p_kind: root.querySelector('#kind').value,
        p_channel: root.querySelector('#channel').value,
        p_fulfilment: fulfilment.value,
        p_delivery_address: root.querySelector('#delivery_address').value.trim() || null,
        p_delivery_city: root.querySelector('#delivery_city').value.trim() || null,
        p_delivery_state: root.querySelector('#delivery_state').value.trim() || null,
        p_delivery_date: date || today(),
        p_discount: discount,
        p_discount_reason: discount > 0 ? discountReason : null,
        p_delivery_fee: fee,
        p_custom_details: root.querySelector('#custom_details').value.trim() || null,
        p_notes: root.querySelector('#notes').value.trim() || null,
        p_items: items.map((l) => ({
          product_id: l.product_id || null,
          item_name: l.item_name,
          qty: l.qty,
          unit_price: l.unit_price,
        })),
      });
      if (error) throw new Error(errText(error));

      if (isQuote) {
        const { error: qErr } = await sb.from('orders').update({ status: 'quote', delivery_date: date || null }).eq('id', created.id);
        if (qErr) throw new Error(errText(qErr));
      }

      if (deposit > 0) {
        const { error: pErr } = await sb.from('payments').insert({
          order_id: created.id, amount: deposit,
          method: root.querySelector('#deposit_method').value,
          paid_on: today(), note: 'Deposit with order',
        });
        if (pErr) throw new Error(errText(pErr));
      }

      dataChanged('orders');
      toast(isQuote ? 'Quote saved.' : 'Order created.');
      ctx.navigate(`#/orders/${created.id}`);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
      root.querySelectorAll('[data-save]').forEach((b) => setBusy(b, false));
    }
  });

  drawLines();
}
