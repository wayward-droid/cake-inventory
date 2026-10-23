// Recipes: bill of materials and cost roll-up.
import { sb, errText, dataChanged } from '../supabase.js';
import {
  esc, money, num, pct, badge, icon, toast, emptyState, spinner, confirmDialog, setBusy,
} from '../ui.js';

export async function render(root, params, ctx) {
  root.innerHTML = `<div class="route-loading">${spinner('Loading recipes…')}</div>`;

  let products = [];
  let ingredients = [];
  let recipes = [];
  let selectedId = params[0] || null;
  let search = '';

  async function load() {
    const [p, i, r] = await Promise.all([
      sb.from('products').select('*').is('deleted_at', null).order('name'),
      sb.from('ingredients').select('*').is('deleted_at', null).order('name'),
      sb.from('recipes').select('*'),
    ]);
    for (const x of [p, i, r]) if (x.error) throw new Error(errText(x.error));
    products = p.data || [];
    ingredients = i.data || [];
    recipes = r.data || [];
    if (!selectedId || !products.some((x) => x.id === selectedId)) selectedId = products[0]?.id || null;
  }

  try { await load(); } catch (e) {
    root.innerHTML = `<div class="notice notice--danger">${icon('alert', 18)} ${esc(e.message)}</div>`;
    return;
  }

  const ingMap = new Map(ingredients.map((i) => [i.id, i]));

  function linesFor(productId) {
    return recipes
      .filter((r) => r.product_id === productId)
      .map((r) => {
        const ing = ingMap.get(r.ingredient_id);
        return {
          ...r,
          ingredient: ing,
          lineCost: ing ? Number(r.qty) * Number(ing.cost_per_unit) : 0,
        };
      });
  }

  function recipeCost(productId) {
    return linesFor(productId).reduce((s, l) => s + l.lineCost, 0);
  }

  function draw() {
    const filtered = products.filter((p) =>
      !search || p.name.toLowerCase().includes(search.toLowerCase()));
    const selected = products.find((p) => p.id === selectedId);
    const lines = selected ? linesFor(selected.id) : [];
    const cost = selected ? recipeCost(selected.id) : 0;
    const price = Number(selected?.price || 0);
    const margin = price > 0 ? ((price - cost) / price) * 100 : null;
    const canWrite = ctx.isOwner;

    root.innerHTML = `
      <div class="page-head">
        <div>
          <p class="eyebrow">Inventory</p>
          <h1>Recipes</h1>
          <p class="page-sub">What one cake actually consumes — and what it actually costs to make.</p>
        </div>
        <div class="page-actions">
          ${canWrite && selected ? `<button class="btn btn--ghost" data-apply-cost>${icon('refresh', 17)} Apply cost to product</button>` : ''}
          <a class="btn btn--ghost" href="#/ingredients">${icon('flour', 17)} Ingredients</a>
        </div>
      </div>

      ${!products.length ? emptyState({
        iconName: 'cake', title: 'Add a product first',
        text: 'Recipes attach to a finished product. Create one, then come back to list its ingredients.',
        action: '<a class="btn btn--primary" href="#/products">Go to products</a>',
      }) : `
      <div class="recipe-layout">
        <aside class="card recipe-list">
          <div class="recipe-list__head">
            <div class="search-box search-box--small">${icon('search', 16)}
              <input type="search" placeholder="Find a product…" data-search value="${esc(search)}">
            </div>
          </div>
          <div class="recipe-list__items">
            ${filtered.map((p) => {
              const c = recipeCost(p.id);
              const n = linesFor(p.id).length;
              return `<button class="recipe-item ${p.id === selectedId ? 'is-active' : ''}" data-product="${esc(p.id)}">
                <span class="recipe-item__main"><strong>${esc(p.name)}</strong>
                  <small>${n ? `${n} ingredient${n === 1 ? '' : 's'} · ${money(c, { decimals: 0 })} cost` : 'No recipe yet'}</small></span>
                ${p.kind === 'custom' ? badge('Custom', 'purple') : ''}
              </button>`;
            }).join('') || '<p class="muted recipe-list__empty">No product matches.</p>'}
          </div>
        </aside>

        <section class="card card--pad recipe-detail">
          ${!selected ? emptyState({ title: 'Pick a product', iconName: 'book' }) : `
            <div class="recipe-head">
              <div>
                <div class="recipe-head__title"><h2>${esc(selected.name)}</h2>${selected.kind === 'custom' ? badge('Made to order', 'purple') : badge('Catalogue', 'info')}</div>
                <p class="muted">${esc([selected.sku, selected.size, selected.flavour].filter(Boolean).join(' · ') || 'No SKU or size set')}</p>
              </div>
              <div class="recipe-head__numbers">
                <div><span>Recipe cost</span><strong>${money(cost, { decimals: 0 })}</strong></div>
                <div><span>Product cost</span><strong>${money(selected.cost_price, { decimals: 0 })}</strong></div>
                <div><span>Selling price</span><strong>${money(selected.price, { decimals: 0 })}</strong></div>
              </div>
            </div>

            <div class="margin-strip ${margin == null ? '' : margin >= 40 ? 'is-good' : margin >= 20 ? 'is-ok' : 'is-low'}">
              <span>Gross margin at current ingredient costs</span>
              <strong>${margin == null ? 'Set a selling price' : `${pct(margin)} · ${money(price - cost, { decimals: 0 })} per ${esc(selected.unit)}`}</strong>
            </div>

            ${lines.length ? `<div class="table-wrap recipe-table">
              <table class="data-table">
                <thead><tr><th>Ingredient</th><th>Quantity</th><th>Cost / unit</th><th>Line cost</th><th></th></tr></thead>
                <tbody>${lines.map((l) => `
                  <tr>
                    <td><div class="cell-main"><strong>${esc(l.ingredient?.name || 'Missing ingredient')}</strong><small>${esc(l.ingredient?.category || '')}</small></div></td>
                    <td><div class="qty-edit">
                      <input type="number" min="0.001" step="any" value="${esc(l.qty)}" data-qty="${esc(l.id)}" ${canWrite ? '' : 'disabled'}>
                      <span>${esc(l.ingredient?.unit || '')}</span>
                    </div></td>
                    <td>${money(l.ingredient?.cost_per_unit, { decimals: 2 })}</td>
                    <td><strong>${money(l.lineCost, { decimals: 0 })}</strong></td>
                    <td class="td-actions">${canWrite ? `<button class="icon-btn icon-btn--danger" data-remove="${esc(l.id)}" title="Remove">${icon('trash', 15)}</button>` : ''}</td>
                  </tr>`).join('')}</tbody>
              </table>
            </div>` : emptyState({ iconName: 'book', title: 'No recipe yet', text: 'Add the ingredients one cake consumes. The cost rolls up automatically.' })}

            ${canWrite ? `<form class="recipe-add" id="recipe-add">
              <div class="field"><label for="ra_ing">Add ingredient</label>
                <select id="ra_ing" required>
                  <option value="">Choose an ingredient…</option>
                  ${ingredients.map((i) => `<option value="${esc(i.id)}">${esc(i.name)} (${esc(i.unit)})</option>`).join('')}
                </select></div>
              <div class="field"><label for="ra_qty">Quantity</label>
                <input id="ra_qty" type="number" min="0.001" step="any" placeholder="0.5" required></div>
              <button class="btn btn--primary" type="submit">${icon('plus', 16)} Add</button>
            </form>
            <div class="form-error" id="recipe-error" role="alert" hidden></div>` : `<div class="notice">${icon('lock', 16)} Read-only. Only the owner can edit recipes.</div>`}
          `}
        </section>
      </div>`}`;

    bind();
  }

  function bind() {
    root.querySelectorAll('[data-product]').forEach((btn) => {
      btn.onclick = () => {
        selectedId = btn.dataset.product;
        history.replaceState(null, '', `#/recipes/${selectedId}`);
        draw();
      };
    });
    const searchEl = root.querySelector('[data-search]');
    if (searchEl) {
      searchEl.oninput = () => { search = searchEl.value; draw(); root.querySelector('[data-search]')?.focus(); };
    }

    root.querySelectorAll('[data-qty]').forEach((input) => {
      input.onchange = async () => {
        const line = recipes.find((r) => r.id === input.dataset.qty);
        const qty = Number(input.value);
        if (!line || !qty || qty <= 0) { toast('Quantity must be greater than zero.', 'error'); draw(); return; }
        const { error } = await sb.from('recipes').update({ qty }).eq('id', line.id);
        if (error) { toast(errText(error), 'error'); draw(); return; }
        line.qty = qty;
        toast('Quantity updated. Apply cost to update the product.');
        draw();
      };
    });

    root.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.onclick = async () => {
        const ok = await confirmDialog({ title: 'Remove this ingredient?', message: 'The product cost will not change until you apply it again.', confirmText: 'Remove', danger: true });
        if (!ok) return;
        const { error } = await sb.from('recipes').delete().eq('id', btn.dataset.remove);
        if (error) { toast(errText(error), 'error'); return; }
        await load();
        draw();
      };
    });

    const add = root.querySelector('#recipe-add');
    if (add) {
      add.onsubmit = async (e) => {
        e.preventDefault();
        const err = root.querySelector('#recipe-error');
        err.hidden = true;
        const ingredientId = add.querySelector('#ra_ing').value;
        const qty = Number(add.querySelector('#ra_qty').value);
        if (!ingredientId || !qty) { err.textContent = 'Choose an ingredient and a quantity.'; err.hidden = false; return; }
        const btn = add.querySelector('button[type=submit]');
        setBusy(btn, true, 'Adding…');
        const { error } = await sb.from('recipes').insert({ product_id: selectedId, ingredient_id: ingredientId, qty });
        if (error) {
          err.textContent = err.message.includes('duplicate') ? 'That ingredient is already in this recipe — edit its quantity instead.' : errText(error);
          err.hidden = false;
          setBusy(btn, false);
          return;
        }
        dataChanged('recipes');
        await load();
        draw();
        toast('Ingredient added.');
      };
    }

    const apply = root.querySelector('[data-apply-cost]');
    if (apply) {
      apply.onclick = async () => {
        setBusy(apply, true, 'Applying…');
        const { data, error } = await sb.rpc('recalc_product_cost', { p_product: selectedId });
        if (error) { toast(errText(error), 'error'); setBusy(apply, false); return; }
        toast(`Product cost updated to ${money(data, { decimals: 0 })}.`);
        dataChanged('products');
        await load();
        draw();
      };
    }
  }

  draw();
}
