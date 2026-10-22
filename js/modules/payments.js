// Payments: deposits, balances, refunds and daily collection history.
import { sb, errText, dataChanged } from '../supabase.js';
import {
  esc, money, num, fmtDate, titleCase, badge, icon, toast, formModal,
  emptyState, spinner, table, today, monthStart, addDays, labelFor, exportModal,
} from '../ui.js';
import { PAYMENT_METHODS } from '../config.js';

const PERIODS = [
  { value: 'month', label: 'This month' },
  { value: '30', label: 'Last 30 days' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' },
];

function ymd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function rangeFor(period) {
  if (period === 'all') return { from: '', to: '' };
  if (period === '30') return { from: addDays(-29), to: today() };
  const now = new Date();
  if (period === 'year') {
    return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` };
  }
  return {
    from: monthStart(),
    to: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

export async function render(root, _params, ctx) {
  root.innerHTML = `<div class="route-loading">${spinner('Counting the money…')}</div>`;

  const state = { period: 'month', method: '', search: '' };
  let payments = [];
  let orders = [];
  let customers = [];
  let balances = [];

  async function load() {
    const [pRes, oRes, cRes, bRes] = await Promise.all([
      sb.from('payments').select('*').is('deleted_at', null)
        .order('paid_on', { ascending: false }).order('created_at', { ascending: false }).limit(1000),
      sb.from('orders').select('id,order_no,customer_id,total,amount_paid,status,delivery_date')
        .is('deleted_at', null).limit(1000),
      sb.from('customers').select('id,name,phone').is('deleted_at', null).limit(1000),
      sb.from('v_order_balances').select('*').order('balance', { ascending: false }).limit(100),
    ]);
    for (const result of [pRes, oRes, cRes, bRes]) {
      if (result.error) throw new Error(errText(result.error));
    }
    payments = pRes.data || [];
    orders = oRes.data || [];
    customers = cRes.data || [];
    balances = bRes.data || [];
  }

  try {
    await load();
  } catch (e) {
    root.innerHTML = `<div class="notice notice--danger">${icon('alert', 18)} ${esc(e.message)}</div>`;
    return;
  }

  function draw() {
    const orderMap = new Map(orders.map((o) => [o.id, o]));
    const customerMap = new Map(customers.map((c) => [c.id, c]));
    const { from, to } = rangeFor(state.period);

    const filtered = payments
      .filter((p) => !from || (p.paid_on >= from && p.paid_on <= to))
      .filter((p) => !state.method || p.method === state.method)
      .filter((p) => {
        if (!state.search) return true;
        const order = orderMap.get(p.order_id);
        const customer = customerMap.get(order?.customer_id);
        return [order?.order_no, customer?.name, p.note, p.method]
          .some((value) => String(value || '').toLowerCase().includes(state.search.toLowerCase()));
      });

    const collected = filtered.filter((p) => Number(p.amount) > 0)
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const refunds = filtered.filter((p) => Number(p.amount) < 0)
      .reduce((sum, p) => sum + Math.abs(Number(p.amount)), 0);
    const net = filtered.reduce((sum, p) => sum + Number(p.amount), 0);
    const outstanding = balances.reduce((sum, b) => sum + Number(b.balance || 0), 0);
    const methods = PAYMENT_METHODS.map((method) => ({
      ...method,
      total: filtered.filter((p) => p.method === method.value && Number(p.amount) > 0)
        .reduce((sum, p) => sum + Number(p.amount), 0),
      count: filtered.filter((p) => p.method === method.value && Number(p.amount) > 0).length,
    }));
    const methodMax = Math.max(...methods.map((m) => m.total), 1);

    root.innerHTML = `
      <div class="page-head">
        <div>
          <p class="eyebrow">Sales</p>
          <h1>Payments</h1>
          <p class="page-sub">Deposits, balances and refunds — every naira that moves.</p>
        </div>
        <div class="page-actions">
          <button class="btn btn--ghost" data-export>${icon('download', 17)} Export</button>
          <button class="btn btn--primary" data-new-payment>${icon('plus', 17)} Record payment</button>
        </div>
      </div>

      <div class="mini-stats">
        <div class="mini-stat mini-stat--sage">
          <span class="mini-stat__icon">${icon('wallet', 17)}</span>
          <span><small>Collected</small><strong>${money(collected, { decimals: 0 })}</strong></span>
        </div>
        <div class="mini-stat mini-stat--danger">
          <span class="mini-stat__icon">${icon('undo', 17)}</span>
          <span><small>Refunds</small><strong>${money(refunds, { decimals: 0 })}</strong></span>
        </div>
        <div class="mini-stat mini-stat--berry">
          <span class="mini-stat__icon">${icon('card', 17)}</span>
          <span><small>Net received</small><strong>${money(net, { decimals: 0 })}</strong></span>
        </div>
        <div class="mini-stat mini-stat--caramel">
          <span class="mini-stat__icon">${icon('clock', 17)}</span>
          <span><small>Outstanding</small><strong>${money(outstanding, { decimals: 0 })}</strong></span>
        </div>
      </div>

      <div class="payments-layout">
        <section class="card">
          <div class="toolbar">
            <div class="search-box">
              ${icon('search', 17)}
              <input type="search" placeholder="Search order, customer or note…" data-search value="${esc(state.search)}">
            </div>
            <div class="toolbar__filters">
              <select data-method-filter aria-label="Payment method">
                <option value="">Method: all</option>
                ${PAYMENT_METHODS.map((m) => `<option value="${m.value}" ${state.method === m.value ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="payment-periods">
            ${PERIODS.map((period) => `<button type="button" class="chip ${state.period === period.value ? 'is-active' : ''}" data-period="${period.value}">${esc(period.label)}</button>`).join('')}
            <span class="payment-periods__count">${num(filtered.length)} payment${filtered.length === 1 ? '' : 's'}</span>
          </div>
          <div id="payments-table"></div>
        </section>

        <aside class="payments-side">
          <section class="card card--pad">
            <div class="card-head"><div><h2>By method</h2><p class="muted">Collected in this view</p></div>${icon('card', 18)}</div>
            ${methods.some((m) => m.count) ? `<div class="method-list">${methods.map((m) => `
              <div class="payment-method-row">
                <div class="payment-method-row__top"><span>${esc(m.label)}</span><strong>${money(m.total, { decimals: 0 })}</strong></div>
                <div class="bar"><span style="width:${Math.max(2, (m.total / methodMax) * 100)}%"></span></div>
                <small>${num(m.count)} payment${m.count === 1 ? '' : 's'}</small>
              </div>`).join('')}</div>` : '<p class="muted">No payments in this view.</p>'}
          </section>

          <section class="card card--pad">
            <div class="card-head"><div><h2>Outstanding</h2><p class="muted">Orders still owing</p></div>${icon('alert', 18)}</div>
            ${balances.length ? `<div class="balance-list">${balances.slice(0, 6).map((b) => `
              <a class="balance-row" href="#/orders/${esc(b.id)}">
                <span><strong>${esc(b.customer_name || 'Walk-in')}</strong><small>${esc(b.order_no)} · ${esc(fmtDate(b.delivery_date))}</small></span>
                <strong class="text-danger">${money(b.balance, { decimals: 0 })}</strong>
              </a>`).join('')}</div>` : '<p class="muted">Every order is fully paid.</p>'}
            ${balances.length > 6 ? `<a class="link small" href="#/orders">See all in orders →</a>` : ''}
          </section>
        </aside>
      </div>`;

    const tableEl = root.querySelector('#payments-table');
    tableEl.innerHTML = filtered.length ? table({
      columns: [
        {
          key: 'paid_on', label: 'Date',
          render: (p) => `<div class="cell-main"><strong>${esc(fmtDate(p.paid_on))}</strong><small>${esc(p.note || '')}</small></div>`,
        },
        {
          key: 'order_id', label: 'Order',
          render: (p) => {
            const order = orderMap.get(p.order_id);
            const customer = customerMap.get(order?.customer_id);
            return `<div class="cell-main"><strong>${esc(order?.order_no || 'Order removed')}</strong><small>${esc(customer?.name || 'Walk-in customer')}</small></div>`;
          },
        },
        {
          key: 'method', label: 'Method',
          render: (p) => badge(labelFor(PAYMENT_METHODS, p.method), p.method === 'cash' ? 'sage' : p.method === 'transfer' ? 'info' : 'muted'),
        },
        {
          key: 'amount', label: 'Amount', className: 'num',
          render: (p) => `<strong class="${Number(p.amount) < 0 ? 'text-danger' : ''}">${money(p.amount)}</strong>`,
        },
        {
          key: 'status', label: 'Order status',
          render: (p) => statusFor(orderMap.get(p.order_id)?.status),
        },
        {
          key: 'open', label: '',
          render: (p) => orderMap.get(p.order_id)
            ? `<a class="btn btn--sm btn--ghost" href="#/orders/${esc(p.order_id)}">Open</a>`
            : '<span class="muted">—</span>',
        },
      ],
      rows: filtered,
      rowKey: 'id',
      empty: 'No payments match this view.',
    }) : emptyState({
      iconName: 'card', title: 'No payments yet',
      text: 'Record a deposit or balance against an order to see it here.',
      action: '<button class="btn btn--primary" data-new-payment>Record payment</button>',
    });

    root.querySelector('[data-search]').addEventListener('change', (e) => {
      state.search = e.target.value.trim();
      draw();
    });
    root.querySelector('[data-method-filter]').addEventListener('change', (e) => {
      state.method = e.target.value;
      draw();
    });
    root.querySelectorAll('[data-period]').forEach((button) => button.addEventListener('click', () => {
      state.period = button.dataset.period;
      draw();
    }));
    root.querySelectorAll('[data-new-payment]').forEach((button) => button.addEventListener('click', openPaymentForm));
    root.querySelector('[data-export]').addEventListener('click', () => {
      exportModal({
        title: 'Payments',
        filename: `payments-${state.period}-${today()}`,
        rows: filtered,
        columns: [
          { key: 'paid_on', label: 'Date', value: (p) => fmtDate(p.paid_on) },
          {
            key: 'order_id', label: 'Order',
            value: (p) => orderMap.get(p.order_id)?.order_no || 'Order removed',
          },
          {
            key: 'customer', label: 'Customer',
            value: (p) => customerMap.get(orderMap.get(p.order_id)?.customer_id)?.name || 'Walk-in customer',
          },
          { key: 'method', label: 'Method', value: (p) => labelFor(PAYMENT_METHODS, p.method) },
          { key: 'amount', label: 'Amount', className: 'num' },
          { key: 'note', label: 'Note' },
        ],
        meta: `Payments · ${PERIODS.find((p) => p.value === state.period)?.label || state.period}`,
      });
    });
  }

  function statusFor(status) {
    if (!status) return '<span class="muted">—</span>';
    return badge(titleCase(status), status === 'completed' ? 'success' : status === 'cancelled' ? 'danger' : 'info');
  }

  function openPaymentForm() {
    const orderOptions = balances.map((b) => ({
      value: b.id,
      label: `${b.order_no} — ${b.customer_name || 'Walk-in'} — ${money(b.balance)} due`,
      balance: Number(b.balance || 0),
    }));
    if (!orderOptions.length) {
      toast('There are no outstanding balances to collect.', 'warn');
      return;
    }

    formModal({
      title: 'Record a payment',
      intro: 'Choose an order, then record the amount received. The order balance updates automatically.',
      submitLabel: 'Record payment',
      fields: [
        { name: 'order_id', label: 'Order', type: 'select', options: orderOptions, required: true, span: 2 },
        { name: 'amount', label: 'Amount received', type: 'money', required: true, min: 0.01, help: 'The full balance is filled in for you.' },
        { name: 'method', label: 'Method', type: 'select', options: PAYMENT_METHODS, required: true, default: 'cash' },
        { name: 'paid_on', label: 'Date received', type: 'date', required: true, default: today() },
        { name: 'note', label: 'Note', type: 'text', span: 2, placeholder: 'e.g. balance on delivery' },
      ],
      values: {
        order_id: orderOptions[0].value,
        amount: orderOptions[0].balance,
        method: 'cash',
        paid_on: today(),
      },
      onOpen: (el) => {
        const orderSelect = el.querySelector('[name="order_id"]');
        const amountInput = el.querySelector('[name="amount"]');
        const sync = () => {
          const selected = orderOptions.find((o) => o.value === orderSelect.value);
          if (selected) amountInput.value = selected.balance;
        };
        orderSelect.addEventListener('change', sync);
      },
      onSubmit: async (values) => {
        const selected = orderOptions.find((o) => o.value === values.order_id);
        if (!selected) throw new Error('Choose an order.');
        if (Number(values.amount) <= 0) throw new Error('Enter an amount greater than zero.');
        if (Number(values.amount) > selected.balance + 0.004) {
          throw new Error('That is more than the outstanding balance on this order.');
        }
        const { error } = await sb.from('payments').insert({
          order_id: values.order_id,
          amount: Number(values.amount),
          method: values.method,
          paid_on: values.paid_on,
          note: values.note,
        });
        if (error) throw new Error(errText(error));
        dataChanged('payments');
        await load();
        toast('Payment recorded.');
        draw();
      },
    });
  }

  draw();
}
