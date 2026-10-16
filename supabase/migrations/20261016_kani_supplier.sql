-- QUOTE-GEN (2026-10-16) — Kani International as a stone SUPPLIER for the PR
-- builder. ordering_vendors already carried "KANI INTERNATIONAL" (the order
-- page's Vendor field); the PR builder's supplier dropdown reads `suppliers`,
-- which only had PEERLESS / PEPIN GRANITE CO. / TECSTONE. Paul: "if I select
-- to go with Kani I want to know to place the order to him — when I go to
-- build a PR have the vendor name with the order so I know it goes to Kani."
-- Idempotent. ✅ APPLIED 2026-10-16 via the Management API.
insert into suppliers (name, kinds, active, notes)
select 'KANI INTERNATIONAL', array['stone']::text[], true, 'Price List 2026 — groups A–H by color. Added by the Quote Generator build.'
where not exists (select 1 from suppliers where upper(name) like 'KANI%');
