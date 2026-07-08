-- ============================================================================
-- Trade polish round 2 fixes (Paul, 2026-07-08)
-- 1. APPROVE & SIGN WAS SILENTLY FAILING: trade_approve_layout stamps
--    signature_method = 'trade_portal', but proof_versions_signature_method_check
--    (June R2 remote-signing build) only allowed 'e_signature'/'paper_scan' —
--    the RPC threw 23514, the client swallowed it, nothing happened on screen.
--    Extend the check to allow 'trade_portal'.
-- 2. New design phase 'changes_requested' — a dealer change request now shows
--    as its own status on the Trade Board instead of blending into In progress.
-- ============================================================================

alter table proof_versions drop constraint if exists proof_versions_signature_method_check;
alter table proof_versions add constraint proof_versions_signature_method_check
  check (signature_method is null or signature_method in ('e_signature', 'paper_scan', 'trade_portal'));

alter table vendor_requests drop constraint if exists vendor_requests_design_phase_chk;
alter table vendor_requests add constraint vendor_requests_design_phase_chk
  check (design_phase in ('not_created', 'in_progress', 'changes_requested', 'sent_draft', 'approved'));
