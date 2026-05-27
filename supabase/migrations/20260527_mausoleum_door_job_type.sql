-- Mausoleum Door — milestone template (seed data, not schema)
-- =============================================================================
-- Adds a milestone_templates row for a new job_type 'mausoleum_door' so door
-- work has substrate. The workflow is two field trips around shop production:
--   • door_pickup  — fetch the door / panel from the mausoleum
--   • door_dropoff — return + install the finished door
-- These two decision points (door_pickup_needed / door_dropoff_needed) feed the
-- Scheduler `door_trip` column.
--
-- Matches the existing template shape: template = { "milestones": [ {key,label,
-- group,team,requires,is_decision,default_status,lead_time_days}, ... ] }.
-- Order is implied by the `requires` chain (there is no sort_order field).
--
-- Run ONCE in Supabase Studio SQL Editor. Idempotent: ON CONFLICT (id) DO
-- NOTHING on the deterministic template id. Safe to re-run.
-- =============================================================================

INSERT INTO milestone_templates (id, tenant_id, job_type, version, template, is_active, notes)
VALUES (
  'f1f1f1f1-0000-4000-8000-000000000001',
  'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  'mausoleum_door',
  1,
  jsonb_build_object('milestones', jsonb_build_array(
    jsonb_build_object('key','contract_signed','label','Contract signed','group','intake','team','sales',
      'requires', jsonb_build_array(), 'is_decision', false, 'default_status','done','lead_time_days', null),
    jsonb_build_object('key','deposit_received','label','Deposit received','group','intake','team','admin',
      'requires', jsonb_build_array('contract_signed'), 'is_decision', false, 'default_status','not_started','lead_time_days', null),
    jsonb_build_object('key','cemetery_confirmed','label','Cemetery confirmed','group','intake','team','admin',
      'requires', jsonb_build_array('deposit_received'), 'is_decision', false, 'default_status','not_started','lead_time_days', null),
    jsonb_build_object('key','door_pickup_needed','label','Door pickup needed','group','field','team','installation',
      'requires', jsonb_build_array('cemetery_confirmed'), 'is_decision', true, 'default_status','not_started','lead_time_days', null),
    jsonb_build_object('key','door_picked_up','label','Door picked up','group','field','team','installation',
      'requires', jsonb_build_array('door_pickup_needed'), 'is_decision', false, 'default_status','not_started','lead_time_days', null),
    jsonb_build_object('key','proof_created','label','Proof created','group','design','team','admin',
      'requires', jsonb_build_array('door_picked_up'), 'is_decision', false, 'default_status','not_started','lead_time_days', null),
    jsonb_build_object('key','proof_approved','label','Proof approved','group','design','team','admin',
      'requires', jsonb_build_array('proof_created'), 'is_decision', true, 'default_status','not_started','lead_time_days', null),
    jsonb_build_object('key','stencil_created','label','Stencil created','group','production','team','production',
      'requires', jsonb_build_array('proof_approved'), 'is_decision', false, 'default_status','not_started','lead_time_days', null),
    jsonb_build_object('key','stencil_cut','label','Stencil cut','group','production','team','production',
      'requires', jsonb_build_array('stencil_created'), 'is_decision', false, 'default_status','not_started','lead_time_days', null),
    jsonb_build_object('key','production_started','label','Production started','group','production','team','production',
      'requires', jsonb_build_array('stencil_cut'), 'is_decision', false, 'default_status','not_started','lead_time_days', null),
    jsonb_build_object('key','production_completed','label','Production completed','group','production','team','production',
      'requires', jsonb_build_array('production_started'), 'is_decision', false, 'default_status','not_started','lead_time_days', null),
    jsonb_build_object('key','door_dropoff_needed','label','Door drop-off needed','group','field','team','installation',
      'requires', jsonb_build_array('production_completed'), 'is_decision', true, 'default_status','not_started','lead_time_days', null),
    jsonb_build_object('key','door_installed','label','Door installed','group','field','team','installation',
      'requires', jsonb_build_array('door_dropoff_needed'), 'is_decision', false, 'default_status','not_started','lead_time_days', null),
    jsonb_build_object('key','completion_photo_uploaded','label','Completion photo uploaded','group','closeout','team','admin',
      'requires', jsonb_build_array('door_installed'), 'is_decision', false, 'default_status','not_started','lead_time_days', null),
    jsonb_build_object('key','customer_notified','label','Customer notified','group','closeout','team','admin',
      'requires', jsonb_build_array('completion_photo_uploaded'), 'is_decision', false, 'default_status','not_started','lead_time_days', null),
    jsonb_build_object('key','paid_in_full','label','Paid in full','group','closeout','team','admin',
      'requires', jsonb_build_array('customer_notified'), 'is_decision', false, 'default_status','not_started','lead_time_days', null),
    jsonb_build_object('key','closed','label','Closed','group','closeout','team','admin',
      'requires', jsonb_build_array('paid_in_full'), 'is_decision', false, 'default_status','not_started','lead_time_days', null)
  )),
  true,
  'Mausoleum door pickup/install workflow (17 milestones). Two field trips — door_pickup (fetch the door/panel) around shop production, then door_dropoff/install. door_pickup_needed + door_dropoff_needed feed the Scheduler door_trip column.'
)
ON CONFLICT (id) DO NOTHING;

-- ── Done ───────────────────────────────────────────────────────────────────
-- Verify with:
--   select job_type, is_active,
--          jsonb_array_length(template->'milestones') AS milestone_count
--     from milestone_templates where job_type = 'mausoleum_door';
--   -- expect: mausoleum_door | t | 17
--   select m->>'key' AS key, m->>'group' AS grp, m->>'is_decision' AS decision
--     from milestone_templates t,
--          jsonb_array_elements(t.template->'milestones') m
--    where t.job_type = 'mausoleum_door';
--   -- expect door_pickup_needed + door_dropoff_needed present, both decision=true
