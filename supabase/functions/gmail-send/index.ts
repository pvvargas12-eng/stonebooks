// =============================================================================
// gmail-send — Supabase Edge Function (Gmail Phase 2)
// =============================================================================
// Input (JSON): { order_id, to, subject, body }
// 1. Get a valid access token via the shared refresh helper (server-side).
// 2. Build an RFC-2822 MIME message with X-Stonebooks-Order-Id: {order_id}.
// 3. base64url-encode and POST to gmail.googleapis.com .../messages/send.
// 4. On success, INSERT an order_emails row (direction 'outbound') capturing
//    the Gmail message id + thread id — these + the order-id header are what
//    let inbound replies auto-attach to the order later (Phase 3).
//
// Deploy WITH JWT verification (default — called from the authenticated app,
// not from Google):  supabase functions deploy gmail-send
//
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
// Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// =============================================================================

import { getValidGoogleToken, base64UrlEncode } from '../_shared/google.ts'

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
  const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
  const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''

  let payload: { order_id?: string; to?: string; subject?: string; body?: string }
  try { payload = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const { order_id, to, subject, body } = payload
  if (!to || !subject) return json({ error: 'missing_to_or_subject' }, 400)
  if (!CLIENT_ID || !CLIENT_SECRET) return json({ error: 'server_not_configured' }, 500)

  try {
    // 1. Fresh access token for the connected mailbox.
    const { accessToken, connectedEmail } = await getValidGoogleToken({
      supabaseUrl: SUPABASE_URL, serviceRole: SERVICE_ROLE, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
    })

    // 2. RFC-2822 MIME. The X-Stonebooks-Order-Id header is load-bearing for
    //    inbound auto-attach — do not drop it.
    const headerLines = [
      `From: ${connectedEmail}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
    ]
    if (order_id) headerLines.push(`X-Stonebooks-Order-Id: ${order_id}`)
    const mime = `${headerLines.join('\r\n')}\r\n\r\n${body ?? ''}`
    const raw = base64UrlEncode(mime)

    // 3. Send.
    const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    })
    const sent = await sendRes.json()
    if (!sendRes.ok || !sent.id) {
      console.error('[gmail-send] send failed:', sendRes.status, sent)
      return json({ error: 'send_failed', detail: sent?.error?.message ?? null }, 502)
    }

    // 4. Log the outbound message (service role bypasses RLS).
    const insRes = await fetch(`${SUPABASE_URL}/rest/v1/order_emails`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        order_id: order_id ?? null,
        gmail_message_id: sent.id,
        gmail_thread_id: sent.threadId ?? null,
        direction: 'outbound',
        from_email: connectedEmail,
        to_email: to,
        subject,
        snippet: (body ?? '').slice(0, 240),
        body: body ?? '',
        sent_at: new Date().toISOString(),
        association_method: 'header',
      }),
    })
    if (!insRes.ok) console.error('[gmail-send] order_emails insert failed:', insRes.status, await insRes.text())

    return json({ ok: true, id: sent.id, threadId: sent.threadId ?? null })
  } catch (e) {
    console.error('[gmail-send] error:', e)
    return json({ error: (e as Error)?.message ?? 'unexpected' }, 500)
  }
})
