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
import { supabase } from './supabase'

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
      const rate = liveRates.customDiePerSqIn
      baseStone.amount = Math.round(L * H * rate * 100) / 100
      baseStone.label = `${shape.label} (custom ${L}″ × ${H}″ face × $${rate}/sq in)`
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
      items.push({ code: 'polish-sides', label: `Polish die sides (${heightIn}″ tall @ ${thickness}″ thick)`, amount: Math.round((heightIn / 12) * rate), editable: true })
    }
  }

  const baseW = baseWidthOf(order)
  const baseD = baseDepthOf(order)
  const bc = order.baseConfig || {}

  // (3) 2″ base polish margin — $70 PER FOOT of base PERIMETER (2×(w+d)).
  if (bc.include && bc.polishMargin2in && baseW > 0 && baseD > 0) {
    const perimeter = 2 * (baseW + baseD)
    const rate = liveRates.basePolishMarginPerFoot
    items.push({ code: 'base-margin', label: `2″ polished margin (perimeter ${perimeter}″ ÷ 12 × $${rate})`, amount: Math.round((perimeter / 12) * rate), editable: true })
  }

  // (4) Saw base — (base length ÷ 12) × $45 when the base finish is SB (sawn).
  if (bc.include && bc.finish === 'SB' && baseW > 0) {
    const rate = liveRates.sawBasePerFoot
    items.push({ code: 'saw-base', label: `Saw base (${baseW}″ ÷ 12 × $${rate})`, amount: Math.round((baseW / 12) * rate), editable: true })
  }

  // Owner-quote flag — custom line items the form flags for the owner to price
  // carry `quotePending` on their `raw` record; surface it on the line item so
  // computeTotals excludes them and the UI can render "$— (owner quote)".
  for (const it of items) {
    if (it.raw?.quotePending) it.quotePending = true
  }

  // Operator amount overrides — the Finance card lets staff edit any computed
  // line's amount; a non-empty override on that line's code wins.
  const ov = pr.lineItemOverrides || {}
  for (const it of items) {
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
    })
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
  const tax = applyTax ? taxBase * liveRates.njTax : 0
  const cc = applyCCSurcharge ? (taxBase + tax) * liveRates.ccSurcharge : 0
  return {
    subtotalDisc: Math.round(subtotalDisc * 100) / 100,
    subtotalPermit: Math.round(subtotalPermit * 100) / 100,
    discountAmt: Math.round(discountAmt * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    cc: Math.round(cc * 100) / 100,
    grandTotal: Math.round(taxBase + tax + cc),
  }
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
