import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(url && anon)

// Sessions persist ONLY on the phone/kiosk surfaces — /field and /sales sign
// in once per device and stay in (private links ride this). The DESKTOP and
// TRADE keep their sign-in screen on every fresh visit (Paul, 2026-07-20:
// "I want the login still for desktop and trade, only not for field").
// autoRefreshToken stays on everywhere so an open desktop tab never expires
// mid-shift; closing it drops the (in-memory) session.
const PERSIST_ROUTES = /^\/(field|sales)(\/|$)/
const persistHere =
  typeof window !== 'undefined' && PERSIST_ROUTES.test(window.location.pathname)

export const supabase = supabaseConfigured
  ? createClient(url, anon, {
      auth: { persistSession: persistHere, autoRefreshToken: true },
      db: { schema: 'public' },
    })
  : null
