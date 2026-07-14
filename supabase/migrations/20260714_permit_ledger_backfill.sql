-- =============================================================================
-- 20260714_permit_ledger_backfill.sql — permit filings → outgoing_payments
-- =============================================================================
-- Audit A1: 46 permit filings in orders.permit[] carry check numbers that
-- appear NOWHERE in outgoing_payments (~$51.4k of paid-out permit money
-- invisible to Payments › Outgoing). This backfill inserts one ledger row per
-- ck-bearing filing that has a positive amount and a real (non-future) filed
-- date, deduped two ways (reference + source_permit_key, the same key the
-- app's createPermitOutgoingPayment writes: '<order_id>:<ck>').
-- Filings WITHOUT a check number are left alone (unverifiable — hand entry).
-- Idempotent — the NOT EXISTS guards make a re-run insert nothing.
-- =============================================================================

-- 0 ── data fix first: PARISER E-26-0027 filing says filed 2028-03-19 (typo;
--      adjacent check 2879 = 2026-03-19). 2028 → 2026.
update orders o
set permit = (
  select jsonb_agg(
    case when f->>'ck' = '2878' and f->>'date_filed' like '2028-03-19%'
         then jsonb_set(f, '{date_filed}', '"2026-03-19"')
         else f end)
  from jsonb_array_elements(o.permit) f
)
where o.order_number = 'E-26-0027' and jsonb_typeof(o.permit) = 'array';

-- 1 ── the backfill
insert into outgoing_payments
  (payee, category, method, reference, amount, paid_date, direction, notes, created_by, order_id, source_permit_key)
select
  coalesce(cem.name, nullif(trim(f->>'name'), ''), 'Unknown cemetery — permit') as payee,
  'Permits',
  case
    when f->>'method' ~* 'zelle' then 'zelle'
    when f->>'method' ~* '^cc$|card|credit' then 'card'
    else 'check'
  end,
  trim(f->>'ck'),
  (f->>'amount')::numeric,
  left(f->>'date_filed', 10)::date,
  'out',
  'Backfilled from the order''s permit log (audit A1, 2026-07-14)',
  'system: permit backfill 2026-07-14',
  o.id,
  o.id || ':' || trim(f->>'ck')
from orders o, jsonb_array_elements(o.permit) f
left join lateral (select name from cemeteries c where c.id = o.cemetery_id) cem on true
where jsonb_typeof(o.permit) = 'array'
  and coalesce(nullif(trim(coalesce(f->>'ck','')),''),'') <> ''
  and coalesce(f->>'amount','') ~ '^[0-9.]+$' and (f->>'amount')::numeric > 0
  and coalesce(nullif(left(f->>'date_filed',10),''),'') <> ''
  and left(f->>'date_filed',10)::date <= current_date
  and not exists (select 1 from outgoing_payments op where op.reference = trim(f->>'ck'))
  and not exists (select 1 from outgoing_payments op2 where op2.source_permit_key = o.id || ':' || trim(f->>'ck'));

-- ── VERIFY ──
-- select count(*), sum(amount) from outgoing_payments where created_by = 'system: permit backfill 2026-07-14';
-- Remaining ck-bearing filings absent from the ledger should be 0:
-- (re-run the audit query from supabase/reports/2026-07-14_stonebooks_audit.md)
