// =============================================================================
// yardStone.js — the stone record's vocabulary (RESET-TAG-1b, 2026-10-19)
// =============================================================================
// Paul: "the words must match the contract line". The phone's chips reuse the
// SAME catalog constants the wizard / OrderForm use (TOP_SHAPES, POLISH_LEVELS,
// BASE_FINISHES, baseConfig.topFinish / polishMargin2in) and the one-line spec
// a stone row shows reads like buildDieSpec / buildBaseSpec. Column mapping is
// documented in supabase/migrations/20261019_inventory_stone_specs.sql.
// Leaf module: imports only the catalog constants (never orderRates — cycle).
// =============================================================================
import { TOP_SHAPES, POLISH_LEVELS, displayGraniteColor } from './monumentCatalog'

// Mirrors orderRates.BASE_FINISHES (SB / RB / BRP / AP / AS). Copied, not
// imported: orderRates → SalesMode → stonebooksData → this module would be a
// cycle (the pricingCore lesson). Keep the two lists in lockstep.
const BASE_FINISHES = [
  { code: 'SB', label: 'SB (sawn)' }, { code: 'RB', label: 'RB (rock pitch)' }, { code: 'BRP', label: 'BRP (balance rock pitch)' },
  { code: 'AP', label: 'All Polish' }, { code: 'AS', label: 'AS (all sawn)' },
]

export const YARD_TYPES = [
  { code: 'die', label: 'Die' }, { code: 'base', label: 'Base' }, { code: 'slant', label: 'Slant' },
  { code: 'hickey', label: 'Hickey' }, { code: 'grass', label: 'Grass' }, { code: 'backer', label: 'Backer' },
  { code: 'other', label: 'Other' },
]
export const yardTypeLabel = (code) => YARD_TYPES.find(t => t.code === String(code || '').toLowerCase())?.label
  || (code ? String(code).replace(/\b\w/g, c => c.toUpperCase()) : '')

// Which chip rows apply to which type.
const DIE_FAMILY = new Set(['die', 'slant', 'hickey', 'grass', 'marker', 'flat', 'upright'])
export const isDieFamily = (t) => DIE_FAMILY.has(String(t || '').toLowerCase())
export const isBaseType = (t) => String(t || '').toLowerCase() === 'base'
// A flat / grass marker has no top shape (Paul).
export const hasTopShape = (t) => isDieFamily(t) && !['grass', 'flat', 'marker'].includes(String(t || '').toLowerCase())

// Chip sets — code + the short word the contract line prints.
export const TOP_SHAPE_CHIPS = TOP_SHAPES.map(t => ({ code: t.code, label: t.label }))
export const POLISH_CHIPS = POLISH_LEVELS.map(p => ({ code: p.code, label: p.code.startsWith('P') ? p.code : p.label }))
export const BASE_FINISH_CHIPS = BASE_FINISHES.map(f => ({ code: f.code, label: f.code }))
export const BASE_TOP_CHIPS = [{ code: 'pol', label: 'POL TOP' }, { code: 'frost', label: 'FROST TOP' }]

export const CONDITIONS = [
  { code: 'good', label: 'Good' }, { code: 'chip', label: 'Chip' }, { code: 'crack', label: 'Crack' },
  { code: 'scratch', label: 'Scratch' }, { code: 'wrong_size', label: 'Wrong size' }, { code: 'other', label: 'Other' },
]
export const conditionLabel = (code) => CONDITIONS.find(c => c.code === code)?.label || (code ? String(code) : 'Good')

const topShapeLabel = (code) => TOP_SHAPES.find(t => t.code === code)?.label || null
const polishLabel = (code) => { const p = POLISH_LEVELS.find(x => x.code === code); return p ? (p.code.startsWith('P') ? p.code : p.label) : null }
const BASE_BACK_LABEL = { SB: 'SB', RB: 'RB', BRP: 'BRP', AP: 'ALL POL', AS: 'AS' }
const BASE_TOP_LABEL = { pol: 'POL TOP', frost: 'FROST TOP' }

// The one-line spec for a stone row, the way the contract line reads:
//   die family → "1-10 x 0-8 x 2-0 · Serp · P2 · Barre Gray"
//   base       → "2-6 x 1-0 x 0-8 · POL TOP, 2" polished margin, BRP · Barre Gray"
// Legacy rows (no codes) fall back to their free text so nothing reads blank.
export function yardStoneSpecLine(row, { withSize = true, withColor = true } = {}) {
  if (!row) return ''
  const parts = []
  if (withSize && row.size) parts.push(row.size)
  if (isBaseType(row.item_type)) {
    const fin = [
      BASE_TOP_LABEL[row.top_finish] || null,
      row.polish_margin ? '2" polished margin' : null,
      BASE_BACK_LABEL[row.finish] || (row.finish ? String(row.finish) : null),
    ].filter(Boolean)
    if (fin.length) parts.push(fin.join(', '))
    else if (row.top || row.sides) parts.push([row.top, row.sides].filter(Boolean).join(', '))
  } else {
    const top = topShapeLabel(row.top) || (row.top && !isDieFamily(row.item_type) ? null : row.top) || null
    if (top) parts.push(top)
    const pol = polishLabel(row.polish_level)
    if (pol) parts.push(pol)
    if (!top && !pol && row.sides) parts.push(row.sides)
  }
  if (withColor && row.color) parts.push(row.color)
  if (row.specs) parts.push(row.specs)
  return parts.join(' · ')
}

// Where exactly: "Zone B · crate C-7 · stack 3" (falls back to the legacy location).
export function yardStoneWhere(row) {
  if (!row) return ''
  const p = [row.zone && `Zone ${row.zone}`, row.crate && `crate ${row.crate}`, row.spot].filter(Boolean)
  if (p.length) return p.join(' · ')
  return row.location ? `@ ${row.location}` : ''
}

// Pre-fill for the ORDER path ("Die is here" / "Base is here"): the order's own
// spec, as the contract reads it. `spec` = the snake_case order row from
// getOrderSpecRow; `dims` = the trade dims pulled from the contract line.
const SIDES_TO_BASE = { 'polish-top-brp': { top_finish: 'pol', finish: 'BRP' }, 'all-polish': { finish: 'AP' }, 'brp-sawback': { finish: 'BRP' } }
// The rest of a renamed contract line minus the words the chips already carry
// ("Die P2 Barre Gray" → nothing; "Flat top. All Sawn" stays).
function restMinus(rest, words) {
  let s = String(rest || '')
  for (const w of words.filter(Boolean)) s = s.replace(new RegExp(`\\b${String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), ' ')
  s = s.replace(/\s*[·,;]\s*/g, ' · ').replace(/\s+/g, ' ').replace(/^(\s*·\s*)+|(\s*·\s*)+$/g, '').trim()
  return s || null
}
export function specFromOrder(spec, piece, dims) {
  if (!spec) return { item_type: piece === 'base' ? 'base' : 'die' }
  const color = displayGraniteColor({ graniteColor: spec.granite_color, pricing: spec.pricing }) || null
  const colorWords = color ? [color, color.replace(/grey/i, 'gray'), color.replace(/gray/i, 'grey')] : []
  if (piece === 'base') {
    const bc = spec.base_config || {}
    const fromSides = SIDES_TO_BASE[bc.sides] || {}
    const finish = bc.finish || fromSides.finish || null
    return {
      item_type: 'base', size: dims?.dims || null, color,
      finish,
      top_finish: bc.topFinish || fromSides.top_finish || null,
      polish_margin: !!bc.polishMargin2in,
      specs: dims ? restMinus(dims.rest, ['base', finish, ...colorWords]) : null,
    }
  }
  return {
    item_type: 'die', size: dims?.dims || null, color,
    top: spec.top_shape || null,
    polish_level: spec.polish_level || null,
    specs: dims ? restMinus(dims.rest, ['die', 'upright', spec.polish_level, ...colorWords]) : null,
  }
}

// "1-10 x 0-8 x 2-0" / "22 x 8 x 24" → [22, 8, 24] (inches). Unreadable → [].
export function sizeToInches(size) {
  return String(size || '').split(/\s*[x×X]\s*/).map(t => {
    const v = t.trim().replace(/[″"']/g, '')
    let m = /^(\d+)-(\d+(?:\.\d+)?)$/.exec(v)
    if (m) return Number(m[1]) * 12 + Number(m[2])
    m = /^(\d+(?:\.\d+)?)$/.exec(v)
    return m ? Number(m[1]) : null
  }).filter(v => v != null)
}
// A MATERIAL size change (Paul's rule): a different number of dims, or any
// dim off by more than an inch. Unreadable sizes never count as different.
export function sizeMateriallyDifferent(a, b) {
  const A = sizeToInches(a), B = sizeToInches(b)
  if (!A.length || !B.length) return false
  if (A.length !== B.length) return true
  return A.some((v, i) => Math.abs(v - B[i]) > 1)
}

// Does the typed search read as a STONE (dims or a type word) rather than a
// family name? "2-0 x 0-8", "24x8x16", "die", "base 2-6" → yes.
export function looksLikeStone(q) {
  const s = String(q || '').trim().toLowerCase()
  if (!s) return false
  if (/\d+\s*[-x×]\s*\d/.test(s)) return true
  const first = s.split(/\s+/)[0]
  return ['die', 'base', 'slant', 'hickey', 'grass', 'flat', 'backer', 'marker', 'other'].includes(first)
}
export function stoneFromSearch(q) {
  const s = String(q || '').trim()
  const first = s.split(/\s+/)[0].toLowerCase()
  const typeMap = { die: 'die', base: 'base', slant: 'slant', hickey: 'hickey', grass: 'grass', flat: 'grass', backer: 'backer', marker: 'grass', other: 'other' }
  const item_type = typeMap[first] || null
  const m = /(\d[\d\-x×X\s"″']*\d)/.exec(s)
  return { item_type, size: m ? m[1].trim() : null }
}
