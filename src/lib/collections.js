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
// Stage codes, in PRIORITY order (installation first — Paul):
//   install  — on the hand-picked install list (set list)
//   ready    — blasted (ready_to_set) but not on the set list yet
//   blast    — in the Blasting Queue (stencil_stuck) on a line
//   bronze   — bronze arrived at the shop (bronze_received done, not installed)
//   line     — on an assembly line, earlier than the blasting queue
// =============================================================================
import { supabase } from './supabase'
import { getInstallList, getCurrentStaffName, logOrderActivity } from './stonebooksData'
import { listFloorLines, lineLabel } from './floorLines'
import { phaseIndex } from './jobComponents'

export const STAGES = [
  { code: 'install', label: 'Install list',    short: 'INSTALL LIST',   rank: 0, tone: 'green' },
  { code: 'ready',   label: 'Blasted · ready', short: 'BLASTED',        rank: 1, tone: 'green' },
  { code: 'blast',   label: 'Blasting queue',  short: 'BLASTING QUEUE', rank: 2, tone: 'amber' },
  { code: 'bronze',  label: 'Bronze arrived',  short: 'BRONZE ARRIVED', rank: 3, tone: 'blue' },
  { code: 'line',    label: 'On the line',     short: 'ON THE LINE',    rank: 4, tone: 'grey' },
]
export const stageDef = (code) => STAGES.find(s => s.code === code) || null

const INSTALL_KEYS = ['installed', 'door_installed', 'work_completed']
const installMs = (ms) => (ms || []).find(m => INSTALL_KEYS.includes(m.milestone_key)) || null

// ── The queues ──────────────────────────────────────────────────────────────
// Returns Map(order_id → { stages: Set, stage (the top-priority one), line,
// phase, scheduledDate, jobId }). Orders already installed never appear.
export async function getCollectionQueues() {
  const out = new Map()
  const touch = (orderId) => {
    if (!orderId) return null
    if (!out.has(orderId)) out.set(orderId, { stages: new Set(), stage: null, line: null, phase: null, scheduledDate: null, jobId: null })
    return out.get(orderId)
  }

  const [setList, lines, bronzeMs] = await Promise.all([
    getInstallList().catch(() => []),
    listFloorLines().catch(() => []),
    supabase.from('job_milestones').select('job_id').eq('milestone_key', 'bronze_received').eq('status', 'done')
      .then(r => r.data || []).catch(() => []),
  ])

  // Jobs we need the order + install milestone for: set-list jobs and bronze jobs.
  const jobIds = [...new Set([
    ...(setList || []).map(r => r.job_id),
    ...(bronzeMs || []).map(r => r.job_id),
  ].filter(Boolean))]
  const jobs = new Map()
  for (let i = 0; i < jobIds.length; i += 150) {
    const { data, error } = await supabase.from('jobs')
      .select('id, order_id, job_type, overall_status, milestones:job_milestones(milestone_key, status, due_date, status_date)')
      .in('id', jobIds.slice(i, i + 150))
    if (error) { console.warn('[collect] jobs:', error.message); continue }
    for (const j of (data || [])) jobs.set(j.id, j)
  }
  const installed = (j) => {
    const ms = installMs(j?.milestones)
    return ms?.status === 'done' || j?.overall_status === 'closed' || j?.overall_status === 'cancelled'
  }

  // 1. Install list — the delivery queue.
  for (const r of (setList || [])) {
    const j = jobs.get(r.job_id)
    if (!j || !j.order_id || installed(j)) continue
    const e = touch(j.order_id)
    e.stages.add('install'); e.jobId = j.id
    const ms = installMs(j.milestones)
    if (ms?.status === 'in_progress' && ms.due_date) e.scheduledDate = ms.due_date
  }

  // 2. Bronze arrived — delivered to the shop, not set yet.
  for (const r of (bronzeMs || [])) {
    const j = jobs.get(r.job_id)
    if (!j || !j.order_id || installed(j)) continue
    const e = touch(j.order_id)
    e.stages.add('bronze'); if (!e.jobId) e.jobId = j.id
  }

  // 3. Assembly lines — blasting queue vs. earlier on the line vs. blasted.
  const blastedIdx = phaseIndex('new_stone', 'ready_to_set')
  const queueIdx = phaseIndex('new_stone', 'stencil_stuck')
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
      if (idx >= blastedIdx) { if (!e.stages.has('install')) e.stages.add('ready') }
      else if (idx >= queueIdx) e.stages.add('blast')
      else e.stages.add('line')
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
      .select('id, order_id, kind, note, amount, sent_to, actor, created_at')
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
export async function addCollectionLog({ orderId, kind = 'note', note = '', amount = null, sentTo = null }) {
  if (!orderId) return { ok: false, error: 'Missing order' }
  const actor = await getCurrentStaffName().catch(() => null)
  const row = { order_id: orderId, kind, note: (note || '').trim() || null, amount: amount ?? null, sent_to: sentTo || null, actor: actor || null }
  const { data, error } = await supabase.from('balance_collection_log').insert(row).select().single()
  if (error) return { ok: false, error: error.message }
  const label = kind === 'call' ? 'Called about the balance' : kind === 'email' ? 'Balance request emailed' : kind === 'text' ? 'Texted about the balance' : 'Collection note'
  logOrderActivity(orderId, { type: 'change', field: 'Balance', newValue: kind, note: [label, sentTo ? `to ${sentTo}` : null, row.note].filter(Boolean).join(' — '), actor }).catch(() => {})
  return { ok: true, row: data }
}

export const CONTACT_KINDS = new Set(['call', 'email', 'text'])
export const lastContactOf = (rows) => (rows || []).find(r => CONTACT_KINDS.has(r.kind)) || null
export const lastNoteOf = (rows) => (rows || []).find(r => r.kind === 'note' && r.note) || null
export const daysAgo = (iso, nowMs = Date.now()) => iso ? Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 86400000)) : null
