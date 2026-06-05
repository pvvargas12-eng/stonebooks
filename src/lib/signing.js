// Public remote-signing data layer. Deliberately tiny — only the supabase client
// (anon key) — so the public /sign/<token> page doesn't pull in the staff data
// layer. The signing-load / signing-submit Edge Functions run as service role
// and validate the token on every call; the anon key here only satisfies the
// gateway (functions deployed with --no-verify-jwt).
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

// Load the contract for review. Returns { ok, status, order_number, surname,
// signer_prefill, customer_email, pdf_url, expires_at }. status may be a terminal
// value (signed/voided/expired) with no pdf_url — the page renders accordingly.
export function loadSigningRequest(token) {
  return invoke('signing-load', { token })
}

// Submit the signature (R4). signaturePng is a data URL.
export function submitSignature({ token, signaturePng, signerName, consent }) {
  return invoke('signing-submit', {
    token,
    signature_png: signaturePng,
    signer_name: signerName,
    consent: !!consent,
  })
}
