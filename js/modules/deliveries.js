// Deliveries: the dispatch board for cakes leaving the bakery.
import { sb, errText, dataChanged } from '../supabase.js';
import {
  esc, money, num, fmtDate, fmtDayMonth, today, addDays, titleCase, statusBadge, badge, icon,
  toast, emptyState, spinner, setBusy, exportModal,
} from '../ui.js';
import { LOCALE, ORDER_STATUSES } from '../config.js';

function ymd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dayHeading(date) {
  if (!date) return 'No date set';
  if (date === today()) return 'Today';
  if (date === addDays(1)) return 'Tomorrow';
  if (date === addDays(-1)) return 'Yesterday';
  return new Intl.DateTimeFormat(LOCALE, { weekday: 'long' }).format(new Date(`${date}T00:00:00`));
}

export async function render(root) {
  root.innerHTML = `<div class="route-loading">${spinner('Loading the delivery run…')}</div>`;

  let orders = [];
  let customers = [];
  const state = { range: 'upcoming', status: '', search: '' };

  async function load() {
    const [oRes, cRes] = await Promise.all([
      sb.from('orders').select('*').is('deleted_at', null)
        .eq('fulfilment', 'delivery').neq('status', 'cancelled')
        .order('delivery_date', { ascending: true }).limit(500),
      sb.from('customers').select('id,name,phone,address,city,state').is('deleted_at', null).limit(1000),
    ]);
    if (oRes.error) throw new Error(errText(oRes.error));
    if (cRes.error) throw new Error(errText(cRes.error));
    orders = oRes.data || [];
    customers = cRes.data || [];
  }

  try {
    await load();
  } catch (e) {
    root.innerHTML = `<div class="notice notice--danger">${icon('alert', 18)} ${esc(e.message)}</div>`;
    return;
  }

  function draw() {
    const customerMap = new Map(customers.map((c) => [c.id, c]));
    const filtered = orders
      .filter((o) => state.range === 'all' || (o.delivery_date && o.delivery_date >= today()) || ['ready', 'out_for_delivery'].includes(o.status))
      .filter((o) => !state.status || o.status === state.status)
      .filter((o) => {
        if (!state.search) return true;
        const customer = customerMap.get(o.customer_id);
        return [o.order_no, customer?.name, customer?.phone, o.delivery_address, o.delivery_city, o.rider_name]
          .some((value) => String(value || '').toLowerCase().includes(state.search.toLowerCase()));
      })
      .sort((a, b) => String(a.delivery_date || '9999').localeCompare(String(b.delivery_date || '9999')));

    const groups = new Map();
    for (const order of filtered) {
      const key = order.delivery_date || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(order);
    }

    const todayCount = orders.filter((o) => o.delivery_date === today()).length;
    const weekCount = orders.filter((o) => o.delivery_date >= today() && o.delivery_date <= addDays(6)).length;
    const readyCount = orders.filter((o) => o.status === 'ready').length;
    const outCount = orders.filter((o) => o.status === 'out_for_delivery').length;

    root.innerHTML = `
      <div class="page-head">
        <div>
          <p class="eyebrow">Operations</p>
          <h1>Deliveries</h1>
          <p class="page-sub">Who is going where, what is ready and what still needs a rider.</p>
        </div>
        <div class="page-actions">
          <button class="btn btn--ghost" data-export>${icon('download', 17)} Export</button>
          <a class="btn btn--primary" href="#/orders/new">${icon('plus', 17)} New order</a>
        </div>
      </div>

      <div class="mini-stats">
        <div class="mini-stat mini-stat--berry">
          <span class="mini-stat__icon">${icon('truck', 17)}</span>
          <span><small>Today</small><strong>${num(todayCount)}</strong></span>
        </div>
        <div class="mini-stat mini-stat--caramel">
          <span class="mini-stat__icon">${icon('calendar', 17)}</span>
          <span><small>Next 7 days</small><strong>${num(weekCount)}</strong></span>
        </div>
        <div class="mini-stat mini-stat--sage">
          <span class="mini-stat__icon">${icon('box', 17)}</span>
          <span><small>Ready to dispatch</small><strong>${num(readyCount)}</strong></span>
        </div>
        <div class="mini-stat mini-stat--purple">
          <span class="mini-stat__icon">${icon('arrow', 17)}</span>
          <span><small>On the road</small><strong>${num(outCount)}</strong></span>
        </div>
      </div>

      <section class="card">
        <div class="toolbar">
          <div class="search-box">
            ${icon('search', 17)}
            <input type="search" placeholder="Search order, customer, address or rider…" data-search value="${esc(state.search)}">
          </div>
          <div class="toolbar__filters">
            <select data-status-filter aria-label="Delivery status">
              <option value="">Status: all</option>
              ${ORDER_STATUSES.filter((s) => !['quote', 'cancelled'].includes(s.value)).map((s) => `<option value="${s.value}" ${state.status === s.value ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="delivery-periods">
          <button type="button" class="chip ${state.range === 'upcoming' ? 'is-active' : ''}" data-range="upcoming">Upcoming</button>
          <button type="button" class="chip ${state.range === 'all' ? 'is-active' : ''}" data-range="all">All deliveries</button>
          <span class="payment-periods__count">${num(filtered.length)} stop${filtered.length === 1 ? '' : 's'}</span>
        </div>
        <div id="delivery-board"></div>
      </section>`;

    const board = root.querySelector('#delivery-board');
    if (!filtered.length) {
      board.innerHTML = emptyState({
        iconName: 'truck', title: state.range === 'upcoming' ? 'No deliveries lined up' : 'No deliveries found',
        text: state.search || state.status
          ? 'Nothing matches those filters.'
          : 'Delivery orders will appear here as soon as they are scheduled.',
        action: '<a class="btn btn--primary" href="#/orders/new">New order</a>',
      });
    } else {
      board.innerHTML = `<div class="delivery-days">${[...groups.entries()].map(([date, dayOrders]) => `
        <section class="delivery-day">
          <div class="delivery-day__head">
            <div><span class="eyebrow">${esc(dayHeading(date))}</span><strong>${date ? esc(fmtDate(date)) : 'No delivery date'}</strong></div>
            <span class="pill">${num(dayOrders.length)} stop${dayOrders.length === 1 ? '' : 's'}</span>
          </div>
          <div class="delivery-day__rows">
            ${dayOrders.map((order) => {
              const customer = customerMap.get(order.customer_id);
              const address = [order.delivery_address, order.delivery_city, order.delivery_state].filter(Boolean).join(', ')
                || [customer?.address, customer?.city, customer?.state].filter(Boolean).join(', ');
              const next = order.status === 'ready' ? 'out_for_delivery' : order.status === 'out_for_delivery' ? 'completed' : '';
              const nextLabel = next === 'out_for_delivery' ? 'Dispatch' : next === 'completed' ? 'Mark delivered' : '';
              return `<article class="delivery-row">
                <div class="delivery-row__date">
                  <strong>${esc(date ? fmtDayMonth(date).day : '—')}</strong>
                  <small>${esc(date ? fmtDayMonth(date).month : '')}</small>
                </div>
                <div class="delivery-row__main">
                  <a href="#/orders/${esc(order.id)}"><strong>${esc(order.order_no)}</strong></a>
                  <span class="delivery-row__customer">${esc(customer?.name || 'Walk-in customer')}</span>
                  <small>${esc(address || 'No address on file')}</small>
                </div>
                <div class="delivery-row__meta">
                  ${statusBadge(order.status)}
                  <small>${order.rider_name ? `Rider: ${esc(order.rider_name)}` : 'No rider assigned'}</small>
                  <strong>${money(order.total, { decimals: 0 })}</strong>
                </div>
                <div class="delivery-row__actions">
                  ${customer?.phone ? `<a class="icon-btn" href="tel:${esc(customer.phone)}" title="Call customer">${icon('phone', 16)}</a>` : ''}
                  ${address ? `<button class="icon-btn" data-copy-address="${esc(address)}" title="Copy address">${icon('pin', 16)}</button>` : ''}
                  ${next ? `<button class="btn btn--sm btn--primary" data-delivery-status="${next}" data-order-id="${esc(order.id)}">${esc(nextLabel)}</button>` : ''}
                  <a class="btn btn--sm btn--ghost" href="#/orders/${esc(order.id)}">Open</a>
                </div>
              </article>`;
            }).join('')}
          </div>
        </section>`).join('')}</div>`;
    }

    root.querySelector('[data-search]').addEventListener('change', (e) => {
      state.search = e.target.value.trim();
      draw();
    });
    root.querySelector('[data-status-filter]').addEventListener('change', (e) => {
      state.status = e.target.value;
      draw();
    });
    root.querySelectorAll('[data-range]').forEach((button) => button.addEventListener('click', () => {
      state.range = button.dataset.range;
      draw();
    }));
    root.querySelectorAll('[data-delivery-status]').forEach((button) => button.addEventListener('click', () => {
      const order = orders.find((o) => o.id === button.dataset.orderId);
      if (order) updateStatus(order, button.dataset.deliveryStatus, button);
    }));
    root.querySelectorAll('[data-copy-address]').forEach((button) => button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copyAddress);
        toast('Delivery address copied.');
      } catch {
        toast('Could not copy the address. You can select it manually.', 'warn');
      }
    }));
    root.querySelector('[data-export]').addEventListener('click', () => {
      exportModal({
        title: 'Deliveries',
        filename: `deliveries-${today()}`,
        rows: filtered,
        columns: [
          { key: 'delivery_date', label: 'Delivery date', value: (o) => fmtDate(o.delivery_date) },
          { key: 'order_no', label: 'Order' },
          { key: 'customer', label: 'Customer', value: (o) => customerMap.get(o.customer_id)?.name || 'Walk-in customer' },
          { key: 'phone', label: 'Phone', value: (o) => customerMap.get(o.customer_id)?.phone || '' },
          { key: 'address', label: 'Address', value: (o) => [o.delivery_address, o.delivery_city, o.delivery_state].filter(Boolean).join(', ') },
          { key: 'rider', label: 'Rider', value: (o) => o.rider_name || '' },
          { key: 'status', label: 'Status', value: (o) => titleCase(o.status) },
          { key: 'total', label: 'Total', className: 'num' },
        ],
        meta: state.range === 'upcoming' ? 'Upcoming delivery run' : 'All delivery orders',
      });
    });
  }

  async function updateStatus(order, next, button) {
    setBusy(button, true, 'Saving…');
    const { error } = await sb.from('orders').update({ status: next }).eq('id', order.id);
    if (error) {
      toast(errText(error), 'error');
      setBusy(button, false);
      return;
    }
    dataChanged('orders');
    toast(next === 'completed' ? 'Delivery marked complete.' : 'Order dispatched.');
    await load();
    draw();
  }

  draw();
}
