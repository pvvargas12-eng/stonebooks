// =============================================================================
// /api/push/send — Vercel Node serverless function (FIELD-3 push sender)
// =============================================================================
// Cron-driven notification fan-out. Reads a cursor from push_state ('sender'),
// scans four sources for anything created/stamped after it, writes
// `notifications` rows per recipient, and fires Web Push at each recipient's
// push_subscriptions. Sources:
//   (a) shop_tasks           -> task_assigned  (assignee; departments fan out)
//   (b) shop_task_replies    -> task_reply     (assignee + tasked_by, never author)
//   (c) approval_links       -> proof_changes / proof_signed (owners only)
//   (d) orders.payments[]    -> payment        (owners only, locked non-voided)
//
// If the VAPID env is missing we STILL write the notifications rows (the
// in-app bell keeps working) and skip the webpush sends, returning
// { sent: 0, wrote: N, reason: 'vapid-missing' }.
//
// Copy rulebook: title noun-verb <=4 words; body = family + what happens
// next; NO emojis; deep_link '/task/{id}' or '/order/{orderId}'.
//
// Server-only env (Vercel): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, and optionally
// CRON_SECRET (same gate as api/email/sync.js).
import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

const fmtUSD = (n) =>
  '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const famOf = (o) => String(o?.primary_lastname || '').trim().toUpperCase()
const firstName = (s) => String(s || '').trim().split(/\s+/)[0] || ''
const ms = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : 0 }
const clip = (s, n = 140) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY
  const CRON_SECRET = process.env.CRON_SECRET
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return res.status(500).json({ error: 'server_not_configured' })
  }

  // Auth: Vercel Cron (CRON_SECRET bearer, if set) OR an authenticated staff
  // user — mirrored exactly from api/email/sync.js. If no CRON_SECRET is
  // configured, unauthenticated cron calls are allowed.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
  const authHeader = req.headers.authorization || ''
  const bearer = authHeader.replace(/^Bearer\s+/i, '')
  let authorized = false
  if (CRON_SECRET && bearer === CRON_SECRET) authorized = true
  if (!authorized && bearer) {
    const { data: caller } = await admin.auth.getUser(bearer)
    if (caller?.user) {
      const { data: partner } = await admin.from('partner_users').select('id').eq('auth_user_id', caller.user.id).maybeSingle()
      authorized = !partner
    }
  }
  if (!authorized && CRON_SECRET) return res.status(401).json({ error: 'not_authorized' })

  // VAPID — sends are skipped (not the writes) when unset.
  const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY
  const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY
  const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:shevcoteam@gmail.com'
  let vapidOk = false
  if (VAPID_PUBLIC && VAPID_PRIVATE) {
    try { webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE); vapidOk = true }
    catch (e) { console.warn('[push/send] vapid config failed:', e?.message) }
  }

  // ── Cursor — value.last ISO; first run looks back 15 minutes ──────────────
  let cursorIso = null
  try {
    const { data } = await admin.from('push_state').select('value').eq('key', 'sender').maybeSingle()
    cursorIso = data?.value?.last || null
  } catch (e) { console.warn('[push/send] cursor read:', e?.message) }
  if (!cursorIso) cursorIso = new Date(Date.now() - 15 * 60000).toISOString()
  const cursorMs = ms(cursorIso)
  let maxSeenMs = cursorMs
  const seen = (iso) => { const t = ms(iso); if (t > maxSeenMs) maxSeenMs = t }

  // ── Roster — department fan-out + the owner audience ──────────────────────
  let activeEmployees = []
  try {
    const { data, error } = await admin.from('employees').select('name, department, is_owner, is_active')
    if (error) throw error
    activeEmployees = (data || []).filter(e => e.is_active && e.name)
  } catch (e) { console.warn('[push/send] employees:', e?.message) }
  const ownerNames = activeEmployees.filter(e => e.is_owner).map(e => e.name)
  const deptNames = (dept) =>
    activeEmployees.filter(e => e.department === dept).map(e => e.name)

  const events = []   // { names: [..], kind, title, body, deep_link, tag }
  const errors = []

  // (a) shop_tasks — task_assigned. Direct assignee, or the department's
  // active people. The actor never gets pinged about their own task.
  try {
    const { data, error } = await admin.from('shop_tasks')
      .select('id, title, assignee, assignee_kind, tasked_by, created_by, created_at, order:orders(order_number, primary_lastname)')
      .gt('created_at', cursorIso)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(500)
    if (error) throw error
    for (const t of (data || [])) {
      try {
        seen(t.created_at)
        const actor = t.tasked_by || t.created_by || null
        let names = t.assignee_kind === 'department'
          ? deptNames(t.assignee)
          : (t.assignee ? [t.assignee] : [])
        names = [...new Set(names)].filter(n => n && n !== actor)
        if (!names.length) continue
        const fam = famOf(t.order)
        const num = t.order?.order_number || ''
        events.push({
          names,
          kind: 'task_assigned',
          title: actor ? clip(`New task from ${firstName(actor)}`, 40) : 'New task',
          body: clip(`${t.title}${fam ? ` — ${fam}${num ? ` ${num}` : ''}.` : ''}`),
          deep_link: `/task/${t.id}`,
          tag: `task-${t.id}`,
        })
      } catch (e) { errors.push(`task ${t?.id}: ${e?.message || e}`) }
    }
  } catch (e) { errors.push(`tasks: ${e?.message || e}`) }

  // (b) shop_task_replies — task_reply to the task's assignee + tasked_by,
  // never the reply author.
  try {
    const { data, error } = await admin.from('shop_task_replies')
      .select('id, task_id, body, author, created_at, task:shop_tasks(id, title, assignee, assignee_kind, tasked_by, created_by, deleted_at)')
      .gt('created_at', cursorIso)
      .order('created_at', { ascending: true })
      .limit(500)
    if (error) throw error
    for (const r of (data || [])) {
      try {
        seen(r.created_at)
        const t = r.task
        if (!t || t.deleted_at) continue
        let names = t.assignee_kind === 'department'
          ? deptNames(t.assignee)
          : (t.assignee ? [t.assignee] : [])
        if (t.tasked_by) names.push(t.tasked_by)
        names = [...new Set(names)].filter(n => n && n !== r.author)
        if (!names.length) continue
        events.push({
          names,
          kind: 'task_reply',
          title: r.author ? clip(`${firstName(r.author)} replied`, 40) : 'New reply',
          body: clip(`${t.title}: ${r.body || ''}`),
          deep_link: `/task/${t.id}`,
          tag: `task-${t.id}-reply`,
        })
      } catch (e) { errors.push(`reply ${r?.id}: ${e?.message || e}`) }
    }
  } catch (e) { errors.push(`replies: ${e?.message || e}`) }

  // (c) approval_links — proof_changes / proof_signed, owner names only.
  try {
    const { data, error } = await admin.from('approval_links')
      .select('id, order_id, changes_requested_at, signed_at, order:orders(order_number, primary_lastname)')
      .or(`changes_requested_at.gt.${cursorIso},signed_at.gt.${cursorIso}`)
      .limit(500)
    if (error) throw error
    for (const l of (data || [])) {
      try {
        const fam = famOf(l.order) || 'The family'
        const num = l.order?.order_number || ''
        if (l.changes_requested_at && ms(l.changes_requested_at) > cursorMs) {
          seen(l.changes_requested_at)
          if (ownerNames.length && l.order_id) {
            events.push({
              names: [...ownerNames],
              kind: 'proof_changes',
              title: 'Changes requested',
              body: clip(`${fam} asked for proof edits${num ? ` — ${num}` : ''}.`),
              deep_link: `/order/${l.order_id}`,
              tag: `approval-${l.id}-changes`,
            })
          }
        }
        if (l.signed_at && ms(l.signed_at) > cursorMs) {
          seen(l.signed_at)
          if (ownerNames.length && l.order_id) {
            events.push({
              names: [...ownerNames],
              kind: 'proof_signed',
              title: 'Proof signed',
              body: clip(`${fam} signed${num ? ` — ${num}` : ''}.`),
              deep_link: `/order/${l.order_id}`,
              tag: `approval-${l.id}-signed`,
            })
          }
        }
      } catch (e) { errors.push(`approval ${l?.id}: ${e?.message || e}`) }
    }
  } catch (e) { errors.push(`approvals: ${e?.message || e}`) }

  // (d) payments — orders touched after the cursor, diffed down to payment
  // entries stamped after it. Locked non-voided only; owner names only.
  // Balance intentionally omitted from the body (keep it one clean line).
  try {
    const { data, error } = await admin.from('orders')
      .select('id, order_number, primary_lastname, payments, updated_at')
      .gt('updated_at', cursorIso)
      .neq('payments', '[]')
      .order('updated_at', { ascending: true })
      .limit(1000)
    if (error) throw error
    for (const o of (data || [])) {
      try {
        seen(o.updated_at)
        const pays = Array.isArray(o.payments) ? o.payments : []
        for (const p of pays) {
          if (!p || p.voided || !(p.locked ?? true)) continue
          if (!(ms(p.createdAt) > cursorMs)) continue
          seen(p.createdAt)
          if (!ownerNames.length) continue
          const fam = famOf(o) || 'The family'
          const num = o.order_number || ''
          const method = String(p.method || '').trim()
          events.push({
            names: [...ownerNames],
            kind: 'payment',
            title: 'Payment received',
            body: clip(`${fmtUSD(p.amount)}${method ? ` ${method}` : ''} — ${fam}${num ? ` ${num}` : ''}.`),
            deep_link: `/order/${o.id}`,
            tag: `order-${o.id}-pay-${p.id || ms(p.createdAt)}`,
          })
        }
      } catch (e) { errors.push(`payments ${o?.id}: ${e?.message || e}`) }
    }
  } catch (e) { errors.push(`payments: ${e?.message || e}`) }

  // ── Write notifications rows (per-event try/catch) ────────────────────────
  let wrote = 0
  const perPerson = new Map()   // name -> [event, ...] (only successfully written)
  for (const ev of events) {
    try {
      const rows = ev.names.map(name => ({
        employee_name: name,
        kind: ev.kind,
        title: ev.title,
        body: ev.body,
        deep_link: ev.deep_link,
      }))
      const { error } = await admin.from('notifications').insert(rows)
      if (error) { errors.push(`insert ${ev.tag}: ${error.message}`); continue }
      wrote += rows.length
      for (const name of ev.names) {
        if (!perPerson.has(name)) perPerson.set(name, [])
        perPerson.get(name).push(ev)
      }
    } catch (e) { errors.push(`insert ${ev.tag}: ${e?.message || e}`) }
  }

  // ── Advance the cursor to the max timestamp seen (never now()) ────────────
  // Persisted BEFORE the sends so a slow/hung push can't replay this window
  // into duplicate notification rows on the next run.
  const newCursor = new Date(maxSeenMs).toISOString()
  try {
    await admin.from('push_state').upsert(
      { key: 'sender', value: { last: newCursor }, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    )
  } catch (e) { errors.push(`cursor: ${e?.message || e}`) }

  // ── Web Push fan-out (per-send try/catch; 404/410 prunes the sub) ─────────
  let sent = 0
  let dropped = 0
  if (vapidOk && perPerson.size > 0) {
    let subs = []
    try {
      const { data, error } = await admin.from('push_subscriptions')
        .select('id, employee_name, endpoint, p256dh, auth')
        .in('employee_name', [...perPerson.keys()])
      if (error) throw error
      subs = data || []
    } catch (e) { errors.push(`subs: ${e?.message || e}`) }

    const subsByName = new Map()
    for (const s of subs) {
      if (!subsByName.has(s.employee_name)) subsByName.set(s.employee_name, [])
      subsByName.get(s.employee_name).push(s)
    }

    for (const [name, evs] of perPerson) {
      const mySubs = subsByName.get(name) || []
      if (!mySubs.length) continue

      // One cheap unread count per person — rides into every payload as the
      // app-icon badge number.
      let badge = 0
      try {
        const { count } = await admin.from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('employee_name', name)
          .is('read_at', null)
        badge = count || 0
      } catch (e) { console.warn('[push/send] badge count:', e?.message) }

      for (const ev of evs) {
        const payload = JSON.stringify({
          title: ev.title, body: ev.body, tag: ev.tag, deep_link: ev.deep_link, badge,
        })
        for (const s of mySubs) {
          if (s._dead) continue
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              payload,
              { TTL: 3600, timeout: 8000 },
            )
            sent++
          } catch (e) {
            const code = e?.statusCode
            if (code === 404 || code === 410) {
              // The push service says this device is gone — prune the row.
              s._dead = true
              dropped++
              try { await admin.from('push_subscriptions').delete().eq('id', s.id) }
              catch (delErr) { errors.push(`prune ${s.id}: ${delErr?.message || delErr}`) }
            } else {
              errors.push(`send ${name}: ${code || ''} ${e?.message || e}`.trim())
            }
          }
        }
      }
    }
  }

  const out = { ok: true, wrote, sent, events: events.length, cursor: newCursor }
  if (!vapidOk) { out.reason = 'vapid-missing'; out.sent = 0 }
  if (dropped) out.dropped = dropped
  if (errors.length) out.errors = errors.slice(0, 12)
  return res.status(200).json(out)
}
