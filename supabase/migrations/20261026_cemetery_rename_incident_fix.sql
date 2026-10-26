-- =============================================================================
-- CEMETERY RENAME INCIDENT FIX (2026-10-26) -- data restore, Paul's go required
-- =============================================================================
-- What happened (proved from permit-fee activity notes, the 2026-07-06 merge log,
-- permit template bindings and updated_at fingerprints -- see CLAUDE.md round
-- CEM-RENAME-INCIDENT): SalesMode's upsertCemetery UPDATEd the LINKED library
-- row with whatever the order form held, NAME INCLUDED. Typing a different
-- cemetery over a linked order renamed the shared row for every order on it.
--
--   a84bb135  "Beth Israel Cemetery" (seed row, 6 permit templates, 73 orders)
--             -> renamed "Beth Abraham Cemetery" / East Brunswick at
--             2026-10-21 17:40:28Z by the save of draft E-26-0952 (Wermuth, Maxine).
--   2c45b7df  "Resurrection Cemetery - Piscataway" (2026-07-06 merge keeper,
--             Diocese of Metuchen permit template) -> renamed "Resurrection
--             Cemetery - Staten Island" + Staten Island address/phone on
--             2026-08-26 ~18:49Z while E-26-0288 (Garra, Bill) was edited; the
--             19:32Z permit note already reads Staten Island, so 0288 IS the
--             genuine Staten Island order.
--   b0000000-...-0003  seed demo row "Resurrection Cemetery - Toms River" (0 real
--             orders on 2026-07-06) -> renamed plain "Resurrection Cemetery",
--             city "Pisc" by 2026-08-31; staff then re-pointed 7 Piscataway
--             orders onto it to escape "Staten Island".
--   b39209a0  "Forest Lawn Memorial Park" -> "Forest Lawn" (Sept) -> "Forest Lawn
--             - MOUNT LEB CEMETERY" at 2026-10-24 17:09:05Z by the save of draft
--             E-26-0979 (Brown, Michael).
--   e5d86be1  a second "Beth Israel Cemetery" (city null) created 2026-09-22 by
--             E-26-0832's save (lookup-or-create miss); 5 orders landed there.
--
-- Also surfaced (hand merge, NOT this hole): a row named "ST STANILAUS" /
-- "SAINT STANS" was merged into Sacred Heart Cemetery (South Amboy) on
-- 2026-10-16 -- orders E-26-0143, 0187, 0406, 0777 carried St. Stanislaus permit
-- notes. Block E below moves them to "St Stanislaus Cemetery" (Sayreville);
-- strike block E before applying if Paul says that merge was right.
--
-- Every row this file touches is snapshotted into _cemetery_fix_20261026_log
-- first. UNDO at the bottom. One transaction: any failure rolls everything back.
-- Apply through the Management API (memory: project_stonebooks_prod_sql.md).
-- =============================================================================
begin;

create table if not exists _cemetery_fix_20261026_log (
  id bigserial primary key,
  step text not null,          -- 'before' | 'after'
  table_name text not null,
  row_id text not null,
  snapshot jsonb,
  note text,
  logged_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 0. BEFORE-IMAGES
-- ---------------------------------------------------------------------------
insert into _cemetery_fix_20261026_log (step, table_name, row_id, snapshot, note)
select 'before', 'cemeteries', c.id::text, to_jsonb(c), 'cemetery row before the fix'
from cemeteries c
where c.id in ('a84bb135-f9d7-42d1-94b4-9e36359a343f',   -- Beth Israel (reads Beth Abraham)
               'e5d86be1-3a9e-41de-8f60-f42f253e7413',   -- Beth Israel duplicate (2026-09-22)
               '2c45b7df-2855-462c-8114-a928ac11857c',   -- Piscataway (reads Staten Island)
               'b0000000-0000-4000-8000-000000000003',   -- ex Toms River demo (reads Resurrection Cemetery / Pisc)
               'b39209a0-e8ff-408e-bfe0-03646e709c9c',   -- Forest Lawn (reads ... - MOUNT LEB CEMETERY)
               'd2652496-d1f7-4785-a233-c657ab8faf2a',   -- Sacred Heart (block E source)
               '8354e30d-d9de-4578-815d-b260a8cc517b');  -- St Stanislaus (block E target)

insert into _cemetery_fix_20261026_log (step, table_name, row_id, snapshot, note)
select 'before', 'orders', o.id::text,
       jsonb_build_object('order_number', o.order_number, 'cemetery_id', o.cemetery_id, 'updated_at', o.updated_at),
       'order cemetery link before the fix'
from orders o
where o.cemetery_id in ('e5d86be1-3a9e-41de-8f60-f42f253e7413', 'b0000000-0000-4000-8000-000000000003')
   or o.order_number in ('E-26-0952', 'E-26-0288', 'E-26-0143', 'E-26-0187', 'E-26-0406', 'E-26-0777');

insert into _cemetery_fix_20261026_log (step, table_name, row_id, snapshot, note)
select 'before', 'work_batches', b.id::text, jsonb_build_object('destination_cemetery_id', b.destination_cemetery_id), 'batch destination before the fix'
from work_batches b where b.destination_cemetery_id in ('e5d86be1-3a9e-41de-8f60-f42f253e7413', 'b0000000-0000-4000-8000-000000000003');
insert into _cemetery_fix_20261026_log (step, table_name, row_id, snapshot, note)
select 'before', 'permit_docs', d.id::text, jsonb_build_object('cemetery_id', d.cemetery_id), 'permit doc before the fix'
from permit_docs d where d.cemetery_id in ('e5d86be1-3a9e-41de-8f60-f42f253e7413', 'b0000000-0000-4000-8000-000000000003');
insert into _cemetery_fix_20261026_log (step, table_name, row_id, snapshot, note)
select 'before', 'permit_templates', t.id::text, jsonb_build_object('cemetery_id', t.cemetery_id, 'extra_cemetery_ids', t.extra_cemetery_ids), 'template before the fix'
from permit_templates t where t.cemetery_id in ('e5d86be1-3a9e-41de-8f60-f42f253e7413', 'b0000000-0000-4000-8000-000000000003')
   or t.extra_cemetery_ids @> '["e5d86be1-3a9e-41de-8f60-f42f253e7413"]'::jsonb
   or t.extra_cemetery_ids @> '["b0000000-0000-4000-8000-000000000003"]'::jsonb;
insert into _cemetery_fix_20261026_log (step, table_name, row_id, snapshot, note)
select 'before', 'cemetery_maps', m.id::text, jsonb_build_object('cemetery_id', m.cemetery_id), 'map page before the fix'
from cemetery_maps m where m.cemetery_id in ('e5d86be1-3a9e-41de-8f60-f42f253e7413', 'b0000000-0000-4000-8000-000000000003');
insert into _cemetery_fix_20261026_log (step, table_name, row_id, snapshot, note)
select 'before', 'cemetery_map_pins', p.id::text, jsonb_build_object('cemetery_id', p.cemetery_id), 'map pin before the fix'
from cemetery_map_pins p where p.cemetery_id in ('e5d86be1-3a9e-41de-8f60-f42f253e7413', 'b0000000-0000-4000-8000-000000000003');
insert into _cemetery_fix_20261026_log (step, table_name, row_id, snapshot, note)
select 'before', 'install_reminders', r.id::text, jsonb_build_object('cemetery_id', r.cemetery_id), 'install reminder before the fix'
from install_reminders r where r.cemetery_id in ('e5d86be1-3a9e-41de-8f60-f42f253e7413', 'b0000000-0000-4000-8000-000000000003');

-- Re-pointing a cemetery link is not an edit of the order: keep updated_at still.
alter table orders disable trigger orders_touch_updated_at;

-- ---------------------------------------------------------------------------
-- A. BETH ISRAEL gets its row back; Beth Abraham becomes its own row
-- ---------------------------------------------------------------------------
-- A1. the keeper (templates, 74 built permits, 73 orders) gets its name back.
--     City: Beth Israel Cemetery is in Woodbridge; "East Brunswick" was typed
--     with the Beth Abraham name on 2026-10-21 (the before-image keeps it).
update cemeteries
   set name = 'Beth Israel Cemetery', city = 'Woodbridge'
 where id = 'a84bb135-f9d7-42d1-94b4-9e36359a343f' and name = 'Beth Abraham Cemetery';

-- A2. fold the 2026-09-22 duplicate (5 orders, nothing else) into the keeper.
update orders set cemetery_id = 'a84bb135-f9d7-42d1-94b4-9e36359a343f' where cemetery_id = 'e5d86be1-3a9e-41de-8f60-f42f253e7413';
update permit_templates set cemetery_id = 'a84bb135-f9d7-42d1-94b4-9e36359a343f' where cemetery_id = 'e5d86be1-3a9e-41de-8f60-f42f253e7413';
update permit_docs set cemetery_id = 'a84bb135-f9d7-42d1-94b4-9e36359a343f' where cemetery_id = 'e5d86be1-3a9e-41de-8f60-f42f253e7413';
update cemetery_maps set cemetery_id = 'a84bb135-f9d7-42d1-94b4-9e36359a343f' where cemetery_id = 'e5d86be1-3a9e-41de-8f60-f42f253e7413';
update cemetery_map_pins set cemetery_id = 'a84bb135-f9d7-42d1-94b4-9e36359a343f' where cemetery_id = 'e5d86be1-3a9e-41de-8f60-f42f253e7413';
update install_reminders set cemetery_id = 'a84bb135-f9d7-42d1-94b4-9e36359a343f' where cemetery_id = 'e5d86be1-3a9e-41de-8f60-f42f253e7413';
update work_batches set destination_cemetery_id = 'a84bb135-f9d7-42d1-94b4-9e36359a343f' where destination_cemetery_id = 'e5d86be1-3a9e-41de-8f60-f42f253e7413';
update permit_templates
   set extra_cemetery_ids = (select coalesce(jsonb_agg(distinct case when e = 'e5d86be1-3a9e-41de-8f60-f42f253e7413' then 'a84bb135-f9d7-42d1-94b4-9e36359a343f' else e end), '[]'::jsonb)
                               from jsonb_array_elements_text(extra_cemetery_ids) e
                              where (case when e = 'e5d86be1-3a9e-41de-8f60-f42f253e7413' then 'a84bb135-f9d7-42d1-94b4-9e36359a343f' else e end) <> cemetery_id::text)
 where extra_cemetery_ids @> '["e5d86be1-3a9e-41de-8f60-f42f253e7413"]'::jsonb;
delete from cemeteries
 where id = 'e5d86be1-3a9e-41de-8f60-f42f253e7413'
   and not exists (select 1 from orders where cemetery_id = 'e5d86be1-3a9e-41de-8f60-f42f253e7413');

-- A3. Beth Abraham Cemetery as its own row; only the order whose editor typed
--     it (E-26-0952, Wermuth, Maxine -- Paul's call, see the report) moves there.
insert into cemeteries (id, tenant_id, name, city, state)
values ('72fb0aa2-fa70-4530-8f7a-f441e4058b57', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'Beth Abraham Cemetery', 'East Brunswick', 'NJ');
update orders set cemetery_id = '72fb0aa2-fa70-4530-8f7a-f441e4058b57'
 where order_number = 'E-26-0952' and cemetery_id = 'a84bb135-f9d7-42d1-94b4-9e36359a343f';

-- ---------------------------------------------------------------------------
-- B. RESURRECTION PISCATAWAY gets its row back; Staten Island becomes its own
-- ---------------------------------------------------------------------------
-- B1. the keeper gets Piscataway back. The Staten Island address/zip/phone were
--     typed for E-26-0288 on 2026-08-26 and move to the new Staten Island row.
update cemeteries
   set name = 'Resurrection Cemetery ' || chr(8212) || ' Piscataway', city = 'Piscataway',
       address = null, zip = null, contact_phone = null
 where id = '2c45b7df-2855-462c-8114-a928ac11857c' and name like 'Resurrection Cemetery%Staten Island';

-- B2. Resurrection Cemetery, Staten Island NY (361 Sharrott Ave) as its own row.
insert into cemeteries (id, tenant_id, name, address, city, state, zip, contact_phone)
values ('784a01ed-32ba-4ddc-bf32-eb4a81d4568e', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
        'Resurrection Cemetery ' || chr(8212) || ' Staten Island', '361 Sharrott Ave', 'Staten Island', 'NY', '10309', '7183567738');
update orders set cemetery_id = '784a01ed-32ba-4ddc-bf32-eb4a81d4568e'
 where order_number = 'E-26-0288' and cemetery_id = '2c45b7df-2855-462c-8114-a928ac11857c';

-- B3. fold the consumed Toms River demo row (7 Piscataway orders, 1 scheduled
--     run) into the Piscataway keeper. Its demo geocode is NOT carried over.
update orders set cemetery_id = '2c45b7df-2855-462c-8114-a928ac11857c' where cemetery_id = 'b0000000-0000-4000-8000-000000000003';
update permit_templates set cemetery_id = '2c45b7df-2855-462c-8114-a928ac11857c' where cemetery_id = 'b0000000-0000-4000-8000-000000000003';
update permit_docs set cemetery_id = '2c45b7df-2855-462c-8114-a928ac11857c' where cemetery_id = 'b0000000-0000-4000-8000-000000000003';
update cemetery_maps set cemetery_id = '2c45b7df-2855-462c-8114-a928ac11857c' where cemetery_id = 'b0000000-0000-4000-8000-000000000003';
update cemetery_map_pins set cemetery_id = '2c45b7df-2855-462c-8114-a928ac11857c' where cemetery_id = 'b0000000-0000-4000-8000-000000000003';
update install_reminders set cemetery_id = '2c45b7df-2855-462c-8114-a928ac11857c' where cemetery_id = 'b0000000-0000-4000-8000-000000000003';
update work_batches set destination_cemetery_id = '2c45b7df-2855-462c-8114-a928ac11857c' where destination_cemetery_id = 'b0000000-0000-4000-8000-000000000003';
update permit_templates
   set extra_cemetery_ids = (select coalesce(jsonb_agg(distinct case when e = 'b0000000-0000-4000-8000-000000000003' then '2c45b7df-2855-462c-8114-a928ac11857c' else e end), '[]'::jsonb)
                               from jsonb_array_elements_text(extra_cemetery_ids) e
                              where (case when e = 'b0000000-0000-4000-8000-000000000003' then '2c45b7df-2855-462c-8114-a928ac11857c' else e end) <> cemetery_id::text)
 where extra_cemetery_ids @> '["b0000000-0000-4000-8000-000000000003"]'::jsonb;
delete from cemeteries
 where id = 'b0000000-0000-4000-8000-000000000003'
   and not exists (select 1 from orders where cemetery_id = 'b0000000-0000-4000-8000-000000000003')
   and not exists (select 1 from work_batches where destination_cemetery_id = 'b0000000-0000-4000-8000-000000000003');

-- ---------------------------------------------------------------------------
-- C. FOREST LAWN gets its name back (E-26-0979 stays here -- Paul's call)
-- ---------------------------------------------------------------------------
update cemeteries set name = 'Forest Lawn Memorial Park'
 where id = 'b39209a0-e8ff-408e-bfe0-03646e709c9c' and name = 'Forest Lawn - MOUNT LEB CEMETERY';

-- ---------------------------------------------------------------------------
-- E. ST. STANISLAUS orders that the 2026-10-16 hand merge put under Sacred Heart
--    (strike this block if Paul says that merge was right)
-- ---------------------------------------------------------------------------
update orders set cemetery_id = '8354e30d-d9de-4578-815d-b260a8cc517b'
 where order_number in ('E-26-0143', 'E-26-0187', 'E-26-0406', 'E-26-0777')
   and cemetery_id = 'd2652496-d1f7-4785-a233-c657ab8faf2a';

alter table orders enable trigger orders_touch_updated_at;

-- ---------------------------------------------------------------------------
-- F. AFTER-IMAGES + ASSERTIONS (any failure rolls the whole file back)
-- ---------------------------------------------------------------------------
insert into _cemetery_fix_20261026_log (step, table_name, row_id, snapshot, note)
select 'after', 'cemeteries', c.id::text, to_jsonb(c), 'cemetery row after the fix'
from cemeteries c
where c.id in ('a84bb135-f9d7-42d1-94b4-9e36359a343f', '2c45b7df-2855-462c-8114-a928ac11857c',
               'b39209a0-e8ff-408e-bfe0-03646e709c9c', '72fb0aa2-fa70-4530-8f7a-f441e4058b57',
               '784a01ed-32ba-4ddc-bf32-eb4a81d4568e');
insert into _cemetery_fix_20261026_log (step, table_name, row_id, snapshot, note)
select 'after', 'orders', o.id::text, jsonb_build_object('order_number', o.order_number, 'cemetery_id', o.cemetery_id), 'order cemetery link after the fix'
from orders o where o.id::text in (select row_id from _cemetery_fix_20261026_log where step = 'before' and table_name = 'orders');

do $$
declare n int;
begin
  if exists (select 1 from cemeteries where id in ('e5d86be1-3a9e-41de-8f60-f42f253e7413', 'b0000000-0000-4000-8000-000000000003')) then
    raise exception 'duplicate rows still present';
  end if;
  select count(*) into n from orders where cemetery_id = 'a84bb135-f9d7-42d1-94b4-9e36359a343f';
  if n <> 77 then raise exception 'Beth Israel expected 77 orders, got %', n; end if;
  select count(*) into n from orders where cemetery_id = '72fb0aa2-fa70-4530-8f7a-f441e4058b57';
  if n <> 1 then raise exception 'Beth Abraham expected 1 order, got %', n; end if;
  select count(*) into n from orders where cemetery_id = '2c45b7df-2855-462c-8114-a928ac11857c';
  if n <> 10 then raise exception 'Resurrection Piscataway expected 10 orders, got %', n; end if;
  select count(*) into n from orders where cemetery_id = '784a01ed-32ba-4ddc-bf32-eb4a81d4568e';
  if n <> 1 then raise exception 'Resurrection Staten Island expected 1 order, got %', n; end if;
  select count(*) into n from orders o
   where o.cemetery_id is null and o.id::text in (select row_id from _cemetery_fix_20261026_log where step = 'before' and table_name = 'orders');
  if n <> 0 then raise exception '% touched orders lost their cemetery', n; end if;
  if (select name from cemeteries where id = 'a84bb135-f9d7-42d1-94b4-9e36359a343f') <> 'Beth Israel Cemetery' then raise exception 'Beth Israel rename did not apply'; end if;
  if (select name from cemeteries where id = '2c45b7df-2855-462c-8114-a928ac11857c') not like 'Resurrection Cemetery%Piscataway' then raise exception 'Piscataway rename did not apply'; end if;
end $$;

commit;

-- =============================================================================
-- UNDO (one transaction; order matters: rows back first, links second)
-- =============================================================================
-- begin;
-- alter table orders disable trigger orders_touch_updated_at;
-- -- 1. the two deleted rows come back from their before-images
-- insert into cemeteries
-- select (jsonb_populate_record(null::cemeteries, l.snapshot)).*
--   from _cemetery_fix_20261026_log l
--  where l.step = 'before' and l.table_name = 'cemeteries'
--    and l.row_id in ('e5d86be1-3a9e-41de-8f60-f42f253e7413', 'b0000000-0000-4000-8000-000000000003')
--    and not exists (select 1 from cemeteries c where c.id::text = l.row_id);
-- -- 2. every link goes back where it was
-- update orders o set cemetery_id = (l.snapshot->>'cemetery_id')::uuid
--   from _cemetery_fix_20261026_log l where l.step = 'before' and l.table_name = 'orders' and o.id::text = l.row_id;
-- update work_batches b set destination_cemetery_id = (l.snapshot->>'destination_cemetery_id')::uuid
--   from _cemetery_fix_20261026_log l where l.step = 'before' and l.table_name = 'work_batches' and b.id::text = l.row_id;
-- update permit_docs d set cemetery_id = (l.snapshot->>'cemetery_id')::uuid
--   from _cemetery_fix_20261026_log l where l.step = 'before' and l.table_name = 'permit_docs' and d.id::text = l.row_id;
-- update permit_templates t set cemetery_id = (l.snapshot->>'cemetery_id')::uuid, extra_cemetery_ids = l.snapshot->'extra_cemetery_ids'
--   from _cemetery_fix_20261026_log l where l.step = 'before' and l.table_name = 'permit_templates' and t.id::text = l.row_id;
-- update cemetery_maps m set cemetery_id = (l.snapshot->>'cemetery_id')::uuid
--   from _cemetery_fix_20261026_log l where l.step = 'before' and l.table_name = 'cemetery_maps' and m.id::text = l.row_id;
-- update cemetery_map_pins p set cemetery_id = (l.snapshot->>'cemetery_id')::uuid
--   from _cemetery_fix_20261026_log l where l.step = 'before' and l.table_name = 'cemetery_map_pins' and p.id::text = l.row_id;
-- update install_reminders r set cemetery_id = (l.snapshot->>'cemetery_id')::uuid
--   from _cemetery_fix_20261026_log l where l.step = 'before' and l.table_name = 'install_reminders' and r.id::text = l.row_id;
-- -- 3. the renamed rows get their (wrong) names and fields back, exactly as logged
-- update cemeteries c
--    set name = l.snapshot->>'name', city = l.snapshot->>'city', address = l.snapshot->>'address',
--        zip = l.snapshot->>'zip', contact_phone = l.snapshot->>'contact_phone'
--   from _cemetery_fix_20261026_log l
--  where l.step = 'before' and l.table_name = 'cemeteries' and c.id::text = l.row_id
--    and l.row_id in ('a84bb135-f9d7-42d1-94b4-9e36359a343f', '2c45b7df-2855-462c-8114-a928ac11857c', 'b39209a0-e8ff-408e-bfe0-03646e709c9c');
-- -- 4. the two rows this file created go away (nothing points at them any more)
-- delete from cemeteries where id in ('72fb0aa2-fa70-4530-8f7a-f441e4058b57', '784a01ed-32ba-4ddc-bf32-eb4a81d4568e')
--    and not exists (select 1 from orders where cemetery_id = cemeteries.id);
-- alter table orders enable trigger orders_touch_updated_at;
-- commit;
