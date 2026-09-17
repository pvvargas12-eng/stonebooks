// =============================================================================
// Foundation E-Form vocabulary + prefill (FDN-EFORM, 2026-09-17)
// =============================================================================
// Paul's paper FOUNDATION sheet, digitized. One shared definition so the
// desktop modal (FoundationFormModal) and the field sheet (FoundationsScreen)
// render, prefill, and validate the exact same form. Values live in
// foundation_forms.data (see the 20260917 migration for the key list).
// Prefill rides the Permit Builder autofill registry against the MAPPED order
// (rowToOrder output) — same resolvers the permits use, so the two never drift.
// =============================================================================
import { autofillValue } from './permitBuilder'

export const FDN_GRAVE_CONFIGS = [
  ['single',      'Single'],
  ['double_deep', 'Double Deep'],
  ['side_x_side', 'Side x Side'],
]

export const FDN_REMAINS = [
  ['full_body', 'Full body'],
  ['cremains',  'Cremains'],
]

export const FDN_STONE_TYPES = [
  ['slant',          'Slant'],
  ['grass_marker',   'Grass marker'],
  ['hickey_upright', 'Hickey / Upright'],
]

export const FDN_YN = [
  ['N', 'No'],
  ['Y', 'Yes'],
]

const label = (pairs, code) => (pairs.find(([c]) => c === code)?.[1]) || ''
export const fdnGraveConfigLabel = (c) => label(FDN_GRAVE_CONFIGS, c)
export const fdnRemainsLabel = (c) => label(FDN_REMAINS, c)
export const fdnStoneTypeLabel = (c) => label(FDN_STONE_TYPES, c)

// The picks the operator MUST make before Save enables — the paper form's
// circled choices. Text fields prefill from the order and may be corrected.
export const FDN_REQUIRED_PICKS = ['grave_config', 'remains', 'veteran_marker_temp', 'stone_type']

export function foundationFormComplete(data) {
  return !!data && FDN_REQUIRED_PICKS.every(k => data[k])
}

// Best-guess stone type from the order's shape string — a suggestion only,
// the operator confirms it on the form.
function guessStoneType(shape) {
  const s = String(shape || '').toLowerCase()
  if (!s) return ''
  if (s.includes('slant')) return 'slant'
  if (s.includes('grass') || s.includes('flat') || s.includes('flush')) return 'grass_marker'
  if (s.includes('hickey') || s.includes('upright') || s.includes('serp')) return 'hickey_upright'
  return ''
}

const PLOT_TO_CONFIG = { single: 'single', dd: 'double_deep', sxs: 'side_x_side' }

// `mapped` is the rowToOrder(order, customer, cemetery) output — the same
// object the permit autofill resolvers were written against.
export function prefillFoundationForm(mapped) {
  const o = mapped || {}
  return {
    cemetery:        autofillValue('cemetery_name', o),
    customer_name:   autofillValue('customer_name', o),
    phone:           autofillValue('customer_phone', o),
    cell:            '',
    deceased:        autofillValue('deceased_name', o),
    dod:             autofillValue('deceased_dod', o),
    location:        autofillValue('grave_location', o),
    stone_size:      autofillValue('die_size', o),
    foundation_size: autofillValue('foundation_size', o),
    grave_config:    PLOT_TO_CONFIG[o?.plotType || o?.plot_type] || '',
    remains:         '',
    veteran_marker_temp: '',
    stone_type:      guessStoneType(o?.shape),
    must_have_map:   '',
    map_note:        '',
  }
}

// Field definition the two form UIs render from: text inputs in paper order,
// then the pick rows. `key` = foundation_forms.data key.
export const FDN_TEXT_FIELDS = [
  { key: 'cemetery',        label: 'Cemetery' },
  { key: 'customer_name',   label: 'Customer name' },
  { key: 'phone',           label: 'Customer phone' },
  { key: 'cell',            label: 'Cell' },
  { key: 'deceased',        label: 'Deceased' },
  { key: 'dod',             label: 'DOD' },
  { key: 'location',        label: 'Location' },
  { key: 'stone_size',      label: 'Stone size' },
  { key: 'foundation_size', label: 'Foundation size' },
]

export const FDN_PICK_FIELDS = [
  { key: 'grave_config',        label: 'Grave',            options: FDN_GRAVE_CONFIGS },
  { key: 'remains',             label: 'Cremains / full body', options: FDN_REMAINS },
  { key: 'veteran_marker_temp', label: 'Veteran mrkr temp', options: FDN_YN },
  { key: 'stone_type',          label: 'Stone type',       options: FDN_STONE_TYPES },
  { key: 'must_have_map',       label: 'Must have map',    options: FDN_YN.slice().reverse() },
]
