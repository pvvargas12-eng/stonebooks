// =============================================================================
// trade-signup — Supabase Edge Function (Stonebooks Trade, slice 8)
// =============================================================================
// Self-signup via a REUSABLE company invite link. Paul generates ONE link per
// company (partner_invites.code); anyone at that company opens it, sets their
// name + email + password, and lands in the same portal — as many logins per
// company as they want. The link can be revoked or expired at any time.
//
// Input (JSON): { code, email, password, name, phone? }
//   1. Validate the invite code (exists, not revoked, not expired).
//   2. Create the auth user with the given password (email pre-confirmed —
//      the invite link itself is the trust anchor). Existing email → error.
//   3. Insert the partner_users mapping (RLS scoping) + bump use_count.
//
// Called by ANONYMOUS visitors via supabase.functions.invoke (the anon key is
// a valid JWT, so default verify_jwt passes). Service role does the writes.
// Auto-deployed by .github/workflows/deploy-functions.yml on push.
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

  let payload: { code?: string; email?: string; password?: string; name?: string; phone?: string }
  try { payload = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const code = (payload.code || '').trim()
  const email = (payload.email || '').trim().toLowerCase()
  const password = payload.password || ''
  const name = (payload.name || '').trim()
  if (!code || !email || !name) return json({ error: 'missing_fields' }, 400)
  if (password.length < 8) return json({ error: 'password_too_short' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

  // 1. Validate the invite.
  const { data: invite } = await admin.from('partner_invites')
    .select('id, partner_id, revoked_at, expires_at, use_count').eq('code', code).maybeSingle()
  if (!invite) return json({ error: 'invalid_invite' }, 400)
  if (invite.revoked_at) return json({ error: 'invite_revoked' }, 400)
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) return json({ error: 'invite_expired' }, 400)

  // 2. Create the auth user (invite link = trust anchor → email pre-confirmed).
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { name, phone: payload.phone || null, trade_signup: true },
  })
  if (createErr) {
    const msg = /already/i.test(createErr.message || '') ? 'email_in_use' : 'signup_failed'
    return json({ error: msg, detail: createErr.message }, 400)
  }
  const userId = created?.user?.id
  if (!userId) return json({ error: 'no_user_id' }, 500)

  // 3. Map user → company + bump the counter.
  const { error: mapErr } = await admin.from('partner_users')
    .insert({ auth_user_id: userId, partner_id: invite.partner_id, role: 'partner' })
  if (mapErr) {
    await admin.auth.admin.deleteUser(userId)   // no orphaned logins
    return json({ error: 'mapping_failed', detail: mapErr.message }, 500)
  }
  await admin.from('partner_invites').update({ use_count: (invite.use_count || 0) + 1 }).eq('id', invite.id)

  return json({ ok: true })
})
