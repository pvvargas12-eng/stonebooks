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

// Phase 1 — spec catalog now lives in the dependency-free monumentCatalog (no
// import cycle). Everything else (pricing rates, configurator tables/fns, and
// buildLineItems) still comes from SalesMode.
import {
  SHAPES, TOP_SHAPES, SIDES_OPTIONS, BASE_SIDES_OPTIONS, POLISH_LEVELS,
  BASE_SIZES, BASE_HEIGHTS, GRANITE_COLORS, buildBaseSpec,
} from './monumentCatalog'
import {
  FOUNDATION_RATE, ADD_ONS_CATALOG,
  NJ_TAX_RATE, CC_SURCHARGE, CUSTOM_FONT_FEE,
  LASER_SIZES, computeLaserPrice, stoneFaceArea,
  BLING_SIZES, computeBlingPrice,
  VASE_SIZES, computeVasePrice,
  PHOTO_TYPES, PHOTO_SIZES, SHAPE_CARVED_DESIGNS,
  buildLineItems, rowToOrder,
} from '../SalesMode'
import { supabase } from './supabase'
import { registerRowGrandTotal } from './pricingCore'

// Re-export the existing dropdown lists so the form imports everything from here.
export {
  SHAPES, TOP_SHAPES, SIDES_OPTIONS, BASE_SIDES_OPTIONS, POLISH_LEVELS,
  BASE_SIZES, BASE_HEIGHTS, GRANITE_COLORS, ADD_ONS_CATALOG, FOUNDATION_RATE,
  LASER_SIZES, BLING_SIZES, VASE_SIZES, PHOTO_TYPES, PHOTO_SIZES, SHAPE_CARVED_DESIGNS,
  stoneFaceArea,
}

// ── NEW / CORRECTED rates introduced by this build ──────────────────────────
export const CUSTOM_DIE_RATE_PER_SQIN     = 4.55   // custom die: face (L × H) × this
export const CUSTOM_DIE_DEFAULT_THICKNESS = 8      // middle dim default (inches)
export const POLISH_SIDE_PER_FOOT         = { 8: 100, 10: 115, 12: 125 }  // by die thickness
export const SAW_BASE_PER_FOOT            = 45     // (base length″ ÷ 12) × this, when finish = SB
export const ALL_POLISH_BASE_PER_FOOT     = 0      // (base length″ ÷ 12) × this, when finish = AP (All Polish). ← SET the per-foot charge here (0 = no charge, like BRP/RB).
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

// ── Live (owner-editable) scalar rates ──────────────────────────────────────
// The scalar per-unit rates above are the constant DEFAULTS. The engine reads
// the live values from here so Settings → Pricing edits take effect at runtime
// without a rebuild. loadPricingConfig() (below) merges owner values over these
// at startup; the small/large LOOKUP TABLES (die prices, base sizes, color
// premiums, tiers, foundation, add-ons) are mutated in place by
// applyPricingConfig so the wizard's buildLineItems — which reads those same
// object references — honors owner values too. Constants stay as the fallback.
export const liveRates = {
  customDiePerSqIn: CUSTOM_DIE_RATE_PER_SQIN,
  customDieDefaultThickness: CUSTOM_DIE_DEFAULT_THICKNESS,
  polishSidePerFoot: { ...POLISH_SIDE_PER_FOOT },
  sawBasePerFoot: SAW_BASE_PER_FOOT,
  allPolishBasePerFoot: ALL_POLISH_BASE_PER_FOOT,
  basePolishMarginPerFoot: BASE_POLISH_MARGIN_PER_FOOT,
  customFontAddon: CUSTOM_FONT_ADDON,
  njTax: NJ_TAX_RATE,
  ccSurcharge: CC_SURCHARGE,
}

// Base finish options for the new form (spec attributes; only SB carries a charge).
export const BASE_FINISHES = [
  { code: 'SB',  label: 'SB (sawn)' },
  { code: 'RB',  label: 'RB (rock pitch)' },
  { code: 'BRP', label: 'BRP (balance rock pitch)' },
  { code: 'AP',  label: 'All Polish' },
]

// Monument "Type" → shape filter for the type dropdown (form-facing labels).
export const MONUMENT_TYPES = [
  { code: 'flat',          label: 'Flat',          shapeCodes: ['grass', 'bronze'] },
  { code: 'hickey',        label: 'Hickey',        shapeCodes: ['hickey'] },
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
  allPolishBasePerFoot: ALL_POLISH_BASE_PER_FOOT,
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
    case 'custom_font':  return liveRates.customFontAddon
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
// Base consolidation. Merges base-height + base-margin + saw-base + all-polish-base
// INTO the base-block row (label = buildBaseSpec) so the base shows as ONE line in
// every editor AND the contract — and is edited as ONE number.
// Phase 4 (Option B): a base-block override sets the WHOLE folded-base figure
// (size + height + saw + margin), REPLACING the natural sum — not just the size.
// The override is applied HERE (computeFormLineItems deliberately skips base-block)
// so the single editable base line means "the entire base costs $X". With NO base
// override the folded amount equals the un-folded sum, so any order that hasn't set
// a base override totals byte-identically to the pre-fold engine. Callers compute
// the grand total from THIS folded list (priceOrderTotals does), so the rows a
// surface shows always sum to the total it shows.
const BASE_FOLD_CODES = new Set(['base-height', 'base-margin', 'saw-base', 'all-polish-base', 'base-color-premium'])
export function foldBaseRows(items, order) {
  const list = items || []
  const baseIdx = list.findIndex(it => String(it.code) === 'base-block')
  if (baseIdx < 0) return list
  const extrasSum = list.reduce((s, it) => s + (BASE_FOLD_CODES.has(String(it.code)) ? (Number(it.amount) || 0) : 0), 0)
  const folded = { ...list[baseIdx] }
  const natural = (Number(list[baseIdx].amount) || 0) + extrasSum
  const ov = order?.pricing?.lineItemOverrides?.['base-block']
  folded.amount = (ov != null && ov !== '') ? Number(ov) : natural
  folded.label = buildBaseSpec(order || {})
  return list
    .map((it, i) => (i === baseIdx ? folded : it))
    .filter(it => !BASE_FOLD_CODES.has(String(it.code)))
}

// Legacy compat (Phase 4): the retired wizard override map (pricing.overrides) is
// honored as a fallback for NON-base line codes only. Pre-Phase-4 orders that still
// carry pricing.overrides price identically without a data migration (the active
// pricing.lineItemOverrides always wins). Base codes (base-block + the folded
// extras) are EXCLUDED — their meaning changed under Option B, so those orders are
// migrated explicitly rather than auto-carried.
function legacyNonBaseOverrides(overrides) {
  const out = {}
  for (const [code, val] of Object.entries(overrides || {})) {
    if (code === 'base-block' || BASE_FOLD_CODES.has(code)) continue
    out[code] = val
  }
  return out
}

// Options-only helper (NOT part of priceOrderTotals — the total reads the SELECTED
// base via baseWidthOf/baseDepthOf). HARD RULE: a base must extend beyond the die
// on BOTH dimensions (strictly larger — no equal/zero-overhang). Smaller-or-equal
// bases are EXCLUDED entirely, never offered. Recommended = die + 1″/2″/3″ PER SIDE
// (total +2/+4/+6 width).
export function rankedBaseSizes(dieWidth, dieDepth) {
  const w = Number(dieWidth) || 0
  const d = Number(dieDepth) || 0
  const fitting = BASE_SIZES
    .map(b => ({ ...b, overhang: (b.w - w) + (b.d - d) }))
    .filter(b => (w ? b.w > w : true) && (d ? b.d > d : true))
    .sort((a, b) => a.overhang - b.overhang)
  const recommendedCodes = []
  if (w) {
    for (const add of [2, 4, 6]) {
      const target = w + add
      const best = fitting
        .filter(b => !recommendedCodes.includes(b.code))
        .sort((a, b) => Math.abs(a.w - target) - Math.abs(b.w - target) || a.price - b.price)[0]
      if (best && Math.abs(best.w - target) <= 4) recommendedCodes.push(best.code)
    }
  }
  return { ordered: fitting, recommendedCodes }
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

// ── Per-item category + tax/discount eligibility ────────────────────────────
// Generalizes the old hardcoded "permit is untaxed" rule into per-line flags:
// every line carries { category, taxable, discountable } so tax applies only to
// taxable lines and the discount only to discountable lines (computeTotals reads
// these). Pass-through fees (permit, cemetery, delivery) are never discountable;
// permit + cemetery are also never taxed. Stone + carving/monument add-ons
// (lettering, etching, vases, emblems, photo, acid wash, repair) are both.
// Defaults only — the Finance card can override taxable/discountable per line.
export function classifyLineItem(code) {
  const c = String(code || '').toLowerCase()
  if (/permit|cemetery/.test(c))   return { category: 'fee',     taxable: false, discountable: false }
  if (/^rush-/.test(c))            return { category: 'fee',     taxable: false, discountable: false }   // rush fees are NON-taxable (#7)
  if (/deliver|setup/.test(c))     return { category: 'fee',     taxable: true,  discountable: false }
  if (/^addon-|^inscription|^custom-font|^acid-wash|^repair|color-premium-custom/.test(c))
    return { category: 'carving', taxable: true, discountable: true }
  return { category: 'stone', taxable: true, discountable: true }   // die / base / foundation / polish / color / mausoleum
}

// A line item is a payment record (deposit/balance) — these are NEVER products
// and must never appear in the line-item list (B2). Guard by code OR label.
const _isPaymentRow = (it) => /\b(payment|deposit|balance)\b/i.test(`${it.code || ''} ${it.label || ''}`)

// ── Bronze Marker — a stripped order flow (no die / base / monument complexity) ──
// FLAT plate prices per the pricing sheet; Custom lets the operator type a price.
// A unitized backer is a flat $489 add. The bronze line label can be overridden
// (display-only, mirrors dieTextOverride). Pricing data lives on pricing.bronze =
// { size, customPrice, customSizeText, backer, descOverride }.
export const BRONZE_SIZES = [
  { code: '24x12', label: '24″ × 12″', price: 2873 },
  { code: '24x14', label: '24″ × 14″', price: 3089 },
  { code: '44x14', label: '44″ × 14″', price: 4965 },
]
export const BRONZE_BACKER_PRICE = 489

// A bronze marker is the NEW stripped flow — discriminated by BRONZE service type
// AND the presence of pricing.bronze (set only by the New Order "Bronze Marker"
// card). The `pricing.bronze` guard keeps any legacy wizard bronze-SHAPE order
// (which prices via the bronze standardSizes, no pricing.bronze) on the old path.
export function isBronzeMarker(order) {
  return (order?.serviceTypes || []).includes('BRONZE') && !!order?.pricing?.bronze
}

// The bronze plate line (+ optional unitized backer). No base/die/foundation.
function bronzeBaseItems(order) {
  const b = order?.pricing?.bronze || {}
  const isCustom = b.size === 'custom'
  const sizeRow = BRONZE_SIZES.find(s => s.code === b.size)
  const sizeLabel = isCustom ? (String(b.customSizeText || '').trim() || 'Custom') : (sizeRow?.label || '—')
  const price = isCustom ? (Number(b.customPrice) || 0) : (sizeRow?.price || 0)
  const override = String(b.descOverride || '').trim()
  const items = [{
    code: 'bronze-marker',
    label: override || `Bronze Marker — ${sizeLabel}`,
    amount: price,
    editable: true,
  }]
  if (b.backer) {
    items.push({ code: 'bronze-backer', label: 'Unitized Backer', amount: BRONZE_BACKER_PRICE, editable: true })
  }
  return items
}

// ── Line items — reconcile the existing engine with this build's pricing ────
// Keep everything buildLineItems already gets right (standard die, color %,
// base block, base-height, foundation, add-ons, lettering, veteran, permit).
// PATCH the custom-die $0 and replace the flat 2″ margin; APPEND polish-sides
// and saw-base. Items flagged quotePending render as "$— (owner quote)".
export function computeFormLineItems(order) {
  // Drop the engine's flat polish-margin; we recompute it per-foot below.
  // ALSO drop buildLineItems' custom-line-item rows (code `custom-<id>`,
  // isCustom): we re-emit each custom item ONCE below with proper custom +
  // quotePending flags and a stable id. Without this, every custom charge is
  // counted twice — once by the engine, once here — which surfaced as the
  // acid-wash double-charge (two non-removable engine rows + two removable
  // form rows, all summing) on E-26-0245. Single source of truth = this loop.
  // Bronze Marker — a stripped flow: bronze plate line + optional unitized backer.
  // No die/base/foundation/add-on logic. Still routed through priceOrderTotals so
  // totals/PDF/receipt work; the shared tail (rush, custom lines, tax flags,
  // overrides, removal) below applies to bronze lines too.
  const bronze = isBronzeMarker(order)
  const items = bronze
    ? bronzeBaseItems(order)
    : buildLineItems(order).filter(it => it.code !== 'polish-margin' && !it.isCustom)
  const shape = SHAPES.find(s => s.code === order.shape)
  const svc = order.serviceTypes || []
  const pr = order.pricing || {}

  if (!bronze) {
  // (0a) Additional-inscription base — tier-driven (Full / MDY / Year).
  if (svc.includes('INSCRIPTION')) {
    const tier = INSCRIPTION_TIERS.find(t => t.code === order.inscription?.tier)
    if (tier) {
      // Supersede any type-driven inscription-base buildLineItems emitted, so an
      // order carrying BOTH inscription.type and a tier doesn't double-count.
      const dup = items.findIndex(it => it.code === 'inscription-base')
      if (dup >= 0) items.splice(dup, 1)
      items.unshift({ code: 'inscription-base', label: `Inscription — ${tier.label}`, amount: tier.price, editable: true })
    }
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

  // (1) Custom die: face = L × H × $4.55 (L = order.width, H = the vertical).
  // 3B — the vertical lives in order.height (OrderForm) OR order.thickness (the
  // SalesMode wizard custom-die input), so fall back to thickness; otherwise a
  // wizard custom die reads H=0 and the die stays at $0 (undercharge).
  if (shape && !order.standardSizeCode) {
    const L = Number(order.width) || 0
    const H = Number(order.height) || Number(order.thickness) || 0
    const baseStone = items.find(it => it.code === 'base-stone')
    if (baseStone && L > 0 && H > 0) {
      const rate = liveRates.customDiePerSqIn
      baseStone.amount = Math.round(L * H * rate * 100) / 100
      // Phase 2 — ONE die-label source. The label is left exactly as buildLineItems
      // set it (buildDieSpec / dieTextOverride), so a CUSTOM die reads identically
      // in the editor, quotes, estimate, and contract. Only the amount is corrected.
      // 3A — the catalog color-premium line was computed in buildLineItems from
      // basePrice ($0 for a custom die). Recompute it from the CORRECTED die amount
      // so a premium granite (Jet Black +25%, Bahama +30%, …) is no longer $0.
      const colorPrem = items.find(it => it.code === 'color-premium')
      if (colorPrem) {
        const c = GRANITE_COLORS.find(g => g.code === order.graniteColor)
        colorPrem.amount = Math.round(baseStone.amount * (c?.premium || 0))
      }
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
    const thickness = Number(order.depth) || liveRates.customDieDefaultThickness
    const heightIn = Number(order.height) || 0
    const rate = liveRates.polishSidePerFoot[thickness] ?? liveRates.polishSidePerFoot[8]
    if (heightIn > 0) {
      items.push({ code: 'polish-sides', label: 'Polish die sides', amount: Math.round((heightIn / 12) * rate), editable: true })
    }
  }

  const baseW = baseWidthOf(order)
  const baseD = baseDepthOf(order)
  const bc = order.baseConfig || {}

  // (3) 2″ base polish margin — $70 PER FOOT of base PERIMETER (2×(w+d)).
  if (bc.include && bc.polishMargin2in && baseW > 0 && baseD > 0) {
    const perimeter = 2 * (baseW + baseD)
    const rate = liveRates.basePolishMarginPerFoot
    items.push({ code: 'base-margin', label: '2″ polished margin', amount: Math.round((perimeter / 12) * rate), editable: true })
  }

  // (4) Saw base — (base length ÷ 12) × $45 when the base finish is SB (sawn).
  if (bc.include && bc.finish === 'SB' && baseW > 0) {
    const rate = liveRates.sawBasePerFoot
    items.push({ code: 'saw-base', label: 'Saw base', amount: Math.round((baseW / 12) * rate), editable: true })
  }

  // (4b) All Polish base — (base length ÷ 12) × the configurable per-foot rate
  // when finish = AP. Same mechanism as saw-base; emits a line only when the rate
  // is set ( > 0 ), so AP is cosmetic-only until allPolishBasePerFoot is set.
  if (bc.include && bc.finish === 'AP' && baseW > 0) {
    const rate = liveRates.allPolishBasePerFoot
    if (rate > 0) items.push({ code: 'all-polish-base', label: 'All polish base', amount: Math.round((baseW / 12) * rate), editable: true })
  }
  } // end if (!bronze) — bronze markers skip all die/base/foundation/monument lines

  // (5) Custom rush fee (#7) — a flat NON-taxable service fee tied to the due-date
  // control. classifyLineItem('rush-fee') stamps it taxable:false. The internal
  // rush note (pricing.rushFeeNote) is NEVER emitted onto the line item, so it
  // can't reach the customer-facing PDF — the label stays generic.
  const rushFee = Number(pr.rushFee) || 0
  if (rushFee > 0) {
    items.push({ code: 'rush-fee', label: 'Rush service fee', amount: rushFee, editable: true })
  }

  // Owner-quote flag — custom line items the form flags for the owner to price
  // carry `quotePending` on their `raw` record; surface it on the line item so
  // computeTotals excludes them and the UI can render "$— (owner quote)".
  for (const it of items) {
    if (it.raw?.quotePending) it.quotePending = true
  }

  // Operator amount overrides — every editor (wizard + Finance card + QuoteHub)
  // lets staff edit any computed line's amount. Phase 4: ONE override map,
  // pricing.lineItemOverrides. The base-block line is intentionally SKIPPED here —
  // its override is the WHOLE folded-base figure, applied in foldBaseRows (Option
  // B). The retired wizard map (pricing.overrides) is read as a NON-base fallback
  // so un-migrated legacy orders price identically (lineItemOverrides wins).
  const ov = { ...legacyNonBaseOverrides(pr.overrides), ...(pr.lineItemOverrides || {}) }
  for (const it of items) {
    if (it.code === 'base-block' || BASE_FOLD_CODES.has(it.code)) continue
    if (ov[it.code] != null && ov[it.code] !== '') it.amount = Number(ov[it.code])
  }

  // Custom line items — staff-added one-off lines (Add-ons card OR Finance card).
  // These now ACTUALLY become line items (and count in the total); previously
  // they were captured but never priced.
  for (const c of (pr.customLineItems || [])) {
    if (!c) continue
    items.push({
      code: c.id || `custom-${c.label || 'item'}`,
      label: c.label || 'Custom item',
      amount: Number(c.amount) || 0,
      editable: true,
      custom: true,
      quotePending: !!c.quotePending,
      // Custom items carry their own flags (operator-editable in the Finance card);
      // default to a taxable + discountable monument line.
      category: c.category || 'custom',
      taxable: c.taxable !== false,
      discountable: c.discountable !== false,
    })
  }

  // Stamp category + tax/discount flags on every line. Derived lines get classifier
  // defaults; per-line Finance-card overrides (pricing.lineItemFlagOverrides[code])
  // win for BOTH derived and custom lines so any item can be flipped case by case.
  const flagOv = pr.lineItemFlagOverrides || {}
  for (const it of items) {
    if (!it.custom) {
      const cls = classifyLineItem(it.code)
      it.category = cls.category
      it.taxable = cls.taxable
      it.discountable = cls.discountable
    }
    const fo = flagOv[it.code]
    if (fo) {
      if (fo.taxable != null) it.taxable = !!fo.taxable
      if (fo.discountable != null) it.discountable = !!fo.discountable
    }
  }

  // (B2) Payments/deposits are never line items. (B3) Operator-removed lines drop
  // out here — the single source, so PDF + totals + Finance card all agree.
  const removedCodes = new Set((pr.removedLineItems || []).map(r => (typeof r === 'string' ? r : r?.code)).filter(Boolean))
  return items.filter(it => !_isPaymentRow(it) && !removedCodes.has(it.code))
}

// ── Totals — THE single source of truth for an order's grand total. Every view
// (order detail, contract PDF, payments) must derive from this so no two screens
// can disagree. Cemetery permit lines are a pass-through fee: NOT discounted and
// NOT taxed (sales tax applies to the monument work only).
export function computeTotals(items, { applyTax = true, applyCCSurcharge = false, discountType, discountValue, discountPct = 0 } = {}) {
  // Per-item flags drive everything now (generalizes the old permit special-case):
  // tax applies to taxable lines; the discount applies to discountable lines.
  let taxableSum = 0, feeUntaxedSum = 0, discountableSum = 0, taxableDiscountableSum = 0
  for (const it of items) {
    if (it.quotePending) continue        // unpriced — excluded until the owner quotes it
    const amt = Number(it.amount) || 0
    const taxable = it.taxable !== false
    const discountable = it.discountable !== false
    if (taxable) taxableSum += amt; else feeUntaxedSum += amt
    if (discountable) discountableSum += amt
    if (taxable && discountable) taxableDiscountableSum += amt
  }

  // Discount type: explicit 'pct' | 'amount' wins; otherwise fall back to the
  // legacy discountPct (% ). The discount applies ONLY to discountable items; a
  // $ discount can never exceed the discountable base.
  const type = discountType || (Number(discountPct) ? 'pct' : null)
  const rawVal = (discountValue != null && discountValue !== '') ? Number(discountValue) : (Number(discountPct) || 0)
  let discountAmt = 0
  if (type === 'pct')         discountAmt = discountableSum * (rawVal || 0) / 100
  else if (type === 'amount') discountAmt = Math.min(rawVal || 0, discountableSum)
  discountAmt = Math.round(discountAmt * 100) / 100

  // Reduce the taxable base only by the taxable share of the discount (covers a
  // line manually flagged discountable-but-untaxed). In the common case every
  // discountable line is also taxable, so this is just taxableSum - discountAmt.
  const taxableShare = discountableSum > 0 ? (taxableDiscountableSum / discountableSum) : 0
  const taxableBase = Math.max(0, taxableSum - discountAmt * taxableShare)
  const tax = applyTax ? taxableBase * liveRates.njTax : 0
  const grandBeforeCC = taxableSum + feeUntaxedSum - discountAmt + tax
  const cc = applyCCSurcharge ? grandBeforeCC * liveRates.ccSurcharge : 0
  return {
    // Kept keys for back-compat: subtotalDisc = taxable (non-fee) subtotal,
    // subtotalPermit = untaxed pass-through fees (permit/cemetery).
    subtotalDisc: Math.round(taxableSum * 100) / 100,
    subtotalPermit: Math.round(feeUntaxedSum * 100) / 100,
    discountAmt,
    tax: Math.round(tax * 100) / 100,
    cc: Math.round(cc * 100) / 100,
    grandTotal: Math.round((grandBeforeCC + cc) * 100) / 100,
  }
}

// ── priceOrderTotals — THE single entry point for "what is this order's total"
// AND "what line items does it have". Phase 4: ONE engine, ONE override map, ONE
// folded list. Every World-A surface (wizard PricingStep, OrderForm, QuoteHub,
// estimate/contract/receipt PDF, QuotesManager) renders `.items` and shows
// `.displayed`, so no two screens can disagree and the rows always sum to the
// total:
//   1. computeFormLineItems(order)   — canonical priced lines (non-base overrides
//                                       applied; legacy pricing.overrides honored
//                                       as a non-base fallback)
//   2. foldBaseRows(...)             — base → ONE line; whole-base override applied
//                                       (Option B). Totals come from this folded
//                                       list, so a base override actually moves the
//                                       total and the shown base line matches it.
//   3. computeTotals(...)            — taxable/discountable-aware, pct OR $ discount
//   4. manualTotal                   — a manual grand-total override wins
// Returns { items, totals, manual, displayed }. `items` is the folded list.
export function priceOrderTotals(order) {
  const o = order || {}
  const pr = o.pricing || {}
  const items = foldBaseRows(
    computeFormLineItems(o).map(it => ({ ...it, code: String(it.code ?? '') })),
    o,
  )
  const totals = computeTotals(items, {
    applyTax: pr.applyTax !== false,
    applyCCSurcharge: !!pr.applyCCSurcharge,
    discountType: pr.discountType,
    discountValue: pr.discountValue,
    discountPct: Number(pr.discountPct) || 0,
  })
  const manual = (pr.manualTotal != null && pr.manualTotal !== '') ? Number(pr.manualTotal) : null
  return { items, totals, manual, displayed: manual != null ? manual : totals.grandTotal }
}

// =============================================================================
// OWNER-EDITABLE PRICING CONFIG (Settings → Pricing)
// =============================================================================
// One tenant-scoped JSONB row in `pricing_config` holds owner overrides. The
// config schema mirrors the editable rates; ANY field absent falls back to the
// constant default (captured pristine in DEFAULT_PRICING_CONFIG at module load,
// before any apply mutates the tables). loadPricingConfig() applies the stored
// row at startup; savePricingConfig() persists + re-applies immediately so the
// form reprices without a reload. Scalars live in `liveRates`; the lookup
// tables (die/base/color/tier/foundation/add-on) are mutated IN PLACE so the
// wizard's buildLineItems (same object references) honors them too.
// =============================================================================

export const PRICING_TENANT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789'

// Snapshot the current effective rates into the config schema shape.
function snapshotPricingConfig() {
  return {
    version: 1,
    perUnit: {
      customDiePerSqIn: liveRates.customDiePerSqIn,
      customDieDefaultThickness: liveRates.customDieDefaultThickness,
      polishSidePerFoot: { ...liveRates.polishSidePerFoot },
      sawBasePerFoot: liveRates.sawBasePerFoot,
      basePolishMarginPerFoot: liveRates.basePolishMarginPerFoot,
    },
    taxes: { njTax: liveRates.njTax, ccSurcharge: liveRates.ccSurcharge },
    fees: { customFontAddon: liveRates.customFontAddon },
    baseHeights: Object.fromEntries(BASE_HEIGHTS.map(h => [h.code, h.upcharge])),
    inscriptionTiers: Object.fromEntries(INSCRIPTION_TIERS.map(t => [t.code, t.price])),
    acidWashByType: Object.fromEntries(ACID_WASH_BY_TYPE.map(t => [t.code, t.price])),
    foundationRates: { ...FOUNDATION_RATE },
    colorPremiums: Object.fromEntries(GRANITE_COLORS.map(c => [c.code, c.premium])),
    diePrices: Object.fromEntries(SHAPES.flatMap(s => (s.standardSizes || []).map(sz => [sz.code, sz.price]))),
    baseSizePrices: Object.fromEntries(BASE_SIZES.map(b => [b.code, b.price])),
    addOnPrices: Object.fromEntries(ADD_ONS_CATALOG.filter(a => !a.custom).map(a => [a.code, a.price])),
  }
}

// Pristine defaults — captured ONCE at module load, before any apply mutates
// the shared tables. The editor merges stored overrides over this.
export const DEFAULT_PRICING_CONFIG = snapshotPricingConfig()

// Deep-merge a partial stored config over a base (one level into the nested
// maps; all leaf values are scalars so a shallow-per-section merge suffices).
function mergePricingConfig(base, over) {
  const out = { ...base }
  for (const key of Object.keys(over || {})) {
    const b = base[key], o = over[key]
    if (b && o && typeof b === 'object' && typeof o === 'object' && !Array.isArray(b)) {
      out[key] = { ...b, ...o }
    } else {
      out[key] = o
    }
  }
  return out
}

// Apply a stored config so the effective rates = pristine defaults with the
// config's non-null values overlaid. We RESET to defaults first, then overlay
// only non-null fields — so blanking a field in the editor (stored as null)
// genuinely reverts that rate to the built-in default, in-session and on reload
// (the documented "blank a field to fall back to the default" contract).
export function applyPricingConfig(config) {
  applyConfigValues(DEFAULT_PRICING_CONFIG, false)   // reset everything to pristine
  if (config) applyConfigValues(config, true)        // overlay non-null overrides
}

// Write a config's values into liveRates + the shared tables. When skipNull is
// true, null/absent fields are left untouched (used for the overlay pass).
function applyConfigValues(config, skipNull) {
  if (!config) return
  const num = (v) => Number(v)
  // null/undefined always means "leave it" — on the overlay pass that yields
  // the default (already set by the reset pass); on the reset pass DEFAULT has
  // no nulls so everything applies. (skipNull kept for call-site clarity.)
  void skipNull
  const ok = (v) => v != null
  if (config.perUnit) {
    const u = config.perUnit
    if (ok(u.customDiePerSqIn)) liveRates.customDiePerSqIn = num(u.customDiePerSqIn)
    if (ok(u.customDieDefaultThickness)) liveRates.customDieDefaultThickness = num(u.customDieDefaultThickness)
    if (ok(u.sawBasePerFoot)) liveRates.sawBasePerFoot = num(u.sawBasePerFoot)
    if (ok(u.allPolishBasePerFoot)) liveRates.allPolishBasePerFoot = num(u.allPolishBasePerFoot)
    if (ok(u.basePolishMarginPerFoot)) liveRates.basePolishMarginPerFoot = num(u.basePolishMarginPerFoot)
    if (u.polishSidePerFoot) for (const k of Object.keys(liveRates.polishSidePerFoot)) {
      if (ok(u.polishSidePerFoot[k])) liveRates.polishSidePerFoot[k] = num(u.polishSidePerFoot[k])
    }
  }
  if (config.taxes) {
    if (ok(config.taxes.njTax)) liveRates.njTax = num(config.taxes.njTax)
    if (ok(config.taxes.ccSurcharge)) liveRates.ccSurcharge = num(config.taxes.ccSurcharge)
  }
  if (config.fees && ok(config.fees.customFontAddon)) liveRates.customFontAddon = num(config.fees.customFontAddon)
  if (config.baseHeights) BASE_HEIGHTS.forEach(h => { if (ok(config.baseHeights[h.code])) h.upcharge = num(config.baseHeights[h.code]) })
  if (config.inscriptionTiers) INSCRIPTION_TIERS.forEach(t => { if (ok(config.inscriptionTiers[t.code])) t.price = num(config.inscriptionTiers[t.code]) })
  if (config.acidWashByType) ACID_WASH_BY_TYPE.forEach(t => { if (ok(config.acidWashByType[t.code])) t.price = num(config.acidWashByType[t.code]) })
  if (config.foundationRates) Object.keys(FOUNDATION_RATE).forEach(k => { if (ok(config.foundationRates[k])) FOUNDATION_RATE[k] = num(config.foundationRates[k]) })
  if (config.colorPremiums) GRANITE_COLORS.forEach(c => { if (ok(config.colorPremiums[c.code])) c.premium = num(config.colorPremiums[c.code]) })
  if (config.diePrices) SHAPES.forEach(s => (s.standardSizes || []).forEach(sz => { if (ok(config.diePrices[sz.code])) sz.price = num(config.diePrices[sz.code]) }))
  if (config.baseSizePrices) BASE_SIZES.forEach(b => { if (ok(config.baseSizePrices[b.code])) b.price = num(config.baseSizePrices[b.code]) })
  if (config.addOnPrices) ADD_ONS_CATALOG.forEach(a => { if (ok(config.addOnPrices[a.code])) a.price = num(config.addOnPrices[a.code]) })
  // INSCRIPTION-PRICING-SYNC — the owner edits inscription prices under
  // "Inscription tiers" (INSCRIPTION_TIERS: full/mdy/year), but the wizard
  // prices inscriptions via the duplicate lett-* Lettering add-ons. Mirror the
  // tier values onto the matching add-ons so a Settings change actually flows to
  // new wizard orders. Applied LAST so the Inscription-tiers field stays
  // authoritative even when the saved config also carries the (default) lett-*
  // addOnPrices value.
  if (config.inscriptionTiers) {
    const TIER_TO_LETT = { full: 'lett-full', mdy: 'lett-mdy', year: 'lett-year' }
    ADD_ONS_CATALOG.forEach(a => {
      const tier = Object.keys(TIER_TO_LETT).find(k => TIER_TO_LETT[k] === a.code)
      if (tier && ok(config.inscriptionTiers[tier])) a.price = num(config.inscriptionTiers[tier])
    })
  }
}

// Fetch + apply the stored config at startup. Safe to call repeatedly; silent
// on failure (engine keeps the constant defaults).
let _pricingLoaded = false
export async function loadPricingConfig() {
  try {
    const { data, error } = await supabase
      .from('pricing_config').select('config').eq('tenant_id', PRICING_TENANT_ID).maybeSingle()
    if (error) { console.error('loadPricingConfig:', error.message); return { ok: false, error: error.message } }
    if (data?.config && Object.keys(data.config).length) applyPricingConfig(data.config)
    _pricingLoaded = true
    return { ok: true }
  } catch (e) {
    console.error('loadPricingConfig:', e)
    return { ok: false, error: String(e?.message || e) }
  }
}
export const isPricingLoaded = () => _pricingLoaded

// Effective config for the editor: pristine defaults merged with the stored row.
export async function getEffectivePricingConfig() {
  try {
    const { data, error } = await supabase
      .from('pricing_config').select('config').eq('tenant_id', PRICING_TENANT_ID).maybeSingle()
    if (error) { console.error('getEffectivePricingConfig:', error.message) }
    return mergePricingConfig(DEFAULT_PRICING_CONFIG, data?.config || {})
  } catch {
    return { ...DEFAULT_PRICING_CONFIG }
  }
}

// Persist the full edited config and re-apply immediately (form reprices live).
export async function savePricingConfig(config, userId) {
  try {
    const { error } = await supabase.from('pricing_config').upsert({
      tenant_id: PRICING_TENANT_ID,
      config,
      updated_at: new Date().toISOString(),
      updated_by: userId || null,
    }, { onConflict: 'tenant_id' })
    if (error) return { ok: false, error: error.message }
    applyPricingConfig(config)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
}

// ── Register the shared line-item engine for stonebooksData (no import cycle) ──
// LINE ITEMS ARE THE PRICE (Paul, final): the Orders-page total = sum of the line
// items via the SAME priceOrderTotals the contract PDF uses. .totals.grandTotal —
// NOT .displayed — so a manual grand-total override (pricing.manualTotal) is
// IGNORED for the balance. Raw snake rows are converted via rowToOrder; an already
// -camel order (has serviceTypes) passes straight through. No basePrice/override
// reconstruction, no contract_total, no payment_status. $0 with no line items.
registerRowGrandTotal((row) => {
  if (!row) return 0
  const o = row.serviceTypes ? row : rowToOrder(row)
  return priceOrderTotals(o).totals.grandTotal
})
