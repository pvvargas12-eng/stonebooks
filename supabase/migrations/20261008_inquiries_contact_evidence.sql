-- =============================================================================
-- 20261008_inquiries_contact_evidence.sql — INQUIRIES-2: contacted = done,
-- untouched within 21 days = back to New
-- =============================================================================
-- Paul (reversing the fresh start): "i made a mistake — i don't want them
-- deleted. if any were contacted in any way shape or form move it to
-- completed even if they weren't marked, then bring back all inquiries that
-- were untouched from the past 21 days."
-- Contact evidence (any one is enough): an OUTBOUND message to the inquiry's
-- email address or to its linked customer/order; a logged follow-up / email /
-- contract activity on the linked lead; a completed task on it; the lead
-- itself touched (signed, next_follow_up, waiting_on, status past draft, lost).
-- Only rows at new/done move — emailed/junk are left exactly as staff set them.
-- Idempotent. Dry run 2026-10-08: 87 contacted, 11 restore, 16 stay done.
-- =============================================================================
with w as (
  select w.id, w.created_at, w.inquiry_status, w.order_id, w.customer_id,
    lower(trim(coalesce(w.parsed->>'email', w.parsed->>'email address', ''))) as email
  from public.website_leads w
  where w.status <> 'claimed' and w.inquiry_status in ('new', 'done')
),
ev as (
  select w.id, w.inquiry_status, w.created_at,
    ( exists (select 1 from public.messages m, unnest(coalesce(m.to_emails, '{}')) t
              where m.direction = 'outbound' and w.email <> '' and lower(t) = w.email)
      or exists (select 1 from public.messages m where m.direction = 'outbound'
                 and ((w.customer_id is not null and m.customer_id = w.customer_id) or (w.order_id is not null and m.order_id = w.order_id)))
      or exists (select 1 from public.order_activity a where w.order_id is not null and a.order_id = w.order_id
                 and (a.type = 'activity' or a.field ilike '%email%' or a.field ilike '%contract%'))
      or exists (select 1 from public.shop_tasks t where w.order_id is not null and t.order_id = w.order_id and t.status = 'done')
      or exists (select 1 from public.orders o where o.id = w.order_id
                 and (o.signed_at is not null or o.next_follow_up is not null or o.waiting_on is not null or o.status <> 'draft' or o.lost_at is not null))
    ) as contacted,
    (w.created_at >= now() - interval '21 days') as recent
  from w
)
update public.website_leads x
set inquiry_status = case when ev.contacted then 'done' when ev.recent then 'new' else 'done' end,
    actioned_at = case when ev.contacted or not ev.recent then coalesce(x.actioned_at, now()) else null end,
    actioned_by = case when ev.contacted then 'contact-evidence 2026-10-08' when ev.recent then null else coalesce(x.actioned_by, 'fresh-start 2026-10-08') end
from ev
where ev.id = x.id
  and (case when ev.contacted then 'done' when ev.recent then 'new' else 'done' end) <> x.inquiry_status
   or (ev.id = x.id and ev.contacted and x.actioned_by is distinct from 'contact-evidence 2026-10-08');

-- VERIFY: select inquiry_status, actioned_by, count(*) from website_leads group by 1,2 order by 1,2;
