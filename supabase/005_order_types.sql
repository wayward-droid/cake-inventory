-- ---------------------------------------------------------------------------
-- 005. Bakery order types
--
-- Run after 004_website_catalogue.sql. Safe to rerun.
--
-- The order form classifies new orders by the menu categories the bakery
-- sells. Existing ready_made/custom rows stay valid for historic orders.
-- ---------------------------------------------------------------------------

alter type public.order_kind add value if not exists 'milk_cake';
alter type public.order_kind add value if not exists 'banana_bread';
alter type public.order_kind add value if not exists 'cake_slice';
alter type public.order_kind add value if not exists 'budget_cake';
alter type public.order_kind add value if not exists 'cake_in_a_jar';
alter type public.order_kind add value if not exists 'fruit_juice';

comment on column public.orders.kind is
  'Order type: menu category for new orders; ready_made/custom retained for historic rows.';

notify pgrst, 'reload schema';
