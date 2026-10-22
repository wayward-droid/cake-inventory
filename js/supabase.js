// ---------------------------------------------------------------------------
// One live Supabase client for the whole app.
// ---------------------------------------------------------------------------

import {
  SUPABASE_URL, SUPABASE_ANON_KEY, IS_CONFIGURED, CONFIG_ERROR,
} from './config.js';

export { IS_CONFIGURED, CONFIG_ERROR };

let client;
if (IS_CONFIGURED) {
  try {
    const mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    client = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch {
    client = new Proxy({}, {
      get() { throw new Error('Could not load the Supabase client. Check the internet connection and SUPABASE_URL in js/config.js.'); },
    });
  }
} else {
  // Fail with a clear setup message instead of pretending to have a database.
  client = new Proxy({}, {
    get() { throw new Error(CONFIG_ERROR); },
  });
}

export const sb = client;

/** Human-readable error string from a Supabase result. */
export function errText(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  return error.message || error.error_description || error.details || 'Something went wrong.';
}

/** Fetch every page of a query (used for small lookup tables only). */
export async function selectAll(table, columns = '*', pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + pageSize - 1);
    if (error) throw new Error(errText(error));
    out.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

/** Settings row, with sensible defaults if it has not loaded yet. */
let settingsCache = null;
export async function getSettings(force = false) {
  if (settingsCache && !force) return settingsCache;
  const { data, error } = await sb.from('settings').select('*').eq('id', true).maybeSingle();
  if (error) throw new Error(errText(error));
  settingsCache = data || {
    business_name: 'Cake Slice Factory',
    currency: 'NGN',
    currency_symbol: '₦',
    locale: 'en-NG',
    tax_rate: 0,
    tax_inclusive: false,
    tax_label: 'VAT',
    discount_limit_pct: 10,
    deposit_required_above: 0,
    allow_negative_stock: false,
  };
  return settingsCache;
}

export function clearSettingsCache() {
  settingsCache = null;
}

/** Broadcast that data changed so open views can refresh if they listen. */
export function dataChanged(table) {
  window.dispatchEvent(new CustomEvent('csf:data-changed', { detail: { table } }));
}

/** Full database export (owner backup). Returns { table: rows }. */
export async function exportEverything() {
  const tables = [
    'settings', 'profiles', 'vendors', 'ingredients', 'products', 'recipes',
    'customers', 'orders', 'order_items', 'payments', 'documents',
    'production_batches', 'stock_movements', 'ingredient_purchases', 'expenses',
    'audit_log', 'order_status_history', 'price_history', 'unit_conversions',
    'purchase_orders', 'purchase_order_items', 'vendor_payments', 'stock_takes',
    'stock_take_items', 'attachments', 'notifications',
  ];
  const out = {};
  for (const t of tables) {
    const { data, error } = await sb.from(t).select('*');
    if (error) throw new Error(`${t}: ${errText(error)}`);
    out[t] = data || [];
  }
  return out;
}
