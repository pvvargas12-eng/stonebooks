// =============================================================================
// /api/field/redeem — private field-link sign-in (FIELD-6)
// =============================================================================
// POST { key } — the field_key from a /field#k=<key> link.
// Validates the key against employees (active people only), then mints a REAL
// Supabase session for the shared staff account without any email round-trip:
// admin.generateLink({ type: 'magiclink' }) returns a hashed_token the client
// exchanges via supabase.auth.verifyOtp — session persists on the device
// (persistSession is on), so the phone signs in ONCE from the link and stays
// signed in. The response also names the person, so the app pins the phone's
// identity (no WhoPicker, no PIN — the link IS the person).
//
// The key is a credential: 32+ chars of crypto randomness, unique per person,
// revocable by regenerating in Settings > Staff. Same trust model as the
// approval share links. Rate limiting rides Vercel's function-level limits;
// failed lookups return a flat 401 with no detail.
//
// Server-only env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and
// FIELD_LOGIN_EMAIL — the email of the shared staff auth account the session
// is minted for (the same account everyone signs in with today).
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY
  const LOGIN_EMAIL = process.env.FIELD_LOGIN_EMAIL
  if (!SUPABASE_URL || !SERVICE_ROLE) return res.status(500).json({ error: 'server_not_configured' })
  if (!LOGIN_EMAIL) return res.status(500).json({ error: 'field_login_not_configured' })

  const key = String((req.body && req.body.key) || '').trim()
  // Never enumerate: too-short keys get the same flat 401 as unknown ones.
  if (key.length < 20) return res.status(401).json({ error: 'invalid_key' })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

  const { data: emp, error: empErr } = await admin
    .from('employees')
    .select('name, department, is_owner, is_active')
    .eq('field_key', key)
    .maybeSingle()
  if (empErr) return res.status(500).json({ error: empErr.message })
  if (!emp || !emp.is_active) return res.status(401).json({ error: 'invalid_key' })

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: LOGIN_EMAIL,
  })
  if (linkErr || !link?.properties?.hashed_token) {
    return res.status(500).json({ error: linkErr?.message || 'could_not_mint_session' })
  }

  return res.status(200).json({
    ok: true,
    token_hash: link.properties.hashed_token,
    person: { name: emp.name, department: emp.department || null, isOwner: !!emp.is_owner },
  })
}
