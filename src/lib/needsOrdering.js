// =============================================================================
// needsOrdering — lines taken off the Needs Ordering list by hand
// (NEEDS-ORDERING-2, Paul 2026-11-18). Table needs_ordering_dismissals,
// migration 20261118_needs_ordering_dismissals.sql. A missing table reads as
// an empty list, never a crash.
// =============================================================================
import { supabase } from './supabase'

export async function listNeedsOrderingDismissals() {
  const { data, error } = await supabase.from('needs_ordering_dismissals').select('need_key, order_id, kind, reason, dismissed_by, created_at')
  if (error) { console.warn('[needs] listNeedsOrderingDismissals:', error.message); return { ok: false, rows: [], error: error.message } }
  return { ok: true, rows: data || [], error: null }
}
export async function dismissNeedsOrdering({ needKey, orderId = null, kind = null, reason = null, by = null }) {
  if (!needKey) return { ok: false, error: 'Missing need key.' }
  const { error } = await supabase.from('needs_ordering_dismissals')
    .upsert({ need_key: needKey, order_id: orderId, kind, reason, dismissed_by: by }, { onConflict: 'need_key' })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
// PR-EMAIL-2: the PR row remembers it was emailed (columns added by migration
// 20261118_bulk_orders_emailed.sql). A failure here never undoes the send.
export async function markPREmailed(bulkOrderId, { to = null, by = null } = {}) {
  if (!bulkOrderId) return { ok: false, error: 'Missing PR.' }
  const { error } = await supabase.from('bulk_orders')
    .update({ emailed_at: new Date().toISOString(), emailed_to: to, emailed_by: by }).eq('id', bulkOrderId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function restoreNeedsOrdering(needKey) {
  if (!needKey) return { ok: false, error: 'Missing need key.' }
  const { error } = await supabase.from('needs_ordering_dismissals').delete().eq('need_key', needKey)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
