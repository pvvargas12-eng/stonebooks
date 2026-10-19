// =============================================================================
// stonePosition.js — ONE verdict per piece (die / base) for every open stone
// order, shared by the desktop Stone Position list and the phone's Find box.
// =============================================================================
// RESET-TAG-1 (2026-10-19): the logic that lived inside StonePositionList
// moved here so the phone's "Die is here / Base is here" result rows show the
// SAME chips the desktop shows — one rule, two surfaces. Best evidence wins:
//   IN YARD     — a live yard row is linked to this order (or allocated under
//                 this exact family name); carries the painted tag + zone/crate
//   RECEIVED    — a stone-PR line for this order came in
//   ORDERED     — a stone-PR line exists / the order's stone milestone says so
//   NOT ORDERED — nothing anywhere (red — the only ones to buy)
// Archived (pre-reset) rows never count: getInventoryStock excludes them.
// =============================================================================
import { listOpenOrdersLight, listJobOrderPairs, getInventoryStock, fmtDate, fmtYardTag } from './stonebooksData'
import { supabase } from './supabase'

export const STONE_SVC = new Set(['NEW_STONE', 'CIVIC_MEMORIAL', 'MAUSOLEUM'])
// Yard item types that fill the DIE slot (the carved piece) vs the BASE slot.
export const DIE_TYPES = new Set(['die', 'slant', 'grass', 'hickey', 'marker', 'flat', 'upright'])
export const isDieType = (t) => DIE_TYPES.has(String(t || '').toLowerCase())
export const isBaseType = (t) => String(t || '').toLowerCase() === 'base'

export const nameTokens = (s) => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(t => t.length >= 3)

export const isStoneOrder = (o) => (o?.service_types || []).some(s => STONE_SVC.has(String(s).toUpperCase()))

// Everything the verdict needs, fetched once. `orders` = every open order
// (the phone searches all of them); `stoneOrders` = the ones that carry a
// stone service (the desktop list).
export async function loadStonePositionData() {
  const [orders, pairs, stock, prLines] = await Promise.all([
    listOpenOrdersLight(),
    listJobOrderPairs(),
    getInventoryStock().then(r => (Array.isArray(r) ? r : (r?.rows || []))),
    supabase.from('bulk_order_items')
      .select('order_id, item_type, quantity, received_qty, bulk_order:bulk_orders(status, kind)')
      .not('order_id', 'is', null)
      .then(({ data: rows, error }) => { if (error) throw new Error(error.message); return rows || [] }),
  ])
  const stoneOrders = (orders || []).filter(isStoneOrder)
  const jobByOrder = new Map((pairs || []).map(p => [p.order_id, p.id]))
  const jobIds = stoneOrders.map(o => jobByOrder.get(o.id)).filter(Boolean)
  const msByJob = new Map()
  for (let i = 0; i < jobIds.length; i += 150) {
    const { data: ms, error } = await supabase.from('job_milestones')
      .select('job_id, milestone_key, status')
      .in('job_id', jobIds.slice(i, i + 150))
      .in('milestone_key', ['stone_in_stock', 'stone_ordered', 'stone_needs_pickup', 'stone_received'])
    if (error) continue
    for (const m of (ms || [])) {
      if (!msByJob.has(m.job_id)) msByJob.set(m.job_id, {})
      msByJob.get(m.job_id)[m.milestone_key] = m.status
    }
  }
  const prByOrder = new Map()
  for (const l of prLines) {
    if (l.bulk_order?.status === 'cancelled') continue
    if (!prByOrder.has(l.order_id)) prByOrder.set(l.order_id, [])
    prByOrder.get(l.order_id).push(l)
  }
  return { orders: orders || [], stoneOrders, jobByOrder, msByJob, stock, prByOrder }
}

// The verdict for one piece of one order. `data` is loadStonePositionData's
// result (its `stock` may be swapped for a fresher list after a yard write).
export function stoneVerdict(order, slot, data) {
  const { jobByOrder, msByJob, stock, prByOrder } = data
  const slotMatch = slot === 'die' ? isDieType : isBaseType
  // 1 — a yard piece, linked (or allocated under this exact family name).
  const oTokens = new Set([...nameTokens(order.primary_lastname), ...nameTokens(order.customer?.last_name)])
  const yard = (stock || []).find(r => r.status === 'allocated' && slotMatch(r.item_type) && (
    r.allocated_order_id === order.id
    || (!r.allocated_order_id && nameTokens(r.assigned_to).some(t => oTokens.has(t)))
  ))
  if (yard) {
    const where = [yard.zone && `Zone ${yard.zone}`, yard.crate && `crate ${yard.crate}`].filter(Boolean).join(' ')
    return {
      code: 'yard', label: 'IN YARD',
      tag: yard.yard_tag != null ? fmtYardTag(yard.yard_tag) : null,
      where: where || null,
      sub: yard.verified_at ? `seen ${fmtDate(yard.verified_at)}` : null,
      linked: !!yard.allocated_order_id, yard,
    }
  }
  // 2 — a stone-PR line for this order, typed for the slot.
  const lines = (prByOrder.get(order.id) || []).filter(l => slotMatch(l.item_type))
  if (lines.some(l => Number(l.received_qty) > 0)) return { code: 'received', label: 'RECEIVED' }
  if (lines.length) return { code: 'ordered', label: 'ORDERED' }
  // 3 — the order's whole-stone milestone ladder (no per-piece detail).
  const ms = msByJob.get(jobByOrder.get(order.id)) || {}
  if (ms.stone_received === 'done' || ms.stone_in_stock === 'done') return { code: 'received', label: 'HERE', sub: 'per the order status' }
  if (ms.stone_ordered === 'done' || ms.stone_needs_pickup === 'done') return { code: 'ordered', label: 'ORDERED', sub: 'per the order status' }
  return { code: 'none', label: 'NOT ORDERED' }
}

// Chip text with the painted number + where it sits: "IN YARD · 041 · Zone B crate C-7".
export function verdictChipText(v) {
  if (!v) return ''
  if (v.code !== 'yard') return v.label
  return [v.label, v.tag, v.where].filter(Boolean).join(' · ')
}
