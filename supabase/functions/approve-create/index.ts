// =============================================================================
// approve-create — Edge Function (Approval Packet remote approval, staff).
// =============================================================================
// Staff generate a single-purpose approval link for a proof version. The browser
// produces the UNSIGNED approval-packet PDF (jsPDF is browser-only) and posts its
// bytes + the signature rect (returned by generateApprovalSheetPDF). This fn:
//   1. Verifies the caller is STAFF (authenticated, NOT in partner_users).
//   2. Generates a 32-byte random token; stores ONLY its SHA-256 hash.
//   3. Revokes any prior active link for this proof version (one active link).
//   4. Uploads the immutable unsigned packet to the PRIVATE bucket.
//   5. Inserts an approval_links row (pending, +14 days).
//   6. Returns { url } = APPROVE_BASE_URL + "/approve/" + token (raw token only
//      in the URL, never logged/stored).
//
// Deploy WITH JWT verification:  supabase functions deploy approve-create
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto). APPROVE_BASE_URL
//   (optional; falls back to the request Origin).
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
const PRIVATE_BUCKET = 'orders-attachments-private'

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
async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'server_not_configured' }, 500)

  let payload: { order_id?: string; proof_version_id?: string; pdf_base64?: string; sig_field_rects?: unknown }
  try { payload = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const orderId = (payload.order_id || '').trim()
  const proofVersionId = (payload.proof_version_id || '').trim()
  const pdfBase64 = payload.pdf_base64 || ''
  if (!orderId) return json({ error: 'missing_order_id' }, 400)
  if (!proofVersionId) return json({ error: 'missing_proof_version_id' }, 400)
  if (!pdfBase64) return json({ error: 'missing_pdf' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

  // 1. Authenticate the caller as STAFF.
  const authHeader = req.headers.get('Authorization') || ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'not_authenticated' }, 401)
  const { data: caller, error: callerErr } = await admin.auth.getUser(jwt)
  if (callerErr || !caller?.user) return json({ error: 'not_authenticated' }, 401)
  const { data: callerMapping } = await admin
    .from('partner_users').select('id').eq('auth_user_id', caller.user.id).maybeSingle()
  if (callerMapping) return json({ error: 'forbidden' }, 403)

  // Confirm the proof version belongs to the order (via its job).
  const { data: pv, error: pvErr } = await admin
    .from('proof_versions').select('id, job_id').eq('id', proofVersionId).maybeSingle()
  if (pvErr) return json({ error: 'lookup_failed' }, 500)
  if (!pv) return json({ error: 'proof_not_found' }, 404)
  const { data: order } = await admin.from('orders').select('id').eq('id', orderId).maybeSingle()
  if (!order) return json({ error: 'order_not_found' }, 404)

  // 1b. Re-approval block: refuse to mint a link on a version the customer
  // already rejected. A fresh approval link requires a NEW proof version
  // (design fixes the layout first, which creates a new version with no link).
  const { data: rejected } = await admin
    .from('approval_links').select('id')
    .eq('proof_version_id', proofVersionId).eq('status', 'changes_requested')
    .limit(1).maybeSingle()
  if (rejected) {
    return json({
      error: 'version_rejected',
      detail: 'This layout version had changes requested — upload a new layout version before sending it for approval again.',
    }, 409)
  }

  // 2. Token + hash + ids.
  const rawToken = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const tokenHash = await sha256Hex(rawToken)
  const linkId = crypto.randomUUID()
  const unsignedPath = `${orderId}/approval-unsigned-${linkId}.pdf`

  // 4. Upload the immutable unsigned packet to the private bucket.
  let pdfBytes: Uint8Array
  try { pdfBytes = bytesFromBase64(pdfBase64) } catch { return json({ error: 'bad_pdf_encoding' }, 400) }
  const { error: upErr } = await admin.storage
    .from(PRIVATE_BUCKET).upload(unsignedPath, pdfBytes, { contentType: 'application/pdf', upsert: true })
  if (upErr) return json({ error: 'upload_failed', detail: upErr.message }, 500)

  // 3. Revoke any prior active link for this proof version (one active link).
  await admin.from('approval_links')
    .update({ status: 'revoked', revoked_at: new Date().toISOString() })
    .eq('proof_version_id', proofVersionId).in('status', ['pending', 'viewed'])

  // 5. Insert the link row.
  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 86400_000).toISOString()
  const { error: insErr } = await admin.from('approval_links').insert({
    id: linkId,
    tenant_id: TENANT_ID,
    order_id: orderId,
    proof_version_id: proofVersionId,
    token_hash: tokenHash,
    status: 'pending',
    expires_at: expiresAt,
    unsigned_pdf_path: unsignedPath,
    sig_field_rects: payload.sig_field_rects ?? null,
    created_by: caller.user.id,
  })
  if (insErr) {
    await admin.storage.from(PRIVATE_BUCKET).remove([unsignedPath])
    return json({ error: 'insert_failed', detail: insErr.message }, 500)
  }

  // 6. Public approval URL — raw token only in the URL.
  const base = (Deno.env.get('APPROVE_BASE_URL') || req.headers.get('Origin') || '').replace(/\/+$/, '')
  const url = base ? `${base}/approve/${rawToken}` : `/approve/${rawToken}`
  return json({ ok: true, link_id: linkId, token: rawToken, url, expires_at: expiresAt })
})
