// Public approval data layer. Deliberately tiny — only the supabase client (anon
// key) — so the public /approve/<token> page doesn't pull in the staff data
// layer. The approve-load / approve-submit Edge Functions run as service role and
// validate the token on every call (deployed --no-verify-jwt). The anon key here
// only satisfies the gateway; it never reads or writes application tables.
import { supabase } from './supabase'

async function invoke(name, body) {
  if (!supabase) return { ok: false, error: 'not_configured' }
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    let detail = error.message
    try { const ctx = await error.context?.json?.(); if (ctx?.error) detail = ctx.detail || ctx.error } catch { /* ignore */ }
    return { ok: false, error: detail }
  }
  if (data?.error) return { ok: false, error: data.detail || data.error }
  return { ok: true, ...data }
}

// Load the packet for review. Returns { ok, status, order_number, surname,
// signer_prefill, pdf_url, expires_at }. status may be terminal
// (signed/revoked/expired) with no pdf_url.
export function loadApprovalRequest(token) {
  return invoke('approve-load', { token })
}

// Submit the approval — the drawn signature image (PNG data URL), typed name,
// consent. The server stamps it into the packet and pins the signed copy.
export function submitApproval({ token, signerName, consent, signatureImage }) {
  return invoke('approve-submit', {
    token,
    action: 'approve',
    signer_name: signerName,
    consent: !!consent,
    signature_image: signatureImage,
  })
}

// Request changes — the customer rejects the layout and describes what needs to
// change. No signature/consent required. The server records the rejection
// (job_events + order_activity), stamps the link 'changes_requested', and routes
// it to the shop's design workflow. Returns { ok, status: 'changes_requested' }.
export function requestChanges({ token, notes, name }) {
  return invoke('approve-submit', {
    token,
    action: 'request_changes',
    change_notes: notes,
    signer_name: name || '',
  })
}
