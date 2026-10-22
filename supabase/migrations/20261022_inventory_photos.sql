-- ── YARD-PHOTOS (2026-10-22, on the founding walk) ────────────────────────────
-- Paul: "i want to be able to click on some and upload pictures — we have many
-- with designs that i want to be able to also upload what it looks like."
-- A stone carries MANY photos now (front, the carved design, the back).
--   photos    jsonb array of { url, path, at, by } — appended by the phone's
--             Photos verb, removed one at a time. Newest last.
--   photo_url (existing) stays = the FIRST photo so every older reader keeps
--             working; it is re-pointed when the first photo is removed.
alter table public.inventory_stock add column if not exists photos jsonb not null default '[]'::jsonb;
