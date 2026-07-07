-- =============================================================================
-- 20260707_trade_signatures.sql
-- STONEBOOKS TRADE — slice 5: layout approval + drop-off / pickup receipts.
--
-- • vendor_requests_partner_update — dealers could SELECT/INSERT but not
--   UPDATE their own orders (V1 gap): board actions (edit / archive / stone
--   dropped off / request changes) now work under a real partner session.
--   Scoped to the partner's own rows on BOTH sides of the policy.
-- • dropoff_receipt / pickup_receipt jsonb — dual-signature receipts:
--   { at, where, signatures: [{ role: 'partner'|'staff', name, path, at }] }.
--   Signature images live in the private vendor-files bucket under the
--   partner's prefix (already partner-writable).
-- • trade_layouts(req) — SECURITY DEFINER: the dealer's window into
--   proof_versions (RLS-locked to staff otherwise). Returns every version
--   V1..Vn for the order's job (or legacy order-scoped rows), sanitized.
-- • trade_approve_layout(req, proof, sig_path, approver) — SECURITY DEFINER:
--   stamps proof_versions (approved_at/by/signature) AND flips the order's
--   design_phase to approved in one transaction. Ownership-checked.
--
-- Applied to prod via the Supabase Management API on 2026-07-07. Idempotent.
-- =============================================================================

alter table vendor_requests
  add column if not exists dropoff_receipt jsonb,
  add column if not exists pickup_receipt  jsonb;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='vendor_requests' and policyname='vendor_requests_partner_update') then
    create policy vendor_requests_partner_update on vendor_requests for update to authenticated
      using (partner_id = public.vp_my_partner_id())
      with check (partner_id = public.vp_my_partner_id());
  end if;
end $$;

-- ── Dealer window into the layout versions ───────────────────────────────────
create or replace function public.trade_layouts(req uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r vendor_requests;
  out jsonb;
begin
  select * into r from vendor_requests where id = req;
  if r.id is null then return '[]'::jsonb; end if;
  if public.vp_my_partner_id() is not null and r.partner_id is distinct from public.vp_my_partner_id() then
    return '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'version', p.version_number,
      'image_url', p.layout_image_url,
      'uploaded_at', to_char(p.uploaded_at, 'YYYY-MM-DD'),
      'sent_at', to_char(p.sent_at, 'YYYY-MM-DD'),
      'approved_at', to_char(p.approved_at, 'YYYY-MM-DD'),
      'approved_by', p.approved_by_name,
      'is_current', p.is_current,
      'notes', p.notes
    ) order by p.version_number desc), '[]'::jsonb)
  into out
  from proof_versions p
  where (r.job_id is not null and p.job_id = r.job_id)
     or p.order_id = r.id;
  return out;
end $$;
grant execute on function public.trade_layouts(uuid) to authenticated;

-- ── Dealer approves a layout (signature + phase flip, one transaction) ───────
create or replace function public.trade_approve_layout(req uuid, proof uuid, sig_path text, approver text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  r vendor_requests;
  ok boolean := false;
begin
  select * into r from vendor_requests where id = req;
  if r.id is null then return false; end if;
  if public.vp_my_partner_id() is not null and r.partner_id is distinct from public.vp_my_partner_id() then
    return false;
  end if;
  update proof_versions p
     set approved_at = now(),
         approved_by_name = approver,
         signature_method = 'trade_portal',
         signature_url = coalesce(sig_path, p.signature_url)
   where p.id = proof
     and ((r.job_id is not null and p.job_id = r.job_id) or p.order_id = r.id);
  ok := found;
  if ok then
    update vendor_requests
       set design_phase = 'approved', design_approved_at = now(), updated_at = now()
     where id = req;
  end if;
  return ok;
end $$;
grant execute on function public.trade_approve_layout(uuid, uuid, text, text) to authenticated;
