// =============================================================================
// gmail-list — Supabase Edge Function (Gmail Phase 3) — READ-ONLY
// =============================================================================
// Input (JSON, optional): { label: "INBOX" | "SENT" }  (default INBOX)
// Returns the most recent ~25 messages in that label as lightweight rows:
//   { id, threadId, from, to, subject, snippet, date, unread }
// Uses messages.list (by label) + messages.get(format=metadata) so no full
// bodies are fetched here (the reading pane uses gmail-thread for that). Tokens
// stay server-side via the shared refresh helper.
//
// Deploy WITH JWT verification (authenticated app call):
//   supabase functions deploy gmail-list
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET. Auto: SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY.
// =============================================================================

import { getValidGoogleToken, getHeader } from '../_shared/google.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'
const MAX = 25

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
  const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''
  if (!CLIENT_ID || !CLIENT_SECRET) return json({ error: 'server_not_configured' }, 500)

  // Which mailbox folder to list (whitelist to INBOX/SENT; default INBOX).
  let label = 'INBOX'
  if (req.method === 'POST') {
    try { const b = await req.json(); if (b?.label === 'SENT') label = 'SENT' } catch { /* default */ }
  }

  try {
    const { accessToken } = await getValidGoogleToken({
      supabaseUrl: SUPABASE_URL, serviceRole: SERVICE_ROLE, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
    })
    const auth = { Authorization: `Bearer ${accessToken}` }

    // 1. List the most recent message ids in the requested label.
    const listRes = await fetch(`${GMAIL}/messages?labelIds=${label}&maxResults=${MAX}`, { headers: auth })
    const list = await listRes.json()
    if (!listRes.ok) {
      console.error('[gmail-list] list failed:', listRes.status, list)
      return json({ error: 'list_failed', detail: list?.error?.message ?? null }, 502)
    }
    const ids: Array<{ id: string }> = list.messages ?? []

    // 2. Fetch metadata for each (parallel). format=metadata → headers + snippet,
    //    no body payload.
    const rows = await Promise.all(ids.map(async ({ id }) => {
      const mRes = await fetch(
        `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: auth },
      )
      if (!mRes.ok) return null
      const m = await mRes.json()
      const headers = m.payload?.headers
      return {
        id: m.id,
        threadId: m.threadId,
        from: getHeader(headers, 'From'),
        to: getHeader(headers, 'To'),   // used by the Sent folder column
        subject: getHeader(headers, 'Subject'),
        snippet: m.snippet ?? '',
        date: getHeader(headers, 'Date'),
        unread: Array.isArray(m.labelIds) && m.labelIds.includes('UNREAD'),
        internalDate: m.internalDate ? Number(m.internalDate) : 0,
      }
    }))

    const messages = rows.filter(Boolean).sort((a, b) => (b!.internalDate) - (a!.internalDate))
    return json({ ok: true, messages })
  } catch (e) {
    console.error('[gmail-list] error:', e)
    return json({ error: (e as Error)?.message ?? 'unexpected' }, 500)
  }
})
