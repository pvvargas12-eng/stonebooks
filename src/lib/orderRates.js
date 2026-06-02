// =============================================================================
// orderRates.js — single rate/config module for the New Order form pricing
// =============================================================================
// THE source of pricing truth for the compact New Order form. It re-uses the
// wizard's existing rate tables + configurator price functions (imported from
// SalesMode — NOT duplicated, so they can never drift from buildLineItems) and
// adds this build's new/corrected rates. The next build's Settings pricing
// editor swaps `RATES` to a DB-backed/owner-editable source without touching
// the form. computeFormLineItems() reconciles the existing buildLineItems with
// the custom-die fix + the new per-foot charges.
// =============================================================================

import {
  SHAPES, TOP_SHAPES, SIDES_OPTIONS, BASE_SIDES_OPTIONS, POLISH_LEVELS,
  BASE_SIZES, BASE_HEIGHTS, GRANITE_COLORS, FOUNDATION_RATE, ADD_ONS_CATALOG,
  NJ_TAX_RATE, CC_SURCHARGE, CUSTOM_FONT_FEE,
  LASER_SIZES, computeLaserPrice, stoneFaceArea,
  BLING_SIZES, computeBlingPrice,
  VASE_SIZES, computeVasePrice,
  PHOTO_TYPES, PHOTO_SIZES, SHAPE_CARVED_DESIGNS,
  buildLineItems,
} from '../SalesMode'

// Re-export the existing dropdown lists so the form imports everything from here.
export {
  SHAPES, TOP_SHAPES, SIDES_OPTIONS, BASE_SIDES_OPTIONS, POLISH_LEVELS,
  BASE_SIZES, BASE_HEIGHTS, GRANITE_COLORS, ADD_ONS_CATALOG,
  LASER_SIZES, BLING_SIZES, VASE_SIZES, PHOTO_TYPES, PHOTO_SIZES, SHAPE_CARVED_DESIGNS,
  stoneFaceArea,
}

// ── NEW / CORRECTED rates introduced by this build ──────────────────────────
export const CUSTOM_DIE_RATE_PER_SQIN     = 4.55   // custom die: face (L × H) × this
export const CUSTOM_DIE_DEFAULT_THICKNESS = 8      // middle dim default (inches)
export const POLISH_SIDE_PER_FOOT         = { 8: 100, 10: 115, 12: 125 }  // by die thickness
export const SAW_BASE_PER_FOOT            = 45     // (base length″ ÷ 12) × this, when finish = SB
export const BASE_POLISH_MARGIN_PER_FOOT  = 70     // 2″ polished margin — PER FOOT (corrects old flat $70)

// Additional-inscription base-price tiers (sets the inscription job's base).
// inscription.tier stores the chosen code; computeFormLineItems adds the base.
export const INSCRIPTION_TIERS = [
  { code: 'full', label: 'Full name & dates', price: 695 },
  { code: 'mdy',  label: 'Month, day & year', price: 550 },
  { code: 'year', label: 'Year only',         price: 495 },
]

// Custom-font add-on (flat). Distinct from SalesMode's $100 CUSTOM_FONT_FEE,
// which applies on the wizard's inscription flow; this build uses $150 as an
// explicit add-on line per the spec.
export const CUSTOM_FONT_ADDON = 150

// Acid-wash price by monument type. Monotonic scale; defaults only — these
// become owner-editable in the Settings editor next build. Keyed by the
// MONUMENT_TYPES codes so the type dropdown maps straight through.
export const ACID_WASH_BY_TYPE = [
  { code: 'flat',           label: 'Flat marker',    price: 250 },
  { code: 'slant',          label: 'Slant',          price: 325 },
  { code: 'double-slant',   label: 'Double slant',   price: 400 },
  { code: 'upright',        label: 'Upright',        price: 450 },
  { code: 'double-upright', label: 'Double upright', price: 500 },
]
export const acidWashPriceForType = (typeCode) =>
  ACID_WASH_BY_TYPE.find(t => t.code === typeCode)?.price ?? 0

// Base finish options for the new form (spec attributes; only SB carries a charge).
export const BASE_FINISHES = [
  { code: 'SB',  label: 'SB (sawn)' },
  { code: 'RB',  label: 'RB (rock pitch)' },
  { code: 'BRP', label: 'BRP (balance rock pitch)' },
]

// Monument "Type" → shape filter for the type dropdown (form-facing labels).
export const MONUMENT_TYPES = [
  { code: 'flat',          label: 'Flat',          shapeCodes: ['grass', 'hickey', 'bronze'] },
  { code: 'slant',         label: 'Slant',         shapeCodes: ['slant'] },
  { code: 'double-slant',  label: 'Double slant',  shapeCodes: ['double-slant'] },
  { code: 'upright',       label: 'Upright',       shapeCodes: ['die'] },
  { code: 'double-upright',label: 'Double upright',shapeCodes: ['double-die'] },
  { code: 'custom',        label: 'Custom',        shapeCodes: ['custom'] },
]

// The single config object the Settings editor will later swap to DB-backed.
export const RATES = {
  customDiePerSqIn: CUSTOM_DIE_RATE_PER_SQIN,
  customDieDefaultThickness: CUSTOM_DIE_DEFAULT_THICKNESS,
  polishSidePerFoot: POLISH_SIDE_PER_FOOT,
  sawBasePerFoot: SAW_BASE_PER_FOOT,
  basePolishMarginPerFoot: BASE_POLISH_MARGIN_PER_FOOT,
  inscriptionTiers: INSCRIPTION_TIERS,
  customFontAddon: CUSTOM_FONT_ADDON,
  acidWashByType: ACID_WASH_BY_TYPE,
  njTax: NJ_TAX_RATE,
  ccSurcharge: CC_SURCHARGE,
  customFontFee: CUSTOM_FONT_FEE,
  foundation: FOUNDATION_RATE,
  dieTable: SHAPES,
  baseSizes: BASE_SIZES,
  baseHeights: BASE_HEIGHTS,
  colors: GRANITE_COLORS,
  addOns: ADD_ONS_CATALOG,
  laserSizes: LASER_SIZES,
  blingSizes: BLING_SIZES,
  vaseSizes: VASE_SIZES,
  photoTypes: PHOTO_TYPES,
  photoSizes: PHOTO_SIZES,
  shapeCarved: SHAPE_CARVED_DESIGNS,
  baseFinishes: BASE_FINISHES,
}

// ── Size-driven add-on pricing (reuses existing configurator math exactly) ──
export function addonPrice(kind, opts = {}) {
  switch (kind) {
    case 'etching':      return computeLaserPrice(opts.size, opts.stoneFaceSqIn)
    case 'bling':        return computeBlingPrice(opts.size, opts.color)
    case 'vase':         return computeVasePrice(opts.size, opts.color)
    case 'photo': {
      const s = PHOTO_SIZES.find(x => x.code === opts.size)
      return s ? (opts.photoType === 'stainless' ? s.stainless : s.porcelain) : 0
    }
    case 'shape-carved': return (SHAPE_CARVED_DESIGNS.find(x => x.code === opts.design)?.price) || 0
    case 'custom_font':  return CUSTOM_FONT_ADDON
    case 'acid_wash':    return acidWashPriceForType(opts.acidType)
    // title / verse / panel / other — operator-entered manual price.
    default: return 0
  }
}

// ── Base fit rule ───────────────────────────────────────────────────────────
// A base "fits" the die when it is at least as wide AND at least as deep as the
// die footprint (it must fully support the die). Among fitting bases, the 3
// with the smallest total overhang (tightest fit above the die) are surfaced
// first as "recommended"; remaining fitting bases follow by overhang, then any
// non-fitting bases by width.
export function rankedBaseSizes(dieWidth, dieDepth) {
  const w = Number(dieWidth) || 0
  const d = Number(dieDepth) || 0
  const scored = BASE_SIZES.map(b => ({
    ...b,
    fits: b.w >= w && b.d >= d,
    overhang: (b.w - w) + (b.d - d),
  }))
  const fitting = scored.filter(s => s.fits).sort((a, b) => a.overhang - b.overhang)
  const notFitting = scored.filter(s => !s.fits).sort((a, b) => a.w - b.w)
  return {
    ordered: [...fitting, ...notFitting],
    recommendedCodes: fitting.slice(0, 3).map(s => s.code),
  }
}

function baseWidthOf(order) {
  const bc = order.baseConfig || {}
  if (!bc.include) return 0
  if (bc.sizeCode === 'custom') return Number(bc.width) || 0
  return BASE_SIZES.find(x => x.code === bc.sizeCode)?.w || 0
}
function baseDepthOf(order) {
  const bc = order.baseConfig || {}
  if (!bc.include) return 0
  if (bc.sizeCode === 'custom') return Number(bc.depth) || 0
  return BASE_SIZES.find(x => x.code === bc.sizeCode)?.d || 0
}

// ── Line items — reconcile the existing engine with this build's pricing ────
// Keep everything buildLineItems already gets right (standard die, color %,
// base block, base-height, foundation, add-ons, lettering, veteran, permit).
// PATCH the custom-die $0 and replace the flat 2″ margin; APPEND polish-sides
// and saw-base. Items flagged quotePending render as "$— (owner quote)".
export function computeFormLineItems(order) {
  // Drop the engine's flat polish-margin; we recompute it per-foot below.
  const items = buildLineItems(order).filter(it => it.code !== 'polish-margin')
  const shape = SHAPES.find(s => s.code === order.shape)
  const svc = order.serviceTypes || []
  const pr = order.pricing || {}

  // (0a) Additional-inscription base — tier-driven (Full / MDY / Year).
  if (svc.includes('INSCRIPTION')) {
    const tier = INSCRIPTION_TIERS.find(t => t.code === order.inscription?.tier)
    if (tier) items.unshift({ code: 'inscription-base', label: `Inscription — ${tier.label}`, amount: tier.price, editable: true })
  }

  // (0b) Acid-wash base — price by monument type, with override + owner-quote.
  // When neither a type nor an override is set, fall to owner-quote (excluded)
  // rather than a silent $0 line.
  if (svc.includes('ACID_WASH')) {
    const typeRow = ACID_WASH_BY_TYPE.find(t => t.code === pr.acidWashType)
    const overridden = pr.acidWashPrice != null && pr.acidWashPrice !== ''
    const amt = overridden ? Number(pr.acidWashPrice) : (typeRow?.price ?? 0)
    const unpriced = !overridden && !typeRow
    items.unshift({ code: 'acid-wash-base', label: `Acid wash${typeRow ? ` — ${typeRow.label}` : ''}`, amount: amt, editable: true, quotePending: !!pr.acidWashQuote || unpriced })
  }

  // (0c) Repair base — owner-quoted by default. Unpriced repairs stay excluded
  // (owner quote) instead of saving as a $0 repair.
  if (svc.includes('REPAIR')) {
    const priced = pr.repairPrice != null && pr.repairPrice !== ''
    const amt = priced ? Number(pr.repairPrice) : 0
    items.unshift({ code: 'repair-base', label: 'Repair', amount: amt, editable: true, quotePending: !!pr.repairQuote || !priced })
  }

  // (1) Custom die: face = L × H × $4.55 (L = order.width, H = order.height).
  if (shape && !order.standardSizeCode) {
    const L = Number(order.width) || 0
    const H = Number(order.height) || 0
    const baseStone = items.find(it => it.code === 'base-stone')
    if (baseStone && L > 0 && H > 0) {
      baseStone.amount = Math.round(L * H * CUSTOM_DIE_RATE_PER_SQIN * 100) / 100
      baseStone.label = `${shape.label} (custom ${L}″ × ${H}″ face × $${CUSTOM_DIE_RATE_PER_SQIN}/sq in)`
    }
  }

  // (1b) Custom color premium — manual % on the (corrected) base-stone amount.
  // Applies when the operator picks "Custom…" color and enters a % increase.
  if (Number(pr.customColorPct) > 0) {
    const baseStone = items.find(it => it.code === 'base-stone')
    const base = baseStone ? Number(baseStone.amount) || 0 : 0
    if (base > 0) {
      const pct = Number(pr.customColorPct)
      items.push({ code: 'color-premium-custom', label: `${pr.customColorName || 'Custom color'} premium (+${pct}%)`, amount: Math.round(base * pct / 100), editable: true })
    }
  }

  // (2) Polish die sides — per foot of die height, rate by die thickness.
  // The flag persists on pricing.polishDieSides (no dedicated column; pricing
  // round-trips whole as JSONB). order.polishSides is accepted as a fallback.
  const wantPolishSides = order.pricing?.polishDieSides || order.polishSides
  if (shape && wantPolishSides) {
    const thickness = Number(order.depth) || CUSTOM_DIE_DEFAULT_THICKNESS
    const heightIn = Number(order.height) || 0
    const rate = POLISH_SIDE_PER_FOOT[thickness] ?? POLISH_SIDE_PER_FOOT[8]
    if (heightIn > 0) {
      items.push({ code: 'polish-sides', label: `Polish die sides (${heightIn}″ tall @ ${thickness}″ thick)`, amount: Math.round((heightIn / 12) * rate), editable: true })
    }
  }

  const baseW = baseWidthOf(order)
  const baseD = baseDepthOf(order)
  const bc = order.baseConfig || {}

  // (3) 2″ base polish margin — $70 PER FOOT of base PERIMETER (2×(w+d)).
  if (bc.include && bc.polishMargin2in && baseW > 0 && baseD > 0) {
    const perimeter = 2 * (baseW + baseD)
    items.push({ code: 'base-margin', label: `2″ polished margin (perimeter ${perimeter}″ ÷ 12 × $${BASE_POLISH_MARGIN_PER_FOOT})`, amount: Math.round((perimeter / 12) * BASE_POLISH_MARGIN_PER_FOOT), editable: true })
  }

  // (4) Saw base — (base length ÷ 12) × $45 when the base finish is SB (sawn).
  if (bc.include && bc.finish === 'SB' && baseW > 0) {
    items.push({ code: 'saw-base', label: `Saw base (${baseW}″ ÷ 12 × $${SAW_BASE_PER_FOOT})`, amount: Math.round((baseW / 12) * SAW_BASE_PER_FOOT), editable: true })
  }

  // Owner-quote flag — custom line items the form flags for the owner to price
  // carry `quotePending` on their `raw` record; surface it on the line item so
  // computeTotals excludes them and the UI can render "$— (owner quote)".
  for (const it of items) {
    if (it.raw?.quotePending) it.quotePending = true
  }

  return items
}

// ── Totals — replicate the PricingStep / rowGrandTotal formula (single source).
// Permit lines are taxed but NOT discounted. Returns the breakdown + grand total.
export function computeTotals(items, { applyTax = true, applyCCSurcharge = false, discountPct = 0 } = {}) {
  const isPermit = it => it.code === 'addon-permit' || it.code === 'permit'
  let subtotalDisc = 0, subtotalPermit = 0
  for (const it of items) {
    if (it.quotePending) continue        // unpriced — excluded until the owner quotes it
    if (isPermit(it)) subtotalPermit += Number(it.amount) || 0
    else subtotalDisc += Number(it.amount) || 0
  }
  const discountAmt = subtotalDisc * (Number(discountPct) || 0) / 100
  const taxBase = (subtotalDisc - discountAmt) + subtotalPermit
  const tax = applyTax ? taxBase * NJ_TAX_RATE : 0
  const cc = applyCCSurcharge ? (taxBase + tax) * CC_SURCHARGE : 0
  return {
    subtotalDisc: Math.round(subtotalDisc * 100) / 100,
    subtotalPermit: Math.round(subtotalPermit * 100) / 100,
    discountAmt: Math.round(discountAmt * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    cc: Math.round(cc * 100) / 100,
    grandTotal: Math.round(taxBase + tax + cc),
  }
}
