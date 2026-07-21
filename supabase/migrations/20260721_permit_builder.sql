-- =============================================================================
-- PB-1: Permit Builder (2026-07-21)
-- =============================================================================
-- permit_templates — one row per cemetery permit FORM. pages[] holds the blank
-- form's page images (uploaded to orders-attachments-public under
-- permit-templates/); fields[] holds the autofill-bound text boxes placed on
-- the blank; layout_slot marks where the monument layout drawing goes.
-- All geometry is stored as FRACTIONS of the page (0-1) so any render size —
-- editor canvas or jsPDF export — resolves identically.
--
-- permit_docs — one row per BUILT permit for an order. data jsonb carries the
-- editable instance: field values + per-field position/size overrides, ad-hoc
-- extra boxes, the placed layout (src, frame, pan/zoom crop, back-page mode),
-- and dimension annotations. Status/fees are NOT duplicated here — the builder
-- writes orders.permit_status and orders.permit[] through the existing rails.
-- =============================================================================

create table if not exists permit_templates (
  id          uuid primary key default gen_random_uuid(),
  cemetery_id uuid references cemeteries(id) on delete set null,
  title       text not null,
  pages       jsonb not null default '[]'::jsonb,
  fields      jsonb not null default '[]'::jsonb,
  layout_slot jsonb,
  notes       text,
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_permit_templates_cemetery on permit_templates(cemetery_id) where not archived;

create table if not exists permit_docs (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  template_id uuid references permit_templates(id) on delete set null,
  cemetery_id uuid,
  title       text,
  data        jsonb not null default '{}'::jsonb,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_permit_docs_order on permit_docs(order_id);
create index if not exists idx_permit_docs_updated on permit_docs(updated_at desc);

alter table permit_templates enable row level security;
alter table permit_docs enable row level security;

drop policy if exists staff_all on permit_templates;
create policy staff_all on permit_templates
  for all to authenticated using (is_staff()) with check (is_staff());

drop policy if exists staff_all on permit_docs;
create policy staff_all on permit_docs
  for all to authenticated using (is_staff()) with check (is_staff());
