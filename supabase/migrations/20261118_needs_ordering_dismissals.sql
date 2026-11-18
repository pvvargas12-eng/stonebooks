-- NEEDS-ORDERING-2 (2026-11-18): Paul wants to take a line OFF the Needs
-- Ordering list by hand ("reconcile it here or remove it from this list").
-- One row per need key (`<order_id>:stone|base|backer`); Put back deletes the
-- row. The order's own piece statuses are untouched: a row here only hides the
-- line from Needs Ordering. Separate from smart_match_dismissals on purpose
-- (dismissing a Smart Matches card says nothing about whether to order).

CREATE TABLE IF NOT EXISTS needs_ordering_dismissals (
  need_key      text PRIMARY KEY,
  order_id      uuid REFERENCES orders(id) ON DELETE CASCADE,
  kind          text,
  reason        text,
  dismissed_by  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_needs_ordering_dismissals_order ON needs_ordering_dismissals(order_id);

ALTER TABLE needs_ordering_dismissals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS needs_ordering_dismissals_authenticated_all ON needs_ordering_dismissals;
CREATE POLICY needs_ordering_dismissals_authenticated_all
  ON needs_ordering_dismissals FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE needs_ordering_dismissals IS
  'Needs Ordering lines the office removed by hand. Hides the line only; order piece statuses are not touched.';

do $$
declare t text := 'needs_ordering_dismissals';
begin
  if not exists (select 1 from pg_policy where polname = 'zz_partner_lockdown_' || t) then
    execute format('create policy %I on public.%I as restrictive for all to authenticated using ((select is_staff())) with check ((select is_staff()))', 'zz_partner_lockdown_' || t, t);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_anon_lockdown_' || t) then
    execute format('create policy %I on public.%I as restrictive for all to anon using (false) with check (false)', 'zz_anon_lockdown_' || t, t);
  end if;
end $$;

notify pgrst, 'reload schema';
