-- =============================================================================
-- 20260706_cemetery_casing_cleanup.sql
-- =============================================================================
-- Directive 2026-07-06 Part 4 — cemetery name cleanup, AUDIT-FIRST.
--
-- WHAT THIS RUNS NOW (safe, pure casing/punctuation):
--   1. title_case_cemetery(text) — Title Case with rules:
--        'St'/'st.' → 'St.'   'Mt'/'mt.' → 'Mt.'
--        'of'/'the'/'and' lowercase mid-name (never the first word)
--        short ALL-CAPS tokens inside a MIXED-case name are preserved as
--        deliberate acronyms; a fully-uppercase name is title-cased whole
--        ("HOLY CROSS CEMETERY" → "Holy Cross Cemetery",
--         "ST GERTRUDE" → "St. Gertrude")
--   2. Applies it to cemeteries.name and cemetery_orders.cemetery_name
--      (the only two places cemetery names are STORED as text — orders/jobs/
--      batches reference cemeteries by FK, so every display picks this up).
--      Every change is logged in _cemetery_casing_log (before/after).
--
-- WHAT THIS ONLY *DEFINES* (DOES NOT RUN — per directive, merges are Paul's
-- per-pair call):
--   3. merge_cemetery(from_name, to_name) — rewrites all references
--      (orders.cemetery_id, work_batches.destination_cemetery_id,
--      cemetery_orders.cemetery_name), logs to _cemetery_merge_log, then
--      removes the duplicate cemetery row(s). Run per approved pair:
--        select public.merge_cemetery('Mt Lebanan', 'Mount Lebanon Cemetery');
--
-- Duplicate DETECTION runs as ad-hoc queries (report generated separately);
-- pg_trgm is enabled here for similarity().
--
-- Idempotent — safe to re-run (re-running the casing pass is a no-op).
-- =============================================================================

create extension if not exists pg_trgm;

-- ── 1. Title Case helper ─────────────────────────────────────────────────────
create or replace function public.title_case_cemetery(input text)
returns text
language plpgsql
immutable
as $$
declare
  tokens     text[];
  t          text;
  fixed      text;
  out_tokens text[] := '{}';
  i          int := 0;
  lower_t    text;
  all_upper  boolean;
begin
  if input is null or btrim(input) = '' then return input; end if;
  all_upper := (upper(input) = input);
  tokens := regexp_split_to_array(btrim(regexp_replace(input, '\s+', ' ', 'g')), ' ');
  foreach t in array tokens loop
    i := i + 1;
    lower_t := lower(t);
    if lower_t in ('st', 'st.') then
      fixed := 'St.';
    elsif lower_t in ('mt', 'mt.') then
      fixed := 'Mt.';
    elsif i > 1 and lower_t in ('of', 'the', 'and') then
      fixed := lower_t;
    elsif not all_upper and t ~ '^[A-Z]{2,4}$' then
      -- mixed-case name → short ALL-CAPS token is a deliberate acronym; keep
      fixed := t;
    else
      -- initcap capitalizes after apostrophes too ("mary's" → "Mary'S");
      -- put possessive 's back down.
      fixed := regexp_replace(initcap(lower_t), '''S($|\M)', '''s', 'g');
    end if;
    out_tokens := out_tokens || fixed;
  end loop;
  return array_to_string(out_tokens, ' ');
end $$;

-- ── 2. Casing pass over the two stored-name columns (logged) ────────────────
create table if not exists public._cemetery_casing_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  row_id      text not null,
  before_name text not null,
  after_name  text not null,
  changed_at  timestamptz not null default now()
);
-- Internal audit table: RLS on, no policies → invisible to app roles.
alter table public._cemetery_casing_log enable row level security;

insert into public._cemetery_casing_log (table_name, row_id, before_name, after_name)
select 'cemeteries', c.id::text, c.name, public.title_case_cemetery(c.name)
from public.cemeteries c
where c.name is distinct from public.title_case_cemetery(c.name);

update public.cemeteries
set name = public.title_case_cemetery(name)
where name is distinct from public.title_case_cemetery(name);

insert into public._cemetery_casing_log (table_name, row_id, before_name, after_name)
select 'cemetery_orders', co.id::text, co.cemetery_name, public.title_case_cemetery(co.cemetery_name)
from public.cemetery_orders co
where co.cemetery_name is distinct from public.title_case_cemetery(co.cemetery_name);

update public.cemetery_orders
set cemetery_name = public.title_case_cemetery(cemetery_name)
where cemetery_name is distinct from public.title_case_cemetery(cemetery_name);

-- ── 3. merge_cemetery — DEFINED ONLY, runs per Paul-approved pair ────────────
create table if not exists public._cemetery_merge_log (
  id                  bigint generated always as identity primary key,
  from_name           text not null,
  to_name             text not null,
  from_ids            uuid[] not null,
  to_id               uuid not null,
  orders_moved        int not null,
  batches_moved       int not null,
  cemetery_orders_renamed int not null,
  merged_at           timestamptz not null default now()
);
alter table public._cemetery_merge_log enable row level security;

create or replace function public.merge_cemetery(from_name text, to_name text)
returns jsonb
language plpgsql
as $$
declare
  v_to_id    uuid;
  v_from_ids uuid[];
  n_orders   int := 0;
  n_batches  int := 0;
  n_couts    int := 0;
begin
  -- Target must resolve to exactly one cemetery row.
  select array_agg(id) into v_from_ids from (
    select id from public.cemeteries where name = from_name
  ) s;
  if v_from_ids is null then
    raise exception 'merge_cemetery: no cemetery named %', from_name;
  end if;

  begin
    select id into strict v_to_id from public.cemeteries
    where name = to_name and not (id = any(v_from_ids));
  exception
    when no_data_found then
      raise exception 'merge_cemetery: no cemetery named %', to_name;
    when too_many_rows then
      raise exception 'merge_cemetery: % matches multiple rows — merge those duplicates first (they share a name; use merge_cemetery_by_id)', to_name;
  end;

  update public.orders set cemetery_id = v_to_id
  where cemetery_id = any(v_from_ids);
  get diagnostics n_orders = row_count;

  update public.work_batches set destination_cemetery_id = v_to_id
  where destination_cemetery_id = any(v_from_ids);
  get diagnostics n_batches = row_count;

  update public.cemetery_orders set cemetery_name = to_name
  where cemetery_name = from_name;
  get diagnostics n_couts = row_count;

  insert into public._cemetery_merge_log
    (from_name, to_name, from_ids, to_id, orders_moved, batches_moved, cemetery_orders_renamed)
  values (from_name, to_name, v_from_ids, v_to_id, n_orders, n_batches, n_couts);

  delete from public.cemeteries where id = any(v_from_ids);

  return jsonb_build_object(
    'from', from_name, 'to', to_name,
    'orders_moved', n_orders, 'batches_moved', n_batches,
    'cemetery_orders_renamed', n_couts,
    'duplicate_rows_removed', coalesce(array_length(v_from_ids, 1), 0)
  );
end $$;

-- Exact-duplicate variant (several rows share ONE name, e.g. 'Hillside
-- Cemetery' ×3): collapse by id into a chosen survivor.
create or replace function public.merge_cemetery_by_id(from_id uuid, to_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_from_name text;
  v_to_name   text;
  n_orders  int := 0;
  n_batches int := 0;
begin
  select name into strict v_from_name from public.cemeteries where id = from_id;
  select name into strict v_to_name   from public.cemeteries where id = to_id;

  update public.orders set cemetery_id = to_id where cemetery_id = from_id;
  get diagnostics n_orders = row_count;

  update public.work_batches set destination_cemetery_id = to_id
  where destination_cemetery_id = from_id;
  get diagnostics n_batches = row_count;

  insert into public._cemetery_merge_log
    (from_name, to_name, from_ids, to_id, orders_moved, batches_moved, cemetery_orders_renamed)
  values (v_from_name, v_to_name, array[from_id], to_id, n_orders, n_batches, 0);

  delete from public.cemeteries where id = from_id;

  return jsonb_build_object(
    'from', v_from_name, 'from_id', from_id, 'to', v_to_name, 'to_id', to_id,
    'orders_moved', n_orders, 'batches_moved', n_batches
  );
end $$;
