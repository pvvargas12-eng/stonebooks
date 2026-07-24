// =============================================================================
// _scheduled — the once-a-day push rulebook (FIELD-NOTIF-1), pure + testable
// =============================================================================
// Underscore prefix keeps this out of Vercel's route table; send.js imports it.
// Zero imports on purpose: scripts/test_scheduled_push.mjs loads this module
// directly, so the window/audience/copy logic is assertable without touching
// web-push, supabase-js, or the network.
//
// The rulebook (prototype doctrine, Paul-approved 2026-07-24):
//   • Crew run digest   6:45–11:00 shop time — today's runs + your due tasks.
//   • Morning Ledger    7:00–11:00, owners — yesterday's money + today's day.
//   • Evening closeout  18:00–22:00, owners — money in, stops done, tasks closed.
// All three are push-only summaries (feed:false — the bell keeps discrete
// events), one claim per person per day via date-suffixed dedupe keys, and
// they SKIP an all-zero day rather than push noise. The old any-time-after-7
// "Due today" digest is retired: its afternoon claims (a person with nothing
// due at 7am got pinged when a task appeared at 5pm) were redundant next to
// the instant task_assigned push.

export const CREW_DIGEST_MIN = 6 * 60 + 45   // 6:45a — crew run digest unlocks
export const LEDGER_MIN = 7 * 60             // 7:00a — owner Morning Ledger unlocks
export const MORNING_CUTOFF_MIN = 11 * 60    // 11:00a — morning claims stop (no afternoon pings)
export const CLOSEOUT_MIN = 18 * 60          // 6:00p — owner closeout unlocks
export const CLOSEOUT_CUTOFF_MIN = 22 * 60   // 10:00p — closeout claims stop

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

// ET calendar day of any timestamp — payments/closures group by SHOP day,
// never UTC day (an 11pm check must not slide into tomorrow's ledger).
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

const usd = (n) =>
  '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// ── The builder ──────────────────────────────────────────────────────────────
// Inputs are plain numbers/maps the handler gathered; output is the same event
// shape the sender claims and sends ({ key, person, title, body, url, tag, at,
// feed }). Deterministic given its inputs (nowIso passed in, never Date.now()).
export function buildScheduledEvents({
  minuteOfDay, today, yesterday, nowIso,
  subscribedPeople = [], ownerNames = [],
  dueByPerson = {},                 // person → due-today+overdue count (their badge number)
  runsToday = 0, stopsToday = 0, firstRunTitle = '',
  stopsDoneToday = 0, tasksClosedToday = 0, shopDueCount = 0,
  payByYmd = {},                    // ET ymd → { sum, count } (locked, non-voided)
  weekendOff = new Set(),           // people whose phones stay silent today (never claim)
}) {
  const events = []
  const owners = new Set(ownerNames)
  const inMorning = minuteOfDay >= CREW_DIGEST_MIN && minuteOfDay < MORNING_CUTOFF_MIN
  const inLedger = minuteOfDay >= LEDGER_MIN && minuteOfDay < MORNING_CUTOFF_MIN
  const inEvening = minuteOfDay >= CLOSEOUT_MIN && minuteOfDay < CLOSEOUT_CUTOFF_MIN

  // Crew run digest — the 6:45 "here is your day" (shop-wide runs; tasks are
  // personal). Skips a person with nothing on: no runs anywhere AND nothing due.
  if (inMorning) {
    for (const person of subscribedPeople) {
      if (owners.has(person)) continue
      if (weekendOff.has(person)) continue   // day off — not even a claim
      const due = dueByPerson[person] || 0
      if (!runsToday && !due) continue
      const runBit = runsToday
        ? `${plural(runsToday, 'run')} · ${plural(stopsToday, 'stop')}${firstRunTitle ? ` — first ${firstRunTitle}` : ''}`
        : 'No runs scheduled'
      const dueBit = due ? `${plural(due, 'task')} due.` : 'Nothing due.'
      events.push({
        key: `rundigest:${person}:${today}`,
        person,
        title: 'Today at the shop',
        body: `${runBit}. ${dueBit}`,
        url: '/field',
        tag: 'sb-digest',
        at: nowIso,
        feed: false,
      })
    }
  }

  // Morning Ledger — owners, 7:00. Yesterday's money + today's shape.
  if (inLedger) {
    const y = payByYmd[yesterday] || { sum: 0, count: 0 }
    for (const person of subscribedPeople) {
      if (!owners.has(person)) continue
      const due = dueByPerson[person] || 0
      if (!y.count && !runsToday && !due) continue
      const moneyBit = y.count ? `Yesterday ${usd(y.sum)} in (${plural(y.count, 'payment')})` : 'Yesterday $0 in'
      const dayBit = runsToday ? `Today ${plural(runsToday, 'run')} · ${plural(stopsToday, 'stop')}` : 'Today no runs'
      const dueBit = due ? `${plural(due, 'task')} due.` : 'Nothing due.'
      events.push({
        key: `ledger:${person}:${today}`,
        person,
        title: 'Morning Ledger',
        body: `${moneyBit}. ${dayBit}. ${dueBit}`,
        url: '/field',
        tag: 'sb-ledger',
        at: nowIso,
        feed: false,
      })
    }
  }

  // Evening closeout — owners, 6:00p. What the day actually did.
  if (inEvening) {
    const t = payByYmd[today] || { sum: 0, count: 0 }
    if (t.count || stopsDoneToday || tasksClosedToday || shopDueCount) {
      const bits = []
      bits.push(t.count ? `${usd(t.sum)} in (${plural(t.count, 'payment')})` : '$0 in')
      if (stopsDoneToday) bits.push(`${plural(stopsDoneToday, 'stop')} done`)
      if (tasksClosedToday) bits.push(`${plural(tasksClosedToday, 'task')} closed`)
      bits.push(shopDueCount ? `${shopDueCount} still due` : 'board clear')
      for (const person of subscribedPeople) {
        if (!owners.has(person)) continue
        events.push({
          key: `closeout:${person}:${today}`,
          person,
          title: 'Evening closeout',
          body: `Today ${bits.join(' · ')}.`,
          url: '/field',
          tag: 'sb-closeout',
          at: nowIso,
          feed: false,
        })
      }
    }
  }

  return events
}
