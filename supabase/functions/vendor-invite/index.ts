// =============================================================================
// vendor-invite — Supabase Edge Function (Vendor Portal PHASE 3)
// =============================================================================
// Staff invites an outside partner to the portal. The partner receives a
// Supabase invite email and SETS THEIR OWN PASSWORD via the link — staff never
// type or see the partner's credentials.
//
// Input (JSON): { partner_id, email, redirect_to? }
//   1. Verify the CALLER is staff (authenticated + NOT mapped in partner_users).
//   2. auth.admin.inviteUserByEmail(email) — creates the auth user + sends the
//      "set your password" email. If the user already exists, fall back to a
//      magic-link / recovery generate so a re-invite still works.
//   3. Upsert a partner_users row mapping that auth user → partner_id, so RLS
//      scopes them on first login.
//
// Deploy WITH JWT verification (default — called from the authenticated staff
// app):  supabase functions deploy vendor-invite
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

  let payload: { partner_id?: string; email?: string; redirect_to?: string }
  try { payload = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const partnerId = (payload.partner_id || '').trim()
  const email = (payload.email || '').trim().toLowerCase()
  const redirectTo = payload.redirect_to || undefined
  if (!partnerId || !email) return json({ error: 'missing_partner_id_or_email' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

  // 1. Authenticate the caller and confirm they are STAFF (not a portal user).
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'not_authenticated' }, 401)
  const { data: caller, error: callerErr } = await admin.auth.getUser(token)
  if (callerErr || !caller?.user) return json({ error: 'not_authenticated' }, 401)
  const { data: callerMapping } = await admin
    .from('partner_users').select('id').eq('auth_user_id', caller.user.id).maybeSingle()
  if (callerMapping) return json({ error: 'forbidden_partners_cannot_invite' }, 403)

  // 2. Invite (or re-invite) the partner contact.
  let invitedUserId: string | null = null
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
    email, redirectTo ? { redirectTo } : undefined,
  )
  if (inviteErr) {
    // Most common cause: the email already has an auth user. Look them up and
    // send a recovery link instead so the re-invite still lands.
    const { data: list } = await admin.auth.admin.listUsers()
    const existing = list?.users?.find((u) => (u.email || '').toLowerCase() === email)
    if (!existing) return json({ error: 'invite_failed', detail: inviteErr.message }, 400)
    invitedUserId = existing.id
    await admin.auth.admin.generateLink({ type: 'recovery', email, options: redirectTo ? { redirectTo } : undefined })
  } else {
    invitedUserId = invited?.user?.id ?? null
  }
  if (!invitedUserId) return json({ error: 'no_user_id' }, 500)

  // 3. Map the auth user → partner (idempotent on auth_user_id).
  const { error: mapErr } = await admin
    .from('partner_users')
    .upsert({ auth_user_id: invitedUserId, partner_id: partnerId, role: 'partner' },
            { onConflict: 'auth_user_id' })
  if (mapErr) return json({ error: 'mapping_failed', detail: mapErr.message }, 500)

  return json({ ok: true, user_id: invitedUserId })
})
