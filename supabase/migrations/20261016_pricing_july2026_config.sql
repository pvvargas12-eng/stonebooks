-- PRICING JULY 2026 (2026-10-16) — Paul's new price sheet (dated 07/28/2026)
-- merged into the SAVED pricing_config overlay. ✅ APPLIED 2026-10-16 via the
-- Management API. Code defaults changed in the same commit (orderRates.js,
-- monumentCatalog.js, SalesMode.jsx ADD_ONS_CATALOG); this keeps the stored
-- overlay (which wins over code) in step with them.
--
-- Backup of the prior row: _pricing_config_backup_20261016 (tenant_id, config,
-- updated_at, backed_up_at). UNDO = update pricing_config p set config = b.config
--   from _pricing_config_backup_20261016 b where b.tenant_id = p.tenant_id;

create table if not exists _pricing_config_backup_20261016 as
  select tenant_id, config, updated_at, now() as backed_up_at from pricing_config;

update pricing_config set
  config = jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(config,
    '{diePrices}', coalesce(config->'diePrices','{}'::jsonb) || '{"24x12x4":1195,"24x14x4":1295,"hickey-2-0x1-0x0-8":1595,"slant-2-6":2795,"die-1-10":2895,"die-2-0":3195,"die-2-4":3795,"die-2-8":4575,"die-3-0":4975,"die-3-6":5595,"ddie-3-6":5595,"ddie-4-0":6384,"ddie-4-6":7182,"ddie-5-0":7980,"ddie-6-0":9576}'::jsonb),
    '{baseSizePrices}', coalesce(config->'baseSizePrices','{}'::jsonb) || '{"base-2-6x1-2":895,"base-3-0x1-2":1295,"base-3-6x1-2":1595,"base-4-0x1-2":1995,"base-2-0x1-0":340,"base-2-4x1-0":395,"base-2-6x1-0":425,"base-2-8x1-0":450,"base-3-6x1-0":612,"base-4-0x1-0":680}'::jsonb),
    '{baseHeights}', '{"6":145,"8":170,"10":195,"12":225}'::jsonb),
    '{perUnit}', coalesce(config->'perUnit','{}'::jsonb) || '{"customDiePerSqIn":4.75,"basePolishMarginPerFoot":55,"steelSidePerFoot":75,"polishSidePerFoot":{"8":105,"10":115,"12":125}}'::jsonb),
    '{addOnPrices}', coalesce(config->'addOnPrices','{}'::jsonb) || '{"granite-vet":650,"lett-mdy":550,"panel":195}'::jsonb),
    '{inscriptionTiers}', coalesce(config->'inscriptionTiers','{}'::jsonb) || '{"mdy":550}'::jsonb),
  updated_at = now()
where tenant_id = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789';
