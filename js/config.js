// ---------------------------------------------------------------------------
// Public configuration.
//
// Set both values to your Supabase project's URL and anon public key. The anon
// key is public by design; Row Level Security protects the data. Never put a
// service-role key in this file.
// ---------------------------------------------------------------------------

export const SUPABASE_URL = 'https://dfganirnvmdgdcatcnkc.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_iaXjJqgM8EO2rcboc2CJ9w_kAeaiiaT';

export const IS_CONFIGURED = Boolean(SUPABASE_URL.trim() && SUPABASE_ANON_KEY.trim());

export const CONFIG_ERROR = 'Supabase is not configured. Add SUPABASE_URL and SUPABASE_ANON_KEY in js/config.js, then run supabase/schema.sql, supabase/002_core_additions.sql, supabase/003_owner_setup.sql and supabase/004_website_catalogue.sql before signing in.';

export const APP_NAME = 'Cake Slice Factory';
export const APP_TAGLINE = 'Baked fresh. Tracked properly.';

// Money is displayed with the Naira symbol; stored as numeric(14,2).
export const CURRENCY = '₦';
export const LOCALE = 'en-NG';

export const CHANNELS = [
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'website', label: 'Website' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'phone', label: 'Phone' },
  { value: 'other', label: 'Other' },
];

export const ORDER_STATUSES = [
  { value: 'quote', label: 'Quote', tone: 'muted' },
  { value: 'confirmed', label: 'Confirmed', tone: 'info' },
  { value: 'in_production', label: 'In production', tone: 'warn' },
  { value: 'ready', label: 'Ready', tone: 'ok' },
  { value: 'out_for_delivery', label: 'Out for delivery', tone: 'purple' },
  { value: 'completed', label: 'Completed', tone: 'success' },
  { value: 'cancelled', label: 'Cancelled', tone: 'danger' },
];

export const STATUS_FLOW = ['quote', 'confirmed', 'in_production', 'ready', 'out_for_delivery', 'completed'];

export const FULFILMENTS = [
  { value: 'pickup', label: 'Pick-up' },
  { value: 'delivery', label: 'Delivery' },
];

export const ORDER_KINDS = [
  { value: 'ready_made', label: 'Catalogue order' },
  { value: 'custom', label: 'Custom cake' },
];

export const PRODUCT_KINDS = [
  { value: 'ready_made', label: 'Catalogue item' },
  { value: 'custom', label: 'Custom / made to order' },
];

export const PRODUCT_CATEGORIES = [
  { value: 'Budget Cakes', label: 'Budget Cakes' },
  { value: 'Cake Slices', label: 'Cake Slices' },
  { value: 'Milk Cakes', label: 'Milk Cakes' },
  { value: 'Cake in a Jar', label: 'Cake in a Jar' },
  { value: 'Banana Bread', label: 'Banana Bread' },
  { value: 'Fruit Juice', label: 'Fruit Juice' },
];

export const EXPENSE_CATEGORIES = [
  { value: 'ingredients', label: 'Ingredients' },
  { value: 'logistics', label: 'Logistics' },
  { value: 'salaries', label: 'Salaries' },
  { value: 'rent', label: 'Rent' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'packaging', label: 'Packaging' },
  { value: 'other', label: 'Other' },
];

export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'transfer', label: 'Bank transfer' },
  { value: 'pos', label: 'POS' },
  { value: 'other', label: 'Other' },
];

export const DOC_TYPES = [
  { value: 'quote', label: 'Quote', prefix: 'QUO' },
  { value: 'invoice', label: 'Invoice', prefix: 'INV' },
  { value: 'receipt', label: 'Receipt', prefix: 'RCT' },
];

export const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'home' },
  { section: 'Sales' },
  { id: 'orders', label: 'Orders', icon: 'bag' },
  { id: 'quotes', label: 'Quotes', icon: 'file' },
  { id: 'payments', label: 'Payments', icon: 'card' },
  { id: 'documents', label: 'Documents', icon: 'file' },
  { id: 'customers', label: 'Customers', icon: 'users' },
  { section: 'Inventory' },
  { id: 'products', label: 'Products', icon: 'cake' },
  { id: 'ingredients', label: 'Ingredients', icon: 'flour' },
  { id: 'recipes', label: 'Recipes', icon: 'book' },
  { id: 'vendors', label: 'Vendors', icon: 'truck' },
  { section: 'Operations' },
  { id: 'production', label: 'Production', icon: 'oven' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'deliveries', label: 'Deliveries', icon: 'truck' },
  { id: 'purchases', label: 'Purchases', icon: 'box' },
  { id: 'expenses', label: 'Expenses', icon: 'wallet' },
  { section: 'Insights' },
  { id: 'reports', label: 'Reports', icon: 'chart' },
  { id: 'admin', label: 'Admin', icon: 'settings', ownerOnly: true },
];

export const LOW_STOCK_FALLBACK = 5;
