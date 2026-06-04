// =============================================================================
// 📚 Stonebooks — inscription carve-text generator (shared)
// =============================================================================
// ONE source of truth for the engraving text, imported by BOTH the Sales wizard
// (SalesMode.jsx) and the Quick Order form (OrderForm.jsx) so the two can never
// drift. Generates the exact text the engraver carves from the deceased data +
// the inscription type.
//
// Exact shop formats (matched precisely — do not "improve"):
//   Month  → 3-letter abbrev + period; "May" has NO period.
//   Date   → "Mon. D, YYYY" (no leading zero on day) e.g. "Oct. 1, 2020".
//   Range  → "{birth} - {death}" (space-hyphen-space); one date alone if only one.
//   Name   → "First M. Last" title-cased; middle initial omitted if no middle.
//   Years  → "{birthYear} - {deathYear}".
// Output by inscription type:
//   full → name line + date-range line   mdy → date-range line only   year → year range
// =============================================================================

const CARVE_MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.']

function carveTitleCase(s) {
  return String(s || '').trim().replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
}
function carveName(d) {
  const first = carveTitleCase(d.firstName)
  const last  = carveTitleCase(d.lastName)
  const mid   = (d.middleName || '').trim()
  const midInit = mid ? `${mid.charAt(0).toUpperCase()}.` : ''
  return [first, midInit, last].filter(Boolean).join(' ')
}
// ISO-ish "YYYY-MM-DD" → "Oct. 1, 2020" (parsed by component → no timezone shift)
function carveFullDate(iso) {
  if (!iso) return ''
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  const yi = parseInt(y, 10), mi = parseInt(m, 10), di = parseInt(d, 10)
  if (!yi || !mi || !di || mi < 1 || mi > 12) return ''
  return `${CARVE_MONTHS[mi - 1]} ${di}, ${yi}`
}
function carveYear(iso) {
  const y = String(iso || '').slice(0, 4)
  return /^\d{4}$/.test(y) ? y : ''
}
function carveRange(a, b) {
  if (a && b) return `${a} - ${b}`
  return a || b || ''
}
function carveDateRange(d) { return carveRange(carveFullDate(d.dateOfBirth), carveFullDate(d.dateOfDeath)) }
function carveYearRange(d) { return carveRange(carveYear(d.dateOfBirth), carveYear(d.dateOfDeath)) }

// Normalize the inscription type from either surface: the wizard stores
// inscription.type ('full' | 'date' | 'year'); the Quick Order form stores
// inscription.tier ('full' | 'mdy' | 'year'). 'date' and 'mdy' are the same
// thing (Month/Day/Year). Returns 'full' | 'mdy' | 'year' | null.
function resolveCarveType(insc) {
  const v = insc?.type || insc?.tier || null
  if (v === 'date' || v === 'mdy') return 'mdy'
  if (v === 'year') return 'year'
  if (v === 'full') return 'full'
  return null
}

export function generateCarveText(order) {
  const t = resolveCarveType(order?.inscription)
  const d = (order?.deceased || []).find(x =>
    x && !x.isReserved && (x.firstName || x.lastName || x.dateOfBirth || x.dateOfDeath))
  if (!d) return ''
  if (t === 'year') return carveYearRange(d)
  if (t === 'mdy')  return carveDateRange(d)
  // 'full' (and the null default) → name line + date-range line
  return [carveName(d), carveDateRange(d)].filter(Boolean).join('\n')
}
