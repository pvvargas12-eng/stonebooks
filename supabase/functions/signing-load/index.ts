// =============================================================================
// signing-load — Supabase Edge Function (Remote e-signing, step R3)
// =============================================================================
// PUBLIC endpoint (no staff login). The /sign/<token> page calls this to load
// the contract for review. Runs as SERVICE ROLE and validates the token itself
// on every call — that token IS the credential. Deploy WITHOUT JWT verification:
//
//   supabase functions deploy signing-load --no-verify-jwt
//
// Behavior:
//   1. Look up the request by token. Unknown token -> 404 (no detail).
//   2. Lazy expiry: if expires_at has passed and status is still pending/viewed,
//      flip to 'expired' and return expired.
//   3. Only pending/viewed are signable. signed/voided/expired -> return status
//      so the page shows the right terminal message.
//   4. First valid load flips pending -> viewed (viewed_at = now()).
//   5. Return ONLY what the page needs + a short-lived signed URL to the unsigned
//      snapshot. The token is never echoed back into any log line.
//
// Auto-injected secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'server_not_configured' }, 500)

  let body: { token?: string }
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const token = (body.token || '').trim()
  if (!token) return json({ error: 'missing_token' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

  const { data: reqRow, error: reqErr } = await admin
    .from('signature_requests')
    .select('id, order_id, status, expires_at, unsigned_pdf_path, customer_email')
    .eq('token', token)
    .maybeSingle()
  if (reqErr) return json({ error: 'lookup_failed' }, 500)
  if (!reqRow) return json({ error: 'not_found' }, 404)

  // Lazy expiry.
  const now = Date.now()
  const expired = reqRow.expires_at && new Date(reqRow.expires_at).getTime() < now
  if (expired && (reqRow.status === 'pending' || reqRow.status === 'viewed')) {
    await admin.from('signature_requests').update({ status: 'expired' }).eq('id', reqRow.id)
    return json({ ok: true, status: 'expired' })
  }

  // Terminal / non-signable states — page shows the right message, no PDF.
  if (reqRow.status !== 'pending' && reqRow.status !== 'viewed') {
    return json({ ok: true, status: reqRow.status })
  }

  // First valid load: pending -> viewed.
  if (reqRow.status === 'pending') {
    await admin.from('signature_requests')
      .update({ status: 'viewed', viewed_at: new Date(now).toISOString() })
      .eq('id', reqRow.id)
  }

  // Order display info (order #, surname) + a nicer signer-name prefill.
  let orderNumber = '', surname = '', signerPrefill = ''
  const { data: order } = await admin
    .from('orders').select('order_number, primary_lastname, customer_id').eq('id', reqRow.order_id).maybeSingle()
  if (order) {
    orderNumber = order.order_number || ''
    surname = order.primary_lastname || ''
    if (order.customer_id) {
      const { data: cust } = await admin
        .from('customers').select('first_name, last_name').eq('id', order.customer_id).maybeSingle()
      if (cust) signerPrefill = `${cust.first_name || ''} ${cust.last_name || ''}`.trim()
    }
  }

  // Short-lived signed URL to the immutable unsigned snapshot.
  let pdfUrl = ''
  if (reqRow.unsigned_pdf_path) {
    const { data: signed } = await admin.storage
      .from('signatures').createSignedUrl(reqRow.unsigned_pdf_path, 600)  // 10 min
    pdfUrl = signed?.signedUrl || ''
  }

  return json({
    ok: true,
    status: 'viewed',
    order_number: orderNumber,
    surname,
    signer_prefill: signerPrefill,
    customer_email: reqRow.customer_email || '',
    pdf_url: pdfUrl,
    expires_at: reqRow.expires_at,
  })
})
