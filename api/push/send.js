// =============================================================================
// /api/push/send — Web Push sender for the /field phone app (FIELD-PUSH)
// =============================================================================
// One endpoint, three jobs:
//   GET  ?config=1                  → { publicKey } (VAPID public key; no auth)
//   POST { resubscribe: {...} }     → re-key a rotated subscription by its old
//                                     endpoint (called from sw.js; the old
//                                     endpoint IS the credential — unguessable)
//   GET/POST (anything else)        → the SWEEP: find notifiable task events,
//                                     claim each (person, event) in
//                                     push_send_log, send via Web Push.
//
// The sweep is stateless + idempotent: it looks back WINDOW_HOURS and relies on
// push_send_log's unique dedupe_key (claimed with an ignore-duplicates upsert
// BEFORE sending) so cron ticks and in-app instant pokes can overlap freely.
// What it notifies (copy doctrine: person-first, short, no CRM jargon):
//   • task assigned to you        "New task from Paul" / title — due Fri
//   • reply on your task          "Lonnie replied" / task — reply text
//   • morning digest (after 7am shop time, once per day)
//                                 "Due today — 3 tasks" / titles
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

const WINDOW_HOURS = 36            // event look-back; dedupe log is the real gate
const DIGEST_HOUR = 7              // shop-local hour the due-today digest unlocks
const MAX_SENDS_PER_PERSON = 8     // per run — absorbs first-deploy backlog floods
const LOG_KEEP_DAYS = 14

// Shop-local clock (America/New_York) — due-date math must match the phones.
function shopClock() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date())
  const get = (t) => (parts.find(p => p.type === t) || {}).value
  return { ymd: `${get('year')}-${get('month')}-${get('day')}`, hour: parseInt(get('hour'), 10) }
}

const trunc = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

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

export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY
  const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY
  const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY
  const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:shevcoteam@gmail.com'
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
  const { data: subs, error: subsErr } = await admin.from('push_subscriptions').select('*')
  if (subsErr) return res.status(500).json({ error: subsErr.message })
  if (!subs || !subs.length) return res.status(200).json({ ok: true, subs: 0, sent: 0 })

  const subsByPerson = {}
  for (const s of subs) (subsByPerson[s.person_name] = subsByPerson[s.person_name] || []).push(s)
  const subscribedPeople = Object.keys(subsByPerson)

  const { data: employees } = await admin.from('employees')
    .select('name, department, is_active').eq('is_active', true)
  const deptOf = {}
  const deptMembers = {}
  for (const e of (employees || [])) {
    deptOf[e.name] = e.department || null
    if (e.department) (deptMembers[e.department] = deptMembers[e.department] || []).push(e.name)
  }

  const { ymd: today, hour } = shopClock()
  const sinceIso = new Date(Date.now() - WINDOW_HOURS * 3600000).toISOString()

  // ── Gather notifiable events ───────────────────────────────────────────────
  const TASK_COLS = 'id, title, assignee, assignee_kind, tasked_by, created_by, status, due_date, snoozed_until, created_at, deleted_at'
  const [{ data: newTasks }, { data: newReplies }, { data: openTasks }] = await Promise.all([
    admin.from('shop_tasks').select(TASK_COLS)
      .gte('created_at', sinceIso).is('deleted_at', null).neq('status', 'done'),
    admin.from('shop_task_replies').select('id, task_id, author, body, created_at, handled_at')
      .gte('created_at', sinceIso).is('handled_at', null),
    admin.from('shop_tasks').select(TASK_COLS)
      .in('status', ['open', 'pending']).is('deleted_at', null),
  ])

  // Live due-count per subscribed person — mirrors the app's Tasks badge
  // (due today or overdue, snoozed-forward excluded).
  const dueByPerson = {}
  const dueTasksByPerson = {}
  for (const person of subscribedPeople) {
    const mine = (openTasks || []).filter(t =>
      isMine(t, person, deptOf) && t.due_date && String(t.due_date).slice(0, 10) <= today && !isSnoozed(t, today))
    dueByPerson[person] = mine.length
    dueTasksByPerson[person] = mine
  }

  const events = []   // { key, person, title, body, url, tag, at }
  for (const t of (newTasks || [])) {
    for (const person of taskAudience(t, deptMembers, t.tasked_by || t.created_by)) {
      if (!subsByPerson[person]) continue
      events.push({
        key: `assigned:${t.id}:${person}`,
        person,
        title: t.tasked_by ? `New task from ${t.tasked_by}` : 'New task',
        body: trunc(t.title, 110) + dueTag(t.due_date, today),
        url: `/field?task=${t.id}`,
        tag: `sb-task-${t.id}`,
        at: t.created_at,
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
      if (!subsByPerson[person]) continue
      events.push({
        key: `reply:${r.id}:${person}`,
        person,
        title: `${r.author || 'Someone'} replied`,
        body: `${trunc(t.title, 60)} — ${trunc(r.body, 90)}`,
        url: `/field?task=${t.id}`,
        tag: `sb-task-${t.id}`,
        at: r.created_at,
      })
    }
  }

  if (hour >= DIGEST_HOUR) {
    for (const person of subscribedPeople) {
      const n = dueByPerson[person] || 0
      if (!n) continue
      const titles = dueTasksByPerson[person].slice(0, 2).map(t => trunc(t.title, 40))
      const more = n - titles.length
      events.push({
        key: `digest:${person}:${today}`,
        person,
        title: `Due today — ${n} task${n === 1 ? '' : 's'}`,
        body: titles.join(' · ') + (more > 0 ? ` · and ${more} more` : ''),
        url: '/field',
        tag: 'sb-digest',
        at: new Date().toISOString(),
      })
    }
  }

  if (!events.length) return res.status(200).json({ ok: true, subs: subs.length, events: 0, sent: 0 })

  // ── Claim before send (the idempotency gate) ───────────────────────────────
  // ignore-duplicates upsert returns ONLY the rows this run actually inserted —
  // anything another sweep already claimed comes back absent and is skipped.
  const claimRows = events.map(e => ({ dedupe_key: e.key, person_name: e.person, title: e.title, body: e.body, url: e.url }))
  const { data: claimed, error: claimErr } = await admin.from('push_send_log')
    .upsert(claimRows, { onConflict: 'dedupe_key', ignoreDuplicates: true })
    .select('dedupe_key')
  if (claimErr) return res.status(500).json({ error: claimErr.message })
  const claimedKeys = new Set((claimed || []).map(r => r.dedupe_key))
  let toSend = events.filter(e => claimedKeys.has(e.key))

  // Per-person cap, newest first — a first-deploy backlog becomes a few fresh
  // pings, not thirty. (Capped-out events stay claimed: dropped, not deferred.)
  const byPerson = {}
  for (const e of toSend) (byPerson[e.person] = byPerson[e.person] || []).push(e)
  toSend = Object.values(byPerson).flatMap(list =>
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
    ok: true, subs: subs.length, events: events.length, claimed: claimedKeys.size,
    sent, failed, prunedSubs: deadEndpoints.size,
  })
}
