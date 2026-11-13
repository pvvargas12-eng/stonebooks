// =============================================================================
// stockMatches.js — the record of yard stones used instead of ordered
// =============================================================================
// PR-MATCH-2 (Paul 2026-11-13). One row per Confirm match on a Stone PR
// (table stock_match_log, migration 20261113). The yard row stays the truth
// for which stone belongs to which order; this is the record of the match and
// of what the line would have cost in the supplier's book (money saved).
// Remove match stamps removed_at, rows are never deleted, and "saved" counts
// live rows only.
// =============================================================================
import { supabase } from './supabase'

const COLS = 'id, order_id, bulk_order_id, po_number, stock_id, yard_tag, piece, family, line_spec, stone_spec, supplier, saved_amount, saved_basis, matched_by, matched_at, removed_at, removed_by'

export async function addStockMatch(m = {}) {
  const row = {
    order_id: m.orderId || null, bulk_order_id: m.bulkOrderId || null, po_number: m.poNumber || null,
    stock_id: m.stockId || null, yard_tag: m.yardTag ?? null, piece: m.piece || null, family: m.family || null,
    line_spec: m.lineSpec || null, stone_spec: m.stoneSpec || null, supplier: m.supplier || null,
    saved_amount: (m.savedAmount != null && Number.isFinite(Number(m.savedAmount))) ? Number(m.savedAmount) : null,
    saved_basis: m.savedBasis || null, matched_by: m.by || null,
  }
  const { data, error } = await supabase.from('stock_match_log').insert(row).select(COLS).single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, row: data }
}

// Remove match: every live record of this stone on this order.
export async function removeStockMatch({ stockId, orderId, by = null }) {
  if (!stockId) return { ok: true }
  let q = supabase.from('stock_match_log').update({ removed_at: new Date().toISOString(), removed_by: by }).eq('stock_id', stockId).is('removed_at', null)
  if (orderId) q = q.eq('order_id', orderId)
  const { error } = await q
  return error ? { ok: false, error: error.message } : { ok: true }
}

// A PR built from scratch has no id until it is saved: its matches are tied to
// it then.
export async function attachStockMatchesToPR(ids, bulkOrderId, poNumber = null) {
  const list = (ids || []).filter(Boolean)
  if (!list.length || !bulkOrderId) return { ok: true }
  const patch = { bulk_order_id: bulkOrderId }
  if (poNumber) patch.po_number = poNumber
  const { error } = await supabase.from('stock_match_log').update(patch).in('id', list)
  return error ? { ok: false, error: error.message } : { ok: true }
}

// Live matches: for one PR, or everything since a day (Owner stats).
export async function listStockMatches({ bulkOrderId = null, ids = null, since = null, limit = 2000 } = {}) {
  let q = supabase.from('stock_match_log').select(COLS).is('removed_at', null).order('matched_at', { ascending: false }).limit(limit)
  if (bulkOrderId) q = q.eq('bulk_order_id', bulkOrderId)
  if (ids && ids.length) q = q.in('id', ids)
  if (since) q = q.gte('matched_at', since)
  const { data, error } = await q
  if (error) { console.warn('[stock-matches] list:', error.message); return [] }
  return data || []
}
