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
  // Operational Truth Substrate write-through. Empty-string inputs are
  // normalized to null so the engine can treat "captured then cleared" the
  // same as "never captured" (no false-positive signals).
  if (patch.expected_resolution_at !== undefined) {
    rowPatch.expected_resolution_at = patch.expected_resolution_at || null
  }
  if (patch.external_party_ref !== undefined) {
    const v = (patch.external_party_ref || '').trim()
    rowPatch.external_party_ref = v || null
  }
  if (patch.block_reason_code !== undefined) {
    rowPatch.block_reason_code = patch.block_reason_code || null
  }

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
// @deprecated The Operational Truth Substrate pass introduces structured
// `block_reason_code` and `external_party_ref` columns on job_milestones plus
// a unified `getMilestoneBlockReason` helper. Once the WaitingHintBanner
// consumer is migrated to read the structured fields, this substring matcher
// (and `inferWaitingStatusFromMilestone` below) can be retired in a
// follow-up cleanup sprint. Kept in place tonight to preserve current
// banner behavior — no consumer changes in this pass.
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

// @deprecated See WAITING_HINT_RULES note above. Slated for retirement after
// the WaitingHintBanner consumer migrates to read structured columns.
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

// =============================================================================
// OPERATIONAL TRUTH SUBSTRATE — phase 2 of the OD/OT foundation pass
// =============================================================================
// Three new helpers that compose on the new `expected_resolution_at`,
// `block_reason_code`, and `external_party_ref` columns on `job_milestones`.
//
// Design rules:
//   • All helpers tolerate NULL on the new columns — pre-migration rows must
//     keep working exactly as before.
//   • No new state machine. These helpers READ structured fields and report.
//     Writing the fields is the milestone editor's job (not in scope tonight).
//   • Pure functions. No DB calls. Easy to compose into Today / Queues / NRA.
// =============================================================================

// The structured block-reason vocabulary. Mirrors the CHECK constraint in
// supabase/operational_truth_substrate_migration.sql. Exported so UI editors
// (future) can render a select against the canonical list.
export const BLOCK_REASON_CODES = [
  { code: 'awaiting_decision', label: 'Awaiting a decision',           short: 'needs a decision' },
  { code: 'awaiting_money',    label: 'Waiting on payment',            short: 'waiting on payment' },
  { code: 'awaiting_upstream', label: 'Waiting on an upstream step',   short: 'upstream step incomplete' },
  { code: 'vendor_silent',     label: 'Supplier hasn\'t responded',    short: 'supplier silent' },
  { code: 'customer_silent',   label: 'Customer hasn\'t responded',    short: 'customer silent' },
  { code: 'operator_paused',   label: 'Paused by the shop',            short: 'paused' },
]

const BLOCK_REASON_BY_CODE = new Map(BLOCK_REASON_CODES.map(r => [r.code, r]))

export function blockReasonInfo(code) {
  return BLOCK_REASON_BY_CODE.get(code) || null
}

// Returns the structured block reason for a milestone, preferring the
// explicit `block_reason_code` column. Returns null when no reason is
// expressible — caller decides whether to fall back to inference helpers
// like `_walkBlockerChain` (which name WHO the blocker is) for the
// upstream chain. This helper answers "WHY," not "WHO."
//
// Shape: { code, label, short } or null.
export function getMilestoneBlockReason(milestone) {
  if (!milestone) return null
  const code = milestone.block_reason_code
  if (!code) return null
  return BLOCK_REASON_BY_CODE.get(code) || { code, label: code, short: code }
}

// Returns whether a milestone is late against the EXTERNAL party's quoted
// resolution date. Distinct from `isMilestoneOverdue` which checks our
// internal `due_date` target. Used by Today / Queues to distinguish
// "in transit on schedule" from "supplier broke their quoted date."
//
// Returns:
//   • null    — no `expected_resolution_at` set; lateness against expectation
//               is unknowable. Caller can fall back to internal due_date.
//   • false   — expectation set and today is on or before the quoted date.
//   • object  — { daysLate: N } where N >= 1 — the external party is past
//               their committed date by N calendar days.
export function isLateAgainstExpectedResolution(milestone, today = new Date()) {
  if (!milestone || !milestone.expected_resolution_at) return null
  const expected = new Date(`${milestone.expected_resolution_at.slice(0, 10)}T00:00:00`)
  const t = new Date(today)
  t.setHours(0, 0, 0, 0)
  if (expected >= t) return false
  const daysLate = Math.floor((t - expected) / 86400000)
  return { daysLate }
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

// ── Next Required Action (NRA) — per-job operational primitive ──────────────
// Pure derived helper. Given a job (with joined order + milestones), returns
// the single most-relevant next action as a structured NRAResult, or null if
// the job is missing.
//
// Resolution priority (first match wins):
//   1. closed                       — terminal, no action
//   2. job_complete                 — paid + all done
//   3. follow_up_external           — overall_status starts with waiting_on_
//   4. collect_deposit              — balance unpaid + production-actionable
//   5. collect_balance              — production_completed done + install pending
//   6. resolve_decision             — open decision milestone ready
//   7. advance_milestone (active)   — any in_progress milestone (latest updated)
//   8. advance_milestone (queued)   — earliest ready not_started milestone
//   9. resolve_blocker              — only blocked/locked remain; walk chain
//  10. unknown                      — fallback (no milestones, or all not_needed)
//
// Composes existing classification helpers (getMilestoneOperationalRole,
// getMilestoneWaitingOn, getMilestoneSectionKey, hasUnsatisfiedRequires,
// isMilestoneOverdue, etc.) — does NOT introduce new classification logic.
//
// Three forward-compatibility hooks are populated when data exists, omitted
// otherwise. These cost nothing now and give future systems a clean point of
// consumption without breaking changes:
//   • team                  — from source milestone's `team` field (ownership lens)
//   • expectedDurationDays  — from MILESTONE_GROUP_DEFAULT_DAYS (time physics)
//   • route                 — reserved for Today→queue navigation (set by callers
//                              later; null here)
//
// NRA returns a SINGLE result per job. Operations needing multi-result lenses
// (queues, Today aggregates) compose NRA across many jobs at their own layer.

export function getNextRequiredAction(job) {
  if (!job) return null

  const milestones = job.milestones || []
  const order = job.order || null
  const byKey = new Map(milestones.map(m => [m.milestone_key, m]))

  // Helper: build the standard result with forward-compat hooks populated.
  // Operational Truth Substrate additions (additive, all nullable):
  //   • blockReasonCode    — structured WHY when the cited milestone is blocked
  //   • expectedResolutionAt — external party's quoted-back date (ISO date)
  //   • externalPartyRef   — free-form party name / reference (e.g. "Coldspring", "PO #4427")
  // Existing fields are untouched; legacy callers see no shape change.
  const result = (kind, label, opts = {}) => {
    const m = opts.milestone || null
    return {
      kind,
      label,
      priority: opts.priority || 'soft',
      party:    opts.party    || null,
      team:     m?.team       || opts.team       || null,
      milestone: m,
      blockers: opts.blockers || [],
      agingDays:  opts.agingDays  ?? (m ? daysSinceMs(m.updated_at) : null),
      overdueDays: opts.overdueDays ?? 0,
      expectedDurationDays:
        m?.group
          ? (MILESTONE_GROUP_DEFAULT_DAYS[m.group] ?? MILESTONE_GROUP_DEFAULT_DAYS._default)
          : null,
      blockReasonCode:      m?.block_reason_code      ?? null,
      expectedResolutionAt: m?.expected_resolution_at ?? null,
      externalPartyRef:     m?.external_party_ref     ?? null,
      route: null,
    }
  }

  // 1. Closed — terminal.
  if (job.overall_status === 'closed') {
    return result('closed', 'Closed — no action required', { priority: 'none' })
  }

  // 2. Job complete — paid in full + all non-skipped milestones done.
  const balance = order ? rowBalanceDue(order) : 0
  const activeMs = milestones.filter(m => m.status !== 'not_needed')
  const allDone  = activeMs.length > 0 && activeMs.every(m => m.status === 'done')
  if (allDone && balance <= 0) {
    return result('job_complete', 'All work complete — close out', { priority: 'soft' })
  }

  // 3. Explicit waiting state on the job. Find the in_progress milestone whose
  // operational waiting party matches. Falls back to any in_progress milestone
  // if no perfect match, or to job-level aging if no milestone is in_progress.
  if (job.overall_status?.startsWith('waiting_on_')) {
    const party = job.overall_status.replace('waiting_on_', '')
    const matching = milestones
      .filter(m => m.status === 'in_progress' && getMilestoneWaitingOn(m) === party)
      .sort((a, b) =>
        new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
      )[0]
    const fallback = matching || milestones
      .filter(m => m.status === 'in_progress')
      .sort((a, b) =>
        new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
      )[0]
    const aging = fallback ? daysSinceMs(fallback.updated_at) : daysSinceUpdate(job)
    const priority = aging >= 14 ? 'urgent' : aging >= 7 ? 'normal' : 'soft'
    return result(
      'follow_up_external',
      `Follow up with ${party}${fallback ? ` — ${fallback.label}` : ''}`,
      { milestone: fallback, party, priority, agingDays: aging },
    )
  }

  // 4. Collect deposit — balance unpaid AND any production-side milestone is
  // actionable AND no payment received yet. Money blockers are operational.
  const totalPaid = order ? rowTotalPaid(order) : 0
  const productionActionable = milestones.some(m =>
    (m.group === 'production' || m.group === 'stone') &&
    (m.status === 'in_progress' ||
      (m.status === 'not_started' && !hasUnsatisfiedRequires(m, byKey)))
  )
  if (balance > 0 && totalPaid <= 0 && productionActionable) {
    return result('collect_deposit', 'Collect deposit before production', {
      priority: 'urgent',
    })
  }

  // 5. Collect balance — production_completed done AND ready_to_install
  // not_started AND balance still outstanding.
  const productionCompleted = byKey.get('production_completed')
  const readyToInstall      = byKey.get('ready_to_install')
  if (
    balance > 0 &&
    productionCompleted?.status === 'done' &&
    readyToInstall?.status === 'not_started'
  ) {
    return result('collect_balance', 'Collect balance before install', {
      priority: 'urgent',
    })
  }

  // 6. Open decision — is_decision milestone that's ready but not started.
  const openDecision = milestones.find(m =>
    m.is_decision &&
    m.status === 'not_started' &&
    !hasUnsatisfiedRequires(m, byKey)
  )
  if (openDecision) {
    return result('resolve_decision', `Decide: ${openDecision.label}`, {
      milestone: openDecision,
      priority: 'normal',
    })
  }

  // 7. Any in_progress milestone — pick most-recently-updated (the one staff
  // most recently touched is most likely what's active).
  const inProgress = milestones
    .filter(m => m.status === 'in_progress')
    .sort((a, b) =>
      new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
    )[0]
  if (inProgress) {
    const overdue = isMilestoneOverdue(inProgress)
    const idleDays = daysSinceMs(inProgress.updated_at) || 0
    const priority = overdue ? 'urgent' : idleDays >= 5 ? 'normal' : 'soft'
    const party = getMilestoneWaitingOn(inProgress)
    return result('advance_milestone', inProgress.label, {
      milestone: inProgress,
      party: party === 'internal' ? null : party,
      priority,
      overdueDays: overdue ? daysPastDue(inProgress) : 0,
    })
  }

  // 8. Earliest ready not_started milestone (workflow order).
  const readyNotStarted = milestones
    .filter(m =>
      m.status === 'not_started' && !hasUnsatisfiedRequires(m, byKey)
    )
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))[0]
  if (readyNotStarted) {
    return result('advance_milestone', readyNotStarted.label, {
      milestone: readyNotStarted,
      priority: 'normal',
    })
  }

  // 9. Only blocked/locked milestones remain — walk the requires chain from
  // the earliest blocked milestone to find the actual leaf blocker.
  const blocked = milestones
    .filter(m =>
      m.status === 'blocked' ||
      (m.status === 'not_started' && hasUnsatisfiedRequires(m, byKey))
    )
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))[0]
  if (blocked) {
    const { leaf, chain } = _walkBlockerChain(blocked, byKey)
    return result('resolve_blocker', `Resolve blocker: ${leaf.label}`, {
      milestone: leaf,
      blockers: chain,
      priority: 'normal',
    })
  }

  // 10. Fallback — no milestones, all not_needed, or unexpected state.
  return result('unknown', 'No action identified', { priority: 'soft' })
}

// File-local. Walks the requires[] chain from a blocked milestone to find the
// leaf upstream blocker — the deepest milestone that's not done AND has no
// unmet requires of its own. Cycle-protected via depth cap.
function _walkBlockerChain(start, byKey) {
  const chain = []
  let current = start
  for (let depth = 0; depth < 20; depth++) {
    const unmet = (current.requires || []).filter(k => {
      const dep = byKey.get(k)
      return dep && dep.status !== 'done' && dep.status !== 'not_needed'
    })
    if (unmet.length === 0) break
    // Follow the first unmet dependency. Record this key as part of the chain.
    chain.push(current.milestone_key)
    const next = byKey.get(unmet[0])
    if (!next) break
    current = next
  }
  return { leaf: current, chain }
}


// =============================================================================
// DEPARTMENT BUCKETS — operational lens for the Jobs tab (L2-followup)
// =============================================================================
// Each department (Production, Installation, …) exposes a set of buckets.
// A bucket is { code, label, subline, count, urgency, rows, dataGap, sortLabel,
// grouping }. Buckets are derived from the existing milestone substrate; no
// schema changes. Gap buckets (work the business does but doesn't yet have a
// milestone for) render with count 0 and `dataGap: true` so the operational
// shape is visible from day one and the gap is honest.
//
// All pattern matching against milestone_key is contained in this file. The
// React components in src/components/Jobs* read structured shapes only.
// =============================================================================

// Stage chip palette. Amber and red are RESERVED for urgency, never used as
// stage colors. When a row is in an amber/red urgency state, the stage chip
// yields to the urgency ramp so the row reads as one signal, not two.
export const STAGE_CHIP_PALETTE = {
  intake:     { code: 'blue',   text: '#1d4ed8', bg: '#e6efff' },
  design:     { code: 'purple', text: '#7c3aed', bg: '#efe6ff' },
  permit:     { code: 'teal',   text: '#0d8a8a', bg: '#dff3f3' },
  photo:      { code: 'pink',   text: '#be185d', bg: '#fce7f3' },
  etching:    { code: 'pink',   text: '#be185d', bg: '#fce7f3' },
  stone:      { code: 'gray',   text: '#5d5d5a', bg: '#ececea' },
  production: { code: 'gray',   text: '#5d5d5a', bg: '#ececea' },
  foundation: { code: 'coral',  text: '#c2410c', bg: '#ffe6dc' },
  install:    { code: 'green',  text: '#2d7a4f', bg: '#e0f0e6' },
  closeout:   { code: 'gray',   text: '#5d5d5a', bg: '#ececea' },
}
const STAGE_CHIP_FALLBACK = { code: 'gray', text: '#5d5d5a', bg: '#ececea' }
export function stageChipFor(group) {
  return STAGE_CHIP_PALETTE[group] || STAGE_CHIP_FALLBACK
}

// Per-bucket aging thresholds (days). When a row's aging exceeds the threshold
// but the milestone isn't overdue, it earns the amber urgency state. Tune
// after watching the live page for a week (default values per L2-followup spec).
export const BUCKET_AGING_THRESHOLDS = {
  // Production
  rubs_to_grab:              5,
  cut_stencil:               3,
  stick_stencil:             3,
  sandblast:                 4,
  wash_clean:                2,
  foundations:              14,
  // Installation
  inscriptions_onsite:       7,
  new_stone_setting:         7,
  bronze_setting:            7,
  doors_pick_up:             7,
  doors_drop_off:            7,
  installs_scheduled:        7,
  // Admin
  intake_to_complete:        3,
  permits_to_file:           5,
  waiting_cemetery:         14,
  stones_to_order:           3,
  waiting_supplier:         14,
  photos_to_request:         7,
  closeouts:                10,
  // Design
  layouts_to_draw:           5,
  awaiting_layout_approval:  7,
  bronze_layouts_to_draw:    5,
  awaiting_bronze_approval:  7,
  photos_to_log:             3,
  etching_layouts:           5,
  // Inscriptions (cross-department: design + approve in Design, cut in Production)
  inscriptions_to_design:    5,
  inscriptions_to_approve:   7,
  inscriptions_to_cut:       3,
  // Installation field-work data gaps
  acid_washes:               5,
  repairs:                   7,
}

// Three-state urgency. Earned only by signal — never painted by category.
export const URGENCY = { NEUTRAL: 'neutral', AMBER: 'amber', RED: 'red' }

// Classifies a single row's urgency. A row is:
//   • red    — milestone past its internal due_date, OR external party past
//              their `expected_resolution_at` (the substrate's quoted-back date)
//   • amber  — aging beyond the bucket's threshold (no due_date breach yet)
//   • neutral — fresh enough to be calm
export function classifyRowUrgency(row, threshold) {
  if (!row) return URGENCY.NEUTRAL
  if (row.overdue) return URGENCY.RED
  const late = row.milestone ? isLateAgainstExpectedResolution(row.milestone) : null
  if (late && late.daysLate > 0) return URGENCY.RED
  const age = row.agingDays ?? 0
  if (threshold && age > threshold) return URGENCY.AMBER
  return URGENCY.NEUTRAL
}

// Returns the worst urgency across an array of rows. Used by bucket cards.
export function worstUrgency(rows) {
  let worst = URGENCY.NEUTRAL
  for (const r of (rows || [])) {
    if (r.urgency === URGENCY.RED) return URGENCY.RED
    if (r.urgency === URGENCY.AMBER) worst = URGENCY.AMBER
  }
  return worst
}

// ─── Row builders ───────────────────────────────────────────────────────────
// Shared row shape across queues:
//   { kind: 'milestone', job, order, customer, cemetery, milestone, stage,
//     agingDays, overdue, overdueDays, dueDate, owner, urgency, plot? }
// Where `kind: 'cemetery-header'` is reserved for the location-grouped panel.

function _buildMilestoneRow(job, milestone, opts = {}) {
  if (!job || !milestone) return null
  const overdue = isMilestoneOverdue(milestone)
  return {
    kind: 'milestone',
    job,
    order: job.order || null,
    customer: job.customer || null,
    cemetery: job.cemetery || null,
    milestone,
    stage: stageChipFor(milestone.group),
    agingDays: daysSinceMs(milestone.updated_at),
    overdue,
    overdueDays: overdue ? daysPastDue(milestone) : 0,
    dueDate: milestone.due_date || null,
    owner: milestone.team || null,
    plot: opts.plot || null,
  }
}

// Standard sort: red urgency first, then amber, then by aging desc, then by
// surname asc. Stable enough for "worst first" reading.
function _sortByUrgencyThenAging(rows) {
  return rows.slice().sort((a, b) => {
    const ua = a.urgency === URGENCY.RED ? 0 : a.urgency === URGENCY.AMBER ? 1 : 2
    const ub = b.urgency === URGENCY.RED ? 0 : b.urgency === URGENCY.AMBER ? 1 : 2
    if (ua !== ub) return ua - ub
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
    if (a.overdue && b.overdue && a.overdueDays !== b.overdueDays) {
      return b.overdueDays - a.overdueDays
    }
    const aAge = a.agingDays ?? 0
    const bAge = b.agingDays ?? 0
    if (aAge !== bAge) return bAge - aAge
    const aN = a.order?.primary_lastname || ''
    const bN = b.order?.primary_lastname || ''
    return aN.localeCompare(bN)
  })
}

// ─── PRODUCTION buckets ─────────────────────────────────────────────────────

// Cut stencil — actionable `stencil_cut` on non-inscription jobs. Inscription
// jobs route to the dedicated `inscriptions_to_cut` bucket below so the queue
// reads as one operational pipeline (designer → approval → cut on plotter).
function _bucketCutStencil(jobs) {
  const rows = []
  for (const job of (jobs || [])) {
    if (job.overall_status === 'closed') continue
    if (job.job_type === 'inscription') continue
    const byKey = new Map((job.milestones || []).map(m => [m.milestone_key, m]))
    const m = byKey.get('stencil_cut')
    if (!m) continue
    if (m.status === 'done' || m.status === 'not_needed') continue
    if (m.status === 'not_started' && hasUnsatisfiedRequires(m, byKey)) continue
    rows.push(_buildMilestoneRow(job, m))
  }
  return _attachUrgency(rows, BUCKET_AGING_THRESHOLDS.cut_stencil)
}

// Stick stencil — INFERRED. `stencil_cut` done AND `production_started`
// not_started ready (i.e. cut is done, sandblast hasn't started yet).
// TODO(L3+): add a real `stencil_stuck` milestone to the new_stone template
// and retire the inferred signal here.
function _bucketStickStencil(jobs) {
  const rows = []
  for (const job of (jobs || [])) {
    if (job.overall_status === 'closed') continue
    const byKey = new Map((job.milestones || []).map(m => [m.milestone_key, m]))
    const cut = byKey.get('stencil_cut')
    const blast = byKey.get('production_started')
    if (!cut || !blast) continue
    if (cut.status !== 'done') continue
    if (blast.status !== 'not_started') continue
    if (hasUnsatisfiedRequires(blast, byKey)) continue
    // Anchor the row on stencil_cut (it's done, so its updated_at is when the
    // cut completed — i.e. how long the stencil has been sitting waiting to
    // be stuck onto the stone). That's the right aging signal for this gap.
    rows.push(_buildMilestoneRow(job, cut))
  }
  return _attachUrgency(rows, BUCKET_AGING_THRESHOLDS.stick_stencil)
}

// Sandblast — actionable `production_started` (not_started ready, OR in_progress).
function _bucketSandblast(jobs) {
  const rows = []
  for (const job of (jobs || [])) {
    if (job.overall_status === 'closed') continue
    const byKey = new Map((job.milestones || []).map(m => [m.milestone_key, m]))
    const m = byKey.get('production_started')
    if (!m) continue
    if (m.status === 'done' || m.status === 'not_needed') continue
    if (m.status === 'not_started' && hasUnsatisfiedRequires(m, byKey)) continue
    rows.push(_buildMilestoneRow(job, m))
  }
  return _attachUrgency(rows, BUCKET_AGING_THRESHOLDS.sandblast)
}

// Wash & clean — INFERRED. `production_started` done AND `production_completed`
// not yet done. Anchor on production_completed (the actionable one).
// TODO(L3+): add a real `washed_cleaned` milestone and retire the inferred
// signal here.
function _bucketWashClean(jobs) {
  const rows = []
  for (const job of (jobs || [])) {
    if (job.overall_status === 'closed') continue
    const byKey = new Map((job.milestones || []).map(m => [m.milestone_key, m]))
    const blast = byKey.get('production_started')
    const done  = byKey.get('production_completed')
    if (!blast || !done) continue
    if (blast.status !== 'done') continue
    if (done.status === 'done' || done.status === 'not_needed') continue
    if (done.status === 'not_started' && hasUnsatisfiedRequires(done, byKey)) continue
    rows.push(_buildMilestoneRow(job, done))
  }
  return _attachUrgency(rows, BUCKET_AGING_THRESHOLDS.wash_clean)
}

// Foundations — `foundation_poured` actionable. One bucket in Production;
// hole-dug / poured / complete sub-states don't exist in the current template
// and are deferred (would need new milestones).
function _bucketFoundations(jobs) {
  const rows = []
  for (const job of (jobs || [])) {
    if (job.overall_status === 'closed') continue
    const byKey = new Map((job.milestones || []).map(m => [m.milestone_key, m]))
    for (const m of (job.milestones || [])) {
      if (m.group !== 'foundation') continue
      if (m.status === 'done' || m.status === 'not_needed') continue
      if (m.status === 'not_started' && hasUnsatisfiedRequires(m, byKey)) continue
      rows.push(_buildMilestoneRow(job, m))
    }
  }
  return _attachUrgency(rows, BUCKET_AGING_THRESHOLDS.foundations)
}

// Rubs to grab — GAP. Pre-stencil cemetery tracing step doesn't exist in any
// template today. Render as a card with count 0 and dataGap: true so the
// operational shape is visible. The card's row panel renders a calm
// "Not wired yet — needs a new milestone." message instead of an empty table.
// TODO(L3+): add a `rub_grabbed` milestone to the inscription / bronze
// templates and a `rub_needed` decision milestone to new_stone (companion
// stones only). Replace the empty array here with a real derive function.

// ─── INSTALLATION buckets ───────────────────────────────────────────────────

// New stone setting — actionable `ready_to_install` on new_stone job types.
function _bucketNewStoneSetting(jobs) {
  const rows = []
  for (const job of (jobs || [])) {
    if (job.overall_status === 'closed') continue
    if (job.job_type !== 'new_stone') continue
    const byKey = new Map((job.milestones || []).map(m => [m.milestone_key, m]))
    const m = byKey.get('ready_to_install')
    if (!m) continue
    if (m.status === 'done' || m.status === 'not_needed') continue
    if (m.status === 'not_started' && hasUnsatisfiedRequires(m, byKey)) continue
    rows.push(_buildMilestoneRow(job, m))
  }
  return _attachUrgency(rows, BUCKET_AGING_THRESHOLDS.new_stone_setting)
}

// Inscriptions on-site — would consume an install-side milestone on the
// inscription template (e.g. `inscription_completed_on_site` or similar). The
// inscription template milestones aren't visible from the app code today; the
// known keys (layout_created, proof_sent, proof_approved) cover the design
// half only. Treat as a gap bucket until the template is inspected and either
// a real install-side milestone is mapped here or a new one is added.
// TODO(L3+): inspect milestone_templates row for job_type='inscription' and
// wire the on-site install milestone if one exists.

// Bronze setting — same situation as inscriptions on-site. Known bronze keys
// (bronze_proof_sent, bronze_proof_approved) cover the layout cycle, not
// install. Treat as a gap bucket.
// TODO(L3+): inspect milestone_templates row for job_type='bronze' and wire
// the install milestone (likely `bronze_set_on_site` or similar).

// Doors to pick up / Doors to drop off — mausoleum door pickup/dropoff. No
// milestones exist anywhere. Pure gap buckets, surfaced so the operational
// shape is visible.
// TODO(L3+): add door-cycle milestones to the new_stone template (or a new
// mausoleum sub-template) and replace these with real derive functions.

// Installs scheduled — would read an install_scheduled_at field or a
// scheduled-status on ready_to_install. Neither exists today. Gap bucket.
// TODO(L3+): add `install_scheduled_at` column to orders or a scheduling
// substate on the install milestone, then derive here.

// ─── ADMIN buckets ──────────────────────────────────────────────────────────
// The Admin role owns office-floor work — intake, permit paperwork, supplier
// POs, photo chasing, closeouts. Some of these buckets are "waiting" queues
// (work the office is tracking but not actively doing — the operational
// question is *who do I need to chase today?*). Those buckets are tagged
// `kind: 'waiting'` in the bucket descriptor and the row variant emphasizes
// the external party and the expected-back date.

// Shared helper — filter a job's milestones to those that are actionable now
// (not done, not skipped, not blocked by unsatisfied requires). Used by every
// "to do" bucket below. Closed jobs are filtered at the outer for-loop.
function _actionableMilestonesByPredicate(jobs, predicate, opts = {}) {
  const onlyStatus = opts.status || null
  const rows = []
  for (const job of (jobs || [])) {
    if (job.overall_status === 'closed') continue
    const byKey = new Map((job.milestones || []).map(m => [m.milestone_key, m]))
    for (const m of (job.milestones || [])) {
      if (!predicate(m)) continue
      if (m.status === 'done' || m.status === 'not_needed') continue
      if (m.status === 'not_started' && hasUnsatisfiedRequires(m, byKey)) continue
      if (onlyStatus && m.status !== onlyStatus) continue
      rows.push(_buildMilestoneRow(job, m))
    }
  }
  return rows
}

// Intake to complete — `intake_complete` actionable. Falls back to any
// actionable milestone in the `intake` group when the canonical key is missing
// (older templates may use a different key name; the group is invariant).
function _bucketIntakeToComplete(jobs) {
  const rows = _actionableMilestonesByPredicate(jobs, m =>
    m.milestone_key === 'intake_complete' || m.group === 'intake'
  )
  return _attachUrgency(rows, BUCKET_AGING_THRESHOLDS.intake_to_complete)
}

// Permits to file — permit-group milestones in `not_started` ready state. Per
// the operational classifier, only the send-side milestones (*_submitted,
// *_filed, to_cemetery) represent work the office actively files. Receive-
// side (*_approved) is the "log the approval" step, not the file step.
function _bucketPermitsToFile(jobs) {
  const rows = _actionableMilestonesByPredicate(
    jobs,
    m => m.group === 'permit' && getMilestoneOperationalRole(m) === 'send_to_cemetery',
    { status: 'not_started' },
  )
  return _attachUrgency(rows, BUCKET_AGING_THRESHOLDS.permits_to_file)
}

// Waiting on cemetery — permit-group milestones in `in_progress`. We've filed
// the permit; the cemetery hasn't responded yet. `expected_resolution_at` (if
// set) drives the row's red-urgency trigger via classifyRowUrgency's existing
// external-party-late check.
function _bucketWaitingCemetery(jobs) {
  const rows = _actionableMilestonesByPredicate(
    jobs,
    m => m.group === 'permit',
    { status: 'in_progress' },
  )
  return _attachUrgency(rows, BUCKET_AGING_THRESHOLDS.waiting_cemetery)
}

// Stones to order — `stone_ordered` in `not_started` ready state. Office
// places the PO.
function _bucketStonesToOrder(jobs) {
  const rows = _actionableMilestonesByPredicate(
    jobs,
    m => m.milestone_key === 'stone_ordered',
    { status: 'not_started' },
  )
  return _attachUrgency(rows, BUCKET_AGING_THRESHOLDS.stones_to_order)
}

// Waiting on supplier — any `stone` or `etching` group milestone in
// `in_progress`. The PO is out; we're waiting on the supplier. Same
// expected-back / past-quoted-date semantics as waiting-on-cemetery.
function _bucketWaitingSupplier(jobs) {
  const rows = _actionableMilestonesByPredicate(
    jobs,
    m => (m.group === 'stone' || m.group === 'etching'),
    { status: 'in_progress' },
  )
  return _attachUrgency(rows, BUCKET_AGING_THRESHOLDS.waiting_supplier)
}

// Photos to request — photo-group send-to-customer milestones not yet started.
// Anchors on `photo_requested` when present; falls back to any photo-group
// milestone whose operational role is `send_to_customer` (defensive against
// template key drift). This is the "we need to ask the customer for the photo"
// queue — distinct from "Photos to log" (Design) which fires once it arrives.
function _bucketPhotosToRequest(jobs) {
  const rows = _actionableMilestonesByPredicate(
    jobs,
    m => m.group === 'photo' && (
      m.milestone_key === 'photo_requested' ||
      getMilestoneOperationalRole(m) === 'send_to_customer'
    ),
    { status: 'not_started' },
  )
  return _attachUrgency(rows, BUCKET_AGING_THRESHOLDS.photos_to_request)
}

// Closeouts — actionable milestones in the `closeout` group. Final paperwork,
// payment confirmation, mark-job-complete. Anchors on group, not a specific
// key, because the closeout templates have several sub-steps.
function _bucketCloseouts(jobs) {
  const rows = _actionableMilestonesByPredicate(jobs, m => m.group === 'closeout')
  return _attachUrgency(rows, BUCKET_AGING_THRESHOLDS.closeouts)
}

// ─── DESIGN buckets ─────────────────────────────────────────────────────────
// The Design role owns layout authoring and customer approval cycles.
// "Layouts to draw" and "Bronze layouts to draw" are the active-work queues;
// the two "Awaiting … approval" queues are waiting queues that surface
// expected-back dates and prompt the chase-the-customer conversation.

// Layouts to draw — `layout_created` or `proof_created` (legacy alias) in
// actionable state, on NON-inscription jobs. Either not_started ready (draft
// from scratch) or in_progress. Etching layouts have their own bucket;
// inscription layouts route to the dedicated `inscriptions_to_design` bucket
// below so the inscription pipeline reads as one operator-facing flow.
function _bucketLayoutsToDraw(jobs) {
  const nonInscription = (jobs || []).filter(j => j.job_type !== 'inscription')
  const rows = _actionableMilestonesByPredicate(
    nonInscription,
    m => m.group === 'design' && (
      m.milestone_key === 'layout_created' ||
      m.milestone_key === 'proof_created'
    ),
  )
  return _attachUrgency(rows, BUCKET_AGING_THRESHOLDS.layouts_to_draw)
}

// Awaiting customer approval — `proof_sent` in_progress on non-inscription
// jobs. Inscription approvals route to `inscriptions_to_approve` below.
function _bucketAwaitingLayoutApproval(jobs) {
  const nonInscription = (jobs || []).filter(j => j.job_type !== 'inscription')
  const rows = _actionableMilestonesByPredicate(
    nonInscription,
    m => m.milestone_key === 'proof_sent' || m.milestone_key === 'layout_sent',
    { status: 'in_progress' },
  )
  return _attachUrgency(rows, BUCKET_AGING_THRESHOLDS.awaiting_layout_approval)
}

// ─── INSCRIPTION pipeline (design → approve → cut) ──────────────────────────
// Inscription jobs touch two departments — Design owns the layout + approval
// cycle, Production owns the stencil cut on the shop plotter. Each step has
// its own bucket so the operator sees the handoff explicitly. The inscription
// template re-uses the shared milestone keys (`layout_created`, `proof_sent`,
// `stencil_cut`) so we filter the shared-key buckets to non-inscription jobs
// and surface inscriptions in their own queues here. If the template ever
// gains inscription-specific keys, swap the key strings — the bucket shape
// stays the same.

function _bucketInscriptionsToDesign(jobs) {
  const inscriptionJobs = (jobs || []).filter(j => j.job_type === 'inscription')
  const rows = _actionableMilestonesByPredicate(
    inscriptionJobs,
    m => m.group === 'design' && (
      m.milestone_key === 'layout_created' ||
      m.milestone_key === 'proof_created'
    ),
  )
  return _attachUrgency(rows, BUCKET_AGING_THRESHOLDS.inscriptions_to_design)
}

function _bucketInscriptionsToApprove(jobs) {
  const inscriptionJobs = (jobs || []).filter(j => j.job_type === 'inscription')
  const rows = _actionableMilestonesByPredicate(
    inscriptionJobs,
    m => m.milestone_key === 'proof_sent' || m.milestone_key === 'layout_sent',
    { status: 'in_progress' },
  )
  return _attachUrgency(rows, BUCKET_AGING_THRESHOLDS.inscriptions_to_approve)
}

function _bucketInscriptionsToCut(jobs) {
  const inscriptionJobs = (jobs || []).filter(j => j.job_type === 'inscription')
  const rows = _actionableMilestonesByPredicate(
    inscriptionJobs,
    m => m.milestone_key === 'stencil_cut',
  )
  return _attachUrgency(rows, BUCKET_AGING_THRESHOLDS.inscriptions_to_cut)
}

// Bronze layouts to draw — `bronze_proof_created` actionable (or legacy
// `bronze_layout_created` if a template ever uses that key).
function _bucketBronzeLayoutsToDraw(jobs) {
  const rows = _actionableMilestonesByPredicate(
    jobs,
    m => m.milestone_key === 'bronze_proof_created' ||
         m.milestone_key === 'bronze_layout_created',
  )
  return _attachUrgency(rows, BUCKET_AGING_THRESHOLDS.bronze_layouts_to_draw)
}

// Awaiting bronze approval — `bronze_proof_sent` in_progress.
function _bucketAwaitingBronzeApproval(jobs) {
  const rows = _actionableMilestonesByPredicate(
    jobs,
    m => m.milestone_key === 'bronze_proof_sent',
    { status: 'in_progress' },
  )
  return _attachUrgency(rows, BUCKET_AGING_THRESHOLDS.awaiting_bronze_approval)
}

// Photos to log — `photo_received` actionable. The customer-supplied photo
// arrived; design needs to log it and apply it to the layout.
function _bucketPhotosToLog(jobs) {
  const rows = _actionableMilestonesByPredicate(
    jobs,
    m => m.milestone_key === 'photo_received',
  )
  return _attachUrgency(rows, BUCKET_AGING_THRESHOLDS.photos_to_log)
}

// Etching layouts — any actionable milestone in the `etching` group. Etching
// templates today have author/sent/approved sub-steps; this surfaces them all
// in one bucket until they earn their own queues.
function _bucketEtchingLayouts(jobs) {
  const rows = _actionableMilestonesByPredicate(jobs, m => m.group === 'etching')
  return _attachUrgency(rows, BUCKET_AGING_THRESHOLDS.etching_layouts)
}

// ─── Urgency attachment + bucket assembly ───────────────────────────────────

function _attachUrgency(rows, threshold) {
  return _sortByUrgencyThenAging(
    rows.filter(Boolean).map(r => ({ ...r, urgency: classifyRowUrgency(r, threshold) }))
  )
}

// ─── RUBS — location-grouped (by cemetery) ──────────────────────────────────
// Reusable grouping pattern: returns { groups: [{ cemetery, rows }] } when
// the bucket is location-grouped. Components use `bucket.grouping === 'cemetery'`
// to switch between flat-panel and grouped-panel render. (Rubs is a gap bucket
// today, so this returns an empty groups array — but the grouping flag stays
// on the bucket so the panel renders the location-grouped empty state, which
// is the operational shape we want visible.)
function _groupRowsByCemetery(rows) {
  const map = new Map()
  for (const r of rows) {
    const key = r.cemetery?.id || '__none__'
    if (!map.has(key)) {
      map.set(key, { cemetery: r.cemetery || null, rows: [] })
    }
    map.get(key).rows.push(r)
  }
  return Array.from(map.values()).sort((a, b) => {
    const an = a.cemetery?.name || 'zzz'
    const bn = b.cemetery?.name || 'zzz'
    return an.localeCompare(bn)
  })
}

// ─── Bucket assembly per department ─────────────────────────────────────────

function _bucket(code, label, rows, opts = {}) {
  const dataGap = !!opts.dataGap
  const subline = opts.subline || null
  const kind = opts.kind || null   // 'waiting' for queues that are tracking, not doing
  const sortLabel = opts.sortLabel || (kind === 'waiting' ? 'Sorted by days waiting' : 'Sorted by aging')
  const grouping = opts.grouping || null
  return {
    code,
    label,
    rows,
    count: rows.length,
    urgency: dataGap ? URGENCY.NEUTRAL : worstUrgency(rows),
    dataGap,
    subline,
    kind,
    sortLabel,
    grouping,
    groups: grouping === 'cemetery' ? _groupRowsByCemetery(rows) : null,
  }
}

function _agingSummary(rows, threshold) {
  if (!rows.length) return null
  const reds = rows.filter(r => r.urgency === URGENCY.RED).length
  const ambers = rows.filter(r => r.urgency === URGENCY.AMBER).length
  if (reds > 0) return `${reds} overdue`
  if (ambers > 0) return `${ambers} aging > ${threshold}d`
  return 'all calm'
}

// Subline variant for waiting buckets — the operational question is "is anyone
// past their quoted date?" rather than "how long has the work been sitting?"
// Red rows here mean the external party broke their committed-back date.
function _waitingSummary(rows, threshold) {
  if (!rows.length) return null
  const reds = rows.filter(r => r.urgency === URGENCY.RED).length
  const ambers = rows.filter(r => r.urgency === URGENCY.AMBER).length
  if (reds > 0) return `${reds} past quoted date`
  if (ambers > 0) return `${ambers} waiting > ${threshold}d`
  return 'all on schedule'
}

export function getProductionBuckets(jobs) {
  const cut       = _bucketCutStencil(jobs)
  const inscCut   = _bucketInscriptionsToCut(jobs)
  const stick     = _bucketStickStencil(jobs)
  const blast     = _bucketSandblast(jobs)
  const wash      = _bucketWashClean(jobs)
  const found     = _bucketFoundations(jobs)
  return [
    _bucket('rubs_to_grab', 'Rubs to grab', [], {
      dataGap: true,
      subline: 'Not wired yet — needs a new milestone',
      grouping: 'cemetery',
      sortLabel: 'Grouped by cemetery — one trip each',
    }),
    _bucket('cut_stencil', 'Cut stencil', cut, {
      subline: _agingSummary(cut, BUCKET_AGING_THRESHOLDS.cut_stencil),
    }),
    // Inscription-side stencil cut. Same plotter work as `cut_stencil`, but
    // for inscription jobs (the customer-approved layout becomes a stencil
    // cut for field application). Sits next to Cut stencil so the operator
    // sees the two stencil queues together.
    _bucket('inscriptions_to_cut', 'Inscriptions to cut', inscCut, {
      subline: _agingSummary(inscCut, BUCKET_AGING_THRESHOLDS.inscriptions_to_cut),
    }),
    _bucket('stick_stencil', 'Stick stencil', stick, {
      dataGap: true,
      subline: stick.length
        ? `${stick.length} inferred from cut + pre-blast`
        : 'Inferred from cut + pre-blast — needs its own milestone',
    }),
    _bucket('sandblast', 'Sandblast', blast, {
      subline: _agingSummary(blast, BUCKET_AGING_THRESHOLDS.sandblast),
    }),
    _bucket('wash_clean', 'Wash & clean', wash, {
      dataGap: true,
      subline: wash.length
        ? `${wash.length} inferred — derived signal`
        : 'Inferred from post-blast gap — needs its own milestone',
    }),
    _bucket('foundations', 'Foundations', found, {
      subline: _agingSummary(found, BUCKET_AGING_THRESHOLDS.foundations),
    }),
  ]
}

export function getAdminBuckets(jobs) {
  const intake     = _bucketIntakeToComplete(jobs)
  const permitsTo  = _bucketPermitsToFile(jobs)
  const waitingCem = _bucketWaitingCemetery(jobs)
  const stonesTo   = _bucketStonesToOrder(jobs)
  const waitingSup = _bucketWaitingSupplier(jobs)
  const photosReq  = _bucketPhotosToRequest(jobs)
  const closeouts  = _bucketCloseouts(jobs)
  return [
    _bucket('intake_to_complete', 'Intake to complete', intake, {
      subline: _agingSummary(intake, BUCKET_AGING_THRESHOLDS.intake_to_complete),
    }),
    _bucket('permits_to_file', 'Permits to file', permitsTo, {
      subline: _agingSummary(permitsTo, BUCKET_AGING_THRESHOLDS.permits_to_file),
    }),
    _bucket('waiting_cemetery', 'Waiting on cemetery', waitingCem, {
      kind: 'waiting',
      subline: _waitingSummary(waitingCem, BUCKET_AGING_THRESHOLDS.waiting_cemetery),
    }),
    _bucket('stones_to_order', 'Stones to order', stonesTo, {
      subline: _agingSummary(stonesTo, BUCKET_AGING_THRESHOLDS.stones_to_order),
    }),
    _bucket('waiting_supplier', 'Waiting on supplier', waitingSup, {
      kind: 'waiting',
      subline: _waitingSummary(waitingSup, BUCKET_AGING_THRESHOLDS.waiting_supplier),
    }),
    _bucket('photos_to_request', 'Photos to request', photosReq, {
      subline: _agingSummary(photosReq, BUCKET_AGING_THRESHOLDS.photos_to_request),
    }),
    _bucket('closeouts', 'Closeouts', closeouts, {
      subline: _agingSummary(closeouts, BUCKET_AGING_THRESHOLDS.closeouts),
    }),
  ]
}

export function getDesignBuckets(jobs) {
  const layouts        = _bucketLayoutsToDraw(jobs)
  const awaitingLayout = _bucketAwaitingLayoutApproval(jobs)
  const inscDesign     = _bucketInscriptionsToDesign(jobs)
  const inscApprove    = _bucketInscriptionsToApprove(jobs)
  const bronzeLayouts  = _bucketBronzeLayoutsToDraw(jobs)
  const awaitingBronze = _bucketAwaitingBronzeApproval(jobs)
  const photosLog      = _bucketPhotosToLog(jobs)
  const etching        = _bucketEtchingLayouts(jobs)
  return [
    _bucket('layouts_to_draw', 'Layouts to draw', layouts, {
      subline: _agingSummary(layouts, BUCKET_AGING_THRESHOLDS.layouts_to_draw),
    }),
    _bucket('awaiting_layout_approval', 'Awaiting customer approval', awaitingLayout, {
      kind: 'waiting',
      subline: _waitingSummary(awaitingLayout, BUCKET_AGING_THRESHOLDS.awaiting_layout_approval),
    }),
    _bucket('inscriptions_to_design', 'Inscriptions to design', inscDesign, {
      subline: _agingSummary(inscDesign, BUCKET_AGING_THRESHOLDS.inscriptions_to_design),
    }),
    _bucket('inscriptions_to_approve', 'Inscriptions to approve', inscApprove, {
      kind: 'waiting',
      subline: _waitingSummary(inscApprove, BUCKET_AGING_THRESHOLDS.inscriptions_to_approve),
    }),
    _bucket('bronze_layouts_to_draw', 'Bronze layouts to draw', bronzeLayouts, {
      subline: _agingSummary(bronzeLayouts, BUCKET_AGING_THRESHOLDS.bronze_layouts_to_draw),
    }),
    _bucket('awaiting_bronze_approval', 'Awaiting bronze approval', awaitingBronze, {
      kind: 'waiting',
      subline: _waitingSummary(awaitingBronze, BUCKET_AGING_THRESHOLDS.awaiting_bronze_approval),
    }),
    _bucket('photos_to_log', 'Photos to log', photosLog, {
      subline: _agingSummary(photosLog, BUCKET_AGING_THRESHOLDS.photos_to_log),
    }),
    _bucket('etching_layouts', 'Etching layouts', etching, {
      subline: _agingSummary(etching, BUCKET_AGING_THRESHOLDS.etching_layouts),
    }),
  ]
}

export function getInstallationBuckets(jobs) {
  const newStone = _bucketNewStoneSetting(jobs)
  return [
    _bucket('inscriptions_onsite', 'Inscriptions on-site', [], {
      dataGap: true,
      subline: 'Not wired yet — needs inscription template install milestone',
    }),
    _bucket('new_stone_setting', 'New stone setting', newStone, {
      subline: _agingSummary(newStone, BUCKET_AGING_THRESHOLDS.new_stone_setting),
    }),
    // Acid washes & Repairs — separate field-work types from the cleaning_
    // repair job_type. The template's install-side milestones aren't visible
    // from app code today, so these are honest data gaps. Once the cleaning_
    // repair template is wired with an actionable on-site milestone, swap
    // these for real derive functions (see TODO above _bucketNewStoneSetting).
    _bucket('acid_washes', 'Acid washes', [], {
      dataGap: true,
      subline: 'Not wired yet — needs a new milestone',
    }),
    _bucket('repairs', 'Repairs', [], {
      dataGap: true,
      subline: 'Not wired yet — needs a new milestone',
    }),
    _bucket('bronze_setting', 'Bronze setting', [], {
      dataGap: true,
      subline: 'Not wired yet — needs bronze template install milestone',
    }),
    _bucket('doors_pick_up', 'Doors to pick up', [], {
      dataGap: true,
      subline: 'Not wired yet — needs a new milestone',
    }),
    _bucket('doors_drop_off', 'Doors to drop off', [], {
      dataGap: true,
      subline: 'Not wired yet — needs a new milestone',
    }),
    _bucket('installs_scheduled', 'Installs scheduled', [], {
      dataGap: true,
      subline: 'Not wired yet — needs a schedule field on the install milestone',
    }),
  ]
}

// Department descriptor — used by the role selector + the Owner stack.
// Stubs surface as cards with no buckets and a single "Coming soon" panel.
// Sales stays a stub on purpose — most sales work happens in the Orders tab
// before a job exists, so job-stage buckets for Sales would be sparse and
// would feel forced. See the DepartmentStub copy in JobsDepartmentView for
// the operator-facing explanation.
export const DEPARTMENTS = [
  { code: 'admin',        label: 'Admin',        stub: false },
  { code: 'design',       label: 'Design',       stub: false },
  { code: 'sales',        label: 'Sales',        stub: true  },
  { code: 'production',   label: 'Production',   stub: false },
  { code: 'installation', label: 'Installation', stub: false },
]

export function bucketsForDepartment(department, jobs) {
  if (department === 'admin')        return getAdminBuckets(jobs)
  if (department === 'design')       return getDesignBuckets(jobs)
  if (department === 'production')   return getProductionBuckets(jobs)
  if (department === 'installation') return getInstallationBuckets(jobs)
  return null   // stub departments (sales)
}

// =============================================================================
// OWNER OVERVIEW — curated ten-queue operator's view
// =============================================================================
// The Owner role no longer stacks every department by default. Instead it
// presents a curated grid of ten queues — the things that can hold up a job
// at this shop. The "All departments" toggle in the UI keeps the old stacked
// view one click away (persisted via workspaceState.ownerViewMode).
//
// Each card carries a `route` descriptor that the UI consumes on click:
//   { type: 'tab',  tab: 'orders' }                            → switch tab
//   { type: 'role', role: 'admin', bucketCode: 'permits_to_file' } → switch
//      role to that department and scroll to that bucket's queue section.

// Pre-contract order statuses. Anything in this list is still an estimate or
// quote (no contract has been signed yet) — these are the rows that an
// Estimates-follow-up signal can reasonably draw from.
const ESTIMATE_STATUSES = ['draft', 'scoping', 'quoted']

// Estimates needing follow-up — pre-contract orders whose `updated_at` is
// older than `thresholdDays`. Past `redThresholdDays` the row goes red so the
// operator sees a strong nudge to call. Mirrors the legacy `stale_quote`
// signal already used by getActionItems — 14 days has historically been the
// red threshold in this codebase, so we keep that and use 5 days as the
// amber/include threshold per spec.
//
// The signal is imperfect (no structured last_contact column exists), but
// it's the same shape every other stale-order surface in the app uses today.
// When the data model adds a real follow-up timestamp, swap the comparison
// here — the bucket shape stays the same.
export function getEstimatesNeedingFollowup(orders, opts = {}) {
  const thresholdDays = opts.thresholdDays ?? 5
  const redThresholdDays = opts.redThresholdDays ?? 14
  const now = Date.now()
  const rows = []
  for (const o of (orders || [])) {
    if (!o || !ESTIMATE_STATUSES.includes(o.status)) continue
    if (!o.updated_at) continue
    const days = Math.floor((now - new Date(o.updated_at).getTime()) / 86400000)
    if (days < thresholdDays) continue
    const urgency = days >= redThresholdDays ? URGENCY.RED : URGENCY.AMBER
    rows.push({
      kind: 'order',
      order: o,
      customer: o.customer || null,
      agingDays: days,
      overdue: urgency === URGENCY.RED,
      overdueDays: urgency === URGENCY.RED ? days - redThresholdDays : 0,
      urgency,
    })
  }
  rows.sort((a, b) => (b.agingDays ?? 0) - (a.agingDays ?? 0))
  const reds = rows.filter(r => r.urgency === URGENCY.RED).length
  const subline = rows.length === 0
    ? 'all calm'
    : (reds > 0 ? `${reds} over ${redThresholdDays}d` : `${rows.length} over ${thresholdDays}d`)
  return {
    code: 'estimates_to_followup',
    label: 'Estimates to follow up on',
    rows,
    count: rows.length,
    urgency: worstUrgency(rows),
    dataGap: false,
    subline,
    sortLabel: null,
    kind: null,
    grouping: null,
    groups: null,
  }
}

// File-local helper — pull a bucket out of a department-buckets list by code.
// Returns null when missing so the caller can decide whether to surface a
// data-gap placeholder. (Today every code we look up is guaranteed to exist;
// the null path is defensive against future bucket renames.)
function _pickBucket(list, code) {
  return (list || []).find(b => b.code === code) || null
}

// Combine the three inscription buckets into a single Overview card. The
// constituent buckets keep their separate identities inside the department
// views — Overview just aggregates them for at-a-glance scanning. The subline
// names the per-stage counts so the operator can read which stage is heaviest
// without leaving the Overview.
function _combinedInscriptionsBucket(designBuckets, productionBuckets) {
  const b1 = _pickBucket(designBuckets,     'inscriptions_to_design')
  const b2 = _pickBucket(designBuckets,     'inscriptions_to_approve')
  const b3 = _pickBucket(productionBuckets, 'inscriptions_to_cut')
  const rows = [
    ...(b1?.rows || []),
    ...(b2?.rows || []),
    ...(b3?.rows || []),
  ]
  return {
    code: 'inscriptions_pending',
    label: 'Inscriptions pending',
    rows,
    count: rows.length,
    urgency: worstUrgency(rows),
    dataGap: false,
    subline: `${b1?.count || 0} to design · ${b2?.count || 0} awaiting · ${b3?.count || 0} to cut`,
    sortLabel: null,
    kind: null,
    grouping: null,
    groups: null,
  }
}

// The curated ten-card Owner overview. Order matters — this is the operator's
// scanning sequence in the morning (sales pipeline → office prep → design →
// production → installation field work).
export function getOwnerOverviewBuckets(jobs, orders) {
  const admin        = getAdminBuckets(jobs)
  const design       = getDesignBuckets(jobs)
  const production   = getProductionBuckets(jobs)
  const installation = getInstallationBuckets(jobs)

  const estimates       = getEstimatesNeedingFollowup(orders)
  const permitsToFile   = _pickBucket(admin,        'permits_to_file')
  const layoutsToDraw   = _pickBucket(design,       'layouts_to_draw')
  const inscriptions    = _combinedInscriptionsBucket(design, production)
  const stonesToOrder   = _pickBucket(admin,        'stones_to_order')
  const sandblast       = _pickBucket(production,   'sandblast')
  const newStoneSetting = _pickBucket(installation, 'new_stone_setting')
  const acidWashes      = _pickBucket(installation, 'acid_washes')
  const rubs            = _pickBucket(production,   'rubs_to_grab')
  const foundations     = _pickBucket(production,   'foundations')

  // Each card carries a route. Estimates → Orders tab; the inscriptions card
  // routes to Design's first inscription bucket (the head of the pipeline)
  // because the Overview can only send the operator to one queue at a time,
  // and the design stage is where most days start. `_overlay` skips cards
  // whose source bucket is missing — defensive against future bucket-code
  // renames that haven't been mirrored here.
  const _overlay = (source, overrides) => source ? { ...source, ...overrides } : null
  return [
    _overlay(estimates,       { route: { type: 'tab',  tab: 'orders' } }),
    _overlay(permitsToFile,   { route: { type: 'role', role: 'admin',        bucketCode: 'permits_to_file' } }),
    _overlay(layoutsToDraw,   { label: 'Layouts to create',           route: { type: 'role', role: 'design',       bucketCode: 'layouts_to_draw' } }),
    _overlay(inscriptions,    { route: { type: 'role', role: 'design',       bucketCode: 'inscriptions_to_design' } }),
    _overlay(stonesToOrder,   { route: { type: 'role', role: 'admin',        bucketCode: 'stones_to_order' } }),
    _overlay(sandblast,       { label: 'Stones to blast',             route: { type: 'role', role: 'production',   bucketCode: 'sandblast' } }),
    _overlay(newStoneSetting, { label: 'Stones to set',               route: { type: 'role', role: 'installation', bucketCode: 'new_stone_setting' } }),
    _overlay(acidWashes,      { label: 'Acid washes to do',           route: { type: 'role', role: 'installation', bucketCode: 'acid_washes' } }),
    _overlay(rubs,            { label: 'Rubs to take',                route: { type: 'role', role: 'production',   bucketCode: 'rubs_to_grab' } }),
    _overlay(foundations,     { label: 'Foundations to complete',     route: { type: 'role', role: 'production',   bucketCode: 'foundations' } }),
  ].filter(Boolean)
}

// =============================================================================
// TODAY — role-aware operational page
// =============================================================================
// The Today tab becomes a per-role briefing surface: morning sentence, then
// Overdue / Due-today / Aging-this-week sections, each filtered to milestones
// owned by the selected role. The role selector is shared with the Jobs tab
// (workspaceState.getSelectedRole / setSelectedRole).
//
// Mapping a milestone to a role uses the milestone's `team` field first.
// When `team` is missing or generic, fall back to the milestone's `group`
// via ROLE_GROUP_MAP. Owner sees everything (no filter).
//
// "Next action in plain English" is the load-bearing piece — the row leads
// with a verb-phrase the operator can act on, not a milestone key. The map
// lives in NEXT_ACTION_VERB and the resolver is nextActionPhrase(milestone,
// surname). Unknown milestone keys fall back to the milestone's own label.

// Milestone.group → owning role. Inferred from the existing group vocabulary
// used by the templates today. Adjust here if a template adds a new group
// without updating the team field on each milestone.
export const ROLE_GROUP_MAP = {
  intake:     'admin',
  permit:     'admin',
  closeout:   'admin',
  design:     'design',
  photo:      'design',
  etching:    'design',
  stone:      'production',
  production: 'production',
  foundation: 'production',
  install:    'installation',
}

// Resolve a milestone to its owning role.
//   1. If the milestone carries a team value matching one of our roles, use it.
//   2. Otherwise fall back to ROLE_GROUP_MAP[group].
//   3. Otherwise null (treated as unowned).
// Sales rarely owns milestones today — most jobs won't surface anything for
// Sales unless a milestone is explicitly tagged team='sales'. That's the spec.
export function roleForMilestone(milestone) {
  if (!milestone) return null
  const team = milestone.team || null
  if (team === 'admin' || team === 'design' || team === 'sales' ||
      team === 'production' || team === 'installation') {
    return team
  }
  const group = milestone.group || null
  return ROLE_GROUP_MAP[group] || null
}

// Next-action verb-phrase map. Each entry is a pair of phrase-builders —
// `notStarted` for `status='not_started'`, and an optional `inProgress` for
// `status='in_progress'`. Each builder takes the customer surname (already
// nicely-cased) and returns the rendered phrase. Returning different phrases
// for "with surname" vs "without" lets us choose the natural English form for
// each milestone — "Sandblast Anderson" (raw appose), "Cut stencil for
// Anderson" (prepositional), "Pour Anderson's foundation" (possessive).
//
// Tone rules: imperative, sentence-case, short. Production staff read these in
// a glance. Don't say "the" unless the sentence reads worse without it.
export const NEXT_ACTION_VERB = {
  // ── Intake / admin ────────────────────────────────────────────────────────
  intake_complete: {
    notStarted: n => n ? `Complete intake for ${n}` : 'Complete intake',
  },

  // ── Design (layout / proof cycle) ─────────────────────────────────────────
  design_needed: {
    notStarted: n => n ? `Start design for ${n}` : 'Start design',
  },
  layout_created: {
    notStarted: n => n ? `Draft layout for ${n}`         : 'Draft layout',
    inProgress: n => n ? `Finish ${n}'s layout`          : 'Finish the layout',
  },
  proof_created: {
    notStarted: n => n ? `Draft layout for ${n}`         : 'Draft layout',
    inProgress: n => n ? `Finish ${n}'s layout`          : 'Finish the layout',
  },
  proof_sent: {
    notStarted: n => n ? `Send ${n}'s layout to customer` : 'Send layout to customer',
    inProgress: () => 'Waiting on customer to approve layout',
  },
  proof_approved: {
    notStarted: n => n ? `Log ${n}'s layout approval`    : 'Log layout approval',
  },
  bronze_proof_created: {
    notStarted: n => n ? `Draft bronze layout for ${n}`  : 'Draft bronze layout',
    inProgress: n => n ? `Finish ${n}'s bronze layout`   : 'Finish bronze layout',
  },
  bronze_proof_sent: {
    notStarted: n => n ? `Send ${n}'s bronze layout to customer` : 'Send bronze layout to customer',
    inProgress: () => 'Waiting on customer to approve bronze layout',
  },
  bronze_proof_approved: {
    notStarted: n => n ? `Log ${n}'s bronze approval`    : 'Log bronze approval',
  },

  // ── Permit / cemetery ────────────────────────────────────────────────────
  permit_submitted: {
    notStarted: n => n ? `Submit ${n}'s permit to cemetery` : 'Submit permit to cemetery',
    inProgress: () => 'Waiting on cemetery for permit',
  },
  permit_filed: {
    notStarted: n => n ? `Submit ${n}'s permit to cemetery` : 'Submit permit to cemetery',
  },
  permit_approved: {
    notStarted: n => n ? `Log ${n}'s permit approval`    : 'Log permit approval',
  },

  // ── Photo / etching ───────────────────────────────────────────────────────
  photo_requested: {
    notStarted: () => 'Request photo from customer',
    inProgress: () => 'Waiting on customer for photo',
  },
  photo_received: {
    notStarted: n => n ? `Log ${n}'s photo`              : 'Log photo receipt',
  },
  etching_ordered: {
    notStarted: n => n ? `Order etching for ${n}`        : 'Order etching',
    inProgress: () => 'Waiting on etching from supplier',
  },
  etching_received: {
    notStarted: n => n ? `Log ${n}'s etching arrival`    : 'Log etching arrival',
  },

  // ── Stone (supplier cycle) ────────────────────────────────────────────────
  stone_ordered: {
    notStarted: n => n ? `Order stone for ${n}`          : 'Order stone',
    inProgress: () => 'Waiting on stone from supplier',
  },
  stone_received: {
    notStarted: n => n ? `Log ${n}'s stone arrival`      : 'Log stone arrival',
  },

  // ── Production (stencil + sandblast + wash) ───────────────────────────────
  stencil_created: {
    notStarted: n => n ? `Cut stencil for ${n}`          : 'Cut stencil',
    inProgress: n => n ? `Finish cutting ${n}'s stencil` : 'Finish cutting stencil',
  },
  stencil_cut: {
    notStarted: n => n ? `Cut stencil for ${n}`          : 'Cut stencil',
    inProgress: n => n ? `Finish cutting ${n}'s stencil` : 'Finish cutting stencil',
  },
  production_started: {
    notStarted: n => n ? `Sandblast ${n}`                : 'Sandblast',
    inProgress: n => n ? `Finish sandblasting ${n}`      : 'Finish sandblasting',
  },
  production_completed: {
    notStarted: n => n ? `Wash and clean ${n}'s stone`   : 'Wash and clean',
    inProgress: () => 'Finish wash and clean',
  },

  // ── Foundation + install ──────────────────────────────────────────────────
  foundation_poured: {
    notStarted: n => n ? `Pour ${n}'s foundation`        : 'Pour foundation',
    inProgress: n => n ? `Finish pouring ${n}'s foundation` : 'Finish pouring foundation',
  },
  ready_to_install: {
    notStarted: n => n ? `Schedule install for ${n}`     : 'Schedule install',
    inProgress: () => 'Finish scheduling install',
  },
  installed: {
    notStarted: n => n ? `Install ${n}`                  : 'Install',
    inProgress: n => n ? `Finish installing ${n}`        : 'Finish install',
  },

  // ── Closeout ──────────────────────────────────────────────────────────────
  job_closed: {
    notStarted: n => n ? `Close out ${n}'s job`          : 'Close out job',
  },
}

// Resolve the row's primary verb-phrase. Unknown milestone keys fall back to
// the milestone's own label (sentence-cased so the fallback still reads as
// prose, never as a stray identifier fragment). Surname is normalized to
// `Anderson`-shape — uppercased first character, rest lowered — so the row
// reads naturally regardless of how the order's primary_lastname was stored.
export function nextActionPhrase(milestone, surname) {
  if (!milestone) return ''
  const name = (surname || '').trim()
  const nicelyCased = name
    ? name[0].toUpperCase() + name.slice(1).toLowerCase()
    : ''

  const entry = NEXT_ACTION_VERB[milestone.milestone_key]
  if (entry) {
    const fn = milestone.status === 'in_progress' && entry.inProgress
      ? entry.inProgress
      : entry.notStarted
    return fn(nicelyCased)
  }

  const fallback = milestone.label || milestone.milestone_key || ''
  if (!fallback) return ''
  return fallback[0].toUpperCase() + fallback.slice(1)
}

// Today's aging threshold. A milestone whose last activity is older than this
// (in days) is "aging this week" if it's not already overdue. One threshold
// across the Today page keeps the section honest — the page is "this week,"
// not per-bucket pacing.
export const TODAY_AGING_THRESHOLD_DAYS = 7

// Decide whether a milestone is actionable enough to surface on Today.
// Closed jobs, done/not_needed milestones, and locked not_started (requires
// not yet satisfied) are excluded. Everything else is fair game.
function _isMilestoneActionable(milestone, byKey) {
  if (!milestone) return false
  if (milestone.status === 'done' || milestone.status === 'not_needed') return false
  if (milestone.status === 'not_started' && hasUnsatisfiedRequires(milestone, byKey)) return false
  return true
}

// Build a Today row from a (job, milestone) pair. Mirrors the queue row shape
// just enough that the helpers downstream (classifyRowUrgency, worstUrgency)
// can be reused without translation. Adds `nextAction` for the verb-phrase
// the Today row leads with.
function _buildTodayRow(job, milestone) {
  if (!job || !milestone) return null
  const overdue = isMilestoneOverdue(milestone)
  const surname = job.order?.primary_lastname
    || job.customer?.last_name
    || job.customer?.lastName
    || ''
  return {
    kind: 'milestone',
    job,
    order: job.order || null,
    customer: job.customer || null,
    cemetery: job.cemetery || null,
    milestone,
    stage: stageChipFor(milestone.group),
    agingDays: daysSinceMs(milestone.updated_at),
    overdue,
    overdueDays: overdue ? daysPastDue(milestone) : 0,
    dueDate: milestone.due_date || null,
    owner: milestone.team || roleForMilestone(milestone) || null,
    surname,
    nextAction: nextActionPhrase(milestone, surname),
  }
}

// Sort rows worst-first: overdue rows by days-past-due descending, then aging
// rows by aging-days descending, then by surname ascending. Mirrors the
// queue-row "worst first" convention so the operator's eye lands on the most
// urgent row regardless of section.
function _sortTodayRows(rows) {
  return rows.slice().sort((a, b) => {
    if (a.overdueDays !== b.overdueDays) return b.overdueDays - a.overdueDays
    const aAge = a.agingDays ?? 0
    const bAge = b.agingDays ?? 0
    if (aAge !== bAge) return bAge - aAge
    const aN = a.order?.primary_lastname || ''
    const bN = b.order?.primary_lastname || ''
    return aN.localeCompare(bN)
  })
}

// Date helpers used by deriveTodayForRole — keep them file-local so the public
// surface stays small.
function _isoYMDFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Build the morning sentence from the three counts. Role-aware: "Quiet morning
// for design" reads differently than "Quiet morning" globally. Honest counts
// only — when the numbers are zero, the sentence says so plainly.
//
// Sentence shape:
//   The first non-zero clause carries the subject ("N things are overdue" /
//   "N things are due today"); subsequent clauses elide the subject because
//   the reader is already grounded ("N due today" / "N aging").
function _morningSentenceFor(role, { overdue, dueToday, aging }) {
  const isOwner = role === 'owner'
  const noun = isOwner ? 'the shop' : _roleNoun(role)

  if (overdue === 0 && dueToday === 0 && aging === 0) {
    return isOwner
      ? "Quiet morning. Nothing needs attention right now."
      : `Quiet morning for ${noun}. Nothing needs attention right now.`
  }

  const parts = []
  const isFirst = () => parts.length === 0
  const subject = (n) => `${n} ${n === 1 ? 'thing is' : 'things are'}`

  if (overdue > 0) {
    parts.push(`${subject(overdue)} overdue`)
  }
  if (dueToday > 0) {
    parts.push(isFirst() ? `${subject(dueToday)} due today` : `${dueToday} due today`)
  }
  if (aging > 0) {
    parts.push(isFirst() ? `${subject(aging)} aging this week` : `${aging} aging this week`)
  }

  const head = parts.join(', ')
  const suffix = isOwner ? '' : ` for ${noun}`
  return head.charAt(0).toUpperCase() + head.slice(1) + suffix + '.'
}

// Lowercase noun used wherever a role lands inside running prose — the morning
// sentence's "for [role]" tail, the Today empty states ("Nothing due today
// for design"), etc. Exported because TodayTab needs the same vocabulary in
// its empty-section copy. Owner reads as "the shop" (the surface that owner
// stewards), keeping the rest of the prose consistent.
export function roleNoun(role) {
  if (role === 'admin')        return 'admin'
  if (role === 'design')       return 'design'
  if (role === 'sales')        return 'sales'
  if (role === 'production')   return 'production'
  if (role === 'installation') return 'installation'
  return 'the shop'
}
const _roleNoun = roleNoun  // local alias preserves the private callsite below.

// Main Today derive. Returns the morning sentence + three row lists ready to
// render. The page does no further filtering — a section that's empty here is
// empty in the UI.
//
// Filtering rules:
//   • Closed jobs are skipped entirely.
//   • Milestones whose status is done / not_needed / blocked-by-requires are
//     skipped (not actionable today).
//   • Role filter: owner sees everything. Other roles see milestones whose
//     resolved role (roleForMilestone) matches.
//
// Classification rules (one milestone lands in one section):
//   1. Overdue — past internal due_date OR past expected_resolution_at.
//   2. Due today — due_date === today's local YMD (and not overdue).
//   3. Aging — aging beyond TODAY_AGING_THRESHOLD_DAYS (and not overdue/due-today).
//   Everything else is calm and not surfaced.
export function deriveTodayForRole(jobs, role, { now = new Date() } = {}) {
  const todayYMD = _isoYMDFromDate(now)
  const overdueRows  = []
  const dueTodayRows = []
  const agingRows    = []

  for (const job of (jobs || [])) {
    if (!job || job.overall_status === 'closed') continue
    const milestones = job.milestones || []
    const byKey = new Map(milestones.map(m => [m.milestone_key, m]))

    for (const m of milestones) {
      if (!_isMilestoneActionable(m, byKey)) continue
      if (role !== 'owner' && roleForMilestone(m) !== role) continue

      const row = _buildTodayRow(job, m)
      if (!row) continue

      // Past expected_resolution_at counts as overdue even if the internal
      // due_date hasn't passed — the external party broke their quoted date.
      const lateExternal = isLateAgainstExpectedResolution(m, now)
      const isOverdue = row.overdue || (lateExternal && lateExternal.daysLate > 0)

      if (isOverdue) {
        // Use the worst overdue source — internal vs external — for the day count.
        const internalDays = row.overdueDays || 0
        const externalDays = lateExternal && lateExternal.daysLate > 0 ? lateExternal.daysLate : 0
        const worstDays = Math.max(internalDays, externalDays)
        overdueRows.push({
          ...row,
          urgency: URGENCY.RED,
          overdue: true,
          overdueDays: worstDays,
        })
        continue
      }

      if (m.due_date && m.due_date.slice(0, 10) === todayYMD) {
        const age = row.agingDays ?? 0
        const isAlsoAging = age > TODAY_AGING_THRESHOLD_DAYS
        dueTodayRows.push({
          ...row,
          urgency: isAlsoAging ? URGENCY.AMBER : URGENCY.NEUTRAL,
        })
        continue
      }

      if ((row.agingDays ?? 0) > TODAY_AGING_THRESHOLD_DAYS) {
        agingRows.push({
          ...row,
          urgency: URGENCY.AMBER,
        })
        continue
      }
      // Else: calm; intentionally not surfaced on Today.
    }
  }

  const overdue  = _sortTodayRows(overdueRows)
  const dueToday = _sortTodayRows(dueTodayRows)
  const aging    = _sortTodayRows(agingRows)

  return {
    morningSentence: _morningSentenceFor(role, {
      overdue:  overdue.length,
      dueToday: dueToday.length,
      aging:    aging.length,
    }),
    overdue,
    dueToday,
    aging,
    counts: {
      overdue:  overdue.length,
      dueToday: dueToday.length,
      aging:    aging.length,
    },
  }
}

// =============================================================================
// End of Jobs Operations data layer
// =============================================================================
