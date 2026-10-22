// Reports: sales, profit, stock and cash — filterable by period.
import { sb, errText } from '../supabase.js';
import {
  esc, money, compactMoney, num, pct, fmtDate, today, monthStart, titleCase, badge, icon,
  toast, emptyState, spinner, lineChart, barList, exportModal, printHTML, labelFor,
} from '../ui.js';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from '../config.js';

const PERIODS = [
  { value: 'month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
];

export async function render(root, params, ctx) {
  const state = { period: 'month', from: '', to: '' };
  let data = null;

  root.innerHTML = `<div class="route-loading">${spinner('Crunching the numbers…')}</div>`;

  function range() {
    const now = new Date();
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (state.period === 'custom') return { start: state.from || monthStart(), end: state.to || iso(now) };
    if (state.period === 'last_month') {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start: iso(d), end: iso(e) };
    }
    if (state.period === 'year') return { start: `${now.getFullYear()}-01-01`, end: iso(now) };
    if (state.period === 'all') return { start: '2000-01-01', end: iso(now) };
    if (state.period === '30' || state.period === '90') {
      const d = new Date(now);
      d.setDate(d.getDate() - Number(state.period));
      return { start: iso(d), end: iso(now) };
    }
    return { start: monthStart(), end: iso(now) };
  }

  async function load() {
    root.innerHTML = `<div class="route-loading">${spinner('Crunching the numbers…')}</div>`;
    const { start, end } = range();
    try {
      const [oRes, eRes, payRes, custRes, restockRes, pnlRes, cashRes, balRes] = await Promise.all([
        sb.from('orders').select('*').is('deleted_at', null).gte('created_at', `${start}T00:00:00`).lte('created_at', `${end}T23:59:59`).order('created_at'),
        sb.from('expenses').select('*').is('deleted_at', null).gte('spent_on', start).lte('spent_on', end),
        sb.from('payments').select('*').is('deleted_at', null).gte('paid_on', start).lte('paid_on', end),
        sb.from('customers').select('id,name,state,city'),
        sb.from('v_ingredient_restock').select('*'),
        sb.from('v_profit_and_loss').select('*'),
        sb.from('v_daily_cashup').select('*'),
        sb.from('v_order_balances').select('*'),
      ]);
      for (const r of [oRes, eRes, payRes, custRes, restockRes, pnlRes, cashRes, balRes]) {
        if (r.error) throw new Error(errText(r.error));
      }
      const orders = (oRes.data || []).filter((o) => o.status === 'completed');
      const orderIds = orders.map((o) => o.id);
      let items = [];
      if (orderIds.length) {
        const { data, error } = await sb.from('order_items').select('*').in('order_id', orderIds);
        if (error) throw new Error(errText(error));
        items = data || [];
      }
      const itemMap = new Map();
      for (const it of items) {
        const arr = itemMap.get(it.order_id) || [];
        arr.push(it);
        itemMap.set(it.order_id, arr);
      }
      data = {
        start, end, orders, items, itemMap,
        expenses: eRes.data || [],
        payments: payRes.data || [],
        customers: custRes.data || [],
        restock: restockRes.data || [],
        pnl: pnlRes.data || [],
        cash: cashRes.data || [],
        balances: balRes.data || [],
      };
      draw();
    } catch (e) {
      root.innerHTML = `<div class="notice notice--danger">${icon('alert', 18)} ${esc(e.message)}</div>`;
    }
  }

  function draw() {
    const { start, end, orders, items, expenses, payments, customers, restock, pnl, balances } = data;
    const cash = (data.cash || []).filter((c) => c.day >= start && c.day <= end);
    const customerMap = new Map(customers.map((c) => [c.id, c]));

    const revenue = orders.reduce((s, o) => s + Number(o.total), 0);
    const cogs = items.reduce((s, it) => s + Number(it.qty) * Number(it.unit_cost || 0), 0);
    const gross = revenue - cogs;
    const opex = expenses.filter((e) => e.category !== 'ingredients').reduce((s, e) => s + Number(e.amount), 0);
    const net = gross - opex;
    const avg = orders.length ? revenue / orders.length : 0;
    const outstanding = balances.reduce((s, b) => s + Number(b.balance), 0);
    const margin = revenue > 0 ? (gross / revenue) * 100 : null;
    const collected = payments.reduce((s, p) => s + Number(p.amount), 0);

    // product performance
    const prodMap = new Map();
    for (const it of items) {
      const key = it.product_id || it.item_name;
      const cur = prodMap.get(key) || { name: it.item_name, qty: 0, revenue: 0, cost: 0 };
      cur.qty += Number(it.qty);
      cur.revenue += Number(it.line_total);
      cur.cost += Number(it.qty) * Number(it.unit_cost || 0);
      prodMap.set(key, cur);
    }
    const products = [...prodMap.values()].sort((a, b) => b.revenue - a.revenue);

    // top customers
    const custMap = new Map();
    for (const o of orders) {
      const c = customerMap.get(o.customer_id);
      if (!c) continue;
      const cur = custMap.get(c.id) || { name: c.name, value: 0, orders: 0 };
      cur.value += Number(o.total);
      cur.orders += 1;
      custMap.set(c.id, cur);
    }
    const topCustomers = [...custMap.values()].sort((a, b) => b.value - a.value).slice(0, 6)
      .map((c) => ({ label: c.name, value: c.value, sub: `${c.orders} order${c.orders === 1 ? '' : 's'}` }));

    // top locations
    const locMap = new Map();
    for (const o of orders) {
      const c = customerMap.get(o.customer_id);
      const label = [c?.city, c?.state].filter(Boolean).join(', ') || 'Unspecified';
      const cur = locMap.get(label) || { label, value: 0, orders: 0 };
      cur.value += Number(o.total);
      cur.orders += 1;
      locMap.set(label, cur);
    }
    const topLocations = [...locMap.values()].sort((a, b) => b.value - a.value).slice(0, 6)
      .map((l) => ({ label: l.label, value: l.value, sub: `${l.orders} order${l.orders === 1 ? '' : 's'}` }));

    // trend
    const spanDays = Math.max(1, Math.round((new Date(end) - new Date(start)) / 86400000));
    const byMonth = spanDays > 92;
    const trendMap = new Map();
    for (const o of orders) {
      const d = new Date(o.created_at);
      const key = byMonth
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
        : o.created_at.slice(0, 10);
      trendMap.set(key, (trendMap.get(key) || 0) + Number(o.total));
    }
    const points = [];
    if (byMonth) {
      const cursor = new Date(start);
      cursor.setDate(1);
      while (cursor <= new Date(end)) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-01`;
        points.push({ label: new Date(key).toLocaleDateString('en-NG', { month: 'short' }), value: trendMap.get(key) || 0 });
        cursor.setMonth(cursor.getMonth() + 1);
      }
    } else {
      const cursor = new Date(start);
      const last = new Date(end);
      while (cursor <= last) {
        const key = cursor.toISOString().slice(0, 10);
        points.push({ label: new Date(key).toLocaleDateString('en-NG', { day: '2-digit', month: 'short' }), value: trendMap.get(key) || 0 });
        cursor.setDate(cursor.getDate() + 1);
      }
      if (points.length > 31) {
        const step = Math.ceil(points.length / 31);
        const sampled = points.filter((_, i) => i % step === 0 || i === points.length - 1);
        points.length = 0;
        points.push(...sampled);
      }
    }

    // expense breakdown
    const expMap = new Map();
    for (const e of expenses) expMap.set(e.category, (expMap.get(e.category) || 0) + Number(e.amount));
    const expList = [...expMap.entries()].sort((a, b) => b[1] - a[1]);
    const expMax = expList[0]?.[1] || 1;

    // cash by method
    const cashMap = new Map();
    for (const p of payments) cashMap.set(p.method, (cashMap.get(p.method) || 0) + Number(p.amount));
    const cashList = [...cashMap.entries()].sort((a, b) => b[1] - a[1]);

    root.innerHTML = `
      <div class="page-head">
        <div>
          <p class="eyebrow">Insights</p>
          <h1>Reports</h1>
          <p class="page-sub">${esc(fmtDate(start))} – ${esc(fmtDate(end))} · completed orders only</p>
        </div>
        <div class="page-actions">
          <button class="btn btn--ghost" data-print>${icon('print', 17)} Print</button>
        </div>
      </div>

      <section class="card card--pad report-filter">
        <div class="period-tabs">
          ${PERIODS.map((p) => `<button class="chip ${state.period === p.value ? 'is-active' : ''}" data-period="${p.value}">${esc(p.label)}</button>`).join('')}
        </div>
        ${state.period === 'custom' ? `<div class="custom-range">
          <div class="field"><label for="r_from">From</label><input id="r_from" type="date" value="${esc(state.from || start)}"></div>
          <div class="field"><label for="r_to">To</label><input id="r_to" type="date" value="${esc(state.to || end)}"></div>
          <button class="btn btn--sm btn--primary" data-apply-range>Apply</button>
        </div>` : ''}
      </section>

      <div class="kpi-grid">
        ${kpi('Revenue', money(revenue, { decimals: 0 }), `${orders.length} completed order${orders.length === 1 ? '' : 's'}`, 'card', 'berry')}
        ${kpi('Gross profit', money(gross, { decimals: 0 }), margin == null ? 'No sales' : `${pct(margin)} margin`, 'chart', 'sage')}
        ${kpi('Net profit', money(net, { decimals: 0 }), `after ${money(opex, { decimals: 0 })} overheads`, 'wallet', net >= 0 ? 'cocoa' : 'danger')}
        ${kpi('Average order', money(avg, { decimals: 0 }), `${money(cogs, { decimals: 0 })} cost of goods`, 'bag', 'caramel')}
        ${kpi('Cash collected', money(collected, { decimals: 0 }), `${payments.length} payment${payments.length === 1 ? '' : 's'}`, 'card', 'purple')}
        ${kpi('Outstanding', money(outstanding, { decimals: 0 }), `${balances.length} order${balances.length === 1 ? '' : 's'} owing`, 'clock', 'danger', '#/orders')}
      </div>

      <div class="report-grid">
        <section class="card card--pad report-wide">
          <div class="card-head"><div><h2>Sales trend</h2><p class="muted">${byMonth ? 'Monthly' : 'Daily'} completed revenue</p></div><span class="pill">${money(revenue, { decimals: 0 })}</span></div>
          ${lineChart({ points })}
        </section>

        <section class="card card--pad">
          <div class="card-head"><div><h2>Top customers</h2><p class="muted">By revenue in period</p></div>${icon('users', 18)}</div>
          ${barList(topCustomers)}
        </section>

        <section class="card card--pad">
          <div class="card-head"><div><h2>Top locations</h2><p class="muted">Where cakes are going</p></div>${icon('pin', 18)}</div>
          ${barList(topLocations)}
        </section>

        <section class="card report-wide">
          <div class="card-head card-head--pad">
            <div><h2>Product performance</h2><p class="muted">Revenue, cost and margin per item</p></div>
            <button class="btn btn--sm btn--ghost" data-csv-products>${icon('download', 15)} Export</button>
          </div>
          ${products.length ? `<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Revenue</th><th class="num">Cost</th><th class="num">Margin</th><th class="num">Margin %</th></tr></thead>
            <tbody>${products.map((p) => {
              const m = p.revenue > 0 ? ((p.revenue - p.cost) / p.revenue) * 100 : null;
              return `<tr>
                <td><strong>${esc(p.name)}</strong></td>
                <td class="num">${num(p.qty, 2)}</td>
                <td class="num">${money(p.revenue, { decimals: 0 })}</td>
                <td class="num">${money(p.cost, { decimals: 0 })}</td>
                <td class="num">${money(p.revenue - p.cost, { decimals: 0 })}</td>
                <td class="num">${m == null ? '—' : badge(pct(m), m >= 40 ? 'success' : m >= 20 ? 'warn' : 'danger')}</td>
              </tr>`;
            }).join('')}</tbody></table></div>` : emptyState({ iconName: 'cake', title: 'No product sales', text: 'Completed orders in this period will show here.' })}
        </section>

        <section class="card card--pad">
          <div class="card-head"><div><h2>Expenses</h2><p class="muted">By category in period</p></div>${icon('wallet', 18)}</div>
          ${expList.length ? `<div class="bar-list">${expList.map(([cat, amount]) => `
            <div class="bar-row">
              <div class="bar-row__top"><span>${esc(labelFor(EXPENSE_CATEGORIES, cat))}</span><strong>${money(amount, { decimals: 0 })}</strong></div>
              <div class="bar"><span style="width:${Math.max(2, (amount / expMax) * 100)}%"></span></div>
            </div>`).join('')}</div>
            <div class="rule-row"><span>Total overheads</span><strong>${money(opex, { decimals: 0 })}</strong></div>`
            : '<p class="muted">No expenses in this period.</p>'}
        </section>

        <section class="card card--pad">
          <div class="card-head"><div><h2>Cash collected</h2><p class="muted">By payment method</p></div>${icon('card', 18)}</div>
          ${cashList.length ? `<div class="method-list">${cashList.map(([method, amount]) => `
            <div class="method-row"><span>${esc(labelFor(PAYMENT_METHODS, method))}</span><strong>${money(amount, { decimals: 0 })}</strong></div>`).join('')}
            <div class="rule-row"><span>Total</span><strong>${money(collected, { decimals: 0 })}</strong></div></div>` : '<p class="muted">No payments in this period.</p>'}
        </section>

        <section class="card report-wide">
          <div class="card-head card-head--pad">
            <div><h2>Profit &amp; loss</h2><p class="muted">Monthly, all recorded periods</p></div>
            <button class="btn btn--sm btn--ghost" data-csv-pnl>${icon('download', 15)} Export</button>
          </div>
          ${pnl.length ? `<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Month</th><th class="num">Revenue</th><th class="num">COGS</th><th class="num">Gross</th><th class="num">Overheads</th><th class="num">Net profit</th></tr></thead>
            <tbody>${pnl.slice(0, 12).map((r) => `<tr>
              <td><strong>${esc(monthLabel(r.month))}</strong></td>
              <td class="num">${money(r.revenue, { decimals: 0 })}</td>
              <td class="num">${money(r.cogs, { decimals: 0 })}</td>
              <td class="num">${money(Number(r.revenue) - Number(r.cogs), { decimals: 0 })}</td>
              <td class="num">${money(r.expenses, { decimals: 0 })}</td>
              <td class="num ${Number(r.profit) < 0 ? 'text-danger' : 'text-sage'}"><strong>${money(r.profit, { decimals: 0 })}</strong></td>
            </tr>`).join('')}</tbody></table></div>` : '<p class="muted">No completed sales or expenses yet.</p>'}
        </section>

        <section class="card report-wide">
          <div class="card-head card-head--pad">
            <div><h2>Daily cash-up</h2><p class="muted">Payments by day and method</p></div>
            <button class="btn btn--sm btn--ghost" data-csv-cash>${icon('download', 15)} Export</button>
          </div>
          ${cash.length ? `<div class="table-wrap"><table class="data-table data-table--tight">
            <thead><tr><th>Day</th><th>Method</th><th class="num">Transactions</th><th class="num">Amount</th></tr></thead>
            <tbody>${cash.slice(0, 40).map((c) => `<tr>
              <td>${esc(fmtDate(c.day))}</td>
              <td>${badge(labelFor(PAYMENT_METHODS, c.method), 'info')}</td>
              <td class="num">${num(c.txns)}</td>
              <td class="num"><strong>${money(c.amount)}</strong></td>
            </tr>`).join('')}</tbody></table></div>` : '<p class="muted">No payments recorded yet.</p>'}
        </section>

        <section class="card report-wide">
          <div class="card-head card-head--pad">
            <div><h2>Ingredient restocking</h2><p class="muted">All-time spend and last delivery</p></div>
            <button class="btn btn--sm btn--ghost" data-csv-restock>${icon('download', 15)} Export</button>
          </div>
          ${restock.length ? `<div class="table-wrap"><table class="data-table data-table--tight">
            <thead><tr><th>Ingredient</th><th class="num">Qty restocked</th><th class="num">Spent</th><th class="num">Receipts</th><th>Last received</th></tr></thead>
            <tbody>${restock.slice(0, 15).map((r) => `<tr>
              <td><strong>${esc(r.name)}</strong></td>
              <td class="num">${num(r.qty_restocked, 2)} ${esc(r.unit)}</td>
              <td class="num">${money(r.amount_spent, { decimals: 0 })}</td>
              <td class="num">${num(r.receipts)}</td>
              <td>${r.last_received ? esc(fmtDate(r.last_received)) : '<span class="muted">Never</span>'}</td>
            </tr>`).join('')}</tbody></table></div>` : '<p class="muted">No stock receipts yet.</p>'}
        </section>
      </div>`;

    // bindings
    root.querySelectorAll('[data-period]').forEach((b) => b.addEventListener('click', () => {
      state.period = b.dataset.period;
      if (state.period !== 'custom') load();
      else draw();
    }));
    root.querySelector('[data-apply-range]')?.addEventListener('click', () => {
      const from = root.querySelector('#r_from').value;
      const to = root.querySelector('#r_to').value;
      if (from && to && from > to) { toast('The start date must be before the end date.', 'error'); return; }
      state.from = from;
      state.to = to;
      load();
    });
    root.querySelector('[data-print]')?.addEventListener('click', () => printReport({ start, end, revenue, cogs, gross, opex, net, orders, products, topCustomers, topLocations, cashList, collected, expList, ctx, settings: ctx.settings }));
    const rangeMeta = `${fmtDate(start)} to ${fmtDate(end)}`;
    root.querySelector('[data-csv-products]')?.addEventListener('click', () => {
      exportModal({
        title: 'Product performance',
        filename: `product-sales-${start}-to-${end}`,
        rows: products,
        columns: [
          { key: 'name', label: 'Product' }, { key: 'qty', label: 'Qty sold', className: 'num' },
          { key: 'revenue', label: 'Revenue', className: 'num' }, { key: 'cost', label: 'Cost', className: 'num' },
          { key: '_margin', label: 'Margin', className: 'num', value: (p) => Number(p.revenue) - Number(p.cost) },
        ],
        meta: rangeMeta,
      });
    });
    root.querySelector('[data-csv-pnl]')?.addEventListener('click', () => {
      exportModal({
        title: 'Profit and loss',
        filename: `profit-and-loss-${today()}`,
        rows: pnl,
        columns: [
          { key: 'month', label: 'Month' }, { key: 'revenue', label: 'Revenue', className: 'num' },
          { key: 'cogs', label: 'COGS', className: 'num' }, { key: 'expenses', label: 'Overheads', className: 'num' },
          { key: 'profit', label: 'Net profit', className: 'num' },
        ],
        meta: 'Monthly, all recorded periods',
      });
    });
    root.querySelector('[data-csv-cash]')?.addEventListener('click', () => {
      exportModal({
        title: 'Daily cash-up',
        filename: `cashup-${start}-to-${end}`,
        rows: cash,
        columns: [
          { key: 'day', label: 'Day', value: (c) => fmtDate(c.day) },
          { key: 'method', label: 'Method', value: (c) => labelFor(PAYMENT_METHODS, c.method) },
          { key: 'txns', label: 'Transactions', className: 'num' },
          { key: 'amount', label: 'Amount', className: 'num' },
        ],
        meta: rangeMeta,
      });
    });
    root.querySelector('[data-csv-restock]')?.addEventListener('click', () => {
      exportModal({
        title: 'Ingredient restocking',
        filename: `restocking-${today()}`,
        rows: restock,
        columns: [
          { key: 'name', label: 'Ingredient' }, { key: 'qty_restocked', label: 'Qty restocked', className: 'num' },
          { key: 'unit', label: 'Unit' }, { key: 'amount_spent', label: 'Spent', className: 'num' },
          { key: 'receipts', label: 'Receipts', className: 'num' },
          { key: 'last_received', label: 'Last received', value: (r) => r.last_received ? fmtDate(r.last_received) : 'Never' },
        ],
        meta: 'All-time restocking',
      });
    });
  }

  await load();
}

function kpi(label, value, sub, iconName, tone = 'berry', href = '') {
  const el = href ? 'a' : 'div';
  return `<${el} class="kpi kpi--${tone}" ${href ? `href="${href}"` : ''}>
    <span class="kpi__icon">${icon(iconName, 19)}</span>
    <span class="kpi__label">${esc(label)}</span>
    <strong class="kpi__value">${esc(value)}</strong>
    <small class="kpi__sub">${esc(sub)}</small>
  </${el}>`;
}

function monthLabel(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-NG', { month: 'long', year: 'numeric' });
}

function printReport({ start, end, revenue, cogs, gross, opex, net, orders, products, topCustomers, cashList, collected, expList, settings }) {
  const row = (label, value, cls = '') => `<tr class="${cls}"><td>${esc(label)}</td><td class="r">${esc(value)}</td></tr>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Business report</title>
    <style>
      @page { margin: 16mm; }
      body { font-family: "Segoe UI", Arial, sans-serif; color: #2c1d1a; font-size: 12px; }
      h1 { margin: 0 0 2px; font-size: 20px; }
      h2 { font-size: 14px; margin: 22px 0 6px; border-bottom: 2px solid #8c3b4a; padding-bottom: 4px; }
      .muted { color: #7a6a63; }
      table { width: 100%; border-collapse: collapse; }
      td, th { padding: 6px 5px; border-bottom: 1px solid #eee2d8; text-align: left; }
      th { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #7a6a63; }
      .r { text-align: right; }
      .grand td { font-weight: 700; border-top: 2px solid #2c1d1a; }
      .two { display: flex; gap: 26px; }
      .two > div { flex: 1; }
    </style></head><body>
    <h1>${esc(settings.business_name || 'Cake Slice Factory')}</h1>
    <div class="muted">Business report · ${esc(fmtDate(start))} – ${esc(fmtDate(end))}</div>

    <h2>Summary</h2>
    <table>
      ${row('Revenue', money(revenue))}
      ${row('Cost of goods sold', money(cogs))}
      ${row('Gross profit', money(gross))}
      ${row('Overheads', money(opex))}
      ${row('Net profit', money(net), 'grand')}
      ${row('Orders completed', num(orders.length))}
      ${row('Cash collected', money(collected))}
    </table>

    <div class="two">
      <div><h2>Top products</h2><table>
        <thead><tr><th>Product</th><th class="r">Qty</th><th class="r">Revenue</th></tr></thead>
        <tbody>${products.slice(0, 8).map((p) => `<tr><td>${esc(p.name)}</td><td class="r">${num(p.qty, 2)}</td><td class="r">${money(p.revenue)}</td></tr>`).join('')}</tbody>
      </table></div>
      <div><h2>Top customers</h2><table>
        <thead><tr><th>Customer</th><th class="r">Revenue</th></tr></thead>
        <tbody>${topCustomers.map((c) => `<tr><td>${esc(c.label)}</td><td class="r">${money(c.value)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>

    <div class="two">
      <div><h2>Expenses</h2><table>
        <thead><tr><th>Category</th><th class="r">Amount</th></tr></thead>
        <tbody>${expList.map(([cat, amount]) => `<tr><td>${esc(labelFor(EXPENSE_CATEGORIES, cat))}</td><td class="r">${money(amount)}</td></tr>`).join('')}</tbody>
      </table></div>
      <div><h2>Cash by method</h2><table>
        <thead><tr><th>Method</th><th class="r">Amount</th></tr></thead>
        <tbody>${cashList.map(([method, amount]) => `<tr><td>${esc(labelFor(PAYMENT_METHODS, method))}</td><td class="r">${money(amount)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>
    <p class="muted" style="margin-top:28px">Generated ${esc(fmtDate(today(), { withTime: true }))} · Cake Slice Factory</p>
    </body></html>`;
  printHTML(html, 'Business report');
}
