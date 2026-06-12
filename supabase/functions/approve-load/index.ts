// =============================================================================
// approve-load — Edge Function (Approval Packet, PUBLIC).
// =============================================================================
// The /approve/<token> page calls this to load the packet for review. SERVICE
// ROLE; the token IS the credential and is validated here on every call. The anon
// client never touches application tables.
//   1. SHA-256-hash the token; look up by token_hash. Unknown -> 404 (no detail).
//   2. Lazy expiry; terminal states (signed/revoked/expired) return status only.
//   3. First valid load flips pending -> viewed (viewed_at = now()).
//   4. Return ONLY the packet display payload + a SHORT-LIVED signed URL to the
//      immutable unsigned packet. No order data beyond order #/surname is exposed.
//
// Deploy WITHOUT JWT:  supabase functions deploy approve-load --no-verify-jwt
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const PRIVATE_BUCKET = 'orders-attachments-private'
const TENANT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789'

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

  let body: { token?: string }
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const token = (body.token || '').trim()
  if (!token) return json({ error: 'missing_token' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
  const tokenHash = await sha256Hex(token)

  const { data: link, error: linkErr } = await admin
    .from('approval_links')
    .select('id, order_id, status, expires_at, unsigned_pdf_path')
    .eq('token_hash', tokenHash)
    .maybeSingle()
  if (linkErr) return json({ error: 'lookup_failed' }, 500)
  if (!link) return json({ error: 'not_found' }, 404)

  const now = Date.now()
  const expired = link.expires_at && new Date(link.expires_at).getTime() < now
  if (expired && (link.status === 'pending' || link.status === 'viewed')) {
    await admin.from('approval_links').update({ status: 'expired' }).eq('id', link.id)
    return json({ ok: true, status: 'expired' })
  }
  if (link.status !== 'pending' && link.status !== 'viewed') {
    return json({ ok: true, status: link.status })
  }
  if (link.status === 'pending') {
    await admin.from('approval_links')
      .update({ status: 'viewed', viewed_at: new Date(now).toISOString() }).eq('id', link.id)
    // Log the first view to the order timeline (best-effort — never block the load).
    try {
      await admin.from('order_activity').insert({
        tenant_id: TENANT_ID,
        order_id: link.order_id,
        type: 'activity',
        note: 'Customer viewed approval',
        actor: 'Customer',
      })
    } catch { /* non-fatal */ }
  }

  // Minimal order display info — order #, surname, signer-name prefill.
  let orderNumber = '', surname = '', signerPrefill = ''
  const { data: order } = await admin
    .from('orders').select('order_number, primary_lastname, customer_id').eq('id', link.order_id).maybeSingle()
  if (order) {
    orderNumber = order.order_number || ''
    surname = order.primary_lastname || ''
    if (order.customer_id) {
      const { data: cust } = await admin
        .from('customers').select('first_name, last_name').eq('id', order.customer_id).maybeSingle()
      if (cust) signerPrefill = `${cust.first_name || ''} ${cust.last_name || ''}`.trim()
    }
  }

  let pdfUrl = ''
  if (link.unsigned_pdf_path) {
    const { data: signed } = await admin.storage.from(PRIVATE_BUCKET).createSignedUrl(link.unsigned_pdf_path, 600)
    pdfUrl = signed?.signedUrl || ''
  }

  return json({
    ok: true,
    status: 'viewed',
    order_number: orderNumber,
    surname,
    signer_prefill: signerPrefill,
    pdf_url: pdfUrl,
    expires_at: link.expires_at,
  })
})
