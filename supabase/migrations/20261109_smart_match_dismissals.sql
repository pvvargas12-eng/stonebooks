-- SMART-WALK (2026-11-09): Paul can DISMISS a Smart Matches card ("i want a
-- dismiss button") without saying anything about the stone. One row per need
-- key (`<order_id>:stone|base|backer`); restoring deletes the row. The order's
-- own piece statuses are untouched — a dismissal only hides the card.

CREATE TABLE IF NOT EXISTS smart_match_dismissals (
  need_key      text PRIMARY KEY,
  order_id      uuid REFERENCES orders(id) ON DELETE CASCADE,
  kind          text,
  reason        text,
  dismissed_by  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smart_match_dismissals_order ON smart_match_dismissals(order_id);

ALTER TABLE smart_match_dismissals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS smart_match_dismissals_authenticated_all ON smart_match_dismissals;
CREATE POLICY smart_match_dismissals_authenticated_all
  ON smart_match_dismissals FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE smart_match_dismissals IS
  'Smart Matches cards the office dismissed by hand. Hides the card only; order piece statuses are not touched.';

-- Added 2026-11-13 when the migration was applied: the same staff / anon
-- lockdown pair every other table carries.
do $$
declare t text := 'smart_match_dismissals';
begin
  if not exists (select 1 from pg_policy where polname = 'zz_partner_lockdown_' || t) then
    execute format('create policy %I on public.%I as restrictive for all to authenticated using ((select is_staff())) with check ((select is_staff()))', 'zz_partner_lockdown_' || t, t);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_anon_lockdown_' || t) then
    execute format('create policy %I on public.%I as restrictive for all to anon using (false) with check (false)', 'zz_anon_lockdown_' || t, t);
  end if;
end $$;

notify pgrst, 'reload schema';
