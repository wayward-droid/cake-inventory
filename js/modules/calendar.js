// Calendar: a month view of pick-ups, deliveries and what is coming next.
import { sb, errText } from '../supabase.js';
import {
  esc, money, num, fmtDate, fmtDayMonth, today, addDays, titleCase, statusBadge, icon,
  openModal, emptyState, spinner, exportModal,
} from '../ui.js';
import { LOCALE, ORDER_STATUSES } from '../config.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function ymd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function monthLabel(year, month) {
  return new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' }).format(new Date(year, month, 1));
}

export async function render(root) {
  const now = new Date();
  const state = {
    year: now.getFullYear(),
    month: now.getMonth(),
    orders: [],
    upcoming: [],
    customers: new Map(),
  };

  root.innerHTML = `<div class="route-loading">${spinner('Opening the calendar…')}</div>`;

  try {
    const [cRes, uRes] = await Promise.all([
      sb.from('customers').select('id,name,phone').is('deleted_at', null).order('name'),
      sb.from('orders').select('*').is('deleted_at', null)
        .gte('delivery_date', today()).lte('delivery_date', addDays(6))
        .neq('status', 'cancelled').order('delivery_date', { ascending: true }),
    ]);
    if (cRes.error) throw new Error(errText(cRes.error));
    if (uRes.error) throw new Error(errText(uRes.error));
    state.customers = new Map((cRes.data || []).map((c) => [c.id, c]));
    state.upcoming = uRes.data || [];
  } catch (e) {
    root.innerHTML = `<div class="notice notice--danger">${icon('alert', 18)} ${esc(e.message)}</div>`;
    return;
  }

  async function loadMonth() {
    const first = new Date(state.year, state.month, 1);
    const last = new Date(state.year, state.month + 1, 0);
    const { data, error } = await sb.from('orders').select('*').is('deleted_at', null)
      .gte('delivery_date', ymd(first)).lte('delivery_date', ymd(last))
      .neq('status', 'cancelled')
      .order('delivery_date', { ascending: true });
    if (error) throw new Error(errText(error));
    state.orders = data || [];
    draw();
  }

  function customerName(order) {
    return state.customers.get(order.customer_id)?.name || 'Walk-in customer';
  }

  function draw() {
    const live = state.orders.filter((o) => o.status !== 'cancelled');
    const deliveries = live.filter((o) => o.fulfilment === 'delivery').length;
    const pickups = live.length - deliveries;
    const value = live.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const byDay = new Map();
    for (const order of state.orders) {
      if (!order.delivery_date) continue;
      if (!byDay.has(order.delivery_date)) byDay.set(order.delivery_date, []);
      byDay.get(order.delivery_date).push(order);
    }

    const first = new Date(state.year, state.month, 1);
    const offset = (first.getDay() + 6) % 7;
    const gridStart = new Date(state.year, state.month, 1 - offset);
    const cells = Array.from({ length: 42 }, (_, i) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + i);
      return date;
    });
    const current = state.year === now.getFullYear() && state.month === now.getMonth();
    const statusCounts = ORDER_STATUSES.map((status) => ({
      ...status,
      count: live.filter((o) => o.status === status.value).length,
    })).filter((s) => s.count > 0);

    root.innerHTML = `
      <div class="page-head">
        <div>
          <p class="eyebrow">Operations</p>
          <h1>Calendar</h1>
          <p class="page-sub">Every cake due, organised by the day it leaves the kitchen.</p>
        </div>
        <div class="page-actions">
          <button class="btn btn--ghost" data-export>${icon('download', 17)} Export</button>
          <a class="btn btn--primary" href="#/orders/new">${icon('plus', 17)} New order</a>
        </div>
      </div>

      <div class="mini-stats">
        <div class="mini-stat mini-stat--berry">
          <span class="mini-stat__icon">${icon('calendar', 17)}</span>
          <span><small>Due this month</small><strong>${num(live.length)}</strong></span>
        </div>
        <div class="mini-stat mini-stat--sage">
          <span class="mini-stat__icon">${icon('truck', 17)}</span>
          <span><small>Deliveries</small><strong>${num(deliveries)}</strong></span>
        </div>
        <div class="mini-stat mini-stat--caramel">
          <span class="mini-stat__icon">${icon('bag', 17)}</span>
          <span><small>Pick-ups</small><strong>${num(pickups)}</strong></span>
        </div>
        <div class="mini-stat mini-stat--cocoa">
          <span class="mini-stat__icon">${icon('wallet', 17)}</span>
          <span><small>Order value</small><strong>${money(value, { decimals: 0 })}</strong></span>
        </div>
      </div>

      <div class="calendar-layout">
        <section class="card calendar-card">
          <div class="calendar-head">
            <div>
              <p class="eyebrow">${current ? 'This month' : 'Planning view'}</p>
              <h2>${esc(monthLabel(state.year, state.month))}</h2>
            </div>
            <div class="calendar-nav">
              <button class="icon-btn" data-prev aria-label="Previous month">${icon('chevron', 18, 'icon--flip')}</button>
              <button class="btn btn--sm btn--ghost" data-today>Today</button>
              <button class="icon-btn" data-next aria-label="Next month">${icon('chevron', 18)}</button>
            </div>
          </div>
          <div class="calendar-weekdays">${WEEKDAYS.map((d) => `<span>${d}</span>`).join('')}</div>
          <div class="calendar-grid">
            ${cells.map((date) => {
              const key = ymd(date);
              const inMonth = date.getMonth() === state.month;
              const dayOrders = byDay.get(key) || [];
              const isToday = key === today();
              return `<button type="button" class="cal-day ${inMonth ? '' : 'is-outside'} ${isToday ? 'is-today' : ''}" data-cal-day="${key}" aria-label="${esc(fmtDate(key))}${dayOrders.length ? `, ${dayOrders.length} order${dayOrders.length === 1 ? '' : 's'}` : ', no orders'}">
                <span class="cal-day__num">${date.getDate()}</span>
                ${dayOrders.length ? `<span class="cal-day__count">${dayOrders.length}</span>` : ''}
                <span class="cal-day__orders">
                  ${dayOrders.slice(0, 3).map((o) => `<span class="cal-chip" data-status="${esc(o.status)}" title="${esc(`${o.order_no} · ${customerName(o)} · ${titleCase(o.status)}`)}">${esc(o.order_no)} · ${esc(customerName(o))}</span>`).join('')}
                  ${dayOrders.length > 3 ? `<span class="cal-more">+${dayOrders.length - 3} more</span>` : ''}
                </span>
              </button>`;
            }).join('')}
          </div>
          <div class="calendar-legend">
            ${ORDER_STATUSES.filter((s) => s.value !== 'cancelled').map((s) => `<span><i class="cal-dot" data-status="${s.value}"></i>${esc(s.label)}</span>`).join('')}
          </div>
        </section>

        <aside class="calendar-side">
          <section class="card card--pad">
            <div class="card-head"><div><h2>Next 7 days</h2><p class="muted">The run coming up</p></div>${icon('clock', 18)}</div>
            ${state.upcoming.length ? `<div class="cal-upcoming">${state.upcoming.slice(0, 6).map((o) => `
              <a class="cal-upcoming__row" href="#/orders/${esc(o.id)}">
                <span class="cal-upcoming__date"><strong>${esc(fmtDayMonth(o.delivery_date).day)}</strong><small>${esc(fmtDayMonth(o.delivery_date).month)}</small></span>
                <span class="cal-upcoming__main"><strong>${esc(customerName(o))}</strong><small>${esc(o.order_no)} · ${o.fulfilment === 'delivery' ? 'Delivery' : 'Pick-up'}</small></span>
                <span class="cal-upcoming__end">${statusBadge(o.status)}</span>
              </a>`).join('')}</div>` : `<p class="muted">No orders due in the next seven days.</p>`}
          </section>

          <section class="card card--pad">
            <div class="card-head"><div><h2>Month at a glance</h2><p class="muted">Where the work sits</p></div>${icon('chart', 18)}</div>
            ${statusCounts.length ? `<div class="cal-status-list">${statusCounts.map((s) => `
              <div class="cal-status-row"><span><i class="cal-dot" data-status="${s.value}"></i>${esc(s.label)}</span><strong>${num(s.count)}</strong></div>`).join('')}
            </div>` : `<p class="muted">No orders with a due date this month.</p>`}
            ${live.length ? `<div class="rule-row"><span>Total scheduled</span><strong>${money(value, { decimals: 0 })}</strong></div>` : ''}
          </section>
        </aside>
      </div>`;

    root.querySelector('[data-prev]').onclick = () => {
      state.month -= 1;
      if (state.month < 0) { state.month = 11; state.year -= 1; }
      loadMonth().catch(showError);
    };
    root.querySelector('[data-next]').onclick = () => {
      state.month += 1;
      if (state.month > 11) { state.month = 0; state.year += 1; }
      loadMonth().catch(showError);
    };
    root.querySelector('[data-today]').onclick = () => {
      const d = new Date();
      state.year = d.getFullYear();
      state.month = d.getMonth();
      loadMonth().catch(showError);
    };
    root.querySelector('[data-export]').onclick = () => {
      exportModal({
        title: 'Order calendar',
        filename: `calendar-${state.year}-${String(state.month + 1).padStart(2, '0')}`,
        rows: [...state.orders].sort((a, b) => String(a.delivery_date).localeCompare(String(b.delivery_date))),
        columns: [
          { key: 'delivery_date', label: 'Due date', value: (o) => fmtDate(o.delivery_date) },
          { key: 'order_no', label: 'Order' },
          { key: 'customer', label: 'Customer', value: customerName },
          { key: 'fulfilment', label: 'Fulfilment', value: (o) => o.fulfilment === 'delivery' ? 'Delivery' : 'Pick-up' },
          { key: 'status', label: 'Status', value: (o) => titleCase(o.status) },
          { key: 'delivery_address', label: 'Address', value: (o) => [o.delivery_address, o.delivery_city, o.delivery_state].filter(Boolean).join(', ') },
          { key: 'total', label: 'Total', className: 'num' },
        ],
        meta: `${monthLabel(state.year, state.month)} · ${live.length} scheduled order${live.length === 1 ? '' : 's'}`,
      });
    };
    root.querySelectorAll('[data-cal-day]').forEach((button) => {
      button.onclick = () => openDay(byDay.get(button.dataset.calDay) || [], button.dataset.calDay);
    });
  }

  function openDay(dayOrders, day) {
    openModal({
      title: fmtDate(day),
      wide: true,
      body: dayOrders.length
        ? `<div class="cal-day-list">${dayOrders.map((o) => {
          const customer = state.customers.get(o.customer_id);
          const address = [o.delivery_address, o.delivery_city, o.delivery_state].filter(Boolean).join(', ');
          return `<a class="cal-day-order" href="#/orders/${esc(o.id)}" data-close>
            <span class="cal-day-order__top"><strong>${esc(o.order_no)}</strong>${statusBadge(o.status)}</span>
            <span class="cal-day-order__name">${esc(customer?.name || 'Walk-in customer')}</span>
            <span class="cal-day-order__meta">${o.fulfilment === 'delivery' ? 'Delivery' : 'Pick-up'}${customer?.phone ? ` · ${esc(customer.phone)}` : ''}</span>
            ${address ? `<span class="cal-day-order__meta">${esc(address)}</span>` : ''}
            <span class="cal-day-order__total">${money(o.total)}</span>
          </a>`;
        }).join('')}</div>`
        : emptyState({ iconName: 'calendar', title: 'A clear day', text: 'No orders are due on this day.' }),
    });
  }

  function showError(error) {
    root.innerHTML = `<div class="notice notice--danger">${icon('alert', 18)} ${esc(error.message)}</div>`;
  }

  await loadMonth();
}
