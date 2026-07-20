// =============================================================================
// fieldLink.js — private per-person field links (FIELD-6)
// =============================================================================
// A /field#k=<field_key> link signs the device in silently (POST /api/field/
// redeem -> verifyOtp mints a persisted session) and pins the phone to the
// link's person (sb_active_staff — the app-wide actor key). The key is stored
// on-device so an expired/cleared session self-heals on the next open without
// the link. Regenerating a person's key in Settings > Staff revokes the old
// link everywhere it was saved.
import { supabase } from '../lib/supabase'
import { setFieldWho } from './fieldIdentity'

const KEY_STORE = 'sb_field_key'

// Runs before the auth gate on every /field load. Returns true if a session
// was minted this call.
export async function redeemFieldLinkIfPresent() {
  let key = null
  try {
    const m = String(window.location.hash || '').match(/[#&]k=([A-Za-z0-9_-]{20,})/)
    if (m) {
      key = m[1]
      // The key never stays in the address bar / history.
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      try { window.localStorage.setItem(KEY_STORE, key) } catch { /* private mode */ }
    } else {
      const { data } = await supabase.auth.getSession()
      if (data?.session) return false          // signed in — nothing to redeem
      try { key = window.localStorage.getItem(KEY_STORE) } catch { /* ignore */ }
    }
  } catch { return false }
  if (!key) return false

  try {
    const r = await fetch('/api/field/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key }),
    })
    if (!r.ok) {
      // A revoked/unknown key must not retry forever.
      if (r.status === 401) { try { window.localStorage.removeItem(KEY_STORE) } catch { /* ignore */ } }
      return false
    }
    const j = await r.json().catch(() => null)
    if (!j?.token_hash) return false
    const { error } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: j.token_hash })
    if (error) { console.warn('[fieldLink] verifyOtp:', error.message); return false }
    if (j.person?.name) setFieldWho(j.person.name)
    return true
  } catch (e) {
    console.warn('[fieldLink] redeem failed:', e?.message)
    return false
  }
}

// 24 bytes of crypto randomness as base62 — the per-person key. Generated
// client-side in Settings > Staff; uniqueness enforced by the DB index.
export function makeFieldKey() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

export function fieldLinkFor(key) {
  return `${window.location.origin}/field#k=${key}`
}
