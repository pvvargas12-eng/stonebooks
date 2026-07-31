-- PERMIT-MULTI-CEM (2026-07-31): one permit form, several cemeteries.
-- Paul: "i need to be able to select multiple cemeteries for what cemetery
-- that permit is for because some permits are the same for different
-- cemeteries." cemetery_id stays the PRIMARY binding; extra_cemetery_ids is
-- a jsonb uuid array of additional cemeteries the template also serves.
-- Matching = primary OR listed in extras (templateMatchesCemetery).
alter table permit_templates add column if not exists extra_cemetery_ids jsonb not null default '[]'::jsonb;
