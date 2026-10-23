-- =====================================================================
--  CAKE SLICE FACTORY  --  001 base schema
--
--  Run FIRST in: Supabase Dashboard -> SQL Editor -> New query -> Run
--  Then run:     supabase/002_core_additions.sql
--  Then run:     supabase/003_owner_setup.sql
--
--  The database is the referee. Totals, stock movement, order numbers,
--  validation and permissions are enforced here, not in the browser.
--
--  Safe to re-run: tables/columns use IF NOT EXISTS and functions use
--  CREATE OR REPLACE. Views are dropped and recreated.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. ENUM TYPES
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('owner','staff');
  end if;
  if not exists (select 1 from pg_type where typname = 'order_channel') then
    create type public.order_channel as enum ('walk_in','website','instagram','whatsapp','phone','other');
  end if;
  if not exists (select 1 from pg_type where typname = 'fulfilment_type') then
    create type public.fulfilment_type as enum ('pickup','delivery');
  end if;
  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type public.order_status as enum
      ('quote','confirmed','in_production','ready','out_for_delivery','completed','cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'order_kind') then
    create type public.order_kind as enum ('ready_made','custom');
  end if;
  if not exists (select 1 from pg_type where typname = 'product_kind') then
    create type public.product_kind as enum ('ready_made','custom');
  end if;
  if not exists (select 1 from pg_type where typname = 'movement_reason') then
    create type public.movement_reason as enum
      ('purchase_received','used_in_production','produced','sold','wasted','adjustment','returned');
  end if;
  if not exists (select 1 from pg_type where typname = 'doc_type') then
    create type public.doc_type as enum ('quote','invoice','receipt');
  end if;
  if not exists (select 1 from pg_type where typname = 'expense_category') then
    create type public.expense_category as enum
      ('ingredients','logistics','salaries','rent','utilities','marketing','equipment','packaging','other');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. SETTINGS (single row) + PROFILES (users)
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id                   boolean primary key default true check (id),
  business_name        text    not null default 'Cake Slice Factory',
  currency             text    not null default 'NGN',
  currency_symbol      text    not null default '₦',
  locale               text    not null default 'en-NG',
  address              text,
  phone                text,
  email                text,
  logo_url             text,
  invoice_footer       text,
  tax_rate             numeric(6,3) not null default 0,
  tax_inclusive        boolean not null default false,
  tax_label            text    not null default 'VAT',
  default_low_stock    numeric(14,2) not null default 5,
  discount_limit_pct   numeric(6,2) not null default 10,
  deposit_required_above numeric(14,2) not null default 0,
  allow_negative_stock boolean not null default false,
  updated_at           timestamptz not null default now()
);

-- upgrade settings from earlier drafts
alter table public.settings add column if not exists logo_url text;
alter table public.settings add column if not exists invoice_footer text;
alter table public.settings add column if not exists tax_rate numeric(6,3) not null default 0;
alter table public.settings add column if not exists tax_inclusive boolean not null default false;
alter table public.settings add column if not exists tax_label text not null default 'VAT';
alter table public.settings add column if not exists discount_limit_pct numeric(6,2) not null default 10;
alter table public.settings add column if not exists deposit_required_above numeric(14,2) not null default 0;
alter table public.settings add column if not exists allow_negative_stock boolean not null default false;

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  phone       text,
  role        public.app_role not null default 'staff',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- auto-create a profile whenever a user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, phone)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.email),
          new.raw_user_meta_data->>'phone')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 3. PERMISSION HELPERS  (used by every RLS policy)
-- ---------------------------------------------------------------------
create or replace function public.my_role()
returns public.app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'owner', false)
$$;

create or replace function public.can_operate()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('owner','staff'), false)
$$;

-- Only usable from the SQL editor: promote the first account to owner.
create or replace function public.promote_to_owner(user_email text)
returns void language sql security definer set search_path = public as $$
  update public.profiles
     set role = 'owner', updated_at = now()
   where lower(email) = lower(user_email);
$$;
revoke execute on function public.promote_to_owner(text) from public, anon, authenticated;

-- First-run bootstrap: the first signed-in account can claim ownership once.
-- The function refuses as soon as any owner exists, so it cannot be used to
-- take over an established system.
create or replace function public.claim_owner()
returns public.app_role
language plpgsql security definer set search_path = public as $$
declare
  uid      uuid := auth.uid();
  existing integer;
begin
  if uid is null then
    raise exception 'Sign in before claiming owner access.';
  end if;

  -- Serialise simultaneous first-run claims. The local setting lets the role
  -- guard distinguish this checked bootstrap from a direct client self-update.
  perform pg_advisory_xact_lock(707001);
  perform set_config('csf.owner_bootstrap', uid::text, true);

  select count(*) into existing from public.profiles where role = 'owner';
  if existing > 0 then
    raise exception 'An owner account already exists. Ask the owner to promote you.';
  end if;

  update public.profiles
     set role = 'owner', active = true, updated_at = now()
   where id = uid and active;

  if not found then
    raise exception 'No active profile found for this account.';
  end if;

  return 'owner'::public.app_role;
end $$;
revoke execute on function public.claim_owner() from public, anon;
grant execute on function public.claim_owner() to authenticated;

-- ---------------------------------------------------------------------
-- 4. INVENTORY: vendors, ingredients, products, recipes
-- ---------------------------------------------------------------------
create table if not exists public.vendors (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  contact_person text,
  phone          text,
  email          text,
  address        text,
  supplies       text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create table if not exists public.ingredients (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category      text,
  unit          text not null default 'kg',
  cost_per_unit numeric(14,2) not null default 0 check (cost_per_unit >= 0),
  stock_qty     numeric(14,2) not null default 0,
  low_stock_at  numeric(14,2),
  vendor_id     uuid references public.vendors(id) on delete set null,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  sku           text,
  website_id    text,
  kind          public.product_kind not null default 'ready_made',
  category      text,
  flavour       text,
  size          text,
  unit          text not null default 'cake',
  price         numeric(14,2) not null default 0 check (price >= 0),
  cost_price    numeric(14,2) not null default 0 check (cost_price >= 0),
  stock_qty     numeric(14,2) not null default 0,
  low_stock_at  numeric(14,2),
  track_stock   boolean not null default true,
  image_url     text,
  description   text,
  status        text not null default 'active' check (status in ('active','draft','discontinued')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

-- ensure columns exist when upgrading from the first draft
alter table public.products add column if not exists flavour text;
alter table public.products add column if not exists size text;
alter table public.products add column if not exists website_id text;
alter table public.products add column if not exists status text not null default 'active';

create unique index if not exists uq_products_website_id
  on public.products(website_id);

create table if not exists public.recipes (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  qty           numeric(14,3) not null default 0 check (qty > 0),
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (product_id, ingredient_id)
);

-- ---------------------------------------------------------------------
-- 5. SALES: customers, orders, lines, payments, documents
-- ---------------------------------------------------------------------
create table if not exists public.customers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  phone         text,
  email         text,
  channel       public.order_channel default 'walk_in',
  address       text,
  city          text,
  state         text,
  notes         text,
  anonymized_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create table if not exists public.orders (
  id               uuid primary key default gen_random_uuid(),
  order_no         text unique,
  customer_id      uuid references public.customers(id) on delete set null,
  kind             public.order_kind not null default 'ready_made',
  channel          public.order_channel not null default 'walk_in',
  fulfilment       public.fulfilment_type not null default 'pickup',
  status           public.order_status not null default 'confirmed',
  delivery_address text,
  delivery_city    text,
  delivery_state   text,
  delivery_date    date,
  subtotal         numeric(14,2) not null default 0,
  discount         numeric(14,2) not null default 0 check (discount >= 0),
  discount_reason  text,
  discount_by      uuid references auth.users(id) on delete set null,
  delivery_fee     numeric(14,2) not null default 0 check (delivery_fee >= 0),
  tax_amount       numeric(14,2) not null default 0,
  total            numeric(14,2) not null default 0,
  amount_paid      numeric(14,2) not null default 0,
  custom_details   text,
  notes            text,
  rider_name       text,
  rider_phone      text,
  stock_deducted   boolean not null default false,
  stock_override   boolean not null default false,
  voided_at        timestamptz,
  void_reason      text,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

alter table public.orders add column if not exists tax_amount numeric(14,2) not null default 0;
alter table public.orders add column if not exists discount_reason text;
alter table public.orders add column if not exists discount_by uuid references auth.users(id) on delete set null;
alter table public.orders add column if not exists rider_name text;
alter table public.orders add column if not exists rider_phone text;
alter table public.orders add column if not exists stock_override boolean not null default false;
alter table public.orders add column if not exists voided_at timestamptz;
alter table public.orders add column if not exists void_reason text;
alter table public.orders add column if not exists deleted_at timestamptz;

create table if not exists public.order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  item_name  text not null,
  qty        numeric(14,2) not null default 1 check (qty > 0),
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0),
  unit_cost  numeric(14,2) not null default 0 check (unit_cost >= 0),
  line_total numeric(14,2) generated always as (round(qty * unit_price, 2)) stored
);

alter table public.order_items add column if not exists unit_cost numeric(14,2) not null default 0;

create table if not exists public.payments (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  amount     numeric(14,2) not null check (amount <> 0),
  method     text not null default 'cash' check (method in ('cash','transfer','pos','other')),
  paid_on    date not null default current_date,
  note       text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.payments add column if not exists deleted_at timestamptz;

create table if not exists public.documents (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  doc_type   public.doc_type not null,
  doc_no     text unique,
  issued_on  date not null default current_date,
  snapshot   jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_documents_order_type
  on public.documents(order_id, doc_type);

-- ---------------------------------------------------------------------
-- 6. PRODUCTION, STOCK LEDGER, PURCHASES, EXPENSES
-- ---------------------------------------------------------------------
create table if not exists public.production_batches (
  id                uuid primary key default gen_random_uuid(),
  batch_no          text unique,
  product_id        uuid not null references public.products(id) on delete cascade,
  qty_produced      numeric(14,2) not null default 0 check (qty_produced > 0),
  produced_on       date not null default current_date,
  note              text,
  override_shortage boolean not null default false,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now()
);

alter table public.production_batches add column if not exists override_shortage boolean not null default false;

create table if not exists public.stock_movements (
  id            uuid primary key default gen_random_uuid(),
  ingredient_id uuid references public.ingredients(id) on delete cascade,
  product_id    uuid references public.products(id) on delete cascade,
  change_qty    numeric(14,2) not null check (change_qty <> 0),
  reason        public.movement_reason not null,
  reference     text,
  note          text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  check ((ingredient_id is not null) <> (product_id is not null))
);

create table if not exists public.ingredient_purchases (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid references public.vendors(id) on delete set null,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  qty           numeric(14,2) not null default 0 check (qty > 0),
  unit          text,
  unit_cost     numeric(14,2) not null default 0 check (unit_cost >= 0),
  purchased_on  date not null default current_date,
  note          text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

alter table public.ingredient_purchases add column if not exists unit text;
alter table public.ingredient_purchases add column if not exists deleted_at timestamptz;

create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  category    public.expense_category not null default 'other',
  vendor_id   uuid references public.vendors(id) on delete set null,
  order_id    uuid references public.orders(id) on delete set null,
  description text not null,
  amount      numeric(14,2) not null check (amount > 0),
  spent_on    date not null default current_date,
  paid_via    text default 'cash',
  note        text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

alter table public.expenses add column if not exists deleted_at timestamptz;

-- ---------------------------------------------------------------------
-- 7. INDEXES
-- ---------------------------------------------------------------------
create index if not exists idx_ingredients_vendor   on public.ingredients(vendor_id);
create index if not exists idx_ingredients_live     on public.ingredients(deleted_at) where deleted_at is null;
create index if not exists idx_products_live        on public.products(deleted_at) where deleted_at is null;
create index if not exists idx_products_sku         on public.products(sku);
create index if not exists idx_recipes_product      on public.recipes(product_id);
create index if not exists idx_recipes_ingredient   on public.recipes(ingredient_id);
create index if not exists idx_customers_phone      on public.customers(phone);
create index if not exists idx_customers_live       on public.customers(deleted_at) where deleted_at is null;
create index if not exists idx_orders_customer      on public.orders(customer_id);
create index if not exists idx_orders_status        on public.orders(status);
create index if not exists idx_orders_created       on public.orders(created_at desc);
create index if not exists idx_orders_due           on public.orders(delivery_date);
create index if not exists idx_orders_live          on public.orders(deleted_at) where deleted_at is null;
create index if not exists idx_order_items_order    on public.order_items(order_id);
create index if not exists idx_payments_order       on public.payments(order_id);
create index if not exists idx_payments_date        on public.payments(paid_on);
create index if not exists idx_documents_order      on public.documents(order_id);
create index if not exists idx_movements_ingredient on public.stock_movements(ingredient_id);
create index if not exists idx_movements_product    on public.stock_movements(product_id);
create index if not exists idx_movements_created    on public.stock_movements(created_at desc);
create index if not exists idx_purchases_ingredient on public.ingredient_purchases(ingredient_id);
create index if not exists idx_purchases_date       on public.ingredient_purchases(purchased_on);
create index if not exists idx_expenses_date        on public.expenses(spent_on);
create index if not exists idx_expenses_category    on public.expenses(category);

-- A customer is unique by normalised phone (BR-19).
create unique index if not exists uq_customers_phone_live
  on public.customers (regexp_replace(coalesce(phone,''), '\D', '', 'g'))
  where phone is not null and btrim(phone) <> '' and deleted_at is null;

-- ---------------------------------------------------------------------
-- 8. COMMON TRIGGERS
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['settings','profiles','vendors','ingredients','products',
                           'recipes','customers','orders']
  loop
    execute format('drop trigger if exists trg_touch on public.%I', t);
    execute format('create trigger trg_touch before update on public.%I
                    for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- human-readable numbers ------------------------------------------------
create sequence if not exists public.order_no_seq start 1001;
create or replace function public.set_order_no()
returns trigger language plpgsql as $$
begin
  if new.order_no is null then
    new.order_no := 'ORD-' || lpad(nextval('public.order_no_seq')::text, 5, '0');
  end if;
  return new;
end $$;
drop trigger if exists trg_order_no on public.orders;
create trigger trg_order_no before insert on public.orders
  for each row execute function public.set_order_no();

create sequence if not exists public.doc_no_seq start 1001;
create or replace function public.set_doc_no()
returns trigger language plpgsql as $$
declare prefix text;
begin
  prefix := case new.doc_type when 'quote' then 'QUO'
                              when 'invoice' then 'INV'
                              when 'receipt' then 'RCT' end;
  if new.doc_no is null then
    new.doc_no := prefix || '-' || lpad(nextval('public.doc_no_seq')::text, 5, '0');
  end if;
  return new;
end $$;
drop trigger if exists trg_doc_no on public.documents;
create trigger trg_doc_no before insert on public.documents
  for each row execute function public.set_doc_no();

create sequence if not exists public.batch_no_seq start 1001;
create or replace function public.set_batch_no()
returns trigger language plpgsql as $$
begin
  if new.batch_no is null then
    new.batch_no := 'BAT-' || lpad(nextval('public.batch_no_seq')::text, 5, '0');
  end if;
  return new;
end $$;
drop trigger if exists trg_batch_no on public.production_batches;
create trigger trg_batch_no before insert on public.production_batches
  for each row execute function public.set_batch_no();

-- ---------------------------------------------------------------------
-- 9. ORDER MONEY RULES  (BR-14, BR-15, BR-20)
-- ---------------------------------------------------------------------
create or replace function public.recalc_order_subtotal()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  oid   uuid := coalesce(new.order_id, old.order_id);
  o     public.orders;
begin
  select * into o from public.orders where id = oid;
  if o.id is null then return null; end if;

  -- Never silently change the lines of an order whose stock is already out.
  if o.stock_deducted then
    raise exception 'Items cannot be changed after stock has been deducted for order %', o.order_no;
  end if;

  update public.orders
     set subtotal = coalesce((select sum(line_total) from public.order_items where order_id = oid), 0)
   where id = oid;
  return null;
end $$;
drop trigger if exists trg_recalc_subtotal on public.order_items;
create trigger trg_recalc_subtotal after insert or update or delete on public.order_items
  for each row execute function public.recalc_order_subtotal();

-- total = subtotal - discount + delivery_fee + tax
create or replace function public.recalc_order_total()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s            public.settings;
  base         numeric(14,2);
  v_rate       numeric(6,3);
begin
  select * into s from public.settings where id = true;
  v_rate := coalesce(s.tax_rate, 0);

  base := round(coalesce(new.subtotal,0) - coalesce(new.discount,0) + coalesce(new.delivery_fee,0), 2);

  if v_rate > 0 then
    if coalesce(s.tax_inclusive, false) then
      new.tax_amount := round(base * v_rate / (100 + v_rate), 2);
      new.total := base;
    else
      new.tax_amount := round(base * v_rate / 100, 2);
      new.total := base + new.tax_amount;
    end if;
  else
    new.tax_amount := 0;
    new.total := base;
  end if;

  return new;
end $$;
drop trigger if exists trg_order_total on public.orders;
create trigger trg_order_total before insert or update on public.orders
  for each row execute function public.recalc_order_total();

-- amount_paid is always the sum of live payments (BR-15)
create or replace function public.sync_amount_paid()
returns trigger language plpgsql security definer set search_path = public as $$
declare oid uuid := coalesce(new.order_id, old.order_id);
begin
  update public.orders
     set amount_paid = coalesce((select sum(amount) from public.payments
                                  where order_id = oid and deleted_at is null), 0)
   where id = oid;
  return null;
end $$;
drop trigger if exists trg_sync_paid on public.payments;
create trigger trg_sync_paid after insert or update or delete on public.payments
  for each row execute function public.sync_amount_paid();

-- Validate the order shape and money rules (BR-01..03, BR-11..14)
create or replace function public.validate_order()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s        public.settings;
  v_limit  numeric(14,2);
  v_actor  uuid := auth.uid();
begin
  select * into s from public.settings where id = true;

  if new.customer_id is null then
    raise exception 'An order must have a customer (BR-01)';
  end if;

  if new.fulfilment = 'delivery'
     and new.status <> 'quote'
     and coalesce(btrim(new.delivery_address), '') = '' then
    raise exception 'A delivery order requires a delivery address (BR-02)';
  end if;

  if new.status <> 'quote' and new.delivery_date is null then
    raise exception 'A delivery or pick-up date is required (BR-03)';
  end if;

  if new.discount > 0 and coalesce(btrim(new.discount_reason), '') = '' then
    raise exception 'A discount requires a reason (A5)';
  end if;

  -- Staff discount cap. SQL-console/system writes have no auth.uid().
  if v_actor is not null and not public.is_owner() and new.discount > 0 then
    v_limit := round(coalesce(new.subtotal,0) * coalesce(s.discount_limit_pct, 0) / 100, 2);
    if new.discount > v_limit then
      raise exception 'Discount above the %%% staff limit needs an owner (BR-12)', s.discount_limit_pct;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.status = 'completed'
       and not exists (select 1 from public.order_items where order_id = new.id) then
      raise exception 'An order needs at least one line item before it can be completed (BR-01)';
    end if;
    if old.status = 'completed' and new.status = 'cancelled'
       and v_actor is not null and not public.is_owner() then
      raise exception 'Only an owner can cancel a completed order (BR-11)';
    end if;
    if new.deleted_at is not null and old.deleted_at is null
       and v_actor is not null and not public.is_owner() then
      raise exception 'Only an owner can delete an order (BR-11)';
    end if;
    if old.stock_deducted and new.status not in ('completed','cancelled') then
      raise exception 'A completed order must be cancelled before changing its status';
    end if;
  end if;

  -- discount attribution
  if new.discount > 0 then
    new.discount_by := coalesce(new.discount_by, v_actor);
  end if;

  return new;
end $$;
drop trigger if exists trg_validate_order on public.orders;
create trigger trg_validate_order before insert or update on public.orders
  for each row execute function public.validate_order();

-- ---------------------------------------------------------------------
-- 10. STOCK RULES
-- ---------------------------------------------------------------------

-- 10a. Items received -> ingredient stock up, cost refresh, ledger row
create or replace function public.on_ingredient_purchase()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.ingredients
     set stock_qty     = stock_qty + new.qty,
         cost_per_unit = case when new.unit_cost > 0 then new.unit_cost else cost_per_unit end,
         updated_at    = now()
   where id = new.ingredient_id;

  insert into public.stock_movements (ingredient_id, change_qty, reason, reference, note, created_by)
  values (new.ingredient_id, new.qty, 'purchase_received',
          'PUR-' || left(new.id::text, 8),
          coalesce('Received ' || new.qty || ' ' || coalesce(new.unit, ''), 'Items received'),
          coalesce(new.created_by, auth.uid()));
  return new;
end $$;
drop trigger if exists trg_ingredient_purchase on public.ingredient_purchases;
create trigger trg_ingredient_purchase after insert on public.ingredient_purchases
  for each row execute function public.on_ingredient_purchase();

-- 10b. Production -> block/warn shortage, consume recipe, add finished stock
create or replace function public.check_production_shortage()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r        record;
  avail    numeric(14,2);
  needed   numeric(14,2);
  allowneg boolean;
begin
  select coalesce(allow_negative_stock, false) into allowneg from public.settings where id = true;

  if new.override_shortage or allowneg then
    return new;
  end if;

  for r in
    select rc.ingredient_id, rc.qty, i.name, i.unit, i.stock_qty
      from public.recipes rc
      join public.ingredients i on i.id = rc.ingredient_id
     where rc.product_id = new.product_id
  loop
    needed := r.qty * new.qty_produced;
    if r.stock_qty < needed then
      raise exception 'Not enough %: need % %, have % %. Tick the override to continue.',
        r.name, round(needed,2), r.unit, round(r.stock_qty,2), r.unit;
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists trg_production_shortage on public.production_batches;
create trigger trg_production_shortage before insert on public.production_batches
  for each row execute function public.check_production_shortage();

create or replace function public.on_production_batch()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select ingredient_id, qty from public.recipes where product_id = new.product_id loop
    update public.ingredients
       set stock_qty = stock_qty - (r.qty * new.qty_produced), updated_at = now()
     where id = r.ingredient_id;

    insert into public.stock_movements (ingredient_id, change_qty, reason, reference, note, created_by)
    values (r.ingredient_id, -(r.qty * new.qty_produced), 'used_in_production',
            new.batch_no, 'Used to bake ' || new.qty_produced || ' unit(s)', new.created_by);
  end loop;

  update public.products
     set stock_qty = stock_qty + new.qty_produced, updated_at = now()
   where id = new.product_id and track_stock = true;

  insert into public.stock_movements (product_id, change_qty, reason, reference, note, created_by)
  values (new.product_id, new.qty_produced, 'produced', new.batch_no,
          'Produced ' || new.qty_produced, new.created_by);
  return new;
end $$;
drop trigger if exists trg_production_batch on public.production_batches;
create trigger trg_production_batch after insert on public.production_batches
  for each row execute function public.on_production_batch();

-- 10c. Complete order -> deduct finished stock exactly once (BR-04, BR-09)
create or replace function public.on_order_completed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  it       record;
  allowneg boolean;
  cur_qty  numeric(14,2);
begin
  if new.status = 'completed' and coalesce(old.stock_deducted, false) = false then
    select coalesce(allow_negative_stock,false) into allowneg from public.settings where id = true;

    for it in
      select oi.product_id, oi.qty, p.name, p.stock_qty
        from public.order_items oi
        join public.products p on p.id = oi.product_id
       where oi.order_id = new.id and p.track_stock = true
    loop
      if it.stock_qty < it.qty and not allowneg and not coalesce(new.stock_override,false) then
        raise exception 'Not enough stock for %: need %, have %. Tick the stock override to continue.',
          it.name, it.qty, it.stock_qty;
      end if;

      update public.products
         set stock_qty = stock_qty - it.qty, updated_at = now()
       where id = it.product_id;

      insert into public.stock_movements (product_id, change_qty, reason, reference, note, created_by)
      values (it.product_id, -it.qty, 'sold', new.order_no,
              'Sold on order ' || new.order_no, auth.uid());
    end loop;

    new.stock_deducted := true;
  end if;
  return new;
end $$;
drop trigger if exists trg_order_completed on public.orders;
create trigger trg_order_completed before update on public.orders
  for each row execute function public.on_order_completed();

-- 10d. Cancel -> return stock exactly once (BR-05)
create or replace function public.reverse_order_stock()
returns trigger language plpgsql security definer set search_path = public as $$
declare it record;
begin
  if new.status = 'cancelled'
     and old.status <> 'cancelled'
     and coalesce(old.stock_deducted, false) = true then

    for it in
      select oi.product_id, oi.qty
        from public.order_items oi
        join public.products p on p.id = oi.product_id
       where oi.order_id = new.id and p.track_stock = true
    loop
      update public.products
         set stock_qty = stock_qty + it.qty, updated_at = now()
       where id = it.product_id;

      insert into public.stock_movements (product_id, change_qty, reason, reference, note, created_by)
      values (it.product_id, it.qty, 'returned', new.order_no,
              'Cancelled order ' || new.order_no, auth.uid());
    end loop;

    new.stock_deducted := false;
    new.voided_at := coalesce(new.voided_at, now());
    new.void_reason := coalesce(new.void_reason, 'Cancelled');
  end if;
  return new;
end $$;
drop trigger if exists trg_order_reverse on public.orders;
create trigger trg_order_reverse before update on public.orders
  for each row execute function public.reverse_order_stock();

-- 10e. Stock adjustment helper (waste, corrections)
create or replace function public.adjust_stock(
  p_ingredient uuid,
  p_product    uuid,
  p_qty        numeric,
  p_reason     public.movement_reason,
  p_note       text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.can_operate() then
    raise exception 'Not permitted';
  end if;
  if p_qty = 0 then raise exception 'Quantity cannot be zero'; end if;
  if (p_ingredient is not null) = (p_product is not null) then
    raise exception 'Provide exactly one of ingredient or product';
  end if;

  if p_ingredient is not null then
    update public.ingredients set stock_qty = stock_qty + p_qty, updated_at = now()
     where id = p_ingredient;
    insert into public.stock_movements (ingredient_id, change_qty, reason, note, created_by)
    values (p_ingredient, p_qty, p_reason, p_note, auth.uid());
  else
    update public.products set stock_qty = stock_qty + p_qty, updated_at = now()
     where id = p_product;
    insert into public.stock_movements (product_id, change_qty, reason, note, created_by)
    values (p_product, p_qty, p_reason, p_note, auth.uid());
  end if;
end $$;
revoke execute on function public.adjust_stock(uuid,uuid,numeric,public.movement_reason,text) from public, anon;
grant  execute on function public.adjust_stock(uuid,uuid,numeric,public.movement_reason,text) to authenticated;

-- ---------------------------------------------------------------------
-- 11. ATOMIC ORDER CREATION
--     All-or-nothing order + items, with cost snapshots for COGS.
-- ---------------------------------------------------------------------
create or replace function public.create_order(
  p_customer        uuid,
  p_kind            public.order_kind,
  p_channel         public.order_channel,
  p_fulfilment      public.fulfilment_type,
  p_delivery_address text default null,
  p_delivery_city    text default null,
  p_delivery_state   text default null,
  p_delivery_date    date default null,
  p_discount         numeric default 0,
  p_discount_reason  text default null,
  p_delivery_fee     numeric default 0,
  p_custom_details   text default null,
  p_notes            text default null,
  p_items            jsonb default '[]'::jsonb
) returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  o     public.orders;
  it    jsonb;
  pid   uuid;
  cost  numeric(14,2);
begin
  if auth.uid() is not null and not public.can_operate() then
    raise exception 'Not permitted';
  end if;

  -- Insert with no discount first: the line items do not exist yet, so the
  -- staff discount cap cannot be evaluated at this point.
  insert into public.orders (
    customer_id, kind, channel, fulfilment, status,
    delivery_address, delivery_city, delivery_state, delivery_date,
    discount, discount_reason, delivery_fee, custom_details, notes, created_by
  ) values (
    p_customer, p_kind, p_channel, p_fulfilment, 'confirmed',
    p_delivery_address, p_delivery_city, p_delivery_state, p_delivery_date,
    0, null, coalesce(p_delivery_fee,0),
    p_custom_details, p_notes, auth.uid()
  ) returning * into o;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    pid := nullif(it->>'product_id', '')::uuid;
    cost := nullif(it->>'unit_cost', '')::numeric;
    if cost is null and pid is not null then
      select cost_price into cost from public.products where id = pid;
    end if;

    insert into public.order_items (order_id, product_id, item_name, qty, unit_price, unit_cost)
    values (o.id, pid, coalesce(it->>'item_name','Item'),
            coalesce((it->>'qty')::numeric, 1),
            coalesce((it->>'unit_price')::numeric, 0),
            coalesce(cost, 0));
  end loop;

  -- Apply the discount after the subtotal exists so the cap is checked correctly.
  if coalesce(p_discount, 0) > 0 then
    update public.orders
       set discount = p_discount,
           discount_reason = p_discount_reason,
           discount_by = auth.uid()
     where id = o.id;
  end if;

  select * into o from public.orders where id = o.id;
  return o;
end $$;
revoke execute on function public.create_order(uuid,public.order_kind,public.order_channel,public.fulfilment_type,text,text,text,date,numeric,text,numeric,text,text,jsonb) from public, anon;
grant  execute on function public.create_order(uuid,public.order_kind,public.order_channel,public.fulfilment_type,text,text,text,date,numeric,text,numeric,text,text,jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 12. IMMUTABLE DOCUMENT SNAPSHOTS
-- ---------------------------------------------------------------------
create or replace function public.issue_document(
  p_order    uuid,
  p_doc_type public.doc_type
) returns public.documents
language plpgsql security definer set search_path = public as $$
declare
  o    public.orders;
  c    public.customers;
  s    public.settings;
  d    public.documents;
  snap jsonb;
begin
  if auth.uid() is not null and not public.can_operate() then
    raise exception 'Not permitted';
  end if;

  select * into d from public.documents where order_id = p_order and doc_type = p_doc_type;
  if d.id is not null then return d; end if;

  select * into o from public.orders where id = p_order;
  if o.id is null then raise exception 'Order not found'; end if;
  select * into c from public.customers where id = o.customer_id;
  select * into s from public.settings where id = true;

  snap := jsonb_build_object(
    'order',     to_jsonb(o),
    'customer',  to_jsonb(c),
    'items',     coalesce((select jsonb_agg(to_jsonb(oi) order by oi.id)
                             from public.order_items oi where oi.order_id = o.id), '[]'::jsonb),
    'payments',  coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at)
                             from public.payments p where p.order_id = o.id and p.deleted_at is null), '[]'::jsonb),
    'settings',  to_jsonb(s),
    'issued_at', now()
  );

  insert into public.documents (order_id, doc_type, snapshot, created_by)
  values (p_order, p_doc_type, snap, auth.uid())
  returning * into d;

  return d;
end $$;
revoke execute on function public.issue_document(uuid,public.doc_type) from public, anon;
grant  execute on function public.issue_document(uuid,public.doc_type) to authenticated;

-- ---------------------------------------------------------------------
-- 13. REPORTING VIEWS  (security_invoker keeps RLS in force)
-- ---------------------------------------------------------------------
drop view if exists public.v_stock_alerts;
create view public.v_stock_alerts with (security_invoker = true) as
  select 'product'::text as kind, p.id, p.name, p.unit, p.stock_qty,
         coalesce(p.low_stock_at, 5) as low_stock_at,
         greatest(coalesce(p.low_stock_at, 5) - p.stock_qty, 0) as shortfall
    from public.products p
   where p.deleted_at is null and p.track_stock = true
     and p.stock_qty <= coalesce(p.low_stock_at, 5)
  union all
  select 'ingredient'::text, i.id, i.name, i.unit, i.stock_qty,
         coalesce(i.low_stock_at, 5),
         greatest(coalesce(i.low_stock_at, 5) - i.stock_qty, 0)
    from public.ingredients i
   where i.deleted_at is null
     and i.stock_qty <= coalesce(i.low_stock_at, 5);

drop view if exists public.v_product_sales;
create view public.v_product_sales with (security_invoker = true) as
  select o.id as order_id, o.created_at::date as order_date,
         oi.product_id, oi.item_name as product_name,
         p.category, p.kind,
         sum(oi.qty) as qty_sold,
         sum(oi.line_total) as revenue,
         sum(oi.qty * oi.unit_cost) as cost,
         sum(oi.line_total) - sum(oi.qty * oi.unit_cost) as margin
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    left join public.products p on p.id = oi.product_id
   where o.status = 'completed' and o.deleted_at is null
   group by o.id, o.created_at::date, oi.product_id, oi.item_name, p.category, p.kind;

drop view if exists public.v_top_customers;
create view public.v_top_customers with (security_invoker = true) as
  select c.id, c.name, c.phone, c.city, c.state, c.channel,
         count(o.id) as orders,
         coalesce(sum(o.total), 0) as spent
    from public.customers c
    left join public.orders o
      on o.customer_id = c.id and o.status = 'completed' and o.deleted_at is null
   where c.deleted_at is null
   group by c.id, c.name, c.phone, c.city, c.state, c.channel;

drop view if exists public.v_top_locations;
create view public.v_top_locations with (security_invoker = true) as
  select coalesce(nullif(btrim(c.state), ''), 'Unspecified') as state,
         coalesce(nullif(btrim(c.city),  ''), 'Unspecified') as city,
         count(o.id) as orders,
         coalesce(sum(o.total), 0) as revenue
    from public.orders o
    join public.customers c on c.id = o.customer_id
   where o.status = 'completed' and o.deleted_at is null
   group by 1, 2;

drop view if exists public.v_ingredient_restock;
create view public.v_ingredient_restock with (security_invoker = true) as
  select i.id, i.name, i.unit,
         coalesce(sum(ip.qty), 0) as qty_restocked,
         coalesce(sum(ip.qty * ip.unit_cost), 0) as amount_spent,
         count(ip.id) as receipts,
         max(ip.purchased_on) as last_received
    from public.ingredients i
    left join public.ingredient_purchases ip
      on ip.ingredient_id = i.id and ip.deleted_at is null
   where i.deleted_at is null
   group by i.id, i.name, i.unit;

drop view if exists public.v_expense_summary;
create view public.v_expense_summary with (security_invoker = true) as
  select date_trunc('month', spent_on)::date as month,
         category::text as category,
         count(*) as entries,
         sum(amount) as total
    from public.expenses
   where deleted_at is null
   group by 1, 2
  union all
  select date_trunc('month', purchased_on)::date,
         'ingredients'::text,
         count(*),
         sum(qty * unit_cost)
    from public.ingredient_purchases
   where deleted_at is null
   group by 1;

drop view if exists public.v_sales_trend;
create view public.v_sales_trend with (security_invoker = true) as
  select created_at::date as day,
         count(*) as orders,
         sum(total) as revenue,
         sum(amount_paid) as collected
    from public.orders
   where status = 'completed' and deleted_at is null
   group by 1;

drop view if exists public.v_order_balances;
create view public.v_order_balances with (security_invoker = true) as
  select o.id, o.order_no, o.status, o.total, o.amount_paid,
         (o.total - o.amount_paid) as balance,
         c.name as customer_name, c.phone as customer_phone,
         o.delivery_date, o.fulfilment, o.created_at
    from public.orders o
    left join public.customers c on c.id = o.customer_id
   where o.deleted_at is null
     and o.status not in ('cancelled', 'quote')
     and (o.total - o.amount_paid) > 0;

-- ---------------------------------------------------------------------
-- 14. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['settings','profiles','vendors','ingredients','products',
                           'recipes','customers','orders','order_items','payments',
                           'documents','production_batches','stock_movements',
                           'ingredient_purchases','expenses']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- settings: everyone reads, owner writes
drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to authenticated using (true);
drop policy if exists settings_write on public.settings;
create policy settings_write on public.settings for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- profiles: read own or owner reads all; owner edits; user may edit own name/phone
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_owner());
drop policy if exists profiles_write on public.profiles;
create policy profiles_write on public.profiles for update to authenticated
  using (public.is_owner()) with check (public.is_owner());
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- catalog: owner writes, everyone signed-in reads
do $$
declare t text;
begin
  foreach t in array array['vendors','ingredients','products','recipes'] loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('create policy %I_write on public.%I for all to authenticated
                    using (public.is_owner()) with check (public.is_owner())', t, t);
  end loop;
end $$;

-- operations: owner + staff
do $$
declare t text;
begin
  foreach t in array array['customers','orders','order_items','payments','documents',
                           'production_batches','ingredient_purchases','expenses'] loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('create policy %I_write on public.%I for all to authenticated
                    using (public.can_operate()) with check (public.can_operate())', t, t);
  end loop;
end $$;

-- stock ledger is written by trigger/function only
drop policy if exists stock_movements_read on public.stock_movements;
create policy stock_movements_read on public.stock_movements for select to authenticated using (true);
drop policy if exists stock_movements_write on public.stock_movements;
drop policy if exists stock_movements_no_write on public.stock_movements;

-- ---------------------------------------------------------------------
-- 15. INITIAL SETTINGS
-- ---------------------------------------------------------------------
insert into public.settings (id) values (true) on conflict (id) do nothing;

-- First run: use "Create owner account" on the sign-in page. The first account
-- claims ownership through public.claim_owner() and every later account stays
-- 'staff' until the owner promotes it. The SQL fallback is:
--   select public.promote_to_owner('you@example.com');
