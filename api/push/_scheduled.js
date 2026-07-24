// =============================================================================
// _scheduled — shop-clock helpers + the weekend-quiet rule (FIELD-NOTIF-2)
// =============================================================================
// Underscore prefix keeps this out of Vercel's route table; send.js imports it.
// Zero imports on purpose: scripts/test_scheduled_push.mjs loads this module
// directly, so the logic is assertable without web-push/supabase/network.
//
// HISTORY: FIELD-NOTIF-1 (2026-07-24) built scheduled morning/evening summary
// pushes here (crew run digest / Morning Ledger / Evening closeout). Paul
// killed them the same day ("thats not helpful") — instants only. What
// survives is the shop clock and his weekend rule.

// Shop-local clock (America/New_York) — due-date math must match the phones.
export function shopClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const get = (t) => (parts.find(p => p.type === t) || {}).value
  const hour = parseInt(get('hour'), 10)
  const minute = parseInt(get('minute'), 10)
  return { ymd: `${get('year')}-${get('month')}-${get('day')}`, hour, minute, minuteOfDay: hour * 60 + minute }
}

// ET calendar day of any timestamp — anything grouping by day groups by SHOP
// day, never UTC day (an 11pm event must not slide into tomorrow).
export function toEtYmd(iso) {
  const t = new Date(iso || 0)
  if (isNaN(t.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(t)
}

// Weekend-quiet rule (Paul, 2026-07-24): Production and Sales workers get NO
// pushes on Saturday or Sunday — their days off stay quiet. Owners are exempt
// (money never sleeps), and Installation/Admin still hear (installs happen on
// Saturdays). The ymd is the SHOP day from shopClock, so the boundary is ET
// midnight, not UTC.
export const WEEKEND_OFF_DEPTS = ['Production', 'Sales']

export function isWeekendYmd(ymd) {
  const d = new Date(String(ymd) + 'T12:00:00Z')   // UTC noon — immune to date shifting
  if (isNaN(d.getTime())) return false
  const dow = d.getUTCDay()
  return dow === 0 || dow === 6
}

// The set of people whose phones stay silent today. Pure: employees rows in,
// names out; empty on weekdays.
export function weekendOffSet(ymd, employees = []) {
  if (!isWeekendYmd(ymd)) return new Set()
  const out = new Set()
  for (const e of employees) {
    if (e && !e.is_owner && WEEKEND_OFF_DEPTS.includes(e.department)) out.add(e.name)
  }
  return out
}
