// =============================================================================
// Collect balances (COLLECT-1, 2026-10-20) — the money sitting on finished
// and nearly-finished work.
// =============================================================================
// Paul: "collecting balances from stones that are on an assembly line or on an
// installation list, or a bronze that was delivered. THIS IS CRITICAL... I also
// want to see how much money is owed due to blasting queue and delivery queue
// that way we can target that number."
//
// Nothing new is written for the QUEUES — they are read off the truths that
// already run the shop: install_list membership, floor_line_items + the
// component's phase, and the bronze_received milestone. The only new truth is
// balance_collection_log (calls / emails / notes per order).
//
// TWO queues (Paul 2026-10-20, round 3: "delivery queue and install list
// should be the same, and blasting queue should also be the same — anything
// from bring up to blasting queue, I don't want the stages of the assembly
// line; bronze arrived should be in the delivery queue"):
//   delivery — on the install list, OR blasted (ready_to_set), OR a bronze
//              that arrived (bronze_received done) — not installed yet
//   blast    — on an assembly line, not blasted yet (ready_to_bring_up …
//              stencil_stuck); `detail` keeps the floor phase for the row
// Delivery first — that is the money closest to the door.
// =============================================================================
import { supabase } from './supabase'
import {
  getInstallList, getCurrentStaffName, logOrderActivity, fetchAllPaged,
  addShopTask, updateShopTask, listShopTasksForOrder, todayISO, fmtUSD, fmtDate,
} from './stonebooksData'
import { listFloorLines, lineLabel } from './floorLines'
import { phaseIndex } from './jobComponents'

// INSTALLED (Paul 2026-10-30: "orders that have been installed must be in bold
// in red so we can see we must get that money in, also the date and how many
// days it has been installed"): the work is DONE and the money is not in —
// the install milestone went done, the order is not closed, a balance owes.
// Sits above the delivery queue; `installedDate` = the milestone's status_date.
export const STAGES = [
  { code: 'installed', label: 'Installed, still owed', short: 'INSTALLED', rank: -1, tone: 'red', sub: 'work is done, money is not in' },
  { code: 'delivery', label: 'Delivery queue', short: 'DELIVERY QUEUE', rank: 0, tone: 'green', sub: 'install list · blasted · bronze arrived' },
  { code: 'blast',    label: 'Blasting queue', short: 'BLASTING QUEUE', rank: 1, tone: 'amber', sub: 'on a line, bring up through blasting' },
]
export const stageDef = (code) => STAGES.find(s => s.code === code) || null

const INSTALL_KEYS = ['installed', 'door_installed', 'work_completed']
const installMs = (ms) => (ms || []).find(m => INSTALL_KEYS.includes(m.milestone_key)) || null

// ── The queues ──────────────────────────────────────────────────────────────
// Returns Map(order_id → { stages: Set, stage (the top-priority one), line,
// phase, detail (why it is in the delivery queue / the floor phase), bronze,
// scheduledDate, installedDate, jobId }). Installed orders appear under the
// `installed` stage (the view drops the ones that are closed or paid).
export async function getCollectionQueues() {
  const out = new Map()
  const touch = (orderId) => {
    if (!orderId) return null
    if (!out.has(orderId)) out.set(orderId, { stages: new Set(), stage: null, line: null, phase: null, detail: null, bronze: false, scheduledDate: null, installedDate: null, jobId: null })
    return out.get(orderId)
  }

  const [setList, lines, bronzeMs, installedMs] = await Promise.all([
    getInstallList().catch(() => []),
    listFloorLines().catch(() => []),
    supabase.from('job_milestones').select('job_id').eq('milestone_key', 'bronze_received').eq('status', 'done')
      .then(r => r.data || []).catch(() => []),
    // Every job whose install/completion milestone went done — the view keeps
    // only the ones that still owe money and are not closed.
    fetchAllPaged(() => supabase.from('job_milestones').select('job_id, status_date').in('milestone_key', INSTALL_KEYS).eq('status', 'done'))
      .catch(() => []),
  ])

  // Jobs we need the order + install milestone for: set-list jobs, bronze jobs
  // and installed jobs. Closed/cancelled jobs are out of every queue, so they
  // are filtered at the query.
  const jobIds = [...new Set([
    ...(setList || []).map(r => r.job_id),
    ...(bronzeMs || []).map(r => r.job_id),
    ...(installedMs || []).map(r => r.job_id),
  ].filter(Boolean))]
  const jobs = new Map()
  for (let i = 0; i < jobIds.length; i += 150) {
    const { data, error } = await supabase.from('jobs')
      .select('id, order_id, job_type, overall_status, milestones:job_milestones(milestone_key, status, due_date, status_date)')
      .in('id', jobIds.slice(i, i + 150))
      .not('overall_status', 'in', '(closed,cancelled)')
    if (error) { console.warn('[collect] jobs:', error.message); continue }
    for (const j of (data || [])) jobs.set(j.id, j)
  }
  const installed = (j) => {
    const ms = installMs(j?.milestones)
    return ms?.status === 'done' || j?.overall_status === 'closed' || j?.overall_status === 'cancelled'
  }

  // 0. Installed and not closed — the money we are owed on finished work.
  for (const r of (installedMs || [])) {
    const j = jobs.get(r.job_id)
    if (!j || !j.order_id || j.overall_status === 'closed' || j.overall_status === 'cancelled') continue
    const e = touch(j.order_id)
    e.stages.add('installed'); if (!e.jobId) e.jobId = j.id
    const ms = installMs(j.milestones)
    const d = ms?.status_date || r.status_date || null
    if (d && (!e.installedDate || d < e.installedDate)) e.installedDate = d
    e.detail = e.detail || 'installed'
  }

  // 1. Install list — the delivery queue.
  for (const r of (setList || [])) {
    const j = jobs.get(r.job_id)
    if (!j || !j.order_id || installed(j)) continue
    const e = touch(j.order_id)
    e.stages.add('delivery'); e.jobId = j.id
    e.detail = e.detail || 'install list'
    const ms = installMs(j.milestones)
    if (ms?.status === 'in_progress' && ms.due_date) e.scheduledDate = ms.due_date
  }

  // 2. Bronze arrived — delivered to the shop, not set yet → delivery queue.
  for (const r of (bronzeMs || [])) {
    const j = jobs.get(r.job_id)
    if (!j || !j.order_id || installed(j)) continue
    const e = touch(j.order_id)
    e.stages.add('delivery'); e.bronze = true; if (!e.jobId) e.jobId = j.id
    e.detail = e.detail || 'bronze arrived'
  }

  // 3. Assembly lines — blasted = delivery queue; anything earlier = blasting queue.
  const blastedIdx = phaseIndex('new_stone', 'ready_to_set')
  for (const l of (lines || [])) {
    if (l.status === 'complete') continue
    for (const it of (l.items || [])) {
      const oid = it.order_id || it.component?.order_id
      const comp = it.component
      if (!oid || !comp) continue
      const idx = phaseIndex('new_stone', comp.current_phase)
      const e = touch(oid)
      e.line = e.line || lineLabel(l)
      e.phase = e.phase || comp.current_phase
      if (idx >= blastedIdx) { e.stages.add('delivery'); e.detail = e.detail || 'blasted' }
      else e.stages.add('blast')
    }
  }

  for (const e of out.values()) {
    e.stage = STAGES.find(s => e.stages.has(s.code))?.code || null
  }
  return out
}

// ── The log ─────────────────────────────────────────────────────────────────
export async function listCollectionLog(orderIds) {
  const ids = [...new Set((orderIds || []).filter(Boolean))]
  const out = new Map()
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase.from('balance_collection_log')
      .select('id, order_id, kind, note, amount, sent_to, actor, created_at, promised_for, task_id')
      .in('order_id', ids.slice(i, i + 150))
      .order('created_at', { ascending: false })
    if (error) { console.warn('[collect] log:', error.message); continue }
    for (const r of (data || [])) {
      if (!out.has(r.order_id)) out.set(r.order_id, [])
      out.get(r.order_id).push(r)
    }
  }
  return out
}

// A call, an email, a text, or a note. Calls/emails/texts move "last contacted
// for payment"; every kind lands in the order's activity feed too.
export async function addCollectionLog({ orderId, kind = 'note', note = '', amount = null, sentTo = null, promisedFor = null, taskId = null }) {
  if (!orderId) return { ok: false, error: 'Missing order' }
  const actor = await getCurrentStaffName().catch(() => null)
  const row = {
    order_id: orderId, kind, note: (note || '').trim() || null, amount: amount ?? null, sent_to: sentTo || null, actor: actor || null,
    promised_for: promisedFor || null, task_id: taskId || null,
  }
  const { data, error } = await supabase.from('balance_collection_log').insert(row).select().single()
  if (error) return { ok: false, error: error.message }
  const label = kind === 'call' ? 'Called about the balance' : kind === 'email' ? 'Balance request emailed' : kind === 'text' ? 'Texted about the balance'
    : kind === 'promise' ? `Promised to pay by ${promisedFor ? fmtDate(promisedFor) : 'a date'}` : 'Collection note'
  logOrderActivity(orderId, { type: 'change', field: 'Balance', newValue: kind, note: [label, sentTo ? `to ${sentTo}` : null, row.note].filter(Boolean).join(' — '), actor }).catch(() => {})
  return { ok: true, row: data }
}

// ── Promise to pay (COLLECT-2) ──────────────────────────────────────────────
// "They said they'd pay by the 24th." One log row with the date, and ONE open
// reminder task on the order due that day (details.auto = 'promise_to_pay') —
// a newer promise re-dates the same task instead of stacking a second one.
// The task lands in the Task Command Center / Today for whoever logged it
// (the shop's "I am" person), Admin department when nobody is picked.
export const PROMISE_AUTO = 'promise_to_pay'
export async function setPromiseToPay({ orderId, family, orderNumber, balance = 0, promisedFor, note = '' }) {
  if (!orderId) return { ok: false, error: 'Missing order' }
  if (!promisedFor) return { ok: false, error: 'Pick the date they promised.' }
  const staff = await getCurrentStaffName().catch(() => null)
  const title = `Promised balance due — ${family || 'order'}${orderNumber ? ` (${orderNumber})` : ''} · ${fmtUSD(balance)} promised by ${fmtDate(promisedFor)}`.slice(0, 300)
  const details = { auto: PROMISE_AUTO, amount: balance, promised_for: promisedFor, note: (note || '').trim() || null }
  const existing = (await listShopTasksForOrder(orderId).catch(() => []))
    .find(t => t.details?.auto === PROMISE_AUTO && t.status !== 'done')
  let taskId = existing?.id || null
  if (existing) {
    const r = await updateShopTask(existing.id, { title, dueDate: promisedFor, details })
    if (!r.ok) return r
  } else {
    const r = await addShopTask({
      title, assignee: staff || 'Admin', assigneeKind: staff ? 'person' : 'department',
      orderId, dueDate: promisedFor, createdBy: staff, taskedBy: staff, taskType: 'order', details,
    })
    if (!r.ok) return r
    taskId = r.task?.id || r.row?.id || null
  }
  return addCollectionLog({ orderId, kind: 'promise', note, amount: balance, promisedFor, taskId })
}

export const CONTACT_KINDS = new Set(['call', 'email', 'text'])
export const lastContactOf = (rows) => (rows || []).find(r => CONTACT_KINDS.has(r.kind)) || null
export const lastNoteOf = (rows) => (rows || []).find(r => r.kind === 'note' && r.note) || null
// The standing promise = the newest promise row (the balance still owing is
// what keeps it alive — a paid order leaves the list and the promise with it).
export const activePromiseOf = (rows) => (rows || []).find(r => r.kind === 'promise' && r.promised_for) || null
export const promiseMissed = (p, today = todayISO()) => !!p?.promised_for && p.promised_for < today
export const daysAgo = (iso, nowMs = Date.now()) => iso ? Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 86400000)) : null
