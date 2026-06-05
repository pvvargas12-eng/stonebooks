-- =============================================================================
-- 20260617_orders_foundation_type.sql
-- New Foundation Type field on orders (nullable text — extend values freely
-- without a migration). No RLS change: a new column inherits the table's
-- existing row policies.
--
-- APPLY MANUALLY in Supabase Studio. Idempotent.
-- ROLLBACK: alter table public.orders drop column if exists foundation_type;
-- =============================================================================

alter table public.orders
  add column if not exists foundation_type text;

-- Optional clean-data guard (easy to extend later). Wrapped so a re-run is safe.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_foundation_type_check'
  ) then
    alter table public.orders
      add constraint orders_foundation_type_check
      check (foundation_type is null or foundation_type in ('Strip','Our Foundation','Cemetery Foundation'));
  end if;
end $$;
