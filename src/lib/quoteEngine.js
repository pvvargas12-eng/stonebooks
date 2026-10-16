// =============================================================================
// quoteEngine — the Quote Generator's brain (desktop Tools tab + Stonebooks
// Field share it). Paul 2026-10-16.
// =============================================================================
// Three jobs:
//   1. Turn typed sizes ("4-0", "48", "4'0") into inches and back.
//   2. Build a REAL order object from a spec so priceOrderTotals() — the same
//      engine the contract prints — produces the quote's line items. No second
//      price list exists: the quote IS the contract math.
//   3. Search the supplier books (src/data/priceBooks.json: Peerless 2026 v2 +
//      Kani 2026, parsed from the PDFs) by size, estimate off the book's
//      square-foot rate when a size is not printed, and apply the markup.
// Rates / markup overrides live in pricing_config.quoteBook (the mini settings)
// so the yearly refresh is one number per color per thickness, PDF or not.
// =============================================================================
import books from '../data/priceBooks.json'
import { SHAPES, BASE_SIZES, GRANITE_COLORS, POLISH_LEVELS } from './orderRates'

export const BOOKS = books.suppliers
export const BOOK_KEYS = Object.keys(BOOKS)          // ['peerless', 'kani']
export const BOOK_GENERATED = books.generatedAt
export const DEFAULT_MARKUP_PCT = 500                 // Paul: "start at like 500%" — cost × 6

// ── sizes ───────────────────────────────────────────────────────────────────
// "4-0" → 48 · "0-8" → 8 · "48" → 48 · "4'0" / "4' 0" / "4 0" → 48 · junk → null
export function parseDim(raw) {
  const s = String(raw ?? '').trim().toLowerCase().replace(/(″|"|in|inch|inches)$/g, '').trim()
  if (!s) return null
  let m = /^(\d+)\s*[-'’\s]\s*(\d+(?:\.\d+)?)$/.exec(s)
  if (m) return Number(m[1]) * 12 + Number(m[2])
  m = /^(\d+(?:\.\d+)?)$/.exec(s)
  if (m) return Number(m[1])
  return null
}
export const inToTrade = (n) => {
  if (n == null || !Number.isFinite(Number(n))) return ''
  const v = Number(n); const ft = Math.floor(v / 12); const inch = Math.round((v - ft * 12) * 10) / 10
  return `${ft}-${inch}`
}
export const fmtTrade = (L, W, H) => [L, W, H].filter(v => v != null).map(inToTrade).join(' x ')
export const fmtInches = (L, W, H) => [L, W, H].filter(v => v != null).map(v => `${v}`).join(' x ')
// How a book prints its sizes.
export const fmtForBook = (supplierKey, L, W, H) => BOOKS[supplierKey]?.units === 'trade' ? fmtTrade(L, W, H) : fmtInches(L, W, H)

// ── shapes the quote offers ─────────────────────────────────────────────────
// section = the book section searched · flat = the third box is the thickness
// (markers) rather than the height (dies / slants).
export const QUOTE_SHAPES = [
  { code: 'die',          label: 'Die',          section: 'die',    flat: false, dims: ['Length', 'Thickness', 'Height'] },
  { code: 'double-die',   label: 'Double die',   section: 'die',    flat: false, dims: ['Length', 'Thickness', 'Height'] },
  { code: 'slant',        label: 'Slant',        section: 'slant',  flat: false, dims: ['Length', 'Width', 'Height'] },
  { code: 'double-slant', label: 'Double slant', section: 'slant',  flat: false, dims: ['Length', 'Width', 'Height'] },
  { code: 'grass',        label: 'Grass marker', section: 'grass',  flat: true,  dims: ['Length', 'Width', 'Thickness'] },
  { code: 'hickey',       label: 'Hickey',       section: 'hickey', flat: true,  dims: ['Length', 'Width', 'Thickness'] },
]
export const BASE_FINISH_OPTIONS = [
  { code: 'BRP', label: 'BRP · balance rock pitch' },
  { code: 'SB',  label: 'Saw back · $45/ft' },
  { code: 'AS',  label: 'All sawn · $45/ft around' },
  { code: 'RB',  label: 'Rock pitch' },
  { code: 'AP',  label: 'All polish' },
]
export const POLISH_OPTIONS = POLISH_LEVELS.filter(p => ['P2', 'P3', 'P5'].includes(p.code))
export const FOUNDATION_OPTIONS = ['Our Foundation', 'Strip', 'Cemetery Foundation']
// The add-ons the quote offers straight from the sheet (codes = ADD_ONS_CATALOG).
export const QUOTE_ADDONS = [
  { code: 'lett-year', label: 'Lettering: year only' },
  { code: 'lett-mdy',  label: 'Lettering: month/day/year' },
  { code: 'lett-full', label: 'Lettering: full inscription' },
  { code: 'panel',     label: 'Panel' },
  { code: 'granite-vet-fdn', label: 'Granite VET + FDN + set' },
  { code: 'granite-vet',     label: 'Granite VET + set (no FDN)' },
  { code: 'bronze-vet-fdn',  label: 'Bronze VET base + FDN + set' },
  { code: 'bronze-vet',      label: 'Bronze VET base (no FDN)' },
]

// The sheet's printed sizes use the printed price: find the catalog size that
// matches the typed dims (dies: w = L, d = thickness, t = height; markers:
// w = L, d = W, t = thickness). Null = custom → the per-square-inch rule.
export function sizeCodeFor(shapeCode, L, W, H) {
  const sh = SHAPES.find(s => s.code === shapeCode)
  if (!sh || !L) return null
  const hit = (sh.standardSizes || []).find(s => s.w === L && s.d === W && s.t === H)
  return hit ? hit.code : null
}
// Printed base sizes (the sheet's 6″ slant bases and 8″ polished-top bases).
export function baseSizeCodeFor(L, W, H) {
  if (!L || !W) return null
  const hit = BASE_SIZES.find(b => {
    if (b.w !== L || b.d !== W) return false
    const hm = /×\s*(\d+-\d+)/g; let last = null, m
    while ((m = hm.exec(b.label))) last = m[1]
    const hIn = last ? parseDim(last) : null
    return !H || !hIn || hIn === H
  })
  return hit ? hit.code : null
}

// ── colors ──────────────────────────────────────────────────────────────────
// Which book column a Stonebooks color reads from. approx = the book has no
// such stone; the column is the nearest cousin and the UI says so.
export const COLOR_BOOK_MAP = {
  'medium-barre-grey':  { peerless: 'medium_barre', kani: 'A' },
  'light-gray':         { peerless: 'medium_barre', kani: 'A', approx: ['peerless', 'kani'] },
  'medium-gray':        { peerless: 'medium_barre', kani: 'A', approx: ['peerless', 'kani'] },
  'dark-gray':          { peerless: 'dark_barre', kani: 'A', approx: ['peerless', 'kani'] },
  'legacy-gray':        { peerless: 'medium_barre', kani: 'A', approx: ['peerless', 'kani'] },
  'st-cloud-grey':      { peerless: 'medium_barre', kani: 'A', approx: ['peerless', 'kani'] },
  'cloud-gray':         { peerless: 'medium_barre', kani: 'A', approx: ['peerless', 'kani'] },
  'jet-black':          { peerless: 'impala_black', kani: 'B', approx: ['peerless'] },
  'american-black':     { peerless: 'impala_black', kani: 'B', approx: ['peerless', 'kani'] },
  'flash-impala-black': { peerless: 'impala_black', kani: 'B' },
  'bahama-blue':        { kani: 'C' },
  'mountain-rose':      { peerless: 'morning_rose', kani: 'E', approx: ['peerless', 'kani'] },
  'colonial-rose':      { peerless: 'morning_rose', kani: 'E', approx: ['peerless', 'kani'] },
  'salisbury-pink':     { kani: 'E', approx: ['kani'] },
  'imperial-pink':      { kani: 'E' },
  'india-red':          { kani: 'E' },
  'missouri-red':       { kani: 'E', approx: ['kani'] },
  'dakota-mahogany':    { peerless: 'canadian_mahogany', kani: 'D', approx: ['peerless'] },
  'royal-mahogany':     { peerless: 'canadian_mahogany', kani: 'D', approx: ['peerless'] },
  'china-evergreen':    { kani: 'G', approx: ['kani'] },
  'cats-eye-brown':     { kani: 'E' },
  'paradiso':           { kani: 'D' },
}
// A color picked straight out of a book: code 'book:<supplier>:<column>'.
export const bookColorCode = (supplier, col) => `book:${supplier}:${col}`
export function parseBookColor(code) {
  const m = /^book:(\w+):(\w+)$/.exec(String(code || ''))
  return m ? { supplier: m[1], col: m[2] } : null
}
export function bookColumnFor(colorCode, supplierKey) {
  const bc = parseBookColor(colorCode)
  if (bc) return bc.supplier === supplierKey ? { key: bc.col, approx: false } : null
  const m = COLOR_BOOK_MAP[colorCode]
  if (!m || !m[supplierKey]) return null
  return { key: m[supplierKey], approx: !!(m.approx && m.approx.includes(supplierKey)) }
}
export function bookColorLabel(supplierKey, col) {
  const c = BOOKS[supplierKey]?.colors.find(x => x.key === col)
  if (!c) return col
  return c.names ? c.names[0] : c.label
}
export function colorLabel(colorCode, customName = '') {
  const bc = parseBookColor(colorCode)
  if (bc) return bookColorLabel(bc.supplier, bc.col)
  if (colorCode === 'custom') return customName || 'Custom color'
  return GRANITE_COLORS.find(c => c.code === colorCode)?.label || colorCode || ''
}
export function standingPremium(colorCode) {
  const c = GRANITE_COLORS.find(x => x.code === colorCode)
  return c ? Math.round((c.premium || 0) * 100) : 0
}
// Every color the quote can pick: the sheet's colors first (with their
// standing premium), then each book's own columns, then Custom.
export function quoteColorOptions(activeColors) {
  const sheet = (activeColors && activeColors.length ? activeColors : GRANITE_COLORS)
  const out = [{ group: 'Your sheet', options: sheet.map(c => ({ code: c.code, label: `${c.label} · +${Math.round((c.premium || 0) * 100)}%` })) }]
  for (const key of BOOK_KEYS) {
    const b = BOOKS[key]
    out.push({ group: `${b.short} book colors`, options: b.colors.map(c => ({ code: bookColorCode(key, c.key), label: c.names ? c.names.join(' / ') : c.label })) })
  }
  out.push({ group: 'Other', options: [{ code: 'custom', label: 'Custom color…' }] })
  return out
}

// ── the book search ─────────────────────────────────────────────────────────
// FLAT sections (base / grass / hickey / backer) print L x W x H where H is the
// thickness; dies and slants print L x thickness x H. The book's rate is per
// square foot of the FACE: L × H for dies, L × W for flats.
const FLAT = new Set(['base', 'grass', 'hickey', 'backer'])
export const isFlatSection = (section) => FLAT.has(section)
export const faceArea = (section, L, W, H) => (FLAT.has(section) ? (L * (W || 0)) : (L * (H || 0))) / 144
export const thickOf = (section, W, H) => (FLAT.has(section) ? H : W)

// Tiers: exact (all typed dims match) · face (same L and H for dies, same L
// and W for flats — any thickness) · near (within 6″ on L, 4″ on the others).
export function searchBook({ supplierKey, section, L = null, W = null, H = null }) {
  const book = BOOKS[supplierKey]
  if (!book || !section || !L) return []
  const rows = book.rows.filter(r => r.section === section)
  const scored = []
  for (const r of rows) {
    const dL = Math.abs(r.L - L)
    const dW = W != null ? Math.abs(r.W - W) : 0
    const dH = H != null ? Math.abs(r.H - H) : 0
    const faceOk = FLAT.has(section) ? (dL === 0 && dW === 0) : (dL === 0 && dH === 0)
    let tier = null
    if (dL === 0 && dW === 0 && dH === 0) tier = 'exact'
    else if (faceOk) tier = 'face'
    else if (dL <= 6 && dH <= 4 && dW <= 4) tier = 'near'
    if (!tier) continue
    scored.push({ ...r, supplier: supplierKey, tier, distance: dL * 2 + dH * 2 + dW })
  }
  const order = { exact: 0, face: 1, near: 2 }
  scored.sort((a, b) => order[a.tier] - order[b.tier] || a.distance - b.distance || a.L - b.L)
  return scored
}
// The book's own rate for (section, thickness), per color column; overrides
// win (the mini settings, keyed `${section}|${thick}`). Null = no rate at all.
export function bookRate(supplierKey, section, thick, rateOverrides = null) {
  const book = BOOKS[supplierKey]
  if (!book) return null
  const inSec = book.rates.filter(r => r.section === section)
  if (!inSec.length) return null
  const t = Number(thick)
  const exact = inSec.find(r => Number(r.thick) === t)
  const base = exact || inSec.slice().sort((a, b) => Math.abs((a.thick ?? t) - t) - Math.abs((b.thick ?? t) - t))[0]
  const ov = rateOverrides?.[supplierKey]?.[`${section}|${base.thick ?? thick}`]
  return { section, thick: base.thick ?? thick, perSqFt: { ...base.perSqFt, ...(ov || {}) }, derived: !!base.derived, overridden: !!(ov && Object.keys(ov).length), matchedThick: !!exact }
}
export function estimateFromRate({ supplierKey, section, L, W, H, rateOverrides = null }) {
  if (!L) return null
  const rate = bookRate(supplierKey, section, thickOf(section, W, H), rateOverrides)
  if (!rate) return null
  const area = faceArea(section, L, W, H)
  if (!area) return null
  const prices = {}
  for (const [k, v] of Object.entries(rate.perSqFt)) prices[k] = Math.round(area * v)
  return { id: `est-${supplierKey}-${section}-${L}x${W}x${H}`, supplier: supplierKey, section, thick: thickOf(section, W, H), L, W, H, label: fmtForBook(supplierKey, L, W, H), area: +area.toFixed(2), prices, weight: null, page: null, bookPage: null, tier: 'estimate', rate }
}
export const markupPrice = (cost, pct) => Math.round((Number(cost) || 0) * (1 + (Number(pct) || 0) / 100))
export const pageImageUrl = (supplierKey, page) => page ? `/${BOOKS[supplierKey].pageImage.replace('{page}', String(page).padStart(3, '0'))}` : null

// ── the order the quote prices (and the lead receives) ──────────────────────
// spec = { shape, L, W, H, polishLevel, steelSides, colorCode, colorPct,
//          customColorName, base: { include, L, W, H, finish, topFinish,
//          polishMargin }, foundationType, addOns: [code…], markupPct,
//          bookPick: { supplier, die: row|null, base: row|null, useForDie,
//          useForBase, dieColor, baseColor, extrasBase } | null }
// bookPick.die / .base rows carry .cost (the picked column's price).
export function applyQuoteSpec(order, spec) {
  const o = { ...order, pricing: { ...(order.pricing || {}) }, baseConfig: { ...(order.baseConfig || {}) } }
  const shape = QUOTE_SHAPES.find(s => s.code === spec.shape) || QUOTE_SHAPES[0]
  o.shape = shape.code
  o.serviceTypes = ['NEW_STONE']
  // The spec may carry the typed strings ("4-0") or inches — parse both.
  const L = parseDim(spec.L), W = parseDim(spec.W), H = parseDim(spec.H)
  o.width = L || null
  // Dies and slants: depth = thickness (W), height = H. Markers: depth = W,
  // thickness = H (the third box is the marker's thickness).
  o.depth = W || null
  o.height = shape.flat ? null : (H || null)
  o.thickness = shape.flat ? (H || null) : (W || null)
  o.standardSizeCode = sizeCodeFor(shape.code, L, W, H)
  o.polishLevel = shape.flat ? null : (spec.polishLevel || 'P2')
  o.topShape = null
  o.pricing.polishRule = 'v2'
  o.pricing.steelSides = !!spec.steelSides && !shape.flat
  o.pricing.colorOnBase = true            // Paul: the color % hits the base too

  const bp = spec.bookPick
  const useDie = !!(bp?.die && bp.useForDie)
  const useBase = !!(bp?.base && bp.useForBase)

  // Color. A sheet color at its standing premium stays a plain pick; a changed
  // percent, a book color or a typed name goes the custom path (graniteColor
  // 'custom' + customColorName + customColorPct), which the engine prices on
  // the die AND the base. When a BOOK price is used, the column already IS
  // the color, so the premium is 0 and only the name rides along.
  const standing = standingPremium(spec.colorCode)
  const pct = Number(spec.colorPct)
  const isBook = !!parseBookColor(spec.colorCode)
  const name = spec.colorCode === 'custom' ? (spec.customColorName || 'Custom color') : colorLabel(spec.colorCode)
  if (useDie || useBase) {
    o.graniteColor = 'custom'
    o.pricing.customColorName = name
    o.pricing.customColorPct = 0
  } else if (spec.colorCode && spec.colorCode !== 'custom' && !isBook && (!Number.isFinite(pct) || pct === standing)) {
    o.graniteColor = spec.colorCode
    o.pricing.customColorName = null
    o.pricing.customColorPct = null
  } else {
    o.graniteColor = 'custom'
    o.pricing.customColorName = name
    o.pricing.customColorPct = Number.isFinite(pct) ? pct : 0
  }

  // Base — its own line. Dies always carry one (requiresBase); the quote's
  // include toggle decides for slants.
  const b = spec.base || {}
  const bL = parseDim(b.L), bW = parseDim(b.W), bH = parseDim(b.H)
  if (b.include && bL && bW) {
    const code = baseSizeCodeFor(bL, bW, bH)
    const hIn = bH || 8
    const hc = [6, 8, 10, 12].reduce((best, h) => Math.abs(h - hIn) < Math.abs(best - hIn) ? h : best, 8)
    o.baseConfig = { ...o.baseConfig, include: true, sizeCode: code || 'custom', width: bL, depth: bW, heightInches: bH || null, heightCode: hc, finish: b.finish || 'BRP', topFinish: b.topFinish || 'pol', polishMargin2in: !!b.polishMargin }
  } else {
    o.baseConfig = { ...o.baseConfig, include: false, sizeCode: null, width: null, depth: null }
  }
  o.foundationType = spec.foundationType || null
  o.pricing.foundationCalc = !!spec.foundationType && spec.foundationType !== 'Cemetery Foundation'
  o.pricing.foundationOverride = null
  o.addOns = (spec.addOns || []).map(code => ({ code, qty: 1 }))

  // Book pricing in place of the sheet: the picked rows become line overrides.
  // base-block's override is the WHOLE folded base (Option B), so the saw /
  // margin extras the quote asked for are added back on top of the marked-up
  // stone (bp.extrasBase = their sum, computed by the caller off the engine).
  o.pricing.lineItemOverrides = { ...(o.pricing.lineItemOverrides || {}) }
  if (useDie) o.pricing.lineItemOverrides['base-stone'] = markupPrice(bp.die.cost, spec.markupPct)
  else delete o.pricing.lineItemOverrides['base-stone']
  if (useBase) o.pricing.lineItemOverrides['base-block'] = markupPrice(bp.base.cost, spec.markupPct) + (Number(bp.extrasBase) || 0)
  else delete o.pricing.lineItemOverrides['base-block']
  o.pricing.quoteBook = (useDie || useBase) ? {
    supplier: bp.supplier || null, markupPct: Number(spec.markupPct) || DEFAULT_MARKUP_PCT, at: new Date().toISOString().slice(0, 10),
    die: useDie ? { rowId: bp.die.id, label: bp.die.label, cost: bp.die.cost, color: bp.dieColor || null, page: bp.die.bookPage, tier: bp.die.tier } : null,
    base: useBase ? { rowId: bp.base.id, label: bp.base.label, cost: bp.base.cost, color: bp.baseColor || null, page: bp.base.bookPage, tier: bp.base.tier } : null,
  } : null
  return o
}
// The vendor name the PR builder + the order's Vendor field should carry
// (orders.stone_vendor; the names match the ordering_vendors rows in prod).
export const supplierVendorName = (key) => key === 'kani' ? 'KANI INTERNATIONAL' : key === 'peerless' ? 'Peerless' : null
