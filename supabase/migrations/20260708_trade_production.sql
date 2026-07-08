-- ============================================================================
-- Trade production sync + design-only completion (Paul, 2026-07-08)
-- 1. job_components can now belong to a TRADE order (vendor_request_id) — the
--    parent check previously required order_id/cemetery_order_id, so trade
--    jobs could never have production pieces.
-- 2. trade_approve_layout: when the request is DESIGN-ONLY, approval IS
--    completion — the order flips to completed and the job closes out
--    ("the job is creating a design and getting it approved").
-- ============================================================================

alter table job_components add column if not exists vendor_request_id uuid references vendor_requests(id) on delete cascade;
create index if not exists job_components_vendor_request_idx on job_components (vendor_request_id);
alter table job_components drop constraint if exists job_components_parent_chk;
alter table job_components add constraint job_components_parent_chk
  check (order_id is not null or cemetery_order_id is not null or vendor_request_id is not null);

create or replace function public.trade_approve_layout(req uuid, proof uuid, sig_path text, approver text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  r vendor_requests;
  ok boolean := false;
  design_only boolean := false;
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
    design_only := r.services is not null
      and coalesce(array_length(r.services, 1), 0) >= 1
      and r.services <@ array['design']::text[];
    update vendor_requests
       set design_phase = 'approved', design_approved_at = now(), updated_at = now(),
           status = case when design_only then 'completed' else status end
     where id = req;
    if design_only and r.job_id is not null then
      update jobs set overall_status = 'completed', last_update_at = now() where id = r.job_id;
    end if;
  end if;
  return ok;
end $$;
grant execute on function public.trade_approve_layout(uuid, uuid, text, text) to authenticated;
