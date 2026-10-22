-- =====================================================================
--  CAKE SLICE FACTORY  --  002 core additions
--
--  Adds the safety and control features the business cannot run without:
--  audit trail, status & price history, reversals, unit conversions,
--  purchase orders, vendor payables, stock takes, attachments,
--  notifications and the remaining reporting views.
--
--  Run AFTER supabase/schema.sql and BEFORE supabase/003_owner_setup.sql. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. AUDIT LOG  (A2 / M11-FR-02) — immutable, owner-readable
-- ---------------------------------------------------------------------
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  table_name  text not null,
  record_id   text,
  action      text not null check (action in ('insert','update','delete')),
  actor       uuid references auth.users(id) on delete set null,
  actor_email text,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_audit_table   on public.audit_log(table_name);
create index if not exists idx_audit_actor   on public.audit_log(actor);
create index if not exists idx_audit_created on public.audit_log(created_at desc);

create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rid      text;
  before_j jsonb;
  after_j  jsonb;
  act      text;
begin
  if tg_op = 'INSERT' then
    act := 'insert'; after_j := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    act := 'update'; before_j := to_jsonb(old); after_j := to_jsonb(new);
  else
    act := 'delete'; before_j := to_jsonb(old);
  end if;

  rid := coalesce(after_j->>'id', before_j->>'id');

  insert into public.audit_log (table_name, record_id, action, actor, actor_email, before, after)
  values (tg_table_name, rid, act, auth.uid(),
          (select email from public.profiles where id = auth.uid()),
          before_j, after_j);
  return null;
end $$;

-- Audit triggers are installed after every audited table exists (see section 9).

-- audit rows can never be changed
create or replace function public.block_change()
returns trigger language plpgsql as $$
begin
  raise exception 'This record is immutable';
end $$;

drop trigger if exists trg_audit_immutable on public.audit_log;
create trigger trg_audit_immutable before update or delete on public.audit_log
  for each row execute function public.block_change();

-- ---------------------------------------------------------------------
-- 2. ORDER STATUS HISTORY  (M6-FR-08)
-- ---------------------------------------------------------------------
create table if not exists public.order_status_history (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  from_status public.order_status,
  to_status   public.order_status not null,
  changed_by  uuid references auth.users(id) on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_osh_order on public.order_status_history(order_id);

create or replace function public.log_order_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_history (order_id, from_status, to_status, changed_by)
    values (new.id, null, new.status, auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.order_status_history (order_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return null;
end $$;

drop trigger if exists trg_order_status_history on public.orders;
create trigger trg_order_status_history
  after insert or update on public.orders
  for each row execute function public.log_order_status();

drop trigger if exists trg_osh_immutable on public.order_status_history;
create trigger trg_osh_immutable before update or delete on public.order_status_history
  for each row execute function public.block_change();

-- ---------------------------------------------------------------------
-- 3. PRICE HISTORY  (B11 / M2-FR-03)
-- ---------------------------------------------------------------------
create table if not exists public.price_history (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  old_price  numeric(14,2),
  new_price  numeric(14,2),
  old_cost   numeric(14,2),
  new_cost   numeric(14,2),
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists idx_price_history_product on public.price_history(product_id);

create or replace function public.log_price_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.price is distinct from old.price or new.cost_price is distinct from old.cost_price then
    insert into public.price_history (product_id, old_price, new_price, old_cost, new_cost, changed_by)
    values (new.id, old.price, new.price, old.cost_price, new.cost_price, auth.uid());
  end if;
  return null;
end $$;

drop trigger if exists trg_price_history on public.products;
create trigger trg_price_history after update on public.products
  for each row execute function public.log_price_change();

-- ---------------------------------------------------------------------
-- 4. UNIT CONVERSIONS  (B4 / M3-FR-04)
-- ---------------------------------------------------------------------
create table if not exists public.unit_conversions (
  id            uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  from_unit     text not null,
  to_unit       text not null,
  factor        numeric(18,6) not null check (factor > 0),
  created_at    timestamptz not null default now(),
  unique (ingredient_id, from_unit, to_unit)
);

create or replace function public.convert_qty(p_ingredient uuid, p_qty numeric, p_from text, p_to text)
returns numeric language sql stable security definer set search_path = public as $$
  select case
    when p_from = p_to then p_qty
    else p_qty * coalesce(
      (select factor from public.unit_conversions
        where ingredient_id = p_ingredient and from_unit = p_from and to_unit = p_to),
      (select 1 / factor from public.unit_conversions
        where ingredient_id = p_ingredient and from_unit = p_to and to_unit = p_from),
      1)
  end
$$;

-- ---------------------------------------------------------------------
-- 5. PRODUCT COST ROLL-UP  (M3-FR-03)
-- ---------------------------------------------------------------------
create or replace function public.recalc_product_cost(p_product uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_cost numeric(14,2);
begin
  if auth.uid() is not null and not public.is_owner() then
    raise exception 'Only an owner can recalculate product cost';
  end if;

  select coalesce(sum(r.qty * i.cost_per_unit), 0) into v_cost
    from public.recipes r
    join public.ingredients i on i.id = r.ingredient_id
   where r.product_id = p_product;

  update public.products set cost_price = round(v_cost, 2), updated_at = now()
   where id = p_product;
  return round(v_cost, 2);
end $$;
grant execute on function public.recalc_product_cost(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. PURCHASE ORDERS  (B6 / M4-FR-04)
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'po_status') then
    create type public.po_status as enum ('draft','sent','partially_received','received','cancelled');
  end if;
end $$;

create table if not exists public.purchase_orders (
  id          uuid primary key default gen_random_uuid(),
  po_no       text unique,
  vendor_id   uuid references public.vendors(id) on delete set null,
  status      public.po_status not null default 'draft',
  ordered_on  date not null default current_date,
  expected_on date,
  notes       text,
  total       numeric(14,2) not null default 0,
  received_at timestamptz,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.purchase_order_items (
  id                uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  ingredient_id     uuid not null references public.ingredients(id) on delete cascade,
  qty               numeric(14,2) not null check (qty > 0),
  unit_cost         numeric(14,2) not null default 0 check (unit_cost >= 0),
  line_total        numeric(14,2) generated always as (round(qty * unit_cost, 2)) stored
);
create index if not exists idx_po_items_po on public.purchase_order_items(purchase_order_id);

create sequence if not exists public.po_no_seq start 1001;
create or replace function public.set_po_no()
returns trigger language plpgsql as $$
begin
  if new.po_no is null then
    new.po_no := 'PO-' || lpad(nextval('public.po_no_seq')::text, 5, '0');
  end if;
  return new;
end $$;

drop trigger if exists trg_po_no on public.purchase_orders;
create trigger trg_po_no before insert on public.purchase_orders
  for each row execute function public.set_po_no();

drop trigger if exists trg_po_touch on public.purchase_orders;
create trigger trg_po_touch before update on public.purchase_orders
  for each row execute function public.touch_updated_at();

create or replace function public.recalc_po_total()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid := coalesce(new.purchase_order_id, old.purchase_order_id);
begin
  update public.purchase_orders
     set total = coalesce((select sum(line_total) from public.purchase_order_items
                            where purchase_order_id = pid), 0)
   where id = pid;
  return null;
end $$;

drop trigger if exists trg_po_recalc on public.purchase_order_items;
create trigger trg_po_recalc after insert or update or delete on public.purchase_order_items
  for each row execute function public.recalc_po_total();

create or replace function public.receive_purchase_order(p_po uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  it       record;
  v_vendor uuid;
  v_status public.po_status;
begin
  if auth.uid() is not null and not public.can_operate() then
    raise exception 'Not permitted';
  end if;

  select vendor_id, status into v_vendor, v_status from public.purchase_orders where id = p_po;
  if not found then raise exception 'Purchase order % not found', p_po; end if;
  if v_status = 'received' then raise exception 'Purchase order % already received', p_po; end if;
  if v_status = 'cancelled' then raise exception 'Purchase order % is cancelled', p_po; end if;

  for it in select ingredient_id, qty, unit_cost
              from public.purchase_order_items where purchase_order_id = p_po
  loop
    insert into public.ingredient_purchases (vendor_id, ingredient_id, qty, unit_cost, note, created_by)
    values (v_vendor, it.ingredient_id, it.qty, it.unit_cost, 'Received from PO', auth.uid());
  end loop;

  update public.purchase_orders set status = 'received', received_at = now() where id = p_po;
end $$;
revoke execute on function public.receive_purchase_order(uuid) from public, anon;
grant  execute on function public.receive_purchase_order(uuid) to authenticated;

-- Vendor payments -> payables (B6)
create table if not exists public.vendor_payments (
  id         uuid primary key default gen_random_uuid(),
  vendor_id  uuid not null references public.vendors(id) on delete cascade,
  amount     numeric(14,2) not null check (amount > 0),
  paid_on    date not null default current_date,
  method     text not null default 'cash',
  note       text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 7. STOCK TAKES  (B7 / M5)
-- ---------------------------------------------------------------------
create table if not exists public.stock_takes (
  id         uuid primary key default gen_random_uuid(),
  reference  text unique,
  taken_on   date not null default current_date,
  status     text not null default 'open' check (status in ('open','posted')),
  note       text,
  created_by uuid references auth.users(id) on delete set null,
  posted_at  timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.stock_take_items (
  id            uuid primary key default gen_random_uuid(),
  stock_take_id uuid not null references public.stock_takes(id) on delete cascade,
  ingredient_id uuid references public.ingredients(id) on delete cascade,
  product_id    uuid references public.products(id) on delete cascade,
  expected_qty  numeric(14,2) not null default 0,
  counted_qty   numeric(14,2),
  variance      numeric(14,2) generated always as (coalesce(counted_qty, 0) - expected_qty) stored,
  check ((ingredient_id is not null) <> (product_id is not null))
);
create index if not exists idx_st_items_st on public.stock_take_items(stock_take_id);

create sequence if not exists public.stock_take_seq start 1001;
create or replace function public.set_stock_take_ref()
returns trigger language plpgsql as $$
begin
  if new.reference is null then
    new.reference := 'ST-' || lpad(nextval('public.stock_take_seq')::text, 5, '0');
  end if;
  return new;
end $$;
drop trigger if exists trg_stock_take_ref on public.stock_takes;
create trigger trg_stock_take_ref before insert on public.stock_takes
  for each row execute function public.set_stock_take_ref();

create or replace function public.post_stock_take(p_st uuid)
returns void language plpgsql security definer set search_path = public as $$
declare it record; v_status text; v_ref text;
begin
  if auth.uid() is not null and not public.can_operate() then
    raise exception 'Not permitted';
  end if;

  select status, coalesce(reference, 'ST-' || left(p_st::text, 8))
    into v_status, v_ref
    from public.stock_takes where id = p_st;

  if v_status is null then raise exception 'Stock take % not found', p_st; end if;
  if v_status = 'posted' then raise exception 'Stock take % already posted', p_st; end if;

  for it in select * from public.stock_take_items where stock_take_id = p_st loop
    if it.variance <> 0 then
      if it.ingredient_id is not null then
        update public.ingredients set stock_qty = stock_qty + it.variance, updated_at = now()
         where id = it.ingredient_id;
        insert into public.stock_movements (ingredient_id, change_qty, reason, reference, note, created_by)
        values (it.ingredient_id, it.variance, 'adjustment', v_ref, 'Stock take variance', auth.uid());
      else
        update public.products set stock_qty = stock_qty + it.variance, updated_at = now()
         where id = it.product_id;
        insert into public.stock_movements (product_id, change_qty, reason, reference, note, created_by)
        values (it.product_id, it.variance, 'adjustment', v_ref, 'Stock take variance', auth.uid());
      end if;
    end if;
  end loop;

  update public.stock_takes set status = 'posted', posted_at = now() where id = p_st;
end $$;
revoke execute on function public.post_stock_take(uuid) from public, anon;
grant  execute on function public.post_stock_take(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8. ATTACHMENTS  (B10 / M9-FR-03) -> Supabase Storage
-- ---------------------------------------------------------------------
create table if not exists public.attachments (
  id          uuid primary key default gen_random_uuid(),
  entity      text not null check (entity in ('order','expense','customer','product','vendor')),
  entity_id   uuid not null,
  file_path   text not null,
  file_name   text,
  mime_type   text,
  size_bytes  bigint,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_attachments_entity on public.attachments(entity, entity_id);

-- ---------------------------------------------------------------------
-- 9. NOTIFICATIONS  (B12 / M11-FR-04)
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade, -- null = everyone
  kind       text not null,          -- low_stock | order_due | balance_overdue
  title      text not null,
  body       text,
  entity     text,
  entity_id  uuid,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_user on public.notifications(user_id, read_at);

create or replace function public.refresh_low_stock_notifications()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0;
begin
  insert into public.notifications (user_id, kind, title, body, entity, entity_id)
  select null, 'low_stock',
         'Low stock: ' || a.name,
         a.kind || ' down to ' || a.stock_qty || ' ' || a.unit,
         a.kind, a.id
    from public.v_stock_alerts a
   where not exists (
     select 1 from public.notifications n
      where n.kind = 'low_stock' and n.entity_id = a.id
        and n.created_at > now() - interval '12 hours');
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.refresh_low_stock_notifications() to authenticated;

-- Install audit triggers now that all audited tables have been created.
do $$
declare t text;
begin
  foreach t in array array['products','ingredients','orders','order_items','payments',
                           'documents','production_batches','ingredient_purchases',
                           'expenses','vendors','recipes','customers','settings',
                           'purchase_orders','purchase_order_items','vendor_payments',
                           'stock_takes','stock_take_items']
  loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('drop trigger if exists trg_audit on public.%I', t);
      execute format('create trigger trg_audit after insert or update or delete on public.%I
                      for each row execute function public.audit_row_change()', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 10. IMMUTABLE LEDGER
-- ---------------------------------------------------------------------
drop trigger if exists trg_movements_immutable on public.stock_movements;
create trigger trg_movements_immutable before update or delete on public.stock_movements
  for each row execute function public.block_change();

-- documents are snapshots: never rewritten, never deleted through the app
drop trigger if exists trg_documents_immutable on public.documents;
create trigger trg_documents_immutable before update or delete on public.documents
  for each row execute function public.block_change();

-- ---------------------------------------------------------------------
-- 11. ROLE ESCALATION GUARD
-- ---------------------------------------------------------------------
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  bootstrap_uid text := current_setting('csf.owner_bootstrap', true);
begin
  if auth.uid() is not null and not public.is_owner() then
    if new.role is distinct from old.role then
      -- claim_owner() sets this transaction-local value only after checking
      -- that no owner exists and taking the bootstrap lock.
      if not (
        new.role = 'owner'
        and new.id = auth.uid()
        and coalesce(bootstrap_uid = auth.uid()::text, false)
      ) then
        raise exception 'Only an owner can change a role';
      end if;
    end if;
    if new.active is distinct from old.active then
      raise exception 'Only an owner can activate or deactivate a user';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_role on public.profiles;
create trigger trg_guard_role before update on public.profiles
  for each row execute function public.guard_profile_role();

-- ---------------------------------------------------------------------
-- 12. STOCK INTEGRITY MONITOR  (the correctness guarantee)
-- ---------------------------------------------------------------------
create or replace function public.check_stock_integrity()
returns table (kind text, id uuid, name text, cached_qty numeric, ledger_qty numeric, diff numeric)
language sql stable security definer set search_path = public as $$
  select 'ingredient'::text, i.id, i.name, i.stock_qty,
         coalesce((select sum(change_qty) from public.stock_movements m where m.ingredient_id = i.id), 0),
         i.stock_qty - coalesce((select sum(change_qty) from public.stock_movements m where m.ingredient_id = i.id), 0)
    from public.ingredients i
   where i.deleted_at is null
  union all
  select 'product'::text, p.id, p.name, p.stock_qty,
         coalesce((select sum(change_qty) from public.stock_movements m where m.product_id = p.id), 0),
         p.stock_qty - coalesce((select sum(change_qty) from public.stock_movements m where m.product_id = p.id), 0)
    from public.products p
   where p.deleted_at is null and p.track_stock = true;
$$;
grant execute on function public.check_stock_integrity() to authenticated;

-- ---------------------------------------------------------------------
-- 13. REPORT VIEWS
-- ---------------------------------------------------------------------
drop view if exists public.v_profit_and_loss;
create view public.v_profit_and_loss with (security_invoker = true) as
  with rev as (
    select date_trunc('month', o.created_at)::date as month,
           coalesce(sum(o.total), 0) as revenue,
           coalesce(sum(c.cogs), 0) as cogs
      from public.orders o
      left join lateral (
        select sum(oi.qty * oi.unit_cost) as cogs
          from public.order_items oi
         where oi.order_id = o.id
      ) c on true
     where o.status = 'completed' and o.deleted_at is null
     group by 1
  ),
  opex as (
    select date_trunc('month', spent_on)::date as month,
           coalesce(sum(amount), 0) as expenses
      from public.expenses
     where deleted_at is null and category <> 'ingredients'
     group by 1
  )
  select coalesce(rev.month, opex.month) as month,
         coalesce(rev.revenue, 0)  as revenue,
         coalesce(rev.cogs, 0)     as cogs,
         coalesce(opex.expenses, 0) as expenses,
         coalesce(rev.revenue, 0) - coalesce(rev.cogs, 0) - coalesce(opex.expenses, 0) as profit
    from rev full outer join opex on rev.month = opex.month;

drop view if exists public.v_daily_cashup;
create view public.v_daily_cashup with (security_invoker = true) as
  select paid_on as day, method,
         count(*) as txns, sum(amount) as amount
    from public.payments
   where deleted_at is null
   group by 1, 2;

drop view if exists public.v_vendor_payables;
create view public.v_vendor_payables with (security_invoker = true) as
  select v.id, v.name, v.phone,
         coalesce(po.ordered_value, 0) as received_value,
         coalesce(vp.paid_value, 0) as paid_value,
         coalesce(po.ordered_value, 0) - coalesce(vp.paid_value, 0) as balance
    from public.vendors v
    left join (
      select vendor_id, sum(total) as ordered_value
        from public.purchase_orders
       where status = 'received'
       group by vendor_id
    ) po on po.vendor_id = v.id
    left join (
      select vendor_id, sum(amount) as paid_value
        from public.vendor_payments
       group by vendor_id
    ) vp on vp.vendor_id = v.id
   where v.deleted_at is null;

drop view if exists public.v_recipe_cost;
create view public.v_recipe_cost with (security_invoker = true) as
  select p.id as product_id, p.name as product_name, p.price, p.cost_price,
         coalesce(sum(r.qty * i.cost_per_unit), 0) as recipe_cost,
         case when p.price > 0
              then round((p.price - coalesce(sum(r.qty * i.cost_per_unit), 0)) / p.price * 100, 1)
              else null end as margin_pct
    from public.products p
    left join public.recipes r     on r.product_id = p.id
    left join public.ingredients i on i.id = r.ingredient_id
   where p.deleted_at is null
   group by p.id, p.name, p.price, p.cost_price;

drop view if exists public.v_customer_history;
create view public.v_customer_history with (security_invoker = true) as
  select c.id as customer_id, c.name, c.phone, c.city, c.state,
         count(o.id) filter (where o.status <> 'cancelled') as orders,
         coalesce(sum(o.total) filter (where o.status = 'completed'), 0) as lifetime_spend,
         max(o.created_at) as last_order_at
    from public.customers c
    left join public.orders o on o.customer_id = c.id and o.deleted_at is null
   where c.deleted_at is null
   group by c.id, c.name, c.phone, c.city, c.state;

-- ---------------------------------------------------------------------
-- 14. RLS FOR THE NEW TABLES
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['audit_log','order_status_history','price_history','unit_conversions',
                           'purchase_orders','purchase_order_items','vendor_payments',
                           'stock_takes','stock_take_items','attachments','notifications']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- audit: owner only, no client writes
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log for select to authenticated
  using (public.is_owner());

-- history: signed-in read, trigger-only writes
drop policy if exists osh_read on public.order_status_history;
create policy osh_read on public.order_status_history for select to authenticated using (true);

drop policy if exists price_history_read on public.price_history;
create policy price_history_read on public.price_history for select to authenticated using (true);

-- catalog-shaped
drop policy if exists unit_conversions_read on public.unit_conversions;
create policy unit_conversions_read on public.unit_conversions for select to authenticated using (true);
drop policy if exists unit_conversions_write on public.unit_conversions;
create policy unit_conversions_write on public.unit_conversions for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- operational
do $$
declare t text;
begin
  foreach t in array array['purchase_orders','purchase_order_items','vendor_payments',
                           'stock_takes','stock_take_items','attachments'] loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('create policy %I_write on public.%I for all to authenticated
                    using (public.can_operate()) with check (public.can_operate())', t, t);
  end loop;
end $$;

-- notifications: global + own; users mark their own read
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated
  using (user_id is null or user_id = auth.uid() or public.is_owner());
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid() or public.is_owner())
  with check (user_id = auth.uid() or public.is_owner());
drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert to authenticated
  with check (public.can_operate());

-- ---------------------------------------------------------------------
-- 15. STORAGE (optional; safe to skip if you prefer the dashboard)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('cake-files', 'cake-files', false)
on conflict (id) do nothing;

drop policy if exists cake_files_read on storage.objects;
create policy cake_files_read on storage.objects for select to authenticated
  using (bucket_id = 'cake-files');
drop policy if exists cake_files_write on storage.objects;
create policy cake_files_write on storage.objects for insert to authenticated
  with check (bucket_id = 'cake-files' and public.can_operate());
drop policy if exists cake_files_delete on storage.objects;
create policy cake_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'cake-files' and public.can_operate());

-- =====================================================================
--  Done. Verify integrity at any time with:
--     select * from public.check_stock_integrity() where diff <> 0;
--
--  First-time setup:
--    1. sign up in the app
--    2. select public.promote_to_owner('you@example.com');
-- =====================================================================
