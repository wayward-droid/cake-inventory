// Admin: settings, users, audit trail, trash, notifications and data tools.
import { sb, errText, dataChanged, exportEverything } from '../supabase.js';
import {
  esc, money, num, fmtDate, fmtDateTime, relativeTime, titleCase, badge, icon, toast,
  openModal, formModal, confirmDialog, emptyState, spinner, table, downloadFile, today,
} from '../ui.js';

const TABS = [
  { key: 'settings', label: 'Settings', icon: 'settings' },
  { key: 'users', label: 'Users & roles', icon: 'users' },
  { key: 'audit', label: 'Audit log', icon: 'clipboard' },
  { key: 'trash', label: 'Trash', icon: 'trash' },
  { key: 'notifications', label: 'Notifications', icon: 'bell' },
  { key: 'data', label: 'Data & integrity', icon: 'layers' },
];

export async function render(root, params, ctx) {
  let tab = params[0] || 'settings';
  root.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">Owner only</p>
        <h1>Admin</h1>
        <p class="page-sub">Business settings, people, the audit trail and data tools.</p>
      </div>
    </div>
    <div class="tabbar tabbar--scroll" role="tablist">
      ${TABS.map((t) => `<button class="tab ${tab === t.key ? 'is-active' : ''}" data-tab="${t.key}">
        ${icon(t.icon, 16)} ${esc(t.label)}</button>`).join('')}
    </div>
    <div id="admin-panel">${spinner()}</div>`;

  const panel = root.querySelector('#admin-panel');

  function setTab(next) {
    tab = next;
    history.replaceState(null, '', `#/admin/${next}`);
    root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === next));
    load();
  }

  async function load() {
    panel.innerHTML = `<div class="route-loading">${spinner()}</div>`;
    try {
      if (tab === 'settings') await renderSettings();
      if (tab === 'users') await renderUsers();
      if (tab === 'audit') await renderAudit();
      if (tab === 'trash') await renderTrash();
      if (tab === 'notifications') await renderNotifications();
      if (tab === 'data') await renderData();
    } catch (e) {
      panel.innerHTML = `<div class="notice notice--danger">${icon('alert', 17)} ${esc(e.message)}</div>`;
    }
  }

  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

  // ---------------------------------------------------------------- settings
  async function renderSettings() {
    const { data, error } = await sb.from('settings').select('*').eq('id', true).maybeSingle();
    if (error) throw new Error(errText(error));
    const s = data || {};

    panel.innerHTML = `<form id="settings-form" class="settings-grid" novalidate>
      <section class="card card--pad">
        <div class="card-head"><div><h2>Business identity</h2><p class="muted">Shown on invoices, receipts and quotes.</p></div>${icon('sparkles', 18)}</div>
        <div class="form-grid form-grid--single">
          ${input('business_name', 'Business name', s.business_name, { required: true })}
          ${input('phone', 'Phone', s.phone)}
          ${input('email', 'Email', s.email, { type: 'email' })}
          ${input('address', 'Address', s.address)}
          ${input('logo_url', 'Logo URL', s.logo_url, { type: 'url', placeholder: 'https://…' })}
          ${textarea('invoice_footer', 'Invoice footer', s.invoice_footer, 'Thank you for your order.')}
        </div>
      </section>

      <section class="card card--pad">
        <div class="card-head"><div><h2>Money &amp; tax</h2><p class="muted">Applied to new orders and documents.</p></div>${icon('wallet', 18)}</div>
        <div class="form-grid form-grid--single">
          ${input('currency_symbol', 'Currency symbol', s.currency_symbol || '₦')}
          ${input('tax_label', 'Tax label', s.tax_label || 'VAT')}
          ${number('tax_rate', 'Tax rate (%)', s.tax_rate || 0, 0, 100, '0.001')}
          ${checkbox('tax_inclusive', 'Prices already include tax', s.tax_inclusive)}
          ${number('discount_limit_pct', 'Staff discount limit (%)', s.discount_limit_pct ?? 10, 0, 100, '0.01')}
          ${number('deposit_required_above', 'Deposit expected above', s.deposit_required_above || 0, 0, null, '0.01')}
        </div>
      </section>

      <section class="card card--pad">
        <div class="card-head"><div><h2>Stock rules</h2><p class="muted">How the database treats shortages.</p></div>${icon('flour', 18)}</div>
        <div class="form-grid form-grid--single">
          ${number('default_low_stock', 'Default low-stock level', s.default_low_stock ?? 5, 0, null, 'any')}
          ${checkbox('allow_negative_stock', 'Allow negative stock', s.allow_negative_stock, 'Baking or selling below zero is permitted. Leave off to force an override.')}
        </div>
      </section>

      <div class="settings-save">
        <div class="form-error" role="alert" hidden></div>
        <button class="btn btn--primary" type="submit" data-save>${icon('check', 17)} Save settings</button>
      </div>
    </form>`;

    const form = panel.querySelector('#settings-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = form.querySelector('.form-error');
      err.hidden = true;
      const btn = form.querySelector('[data-save]');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        const payload = {
          business_name: val(form, 'business_name') || 'Cake Slice Factory',
          phone: val(form, 'phone'), email: val(form, 'email'), address: val(form, 'address'),
          logo_url: val(form, 'logo_url'), invoice_footer: val(form, 'invoice_footer'),
          currency_symbol: val(form, 'currency_symbol') || '₦',
          tax_label: val(form, 'tax_label') || 'VAT',
          tax_rate: Number(val(form, 'tax_rate') || 0),
          tax_inclusive: form.elements.tax_inclusive.checked,
          discount_limit_pct: Number(val(form, 'discount_limit_pct') || 0),
          deposit_required_above: Number(val(form, 'deposit_required_above') || 0),
          default_low_stock: Number(val(form, 'default_low_stock') || 0),
          allow_negative_stock: form.elements.allow_negative_stock.checked,
        };
        const { error: saveErr } = await sb.from('settings').update(payload).eq('id', true);
        if (saveErr) throw new Error(errText(saveErr));
        await ctx.reloadSettings();
        dataChanged('settings');
        toast('Settings saved.');
        btn.disabled = false;
        btn.textContent = 'Save settings';
      } catch (error) {
        err.textContent = error.message;
        err.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Save settings';
      }
    });
  }

  // ---------------------------------------------------------------- users
  async function renderUsers() {
    const { data, error } = await sb.from('profiles').select('*').order('created_at');
    if (error) throw new Error(errText(error));
    const users = data || [];

    panel.innerHTML = `<section class="card">
      <div class="card-head card-head--pad">
        <div><h2>People</h2><p class="muted">Owners manage everything. Staff run day-to-day sales and stock.</p></div>
        <span class="pill">${num(users.length)} user${users.length === 1 ? '' : 's'}</span>
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Joined</th><th></th></tr></thead>
        <tbody>${users.map((u) => `<tr>
          <td><div class="cell-main"><strong>${esc(u.full_name || u.email)}</strong><small>${esc(u.email)}${u.phone ? ` · ${esc(u.phone)}` : ''}</small></div></td>
          <td>${u.id === ctx.profile.id
            ? badge('Owner (you)', 'success')
            : `<select data-role="${esc(u.id)}" class="select-inline">
                <option value="staff" ${u.role === 'staff' ? 'selected' : ''}>Staff</option>
                <option value="owner" ${u.role === 'owner' ? 'selected' : ''}>Owner</option>
              </select>`}</td>
          <td>${u.active === false ? badge('Deactivated', 'danger') : badge('Active', 'success')}</td>
          <td>${esc(fmtDate(u.created_at))}</td>
          <td class="td-actions">${u.id === ctx.profile.id ? '<span class="muted">—</span>' : `<button class="btn btn--sm ${u.active === false ? 'btn--primary' : 'btn--ghost'}" data-toggle="${esc(u.id)}" data-active="${u.active === false ? '1' : '0'}">${u.active === false ? 'Reactivate' : 'Deactivate'}</button>`}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </section>
    <div class="notice">${icon('lock', 17)} New accounts sign up from the sign-in page and start as staff. Promote a trusted person to owner here. The database blocks non-owners from changing roles.</div>`;

    panel.querySelectorAll('[data-role]').forEach((sel) => sel.addEventListener('change', async () => {
      const id = sel.dataset.role;
      const role = sel.value;
      const ok = await confirmDialog({
        title: role === 'owner' ? 'Make this user an owner?' : 'Change this user to staff?',
        message: role === 'owner' ? 'Owners can change settings, see the audit log and delete records.' : 'They keep day-to-day access but lose owner controls.',
        confirmText: 'Update role',
      });
      if (!ok) { load(); return; }
      const { error } = await sb.from('profiles').update({ role }).eq('id', id);
      if (error) { toast(errText(error), 'error'); load(); return; }
      dataChanged('profiles');
      toast('Role updated.');
      load();
    }));

    panel.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
      const activate = b.dataset.active === '1';
      const ok = await confirmDialog({
        title: activate ? 'Reactivate this user?' : 'Deactivate this user?',
        message: activate ? 'They can sign in and work again.' : 'They are signed out of new sessions and cannot operate until reactivated.',
        confirmText: activate ? 'Reactivate' : 'Deactivate', danger: !activate,
      });
      if (!ok) return;
      const { error } = await sb.from('profiles').update({ active: activate }).eq('id', b.dataset.toggle);
      if (error) { toast(errText(error), 'error'); return; }
      dataChanged('profiles');
      toast(activate ? 'User reactivated.' : 'User deactivated.');
      load();
    }));
  }

  // ---------------------------------------------------------------- audit
  async function renderAudit() {
    const { data, error } = await sb.from('audit_log').select('*').order('created_at', { ascending: false }).limit(150);
    if (error) throw new Error(errText(error));
    let rows = data || [];
    let tableFilter = '';
    let actionFilter = '';

    function draw() {
      const filtered = rows.filter((r) => (!tableFilter || r.table_name === tableFilter) && (!actionFilter || r.action === actionFilter));
      const tables = [...new Set(rows.map((r) => r.table_name))].sort();
      panel.innerHTML = `<section class="card">
        <div class="card-head card-head--pad">
          <div><h2>Audit log</h2><p class="muted">Every insert, update and delete, newest first. Read-only.</p></div>
          <div class="toolbar__filters">
            <select data-audit-table aria-label="Table">
              <option value="">All tables</option>
              ${tables.map((t) => `<option value="${esc(t)}" ${tableFilter === t ? 'selected' : ''}>${esc(titleCase(t))}</option>`).join('')}
            </select>
            <select data-audit-action aria-label="Action">
              <option value="">All actions</option>
              <option value="insert" ${actionFilter === 'insert' ? 'selected' : ''}>Insert</option>
              <option value="update" ${actionFilter === 'update' ? 'selected' : ''}>Update</option>
              <option value="delete" ${actionFilter === 'delete' ? 'selected' : ''}>Delete</option>
            </select>
          </div>
        </div>
        ${filtered.length ? `<div class="table-wrap"><table class="data-table data-table--tight">
          <thead><tr><th>When</th><th>Table</th><th>Action</th><th>Actor</th><th></th></tr></thead>
          <tbody>${filtered.map((r) => `<tr>
            <td><div class="cell-main"><strong>${esc(relativeTime(r.created_at))}</strong><small>${esc(fmtDateTime(r.created_at))}</small></div></td>
            <td>${esc(titleCase(r.table_name))}</td>
            <td>${badge(r.action, r.action === 'insert' ? 'success' : r.action === 'update' ? 'info' : 'danger')}</td>
            <td>${esc(r.actor_email || 'system')}</td>
            <td class="td-actions"><button class="btn btn--sm btn--ghost" data-view-audit="${esc(r.id)}">${icon('eye', 15)} View</button></td>
          </tr>`).join('')}</tbody></table></div>`
          : emptyState({ iconName: 'clipboard', title: 'No audit entries', text: 'Changes to products, orders, expenses and settings appear here.' })}
      </section>`;

      panel.querySelector('[data-audit-table]').addEventListener('change', (e) => { tableFilter = e.target.value; draw(); });
      panel.querySelector('[data-audit-action]').addEventListener('change', (e) => { actionFilter = e.target.value; draw(); });
      panel.querySelectorAll('[data-view-audit]').forEach((b) => b.addEventListener('click', () => {
        const row = rows.find((r) => r.id === b.dataset.viewAudit);
        viewAudit(row);
      }));
    }

    function viewAudit(row) {
      if (!row) return;
      const changes = diff(row.before, row.after);
      openModal({
        title: `${titleCase(row.table_name)} · ${row.action} · ${fmtDateTime(row.created_at)}`,
        wide: true,
        body: `<p class="muted">Actor: ${esc(row.actor_email || 'system')} · record ${esc(String(row.record_id || '').slice(0, 8))}</p>
          ${changes.length ? `<div class="table-wrap"><table class="data-table data-table--tight">
            <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
            <tbody>${changes.map((c) => `<tr>
              <td><strong>${esc(c.key)}</strong></td>
              <td class="muted">${esc(fmtVal(c.before))}</td>
              <td>${esc(fmtVal(c.after))}</td>
            </tr>`).join('')}</tbody></table></div>`
          : `<div class="notice">${icon('clipboard', 16)} ${row.action === 'insert' ? 'Record created.' : row.action === 'delete' ? 'Record deleted.' : 'No field values changed.'}</div>`}
          ${row.action === 'insert' ? `<details class="audit-json"><summary>Created record</summary><pre>${esc(JSON.stringify(row.after, null, 2))}</pre></details>` : ''}`,
        footer: '<button class="btn btn--ghost" data-close>Close</button>',
      });
    }

    draw();
  }

  // ---------------------------------------------------------------- trash
  async function renderTrash() {
    const configs = [
      { table: 'orders', label: 'Orders', name: (r) => r.order_no, purge: false },
      { table: 'products', label: 'Products', name: (r) => r.name, purge: true },
      { table: 'ingredients', label: 'Ingredients', name: (r) => r.name, purge: true },
      { table: 'customers', label: 'Customers', name: (r) => r.name, purge: false },
      { table: 'vendors', label: 'Vendors', name: (r) => r.name, purge: true },
      { table: 'expenses', label: 'Expenses', name: (r) => r.description, purge: true },
      { table: 'ingredient_purchases', label: 'Stock receipts', name: (r) => `Purchase · ${fmtDate(r.purchased_on)}`, purge: true },
    ];

    const results = await Promise.all(configs.map(async (c) => {
      const { data, error } = await sb.from(c.table).select('*').not('deleted_at', 'is', null);
      if (error) throw new Error(errText(error));
      return { ...c, rows: data || [] };
    }));
    const total = results.reduce((s, r) => s + r.rows.length, 0);

    panel.innerHTML = `<section class="card">
      <div class="card-head card-head--pad">
        <div><h2>Trash</h2><p class="muted">Soft-deleted records. Restore them or remove them for good.</p></div>
        <span class="pill">${num(total)} item${total === 1 ? '' : 's'}</span>
      </div>
      ${total ? `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Type</th><th>Record</th><th>Deleted</th><th></th></tr></thead>
        <tbody>${results.flatMap((c) => c.rows.map((r) => `<tr>
          <td>${badge(c.label, 'muted')}</td>
          <td><strong>${esc(c.name(r) || 'Untitled')}</strong></td>
          <td>${esc(fmtDateTime(r.deleted_at))}</td>
          <td class="td-actions"><div class="row-actions">
            <button class="btn btn--sm btn--ghost" data-restore="${esc(c.table)}|${esc(r.id)}">${icon('undo', 15)} Restore</button>
            ${c.purge ? `<button class="btn btn--sm btn--danger" data-purge="${esc(c.table)}|${esc(r.id)}">${icon('trash', 15)} Delete forever</button>` : ''}
          </div></td>
        </tr>`)).join('')}</tbody>
      </table></div>` : emptyState({ iconName: 'trash', title: 'Trash is empty', text: 'Archived records will appear here so nothing is lost by accident.' })}
    </section>
    <div class="notice">${icon('lock', 17)} Orders and customers can be restored but not permanently deleted, so stock history and accounting stay intact.</div>`;

    panel.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', async () => {
      const [table, id] = b.dataset.restore.split('|');
      const { error } = await sb.from(table).update({ deleted_at: null }).eq('id', id);
      if (error) { toast(errText(error), 'error'); return; }
      dataChanged(table);
      toast('Restored.');
      load();
    }));

    panel.querySelectorAll('[data-purge]').forEach((b) => b.addEventListener('click', async () => {
      const [table, id] = b.dataset.purge.split('|');
      const ok = await confirmDialog({
        title: 'Delete forever?',
        message: 'This cannot be undone. Linked history may also be removed by the database.',
        confirmText: 'Delete forever', danger: true,
      });
      if (!ok) return;
      const { error } = await sb.from(table).delete().eq('id', id);
      if (error) { toast(errText(error), 'error'); return; }
      dataChanged(table);
      toast('Deleted permanently.');
      load();
    }));
  }

  // ---------------------------------------------------------------- notifications
  async function renderNotifications() {
    const { data, error } = await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(100);
    if (error) throw new Error(errText(error));
    const rows = data || [];

    panel.innerHTML = `<section class="card">
      <div class="card-head card-head--pad">
        <div><h2>Notifications</h2><p class="muted">Low-stock alerts and system messages.</p></div>
        <div class="toolbar__filters">
          <button class="btn btn--sm btn--ghost" data-scan>${icon('refresh', 15)} Scan low stock</button>
          <button class="btn btn--sm btn--ghost" data-mark-read>${icon('check', 15)} Mark all read</button>
        </div>
      </div>
      ${rows.length ? `<div class="notif-list notif-list--page">${rows.map((n) => `<div class="notif-item ${n.read_at ? 'is-read' : ''}">
        <span class="notif-item__icon ${n.kind === 'low_stock' ? 'notif-item__icon--warn' : ''}">${icon(n.kind === 'low_stock' ? 'alert' : 'bell', 16)}</span>
        <span><strong>${esc(n.title)}</strong><small>${esc(n.body || '')} · ${esc(relativeTime(n.created_at))}</small></span>
        ${n.read_at ? badge('Read', 'muted') : badge('New', 'berry')}
      </div>`).join('')}</div>` : emptyState({ iconName: 'bell', title: 'No notifications', text: 'Scan low stock to raise alerts for anything below its reorder point.' })}
    </section>`;

    panel.querySelector('[data-scan]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const { data: n, error } = await sb.rpc('refresh_low_stock_notifications', {});
        if (error) throw new Error(errText(error));
        toast(`${n || 0} low-stock alert${Number(n) === 1 ? '' : 's'} raised.`);
        load();
      } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
    });

    panel.querySelector('[data-mark-read]').addEventListener('click', async () => {
      const unread = rows.filter((n) => !n.read_at);
      if (!unread.length) { toast('Everything is already read.'); return; }
      const { error } = await sb.from('notifications')
        .update({ read_at: new Date().toISOString() })
        .in('id', unread.map((n) => n.id));
      if (error) { toast(errText(error), 'error'); return; }
      toast('Notifications marked read.');
      load();
    });
  }

  // ---------------------------------------------------------------- data
  async function renderData() {
    panel.innerHTML = `<div class="data-grid">
      <section class="card card--pad">
        <div class="card-head"><div><h2>Backup</h2><p class="muted">Every table as a JSON file you can keep.</p></div>${icon('download', 18)}</div>
        <p class="muted">Download a full snapshot of the business — settings, catalogue, orders, stock movements, audit log and more.</p>
        <button class="btn btn--primary btn--block" data-export>${icon('download', 16)} Export all data</button>
      </section>

      <section class="card card--pad">
        <div class="card-head"><div><h2>Stock integrity</h2><p class="muted">Cached quantities versus the ledger.</p></div>${icon('layers', 18)}</div>
        <p class="muted">The stock ledger is the source of truth. This check compares every ingredient and product against the sum of its movements.</p>
        <button class="btn btn--ghost btn--block" data-integrity>${icon('check', 16)} Run integrity check</button>
        <div id="integrity-result"></div>
      </section>

      <section class="card card--pad">
        <div class="card-head"><div><h2>Housekeeping</h2><p class="muted">Keep the workspace tidy.</p></div>${icon('refresh', 18)}</div>
        <div class="stack">
          <button class="btn btn--ghost btn--block" data-scan>${icon('bell', 16)} Refresh low-stock alerts</button>
          <button class="btn btn--ghost btn--block" data-mark-read>${icon('check', 16)} Mark notifications read</button>
        </div>
      </section>

      <section class="card card--pad">
        <div class="card-head"><div><h2>Connected project</h2></div>${icon('wifi', 18)}</div>
        <p class="muted">This workspace is backed by Supabase. Row Level Security, triggers and the immutable ledger are active.</p>
      </section>
    </div>`;

    panel.querySelector('[data-export]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Preparing…';
      try {
        const everything = await exportEverything();
        downloadFile(`cake-slice-backup-${today()}.json`, JSON.stringify(everything, null, 2), 'application/json');
        toast('Backup downloaded.');
      } catch (err) { toast(err.message, 'error'); }
      btn.disabled = false;
      btn.textContent = 'Export all data';
    });

    panel.querySelector('[data-integrity]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const out = panel.querySelector('#integrity-result');
      btn.disabled = true;
      btn.textContent = 'Checking…';
      try {
        const { data, error } = await sb.rpc('check_stock_integrity', {});
        if (error) throw new Error(errText(error));
        const bad = (data || []).filter((r) => Math.abs(Number(r.diff)) > 0.004);
        out.innerHTML = bad.length
          ? `<div class="notice notice--danger">${icon('alert', 16)} ${bad.length} item${bad.length === 1 ? '' : 's'} differ from the ledger.</div>
            <div class="table-wrap"><table class="data-table data-table--tight">
              <thead><tr><th>Item</th><th>Kind</th><th class="num">Cached</th><th class="num">Ledger</th><th class="num">Diff</th></tr></thead>
              <tbody>${bad.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.kind)}</td><td class="num">${num(r.cached_qty, 2)}</td><td class="num">${num(r.ledger_qty, 2)}</td><td class="num text-danger">${num(r.diff, 2)}</td></tr>`).join('')}</tbody>
            </table></div>`
          : `<div class="notice notice--ok">${icon('check', 16)} All ${num((data || []).length)} stock balances match the ledger exactly.</div>`;
      } catch (err) { out.innerHTML = `<div class="notice notice--danger">${esc(err.message)}</div>`; }
      btn.disabled = false;
      btn.textContent = 'Run integrity check';
    });

    panel.querySelectorAll('[data-scan]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const { data, error } = await sb.rpc('refresh_low_stock_notifications', {});
        if (error) throw new Error(errText(error));
        toast(`${data || 0} low-stock alert${Number(data) === 1 ? '' : 's'} raised.`);
      } catch (err) { toast(err.message, 'error'); }
    }));

    panel.querySelectorAll('[data-mark-read]').forEach((b) => b.addEventListener('click', async () => {
      const { error } = await sb.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
      if (error) { toast(errText(error), 'error'); return; }
      toast('Notifications marked read.');
    }));

  }

  await load();
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function val(form, name) {
  const el = form.elements[name];
  if (!el) return null;
  const v = String(el.value ?? '').trim();
  return v === '' ? null : v;
}

function input(name, label, value, opts = {}) {
  return `<div class="field"><label for="s_${name}">${esc(label)}${opts.required ? ' <span class="req">*</span>' : ''}</label>
    <input id="s_${name}" name="${name}" type="${opts.type || 'text'}" value="${esc(value || '')}" placeholder="${esc(opts.placeholder || '')}"></div>`;
}
function number(name, label, value, min, max, step) {
  return `<div class="field"><label for="s_${name}">${esc(label)}</label>
    <input id="s_${name}" name="${name}" type="number" value="${esc(value)}" ${min != null ? `min="${min}"` : ''} ${max != null ? `max="${max}"` : ''} step="${step || 'any'}"></div>`;
}
function textarea(name, label, value, placeholder = '') {
  return `<div class="field"><label for="s_${name}">${esc(label)}</label>
    <textarea id="s_${name}" name="${name}" rows="2" placeholder="${esc(placeholder)}">${esc(value || '')}</textarea></div>`;
}
function checkbox(name, label, checked, help = '') {
  return `<div class="field field--check">
    <label class="switch-row" for="s_${name}">
      <input type="checkbox" id="s_${name}" name="${name}" ${checked ? 'checked' : ''}>
      <span class="switch"></span><span>${esc(label)}</span>
    </label>
    ${help ? `<small class="field__help">${esc(help)}</small>` : ''}
  </div>`;
}

function diff(before, after) {
  if (!before && !after) return [];
  if (!before) return Object.entries(after || {}).map(([key, value]) => ({ key, before: null, after: value }));
  if (!after) return Object.entries(before || {}).map(([key, value]) => ({ key, before: value, after: null }));
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out = [];
  for (const key of keys) {
    const b = before[key];
    const a = after[key];
    if (JSON.stringify(b) !== JSON.stringify(a)) out.push({ key, before: b, after: a });
  }
  return out;
}

function fmtVal(v) {
  if (v == null) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
