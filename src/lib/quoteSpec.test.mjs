// Round-trip + isolation tests for the canonical quote spec.
// Run: node src/lib/quoteSpec.test.mjs   (no test framework needed)
//
// Acceptance #1: applySpecToOrder(order, JSONroundtrip(extractSpecFromOrder(order)))
// is JSON-deep-equal to `order` across every SPEC field, and leaves every
// non-spec field untouched. The JSON round-trip simulates the JSONB write to
// orders.quotes so an in-memory clone can't diverge from what persists.

import {
  SPEC_TOP_FIELDS,
  extractSpecFromOrder,
  applySpecToOrder,
  validateSpec,
} from './quoteSpec.js'

let failures = 0
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
function assert(name, cond) {
  if (cond) { console.log(`  PASS  ${name}`) }
  else { console.error(`  FAIL  ${name}`); failures++ }
}

// A representative order: spec fields with dynamic pricing keys + inscription
// CONTENT, plus every do-not-touch field, to prove isolation.
const order = {
  // ── spec: stone geometry/identity ──
  shape: 'slant', standardSizeCode: 'slant-2-6', graniteColor: 'medium-barre-grey',
  width: 30, depth: 12, thickness: 18, height: null,
  topShape: 'classic-serp', sides: 'brp', polishLevel: 'P5',
  customShape: null, customShapeDescription: '',
  // ── spec: whole sub-objects ──
  baseConfig: { include: true, sizeCode: 'base-2-6x1-2', width: null, depth: null, heightCode: '8', polishMargin2in: true, sides: 'polish-top-brp' },
  addOns: [{ code: 'lett-full', qty: 1, price: 695, label: 'Lettering: Full Inscription' }],
  serviceTypes: ['NEW_STONE'],
  pricing: {
    overrides: { 'base-stone': 3100 }, customLineItems: [{ id: 7, label: 'Special', amount: 50 }],
    applyTax: true, applyCCSurcharge: false, foundationCalc: true, foundationOverride: null,
    discountPct: 10, discountType: 'pct', discountValue: 10,
    // dynamically-added keys makeBlankOrder never declares (must survive whole-object capture):
    customColorPct: 0, customColorName: '', lineItemOverrides: { 'saw-base': 200 },
    lineItemFlagOverrides: { 'addon-lett-full': { taxable: false } },
    acidWashType: null, acidWashPrice: '', repairPrice: '', polishDieSides: true,
    removedLineItems: ['base-margin'], manualTotal: '', notes: 'internal pricing note',
  },
  rushFeesPerService: { NEW_STONE: 250 },
  polishSides: true, rushOrder: true,
  // ── spec: inscription PRICING fields, alongside CONTENT that must be preserved but NOT snapshotted ──
  inscription: {
    tier: 'full', customFont: true,
    epitaph: 'Forever in our hearts', layoutStyle: 'centered_family_name',
    dateFormat: 'year_only', carveText: 'PAUL V.', customNotes: 'serif please',
  },
  // ── do-not-touch (shared) fields ──
  id: 'ord-123', orderNumber: 'E-26-0099', status: 'quoted', primary_lastname: 'Vargas',
  deceased: [{ firstName: 'Paul', lastName: 'Vargas', dateOfBirth: '1919-01-01' }],
  cemetery: { name: 'Holy Cross', section: 'A' },
  customer: { id: 'cust-1', firstName: 'Maria', lastName: 'Vargas' },
  payments: [{ id: 'p1', amount: 1000, locked: true }],
  designs: [{ id: 'd1', snapshot: {} }], designPreferences: 'angel motif',
  customerSignatureUrl: 'https://x/sig.png', signedAt: null,
  staffNotes: [{ text: 'call back' }], targetCompletionDate: '2026-12-01',
}

// ── Acceptance #1: round-trip invariant ───────────────────────────────────────
const spec = extractSpecFromOrder(order)
const persisted = JSON.parse(JSON.stringify(spec))     // simulate JSONB write/read
const back = applySpecToOrder(order, persisted)

console.log('Round-trip invariant:')
for (const f of SPEC_TOP_FIELDS) {
  assert(`spec field preserved: ${f}`, eq(back[f], order[f]))
}
assert('inscription.tier preserved', back.inscription.tier === order.inscription.tier)
assert('inscription.customFont preserved', back.inscription.customFont === order.inscription.customFont)
assert('inscription CONTENT preserved (epitaph)', back.inscription.epitaph === order.inscription.epitaph)
assert('inscription CONTENT preserved (carveText)', back.inscription.carveText === order.inscription.carveText)
assert('dynamic pricing key survived (lineItemOverrides)', eq(back.pricing.lineItemOverrides, order.pricing.lineItemOverrides))
assert('dynamic pricing key survived (polishDieSides)', back.pricing.polishDieSides === true)

console.log('Non-spec fields untouched:')
for (const f of ['id', 'orderNumber', 'status', 'primary_lastname', 'deceased', 'cemetery', 'customer', 'payments', 'designs', 'designPreferences', 'customerSignatureUrl', 'signedAt', 'staffNotes', 'targetCompletionDate']) {
  assert(`untouched: ${f}`, eq(back[f], order[f]))
}

// ── Spec-diff isolation (supports Acceptance #3/#4 at the spec layer) ──────────
console.log('Apply a DIFFERENT spec changes only spec fields:')
const q2spec = JSON.parse(JSON.stringify(spec))
q2spec.graniteColor = 'mountain-rose'        // #4: different granite
q2spec.standardSizeCode = 'slant-3-0'        // #3: different size
q2spec.width = 36
const q2 = applySpecToOrder(order, q2spec)
assert('graniteColor changed', q2.graniteColor === 'mountain-rose')
assert('size changed', q2.standardSizeCode === 'slant-3-0' && q2.width === 36)
assert('Quote-1 order object NOT mutated', order.graniteColor === 'medium-barre-grey' && order.standardSizeCode === 'slant-2-6')
assert('deceased still shared/identical', eq(q2.deceased, order.deceased))
assert('cemetery still shared/identical', eq(q2.cemetery, order.cemetery))
assert('inscription content still shared (epitaph)', q2.inscription.epitaph === order.inscription.epitaph)

// ── No shared references (mutating the result must not touch the source) ───────
console.log('Deep-clone (no shared refs):')
q2.pricing.overrides['base-stone'] = 99999
assert('pricing.overrides not shared with source', order.pricing.overrides['base-stone'] === 3100)
q2.addOns.push({ code: 'x' })
assert('addOns not shared with source', order.addOns.length === 1)

// ── validateSpec ──────────────────────────────────────────────────────────────
console.log('validateSpec:')
assert('complete spec ok', validateSpec(spec).ok === true)
assert('empty spec missing field', validateSpec({}).ok === false)
assert('inscription-only spec ok via serviceTypes', validateSpec({ serviceTypes: ['INSCRIPTION'] }).ok === true)

console.log('')
if (failures) { console.error(`${failures} FAILED`); process.exit(1) }
else { console.log('ALL PASSED'); process.exit(0) }
