// ---------------------------------------------------------------------------
// Application shell: session guard, navigation, routing, notifications.
// ---------------------------------------------------------------------------

import { requireAuth, getProfile, signOut, displayName, initials, onAuthChange, claimOwner } from './auth.js';
import { sb, getSettings, clearSettingsCache, errText, dataChanged } from './supabase.js';
import { NAV, APP_NAME } from './config.js';
import { initTheme } from './theme.js';
import {
  esc, icon, toast, money, fmtDate, relativeTime, statusBadge, setCurrencySymbol,
  openModal, emptyState, spinner, today, addDays,
} from './ui.js';

const MODULES = {
  dashboard: () => import('./modules/dashboard.js'),
  orders: () => import('./modules/orders.js'),
  quotes: () => import('./modules/orders.js').then((m) => ({
    render: (root, params, ctx) => m.renderQuotes(root, params, ctx),
  })),
  payments: () => import('./modules/payments.js'),
  documents: () => import('./modules/documents.js'),
  customers: () => import('./modules/customers.js'),
  products: () => import('./modules/products.js').then((m) => m.products),
  ingredients: () => import('./modules/ingredients.js').then((m) => m.ingredients),
  recipes: () => import('./modules/recipes.js'),
  vendors: () => import('./modules/vendors.js').then((m) => m.vendors),
  production: () => import('./modules/production.js'),
  calendar: () => import('./modules/calendar.js'),
  deliveries: () => import('./modules/deliveries.js'),
  purchases: () => import('./modules/purchases.js'),
  expenses: () => import('./modules/expenses.js'),
  reports: () => import('./modules/reports.js'),
  admin: () => import('./modules/admin.js'),
};

const PAGE_TITLES = {
  dashboard: 'Dashboard', orders: 'Orders', quotes: 'Quotes', payments: 'Payments',
  documents: 'Documents', customers: 'Customers', products: 'Products',
  ingredients: 'Ingredients', recipes: 'Recipes', vendors: 'Vendors', production: 'Production',
  calendar: 'Calendar', deliveries: 'Deliveries', purchases: 'Purchases',
  expenses: 'Expenses', reports: 'Reports', admin: 'Admin',
};

let profile;
let settings;
let currentModule = null;

async function boot() {
  profile = await requireAuth();
  if (!profile) return;

  // Finish a first-owner claim after an email-confirmation redirect.
  const pendingOwner = sessionStorage.getItem('csf-owner-pending');
  if (pendingOwner && profile.role !== 'owner' && pendingOwner.toLowerCase() === (profile.email || '').toLowerCase()) {
    try {
      await claimOwner();
      profile = await getProfile(true);
    } catch (e) {
      console.warn('Owner setup did not finish:', e.message);
    }
    sessionStorage.removeItem('csf-owner-pending');
  }

  try {
    settings = await getSettings(true);
    setCurrencySymbol(settings.currency_symbol || '₦');
  } catch (e) {
    console.warn(e);
    settings = { business_name: APP_NAME, currency_symbol: '₦' };
  }

  document.getElementById('app').innerHTML = shellHTML();
  hydrateShell();
  bindShell();
  initTheme();
  window.addEventListener('hashchange', route);
  window.addEventListener('csf:data-changed', () => refreshNotifications().catch(() => {}));
  window.addEventListener('online', updateConnectivity);
  window.addEventListener('offline', updateConnectivity);
  updateConnectivity();

  // A session ending in another tab kicks this one out.
  onAuthChange((event) => {
    if (event === 'SIGNED_OUT') location.replace('index.html');
  });

  await route();
  refreshNotifications().catch(() => {});
}

function shellHTML() {
  const owner = profile.role === 'owner';
  const nav = NAV.map((item) => {
    if (item.section) return `<p class="nav__section">${esc(item.section)}</p>`;
    if (item.ownerOnly && !owner) return '';
    return `<a class="nav__link" href="#/${item.id}" data-nav="${item.id}" aria-label="${esc(item.label)}" title="${esc(item.label)}">
      ${icon(item.icon, 19)}<span>${esc(item.label)}</span>
    </a>`;
  }).join('');

  return `
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar__head">
          <a class="brand" href="#/dashboard" aria-label="Cake Slice Factory">
            <span class="brand__mark">${brandMark()}</span>
            <span class="brand__text"><strong>Cake Slice</strong><small>Factory</small></span>
          </a>
          <button class="icon-btn sidebar__close" data-close-nav aria-label="Close menu">${icon('close', 19)}</button>
        </div>
        <nav class="nav" aria-label="Main navigation">${nav}</nav>
        <div class="sidebar__foot">
          <button class="sidebar__user" data-user-menu aria-label="Account menu" title="Account">
            <span class="avatar">${esc(initials(displayName(profile)))}</span>
            <span class="sidebar__usertext">
              <strong>${esc(displayName(profile))}</strong>
              <small>${esc(profile.role)}</small>
            </span>
            ${icon('chevron', 15)}
          </button>
        </div>
      </aside>

      <div class="sidebar-scrim" data-close-nav></div>

      <div class="main">
        <div id="offline-banner" class="offline-banner" hidden>${icon('wifi', 15)} You are offline. Changes will fail until the connection returns.</div>
        <header class="topbar">
          <button class="icon-btn topbar__menu" data-open-nav aria-label="Open menu" title="Open menu" aria-controls="sidebar" aria-expanded="false">${icon('menu', 20)}</button>
          <div class="topbar__title">
            <p class="eyebrow" id="page-eyebrow">${esc(settings.business_name || APP_NAME)}</p>
            <h1 id="page-title">Dashboard</h1>
          </div>
          <div class="topbar__actions">
            <a class="btn btn--primary topbar__new" href="#/orders/new">${icon('plus', 16)} <span>New order</span></a>
            <button class="icon-btn theme-toggle" data-theme-toggle aria-label="Switch to dark mode" title="Switch to dark mode">
              ${icon('moon', 19)}
            </button>
            <button class="icon-btn notif-btn" data-notif aria-label="Notifications">
              ${icon('bell', 19)}<span class="notif-dot" data-notif-count hidden></span>
            </button>
            <button class="user-chip" data-user-menu aria-label="Account menu" title="Account">
              <span class="avatar">${esc(initials(displayName(profile)))}</span>
              <span class="user-chip__text"><strong>${esc(displayName(profile).split(' ')[0])}</strong><small>${esc(profile.role)}</small></span>
              ${icon('chevron', 14)}
            </button>
          </div>
        </header>
        <main id="view" class="view" tabindex="-1"></main>
      </div>
    </div>`;
}

function brandMark() {
  return `<svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true">
    <path d="M8 30h24" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M9 30v-9a5 5 0 0 1 5-5h12a5 5 0 0 1 5 5v9" fill="none" stroke="currentColor" stroke-width="2.4"/>
    <path d="M9 23c2.5 1.7 5 1.7 7.5 0s5-1.7 7.5 0 5 1.7 7 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M15 16v-3a2 2 0 0 1 4 0v3M22 16v-3a2 2 0 0 1 4 0v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <circle cx="31" cy="9" r="1.6" fill="currentColor"/>
  </svg>`;
}

function hydrateShell() {
  const title = PAGE_TITLES[currentId()] || 'Dashboard';
  document.getElementById('page-title').textContent = title;
  document.title = `${title} · ${settings.business_name || APP_NAME}`;
  setActiveNav(currentId());
}

function bindShell() {
  const sidebar = document.getElementById('sidebar');
  const menuButton = document.querySelector('[data-open-nav]');
  const open = () => {
    sidebar.classList.add('is-open');
    document.body.classList.add('no-scroll');
    menuButton?.setAttribute('aria-expanded', 'true');
  };
  const close = () => {
    sidebar.classList.remove('is-open');
    document.body.classList.remove('no-scroll');
    menuButton?.setAttribute('aria-expanded', 'false');
  };
  menuButton?.addEventListener('click', open);
  document.querySelectorAll('[data-close-nav]').forEach((el) => el.addEventListener('click', close));
  document.querySelectorAll('.nav__link').forEach((a) => a.addEventListener('click', close));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('is-open')) close();
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 1024) close();
  });

  document.querySelectorAll('[data-user-menu]').forEach((btn) => {
    btn.addEventListener('click', accountMenu);
  });
  document.querySelector('[data-notif]')?.addEventListener('click', notificationsModal);

  document.querySelector('.topbar__new')?.addEventListener('click', close);
}

function accountMenu() {
  openModal({
    title: 'Account',
    body: `<div class="account-card">
      <span class="avatar avatar--lg">${esc(initials(displayName(profile)))}</span>
      <div>
        <strong>${esc(displayName(profile))}</strong>
        <p>${esc(profile.email || '')}</p>
        <p class="muted">${esc(profile.role === 'owner' ? 'Owner — full access' : 'Staff — day-to-day access')}</p>
      </div>
    </div>
    <div class="menu-list">
      ${profile.role === 'owner' ? `<a class="menu-list__item" href="#/admin" data-close>${icon('settings', 17)} Admin & settings</a>` : ''}
      <button class="menu-list__item" data-signout>${icon('logout', 17)} Sign out</button>
    </div>`,
    onOpen: (el, close) => {
      el.querySelectorAll('[data-close]').forEach((a) => a.addEventListener('click', close));
      el.querySelector('[data-signout]').onclick = async () => {
        close();
        await signOut();
        location.replace('index.html');
      };
    },
  });
}

function updateConnectivity() {
  const banner = document.getElementById('offline-banner');
  if (banner) banner.hidden = navigator.onLine !== false;
}

function currentId() {
  const raw = location.hash.replace(/^#\/?/, '');
  return (raw.split('?')[0].split('/')[0] || 'dashboard');
}

function currentParams() {
  const raw = location.hash.replace(/^#\/?/, '');
  const path = raw.split('?')[0];
  return path.split('/').filter(Boolean).slice(1);
}

function setActiveNav(id) {
  document.querySelectorAll('[data-nav]').forEach((a) => {
    a.classList.toggle('is-active', a.dataset.nav === id);
  });
}

async function route() {
  const id = currentId();
  const params = currentParams();
  const view = document.getElementById('view');
  if (!view) return;

  document.getElementById('sidebar')?.classList.remove('is-open');
  document.body.classList.remove('no-scroll');
  document.querySelector('[data-open-nav]')?.setAttribute('aria-expanded', 'false');

  if (id === 'admin' && profile.role !== 'owner') {
    view.innerHTML = emptyState({
      iconName: 'lock', title: 'Owner only',
      text: 'User management, settings, the audit log and the trash are restricted to the owner.',
      action: '<a class="btn btn--primary" href="#/dashboard">Back to dashboard</a>',
    });
    return;
  }

  hydrateShell();
  setActiveNav(id);
  document.querySelectorAll('.nav__link').forEach((a) => a.classList.remove('is-active'));
  document.querySelector(`[data-nav="${id}"]`)?.classList.add('is-active');

  const loader = MODULES[id];
  if (!loader) {
    view.innerHTML = emptyState({
      iconName: 'alert', title: 'Page not found',
      text: 'That page does not exist.',
      action: '<a class="btn btn--primary" href="#/dashboard">Go to dashboard</a>',
    });
    return;
  }

  view.innerHTML = `<div class="route-loading">${spinner('Loading…')}</div>`;
  try {
    const mod = await loader();
    const ctx = {
      profile,
      isOwner: profile.role === 'owner',
      settings,
      navigate: (to) => { location.hash = to.startsWith('#') ? to : `#/${to}`; },
      reload: route,
      async reloadSettings() {
        clearSettingsCache();
        settings = await getSettings(true);
        setCurrencySymbol(settings.currency_symbol || '₦');
      },
    };
    currentModule = mod;
    await mod.render(view, params, ctx);
    view.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Something went wrong</p><h1>We could not load this page</h1></div></div>
      <div class="card card--pad">
        <div class="notice notice--danger">${icon('alert', 18)} ${esc(e.message || String(e))}</div>
        <div class="btn-row">
          <button class="btn btn--primary" data-retry>Try again</button>
          <a class="btn btn--ghost" href="#/dashboard">Dashboard</a>
        </div>
      </div>`;
    view.querySelector('[data-retry]')?.addEventListener('click', route);
  }
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
let notifCache = { alerts: [], due: [], balances: [], inbox: [] };

async function loadNotifications() {
  const [alerts, due, balances, inbox] = await Promise.all([
    sb.from('v_stock_alerts').select('*').order('shortfall', { ascending: false }).limit(20),
    sb.from('orders').select('*').is('deleted_at', null)
      .in('status', ['confirmed', 'in_production', 'ready', 'out_for_delivery'])
      .lte('delivery_date', addDays(3)).order('delivery_date', { ascending: true }).limit(20),
    sb.from('v_order_balances').select('*').order('balance', { ascending: false }).limit(20),
    sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(20),
  ]);
  notifCache = {
    alerts: alerts.data || [],
    due: due.data || [],
    balances: balances.data || [],
    inbox: inbox.data || [],
  };
  return notifCache;
}

async function refreshNotifications() {
  try {
    const n = await loadNotifications();
    const count = n.alerts.length + n.due.length + n.balances.length + n.inbox.filter((x) => !x.read_at).length;
    const dot = document.querySelector('[data-notif-count]');
    if (dot) {
      dot.hidden = count === 0;
      dot.textContent = count > 99 ? '99+' : String(count);
    }
  } catch (e) {
    console.warn('notifications', e);
  }
}

async function notificationsModal() {
  let data;
  try { data = await loadNotifications(); } catch (e) { toast(e.message, 'error'); return; }
  const { alerts, due, balances, inbox } = data;

  const section = (title, items, render, href) => items.length ? `
    <div class="notif-group">
      <div class="notif-group__head"><h3>${esc(title)}</h3><span>${items.length}</span></div>
      ${items.slice(0, 6).map(render).join('')}
      ${href ? `<a class="notif-more" href="${href}" data-close>View all ${icon('arrow', 14)}</a>` : ''}
    </div>` : '';

  const body = (alerts.length || due.length || balances.length || inbox.length)
    ? `<div class="notif-list">
        ${section('Low stock', alerts, (a) => `<a class="notif-item" href="#/ingredients" data-close>
          <span class="notif-item__icon notif-item__icon--warn">${icon('alert', 16)}</span>
          <span><strong>${esc(a.name)}</strong><small>${esc(a.kind)} · ${esc(a.stock_qty)} ${esc(a.unit)} left (reorder at ${esc(a.low_stock_at)})</small></span>
        </a>`)}
        ${section('Orders due soon', due, (o) => `<a class="notif-item" href="#/orders/${esc(o.id)}" data-close>
          <span class="notif-item__icon">${icon('clock', 16)}</span>
          <span><strong>${esc(o.order_no)}</strong><small>Due ${esc(fmtDate(o.delivery_date))} · ${esc(o.status.replace(/_/g, ' '))}</small></span>
        </a>`)}
        ${section('Outstanding balances', balances, (b) => `<a class="notif-item" href="#/orders/${esc(b.id)}" data-close>
          <span class="notif-item__icon notif-item__icon--berry">${icon('wallet', 16)}</span>
          <span><strong>${esc(b.customer_name || 'Customer')}</strong><small>${esc(b.order_no)} · ${esc(money(b.balance))} outstanding</small></span>
        </a>`)}
        ${section('Inbox', inbox.filter((x) => !x.read_at), (n) => `<div class="notif-item">
          <span class="notif-item__icon">${icon('bell', 16)}</span>
          <span><strong>${esc(n.title)}</strong><small>${esc(n.body || '')} · ${esc(relativeTime(n.created_at))}</small></span>
        </div>`)}
      </div>`
    : emptyState({ iconName: 'bell', title: 'All clear', text: 'No low stock, due orders or outstanding balances right now.' });

  openModal({
    title: 'Notifications',
    body,
    wide: true,
    footer: `<button class="btn btn--ghost" data-mark-read>Mark inbox as read</button>
      <button class="btn btn--primary" data-close>Done</button>`,
    onOpen: (el, close) => {
      el.querySelectorAll('[data-close]').forEach((a) => a.addEventListener('click', close));
      el.querySelector('[data-mark-read]').onclick = async (e) => {
        const unread = inbox.filter((x) => !x.read_at);
        if (unread.length) {
          const { error } = await sb.from('notifications')
            .update({ read_at: new Date().toISOString() })
            .in('id', unread.map((x) => x.id));
          if (error) toast(errText(error), 'error');
        }
        e.target.disabled = true;
        e.target.textContent = 'Marked read';
        refreshNotifications();
      };
    },
  });
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('app').innerHTML = `<div class="fatal">
    <h1>Could not start the app</h1><p>${esc(e.message || String(e))}</p>
    <a class="btn btn--primary" href="index.html">Back to sign in</a>
  </div>`;
});
