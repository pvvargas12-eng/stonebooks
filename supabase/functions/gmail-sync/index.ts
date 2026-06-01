// =============================================================================
// gmail-sync — Supabase Edge Function (Gmail Phase 4) — auto-association
// =============================================================================
// Scans recent INBOX messages and attaches each to the right order, writing an
// inbound order_emails row. Two strategies, in confidence order:
//   (a) THREAD MATCH (high): message.threadId == an existing
//       order_emails.gmail_thread_id with an order_id → attach (method 'thread').
//   (b) ADDRESS MATCH (medium): sender email matches a customer
//       (customers.email / email_alt) AND that customer has EXACTLY ONE active
//       order → attach (method 'address'). Zero/multiple → leave unassociated.
// No fabricated matches. UPSERT keyed on gmail_message_id so re-syncs don't
// duplicate. Tokens stay server-side (shared refresh helper).
//
// Deploy WITH JWT verification (called from the app's "Sync inbox" button):
//   supabase functions deploy gmail-sync
// =============================================================================

import { getValidGoogleToken, getHeader } from '../_shared/google.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'
const MAX = 50
const ACTIVE_STATUSES = ['draft', 'scoping', 'quoted', 'contracted', 'in_production', 'installed']

// "Display Name <addr@x.com>" → "addr@x.com" (lowercased).
function parseEmail(raw: string): string {
  const m = String(raw || '').match(/<([^>]+)>/)
  return (m ? m[1] : (raw || '')).trim().toLowerCase()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
  const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''
  if (!CLIENT_ID || !CLIENT_SECRET) return json({ error: 'server_not_configured' }, 500)

  const rest = (path: string) => `${SUPABASE_URL}/rest/v1/${path}`
  const restHeaders = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` }

  try {
    const { accessToken } = await getValidGoogleToken({
      supabaseUrl: SUPABASE_URL, serviceRole: SERVICE_ROLE, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
    })
    const auth = { Authorization: `Bearer ${accessToken}` }

    // 1. Recent INBOX message ids.
    const listRes = await fetch(`${GMAIL}/messages?labelIds=INBOX&maxResults=${MAX}`, { headers: auth })
    const list = await listRes.json()
    if (!listRes.ok) return json({ error: 'list_failed', detail: list?.error?.message ?? null }, 502)
    const ids: Array<{ id: string }> = list.messages ?? []

    // 2. Metadata for each.
    const metas = (await Promise.all(ids.map(async ({ id }) => {
      const r = await fetch(
        `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: auth },
      )
      if (!r.ok) return null
      const m = await r.json()
      const headers = m.payload?.headers
      return {
        id: m.id,
        threadId: m.threadId,
        from: getHeader(headers, 'From'),
        subject: getHeader(headers, 'Subject'),
        snippet: m.snippet ?? '',
        date: getHeader(headers, 'Date'),
        internalDate: m.internalDate ? Number(m.internalDate) : Date.now(),
      }
    }))).filter(Boolean) as Array<any>

    let attachedThread = 0, attachedAddress = 0, skipped = 0

    for (const msg of metas) {
      let orderId: string | null = null
      let method: string | null = null

      // (a) THREAD MATCH — an existing order_emails row on this thread with an order.
      const tRes = await fetch(
        rest(`order_emails?select=order_id&gmail_thread_id=eq.${encodeURIComponent(msg.threadId)}&order_id=not.is.null&limit=1`),
        { headers: restHeaders },
      )
      const tRows = tRes.ok ? await tRes.json() : []
      if (Array.isArray(tRows) && tRows[0]?.order_id) {
        orderId = tRows[0].order_id
        method = 'thread'
      }

      // (b) ADDRESS MATCH — sender → customer → exactly one active order.
      if (!orderId) {
        const sender = parseEmail(msg.from)
        if (sender) {
          const cRes = await fetch(
            rest(`customers?select=id&or=(email.eq.${encodeURIComponent(sender)},email_alt.eq.${encodeURIComponent(sender)})`),
            { headers: restHeaders },
          )
          const custs = cRes.ok ? await cRes.json() : []
          const custIds = (Array.isArray(custs) ? custs : []).map((c: any) => c.id)
          if (custIds.length > 0) {
            const oRes = await fetch(
              rest(`orders?select=id&customer_id=in.(${custIds.join(',')})&status=in.(${ACTIVE_STATUSES.join(',')})`),
              { headers: restHeaders },
            )
            const orders = oRes.ok ? await oRes.json() : []
            if (Array.isArray(orders) && orders.length === 1) {
              orderId = orders[0].id
              method = 'address'
            }
          }
        }
      }

      if (!orderId) { skipped++; continue }

      // UPSERT the inbound row (guarded on gmail_message_id).
      const up = await fetch(rest('order_emails?on_conflict=gmail_message_id'), {
        method: 'POST',
        headers: { ...restHeaders, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          order_id: orderId,
          gmail_message_id: msg.id,
          gmail_thread_id: msg.threadId,
          direction: 'inbound',
          from_email: parseEmail(msg.from),
          subject: msg.subject,
          snippet: msg.snippet,
          sent_at: new Date(msg.internalDate).toISOString(),
          association_method: method,
        }),
      })
      if (!up.ok) { console.error('[gmail-sync] upsert failed:', up.status, await up.text()); continue }
      if (method === 'thread') attachedThread++; else attachedAddress++
    }

    return json({
      ok: true,
      scanned: metas.length,
      attached: attachedThread + attachedAddress,
      byThread: attachedThread,
      byAddress: attachedAddress,
      skipped,
    })
  } catch (e) {
    console.error('[gmail-sync] error:', e)
    return json({ error: (e as Error)?.message ?? 'unexpected' }, 500)
  }
})
