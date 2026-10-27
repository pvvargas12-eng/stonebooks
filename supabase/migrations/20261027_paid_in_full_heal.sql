-- =============================================================================
-- PAID-IN-FULL HEAL (2026-10-27) — fully paid orders whose status never flipped
-- =============================================================================
-- Paul: "if the balance is paid it should be paid in full... If there are others
-- with a 0.00 balance and not labeled paid in full then fix it as well."
--
-- The 20 ids below were found by pricing every live order through the engine
-- (scratchpad audit_paid.mjs: engine grand total vs locked non-voided payments,
-- compared at the cent). Each is paid to the cent (a few overpaid) and still
-- reads contracted / in_production. Friend E-26-0614 itself was a floating-
-- point residual (9e-13) — fixed in code (rowBalanceCents), no row touched.
--
-- Mirrors what recordOrderPayment's _paymentsColumnPatch does on the next
-- payment: status -> paid_in_full with the prior status snapshotted in
-- status_before_paid_in_full (the M2 revert convention). Guarded: only rows
-- still at contracted / in_production move; re-running is a no-op.
--
-- UNDO:
--   update orders o set status = l.status_before, status_before_paid_in_full = l.sbpif_before,
--     updated_at = l.updated_at_before
--   from _paid_in_full_heal_20261027 l where l.order_id = o.id;
-- =============================================================================
begin;

create table if not exists _paid_in_full_heal_20261027 (
  order_id uuid primary key,
  order_number text,
  status_before text,
  sbpif_before text,
  updated_at_before timestamptz,
  healed_at timestamptz not null default now()
);

insert into _paid_in_full_heal_20261027 (order_id, order_number, status_before, sbpif_before, updated_at_before)
select id, order_number, status, status_before_paid_in_full, updated_at
from orders
where id in ('f6459e70-a547-4626-a4ca-bf1c3818464f','b6e9d1aa-d053-4f0d-a1a0-1400d7c8117b','8ed0ce5d-866f-4e6f-91df-3f48f6c42a3e','fa84c532-93b3-48bb-9c6f-f679c2590ac8','2b8dcd29-d9e3-449c-9a12-23957975794d','1a03be26-746e-40d0-998e-ac826e6b0591','93d02110-8ea4-41fd-80d8-e4e3a37794a3','8887c2a1-9d96-4b75-b7f6-baa945d25ba4','5a7aece6-4061-4f0a-bad8-4512e5890a62','e0a10f52-6540-4efb-bbbd-5e35be4e2866','07ac816a-1b6d-499e-941a-89a5f083fc45','c44cbdee-6960-4831-93e9-afeb4d8677aa','745a87ab-7407-411b-9d81-742fc27e5496','b7b5370b-4228-4f75-b5d0-e93525bd4282','36a41926-ff42-4cc7-bb45-0e7d32171001','0246f49f-6a99-420b-a311-c1a9c90d5ded','a53cbf75-f5ea-4398-892b-21f94296b361','aa73bbb7-e1bf-4f95-90c5-6f22a89b20d1','014cb421-2eb4-417d-81b7-4b1934dddbf7','c851ae01-c0f5-488e-83a4-5b5904b177ea')
  and status in ('contracted', 'in_production')
on conflict (order_id) do nothing;

update orders o
set status = 'paid_in_full',
    status_before_paid_in_full = o.status
from _paid_in_full_heal_20261027 l
where l.order_id = o.id
  and o.status in ('contracted', 'in_production');

do $$
declare n int;
begin
  select count(*) into n from orders where id in (select order_id from _paid_in_full_heal_20261027) and status <> 'paid_in_full';
  if n > 0 then raise exception 'heal incomplete: % rows not paid_in_full', n; end if;
end $$;

commit;

select l.order_number, l.status_before, o.status as status_now, o.status_before_paid_in_full
from _paid_in_full_heal_20261027 l join orders o on o.id = l.order_id order by l.order_number;
