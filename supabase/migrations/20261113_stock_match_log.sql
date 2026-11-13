-- ── PR-MATCH-2 (2026-11-13): the record of yard stones used instead of ordered ─
-- Paul: "when I confirm match that stock number matches to that stone unless I
-- later remove match, then it would go back into stock inventory. When
-- reviewing I want to see the numbers that are matched... I also want to see
-- how much money I saved by using stock instead of ordering... that's also a
-- number I want to see in owner reports."
--
-- One row per confirmed match on a Stone PR. The yard row itself stays the
-- truth for "which stone belongs to which order" (inventory_stock.status =
-- allocated + allocated_order_id); this table is the RECORD: which PR it was
-- matched on, what the line would have cost in the supplier's price book
-- (saved_amount, null when no book is loaded for that supplier) and when.
-- Remove match stamps removed_at; the row is never deleted, and money saved
-- counts only rows with removed_at null.
-- UNDO: drop table public.stock_match_log;

create table if not exists public.stock_match_log (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  order_id       uuid references public.orders(id) on delete cascade,
  bulk_order_id  uuid references public.bulk_orders(id) on delete set null,
  po_number      text,
  stock_id       uuid references public.inventory_stock(id) on delete set null,
  yard_tag       integer,
  piece          text,                 -- die | base | backer
  family         text,
  line_spec      text,                 -- what the PR line asked for
  stone_spec     text,                 -- the yard stone that filled it
  supplier       text,
  saved_amount   numeric(12,2),        -- book cost of the line not ordered
  saved_basis    text,                 -- 'printed row' | 'book rate' | null
  matched_by     text,
  matched_at     timestamptz not null default now(),
  removed_at     timestamptz,
  removed_by     text
);
create index if not exists stock_match_log_pr_idx on public.stock_match_log (bulk_order_id);
create index if not exists stock_match_log_at_idx on public.stock_match_log (matched_at desc);
create index if not exists stock_match_log_order_idx on public.stock_match_log (order_id);

alter table public.stock_match_log enable row level security;

do $$
declare t text := 'stock_match_log';
begin
  if not exists (select 1 from pg_policy where polname = t || '_authenticated_all') then
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t || '_authenticated_all', t);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_partner_lockdown_' || t) then
    execute format('create policy %I on public.%I as restrictive for all to authenticated using ((select is_staff())) with check ((select is_staff()))', 'zz_partner_lockdown_' || t, t);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_anon_lockdown_' || t) then
    execute format('create policy %I on public.%I as restrictive for all to anon using (false) with check (false)', 'zz_anon_lockdown_' || t, t);
  end if;
end $$;
