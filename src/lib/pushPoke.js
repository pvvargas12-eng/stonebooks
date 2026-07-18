// =============================================================================
// pushPoke.js — nudge the push sender after a task/reply write
// =============================================================================
// The Vercel cron sweeps every 5 minutes; this fire-and-forget poke makes a
// freshly assigned task or reply land on the assignee's phone in seconds
// instead. Bursts collapse into one call (the sweep processes everything
// pending anyway), and every failure is silent — cron is the backstop, so
// this must never surface an error or block a save.
// =============================================================================
import { supabase } from './supabase'

let timer = null

export function pokePushSender() {
  if (timer) return
  timer = setTimeout(async () => {
    timer = null
    try {
      const { data } = await supabase.auth.getSession()
      const token = data && data.session && data.session.access_token
      if (!token) return
      await fetch('/api/push/send', { method: 'POST', headers: { authorization: `Bearer ${token}` } })
    } catch { /* cron will catch up */ }
  }, 2500)
}
