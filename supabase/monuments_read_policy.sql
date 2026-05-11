-- =============================================================================
-- MONUMENTS TABLE — READ ACCESS POLICY
-- =============================================================================
-- The catalog browser uses Supabase's anon (public) key to read monuments.
-- For that to work, Row Level Security must either be off, or a SELECT policy
-- must exist that allows the anon role to read.
--
-- Pick ONE of the two options below and run it in: Supabase → SQL Editor.
-- =============================================================================


-- ============================================================
-- OPTION A — RLS ON, public read (recommended)
-- Anyone with the anon key can READ monuments. They cannot insert/update/delete
-- because no policies are granted for those operations. The tagger uploads using
-- the service_role key (which bypasses RLS), so uploads keep working.
-- ============================================================

alter table public.monuments enable row level security;

drop policy if exists "monuments_public_read" on public.monuments;

create policy "monuments_public_read"
on public.monuments
for select
to anon, authenticated
using (true);


-- ============================================================
-- OPTION B — RLS OFF (simpler, less safe — only if portal is private)
-- Use this only if you're sure the portal URL won't be exposed publicly.
-- ============================================================

-- alter table public.monuments disable row level security;
