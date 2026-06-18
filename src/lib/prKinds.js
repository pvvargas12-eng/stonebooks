// =============================================================================
// prKinds — per-kind config + needs/spec helpers for purchase requests.
// =============================================================================
// Stone / Photo / Etching PRs share the same builder, editor, print, and data
// path; only three things differ and they all live here:
//   1) where the "needs" come from (stone = yard-miss resolver; photo/etching =
//      order.addOns scan),
//   2) how a need becomes a line + how a line renders its Item spec,
//   3) labels / supplier kind / whether submit touches an order milestone.
// Photo/etching have NO "ordered" milestone in any job template, so their PRs only
// change/remove the PR on submit/cancel/delete (handled in the data layer).
// =============================================================================

import { getActiveStoneOrders, getInventoryStock, listOpenPRCoverage } from './stonebooksData'
import { rowToOrder } from '../SalesMode'
import { resolveStoneNeeds, matchNeedsToStock } from './inventoryMatch'
import { resolvePRLineSpecs as resolveStoneSpecs } from './prSpec'

export const PR_KINDS = {
  stone:   { key: 'stone',   label: 'Stone',   noun: 'Stone',   supplierKind: 'stone',   itemHeader: 'Item',    hasMilestone: true,  accent: '#8a7340' },
  photo:   { key: 'photo',   label: 'Photo',   noun: 'Photo',   supplierKind: 'photo',   itemHeader: 'Photo',   hasMilestone: false, accent: '#8a5cc4' },
  etching: { key: 'etching', label: 'Etching', noun: 'Etching', supplierKind: 'etching', itemHeader: 'Etching', hasMilestone: false, accent: '#3f6ea5' },
}
export const PR_KIND_LIST = ['stone', 'photo', 'etching']
export const prKind = (k) => PR_KINDS[k] || PR_KINDS.stone

const titleCase = (s) => String(s || '').replace(/\b\w/g, c => c.toUpperCase())
const norm = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

export const photoSpecStr = (type, size) => [titleCase(type), size].map(v => String(v || '').trim()).filter(Boolean).join(' · ') || 'Photo'
export const etchingSpecStr = (size) => (String(size || '').trim() || 'Etching')

function familyOf(row) {
  if (row.primary_lastname && String(row.primary_lastname).trim()) return String(row.primary_lastname).trim()
  if (Array.isArray(row.deceased)) {
    const d = row.deceased.find(x => x && !x.isReserved && (x.lastName || x.firstName))
    if (d) return [d.lastName, d.firstName].filter(Boolean).join(', ')
  }
  return row.order_number || 'Order'
}

// A need is already on an open PR of this kind if a line shares the order + size
// (+ photo type). Used to hide needs already requested.
function onOpenPR(need, cov, kind) {
  return cov.some(c => c.order_id && need.orderId && c.order_id === need.orderId
    && norm(c.size) === norm(need.size)
    && (kind !== 'photo' || norm(c.top) === norm(need.type)))
}

// The needs list for a kind. Stone: yard-miss resolver (unchanged from the builder).
// Photo/etching: scan order.addOns for photo-* / laser-* not already on a PR.
export async function loadPRNeeds(kind) {
  const [ordRes, covRes] = await Promise.all([getActiveStoneOrders(), listOpenPRCoverage()])
  const cov = (covRes.items || []).filter(c => c.pr_kind === kind)
  const orders = (ordRes.rows || []).map(r => {
    const o = rowToOrder(r, null, null)
    o.family = familyOf(r)
    o._meta = { neededBy: r.target_completion_date || null, rush: !!r.rush_order }
    return o
  })

  if (kind === 'stone') {
    const stock = (await getInventoryStock()).rows || []
    const matched = matchNeedsToStock(resolveStoneNeeds(orders), stock)
    return matched.filter(m => !m.best && !m.fulfilled).map(m => m.need)
  }

  const prefix = kind === 'photo' ? 'photo-' : 'laser-'
  const needs = []
  for (const o of orders) {
    const meta = o._meta || {}
    for (const a of (Array.isArray(o.addOns) ? o.addOns : [])) {
      const code = String(a.code || '')
      if (!code.startsWith(prefix)) continue
      const p = code.split('-')
      if (kind === 'photo') {
        const type = a.type || p[1] || 'photo'
        const size = a.size || p[2] || ''
        needs.push({ key: `${o.id}:${code}`, orderId: o.id, orderNumber: o.orderNumber, family: o.family, neededBy: meta.neededBy, rush: meta.rush, kind: 'photo', type, size, hasImage: !!(a.customerPhotoUrl || a.customerPhotoPath), spec: photoSpecStr(type, size) })
      } else {
        const size = a.size || p[1] || ''
        needs.push({ key: `${o.id}:${code}`, orderId: o.id, orderNumber: o.orderNumber, family: o.family, neededBy: meta.neededBy, rush: meta.rush, kind: 'etching', size, spec: etchingSpecStr(size) })
      }
    }
  }
  return needs.filter(n => !onOpenPR(n, cov, kind))
}

// Turn a need into a PR line (the bulk_order_items shape). Stone leaves spec_text
// unset (live-resolved); photo stashes type→top + attachment→sides; etching size.
export function prLineFromNeed(kind, n) {
  if (kind === 'photo') {
    return { family_name: n.family, order_id: n.orderId, size: n.size, top: n.type, sides: n.hasImage ? 'photo_on_file' : 'awaiting_photo', need_key: n.key, quantity: 1 }
  }
  if (kind === 'etching') {
    return { family_name: n.family, order_id: n.orderId, size: n.size, need_key: n.key, quantity: 1 }
  }
  return { family_name: n.family, order_id: n.orderId, color: n.color, size: n.size, top: n.top, sides: n.sides, need_key: n.key, quantity: 1 }
}

// The display spec composed from a line's own stored fields (the override-free base).
export function composeLineSpec(kind, it) {
  if (kind === 'photo') return photoSpecStr(it.top, it.size)
  if (kind === 'etching') return etchingSpecStr(it.size)
  // stone manual-line fallback (no order link)
  const composed = [it.color, it.size, it.top, it.sides].map(v => (v || '').trim()).filter(Boolean).join(' · ')
  return composed || '—'
}

// Photo attachment status snapshotted on the line at build time (sides field).
export const photoAttachLabel = (it) => (it.sides === 'photo_on_file' ? 'photo on file' : it.sides === 'awaiting_photo' ? 'AWAITING PHOTO' : '')

// Resolve { lineSpec, liveSpec } for every item of a PR. Stone delegates to the
// live order-resolving resolver; photo/etching compose from the line's fields
// (override via spec_text wins). attach[] carries the photo attachment label.
export async function resolveSpecsForPR(kind, items) {
  if (kind === 'stone') {
    const { lineSpec, liveSpec } = await resolveStoneSpecs(items)
    return { lineSpec, liveSpec, attach: {} }
  }
  const lineSpec = {}, liveSpec = {}, attach = {}
  for (const it of (items || [])) {
    const base = composeLineSpec(kind, it)
    liveSpec[it.id] = base
    lineSpec[it.id] = (it.spec_text || '').trim() || base
    if (kind === 'photo') attach[it.id] = photoAttachLabel(it)
  }
  return { lineSpec, liveSpec, attach }
}
