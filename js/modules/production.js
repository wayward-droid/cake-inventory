// Production: bake batches, consume ingredients, record waste.
import { sb, errText, dataChanged } from '../supabase.js';
import {
  esc, money, num, fmtDate, fmtDateTime, titleCase, badge, icon, toast, openModal,
  confirmDialog, emptyState, spinner, table, today, addDays, setBusy,
} from '../ui.js';

export async function render(root, params, ctx) {
  const { settings } = ctx;
  root.innerHTML = `<div class="route-loading">${spinner('Loading the kitchen…')}</div>`;

  let batches = [], products = [], recipes = [], ingredients = [], due = [];
  try {
    const [bRes, pRes, rRes, iRes, dRes] = await Promise.all([
      sb.from('production_batches').select('*').order('created_at', { ascending: false }).limit(60),
      sb.from('products').select('*').is('deleted_at', null).order('name'),
      sb.from('recipes').select('*'),
      sb.from('ingredients').select('*').is('deleted_at', null).order('name'),
      sb.from('orders').select('*').is('deleted_at', null)
        .in('status', ['confirmed', 'in_production', 'ready'])
        .lte('delivery_date', addDays(7)).order('delivery_date', { ascending: true }),
    ]);
    for (const r of [bRes, pRes, rRes, iRes, dRes]) if (r.error) throw new Error(errText(r.error));
    batches = bRes.data || [];
    products = pRes.data || [];
    recipes = rRes.data || [];
    ingredients = iRes.data || [];
    due = dRes.data || [];
  } catch (e) {
    root.innerHTML = `<div class="notice notice--danger">${icon('alert', 18)} ${esc(e.message)}</div>`;
    return;
  }

  const productMap = new Map(products.map((p) => [p.id, p]));
  const ingredientMap = new Map(ingredients.map((i) => [i.id, i]));
  const canWrite = true;

  function recipeFor(productId) {
    return recipes.filter((r) => r.product_id === productId)
      .map((r) => ({ ...r, ingredient: ingredientMap.get(r.ingredient_id) }))
      .filter((r) => r.ingredient);
  }

  function draw() {
    const valued = batches.reduce((s, b) => {
      const p = productMap.get(b.product_id);
      return s + Number(b.qty_produced) * Number(p?.cost_price || 0);
    }, 0);
    const made = batches.reduce((s, b) => s + Number(b.qty_produced), 0);
    const openDue = due.filter((o) => o.status !== 'ready');

    root.innerHTML = `
      <div class="page-head">
        <div>
          <p class="eyebrow">Operations</p>
          <h1>Production</h1>
          <p class="page-sub">Bake a batch, draw down ingredients and see what is due next.</p>
        </div>
        <div class="page-actions">
          <button class="btn btn--ghost" data-waste>${icon('alert', 17)} Record waste</button>
          <button class="btn btn--primary" data-new-batch>${icon('plus', 17)} New batch</button>
        </div>
      </div>

      <div class="mini-stats">
        <div class="mini-stat mini-stat--berry">
          <span class="mini-stat__icon">${icon('oven', 17)}</span>
          <span><small>Batches logged</small><strong>${num(batches.length)}</strong></span>
        </div>
        <div class="mini-stat mini-stat--sage">
          <span class="mini-stat__icon">${icon('cake', 17)}</span>
          <span><small>Units baked</small><strong>${num(made)}</strong></span>
        </div>
        <div class="mini-stat mini-stat--cocoa">
          <span class="mini-stat__icon">${icon('wallet', 17)}</span>
          <span><small>Batch value</small><strong>${money(valued, { decimals: 0 })}</strong></span>
        </div>
        <div class="mini-stat mini-stat--caramel">
          <span class="mini-stat__icon">${icon('clock', 17)}</span>
          <span><small>Orders due</small><strong>${num(openDue.length)}</strong></span>
        </div>
      </div>

      <div class="production-layout">
        <div class="production-main">
          <section class="card">
            <div class="card-head card-head--pad">
              <div><h2>Recent batches</h2><p class="muted">Newest first · ingredients leave stock automatically</p></div>
              <button class="icon-btn" data-refresh title="Refresh">${icon('refresh', 17)}</button>
            </div>
            ${batches.length ? table({
              columns: [
                {
                  key: 'batch_no', label: 'Batch',
                  render: (b) => `<div class="cell-main"><strong>${esc(b.batch_no)}</strong><small>${esc(fmtDate(b.produced_on))}</small></div>`,
                },
                {
                  key: 'product_id', label: 'Product',
                  render: (b) => {
                    const p = productMap.get(b.product_id);
                    return `<div class="cell-main"><strong>${esc(p?.name || 'Removed product')}</strong><small>${esc(p?.size || p?.category || '')}</small></div>`;
                  },
                },
                { key: 'qty_produced', label: 'Qty', className: 'num', render: (b) => `<strong>${num(b.qty_produced, 2)}</strong>` },
                {
                  key: 'ingredients', label: 'Ingredients used',
                  render: (b) => {
                    const lines = recipeFor(b.product_id);
                    if (!lines.length) return '<span class="muted">No recipe</span>';
                    return `<span class="muted">${lines.length} ingredient${lines.length === 1 ? '' : 's'}</span>`;
                  },
                },
                { key: 'note', label: 'Note', render: (b) => esc(b.note || '—') },
                { key: 'created_at', label: 'Logged', render: (b) => `<span class="muted">${esc(fmtDateTime(b.created_at))}</span>` },
              ],
              rows: batches,
              empty: 'No batches yet. Bake your first batch to start tracking what goes into each cake.',
            }) : emptyState({ iconName: 'oven', title: 'The oven is cold', text: 'Log a batch to consume ingredients and add finished stock.', action: '<button class="btn btn--primary" data-new-batch>New batch</button>' })}
          </section>
        </div>

        <aside class="production-side">
          <section class="card card--pad">
            <div class="card-head"><div><h2>Orders due</h2><p class="muted">Next 7 days</p></div>${icon('clock', 18)}</div>
            ${due.length ? `<div class="due-list">${due.slice(0, 10).map((o) => `
              <a class="due-row" href="#/orders/${esc(o.id)}">
                <span class="due-row__date"><strong>${esc(fmtDate(o.delivery_date).slice(0, 6))}</strong><small>${esc(o.fulfilment)}</small></span>
                <span class="due-row__text"><strong>${esc(o.order_no)}</strong><small>${esc(titleCase(o.status))}</small></span>
                ${badge(o.status === 'in_production' ? 'Baking' : o.status === 'ready' ? 'Ready' : 'To start', o.status === 'ready' ? 'success' : o.status === 'in_production' ? 'warn' : 'info')}
              </a>`).join('')}</div>` : '<p class="muted">Nothing due in the next week.</p>'}
          </section>

          <section class="card card--pad">
            <div class="card-head"><div><h2>Quick actions</h2></div>${icon('sparkles', 18)}</div>
            <div class="stack">
              <button class="btn btn--ghost btn--block" data-waste>${icon('alert', 16)} Record waste or spoilage</button>
              <a class="btn btn--ghost btn--block" href="#/recipes">${icon('book', 16)} Review recipes</a>
              <a class="btn btn--ghost btn--block" href="#/ingredients">${icon('flour', 16)} Ingredient stock</a>
            </div>
          </section>

          ${!settings.allow_negative_stock ? `<div class="notice">${icon('alert', 16)} Negative stock is blocked. Tick the shortage override on a batch if you must bake ahead of a delivery.</div>` : ''}
        </aside>
      </div>`;

    root.querySelectorAll('[data-new-batch]').forEach((b) => b.addEventListener('click', newBatch));
    root.querySelector('[data-waste]')?.addEventListener('click', wasteModal);
    root.querySelector('[data-refresh]')?.addEventListener('click', () => render(root, params, ctx));
  }

  function newBatch() {
    const bakeable = products.filter((p) => recipeFor(p.id).length > 0 && p.status !== 'discontinued');
    if (!bakeable.length) {
      toast('Add a recipe to a product before baking a batch.', 'warn');
      return;
    }

    const body = `<form id="batch-form" class="form-grid" novalidate>
      <div class="field field--wide">
        <label for="b_product">Product</label>
        <select id="b_product" name="product_id" required>
          <option value="">Choose a product…</option>
          ${bakeable.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="b_qty">Quantity produced</label>
        <input id="b_qty" name="qty_produced" type="number" min="0.01" step="any" value="1" required>
      </div>
      <div class="field">
        <label for="b_date">Produced on</label>
        <input id="b_date" name="produced_on" type="date" value="${today()}" required>
      </div>
      <div class="field field--wide">
        <label for="b_note">Note</label>
        <input id="b_note" name="note" type="text" placeholder="e.g. Friday bake, extra for walk-ins">
      </div>
      <div class="field field--wide">
        <div class="availability" id="availability"></div>
      </div>
      <div class="field field--wide">
        <label class="switch-row" for="b_override">
          <input type="checkbox" id="b_override" name="override_shortage">
          <span class="switch"></span>
          <span>Override shortage (bake anyway)</span>
        </label>
        <small class="field__help">Use only when stock counts are known to be behind the shelf.</small>
      </div>
      <div class="form-error" role="alert" hidden></div>
    </form>`;

    openModal({
      title: 'New production batch',
      body,
      footer: `<button class="btn btn--ghost" data-close>Cancel</button>
        <button class="btn btn--primary" type="submit" form="batch-form" data-bake>${icon('oven', 16)} Bake batch</button>`,
      onOpen: (el, close) => {
        const form = el.querySelector('#batch-form');
        const productSel = el.querySelector('#b_product');
        const qtyInput = el.querySelector('#b_qty');
        const availability = el.querySelector('#availability');
        const err = el.querySelector('.form-error');

        function preview() {
          const p = products.find((x) => x.id === productSel.value);
          const qty = Number(qtyInput.value || 0);
          if (!p) { availability.innerHTML = '<p class="muted">Pick a product to see ingredient availability.</p>'; return; }
          const lines = recipeFor(p.id);
          const short = lines.filter((l) => Number(l.ingredient.stock_qty) < Number(l.qty) * qty);
          availability.innerHTML = `
            <div class="availability__head">
              <strong>Ingredients for ${num(qty, 2)} × ${esc(p.name)}</strong>
              ${short.length ? badge(`${short.length} short`, 'danger') : badge('All in stock', 'success')}
            </div>
            <div class="availability__rows">
              ${lines.map((l) => {
                const need = Number(l.qty) * qty;
                const have = Number(l.ingredient.stock_qty);
                const isShort = have < need;
                return `<div class="availability__row ${isShort ? 'is-short' : ''}">
                  <span>${esc(l.ingredient.name)}</span>
                  <span>${num(need, 2)} ${esc(l.ingredient.unit)}</span>
                  <span class="muted">${num(have, 2)} in stock</span>
                </div>`;
              }).join('')}
            </div>
            ${short.length && !el.querySelector('#b_override').checked
              ? `<p class="text-danger small">Short on ${short.map((l) => esc(l.ingredient.name)).join(', ')}. Tick the override to continue.</p>` : ''}`;
        }

        productSel.addEventListener('change', preview);
        qtyInput.addEventListener('input', preview);
        el.querySelector('#b_override').addEventListener('change', preview);
        preview();

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          err.hidden = true;
          const productId = productSel.value;
          const qty = Number(qtyInput.value);
          if (!productId || !qty || qty <= 0) { err.textContent = 'Choose a product and a quantity above zero.'; err.hidden = false; return; }
          const btn = el.querySelector('[data-bake]');
          setBusy(btn, true, 'Baking…');
          try {
            const { error } = await sb.from('production_batches').insert({
              product_id: productId,
              qty_produced: qty,
              produced_on: form.elements.produced_on.value || today(),
              note: form.elements.note.value.trim() || null,
              override_shortage: form.elements.override_shortage.checked,
              created_by: ctx.profile.id,
            });
            if (error) throw new Error(errText(error));
            dataChanged('production_batches');
            toast('Batch logged. Ingredients and finished stock updated.');
            close();
            render(root, params, ctx);
          } catch (error) {
            err.textContent = error.message;
            err.hidden = false;
            setBusy(btn, false);
          }
        });
      },
    });
  }

  function wasteModal() {
    const body = `<form id="waste-form" class="form-grid" novalidate>
      <div class="field">
        <label for="w_kind">What was wasted?</label>
        <select id="w_kind" name="kind">
          <option value="ingredient">Ingredient</option>
          <option value="product">Finished product</option>
        </select>
      </div>
      <div class="field">
        <label for="w_item">Item</label>
        <select id="w_item" name="item" required></select>
      </div>
      <div class="field">
        <label for="w_qty">Quantity lost</label>
        <input id="w_qty" name="qty" type="number" min="0.01" step="any" required>
      </div>
      <div class="field">
        <label for="w_note">What happened?</label>
        <input id="w_note" name="note" type="text" placeholder="Dropped, expired, overbaked…">
      </div>
      <div class="form-error" role="alert" hidden></div>
    </form>`;

    openModal({
      title: 'Record waste',
      body,
      footer: `<button class="btn btn--ghost" data-close>Cancel</button>
        <button class="btn btn--danger" type="submit" form="waste-form" data-save-waste>${icon('alert', 16)} Record waste</button>`,
      onOpen: (el, close) => {
        const form = el.querySelector('#waste-form');
        const kindSel = el.querySelector('#w_kind');
        const itemSel = el.querySelector('#w_item');
        const err = el.querySelector('.form-error');

        const fill = () => {
          const list = kindSel.value === 'ingredient' ? ingredients : products.filter((p) => p.track_stock !== false);
          itemSel.innerHTML = `<option value="">Choose…</option>${list.map((x) => `<option value="${esc(x.id)}">${esc(x.name)} (${num(x.stock_qty, 2)} ${esc(x.unit || '')})</option>`).join('')}`;
        };
        kindSel.addEventListener('change', fill);
        fill();

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          err.hidden = true;
          const qty = Number(form.elements.qty.value);
          const item = itemSel.value;
          if (!item || !qty || qty <= 0) { err.textContent = 'Choose an item and a quantity above zero.'; err.hidden = false; return; }
          const btn = el.querySelector('[data-save-waste]');
          setBusy(btn, true, 'Recording…');
          try {
            const { error } = await sb.rpc('adjust_stock', {
              p_ingredient: kindSel.value === 'ingredient' ? item : null,
              p_product: kindSel.value === 'product' ? item : null,
              p_qty: -Math.abs(qty),
              p_reason: 'wasted',
              p_note: form.elements.note.value.trim() || null,
            });
            if (error) throw new Error(errText(error));
            dataChanged('stock_movements');
            toast('Waste recorded in the stock ledger.');
            close();
            render(root, params, ctx);
          } catch (error) {
            err.textContent = error.message;
            err.hidden = false;
            setBusy(btn, false);
          }
        });
      },
    });
  }

  draw();
}
