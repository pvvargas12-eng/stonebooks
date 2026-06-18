// =============================================================================
// prSpec — resolve a Stone PR line's "Item" spec the way the contract reads it.
// =============================================================================
// Shared by the PR print sheet and the PR editor so they never drift. Priority:
//   1) manual wording override (bulk_order_items.spec_text)
//   2) LIVE spec from the linked order for this line's kind (die / base), via the
//      SAME resolver the contract uses (resolveStoneNeeds → buildDieSpec /
//      buildBaseSpec); base gets the order color appended to match the die
//   3) composed color+size fallback (manual lines with no order link)
// Never borrows the other kind's spec.
// =============================================================================

import { getOrderById } from './stonebooksData'
import { rowToOrder } from '../SalesMode'
import { resolveStoneNeeds } from './inventoryMatch'

const normSize = (v) => String(v ?? '').toLowerCase().replace(/×/g, 'x').replace(/[^a-z0-9x]/g, '')

export function lineKind(it, resolved) {
  const st = (it.spec_text || '').trim().toLowerCase()
  if (st.startsWith('base')) return 'base'
  if (st.startsWith('die')) return 'die'
  const ls = normSize(it.size)
  if (ls && resolved?.base && normSize(resolved.base.size) === ls) return 'base'
  if (ls && resolved?.die && normSize(resolved.die.size) === ls) return 'die'
  if (resolved?.base && !(it.top && it.top.trim())) return 'base'
  return 'die'
}

// The spec resolved from the order (ignores the override) — used as the print value
// AND as the editor's placeholder so staff see what it prints as when left blank.
export function liveLineSpec(it, resolved) {
  const kind = lineKind(it, resolved)
  const need = resolved ? (kind === 'base' ? resolved.base : resolved.die) : null
  if (need && need.spec) {
    if (kind === 'base') return `Base: ${need.spec}${need.color ? ` · ${need.color}` : ''}`
    return `Die: ${need.spec}`
  }
  const composed = [it.color, it.size, it.top, it.sides].map(v => (v || '').trim()).filter(Boolean).join(' · ')
  if (!composed) return '—'
  return `${kind === 'base' ? 'Base: ' : 'Die: '}${composed}`
}

// Effective spec: manual override wins, else the live spec.
export function resolveLineSpec(it, resolved) {
  const override = (it.spec_text || '').trim()
  return override || liveLineSpec(it, resolved)
}

// Load each linked order once, resolve its die + base needs, and return both the
// effective spec map (override-aware) and the live spec map (override-ignored).
export async function resolvePRLineSpecs(items) {
  const orderIds = [...new Set((items || []).map(i => i.order_id).filter(Boolean))]
  const resolvedByOrder = {}
  await Promise.all(orderIds.map(async (oid) => {
    try {
      const row = await getOrderById(oid)
      if (!row) return
      const order = rowToOrder(row, null, null)
      const needs = resolveStoneNeeds([order])
      resolvedByOrder[oid] = {
        die: needs.find(n => n.kind !== 'base') || null,
        base: needs.find(n => n.kind === 'base') || null,
      }
    } catch { /* leave unresolved → fallback path */ }
  }))
  const lineSpec = {}, liveSpec = {}
  for (const it of (items || [])) {
    const r = resolvedByOrder[it.order_id]
    lineSpec[it.id] = resolveLineSpec(it, r)
    liveSpec[it.id] = liveLineSpec(it, r)
  }
  return { lineSpec, liveSpec, resolvedByOrder }
}

export const isBaseSpec = (s) => /^base/i.test(String(s || '').trim())
