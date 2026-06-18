-- =============================================================================
-- 20260618_bulk_orders_rls.sql — give bulk_orders its OWN staff RLS policy
-- =============================================================================
-- ROOT CAUSE this fixes:
--   bulk_orders was created (20260526) with RLS OFF and zero policies. The
--   procurement migration (20260617) ADDED COLUMNS to it (supplier_id, status)
--   but — unlike the two NEW tables it created (suppliers, bulk_order_items),
--   each of which got an explicit `*_staff_all` permissive policy — it never gave
--   bulk_orders a policy of its own. It assumed the table was already covered.
--
--   With RLS enabled on bulk_orders (by the app-wide partner/anon lockdown) and
--   NO permissive policy granting `authenticated`, every staff INSERT/UPDATE/
--   SELECT from the APP is denied, while a manual insert in the Studio SQL editor
--   SUCCEEDS because that session runs as the table owner and BYPASSES RLS.
--   That is the exact observed split: manual insert works, createStonePR fails.
--
--   Symptom table (who has an explicit staff-permissive policy):
--     suppliers          ✅  → createSupplier works
--     bulk_order_items   ✅  → line inserts work
--     inventory_stock    ✅  → addInventoryItem works
--     bulk_orders        ❌  → createStonePR's header insert is denied   <-- THIS
--
-- This migration makes bulk_orders self-sufficient (its own staff CRUD policy),
-- mirroring 20260617 exactly. Additive + idempotent: permissive policies OR
-- together, so any lockdown-added zz_staff_all stays harmless; the restrictive
-- zz_anon_deny / zz_partner_lockdown AND-block anon + partners regardless of what
-- other policies exist. Safe to re-run. APPLY MANUALLY in Supabase Studio.
-- =============================================================================

-- ── STEP 0 — RUN THIS FIRST (read-only). Confirms the gap before you fix it. ──
-- Paste + run alone. Expect: rls_enabled = true (or false) AND no PERMISSIVE
-- policy whose roles include `authenticated`. That missing permissive IS the bug.
/*
select c.relrowsecurity as rls_enabled,
       coalesce(string_agg(
         p.polname || ' [' ||
         case p.polpermissive when true then 'PERMISSIVE' else 'RESTRICTIVE' end || ' ' ||
         array_to_string(array(select rolname from pg_roles where oid = any(p.polroles)), ',') || ']',
         ', '), '(no policies)') as policies
from pg_class c
left join pg_policy p on p.polrelid = c.oid
where c.relname = 'bulk_orders'
group by c.relrowsecurity;
*/

-- ── FIX ──────────────────────────────────────────────────────────────────────
alter table public.bulk_orders enable row level security;

drop policy if exists "bulk_orders_staff_all" on public.bulk_orders;
create policy "bulk_orders_staff_all" on public.bulk_orders as permissive  for all to authenticated using (is_staff()) with check (is_staff());

drop policy if exists "zz_anon_deny"          on public.bulk_orders;
create policy "zz_anon_deny"          on public.bulk_orders as restrictive for all to anon          using (false)      with check (false);

drop policy if exists "zz_partner_lockdown"   on public.bulk_orders;
create policy "zz_partner_lockdown"   on public.bulk_orders as restrictive for all to authenticated using (is_staff()) with check (is_staff());

-- ── STEP 5 — VERIFY (after applying) ─────────────────────────────────────────
-- (a) Re-run STEP 0 → bulk_orders now shows `bulk_orders_staff_all [PERMISSIVE authenticated]`.
-- (b) From the APP (authenticated staff): build a Stone PR in Inventory → Procurement.
--     It should persist and appear in the list. (createStonePR no longer hits an RLS denial.)
-- (c) Optional logic check in Studio:  select count(*) from bulk_orders;  -- staff: all rows.
