// =============================================================================
// quoteSpec.js — canonical stone-spec extract/apply for the multi-quote layer.
// =============================================================================
// THE single source of truth for "what is a quote's stone spec." A quote stores
// ONLY these fields; everything else on the order (deceased, cemetery, customer,
// permit, payments, designs, signatures, notes, order number) is SHARED across
// all quotes and is never captured or written here.
//
// PURE MODULE — no React, no supabase, no engine imports. This lets the Node
// round-trip test (quoteSpec.test.mjs) import it directly, AND keeps extract/
// apply free of side effects. Pricing a quote = applySpecToOrder(order, spec)
// then running the live engine (computeFormLineItems/computeTotals); we never
// cache a quote's lineItems/total.
//
// INVARIANT (unit-tested): for any order,
//   applySpecToOrder(order, JSONroundtrip(extractSpecFromOrder(order)))
// is JSON-deep-equal to `order` across every SPEC field, and leaves every
// non-spec field untouched. The JSON round-trip in the test simulates the JSONB
// write to orders.quotes so an in-memory clone can't diverge from what persists.
// =============================================================================

// Top-level fields captured verbatim (scalars + whole sub-objects). Whole
// sub-objects (baseConfig, addOns, serviceTypes, pricing, rushFeesPerService)
// are snapshotted entire — `pricing` especially, because the engine reads many
// keys (customColorPct, discountType/Value, lineItemOverrides,
// lineItemFlagOverrides, acidWash*, repair*, polishDieSides, removedLineItems,
// manualTotal …) that makeBlankOrder never declares; enumerating them would
// silently drop the dynamically-added ones.
//
// topShape / sides / polishLevel / thickness / customShape / customShapeDescription
// are NOT priced by either engine, but are included deliberately ("no silent
// drops"): the future contract PDF spec block needs them, and since the per-quote
// editor never varies them they harmlessly inherit Quote 1's value. NOTE: top-level
// `sides` (SIDES_OPTIONS — the die/stone vertical-side treatment) is DISTINCT from
// `baseConfig.sides` (BASE_SIDES_OPTIONS — the base's sides); both are captured,
// the first authoritative for the die, the second (inside baseConfig) for the base.
export const SPEC_TOP_FIELDS = [
  // stone geometry + identity
  'shape', 'standardSizeCode', 'graniteColor',
  'width', 'depth', 'thickness', 'height',
  // stone surface attributes (PDF spec block; not priced, never varied per quote)
  'topShape', 'sides', 'polishLevel',
  'customShape', 'customShapeDescription',
  // whole sub-objects
  'baseConfig', 'addOns', 'serviceTypes', 'pricing', 'rushFeesPerService',
  // scalars
  'polishSides', 'rushOrder',
]

// Inscription is captured as a NESTED PARTIAL — only the two pricing-relevant
// keys. The rest of inscription (epitaph, layout, dateFormat, carveText, all the
// deceased-linked content) is SHARED across quotes and must NOT be snapshotted:
// snapshotting it would restore a stale epitaph when a quote is later promoted.
export const SPEC_INSCRIPTION_FIELDS = ['tier', 'customFont']

// Flat list of every captured field, for tests/introspection.
export const SPEC_FIELDS = [
  ...SPEC_TOP_FIELDS,
  ...SPEC_INSCRIPTION_FIELDS.map((f) => `inscription.${f}`),
]

// Deep clone via the SAME path the value takes into JSONB: JSON round-trip.
// This strips `undefined` and any non-serializable value (Date, Map, function)
// so the in-memory spec can never diverge from what persists in orders.quotes.
function jsonClone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v))
}

// Extract the canonical spec from an order. Result is JSON-safe (already round-
// tripped), so it can be written straight into orders.quotes[].spec.
export function extractSpecFromOrder(order) {
  const spec = {}
  for (const key of SPEC_TOP_FIELDS) {
    const v = order?.[key]
    if (v !== undefined) spec[key] = v
  }
  const insc = {}
  for (const f of SPEC_INSCRIPTION_FIELDS) {
    const v = order?.inscription?.[f]
    if (v !== undefined) insc[f] = v
  }
  spec.inscription = insc
  // Single JSONB-equivalent normalization for the whole spec.
  return JSON.parse(JSON.stringify(spec))
}

// Apply a spec onto an order, returning a NEW order with exactly the SPEC fields
// overwritten (deep-cloned) and every other field carried through untouched.
// Exact inverse of extractSpecFromOrder over SPEC_FIELDS.
//   - deceased[], cemetery, customer link, permit, payments[], designs/
//     designPreferences, signatures, order number, notes/staffNotes: untouched.
//   - primary_lastname is GENERATED in Postgres — never written here.
export function applySpecToOrder(order, spec) {
  const next = { ...order }
  if (spec && typeof spec === 'object') {
    for (const key of SPEC_TOP_FIELDS) {
      if (key in spec) next[key] = jsonClone(spec[key])
    }
    // Inscription nested-partial merge: keep ALL existing inscription content,
    // overwrite only the captured pricing keys.
    const insc = { ...(order?.inscription || {}) }
    if (spec.inscription && typeof spec.inscription === 'object') {
      for (const f of SPEC_INSCRIPTION_FIELDS) {
        if (f in spec.inscription) insc[f] = jsonClone(spec.inscription[f])
      }
    }
    next.inscription = insc
  }
  return next
}

// Validate a spec is complete enough to drive pricing/promotion. Returns
// { ok: true } or { ok: false, missing: '<field>' }. Used by the promotion
// sprint (abort-on-incomplete) and by QuotesManager to gate generation.
export function validateSpec(spec) {
  if (!spec || typeof spec !== 'object') return { ok: false, missing: 'spec' }
  // A stone-bearing quote needs a shape; an inscription/acid/repair-only quote
  // is driven by serviceTypes instead. Require at least one of the two.
  const hasShape = !!spec.shape
  const hasService = Array.isArray(spec.serviceTypes) && spec.serviceTypes.length > 0
  if (!hasShape && !hasService) return { ok: false, missing: 'shape (or serviceTypes)' }
  return { ok: true }
}
