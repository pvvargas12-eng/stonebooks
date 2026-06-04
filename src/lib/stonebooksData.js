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

// Page through ALL rows of a query in 1000-row batches. PostgREST enforces a
// server-side max-rows cap (1000) that .limit() CANNOT override, so a single
// request silently truncates large tables (the customers table has 1100+ rows;
// late-alphabet customers like "Wermouth" at rank ~1073 fell past row 1000 and
// never loaded — confirmed via Content-Range 0-999/1116). buildQuery must return
// a FRESH PostgREST builder each call so .range() can be applied per page.
export async function fetchAllPaged(buildQuery, pageSize = 1000) {
  let from = 0
  const all = []
  for (;;) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1)
    if (error) { console.error('fetchAllPaged:', error.message); break }
    const batch = data || []
    all.push(...batch)
    if (batch.length < pageSize) break
    from += pageSize
  }
  return all
}

export async function listAllCustomers({ includeArchived = false } = {}) {
  return fetchAllPaged(() => {
    let q = supabase
      .from('customers')
      .select('*')
      .order('last_name', { ascending: true, nullsFirst: false })
    if (!includeArchived) q = q.or('archived.is.null,archived.eq.false')
    return q
  })
}

export async function listArchivedCustomers() {
  return fetchAllPaged(() => supabase
    .from('customers')
    .select('*')
    .eq('archived', true)
    .order('last_name', { ascending: true }))
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
    // Real column is phone_alt (matches customerToRow / the customers schema).
    // Sending the non-existent phone_secondary made every insert fail with
    // PostgREST PGRST204 "Could not find the 'phone_secondary' column".
    phone_alt: customer.phoneSecondary || null,
    email: customer.email || null,
    address_line1: customer.addressLine1 || null,
    address_line2: customer.addressLine2 || null,
    email_alt: customer.emailAlt || null,
    city: customer.city || null,
    state: customer.state || null,
    zip: customer.zip || null,
    // referral_source is a JOB column, not a customers column — never send it
    // here (it caused "Could not find the 'referral_source' column of customers").
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

// `archived`: false → active only (archived is null/false), true → archived
// only, 'all'/undefined → both. `statuses` still narrows by the lifecycle enum
// when provided. The Triage Workbench loads by `archived` and filters status
// client-side.
export async function listAllOrders({ statuses, archived, limit = 500 } = {}) {
  let q = supabase.from('orders').select('*, customer:customers(*), cemetery:cemeteries(*)')
  if (statuses && statuses.length) q = q.in('status', statuses)
  if (archived === false)     q = q.or('archived.is.null,archived.eq.false')
  else if (archived === true) q = q.eq('archived', true)
  q = q.order('updated_at', { ascending: false }).limit(limit)
  const { data, error } = await q
  if (error) { console.error('listAllOrders:', error); return [] }
  return data || []
}

// Single order (read-only) for the Order Detail View — joins customer + cemetery
// like listAllOrders so the detail surface has the same row shape.
export async function getOrderById(id) {
  if (!id) return null
  const { data, error } = await supabase
    .from('orders')
    .select('*, customer:customers(*), cemetery:cemeteries(*)')
    .eq('id', id)
    .maybeSingle()
  if (error) { console.error('getOrderById:', error); return null }
  return data
}

// ── Order emails (Gmail Phase 2 — 20260601_order_emails.sql) ───────────────
// Read the per-order email log (authenticated SELECT). Writes happen only via
// the gmail-send Edge Function (service role).
export async function getOrderEmails(orderId) {
  if (!orderId) return []
  const { data, error } = await supabase
    .from('order_emails')
    .select('*')
    .eq('order_id', orderId)
    .order('sent_at', { ascending: false, nullsFirst: false })
  if (error) { console.warn('[email] getOrderEmails:', error.message); return [] }
  return data || []
}

// List the connected mailbox's recent messages for a folder (read-only).
// label: 'INBOX' | 'SENT' (default INBOX). Tokens stay server-side in the
// gmail-list Edge Function. Returns { ok, messages?, error? }.
export async function gmailListMessages(label = 'INBOX') {
  const folder = label === 'SENT' ? 'SENT' : 'INBOX'
  const { data, error } = await supabase.functions.invoke('gmail-list', { body: { label: folder } })
  if (error) {
    let detail = error.message
    try { const ctx = await error.context?.json?.(); if (ctx?.error) detail = ctx.error } catch { /* ignore */ }
    return { ok: false, error: detail }
  }
  if (data?.error) return { ok: false, error: data.error }
  return { ok: true, messages: data?.messages || [] }
}

// Run inbound auto-association over recent INBOX mail (gmail-sync Edge
// Function). Returns { ok, scanned?, attached?, byThread?, byAddress?, skipped?, error? }.
export async function gmailSyncInbox() {
  const { data, error } = await supabase.functions.invoke('gmail-sync', { body: {} })
  if (error) {
    let detail = error.message
    try { const ctx = await error.context?.json?.(); if (ctx?.error) detail = ctx.error } catch { /* ignore */ }
    return { ok: false, error: detail }
  }
  if (data?.error) return { ok: false, error: data.error }
  return { ok: true, ...data }
}

// For a set of Gmail message ids, return a map { messageId: { orderId,
// orderNumber } } for any that are associated to an order (read-only — reads
// the order_emails log written by gmail-sync / gmail-send). Drives the inbox
// "→ order" badge.
export async function getEmailAssociations(messageIds) {
  if (!Array.isArray(messageIds) || messageIds.length === 0) return {}
  const { data, error } = await supabase
    .from('order_emails')
    .select('gmail_message_id, order_id, order:orders(order_number)')
    .in('gmail_message_id', messageIds)
    .not('order_id', 'is', null)
  if (error) { console.warn('[email] getEmailAssociations:', error.message); return {} }
  const map = {}
  for (const r of data || []) {
    if (r.gmail_message_id) map[r.gmail_message_id] = { orderId: r.order_id, orderNumber: r.order?.order_number || null }
  }
  return map
}

// Fetch a full thread for the reading pane via the gmail-thread Edge Function.
export async function gmailGetThread(threadId) {
  if (!threadId) return { ok: false, error: 'Missing threadId' }
  const { data, error } = await supabase.functions.invoke('gmail-thread', { body: { threadId } })
  if (error) {
    let detail = error.message
    try { const ctx = await error.context?.json?.(); if (ctx?.error) detail = ctx.error } catch { /* ignore */ }
    return { ok: false, error: detail }
  }
  if (data?.error) return { ok: false, error: data.error }
  return { ok: true, messages: data?.messages || [] }
}

// Generate an AI draft email for an order via the ai-draft Edge Function
// (Claude Haiku). mode ∈ reply | request_photo | request_approval |
// balance_reminder | install_complete | closeout. The Anthropic key stays
// server-side; the draft is never auto-sent. photoCount (closeout mode) lets the
// draft reference the completion photos being shared. Returns { ok, subject?,
// body?, error? }.
export async function aiDraftEmail({ orderId, mode, balance, total, draftText, photoCount }) {
  const { data, error } = await supabase.functions.invoke('ai-draft', {
    body: { order_id: orderId, mode, balance, total, draft_text: draftText, photo_count: photoCount },
  })
  if (error) {
    let detail = error.message
    try { const ctx = await error.context?.json?.(); if (ctx?.error) detail = ctx.detail || ctx.error } catch { /* ignore */ }
    return { ok: false, error: detail }
  }
  if (data?.error) return { ok: false, error: data.detail || data.error }
  return { ok: true, subject: data?.subject || '', body: data?.body || '' }
}

// Send an order email via the gmail-send Edge Function. Tokens stay server-side;
// the browser only passes the message fields. Returns { ok, data?, error? }.
export async function sendOrderEmail({ orderId, to, subject, body }) {
  const { data, error } = await supabase.functions.invoke('gmail-send', {
    body: { order_id: orderId || null, to, subject, body },
  })
  if (error) {
    // FunctionsHttpError carries the non-2xx; surface the body's error if present.
    let detail = error.message
    try { const ctx = await error.context?.json?.(); if (ctx?.error) detail = ctx.error } catch { /* ignore */ }
    return { ok: false, error: detail }
  }
  if (data?.error) return { ok: false, error: data.error }
  return { ok: true, data }
}

// ── Order notes (20260601_order_notes.sql) ────────────────────────────────
export async function getOrderNotes(orderId) {
  if (!orderId) return []
  const { data, error } = await supabase
    .from('order_notes')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
  if (error) { console.warn('[orders] getOrderNotes:', error.message); return [] }
  return data || []
}

export async function addOrderNote({ orderId, body, author }) {
  const text = (body || '').trim()
  if (!orderId || !text) return { ok: false, error: 'Missing order or note text' }
  const { data, error } = await supabase
    .from('order_notes')
    .insert({ order_id: orderId, body: text, author: author || null })
    .select()
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, data }
}

// ── Order attachments — general uploads in the existing public bucket ──────
// No new bucket: general attachments live in orders-attachments-public under
// attachments/{orderId}/. (Layout proofs and signatures live in their own
// existing buckets and are aggregated separately on the Order Detail View.)
export async function uploadOrderAttachment(orderId, file) {
  if (!orderId || !file) return { ok: false, error: 'Missing orderId or file' }
  const safe = String(file.name || 'file').replace(/[^\w.-]+/g, '_')
  const path = `attachments/${orderId}/${crypto.randomUUID()}_${safe}`
  const { error } = await supabase.storage
    .from('orders-attachments-public')
    .upload(path, file, { upsert: false, contentType: file.type || undefined })
  if (error) return { ok: false, error: error.message }
  const { data } = supabase.storage.from('orders-attachments-public').getPublicUrl(path)
  return { ok: true, url: data.publicUrl, path, name: safe }
}

export async function listOrderAttachments(orderId) {
  if (!orderId) return []
  const dir = `attachments/${orderId}`
  const { data, error } = await supabase.storage
    .from('orders-attachments-public')
    .list(dir, { sortBy: { column: 'created_at', order: 'desc' } })
  if (error) { console.warn('[orders] listOrderAttachments:', error.message); return [] }
  return (data || [])
    .filter(f => f && f.name && f.id) // skip folder placeholders
    .map(f => {
      const path = `${dir}/${f.name}`
      const { data: u } = supabase.storage.from('orders-attachments-public').getPublicUrl(path)
      // Stored name is `${uuid}_${original}` — strip the uuid prefix for display.
      const display = f.name.replace(/^[0-9a-f-]{36}_/i, '')
      return { name: display, url: u.publicUrl, path, createdAt: f.created_at || null }
    })
}

// ── Completion photos (ITEM 4) ──────────────────────────────────────────────
// Field/production work (setting, delivery, inscription, acid wash, repair —
// the kinds flagged requiresCompletionPhoto) gets photographed at completion.
// Stored in the SAME public bucket as other order attachments, under the
// brief's layout `<order_id>/completion/`. No new bucket, no migration: the
// files in storage ARE the persisted refs (mirrors listOrderAttachments), so
// they survive navigation and show on the order record on reload.
export async function uploadCompletionPhoto(orderId, file) {
  if (!orderId || !file) return { ok: false, error: 'Missing orderId or file' }
  const safe = String(file.name || 'photo').replace(/[^\w.-]+/g, '_')
  const path = `${orderId}/completion/${crypto.randomUUID()}_${safe}`
  const { error } = await supabase.storage
    .from('orders-attachments-public')
    .upload(path, file, { upsert: false, contentType: file.type || undefined })
  if (error) return { ok: false, error: error.message }
  const { data } = supabase.storage.from('orders-attachments-public').getPublicUrl(path)
  return { ok: true, url: data.publicUrl, path, name: safe }
}

export async function listCompletionPhotos(orderId) {
  if (!orderId) return []
  const dir = `${orderId}/completion`
  const { data, error } = await supabase.storage
    .from('orders-attachments-public')
    .list(dir, { sortBy: { column: 'created_at', order: 'desc' } })
  if (error) { console.warn('[completion] listCompletionPhotos:', error.message); return [] }
  return (data || [])
    .filter(f => f && f.name && f.id)   // skip folder placeholders
    .map(f => {
      const path = `${dir}/${f.name}`
      const { data: u } = supabase.storage.from('orders-attachments-public').getPublicUrl(path)
      const display = f.name.replace(/^[0-9a-f-]{36}_/i, '')
      return { name: display, url: u.publicUrl, path, createdAt: f.created_at || null }
    })
}

// The job spawned from an order (read-only), with its milestones — drives the
// Order Detail "Related job" card (stage / next task / blockers). Returns the
// earliest job for the order (orders spawn one job today; mausoleum-door orders
// route via cemetery_order_id, not order_id, so they return null here).
export async function getJobByOrderId(orderId) {
  if (!orderId) return null
  const { data, error } = await supabase
    .from('jobs')
    .select('*, milestones:job_milestones(*)')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) { console.error('getJobByOrderId:', error); return null }
  const job = (data && data[0]) || null
  if (job && Array.isArray(job.milestones)) {
    job.milestones = [...job.milestones].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  }
  return job
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
// Exported in TODAY-COMMAND-CENTER so TodayTab can walk payment lines (each
// carries .receivedAt + .amount) for month-to-date and week-to-date money math.
// financial_records is empty in prod; orders.payments[] is the live money truth.
export function rowNonVoidedPayments(order) {
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

// =============================================================================
// ORDER STATUS DIMENSIONS — ONE SOURCE OF TRUTH (Orders / Jobs / Scheduler)
// =============================================================================
// Four dimensions surfaced as dropdowns in the Orders table + chips in the Jobs
// hubs. Payment is derived from money (read-only). Design / Stone / FDN are
// derived from job_milestones and WRITTEN by flipping those same milestones, so
// the three surfaces can never disagree. Editing a dropdown calls
// setOrder{Design,Stone,Fdn}Status, which flips the milestone ladder directly.
// =============================================================================

export const PAYMENT_STATUS = [
  { code: 'quoted',       label: 'Quoted' },
  { code: 'deposit',      label: 'Deposit' },
  { code: 'paid_in_full', label: 'Paid in full' },
]
export const DESIGN_STATUS = [
  { code: 'not_created',       label: 'Not created' },
  { code: 'layout_created',    label: 'Layout created' },
  { code: 'needs_adjustments', label: 'Needs adjustments' },
  { code: 'layout_approved',   label: 'Layout approved' },
]
export const STONE_STATUS = [
  { code: 'not_ordered',       label: 'Not ordered' },
  { code: 'in_stock',          label: 'In stock' },
  { code: 'ordered',           label: 'Ordered' },
  { code: 'needs_pickup',      label: 'Needs pickup' },
  { code: 'needs_stencil_cut', label: 'Needs stencil cut' },
  { code: 'needs_blasting',    label: 'Needs blasting' },
  { code: 'blasted',           label: 'Blasted' },
]
export const FDN_STATUS = [
  { code: 'na',       label: 'N/A' },
  { code: 'need_map', label: 'Need map' },
  { code: 'not_in',   label: 'FDN not in' },
  { code: 'dug',      label: 'FDN dug' },
  { code: 'poured',   label: 'FDN poured' },
  { code: 'in',       label: 'FDN in' },
]
const FDN_KEYS = ['foundation_needed', 'foundation_need_map', 'foundation_scheduled', 'foundation_dug', 'foundation_poured', 'foundation_in']

const _msList = (job) => (job?.milestones) || []
const _msDone = (job, key) => { const m = _msList(job).find(x => x.milestone_key === key); return !!m && (m.status === 'done') }
const _msHas  = (job, key) => _msList(job).some(x => x.milestone_key === key)
export function milestoneDone(job, key) { return _msDone(job, key) }

// Editable contract total (orders.contract_total). NULL = blank in the table.
export function orderContractTotal(order) {
  return order?.contract_total != null ? Number(order.contract_total) : null
}
// Total used for payment status + the set-gate: the typed contract_total when
// set, else the pricing-derived grand total (legacy/QB rows have no scalar).
function _effectiveTotal(order) {
  const ct = orderContractTotal(order)
  return ct != null ? ct : rowGrandTotal(order)
}

// Manual override (orders.payment_status) wins — imported orders have no
// reliable stored total, so the office sets payment by hand. Falls back to the
// money derivation when no override is set (or before the column migration).
const _PAY_CODES = new Set(['quoted', 'deposit', 'paid_in_full'])
export function derivePaymentStatus(order) {
  if (order?.payment_status && _PAY_CODES.has(order.payment_status)) return order.payment_status
  const total = _effectiveTotal(order)
  const paid = rowTotalPaid(order)
  if (total > 0 && (total - paid) <= 0) return 'paid_in_full'
  if (paid > 0) return 'deposit'
  return 'quoted'
}
export function deriveDesignStatus(job) {
  if (_msDone(job, 'proof_approved')) return 'layout_approved'
  if (_msDone(job, 'proof_changes_requested')) return 'needs_adjustments'
  if (_msDone(job, 'proof_created')) return 'layout_created'
  return 'not_created'
}
export function deriveStoneStatus(job) {
  if (_msDone(job, 'production_completed')) return 'blasted'
  if (_msDone(job, 'stencil_cut')) return 'needs_blasting'
  if (_msDone(job, 'stone_received')) return 'needs_stencil_cut'
  if (_msDone(job, 'stone_needs_pickup')) return 'needs_pickup'
  if (_msDone(job, 'stone_in_stock')) return 'in_stock'
  if (_msDone(job, 'stone_ordered')) return 'ordered'
  return 'not_ordered'
}
export function deriveFdnStatus(job) {
  const present = FDN_KEYS.filter(k => _msHas(job, k))
  if (present.length === 0) return 'na'
  const allNotNeeded = present.every(k => { const m = _msList(job).find(x => x.milestone_key === k); return m && m.status === 'not_needed' })
  if (allNotNeeded) return 'na'
  if (_msDone(job, 'foundation_in')) return 'in'
  if (_msDone(job, 'foundation_poured')) return 'poured'
  if (_msDone(job, 'foundation_dug')) return 'dug'
  if (_msDone(job, 'foundation_need_map')) return 'need_map'
  return 'not_in'
}
const _statusLabel = (dim, code) => (dim.find(s => s.code === code) || {}).label || code
export const paymentStatusLabel = (c) => _statusLabel(PAYMENT_STATUS, c)
export const designStatusLabel  = (c) => _statusLabel(DESIGN_STATUS, c)
export const stoneStatusLabel   = (c) => _statusLabel(STONE_STATUS, c)
export const fdnStatusLabel     = (c) => _statusLabel(FDN_STATUS, c)

// Write plans — flip the milestone ladder so the derived status is deterministic.
function _designPlan(code) {
  switch (code) {
    case 'not_created':       return { done: [], notStarted: ['proof_created', 'proof_changes_requested', 'proof_approved'] }
    case 'layout_created':    return { done: ['proof_created'], notStarted: ['proof_changes_requested', 'proof_approved'] }
    case 'needs_adjustments': return { done: ['proof_created', 'proof_changes_requested'], notStarted: ['proof_approved'] }
    case 'layout_approved':   return { done: ['proof_created', 'proof_approved'], notStarted: [] }
    default: return null
  }
}
function _stonePlan(code) {
  const all = ['stone_in_stock', 'stone_ordered', 'stone_needs_pickup', 'stone_received', 'stencil_created', 'stencil_cut', 'production_started', 'production_completed']
  const after = (...done) => ({ done, notStarted: all.filter(k => !done.includes(k)) })
  switch (code) {
    case 'not_ordered':       return { done: [], notStarted: all }
    case 'in_stock':          return after('stone_in_stock')
    case 'ordered':           return after('stone_ordered')
    case 'needs_pickup':      return after('stone_ordered', 'stone_needs_pickup')
    case 'needs_stencil_cut': return { done: ['stone_ordered', 'stone_needs_pickup', 'stone_received'], notStarted: ['stencil_cut', 'production_started', 'production_completed'] }
    case 'needs_blasting':    return { done: ['stone_ordered', 'stone_needs_pickup', 'stone_received', 'stencil_created', 'stencil_cut'], notStarted: ['production_started', 'production_completed'] }
    case 'blasted':           return { done: ['stone_ordered', 'stone_needs_pickup', 'stone_received', 'stencil_created', 'stencil_cut', 'production_started', 'production_completed'], notStarted: [] }
    default: return null
  }
}
function _fdnPlan(code) {
  switch (code) {
    case 'na':       return { notNeeded: FDN_KEYS }
    case 'not_in':   return { done: ['foundation_needed'], notStarted: ['foundation_need_map', 'foundation_scheduled', 'foundation_dug', 'foundation_poured', 'foundation_in'] }
    case 'need_map': return { done: ['foundation_needed', 'foundation_need_map'], notStarted: ['foundation_scheduled', 'foundation_dug', 'foundation_poured', 'foundation_in'] }
    case 'dug':      return { done: ['foundation_needed', 'foundation_need_map', 'foundation_scheduled', 'foundation_dug'], notStarted: ['foundation_poured', 'foundation_in'] }
    case 'poured':   return { done: ['foundation_needed', 'foundation_need_map', 'foundation_scheduled', 'foundation_dug', 'foundation_poured'], notStarted: ['foundation_in'] }
    case 'in':       return { done: FDN_KEYS, notStarted: [] }
    default: return null
  }
}

// Direct milestone-ladder write (explicit operator status declaration from a
// dropdown). Bypasses updateMilestone's readiness gate + cascade on purpose —
// the operator is declaring the dimension's state, and the ladder keeps the
// derived value deterministic. Up to 3 batched updates, job-scoped.
async function _applyMilestonePlan(jobId, plan) {
  if (!jobId || !plan) return { ok: false, error: 'Invalid status change' }
  const today = new Date().toISOString().slice(0, 10)
  const nowIso = new Date().toISOString()
  const steps = [
    plan.done?.length      ? supabase.from('job_milestones').update({ status: 'done',        status_date: today, updated_at: nowIso }).eq('job_id', jobId).in('milestone_key', plan.done)      : null,
    plan.notStarted?.length? supabase.from('job_milestones').update({ status: 'not_started', status_date: null,  updated_at: nowIso }).eq('job_id', jobId).in('milestone_key', plan.notStarted) : null,
    plan.notNeeded?.length ? supabase.from('job_milestones').update({ status: 'not_needed',  status_date: null,  updated_at: nowIso }).eq('job_id', jobId).in('milestone_key', plan.notNeeded)  : null,
  ].filter(Boolean)
  for (const step of steps) { const { error } = await step; if (error) return { ok: false, error: error.message } }
  return { ok: true }
}
export function setOrderDesignStatus(jobId, code) { return _applyMilestonePlan(jobId, _designPlan(code)) }
export function setOrderStoneStatus(jobId, code)  { return _applyMilestonePlan(jobId, _stonePlan(code)) }
export function setOrderFdnStatus(jobId, code)    { return _applyMilestonePlan(jobId, _fdnPlan(code)) }

// The write plan for a dimension+code — lets a caller mirror the milestone flip
// in LOCAL state (optimistic update) instead of refetching after an inline edit.
export function orderStatusWritePlan(dimension, code) {
  if (dimension === 'design') return _designPlan(code)
  if (dimension === 'stone')  return _stonePlan(code)
  if (dimension === 'fdn')    return _fdnPlan(code)
  return null
}

// ── THE SET GATE — one function, used by Orders chip + Jobs hubs + Scheduler ──
// SET-READY = Paid in full ∧ Blasted ∧ (FDN In or N/A) ∧ permit-ok-where-required.
// Returns the first failing reason, or null when ready.
export function setBlockReason(order, job) {
  // Honor the manual Payment override (derivePaymentStatus) so the office's
  // "Paid in full" clears the gate even on imported orders with no stored total.
  if (derivePaymentStatus(order) !== 'paid_in_full') return 'Not paid in full'
  if (!_msDone(job, 'production_completed')) return 'Not blasted'
  const fdn = deriveFdnStatus(job)
  if (!(fdn === 'in' || fdn === 'na')) return 'FDN not in'
  const permitRequired = order?.permit_required === true || order?.permit_status === 'required' || order?.permit_status === 'submitted'
  const permitOk = !permitRequired || order?.permit_status === 'approved'
  if (!permitOk) return 'Permit not approved'
  return null
}
export function isReadyToSet(order, job) { return setBlockReason(order, job) === null }

// ── RECORD PAYMENT (append-only) ─────────────────────────────────────────────
// Append a payment to the order's payments[] JSONB. Money records are
// APPEND-ONLY here: this never edits or deletes an existing payment (voiding /
// adjusting is a separate, flagged action — NOT part of this path). Mirrors
// orderToRow's legacy deposit_*/balance_* derivation (first two locked
// non-voided) and statusPatchFor's paid-in-full flip so the order's status,
// totals, and legacy columns all stay consistent with the wizard's own path.
//   input: { amount, method, type, receivedAt, ref, note, createdBy }
//     type ∈ deposit | progress | final (informational; labels still derive by
//     position in the receipt PDF). method ∈ cash | check | card | other | zelle.
export async function recordOrderPayment(orderId, input = {}) {
  if (!orderId) return { ok: false, error: 'Missing order id' }
  const amount = Number(input.amount)
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter a payment amount greater than zero.' }

  const { data: row, error: readErr } = await supabase.from('orders').select('*').eq('id', orderId).single()
  if (readErr || !row) return { ok: false, error: readErr?.message || 'Order not found' }

  const existing = Array.isArray(row.payments) ? row.payments : []
  const nowIso = new Date().toISOString()
  const payment = {
    id: (crypto?.randomUUID?.() || `pay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    amount,
    method: input.method || 'check',
    type: input.type || null,
    ref: input.ref || null,
    receivedAt: input.receivedAt || nowIso.slice(0, 10),
    createdAt: nowIso,
    createdBy: input.createdBy || null,
    note: input.note || null,
    direction: 'in',         // QB-readiness — customer payments are inbound
    locked: true,            // a recorded payment is a committed money record
    voided: false, voidedReason: null, voidedAt: null, voidedBy: null,
  }
  const payments = [...existing, payment]

  // Legacy mirror — first two locked non-voided (matches orderToRow).
  const lockedNV = payments.filter(p => p.locked && !p.voided)
  const p0 = lockedNV[0] || null, p1 = lockedNV[1] || null

  // Status reconcile — flip to paid_in_full when the locked non-voided sum
  // reaches the grand total (snapshotting the prior status), same as
  // statusPatchFor. Advance-only here: we never auto-revert on an append.
  const grand = rowGrandTotal(row)
  const lockedSum = lockedNV.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  // Compare on whole dollars (grand is already rounded) so a penny of float
  // drift can't leave a paid order one cent short of flipping.
  const fullyPaid = grand > 0 && Math.round(lockedSum) >= grand
  let status = row.status
  let statusBefore = row.status_before_paid_in_full
  if (fullyPaid && status !== 'paid_in_full' && status !== 'closed') {
    statusBefore = status
    status = 'paid_in_full'
  }

  const patch = {
    payments,
    deposit_amount: p0 ? p0.amount : null,
    deposit_method: p0 ? p0.method : null,
    deposit_ref: p0 ? p0.ref : null,
    deposit_received_at: p0 ? p0.receivedAt : null,
    balance_amount: p1 ? p1.amount : null,
    balance_method: p1 ? p1.method : null,
    balance_ref: p1 ? p1.ref : null,
    balance_received_at: p1 ? p1.receivedAt : null,
    status,
    status_before_paid_in_full: statusBefore,
    updated_at: nowIso,
  }
  // Optimistic-concurrency guard: only write if the row hasn't changed since we
  // read it (else a simultaneous append from another tab/staff would be
  // silently clobbered — a lost money record). Conflict → ask to retry.
  let q = supabase.from('orders').update(patch).eq('id', orderId)
  if (row.updated_at != null) q = q.eq('updated_at', row.updated_at)
  const { data: updated, error: upErr } = await q.select('id')
  if (upErr) return { ok: false, error: upErr.message }
  if (!updated || updated.length === 0) {
    return { ok: false, error: 'This order changed while you were recording the payment. Reopen the order and try again.' }
  }
  // A6 — a logged deposit auto-completes contract_signed + deposit_received on
  // the job. Best-effort: never fail the payment over a milestone sync.
  try { await applyDepositMilestones(orderId) } catch (e) { console.warn('[A6] applyDepositMilestones:', e?.message) }
  return { ok: true, payment, paid: lockedSum, balance: Math.max(0, grand - Math.round(lockedSum)) }
}

// ── A6 — deposit auto-completes the pre-deposit checklist ───────────────────
// Logging a deposit means the contract + deposit steps are obviously done, so
// auto-complete `contract_signed` + `deposit_received` on the order's job —
// independent of whether a real signature has been recorded. Deposit-GATED
// (only fires when the order actually has a logged deposit) so a signed order
// with no money in doesn't get deposit_received ticked. Idempotent: already-done
// milestones are left untouched (the .neq guard keeps their status_date stable).
// Safe to call from the payment path AND from createJobFromOrder (deposit-before-
// sign case): re-reads the order, finds the job, marks the two keys.
export async function applyDepositMilestones(orderId) {
  if (!orderId) return { ok: true, skipped: 'no_order' }
  const { data: row } = await supabase
    .from('orders').select('payments, deposit_amount').eq('id', orderId).single()
  if (!_orderHasLoggedDeposit(row)) return { ok: true, skipped: 'no_deposit' }
  const job = await getJobByOrderId(orderId)
  if (!job?.id) return { ok: true, skipped: 'no_job' }
  const { error } = await supabase
    .from('job_milestones')
    .update({ status: 'done', status_date: todayLocalISO(), updated_at: new Date().toISOString() })
    .eq('job_id', job.id)
    .in('milestone_key', ['contract_signed', 'deposit_received'])
    .neq('status', 'done')
  if (error) return { ok: false, error: error.message }
  return { ok: true, jobId: job.id }
}

// True when an order row carries a real, committed deposit — a locked,
// non-voided payment with amount > 0 (or the legacy deposit_amount column when
// payments[] is empty). Accepts a snake_case row.
function _orderHasLoggedDeposit(row) {
  if (!row) return false
  const payments = Array.isArray(row.payments) ? row.payments : []
  if (payments.some(p => p && (p.locked ?? true) && !p.voided && Number(p.amount) > 0)) return true
  if (payments.length === 0 && Number(row.deposit_amount || 0) > 0) return true
  return false
}

// A6 flag — "signed contract still needed": a deposit has been logged but no
// real signature is on file. The deposit auto-completes contract_signed, so this
// flag is the persistent reminder to still collect the actual signature. Clears
// itself the moment a real signature is recorded (signed_at set). Derived — no
// column, no migration. Accepts either a camelCase order or a snake_case row.
export function needsSignedContract(o) {
  if (!o) return false
  if (o.signedAt || o.signed_at) return false
  const payments = Array.isArray(o.payments) ? o.payments : []
  if (payments.some(p => p && (p.locked ?? true) && !p.voided && Number(p.amount) > 0)) return true
  if (payments.length === 0 && Number(o.depositAmount ?? o.deposit_amount ?? 0) > 0) return true
  return false
}

// ── OUTGOING PAYMENTS (Payments tab v2) ─────────────────────────────────────
// Money paid OUT — suppliers, subs, overhead. Not tied to a customer order, so
// it lives in its own table (20260604_outgoing_payments.sql). Stored atomically
// with the fields QuickBooks needs (payee, category, method, reference, amount,
// date) so a later sync is a mapping job. Returns [] gracefully if the table
// hasn't been created yet (migration pending) so the UI never crashes.
export async function listOutgoingPayments() {
  const { data, error } = await supabase
    .from('outgoing_payments').select('*').order('paid_date', { ascending: false })
  if (error) { console.warn('[payments] listOutgoingPayments:', error.message); return [] }
  return data || []
}

export async function recordOutgoingPayment(input = {}) {
  const amount = Number(input.amount)
  if (!input.payee || !String(input.payee).trim()) return { ok: false, error: 'Enter a payee.' }
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter an amount greater than zero.' }
  const row = {
    payee:      String(input.payee).trim(),
    category:   input.category?.trim() || null,
    method:     input.method || null,
    reference:  input.reference?.trim() || null,
    amount,
    paid_date:  input.paidDate || new Date().toISOString().slice(0, 10),
    direction:  'out',
    notes:      input.notes?.trim() || null,
    created_by: input.createdBy || null,
  }
  const { data, error } = await supabase.from('outgoing_payments').insert(row).select().single()
  if (error) {
    if (/relation .*outgoing_payments.* does not exist|could not find the table/i.test(error.message)) {
      return { ok: false, error: 'Outgoing payments aren’t set up yet — apply the 20260604_outgoing_payments migration in Supabase Studio, then try again.' }
    }
    return { ok: false, error: error.message }
  }
  return { ok: true, payment: data }
}

export async function deleteOutgoingPayment(id) {
  if (!id) return { ok: false, error: 'Missing id' }
  const { error } = await supabase.from('outgoing_payments').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ── BULK OPERATIONS (Orders Triage Workbench) ───────────────────────────────
// Every bulk write is ONE batched statement (.update().in('id', ids)) — never a
// per-row loop. Tenant-scoped (belt-and-suspenders over RLS) + reversible. No
// hard deletes anywhere. Each returns { ok, count } (rows actually written).

export const TENANT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789'

// Generic batched order patch. `patch` must be plain order columns.
export async function bulkUpdateOrders(ids, patch) {
  const list = [...new Set((ids || []).filter(Boolean))]
  if (list.length === 0) return { ok: true, count: 0 }
  const { data, error } = await supabase
    .from('orders').update(patch).in('id', list).eq('tenant_id', TENANT_ID).select('id')
  if (error) return { ok: false, error: error.message }
  return { ok: true, count: data?.length || 0 }
}

// Archive / restore — sets the archived boolean + timestamp ONLY. Never touches
// payments, pricing, status, or milestones.
export function bulkArchiveOrders(ids) {
  return bulkUpdateOrders(ids, { archived: true, archived_at: new Date().toISOString() })
}
export function bulkRestoreOrders(ids) {
  return bulkUpdateOrders(ids, { archived: false, archived_at: null })
}

// ── D2 — HARD DELETE (permanent, archive-gated) ─────────────────────────────
// Irreversible. ONLY an archived order can be hard-deleted (archive first). The
// cascade clears every child explicitly, in dependency order, so nothing is
// orphaned — money (payments[] JSONB + legacy columns ride on the order row),
// jobs, milestones, events, promises, batch links, proofs, estimates,
// financial_records, notes, emails, and Storage attachments. Aborts on the first
// error WITHOUT deleting the order row, so a blocked child delete can never
// leave a half-deleted order. RESTRICT children (job_cost_estimates,
// financial_records) are deleted before their job; cascade children are deleted
// explicitly too for a no-orphan guarantee regardless of FK config.
export async function hardDeleteOrder(orderId) {
  if (!orderId) return { ok: false, error: 'Missing order id' }
  const { data: ord, error: rErr } = await supabase
    .from('orders').select('id, order_number, archived').eq('id', orderId).single()
  if (rErr || !ord) return { ok: false, error: rErr?.message || 'Order not found' }
  if (!ord.archived) return { ok: false, error: 'This order must be archived before it can be permanently deleted.' }

  // 1) Jobs + their children.
  const { data: jobs, error: jReadErr } = await supabase.from('jobs').select('id').eq('order_id', orderId)
  if (jReadErr) return { ok: false, error: `Could not read jobs: ${jReadErr.message}` }
  const jobIds = (jobs || []).map(j => j.id)
  if (jobIds.length) {
    // RESTRICT children must go before the job, else the job delete is blocked.
    for (const t of ['job_cost_estimates', 'financial_records']) {
      const { error } = await supabase.from(t).delete().in('job_id', jobIds)
      if (error) return { ok: false, error: `Failed clearing ${t}: ${error.message}` }
    }
    // Remaining children — explicit so we never rely on FK cascade config.
    for (const t of ['work_batch_jobs', 'job_promises', 'proof_versions', 'job_events', 'job_milestones']) {
      const { error } = await supabase.from(t).delete().in('job_id', jobIds)
      if (error) return { ok: false, error: `Failed clearing ${t}: ${error.message}` }
    }
    const { error: jErr } = await supabase.from('jobs').delete().in('id', jobIds)
    if (jErr) return { ok: false, error: `Failed deleting job(s): ${jErr.message}` }
  }

  // 2) Order-level children. order_notes cascades; delete explicitly anyway.
  for (const t of ['order_emails', 'order_notes', 'financial_records']) {
    const { error } = await supabase.from(t).delete().eq('order_id', orderId)
    // A missing table/column on a given deployment shouldn't block the delete.
    if (error && !/relation .* does not exist|column .* does not exist/i.test(error.message)) {
      return { ok: false, error: `Failed clearing ${t}: ${error.message}` }
    }
  }

  // 3) Storage attachments (best-effort — a storage hiccup shouldn't strand the
  //    DB delete, but we try first while we still have the order id).
  try { await _deleteOrderStorage(orderId) } catch (e) { console.warn('[hardDelete] storage sweep:', e?.message) }

  // 4) The order row itself (payments[] JSONB + legacy deposit/balance go with it).
  const { error: oErr } = await supabase.from('orders').delete().eq('id', orderId)
  if (oErr) return { ok: false, error: `Failed deleting the order: ${oErr.message}` }
  return { ok: true, orderNumber: ord.order_number }
}

// Remove an order's files from the public attachments bucket. Covers both the
// general-attachment layout (attachments/<orderId>/) and the completion-photo
// layout (<orderId>/completion/). Proof/signature files live in their own
// buckets and are left to their own lifecycle.
async function _deleteOrderStorage(orderId) {
  const bucket = supabase.storage.from('orders-attachments-public')
  const dirs = [`attachments/${orderId}`, `${orderId}/completion`, `${orderId}`]
  for (const dir of dirs) {
    const { data } = await bucket.list(dir)
    const files = (data || []).filter(f => f && f.id).map(f => `${dir}/${f.name}`)
    if (files.length) await bucket.remove(files)
  }
}

// Set lifecycle status (plain enum set — no paid_in_full snapshot, no side
// effects; "Set status from the status enum").
export function bulkSetOrderStatus(ids, status) {
  return bulkUpdateOrders(ids, { status })
}

// Set cemetery (FK).
export function bulkSetOrderCemetery(ids, cemeteryId) {
  return bulkUpdateOrders(ids, { cemetery_id: cemeteryId || null })
}

// Set job type / "move to queue" — job_type lives on jobs, keyed by order_id.
// One batched update over jobs by order_id (not a per-row loop).
export async function bulkSetJobType(orderIds, jobType) {
  const list = [...new Set((orderIds || []).filter(Boolean))]
  if (list.length === 0) return { ok: true, count: 0 }
  const { data, error } = await supabase
    .from('jobs').update({ job_type: jobType, last_update_at: new Date().toISOString() })
    .in('order_id', list).eq('tenant_id', TENANT_ID).select('id')
  if (error) return { ok: false, error: error.message }
  return { ok: true, count: data?.length || 0 }
}

// Set stage — mark each selected order's job milestones DONE through
// `throughKey` (advance-only). ONE batched update over job_milestones: resolve
// the jobs for the selected orders + the milestone keys up to the target from
// the active new_stone template, then a single .in() write. Non-new_stone jobs
// that lack those keys are simply unaffected. Returns the jobs touched + the
// keys advanced so the caller can report.
export async function bulkSetStage(orderIds, throughKey) {
  const list = [...new Set((orderIds || []).filter(Boolean))]
  if (list.length === 0) return { ok: true, count: 0, jobs: 0 }

  // Jobs for the selected orders.
  const { data: jobs, error: jErr } = await supabase
    .from('jobs').select('id').in('order_id', list).eq('tenant_id', TENANT_ID)
  if (jErr) return { ok: false, error: jErr.message }
  const jobIds = (jobs || []).map(j => j.id)
  if (jobIds.length === 0) return { ok: true, count: 0, jobs: 0 }

  // Keys through the target, from the active new_stone template.
  const { allMilestones } = await buildMilestoneListForOrder(['NEW_STONE'])
  const order = (allMilestones || []).map(m => m.key)
  const idx = order.indexOf(throughKey)
  if (idx < 0) return { ok: false, error: `Stage "${throughKey}" not in the new_stone template` }
  const keys = order.slice(0, idx + 1)

  // How many selected jobs actually carry this stage key (vs. a different
  // job_type that lacks it) — so the caller can report jobs skipped.
  const { data: haveKey } = await supabase
    .from('job_milestones').select('job_id').in('job_id', jobIds).eq('milestone_key', throughKey)
  const applicable = new Set((haveKey || []).map(r => r.job_id)).size
  const skipped = jobIds.length - applicable

  const stamp = new Date().toISOString()
  const { data, error } = await supabase
    .from('job_milestones')
    .update({ status: 'done', status_date: stamp.slice(0, 10), updated_at: stamp })
    .in('job_id', jobIds).in('milestone_key', keys).neq('status', 'done')
    .select('id')
  if (error) return { ok: false, error: error.message }
  return { ok: true, count: data?.length || 0, jobs: jobIds.length, applicable, skipped, keys }
}

// ── Customers bulk (uses the existing customers.archived column) ─────────────
export async function bulkArchiveCustomers(ids) {
  const list = [...new Set((ids || []).filter(Boolean))]
  if (list.length === 0) return { ok: true, count: 0 }
  const { data, error } = await supabase
    .from('customers').update({ archived: true, archived_at: new Date().toISOString() })
    .in('id', list).eq('tenant_id', TENANT_ID).select('id')
  if (error) return { ok: false, error: error.message }
  return { ok: true, count: data?.length || 0 }
}
export async function bulkRestoreCustomers(ids) {
  const list = [...new Set((ids || []).filter(Boolean))]
  if (list.length === 0) return { ok: true, count: 0 }
  const { data, error } = await supabase
    .from('customers').update({ archived: false, archived_at: null })
    .in('id', list).eq('tenant_id', TENANT_ID).select('id')
  if (error) return { ok: false, error: error.message }
  return { ok: true, count: data?.length || 0 }
}

// ── WORKFLOW QUEUES (read-only classifier) ───────────────────────────────────
// A queue is a named view over orders. classifyOrderQueues buckets each order
// into ONE production queue (the furthest-along it qualifies for, so it appears
// once) + zero-or-more cross-cutting attention overlays. Production queues are
// new_stone-only and template-driven: the gate/end keys are matched against the
// job's OWN job_milestones, so a queue whose gate key doesn't exist on the job
// stays empty (no fabricated stages). NOTHING here writes.

export const PRODUCTION_QUEUES = [
  { code: 'designs_needed',       label: 'Designs needed',           gate: 'deposit_received',     end: 'proof_sent' },
  { code: 'proofs_awaiting',      label: 'Proofs awaiting approval', gate: 'proof_sent',           end: 'proof_approved' },
  { code: 'stones_to_order',      label: 'Stones to order',          gate: 'proof_approved',       end: 'stone_ordered' },
  { code: 'stones_ordered',       label: 'Stones ordered',           gate: 'stone_ordered',        end: 'stone_received' },
  { code: 'stones_received',      label: 'Stones received',          gate: 'stone_received',       end: 'production_completed' },
  { code: 'photos_needed',        label: 'Photos needed',            gate: 'photo_needed',         end: 'photo_received' },
  { code: 'etchings_needed',      label: 'Etchings needed',          gate: 'etching_needed',       end: 'stencil_cut' },
  { code: 'foundations_needed',   label: 'Foundations needed',       gate: 'foundation_needed',    end: 'foundation_scheduled' },
  { code: 'foundations_scheduled',label: 'Foundations scheduled',    gate: 'foundation_scheduled', end: 'foundation_poured' },
  { code: 'installs_ready',       label: 'Installs ready/scheduled', gate: 'ready_to_install',      end: 'installed' },
]
export const OVERLAY_QUEUES = [
  { code: 'balances_due', label: 'Balances due' },
  { code: 'blocked',      label: 'Blocked' },
]
// v1 "blocked" blocker kinds — waiting-on-someone / stuck (NOT pure financial,
// which is its own Balances-due overlay, and NOT the blue scheduling states).
const BLOCKED_BLOCKER_KINDS = new Set(['cemetery_hold', 'waiting_on_family', 'proof_waiting_customer', 'production_blocked'])

// ── PERMITS (launch-critical permit command center) ─────────────────────────
export const PERMIT_STATUSES = [
  { code: 'unknown',      label: 'Unknown' },
  { code: 'not_required', label: 'Not required' },
  { code: 'required',     label: 'Required' },
  { code: 'submitted',    label: 'Submitted' },
  { code: 'approved',     label: 'Approved' },
]
export const PERMIT_QUEUES = [
  { code: 'permit_required',  label: 'Permits required' },
  { code: 'permit_submitted', label: 'Permits submitted' },
  { code: 'permit_approved',  label: 'Permits approved' },
  { code: 'permit_missing',   label: 'Permits missing' },
  { code: 'permit_blocking',  label: 'Permits blocking install' },
]

const _QUEUE_LABELS = Object.fromEntries([...PRODUCTION_QUEUES, ...OVERLAY_QUEUES, ...PERMIT_QUEUES].map(q => [q.code, q.label]))
export function queueLabel(code) { return _QUEUE_LABELS[code] || code }

// Spec-less order — missing the monument basics the office fills in at triage.
export function orderMissingInfo(order) {
  return !order?.shape || !order?.granite_color || (!order?.width_inches && !order?.standard_size_code)
}

// Returns { productionQueue: code|null, overlays: code[] }. `pressure` is the
// computeOrderPressure result for this order (callers already have it; passed
// in to avoid recomputing). Closed/cancelled/archived orders never queue.
export function classifyOrderQueues(order, job, pressure) {
  const result = { productionQueue: null, overlays: [] }
  if (!order) return result
  const terminal = order.status === 'closed' || order.status === 'cancelled' || order.archived === true
  if (terminal) return result

  // Overlays (cross-cutting; any non-terminal order, any job type)
  if (rowBalanceDue(order) > 0) result.overlays.push('balances_due')
  const kind = pressure?.blocker?.kind
  if (orderMissingInfo(order) || (kind && BLOCKED_BLOCKER_KINDS.has(kind))) result.overlays.push('blocked')

  // Production pipeline — new_stone jobs only; furthest-along by gate sort_order.
  if (job?.job_type === 'new_stone') {
    const ms = new Map((job.milestones || []).map(m => [m.milestone_key, m]))
    const done = k => ms.get(k)?.status === 'done'
    let best = null, bestRank = -1
    for (const q of PRODUCTION_QUEUES) {
      if (ms.has(q.gate) && done(q.gate) && !done(q.end)) {
        const rank = ms.get(q.gate)?.sort_order ?? -1
        if (rank > bestRank) { bestRank = rank; best = q.code }
      }
    }
    result.productionQueue = best
  }
  return result
}

// Which permit buckets (PERMIT_QUEUES codes) an order belongs to. An order can
// be in several (e.g. 'permit_submitted' AND 'permit_blocking'). Blocking logic
// is exactly the spec: ready_to_install done AND status NOT approved AND NOT
// not_required (so 'unknown' on a ready stone IS flagged — conservative for a
// launch safety system). Terminal orders never appear.
export function permitBuckets(order, job) {
  const out = []
  if (!order) return out
  const terminal = order.status === 'closed' || order.status === 'cancelled' || order.archived === true
  if (terminal) return out
  const st = order.permit_status || 'unknown'
  if (st === 'required')  out.push('permit_required')
  if (st === 'submitted') out.push('permit_submitted')
  if (st === 'approved')  out.push('permit_approved')
  // Missing — cemetery requires a permit but the order has no determination yet.
  if (order.permit_required === true && st === 'unknown') out.push('permit_missing')
  // Blocking install — a ready-to-set stone without an approved (or N/A) permit.
  if (st !== 'approved' && st !== 'not_required') {
    const readyDone = (job?.milestones || []).some(m => m.milestone_key === 'ready_to_install' && m.status === 'done')
    if (readyDone) out.push('permit_blocking')
  }
  return out
}

// Auto-detect: derive the permit requirement/fee snapshot + status from a
// cemetery, WITHOUT downgrading a real filing. cemetery may be null (order's
// cemetery not linked yet) → requirement null, status stays 'unknown' (unless
// already submitted/approved, which is preserved). Pure — no DB.
export function derivePermitPatch(cemetery, currentStatus) {
  const req = cemetery?.permit_required ?? null
  const patch = {
    permit_required: req,
    permit_fee_low:  cemetery?.permit_fee_low ?? null,
    permit_fee_high: cemetery?.permit_fee_high ?? null,
  }
  // Never overwrite a submitted/approved permit — correcting the cemetery fixes
  // the requirement + fee but never wipes a real filing.
  if (currentStatus === 'submitted' || currentStatus === 'approved') return patch
  patch.permit_status = req === false ? 'not_required' : req === true ? 'required' : 'unknown'
  return patch
}

// Apply auto-detect to one order (reads its cemetery, writes the snapshot+status).
// Safe when cemetery_id is null. Call after an order's cemetery is set/changed.
export async function autoDetectOrderPermit(orderId) {
  if (!orderId) return { ok: false, error: 'No orderId' }
  const { data: row, error } = await supabase
    .from('orders')
    .select('id, permit_status, cemetery:cemeteries(permit_required, permit_fee_low, permit_fee_high)')
    .eq('id', orderId).single()
  if (error || !row) return { ok: false, error: error?.message || 'Order not found' }
  const patch = derivePermitPatch(row.cemetery, row.permit_status || 'unknown')
  const { error: upErr } = await supabase.from('orders').update(patch).eq('id', orderId).eq('tenant_id', TENANT_ID)
  if (upErr) return { ok: false, error: upErr.message }
  return { ok: true, patch }
}

// Per-order permit edit (OrderDetail). Accepts permit_status + dates + fee paid +
// a jsonb merge under `permit`. Auto-stamps filed/approved dates if not provided.
export async function setOrderPermit(orderId, patch) {
  if (!orderId) return { ok: false, error: 'No orderId' }
  const { error } = await supabase.from('orders')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', orderId).eq('tenant_id', TENANT_ID)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// Cemetery permit requirements (the "Cemetery requirements" editor).
export async function listCemeteriesWithPermit() {
  const { data, error } = await supabase.from('cemeteries').select('*').order('name', { ascending: true })
  if (error) { console.error('listCemeteriesWithPermit:', error); return [] }
  return data || []
}
export async function updateCemeteryPermit(id, patch) {
  if (!id) return { ok: false, error: 'No cemetery id' }
  const { error } = await supabase.from('cemeteries').update(patch).eq('id', id).eq('tenant_id', TENANT_ID)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

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

// E1 — phone INPUT helpers. phoneDigits() is the stored, normalized value
// (digits only, max 10). maskPhoneInput() is the live, as-you-type display
// `(XXX) XXX - XXXX`, partial-friendly so the mask builds up while typing.
export function phoneDigits(v) {
  return String(v ?? '').replace(/\D/g, '').slice(0, 10)
}
export function maskPhoneInput(v) {
  const d = phoneDigits(v)
  if (!d) return ''
  if (d.length <= 3) return `(${d}`
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)} - ${d.slice(6)}`
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
  MAUSOLEUM_DOOR:  'mausoleum_door',
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

// ── MAUSOLEUM DOOR PRICING ───────────────────────────────────────────────────
// Hardcoded for now; migrate to a DB table when 3+ cemeteries are finalized.
// Two pricing shapes:
//   • 'indoor_outdoor_split' — operator picks indoor/outdoor per door; the
//     priced item list is filtered by that selection (St James).
//   • 'flat' — one item list regardless of location.
// A door order whose cemetery matches none of these falls back to 'custom'
// (operator enters free-form line items + prices per door).
export const CEMETERY_DOOR_PRICING = {
  ST_JAMES: {
    label: 'St James',
    type: 'indoor_outdoor_split',
    indoor: {
      name_and_dates_1:   { label: 'Name + dates (1 name)',  price: 225 },
      name_and_dates_2:   { label: 'Names + dates (2 names)', price: 275 },
      date_of_death_only: { label: 'Date of death only',     price: 100 },
      veterans_verse:     { label: 'Veterans verse',         price: 98 },
      head_of_christ:     { label: 'Head of Christ',         price: 150 },
      madonna:            { label: 'Madonna',                price: 150 },
      cross:              { label: 'Cross',                  price: 125 },
    },
    outdoor: {
      name_and_dates_1:   { label: 'Name + dates (1 name)',  price: 295 },
      name_and_dates_2:   { label: 'Names + dates (2 names)', price: 425 },
      date_of_death_only: { label: 'Date of death only',     price: 195 },
      veterans_verse:     { label: 'Veterans verse',         price: 75 },
      outdoor_repaint:    { label: 'Repaint',                price: 125 },
      head_of_christ:     { label: 'Head of Christ',         price: 150 },
      madonna:            { label: 'Madonna',                price: 150 },
      cross:              { label: 'Cross',                  price: 125 },
    },
  },
  BETH_ISRAEL: {
    label: 'Beth Israel',
    type: 'flat',
    items: {
      inscription:    { label: 'Inscription',    price: 205.50 },
      repaint:        { label: 'Repaint',        price: 47 },
      white:          { label: 'White',          price: 41.40 },
      hebrew_verse:   { label: 'Hebrew verse',   price: 47 },
      painted_border: { label: 'Painted border', price: 154.75 },
      double_crypt:   { label: 'Double crypt',   price: 217 },
      bench:          { label: 'Bench',          price: 558 },
    },
  },
  WOODBRIDGE_MEMORIAL_GARDENS: {
    label: 'Woodbridge Memorial Gardens',
    type: 'flat',
    items: {
      inscription:    { label: 'Inscription',    price: 170 },
      repaint:        { label: 'Repaint',        price: 47 },
      white:          { label: 'White',          price: 41.40 },
      painted_border: { label: 'Painted border', price: 154.75 },
      double_crypt:   { label: 'Double crypt',   price: 217 },
      bench:          { label: 'Bench',          price: 558 },
      chinese:        { label: 'Chinese',        price: 35 },
      english_verse:  { label: 'English verse',  price: 47 },
    },
  },
  // Clover Leaf shares Woodbridge's list — built by spread below to stay DRY.
}
// Clover Leaf = Woodbridge Memorial Gardens item list (same prices), distinct label.
CEMETERY_DOOR_PRICING.CLOVER_LEAF = {
  label: 'Clover Leaf',
  type: 'flat',
  items: { ...CEMETERY_DOOR_PRICING.WOODBRIDGE_MEMORIAL_GARDENS.items },
}

// Canonical-name matchers → pricing key. Case-insensitive substring on the
// order's cemetery name (demo prefix stripped). No match → custom mode.
const _CEMETERY_PRICING_MATCHERS = [
  { key: 'ST_JAMES',                    needles: ['st james', 'st. james', 'saint james'] },
  { key: 'BETH_ISRAEL',                 needles: ['beth israel'] },
  { key: 'WOODBRIDGE_MEMORIAL_GARDENS', needles: ['woodbridge memorial'] },
  { key: 'CLOVER_LEAF',                 needles: ['clover leaf', 'cloverleaf'] },
]

// Resolve a cemetery NAME to its door-pricing entry. Returns the pricing object
// (with an added `key`), or a 'custom' shape when nothing matches.
export function lookupCemeteryPricing(cemeteryName) {
  const cleaned = String(cemeteryName || '').toLowerCase().replace('zz_demo_', '').trim()
  if (cleaned) {
    for (const m of _CEMETERY_PRICING_MATCHERS) {
      if (m.needles.some(n => cleaned.includes(n))) {
        return { key: m.key, ...CEMETERY_DOOR_PRICING[m.key] }
      }
    }
  }
  return { key: 'CUSTOM', label: 'Custom pricing', type: 'custom' }
}

// Total price for a single door given its cemetery pricing entry.
//   indoor_outdoor_split → sum selectedItems from the door.location item list
//   flat                 → sum selectedItems from cemeteryPricing.items
//   custom               → sum operator-entered customLineItems[].price
//
// selectedItems entries may be a bare key string (legacy) or an object
// { key, price_override? }. A finite price_override wins over the list price,
// powering the Step-6 inline edits.
export function getDoorPrice(door, cemeteryPricing) {
  if (!door || !cemeteryPricing) return 0
  if (cemeteryPricing.type === 'custom') {
    return (door.customLineItems || []).reduce((sum, li) => sum + (Number(li.price) || 0), 0)
  }
  let itemMap = null
  if (cemeteryPricing.type === 'indoor_outdoor_split') {
    itemMap = cemeteryPricing[door.location] || {}
  } else if (cemeteryPricing.type === 'flat') {
    itemMap = cemeteryPricing.items || {}
  } else {
    return 0
  }
  return (door.selectedItems || []).reduce((sum, sel) => {
    const key = typeof sel === 'string' ? sel : sel?.key
    const override = (sel && typeof sel === 'object' && sel.price_override != null) ? Number(sel.price_override) : null
    if (override != null && Number.isFinite(override)) return sum + override
    const entry = itemMap[key]
    return sum + (entry ? (Number(entry.price) || 0) : 0)
  }, 0)
}

// Resolve the pricing entry for a cemetery ORDER. A custom (operator-added)
// cemetery carries a frozen flat price list in cemetery_pricing_snapshot;
// the 4 known cemeteries read live from CEMETERY_DOOR_PRICING by name.
export function getCemeteryPricingForOrder(cemeteryOrder) {
  if (!cemeteryOrder) return { key: 'CUSTOM', label: 'Custom pricing', type: 'custom' }
  if (cemeteryOrder.cemetery_pricing_snapshot) {
    return { key: 'CUSTOM_SNAPSHOT', ...cemeteryOrder.cemetery_pricing_snapshot }
  }
  return lookupCemeteryPricing(cemeteryOrder.cemetery_name)
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

export async function createJobFromOrder(orderId, { source, allowUnsigned = false } = {}) {
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
  // The wizard requires a signed contract; the New Order form enters active /
  // backfilled orders directly, so it passes allowUnsigned to skip the guard
  // (signed_at stays NULL unless staff explicitly mark it signed).
  if (!allowUnsigned && !order.signed_at) return { ok: false, error: 'Order is not signed yet — no job created' }

  // 3. Resolve template + milestone list.
  const { primaryTemplate, allMilestones } = await buildMilestoneListForOrder(order.service_types)
  if (!primaryTemplate) return { ok: false, error: 'No active template matches this order\'s service types' }

  // 4. Insert the job.
  // service_kind discriminates acid_wash vs repair for cleaning_repair jobs so
  // the Scheduler workflow grid can split them into separate columns. Precedence
  // rule: when BOTH ACID_WASH and REPAIR are on the order, 'repair' wins (a stone
  // needing structural repair is dispatched as a repair, with the wash folded in).
  // NULL for any non-cleaning_repair job.
  let serviceKind = null
  if (primaryTemplate.job_type === 'cleaning_repair') {
    const st = order.service_types || []
    serviceKind = st.includes('REPAIR') ? 'repair'
      : st.includes('ACID_WASH') ? 'acid_wash'
      : null
  }
  const jobRow = {
    tenant_id: order.tenant_id,
    order_id: order.id,
    template_id: primaryTemplate.id,
    job_type: primaryTemplate.job_type,
    service_kind: serviceKind,
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

  // A6 — if a deposit was logged before the job existed (deposit-before-sign),
  // auto-complete contract_signed + deposit_received now. Deposit-gated inside
  // applyDepositMilestones, so a no-deposit signing is unaffected. Best-effort.
  try { await applyDepositMilestones(orderId) } catch (e) { console.warn('[A6] applyDepositMilestones (job create):', e?.message) }

  return { ok: true, job, alreadyExisted: false }
}

// New Order form — the ordered milestone list for a set of service types, so
// the stage-backfill control can present "enter at which stage". Returns
// [{ key, label, group, sortOrder }] in template order.
export async function getOrderMilestoneTemplate(serviceTypes) {
  const { allMilestones } = await buildMilestoneListForOrder(serviceTypes)
  return (allMilestones || []).map((m, i) => ({ key: m.key, label: m.label, group: m.group, sortOrder: i }))
}

// New Order form — backfill a freshly-created job to its real current stage:
// mark every milestone up to and including `throughKey` (by sort_order) as
// 'done'. throughKey null/'fresh' = leave everything not_started. Returns
// { ok, doneCount }.
export async function backfillJobMilestones(jobId, throughKey) {
  if (!jobId) return { ok: false, error: 'No jobId' }
  if (!throughKey || throughKey === 'fresh') return { ok: true, doneCount: 0 }
  const { data: ms, error } = await supabase
    .from('job_milestones')
    .select('id, milestone_key, sort_order')
    .eq('job_id', jobId)
    .order('sort_order', { ascending: true })
  if (error) return { ok: false, error: error.message }
  const cutoff = (ms || []).find(m => m.milestone_key === throughKey)
  if (!cutoff) return { ok: false, error: 'Stage milestone not found on job' }
  const toComplete = (ms || []).filter(m => (m.sort_order ?? 0) <= (cutoff.sort_order ?? 0)).map(m => m.id)
  if (toComplete.length === 0) return { ok: true, doneCount: 0 }
  const stamp = new Date().toISOString()
  const { error: upErr } = await supabase
    .from('job_milestones')
    .update({ status: 'done', status_date: stamp.slice(0, 10), updated_at: stamp })
    .in('id', toComplete)
  if (upErr) return { ok: false, error: upErr.message }
  return { ok: true, doneCount: toComplete.length }
}

// ── CEMETERY ORDERS ──────────────────────────────────────────────────────────
// Door orders placed by a cemetery. Stored in cemetery_orders (separate from the
// family-sales `orders` table). Draft is created on cemetery pick and saved as
// the operator moves through the wizard; "Submit to production" spawns one
// mausoleum_door job per door (jobs.cemetery_order_id set, order_id null).

export async function createCemeteryOrderDraft({ cemeteryName, cemeteryPricingSnapshot } = {}) {
  const row = { cemetery_name: cemeteryName || 'Untitled', doors: [], status: 'draft' }
  // Custom (operator-added) cemeteries snapshot their price list onto the row;
  // the 4 known cemeteries leave this null and resolve live by name.
  if (cemeteryPricingSnapshot) row.cemetery_pricing_snapshot = cemeteryPricingSnapshot
  const { data, error } = await supabase.from('cemetery_orders').insert(row).select().single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, order: data }
}

export async function updateCemeteryOrder(id, patch) {
  if (!id) return { ok: false, error: 'Missing cemetery order id' }
  const { data, error } = await supabase
    .from('cemetery_orders')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, order: data }
}

export async function getCemeteryOrder(id) {
  if (!id) return null
  const { data, error } = await supabase.from('cemetery_orders').select('*').eq('id', id).single()
  if (error) { console.warn('[cemetery] getCemeteryOrder:', error.message); return null }
  return data
}

// Archive / restore — soft, sets the archived flag (needs the
// cemetery_orders.archived column; the list filters client-side so it degrades
// gracefully until the one-line migration runs).
export async function setCemeteryOrderArchived(id, archived) {
  if (!id) return { ok: false, error: 'Missing cemetery order id' }
  const { error } = await supabase.from('cemetery_orders').update({ archived }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
// Hard delete — jobs / financial_records / job_cost_estimates reference
// cemetery_order_id ON DELETE RESTRICT, so this FAILS LOUD (returns the FK
// error) when the order has spawned jobs or carries financial rows; only an
// order with nothing linked (e.g. an abandoned draft) can be removed.
export async function deleteCemeteryOrder(id) {
  if (!id) return { ok: false, error: 'Missing cemetery order id' }
  const { error } = await supabase.from('cemetery_orders').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function getCemeteryOrders({ status, cemetery } = {}) {
  let q = supabase.from('cemetery_orders').select('*').order('created_at', { ascending: false })
  if (status) q = q.eq('status', status)
  if (cemetery) q = q.eq('cemetery_name', cemetery)
  const { data, error } = await q
  if (error) { console.warn('[cemetery] getCemeteryOrders:', error.message); return [] }
  return data || []
}

// Best-effort cemetery-record lookup for contact auto-population. The order
// stores the pricing LABEL ('St James'), while the cemeteries row is the full
// name ('St. James Cemetery'), so this normalizes punctuation, drops generic
// words (cemetery/memorial/park/gardens), and matches when every remaining
// token is present in a row's normalized name. Returns the first match or null.
export async function getCemeteryByName(name) {
  if (!name) return null
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const target = norm(name).replace(/\b(cemetery|memorial|park|gardens|mausoleum|parish)\b/g, ' ').replace(/\s+/g, ' ').trim()
  const tokens = target.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null
  const { data, error } = await supabase
    .from('cemeteries')
    .select('name, address, city, state, contact_phone, contact_email')
  if (error || !data) return null
  return data.find(c => { const n = norm(c.name); return tokens.every(t => n.includes(t)) }) || null
}

// Jobs spawned from a cemetery order, each with its milestone rows (for X-of-N
// progress + next-action derivation in the detail view). Ordered by door_index.
export async function getJobsForCemeteryOrder(cemeteryOrderId) {
  if (!cemeteryOrderId) return []
  const { data, error } = await supabase
    .from('jobs')
    .select('id, door_index, overall_status, last_update_at, next_action, next_action_due, milestones:job_milestones(milestone_key, label, status, sort_order, requires)')
    .eq('cemetery_order_id', cemeteryOrderId)
    .order('door_index', { ascending: true })
  if (error) { console.warn('[cemetery] getJobsForCemeteryOrder:', error.message); return [] }
  return data || []
}

// Distinct cemetery_name values across all cemetery orders — for the list-view
// cemetery filter dropdown.
export async function getDistinctCemeteryNames() {
  const { data, error } = await supabase.from('cemetery_orders').select('cemetery_name')
  if (error) { console.warn('[cemetery] getDistinctCemeteryNames:', error.message); return [] }
  return [...new Set((data || []).map(r => r.cemetery_name).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

// Upload a packet (PDF/image) to the cemetery_packets Storage bucket at
// cemetery_orders/{orderId}/{filename}. upsert so a replacement overwrites.
export async function uploadCemeteryPacket(orderId, file) {
  if (!orderId || !file) return { ok: false, error: 'Missing orderId or file' }
  const path = `cemetery_orders/${orderId}/${file.name}`
  const { error } = await supabase.storage.from('cemetery_packets').upload(path, file, { upsert: true })
  if (error) return { ok: false, error: error.message }
  return { ok: true, path }
}

// Signed download URL for a packet (the bucket is private). Short-lived.
export async function getCemeteryPacketSignedUrl(path, expiresIn = 300) {
  if (!path) return null
  const { data, error } = await supabase.storage.from('cemetery_packets').createSignedUrl(path, expiresIn)
  if (error) { console.warn('[cemetery] packet signed url:', error.message); return null }
  return data?.signedUrl || null
}

// =============================================================================
// FINANCIAL RECORDS — unified operational ledger (Migration J)
// =============================================================================
// Every dollar in (payment_received) or out (expense_incurred). Powers per-job
// / per-cemetery-order profitability and the Profit tab. tenant_id is left to
// the column DEFAULT. See 20260527_financial_records.sql.

// Expense categories — domain-reviewed (Monument Operations Architect). Baked
// into the financial_records CHECK constraint; keep these two in sync.
export const EXPENSE_CATEGORIES = [
  { key: 'material',      label: 'Material' },          // granite, bronze, stencil, abrasive
  { key: 'labor',         label: 'Labor' },             // in-house crew hours
  { key: 'subcontractor', label: 'Subcontractor' },     // hired foundation/crane crew
  { key: 'cemetery_fee',  label: 'Cemetery fee' },      // setting/opening fee to cemetery
  { key: 'equipment',     label: 'Equipment rental' },  // crane/lift/tool rental
  { key: 'vehicle',       label: 'Vehicle / fuel' },    // truck fuel, repairs, registration
  { key: 'overhead',      label: 'Overhead' },          // shop rent, utilities, insurance
  { key: 'other',         label: 'Other' },
]
export const PAYMENT_METHODS = [
  { key: 'check',         label: 'Check' },
  { key: 'credit_card',   label: 'Credit card' },
  { key: 'cash',          label: 'Cash' },
  { key: 'zelle',         label: 'Zelle' },
  { key: 'bank_transfer', label: 'Bank transfer' },
  { key: 'other',         label: 'Other' },
]
export const expenseCategoryLabel = (k) => EXPENSE_CATEGORIES.find(c => c.key === k)?.label || k || 'Uncategorized'
export const paymentMethodLabel = (k) => PAYMENT_METHODS.find(m => m.key === k)?.label || k || '—'

const sumAmt = (rows) => (rows || []).reduce((s, r) => s + Number(r.amount || 0), 0)
const groupByCategory = (rows) => {
  const out = {}
  for (const r of rows || []) {
    const k = r.category || 'uncategorized'
    out[k] = (out[k] || 0) + Number(r.amount || 0)
  }
  return out
}
// Shared margin math. revenue===null means "not attributable at this grain"
// (e.g. a cemetery door-job — revenue lives on the order). marginPercent is
// null both for that case and for no-activity; a loss with zero revenue keeps
// a negative margin but a null percent (N/A).
function buildProfit(revenue, expenses, byCategory) {
  if (revenue === null) return { revenue: null, expenses, byCategory, margin: null, marginPercent: null, rolledUp: true }
  const margin = revenue - expenses
  const marginPercent = revenue > 0 ? (margin / revenue) * 100 : null
  return { revenue, expenses, byCategory, margin, marginPercent, rolledUp: false }
}

export async function recordPayment({ amount, paymentMethod, paymentReference, occurredAt, jobId, orderId, cemeteryOrderId, notes, createdBy } = {}) {
  const amt = Math.round(Number(amount) * 100) / 100
  if (!Number.isFinite(amt) || amt === 0) return { ok: false, error: 'Payment amount must be a non-zero number' }
  const row = {
    record_type: 'payment_received', amount: amt,
    payment_method: paymentMethod || null, payment_reference: paymentReference || null,
    job_id: jobId || null, order_id: orderId || null, cemetery_order_id: cemeteryOrderId || null,
    notes: notes || null, created_by: createdBy || null,
  }
  if (occurredAt) row.occurred_at = occurredAt
  const { data, error } = await supabase.from('financial_records').insert(row).select().single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, record: data }
}

export async function recordExpense({ amount, category, vendor, description, occurredAt, jobId, orderId, cemeteryOrderId, receiptStoragePath, notes, createdBy } = {}) {
  const amt = Math.round(Number(amount) * 100) / 100
  if (!Number.isFinite(amt) || amt === 0) return { ok: false, error: 'Expense amount must be a non-zero number' }
  const row = {
    record_type: 'expense_incurred', amount: amt,
    category: category || null, vendor: vendor || null, description: description || null,
    receipt_storage_path: receiptStoragePath || null,
    job_id: jobId || null, order_id: orderId || null, cemetery_order_id: cemeteryOrderId || null,
    notes: notes || null, created_by: createdBy || null,
  }
  if (occurredAt) row.occurred_at = occurredAt
  const { data, error } = await supabase.from('financial_records').insert(row).select().single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, record: data }
}

export async function getFinancialRecords({ recordType, jobId, orderId, cemeteryOrderId, dateRange, category } = {}) {
  let q = supabase.from('financial_records').select('*').order('occurred_at', { ascending: false })
  if (recordType) q = q.eq('record_type', recordType)
  if (jobId) q = q.eq('job_id', jobId)
  if (orderId) q = q.eq('order_id', orderId)
  if (cemeteryOrderId) q = q.eq('cemetery_order_id', cemeteryOrderId)
  if (category) q = q.eq('category', category)
  if (dateRange?.start) q = q.gte('occurred_at', dateRange.start)
  if (dateRange?.end) q = q.lt('occurred_at', dateRange.end)   // half-open [start, end)
  const { data, error } = await q
  if (error) { console.warn('[fin] getFinancialRecords:', error.message); return [] }
  return data || []
}

// Per-job profitability. Revenue is attributed at exactly one grain:
//  • cemetery door-jobs → revenue NULL (rolled up to the cemetery order).
//  • family job → its own job-level payments, PLUS order-level payments only
//    when the parent order has exactly one job (disjoint: job_id IS NULL).
export async function getJobProfitability(jobId) {
  if (!jobId) return null
  const { data: job } = await supabase.from('jobs').select('id, order_id, cemetery_order_id').eq('id', jobId).single()
  const expRows = await getFinancialRecords({ recordType: 'expense_incurred', jobId })
  const expenses = sumAmt(expRows)
  const byCategory = groupByCategory(expRows)

  let revenue = null
  if (job && !job.cemetery_order_id) {
    revenue = sumAmt(await getFinancialRecords({ recordType: 'payment_received', jobId }))
    if (job.order_id) {
      const { count } = await supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('order_id', job.order_id)
      if (count === 1) {
        const orderPays = (await getFinancialRecords({ recordType: 'payment_received', orderId: job.order_id })).filter(r => !r.job_id)
        revenue += sumAmt(orderPays)
      }
    }
  }
  return buildProfit(revenue, expenses, byCategory)
}

// Per-cemetery-order profitability. Expenses = order-level + all its door-jobs'
// (disjoint by the at-most-one-link invariant). Revenue = order-level payments.
export async function getCemeteryOrderProfitability(cemeteryOrderId) {
  if (!cemeteryOrderId) return null
  const directExp = await getFinancialRecords({ recordType: 'expense_incurred', cemeteryOrderId })
  const { data: jobRows } = await supabase.from('jobs').select('id').eq('cemetery_order_id', cemeteryOrderId)
  const jobIds = (jobRows || []).map(j => j.id)
  let jobExp = []
  if (jobIds.length) {
    const { data } = await supabase.from('financial_records').select('*').eq('record_type', 'expense_incurred').in('job_id', jobIds)
    jobExp = data || []
  }
  const expRows = [...directExp, ...jobExp]
  const revenue = sumAmt(await getFinancialRecords({ recordType: 'payment_received', cemeteryOrderId }))
  return buildProfit(revenue, sumAmt(expRows), groupByCategory(expRows))
}

export async function getPaymentsTotal({ dateRange, method } = {}) {
  let q = supabase.from('financial_records').select('amount').eq('record_type', 'payment_received')
  if (method) q = q.eq('payment_method', method)
  if (dateRange?.start) q = q.gte('occurred_at', dateRange.start)
  if (dateRange?.end) q = q.lt('occurred_at', dateRange.end)
  const { data, error } = await q
  if (error) { console.warn('[fin] getPaymentsTotal:', error.message); return 0 }
  return sumAmt(data)
}

export async function getExpensesTotal({ dateRange, category } = {}) {
  let q = supabase.from('financial_records').select('amount').eq('record_type', 'expense_incurred')
  if (category) q = q.eq('category', category)
  if (dateRange?.start) q = q.gte('occurred_at', dateRange.start)
  if (dateRange?.end) q = q.lt('occurred_at', dateRange.end)
  const { data, error } = await q
  if (error) { console.warn('[fin] getExpensesTotal:', error.message); return 0 }
  return sumAmt(data)
}

// One query → { [cemeteryOrderId]: totalPaid }. Lets the list view compute
// each row's payment state without N round-trips.
export async function getPaidTotalsByCemeteryOrder() {
  const { data, error } = await supabase
    .from('financial_records')
    .select('cemetery_order_id, amount')
    .eq('record_type', 'payment_received')
    .not('cemetery_order_id', 'is', null)
  if (error) { console.warn('[fin] getPaidTotalsByCemeteryOrder:', error.message); return {} }
  const map = {}
  for (const r of data || []) map[r.cemetery_order_id] = (map[r.cemetery_order_id] || 0) + Number(r.amount || 0)
  return map
}

// Total paid against a single cemetery order (live from the ledger).
export async function getCemeteryOrderPaidTotal(cemeteryOrderId) {
  if (!cemeteryOrderId) return 0
  return sumAmt(await getFinancialRecords({ recordType: 'payment_received', cemeteryOrderId }))
}

// "Owed to you" — open A/R across cemetery orders (total_amount − paid) for
// active, non-cancelled orders. Family-order A/R is a follow-up.
export async function getOutstandingReceivable() {
  const { data, error } = await supabase
    .from('cemetery_orders')
    .select('id, total_amount, status')
    .in('status', ['submitted', 'in_production', 'completed', 'invoiced'])
  if (error) { console.warn('[fin] getOutstandingReceivable:', error.message); return 0 }
  const paid = await getPaidTotalsByCemeteryOrder()
  let owed = 0
  for (const o of data || []) {
    const bal = Number(o.total_amount || 0) - Number(paid[o.id] || 0)
    if (bal > 0) owed += bal
  }
  return owed
}

// Upload a receipt photo/PDF to the private `receipts` bucket. Returns the path.
export async function uploadReceipt(file) {
  if (!file) return { ok: false, error: 'Missing file' }
  const safe = String(file.name || 'receipt').replace(/[^\w.-]+/g, '_')
  const path = `receipts/${Date.now()}_${safe}`
  const { error } = await supabase.storage.from('receipts').upload(path, file, { upsert: true })
  if (error) return { ok: false, error: error.message }
  return { ok: true, path }
}

export async function getReceiptSignedUrl(path, expiresIn = 300) {
  if (!path) return null
  const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, expiresIn)
  if (error) { console.warn('[fin] receipt signed url:', error.message); return null }
  return data?.signedUrl || null
}

// =============================================================================
// PER-JOB P&L — estimates, profit-and-loss, variance signals (Migration K)
// =============================================================================
// Bottom-up operational P&L. Estimates are coarse (quote-time) buckets, kept
// deliberately SIMPLER than the 8 expense categories. Projected margin comes
// from estimates vs quoted_total; realized margin from actuals vs collected.

// Locked estimate taxonomy (Paul Q3). Baked into the job_cost_estimates CHECK.
export const ESTIMATE_CATEGORIES = [
  { key: 'material',          label: 'Material' },              // granite/bronze stock + consumables
  { key: 'labor',             label: 'Labor' },                 // shop engraving / fabrication hours
  { key: 'subcontractor',     label: 'Subcontractor' },         // hired foundation / crane crew
  { key: 'permits_cemetery',  label: 'Permits / cemetery fees' },// setting/opening + permits
  { key: 'install',           label: 'Install' },               // cemetery trip, set & foundation
  { key: 'other',             label: 'Other' },                 // misc / contingency
]
export const estimateCategoryLabel = (k) => ESTIMATE_CATEGORIES.find(c => c.key === k)?.label || k

// Maps each estimate category → the expense categories (from the 8-category
// ledger set) whose actuals roll up against it. Every expense category has a
// home, so total_actual reconciles. (Workflow Intelligence review.) Note:
// 'install'/'permits_cemetery' are approximate maps (no 1:1 expense category).
const ESTIMATE_TO_EXPENSE = {
  material:         ['material'],
  labor:            ['labor'],
  subcontractor:    ['subcontractor'],
  permits_cemetery: ['cemetery_fee'],
  install:          ['vehicle', 'equipment'],
  other:            ['other', 'overhead'],
}

// Margin percentages are stored in numeric(6,2) (±9999.99). Clamp computed
// values so a tiny-revenue / big-cost job can never overflow on write.
const clampPct = (n) => {
  if (n == null || !Number.isFinite(n)) return null
  return Math.max(-9999, Math.min(9999, Math.round(n * 100) / 100))
}

function buildCostByCategory(estimateRows, actualRows) {
  const estByCat = {}
  for (const r of estimateRows || []) estByCat[r.category] = Number(r.estimated_amount || 0)
  const actByExp = {}
  for (const r of actualRows || []) actByExp[r.category] = (actByExp[r.category] || 0) + Number(r.amount || 0)
  const byCategory = {}
  let total_estimated = 0, total_actual = 0
  for (const { key } of ESTIMATE_CATEGORIES) {
    const estimated = estByCat[key] || 0
    const actual = (ESTIMATE_TO_EXPENSE[key] || []).reduce((s, ec) => s + (actByExp[ec] || 0), 0)
    byCategory[key] = { estimated, actual, variance: actual - estimated }   // variance > 0 = over budget
    total_estimated += estimated; total_actual += actual
  }
  return { byCategory, estByCat, total_estimated, total_actual }
}

function buildMargin(contractTotal, collected, totalEstimated, totalActual) {
  const projected_dollar = contractTotal != null ? contractTotal - totalEstimated : null
  const projected_pct = contractTotal > 0 ? clampPct((projected_dollar / contractTotal) * 100) : null
  const realized_dollar = collected - totalActual
  const realized_pct = collected > 0 ? clampPct((realized_dollar / collected) * 100) : null
  const lost_pct = (projected_pct != null && realized_pct != null) ? clampPct(projected_pct - realized_pct) : null
  return { projected_pct, realized_pct, lost_pct, projected_dollar, realized_dollar }
}

// The three rule-based detectors, agent-corrected. Pure function over already
// fetched data so getJobPnL / getCemeteryOrderPnL don't re-query.
function computeSignals({ estByCat, actuals, payments, projectedPct, collected, totalActual, activeish }) {
  const signals = []

  // 1) material over budget — trip-wire +20% (granite volatility), red >40%.
  const estMat = estByCat['material'] || 0
  if (estMat > 0) {   // guard divide/false-fire when no estimate entered
    const actMat = (actuals || []).filter(r => r.category === 'material').reduce((s, r) => s + Number(r.amount || 0), 0)
    if (actMat > estMat * 1.20) {
      const over = actMat / estMat - 1
      signals.push({
        type: 'material_over_budget',
        severity: over > 0.40 ? 'red' : 'amber',
        message: 'Material spend over budget',
        evidence: `Actual ${fmtUSD(actMat)} vs estimate ${fmtUSD(estMat)} (+${Math.round(over * 100)}%, threshold +20%)`,
      })
    }
  }

  // 2) second install trip not billed — ≥2 distinct-date vehicle/equipment
  //    expense rows + no trip-fee revenue line (text heuristic). Advisory.
  const tripRows = (actuals || []).filter(r => r.category === 'vehicle' || r.category === 'equipment')
  const tripDates = [...new Set(tripRows.map(r => String(r.occurred_at || '').slice(0, 10)).filter(Boolean))]
  if (tripDates.length >= 2) {
    const billed = (payments || []).some(p => /trip|re-?deliver|extra visit|2nd trip|second trip/i.test(`${p.notes || ''} ${p.payment_reference || ''}`))
    if (!billed) {
      // Real $ already in the ledger — no invented numbers.
      const tripCost = tripRows.reduce((s, r) => s + Number(r.amount || 0), 0)
      signals.push({
        type: 'second_install_trip_not_billed',
        severity: 'amber',
        message: 'Possible unbilled second trip',
        evidence: `${tripDates.length} on-site trips (vehicle/equipment costs on ${tripDates.join(', ')}); ~${fmtUSD(tripCost)} in trip-date costs with no offsetting trip-fee revenue (heuristic).`,
        impactDollar: tripCost,
      })
    }
  }

  // 3) margin dropping in production — point-in-time (no trend data tonight),
  //    guarded for collected>0 && actuals>0; handles projected≤0 inversion.
  if (activeish && collected > 0 && totalActual > 0 && projectedPct != null) {
    const realized = ((collected - totalActual) / collected) * 100
    let fire = false, sev = 'amber'
    if (projectedPct <= 0) {
      if (realized < projectedPct) { fire = true; sev = 'red' }
    } else if (realized < projectedPct * 0.7) {
      fire = true
      sev = (realized <= projectedPct * 0.5 || realized < 0) ? 'red' : 'amber'
    }
    if (fire) {
      const gap = projectedPct > 0 ? ((projectedPct - realized) / 100) * collected : null
      signals.push({
        type: 'margin_dropping_in_production',
        severity: sev,
        message: 'Margin dropping while in production',
        evidence: `Realized ${realized.toFixed(0)}% vs projected ${projectedPct.toFixed(0)}%${gap != null && gap > 0 ? ` — roughly ${fmtUSD(gap)} of expected margin not yet realized at this spend level` : ''}. Collected ${fmtUSD(collected)}, spent ${fmtUSD(totalActual)}.`,
        impactDollar: gap,
      })
    }
  }
  return signals
}

// Estimates for one target (pass exactly one of jobId / cemeteryOrderId).
export async function getJobCostEstimates({ jobId, cemeteryOrderId } = {}) {
  if (!jobId && !cemeteryOrderId) return []
  let q = supabase.from('job_cost_estimates').select('*')
  q = jobId ? q.eq('job_id', jobId) : q.eq('cemetery_order_id', cemeteryOrderId)
  const { data, error } = await q
  if (error) { console.warn('[pnl] getJobCostEstimates:', error.message); return [] }
  return data || []
}

// Upsert one estimate by (job_id, cemetery_order_id, category). Relies on the
// UNIQUE NULLS NOT DISTINCT constraint — on_conflict must list all three cols.
export async function setJobCostEstimate({ jobId, cemeteryOrderId, category, estimatedAmount, notes, createdBy } = {}) {
  if ((!jobId && !cemeteryOrderId) || (jobId && cemeteryOrderId)) return { ok: false, error: 'Provide exactly one of jobId / cemeteryOrderId' }
  if (!category) return { ok: false, error: 'Missing category' }
  const amt = Math.round(Number(estimatedAmount) * 100) / 100
  if (!Number.isFinite(amt) || amt < 0) return { ok: false, error: 'Estimate must be a non-negative number' }
  const row = {
    job_id: jobId || null,
    cemetery_order_id: cemeteryOrderId || null,
    category,
    estimated_amount: amt,
    notes: notes || null,
    created_by: createdBy || null,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabase
    .from('job_cost_estimates')
    .upsert(row, { onConflict: 'job_id,cemetery_order_id,category' })
    .select()
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, estimate: data }
}

export async function removeJobCostEstimate(estimateId) {
  if (!estimateId) return { ok: false, error: 'Missing estimate id' }
  const { error } = await supabase.from('job_cost_estimates').delete().eq('id', estimateId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// Effective payments attributable to a job: job-level, plus order-level only
// when the parent family order has exactly one job (disjoint: job_id IS NULL).
async function effectiveJobPayments(job) {
  const jobPays = await getFinancialRecords({ recordType: 'payment_received', jobId: job.id })
  if (job.order_id) {
    const { count } = await supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('order_id', job.order_id)
    if (count === 1) {
      const orderPays = (await getFinancialRecords({ recordType: 'payment_received', orderId: job.order_id })).filter(r => !r.job_id)
      return [...jobPays, ...orderPays]
    }
  }
  return jobPays
}

export async function getJobPnL(jobId) {
  if (!jobId) return null
  const { data: job } = await supabase.from('jobs').select('id, quoted_total, order_id, cemetery_order_id, overall_status').eq('id', jobId).single()
  if (!job) return null
  const [estimates, actuals, payments] = await Promise.all([
    getJobCostEstimates({ jobId }),
    getFinancialRecords({ recordType: 'expense_incurred', jobId }),
    effectiveJobPayments(job),
  ])
  const costs = buildCostByCategory(estimates, actuals)
  const collected = payments.reduce((s, p) => s + Number(p.amount || 0), 0)
  const sortedPays = payments.slice().sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)))
  const deposit = sortedPays.length ? Number(sortedPays[0].amount || 0) : 0
  const contract_total = job.quoted_total != null ? Number(job.quoted_total) : null
  const margin = buildMargin(contract_total, collected, costs.total_estimated, costs.total_actual)
  const activeish = !['completed', 'cancelled', 'closed', 'archived', 'paid'].includes(job.overall_status)
  const signals = computeSignals({ estByCat: costs.estByCat, actuals, payments, projectedPct: margin.projected_pct, collected, totalActual: costs.total_actual, activeish })
  return {
    revenue: { contract_total, deposit, payments_collected: collected, balance_due: contract_total != null ? contract_total - collected : null },
    costs: { byCategory: costs.byCategory, total_estimated: costs.total_estimated, total_actual: costs.total_actual },
    margin,
    signals,
  }
}

export async function getCemeteryOrderPnL(cemeteryOrderId) {
  if (!cemeteryOrderId) return null
  const { data: order } = await supabase.from('cemetery_orders').select('id, total_amount, status').eq('id', cemeteryOrderId).single()
  if (!order) return null
  const [estimates, directExp, payments, jobRowsRes] = await Promise.all([
    getJobCostEstimates({ cemeteryOrderId }),
    getFinancialRecords({ recordType: 'expense_incurred', cemeteryOrderId }),
    getFinancialRecords({ recordType: 'payment_received', cemeteryOrderId }),
    supabase.from('jobs').select('id').eq('cemetery_order_id', cemeteryOrderId),
  ])
  const jobIds = (jobRowsRes.data || []).map(j => j.id)
  let jobExp = []
  if (jobIds.length) {
    const { data } = await supabase.from('financial_records').select('*').eq('record_type', 'expense_incurred').in('job_id', jobIds)
    jobExp = data || []
  }
  const actuals = [...directExp, ...jobExp]
  const costs = buildCostByCategory(estimates, actuals)
  const collected = payments.reduce((s, p) => s + Number(p.amount || 0), 0)
  const sortedPays = payments.slice().sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)))
  const deposit = sortedPays.length ? Number(sortedPays[0].amount || 0) : 0
  const contract_total = order.total_amount != null ? Number(order.total_amount) : null
  const margin = buildMargin(contract_total, collected, costs.total_estimated, costs.total_actual)
  const activeish = !['completed', 'cancelled', 'paid'].includes(order.status)
  const signals = computeSignals({ estByCat: costs.estByCat, actuals, payments, projectedPct: margin.projected_pct, collected, totalActual: costs.total_actual, activeish })
  return {
    revenue: { contract_total, deposit, payments_collected: collected, balance_due: contract_total != null ? contract_total - collected : null },
    costs: { byCategory: costs.byCategory, total_estimated: costs.total_estimated, total_actual: costs.total_actual },
    margin,
    signals,
  }
}

// Standalone signal run for a job (used where only signals are needed).
export async function detectJobSignals(jobId) {
  const pnl = await getJobPnL(jobId)
  return pnl?.signals || []
}

// Mirror of detectJobSignals for a cemetery order.
export async function detectCemeteryOrderSignals(cemeteryOrderId) {
  const pnl = await getCemeteryOrderPnL(cemeteryOrderId)
  return pnl?.signals || []
}

// =============================================================================
// computeOrderPressure — single highest-severity blocker + call signal
// =============================================================================
// Shared substrate used by Customers + Orders tabs (and reusable elsewhere) to
// derive an operator-readable "what's this order doing right now" read. ONE
// blocker per order — the highest-severity match wins (avoids chip-soup).
//
// The function is intentionally defensive — it accepts (order, job?, milestones?)
// and only fires the blockers it can ground in real data:
//   • Milestone-state blockers fire only when the relevant milestone row exists
//     and its status_date/requires/templates substrate is in place
//   • Order-level blockers (overdue_balance) fire from columns we always have
//   • Status-string blockers (waiting_on_*) fire from job.overall_status
//
// Severity ranking (highest first) — labels are operator-vocabulary per the
// CRM-RESKIN-PASS Monument review:
//   1. overdue_balance      (red)   "Overdue balance"            — balance > 0 + past target
//   2. install_late         (red)   "Install late"               — installed.due_date past, not done
//   3. production_blocked   (amber) "Stuck in production Nd"     — prod_started ≥14d, no prod_completed
//   4. proof_waiting_customer (amber) "Awaiting proof approval"  — proof_created done, proof_approved actionable
//   5. cemetery_hold        (amber) "Cemetery hold"              — job status OR permit gap
//   6. waiting_on_family    (amber) "Waiting on family"          — job.overall_status='waiting_on_customer'
//   7. needs_install_date   (blue)  "Needs install date"         — prod_completed done, ready_to_install actionable
//   8a. install_scheduled   (blue)  "Install scheduled <date>"   — ready_to_install done + installed.due_date set
//   8b. stone_ready_schedule_trip (blue) "Stone ready — schedule trip" — ready_to_install done, no due_date
//   9. (null — no detectable blocker / no milestone signal)
//
// needsCall = true when blocker is overdue_balance, install_late,
// proof_waiting_customer, waiting_on_family, OR stone_ready_schedule_trip
// (>3 days). install_scheduled does NOT trigger a call (the date is set;
// no operator action needed unless it slips). The >3 days rule on
// stone_ready_schedule_trip prevents same-day readiness from screaming
// "call now."
const PRODUCTION_STALL_DAYS  = 14
const READY_FOR_INSTALL_CALL_DAYS = 3

export function computeOrderPressure(order, job = null, milestones = null) {
  const empty = { blocker: null, needsCall: false, callReasons: [], paymentState: 'none', ageDays: 0 }
  if (!order) return empty

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  // Age — prefer signed_at, fall back to created_at for unsigned drafts.
  const ageAnchor = order.signed_at || order.pricing_locked_at || order.created_at || null
  const ageDays = ageAnchor
    ? Math.max(0, Math.floor((now - new Date(ageAnchor)) / 86400000))
    : 0

  // Payment state — independent of blockers. rowGrandTotal/rowTotalPaid read
  // from the canonical payments[] path the Customers tab already uses.
  const total = rowGrandTotal(order)
  const paid  = rowTotalPaid(order)
  const balance = total - paid
  let paymentState = 'none'
  if (total > 0) {
    if (balance <= 0) paymentState = 'paid_in_full'
    else if (paid > 0) paymentState = 'partial'
    else paymentState = 'unpaid'
    if (balance > 0 && order.target_completion_date) {
      const tgt = new Date(order.target_completion_date)
      if (tgt < todayStart) paymentState = 'overdue'
    }
  }

  // Milestone index — empty Map if neither milestones nor job.milestones provided.
  const ms = milestones || job?.milestones || []
  const byKey = new Map(ms.map(m => [m.milestone_key, m]))
  const isActionable = (m) => m && m.status !== 'done' && m.status !== 'not_needed'
  const isDone = (m) => m && m.status === 'done'

  // Resolve in priority order — first match wins. Returning early keeps the
  // ranking explicit (no post-hoc sort that could drift).

  // 1. overdue_balance (red)
  if (SOLD_STATUSES.includes(order.status) && balance > 0 && order.target_completion_date) {
    const tgt = new Date(order.target_completion_date)
    if (tgt < todayStart) {
      return _packPressure({
        blocker: { kind: 'overdue_balance', label: 'Overdue balance', severity: 'red' },
        callReasons: ['Overdue balance'],
        paymentState, ageDays,
      })
    }
  }

  // 2. install_late (red) — milestone-driven; requires due_date to have been set.
  // NOTE (sparse data): installed.due_date is populated on ~0.6% of milestones
  // in current prod (per 2026-05-28 audit), so this branch is forward-looking;
  // it will essentially never fire on existing rows until milestone due_dates
  // start landing. Adding install_late to callReasons because slipped installs
  // are the most apologetic-call scenario and were silently excluded before.
  const installed = byKey.get('installed') || byKey.get('door_installed') || byKey.get('work_completed')
  if (installed && isActionable(installed) && installed.due_date) {
    const due = new Date(installed.due_date)
    if (due < todayStart) {
      return _packPressure({
        blocker: { kind: 'install_late', label: 'Install late', severity: 'red' },
        callReasons: ['Install date slipped'],
        paymentState, ageDays,
      })
    }
  }

  // 3. production_blocked (amber) — started ≥14d ago, not completed.
  // NOTE (sparse data): production_started.status_date is populated on ~2.7%
  // of milestones, so the stall computation falls back to the order's age
  // when status_date is null — a defensible proxy ("if this order is 20+
  // days old AND production_started but not completed, it's stuck"). When
  // status_date later starts populating reliably, the fallback becomes
  // irrelevant on its own.
  const prodStarted   = byKey.get('production_started')
  const prodCompleted = byKey.get('production_completed') || byKey.get('work_completed')
  if (isDone(prodStarted) && isActionable(prodCompleted)) {
    const stallAnchor = prodStarted.status_date
      ? new Date(prodStarted.status_date)
      : (order.signed_at ? new Date(order.signed_at) : null)  // signed_at fallback when status_date sparse
    const stallDays = stallAnchor ? Math.floor((now - stallAnchor) / 86400000) : 0
    if (stallDays >= PRODUCTION_STALL_DAYS) {
      return _packPressure({
        blocker: { kind: 'production_blocked', label: `Stuck in production ${stallDays}d`, severity: 'amber' },
        callReasons: [],
        paymentState, ageDays,
      })
    }
  }

  // 4. proof_waiting_customer (amber)
  const proofCreated  = byKey.get('proof_created')
  const proofApproved = byKey.get('proof_approved')
  if (isDone(proofCreated) && isActionable(proofApproved)) {
    return _packPressure({
      blocker: { kind: 'proof_waiting_customer', label: 'Awaiting proof approval', severity: 'amber' },
      callReasons: ['Awaiting proof approval'],
      paymentState, ageDays,
    })
  }

  // 5. cemetery_hold (amber) — was 'Waiting on cemetery'; Monument review
  // flagged it as too vague for action (could be permit, plot info, or rules).
  // Phase 2 will split into sub-kinds when template milestones disambiguate.
  if (job?.overall_status === 'waiting_on_cemetery') {
    return _packPressure({
      blocker: { kind: 'cemetery_hold', label: 'Cemetery hold', severity: 'amber' },
      callReasons: [],
      paymentState, ageDays,
    })
  }
  const permitFiled    = byKey.get('permit_filed')
  const permitApproved = byKey.get('permit_approved')
  if (isDone(permitFiled) && isActionable(permitApproved)) {
    return _packPressure({
      blocker: { kind: 'cemetery_hold', label: 'Cemetery hold', severity: 'amber' },
      callReasons: [],
      paymentState, ageDays,
    })
  }

  // 6. waiting_on_family (amber) — was 'Waiting on customer'; "family" is
  // the funeral/monument-industry universal noun.
  if (job?.overall_status === 'waiting_on_customer') {
    return _packPressure({
      blocker: { kind: 'waiting_on_family', label: 'Waiting on family', severity: 'amber' },
      callReasons: ['Waiting on family'],
      paymentState, ageDays,
    })
  }

  // 7. needs_install_date (blue) — production done, no install on calendar.
  // Was 'Needs scheduling' — disambiguated to specifically mean install date.
  const readyToInstall = byKey.get('ready_to_install')
  if (isDone(prodCompleted) && isActionable(installed) && !isDone(readyToInstall)) {
    return _packPressure({
      blocker: { kind: 'needs_install_date', label: 'Needs install date', severity: 'blue' },
      callReasons: [],
      paymentState, ageDays,
    })
  }

  // 8. ready_for_install (blue) — split into two states based on whether
  // an install date is on the calendar (Monument: "Ready for install" was
  // ambiguous between "stone done, no trip yet" and "trip scheduled").
  //   • installed.due_date set + in future → "Install scheduled [date]"
  //   • no installed.due_date                → "Stone ready — schedule trip"
  if (isDone(readyToInstall) && isActionable(installed)) {
    const dueDate = installed?.due_date
    if (dueDate) {
      const formatted = _shortDate(dueDate)
      return _packPressure({
        blocker: { kind: 'install_scheduled', label: `Install scheduled ${formatted}`, severity: 'blue' },
        callReasons: [],     // scheduled — no call needed unless date slips
        paymentState, ageDays,
      })
    }
    const callReasons = []
    if (readyToInstall.status_date) {
      const readyAge = Math.floor((now - new Date(readyToInstall.status_date)) / 86400000)
      if (readyAge > READY_FOR_INSTALL_CALL_DAYS) callReasons.push(`Stone ready ${readyAge}d — call to schedule`)
    }
    return _packPressure({
      blocker: { kind: 'stone_ready_schedule_trip', label: 'Stone ready — schedule trip', severity: 'blue' },
      callReasons,
      paymentState, ageDays,
    })
  }

  // 9. closeout_pending (blue) — the work is installed/done but the order
  // hasn't been closed out with the family yet. Fires when `installed` is done
  // AND a closeout-group milestone is still actionable AND the order isn't a
  // terminal closed/cancelled state. This is the "Close out order with customer"
  // task (ITEM 5) — it routes to the order's closeout surface (completion photos
  // + the AI closeout draft). Milestone-driven, no storage scan; the photos the
  // crew uploads at completion are the operator's cue, the install milestone is
  // the system trigger.
  const CLOSEOUT_TERMINAL = ['closed', 'cancelled', 'archived']
  const closeoutActionable = ms.some(m => m.group === 'closeout' && isActionable(m))
  if (isDone(installed) && closeoutActionable && !CLOSEOUT_TERMINAL.includes(order.status)) {
    return _packPressure({
      blocker: { kind: 'closeout_pending', label: 'Close out with customer', severity: 'blue' },
      callReasons: [],
      paymentState, ageDays,
    })
  }

  // 10. healthy / in flight
  return _packPressure({ blocker: null, callReasons: [], paymentState, ageDays })
}

// Compact month-day formatter used in dynamic blocker labels.
function _shortDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Internal — derives needsCall from callReasons, packs the return.
function _packPressure({ blocker, callReasons, paymentState, ageDays }) {
  return {
    blocker,
    needsCall: (callReasons || []).length > 0,
    callReasons: callReasons || [],
    paymentState,
    ageDays,
  }
}

// =============================================================================
// PROFIT OVERVIEW — company nervous system + operational rollups (Layer 1/2)
// =============================================================================
// One bulk fetch → all Profit-tab aggregates, computed client-side so we make a
// handful of round-trips instead of N per-entity calls. NO fabricated numbers:
// callers render honest empty states from the null/zero fields here.

// Milestone group ordering (mirrors JobsTab GROUP_ORDER) for the stage pill.
const PNL_STAGE_ORDER = ['intake', 'design', 'permit', 'stone', 'photo', 'etching', 'production', 'foundation', 'install', 'closeout']
const PNL_STAGE_LABEL = { intake: 'Intake', design: 'Design', permit: 'Permit', stone: 'Stone', photo: 'Photo', etching: 'Etching', production: 'Production', foundation: 'Foundation', install: 'Install', closeout: 'Closeout' }
const JOB_CLOSED = ['completed', 'cancelled', 'closed', 'archived', 'paid']
const CEM_CLOSED = ['completed', 'cancelled', 'paid']

// Full Q4 margin tone: red if realized < projected×0.5 OR < 20 abs; amber if
// < projected×0.7 OR < 30 abs; null pct → neutral.
export function marginToneOf(projectedPct, realizedPct) {
  const v = realizedPct != null ? realizedPct : projectedPct
  if (v == null) return 'neutral'
  if ((projectedPct != null && v < projectedPct * 0.5) || v < 20) return 'red'
  if ((projectedPct != null && v < projectedPct * 0.7) || v < 30) return 'amber'
  return 'green'
}

const median = (arr) => {
  const a = arr.filter(x => x != null).sort((x, y) => x - y)
  if (!a.length) return null
  const m = Math.floor(a.length / 2)
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}

// Staff list for dimension dropdowns (sales rep). From user_settings.
export async function getStaffList() {
  const { data, error } = await supabase.from('user_settings').select('user_id, display_name')
  if (error) { console.warn('[profit] getStaffList:', error.message); return [] }
  return (data || []).map(u => ({ id: u.user_id, name: u.display_name || 'Staff' }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// Write dimensional tags straight to the jobs row.
export async function updateJobDimensions(jobId, patch) {
  if (!jobId) return { ok: false, error: 'Missing job id' }
  const allowed = {}
  for (const k of ['sales_rep_id', 'crew_id', 'referral_source', 'referral_entity_id', 'quoted_total']) {
    if (k in patch) allowed[k] = patch[k]
  }
  const { error } = await supabase.from('jobs').update({ ...allowed, last_update_at: new Date().toISOString() }).eq('id', jobId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// Empty-overview shape — used when getProfitOverview fails, so the caller's
// loading state always resolves cleanly and the page renders honest empty
// states instead of hanging on "Loading…" forever.
const _emptyProfitOverview = () => ({
  metrics: {
    revenueMonth: 0, revenuePrev: 0, revenueSpark: new Array(30).fill(0),
    expensesMonth: 0, expensesPrev: 0, expensesSpark: new Array(30).fill(0),
    netMonth: 0, arTotal: 0, aging: { current: 0, d30: 0, d60: 0 }, arOver30Count: 0,
    cashFlow: 0, forecast14: null, overheadBurn: 0,
    avgJobMargin: { weightedPct: null, medianPct: null, n: 0 },
  },
  cemeteryRollup: [], jobTypeRollup: [], activeRows: [], topSignals: [],
  _error: null,
})

export async function getProfitOverview() {
  try {
    return await _getProfitOverviewInner()
  } catch (e) {
    // NEVER let this reject — the Profit tab's loading state depends on a
    // resolved value. Surface the error in the return shape; the page renders
    // honest empty states + can show the error message.
    console.error('[profit] getProfitOverview failed:', e)
    return { ..._emptyProfitOverview(), _error: e?.message || String(e) }
  }
}

async function _getProfitOverviewInner() {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const thirtyAgo = new Date(now.getTime() - 30 * 864e5)

  // Per-section guards — one failing query doesn't kill the whole overview.
  // Each entry returns `{data: []|null}` shape so destructuring stays uniform.
  const safe = async (p, label) => {
    try { const r = await p; if (r?.error) console.warn(`[profit] ${label}:`, r.error.message); return r }
    catch (e) { console.warn(`[profit] ${label} threw:`, e?.message || e); return { data: [], error: e } }
  }

  const [finPays, exps, jobsRes, cemRes, estRes, ordersRes] = await Promise.all([
    safe(getFinancialRecords({ recordType: 'payment_received' }), 'payments').then(r => Array.isArray(r) ? r : (r?.data || [])),
    safe(getFinancialRecords({ recordType: 'expense_incurred' }), 'expenses').then(r => Array.isArray(r) ? r : (r?.data || [])),
    safe(supabase.from('jobs').select('id, job_type, order_id, cemetery_order_id, quoted_total, overall_status'), 'jobs'),
    safe(supabase.from('cemetery_orders').select('id, cemetery_name, total_amount, status, created_at, submitted_at'), 'cemetery_orders'),
    safe(supabase.from('job_cost_estimates').select('job_id, cemetery_order_id, category, estimated_amount'), 'estimates'),
    // D1 — archived orders never count toward any financial rollup.
    safe(supabase.from('orders').select('id, payments, deposit_amount, balance_amount, deposit_received_at, contract_total, pricing, add_ons, created_at, archived').or('archived.is.null,archived.eq.false').limit(10000), 'orders'),
  ])
  const jobs = jobsRes?.data || []
  const cems = cemRes?.data || []
  const estimates = estRes?.data || []
  const orders = ordersRes?.data || []

  // REAL MONEY: financial_records is empty in prod — the live payment ledger is
  // orders.payments[]. Flatten non-voided LOCKED entries into the same row shape
  // the overview already sums ({ amount, occurred_at, order_id, job_id }), so
  // every downstream calc (monthly revenue, sparklines, per-order collected,
  // cash flow) picks up real dollars instead of $0. (Item 1 root cause.)
  const orderPays = []
  const contractByOrder = {}
  for (const o of orders) {
    contractByOrder[o.id] = (o.contract_total != null ? Number(o.contract_total) : rowGrandTotal(o)) || 0
    const ps = Array.isArray(o.payments) ? o.payments.filter(p => p && !p.voided && (p.locked ?? true)) : []
    for (const p of ps) {
      const amt = Number(p.amount) || 0
      if (amt === 0) continue
      orderPays.push({ amount: amt, occurred_at: p.receivedAt || p.createdAt || o.created_at, order_id: o.id, job_id: null })
    }
    // Read-fallback for legacy rows with no payments[] but a legacy deposit.
    if (ps.length === 0 && Number(o.deposit_amount) > 0) {
      orderPays.push({ amount: Number(o.deposit_amount), occurred_at: o.deposit_received_at || o.created_at, order_id: o.id, job_id: null })
    }
  }
  const pays = [...finPays, ...orderPays]

  // active-job stage: fetch milestones only for non-closed jobs.
  // FIX: `group` is a SQL reserved word — the prior alias `group_key:group`
  // was fragile in PostgREST. Select * and read m.group in JS (matches how
  // JobsTab already consumes milestone rows).
  const activeJobIds = jobs.filter(j => !JOB_CLOSED.includes(j.overall_status)).map(j => j.id)
  let milestones = []
  if (activeJobIds.length) {
    const mres = await safe(
      supabase.from('job_milestones').select('*').in('job_id', activeJobIds),
      'job_milestones',
    )
    milestones = mres?.data || []
  }
  const stageByJob = {}
  {
    const byJob = {}
    for (const m of milestones) (byJob[m.job_id] ||= []).push(m)
    for (const [jid, ms] of Object.entries(byJob)) {
      const open = ms.filter(m => m.status !== 'done' && m.status !== 'not_needed')
        .sort((a, b) => (PNL_STAGE_ORDER.indexOf(a.group) - PNL_STAGE_ORDER.indexOf(b.group)) || (a.sort_order ?? 0) - (b.sort_order ?? 0))
      stageByJob[jid] = open.length ? (PNL_STAGE_LABEL[open[0].group] || open[0].group || '—') : 'Closeout'
    }
  }

  // group helpers
  const sumBy = (rows, keyFn) => { const m = {}; for (const r of rows) { const k = keyFn(r); if (k != null) m[k] = (m[k] || 0) + Number(r.amount || 0) } return m }
  const payByJob = sumBy(pays, r => r.job_id), payByCem = sumBy(pays, r => r.cemetery_order_id), payByOrder = sumBy(pays, r => (!r.job_id ? r.order_id : null))
  const expByJob = sumBy(exps, r => r.job_id), expByCem = sumBy(exps, r => r.cemetery_order_id)
  const jobsByOrderCount = {}; for (const j of jobs) if (j.order_id) jobsByOrderCount[j.order_id] = (jobsByOrderCount[j.order_id] || 0) + 1
  const jobsByCem = {}; for (const j of jobs) if (j.cemetery_order_id) (jobsByCem[j.cemetery_order_id] ||= []).push(j.id)
  // per-target estimate actuals (category → expense rows for that target)
  const expRowsByJob = {}; for (const e of exps) if (e.job_id) (expRowsByJob[e.job_id] ||= []).push(e)
  const expRowsByCem = {}; for (const e of exps) if (e.cemetery_order_id) (expRowsByCem[e.cemetery_order_id] ||= []).push(e)
  const estRowsByJob = {}; for (const e of estimates) if (e.job_id) (estRowsByJob[e.job_id] ||= []).push(e)
  const estRowsByCem = {}; for (const e of estimates) if (e.cemetery_order_id) (estRowsByCem[e.cemetery_order_id] ||= []).push(e)
  const payRowsByJob = {}; for (const p of pays) if (p.job_id) (payRowsByJob[p.job_id] ||= []).push(p)
  const payRowsByCem = {}; for (const p of pays) if (p.cemetery_order_id) (payRowsByCem[p.cemetery_order_id] ||= []).push(p)

  // ── METRICS ────────────────────────────────────────────────────────────
  const inMonth = (iso, start, end) => { const t = new Date(iso).getTime(); return t >= start.getTime() && (!end || t < end.getTime()) }
  const revenueMonth = sumAmt(pays.filter(p => inMonth(p.occurred_at, monthStart)))
  const revenuePrev = sumAmt(pays.filter(p => inMonth(p.occurred_at, prevStart, monthStart)))
  const expensesMonth = sumAmt(exps.filter(e => inMonth(e.occurred_at, monthStart)))
  const expensesPrev = sumAmt(exps.filter(e => inMonth(e.occurred_at, prevStart, monthStart)))
  // 30-day daily sparklines (oldest → newest)
  const spark = (rows) => {
    const buckets = new Array(30).fill(0)
    for (const r of rows) {
      const days = Math.floor((now.getTime() - new Date(r.occurred_at).getTime()) / 864e5)
      if (days >= 0 && days < 30) buckets[29 - days] += Number(r.amount || 0)
    }
    return buckets
  }
  const revenueSpark = spark(pays.filter(p => new Date(p.occurred_at) >= thirtyAgo))
  const expensesSpark = spark(exps.filter(e => new Date(e.occurred_at) >= thirtyAgo))

  // A/R aging across active cemetery orders (no due dates → age by submitted/created)
  const paidByCemTotal = sumBy(pays, r => r.cemetery_order_id)
  const aging = { current: 0, d30: 0, d60: 0 }
  let arTotal = 0, arOver30Count = 0
  for (const o of cems) {
    if (CEM_CLOSED.includes(o.status) || o.status === 'draft') continue
    const bal = Number(o.total_amount || 0) - Number(paidByCemTotal[o.id] || 0)
    if (bal <= 0) continue
    arTotal += bal
    const ageDays = Math.floor((now.getTime() - new Date(o.submitted_at || o.created_at).getTime()) / 864e5)
    if (ageDays >= 60) { aging.d60 += bal; arOver30Count++ }
    else if (ageDays >= 30) { aging.d30 += bal; arOver30Count++ }
    else aging.current += bal
  }

  const cashFlow = sumAmt(pays) - sumAmt(exps)   // all-time operational
  const overheadBurn = sumAmt(exps.filter(e => !e.job_id && !e.order_id && !e.cemetery_order_id && new Date(e.occurred_at) >= thirtyAgo))

  // ── per-entity P&L (in-memory, reuses buildCostByCategory/buildMargin) ───
  const familyJobPnL = (j) => {
    const actuals = expRowsByJob[j.id] || []
    const costs = buildCostByCategory(estRowsByJob[j.id] || [], actuals)
    let collected = (payByJob[j.id] || 0)
    if (j.order_id && jobsByOrderCount[j.order_id] === 1) collected += (payByOrder[j.order_id] || 0)
    // Contract revenue: job.quoted_total when set, else the order's real total
    // (contract_total ?? pricing-derived) — quoted_total is null on most orders.
    const contract = j.quoted_total != null
      ? Number(j.quoted_total)
      : (j.order_id && contractByOrder[j.order_id] ? contractByOrder[j.order_id] : null)
    const margin = buildMargin(contract, collected, costs.total_estimated, costs.total_actual)
    return { costs, collected, contract, margin, actuals }
  }
  const cemPnL = (o) => {
    const jobIds = jobsByCem[o.id] || []
    const actuals = [...(expRowsByCem[o.id] || []), ...jobIds.flatMap(id => expRowsByJob[id] || [])]
    const costs = buildCostByCategory(estRowsByCem[o.id] || [], actuals)
    const collected = (payByCem[o.id] || 0)
    const contract = o.total_amount != null ? Number(o.total_amount) : null
    const margin = buildMargin(contract, collected, costs.total_estimated, costs.total_actual)
    return { costs, collected, contract, margin, actuals, jobCount: jobIds.length }
  }

  // ── ACTIVE ROWS (jobs + cemetery orders) + signals ──────────────────────
  const activeRows = []
  const allSignals = []
  for (const j of jobs) {
    if (j.cemetery_order_id) continue   // door-jobs roll up to the order
    const p = familyJobPnL(j)
    const activeish = !JOB_CLOSED.includes(j.overall_status)
    const signals = computeSignals({ estByCat: p.costs.estByCat, actuals: p.actuals, payments: payRowsByJob[j.id] || [], projectedPct: p.margin.projected_pct, collected: p.collected, totalActual: p.costs.total_actual, activeish })
    const row = {
      key: `j:${j.id}`, kind: 'Job', jobType: j.job_type, status: j.overall_status,
      stage: stageByJob[j.id] || (activeish ? '—' : 'Closeout'),
      revenue: p.collected, cost: p.costs.total_actual,
      projectedPct: p.margin.projected_pct, realizedPct: p.margin.realized_pct,
      tone: marginToneOf(p.margin.projected_pct, p.margin.realized_pct),
      active: activeish, signals,
      byCategory: p.costs.byCategory, contract: p.contract,
      actuals: p.actuals,
    }
    activeRows.push(row)
    for (const s of signals) allSignals.push({ ...s, link: row.key, label: `Job ${String(j.id).slice(0, 8)}` })
  }
  for (const o of cems) {
    if (o.status === 'draft') continue
    const p = cemPnL(o)
    const activeish = !CEM_CLOSED.includes(o.status)
    const signals = computeSignals({ estByCat: p.costs.estByCat, actuals: p.actuals, payments: payRowsByCem[o.id] || [], projectedPct: p.margin.projected_pct, collected: p.collected, totalActual: p.costs.total_actual, activeish })
    const row = {
      key: `c:${o.id}`, kind: 'Cemetery order', status: o.status, stage: o.status,
      label: o.cemetery_name, sub: o.cemetery_name,
      revenue: p.collected, cost: p.costs.total_actual,
      projectedPct: p.margin.projected_pct, realizedPct: p.margin.realized_pct,
      tone: marginToneOf(p.margin.projected_pct, p.margin.realized_pct),
      active: activeish, signals, jobCount: p.jobCount,
      byCategory: p.costs.byCategory, contract: p.contract,
      actuals: p.actuals,
    }
    activeRows.push(row)
    for (const s of signals) allSignals.push({ ...s, link: row.key, label: o.cemetery_name })
  }

  // top 3 signals (red first)
  const sevRank = { red: 0, amber: 1 }
  const topSignals = allSignals.sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9)).slice(0, 3)

  // ── CEMETERY ROLLUP (group by name) ──────────────────────────────────────
  const cemByName = {}
  for (const o of cems) {
    if (o.status === 'draft') continue
    const b = (cemByName[o.cemetery_name] ||= { name: o.cemetery_name, orderIds: [], rev: 0, exp: 0, jobCount: 0 })
    b.orderIds.push(o.id)
  }
  for (const b of Object.values(cemByName)) {
    const jobset = new Set(b.orderIds.flatMap(oid => jobsByCem[oid] || []))
    b.jobCount = jobset.size
    for (const oid of b.orderIds) { b.rev += (payByCem[oid] || 0); b.exp += (expByCem[oid] || 0) }
    for (const jid of jobset) b.exp += (expByJob[jid] || 0)
    b.marginPct = b.rev > 0 ? Math.round(((b.rev - b.exp) / b.rev) * 100) : null
    b.tone = marginToneOf(null, b.marginPct)
  }
  const cemeteryRollup = Object.values(cemByName)
    .sort((a, b) => (b.marginPct ?? -Infinity) - (a.marginPct ?? -Infinity))

  // ── JOB-TYPE ROLLUP (family types only; mausoleum_door rolls to cemetery) ─
  const FAMILY_TYPES = new Set(['new_stone', 'inscription', 'bronze', 'cleaning_repair'])
  const byType = {}
  for (const j of jobs) {
    if (!FAMILY_TYPES.has(j.job_type)) continue
    const b = (byType[j.job_type] ||= { jobType: j.job_type, rev: 0, exp: 0, jobCount: 0 })
    b.jobCount++
    b.exp += (expByJob[j.id] || 0)
    b.rev += (payByJob[j.id] || 0)
    if (j.order_id && jobsByOrderCount[j.order_id] === 1) b.rev += (payByOrder[j.order_id] || 0)
  }
  for (const b of Object.values(byType)) {
    b.marginPct = b.rev > 0 ? Math.round(((b.rev - b.exp) / b.rev) * 100) : null
    b.tone = marginToneOf(null, b.marginPct)
  }
  const jobTypeRollup = Object.values(byType).sort((a, b) => (b.marginPct ?? -Infinity) - (a.marginPct ?? -Infinity))

  // ── AVG JOB MARGIN (revenue-weighted + median) ───────────────────────────
  const incl = []
  for (const j of jobs) {
    if (j.cemetery_order_id || j.quoted_total == null) continue
    const actual = expByJob[j.id] || 0
    if (actual <= 0) continue
    let collected = payByJob[j.id] || 0
    if (j.order_id && jobsByOrderCount[j.order_id] === 1) collected += (payByOrder[j.order_id] || 0)
    if (collected <= 0) continue
    incl.push({ rev: collected, cost: actual, pct: ((collected - actual) / collected) * 100 })
  }
  const totalRev = incl.reduce((s, x) => s + x.rev, 0)
  const avgJobMargin = incl.length ? {
    weightedPct: totalRev > 0 ? Math.round(((totalRev - incl.reduce((s, x) => s + x.cost, 0)) / totalRev) * 100) : null,
    medianPct: Math.round(median(incl.map(x => x.pct))),
    n: incl.length,
  } : { weightedPct: null, medianPct: null, n: 0 }

  return {
    metrics: {
      revenueMonth, revenuePrev, revenueSpark,
      expensesMonth, expensesPrev, expensesSpark,
      netMonth: revenueMonth - expensesMonth,
      arTotal, aging, arOver30Count,
      cashFlow,
      forecast14: null,          // honest: no payment-date estimates yet
      overheadBurn,
      avgJobMargin,
    },
    cemeteryRollup,
    jobTypeRollup,
    activeRows,
    topSignals,
  }
}

// Next order number in CO-{YYYY}-{NNN} form (per-year sequence, max+1).
export async function generateCemeteryOrderNumber(year) {
  const y = year || new Date().getFullYear()
  const prefix = `CO-${y}-`
  const { data, error } = await supabase
    .from('cemetery_orders')
    .select('order_number')
    .like('order_number', `${prefix}%`)
    .order('order_number', { ascending: false })
    .limit(1)
  let next = 1
  if (!error && data && data.length && data[0].order_number) {
    const m = String(data[0].order_number).match(/-(\d+)$/)
    if (m) next = parseInt(m[1], 10) + 1
  }
  return `${prefix}${String(next).padStart(3, '0')}`
}

// Submit → spawn one mausoleum_door job per door. Idempotent per
// (cemetery_order_id, door_index); only missing door-jobs are created. Stamps
// the order in_production with submitted_at + a total_amount snapshot, and
// assigns the order_number if not already set.
export async function createJobsFromCemeteryOrder(cemeteryOrderId) {
  if (!cemeteryOrderId) return { ok: false, error: 'No cemeteryOrderId' }
  const { data: co, error } = await supabase.from('cemetery_orders').select('*').eq('id', cemeteryOrderId).single()
  if (error || !co) return { ok: false, error: error?.message || 'Cemetery order not found' }

  const doors = co.doors || []
  if (doors.length === 0) return { ok: false, error: 'Cemetery order has no doors' }

  const template = await fetchActiveTemplateByJobType('mausoleum_door')
  if (!template) return { ok: false, error: 'No active mausoleum_door template' }
  const milestones = template.template?.milestones || []

  const { data: existing, error: exErr } = await supabase
    .from('jobs')
    .select('id, door_index')
    .eq('cemetery_order_id', cemeteryOrderId)
  if (exErr) return { ok: false, error: exErr.message }
  const existingIdx = new Set((existing || []).map(j => j.door_index))

  const created = []
  for (let i = 0; i < doors.length; i++) {
    if (existingIdx.has(i)) continue
    const jobRow = {
      tenant_id: co.tenant_id,
      order_id: null,
      cemetery_order_id: co.id,
      template_id: template.id,
      job_type: 'mausoleum_door',
      door_index: i,
      overall_status: 'active',
      last_update_at: new Date().toISOString(),
    }
    const { data: job, error: jErr } = await supabase.from('jobs').insert(jobRow).select().single()
    if (jErr) return { ok: false, error: jErr.message }

    const msRows = milestones.map((m, idx) => ({
      tenant_id: co.tenant_id,
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
    if (msRows.length > 0) {
      const { error: msErr } = await supabase.from('job_milestones').insert(msRows)
      if (msErr) {
        await supabase.from('jobs').delete().eq('id', job.id)
        return { ok: false, error: `Failed to seed milestones: ${msErr.message}` }
      }
    }
    await supabase.from('job_events').insert({
      tenant_id: co.tenant_id,
      job_id: job.id,
      event_type: 'job_created',
      payload: {
        source: 'cemetery_order',
        cemetery_order_id: co.id,
        door_index: i,
        template_job_type: 'mausoleum_door',
        template_version: template.version,
        milestone_count: msRows.length,
      },
    })
    created.push(job)
  }

  // Snapshot total (override-aware via getDoorPrice, plus the tax / CC-fee
  // toggles) + flip status. order_number assigned on first submit.
  const pricing = getCemeteryPricingForOrder(co)
  const subtotal = doors.reduce((s, d) => s + getDoorPrice(d, pricing), 0)
  let totalAmount = subtotal
  if (co.tax_applied)    totalAmount += subtotal * 0.06625
  if (co.cc_fee_applied) totalAmount += subtotal * 0.03
  totalAmount = Math.round(totalAmount * 100) / 100
  const patch = {
    status: 'in_production',
    submitted_at: co.submitted_at || new Date().toISOString(),
    total_amount: totalAmount,
    updated_at: new Date().toISOString(),
  }
  if (!co.order_number) {
    patch.order_number = await generateCemeteryOrderNumber(new Date().getFullYear())
  }
  const { error: updErr } = await supabase.from('cemetery_orders').update(patch).eq('id', co.id)
  if (updErr) return { ok: false, error: `Jobs created but order update failed: ${updErr.message}` }

  return { ok: true, jobs: created, orderNumber: patch.order_number || co.order_number }
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
      order:orders(*),
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
  // Date-projection write-through. The user-set flag travels with the value:
  // clearing the projected date (null) resets user_set to false so live
  // projection takes over again. Setting a value flips user_set to true.
  if (patch.projected_completion_at !== undefined) {
    rowPatch.projected_completion_at = patch.projected_completion_at || null
  }
  if (patch.projected_completion_at_user_set !== undefined) {
    rowPatch.projected_completion_at_user_set = !!patch.projected_completion_at_user_set
  }
  if (patch.contract_due_at !== undefined) {
    rowPatch.contract_due_at = patch.contract_due_at || null
  }
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

// Generic audit-event writer (used by the proof "request changes" flow, etc.).
// Append-only; never mutates prior events. tenant_id resolved from the job.
export async function addJobEvent(jobId, { eventType, note = null, payload = {}, milestoneKey = null, createdBy = null } = {}) {
  if (!jobId || !eventType) return { ok: false, error: 'jobId + eventType required' }
  const { data: job, error: getErr } = await supabase.from('jobs').select('id, tenant_id').eq('id', jobId).single()
  if (getErr || !job) return { ok: false, error: getErr?.message || 'Job not found' }
  const { error } = await supabase.from('job_events').insert({
    tenant_id: job.tenant_id, job_id: jobId, event_type: eventType,
    milestone_key: milestoneKey, payload: payload || {}, note, created_by: createdBy || null,
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
// Declared here so the date-projection helpers below can reference URGENCY
// without a hoisting issue; the operational classification block that
// previously held this constant moves further down.
export const URGENCY = { NEUTRAL: 'neutral', AMBER: 'amber', RED: 'red' }

// =============================================================================
// DATE PROJECTION — honest timeline forecasting
// =============================================================================
// Every milestone now carries three conceptual dates:
//   • contract_due_at      — the customer-facing promise (set at job creation;
//                            never auto-moves)
//   • projected_completion_at — the system's honest projection; recalculated
//                            live as upstream stages slip or accelerate. The
//                            stored DB value is only authoritative when the
//                            operator manually overrides it (see the
//                            projected_completion_at_user_set flag).
//   • actual_completion_at — derived from status_date when status='done'.
//                            We don't add a new column; we read what's there.
//                            Compromise: status_date is also touched on the
//                            in_progress transition, but projection only
//                            consults it when status==='done'.
//
// The migration at supabase/migrations/20260526_date_projection_and_bulk_orders.sql
// adds the new columns. Pre-migration runtime sees `undefined` for the new
// fields and projectJobDates falls back to its defaults — never throws.
//
// Pacing values capture Paul's measurements of typical stage durations from
// the moment a milestone's requires[] are satisfied to its own completion.
// Tune as the shop's lived experience tells us the numbers are off.
export const PACING_DAYS = {
  intake_complete:       1,
  design_needed:         1,
  layout_created:       14,
  proof_created:        14,
  proof_sent:            7,
  proof_approved:        1,
  permit_submitted:     14,
  permit_approved:       1,
  stone_ordered:        30,
  stone_received:        0,
  stencil_created:       3,
  stencil_cut:           2,
  production_started:   14,
  production_completed:  3,
  foundation_poured:    30,
  ready_to_install:     14,
  installed:             1,
  job_closed:            7,
}

// Foundation must cure 30 days before install per Paul's shop rule. Used as
// the reverse-propagation gap: foundation_poured.projected = installed.projected - 30.
const FOUNDATION_LEAD_DAYS = 30
const _DAY_MS = 86400000

// ISO-date math — operates on YYYY-MM-DD strings, parses as local midnight
// to avoid the UTC drift that plain toISOString-based math introduces near
// midnight in NJ.
function _addDays(isoDateLike, days) {
  if (!isoDateLike) return null
  const base = new Date(`${String(isoDateLike).slice(0, 10)}T00:00:00`)
  base.setDate(base.getDate() + days)
  const y = base.getFullYear()
  const m = String(base.getMonth() + 1).padStart(2, '0')
  const d = String(base.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Project completion dates for every milestone in a job. Returns a Map from
// milestone_key to ISO YYYY-MM-DD. Pure function — no side effects, no DB.
//
// Anchor: job.order.signed_at (the contract sign date, the existing sale
// anchor used elsewhere in the codebase). Falls back to job.created_at when
// the order isn't joined, then to today as a last resort so the function
// never returns nulls for actionable jobs.
//
// Algorithm:
//   • Each non-foundation milestone projects forward from max(parents'
//     projected dates, anchor) + pacingFor(key). Parents are the milestone's
//     requires[] siblings — same dependency graph the readiness gate uses.
//   • `foundation_poured` reverse-propagates: installed.projected - 30 days.
//     This implements the shop rule that the foundation must cure 30 days
//     before install. The forward edge through foundation_poured is skipped
//     in pass 1 to avoid a circular dependency through installed.requires.
//   • If a milestone has status='done' with a status_date, projection treats
//     that as actual completion. Downstream milestones project from it.
//   • If projected_completion_at_user_set is true, the stored DB value is
//     fixed and downstream milestones project from it.
//   • For `stone_ordered` linked to a bulk_order with supplier_eta and
//     placed_at, the per-milestone pacing is overridden with the supplier's
//     quoted lead time (eta - placed) instead of the generic 30-day default.
//
// `opts.bulkOrders` is an optional array. When passed, the engine consults
// each milestone's bulk_order_id to find a linked supplier order.
export function projectJobDates(job, opts = {}) {
  const projections = new Map()
  if (!job) return projections

  const anchorRaw = job.order?.signed_at || job.created_at || new Date().toISOString()
  const anchorISO = String(anchorRaw).slice(0, 10)
  const milestones = job.milestones || []
  const byKey = new Map(milestones.map(m => [m.milestone_key, m]))
  const bulkById = new Map()
  for (const b of (opts.bulkOrders || [])) {
    if (b?.id) bulkById.set(b.id, b)
  }

  // Per-milestone pacing — same as PACING_DAYS unless the milestone is a
  // stone_ordered linked to a bulk_order with supplier-quoted dates, in
  // which case the supplier's actual lead time wins.
  function pacingFor(m) {
    if (m.milestone_key === 'stone_ordered' && m.bulk_order_id) {
      const bo = bulkById.get(m.bulk_order_id)
      if (bo && bo.placed_at && bo.supplier_eta) {
        const placed = new Date(`${String(bo.placed_at).slice(0, 10)}T00:00:00`).getTime()
        const eta    = new Date(`${String(bo.supplier_eta).slice(0, 10)}T00:00:00`).getTime()
        const days = Math.round((eta - placed) / _DAY_MS)
        if (Number.isFinite(days) && days >= 0) return days
      }
    }
    return PACING_DAYS[m.milestone_key] ?? 0
  }

  // Treat status='done' + status_date as actual completion. We deliberately
  // don't add a separate column for this — see header comment for the
  // compromise. Bulk-order-received cascade goes through the normal status
  // update path so it lands here too.
  function actualOf(m) {
    if (m.status === 'done' && m.status_date) return String(m.status_date).slice(0, 10)
    return null
  }

  function projectOne(key, visiting) {
    if (projections.has(key)) return projections.get(key)
    if (visiting.has(key)) return null
    const m = byKey.get(key)
    if (!m) return null

    const actual = actualOf(m)
    if (actual) {
      projections.set(key, actual)
      return actual
    }
    if (m.projected_completion_at_user_set && m.projected_completion_at) {
      const v = String(m.projected_completion_at).slice(0, 10)
      projections.set(key, v)
      return v
    }
    // Foundation handled in pass 2 (reverse-propagated from installed).
    if (key === 'foundation_poured') return null

    visiting.add(key)
    let parentMax = anchorISO
    for (const req of (m.requires || [])) {
      // Skip the foundation edge — install pulls foundation back, never the
      // other way. Other milestones' requires propagate normally.
      if (req === 'foundation_poured') continue
      const v = projectOne(req, visiting)
      if (v && v > parentMax) parentMax = v
    }
    visiting.delete(key)

    const result = _addDays(parentMax, pacingFor(m))
    projections.set(key, result)
    return result
  }

  // Pass 1 — forward-project every milestone except foundation_poured.
  for (const m of milestones) {
    if (m.milestone_key === 'foundation_poured') continue
    projectOne(m.milestone_key, new Set())
  }

  // Pass 2 — foundation_poured reverse-propagates from installed. When
  // installed is absent (e.g. cleaning_repair jobs with no install stage),
  // foundation falls back to a normal forward projection from its own
  // requires so the function still returns a useful date.
  const fnd = byKey.get('foundation_poured')
  if (fnd) {
    const actual = actualOf(fnd)
    if (actual) {
      projections.set('foundation_poured', actual)
    } else if (fnd.projected_completion_at_user_set && fnd.projected_completion_at) {
      projections.set('foundation_poured', String(fnd.projected_completion_at).slice(0, 10))
    } else {
      const installedProj = projections.get('installed')
      if (installedProj) {
        projections.set('foundation_poured', _addDays(installedProj, -FOUNDATION_LEAD_DAYS))
      } else {
        let parentMax = anchorISO
        for (const req of (fnd.requires || [])) {
          const v = projections.get(req)
          if (v && v > parentMax) parentMax = v
        }
        projections.set('foundation_poured', _addDays(parentMax, pacingFor(fnd)))
      }
    }
  }

  return projections
}

// Divergence comparison between the customer-facing promise and the system's
// projection. Returned shape is consumed by row components to decide whether
// to show a single date or both. "Within 1 day" counts as agreement per the
// spec; 2–7 days late = amber, 8+ days late = red. Early projection (negative
// divergence) stays neutral — that's good news, never an alarm.
//
// `projectionMap` is the Map returned by projectJobDates. Optional — when
// omitted, the milestone's stored projected_completion_at is used.
export function compareMilestoneDates(milestone, projectionMap) {
  const out = {
    promised:       null,
    projected:      null,
    actual:         null,
    divergenceDays: 0,
    urgency:        URGENCY.NEUTRAL,
    userSet:        false,
  }
  if (!milestone) return out

  out.actual = (milestone.status === 'done' && milestone.status_date)
    ? String(milestone.status_date).slice(0, 10)
    : null
  out.promised = milestone.contract_due_at
    ? String(milestone.contract_due_at).slice(0, 10)
    : null
  out.projected = projectionMap && projectionMap.get
    ? (projectionMap.get(milestone.milestone_key) || null)
    : (milestone.projected_completion_at
        ? String(milestone.projected_completion_at).slice(0, 10)
        : null)
  out.userSet = !!milestone.projected_completion_at_user_set

  if (out.promised && out.projected) {
    out.divergenceDays = Math.round(
      (new Date(`${out.projected}T00:00:00`).getTime() -
       new Date(`${out.promised}T00:00:00`).getTime()) / _DAY_MS
    )
  }
  if (out.divergenceDays >= 8) out.urgency = URGENCY.RED
  else if (out.divergenceDays >= 2) out.urgency = URGENCY.AMBER

  return out
}

// Format a divergence object for display. Three modes:
//   • { single: 'Done Jun 5', tone: 'done' }     — completed work
//   • { single: 'Jun 5',      tone: 'calm' }     — within 1d (or only one date set)
//   • { promised: 'Jun 5', projected: 'Jun 8',
//       tone: 'amber' | 'red' }                  — diverged
// The row component decides how to render based on the shape.
export function formatMilestoneDateDisplay(dates) {
  if (!dates) return { single: '—', tone: 'calm' }
  if (dates.actual) {
    return { single: `Done ${fmtDate(dates.actual)}`, tone: 'done' }
  }
  if (dates.promised && dates.projected && Math.abs(dates.divergenceDays) >= 2) {
    const tone = dates.urgency === URGENCY.RED ? 'red'
               : dates.urgency === URGENCY.AMBER ? 'amber'
               : 'calm'
    return {
      promised:  fmtDate(dates.promised),
      projected: fmtDate(dates.projected),
      tone,
    }
  }
  const single = dates.projected || dates.promised
  return { single: single ? fmtDate(single) : '—', tone: 'calm' }
}

// =============================================================================
// END date projection
// =============================================================================

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

export function getAdminBuckets(jobs, bulkOrders) {
  const intake     = _bucketIntakeToComplete(jobs)
  const permitsTo  = _bucketPermitsToFile(jobs)
  const waitingCem = _bucketWaitingCemetery(jobs)
  const stonesTo   = _bucketStonesToOrder(jobs)
  const waitingSup = _bucketWaitingSupplier(jobs)
  const photosReq  = _bucketPhotosToRequest(jobs)
  const closeouts  = _bucketCloseouts(jobs)
  const linkedCounts = bulkOrderLinkedCounts(jobs)
  const openBulk = getOpenBulkOrdersBucket(bulkOrders || [], linkedCounts)
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
    // Open bulk orders — surfaces active POs across all suppliers. The
    // bucket's `kind: 'bulk_order_list'` signals JobsQueueSection to render
    // BulkOrderRow components instead of the default milestone-row panel.
    openBulk,
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

// `opts.bulkOrders` is consumed only by Admin (for the Open bulk orders
// bucket). Other departments ignore it. Defaults to an empty array when
// callers don't have bulk_orders loaded yet — the Admin bucket renders an
// empty count rather than throwing.
export function bucketsForDepartment(department, jobs, opts = {}) {
  if (department === 'admin')        return getAdminBuckets(jobs, opts.bulkOrders || [])
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

// ─── Owner attention lists ──────────────────────────────────────────────────
// Two flat lists fed by the Amber/Red headline cards on Owner Overview.
// Walk every bucket from every real department, collect rows that earned
// urgency, dedupe by milestone.id (a single milestone can surface in more
// than one bucket — e.g. an in-progress permit lives in both
// _bucketPermitsToFile-shape lookups and waiting_cemetery in some
// configurations; we want it once), attach a `department` field naming
// who owns the work, then sort worst-first so the operator's eye lands
// on the most overdue first.

function _collectAllRowsForUrgency(jobs, bulkOrders, urgency) {
  const all = [
    ...(getAdminBuckets(jobs, bulkOrders) || []),
    ...(getDesignBuckets(jobs) || []),
    ...(getProductionBuckets(jobs) || []),
    ...(getInstallationBuckets(jobs) || []),
  ]
  const seen = new Set()
  const collected = []
  for (const bucket of all) {
    // Skip the Open bulk orders bucket — its rows aren't milestone rows
    // (they're bulk_order rows) and don't belong in an attention list of
    // "tasks." Same for any future non-milestone bucket kinds.
    if (bucket?.kind === 'bulk_order_list') continue
    for (const row of (bucket.rows || [])) {
      if (row.urgency !== urgency) continue
      const id = row.milestone?.id
      if (!id || seen.has(id)) continue
      seen.add(id)
      collected.push({
        ...row,
        department: roleForMilestone(row.milestone),
      })
    }
  }
  collected.sort((a, b) => {
    if (a.overdueDays !== b.overdueDays) return (b.overdueDays || 0) - (a.overdueDays || 0)
    const aAge = a.agingDays ?? 0
    const bAge = b.agingDays ?? 0
    if (aAge !== bAge) return bAge - aAge
    const aN = a.order?.primary_lastname || ''
    const bN = b.order?.primary_lastname || ''
    return aN.localeCompare(bN)
  })
  return collected
}

// Forward declaration — roleForMilestone is defined further down in the
// file (under the Today section). JavaScript module hoisting makes the
// function callable from here at runtime; placing the call inside
// _collectAllRowsForUrgency rather than at module evaluation time is what
// keeps this safe.
export function getAllAmberTasks(jobs, bulkOrders) {
  return _collectAllRowsForUrgency(jobs, bulkOrders, URGENCY.AMBER)
}
export function getAllOverdueTasks(jobs, bulkOrders) {
  return _collectAllRowsForUrgency(jobs, bulkOrders, URGENCY.RED)
}

// ─── Sales summary ──────────────────────────────────────────────────────────
// One-shot derivation for the Sales role's hybrid summary view. Returns:
//   {
//     potentialRevenue: total dollar value across open estimates,
//     estimateCount:    how many estimates contribute to that total,
//     avgEstimateValue: potentialRevenue / estimateCount (0 when no estimates),
//     followups:        array (top 5) of orders needing follow-up,
//     followupsCount:   full count (not the 5 displayed),
//     recentlyWon:      array (top 5) of orders signed in the last 7 days,
//     recentlyWonCount: full count signed in the window,
//   }
// "Recently won" reads `order.signed_at` — the same timestamp used by job
// creation as the "moment the customer signed the contract." This is the
// honest source for "won today / yesterday / this week" without inventing
// a separate status-transition log.
export function getSalesSummary(orders, { now = new Date(), recentlyWonDays = 7, followupLimit = 5, recentlyWonLimit = 5 } = {}) {
  const list = orders || []

  // Potential revenue across open estimates. ESTIMATE_STATUSES is the
  // pre-contract set used by getEstimatesNeedingFollowup so the two views
  // count the same universe of orders.
  const estimates = list.filter(o => o && ESTIMATE_STATUSES.includes(o.status))
  const potentialRevenue = estimates.reduce((sum, o) => sum + rowGrandTotal(o), 0)
  const estimateCount = estimates.length
  const avgEstimateValue = estimateCount > 0 ? potentialRevenue / estimateCount : 0

  // Follow-ups due — reuses the existing helper, then slices for display.
  const followupBucket = getEstimatesNeedingFollowup(list)
  const followupsAll = followupBucket?.rows || []
  const followups = followupsAll.slice(0, followupLimit)

  // Recently won — orders with signed_at in the lookback window. signed_at
  // is the contract execution timestamp on orders; it's the cleanest
  // available "win moment" without a status-transition log.
  const cutoffMs = now.getTime() - (recentlyWonDays * _DAY_MS)
  const wonRows = []
  for (const o of list) {
    if (!o?.signed_at) continue
    const signedMs = new Date(o.signed_at).getTime()
    if (!Number.isFinite(signedMs) || signedMs < cutoffMs || signedMs > now.getTime()) continue
    const daysAgo = Math.max(0, Math.floor((now.getTime() - signedMs) / _DAY_MS))
    wonRows.push({
      order: o,
      customer: o.customer || null,
      value: rowGrandTotal(o),
      signedAt: o.signed_at,
      daysAgo,
    })
  }
  wonRows.sort((a, b) => {
    const aMs = new Date(a.signedAt).getTime()
    const bMs = new Date(b.signedAt).getTime()
    return bMs - aMs
  })

  return {
    potentialRevenue,
    estimateCount,
    avgEstimateValue,
    followups,
    followupsCount: followupsAll.length,
    recentlyWon:      wonRows.slice(0, recentlyWonLimit),
    recentlyWonCount: wonRows.length,
  }
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
//
// JOBS-OPERATIONAL-HUBS Phase 1A entries (added 2026-05-28):
//   • `field` — real gap. mausoleum_door template uses group='field' for the
//     four door pickup/install milestones. Today they route correctly only
//     because every one carries team='installation' (which wins over the
//     group fallback). Added here so a future field-grouped milestone that
//     ships without an explicit team still routes home.
//   • rub_grab / acid_wash / repair / door_trip — defensive entries. These
//     are Scheduler `work_batches.kind` values today, NOT milestone groups
//     anywhere in the template library. Phase 0 named them as orphan groups;
//     audit shows they're not in milestone use yet. Added so a future
//     workflow milestone using one of those names as `group` routes the way
//     the Scheduler already organises that work.
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
  field:      'installation',
  rub_grab:   'installation',
  acid_wash:  'production',
  repair:     'production',
  door_trip:  'installation',
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

// =============================================================================
// JOBS-OPERATIONAL-HUBS Phase 1A — hub work-item filtering
// =============================================================================
// A "hub" is one of 4 operational departments (Admin / Design / Production /
// Installation) that the Jobs tab organizes its work into. Owner aggregator
// and Sales are Phase 1B.
//
// A job appears in a hub when EITHER:
//   1. It has an actionable milestone whose group is owned by that hub
//      (resolved via roleForMilestone — team field wins, ROLE_GROUP_MAP
//      fallback when team is missing), OR
//   2. Its computeOrderPressure blocker matches one of the hub's owned
//      blocker kinds.
//
// A single job can appear in MULTIPLE hubs simultaneously — milestones run
// in parallel (proof in design + foundation in production). That's correct
// operationally; the same family has two threads of attention.
//
// HUB_DEFS is exported because the UI consumes its filterChips, label, and
// emptyMessage. getActionItems integration (stalled_job, next_actionable_idle,
// cemetery_deadline) is Phase 1B follow-up — Phase 1A leans on
// computeOrderPressure + milestone-group ownership which already covers
// ~70% of the spec'd hub→signal map without a second pass over the job list.
//
// Known Phase 1A → Phase 1B gaps (flagged by Workflow Intelligence review):
//   • Admin misses `cemetery_deadline` — hard cemetery permit deadlines from
//     `orders.cemetery_deadline`. Single-field read; should fast-track in 1B.
//   • Production misses `stalled_job` — jobs silent ≥14d with no actionable
//     milestone won't surface (no blocker triggers because the gate requires
//     a specific milestone-state combo). Real "where did this go?" gap.
//   • Admin misses `waiting_aged` — 7d+ waiting follow-up nag.
// Each of these is a flat-array read in getActionItems and can be threaded
// through HUB_DEFS.actionItemKinds + an extension to getHubWorkItems without
// touching computeOrderPressure.

const _hubGroupActive = (item, group) => item.actionableGroups?.has(group) === true
const _hubBlockerIs = (item, kind) => item.pressure?.blocker?.kind === kind
const _hubBlockerInSet = (item, set) => {
  const k = item.pressure?.blocker?.kind
  return !!k && set.has(k)
}

export const HUB_DEFS = {
  admin: {
    code: 'admin',
    label: 'Admin',
    description: 'Intake, permits, payments, customer follow-ups, cemetery holds',
    // Milestone groups Admin owns — actionable milestones in any of these
    // pull the job into the Admin hub.
    //   • closeout — admin verifies the field crew handed off cleanly
    //     (customer_notified / paid_in_full / closed). The mausoleum_door
    //     template's `completion_photo_uploaded` also lives in the closeout
    //     group, which technically required the field crew to take + upload
    //     the photo — but admin owns confirming the upload landed and the
    //     paperwork side closed. Monument Ops review (2026-05-28) flagged
    //     this as a potential mis-routing; the decision is to keep admin
    //     ownership because the close-out check is paperwork verification,
    //     not field work. Phase 2 may split the group if the distinction
    //     starts to bite operationally.
    milestoneGroups: new Set(['intake', 'permit', 'closeout']),
    // Blocker kinds Admin chases. Cemetery + payment are admin's classic
    // "did you call them yet?" follow-up queues. waiting_on_family also
    // surfaces here because the office calls the family back, not the shop
    // (operational lock from earlier sprints).
    blockerKinds: new Set(['cemetery_hold', 'overdue_balance', 'waiting_on_family', 'closeout_pending']),
    filterChips: [
      { code: 'intake',        label: 'Intake gap',       match: (it) => _hubGroupActive(it, 'intake') },
      { code: 'permit',        label: 'Permit work',      match: (it) => _hubGroupActive(it, 'permit') },
      { code: 'cemetery_hold', label: 'Cemetery hold',    match: (it) => _hubBlockerIs(it, 'cemetery_hold') },
      { code: 'payment',       label: 'Payment overdue',  match: (it) => _hubBlockerIs(it, 'overdue_balance') },
      { code: 'family',        label: 'Family follow-up', match: (it) => _hubBlockerIs(it, 'waiting_on_family') || it.pressure?.needsCall === true },
      { code: 'closeout',      label: 'Closeout',         match: (it) => _hubGroupActive(it, 'closeout') || _hubBlockerIs(it, 'closeout_pending') },
    ],
    emptyMessage: 'Admin hub clear — nothing waiting on you right now.',
  },
  design: {
    code: 'design',
    label: 'Design',
    description: 'Layouts, proofs, inscriptions, bronze designs, photo & etching workflow',
    milestoneGroups: new Set(['design', 'photo', 'etching']),
    // Design owns the proof cycle. proof_waiting_customer here means the
    // design team owes the next move — drafting / re-drafting / sending.
    // Note: the office (admin) makes the actual phone call to the family
    // for approval, but the WORK ITEM lives in design's queue because the
    // design team needs the answer to keep moving — and the layout file
    // is in design's possession. If a future operational tweak moves the
    // chase-call into admin's chip set, swap this kind into Admin's
    // blockerKinds. Phase 1A keeps it here because that's where the work
    // physically stalls.
    blockerKinds: new Set(['proof_waiting_customer']),
    filterChips: [
      { code: 'layout',         label: 'Layout',          match: (it) => _hubGroupActive(it, 'design') },
      { code: 'photo',          label: 'Photo',           match: (it) => _hubGroupActive(it, 'photo') },
      { code: 'etching',        label: 'Etching',         match: (it) => _hubGroupActive(it, 'etching') },
      { code: 'awaiting_proof', label: 'Awaiting customer', match: (it) => _hubBlockerIs(it, 'proof_waiting_customer') },
    ],
    emptyMessage: 'Design hub clear — no layouts, proofs, or inscriptions waiting.',
  },
  production: {
    code: 'production',
    label: 'Production',
    description: 'Stencil, cutting, sandblasting, washing, foundation pours, repairs',
    // 'foundation' lives in production because the pour is shop-staged
    // concrete work; the FIELD pour is a separate trip routed through
    // installation. 'stone' covers cut/blast/wash stages of the stone.
    milestoneGroups: new Set(['stone', 'production', 'foundation']),
    blockerKinds: new Set(['production_blocked']),
    filterChips: [
      { code: 'stone',      label: 'Stone',      match: (it) => _hubGroupActive(it, 'stone') },
      { code: 'production', label: 'Production', match: (it) => _hubGroupActive(it, 'production') },
      { code: 'foundation', label: 'Foundation', match: (it) => _hubGroupActive(it, 'foundation') },
      { code: 'stuck',      label: 'Stuck',      match: (it) => _hubBlockerIs(it, 'production_blocked') },
    ],
    emptyMessage: 'Production hub clear — nothing in flight or stuck.',
  },
  installation: {
    code: 'installation',
    label: 'Installation',
    description: 'Foundations to set, stones ready to set, cemetery trips, doors, pickups',
    // 'install' is the canonical install milestone group; 'field' is the
    // mausoleum_door template's group for door pickup/dropoff/install trips
    // (door milestones already carry team='installation' on the row, but
    // the group fallback covers any future field-grouped milestone that
    // ships without an explicit team).
    milestoneGroups: new Set(['install', 'field']),
    blockerKinds: new Set([
      'install_late',
      'needs_install_date',
      'install_scheduled',
      'stone_ready_schedule_trip',
    ]),
    filterChips: [
      { code: 'install',   label: 'Install',      match: (it) => _hubGroupActive(it, 'install') || _hubGroupActive(it, 'field') },
      { code: 'ready',     label: 'Ready to set', match: (it) => _hubBlockerInSet(it, new Set(['stone_ready_schedule_trip', 'needs_install_date'])) },
      { code: 'scheduled', label: 'Scheduled',    match: (it) => _hubBlockerIs(it, 'install_scheduled') },
      { code: 'late',      label: 'Install late', match: (it) => _hubBlockerIs(it, 'install_late') },
    ],
    emptyMessage: 'Installation hub clear — no stones ready, scheduled, or late.',
  },
}

// Severity ranking — red urgency floats to top, then amber, then blue, then
// in-flight (no blocker). Mirrors the SEVERITY_RANK used by JobsListView so
// the two surfaces feel the same.
function _hubSevRank(sev) {
  if (sev === 'red')   return 0
  if (sev === 'amber') return 1
  if (sev === 'blue')  return 2
  return 3
}

// Main hub work-item derivation. Pure function — no side effects, no async.
// Callers pass already-loaded jobs (with order/customer/cemetery joined and
// milestones embedded; same shape getJobs returns). Orders param is reserved
// for Phase 1B Sales Hub which will pull from orders directly (no job yet).
//
// Returns:
//   {
//     items: [{ job, order, pressure, actionableGroups, hubActionableGroups,
//               reasons, urgent, severity }],
//     counts: { urgent, total },
//     actionableSignals: [string]   // distinct signal kinds that pulled jobs in
//   }
//
// Items are sorted urgent-first (red → amber → blue → in-flight), with
// recency + family-name as tiebreakers.
export function getHubWorkItems(hubCode, jobs, orders = null, opts = {}) { // eslint-disable-line no-unused-vars
  const def = HUB_DEFS[hubCode]
  if (!def) {
    return { items: [], counts: { urgent: 0, total: 0 }, actionableSignals: [] }
  }

  const items = []
  const signals = new Set()

  for (const job of (jobs || [])) {
    if (!job) continue
    const order = job.order || null
    const milestones = job.milestones || []
    const pressure = order ? computeOrderPressure(order, job, milestones) : null

    // Collect every actionable milestone group on the job (any hub). One job
    // can have parallel actionable threads — e.g. proof_approved is actionable
    // in design while foundation_poured is actionable in production. The
    // Set is the item's own portable "what's open" snapshot; filter chips
    // and multi-hub membership both read from it.
    const actionableGroups = new Set()
    for (const m of milestones) {
      if (!m) continue
      if (m.status === 'done' || m.status === 'not_needed') continue
      if (m.group) actionableGroups.add(m.group)
    }

    // Hub membership reasons. A job qualifies for this hub via milestone
    // group ownership OR via blocker ownership (or both). Tracking reasons
    // lets the UI explain "why is this here?" if we ever surface that.
    const reasons = []
    const hubActionableGroups = []
    for (const g of actionableGroups) {
      if (def.milestoneGroups.has(g)) {
        hubActionableGroups.push(g)
        signals.add(`milestone_group:${g}`)
      }
    }
    if (hubActionableGroups.length > 0) {
      reasons.push({ kind: 'milestone_group', groups: hubActionableGroups })
    }
    if (pressure?.blocker && def.blockerKinds.has(pressure.blocker.kind)) {
      reasons.push({ kind: 'blocker', blocker: pressure.blocker })
      signals.add(`blocker:${pressure.blocker.kind}`)
    }
    if (reasons.length === 0) continue

    const sev = pressure?.blocker?.severity || null
    const urgent = sev === 'red' || sev === 'amber'

    items.push({
      job,
      order,
      pressure,
      actionableGroups,
      hubActionableGroups,
      reasons,
      urgent,
      severity: sev,
    })
  }

  items.sort((a, b) => {
    const sevDiff = _hubSevRank(a.severity) - _hubSevRank(b.severity)
    if (sevDiff !== 0) return sevDiff
    const aTs = a.job.last_update_at ? new Date(a.job.last_update_at).getTime() : 0
    const bTs = b.job.last_update_at ? new Date(b.job.last_update_at).getTime() : 0
    if (aTs !== bTs) return bTs - aTs
    const aN = a.order?.primary_lastname || ''
    const bN = b.order?.primary_lastname || ''
    return aN.localeCompare(bN)
  })

  const urgent = items.filter(i => i.urgent).length
  return {
    items,
    counts: { urgent, total: items.length },
    actionableSignals: Array.from(signals).sort(),
  }
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
// BULK SUPPLIER ORDERS — grouped POs across multiple milestones
// =============================================================================
// A bulk_order is one PO to a supplier covering one or more job milestones.
// Created from the multi-select action bar on Admin's "Stones to order" and
// "Photos to request" queues. When received, the order cascades — every
// linked milestone moves to done with status_date = today (which the
// projection engine reads as actual_completion_at).
//
// Pre-migration: the `bulk_orders` table doesn't exist. The list/create
// calls below catch the Supabase error and degrade — listOpenBulkOrders
// returns [] so the Admin bucket renders an empty data-gap card instead of
// throwing. Post-migration: full lifecycle works.

// Valid kinds. Mirrors the CHECK constraint in the migration so client-side
// errors surface before the DB rejects.
export const BULK_ORDER_KINDS = [
  { code: 'stone',   label: 'Stone'   },
  { code: 'photo',   label: 'Photo'   },
  { code: 'etching', label: 'Etching' },
  { code: 'bronze',  label: 'Bronze'  },
]

// Today's local YMD — used by the cascade-on-receive path. Reuses
// todayLocalISO already defined above.
function _todayYMD() {
  return todayLocalISO()
}

// Fetch every active (un-received) bulk_order. Pre-migration the table
// doesn't exist; we catch the error and return []. Same defensive pattern
// every helper in this file uses for missing-schema cases.
export async function listOpenBulkOrders() {
  const { data, error } = await supabase
    .from('bulk_orders')
    .select('*')
    .is('received_at', null)
    .order('placed_at', { ascending: true })
  if (error) {
    console.warn('[bulkOrders] listOpenBulkOrders failed:', error.message)
    return []
  }
  return data || []
}

// Fetch every bulk_order (open + received). Used by the projection engine
// so milestones linked to RECEIVED orders also get the supplier's actual
// lead time when computing dates for downstream stages. Same graceful-
// degrade pattern as listOpenBulkOrders.
export async function listAllBulkOrders() {
  const { data, error } = await supabase
    .from('bulk_orders')
    .select('*')
    .order('placed_at', { ascending: false })
  if (error) {
    console.warn('[bulkOrders] listAllBulkOrders failed:', error.message)
    return []
  }
  return data || []
}

// Create a bulk_order + link each selected milestone via bulk_order_id, +
// transition each linked milestone to in_progress (the order is now placed,
// so the milestone is awaiting external — exactly what in_progress means in
// the operational classifier). Returns { ok, bulkOrder, error }.
//
// `milestoneIds` is an array of job_milestones.id (the UUID PK), not
// milestone_key. The UI tracks selected rows by id because the same
// milestone_key can appear on many jobs.
export async function createBulkOrder(input) {
  const payload = {
    kind:          input.kind,
    supplier_name: (input.supplier_name || '').trim(),
    po_number:     (input.po_number || '').trim() || null,
    po_file_url:   input.po_file_url || null,
    po_uploaded_at: input.po_file_url ? new Date().toISOString() : null,
    placed_at:     input.placed_at || _todayYMD(),
    supplier_eta:  input.supplier_eta || null,
    notes:         (input.notes || '').trim() || null,
  }
  if (!payload.kind)          return { ok: false, error: 'Kind is required' }
  if (!payload.supplier_name) return { ok: false, error: 'Supplier name is required' }

  const { data: bulkOrder, error: insertErr } = await supabase
    .from('bulk_orders')
    .insert(payload)
    .select()
    .single()
  if (insertErr) return { ok: false, error: insertErr.message }

  const milestoneIds = (input.milestoneIds || []).filter(Boolean)
  if (milestoneIds.length === 0) {
    return { ok: true, bulkOrder, linkedCount: 0 }
  }

  // Link each milestone + flip to in_progress + stamp status_date. We do
  // this in one update because every linked milestone gets the same patch.
  const today = _todayYMD()
  const { error: linkErr } = await supabase
    .from('job_milestones')
    .update({
      bulk_order_id: bulkOrder.id,
      status:        'in_progress',
      status_date:   today,
      updated_at:    new Date().toISOString(),
    })
    .in('id', milestoneIds)
  if (linkErr) {
    // The bulk_order was created but linking failed. Surface the partial
    // state so the caller can decide whether to retry or warn the operator.
    return { ok: false, error: `Bulk order created but linking failed: ${linkErr.message}`, bulkOrder }
  }

  return { ok: true, bulkOrder, linkedCount: milestoneIds.length }
}

// Cascade — mark the bulk_order received, then push every linked milestone
// to done with today's status_date (which the projection engine reads as
// actual_completion_at). Returns { ok, error, cascadedCount }.
export async function markBulkOrderReceived(bulkOrderId, { actorUserId } = {}) {
  if (!bulkOrderId) return { ok: false, error: 'Missing bulk order id' }
  const today = _todayYMD()
  const nowISO = new Date().toISOString()

  const { error: updErr } = await supabase
    .from('bulk_orders')
    .update({
      received_at: today,
      received_by: actorUserId || null,
      updated_at:  nowISO,
    })
    .eq('id', bulkOrderId)
  if (updErr) return { ok: false, error: updErr.message }

  // Find linked milestones and cascade their completion. We pull-then-update
  // (instead of a single SQL UPDATE) so we have explicit visibility into
  // which milestones were touched and so milestones that are already done
  // don't get their status_date stomped.
  const { data: linked, error: fetchErr } = await supabase
    .from('job_milestones')
    .select('id, status, status_date')
    .eq('bulk_order_id', bulkOrderId)
  if (fetchErr) return { ok: false, error: fetchErr.message }

  const toCascade = (linked || []).filter(m => m.status !== 'done')
  if (toCascade.length === 0) {
    return { ok: true, cascadedCount: 0 }
  }
  const ids = toCascade.map(m => m.id)
  const { error: cascadeErr } = await supabase
    .from('job_milestones')
    .update({
      status:      'done',
      status_date: today,
      updated_at:  nowISO,
    })
    .in('id', ids)
  if (cascadeErr) return { ok: false, error: cascadeErr.message }

  return { ok: true, cascadedCount: ids.length }
}

// Build a row shape for the "Open bulk orders" Admin bucket. The row carries
// the bulk_order + a count of linked jobs + an urgency state earned by
// supplier_eta past today (red) or aging from placed_at (amber when older
// than the supplier_waiting threshold).
function _buildBulkOrderRow(bulkOrder, linkedCount) {
  const today = _todayYMD()
  const placedAge = bulkOrder.placed_at
    ? Math.max(0, Math.floor((Date.now() - new Date(`${bulkOrder.placed_at}T00:00:00`).getTime()) / _DAY_MS))
    : null
  let urgency = URGENCY.NEUTRAL
  let overdueDays = 0
  if (bulkOrder.supplier_eta) {
    const etaTime = new Date(`${String(bulkOrder.supplier_eta).slice(0, 10)}T00:00:00`).getTime()
    const todayTime = new Date(`${today}T00:00:00`).getTime()
    if (etaTime < todayTime) {
      overdueDays = Math.floor((todayTime - etaTime) / _DAY_MS)
      urgency = URGENCY.RED
    }
  }
  if (urgency === URGENCY.NEUTRAL && placedAge != null && placedAge > BUCKET_AGING_THRESHOLDS.waiting_supplier) {
    urgency = URGENCY.AMBER
  }
  return {
    kind:        'bulk_order',
    bulkOrder,
    linkedCount,
    placedAge,
    overdueDays,
    urgency,
  }
}

// Derives the "Open bulk orders" bucket for the Admin role. `linkedCountsById`
// is a Map of bulk_order.id → count of milestones linked to it (passed in
// from the parent so we don't refetch milestones inside the derive).
export function getOpenBulkOrdersBucket(bulkOrders, linkedCountsById) {
  const rows = (bulkOrders || [])
    .filter(b => !b.received_at)
    .map(b => _buildBulkOrderRow(b, linkedCountsById?.get?.(b.id) || 0))
    .sort((a, b) => {
      // Worst-first: red urgency, then highest overdueDays, then oldest placed_at.
      const ua = a.urgency === URGENCY.RED ? 0 : a.urgency === URGENCY.AMBER ? 1 : 2
      const ub = b.urgency === URGENCY.RED ? 0 : b.urgency === URGENCY.AMBER ? 1 : 2
      if (ua !== ub) return ua - ub
      if (a.overdueDays !== b.overdueDays) return b.overdueDays - a.overdueDays
      const ap = a.bulkOrder.placed_at || ''
      const bp = b.bulkOrder.placed_at || ''
      return ap.localeCompare(bp)
    })
  const reds = rows.filter(r => r.urgency === URGENCY.RED).length
  const subline = rows.length === 0
    ? null
    : (reds > 0 ? `${reds} past supplier ETA` : `${rows.length} open`)
  return {
    code:     'open_bulk_orders',
    label:    'Open bulk orders',
    rows,
    count:    rows.length,
    urgency:  worstUrgency(rows),
    dataGap:  false,
    subline,
    sortLabel: 'Sorted by days past ETA',
    kind:      'bulk_order_list',  // signals the panel to render BulkOrderRow
    grouping:  null,
    groups:    null,
  }
}

// Compute the linked-milestone count for each bulk_order from the in-memory
// jobs list. Avoids a second DB round-trip — the jobs fetch already pulled
// every milestone including bulk_order_id (since getJobs selects *).
export function bulkOrderLinkedCounts(jobs) {
  const counts = new Map()
  for (const job of (jobs || [])) {
    for (const m of (job.milestones || [])) {
      if (!m.bulk_order_id) continue
      counts.set(m.bulk_order_id, (counts.get(m.bulk_order_id) || 0) + 1)
    }
  }
  return counts
}

// =============================================================================
// SCHEDULER SUBSTRATE — work batches, trip optimizer, promises, carryover
// =============================================================================
// The substrate behind the Scheduler and Calendar tabs. Models the operator's
// real workflow:
//   • Unscheduled actionable jobs sit in per-kind columns.
//   • The operator selects N jobs, opens the batch builder, picks a kind +
//     destination + date + worker, and saves. The batch lands on a day.
//   • The Calendar tab renders placed batches per day. Day view becomes the
//     crew chief's dispatch sheet, with mileage, stop ordering, and the
//     carryover banner for unfinished prior-day work.
//   • Trip optimizer surfaces piggyback opportunities when a destination is
//     set — same cemetery first, then nearby (haversine), then cross-stage.
//   • Promises are first-class. The 🤡 treatment renders loud everywhere
//     a promised job appears.
//
// All helpers read/write through the migrated tables:
//   work_batches, work_batch_jobs, job_promises, cemeteries(.geocoded_*)
//
// Pre-migration runtime: every helper catches the missing-table error and
// returns an empty list / { ok: false } so the UI doesn't crash.
// =============================================================================

// ── BATCH_KINDS ─────────────────────────────────────────────────────────────
// Nine kinds covering field trips (isField: true, requiresDestination: true)
// and shop blocks (isField: false). requiresCompletionPhoto exists in the
// schema-ready state today; enforcement ships in commit 2.
export const BATCH_KINDS = [
  { code: 'inscription',     label: 'Inscriptions',     color: '#534AB7', isField: true,  requiresDestination: true,  requiresCompletionPhoto: true  },
  { code: 'blasting',        label: 'Blasting',         color: '#5F5E5A', isField: false, requiresDestination: false, requiresCompletionPhoto: false },
  { code: 'setting',         label: 'Setting',          color: '#1D9E75', isField: true,  requiresDestination: true,  requiresCompletionPhoto: true  },
  { code: 'delivery',        label: 'Delivery',         color: '#1D9E75', isField: true,  requiresDestination: true,  requiresCompletionPhoto: true  },
  { code: 'acid_wash',       label: 'Acid wash',        color: '#5F5E5A', isField: false, requiresDestination: false, requiresCompletionPhoto: true  },
  { code: 'repair',          label: 'Repair',           color: '#D85A30', isField: false, requiresDestination: false, requiresCompletionPhoto: true  },
  { code: 'rub_grab',        label: 'Rub-grab trip',    color: '#5F5E5A', isField: true,  requiresDestination: true,  requiresCompletionPhoto: false },
  { code: 'foundation_trip', label: 'Foundation trip',  color: '#D85A30', isField: true,  requiresDestination: true,  requiresCompletionPhoto: false },
  // door_trip — "pickup" leg fetches the door; "return" leg drops it back at
  // the cemetery. Shevchenko does NOT install mausoleum doors; the template's
  // door_installed milestone key is a MISNOMER (Phase 4 will rename it). Any
  // future UI text tied to this kind must say "returned" / "dropped off",
  // never "installed."
  { code: 'door_trip',       label: 'Door pickup/return', color: '#5F5E5A', isField: true,  requiresDestination: true,  requiresCompletionPhoto: false },
  // Custom calendar events — zero-job batches that serve as ad-hoc entries.
  // site_visit: estimate visits, customer-home meetings, cemetery walks.
  // errand:     pick up parts, drop off paperwork, generic schedule item.
  // Both are field by default (operator can override notes/address inline).
  // requiresDestination=false so the AddEventModal isn't forced into a
  // cemetery picker when the destination is a customer's house or a parts
  // store; the modal exposes optional free-text address for those cases.
  { code: 'site_visit',      label: 'Site visit',       color: '#7F77DD', isField: true,  requiresDestination: false, requiresCompletionPhoto: false },
  { code: 'errand',          label: 'Errand',           color: '#5F5E5A', isField: true,  requiresDestination: false, requiresCompletionPhoto: false },
]

const _BATCH_KIND_BY_CODE = new Map(BATCH_KINDS.map(k => [k.code, k]))
export function batchKindInfo(code) {
  return _BATCH_KIND_BY_CODE.get(code) || { code, label: code, color: '#5F5E5A', isField: false, requiresDestination: false, requiresCompletionPhoto: false }
}

// Shop coordinates — the origin point for every field-trip mileage
// calculation. Set to Shevchenko Monuments' actual Perth Amboy address.
export const SHOP_COORDINATES = { lat: 40.525008314072224, lng: -74.28993820409238 }

// Routing table: source milestone_key → { kind, completion_milestone_key }.
// Drives getSchedulableJobs (which surfaces jobs into Scheduler columns) AND
// the Phase 2 markBatchJobComplete cascade (which uses completion key to flip
// the right milestone done). The inline routing in getSchedulableJobs must
// stay in lockstep with this map — if you add an entry here, mirror it there.
//
// Phase-3 updates (2026-05-28):
//   • (P) Dropped the dead job_type='inscription' predicate on stencil_cut — no
//     such job_type exists in prod data; the column was permanently empty.
//   • (G) Foundation route DEFERRED to Phase 4. The proper fix is a template
//     migration adding foundation_cured + gating downstream setting work on
//     it (Monument Ops review: concrete needs a 7-day cure window before a
//     stone can be set on it; the prior backwards foundation_poured route
//     would cause crews to set on green concrete if downstream logic ever
//     keys off foundation_poured). Until Phase 4, foundation work is NOT
//     schedulable through this surface — that's intentional, not a gap.
//   • Added door_trip routes for mausoleum_door jobs (8 jobs × 4 door
//     milestones were silently invisible to the scheduler).
//   • (A) getSchedulableJobs guards each push against the completion key
//     already being done (the source-key re-surface fix; see comment below
//     the inline router for the full pattern).
//   • Delivery route (P) commented out — unfireable today (no non-new_stone
//     template carries ready_to_install) and a latent foot-gun (would auto-
//     enroll in silent cascade failure when a future template adds it).
//     Reinstate explicitly when that template lands.
//
// IMPORTANT — door_installed is a MISNOMER. Shevchenko Monuments does NOT
// install mausoleum doors. The 'dropoff' leg is the crew returning the door
// to the cemetery; the milestone key is named door_installed only because
// the template ships that way today. Phase 4 template migration will rename
// to door_returned / door_dropped_off and any UI text in this codebase
// must read "returned" / "dropped off" — NEVER "installed."
//
// NULL completion = source-as-completion fallback (K). markBatchJobComplete
// cascades the SOURCE milestone to done when completion is null. This gives
// inscription (and any future null-completion routes) date truth without
// needing a Phase 4 template migration to add an inscription_completed key.
// Phase 4 should still add the proper completion milestone — this is a
// pragmatic bridge, not the final shape.
const _MILESTONE_TO_BATCH_ROUTE = new Map([
  // Inscription cycle — operator brings the stencil to the cemetery and
  // sandblasts. NULL completion → source-as-completion fallback (K): the
  // cascade flips stencil_cut to done on dispatch tick, stamping status_date.
  ['stencil_cut',          { kind: 'inscription',     completion_milestone_key: null }],
  // Sandblast — shop work. production_started → production_completed.
  ['production_started',   { kind: 'blasting',        completion_milestone_key: 'production_completed' }],
  // Setting (new_stone) — non-new_stone delivery is commented out (P).
  ['ready_to_install',     { kind: 'setting',         completion_milestone_key: 'installed' }],
  // Foundation — DEFERRED to Phase 4 (see header). No route entry today.
  // Mausoleum door trips — pickup leg surfaces from door_pickup_needed and
  // cascades door_picked_up. Dropoff leg surfaces from door_dropoff_needed
  // and cascades door_installed (MISNOMER — means returned to cemetery,
  // not installed; Shevchenko does no door installation). Template-chain
  // requires force the legs to surface sequentially: dropoff is gated on
  // production_completed → … → door_picked_up, so a job cannot show in
  // both legs at once.
  ['door_pickup_needed',   { kind: 'door_trip',       completion_milestone_key: 'door_picked_up' }],
  ['door_dropoff_needed',  { kind: 'door_trip',       completion_milestone_key: 'door_installed' }],
  // Acid wash / repair / rub_grab — templates don't carry the source
  // milestone for these kinds yet. Columns will surface empty until the
  // milestone_templates are extended (Phase 4 candidate).
])

// ── BATCH CRUD ──────────────────────────────────────────────────────────────

// Fetch batches with optional filters. Joined with cemetery for destination
// display + batch_jobs for the linked-job count. Returns rows with the link
// rows embedded as `batch_jobs: []`.
export async function getBatches({ from, to, kind, assigned_to, status } = {}) {
  let q = supabase
    .from('work_batches')
    .select(`
      *,
      cemetery:cemeteries(*),
      batch_jobs:work_batch_jobs(*)
    `)
    .order('scheduled_date', { ascending: true, nullsFirst: true })
  if (from) q = q.gte('scheduled_date', from)
  if (to)   q = q.lte('scheduled_date', to)
  if (kind) q = q.eq('kind', kind)
  if (assigned_to) q = q.eq('assigned_to', assigned_to)
  if (status) q = q.eq('status', status)
  const { data, error } = await q
  if (error) {
    console.warn('[scheduler] getBatches failed:', error.message)
    return []
  }
  return data || []
}

// Full single-batch detail. Joins linked jobs with their milestones + order
// + cemetery so the Calendar Day dispatch sheet has everything to render
// die specs, color, top, etc.
export async function getBatch(id) {
  if (!id) return null
  const { data, error } = await supabase
    .from('work_batches')
    .select(`
      *,
      cemetery:cemeteries(*),
      batch_jobs:work_batch_jobs(
        *,
        job:jobs(
          *,
          milestones:job_milestones(*),
          order:orders(*, customer:customers(*), cemetery:cemeteries(*))
        )
      )
    `)
    .eq('id', id)
    .single()
  if (error) {
    console.warn('[scheduler] getBatch failed:', error.message)
    return null
  }
  if (data?.batch_jobs) {
    data.batch_jobs.sort((a, b) => (a.stop_order ?? 999) - (b.stop_order ?? 999))
  }
  return data
}

// Create a batch + its linked stops in one go. stop_order is assigned in
// the order stops arrive. For non-trip batches (blasting / acid_wash /
// repair) stop_order is left NULL — there's no driving order.
//
// Phase 3 (2026-05-28): accepts either input.stops (the routing-aware shape
// from BatchBuilder) or the legacy input.job_ids (backward compat). When
// stops are provided, each row's source_milestone_key + completion_milestone_key
// are persisted onto the link row, giving Phase 2's markBatchJobComplete
// cascade a deterministic milestone target. Legacy job_ids → both columns
// NULL on the link rows (cascade skipped on completion — same shape as the
// 40 pre-Migration-L demo rows).
//
// Stops shape: [{ job_id, source_milestone_key, completion_milestone_key }].
// Both milestone keys are optional per stop; NULL is the explicit "no
// provenance recorded" signal.
export async function createBatch(input) {
  const kind = input.kind
  const kindInfo = batchKindInfo(kind)
  if (!kindInfo || !BATCH_KINDS.find(k => k.code === kind)) {
    return { ok: false, error: `Unknown batch kind: ${kind}` }
  }
  if (kindInfo.requiresDestination && !input.destination_cemetery_id) {
    return { ok: false, error: `${kindInfo.label} batches need a destination cemetery.` }
  }
  const payload = {
    kind,
    title:                   (input.title || '').trim() || null,
    scheduled_date:          input.scheduled_date || null,
    am_pm:                   input.am_pm || null,
    destination_cemetery_id: input.destination_cemetery_id || null,
    assigned_to:             (input.assigned_to || '').trim() || null,
    notes:                   (input.notes || '').trim() || null,
    status:                  input.status || 'planned',
  }
  const { data: batch, error: insErr } = await supabase
    .from('work_batches')
    .insert(payload)
    .select()
    .single()
  if (insErr) return { ok: false, error: insErr.message }

  // Normalize to the stops shape. Legacy job_ids → NULL provenance.
  const stops = Array.isArray(input.stops) && input.stops.length > 0
    ? input.stops.filter(s => s && s.job_id)
    : (input.job_ids || []).filter(Boolean).map(jid => ({
        job_id: jid,
        source_milestone_key: null,
        completion_milestone_key: null,
      }))
  if (stops.length === 0) return { ok: true, batch, linkedCount: 0 }

  const isTrip = kindInfo.isField
  const links = stops.map((s, idx) => ({
    batch_id:                 batch.id,
    job_id:                   s.job_id,
    stop_order:               isTrip ? (idx + 1) : null,
    // Length-checked by Migration L's work_batch_jobs_milestone_keys_len:
    // empty string would trip the CHECK, so normalize falsy → NULL.
    source_milestone_key:     s.source_milestone_key     || null,
    completion_milestone_key: s.completion_milestone_key || null,
  }))
  const { error: linkErr } = await supabase.from('work_batch_jobs').insert(links)
  if (linkErr) {
    return { ok: false, error: `Batch created but linking failed: ${linkErr.message}`, batch }
  }
  return { ok: true, batch, linkedCount: stops.length }
}

export async function updateBatch(id, patch) {
  if (!id) return { ok: false, error: 'Missing batch id' }
  const row = { updated_at: new Date().toISOString() }
  if (patch.title !== undefined)                   row.title = patch.title || null
  if (patch.scheduled_date !== undefined)          row.scheduled_date = patch.scheduled_date || null
  if (patch.am_pm !== undefined)                   row.am_pm = patch.am_pm || null
  if (patch.destination_cemetery_id !== undefined) row.destination_cemetery_id = patch.destination_cemetery_id || null
  if (patch.assigned_to !== undefined)             row.assigned_to = patch.assigned_to || null
  if (patch.notes !== undefined)                   row.notes = patch.notes || null
  if (patch.status !== undefined)                  row.status = patch.status
  const { error } = await supabase.from('work_batches').update(row).eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function deleteBatch(id) {
  if (!id) return { ok: false, error: 'Missing batch id' }
  const { error } = await supabase.from('work_batches').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function addJobToBatch(batchId, jobId, stop_order = null) {
  if (!batchId || !jobId) return { ok: false, error: 'Missing batchId or jobId' }
  const { error } = await supabase.from('work_batch_jobs').insert({
    batch_id: batchId,
    job_id:   jobId,
    stop_order,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function removeJobFromBatch(batchId, jobId) {
  if (!batchId || !jobId) return { ok: false, error: 'Missing batchId or jobId' }
  const { error } = await supabase
    .from('work_batch_jobs')
    .delete()
    .eq('batch_id', batchId)
    .eq('job_id', jobId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// Reorder stops in a field-trip batch. Accepts the new ordering as an array
// of job_ids; we update each link row's stop_order in a single batch UPDATE.
export async function reorderBatchStops(batchId, orderedJobIds) {
  if (!batchId || !Array.isArray(orderedJobIds)) {
    return { ok: false, error: 'Missing batchId or orderedJobIds array' }
  }
  // Postgres has no atomic multi-row-update-by-position via supabase-js;
  // we issue N updates sequentially. Small N (<= 20 typical) keeps this OK.
  for (let i = 0; i < orderedJobIds.length; i++) {
    const { error } = await supabase
      .from('work_batch_jobs')
      .update({ stop_order: i + 1 })
      .eq('batch_id', batchId)
      .eq('job_id', orderedJobIds[i])
    if (error) return { ok: false, error: error.message }
  }
  return { ok: true }
}

// Swap every batch from dateA onto dateB and vice versa (the rain-day flip).
// Two-step pass so we don't temporarily collapse both onto the same day in
// between updates (which the UI would briefly re-render in a weird state).
export async function swapBatchDays(dateA, dateB) {
  if (!dateA || !dateB) return { ok: false, error: 'Missing dateA or dateB' }
  if (dateA === dateB) return { ok: true, swapped: 0 }
  // Use a sentinel date well outside operational range to park one half.
  const SENTINEL = '1900-01-01'
  const { error: e1 } = await supabase
    .from('work_batches')
    .update({ scheduled_date: SENTINEL, updated_at: new Date().toISOString() })
    .eq('scheduled_date', dateA)
  if (e1) return { ok: false, error: e1.message }
  const { error: e2 } = await supabase
    .from('work_batches')
    .update({ scheduled_date: dateA, updated_at: new Date().toISOString() })
    .eq('scheduled_date', dateB)
  if (e2) return { ok: false, error: e2.message }
  const { error: e3 } = await supabase
    .from('work_batches')
    .update({ scheduled_date: dateB, updated_at: new Date().toISOString() })
    .eq('scheduled_date', SENTINEL)
  if (e3) return { ok: false, error: e3.message }
  return { ok: true }
}

export async function markBatchRunningLate(batchId) {
  return updateBatch(batchId, { status: 'running_late' })
}
export async function markBatchInProgress(batchId) {
  return updateBatch(batchId, { status: 'in_progress' })
}
export async function markBatchCompleted(batchId) {
  return updateBatch(batchId, { status: 'completed' })
}
export async function markBatchCancelled(batchId) {
  return updateBatch(batchId, { status: 'cancelled' })
}

// ── Unschedule (ITEM 3) ─────────────────────────────────────────────────────
// Pull a batch off the calendar back to the "Ready to schedule" tray. Clears
// scheduled_date + am_pm ONLY — does NOT mark complete and does NOT delete.
// The stops, status (planned/running_late), notes, and crew all survive so the
// dispatcher can drag it onto a new day untouched.
export async function unscheduleBatch(batchId) {
  return updateBatch(batchId, { scheduled_date: null, am_pm: null })
}

// Reverse a stop completion (ITEM 3). Clears completed_at + completed_by so the
// task goes active again. Intentionally does NOT revert the milestone cascade:
// the link-row completion is the operator's ground-truth toggle, while the
// milestone is a separate best-effort sync (see markBatchJobComplete). Reverting
// milestone status on unmark would risk clobbering a manually-advanced stage, so
// we leave the milestone where it is — the operator manages stage state from the
// Job surface.
export async function unmarkBatchJobComplete(batchJobId) {
  if (!batchJobId) return { ok: false, error: 'Missing batch_job id' }
  const { error } = await supabase
    .from('work_batch_jobs')
    .update({ completed_at: null, completed_by: null })
    .eq('id', batchJobId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// Pure: is a scheduled batch past-due and still unfinished (ITEM 3)? Drives the
// derived OVERDUE state in the Week tray — NO DB mutation on read (the project
// deliberately avoids mount-time sweeps against the live prod demo; see
// expirePastPromises). scheduled_date is preserved so the UI can show
// "Was scheduled for <date>". A batch is overdue when its scheduled day is
// strictly before today, it isn't cancelled/completed, and at least one stop is
// still open (zero-stop ad-hoc events count as overdue once their day passes).
// todayISO is the local YYYY-MM-DD (caller passes todayLocalISO()).
export function isBatchOverdue(batch, todayISO) {
  if (!batch || !batch.scheduled_date) return false
  if (batch.status === 'cancelled' || batch.status === 'completed') return false
  const day = String(batch.scheduled_date).slice(0, 10)
  if (day >= todayISO) return false
  const stops = batch.batch_jobs || batch.stops || []
  if (stops.length === 0) return true
  return !stops.every(s => s.completed_at)
}

// Mark a specific stop done (within a batch). Used by the Day view's per-
// stop checkboxes + the carryover banner's "mark complete" action.
//
// SCHEDULER-COMPLETE Phase 2 + 3 — milestone cascade.
//
//   When the link row carries a completion_milestone_key (set at batch
//   creation by the Phase 3 routing logic, post-Migration L), we cascade
//   the linked milestone to status='done' via updateMilestone, which
//   writes status_date=today (local) at line 2271. This closes the
//   structural date-truth gap the 2026-05-28 audit identified: previously
//   the dispatch checkbox stamped completed_at on the LINK row only and
//   the underlying milestone stayed at whatever status it had before the
//   trip, leaving job_milestones with 145 of 175 'done' rows undated.
//
//   (K) SOURCE-AS-COMPLETION FALLBACK. When completion_milestone_key is
//   NULL but source_milestone_key is non-null, we cascade the SOURCE
//   milestone instead. This is the inscription pattern (no proper
//   completion milestone in the templates today; Phase 4 should add
//   inscription_completed) — without this fallback the job would zombie
//   in the inscription column forever because stencil_cut stays
//   actionable. The cascade flips stencil_cut itself to done; the (A)
//   re-surface guard then takes over.
//
//   Cascade is BEST-EFFORT. It runs after the link-row write succeeds
//   and is wrapped in try/catch: a cascade failure (milestone not found,
//   readiness gate blocked because a `requires` isn't satisfied, RLS
//   denial) MUST NOT roll back the operator's completion. The link-row
//   completed_at is the ground truth of "the crew said this is done";
//   the milestone cascade is a best-effort sync.
//
//   (M) CASCADE-FAILURE VISIBILITY. When the readiness gate blocks a
//   cascade (the target milestone has unsatisfied `requires`), we
//   surface a warning string in the return value so the dispatch surface
//   can render an amber toast/banner. Silent skip would let the operator
//   tick "complete," see a green check, and never learn the milestone
//   stayed open — which is the exact silent-corruption pathway the
//   Workflow Intelligence agent flagged.
//
//   NULL on BOTH source and completion = legacy / ad-hoc shape (zero-job
//   site_visit/errand kinds, or the 40 pre-Migration-L rows surfaced
//   2026-05-28). Cascade is silently skipped — no warning, no toast.
//
//   actorUserId is optional. When supplied, the milestone's updated_by
//   carries the auth uuid; when omitted, updated_by ends up NULL.
//
// Return shape:
//   { ok: true }                                    — completed, no cascade needed
//   { ok: true, cascade: { target, status:'done' } } — completed + milestone advanced
//   { ok: true, warning: '...' }                    — completed but cascade blocked
//                                                      (operator should see a toast)
//   { ok: false, error: '...' }                     — link-row write failed
export async function markBatchJobComplete(batchJobId, { actorName, actorUserId } = {}) {
  if (!batchJobId) return { ok: false, error: 'Missing batch_job id' }
  const { data, error } = await supabase
    .from('work_batch_jobs')
    .update({
      completed_at: new Date().toISOString(),
      completed_by: actorName || null,
    })
    .eq('id', batchJobId)
    .select('job_id, source_milestone_key, completion_milestone_key')
    .single()
  if (error) return { ok: false, error: error.message }
  // Auto-resolve any promises for this job now that a stop completed. Safe to
  // run here — it only fires on an explicit operator action (dispatch
  // completion), never on a passive page load. Best-effort: a resolution
  // failure must not fail the completion itself.
  if (data?.job_id) {
    try {
      await resolvePromisesForJob(data.job_id)
    } catch (e) {
      console.warn('[promises] auto-resolve after completion failed:', e?.message)
    }
  }
  // Resolve the cascade target. Completion key wins when present; otherwise
  // (K) falls back to source-as-completion (inscription pattern). NULL on
  // both = silent skip (legacy / ad-hoc).
  const cascadeKey = data?.completion_milestone_key || data?.source_milestone_key || null
  if (data?.job_id && cascadeKey) {
    try {
      const r = await updateMilestone(
        data.job_id,
        cascadeKey,
        { status: 'done' },
        { actorUserId },
      )
      if (r.ok) {
        return { ok: true, cascade: { target: cascadeKey, status: 'done' } }
      }
      // (M) Surface readiness-gate blocks as an operator-facing warning.
      if (r.requiresOverride) {
        const blocking = (r.blockingKeys || []).join(', ') || 'an upstream milestone'
        const msg = `Stop marked complete, but the linked milestone (${cascadeKey}) needs a manual review — its prerequisite is not done yet (${blocking}).`
        console.warn(`[scheduler] milestone cascade blocked: ${cascadeKey} — requires not satisfied (${blocking})`)
        return { ok: true, warning: msg }
      }
      // Non-block failure (milestone not found, RLS denial, etc.) — keep
      // the completion success, but still surface so the operator knows
      // the date didn't stamp.
      const detail = r.error || 'unknown'
      console.warn(`[scheduler] milestone cascade skipped: ${cascadeKey} — ${detail}`)
      return { ok: true, warning: `Stop marked complete, but the linked milestone (${cascadeKey}) could not be updated: ${detail}.` }
    } catch (e) {
      console.warn('[scheduler] milestone cascade failed:', e?.message)
      return { ok: true, warning: `Stop marked complete, but the linked milestone (${cascadeKey}) could not be updated: ${e?.message || 'unknown error'}.` }
    }
  }
  return { ok: true }
}

// Reschedule a single stop to a new day. Implemented by moving the link
// row to a NEW batch on the target day (creating one when none exists for
// the same kind + destination + worker), with carry_over_from set to the
// original link row so the audit chain is intact.
export async function rescheduleBatchJobToDay(batchJobRow, targetDate) {
  if (!batchJobRow?.id || !targetDate) return { ok: false, error: 'Missing batch_job row or target date' }
  // 1. Look up the original batch to clone its kind/destination/worker.
  const { data: origBatch, error: bErr } = await supabase
    .from('work_batches')
    .select('*')
    .eq('id', batchJobRow.batch_id)
    .single()
  if (bErr) return { ok: false, error: bErr.message }
  // 2. Find or create a matching target-day batch.
  const { data: candidates } = await supabase
    .from('work_batches')
    .select('id')
    .eq('scheduled_date', targetDate)
    .eq('kind', origBatch.kind)
    .eq('destination_cemetery_id', origBatch.destination_cemetery_id || null)
    .eq('assigned_to', origBatch.assigned_to || null)
  let targetBatchId = candidates?.[0]?.id || null
  if (!targetBatchId) {
    const { data: newBatch, error: cErr } = await supabase
      .from('work_batches')
      .insert({
        kind:                    origBatch.kind,
        title:                   origBatch.title,
        scheduled_date:          targetDate,
        destination_cemetery_id: origBatch.destination_cemetery_id,
        assigned_to:             origBatch.assigned_to,
        notes:                   origBatch.notes,
      })
      .select()
      .single()
    if (cErr) return { ok: false, error: cErr.message }
    targetBatchId = newBatch.id
  }
  // 3. Insert a new link row on the target batch carrying carry_over_from
  //    back to the original stop. The original row stays put (historical
  //    truth: that stop was on the original day, just not completed).
  const { error: linkErr } = await supabase.from('work_batch_jobs').insert({
    batch_id:        targetBatchId,
    job_id:          batchJobRow.job_id,
    stop_order:      null,
    carry_over_from: batchJobRow.id,
  })
  if (linkErr) return { ok: false, error: linkErr.message }
  return { ok: true, targetBatchId }
}

// Send a stop back to the unscheduled pile. Implemented as a hard-delete
// of the link row (the job itself is untouched and re-surfaces in the
// Scheduler's UnscheduledColumn next render).
export async function unscheduleBatchJob(batchJobId) {
  if (!batchJobId) return { ok: false, error: 'Missing batch_job id' }
  const { error } = await supabase.from('work_batch_jobs').delete().eq('id', batchJobId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ── SCHEDULABLE JOBS DERIVER ────────────────────────────────────────────────
// Walks open jobs + active milestones and groups them by which batch kind
// they could go into. A single job may appear in multiple kind buckets
// across its lifetime; that's intentional — the operator sees the work
// where it lives at every stage. Already-batched jobs (jobs whose current
// actionable milestone is already linked to an open batch) are excluded.

// Returns { buckets, blocked }.
//   buckets — Map(BATCH_KINDS code → [{ job, milestone, completion_milestone_key }])
//             of jobs that are actionable AND ready for that kind of batch.
//   blocked — [{ job, milestone, completion_milestone_key, reasons:[] }] of jobs
//             that have reached ready_to_install but are NOT safe to schedule
//             (permit not approved / foundation not poured / stone not received).
//             Surfaced loudly instead of silently omitted so the scheduler can
//             tell "nothing to install" from "installs blocked, go fix them".
// READY-WORK ROUTING — the SINGLE place an actionable milestone is mapped to a
// scheduler column (batch kind) + the milestone the dispatch tick should flip.
// Keyed by milestone_key. This replaces the old inline per-key `if` ladder; it
// reads the same job_milestones + group taxonomy the Jobs hubs (HUB_DEFS /
// getHubWorkItems) read, so "ready to X" cannot drift between the two surfaces.
//   completion — the milestone markBatchJobComplete cascades to done. NULL =
//                source-as-completion (the source milestone itself flips).
//   guard      — a downstream completion key; if already done, suppress the
//                card so a job doesn't re-surface after its dispatch cascade.
//                NULL/source-as-completion routes self-skip (own milestone
//                flips done → filtered at the top of the loop).
// ready_to_install is handled inline below (it carries the install gate), not
// here. foundation_poured being ACTIONABLE means the pour trip hasn't happened
// yet → it routes to foundation_trip (the trip completes the pour); this is
// the foundation column finally lighting up. The old "foundation deferred"
// note was about gating SETTING on cure, which the install gate still enforces.
const READY_WORK_ROUTES = [
  { key: 'stencil_cut',         kind: 'inscription',     completion: null,                   guard: null },
  { key: 'production_started',  kind: 'blasting',        completion: 'production_completed',  guard: 'production_completed' },
  { key: 'door_pickup_needed',  kind: 'door_trip',       completion: 'door_picked_up',        guard: 'door_picked_up' },
  { key: 'door_dropoff_needed', kind: 'door_trip',       completion: 'door_installed',        guard: 'door_installed' },
  { key: 'foundation_poured',   kind: 'foundation_trip', completion: 'foundation_poured',     guard: null },
]
// cleaning_repair jobs carry no fixed source key, so they route by service_kind:
// any actionable shop/field milestone surfaces the job into its service column
// (source-as-completion). This is how the acid_wash + repair columns light up.
const CLEANING_REPAIR_GROUPS = new Set(['production', 'field', 'stone', 'cleaning', 'repair'])
function routeReadyWork(m, job) {
  const direct = READY_WORK_ROUTES.find(r => r.key === m.milestone_key)
  if (direct) return direct
  if (job.job_type === 'cleaning_repair' && CLEANING_REPAIR_GROUPS.has(m.group)) {
    if (job.service_kind === 'acid_wash') return { kind: 'acid_wash', completion: m.milestone_key, guard: null }
    if (job.service_kind === 'repair')    return { kind: 'repair',    completion: m.milestone_key, guard: null }
  }
  return null
}

export function getSchedulableJobs(jobs, batches) {
  const buckets = new Map(BATCH_KINDS.map(k => [k.code, []]))
  const blocked = []
  // Build a set of (job_id) that are already in an open (non-completed,
  // non-cancelled) batch. Those jobs disappear from the unscheduled pile
  // until the batch is closed or the link is removed.
  const linked = new Set()
  for (const b of (batches || [])) {
    if (b.status === 'completed' || b.status === 'cancelled') continue
    for (const link of (b.batch_jobs || [])) {
      if (!link.completed_at) linked.add(link.job_id)
    }
  }

  // Hub-fed candidate universe — the Production + Installation hubs ARE the
  // shop/field ready-work the Jobs hubs surface. Re-basing on them (instead of
  // a private job walk) means the Scheduler and the Jobs hubs read ONE source;
  // a job is "ready to schedule" only if the same classifier puts it in an
  // operational hub. getHubWorkItems is defined earlier in this module.
  const hubItems = [
    ...getHubWorkItems('production', jobs).items,
    ...getHubWorkItems('installation', jobs).items,
  ]
  const candidates = []
  const seenJob = new Set()
  for (const it of hubItems) {
    if (!it?.job || seenJob.has(it.job.id)) continue
    seenJob.add(it.job.id)
    candidates.push(it.job)
  }

  for (const job of candidates) {
    if (!job || job.overall_status === 'closed') continue
    if (linked.has(job.id)) continue
    const byKey = new Map((job.milestones || []).map(m => [m.milestone_key, m]))
    // Suppression guard (A): the dispatch cascade flips ONLY the completion
    // milestone; the source often stays actionable, so without this a job
    // re-appears in its column the day after the batch closes. completionDone
    // looks ahead to the completion key — done there → suppress.
    const completionDone = (key) => {
      if (!key) return false
      const c = byKey.get(key)
      return !!c && (c.status === 'done' || c.status === 'not_needed')
    }
    // One card per (job, kind) — a cleaning_repair job with several actionable
    // shop milestones shouldn't stack duplicate cards in one column.
    const seenKinds = new Set()
    const pushCard = (kind, m, completion) => {
      if (seenKinds.has(kind)) return
      const arr = buckets.get(kind)
      if (!arr) return
      seenKinds.add(kind)
      arr.push({ job, milestone: m, completion_milestone_key: completion })
    }

    for (const m of (job.milestones || [])) {
      if (m.status === 'done' || m.status === 'not_needed') continue
      if (m.status === 'not_started' && hasUnsatisfiedRequires(m, byKey)) continue

      // Ready-to-install carries the install-readiness gate, so it's handled
      // inline rather than in READY_WORK_ROUTES.
      if (m.milestone_key === 'ready_to_install') {
        if (completionDone('installed')) continue
        if (job.job_type === 'new_stone') {
          // Unified set-gate — ONE source shared with the Orders blocked chip
          // and the Jobs hubs: Paid in full ∧ Blasted ∧ (FDN In or N/A) ∧
          // permit-ok-where-required. setBlockReason returns the failing reason.
          const reason = setBlockReason(job.order, job)
          if (!reason) {
            pushCard('setting', m, 'installed')
          } else {
            blocked.push({ job, milestone: m, completion_milestone_key: 'installed', reasons: [reason] })
          }
        } else {
          // Non-new_stone ready_to_install → delivery. The stone/foundation
          // gate is new_stone-specific (physical setting), so delivery routes
          // ungated; completion stays 'installed'.
          pushCard('delivery', m, 'installed')
        }
        continue
      }

      const route = routeReadyWork(m, job)
      if (route) {
        if (route.guard && completionDone(route.guard)) continue
        pushCard(route.kind, m, route.completion)
      }
    }
  }
  // Sort each bucket by aging desc so the most-overdue card surfaces first.
  for (const arr of buckets.values()) {
    arr.sort((a, b) => {
      const aOver = isMilestoneOverdue(a.milestone) ? 0 : 1
      const bOver = isMilestoneOverdue(b.milestone) ? 0 : 1
      if (aOver !== bOver) return aOver - bOver
      const aAge = daysSinceMs(a.milestone.updated_at) || 0
      const bAge = daysSinceMs(b.milestone.updated_at) || 0
      return bAge - aAge
    })
  }
  // Blocked installs sort oldest-waiting first — the longer a ready stone sits
  // unschedulable, the more it needs the operator's eye.
  blocked.sort((a, b) => (daysSinceMs(b.milestone.updated_at) || 0) - (daysSinceMs(a.milestone.updated_at) || 0))
  return { buckets, blocked }
}

// ── MONTH / WEEK / DAY VIEW DERIVERS ────────────────────────────────────────

// 6-week month grid (always 42 cells, Sun-Sat) starting from the Sunday
// before the first of the month. Each cell carries the day's date, an
// in-month flag, counts of placed batches by status, and any active
// promises whose promised_date falls on that day.
export function getMonthLandscape({ year, month, batches, promises }) {
  // Anchor on the 1st of the requested month; back up to the prior Sunday.
  const anchor = new Date(year, month, 1)
  const offset = anchor.getDay()   // 0 = Sunday
  const start = new Date(year, month, 1 - offset)
  const todayISO = todayLocalISO()

  const batchesByDate = new Map()
  for (const b of (batches || [])) {
    if (!b.scheduled_date) continue
    const k = String(b.scheduled_date).slice(0, 10)
    if (!batchesByDate.has(k)) batchesByDate.set(k, [])
    batchesByDate.get(k).push(b)
  }
  const promisesByDate = new Map()
  for (const p of (promises || [])) {
    if (p.kept !== null || p.resolved_at) continue   // closed promises off the heat map
    const k = String(p.promised_date).slice(0, 10)
    if (!promisesByDate.has(k)) promisesByDate.set(k, [])
    promisesByDate.get(k).push(p)
  }

  const cells = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const dayBatches = batchesByDate.get(iso) || []
    const dayPromises = promisesByDate.get(iso) || []
    cells.push({
      date:        d,
      iso,
      inMonth:     d.getMonth() === month,
      isToday:     iso === todayISO,
      batches:     dayBatches,
      batchCount:  dayBatches.length,
      promises:    dayPromises,
      promiseCount: dayPromises.length,
      // Heavy day signal — 5+ batches OR 1+ promise + 3+ batches.
      heavy:       dayBatches.length >= 5 ||
                   (dayPromises.length > 0 && dayBatches.length >= 3),
    })
  }
  return cells
}

// Two-week / week view — returns the requested number of consecutive days
// starting from `start` with their placed batches. `start` should be a
// Date or YYYY-MM-DD. spanDays defaults to 7.
export function getDayRange({ start, spanDays = 7, batches, promises }) {
  const anchor = (typeof start === 'string')
    ? new Date(`${start.slice(0, 10)}T00:00:00`)
    : new Date(start)
  const todayISO = todayLocalISO()

  const batchesByDate = new Map()
  for (const b of (batches || [])) {
    if (!b.scheduled_date) continue
    const k = String(b.scheduled_date).slice(0, 10)
    if (!batchesByDate.has(k)) batchesByDate.set(k, [])
    batchesByDate.get(k).push(b)
  }
  const promisesByDate = new Map()
  for (const p of (promises || [])) {
    if (p.kept !== null || p.resolved_at) continue
    const k = String(p.promised_date).slice(0, 10)
    if (!promisesByDate.has(k)) promisesByDate.set(k, [])
    promisesByDate.get(k).push(p)
  }

  const cells = []
  for (let i = 0; i < spanDays; i++) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + i)
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const dayBatches = batchesByDate.get(iso) || []
    const dayPromises = promisesByDate.get(iso) || []
    cells.push({
      date:    d,
      iso,
      isToday: iso === todayISO,
      batches: dayBatches,
      promises: dayPromises,
      heavy:   dayBatches.length >= 5 ||
               (dayPromises.length > 0 && dayBatches.length >= 3),
    })
  }
  return cells
}

// Day view — splits a day's batches into field + shop, computes per-trip
// mileage, and sorts stops within trips. Stop sorting uses the link row's
// stop_order; missing stop_order falls to the end (defensive).
export function getDayView({ date, batches }) {
  const iso = (typeof date === 'string') ? String(date).slice(0, 10) : todayLocalISO()
  const today = (batches || []).filter(b => String(b.scheduled_date || '').slice(0, 10) === iso)
  const field = []
  const shop  = []
  for (const b of today) {
    const kindInfo = batchKindInfo(b.kind)
    const stops = (b.batch_jobs || []).slice().sort((x, y) => (x.stop_order ?? 999) - (y.stop_order ?? 999))
    const augmented = { ...b, kindInfo, stops }
    if (kindInfo.isField) {
      augmented.mileage = computeTripMileage(b)
      field.push(augmented)
    } else {
      shop.push(augmented)
    }
  }
  return { date: iso, field, shop }
}

// ── TRIP OPTIMIZER ──────────────────────────────────────────────────────────
// Four reason levels, in precedence order:
//   1. same_cemetery — any actionable job at the destination cemetery
//   2. piggyback      — rubs/photos at the destination cemetery (regardless of distance)
//   3. nearby_cemetery — actionable jobs within NEARBY_RADIUS_MILES
//   4. cross_stage_same_cemetery — upstream actionable jobs at the destination
//
// Returns 4-8 suggestions sorted by precedence then by aging.
const NEARBY_RADIUS_MILES = 10
const MAX_TRIP_SUGGESTIONS = 8

export function getTripSuggestions({ cemetery_id, currently_selected_job_ids, jobs, cemeteries }) {
  if (!cemetery_id) return []
  const selectedSet = new Set(currently_selected_job_ids || [])
  const destination = (cemeteries || []).find(c => c.id === cemetery_id)
  if (!destination) return []

  const sameCemetery = []
  const piggyback = []
  const nearbyCemetery = []
  const crossStageSame = []

  // Precompute cemetery distances from the destination.
  const distanceById = new Map()
  if (destination.geocoded_lat != null && destination.geocoded_lng != null) {
    for (const c of cemeteries) {
      if (!c.id || c.id === destination.id) continue
      if (c.geocoded_lat == null || c.geocoded_lng == null) continue
      distanceById.set(c.id, haversineMiles(
        Number(destination.geocoded_lat), Number(destination.geocoded_lng),
        Number(c.geocoded_lat),           Number(c.geocoded_lng),
      ))
    }
  }

  for (const job of (jobs || [])) {
    if (!job || job.overall_status === 'closed') continue
    if (selectedSet.has(job.id)) continue
    const jobCemId = job.order?.cemetery_id || job.cemetery?.id
    if (!jobCemId) continue
    const byKey = new Map((job.milestones || []).map(m => [m.milestone_key, m]))
    const actionable = (job.milestones || []).find(m => {
      if (m.status === 'done' || m.status === 'not_needed') return false
      if (m.status === 'not_started' && hasUnsatisfiedRequires(m, byKey)) return false
      return true
    })
    if (!actionable) continue

    const fieldKinds = new Set(['stencil_cut', 'ready_to_install', 'installed', 'foundation_poured'])
    const isFieldReady = fieldKinds.has(actionable.milestone_key)

    if (jobCemId === cemetery_id) {
      if (isFieldReady) {
        sameCemetery.push({ job, milestone: actionable, reason: 'same_cemetery', distance_miles: 0 })
      } else {
        crossStageSame.push({ job, milestone: actionable, reason: 'cross_stage_same_cemetery', distance_miles: 0 })
      }
      continue
    }
    const dist = distanceById.get(jobCemId)
    if (dist != null && dist <= NEARBY_RADIUS_MILES && isFieldReady) {
      nearbyCemetery.push({ job, milestone: actionable, reason: 'nearby_cemetery', distance_miles: dist })
    }
  }

  // Sort each bucket by aging desc within itself.
  const byAging = (a, b) => (daysSinceMs(b.milestone.updated_at) || 0) - (daysSinceMs(a.milestone.updated_at) || 0)
  sameCemetery.sort(byAging)
  piggyback.sort(byAging)
  nearbyCemetery.sort((a, b) => a.distance_miles - b.distance_miles)
  crossStageSame.sort(byAging)

  const out = [
    ...sameCemetery,
    ...piggyback,
    ...nearbyCemetery,
    ...crossStageSame,
  ]
  return out.slice(0, MAX_TRIP_SUGGESTIONS)
}

// ── PROMISE HELPERS ─────────────────────────────────────────────────────────
// job_promises rows persist as long as the job. Open promises (kept IS NULL,
// resolved_at IS NULL) drive the loud 🤡 treatment everywhere.

export async function getActivePromisesForJob(jobId) {
  if (!jobId) return []
  const { data, error } = await supabase
    .from('job_promises')
    .select('*')
    .eq('job_id', jobId)
    .is('resolved_at', null)
    .order('promised_date', { ascending: true })
  if (error) {
    console.warn('[scheduler] getActivePromisesForJob failed:', error.message)
    return []
  }
  return data || []
}

export async function addPromise(jobId, { promised_by, promised_date, notes }) {
  if (!jobId || !promised_by || !promised_date) {
    return { ok: false, error: 'job_id, promised_by, and promised_date are required.' }
  }
  const { data, error } = await supabase
    .from('job_promises')
    .insert({
      job_id:        jobId,
      promised_by:   promised_by,
      promised_date: promised_date,
      notes:         (notes || '').trim() || null,
    })
    .select()
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, promise: data }
}

export async function resolvePromise(promiseId, { kept }) {
  if (!promiseId) return { ok: false, error: 'Missing promise id' }
  const { error } = await supabase
    .from('job_promises')
    .update({
      kept: !!kept,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', promiseId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// Rolling counters for a team member. Returns `{ made, kept, openCount }`
// across the window. `made` and `kept` include only resolved promises so
// the kept-rate is honest; openCount tells the operator how many promises
// are still in the air for this person.
export async function getPromiseCounts(promised_by, { rolling_days = 90 } = {}) {
  if (!promised_by) return { made: 0, kept: 0, openCount: 0 }
  const cutoff = new Date(Date.now() - rolling_days * 86400000).toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('job_promises')
    .select('id, kept, resolved_at, promised_date')
    .eq('promised_by', promised_by)
    .gte('promised_date', cutoff)
  if (error) {
    console.warn('[scheduler] getPromiseCounts failed:', error.message)
    return { made: 0, kept: 0, openCount: 0 }
  }
  const rows = data || []
  const resolved = rows.filter(r => r.resolved_at)
  return {
    made:      resolved.length,
    kept:      resolved.filter(r => r.kept === true).length,
    openCount: rows.filter(r => r.resolved_at === null).length,
  }
}

// Every open promise + the job it's attached to. Used by the Scheduler
// promise banner + the Today badge derivation. Joins minimal job fields.
export async function getAllOpenPromises({ since, includeResolved = false } = {}) {
  let q = supabase
    .from('job_promises')
    .select(`
      *,
      job:jobs(id, order_id, order:orders(id, order_number, primary_lastname, customer:customers(*), cemetery:cemeteries(*)))
    `)
    .order('promised_date', { ascending: true })
  // Default: open promises only. The Calendar passes includeResolved so its
  // day-state engine can render PERMANENT green (kept=true) / missed (kept=false)
  // marks — a settled promise has resolved_at set and would otherwise drop out.
  if (!includeResolved) q = q.is('resolved_at', null)
  if (since) q = q.gte('promised_date', since)
  const { data, error } = await q
  if (error) {
    console.warn('[scheduler] getAllOpenPromises failed:', error.message)
    return []
  }
  return data || []
}

// Build a Map<job_id, promise[]> from a list of open promises for quick
// per-job lookup inside row components. Keeps the badge render O(1).
export function indexPromisesByJob(promises) {
  const map = new Map()
  for (const p of (promises || [])) {
    if (!p?.job_id) continue
    if (!map.has(p.job_id)) map.set(p.job_id, [])
    map.get(p.job_id).push(p)
  }
  return map
}

// ── AUTO-RESOLVE PROMISES (system-computed, not human-marked) ────────────────
// resolvePromisesForJob IS wired into markBatchJobComplete (fires only on an
// operator's dispatch-completion action). expirePastPromises is defined but
// intentionally NOT called anywhere — it mutates many rows and the dev server
// points at prod, so it'll be triggered manually (button / dev script) later.
//
// Both stamp resolved_at alongside kept (proper closure: open-promise consumers
// like getAllOpenPromises / PromiseBanner / Today key off resolved_at). The
// Calendar still renders settled promises as PERMANENT green/missed because it
// loads them via getAllOpenPromises({ includeResolved: true }).
//
// Completeness considers SCHEDULED-batch links only — a job sitting in an
// unscheduled tray batch must not block resolution (matches the day-state engine).

// Resolve every open promise for a job once all its SCHEDULED stops are
// complete. kept = true when the latest completion ≤ promised_date, else false.
export async function resolvePromisesForJob(jobId) {
  if (!jobId) return { ok: false, error: 'Missing jobId' }
  const { data: promises, error: pErr } = await supabase
    .from('job_promises')
    .select('id, promised_date, kept')
    .eq('job_id', jobId)
    .is('kept', null)
  if (pErr) return { ok: false, error: pErr.message }
  if (!promises || promises.length === 0) return { ok: true, resolved: 0 }

  const { data: links, error: lErr } = await supabase
    .from('work_batch_jobs')
    .select('id, completed_at, batch:work_batches(scheduled_date)')
    .eq('job_id', jobId)
  if (lErr) return { ok: false, error: lErr.message }

  // Only links on a scheduled batch count toward "delivered".
  const scheduledLinks = (links || []).filter(l => l.batch && l.batch.scheduled_date)
  const allComplete = scheduledLinks.length > 0 && scheduledLinks.every(l => !!l.completed_at)
  if (!allComplete) return { ok: true, resolved: 0 }   // not deliverable yet

  const latestISO = scheduledLinks
    .map(l => String(l.completed_at).slice(0, 10))
    .reduce((m, d) => (d > m ? d : m), '')

  let resolved = 0
  for (const p of promises) {
    const kept = latestISO <= String(p.promised_date).slice(0, 10)
    const { error } = await supabase
      .from('job_promises')
      .update({ kept, resolved_at: new Date().toISOString() })
      .eq('id', p.id)
    if (!error) resolved++
  }
  return { ok: true, resolved }
}

// Sweep past-due open promises and stamp their outcome. Catches retroactive
// "kept" cases (all stops completed on/before the promised date) and records
// genuine misses (kept = false). Intended to run once on Calendar mount.
export async function expirePastPromises(today) {
  const iso = (typeof today === 'string') ? String(today).slice(0, 10) : todayLocalISO()
  const { data: promises, error: pErr } = await supabase
    .from('job_promises')
    .select('id, job_id, promised_date')
    .is('kept', null)
    .lt('promised_date', iso)
  if (pErr) return { ok: false, error: pErr.message }
  if (!promises || promises.length === 0) return { ok: true, expired: 0 }

  let expired = 0
  for (const p of promises) {
    const { data: links, error: lErr } = await supabase
      .from('work_batch_jobs')
      .select('id, completed_at')
      .eq('job_id', p.job_id)
    if (lErr) continue
    const allComplete = (links || []).length > 0 && links.every(l => !!l.completed_at)
    let kept = false
    if (allComplete) {
      const latestISO = links
        .map(l => String(l.completed_at).slice(0, 10))
        .reduce((m, d) => (d > m ? d : m), '')
      kept = latestISO <= String(p.promised_date).slice(0, 10)
    }
    const { error } = await supabase
      .from('job_promises')
      .update({ kept, resolved_at: new Date().toISOString() })
      .eq('id', p.id)
    if (!error) expired++
  }
  return { ok: true, expired }
}

// ── CARRYOVER MODEL ─────────────────────────────────────────────────────────
// Yesterday's unfinished work surfaces as a banner on today's Day view.
// Original batch row stays put (historical truth that it was scheduled for
// the prior day). Operator picks one of three actions per stop: mark
// complete (cascade to completed_at), reschedule to a target day, or send
// back to unscheduled (link-row delete).

export async function getCarryoverForToday(today) {
  const iso = (typeof today === 'string') ? String(today).slice(0, 10) : todayLocalISO()
  const { data, error } = await supabase
    .from('work_batch_jobs')
    .select(`
      *,
      batch:work_batches(*, cemetery:cemeteries(*)),
      job:jobs(*, order:orders(*, customer:customers(*), cemetery:cemeteries(*)))
    `)
    .is('completed_at', null)
  if (error) {
    console.warn('[scheduler] getCarryoverForToday failed:', error.message)
    return []
  }
  // Filter post-fetch: keep only link rows whose batch's scheduled_date is
  // strictly before today (and not null — null = still in build tray).
  return (data || [])
    .filter(r => r.batch?.scheduled_date && String(r.batch.scheduled_date).slice(0, 10) < iso)
    .filter(r => r.batch?.status !== 'cancelled')
}

// ── MILEAGE / HAVERSINE ─────────────────────────────────────────────────────

export function haversineMiles(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some(v => !Number.isFinite(v))) return null
  const R = 3958.8   // earth radius in miles
  const toRad = (x) => (x * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// Compute per-leg + total mileage for a field-trip batch. Returns:
//   { leg_miles: [number|null], total_miles, estimated_minutes }
// Legs are: shop → stop1 → stop2 → … → stopN → shop. A leg's miles is null
// when either endpoint lacks lat/lng (defensive — UI renders "—" instead
// of pretending to know the distance).
const _AVG_SPEED_MPH = 45
export function computeTripMileage(batch) {
  if (!batch?.batch_jobs) {
    return { leg_miles: [], total_miles: 0, estimated_minutes: 0 }
  }
  const stops = batch.batch_jobs
    .slice()
    .sort((a, b) => (a.stop_order ?? 999) - (b.stop_order ?? 999))
  // Build the stop coordinate list, ending back at the shop.
  const points = [SHOP_COORDINATES]
  for (const s of stops) {
    const cem = s.job?.order?.cemetery || s.job?.cemetery || batch.cemetery
    if (cem?.geocoded_lat != null && cem?.geocoded_lng != null) {
      points.push({ lat: Number(cem.geocoded_lat), lng: Number(cem.geocoded_lng) })
    } else {
      points.push(null)
    }
  }
  points.push(SHOP_COORDINATES)
  const legs = []
  let total = 0
  let anyKnown = false
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (!a || !b) { legs.push(null); continue }
    const m = haversineMiles(a.lat, a.lng, b.lat, b.lng)
    legs.push(m)
    if (Number.isFinite(m)) { total += m; anyKnown = true }
  }
  return {
    leg_miles:         legs,
    total_miles:       anyKnown ? Math.round(total * 10) / 10 : 0,
    estimated_minutes: anyKnown ? Math.round((total / _AVG_SPEED_MPH) * 60) : 0,
  }
}

// =============================================================================
// Proof versions (approval-packet version history)
// =============================================================================

// Stage 2 — create a new layout version for a job. Delegates the
// demote-current → next-version-number → insert-current transaction to the
// create_proof_version Postgres function (20260601_create_proof_version_fn.sql)
// so the one-current-per-job invariant holds atomically. Returns the raw
// supabase.rpc shape ({ data, error }); data is the inserted proof_versions row.
export async function createProofVersion({ jobId, layoutImageUrl, metadataSnapshot, uploadedBy }) {
  return await supabase.rpc('create_proof_version', {
    p_job_id:            jobId,
    p_layout_image_url:  layoutImageUrl,
    p_metadata_snapshot: metadataSnapshot ?? {},
    p_uploaded_by:       uploadedBy ?? null,
  })
}

// Stage 2 Commit 1 — upload a layout proof image to the public bucket created
// by 20260529_proof_versions.sql. UUID-based path keeps versions immutable
// (no overwrite) and side-steps filename collisions. JPG/PNG only — the public
// bucket exists so jsPDF's urlToDataURL() can fetch the image without signed-URL
// gymnastics; restricting to web-image types keeps that path simple.
export async function uploadProofLayout(jobId, file) {
  if (!jobId || !file) return { ok: false, error: 'Missing jobId or file' }
  const okTypes = ['image/jpeg', 'image/png']
  if (!okTypes.includes(file.type)) {
    return { ok: false, error: 'Layout image must be a JPG or PNG.' }
  }
  const ext = file.type === 'image/png' ? 'png' : 'jpg'
  const path = `proofs/${jobId}/${crypto.randomUUID()}.${ext}`
  const { error: upErr } = await supabase.storage
    .from('orders-attachments-public')
    .upload(path, file, { upsert: false, contentType: file.type })
  if (upErr) return { ok: false, error: upErr.message }
  const { data } = supabase.storage
    .from('orders-attachments-public')
    .getPublicUrl(path)
  return { ok: true, url: data.publicUrl, path }
}

// Version stack for a job, newest first. Reads the whole row (snapshot +
// overrides + approval state) so the Design Packet can render the current
// version inline without a second fetch.
export async function getProofVersions(jobId) {
  if (!jobId) return []
  const { data, error } = await supabase
    .from('proof_versions')
    .select('*')
    .eq('job_id', jobId)
    .order('version_number', { ascending: false })
  if (error) { console.warn('[proof] getProofVersions:', error.message); return [] }
  return data || []
}

// Stage 2 Commit 2 — proof lifecycle stamps (sent / approved). Whitelisted
// patch: only the lifecycle-timestamp + approver-name fields are writable here.
// signature_method / signature_url are intentionally NOT writable — actual
// signature capture is Phase 5A.3 (private bucket). Returns the updated row so
// the caller can refresh local state without a re-fetch.
export async function updateProofVersion(id, patch = {}) {
  if (!id) return { ok: false, error: 'Missing proof version id' }
  // Each branch gates on `!== undefined`, so passing an explicit `null`
  // (the undo path: { sent_at: null } / { approved_at: null }) IS permitted —
  // it falls through and writes NULL, clearing the timestamp. Omitting a key
  // leaves that column untouched.
  const row = {}
  if (patch.sent_at !== undefined)          row.sent_at = patch.sent_at || null
  if (patch.approved_at !== undefined)      row.approved_at = patch.approved_at || null
  if (patch.approved_by_name !== undefined) row.approved_by_name = (patch.approved_by_name || '').trim() || null
  // Phase 5A.3 active — signature fields are writable (set on e-signature
  // approval, nulled on unmark). Only the sign / unmark paths pass these.
  if (patch.signature_method !== undefined) row.signature_method = patch.signature_method || null
  if (patch.signature_url !== undefined)    row.signature_url = patch.signature_url || null
  if (Object.keys(row).length === 0) return { ok: false, error: 'Nothing to update' }
  const { data, error } = await supabase
    .from('proof_versions')
    .update(row)
    .eq('id', id)
    .select()
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, data }
}

// Phase 5A.3 — upload an approval signature PNG to the PRIVATE proof-signatures
// bucket (20260601_proof_signatures_bucket.sql). Path: signatures/{jobId}/
// {versionId}.png — one per version, upsert overwrites on re-sign. Returns the
// storage PATH (stored in proof_versions.signature_url); reads go through a
// signed URL since the bucket is private.
export async function uploadProofSignature(jobId, versionId, dataUrl) {
  if (!jobId || !versionId || !dataUrl) return { ok: false, error: 'Missing jobId, versionId, or signature' }
  const res = await fetch(dataUrl)
  const blob = await res.blob()
  const path = `signatures/${jobId}/${versionId}.png`
  const { error } = await supabase.storage
    .from('proof-signatures')
    .upload(path, blob, { upsert: true, contentType: 'image/png' })
  if (error) return { ok: false, error: error.message }
  return { ok: true, path }
}

// Short-lived signed URL for a private proof signature (render-time only).
export async function getProofSignatureSignedUrl(path, expiresIn = 300) {
  if (!path) return null
  const { data, error } = await supabase.storage
    .from('proof-signatures')
    .createSignedUrl(path, expiresIn)
  if (error) { console.warn('[proof] signature signed url:', error.message); return null }
  return data?.signedUrl || null
}

// Resolve the current staff member's display name for audit stamping
// (uploaded_by, etc.). Mirrors the sidebar's display_name || email convention
// (Stonebooks.jsx). Identity isn't prop-drilled to deep surfaces, so resolve it
// at the data layer. Falls back to 'Staff' when there's no per-user identity.
export async function getCurrentStaffName() {
  try {
    const { data: { user } = {} } = await supabase.auth.getUser()
    if (!user) return 'Staff'
    const settings = await getUserSettings(user.id)
    return settings?.display_name || user.email || 'Staff'
  } catch {
    return 'Staff'
  }
}

// =============================================================================
// End of Jobs Operations data layer
// =============================================================================
