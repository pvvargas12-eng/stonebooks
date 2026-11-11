// =============================================================================
// prCost.js — what a Stone PR line costs by the supplier's own price book
// =============================================================================
// Paul 2026-11-10: "based on the price from Peerless I want this calculated on
// total cost next to order number." The books are the ones the Quote Generator
// reads (src/data/priceBooks.json — Peerless July 2026 v2, Kani 2026). PURE and
// derived at read time: nothing is stored on the PR.
//   exact    = the printed row for that size, in that color's column
//   estimate = no printed row; face area x the book's sq-ft rate for that thickness
// The book price is the stone at its listed size and color. Shaped tops, extra
// polish and freight are the supplier's adders and are NOT in this number.
// =============================================================================
import { BOOKS, searchBook, estimateFromRate } from './quoteEngine'
import { sizeToInches } from './yardStone'
import { stoneTypeFamily } from './inventoryMatch'

export function bookKeyForSupplier(name) {
  const s = String(name || '').toLowerCase()
  if (s.includes('peerless')) return 'peerless'
  if (s.includes('kani')) return 'kani'
  return null
}
export const bookName = (key) => BOOKS[key]?.short || BOOKS[key]?.name || null
export const bookEdition = (key) => BOOKS[key]?.edition || null

const SECTION_OF = { die: 'die', base: 'base', slant: 'slant', hickey: 'hickey', flat: 'grass', backer: 'backer' }

// The line's typed color → the book's color column. null = not recognized.
function peerlessColumn(text) {
  const s = String(text || '').toLowerCase()
  if (!s.trim()) return null
  if (/zimbabwe/.test(s)) return 'zimbabwe_black'
  if (/blue\s*pearl/.test(s)) return 'blue_pearl'
  if (/mahogany/.test(s)) return 'canadian_mahogany'
  if (/rose|pink/.test(s)) return 'morning_rose'
  if (/gem|mist/.test(s)) return 'gem_mist'
  if (/black|impala/.test(s)) return 'impala_black'
  if (/dark|\bdk\b/.test(s)) return 'dark_barre'
  if (/barre|gr[ae]y|\bmd\b|medium/.test(s)) return 'medium_barre'
  return null
}
function kaniColumn(text) {
  const s = String(text || '').toLowerCase().replace(/grey/g, 'gray').trim()
  if (!s) return null
  for (const c of (BOOKS.kani?.colors || [])) {
    if ((c.names || []).some(n => { const k = String(n).toLowerCase().replace(/grey/g, 'gray'); return s.includes(k) || k.includes(s) })) return c.key
  }
  if (/black|impala/.test(s)) return 'B'
  if (/barre|barra|gray/.test(s)) return 'A'
  return null
}
const DEFAULT_COLUMN = { peerless: 'medium_barre', kani: 'A' }
const columnLabel = (key, col) => {
  const c = (BOOKS[key]?.colors || []).find(x => x.key === col)
  if (!c) return col
  return key === 'kani' ? `Group ${c.key}` : c.label
}

// → { ok: true, unit, total, qty, tier, column, columnLabel, assumedColor, sizeLabel }
//   | { ok: false, why }
export function lineBookCost(line, bookKey) {
  const book = BOOKS[bookKey]
  if (!book) return { ok: false, why: 'No price book for this supplier' }
  const fam = stoneTypeFamily(line?.item_type)
  const section = SECTION_OF[fam]
  if (!section) return { ok: false, why: 'Type is not in the book' }
  const dims = sizeToInches(line?.size)
  if (dims.length < 3) return { ok: false, why: 'Size needs L x W x H' }
  const [L, W, H] = dims
  let column = bookKey === 'kani' ? kaniColumn(line.color) : peerlessColumn(line.color)
  const assumedColor = !column
  if (!column) column = DEFAULT_COLUMN[bookKey]
  const qty = Math.max(1, Number(line.quantity) || 1)
  const exact = searchBook({ supplierKey: bookKey, section, L, W, H }).find(r => r.tier === 'exact' && r.prices?.[column] != null)
  if (exact) {
    const unit = Number(exact.prices[column])
    return { ok: true, unit, total: unit * qty, qty, tier: 'exact', column, columnLabel: columnLabel(bookKey, column), assumedColor, sizeLabel: exact.label }
  }
  const est = estimateFromRate({ supplierKey: bookKey, section, L, W, H })
  if (est && est.prices?.[column] != null) {
    const unit = Number(est.prices[column])
    return { ok: true, unit, total: unit * qty, qty, tier: 'estimate', column, columnLabel: columnLabel(bookKey, column), assumedColor, sizeLabel: est.label }
  }
  return { ok: false, why: 'Size is not in the book' }
}

// Every line priced + the totals. `lines` = the PR grid rows.
export function prBookCost(lines, bookKey) {
  const byId = new Map()
  let total = 0, priced = 0, unpriced = 0, estimated = 0, assumed = 0
  for (const l of (lines || [])) {
    const c = lineBookCost(l, bookKey)
    byId.set(l.id, c)
    if (c.ok) { total += c.total; priced++; if (c.tier === 'estimate') estimated++; if (c.assumedColor) assumed++ }
    else unpriced++
  }
  return { byId, total, priced, unpriced, estimated, assumed }
}
