-- =====================================================================
--  CAKE SLICE FACTORY  --  database regression tests
--
--  Run in the Supabase SQL editor. The whole suite runs inside a
--  transaction and is rolled back, so it never changes your data.
--
--  Every NOTICE 'PASS ...' is a passing assertion. Any failure raises
--  an exception and aborts the run.
-- =====================================================================

begin;

do $$
declare
  v_ing     uuid;
  v_prod    uuid;
  v_cust    uuid;
  v_order   public.orders;
  v_stock   numeric;
  v_diff    numeric;
  v_total   numeric;
  v_paid    numeric;
  v_batch   uuid;
begin
  -- ------------------------------------------------------------ fixtures
  insert into public.ingredients (name, unit, cost_per_unit, stock_qty, low_stock_at)
  values ('TEST ingredient', 'kg', 0, 0, 2)
  returning id into v_ing;

  insert into public.products (name, sku, kind, price, cost_price, stock_qty, low_stock_at, track_stock)
  values ('TEST cake', 'TEST-SKU-' || left(gen_random_uuid()::text, 8), 'ready_made', 1000, 0, 0, 1, true)
  returning id into v_prod;

  insert into public.recipes (product_id, ingredient_id, qty) values (v_prod, v_ing, 2);

  insert into public.customers (name, phone, city, state)
  values ('TEST customer', '00000000000', 'Lagos', 'Lagos')
  returning id into v_cust;

  -- ------------------------------------------------------------ opening stock + purchase
  perform public.adjust_stock(v_ing, null, 10, 'adjustment', 'TEST opening');
  select stock_qty into v_stock from public.ingredients where id = v_ing;
  if v_stock <> 10 then raise exception 'FAIL opening stock: %', v_stock; end if;
  raise notice 'PASS opening stock = 10';

  insert into public.ingredient_purchases (ingredient_id, qty, unit, unit_cost)
  values (v_ing, 5, 'kg', 250);

  select stock_qty, cost_per_unit into v_stock, v_diff from public.ingredients where id = v_ing;
  if v_stock <> 15 then raise exception 'FAIL purchase stock: %', v_stock; end if;
  if v_diff <> 250 then raise exception 'FAIL purchase cost: %', v_diff; end if;
  raise notice 'PASS purchase raises stock and refreshes cost';

  -- ------------------------------------------------------------ production
  insert into public.production_batches (product_id, qty_produced, produced_on)
  values (v_prod, 3, current_date)
  returning id into v_batch;

  select stock_qty into v_stock from public.ingredients where id = v_ing;
  if v_stock <> 9 then raise exception 'FAIL ingredient consumption: %', v_stock; end if;
  select stock_qty into v_stock from public.products where id = v_prod;
  if v_stock <> 3 then raise exception 'FAIL product output: %', v_stock; end if;
  raise notice 'PASS production consumes 6 kg and produces 3 cakes';

  -- ------------------------------------------------------------ order totals
  v_order := public.create_order(
    v_cust, 'ready_made', 'walk_in', 'pickup', null, null, null, current_date,
    100, 'TEST discount', 50, null, 'TEST order',
    jsonb_build_array(jsonb_build_object(
      'product_id', v_prod, 'item_name', 'TEST cake', 'qty', 2, 'unit_price', 1000))
  );

  select total into v_total from public.orders where id = v_order.id;
  if v_total <> 1950 then raise exception 'FAIL order total: % (expected 1950)', v_total; end if;
  raise notice 'PASS total = 2000 - 100 + 50';

  insert into public.payments (order_id, amount, method, paid_on)
  values (v_order.id, 1000, 'cash', current_date);

  select amount_paid into v_paid from public.orders where id = v_order.id;
  if v_paid <> 1000 then raise exception 'FAIL amount_paid: %', v_paid; end if;
  raise notice 'PASS payment syncs amount_paid';

  -- ------------------------------------------------------------ completion deducts once
  update public.orders set status = 'completed' where id = v_order.id;
  select stock_qty into v_stock from public.products where id = v_prod;
  if v_stock <> 1 then raise exception 'FAIL completion stock: %', v_stock; end if;

  update public.orders set status = 'completed' where id = v_order.id;
  select stock_qty into v_stock from public.products where id = v_prod;
  if v_stock <> 1 then raise exception 'FAIL double deduction: %', v_stock; end if;
  raise notice 'PASS completion deducts stock exactly once';

  -- ------------------------------------------------------------ changing a completed order fails
  begin
    update public.orders set status = 'confirmed' where id = v_order.id;
    raise exception 'TEST FAILED: completed order was allowed to leave completed';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
  end;
  raise notice 'PASS completed order cannot be reopened silently';

  -- ------------------------------------------------------------ cancel reverses once
  update public.orders set status = 'cancelled' where id = v_order.id;
  select stock_qty into v_stock from public.products where id = v_prod;
  if v_stock <> 3 then raise exception 'FAIL reversal stock: %', v_stock; end if;

  update public.orders set status = 'cancelled' where id = v_order.id;
  select stock_qty into v_stock from public.products where id = v_prod;
  if v_stock <> 3 then raise exception 'FAIL double reversal: %', v_stock; end if;
  raise notice 'PASS cancellation returns stock exactly once';

  -- ------------------------------------------------------------ stock conservation
  select diff into v_diff from public.check_stock_integrity() where id = v_ing;
  if coalesce(v_diff, 0) <> 0 then raise exception 'FAIL ingredient ledger diff: %', v_diff; end if;
  select diff into v_diff from public.check_stock_integrity() where id = v_prod;
  if coalesce(v_diff, 0) <> 0 then raise exception 'FAIL product ledger diff: %', v_diff; end if;
  raise notice 'PASS stock conservation invariant holds';

  -- ------------------------------------------------------------ documents are immutable
  perform public.issue_document(v_order.id, 'invoice');
  begin
    update public.documents set snapshot = '{}'::jsonb where order_id = v_order.id;
    raise exception 'TEST FAILED: document snapshot was updated';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
  end;
  raise notice 'PASS issued documents cannot be changed';

  -- ------------------------------------------------------------ audit trail
  if not exists (select 1 from public.audit_log where table_name = 'orders' and record_id = v_order.id::text) then
    raise exception 'FAIL no order audit rows';
  end if;
  raise notice 'PASS money-affecting changes are audited';

  raise notice 'ALL DATABASE TESTS PASSED';
end $$;

rollback;
