-- MDY inscription back to Paul's $595 (2026-10-22). PERMIT-QUICK (10-20) set the code to 595 but the saved overlay
-- still carried 550 from the 10-16 migration and the overlay wins. Signed orders are pinned (signedLines), so this
-- moves only unsigned quotes/leads. UNDO: update pricing_config p set config = b.config from _pricing_config_backup_20261022 b where b.tenant_id = p.tenant_id;
create table if not exists _pricing_config_backup_20261022 as
  select tenant_id, config, updated_at, now() as backed_up_at from pricing_config;
update pricing_config set
  config = jsonb_set(jsonb_set(config, '{inscriptionTiers,mdy}', '595'::jsonb), '{addOnPrices,lett-mdy}', '595'::jsonb),
  updated_at = now()
where tenant_id = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789';
select jsonb_build_object('backup_rows', (select count(*) from _pricing_config_backup_20261022),
  'backup_mdy', (select config->'inscriptionTiers'->'mdy' from _pricing_config_backup_20261022),
  'tier_now', config->'inscriptionTiers'->'mdy', 'addon_now', config->'addOnPrices'->'lett-mdy', 'updated', updated_at) as r
from pricing_config;
