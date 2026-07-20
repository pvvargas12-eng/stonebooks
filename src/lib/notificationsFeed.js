// =============================================================================
// notificationsFeed.js — the in-app notification feed (the /field bell)
// =============================================================================
// Read/write helpers for the `notifications` table. Rows are written by the
// unified push sender (api/push/send.js) for every claimed event whether or
// not the person's phone can receive Web Push — the bell is the durable
// channel, push is the fast one. Push plumbing itself lives in
// src/field/fieldPush.js; this module is feed-only.
import { supabase } from './supabase'

export async function loadUnreadCount(name) {
  if (!name) return 0
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('employee_name', name)
    .is('read_at', null)
  if (error) { console.warn('[feed] loadUnreadCount:', error.message); return 0 }
  return count || 0
}

// Last 30 days, newest first, capped at a page of 50.
export async function listNotifications(name) {
  if (!name) return []
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString()
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('employee_name', name)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) { console.warn('[feed] listNotifications:', error.message); return [] }
  return data || []
}

export async function markRead(id) {
  if (!id) return { ok: false, error: 'Missing notification id.' }
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function markAllRead(name) {
  if (!name) return { ok: false, error: 'Missing name.' }
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('employee_name', name)
    .is('read_at', null)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
