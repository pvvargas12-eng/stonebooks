// =============================================================================
// signing-create — Supabase Edge Function (Remote e-signing, step R2)
// =============================================================================
// Staff creates a signing link for an order. The browser generates the CONTRACT
// PDF (the existing jsPDF generator is browser-only, so the snapshot is produced
// client-side and uploaded here) and posts its bytes + the customer signature/
// date rects. This function:
//   1. Verifies the CALLER is staff (authenticated + NOT in partner_users) —
//      same gate as vendor-invite.
//   2. Generates an unguessable token (32 random bytes, base64url).
//   3. Stores the unsigned snapshot (immutable) in the PRIVATE "signatures"
//      bucket at signatures/<order_id>/<request_id>/unsigned.pdf.
//   4. Inserts a signature_requests row (status 'pending', expires in 14 days).
//   5. Returns { url } — SIGN_BASE_URL + "/sign/" + token — for staff to email
//      the customer THEMSELVES (no auto-email in this build; see R5 seam).
//
// Deploy WITH JWT verification (default — called from the authenticated staff
// app):  supabase functions deploy signing-create
//
// Auto-injected secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Extra secret to set:    SIGN_BASE_URL (e.g. https://stonebooks.vercel.app).
//   Falls back to the request Origin header when unset.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const TENANT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789'
const EXPIRY_DAYS = 14

function base64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function bytesFromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'server_not_configured' }, 500)

  let payload: {
    order_id?: string
    pdf_base64?: string
    sig_field_rects?: unknown
    customer_email?: string
  }
  try { payload = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }

  const orderId = (payload.order_id || '').trim()
  const pdfBase64 = payload.pdf_base64 || ''
  if (!orderId) return json({ error: 'missing_order_id' }, 400)
  if (!pdfBase64) return json({ error: 'missing_pdf' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

  // 1. Authenticate the caller and confirm they are STAFF.
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'not_authenticated' }, 401)
  const { data: caller, error: callerErr } = await admin.auth.getUser(token)
  if (callerErr || !caller?.user) return json({ error: 'not_authenticated' }, 401)
  const { data: callerMapping } = await admin
    .from('partner_users').select('id').eq('auth_user_id', caller.user.id).maybeSingle()
  if (callerMapping) return json({ error: 'forbidden_partners_cannot_sign_create' }, 403)

  // Confirm the order exists (and scope storage path under it).
  const { data: order, error: orderErr } = await admin
    .from('orders').select('id').eq('id', orderId).maybeSingle()
  if (orderErr) return json({ error: 'order_lookup_failed', detail: orderErr.message }, 500)
  if (!order) return json({ error: 'order_not_found' }, 404)

  // 2. Token + ids.
  const signToken = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const requestId = crypto.randomUUID()
  const unsignedPath = `${orderId}/${requestId}/unsigned.pdf`

  // 3. Upload the immutable unsigned snapshot to the private bucket.
  let pdfBytes: Uint8Array
  try { pdfBytes = bytesFromBase64(pdfBase64) } catch { return json({ error: 'bad_pdf_encoding' }, 400) }
  const { error: upErr } = await admin.storage
    .from('signatures')
    .upload(unsignedPath, pdfBytes, { contentType: 'application/pdf', upsert: true })
  if (upErr) return json({ error: 'upload_failed', detail: upErr.message }, 500)

  // 4. Insert the request row.
  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 86400_000).toISOString()
  const { error: insErr } = await admin.from('signature_requests').insert({
    id: requestId,
    tenant_id: TENANT_ID,
    order_id: orderId,
    token: signToken,
    status: 'pending',
    expires_at: expiresAt,
    unsigned_pdf_path: unsignedPath,
    sig_field_rects: payload.sig_field_rects ?? null,
    customer_email: (payload.customer_email || '').trim() || null,
    created_by: caller.user.id,
  })
  if (insErr) {
    // Best-effort cleanup of the orphaned upload.
    await admin.storage.from('signatures').remove([unsignedPath])
    return json({ error: 'insert_failed', detail: insErr.message }, 500)
  }

  // 5. Build the public signing URL. Token is returned in the URL only — never logged.
  const base = (Deno.env.get('SIGN_BASE_URL') || req.headers.get('Origin') || '').replace(/\/+$/, '')
  const url = base ? `${base}/sign/${signToken}` : `/sign/${signToken}`

  return json({ ok: true, request_id: requestId, token: signToken, url, expires_at: expiresAt })
})
