// Test harness for api/push/_scheduled.js (FIELD-NOTIF-1).
// Pure module — no deps, no network. Run: node scripts/test_scheduled_push.mjs
import { readFileSync } from 'node:fs'
import {
  buildScheduledEvents, shopClock, toEtYmd,
  CREW_DIGEST_MIN, LEDGER_MIN, MORNING_CUTOFF_MIN, CLOSEOUT_MIN, CLOSEOUT_CUTOFF_MIN,
} from '../api/push/_scheduled.js'

let failed = 0
const ok = (cond, name) => {
  if (cond) console.log(`  pass  ${name}`)
  else { failed++; console.error(`  FAIL  ${name}`) }
}

const BASE = {
  today: '2026-07-24', yesterday: '2026-07-23', nowIso: '2026-07-24T11:00:00.000Z',
  subscribedPeople: ['Paul', 'Chelsea', 'Collin'],
  ownerNames: ['Paul', 'Chelsea', 'Alex'],          // Alex is owner but NOT subscribed
  dueByPerson: { Paul: 4, Chelsea: 0, Collin: 3 },
  runsToday: 2, stopsToday: 9, firstRunTitle: 'Holy Cross run',
  stopsDoneToday: 7, tasksClosedToday: 5, shopDueCount: 3,
  payByYmd: { '2026-07-23': { sum: 4120, count: 3 }, '2026-07-24': { sum: 2900, count: 2 } },
}
const at = (minuteOfDay, over = {}) => buildScheduledEvents({ ...BASE, minuteOfDay, ...over })
const keys = (evs) => evs.map(e => e.key).sort()
const byPrefix = (evs, p) => evs.filter(e => e.key.startsWith(p + ':'))

console.log('window edges')
ok(byPrefix(at(CREW_DIGEST_MIN - 1), 'rundigest').length === 0, '6:44 → no crew digest')
ok(byPrefix(at(CREW_DIGEST_MIN), 'rundigest').length === 1, '6:45 → crew digest (Collin only)')
ok(byPrefix(at(LEDGER_MIN - 1), 'ledger').length === 0, '6:59 → no ledger yet')
ok(byPrefix(at(LEDGER_MIN), 'ledger').length === 2, '7:00 → ledger for both subscribed owners')
ok(at(MORNING_CUTOFF_MIN).length === 0, '11:00 → morning window closed, nothing claims')
ok(byPrefix(at(MORNING_CUTOFF_MIN - 1), 'rundigest').length === 1, '10:59 → morning still open')
ok(byPrefix(at(CLOSEOUT_MIN - 1), 'closeout').length === 0, '5:59p → no closeout')
ok(byPrefix(at(CLOSEOUT_MIN), 'closeout').length === 2, '6:00p → closeout for subscribed owners')
ok(at(CLOSEOUT_CUTOFF_MIN).length === 0, '10:00p → evening window closed')
ok(at(15 * 60).length === 0, '3:00p → NO afternoon pings of any kind (the 5pm digest bug is dead)')

console.log('role split + audience')
const morning = at(LEDGER_MIN)
ok(keys(byPrefix(morning, 'rundigest')).join() === 'rundigest:Collin:2026-07-24', 'crew digest goes only to subscribed crew')
ok(keys(byPrefix(morning, 'ledger')).join() === 'ledger:Chelsea:2026-07-24,ledger:Paul:2026-07-24', 'ledger goes only to subscribed owners (no Alex — not subscribed)')
ok(morning.every(e => e.feed === false), 'summaries never write feed rows')
const evening = at(CLOSEOUT_MIN)
ok(byPrefix(evening, 'rundigest').length === 0 && byPrefix(evening, 'ledger').length === 0, 'evening window claims closeout only')

console.log('skip-if-zero (no noise)')
ok(at(LEDGER_MIN, { runsToday: 0, stopsToday: 0, dueByPerson: { Paul: 0, Chelsea: 0, Collin: 0 }, payByYmd: {} }).length === 0,
  'all-zero morning → nothing for anyone')
ok(at(CLOSEOUT_MIN, { stopsDoneToday: 0, tasksClosedToday: 0, shopDueCount: 0, payByYmd: {} }).length === 0,
  'all-zero closeout → nothing')
ok(byPrefix(at(CREW_DIGEST_MIN, { runsToday: 0, stopsToday: 0 }), 'rundigest').length === 1,
  'crew with due tasks but no runs still gets the digest')
ok(byPrefix(at(CREW_DIGEST_MIN, { dueByPerson: { Collin: 0 } }), 'rundigest').length === 1,
  'crew with runs but nothing due still gets the digest')

console.log('copy')
const ledger = byPrefix(morning, 'ledger').find(e => e.person === 'Paul')
ok(ledger.title === 'Morning Ledger', 'ledger title exact')
ok(ledger.body.includes('$4,120') && ledger.body.includes('3 payments'), 'ledger cites yesterday money: ' + ledger.body)
ok(ledger.body.includes('2 runs') && ledger.body.includes('9 stops') && ledger.body.includes('4 tasks due'), 'ledger cites the day shape')
const close = byPrefix(evening, 'closeout')[0]
ok(close.body.includes('$2,900') && close.body.includes('7 stops done') && close.body.includes('5 tasks closed') && close.body.includes('3 still due'),
  'closeout cites today: ' + close.body)
const run = byPrefix(morning, 'rundigest')[0]
ok(run.title === 'Today at the shop' && run.body.includes('first Holy Cross run') && run.body.includes('3 tasks due'),
  'crew digest copy: ' + run.body)
const clear = byPrefix(at(CLOSEOUT_MIN, { shopDueCount: 0 }), 'closeout')[0]
ok(clear.body.includes('board clear'), 'closeout empty-board copy')
ok(morning.concat(evening).every(e => !/[^\x00-\x7F’…—·]/.test(e.title + e.body)), 'no emojis in any copy')

console.log('clock helpers')
ok(toEtYmd('2026-07-25T03:30:00.000Z') === '2026-07-24', '11:30pm ET stays on the shop day (EDT)')
ok(toEtYmd('2026-01-25T03:30:00.000Z') === '2026-01-24', '10:30pm ET winter stays on the shop day (EST)')
const clk = shopClock(new Date('2026-07-24T10:45:00.000Z'))
ok(clk.ymd === '2026-07-24' && clk.minuteOfDay === 6 * 60 + 45, 'shopClock: 10:45Z = 6:45am ET in July')

console.log('send.js regression guards (text-level)')
const sender = readFileSync(new URL('../api/push/send.js', import.meta.url), 'utf8')
ok(sender.includes("rundigest: 'digest'") && sender.includes("ledger: 'ledger'") && sender.includes("closeout: 'closeout'"),
  'PREF_BY_PREFIX maps the three new kinds')
ok(!sender.includes('DIGEST_HOUR'), 'old any-time-after-7 digest gate removed')
ok(!sender.includes('dueTasksByPerson'), 'old digest task-title plumbing removed')
ok(sender.includes('buildScheduledEvents({'), 'sender calls the scheduled builder')
ok(sender.includes("from './_scheduled.js'"), 'sender imports the pure module')

if (failed) { console.error(`\n${failed} FAILED`); process.exit(1) }
console.log('\nall green')
