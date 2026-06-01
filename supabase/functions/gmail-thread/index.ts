// =============================================================================
// gmail-thread — Supabase Edge Function (Gmail Phase 3) — READ-ONLY
// =============================================================================
// Input (JSON): { threadId }
// Returns the full thread for the reading pane:
//   { messages: [ { id, from, to, subject, date, body, unread } ] }
// Uses threads.get(format=full) and extracts the best body text (plain → html).
// Tokens stay server-side via the shared refresh helper.
//
// Deploy WITH JWT verification (authenticated app call):
//   supabase functions deploy gmail-thread
// =============================================================================

import { getValidGoogleToken, getHeader, extractBody } from '../_shared/google.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
  const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''
  if (!CLIENT_ID || !CLIENT_SECRET) return json({ error: 'server_not_configured' }, 500)

  let payload: { threadId?: string }
  try { payload = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const threadId = payload.threadId
  if (!threadId) return json({ error: 'missing_threadId' }, 400)

  try {
    const { accessToken } = await getValidGoogleToken({
      supabaseUrl: SUPABASE_URL, serviceRole: SERVICE_ROLE, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
    })
    const tRes = await fetch(`${GMAIL}/threads/${threadId}?format=full`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const thread = await tRes.json()
    if (!tRes.ok) {
      console.error('[gmail-thread] get failed:', tRes.status, thread)
      return json({ error: 'thread_failed', detail: thread?.error?.message ?? null }, 502)
    }

    const messages = (thread.messages ?? []).map((m: any) => {
      const headers = m.payload?.headers
      return {
        id: m.id,
        from: getHeader(headers, 'From'),
        to: getHeader(headers, 'To'),
        subject: getHeader(headers, 'Subject'),
        date: getHeader(headers, 'Date'),
        body: extractBody(m.payload),
        unread: Array.isArray(m.labelIds) && m.labelIds.includes('UNREAD'),
      }
    })
    return json({ ok: true, threadId, messages })
  } catch (e) {
    console.error('[gmail-thread] error:', e)
    return json({ error: (e as Error)?.message ?? 'unexpected' }, 500)
  }
})
