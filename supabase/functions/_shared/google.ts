// =============================================================================
// _shared/google.ts — server-side Google token helper (Gmail Phase 2)
// =============================================================================
// Shared by the Gmail Edge Functions. getValidGoogleToken() returns a fresh
// access token for the connected mailbox, refreshing via the stored
// refresh_token when the current access token is expired/near-expiry, and
// persisting the new token + expiry back to google_oauth_tokens (service role).
//
// Tokens NEVER leave the server — only Edge Functions call this.
// =============================================================================

interface TokenResult {
  accessToken: string
  connectedEmail: string
  refreshToken: string | null
}

interface RefreshDeps {
  supabaseUrl: string
  serviceRole: string
  clientId: string
  clientSecret: string
  // Optionally target a specific mailbox; defaults to the most-recently updated.
  connectedEmail?: string
}

// 60s skew buffer so we refresh slightly before the token actually expires.
const EXPIRY_SKEW_MS = 60_000

export async function getValidGoogleToken(deps: RefreshDeps): Promise<TokenResult> {
  const { supabaseUrl, serviceRole, clientId, clientSecret, connectedEmail } = deps
  const restBase = `${supabaseUrl}/rest/v1/google_oauth_tokens`
  const restHeaders = { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` }

  // 1. Load the token row (specific mailbox, or the most-recent connection).
  const filter = connectedEmail
    ? `connected_email=eq.${encodeURIComponent(connectedEmail)}`
    : 'order=updated_at.desc'
  const rowRes = await fetch(`${restBase}?select=*&${filter}&limit=1`, { headers: restHeaders })
  if (!rowRes.ok) throw new Error(`token row read failed: ${rowRes.status}`)
  const rows = await rowRes.json()
  const row = Array.isArray(rows) ? rows[0] : null
  if (!row) throw new Error('No connected Google account')

  // 2. Reuse the stored access token if it's still valid.
  const now = Date.now()
  const expiry = row.token_expiry ? new Date(row.token_expiry).getTime() : 0
  if (row.access_token && expiry > now + EXPIRY_SKEW_MS) {
    return { accessToken: row.access_token, connectedEmail: row.connected_email, refreshToken: row.refresh_token }
  }

  // 3. Refresh via the stored refresh_token.
  if (!row.refresh_token) throw new Error('No refresh token on file — reconnect the Google account')
  const tr = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: row.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  const tok = await tr.json()
  if (!tr.ok || !tok.access_token) {
    console.error('[google] refresh failed:', tok)
    throw new Error('Token refresh failed — reconnect the Google account')
  }

  // 4. Persist the new access token + expiry (refresh_token is unchanged here).
  const newExpiryIso = new Date(now + (tok.expires_in ?? 3600) * 1000).toISOString()
  const patchRes = await fetch(`${restBase}?id=eq.${row.id}`, {
    method: 'PATCH',
    headers: { ...restHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ access_token: tok.access_token, token_expiry: newExpiryIso, updated_at: new Date().toISOString() }),
  })
  if (!patchRes.ok) console.error('[google] token persist failed:', patchRes.status, await patchRes.text())

  return { accessToken: tok.access_token, connectedEmail: row.connected_email, refreshToken: row.refresh_token }
}

// Base64url-encode a UTF-8 string (Gmail's `raw` message field format).
export function base64UrlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
