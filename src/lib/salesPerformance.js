// =============================================================================
// salesPerformance.js — the reads behind Reports › Sales performance
// =============================================================================
// SALES-PERF-1 (Paul 2026-11-13): "in depth analysis on sales made, leads we
// are tracking and then sales by employees. I want to see how much work each
// person is doing and their total sales, chasing leads, pipeline visible with
// all customers each employee is in contact with, last contact date and what
// the status of that lead is."
//
// READ-ONLY. Nothing is stored; every number is derived from what the office
// already writes:
//   who owns a sale / lead — orders.sales_rep (the name picked at intake).
//       Most older orders carry no name (prod 2026-11-13: 521 blank, 108
//       "Website"), so the fallback is the first staff member who worked the
//       order in the last year (first note, first payment taken) — shown as
//       ASSUMED, never mixed silently with the named ones.
//   a contact — a typed order activity line or an order note by a staff
//       member, an email sent on the order, a finished task on the order.
//       The automatic lines ("Payment recorded", "Attachment deleted",
//       "Customer viewed approval") are work, not contact, and are left out.
//   work — contacts logged + tasks finished (any task, order or not).
// Columns confirmed in information_schema 2026-11-13 (INCIDENT #6 rule).
// =============================================================================
import { supabase } from './supabase'
import { fetchAllPaged, STAFF_NAMES } from './stonebooksData'

const DAY = 86400000
// One person, several spellings on old rows.
const ALIASES = { cathy: 'Catherina', cath: 'Catherina' }
const NOT_PEOPLE = new Set(['website', 'customer', 'system', 'auto', 'stonebooks', 'claude'])
const STAFF_BY_FIRST = new Map(STAFF_NAMES.map(n => [n.toLowerCase(), n]))

// "Paul Vargas" / "paul" / "Cathy" → the roster name; a name the roster does
// not know stays as typed (a former employee still owns their sales); the
// website, the customer and automatic stamps are nobody.
export function staffName(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  const first = s.split(/[\s,]+/)[0].toLowerCase()
  if (NOT_PEOPLE.has(first)) return null
  if (ALIASES[first]) return ALIASES[first]
  if (STAFF_BY_FIRST.has(first)) return STAFF_BY_FIRST.get(first)
  return s.replace(/\b\w/g, c => c.toUpperCase()).slice(0, 40)
}

const SYSTEM_NOTE = /^(payment recorded|payment voided|payment edited|attachment deleted|attachment added|customer viewed|contract signed|status changed)/i
function touchKind(text) {
  const t = String(text || '').toLowerCase()
  if (/^lead status:/.test(t)) return 'Status'
  if (/\b(call|called|calling|vm|voicemail|voice mail|spoke|phone|rang)\b/.test(t)) return 'Call'
  if (/\b(text|texted|sms)\b/.test(t)) return 'Text'
  if (/\b(email|emailed|e-mail)\b/.test(t)) return 'Email'
  if (/\b(visit|came in|stopped by|in person|walked in)\b/.test(t)) return 'Visit'
  return 'Note'
}

const paged = (build) => fetchAllPaged(build).catch((e) => { console.warn('[sales-perf]', e?.message || e); return [] })

// One load for the page. `days` = how far back contact evidence is read.
export async function loadSalesActivity({ days = 365 } = {}) {
  const since = new Date(Date.now() - days * DAY).toISOString()
  const [extraRows, acts, notes, mails, tasks] = await Promise.all([
    paged(() => supabase.from('orders')
      .select('id, sales_rep, waiting_on, next_follow_up, lost_at, lost_reason, customer:customers(phone_primary)')
      .or('archived.is.null,archived.eq.false').order('created_at', { ascending: false })),
    paged(() => supabase.from('order_activity')
      .select('order_id, actor, note, created_at')
      .eq('type', 'activity').gte('created_at', since).order('created_at', { ascending: true })),
    paged(() => supabase.from('order_notes')
      .select('order_id, author, body, created_at')
      .gte('created_at', since).order('created_at', { ascending: true })),
    paged(() => supabase.from('messages')
      .select('order_id, subject, sent_at, created_at')
      .eq('direction', 'outbound').not('order_id', 'is', null)
      .gte('created_at', since).order('created_at', { ascending: true })),
    paged(() => supabase.from('shop_tasks')
      .select('order_id, title, task_type, done_by, done_at')
      .eq('status', 'done').is('deleted_at', null)
      .gte('done_at', since).order('done_at', { ascending: true })),
  ])

  const extras = new Map(extraRows.map(r => [r.id, r]))
  const touches = []        // { orderId, who, at, kind, text }
  const firstWorker = new Map()   // order id → the first staff member seen on it
  const seeWorker = (orderId, who) => { if (orderId && who && !firstWorker.has(orderId)) firstWorker.set(orderId, who) }

  for (const a of acts) {
    const who = staffName(a.actor)
    seeWorker(a.order_id, who)
    if (!who || !a.note || SYSTEM_NOTE.test(a.note)) continue
    touches.push({ orderId: a.order_id, who, at: a.created_at, kind: touchKind(a.note), text: a.note })
  }
  for (const n of notes) {
    const who = staffName(n.author)
    seeWorker(n.order_id, who)
    if (!who || !n.body) continue
    touches.push({ orderId: n.order_id, who, at: n.created_at, kind: touchKind(n.body), text: n.body })
  }
  for (const m of mails) {
    touches.push({ orderId: m.order_id, who: null, at: m.sent_at || m.created_at, kind: 'Email', text: m.subject || 'Email sent' })
  }
  const tasksDone = []
  for (const t of tasks) {
    const who = staffName(t.done_by)
    tasksDone.push({ orderId: t.order_id || null, who, at: t.done_at, title: t.title || 'Task', type: t.task_type || 'general' })
    if (t.order_id && who) touches.push({ orderId: t.order_id, who, at: t.done_at, kind: 'Task done', text: t.title || 'Task' })
  }
  touches.sort((a, b) => String(a.at).localeCompare(String(b.at)))
  return { extras, touches, tasksDone, firstWorker, days }
}
