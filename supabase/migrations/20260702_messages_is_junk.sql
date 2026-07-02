-- =============================================================================
-- 20260702_messages_is_junk — shared junk flag on messages
-- =============================================================================
-- Junk marks were localStorage-only (per-browser): one staff member marking a
-- thread junk was invisible to everyone else. This adds a nullable boolean:
--   NULL  = no manual decision (the client-side heuristic applies)
--   true  = staff marked the thread junk
--   false = staff explicitly marked it NOT junk (overrides the heuristic)
-- The app writes the same value to every message in the thread; reads take the
-- newest non-null value per thread.
--
-- Run manually in Supabase Studio (SQL Editor). Idempotent.
-- =============================================================================

alter table public.messages add column if not exists is_junk boolean;
