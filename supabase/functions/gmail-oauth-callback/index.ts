// =============================================================================
// gmail-oauth-callback — Supabase Edge Function (Gmail integration Phase 1)
// =============================================================================
// Google redirects the browser here after consent with ?code & ?state. We:
//   1. Exchange the code for tokens (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET).
//   2. Resolve the connected mailbox via the userinfo endpoint.
//   3. Upsert the tokens into google_oauth_tokens (service role — bypasses RLS).
//   4. Redirect the browser back to the app (state.ret) with a status param.
//
// Deploy WITHOUT JWT verification — Google calls this with no Supabase JWT:
//   supabase functions deploy gmail-oauth-callback --no-verify-jwt
//
// Secrets required (supabase secrets set ...):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
// Auto-injected by the platform: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Optional: APP_URL (fallback redirect target if state.ret is missing).
//
// The redirect_uri used in the token exchange MUST exactly match the one
// registered on the OAuth client AND the one the app put in the consent URL:
//   {SUPABASE_URL}/functions/v1/gmail-oauth-callback
// =============================================================================

Deno.serve(async (req) => {
  const reqUrl = new URL(req.url)
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
  const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''
  const APP_URL = Deno.env.get('APP_URL') ?? ''
  const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/gmail-oauth-callback`

  // Decode state ({ uid, by, ret }) — base64(JSON), set by the app.
  let state: { uid?: string; by?: string; ret?: string } = {}
  try {
    const raw = reqUrl.searchParams.get('state')
    if (raw) state = JSON.parse(atob(raw))
  } catch { /* ignore malformed state */ }
  const appBase = (state.ret || APP_URL || '').replace(/\/$/, '')

  const back = (params: Record<string, string>) => {
    const u = new URL(appBase || 'https://example.com')
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
    return Response.redirect(u.toString(), 302)
  }

  // Google returned an error (denied consent, etc.).
  const oauthErr = reqUrl.searchParams.get('error')
  if (oauthErr) return back({ gmail: 'error', reason: oauthErr })

  const code = reqUrl.searchParams.get('code')
  if (!code) return back({ gmail: 'error', reason: 'missing_code' })
  if (!CLIENT_ID || !CLIENT_SECRET) return back({ gmail: 'error', reason: 'server_not_configured' })

  try {
    // 1. Exchange the authorization code for tokens.
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    })
    const tok = await tokenRes.json()
    if (!tokenRes.ok || !tok.access_token) {
      console.error('[gmail-oauth] token exchange failed:', tok)
      return back({ gmail: 'error', reason: 'token_exchange_failed' })
    }

    // 2. Resolve the connected mailbox.
    const uiRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    })
    const info = await uiRes.json()
    const email: string | null = info.email ?? null
    if (!email) return back({ gmail: 'error', reason: 'no_email' })

    // 3. Upsert tokens (service role bypasses RLS). merge-duplicates on the
    //    UNIQUE(connected_email) constraint so re-consent updates in place.
    const expiry = tok.expires_in
      ? new Date(Date.now() + tok.expires_in * 1000).toISOString()
      : null
    const row = {
      connected_email: email,
      access_token: tok.access_token,
      // refresh_token only comes back with prompt=consent; keep prior on absence
      // by omitting it when null (merge-duplicates leaves the existing value).
      ...(tok.refresh_token ? { refresh_token: tok.refresh_token } : {}),
      token_expiry: expiry,
      scopes: tok.scope ?? null,
      connected_by: state.by ?? null,
      updated_at: new Date().toISOString(),
    }
    const insRes = await fetch(`${SUPABASE_URL}/rest/v1/google_oauth_tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(row),
    })
    if (!insRes.ok) {
      const detail = await insRes.text()
      console.error('[gmail-oauth] token store failed:', insRes.status, detail)
      return back({ gmail: 'error', reason: 'store_failed' })
    }

    // 4. Back to the app.
    return back({ gmail: 'connected', email })
  } catch (e) {
    console.error('[gmail-oauth] unexpected error:', e)
    return back({ gmail: 'error', reason: 'unexpected' })
  }
})
