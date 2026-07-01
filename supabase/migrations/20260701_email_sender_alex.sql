-- =============================================================================
-- 20260701_email_sender_alex.sql  (Email Command Center — add sender "Alex")
-- =============================================================================
-- Adds Alex to the sender picker. Idempotent — only inserts if not already there.
-- APPLY MANUALLY in Supabase Studio (or leave it; the app works without it).
-- =============================================================================

insert into public.email_senders (name, title, phone, signature_text, sort_order)
select 'Alex', null, '(732) 442-1286',
  E'Alex\nShevchenko Monuments, LLC.\n329 S Florida Grove Rd, Perth Amboy, NJ 08861\n(732) 442-1286 · shevcoteam@gmail.com', 7
where not exists (select 1 from public.email_senders where lower(name) = 'alex');

-- VERIFY: select name from email_senders order by sort_order;  -> …, Sabina, Alex
