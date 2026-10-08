-- =============================================================================
-- 20261008_inquiries_fresh_start.sql — INQUIRIES-1 round 2: start from today
-- =============================================================================
-- Paul (first look at the tab, 58 waiting back to August): "i dont want 58, i
-- really want to start today from scratch." Every inquiry that arrived before
-- today (NJ local midnight = 04:00Z on 2026-10-08) is marked done — they all
-- already became leads under the old sweep, so nothing is lost; the funnel
-- (order_id → signed) still counts them. Idempotent; reversible with the
-- actioned_by stamp below.
-- =============================================================================
update public.website_leads
set inquiry_status = 'done', actioned_at = now(), actioned_by = 'fresh-start 2026-10-08'
where inquiry_status = 'new' and created_at < '2026-10-08T04:00:00Z';

-- VERIFY: select inquiry_status, count(*) from website_leads group by 1;
-- UNDO:   update website_leads set inquiry_status = 'new', actioned_at = null, actioned_by = null where actioned_by = 'fresh-start 2026-10-08';
