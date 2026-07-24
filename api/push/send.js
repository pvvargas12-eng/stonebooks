// =============================================================================
// /api/push/send — Web Push sender for the /field phone app (FIELD-PUSH-UNIFY)
// =============================================================================
// One endpoint, three jobs:
//   GET  ?config=1                  → { publicKey } (VAPID public key; no auth)
//   POST { resubscribe: {...} }     → re-key a rotated subscription by its old
//                                     endpoint (called from sw.js; the old
//                                     endpoint IS the credential — unguessable)
//   GET/POST (anything else)        → the SWEEP: find notifiable events, claim
//                                     each (person, event) in push_send_log,
//                                     write the in-app notifications feed row,
//                                     send via Web Push.
//
// The sweep is stateless + idempotent: it looks back WINDOW_HOURS and relies on
// push_send_log's unique dedupe_key (claimed with an ignore-duplicates upsert
// BEFORE anything is written or sent) so cron ticks and in-app instant pokes
// can overlap freely. Every claimed event EXCEPT the digest also lands in the
// `notifications` table — the bell feed works even on phones that never grant
// push permission. What it notifies (copy doctrine: person-first, short, no
// CRM jargon, no emojis):
//   • task assigned to you        "New task from Paul" / title — due Fri
//   • reply on your task          "Lonnie replied" / task — reply text
//   • proof changes requested     "Changes requested" / KOWALSKI asked for
//     (owners only)               proof edits — E-26-0142.
//   • proof signed (owners only)  "Proof signed" / KOWALSKI signed — E-26-0142.
//   • payment landed              "Payment received" / $2,500.00 check —
//     (owners only)               KOWALSKI E-26-0142.
//   • crew run digest (6:45–11a shop time, once/day; push-only)
//                                 "Today at the shop" / runs + stops + due tasks
//   • Morning Ledger (owners, 7–11a, once/day; push-only)
//                                 "Morning Ledger" / yesterday $ + today's day
//   • Evening closeout (owners, 6–10p, once/day; push-only)
//                                 "Evening closeout" / $ in · stops done · tasks closed
// Every payload carries badgeCount = that person's live due-today+overdue
// count, so the home-screen badge tracks the in-app Tasks badge.
//
// Triggered by Vercel Cron (every 5 min, vercel.json) and by pokePushSender()
// fire-and-forgets after a task/reply write (near-instant delivery).
//
// Server-only env (Vercel): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// (mailto:...), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and optionally
// CRON_SECRET (same posture as /api/email/sync: if set, cron must present it
// as a Bearer token; a staff JWT is also accepted for the in-app pokes).
// =============================================================================
import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import {
  shopClock, toEtYmd, buildScheduledEvents,
  CREW_DIGEST_MIN, MORNING_CUTOFF_MIN, CLOSEOUT_MIN, CLOSEOUT_CUTOFF_MIN,
} from './_scheduled.js'

const WINDOW_HOURS = 36            // event look-back; dedupe log is the real gate
const MAX_SENDS_PER_PERSON = 8     // per run — absorbs first-deploy backlog floods
const LOG_KEEP_DAYS = 14

const trunc = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

const fmtUSD = (n) =>
  '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const famOf = (o) => String((o && o.primary_lastname) || '').trim().toUpperCase()
const ms = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : 0 }

function dueTag(dueDate, todayYmd) {
  if (!dueDate) return ''
  const due = String(dueDate).slice(0, 10)
  if (due < todayYmd) return ' — overdue'
  if (due === todayYmd) return ' — due today'
  const d = new Date(due + 'T12:00:00Z')
  if (isNaN(d.getTime())) return ''
  return ` — due ${d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}`
}

const isSnoozed = (t, todayYmd) => !!t.snoozed_until && String(t.snoozed_until).slice(0, 10) > todayYmd

// mine = named me, or my department — the MY-TASKS RULE the app uses.
function isMine(t, person, deptOf) {
  return (t.assignee_kind === 'person' && t.assignee === person) ||
    (t.assignee_kind === 'department' && deptOf[person] && t.assignee === deptOf[person])
}

// Who should hear about a task event: the named person, or everyone in the
// assigned department. Always minus `exclude` (the actor — no self-pings).
function taskAudience(task, deptMembers, exclude) {
  const out = task.assignee_kind === 'department'
    ? (deptMembers[task.assignee] || [])
    : (task.assignee ? [task.assignee] : [])
  return out.filter(n => n && n !== exclude)
}

// notifications.kind from the event's dedupe-key prefix.
const KIND_BY_PREFIX = {
  assigned: 'task_assigned', reply: 'task_reply',
  changes: 'proof_changes', signed: 'proof_signed', pay: 'payment',
}
const kindOf = (key) => KIND_BY_PREFIX[String(key).split(':')[0]] || 'note'

// Per-device mute map (FIELD-6): push_subscriptions.prefs[{prefKey}] === false
// mutes that kind's PUSHES on that device. Feed rows are untouched — the
// in-app bell always keeps everything.
const PREF_BY_PREFIX = {
  assigned: 'task_assigned', reply: 'task_reply', digest: 'digest',
  pay: 'payment', changes: 'proofs', signed: 'proofs',
  // FIELD-NOTIF-1: the crew run digest inherits the old 'digest' toggle (same
  // product slot); the owner summaries get their OWN keys — Paul muted 'digest'
  // back when it was the task list, and that mute must not silence the Ledger.
  rundigest: 'digest', ledger: 'ledger', closeout: 'closeout',
}
const prefKeyOf = (key) => PREF_BY_PREFIX[String(key).split(':')[0]] || null
const deviceMuted = (sub, eventKey) => {
  const pk = prefKeyOf(eventKey)
  return !!(pk && sub && sub.prefs && sub.prefs[pk] === false)
}

// Whole-handler guard: a config typo or runtime surprise must return a
// READABLE JSON error, never a bare FUNCTION_INVOCATION_FAILED (2026-07-20:
// the first configured run crashed opaque and cost a debugging round-trip).
export default async function handler(req, res) {
  try {
    return await sendHandler(req, res)
  } catch (e) {
    console.error('[push/send] crashed:', e)
    return res.status(500).json({
      error: 'sender_crashed',
      detail: e?.message || String(e),
      at: (e?.stack || '').split('\n')[1]?.trim() || null,
    })
  }
}

// Env values arrive from a dashboard paste — strip whitespace and stray
// quotes before they reach crypto that throws on malformed input.
const cleanEnv = (s) => String(s || '').trim().replace(/^["']+|["']+$/g, '')

async function sendHandler(req, res) {
  const SUPABASE_URL = cleanEnv(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
  const SERVICE_ROLE = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY)
  const VAPID_PUBLIC = cleanEnv(process.env.VAPID_PUBLIC_KEY)
  const VAPID_PRIVATE = cleanEnv(process.env.VAPID_PRIVATE_KEY)
  const VAPID_SUBJECT = cleanEnv(process.env.VAPID_SUBJECT) || 'mailto:shevcoteam@gmail.com'
  const CRON_SECRET = process.env.CRON_SECRET

  // ── Config fetch (public by definition — it's the VAPID *public* key) ──────
  if (req.query && String(req.query.config || '') === '1') {
    if (!VAPID_PUBLIC) return res.status(500).json({ error: 'push_not_configured' })
    return res.status(200).json({ publicKey: VAPID_PUBLIC })
  }

  if (!SUPABASE_URL || !SERVICE_ROLE) return res.status(500).json({ error: 'server_not_configured' })
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

  // ── Subscription re-key from sw.js pushsubscriptionchange ──────────────────
  // No bearer available inside a service worker; the old endpoint (a long
  // random push-service URL) is the credential. Can only touch a row that
  // already exists — never creates one.
  const resub = req.method === 'POST' && req.body && typeof req.body === 'object' ? req.body.resubscribe : null
  if (resub) {
    const oldEndpoint = resub.oldEndpoint || null
    const sub = resub.subscription || {}
    if (!oldEndpoint || !sub.endpoint || !sub.keys) return res.status(400).json({ error: 'bad_resubscribe' })
    const { error } = await admin.from('push_subscriptions')
      .update({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, last_seen_at: new Date().toISOString() })
      .eq('endpoint', oldEndpoint)
    // New endpoint already has its own row → the old one is simply dead.
    if (error && error.code === '23505') await admin.from('push_subscriptions').delete().eq('endpoint', oldEndpoint)
    return res.status(200).json({ ok: true })
  }

  // ── Auth for the sweep: Vercel Cron (CRON_SECRET bearer, if set) OR staff ──
  const authHeader = req.headers.authorization || ''
  const bearer = authHeader.replace(/^Bearer\s+/i, '')
  let authorized = false
  if (CRON_SECRET && bearer === CRON_SECRET) authorized = true
  if (!authorized && bearer) {
    const { data: caller } = await admin.auth.getUser(bearer)
    if (caller && caller.user) {
      const { data: partner } = await admin.from('partner_users').select('id').eq('auth_user_id', caller.user.id).maybeSingle()
      authorized = !partner
    }
  }
  // No CRON_SECRET configured → allow (Vercel cron is the only scheduled
  // caller). Set CRON_SECRET to lock the endpoint down. Same as email/sync.
  if (!authorized && CRON_SECRET) return res.status(401).json({ error: 'not_authorized' })

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return res.status(500).json({ error: 'push_not_configured' })
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

  // ── Load the audience ──────────────────────────────────────────────────────
  // Subscriptions decide who gets a PUSH; the roster decides who gets a FEED
  // row — a phone with the ask still pending keeps a working bell.
  const { data: subs, error: subsErr } = await admin.from('push_subscriptions').select('*')
  if (subsErr) return res.status(500).json({ error: subsErr.message })

  const subsByPerson = {}
  for (const s of (subs || [])) (subsByPerson[s.person_name] = subsByPerson[s.person_name] || []).push(s)
  const subscribedPeople = Object.keys(subsByPerson)

  const { data: employees } = await admin.from('employees')
    .select('name, department, is_owner, is_active').eq('is_active', true)
  const deptOf = {}
  const deptMembers = {}
  const ownerNames = []
  for (const e of (employees || [])) {
    deptOf[e.name] = e.department || null
    if (e.department) (deptMembers[e.department] = deptMembers[e.department] || []).push(e.name)
    if (e.is_owner) ownerNames.push(e.name)
  }

  const { ymd: today, minuteOfDay } = shopClock()
  const yesterday = toEtYmd(new Date(Date.now() - 24 * 3600000).toISOString())
  const sinceIso = new Date(Date.now() - WINDOW_HOURS * 3600000).toISOString()
  const sinceMs = ms(sinceIso)

  // ── Gather notifiable events ───────────────────────────────────────────────
  const TASK_COLS = 'id, title, assignee, assignee_kind, tasked_by, created_by, status, due_date, snoozed_until, created_at, deleted_at'
  const [{ data: newTasks }, { data: newReplies }, { data: openTasks }, { data: apprLinks }, { data: payOrders }] = await Promise.all([
    admin.from('shop_tasks').select(TASK_COLS)
      .gte('created_at', sinceIso).is('deleted_at', null).neq('status', 'done'),
    admin.from('shop_task_replies').select('id, task_id, author, body, created_at, handled_at')
      .gte('created_at', sinceIso).is('handled_at', null),
    admin.from('shop_tasks').select(TASK_COLS)
      .in('status', ['open', 'pending']).is('deleted_at', null),
    admin.from('approval_links')
      .select('id, order_id, changes_requested_at, signed_at, order:orders(order_number, primary_lastname)')
      .or(`changes_requested_at.gte.${sinceIso},signed_at.gte.${sinceIso}`),
    admin.from('orders')
      .select('id, order_number, primary_lastname, payments, updated_at')
      .gte('updated_at', sinceIso).neq('payments', '[]'),
  ])

  // Live due-count per subscribed person — mirrors the app's Tasks badge
  // (due today or overdue, snoozed-forward excluded). Push payloads only.
  const dueByPerson = {}
  for (const person of subscribedPeople) {
    dueByPerson[person] = (openTasks || []).filter(t =>
      isMine(t, person, deptOf) && t.due_date && String(t.due_date).slice(0, 10) <= today && !isSnoozed(t, today)).length
  }

  // ── Day-shape data for the scheduled summaries (FIELD-NOTIF-1) ─────────────
  // Fetched ONLY inside the morning/evening claim windows so the every-5-min
  // sweep stays two queries lighter the rest of the day.
  const needDay = minuteOfDay >= CREW_DIGEST_MIN && minuteOfDay < MORNING_CUTOFF_MIN
  const needClose = minuteOfDay >= CLOSEOUT_MIN && minuteOfDay < CLOSEOUT_CUTOFF_MIN
  let runsToday = 0, stopsToday = 0, firstRunTitle = '', stopsDoneToday = 0, tasksClosedToday = 0, shopDueCount = 0
  if (needDay || needClose) {
    const { data: batches } = await admin.from('work_batches')
      .select('id, title, scheduled_date, created_at')
      .eq('scheduled_date', today).order('created_at', { ascending: true })
    runsToday = (batches || []).length
    firstRunTitle = trunc(((batches || [])[0] || {}).title || '', 28)
    const batchIds = (batches || []).map(b => b.id)
    if (batchIds.length) {
      const { data: stops } = await admin.from('work_batch_jobs')
        .select('id, batch_id, completed_at').in('batch_id', batchIds)
      stopsToday = (stops || []).length
      stopsDoneToday = (stops || []).filter(s => s.completed_at && toEtYmd(s.completed_at) === today).length
    }
    if (needClose) {
      const { data: closedTasks } = await admin.from('shop_tasks')
        .select('id, done_at')
        .gte('done_at', new Date(Date.now() - 24 * 3600000).toISOString()).is('deleted_at', null)
      tasksClosedToday = (closedTasks || []).filter(t => toEtYmd(t.done_at) === today).length
    }
    shopDueCount = (openTasks || []).filter(t =>
      t.due_date && String(t.due_date).slice(0, 10) <= today && !isSnoozed(t, today)).length
  }

  const events = []   // { key, person, title, body, url, tag, at, feed }
  for (const t of (newTasks || [])) {
    for (const person of taskAudience(t, deptMembers, t.tasked_by || t.created_by)) {
      events.push({
        key: `assigned:${t.id}:${person}`,
        person,
        title: t.tasked_by ? `New task from ${t.tasked_by}` : 'New task',
        body: trunc(t.title, 110) + dueTag(t.due_date, today),
        url: `/field?task=${t.id}`,
        tag: `sb-task-${t.id}`,
        at: t.created_at,
        feed: true,
      })
    }
  }

  const replyTaskIds = [...new Set((newReplies || []).map(r => r.task_id))]
  let replyTasks = {}
  if (replyTaskIds.length) {
    const { data: rt } = await admin.from('shop_tasks').select(TASK_COLS).in('id', replyTaskIds)
    for (const t of (rt || [])) replyTasks[t.id] = t
  }
  for (const r of (newReplies || [])) {
    const t = replyTasks[r.task_id]
    if (!t || t.deleted_at) continue
    // A reply pings both sides of the task — assignee side plus whoever
    // assigned it — minus the author. (Same routing the Today inbox uses.)
    const audience = new Set(taskAudience(t, deptMembers, r.author))
    if (t.tasked_by && t.tasked_by !== r.author) audience.add(t.tasked_by)
    else if (t.created_by && t.created_by !== r.author) audience.add(t.created_by)
    for (const person of audience) {
      events.push({
        key: `reply:${r.id}:${person}`,
        person,
        title: `${r.author || 'Someone'} replied`,
        body: `${trunc(t.title, 60)} — ${trunc(r.body, 90)}`,
        url: `/field?task=${t.id}`,
        tag: `sb-task-${t.id}`,
        at: r.created_at,
        feed: true,
      })
    }
  }

  // Owner money/approval events (FIELD-3 rulebook). Audience = every owner —
  // the sender SQL is the enforcement point for "owner devices only".
  for (const l of (apprLinks || [])) {
    if (!l.order_id || !ownerNames.length) continue
    const fam = famOf(l.order) || 'The family'
    const num = (l.order && l.order.order_number) || ''
    if (l.changes_requested_at && ms(l.changes_requested_at) >= sinceMs) {
      for (const person of ownerNames) {
        events.push({
          key: `changes:${l.id}:${ms(l.changes_requested_at)}:${person}`,
          person,
          title: 'Changes requested',
          body: trunc(`${fam} asked for proof edits${num ? ` — ${num}` : ''}.`, 120),
          url: `/field?order=${l.order_id}`,
          tag: `sb-appr-${l.id}`,
          at: l.changes_requested_at,
          feed: true,
        })
      }
    }
    if (l.signed_at && ms(l.signed_at) >= sinceMs) {
      for (const person of ownerNames) {
        events.push({
          key: `signed:${l.id}:${person}`,
          person,
          title: 'Proof signed',
          body: trunc(`${fam} signed${num ? ` — ${num}` : ''}.`, 120),
          url: `/field?order=${l.order_id}`,
          tag: `sb-appr-${l.id}`,
          at: l.signed_at,
          feed: true,
        })
      }
    }
  }

  const payByYmd = {}   // ET shop-day → { sum, count } — feeds Ledger + closeout
  for (const o of (payOrders || [])) {
    const pays = Array.isArray(o.payments) ? o.payments : []
    for (const p of pays) {
      if (!p || p.voided || !(p.locked ?? true)) continue
      const pYmd = toEtYmd(p.createdAt)
      if (pYmd === today || pYmd === yesterday) {
        const slot = (payByYmd[pYmd] = payByYmd[pYmd] || { sum: 0, count: 0 })
        slot.sum += Number(p.amount) || 0
        slot.count++
      }
      const at = ms(p.createdAt)
      if (!(at >= sinceMs)) continue
      const fam = famOf(o) || 'The family'
      const num = o.order_number || ''
      const method = String(p.method || '').trim()
      for (const person of ownerNames) {
        events.push({
          key: `pay:${o.id}:${p.id || at}:${person}`,
          person,
          title: 'Payment received',
          body: trunc(`${fmtUSD(p.amount)}${method ? ` ${method}` : ''} — ${fam}${num ? ` ${num}` : ''}.`, 120),
          url: `/field?order=${o.id}`,
          tag: `sb-pay-${o.id}`,
          at: p.createdAt,
          feed: true,
        })
      }
    }
  }

  // Scheduled summaries (FIELD-NOTIF-1): crew run digest 6:45, owner Morning
  // Ledger 7:00, owner closeout 6:00p — morning/evening claim windows only, so
  // no afternoon "due today" pings; push-only (the feed keeps discrete events);
  // once per person per day via the date-suffixed keys.
  events.push(...buildScheduledEvents({
    minuteOfDay, today, yesterday, nowIso: new Date().toISOString(),
    subscribedPeople, ownerNames, dueByPerson,
    runsToday, stopsToday, firstRunTitle,
    stopsDoneToday, tasksClosedToday, shopDueCount, payByYmd,
  }))

  if (!events.length) {
    return res.status(200).json({ ok: true, subs: (subs || []).length, events: 0, wrote: 0, sent: 0 })
  }

  // ── Claim before anything (the idempotency gate) ───────────────────────────
  // ignore-duplicates upsert returns ONLY the rows this run actually inserted —
  // anything another sweep already claimed comes back absent and is skipped,
  // for the feed write AND the push.
  const claimRows = events.map(e => ({ dedupe_key: e.key, person_name: e.person, title: e.title, body: e.body, url: e.url }))
  const { data: claimed, error: claimErr } = await admin.from('push_send_log')
    .upsert(claimRows, { onConflict: 'dedupe_key', ignoreDuplicates: true })
    .select('dedupe_key')
  if (claimErr) return res.status(500).json({ error: claimErr.message })
  const claimedKeys = new Set((claimed || []).map(r => r.dedupe_key))
  const claimedEvents = events.filter(e => claimedKeys.has(e.key))

  // ── Feed rows — the bell reads these; written for every claimed event
  //    whether or not the person's phone can receive a push ─────────────────
  let wrote = 0
  const feedRows = claimedEvents.filter(e => e.feed).map(e => ({
    employee_name: e.person,
    kind: kindOf(e.key),
    title: e.title,
    body: e.body,
    deep_link: e.url,
  }))
  if (feedRows.length) {
    const { error: feedErr } = await admin.from('notifications').insert(feedRows)
    if (feedErr) console.warn('[push/send] feed insert:', feedErr.message)
    else wrote = feedRows.length
  }

  // Per-person cap, newest first — a first-deploy backlog becomes a few fresh
  // pings, not thirty. (Capped-out events stay claimed: dropped, not deferred —
  // their feed rows above are the durable record.)
  const byPerson = {}
  for (const e of claimedEvents) {
    if (!subsByPerson[e.person]) continue
    ;(byPerson[e.person] = byPerson[e.person] || []).push(e)
  }
  const toSend = Object.values(byPerson).flatMap(list =>
    list.sort((a, z) => String(z.at).localeCompare(String(a.at))).slice(0, MAX_SENDS_PER_PERSON))

  // ── Send ───────────────────────────────────────────────────────────────────
  let sent = 0, failed = 0
  const deadEndpoints = new Set()
  await Promise.all(toSend.map(async (e) => {
    const payload = JSON.stringify({
      title: e.title, body: e.body, url: e.url, tag: e.tag,
      badgeCount: dueByPerson[e.person] || 0,
    })
    for (const s of (subsByPerson[e.person] || [])) {
      if (deviceMuted(s, e.key)) continue
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: s.keys || {} },
          payload,
          { TTL: 24 * 3600 },
        )
        sent++
      } catch (err) {
        const code = err && err.statusCode
        if (code === 404 || code === 410) deadEndpoints.add(s.endpoint)   // phone unsubscribed/expired
        else { failed++; console.warn('[push/send]', code || '', err && err.message) }
      }
    }
  }))

  // ── Hygiene: dead endpoints out, old log rows out ──────────────────────────
  if (deadEndpoints.size) {
    await admin.from('push_subscriptions').delete().in('endpoint', [...deadEndpoints])
  }
  const pruneBefore = new Date(Date.now() - LOG_KEEP_DAYS * 86400000).toISOString()
  await admin.from('push_send_log').delete().lt('sent_at', pruneBefore)

  return res.status(200).json({
    ok: true, subs: (subs || []).length, events: events.length, claimed: claimedKeys.size,
    wrote, sent, failed, prunedSubs: deadEndpoints.size,
  })
}
