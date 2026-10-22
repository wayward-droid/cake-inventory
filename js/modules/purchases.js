// Purchases: received stock, purchase orders and vendor payables.
import { sb, errText, dataChanged } from '../supabase.js';
import {
  esc, money, num, fmtDate, relativeTime, titleCase, badge, icon, toast, openModal,
  formModal, confirmDialog, emptyState, spinner, table, today, setBusy,
} from '../ui.js';
import { PAYMENT_METHODS } from '../config.js';

export async function render(root, params, ctx) {
  root.innerHTML = `<div class="route-loading">${spinner('Loading purchases…')}</div>`;

  let vendors = [], ingredients = [], purchases = [], orders = [], poItems = [], payables = [];
  try {
    const [vRes, iRes, pRes, oRes, piRes, payRes] = await Promise.all([
      sb.from('vendors').select('*').is('deleted_at', null).order('name'),
      sb.from('ingredients').select('*').is('deleted_at', null).order('name'),
      sb.from('ingredient_purchases').select('*').is('deleted_at', null).order('purchased_on', { ascending: false }).limit(100),
      sb.from('purchase_orders').select('*').order('created_at', { ascending: false }),
      sb.from('purchase_order_items').select('*'),
      sb.from('v_vendor_payables').select('*'),
    ]);
    for (const r of [vRes, iRes, pRes, oRes, piRes, payRes]) if (r.error) throw new Error(errText(r.error));
    vendors = vRes.data || [];
    ingredients = iRes.data || [];
    purchases = pRes.data || [];
    orders = oRes.data || [];
    poItems = piRes.data || [];
    payables = payRes.data || [];
  } catch (e) {
    root.innerHTML = `<div class="notice notice--danger">${icon('alert', 18)} ${esc(e.message)}</div>`;
    return;
  }

  const vendorMap = new Map(vendors.map((v) => [v.id, v]));
  const ingredientMap = new Map(ingredients.map((i) => [i.id, i]));
  const itemsFor = (poId) => poItems.filter((i) => i.purchase_order_id === poId);
  let tab = 'received';

  function draw() {
    const receivedValue = purchases.reduce((s, p) => s + Number(p.qty) * Number(p.unit_cost), 0);
    const openPOs = orders.filter((o) => !['received', 'cancelled'].includes(o.status));
    const payable = payables.reduce((s, p) => s + Math.max(0, Number(p.balance)), 0);

    root.innerHTML = `
      <div class="page-head">
        <div>
          <p class="eyebrow">Operations</p>
          <h1>Purchases</h1>
          <p class="page-sub">Stock in, purchase orders out, and what you still owe vendors.</p>
        </div>
        <div class="page-actions">
          <button class="btn btn--ghost" data-record>${icon('box', 17)} Record purchase</button>
          <button class="btn btn--primary" data-new-po>${icon('plus', 17)} New purchase order</button>
        </div>
      </div>

      <div class="mini-stats">
        <div class="mini-stat mini-stat--sage">
          <span class="mini-stat__icon">${icon('box', 17)}</span>
          <span><small>Received value</small><strong>${money(receivedValue, { decimals: 0 })}</strong></span>
        </div>
        <div class="mini-stat mini-stat--caramel">
          <span class="mini-stat__icon">${icon('clock', 17)}</span>
          <span><small>Open purchase orders</small><strong>${num(openPOs.length)}</strong></span>
        </div>
        <div class="mini-stat mini-stat--danger">
          <span class="mini-stat__icon">${icon('wallet', 17)}</span>
          <span><small>Owed to vendors</small><strong>${money(payable, { decimals: 0 })}</strong></span>
        </div>
        <div class="mini-stat mini-stat--berry">
          <span class="mini-stat__icon">${icon('truck', 17)}</span>
          <span><small>Vendors</small><strong>${num(vendors.length)}</strong></span>
        </div>
      </div>

      <div class="tabbar" role="tablist">
        ${tabButton('received', 'Items received', purchases.length)}
        ${tabButton('orders', 'Purchase orders', orders.length)}
        ${tabButton('payables', 'Vendor payables', payables.filter((p) => Number(p.balance) > 0.004).length)}
      </div>

      <div id="purchases-panel"></div>`;

    root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; draw(); }));
    root.querySelector('[data-record]').addEventListener('click', recordPurchase);
    root.querySelector('[data-new-po]').addEventListener('click', newPurchaseOrder);

    const panel = root.querySelector('#purchases-panel');
    if (tab === 'received') panel.innerHTML = receivedPanel();
    if (tab === 'orders') panel.innerHTML = ordersPanel();
    if (tab === 'payables') panel.innerHTML = payablesPanel();
    bindPanel(panel);
  }

  function tabButton(key, label, count) {
    return `<button class="tab ${tab === key ? 'is-active' : ''}" data-tab="${key}" role="tab">
      ${esc(label)} <span class="tab__count">${num(count)}</span></button>`;
  }

  function receivedPanel() {
    return `<section class="card">
      <div class="card-head card-head--pad">
        <div><h2>Items received</h2><p class="muted">Each receipt raises ingredient stock and refreshes unit cost.</p></div>
        <button class="icon-btn" data-refresh title="Refresh">${icon('refresh', 17)}</button>
      </div>
      ${purchases.length ? table({
        columns: [
          { key: 'purchased_on', label: 'Date', render: (p) => `<div class="cell-main"><strong>${esc(fmtDate(p.purchased_on))}</strong><small>${esc(relativeTime(p.created_at))}</small></div>` },
          { key: 'vendor_id', label: 'Vendor', render: (p) => esc(vendorMap.get(p.vendor_id)?.name || '—') },
          {
            key: 'ingredient_id', label: 'Ingredient',
            render: (p) => `<div class="cell-main"><strong>${esc(ingredientMap.get(p.ingredient_id)?.name || 'Removed')}</strong><small>${esc(p.note || '')}</small></div>`,
          },
          { key: 'qty', label: 'Qty', className: 'num', render: (p) => `${num(p.qty, 2)} <small>${esc(p.unit || ingredientMap.get(p.ingredient_id)?.unit || '')}</small>` },
          { key: 'unit_cost', label: 'Unit cost', className: 'num', render: (p) => money(p.unit_cost) },
          { key: '_total', label: 'Total', className: 'num', render: (p) => `<strong>${money(Number(p.qty) * Number(p.unit_cost))}</strong>` },
          { key: '_actions', label: '', className: 'td-actions', raw: true, render: (p) => `<button class="icon-btn icon-btn--danger" data-delete-purchase="${esc(p.id)}" title="Reverse receipt">${icon('undo', 16)}</button>` },
        ],
        rows: purchases,
        empty: 'No stock receipts yet. Record one when a delivery arrives.',
      }) : emptyState({ iconName: 'box', title: 'No deliveries yet', text: 'Record items received when stock arrives.', action: '<button class="btn btn--primary" data-record>Record purchase</button>' })}
    </section>`;
  }

  function ordersPanel() {
    return `<section class="card">
      <div class="card-head card-head--pad">
        <div><h2>Purchase orders</h2><p class="muted">Order ahead, receive once, pay the vendor on your terms.</p></div>
        <button class="icon-btn" data-refresh title="Refresh">${icon('refresh', 17)}</button>
      </div>
      ${orders.length ? table({
        columns: [
          { key: 'po_no', label: 'PO', render: (o) => `<div class="cell-main"><strong>${esc(o.po_no)}</strong><small>${esc(fmtDate(o.ordered_on))}</small></div>` },
          { key: 'vendor_id', label: 'Vendor', render: (o) => esc(vendorMap.get(o.vendor_id)?.name || '—') },
          { key: '_items', label: 'Items', render: (o) => `${num(itemsFor(o.id).length)} line${itemsFor(o.id).length === 1 ? '' : 's'}` },
          { key: 'expected_on', label: 'Expected', render: (o) => o.expected_on ? esc(fmtDate(o.expected_on)) : '<span class="muted">—</span>' },
          { key: 'total', label: 'Total', className: 'num', render: (o) => `<strong>${money(o.total, { decimals: 0 })}</strong>` },
          { key: 'status', label: 'Status', render: (o) => badge(titleCase(o.status), o.status === 'received' ? 'success' : o.status === 'cancelled' ? 'danger' : o.status === 'sent' ? 'warn' : 'muted') },
          {
            key: '_actions', label: '', className: 'td-actions', raw: true,
            render: (o) => `<div class="row-actions">
              <button class="btn btn--sm btn--ghost" data-view-po="${esc(o.id)}">${icon('eye', 15)} View</button>
              ${!['received', 'cancelled'].includes(o.status) ? `<button class="btn btn--sm btn--primary" data-receive-po="${esc(o.id)}">${icon('check', 15)} Receive</button>` : ''}
              ${!['received', 'cancelled'].includes(o.status) ? `<button class="icon-btn icon-btn--danger" data-cancel-po="${esc(o.id)}" title="Cancel">${icon('close', 15)}</button>` : ''}
            </div>`,
          },
        ],
        rows: orders,
        empty: 'No purchase orders yet.',
      }) : emptyState({ iconName: 'clipboard', title: 'No purchase orders', text: 'Raise one for cocoa, boxes or a big weekend bake.', action: '<button class="btn btn--primary" data-new-po>New purchase order</button>' })}
    </section>`;
  }

  function payablesPanel() {
    const owing = payables.filter((p) => Number(p.balance) > 0.004);
    return `<section class="card">
      <div class="card-head card-head--pad">
        <div><h2>Vendor payables</h2><p class="muted">Received purchase orders minus payments made.</p></div>
        <button class="icon-btn" data-refresh title="Refresh">${icon('refresh', 17)}</button>
      </div>
      ${owing.length ? table({
        columns: [
          { key: 'name', label: 'Vendor', render: (v) => `<div class="cell-main"><strong>${esc(v.name)}</strong><small>${esc(v.phone || '')}</small></div>` },
          { key: 'received_value', label: 'Goods received', className: 'num', render: (v) => money(v.received_value, { decimals: 0 }) },
          { key: 'paid_value', label: 'Paid', className: 'num', render: (v) => `<span class="text-sage">${money(v.paid_value, { decimals: 0 })}</span>` },
          {
            key: 'balance', label: 'Balance', className: 'num',
            render: (v) => Number(v.balance) > 0.004
              ? `<strong class="text-danger">${money(v.balance, { decimals: 0 })}</strong>`
              : '<span class="text-sage">Settled</span>',
          },
          {
            key: '_actions', label: '', className: 'td-actions', raw: true,
            render: (v) => `<div class="row-actions">
              <button class="btn btn--sm btn--ghost" data-pay-vendor="${esc(v.id)}" data-balance="${esc(v.balance)}">${icon('card', 15)} Pay</button>
            </div>`,
          },
        ],
        rows: owing,
        empty: 'No vendor balances yet.',
      }) : emptyState({ iconName: 'wallet', title: 'No vendors to settle', text: 'Record a purchase order and receive it to build a payable.' })}
      ${owing.length ? `<div class="notice notice--warn">${icon('alert', 16)} ${owing.length} vendor${owing.length === 1 ? '' : 's'} still owed ${money(owing.reduce((s, p) => s + Number(p.balance), 0), { decimals: 0 })}.</div>` : ''}
    </section>`;
  }

  function bindPanel(panel) {
    panel.querySelector('[data-refresh]')?.addEventListener('click', () => render(root, params, ctx));
    panel.querySelectorAll('[data-record]').forEach((b) => b.addEventListener('click', recordPurchase));
    panel.querySelectorAll('[data-new-po]').forEach((b) => b.addEventListener('click', newPurchaseOrder));

    panel.querySelectorAll('[data-delete-purchase]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Reverse this receipt?',
        message: 'The purchase is soft-deleted. Ingredient stock is not automatically reduced — use a stock adjustment if the goods also went back.',
        confirmText: 'Reverse', danger: true,
      });
      if (!ok) return;
      const { error } = await sb.from('ingredient_purchases').update({ deleted_at: new Date().toISOString() }).eq('id', b.dataset.deletePurchase);
      if (error) { toast(errText(error), 'error'); return; }
      dataChanged('ingredient_purchases');
      toast('Receipt reversed.');
      render(root, params, ctx);
    }));

    panel.querySelectorAll('[data-view-po]').forEach((b) => b.addEventListener('click', () => viewPO(b.dataset.viewPo)));
    panel.querySelectorAll('[data-receive-po]').forEach((b) => b.addEventListener('click', () => receivePO(b.dataset.receivePo)));
    panel.querySelectorAll('[data-cancel-po]').forEach((b) => b.addEventListener('click', () => cancelPO(b.dataset.cancelPo)));
    panel.querySelectorAll('[data-pay-vendor]').forEach((b) => b.addEventListener('click', () => payVendor(b.dataset.payVendor, b.dataset.balance)));
  }

  function recordPurchase() {
    if (!ingredients.length) { toast('Add an ingredient first.', 'warn'); return; }
    formModal({
      title: 'Record items received',
      wide: true,
      intro: 'This raises ingredient stock, writes to the ledger and refreshes the unit cost.',
      fields: [
        { name: 'vendor_id', label: 'Vendor', type: 'select', options: vendors.map((v) => ({ value: v.id, label: v.name })), span: 2 },
        { name: 'ingredient_id', label: 'Ingredient', type: 'select', options: ingredients.map((i) => ({ value: i.id, label: `${i.name} (${i.unit})` })), required: true, span: 2 },
        { name: 'qty', label: 'Quantity', type: 'number', required: true, min: 0.01, step: 'any' },
        { name: 'unit', label: 'Unit', type: 'text', placeholder: 'kg, piece, litre…' },
        { name: 'unit_cost', label: 'Unit cost', type: 'money', required: true, min: 0 },
        { name: 'purchased_on', label: 'Received on', type: 'date', required: true, default: today() },
        { name: 'note', label: 'Note', type: 'text', span: 2, placeholder: 'Invoice number, delivery note…' },
      ],
      onSubmit: async (data) => {
        const ing = ingredients.find((i) => i.id === data.ingredient_id);
        const { error } = await sb.from('ingredient_purchases').insert({
          vendor_id: data.vendor_id, ingredient_id: data.ingredient_id,
          qty: Number(data.qty), unit: data.unit || ing?.unit || null,
          unit_cost: Number(data.unit_cost), purchased_on: data.purchased_on,
          note: data.note, created_by: ctx.profile.id,
        });
        if (error) throw new Error(errText(error));
        dataChanged('ingredient_purchases');
        toast('Stock received and ledger updated.');
        render(root, params, ctx);
      },
    });
  }

  function newPurchaseOrder() {
    if (!vendors.length) { toast('Add a vendor first.', 'warn'); return; }
    if (!ingredients.length) { toast('Add ingredients first.', 'warn'); return; }
    const lines = [{ ingredient_id: ingredients[0].id, qty: 1, unit_cost: Number(ingredients[0].cost_per_unit || 0) }];

    const body = `<form id="po-form" class="form-grid" novalidate>
      <div class="field"><label for="po_vendor">Vendor</label>
        <select id="po_vendor" name="vendor_id" required>
          <option value="">Choose…</option>
          ${vendors.map((v) => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('')}
        </select></div>
      <div class="field"><label for="po_ordered">Ordered on</label><input id="po_ordered" name="ordered_on" type="date" value="${today()}"></div>
      <div class="field"><label for="po_expected">Expected on</label><input id="po_expected" name="expected_on" type="date" value="${today()}"></div>
      <div class="field"><label for="po_notes">Notes</label><input id="po_notes" name="notes" type="text" placeholder="Delivery instructions"></div>
      <div class="field field--wide">
        <label>Lines</label>
        <div class="po-lines" id="po-lines"></div>
        <button class="btn btn--sm btn--ghost" type="button" id="po-add">${icon('plus', 15)} Add line</button>
      </div>
      <div class="field field--wide"><div class="availability" id="po-total"></div></div>
      <div class="form-error" role="alert" hidden></div>
    </form>`;

    openModal({
      title: 'New purchase order',
      body,
      wide: true,
      footer: `<button class="btn btn--ghost" data-close>Cancel</button>
        <button class="btn btn--primary" type="submit" form="po-form" data-save-po>${icon('clipboard', 16)} Create order</button>`,
      onOpen: (el, close) => {
        const form = el.querySelector('#po-form');
        const linesEl = el.querySelector('#po-lines');
        const totalEl = el.querySelector('#po-total');
        const err = el.querySelector('.form-error');

        function read() {
          [...linesEl.querySelectorAll('.po-line')].forEach((row, i) => {
            lines[i] = {
              ingredient_id: row.querySelector('[data-f="ingredient_id"]').value,
              qty: Number(row.querySelector('[data-f="qty"]').value || 0),
              unit_cost: Number(row.querySelector('[data-f="unit_cost"]').value || 0),
            };
          });
        }
        function draw() {
          linesEl.innerHTML = lines.map((l, i) => `<div class="po-line" data-i="${i}">
            <select data-f="ingredient_id">
              ${ingredients.map((ing) => `<option value="${esc(ing.id)}" ${ing.id === l.ingredient_id ? 'selected' : ''}>${esc(ing.name)} (${esc(ing.unit)})</option>`).join('')}
            </select>
            <input type="number" data-f="qty" min="0.01" step="any" value="${esc(l.qty)}" placeholder="Qty">
            <div class="input-prefix"><span>₦</span><input type="number" data-f="unit_cost" min="0" step="0.01" value="${esc(l.unit_cost)}"></div>
            <button class="icon-btn icon-btn--danger" type="button" data-rm="${i}" title="Remove">${icon('trash', 15)}</button>
          </div>`).join('');
          totalEl.innerHTML = `<div class="availability__head"><strong>Order total</strong><strong>${money(lines.reduce((s, l) => s + l.qty * l.unit_cost, 0))}</strong></div>`;
        }

        linesEl.addEventListener('change', (e) => {
          read();
          if (e.target.dataset.f === 'ingredient_id') {
            const ing = ingredients.find((x) => x.id === e.target.value);
            const i = Number(e.target.closest('.po-line').dataset.i);
            if (ing) lines[i].unit_cost = Number(ing.cost_per_unit || 0);
            draw();
          } else {
            totalEl.innerHTML = `<div class="availability__head"><strong>Order total</strong><strong>${money(lines.reduce((s, l) => s + l.qty * l.unit_cost, 0))}</strong></div>`;
          }
        });
        linesEl.addEventListener('input', (e) => {
          read();
          if (e.target.dataset.f === 'qty' || e.target.dataset.f === 'unit_cost') {
            totalEl.innerHTML = `<div class="availability__head"><strong>Order total</strong><strong>${money(lines.reduce((s, l) => s + l.qty * l.unit_cost, 0))}</strong></div>`;
          }
        });
        linesEl.addEventListener('click', (e) => {
          const rm = e.target.closest('[data-rm]');
          if (rm) { read(); lines.splice(Number(rm.dataset.rm), 1); draw(); }
        });
        el.querySelector('#po-add').addEventListener('click', () => {
          read();
          lines.push({ ingredient_id: ingredients[0].id, qty: 1, unit_cost: Number(ingredients[0].cost_per_unit || 0) });
          draw();
        });

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          err.hidden = true;
          read();
          const vendorId = form.elements.vendor_id.value;
          const valid = lines.filter((l) => l.ingredient_id && l.qty > 0);
          if (!vendorId) { err.textContent = 'Choose a vendor.'; err.hidden = false; return; }
          if (!valid.length) { err.textContent = 'Add at least one line with a quantity.'; err.hidden = false; return; }
          const btn = el.querySelector('[data-save-po]');
          setBusy(btn, true, 'Creating…');
          try {
            const { data: po, error } = await sb.from('purchase_orders').insert({
              vendor_id: vendorId, status: 'sent',
              ordered_on: form.elements.ordered_on?.value || today(),
              expected_on: form.elements.expected_on.value || null,
              notes: form.elements.notes.value.trim() || null,
              created_by: ctx.profile.id,
            }).select().single();
            if (error) throw new Error(errText(error));
            const { error: itemErr } = await sb.from('purchase_order_items').insert(valid.map((l) => ({
              purchase_order_id: po.id, ingredient_id: l.ingredient_id,
              qty: l.qty, unit_cost: l.unit_cost,
            })));
            if (itemErr) throw new Error(errText(itemErr));
            dataChanged('purchase_orders');
            toast('Purchase order created.');
            close();
            render(root, params, ctx);
          } catch (error) {
            err.textContent = error.message;
            err.hidden = false;
            setBusy(btn, false);
          }
        });
        draw();
      },
    });
  }

  function viewPO(id) {
    const po = orders.find((o) => o.id === id);
    if (!po) return;
    const items = itemsFor(id);
    openModal({
      title: `${po.po_no} · ${vendorMap.get(po.vendor_id)?.name || 'Vendor'}`,
      wide: true,
      body: `<div class="po-summary">
        <div><span>Status</span>${badge(titleCase(po.status), po.status === 'received' ? 'success' : 'warn')}</div>
        <div><span>Ordered</span><strong>${esc(fmtDate(po.ordered_on))}</strong></div>
        <div><span>Expected</span><strong>${esc(fmtDate(po.expected_on))}</strong></div>
        <div><span>Total</span><strong>${money(po.total)}</strong></div>
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Ingredient</th><th class="num">Qty</th><th class="num">Unit cost</th><th class="num">Line total</th></tr></thead>
        <tbody>${items.map((i) => `<tr>
          <td>${esc(ingredientMap.get(i.ingredient_id)?.name || '—')}</td>
          <td class="num">${num(i.qty, 2)} ${esc(ingredientMap.get(i.ingredient_id)?.unit || '')}</td>
          <td class="num">${money(i.unit_cost)}</td>
          <td class="num">${money(i.line_total)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      ${po.notes ? `<p class="prose">${esc(po.notes)}</p>` : ''}`,
      footer: `<button class="btn btn--ghost" data-close>Close</button>
        ${!['received', 'cancelled'].includes(po.status) ? `<button class="btn btn--primary" data-modal-receive>${icon('check', 16)} Mark received</button>` : ''}`,
      onOpen: (el, close) => {
        el.querySelector('[data-modal-receive]')?.addEventListener('click', () => { close(); receivePO(id); });
      },
    });
  }

  async function receivePO(id) {
    const po = orders.find((o) => o.id === id);
    const ok = await confirmDialog({
      title: `Receive ${po?.po_no || 'purchase order'}?`,
      message: 'Every line becomes a stock receipt. Ingredient quantities and costs update together. This cannot be undone.',
      confirmText: 'Receive stock',
    });
    if (!ok) return;
    const { error } = await sb.rpc('receive_purchase_order', { p_po: id });
    if (error) { toast(errText(error), 'error'); return; }
    dataChanged('purchase_orders');
    toast('Purchase order received. Stock is in.');
    render(root, params, ctx);
  }

  async function cancelPO(id) {
    const po = orders.find((o) => o.id === id);
    const ok = await confirmDialog({ title: `Cancel ${po?.po_no}?`, message: 'The order stays in history but can no longer be received.', confirmText: 'Cancel order', danger: true });
    if (!ok) return;
    const { error } = await sb.from('purchase_orders').update({ status: 'cancelled' }).eq('id', id);
    if (error) { toast(errText(error), 'error'); return; }
    dataChanged('purchase_orders');
    toast('Purchase order cancelled.');
    render(root, params, ctx);
  }

  function payVendor(vendorId, balance) {
    const v = vendorMap.get(vendorId);
    formModal({
      title: `Pay ${v?.name || 'vendor'}`,
      intro: `Outstanding balance ${money(balance)}.`,
      fields: [
        { name: 'amount', label: 'Amount', type: 'money', required: true, min: 0, default: Number(balance).toFixed(2) },
        { name: 'method', label: 'Method', type: 'select', options: PAYMENT_METHODS, required: true, default: 'transfer' },
        { name: 'paid_on', label: 'Paid on', type: 'date', required: true, default: today() },
        { name: 'note', label: 'Note', type: 'text', span: 2 },
      ],
      submitLabel: 'Record payment',
      onSubmit: async (data) => {
        const { error } = await sb.from('vendor_payments').insert({
          vendor_id: vendorId, amount: Number(data.amount), method: data.method,
          paid_on: data.paid_on, note: data.note, created_by: ctx.profile.id,
        });
        if (error) throw new Error(errText(error));
        dataChanged('vendor_payments');
        toast('Vendor payment recorded.');
        render(root, params, ctx);
      },
    });
  }

  draw();
}
