// =============================================================================
// inventoryMatch.js — Smart Matches: resolve what open orders physically need,
// then match those needs against available yard stock. PURE / read-only.
// =============================================================================
// Reuses the canonical spec resolvers (buildDieSpec / buildBaseSpec / dieSize3 /
// dieTopLabel) — does NOT re-derive spec logic. Deterministic string/dimension
// comparison only (NO AI/fuzzy). Sizes are compared on a normalized form but the
// verbatim stored strings are preserved for display.
//
// Classification is on the RELIABLE axes — item_type + color + size. Finish
// (top/sides) is shown for human verification but NOT used to downgrade a match:
// the order stores top SHAPE ("Serp") + polish ("P3"), while the yard stores top
// FINISH ("Polished") + sides ("BRP") — different axes, so comparing them would
// wrongly turn every exact into a near. A finish-vocabulary map is a later phase.
// =============================================================================

import {
  SHAPES, GRANITE_COLORS, BASE_SIZES, BASE_HEIGHTS,
  buildDieSpec, buildBaseSpec, dieSize3, dieTopLabel, dimsFromWDT,
} from './monumentCatalog'

// Map a monument shape code → an inventory item_type.
const SHAPE_TO_ITEM_TYPE = {
  grass: 'grass', hickey: 'hickey', slant: 'slant', 'double-slant': 'slant',
  die: 'die', 'double-die': 'die', flat: 'marker', bronze: 'bronze',
  bench: 'bench', ledger: 'ledger', civic: 'custom', custom: 'custom',
}

// ── Need resolution ──────────────────────────────────────────────────────────
// Each order can yield a STONE need (the die/marker) and, when a base is included,
// a BASE need. Service-only orders (no shape → buildDieSpec '') yield no need.
export function resolveStoneNeeds(orders) {
  const needs = []
  for (const o of (orders || [])) {
    if (!o) continue
    const shape = SHAPES.find(s => s.code === o.shape)
    if (!shape) continue
    const dieSpec = buildDieSpec(o)
    if (!dieSpec) continue
    const color = GRANITE_COLORS.find(c => c.code === o.graniteColor)
    const family = o.family || o.orderNumber || 'Order'
    const colorLabel = color?.label || o.graniteColor || null

    needs.push({
      key: `${o.id}:stone`,
      orderId: o.id,
      orderNumber: o.orderNumber || null,
      family,
      kind: 'stone',
      itemType: SHAPE_TO_ITEM_TYPE[o.shape] || 'custom',
      color: colorLabel,
      size: dieSize3(o, shape) || '',
      top: dieTopLabel(o) || null,           // top SHAPE (context only)
      sides: o.sides || null,                // sides treatment (context only)
      spec: dieSpec,
    })

    const bc = o.baseConfig || {}
    if (bc.include) {
      const bs = BASE_SIZES.find(b => b.code === bc.sizeCode)
      const w = bs ? bs.w : bc.width
      const d = bs ? bs.d : bc.depth
      const t = (bc.heightCode != null) ? bc.heightCode : null   // height code IS inches (6/8/10/12)
      const baseSize = dimsFromWDT({ w, d, t }) || ''
      if (w || d) {
        needs.push({
          key: `${o.id}:base`,
          orderId: o.id,
          orderNumber: o.orderNumber || null,
          family,
          kind: 'base',
          itemType: 'base',
          color: colorLabel,
          size: baseSize,
          top: null,
          sides: bc.finish || null,
          spec: buildBaseSpec(o),
          heightLabel: (bc.heightCode != null) ? (BASE_HEIGHTS.find(x => x.code === bc.heightCode)?.label || null) : null,
        })
      }
    }
  }
  return needs
}

// ── Normalization (compare-only; display always uses the verbatim stored value) ─
const normType = (v) => String(v ?? '').toLowerCase().trim()
const normColor = (v) => String(v ?? '').toLowerCase().replace(/grey/g, 'gray').replace(/[^a-z0-9]/g, '')
const normSize = (v) => String(v ?? '').toLowerCase().replace(/×/g, 'x').replace(/\s/g, '')

function colorMatch(a, b) {
  const na = normColor(a), nb = normColor(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

const dimsOf = (sizeStr) => normSize(sizeStr).split('x').filter(Boolean)
function inchesOf(d) {           // "2-6" → 30 ; "8" → 8
  const m = String(d).match(/(\d+)\s*-\s*(\d+)/)
  if (m) return parseInt(m[1], 10) * 12 + parseInt(m[2], 10)
  const n = parseInt(String(d).replace(/[^\d]/g, ''), 10)
  return Number.isFinite(n) ? n : null
}
// 'exact' (all dims agree) | 'near' (exactly one dim differs) | 'far'.
function compareSize(needSize, yardSize) {
  const a = dimsOf(needSize), b = dimsOf(yardSize)
  if (!a.length || !b.length) return { strength: 'far', diff: null }
  if (normSize(needSize) === normSize(yardSize)) return { strength: 'exact', diff: null }
  const names = ['width', 'depth', 'height']
  const n = Math.max(a.length, b.length)
  let same = 0, diff = null
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i] && a[i] != null) { same++; continue }
    const inN = inchesOf(a[i]), inH = inchesOf(b[i])
    diff = { dim: names[i] || `dim ${i + 1}`, need: a[i] ?? '—', have: b[i] ?? '—', deltaIn: (inN != null && inH != null) ? inH - inN : null }
  }
  if (same >= 2 && a.length === b.length) return { strength: 'near', diff }
  return { strength: 'far', diff }
}
function sizeReason(d) {
  if (!d) return 'size differs'
  if (d.deltaIn != null && d.deltaIn !== 0) {
    return `${d.have} ${d.dim}, need ${d.need} — ${Math.abs(d.deltaIn)}″ ${d.deltaIn > 0 ? 'over' : 'short'}`
  }
  return `${d.dim}: have ${d.have}, need ${d.need}`
}

// ── Matcher ──────────────────────────────────────────────────────────────────
const RANK = { exact: 2, near: 1 }
export function matchNeedsToStock(needs, stock) {
  const available = (stock || []).filter(s => (s.status || 'available') === 'available')
  return (needs || []).map(need => {
    let best = null
    let candidateCount = 0
    for (const s of available) {
      if (normType(s.item_type) !== normType(need.itemType)) continue
      if (!colorMatch(need.color, s.color)) continue
      const sz = compareSize(need.size, s.size)
      if (sz.strength === 'far') continue
      candidateCount++
      const strength = sz.strength
      const why = strength === 'near' && sz.diff ? [sizeReason(sz.diff)] : []
      const cand = { stock: s, strength, why }
      if (!best || RANK[strength] > RANK[best.strength]) best = cand
    }
    return { need, best, candidateCount }
  })
}
