// =============================================================================
// reconciliationEngine.js — Phase 1 match engine (PURE compute, writes nothing)
// =============================================================================
// Matches the 253 non-lead OPEN orders against the embedded 92-job active schedule
// snapshot and sorts them into review buckets. No DB access, no mutation — the
// review UI runs this on live data and the operator approves before anything writes.
// =============================================================================
import { RECONCILIATION_SCHEDULE } from './reconciliationSchedule'

// ── Normalization (matching only — original text is always preserved) ─────────
const SURNAME_TAGS = /\b(MKR|MRK|SLT|SLANT|BRONZE|HM|STOCK|TA|DBL|DOUBLE)\b/g
export function normalizeSurname(s) {
  return String(s || '').toUpperCase().split(/[,/]/)[0].replace(SURNAME_TAGS, '').replace(/\s+/g, ' ').trim()
}

// Canonical aliases for the dirty/abbreviated cemetery variants seen on the sheet
// AND the duplicated/typo'd cemeteries rows. Applied to a pre-stripped uppercase
// string. Kept conservative: genuinely-different cemeteries (Mount Lebanon vs New
// Mount Lebanon) stay distinct — only typos/abbreviations collapse.
const CEMETERY_ALIASES = [
  [/\bSAINT GERTRUFE\b/, 'ST GERTRUDE'], [/\bST GERTS?\b/, 'ST GERTRUDE'], [/\bSAINT GERTRUDE\b/, 'ST GERTRUDE'],
  [/\bSAINT NIC\b/, 'ST NICHOLAS'], [/\bST NIC\b/, 'ST NICHOLAS'],
  [/\bNEW MT LEB\b/, 'NEW MOUNT LEBANON'], [/\bMT LEB\b/, 'MOUNT LEBANON'],
  [/\bMT CALVARY\b/, 'MOUNT CALVARY'],
  [/\bOLH\b/, 'OUR LADY OF HOPE'], [/\bOUR LADY OF HELP\b/, 'OUR LADY OF HOPE'],
  [/\bUKR\b/, 'UKRAINIAN'],
  [/\bFAIRVIEW WF\b/, 'FAIRVIEW WESTFIELD'],
  [/\bHILLSIDE MET\b/, 'HILLSIDE'], // Hillside vs Hillside Met — collapse the abbrev
  [/\bRESURRECTION PISC\b/, 'RESURRECTION'],
  [/\bST PETER AND PAUL\b/, 'ST PETER AND PAUL'],
]
const CEM_STRIP = /\b(CEMETERY|MAUSOLEUM|MEMORIAL PARK|MEMORIAL|GARDENS?|EPISCOPAL|CATHOLIC|PARISH|CHURCH|R\.?C\.?)\b/g
export function normalizeCemetery(name) {
  let s = String(name || '').toUpperCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  for (const [re, canon] of CEMETERY_ALIASES) if (re.test(s)) { s = canon; break }
  s = s.replace(/\bSAINT\b/g, 'ST').replace(CEM_STRIP, '').replace(/\s+/g, ' ').trim()
  return s
}

// Business / vendor / demo / placeholder surnames — NEVER auto-closed; review only.
const JUNK_SURNAME_PATTERNS = [
  /\bDEMO\b/, /\bTEST\b/, /\bSAMPLE\b/, /^ZZ/, /\bPLACEHOLDER\b/, /^ASDF/, /^X+$/,
  /\bALLSTATE\b/, /\bINSURANCE\b/, /\bGEICO\b/, /\bPROGRESSIVE\b/,
  /\bDEPT\b/, /\bDEPARTMENT\b/, /\bFIRE\b/, /\bPOLICE\b/, /\bPORT READING\b/, /\bTOWNSHIP\b/, /\bBOROUGH\b/, /\bCITY OF\b/,
  /\bFH\b/, /\bFUNERAL\b/, /\bHOME\b/, /\bCHAPEL\b/,
  /\bINC\b/, /\bLLC\b/, /\bCORP\b/, /\bCOMPANY\b/, /\bGRANITE\b/, /\bMONUMENT(S)?\b/, /\bVENDOR\b/,
  /\bCHURCH\b/, /\bPARISH\b/, /\bGERD\b/,
]
export function looksNonCustomer(surname) {
  const s = String(surname || '').trim()
  if (!s || s.length <= 1 || /^\d+$/.test(s)) return true
  return JUNK_SURNAME_PATTERNS.some(re => re.test(s))
}

// orderActiveSurname — the surname to MATCH on. primary_lastname is NULL on ~200
// orders, so fall back to the linked customer's last_name (the deceased/family
// surname the schedule uses). customer.first_name is contaminated (buyer name) —
// never used. Returns { surname (normalized), raw, source }.
export function orderActiveSurname(order) {
  const o = order || {}
  const fromOrder = String(o.primary_lastname || '').trim()
  const fromCust = String(o.customer?.last_name || '').trim()
  const raw = fromOrder || fromCust
  return { surname: normalizeSurname(raw), raw, source: fromOrder ? 'order' : (fromCust ? 'customer' : 'none') }
}

// ── The match ─────────────────────────────────────────────────────────────────
// buckets: confirmed | review | closeCandidate ; reviewReason: collision |
// non_customer | low_confidence . Plus unmatchedSchedule (jobs no order hit).
// Returns { rows, unmatchedSchedule, counts }. PURE — writes nothing.
export function matchReconciliation(openOrders, schedule = RECONCILIATION_SCHEDULE) {
  // index schedule by normalized surname
  const schedBySurname = new Map()
  for (const j of schedule) {
    const k = normalizeSurname(j.surname)
    if (!schedBySurname.has(k)) schedBySurname.set(k, [])
    schedBySurname.get(k).push(j)
  }
  // count OPEN orders per normalized surname+cemetery (to detect collisions)
  const openBySurCem = new Map()
  const prepared = (openOrders || []).map(o => {
    const sn = orderActiveSurname(o)
    const cem = normalizeCemetery(o.cemetery?.name)
    const key = `${sn.surname}|${cem}`
    openBySurCem.set(key, (openBySurCem.get(key) || 0) + 1)
    return { order: o, sn, cem, key }
  })

  const rows = []
  const matchedScheduleIds = new Set()
  for (const p of prepared) {
    const { order, sn, cem } = p
    const base = { orderId: order.id, orderNumber: order.order_number, status: order.status,
      surname: sn.surname, surnameRaw: sn.raw, surnameSource: sn.source,
      cemeteryName: order.cemetery?.name || '', cemeteryNorm: cem }

    // 1) non-customer / junk → review (never close)
    if (looksNonCustomer(sn.surname)) {
      rows.push({ ...base, bucket: 'review', reviewReason: 'non_customer', confidence: 'none',
        reason: 'Surname looks like a business/vendor/demo/placeholder — never auto-close.', match: null })
      continue
    }
    const cands = schedBySurname.get(sn.surname) || []

    // 2) surname NOT on schedule → close candidate
    if (cands.length === 0) {
      rows.push({ ...base, bucket: 'closeCandidate', confidence: 'high',
        reason: 'Surname (from ' + sn.source + ') is not on the active schedule.', match: null })
      continue
    }

    // surname IS on the schedule → keep active; refine by cemetery + collisions.
    const cemMatches = cem ? cands.filter(c => normalizeCemetery(c.cemeteryRaw) === cem) : []
    const openSiblings = openBySurCem.get(p.key) || 1

    if (openSiblings > 1) {
      // multiple OPEN orders share surname+cemetery — operator must disambiguate.
      rows.push({ ...base, bucket: 'review', reviewReason: 'collision', confidence: 'low',
        reason: `${openSiblings} open orders share "${sn.surname}" at this cemetery — pick which matches.`,
        match: cands, scheduleHints: cands.map(c => ({ id: c.id, nameRaw: c.nameRaw, firstInitial: c.firstInitial, cemeteryRaw: c.cemeteryRaw, section: c.section })) })
      continue
    }
    if (cemMatches.length === 1) {
      matchedScheduleIds.add(cemMatches[0].id)
      rows.push({ ...base, bucket: 'confirmed', confidence: 'high',
        reason: 'Surname + cemetery both match a single schedule job.', match: cemMatches[0] })
      continue
    }
    if (cemMatches.length > 1) {
      rows.push({ ...base, bucket: 'review', reviewReason: 'collision', confidence: 'low',
        reason: `Surname "${sn.surname}" matches multiple schedule jobs at this cemetery — pick one.`,
        match: cemMatches, scheduleHints: cemMatches.map(c => ({ id: c.id, nameRaw: c.nameRaw, firstInitial: c.firstInitial, cemeteryRaw: c.cemeteryRaw, section: c.section })) })
      continue
    }
    // surname on schedule but cemetery missing/mismatch → low-confidence keep
    cands.forEach(c => matchedScheduleIds.add(c.id))
    rows.push({ ...base, bucket: 'review', reviewReason: 'low_confidence', confidence: 'low',
      reason: cem ? 'Surname matches the schedule but the cemetery differs — confirm before keeping.'
                  : 'Surname matches the schedule but this order has no cemetery — confirm.',
      match: cands.length === 1 ? cands[0] : cands,
      scheduleHints: cands.map(c => ({ id: c.id, nameRaw: c.nameRaw, firstInitial: c.firstInitial, cemeteryRaw: c.cemeteryRaw, section: c.section })) })
  }

  const unmatchedSchedule = schedule.filter(j => !matchedScheduleIds.has(j.id))

  const counts = {
    open: prepared.length,
    confirmed: rows.filter(r => r.bucket === 'confirmed').length,
    review: rows.filter(r => r.bucket === 'review').length,
    review_collision: rows.filter(r => r.reviewReason === 'collision').length,
    review_non_customer: rows.filter(r => r.reviewReason === 'non_customer').length,
    review_low_confidence: rows.filter(r => r.reviewReason === 'low_confidence').length,
    closeCandidate: rows.filter(r => r.bucket === 'closeCandidate').length,
    unmatchedSchedule: unmatchedSchedule.length,
    scheduleTotal: schedule.length,
  }
  return { rows, unmatchedSchedule, counts }
}
