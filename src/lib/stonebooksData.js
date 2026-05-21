// =============================================================================
// Stonebooks — Data layer
// =============================================================================
// All Supabase queries + row-level helpers used by Stonebooks tabs.
// Keep dumb-and-stable so the tabs can focus on UI.
// =============================================================================

import { supabase } from './supabase'

// ── CONSTANTS — mirror SalesMode for consistency ────────────────────────────
export const NJ_TAX_RATE = 0.06625
export const CC_SURCHARGE = 0.03

export const ORDER_STATUSES = [
  { code: 'draft',         label: 'Draft',         color: '#8b8b87' },
  { code: 'scoping',       label: 'Scoping',       color: '#b8842a' },
  { code: 'quoted',        label: 'Quoted',        color: '#1d4ed8' },
  { code: 'contracted',    label: 'Contracted',    color: '#2d7a4f' },
  { code: 'in_production', label: 'In Production', color: '#7c3aed' },
  { code: 'installed',     label: 'Installed',     color: '#0f1419' },
  { code: 'paid_in_full',  label: 'Paid in Full',  color: '#0d9488' },
  { code: 'closed',        label: 'Closed',        color: '#5d5d5a' },
  { code: 'cancelled',     label: 'Cancelled',     color: '#b54040' },
  { code: 'archived',      label: 'Archived',      color: '#5d5d5a' },
]
export const ACTIVE_STATUSES = ['draft', 'scoping', 'quoted', 'contracted', 'in_production', 'installed']
export const SOLD_STATUSES   = ['contracted', 'in_production', 'installed', 'paid_in_full', 'closed']

export function statusInfo(code) {
  return ORDER_STATUSES.find(s => s.code === code) || { code, label: code, color: '#8b8b87' }
}

// ── CUSTOMERS ────────────────────────────────────────────────────────────────

export async function listAllCustomers({ includeArchived = false } = {}) {
  let q = supabase
    .from('customers')
    .select('*')
    .order('last_name', { ascending: true, nullsFirst: false })
  if (!includeArchived) q = q.or('archived.is.null,archived.eq.false')
  const { data, error } = await q
  if (error) { console.error('listAllCustomers:', error); return [] }
  return data || []
}

export async function listArchivedCustomers() {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('archived', true)
    .order('last_name', { ascending: true })
  if (error) { console.error('listArchivedCustomers:', error); return [] }
  return data || []
}

export async function archiveCustomer(customerId) {
  const { error } = await supabase
    .from('customers')
    .update({ archived: true, archived_at: new Date().toISOString() })
    .eq('id', customerId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function unarchiveCustomer(customerId) {
  const { error } = await supabase
    .from('customers')
    .update({ archived: false, archived_at: null })
    .eq('id', customerId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// Hard delete — only safe if zero orders attached. Caller must verify first.
export async function deleteCustomer(customerId) {
  // Safety check — count orders attached
  const { count, error: countErr } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('customer_id', customerId)
  if (countErr) return { ok: false, error: countErr.message }
  if (count > 0) {
    return { ok: false, error: `Cannot delete — customer has ${count} order${count === 1 ? '' : 's'} attached. Archive instead.` }
  }
  const { error } = await supabase.from('customers').delete().eq('id', customerId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function getCustomer(customerId) {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .single()
  if (error) { console.error('getCustomer:', error); return null }
  return data
}

export async function listOrdersForCustomer(customerId) {
  const { data, error } = await supabase
    .from('orders')
    .select('*, cemetery:cemeteries(*)')
    .eq('customer_id', customerId)
    .order('updated_at', { ascending: false })
  if (error) { console.error('listOrdersForCustomer:', error); return [] }
  return data || []
}

export async function createCustomer(customer) {
  const row = {
    first_name: customer.firstName || '',
    last_name:  customer.lastName || '',
    phone_primary: customer.phonePrimary || null,
    phone_secondary: customer.phoneSecondary || null,
    email: customer.email || null,
    address_line1: customer.addressLine1 || null,
    city: customer.city || null,
    state: customer.state || null,
    zip: customer.zip || null,
    referral_source: customer.referralSource || null,
    notes: customer.notes || null,
  }
  const { data, error } = await supabase.from('customers').insert(row).select().single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, customer: data }
}

export async function updateCustomerNotes(customerId, notes) {
  const { error } = await supabase.from('customers').update({ notes }).eq('id', customerId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ── ORDERS ───────────────────────────────────────────────────────────────────

export async function listAllOrders({ statuses, limit = 500 } = {}) {
  let q = supabase.from('orders').select('*, customer:customers(*), cemetery:cemeteries(*)')
  if (statuses && statuses.length) q = q.in('status', statuses)
  q = q.order('updated_at', { ascending: false }).limit(limit)
  const { data, error } = await q
  if (error) { console.error('listAllOrders:', error); return [] }
  return data || []
}

// ── ORDER PRICE COMPUTATION ──────────────────────────────────────────────────
// Mirrors SalesMode's buildLineItems → grand total math, but reads directly
// from the saved row (add_ons jsonb + pricing jsonb).
export function rowGrandTotal(order) {
  if (!order) return 0
  const pricing = order.pricing || {}
  const overrides = pricing.overrides || {}
  const addOns = order.add_ons || []

  // Subtotal — line items
  let subtotalDisc = 0    // discountable
  let subtotalPermit = 0  // not discounted (cemetery permits)

  // Base stone price
  if (overrides['base-stone'] != null) {
    subtotalDisc += Number(overrides['base-stone']) || 0
  } else if (pricing.basePrice != null) {
    subtotalDisc += Number(pricing.basePrice) || 0
  }

  // All other override-style line items (foundation, polish, color premium, etc.)
  for (const [code, val] of Object.entries(overrides)) {
    if (code === 'base-stone') continue
    if (typeof val !== 'number') continue
    if (code === 'addon-permit') subtotalPermit += val
    else                          subtotalDisc += val
  }

  // Add-ons
  for (const a of addOns) {
    if (a.freeWithStone) continue
    const amt = (Number(a.price) || 0) * (Number(a.qty) || 1)
    if (a.code === 'permit') subtotalPermit += amt
    else                     subtotalDisc += amt
  }

  // Custom line items
  for (const c of (pricing.customLineItems || [])) {
    subtotalDisc += Number(c.amount) || 0
  }

  // Discount
  const discountPct = Number(pricing.discountPct) || 0
  const discountAmt = subtotalDisc * (discountPct / 100)

  // Tax + CC
  const taxBase = (subtotalDisc - discountAmt) + subtotalPermit
  const tax = pricing.applyTax ? taxBase * NJ_TAX_RATE : 0
  const cc  = pricing.applyCCSurcharge ? (taxBase + tax) * CC_SURCHARGE : 0

  return Math.round(taxBase + tax + cc)
}

// Sprint M2 Phase 2 — payment helpers prefer the payments[] array when it's
// populated (sum of non-voided entries), and fall back to the legacy
// deposit_amount/balance_amount columns for rows that pre-date the payments[]
// migration or weren't fetched with the payments column. The `!p.voided`
// filter is a no-op in Phase 2 (no void UI yet) but is written now so Phase 4
// doesn't have to re-touch these.
function rowNonVoidedPayments(order) {
  // Sprint M2 Phase 2.1 — defensive `?? true`: stonebooksData reads rows
  // directly via select('*'), bypassing rowToOrder's read-time auto-lock. A
  // payment missing the `locked` field (Phase 2-era data) counts as locked
  // here too; only explicit `locked: false` drafts are excluded from totals.
  return Array.isArray(order?.payments)
    ? order.payments.filter(p => !p.voided && (p.locked ?? true))
    : []
}
export function rowDepositPaid(order) {
  const ps = rowNonVoidedPayments(order)
  if (ps.length > 0) return Number(ps[0].amount) || 0
  return Number(order?.deposit_amount) || 0
}
export function rowBalancePaid(order) {
  const ps = rowNonVoidedPayments(order)
  if (ps.length >= 2) return ps.slice(1).reduce((s, p) => s + (Number(p.amount) || 0), 0)
  if (ps.length === 1) return 0
  return Number(order?.balance_amount) || 0
}
export function rowTotalPaid(order) {
  const ps = rowNonVoidedPayments(order)
  if (ps.length > 0) return ps.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  return (Number(order?.deposit_amount) || 0) + (Number(order?.balance_amount) || 0)
}
export function rowBalanceDue(order)   { return Math.max(0, rowGrandTotal(order) - rowTotalPaid(order)) }

// ── FORMATTERS ───────────────────────────────────────────────────────────────

export function fmtUSD(n, opts = {}) {
  const num = Number(n) || 0
  if (opts.short) {
    if (num >= 1000000) return `$${(num / 1000000).toFixed(1)}M`
    if (num >= 1000)    return `$${(num / 1000).toFixed(1)}k`
    return `$${num.toFixed(0)}`
  }
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export function fmtPhone(s) {
  if (!s) return ''
  const d = String(s).replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  if (d.length === 11) return `+${d[0]} (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`
  return s
}

export function fmtDate(iso, opts = {}) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (opts.long) return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  if (opts.month) return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtRelative(iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / 86400000)
  if (days === 0)   return 'today'
  if (days === 1)   return 'yesterday'
  if (days < 7)     return `${days}d ago`
  if (days < 30)    return `${Math.floor(days / 7)}w ago`
  if (days < 365)   return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

export function customerName(c) {
  if (!c) return '—'
  const last = (c.last_name || c.lastName || '').toUpperCase()
  const first = c.first_name || c.firstName || ''
  if (last && first) return `${last}, ${first}`
  return last || first || '—'
}

export function customerInitials(c) {
  if (!c) return '?'
  const f = (c.first_name || c.firstName || '?')[0]
  const l = (c.last_name  || c.lastName  || '?')[0]
  return (f + l).toUpperCase()
}

// ── USER PROFILE ─────────────────────────────────────────────────────────────

export async function getUserSettings(userId) {
  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) { console.error('getUserSettings:', error); return null }
  return data
}

export async function upsertUserSettings(userId, patch) {
  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function uploadProfilePhoto(userId, file) {
  if (!file) return { ok: false, error: 'No file' }
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `${userId}/avatar.${ext}`

  // Upload with upsert so users can replace their photo
  const { error: upErr } = await supabase.storage
    .from('profile-photos')
    .upload(path, file, { upsert: true, contentType: file.type })
  if (upErr) return { ok: false, error: upErr.message }

  // Get public URL
  const { data } = supabase.storage.from('profile-photos').getPublicUrl(path)
  return { ok: true, url: data.publicUrl }
}

// Post-J1-P1 stabilization helper — turns 'waiting_on_cemetery' into
// 'waiting on cemetery' for human-readable action-item labels.
function _humanizeWaitingStatus(code) {
  if (!code) return 'waiting'
  return code.replace(/^waiting_/, 'waiting on ').replace(/_/g, ' ')
}

// Post-J1-P1 stabilization helper — mirrors the readiness check in JobsTab.jsx
// MilestoneRow. A milestone is "ready" when all of its requires[] resolve to
// milestones already in 'done' or 'not_needed' state. Used by next_actionable_idle
// to find the lowest-sort_order ready not_started milestone for sleeping jobs.
function _isMilestoneReady(milestone, milestonesByKey) {
  if (!milestone.requires || milestone.requires.length === 0) return true
  for (const k of milestone.requires) {
    const dep = milestonesByKey.get(k)
    if (dep && dep.status !== 'done' && dep.status !== 'not_needed') return false
  }
  return true
}

// ── ACTION ITEMS (Today tab) ─────────────────────────────────────────────────
// Returns categorized list of things that need attention. Two opt-in modes:
//   getActionItems()                              → legacy: orders-only signals
//   getActionItems({ includeOperational: true })  → adds job/milestone signals
//
// Every item carries a `route` ('order' | 'job') and `routeId` so consumers
// can drill into the right surface. Today's existing UI ignores `route` for
// now and keeps using `item.order.id`; Commit B will switch to route-aware
// routing once the operational items are surfaced via a sectioned UI.
//
// Operational signals (when includeOperational:true):
//   overdue_milestone (red) — most-overdue actionable milestone per job, top 20
//   waiting_aged (amber)    — waiting_* status untouched > 7d, top 10
//   stalled_job (amber)     — active status untouched > 14d, top 10
//
// Dedupe rule: any job that has at least one overdue actionable milestone is
// suppressed from stalled_job (even if that job doesn't make the top-20 cap
// for overdue_milestone). The overdue signal is the stronger operational
// truth; surfacing the same job twice would be noise.

export async function getActionItems(opts = {}) {
  const { includeOperational = false } = opts

  const { data: rows, error } = await supabase
    .from('orders')
    .select('*, customer:customers(*), cemetery:cemeteries(*)')
    .in('status', ACTIVE_STATUSES)
    .limit(500)
  if (error) { console.error('getActionItems:', error); return [] }

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const in7 = new Date(today.getTime() + 7 * 86400000)
  const in14 = new Date(today.getTime() + 14 * 86400000)
  const monthAgo = new Date(today.getTime() - 30 * 86400000)
  const threeDaysAgo = new Date(today.getTime() - 3 * 86400000)
  const sevenAgo = new Date(today.getTime() - 7 * 86400000)
  const fourteenAgo = new Date(today.getTime() - 14 * 86400000)

  const items = []

  for (const o of (rows || [])) {
    const total = rowGrandTotal(o)
    const paid = rowTotalPaid(o)
    const balance = total - paid

    // 1. Overdue balances — sold orders past target date with unpaid balance
    if (SOLD_STATUSES.includes(o.status) && balance > 0 && o.target_completion_date) {
      const target = new Date(o.target_completion_date)
      if (target < today) {
        items.push({
          kind: 'overdue_balance',
          severity: 'red',
          order: o,
          job: null,
          icon: '$',
          label: `${customerName(o.customer)} · balance ${fmtUSD(balance)} overdue`,
          meta: `Target was ${fmtDate(o.target_completion_date)}`,
          route: 'order',
          routeId: o.id,
        })
      }
    }

    // 2. Cemetery permit deadline — approaching
    if (o.cemetery_deadline) {
      const dl = new Date(o.cemetery_deadline)
      if (dl >= today && dl <= in7) {
        items.push({
          kind: 'cemetery_deadline',
          severity: 'red',
          order: o,
          job: null,
          icon: '!',
          label: `${customerName(o.customer)} · cemetery permit deadline`,
          meta: `${fmtDate(o.cemetery_deadline)} (${Math.ceil((dl - today) / 86400000)}d)`,
          route: 'order',
          routeId: o.id,
        })
      }
    }

    // 3. Target completion approaching
    if (o.target_completion_date) {
      const tgt = new Date(o.target_completion_date)
      if (tgt >= today && tgt <= in14 && SOLD_STATUSES.includes(o.status)) {
        items.push({
          kind: 'target_soon',
          severity: 'amber',
          order: o,
          job: null,
          icon: '⏱',
          label: `${customerName(o.customer)} · target completion soon`,
          meta: `${fmtDate(o.target_completion_date)} (${Math.ceil((tgt - today) / 86400000)}d)`,
          route: 'order',
          routeId: o.id,
        })
      }
    }

    // 4. Abandoned drafts — draft or scoping older than 30 days, no recent update
    if (['draft', 'scoping'].includes(o.status)) {
      const updated = new Date(o.updated_at)
      if (updated < monthAgo) {
        items.push({
          kind: 'abandoned_draft',
          severity: 'muted',
          order: o,
          job: null,
          icon: '·',
          label: `${customerName(o.customer)} · draft sitting idle`,
          meta: `Last touched ${fmtRelative(o.updated_at)}`,
          route: 'order',
          routeId: o.id,
        })
      }
    }

    // 5. Quoted but not contracted — older than 14 days
    if (o.status === 'quoted') {
      const updated = new Date(o.updated_at)
      const fortnight = new Date(today.getTime() - 14 * 86400000)
      if (updated < fortnight) {
        items.push({
          kind: 'stale_quote',
          severity: 'amber',
          order: o,
          job: null,
          icon: '⌛',
          label: `${customerName(o.customer)} · quote not yet contracted`,
          meta: `Quoted ${fmtRelative(o.updated_at)} · ${fmtUSD(total)}`,
          route: 'order',
          routeId: o.id,
        })
      }
    }
  }

  // ─── Operational signals (Sprint J1-P1 stabilization — Today commit A) ────
  // Opt-in via opts.includeOperational. UI in Today does NOT pass this flag
  // yet; the legacy item set above is what currently renders. Commit B will
  // flip the flag and add sectioned rendering.
  if (includeOperational) {
    const { data: jobs, error: jobsErr } = await supabase
      .from('jobs')
      .select(`
        id, overall_status, last_update_at, order_id,
        order:orders(id, order_number, status, updated_at, customer:customers(*)),
        milestones:job_milestones(milestone_key, label, due_date, status, sort_order, requires)
      `)
      .neq('overall_status', 'closed')
      .limit(500)

    if (jobsErr) {
      console.error('getActionItems operational query:', jobsErr)
    } else {
      const overdueRows = []           // { job, milestone, daysOverdue }
      const waitingRows = []           // { job, daysSince }
      const stalledRows = []           // { job, daysSince }
      const nextActionableRows = []    // { job, milestone, daysIdle }

      for (const j of (jobs || [])) {
        if (!j.order) continue
        if (j.order.status === 'cancelled') continue

        // overdue_milestone — pick the most-overdue actionable milestone for
        // this job. Same condition as the JobsTab overdue cue: due_date <
        // today AND status NOT in done/not_needed.
        let worst = null
        let worstDays = -1
        for (const m of (j.milestones || [])) {
          if (!m.due_date) continue
          if (m.status === 'done' || m.status === 'not_needed') continue
          const dueDate = new Date(m.due_date + 'T00:00:00')
          if (dueDate >= today) continue
          const days = Math.floor((today - dueDate) / 86400000)
          if (days > worstDays) { worstDays = days; worst = m }
        }
        if (worst) {
          overdueRows.push({ job: j, milestone: worst, daysOverdue: worstDays })
        }

        // waiting_aged — overall_status starts with 'waiting_' AND
        // last_update_at > 7d ago. Independent of overdue dedupe — a job
        // that's both waiting AND has an overdue milestone surfaces both
        // (they're different operational truths).
        if (j.overall_status && j.overall_status.startsWith('waiting_')) {
          const updated = new Date(j.last_update_at || 0)
          if (updated < sevenAgo) {
            const daysSince = Math.floor((today - updated) / 86400000)
            waitingRows.push({ job: j, daysSince })
          }
        }

        // stalled_job — STRICTLY overall_status==='active' (waiting_* states
        // never produce stalled_job; they have their own waiting_aged signal).
        if (j.overall_status === 'active') {
          const updated = new Date(j.last_update_at || 0)
          if (updated < fourteenAgo) {
            const daysSince = Math.floor((today - updated) / 86400000)
            stalledRows.push({ job: j, daysSince })
          }
        }

        // next_actionable_idle — "healthy but sleeping" detection.
        // STRICT gate: no in_progress milestone may exist (the job has no
        // current momentum to disturb — we only flag jobs where the next
        // thing hasn't started). overall_status must be 'active'. The
        // milestone is selected by lowest sort_order among ready not_started
        // (matches the canonical template flow's "what's next"). Idle
        // threshold is 3 days — tighter than stalled_job (14d), filling the
        // operational blind zone between recent-activity and stalled.
        // Dedupes against overdue + stalled below (those are stronger signals).
        if (j.overall_status === 'active') {
          const hasInProgress = (j.milestones || []).some(m => m.status === 'in_progress')
          if (!hasInProgress) {
            const milestonesByKey = new Map((j.milestones || []).map(m => [m.milestone_key, m]))
            const readyNotStarted = (j.milestones || [])
              .filter(m => m.status === 'not_started' && _isMilestoneReady(m, milestonesByKey))
              .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
            const next = readyNotStarted[0]
            if (next) {
              const updated = new Date(j.last_update_at || 0)
              if (updated < threeDaysAgo) {
                const daysIdle = Math.floor((today - updated) / 86400000)
                nextActionableRows.push({ job: j, milestone: next, daysIdle })
              }
            }
          }
        }
      }

      // Build dedupe sets from ALL candidates (pre-cap). A job with an
      // overdue milestone that doesn't make the top-20 cap still suppresses
      // stalled_job and next_actionable_idle — surfacing the same job twice
      // would be noise. Same principle for stalled jobs suppressing
      // next_actionable_idle (stalled is the older/stronger signal at 14d+).
      const overdueJobIds = new Set(overdueRows.map(r => r.job.id))
      const stalledJobIds = new Set(stalledRows.map(r => r.job.id))

      // Emit overdue_milestone (top 20 by days overdue desc)
      overdueRows.sort((a, b) => b.daysOverdue - a.daysOverdue)
      for (const r of overdueRows.slice(0, 20)) {
        items.push({
          kind: 'overdue_milestone',
          severity: 'red',
          order: r.job.order,
          job: { id: r.job.id, overall_status: r.job.overall_status, last_update_at: r.job.last_update_at, order_id: r.job.order_id },
          icon: '⚠',
          label: `${customerName(r.job.order.customer)} · ${r.milestone.label}`,
          meta: `${r.daysOverdue}d overdue · ${r.job.order.order_number || 'job ' + r.job.id.slice(0, 8)}`,
          route: 'job',
          routeId: r.job.id,
        })
      }

      // Emit waiting_aged (top 10 by days-in-state desc)
      waitingRows.sort((a, b) => b.daysSince - a.daysSince)
      for (const r of waitingRows.slice(0, 10)) {
        items.push({
          kind: 'waiting_aged',
          severity: 'amber',
          order: r.job.order,
          job: { id: r.job.id, overall_status: r.job.overall_status, last_update_at: r.job.last_update_at, order_id: r.job.order_id },
          icon: '⌛',
          label: `${customerName(r.job.order.customer)} · ${_humanizeWaitingStatus(r.job.overall_status)}`,
          meta: `${r.daysSince}d in this state · ${r.job.order.order_number || 'job ' + r.job.id.slice(0, 8)}`,
          route: 'job',
          routeId: r.job.id,
        })
      }

      // Emit stalled_job (top 10, deduped against ANY overdue-candidate job)
      const stalledFiltered = stalledRows.filter(r => !overdueJobIds.has(r.job.id))
      stalledFiltered.sort((a, b) => b.daysSince - a.daysSince)
      for (const r of stalledFiltered.slice(0, 10)) {
        items.push({
          kind: 'stalled_job',
          severity: 'amber',
          order: r.job.order,
          job: { id: r.job.id, overall_status: r.job.overall_status, last_update_at: r.job.last_update_at, order_id: r.job.order_id },
          icon: '·',
          label: `${customerName(r.job.order.customer)} · no updates in ${r.daysSince}d`,
          meta: r.job.order.order_number || `job ${r.job.id.slice(0, 8)}`,
          route: 'job',
          routeId: r.job.id,
        })
      }

      // Emit next_actionable_idle (top 10 by daysIdle desc, deduped against
      // both overdue and stalled candidate sets — stronger signals win).
      // Severity: 'muted' — this is "deserves attention before it quietly
      // becomes a problem," not "something is actively wrong." Renders at
      // the bottom of the Operations section, below the red/amber signals.
      const nextActionableFiltered = nextActionableRows.filter(r =>
        !overdueJobIds.has(r.job.id) && !stalledJobIds.has(r.job.id)
      )
      nextActionableFiltered.sort((a, b) => b.daysIdle - a.daysIdle)
      for (const r of nextActionableFiltered.slice(0, 10)) {
        items.push({
          kind: 'next_actionable_idle',
          severity: 'muted',
          order: r.job.order,
          job: { id: r.job.id, overall_status: r.job.overall_status, last_update_at: r.job.last_update_at, order_id: r.job.order_id },
          icon: '→',
          label: `${customerName(r.job.order.customer)} · ${r.milestone.label}`,
          meta: `Ready ${r.daysIdle}d ago · ${r.job.order.order_number || 'job ' + r.job.id.slice(0, 8)}`,
          route: 'job',
          routeId: r.job.id,
        })
      }
    }
  }

  // Sort: red severity first, then amber, then muted; within group, most recent first
  const sevRank = { red: 0, amber: 1, muted: 2 }
  items.sort((a, b) => {
    const dr = sevRank[a.severity] - sevRank[b.severity]
    if (dr !== 0) return dr
    return new Date(b.order?.updated_at || 0) - new Date(a.order?.updated_at || 0)
  })

  return items
}

// ── REPORTS — date helpers ───────────────────────────────────────────────────

export function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function endOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
}

export function monthsAgo(n) {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth() - n, 1)
}

export function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(d) {
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}
// =============================================================================
// Stonebooks — Jobs Operations data layer (Sprint J1-P1, commit 2)
// =============================================================================
// Append this entire block to the bottom of src/lib/stonebooksData.js, just
// before any closing exports or trailing whitespace. Nothing above it changes.
//
// Conventions matched to existing helpers:
//   - reads return [] / null on error, log to console.error
//   - writes return { ok: true, ... } / { ok: false, error }
//   - snake_case in the DB, mirrored field names in JS where natural
//   - JSONB-heavy storage, defensive defaults on read
//
// What this commit ships:
//   - Service-type → template mapping
//   - Template loader + milestone union for multi-service orders
//   - createJobFromOrder (idempotent)
//   - getJobs (list view) + getJob (detail)
//   - Milestone updates with readiness gating + override path
//   - Decision-milestone cascade ("not needed" propagates to dependents)
//   - Job-level helpers: status, next action, note
//   - Event reader
// =============================================================================

// ── JOBS: constants ──────────────────────────────────────────────────────────

export const JOB_OVERALL_STATUSES = [
  { code: 'active',              label: 'Active',              color: '#2d7a4f' },
  { code: 'waiting_on_customer', label: 'Waiting on customer', color: '#b8842a' },
  { code: 'waiting_on_cemetery', label: 'Waiting on cemetery', color: '#b8842a' },
  { code: 'waiting_on_supplier', label: 'Waiting on supplier', color: '#b8842a' },
  { code: 'weather_delayed',     label: 'Weather delayed',     color: '#5d5d5a' },
  { code: 'seasonal_hold',       label: 'Seasonal hold',       color: '#5d5d5a' },
  { code: 'legal_hold',          label: 'Legal hold',          color: '#b54040' },
  { code: 'blocked',             label: 'Blocked',             color: '#b54040' },
  { code: 'closed',              label: 'Closed',              color: '#0f1419' },
]

export const JOB_MILESTONE_STATUSES = [
  { code: 'not_needed',  label: 'Not needed',  color: '#8b8b87' },
  { code: 'not_started', label: 'Not started', color: '#5d5d5a' },
  { code: 'in_progress', label: 'In progress', color: '#1d4ed8' },
  { code: 'done',        label: 'Done',        color: '#2d7a4f' },
  { code: 'blocked',     label: 'Blocked',     color: '#b54040' },
]

export const JOB_TEAMS = [
  { code: 'design',       label: 'Design',       color: '#7c3aed' },
  { code: 'sales',        label: 'Sales',        color: '#1d4ed8' },
  { code: 'admin',        label: 'Admin',        color: '#b8842a' },
  { code: 'production',   label: 'Production',   color: '#0d9488' },
  { code: 'installation', label: 'Installation', color: '#2d7a4f' },
]

// Sprint J1-P1 stabilization — default milestone duration (in days) by group.
// Used by _applyMilestoneUpdate to auto-seed due_date on the FIRST transition
// into 'in_progress' when no date is currently set. Group-level defaults are a
// placeholder model; several groups (etching especially) will eventually
// subdivide into structured substates with their own per-substate thresholds.
// Etching is intentionally generous (90d) because it can include outsourced
// vendor steps — treating it as a simple internal task would create
// unrealistic overdue pressure. Same caveat applies in spirit to design,
// permit, stone, photo — they're floor estimates pending the subflow refactor.
// Values calibrated for Shevchenko Monuments 2026-05-18.
const MILESTONE_GROUP_DEFAULT_DAYS = {
  intake:      3,
  design:     14,
  permit:     21,
  stone:      45,
  photo:      30,
  etching:    90,
  production: 21,
  foundation: 14,
  install:    14,
  closeout:    7,
  _default:   14,
}

export function jobStatusInfo(code) {
  return JOB_OVERALL_STATUSES.find(s => s.code === code) || { code, label: code, color: '#8b8b87' }
}
export function milestoneStatusInfo(code) {
  return JOB_MILESTONE_STATUSES.find(s => s.code === code) || { code, label: code, color: '#8b8b87' }
}
export function teamInfo(code) {
  return JOB_TEAMS.find(t => t.code === code) || { code, label: code || '—', color: '#8b8b87' }
}

// ── JOBS: service-type → job-type mapping ────────────────────────────────────
// Maps the codes from orders.service_types (an ARRAY) onto our four templates.
// The first matching service type drives the primary template; secondary types
// contribute additional milestones via union (see milestonesForServiceTypes).
//
// OTHER → new_stone fallback, with a staff_notes flag added at creation time.

const SERVICE_TYPE_TO_JOB_TYPE = {
  NEW_STONE:       'new_stone',
  CIVIC_MEMORIAL:  'new_stone',
  MAUSOLEUM:       'new_stone',
  INSCRIPTION:     'inscription',
  ADD_PHOTO:       'inscription',
  BRONZE:          'bronze',
  ACID_WASH:       'cleaning_repair',
  REPAIR:          'cleaning_repair',
  OTHER:           'new_stone',
}

export function jobTypeForServiceTypes(serviceTypes) {
  if (!Array.isArray(serviceTypes) || serviceTypes.length === 0) return null
  for (const s of serviceTypes) {
    const t = SERVICE_TYPE_TO_JOB_TYPE[s]
    if (t) return t
  }
  return 'new_stone' // unknown codes fall through to new_stone
}

// ── JOBS: template loading ───────────────────────────────────────────────────

async function fetchActiveTemplateByJobType(jobType) {
  const { data, error } = await supabase
    .from('milestone_templates')
    .select('*')
    .eq('job_type', jobType)
    .eq('is_active', true)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) { console.error('fetchActiveTemplateByJobType:', error); return null }
  return data
}

// Given a service_types[] array, returns:
//   { primaryTemplate, allMilestones }
// where allMilestones is the primary template's milestone list with any
// additional milestones from secondary-service templates appended (deduped by
// milestone_key, primary wins on conflict). sort_order is assigned by final
// position so the table renders in a stable order.
async function buildMilestoneListForOrder(serviceTypes) {
  const types = Array.isArray(serviceTypes) ? serviceTypes : []
  if (types.length === 0) return { primaryTemplate: null, allMilestones: [] }

  const primaryJobType = jobTypeForServiceTypes(types)
  if (!primaryJobType) return { primaryTemplate: null, allMilestones: [] }

  const primaryTemplate = await fetchActiveTemplateByJobType(primaryJobType)
  if (!primaryTemplate) return { primaryTemplate: null, allMilestones: [] }

  const seenKeys = new Set()
  const merged = []
  for (const m of (primaryTemplate.template?.milestones || [])) {
    seenKeys.add(m.key)
    merged.push(m)
  }

  // Collect distinct secondary job-types (other than primary)
  const secondaryJobTypes = []
  for (const s of types) {
    const t = SERVICE_TYPE_TO_JOB_TYPE[s]
    if (t && t !== primaryJobType && !secondaryJobTypes.includes(t)) {
      secondaryJobTypes.push(t)
    }
  }

  for (const jt of secondaryJobTypes) {
    const tmpl = await fetchActiveTemplateByJobType(jt)
    if (!tmpl) continue
    for (const m of (tmpl.template?.milestones || [])) {
      if (!seenKeys.has(m.key)) {
        seenKeys.add(m.key)
        merged.push(m)
      }
    }
  }

  return { primaryTemplate, allMilestones: merged }
}

// ── JOBS: createJobFromOrder ─────────────────────────────────────────────────
// Idempotent: if a job already exists for this order, returns that job
// with alreadyExisted:true and writes NO new event.
// Requires orders.signed_at to be non-null.
// Writes a job_created event on first creation, tagged with creation_source
// for the audit trail: 'wizard' (auto from contract signing), 'backfill'
// (batch from Jobs tab), or 'manual' (default for any ad-hoc caller).

export async function createJobFromOrder(orderId, { source } = {}) {
  if (!orderId) return { ok: false, error: 'No orderId' }

  // 1. Existing job? Return it.
  const { data: existing } = await supabase
    .from('jobs')
    .select('*')
    .eq('order_id', orderId)
    .maybeSingle()
  if (existing) return { ok: true, job: existing, alreadyExisted: true }

  // 2. Load the order.
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('id, signed_at, service_types, sales_rep, tenant_id, staff_notes')
    .eq('id', orderId)
    .single()
  if (orderErr || !order) return { ok: false, error: orderErr?.message || 'Order not found' }
  if (!order.signed_at) return { ok: false, error: 'Order is not signed yet — no job created' }

  // 3. Resolve template + milestone list.
  const { primaryTemplate, allMilestones } = await buildMilestoneListForOrder(order.service_types)
  if (!primaryTemplate) return { ok: false, error: 'No active template matches this order\'s service types' }

  // 4. Insert the job.
  const jobRow = {
    tenant_id: order.tenant_id,
    order_id: order.id,
    template_id: primaryTemplate.id,
    job_type: primaryTemplate.job_type,
    overall_status: 'active',
    last_update_at: new Date().toISOString(),
  }
  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .insert(jobRow)
    .select()
    .single()
  if (jobErr) return { ok: false, error: jobErr.message }

  // 5. Insert milestone rows.
  const milestoneRows = allMilestones.map((m, idx) => ({
    tenant_id: order.tenant_id,
    job_id: job.id,
    milestone_key: m.key,
    label: m.label,
    group: m.group,
    team: m.team || null,
    status: m.default_status || 'not_started',
    sort_order: idx,
    requires: m.requires || [],
    is_decision: !!m.is_decision,
    cascades_to: m.cascades_to || [],
    is_customer_visible: !!m.is_customer_visible,
    due_date: null,
    updated_at: new Date().toISOString(),
  }))
  if (milestoneRows.length > 0) {
    const { error: msErr } = await supabase.from('job_milestones').insert(milestoneRows)
    if (msErr) {
      // Roll back the job row so we don't leave orphans
      await supabase.from('jobs').delete().eq('id', job.id)
      return { ok: false, error: `Failed to seed milestones: ${msErr.message}` }
    }
  }

  // 6. Write job_created event.
  const eventPayload = {
    service_types: order.service_types,
    template_job_type: primaryTemplate.job_type,
    template_version: primaryTemplate.version,
    milestone_count: milestoneRows.length,
    creation_source: source || 'manual',
  }
  if ((order.service_types || []).includes('OTHER')) {
    eventPayload.staff_review_required = true
    eventPayload.reason = 'Order contains OTHER service type; verify template fits the actual work.'
  }
  await supabase.from('job_events').insert({
    tenant_id: order.tenant_id,
    job_id: job.id,
    event_type: 'job_created',
    payload: eventPayload,
    note: eventPayload.staff_review_required
      ? 'Job created from OTHER service type — staff review recommended.'
      : null,
  })

  return { ok: true, job, alreadyExisted: false }
}

// ── JOBS: list view ──────────────────────────────────────────────────────────
// Returns rows for the Jobs tab table. Each row includes:
//   - joined customer (id, names, phones)
//   - joined cemetery (id, name)
//   - joined order (id, order_number, service_types, target_completion_date)
//   - milestones array (full set; the UI summarizes by group)
//
// Filters:
//   teamFilter:   array of team codes to filter milestones (and hide jobs with
//                 no matching open milestones). Empty array / undefined = no filter.
//   statusFilter: array of overall_status codes to keep.
//   includeClosed: default false; closed jobs hidden unless asked.

export async function getJobs({ teamFilter, statusFilter, includeClosed = false, limit = 500 } = {}) {
  let q = supabase
    .from('jobs')
    .select(`
      *,
      milestones:job_milestones(*),
      order:orders(id, order_number, service_types, target_completion_date, target_completion_end_date, primary_lastname, signed_at, customer_id, cemetery_id),
      customer:orders(customer:customers(*)),
      cemetery:orders(cemetery:cemeteries(*))
    `)
    .order('last_update_at', { ascending: false })
    .limit(limit)

  if (statusFilter && statusFilter.length) {
    q = q.in('overall_status', statusFilter)
  } else if (!includeClosed) {
    q = q.neq('overall_status', 'closed')
  }

  const { data, error } = await q
  if (error) { console.error('getJobs:', error); return [] }

  // The double-nested customer/cemetery select returns arrays of join objects;
  // flatten to a single record per job for easier consumption.
  const rows = (data || []).map(j => {
    const order = j.order || null
    // Unnest customer + cemetery via a second fetch path; Supabase's PostgREST
    // can sometimes return either shape depending on relationship hints. Be
    // defensive.
    let customer = null, cemetery = null
    if (Array.isArray(j.customer) && j.customer.length) {
      customer = j.customer[0]?.customer || null
    } else if (j.customer && j.customer.customer) {
      customer = j.customer.customer
    }
    if (Array.isArray(j.cemetery) && j.cemetery.length) {
      cemetery = j.cemetery[0]?.cemetery || null
    } else if (j.cemetery && j.cemetery.cemetery) {
      cemetery = j.cemetery.cemetery
    }
    return {
      ...j,
      milestones: (j.milestones || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
      order,
      customer,
      cemetery,
    }
  })

  // Team filter is post-fetch (the join shape makes server-side filtering on
  // children awkward, and the dataset is small in Sprint 1).
  if (teamFilter && teamFilter.length) {
    return rows.filter(r =>
      r.milestones.some(m =>
        teamFilter.includes(m.team) &&
        m.status !== 'done' &&
        m.status !== 'not_needed'
      )
    )
  }
  return rows
}

// ── JOBS: single-job detail ──────────────────────────────────────────────────

export async function getJob(jobId) {
  if (!jobId) return null
  const { data: job, error } = await supabase
    .from('jobs')
    .select(`
      *,
      milestones:job_milestones(*),
      order:orders(*, customer:customers(*), cemetery:cemeteries(*))
    `)
    .eq('id', jobId)
    .single()
  if (error) { console.error('getJob:', error); return null }
  if (!job) return null
  return {
    ...job,
    milestones: (job.milestones || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
    customer: job.order?.customer || null,
    cemetery: job.order?.cemetery || null,
  }
}

// ── JOBS: readiness gating ───────────────────────────────────────────────────
// A milestone is "ready" if every key in its requires[] resolves to a milestone
// whose status is 'done' OR 'not_needed' on the same job.
// `not_needed` counts as satisfied — that's the whole point of the cascade.

export function computeMilestoneReadiness(milestone, allMilestones) {
  const requires = Array.isArray(milestone.requires) ? milestone.requires : []
  if (requires.length === 0) return { ready: true, blockingKeys: [] }
  const byKey = new Map(allMilestones.map(m => [m.milestone_key, m]))
  const blocking = []
  for (const key of requires) {
    const dep = byKey.get(key)
    if (!dep) continue // unknown key — be permissive, log later
    if (dep.status !== 'done' && dep.status !== 'not_needed') {
      blocking.push(key)
    }
  }
  return { ready: blocking.length === 0, blockingKeys: blocking }
}

// ── JOBS: updateMilestone ────────────────────────────────────────────────────
// Patch shape: { status?, due_date?, assignee_user_id?, note? }
// If the patch advances status to 'in_progress' or 'done' and the milestone
// is not ready, this returns:
//   { ok: false, requiresOverride: true, blockingKeys: [...] }
// The caller can then prompt for a reason and call updateMilestoneWithOverride.

export async function updateMilestone(jobId, milestoneKey, patch, { actorUserId } = {}) {
  return _applyMilestoneUpdate(jobId, milestoneKey, patch, { actorUserId, override: null })
}

export async function updateMilestoneWithOverride(jobId, milestoneKey, patch, overrideReason, { actorUserId } = {}) {
  const reason = (overrideReason || '').trim()
  if (!reason) return { ok: false, error: 'Override reason is required' }
  return _applyMilestoneUpdate(jobId, milestoneKey, patch, { actorUserId, override: reason })
}

async function _applyMilestoneUpdate(jobId, milestoneKey, patch, { actorUserId, override }) {
  if (!jobId || !milestoneKey) return { ok: false, error: 'Missing jobId or milestoneKey' }

  // 1. Load this milestone and its siblings (for readiness check).
  const { data: siblings, error: sibErr } = await supabase
    .from('job_milestones')
    .select('*')
    .eq('job_id', jobId)
  if (sibErr) return { ok: false, error: sibErr.message }
  const current = (siblings || []).find(m => m.milestone_key === milestoneKey)
  if (!current) return { ok: false, error: 'Milestone not found' }

  // 2. Readiness gate — only for forward-progress status changes.
  const advancingStatus =
    patch.status && (patch.status === 'in_progress' || patch.status === 'done')
  if (advancingStatus && !override) {
    const { ready, blockingKeys } = computeMilestoneReadiness(current, siblings)
    if (!ready) {
      return { ok: false, requiresOverride: true, blockingKeys }
    }
  }

  // 3. Build the row patch.
  const rowPatch = { updated_at: new Date().toISOString() }
  if (actorUserId) rowPatch.updated_by = actorUserId
  if (patch.status !== undefined) {
    rowPatch.status = patch.status
    rowPatch.status_date = new Date().toISOString().slice(0, 10)
  }
  if (patch.due_date !== undefined) rowPatch.due_date = patch.due_date
  if (patch.assignee_user_id !== undefined) rowPatch.assignee_user_id = patch.assignee_user_id
  if (patch.note !== undefined) rowPatch.note = patch.note

  // Sprint J1-P1 stabilization — auto-seed due_date on FIRST transition to
  // 'in_progress'. Three guards keep this safe and idempotent:
  //   1. patch.status === 'in_progress' (only this direction; not done/blocked/etc.)
  //   2. patch.due_date === undefined (an explicit date in the same patch wins)
  //   3. !current.due_date (never overwrite — sticky once set, auto or manual)
  // When all three hold, seed today + MILESTONE_GROUP_DEFAULT_DAYS[group].
  // YYYY-MM-DD computed from LOCAL date components (avoids the UTC drift the
  // pre-existing status_date computation has — that's a separate fix, not
  // in scope here).
  // The override path through updateMilestoneWithOverride hits this same
  // logic — auto-seed fires regardless of whether the transition was gated.
  let autoSeedDate = null
  if (
    patch.status === 'in_progress' &&
    patch.due_date === undefined &&
    !current.due_date
  ) {
    const days = MILESTONE_GROUP_DEFAULT_DAYS[current.group] ?? MILESTONE_GROUP_DEFAULT_DAYS._default
    const seedDt = new Date(Date.now() + days * 86400000)
    autoSeedDate = `${seedDt.getFullYear()}-${String(seedDt.getMonth() + 1).padStart(2, '0')}-${String(seedDt.getDate()).padStart(2, '0')}`
    rowPatch.due_date = autoSeedDate
  }

  // 4. Apply the patch.
  const { data: updated, error: updErr } = await supabase
    .from('job_milestones')
    .update(rowPatch)
    .eq('job_id', jobId)
    .eq('milestone_key', milestoneKey)
    .select()
    .single()
  if (updErr) return { ok: false, error: updErr.message }

  // 5. Write the corresponding event(s).
  const events = []
  if (patch.status !== undefined && patch.status !== current.status) {
    events.push({
      tenant_id: current.tenant_id,
      job_id: jobId,
      event_type: override ? 'override' : 'milestone_status_changed',
      milestone_key: milestoneKey,
      payload: { from: current.status, to: patch.status },
      note: patch.note || null,
      is_override: !!override,
      override_reason: override || null,
      created_by: actorUserId || null,
    })
  }
  if (patch.due_date !== undefined && patch.due_date !== current.due_date) {
    events.push({
      tenant_id: current.tenant_id,
      job_id: jobId,
      event_type: 'milestone_due_date_set',
      milestone_key: milestoneKey,
      payload: { from: current.due_date, to: patch.due_date },
      created_by: actorUserId || null,
    })
  }
  if (patch.assignee_user_id !== undefined && patch.assignee_user_id !== current.assignee_user_id) {
    events.push({
      tenant_id: current.tenant_id,
      job_id: jobId,
      event_type: 'milestone_assigned',
      milestone_key: milestoneKey,
      payload: { from: current.assignee_user_id, to: patch.assignee_user_id },
      created_by: actorUserId || null,
    })
  }
  if (patch.note !== undefined && !events.some(e => e.note)) {
    events.push({
      tenant_id: current.tenant_id,
      job_id: jobId,
      event_type: 'milestone_note_added',
      milestone_key: milestoneKey,
      payload: {},
      note: patch.note,
      created_by: actorUserId || null,
    })
  }
  // Sprint J1-P1 stabilization — auto-seed event. Emitted AFTER the
  // note-event block above so that a user-supplied patch.note still gets
  // its own milestone_note_added event (that block uses
  // `!events.some(e => e.note)` as a suppression guard; we must not trip
  // it before the user's note can land). Reuses milestone_due_date_set
  // event type so the existing JobsTab event-log renderer handles it
  // without UI changes; the auto_seeded:true payload flag + the note
  // make the audit trail queryable and human-readable.
  if (autoSeedDate !== null) {
    events.push({
      tenant_id: current.tenant_id,
      job_id: jobId,
      event_type: 'milestone_due_date_set',
      milestone_key: milestoneKey,
      payload: { from: null, to: autoSeedDate, auto_seeded: true },
      note: 'Auto-seeded on transition to in_progress.',
      created_by: actorUserId || null,
    })
  }
  if (events.length > 0) {
    await supabase.from('job_events').insert(events)
  }

  // 6. Cascade if this was a decision milestone flipped to 'not_needed'.
  let cascadeApplied = null
  if (
    current.is_decision &&
    patch.status === 'not_needed' &&
    Array.isArray(current.cascades_to) &&
    current.cascades_to.length > 0
  ) {
    cascadeApplied = await _applyNotNeededCascade(jobId, current, actorUserId)
  }

  // 7. If a non-decision milestone was flipped back from not_needed to
  // not_started (rare), we don't auto-reset its downstream chain — that's a
  // manual decision. We just log nothing extra.

  return { ok: true, milestone: updated, cascadeApplied }
}

async function _applyNotNeededCascade(jobId, decisionMilestone, actorUserId) {
  const keys = Array.isArray(decisionMilestone.cascades_to) ? decisionMilestone.cascades_to : []
  if (keys.length === 0) return { affectedKeys: [] }

  const { data: dependents, error: depErr } = await supabase
    .from('job_milestones')
    .select('*')
    .eq('job_id', jobId)
    .in('milestone_key', keys)
  if (depErr) { console.error('cascade fetch:', depErr); return { affectedKeys: [] } }

  const toUpdate = (dependents || []).filter(d => d.status !== 'not_needed' && d.status !== 'done')
  const nowIso = new Date().toISOString()
  const today = nowIso.slice(0, 10)
  const affected = []

  for (const d of toUpdate) {
    const { error } = await supabase
      .from('job_milestones')
      .update({
        status: 'not_needed',
        status_date: today,
        updated_at: nowIso,
        updated_by: actorUserId || null,
      })
      .eq('id', d.id)
    if (!error) affected.push(d.milestone_key)
  }

  if (affected.length > 0) {
    await supabase.from('job_events').insert({
      tenant_id: decisionMilestone.tenant_id,
      job_id: jobId,
      event_type: 'cascade_applied',
      milestone_key: decisionMilestone.milestone_key,
      payload: { affected_keys: affected, trigger: decisionMilestone.milestone_key },
      note: `Auto-cascade: ${affected.length} dependent milestone${affected.length === 1 ? '' : 's'} set to not_needed.`,
      created_by: actorUserId || null,
    })
  }
  return { affectedKeys: affected }
}

// ── JOBS: job-level helpers ──────────────────────────────────────────────────

// Sprint J1-P1 operational continuation #3 — waiting-state transition hints.
// Pure heuristic. When staff moves a milestone to in_progress and the label/key
// implies an outbound action on an external party (customer / cemetery /
// supplier), we surface a soft suggestion to update job.overall_status.
//
// Conservative substring matching against `label + milestone_key` (lowercased).
// The exclusion regex bails out on "the wait is over" signals
// (received/approved/etc.) so labels like "Customer approval received" don't
// false-positive into waiting_on_customer. First positive rule wins.
//
// Subflow direction (NOT yet implemented): when groups like etching evolve
// into structured substates, each substate's external-party role will be
// encoded on the template rather than inferred. This heuristic is the
// no-schema bootstrap pending that refactor.
const WAITING_HINT_RULES = [
  {
    kind: 'waiting_on_supplier',
    patterns: ['ordered', 'order placed', 'po sent', 'po submitted'],
  },
  {
    kind: 'waiting_on_cemetery',
    patterns: [
      'permit submitted', 'permit filed', 'submit permit',
      'submitted to cemetery', 'filed with cemetery', 'sent to cemetery',
    ],
  },
  {
    kind: 'waiting_on_customer',
    patterns: [
      'sent to customer', 'send to customer',
      'awaiting customer', 'customer approval', 'customer sign-off',
      'layout sent', 'proof sent',
      'layout to customer', 'proof to customer',
    ],
  },
]
const WAITING_HINT_EXCLUSIONS = /\b(received|arrived|approved|confirmed|rejected|completed|done)\b/

export function inferWaitingStatusFromMilestone(milestone) {
  if (!milestone) return null
  const text = `${milestone.label || ''} ${milestone.milestone_key || ''}`.toLowerCase()
  if (WAITING_HINT_EXCLUSIONS.test(text)) return null
  for (const rule of WAITING_HINT_RULES) {
    for (const pattern of rule.patterns) {
      if (text.includes(pattern)) return rule.kind
    }
  }
  return null
}

export async function setJobOverallStatus(jobId, newStatus, note, { actorUserId, source } = {}) {
  if (!jobId || !newStatus) return { ok: false, error: 'Missing jobId or newStatus' }
  const valid = JOB_OVERALL_STATUSES.some(s => s.code === newStatus)
  if (!valid) return { ok: false, error: `Invalid status: ${newStatus}` }

  const { data: job, error: getErr } = await supabase
    .from('jobs')
    .select('id, tenant_id, overall_status, closed_at')
    .eq('id', jobId)
    .single()
  if (getErr || !job) return { ok: false, error: getErr?.message || 'Job not found' }
  if (job.overall_status === newStatus) return { ok: true, unchanged: true }

  const patch = {
    overall_status: newStatus,
    last_update_at: new Date().toISOString(),
  }
  if (actorUserId) patch.last_update_by = actorUserId
  if (newStatus === 'closed' && !job.closed_at) patch.closed_at = new Date().toISOString()
  if (newStatus !== 'closed' && job.closed_at) patch.closed_at = null

  const { error: updErr } = await supabase.from('jobs').update(patch).eq('id', jobId)
  if (updErr) return { ok: false, error: updErr.message }

  // Event payload — optional `triggered_by` audit tag mirrors the
  // `creation_source` pattern from Sprint J1-P1 Commit 6 (wizard/backfill/manual).
  const payload = { from: job.overall_status, to: newStatus }
  if (source) payload.triggered_by = source

  await supabase.from('job_events').insert({
    tenant_id: job.tenant_id,
    job_id: jobId,
    event_type: newStatus === 'closed' ? 'job_closed' : 'job_status_changed',
    payload,
    note: note || null,
    created_by: actorUserId || null,
  })
  return { ok: true }
}

export async function setNextAction(jobId, text, dueDate, { actorUserId } = {}) {
  if (!jobId) return { ok: false, error: 'Missing jobId' }
  const { data: job, error: getErr } = await supabase
    .from('jobs')
    .select('id, tenant_id, next_action, next_action_due')
    .eq('id', jobId)
    .single()
  if (getErr || !job) return { ok: false, error: getErr?.message || 'Job not found' }

  const patch = {
    next_action: text || null,
    next_action_due: dueDate || null,
    last_update_at: new Date().toISOString(),
  }
  if (actorUserId) patch.last_update_by = actorUserId

  const { error: updErr } = await supabase.from('jobs').update(patch).eq('id', jobId)
  if (updErr) return { ok: false, error: updErr.message }

  await supabase.from('job_events').insert({
    tenant_id: job.tenant_id,
    job_id: jobId,
    event_type: 'next_action_set',
    payload: {
      from: job.next_action,
      to: text || null,
      from_due: job.next_action_due,
      to_due: dueDate || null,
    },
    created_by: actorUserId || null,
  })
  return { ok: true }
}

export async function addJobNote(jobId, body, { relatedMilestoneKey, actorUserId } = {}) {
  if (!jobId) return { ok: false, error: 'Missing jobId' }
  const text = (body || '').trim()
  if (!text) return { ok: false, error: 'Note body is empty' }

  const { data: job, error: getErr } = await supabase
    .from('jobs')
    .select('id, tenant_id')
    .eq('id', jobId)
    .single()
  if (getErr || !job) return { ok: false, error: getErr?.message || 'Job not found' }

  const { error } = await supabase.from('job_events').insert({
    tenant_id: job.tenant_id,
    job_id: jobId,
    event_type: 'note_added',
    milestone_key: relatedMilestoneKey || null,
    payload: {},
    note: text,
    created_by: actorUserId || null,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ── JOBS: event reader ───────────────────────────────────────────────────────

export async function getJobEvents(jobId, { limit = 200, includeVoided = false } = {}) {
  if (!jobId) return []
  let q = supabase
    .from('job_events')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (!includeVoided) q = q.eq('voided', false)
  const { data, error } = await q
  if (error) { console.error('getJobEvents:', error); return [] }
  return data || []
}

// ── JOBS: derived helpers (no DB calls) ──────────────────────────────────────
// Pure functions for UI use — summarize a milestone list by group, find the
// best "next required action" suggestion, compute days since update, etc.

export function summarizeMilestonesByGroup(milestones) {
  const out = new Map()
  for (const m of (milestones || [])) {
    const g = m.group || 'other'
    if (!out.has(g)) out.set(g, { group: g, total: 0, done: 0, notNeeded: 0, inProgress: 0, blocked: 0, notStarted: 0 })
    const row = out.get(g)
    row.total += 1
    if (m.status === 'done')        row.done += 1
    if (m.status === 'not_needed')  row.notNeeded += 1
    if (m.status === 'in_progress') row.inProgress += 1
    if (m.status === 'blocked')     row.blocked += 1
    if (m.status === 'not_started') row.notStarted += 1
  }
  return Array.from(out.values())
}

// Returns the oldest "actionable" milestone — i.e. not_started or in_progress
// AND ready (all prerequisites satisfied). This drives the suggested
// next-action when staff hasn't manually set one.
export function suggestNextActionableMilestone(milestones) {
  const list = milestones || []
  const candidates = list.filter(m => {
    if (m.status !== 'not_started' && m.status !== 'in_progress') return false
    const { ready } = computeMilestoneReadiness(m, list)
    return ready
  })
  if (candidates.length === 0) return null
  // Earliest by sort_order is the natural workflow order
  candidates.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  return candidates[0]
}

export function daysSinceUpdate(job) {
  if (!job?.last_update_at) return null
  const ms = Date.now() - new Date(job.last_update_at).getTime()
  return Math.floor(ms / 86400000)
}

// ── Milestone overdue + readiness helpers (relocated from JobsTab) ───────────
// Pure helpers — no DB, no side effects. Surface in MilestoneRow (overdue cue +
// blocking caption), in useMemoGroupMilestones (within-group sort priority),
// and in queue components (overdue badges, blocker notes). Centralized here
// so every consumer reads from the same source.

export function todayLocalISO() {
  // Build YYYY-MM-DD from local components. Avoids toISOString's UTC drift,
  // which near midnight in NJ can roll the date forward or back.
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function isMilestoneOverdue(m) {
  if (!m?.due_date) return false
  if (m.status === 'done' || m.status === 'not_needed') return false
  // ISO YYYY-MM-DD lex-compares correctly; "due today" is NOT overdue.
  return m.due_date < todayLocalISO()
}

export function daysPastDue(m) {
  if (!isMilestoneOverdue(m)) return 0
  // Parse both as local midnight so the diff is an honest day count.
  const due = new Date(m.due_date + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.floor((today - due) / 86400000)
}

// Returns true if a not_started milestone has at least one unsatisfied
// `requires[]` dependency (i.e., it's locked, can't be acted on yet).
// Mirrors the same check MilestoneRow uses for its blocking caption.
export function hasUnsatisfiedRequires(m, byKey) {
  if (!m.requires || m.requires.length === 0) return false
  for (const k of m.requires) {
    const dep = byKey.get(k)
    if (dep && dep.status !== 'done' && dep.status !== 'not_needed') return true
  }
  return false
}

// ── Generic aging helper ────────────────────────────────────────────────────
// Days elapsed since a given ISO timestamp (or null if absent). Local-clock-
// based; midnight transitions match user-visible reality. Used for queue row
// aging and any other "Nd idle / ago" surface.

export function daysSinceMs(timestamp) {
  if (!timestamp) return null
  const diff = Date.now() - new Date(timestamp).getTime()
  return Math.max(0, Math.floor(diff / 86400000))
}

// ── Operational classification layer ────────────────────────────────────────
// Sprint J1-P1 follow-up — queue derivation (and future NRA, drift signals,
// AI-drafted comms) reads operational meaning from these helpers, never from
// raw milestone_key string patterns. v1 implementation infers the meaning
// from the existing key/group naming convention; v2/v3 will swap the internal
// implementation to read template-side metadata when templates carry
// operational_role / waiting_on / owner_type fields. Consumers do not change.
//
// These three helpers are the load-bearing abstraction. Adding a fourth or
// fifth is fine; bypassing them with inline pattern matching is not.

// What operational party is this milestone waiting on when in_progress?
// Wraps inferWaitingStatusFromMilestone (which returns the full waiting_on_*
// enum used by the hint banner) and returns the simplified party label used
// by queues and NRA. Returns one of:
//   'customer' | 'cemetery' | 'supplier' | 'internal'
export function getMilestoneWaitingOn(milestone) {
  if (!milestone) return 'internal'
  const inferred = inferWaitingStatusFromMilestone(milestone)
  if (inferred === 'waiting_on_customer') return 'customer'
  if (inferred === 'waiting_on_cemetery') return 'cemetery'
  if (inferred === 'waiting_on_supplier') return 'supplier'
  return 'internal'
}

// What operational role does this milestone play in its group?
// Returns one of the v1 role enum values:
//   'decision' | 'internal_work'
//   | 'send_to_customer' | 'receive_from_customer'
//   | 'send_to_supplier' | 'receive_from_supplier'
//   | 'send_to_cemetery' | 'receive_from_cemetery'
//   | 'scheduling' | 'field_work'
//
// v1: classification by (group, key suffix). Pattern matching is contained
// here — queue/NRA consumers must never inspect milestone_key directly.
export function getMilestoneOperationalRole(milestone) {
  if (!milestone) return 'internal_work'
  if (milestone.is_decision) return 'decision'

  const key = (milestone.milestone_key || '').toLowerCase()
  const group = milestone.group || ''

  // Design group: internal authoring vs send/approve cycle
  if (group === 'design') {
    if (/_(approved|approved_by_customer)$/.test(key)) return 'receive_from_customer'
    if (/_(sent|sent_to_customer)$/.test(key))         return 'send_to_customer'
    return 'internal_work'
  }

  // Permit group → cemetery party
  if (group === 'permit') {
    if (/_(submitted|filed)$/.test(key) || /to_cemetery/.test(key)) return 'send_to_cemetery'
    if (/_(approved|received)$/.test(key))                          return 'receive_from_cemetery'
    return 'internal_work'
  }

  // Stone / etching groups → supplier party
  if (group === 'stone' || group === 'etching') {
    if (/_(ordered|order_placed)$/.test(key) || /^po_/.test(key)) return 'send_to_supplier'
    if (/_(received|arrived)$/.test(key))                         return 'receive_from_supplier'
    return 'internal_work'
  }

  // Photo group → customer party (typical: request photo, receive photo)
  if (group === 'photo') {
    if (/request/.test(key))  return 'send_to_customer'
    if (/received/.test(key)) return 'receive_from_customer'
    return 'internal_work'
  }

  // Foundation / install / closeout: field work + scheduling steps
  if (group === 'foundation' || group === 'install') {
    if (/_(scheduled|schedule)/.test(key)) return 'scheduling'
    return 'field_work'
  }

  // Fallback — intake, closeout, production, and any unrecognized group
  return 'internal_work'
}

// Universal operational state classifier — what stage is this milestone in
// right now? Independent of queue or domain. Returns one of:
//   'blocked'           — cannot act yet (status=blocked OR locked not_started)
//   'awaiting_internal' — actionable internal work to advance it
//   'awaiting_external' — sent out, waiting for external party response
//   'handoff_pending'   — done, but a cross-group downstream milestone has not
//                         picked up. Cross-group is the precise definition of
//                         operational handoff drift (e.g., design→stone,
//                         stone→production, production→install). Same-group
//                         downstream not_started is just normal workflow
//                         progression and is NOT flagged.
//   'complete'          — done
//   'skipped'           — not_needed
//
// Queues map these state codes to their own section labels; NRA composes over
// the same codes. Renamed from 'received_unprocessed' once Production made
// clear the signal is about cross-group orchestration, not receive-role drift.
export function getMilestoneSectionKey(milestone, allInJob) {
  if (!milestone) return null
  const status = milestone.status
  const role = getMilestoneOperationalRole(milestone)

  if (status === 'not_needed') return 'skipped'
  if (status === 'blocked')    return 'blocked'

  const byKey = new Map((allInJob || []).map(m => [m.milestone_key, m]))
  if (status === 'not_started' && hasUnsatisfiedRequires(milestone, byKey)) {
    return 'blocked'
  }

  if (status === 'done') {
    // Cross-group handoff drift: this milestone is done, and any downstream
    // milestone IN A DIFFERENT GROUP is not_started. The next team hasn't
    // picked it up. Intra-group "drift" (stencil_created done → stencil_cut
    // not_started) is normal workflow progression and is intentionally not
    // flagged here.
    if (_hasCrossGroupDownstreamNotStarted(milestone, allInJob)) {
      return 'handoff_pending'
    }
    return 'complete'
  }

  // Active statuses (not_started unlocked, in_progress)
  const isSend = role === 'send_to_customer'
              || role === 'send_to_supplier'
              || role === 'send_to_cemetery'
  if (isSend && status === 'in_progress') return 'awaiting_external'

  // Receive milestones that are pending (not yet done) — still awaiting external.
  // Both not_started (after requires are satisfied) and in_progress count: an
  // actively-pending receive is by definition waiting on the external party,
  // not internal work. The locked not_started case is already caught above.
  const isReceive = role === 'receive_from_customer'
                 || role === 'receive_from_supplier'
                 || role === 'receive_from_cemetery'
  if (isReceive && (status === 'in_progress' || status === 'not_started')) {
    return 'awaiting_external'
  }

  // Everything else actionable defaults to internal work (internal_work,
  // scheduling, field_work, send_* not yet sent, etc.)
  return 'awaiting_internal'
}

// File-local: does any milestone in this job have `m.milestone_key` in its
// requires[] AND a not_started status AND a different group? This is the
// precise cross-group handoff signal — a milestone is done but the next team
// (different group) hasn't started. Same-group downstream not_started is just
// normal sequential workflow and is intentionally NOT flagged here.
function _hasCrossGroupDownstreamNotStarted(m, allInJob) {
  if (!m || !m.milestone_key) return false
  for (const other of (allInJob || [])) {
    if (other.status !== 'not_started') continue
    if (!other.requires || other.requires.length === 0) continue
    if (other.group === m.group) continue
    if (other.requires.includes(m.milestone_key)) return true
  }
  return false
}

// ── Queue derivation — operational lenses on milestone state ────────────────
// Each function takes the array of jobs (as returned by getJobs) and returns
// queue-ready row objects with section assignments and sort applied. UI
// iterates and renders; UI does not filter, sort, or classify.

const LAYOUTS_SECTION_ORDER = [
  'needs_drawing',
  'awaiting_approval',
  'ready_to_advance',
  'blocked',
]

// Maps the universal operational state code to a Layouts-queue section key.
// Returns null if the milestone is not in the Layouts queue.
function _layoutsSectionFor(milestone, allInJob) {
  if (!milestone || milestone.group !== 'design') return null
  if (getMilestoneOperationalRole(milestone) === 'decision') return null
  const state = getMilestoneSectionKey(milestone, allInJob)
  if (state === 'complete' || state === 'skipped' || state == null) return null
  if (state === 'blocked')              return 'blocked'
  if (state === 'awaiting_internal')    return 'needs_drawing'
  if (state === 'awaiting_external')    return 'awaiting_approval'
  if (state === 'handoff_pending')      return 'ready_to_advance'
  // Unclassified — log in dev for smoke-test visibility, suppress in prod.
  if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
    console.warn(
      `[Layouts queue] Unclassified design milestone fell through: ` +
      `key=${milestone.milestone_key} status=${milestone.status} state=${state}`,
    )
  }
  return null
}

export function deriveLayoutsQueueRows(jobs) {
  const rows = []
  for (const job of (jobs || [])) {
    if (job.overall_status === 'closed') continue
    const milestones = job.milestones || []
    const byKey = new Map(milestones.map(m => [m.milestone_key, m]))
    for (const m of milestones) {
      if (m.group !== 'design') continue
      const section = _layoutsSectionFor(m, milestones)
      if (!section) continue
      const overdue = isMilestoneOverdue(m)
      rows.push({
        section,
        milestone: m,
        job,
        order: job.order || null,
        customer: job.customer || null,
        cemetery: job.cemetery || null,
        team: m.team || null,
        agingDays: daysSinceMs(m.updated_at),
        updatedAt: m.updated_at || null,
        overdue,
        overdueDays: overdue ? daysPastDue(m) : 0,
        dueDate: m.due_date || null,
        blockerKeys: (m.requires || []).filter(k => {
          const dep = byKey.get(k)
          return dep && dep.status !== 'done' && dep.status !== 'not_needed'
        }),
        waitingStatus: (job.overall_status || '').startsWith('waiting_')
          ? job.overall_status : null,
      })
    }
  }
  rows.sort((a, b) => {
    const sa = LAYOUTS_SECTION_ORDER.indexOf(a.section)
    const sb = LAYOUTS_SECTION_ORDER.indexOf(b.section)
    if (sa !== sb) return sa - sb
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
    if (a.overdue && b.overdue && a.overdueDays !== b.overdueDays) {
      return b.overdueDays - a.overdueDays
    }
    const aAge = a.agingDays ?? 0
    const bAge = b.agingDays ?? 0
    if (aAge !== bAge) return bAge - aAge
    const aN = a.order?.primary_lastname || ''
    const bN = b.order?.primary_lastname || ''
    if (aN !== bN) return aN.localeCompare(bN)
    const aO = a.order?.order_number || ''
    const bO = b.order?.order_number || ''
    return aO.localeCompare(bO)
  })
  return rows
}

const STONES_SECTION_ORDER = [
  'to_order',
  'ordered_awaiting_supplier',
  'received_awaiting_production',
  'blocked',
]

// Maps the universal operational state code to a Stones-queue section key.
// Returns null if the milestone is not in the Stones queue.
//
// Group boundary: m.group === 'stone' is the entire scope. Downstream
// production milestones (stencil_*, production_*, ready_to_install, etc.)
// have group !== 'stone' and are structurally excluded — they belong to the
// Production queue. The 'received_awaiting_production' section uses the
// universal handoff_pending state to surface the cross-group handoff drift
// without rendering the production milestones themselves.
function _stonesSectionFor(milestone, allInJob) {
  if (!milestone || milestone.group !== 'stone') return null
  if (getMilestoneOperationalRole(milestone) === 'decision') return null
  const state = getMilestoneSectionKey(milestone, allInJob)
  if (state === 'complete' || state === 'skipped' || state == null) return null
  if (state === 'blocked')           return 'blocked'
  if (state === 'awaiting_internal') return 'to_order'
  if (state === 'awaiting_external') return 'ordered_awaiting_supplier'
  if (state === 'handoff_pending')   return 'received_awaiting_production'
  // Unclassified — log in dev for smoke-test visibility, suppress in prod.
  if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
    console.warn(
      `[Stones queue] Unclassified stone milestone fell through: ` +
      `key=${milestone.milestone_key} status=${milestone.status} state=${state}`,
    )
  }
  return null
}

export function deriveStonesQueueRows(jobs) {
  const rows = []
  for (const job of (jobs || [])) {
    if (job.overall_status === 'closed') continue
    const milestones = job.milestones || []
    const byKey = new Map(milestones.map(m => [m.milestone_key, m]))
    for (const m of milestones) {
      if (m.group !== 'stone') continue
      const section = _stonesSectionFor(m, milestones)
      if (!section) continue
      const overdue = isMilestoneOverdue(m)
      rows.push({
        section,
        milestone: m,
        job,
        order: job.order || null,
        customer: job.customer || null,
        cemetery: job.cemetery || null,
        team: m.team || null,
        agingDays: daysSinceMs(m.updated_at),
        updatedAt: m.updated_at || null,
        overdue,
        overdueDays: overdue ? daysPastDue(m) : 0,
        dueDate: m.due_date || null,
        blockerKeys: (m.requires || []).filter(k => {
          const dep = byKey.get(k)
          return dep && dep.status !== 'done' && dep.status !== 'not_needed'
        }),
        waitingStatus: (job.overall_status || '').startsWith('waiting_')
          ? job.overall_status : null,
      })
    }
  }
  rows.sort((a, b) => {
    const sa = STONES_SECTION_ORDER.indexOf(a.section)
    const sb = STONES_SECTION_ORDER.indexOf(b.section)
    if (sa !== sb) return sa - sb
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
    if (a.overdue && b.overdue && a.overdueDays !== b.overdueDays) {
      return b.overdueDays - a.overdueDays
    }
    const aAge = a.agingDays ?? 0
    const bAge = b.agingDays ?? 0
    if (aAge !== bAge) return bAge - aAge
    const aN = a.order?.primary_lastname || ''
    const bN = b.order?.primary_lastname || ''
    if (aN !== bN) return aN.localeCompare(bN)
    const aO = a.order?.order_number || ''
    const bO = b.order?.order_number || ''
    return aO.localeCompare(bO)
  })
  return rows
}

const PRODUCTION_SECTION_ORDER = [
  'stencil_prep_needed',
  'ready_for_carving',
  'in_production',
  'complete_awaiting_install',
  'blocked',
]

// Production-queue stage classifier. Explicit map of milestone_key →
// production-stage code. Pattern matching contained here, never in JSX.
// Adding a new production milestone is a one-line addition; the dev warning
// in _productionSectionFor catches forgotten cases during smoke-test.
//
// Architectural note: this is queue-local pattern matching, analogous to
// (but smaller-scope than) getMilestoneOperationalRole. v2 metadata migration
// will replace the map's internals with template-side metadata reads; the
// helper's signature and consumers stay unchanged.
const PRODUCTION_STAGE_MAP = {
  stencil_created:      'stencil_created',
  stencil_cut:          'stencil_cut',
  production_started:   'production_started',
  production_completed: 'production_completed',
}

function _productionStage(milestone) {
  return PRODUCTION_STAGE_MAP[milestone?.milestone_key] || null
}

// Maps universal state + production stage to a Production-queue section key.
// Section structure (per the corrected operational model):
//   stencil_prep_needed     — stencil_created OR stencil_cut, actionable
//   ready_for_carving       — production_started not_started, all requires met
//   in_production           — production_started in_progress, OR
//                             production_completed actionable
//   complete_awaiting_install — universal handoff_pending (production_completed
//                             done + cross-group ready_to_install not_started)
//   blocked                 — locked or explicitly blocked
//
// Group boundary: m.group === 'production' is the entire scope. Install
// milestones (ready_to_install, installed) are structurally excluded; they
// belong to a future Install queue.
function _productionSectionFor(milestone, allInJob) {
  if (!milestone || milestone.group !== 'production') return null
  if (getMilestoneOperationalRole(milestone) === 'decision') return null

  const state = getMilestoneSectionKey(milestone, allInJob)
  if (state === 'complete' || state === 'skipped' || state == null) return null
  if (state === 'blocked')         return 'blocked'
  if (state === 'handoff_pending') return 'complete_awaiting_install'
  if (state !== 'awaiting_internal') return null

  const stage = _productionStage(milestone)
  if (stage === 'stencil_created' || stage === 'stencil_cut') {
    return 'stencil_prep_needed'
  }
  if (stage === 'production_started') {
    return milestone.status === 'not_started' ? 'ready_for_carving' : 'in_production'
  }
  if (stage === 'production_completed') {
    return 'in_production'
  }

  // Unknown production-group milestone — log in dev for smoke-test visibility.
  // If a new production key is added to a template without updating
  // PRODUCTION_STAGE_MAP, this fires on localhost during testing.
  if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
    console.warn(
      `[Production queue] Unstaged production milestone: ${milestone.milestone_key}`,
    )
  }
  return null
}

export function deriveProductionQueueRows(jobs) {
  const rows = []
  for (const job of (jobs || [])) {
    if (job.overall_status === 'closed') continue
    const milestones = job.milestones || []
    const byKey = new Map(milestones.map(m => [m.milestone_key, m]))
    for (const m of milestones) {
      if (m.group !== 'production') continue
      const section = _productionSectionFor(m, milestones)
      if (!section) continue
      const overdue = isMilestoneOverdue(m)
      rows.push({
        section,
        milestone: m,
        job,
        order: job.order || null,
        customer: job.customer || null,
        cemetery: job.cemetery || null,
        team: m.team || null,
        agingDays: daysSinceMs(m.updated_at),
        updatedAt: m.updated_at || null,
        overdue,
        overdueDays: overdue ? daysPastDue(m) : 0,
        dueDate: m.due_date || null,
        blockerKeys: (m.requires || []).filter(k => {
          const dep = byKey.get(k)
          return dep && dep.status !== 'done' && dep.status !== 'not_needed'
        }),
        waitingStatus: (job.overall_status || '').startsWith('waiting_')
          ? job.overall_status : null,
      })
    }
  }
  rows.sort((a, b) => {
    const sa = PRODUCTION_SECTION_ORDER.indexOf(a.section)
    const sb = PRODUCTION_SECTION_ORDER.indexOf(b.section)
    if (sa !== sb) return sa - sb
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
    if (a.overdue && b.overdue && a.overdueDays !== b.overdueDays) {
      return b.overdueDays - a.overdueDays
    }
    const aAge = a.agingDays ?? 0
    const bAge = b.agingDays ?? 0
    if (aAge !== bAge) return bAge - aAge
    const aN = a.order?.primary_lastname || ''
    const bN = b.order?.primary_lastname || ''
    if (aN !== bN) return aN.localeCompare(bN)
    const aO = a.order?.order_number || ''
    const bO = b.order?.order_number || ''
    return aO.localeCompare(bO)
  })
  return rows
}

export function deriveWaitingOnCustomerQueueRows(jobs) {
  const rows = []
  for (const job of (jobs || [])) {
    if (job.overall_status !== 'waiting_on_customer') continue
    // Identify the most-recent in_progress milestone whose operational
    // waiting party is the customer. Falls back to null if none match.
    const candidates = (job.milestones || []).filter(m =>
      m.status === 'in_progress' && getMilestoneWaitingOn(m) === 'customer'
    )
    candidates.sort((a, b) =>
      new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
    )
    const awaiting = candidates[0] || null
    rows.push({
      job,
      order: job.order || null,
      customer: job.customer || null,
      cemetery: job.cemetery || null,
      awaitingMilestone: awaiting,
      awaitingDays: awaiting ? daysSinceMs(awaiting.updated_at) : null,
      awaitingTeam: awaiting?.team || null,
      daysWaiting: daysSinceUpdate(job),
      jobUpdatedAt: job.last_update_at || null,
    })
  }
  rows.sort((a, b) => {
    const ad = a.daysWaiting ?? 0
    const bd = b.daysWaiting ?? 0
    if (ad !== bd) return bd - ad
    const aN = a.order?.primary_lastname || ''
    const bN = b.order?.primary_lastname || ''
    return aN.localeCompare(bN)
  })
  return rows
}

// =============================================================================
// End of Jobs Operations data layer
// =============================================================================
