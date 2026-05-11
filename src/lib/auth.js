// =============================================================================
// Stonebooks — Auth helpers
// =============================================================================
// Wraps Supabase Auth so the rest of the app talks to a small surface.
// The login UI lives in Stonebooks.jsx — this file is just the plumbing.
// =============================================================================

import { supabase } from './supabase'

// Returns the current session (or null if not signed in)
export async function getSession() {
  const { data, error } = await supabase.auth.getSession()
  if (error) {
    console.error('getSession error:', error)
    return null
  }
  return data.session
}

// Returns the current authenticated user (or null)
export async function getUser() {
  const session = await getSession()
  return session?.user || null
}

// Sign in with email + password
export async function signInWithPassword(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, user: data.user, session: data.session }
}

// Sign in via magic link (passwordless — Supabase emails a click-to-login link)
export async function signInWithMagicLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      // Where to land after clicking the link in the email
      emailRedirectTo: window.location.origin,
    },
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// Sign out
export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// Subscribe to auth state changes — call from a useEffect.
// Returns the unsubscribe function.
export function onAuthStateChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback(session?.user || null, event, session)
  })
  return () => data.subscription.unsubscribe()
}

// Update password for the current user (used in Settings → Account)
export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// Send a password reset email
export async function resetPasswordForEmail(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(
    email.trim().toLowerCase(),
    { redirectTo: window.location.origin }
  )
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
