// Test harness for api/push/_scheduled.js (FIELD-NOTIF-2: instants only —
// clock helpers + the weekend-quiet rule). Pure module — no deps, no network.
// Run: node scripts/test_scheduled_push.mjs
import { readFileSync } from 'node:fs'
import { shopClock, toEtYmd, isWeekendYmd, weekendOffSet } from '../api/push/_scheduled.js'

let failed = 0
const ok = (cond, name) => {
  if (cond) console.log(`  pass  ${name}`)
  else { failed++; console.error(`  FAIL  ${name}`) }
}

console.log('clock helpers')
ok(toEtYmd('2026-07-25T03:30:00.000Z') === '2026-07-24', '11:30pm ET stays on the shop day (EDT)')
ok(toEtYmd('2026-01-25T03:30:00.000Z') === '2026-01-24', '10:30pm ET winter stays on the shop day (EST)')
const clk = shopClock(new Date('2026-07-24T10:45:00.000Z'))
ok(clk.ymd === '2026-07-24' && clk.minuteOfDay === 6 * 60 + 45, 'shopClock: 10:45Z = 6:45am ET in July')

console.log('weekend quiet (Production + Sales workers)')
ok(!isWeekendYmd('2026-07-24') && isWeekendYmd('2026-07-25') && isWeekendYmd('2026-07-26'),
  'Fri no / Sat yes / Sun yes')
const ROSTER = [
  { name: 'Collin', department: 'Production', is_owner: false },
  { name: 'Leo', department: 'Production', is_owner: false },
  { name: 'Sam', department: 'Sales', is_owner: false },
  { name: 'Sabina', department: 'Admin', is_owner: true },
  { name: 'Chelsea', department: 'Production', is_owner: true },   // owner exempt even in a quiet dept
  { name: 'Paul', department: null, is_owner: true },
]
const satOff = weekendOffSet('2026-07-25', ROSTER)
ok([...satOff].sort().join() === 'Collin,Leo,Sam', 'Saturday set = Production + Sales workers only')
ok(!satOff.has('Chelsea') && !satOff.has('Sabina'), 'owners exempt regardless of department')
ok(weekendOffSet('2026-07-24', ROSTER).size === 0, 'weekday set is empty')

console.log('send.js regression guards (text-level)')
const sender = readFileSync(new URL('../api/push/send.js', import.meta.url), 'utf8')
ok(sender.includes('weekendOffSet(today') && sender.includes('weekendOffToday.has(e.person)'),
  'send loop gates weekend-off people (claims/feed still land, pushes skipped)')
ok(!sender.includes('buildScheduledEvents') && !sender.includes('DIGEST_HOUR') && !sender.includes('rundigest'),
  'NO scheduled summaries: no builder call, no digest gate, no digest keys (FIELD-NOTIF-2)')
ok(!sender.includes("ledger: 'ledger'") && !sender.includes("closeout: 'closeout'"),
  'ledger/closeout pref keys gone from PREF_BY_PREFIX')
ok(sender.includes("from './_scheduled.js'"), 'sender imports the pure module for clock + weekend rule')
const prefsSheet = readFileSync(new URL('../src/field/NotifPrefsSheet.jsx', import.meta.url), 'utf8')
ok(!prefsSheet.includes("'digest'") && !prefsSheet.includes("'ledger'") && !prefsSheet.includes("'closeout'"),
  'prefs sheet has no toggles for pushes that no longer exist')

if (failed) { console.error(`\n${failed} FAILED`); process.exit(1) }
console.log('\nall green')
