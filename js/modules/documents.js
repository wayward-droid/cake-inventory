// Documents: every quote, invoice and receipt issued from an order.
import { sb, errText } from '../supabase.js';
import {
  esc, money, num, fmtDate, titleCase, badge, icon, emptyState, spinner,
  table, exportModal, labelFor, today,
} from '../ui.js';
import { DOC_TYPES } from '../config.js';
import { printDoc } from './orders.js';

export async function render(root, _params, ctx) {
  root.innerHTML = `<div class="route-loading">${spinner('Opening the document file…')}</div>`;

  let documents = [];
  let orders = [];
  let customers = [];
  try {
    const [dRes, oRes, cRes] = await Promise.all([
      sb.from('documents').select('*').order('issued_on', { ascending: false }).order('created_at', { ascending: false }).limit(500),
      sb.from('orders').select('id,order_no,customer_id,total,amount_paid,status,delivery_date,fulfilment').is('deleted_at', null).limit(1000),
      sb.from('customers').select('id,name,phone,address,city,state').is('deleted_at', null).limit(1000),
    ]);
    for (const result of [dRes, oRes, cRes]) {
      if (result.error) throw new Error(errText(result.error));
    }
    documents = dRes.data || [];
    orders = oRes.data || [];
    customers = cRes.data || [];
  } catch (e) {
    root.innerHTML = `<div class="notice notice--danger">${icon('alert', 18)} ${esc(e.message)}</div>`;
    return;
  }

  const orderMap = new Map(orders.map((o) => [o.id, o]));
  const customerMap = new Map(customers.map((c) => [c.id, c]));
  const state = { type: '', search: '' };

  function orderFor(doc) {
    return doc.snapshot?.order || orderMap.get(doc.order_id) || null;
  }

  function customerFor(doc) {
    const order = orderFor(doc);
    return doc.snapshot?.customer || customerMap.get(order?.customer_id) || null;
  }

  function totalFor(doc) {
    return Number(doc.snapshot?.order?.total ?? orderFor(doc)?.total ?? 0);
  }

  function draw() {
    const filtered = documents
      .filter((doc) => !state.type || doc.doc_type === state.type)
      .filter((doc) => {
        if (!state.search) return true;
        const order = orderFor(doc);
        const customer = customerFor(doc);
        return [doc.doc_no, order?.order_no, customer?.name, customer?.phone]
          .some((value) => String(value || '').toLowerCase().includes(state.search.toLowerCase()));
      });

    const counts = DOC_TYPES.map((type) => ({
      ...type,
      count: documents.filter((doc) => doc.doc_type === type.value).length,
    }));
    const value = documents.reduce((sum, doc) => sum + totalFor(doc), 0);

    root.innerHTML = `
      <div class="page-head">
        <div>
          <p class="eyebrow">Sales</p>
          <h1>Documents</h1>
          <p class="page-sub">Quotes, invoices and receipts — ready to print or send.</p>
        </div>
        <div class="page-actions">
          <button class="btn btn--ghost" data-export>${icon('download', 17)} Export</button>
          <a class="btn btn--primary" href="#/orders">${icon('bag', 17)} Open orders</a>
        </div>
      </div>

      <div class="mini-stats">
        <div class="mini-stat mini-stat--berry">
          <span class="mini-stat__icon">${icon('file', 17)}</span>
          <span><small>Documents</small><strong>${num(documents.length)}</strong></span>
        </div>
        ${counts.map((count) => `<div class="mini-stat ${count.value === 'quote' ? 'mini-stat--purple' : count.value === 'invoice' ? 'mini-stat--caramel' : 'mini-stat--sage'}">
          <span class="mini-stat__icon">${icon(count.value === 'receipt' ? 'check' : 'file', 17)}</span>
          <span><small>${esc(count.label)}s</small><strong>${num(count.count)}</strong></span>
        </div>`).join('')}
        <div class="mini-stat mini-stat--cocoa">
          <span class="mini-stat__icon">${icon('wallet', 17)}</span>
          <span><small>Document value</small><strong>${money(value, { decimals: 0 })}</strong></span>
        </div>
      </div>

      <section class="card">
        <div class="toolbar">
          <div class="search-box">
            ${icon('search', 17)}
            <input type="search" placeholder="Search document, order or customer…" data-search value="${esc(state.search)}">
          </div>
          <div class="toolbar__filters">
            <select data-type-filter aria-label="Document type">
              <option value="">Type: all</option>
              ${DOC_TYPES.map((type) => `<option value="${type.value}" ${state.type === type.value ? 'selected' : ''}>${esc(type.label)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div id="documents-table"></div>
      </section>`;

    const tableEl = root.querySelector('#documents-table');
    tableEl.innerHTML = filtered.length ? table({
      columns: [
        {
          key: 'doc_no', label: 'Document',
          render: (doc) => `<div class="cell-main"><strong>${esc(doc.doc_no || 'Not numbered')}</strong><small>${esc(fmtDate(doc.issued_on))}</small></div>`,
        },
        {
          key: 'doc_type', label: 'Type',
          render: (doc) => badge(labelFor(DOC_TYPES, doc.doc_type), doc.doc_type === 'quote' ? 'purple' : doc.doc_type === 'invoice' ? 'info' : 'success'),
        },
        {
          key: 'order_id', label: 'Order',
          render: (doc) => {
            const order = orderFor(doc);
            return order ? `<a class="link" href="#/orders/${esc(order.id)}">${esc(order.order_no)}</a>` : '<span class="muted">Removed</span>';
          },
        },
        {
          key: 'customer', label: 'Customer',
          render: (doc) => {
            const customer = customerFor(doc);
            return `<div class="cell-main"><strong>${esc(customer?.name || 'Walk-in customer')}</strong><small>${esc(customer?.phone || '')}</small></div>`;
          },
        },
        {
          key: 'issued_on', label: 'Issued',
          render: (doc) => esc(fmtDate(doc.issued_on)),
        },
        {
          key: 'total', label: 'Total', className: 'num',
          render: (doc) => `<strong>${money(totalFor(doc))}</strong>`,
        },
        {
          key: 'actions', label: '',
          render: (doc) => `<div class="row-actions">
            <button class="btn btn--sm btn--ghost" data-print-doc="${esc(doc.id)}">${icon('print', 14)} Print</button>
            ${orderFor(doc) ? `<a class="btn btn--sm btn--ghost" href="#/orders/${esc(orderFor(doc).id)}">Open</a>` : ''}
          </div>`,
        },
      ],
      rows: filtered,
      rowKey: 'id',
      empty: 'No documents match this view.',
    }) : emptyState({
      iconName: 'file', title: 'No documents yet',
      text: 'Open an order and print or issue a quote, invoice or receipt to file it here.',
      action: '<a class="btn btn--primary" href="#/orders">Open orders</a>',
    });

    root.querySelector('[data-search]').addEventListener('change', (e) => {
      state.search = e.target.value.trim();
      draw();
    });
    root.querySelector('[data-type-filter]').addEventListener('change', (e) => {
      state.type = e.target.value;
      draw();
    });
    root.querySelectorAll('[data-print-doc]').forEach((button) => button.addEventListener('click', () => {
      const doc = documents.find((d) => d.id === button.dataset.printDoc);
      if (doc) printDoc(doc, orderFor(doc), customerFor(doc), null, null, ctx.settings);
    }));
    root.querySelector('[data-export]').addEventListener('click', () => {
      exportModal({
        title: 'Documents',
        filename: `documents-${today()}`,
        rows: filtered,
        columns: [
          { key: 'doc_no', label: 'Document' },
          { key: 'doc_type', label: 'Type', value: (doc) => labelFor(DOC_TYPES, doc.doc_type) },
          { key: 'issued_on', label: 'Issued', value: (doc) => fmtDate(doc.issued_on) },
          { key: 'order', label: 'Order', value: (doc) => orderFor(doc)?.order_no || '' },
          { key: 'customer', label: 'Customer', value: (doc) => customerFor(doc)?.name || 'Walk-in customer' },
          { key: 'total', label: 'Total', className: 'num', value: totalFor },
        ],
        meta: state.type ? `${labelFor(DOC_TYPES, state.type)} documents` : 'All document types',
      });
    });
  }

  draw();
}
