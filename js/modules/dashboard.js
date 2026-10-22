// Dashboard: the owner's morning glance.
import { sb, errText } from '../supabase.js';
import {
  esc, money, compactMoney, num, fmtDate, today, monthStart, addDays, icon, statusBadge,
  lineChart, emptyState, spinner, toast, relativeTime, pct,
} from '../ui.js';

export async function render(root, _params, ctx) {
  root.innerHTML = `<div class="route-loading">${spinner('Reading the bakery…')}</div>`;
  const { profile, settings } = ctx;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = (profile.full_name || profile.email || 'there').split(' ')[0];

  try {
    const month = monthStart();
    const day = today();

    const [
      monthOrders, todayOrders, expenses, balances, alerts, due, recent,
      trend, productSales, topCustomers, ingredients, products, customerCount, recipeCount,
    ] = await Promise.all([
      sb.from('orders').select('*').eq('status', 'completed').is('deleted_at', null).gte('created_at', month),
      sb.from('orders').select('*').is('deleted_at', null).gte('created_at', `${day}T00:00:00`),
      sb.from('expenses').select('*').is('deleted_at', null).gte('spent_on', month),
      sb.from('v_order_balances').select('*'),
      sb.from('v_stock_alerts').select('*').order('shortfall', { ascending: false }),
      sb.from('orders').select('*').is('deleted_at', null)
        .in('status', ['confirmed', 'in_production', 'ready', 'out_for_delivery'])
        .lte('delivery_date', addDays(5)).order('delivery_date', { ascending: true }).limit(6),
      sb.from('orders').select('*').is('deleted_at', null).order('created_at', { ascending: false }).limit(6),
      sb.from('v_sales_trend').select('*').gte('day', addDays(-13)).order('day', { ascending: true }),
      sb.from('v_product_sales').select('*').gte('order_date', month),
      sb.from('v_top_customers').select('*').order('spent', { ascending: false }).limit(3),
      sb.from('ingredients').select('*').is('deleted_at', null),
      sb.from('products').select('*').is('deleted_at', null),
      sb.from('customers').select('*', { count: 'exact', head: true }).is('deleted_at', null),
      sb.from('recipes').select('product_id'),
    ]);

    for (const r of [monthOrders, todayOrders, expenses, balances, alerts, due, recent, trend, productSales, topCustomers, ingredients, products, customerCount, recipeCount]) {
      if (r.error) throw new Error(errText(r.error));
    }

    const mOrders = monthOrders.data || [];
    const tOrders = todayOrders.data || [];
    const exp = expenses.data || [];
    const bal = balances.data || [];
    const lows = alerts.data || [];
    const dueOrders = due.data || [];
    const recentOrders = recent.data || [];
    const trendRows = trend.data || [];
    const sales = productSales.data || [];
    const tops = topCustomers.data || [];
    const ings = ingredients.data || [];
    const prods = products.data || [];

    const revenueToday = tOrders.filter((o) => o.status === 'completed').reduce((s, o) => s + Number(o.total), 0);
    const revenueMonth = mOrders.reduce((s, o) => s + Number(o.total), 0);
    const cogsMonth = sales.reduce((s, x) => s + Number(x.cost || 0), 0);
    const opexMonth = exp.filter((e) => e.category !== 'ingredients').reduce((s, e) => s + Number(e.amount), 0);
    const profitMonth = revenueMonth - cogsMonth - opexMonth;
    const outstanding = bal.reduce((s, b) => s + Number(b.balance), 0);
    const stockValue = ings.reduce((s, i) => s + Number(i.stock_qty) * Number(i.cost_per_unit), 0)
      + prods.filter((p) => p.track_stock).reduce((s, p) => s + Number(p.stock_qty) * Number(p.cost_price), 0);

    const productRank = new Map();
    for (const row of sales) {
      const k = row.product_name;
      const cur = productRank.get(k) || { name: k, qty: 0, revenue: 0 };
      cur.qty += Number(row.qty_sold);
      cur.revenue += Number(row.revenue);
      productRank.set(k, cur);
    }
    const topProduct = [...productRank.values()].sort((a, b) => b.revenue - a.revenue)[0];
    const topCustomer = tops[0];

    // Fill missing days so the chart has a continuous baseline.
    const trendMap = new Map(trendRows.map((r) => [r.day, r]));
    const points = [];
    for (let i = 13; i >= 0; i--) {
      const d = addDays(-i);
      const row = trendMap.get(d);
      points.push({
        label: fmtDate(d).replace(/ \d{4}$/, ''),
        value: Number(row?.revenue || 0),
      });
    }

    const hasProducts = prods.length > 0;
    const hasOrders = recentOrders.length > 0;
    const hasRecipes = new Set((recipeCount.data || []).map((r) => r.product_id)).size > 0;

    root.innerHTML = `
      <div class="page-head">
        <div>
          <p class="eyebrow">${esc(greeting)}, ${esc(firstName)}</p>
          <h1>${hasOrders ? 'Here is today at a glance' : 'Let us set up your bakery'}</h1>
          <p class="page-sub">${esc(fmtDate(today(), { withTime: false }))} · ${esc(settings.business_name || '')}</p>
        </div>
        <div class="page-actions">
          <a class="btn btn--ghost" href="#/reports">${icon('chart', 17)} Reports</a>
          <a class="btn btn--primary" href="#/orders/new">${icon('plus', 17)} New order</a>
        </div>
      </div>

      ${!hasProducts || !hasOrders ? onboarding({ hasProducts, hasRecipes, hasOrders, customers: customerCount.count || 0, ingredients: ings.length }) : ''}

      <div class="kpi-grid">
        ${kpi('Revenue today', money(revenueToday, { decimals: 0 }), `${tOrders.filter((o) => o.status === 'completed').length} completed order(s)`, 'card', 'berry')}
        ${kpi('This month', money(revenueMonth, { decimals: 0 }), `${mOrders.length} completed orders`, 'chart', 'cocoa')}
        ${kpi('Profit this month', money(profitMonth, { decimals: 0 }), `after ${money(cogsMonth + opexMonth, { decimals: 0 })} costs`, 'wallet', profitMonth >= 0 ? 'sage' : 'danger')}
        ${kpi('Outstanding', money(outstanding, { decimals: 0 }), `${bal.length} order(s) owing`, 'clock', 'caramel', '#/orders')}
        ${kpi('Low stock', num(lows.length), lows.length
          ? `${[
            lows.filter((x) => x.kind === 'ingredient').length ? `${lows.filter((x) => x.kind === 'ingredient').length} ingredient(s)` : '',
            lows.filter((x) => x.kind === 'product').length ? `${lows.filter((x) => x.kind === 'product').length} product(s)` : '',
          ].filter(Boolean).join(' · ')} to reorder`
          : 'Everything above reorder point', 'alert', lows.length ? 'warn' : 'sage', '#/ingredients')}
        ${kpi('Stock value', compactMoney(stockValue), `${num(ings.length)} ingredients · ${num(prods.length)} products`, 'box', 'purple')}
      </div>

      <div class="dash-grid">
        <section class="card card--pad dash-main">
          <div class="card-head">
            <div><h2>Sales trend</h2><p class="muted">Completed orders, last 14 days</p></div>
            <span class="pill">${money(points.reduce((s, p) => s + p.value, 0), { decimals: 0 })}</span>
          </div>
          ${lineChart({ points })}
        </section>

        <section class="card card--pad">
          <div class="card-head">
            <div><h2>Top product</h2><p class="muted">This month by revenue</p></div>
            ${icon('sparkles', 18)}
          </div>
          ${topProduct ? `
            <div class="spotlight">
              <span class="spotlight__label">${esc(topProduct.name)}</span>
              <strong>${money(topProduct.revenue, { decimals: 0 })}</strong>
              <small>${num(topProduct.qty)} sold this month</small>
            </div>` : emptyState({ title: 'No sales yet', text: 'Complete an order to see your best seller.', iconName: 'cake' })}
          <hr class="rule">
          <div class="card-head"><div><h2>Top customer</h2></div>${icon('users', 18)}</div>
          ${topCustomer ? `<a class="spotlight spotlight--link" href="#/customers/${esc(topCustomer.id)}">
            <span class="spotlight__label">${esc(topCustomer.name)}</span>
            <strong>${money(topCustomer.spent, { decimals: 0 })}</strong>
            <small>${num(topCustomer.orders)} completed order(s)</small>
          </a>` : `<p class="muted">No customer history yet.</p>`}
        </section>

        <section class="card card--pad">
          <div class="card-head">
            <div><h2>Low stock</h2><p class="muted">Reorder before you bake</p></div>
            <a class="link" href="#/ingredients">Manage ${icon('arrow', 14)}</a>
          </div>
          ${lows.length ? `<div class="alert-list">${lows.slice(0, 6).map((a) => `
            <a class="alert-row" href="${a.kind === 'product' ? '#/products' : '#/ingredients'}">
              <span class="alert-row__icon">${icon(a.kind === 'product' ? 'cake' : 'flour', 16)}</span>
              <span class="alert-row__text"><strong>${esc(a.name)}</strong><small>${esc(a.kind)} · reorder at ${num(a.low_stock_at, 2)} ${esc(a.unit)}</small></span>
              <span class="alert-row__qty">${num(a.stock_qty, 2)}<small>${esc(a.unit)}</small></span>
            </a>`).join('')}</div>` : emptyState({ title: 'All stocked up', text: 'Nothing is below its reorder point.', iconName: 'check' })}
        </section>

        <section class="card card--pad">
          <div class="card-head">
            <div><h2>Due soon</h2><p class="muted">Next 5 days</p></div>
            <a class="link" href="#/orders">All orders ${icon('arrow', 14)}</a>
          </div>
          ${dueOrders.length ? `<div class="due-list">${dueOrders.map((o) => `
            <a class="due-row" href="#/orders/${esc(o.id)}">
              <span class="due-row__date"><strong>${esc(fmtDate(o.delivery_date).slice(0, 6))}</strong><small>${esc(o.fulfilment === 'delivery' ? 'delivery' : 'pickup')}</small></span>
              <span class="due-row__text"><strong>${esc(o.order_no)}</strong><small>${esc(o.fulfilment === 'delivery' ? o.delivery_city || o.delivery_address || '' : 'Counter pick-up')}</small></span>
              ${statusBadge(o.status)}
            </a>`).join('')}</div>` : emptyState({ title: 'Nothing due', text: 'No orders need attention in the next five days.', iconName: 'check' })}
        </section>

        <section class="card card--pad dash-wide">
          <div class="card-head">
            <div><h2>Recent orders</h2><p class="muted">Newest first</p></div>
            <a class="link" href="#/orders">View all ${icon('arrow', 14)}</a>
          </div>
          ${recentOrders.length ? `<div class="table-wrap"><table class="data-table data-table--tight">
            <thead><tr><th>Order</th><th>Customer</th><th>Channel</th><th>Total</th><th>Balance</th><th>Status</th></tr></thead>
            <tbody>${recentOrders.map((o) => {
              const balance = Number(o.total) - Number(o.amount_paid);
              return `<tr data-href="#/orders/${esc(o.id)}" tabindex="0" style="cursor:pointer">
                <td><strong>${esc(o.order_no)}</strong><small class="cell-sub">${esc(relativeTime(o.created_at))}</small></td>
                <td>${esc(o._customer || '')}</td>
                <td>${esc(o.channel.replace(/_/g, ' '))}</td>
                <td>${esc(money(o.total, { decimals: 0 }))}</td>
                <td>${balance > 0 ? `<span class="text-danger">${esc(money(balance, { decimals: 0 }))}</span>` : `<span class="text-sage">Paid</span>`}</td>
                <td>${statusBadge(o.status)}</td>
              </tr>`;
            }).join('')}</tbody></table></div>` : emptyState({ title: 'No orders yet', text: 'Record your first walk-in order in under a minute.', iconName: 'bag', action: '<a class="btn btn--primary" href="#/orders/new">New order</a>' })}
        </section>
      </div>`;

    // recent orders do not carry customer names; fill them in
    const missing = recentOrders.filter((o) => !o._customer);
    if (missing.length) {
      const { data: custs } = await sb.from('customers').select('id,name');
      const map = new Map((custs || []).map((c) => [c.id, c.name]));
      missing.forEach((o) => { o._customer = map.get(o.customer_id) || 'Walk-in'; });
      root.querySelectorAll('tbody tr[data-href]').forEach((tr, i) => {
        const o = recentOrders[i];
        if (o) tr.children[1].textContent = o._customer;
      });
    }

    root.querySelectorAll('tr[data-href]').forEach((tr) => {
      tr.addEventListener('click', () => { location.hash = tr.dataset.href; });
    });
  } catch (e) {
    root.innerHTML = `<div class="page-head"><div><h1>Dashboard</h1></div></div>
      <div class="notice notice--danger">${icon('alert', 18)} ${esc(e.message)}</div>`;
  }
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

function onboarding({ hasProducts, hasRecipes, hasOrders, customers, ingredients }) {
  const steps = [
    { done: hasProducts, label: 'Add your finished cakes', href: '#/products', hint: 'Ready-made and custom products' },
    { done: ingredients > 0, label: 'Add ingredients & stock', href: '#/ingredients', hint: 'Flour, sugar, butter, boxes' },
    { done: hasRecipes, label: 'Build a recipe', href: '#/recipes', hint: 'Link ingredients to each cake' },
    { done: hasProducts && hasRecipes, label: 'Bake your first batch', href: '#/production', hint: 'Consumes ingredients, adds finished stock' },
    { done: customers > 0, label: 'Add your first customer', href: '#/customers', hint: 'Name and phone are enough' },
    { done: hasOrders, label: 'Record your first order', href: '#/orders/new', hint: 'Walk-in, Instagram or WhatsApp' },
  ];
  const done = steps.filter((s) => s.done).length;
  return `<section class="setup">
    <div class="setup__head">
      <div><p class="eyebrow">Getting started</p><h2>Set up in six small steps</h2></div>
      <span class="pill">${done}/${steps.length} done</span>
    </div>
    <div class="setup__grid">${steps.map((s) => `
      <a class="setup__step ${s.done ? 'is-done' : ''}" href="${s.href}">
        <span class="setup__check">${s.done ? icon('check', 14) : ''}</span>
        <span><strong>${esc(s.label)}</strong><small>${esc(s.hint)}</small></span>
      </a>`).join('')}</div>
  </section>`;
}
