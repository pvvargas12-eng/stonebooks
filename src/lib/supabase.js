import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(url && anon)

// persistSession flipped TRUE 2026-07-20 (Paul: "annoying that I need to log
// in every time I open the app") — sessions live in localStorage and
// auto-refresh, so a device signs in once and stays in. Field phones ride
// this + their private /field#k= links; the desktop keeps its session too.
export const supabase = supabaseConfigured
  ? createClient(url, anon, {
      auth: { persistSession: true, autoRefreshToken: true },
      db: { schema: 'public' },
    })
  : null
