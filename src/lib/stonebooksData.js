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

// ── ACTION ITEMS (Today tab) ─────────────────────────────────────────────────
// Returns categorized list of things that need attention.

export async function getActionItems() {
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
          icon: '$',
          label: `${customerName(o.customer)} · balance ${fmtUSD(balance)} overdue`,
          meta: `Target was ${fmtDate(o.target_completion_date)}`,
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
          icon: '!',
          label: `${customerName(o.customer)} · cemetery permit deadline`,
          meta: `${fmtDate(o.cemetery_deadline)} (${Math.ceil((dl - today) / 86400000)}d)`,
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
          icon: '⏱',
          label: `${customerName(o.customer)} · target completion soon`,
          meta: `${fmtDate(o.target_completion_date)} (${Math.ceil((tgt - today) / 86400000)}d)`,
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
          icon: '·',
          label: `${customerName(o.customer)} · draft sitting idle`,
          meta: `Last touched ${fmtRelative(o.updated_at)}`,
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
          icon: '⌛',
          label: `${customerName(o.customer)} · quote not yet contracted`,
          meta: `Quoted ${fmtRelative(o.updated_at)} · ${fmtUSD(total)}`,
        })
      }
    }
  }

  // Sort: red severity first, then amber, then muted; within group, most recent first
  const sevRank = { red: 0, amber: 1, muted: 2 }
  items.sort((a, b) => {
    const dr = sevRank[a.severity] - sevRank[b.severity]
    if (dr !== 0) return dr
    return new Date(b.order.updated_at) - new Date(a.order.updated_at)
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
// Idempotent: if a job already exists for this order, returns that job.
// Requires orders.signed_at to be non-null.
// Writes a job_created event on first creation.

export async function createJobFromOrder(orderId) {
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

export async function setJobOverallStatus(jobId, newStatus, note, { actorUserId } = {}) {
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

  await supabase.from('job_events').insert({
    tenant_id: job.tenant_id,
    job_id: jobId,
    event_type: newStatus === 'closed' ? 'job_closed' : 'job_status_changed',
    payload: { from: job.overall_status, to: newStatus },
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

// =============================================================================
// End of Jobs Operations data layer
// =============================================================================
