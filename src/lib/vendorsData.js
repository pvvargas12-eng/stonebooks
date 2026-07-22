// =============================================================================
// 📚 Stonebooks — Vendor / Partner portal data layer
// =============================================================================
// CRUD for partners, requests, items, batches, POs, attachments, events. Both
// creation paths (internal staff + external partner) call createVendorRequest,
// so they produce identical vendor_requests + vendor_items rows (source
// discriminates). Files live in the private `vendor-files` bucket, pathed under
// <partner_id>/ for Phase 3 storage scoping; downloads use signed URLs.
// Returns [] / friendly errors when the 20260608 migration isn't applied yet.
// =============================================================================

import { supabase } from './supabase'
import { getCurrentStaffName, createTradeJob, sendShopEmail, todayISO } from './stonebooksData'

const MIGRATION_HINT = 'Vendor portal isn’t set up yet — apply the 20260608_vendor_portal migration in Supabase Studio, then try again.'
const isMissing = (msg) => /relation .* does not exist|could not find the table|schema cache/i.test(msg || '')
const wrapErr = (error) => ({ ok: false, error: isMissing(error?.message) ? MIGRATION_HINT : (error?.message || 'Error') })

const uid = () => (crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
const safeName = (n) => String(n || 'file').replace(/[^\w.-]+/g, '_')

// ── Partners ─────────────────────────────────────────────────────────────────
export async function listPartners({ includeInactive = true } = {}) {
  let q = supabase.from('partners').select('*').order('company_name', { ascending: true })
  if (!includeInactive) q = q.eq('active', true)
  const { data, error } = await q
  if (error) { console.warn('[vendors] listPartners:', error.message); return [] }
  return data || []
}
export async function createPartner(input = {}) {
  if (!input.companyName?.trim()) return { ok: false, error: 'Enter a company name.' }
  const row = {
    company_name: input.companyName.trim(), contact_person: input.contactPerson?.trim() || null,
    phone: input.phone?.trim() || null, email: input.email?.trim() || null,
    address: input.address?.trim() || null, payment_terms: input.paymentTerms?.trim() || null,
    notes: input.notes?.trim() || null, active: input.active === false ? false : true,
  }
  const { data, error } = await supabase.from('partners').insert(row).select().single()
  if (error) return wrapErr(error)
  return { ok: true, partner: data }
}
export async function updatePartner(id, patch = {}) {
  if (!id) return { ok: false, error: 'Missing id' }
  const map = { companyName: 'company_name', contactPerson: 'contact_person', phone: 'phone', email: 'email', address: 'address', paymentTerms: 'payment_terms', notes: 'notes', active: 'active' }
  const row = { updated_at: new Date().toISOString() }
  for (const [k, col] of Object.entries(map)) if (k in patch) row[col] = typeof patch[k] === 'string' ? (patch[k].trim() || null) : patch[k]
  const { error } = await supabase.from('partners').update(row).eq('id', id)
  if (error) return wrapErr(error)
  return { ok: true }
}

// ── Requests + items (the shared creation path) ──────────────────────────────
// items: [{ workType, vendorReference, stoneSize, baseSize, color, cemetery,
//           deceasedFamilyName, itemNotes }]
export async function createVendorRequest(input = {}) {
  if (!input.partnerId) return { ok: false, error: 'Pick a partner.' }
  const items = (input.items || []).filter(Boolean)
  if (items.length === 0) return { ok: false, error: 'Add at least one item.' }
  const createdBy = input.createdBy || await getCurrentStaffName().catch(() => null)
  const TRADE_SERVICE_CODES = ['design', 'blast', 'pickup', 'install', 'doors', 'fix', 'custom']
  const services = (input.services || []).filter(s => TRADE_SERVICE_CODES.includes(s))
  const reqRow = {
    partner_id: input.partnerId,
    request_name: input.requestName?.trim() || null,
    needed_by: input.neededBy || null,
    rush: !!input.rush,
    general_notes: input.generalNotes?.trim() || null,
    status: 'submitted',
    source: input.source === 'partner' ? 'partner' : 'internal',
    created_by: createdBy || null,
    // Stonebooks Trade order-grain fields (20260707 migration).
    family_name: input.familyName?.trim() || null,
    dealer_order_number: input.dealerOrderNumber?.trim() || null,
    services,
    service_custom: input.serviceCustom?.trim() || null,
    rush_need_by: input.rush ? (input.rushNeedBy || input.neededBy || null) : null,
    rush_status: input.rush ? 'pending' : 'none',
    submitted_by: input.submittedBy?.trim() || null,
  }
  const { data: req, error: reqErr } = await supabase.from('vendor_requests').insert(reqRow).select().single()
  if (reqErr) return wrapErr(reqErr)

  const itemRows = items.map(it => ({
    request_id: req.id,
    work_type: ['design', 'blasting', 'setting', 'other', 'blast', 'pickup', 'install', 'doors', 'fix', 'custom'].includes(it.workType) ? it.workType : 'other',
    vendor_reference: it.vendorReference?.trim() || null,
    stone_size: it.stoneSize?.trim() || null,
    base_size: it.baseSize?.trim() || null,
    color: it.color?.trim() || null,
    cemetery: it.cemetery?.trim() || null,
    deceased_family_name: it.deceasedFamilyName?.trim() || null,
    item_notes: it.itemNotes?.trim() || null,
    location: it.location?.trim() || null,
    notes_align: it.notesAlign === 'center' ? 'center' : null,
    status: 'submitted',
  }))
  const { data: created, error: itemErr } = await supabase.from('vendor_items').insert(itemRows).select()
  if (itemErr) return { ok: false, error: `Request created but items failed: ${itemErr.message}`, request: req }

  // Event carries partner_id + actor_role so a dealer submission lights the
  // Vendors badge (partner-actor, staff_seen_at null) the moment it lands.
  await supabase.from('vendor_events').insert({
    request_id: req.id, partner_id: input.partnerId,
    event_type: 'order_created',
    actor: createdBy || (reqRow.source === 'partner' ? 'Partner' : 'Staff'),
    actor_role: reqRow.source === 'partner' ? 'partner' : 'staff',
    detail: `New order${reqRow.family_name ? ` — ${reqRow.family_name}` : ''}${reqRow.dealer_order_number ? ` (${reqRow.dealer_order_number})` : ''}${reqRow.rush ? ` · RUSH needed by ${reqRow.rush_need_by || '?'}` : ''}`,
  }).select().maybeSingle().then(() => {}, () => {})

  // Dealer confirmation email ("we got it") — respects their Settings toggle.
  if (reqRow.source === 'partner') notifyTradeDealer(req.id, 'placed').catch(() => {})

  return { ok: true, request: req, items: created || [] }
}

// All items across partners, request + partner + batch joined (Work Queue).
// ARCHIVED requests are excluded EVERYWHERE this feeds (Work Queue, batches,
// the partner portal job lists) — Paul's rule: archived = off every work
// surface in Stonebooks, not just hidden on the board.
export async function listVendorItems() {
  const { data, error } = await supabase
    .from('vendor_items')
    .select('*, request:vendor_requests(*, partner:partners(*)), batch:vendor_batches(*)')
    .order('updated_at', { ascending: false })
  if (error) { console.warn('[vendors] listVendorItems:', error.message); return [] }
  return (data || []).filter(i => !i.request?.archived_at)
}
export async function getVendorItem(id) {
  if (!id) return null
  const { data, error } = await supabase
    .from('vendor_items')
    .select('*, request:vendor_requests(*, partner:partners(*)), batch:vendor_batches(*)')
    .eq('id', id).single()
  if (error) { console.warn('[vendors] getVendorItem:', error.message); return null }
  return data
}
export async function getVendorRequest(id) {
  if (!id) return null
  const { data, error } = await supabase
    .from('vendor_requests')
    .select('*, partner:partners(*), items:vendor_items(*)')
    .eq('id', id).single()
  if (error) { console.warn('[vendors] getVendorRequest:', error.message); return null }
  return data
}

export async function updateVendorRequest(id, patch = {}) {
  if (!id) return { ok: false, error: 'Missing id' }
  const map = { requestName: 'request_name', partnerId: 'partner_id', neededBy: 'needed_by', rush: 'rush', generalNotes: 'general_notes', status: 'status' }
  const row = { updated_at: new Date().toISOString() }
  for (const [k, col] of Object.entries(map)) if (k in patch) row[col] = patch[k]
  const { error } = await supabase.from('vendor_requests').update(row).eq('id', id)
  if (error) return wrapErr(error)
  return { ok: true }
}

export async function updateVendorItem(id, patch = {}, { actor } = {}) {
  if (!id) return { ok: false, error: 'Missing id' }
  const map = {
    workType: 'work_type', vendorReference: 'vendor_reference', stoneSize: 'stone_size',
    baseSize: 'base_size', color: 'color', cemetery: 'cemetery', deceasedFamilyName: 'deceased_family_name',
    itemNotes: 'item_notes', status: 'status', assignedTo: 'assigned_to', internalNotes: 'internal_notes', batchId: 'batch_id',
  }
  const row = { updated_at: new Date().toISOString() }
  for (const [k, col] of Object.entries(map)) if (k in patch) row[col] = patch[k]
  const { data, error } = await supabase.from('vendor_items').update(row).eq('id', id).select('request_id').single()
  if (error) return wrapErr(error)
  if (patch.status) {
    await addVendorEvent({ requestId: data?.request_id, itemId: id, eventType: 'status_changed', actor, detail: `Status → ${patch.status}` })
  }
  return { ok: true }
}

export async function addVendorItem(requestId, itemInput = {}) {
  if (!requestId) return { ok: false, error: 'Missing request' }
  const row = {
    request_id: requestId,
    work_type: ['design', 'blasting', 'setting', 'other'].includes(itemInput.workType) ? itemInput.workType : 'other',
    vendor_reference: itemInput.vendorReference?.trim() || null,
    stone_size: itemInput.stoneSize?.trim() || null, base_size: itemInput.baseSize?.trim() || null,
    color: itemInput.color?.trim() || null, cemetery: itemInput.cemetery?.trim() || null,
    deceased_family_name: itemInput.deceasedFamilyName?.trim() || null, item_notes: itemInput.itemNotes?.trim() || null,
    status: 'submitted',
  }
  const { data, error } = await supabase.from('vendor_items').insert(row).select().single()
  if (error) return wrapErr(error)
  return { ok: true, item: data }
}
export async function deleteVendorItem(id) {
  if (!id) return { ok: false, error: 'Missing id' }
  const { error } = await supabase.from('vendor_items').delete().eq('id', id)
  if (error) return wrapErr(error)
  return { ok: true }
}
export async function duplicateVendorItem(id) {
  const it = await getVendorItem(id)
  if (!it) return { ok: false, error: 'Item not found' }
  return addVendorItem(it.request_id, {
    workType: it.work_type, vendorReference: it.vendor_reference, stoneSize: it.stone_size,
    baseSize: it.base_size, color: it.color, cemetery: it.cemetery,
    deceasedFamilyName: it.deceased_family_name, itemNotes: it.item_notes,
  })
}

// ── Files ────────────────────────────────────────────────────────────────────
export async function uploadVendorFile(file, { partnerId, requestId, itemId, uploaderRole = 'staff', kind = 'upload' } = {}) {
  if (!file) return { ok: false, error: 'No file' }
  const path = `${partnerId || 'unknown'}/${requestId || itemId || 'misc'}/${uid()}_${safeName(file.name)}`
  const { error: upErr } = await supabase.storage.from('vendor-files').upload(path, file, { upsert: false, contentType: file.type || undefined })
  if (upErr) return wrapErr(upErr)
  const { data, error } = await supabase.from('vendor_attachments').insert({
    request_id: requestId || null, item_id: itemId || null, uploader_role: uploaderRole, kind, file_path: path, file_name: file.name,
  }).select().single()
  if (error) return wrapErr(error)
  await addVendorEvent({ requestId, itemId, eventType: 'file_uploaded', actor: uploaderRole === 'partner' ? 'Partner' : 'Staff', detail: `${kind === 'completion_photo' ? 'Completion photo' : 'File'}: ${file.name}` })
  return { ok: true, attachment: data }
}
export async function listVendorAttachments({ requestId, itemId } = {}) {
  let q = supabase.from('vendor_attachments').select('*').order('created_at', { ascending: false })
  if (itemId) q = q.eq('item_id', itemId)
  else if (requestId) q = q.eq('request_id', requestId)
  const { data, error } = await q
  if (error) { console.warn('[vendors] listVendorAttachments:', error.message); return [] }
  return data || []
}
export async function vendorFileSignedUrl(path, expiresIn = 3600) {
  if (!path) return null
  const { data, error } = await supabase.storage.from('vendor-files').createSignedUrl(path, expiresIn)
  if (error) { console.warn('[vendors] signed url:', error.message); return null }
  return data?.signedUrl || null
}

// ── Events ───────────────────────────────────────────────────────────────────
export async function addVendorEvent({ requestId, itemId, eventType, actor, detail } = {}) {
  if (!eventType) return { ok: false }
  const { error } = await supabase.from('vendor_events').insert({
    request_id: requestId || null, item_id: itemId || null, event_type: eventType, actor: actor || null, detail: detail || null,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
export async function listVendorEvents({ requestId, itemId } = {}) {
  let q = supabase.from('vendor_events').select('*').order('created_at', { ascending: false })
  if (itemId) q = q.or(`item_id.eq.${itemId}${requestId ? `,request_id.eq.${requestId}` : ''}`)
  else if (requestId) q = q.eq('request_id', requestId)
  const { data, error } = await q
  if (error) { console.warn('[vendors] listVendorEvents:', error.message); return [] }
  return data || []
}

// ── Batches ──────────────────────────────────────────────────────────────────
export async function listVendorBatches() {
  const { data, error } = await supabase
    .from('vendor_batches').select('*, partner:partners(*), items:vendor_items(id, status, work_type, vendor_reference)')
    .order('created_at', { ascending: false })
  if (error) { console.warn('[vendors] listVendorBatches:', error.message); return [] }
  return data || []
}
export async function createVendorBatch({ partnerId, name } = {}) {
  const { data, error } = await supabase.from('vendor_batches').insert({ partner_id: partnerId || null, name: name?.trim() || null, status: 'open' }).select().single()
  if (error) return wrapErr(error)
  return { ok: true, batch: data }
}
export async function updateVendorBatch(id, patch = {}) {
  if (!id) return { ok: false, error: 'Missing id' }
  const row = { updated_at: new Date().toISOString() }
  if (patch.name !== undefined) row.name = patch.name?.trim() || null
  if (patch.status !== undefined) row.status = patch.status
  const { error } = await supabase.from('vendor_batches').update(row).eq('id', id)
  if (error) return wrapErr(error)
  return { ok: true }
}
export const setItemBatch = (itemId, batchId) => updateVendorItem(itemId, { batchId: batchId || null })

// ── POs (simple, no pricing) ─────────────────────────────────────────────────
export async function listVendorPOs() {
  const { data, error } = await supabase
    .from('vendor_pos').select('*, partner:partners(*), po_items:vendor_po_items(*)')
    .order('created_at', { ascending: false })
  if (error) { console.warn('[vendors] listVendorPOs:', error.message); return [] }
  return data || []
}
export async function nextPONumber() {
  const { data } = await supabase.from('vendor_pos').select('po_number').order('created_at', { ascending: false }).limit(50)
  const year = new Date().getFullYear()
  let max = 0
  for (const r of (data || [])) {
    const m = String(r.po_number || '').match(new RegExp(`VPO-${year}-(\\d+)`))
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `VPO-${year}-${String(max + 1).padStart(3, '0')}`
}
// poItems: [{ itemId, description, quantity }]
export async function createVendorPO(input = {}) {
  if (!input.partnerId) return { ok: false, error: 'Pick a partner.' }
  const poNumber = input.poNumber || await nextPONumber()
  const { data: po, error } = await supabase.from('vendor_pos').insert({
    partner_id: input.partnerId, po_number: poNumber, po_date: input.poDate || todayISO(),
    status: input.status === 'sent' ? 'sent' : 'draft', notes: input.notes?.trim() || null,
    custom_amount: input.customAmount != null && input.customAmount !== '' ? Number(input.customAmount) : null,
    batch_id: input.batchId || null,
  }).select().single()
  if (error) return wrapErr(error)
  const poItems = (input.poItems || []).filter(Boolean)
  if (poItems.length) {
    const rows = poItems.map(pi => ({
      po_id: po.id, item_id: pi.itemId || null, description: pi.description || null, quantity: Number(pi.quantity) || 1,
      unit_price: pi.unitPrice != null && pi.unitPrice !== '' ? Number(pi.unitPrice) : null,
    }))
    // Surface a line-insert failure — swallowing it makes typed lines "vanish".
    const { error: itemsErr } = await supabase.from('vendor_po_items').insert(rows)
    if (itemsErr) return { ok: false, error: `Invoice saved but its lines failed: ${itemsErr.message}`, po }
  }
  if (po.status === 'sent') await addVendorEvent({ requestId: null, itemId: null, eventType: 'email_sent', actor: 'Staff', detail: `PO ${poNumber} sent` })
  return { ok: true, po }
}
export async function updateVendorPO(id, patch = {}) {
  if (!id) return { ok: false, error: 'Missing id' }
  const row = {}
  if (patch.status !== undefined) row.status = patch.status
  if (patch.poNumber !== undefined) row.po_number = patch.poNumber?.trim() || null
  if (patch.notes !== undefined) row.notes = patch.notes?.trim() || null
  if (patch.customAmount !== undefined) row.custom_amount = patch.customAmount === '' ? null : Number(patch.customAmount)
  if (Object.keys(row).length) {
    const { error } = await supabase.from('vendor_pos').update(row).eq('id', id)
    if (error) return wrapErr(error)
  }
  // Full line replace (edit-invoice flow) — delete + re-insert, and CHECK the
  // insert error: a silent line-insert failure looks like "my lines never
  // saved" (Paul, 2026-07-08).
  if (patch.poItems !== undefined) {
    const { error: delErr } = await supabase.from('vendor_po_items').delete().eq('po_id', id)
    if (delErr) return wrapErr(delErr)
    const rows = (patch.poItems || []).filter(Boolean).map(pi => ({
      po_id: id, item_id: pi.itemId || null, description: pi.description || null, quantity: Number(pi.quantity) || 1,
      unit_price: pi.unitPrice != null && pi.unitPrice !== '' ? Number(pi.unitPrice) : null,
    }))
    if (rows.length) {
      const { error: insErr } = await supabase.from('vendor_po_items').insert(rows)
      if (insErr) return wrapErr(insErr)
    }
  }
  return { ok: true }
}

// Delete an invoice outright (lines first — no FK cascade assumed).
export async function deleteVendorPO(id) {
  if (!id) return { ok: false, error: 'Missing id' }
  const { error: liErr } = await supabase.from('vendor_po_items').delete().eq('po_id', id)
  if (liErr) return wrapErr(liErr)
  const { error } = await supabase.from('vendor_pos').delete().eq('id', id)
  if (error) return wrapErr(error)
  return { ok: true }
}

// Payment received against an invoice → status 'paid' + the payment details
// kept on the row (Paul, 2026-07-08: "add payment received and it would mark
// it as paid").
export async function recordVendorPOPayment(id, { amount, method = 'check', ref = '', date = null, actor = null } = {}) {
  if (!id) return { ok: false, error: 'Missing id' }
  if (amount == null || amount === '' || !(Number(amount) > 0)) return { ok: false, error: 'Enter the amount received.' }
  const payment = {
    amount: Number(amount), method, ref: ref?.trim() || null,
    date: date || todayISO(),
    recordedBy: actor || null, at: new Date().toISOString(),
  }
  const { data: po, error } = await supabase.from('vendor_pos')
    .update({ status: 'paid', payment }).eq('id', id).select('po_number, partner_id').single()
  if (error) return wrapErr(error)
  await addVendorEvent({
    requestId: null, itemId: null, eventType: 'status_changed', actor: actor || 'Staff',
    detail: `Invoice ${po?.po_number || ''} PAID — $${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2 })} by ${method}${ref ? ` (#${ref.trim()})` : ''}`,
  }).catch(() => {})
  return { ok: true }
}

// ── Partner portal: identity + invites (PHASE 3) ─────────────────────────────
// Resolves the CURRENT auth user to a partner mapping. Returns
// { partnerId, partner } for a portal user, or null for staff (no mapping).
// This is what App routing uses to decide staff app vs partner portal. The
// partner_users RLS lets a partner read only their own mapping row, and the
// scoped partners policy lets them read only their own company — so this is
// safe to call from either side.
export async function getMyPartnerContext() {
  const { data: auth } = await supabase.auth.getUser()
  const userId = auth?.user?.id
  if (!userId) return null
  const { data: mapping, error } = await supabase
    .from('partner_users').select('partner_id').eq('auth_user_id', userId).maybeSingle()
  if (error || !mapping) return null   // staff (or pre-migration): no portal binding
  const { data: partner } = await supabase.from('partners').select('*').eq('id', mapping.partner_id).maybeSingle()
  return { partnerId: mapping.partner_id, partner: partner || null }
}

// Staff invites an outside partner contact to the portal. Routes through the
// vendor-invite Edge Function (service role) — the partner sets their OWN
// password from the invite email; staff never type partner credentials.
export async function invitePartnerUser({ partnerId, email } = {}) {
  if (!partnerId) return { ok: false, error: 'Missing partner.' }
  if (!email?.trim()) return { ok: false, error: 'Enter the partner contact’s email.' }
  const { data, error } = await supabase.functions.invoke('vendor-invite', {
    body: { partner_id: partnerId, email: email.trim().toLowerCase(), redirect_to: `${window.location.origin}/trade` },
  })
  if (error) {
    // Edge function not deployed yet, or returned an error body.
    let msg = error.message || 'Invite failed.'
    try { const ctx = await error.context?.json?.(); if (ctx?.error) msg = ctx.detail || ctx.error } catch { /* ignore */ }
    if (/not.*found|404|failed to fetch|failed to send/i.test(msg)) {
      msg = 'Invite isn’t available yet — deploy the vendor-invite Edge Function (supabase functions deploy vendor-invite), then try again.'
    }
    return { ok: false, error: msg }
  }
  if (data?.error) return { ok: false, error: data.detail || data.error }
  return { ok: true, userId: data?.user_id }
}

// Portal users mapped to a partner (staff view — who can log into the portal
// for this company). Staff RLS sees all mappings.
export async function listPartnerUsers(partnerId) {
  if (!partnerId) return []
  const { data, error } = await supabase
    .from('partner_users').select('*').eq('partner_id', partnerId).order('created_at', { ascending: true })
  if (error) { console.warn('[vendors] listPartnerUsers:', error.message); return [] }
  return data || []
}

// Staff signal: how many PARTNER-submitted requests are still awaiting first
// triage (≥1 line item still in 'submitted'). Honest + schema-free — it rises
// when a partner submits and falls as staff advance the items off 'submitted'.
// Returns 0 on any error / unapplied migration so the shell badge never breaks.
export async function getNewPartnerRequestCount() {
  const { data, error } = await supabase
    .from('vendor_items')
    .select('request_id, request:vendor_requests!inner(source)')
    .eq('status', 'submitted')
    .eq('request.source', 'partner')
  if (error) { console.warn('[vendors] getNewPartnerRequestCount:', error.message); return 0 }
  return new Set((data || []).map(r => r.request_id)).size
}

// Partner portal job lists. RLS scopes every row to the caller's partner, so
// these need no explicit partner_id filter — isolation is enforced server-side.
export async function listMyRequests() {
  const { data, error } = await supabase
    .from('vendor_requests')
    .select('*, items:vendor_items(*)')
    .order('created_at', { ascending: false })
  if (error) { console.warn('[vendors] listMyRequests:', error.message); return [] }
  return data || []
}

// =============================================================================
// STONEBOOKS TRADE (Trade Accounts) — slice 1 data layer
// =============================================================================
// The trade ORDER is a vendor_requests row (order-grain fields added by the
// 20260707_trade_accounts migration); specs live on its vendor_items. Every
// action logs a vendor_event carrying partner_id + actor_role — partner-actor
// events power the red Vendors badge until staff_seen_at is stamped.
// =============================================================================

export const TRADE_SERVICES = [
  { code: 'design',  label: 'Design' },
  { code: 'blast',   label: 'Blast' },
  { code: 'pickup',  label: 'Pickup' },
  { code: 'install', label: 'Install' },
  { code: 'doors',   label: 'Doors' },
  { code: 'fix',     label: 'Fix' },
  { code: 'custom',  label: 'Custom' },
]
export const TRADE_DESIGN_PHASES = [
  { code: 'not_created',       label: 'Not created',       tone: 'gray' },
  { code: 'in_progress',       label: 'In progress',       tone: 'blue' },
  { code: 'changes_requested', label: 'Changes requested', tone: 'red' },
  { code: 'sent_draft',        label: 'Sent draft',        tone: 'amber' },
  { code: 'approved',          label: 'Approved',          tone: 'green' },
]
export const TRADE_STONE_STATUSES = [
  { code: 'not_here', label: 'Not here', tone: 'gray' },
  { code: 'arrived',  label: 'Arrived',  tone: 'green' },
]
export const TRADE_RUSH_STATUSES = ['none', 'pending', 'approved', 'declined']
export const tradeServiceLabel = (code) =>
  (TRADE_SERVICES.find(s => s.code === code)?.label) || (code ? String(code) : '')

// One event writer for BOTH sides. actorRole 'partner' events light the badge.
export async function logTradeEvent({ requestId = null, itemId = null, partnerId = null, type, detail = null, actor = null, actorRole = 'staff' }) {
  if (!type) return { ok: false, error: 'Missing event type' }
  const { error } = await supabase.from('vendor_events').insert({
    request_id: requestId, item_id: itemId, partner_id: partnerId,
    event_type: type, detail, actor, actor_role: actorRole === 'partner' ? 'partner' : 'staff',
  })
  if (error) { console.warn('[trade] logTradeEvent:', error.message); return wrapErr(error) }
  return { ok: true }
}

// Trade orders, request-grain, partner + items joined. scope: active (default,
// not archived + not completed/cancelled), complete, archived, all.
export async function listTradeOrders({ partnerId = null, scope = 'active' } = {}) {
  let q = supabase.from('vendor_requests')
    .select('*, partner:partners(*), items:vendor_items(*)')
    .order('created_at', { ascending: false })
  if (partnerId) q = q.eq('partner_id', partnerId)
  const { data, error } = await q
  if (error) { console.warn('[trade] listTradeOrders:', error.message); return [] }
  const rows = data || []
  const isComplete = (r) => ['completed', 'cancelled'].includes(r.status)
  if (scope === 'archived') return rows.filter(r => r.archived_at)
  if (scope === 'complete') return rows.filter(r => !r.archived_at && isComplete(r))
  if (scope === 'active')   return rows.filter(r => !r.archived_at && !isComplete(r))
  return rows
}

// Order-grain patch (camelCase → columns). Callers decide needs_reaccept.
const TRADE_ORDER_COLS = {
  familyName: 'family_name', dealerOrderNumber: 'dealer_order_number',
  services: 'services', serviceCustom: 'service_custom',
  neededBy: 'needed_by', rush: 'rush', rushNeedBy: 'rush_need_by',
  rushStatus: 'rush_status', rushDecidedBy: 'rush_decided_by', rushDecidedAt: 'rush_decided_at',
  acceptedAt: 'accepted_at', acceptedBy: 'accepted_by', needsReaccept: 'needs_reaccept',
  designPhase: 'design_phase', designApprovedAt: 'design_approved_at',
  stoneStatus: 'stone_status', stoneArrivedAt: 'stone_arrived_at', stoneDropLocation: 'stone_drop_location',
  archivedAt: 'archived_at', archivedBy: 'archived_by', jobId: 'job_id',
  status: 'status', generalNotes: 'general_notes', requestName: 'request_name',
  dropoffReceipt: 'dropoff_receipt', pickupReceipt: 'pickup_receipt',
}
export async function updateTradeOrder(requestId, patch = {}) {
  if (!requestId) return { ok: false, error: 'Missing order id' }
  const row = { updated_at: new Date().toISOString() }
  for (const [k, col] of Object.entries(TRADE_ORDER_COLS)) if (k in patch) row[col] = patch[k]
  const { error } = await supabase.from('vendor_requests').update(row).eq('id', requestId)
  if (error) return wrapErr(error)
  return { ok: true }
}

// The Accept checkpoint — specs verified, guarantee attaches, and the order
// becomes a REAL job (same milestone templates the shop already works, so the
// Scheduler / hubs / dealer tracker all read one truth). Re-accepts (post-edit)
// keep the existing job.
export async function acceptTradeOrder(requestId, { actor = null } = {}) {
  const { data: req } = await supabase.from('vendor_requests')
    .select('id, partner_id, services, job_id').eq('id', requestId).maybeSingle()
  const r = await updateTradeOrder(requestId, {
    acceptedAt: new Date().toISOString(), acceptedBy: actor, needsReaccept: false,
    status: 'accepted',
  })
  if (!r.ok) return r
  await logTradeEvent({ requestId, partnerId: req?.partner_id || null, type: 'order_accepted', actor, detail: 'Specs verified — order accepted' })
  notifyTradeDealer(requestId, 'accepted').catch(() => {})
  if (req && !req.job_id) {
    const jr = await createTradeJob({ vendorRequestId: requestId, services: req.services || [] })
    if (jr.ok && jr.job && !jr.alreadyExisted) {
      await updateTradeOrder(requestId, { jobId: jr.job.id })
      await logTradeEvent({ requestId, partnerId: req?.partner_id || null, type: 'job_created', actor, detail: 'Sent to production — job created' })
    } else if (!jr.ok) {
      console.warn('[trade] job creation failed:', jr.error)
    }
  }
  return r
}

// ── Slice 6: dealer email notifications with deep links ─────────────────────
// Every Shevchenko action emails the dealer with ONE button that lands them on
// the exact order (?trade=<id> → the portal auto-opens Orders and expands it).
// Sent to the company email (partners.email); per-user prefs land in slice 8's
// Settings. Fire-and-forget — a mail hiccup never blocks the action.
// Preference keys — each maps one or more notify kinds; false = muted, absent
// = ON. Edited by the dealer in portal Settings (partners.notification_prefs).
export const TRADE_NOTIFY_PREFS = [
  { key: 'placed',       label: 'Order placed (confirmation)' },
  { key: 'accepted',     label: 'Order accepted' },
  { key: 'rush',         label: 'Rush approved / declined' },
  { key: 'layout_ready', label: 'Layout ready for approval' },
  { key: 'photo',        label: 'Finished-stone photo added' },
  { key: 'ready',        label: 'Ready for pickup' },
  { key: 'invoice',      label: 'Invoice sent' },
]
const NOTIFY_PREF_KEY = { rush_approved: 'rush', rush_declined: 'rush' }
export async function updatePartnerNotificationPrefs(partnerId, prefs) {
  if (!partnerId) return { ok: false, error: 'Missing company' }
  const { error } = await supabase.from('partners')
    .update({ notification_prefs: prefs || {}, updated_at: new Date().toISOString() }).eq('id', partnerId)
  return error ? wrapErr(error) : { ok: true }
}

// ── Team names — who at the dealer can be picked as "submitted by" ───────────
// Managed in Trade Settings, rendered as pick-bubbles above Submit. Fetched
// fresh (not from the login context) so names added in Settings show up on the
// order form without a re-login.
export async function getPartnerTeamNames(partnerId) {
  if (!partnerId) return []
  const { data, error } = await supabase.from('partners').select('team_names').eq('id', partnerId).maybeSingle()
  if (error) { console.warn('[trade] team names:', error.message); return [] }
  return Array.isArray(data?.team_names) ? data.team_names.filter(n => typeof n === 'string' && n.trim()) : []
}
export async function updatePartnerTeamNames(partnerId, names) {
  if (!partnerId) return { ok: false, error: 'Missing company' }
  const clean = [...new Set((names || []).map(n => String(n).trim()).filter(Boolean))]
  const { error } = await supabase.from('partners')
    .update({ team_names: clean, updated_at: new Date().toISOString() }).eq('id', partnerId)
  return error ? wrapErr(error) : { ok: true, names: clean }
}

// Build the branded dealer-email HTML from an (editable) subject/body + the
// deep-link button. Shared by the direct send and the previewed send.
export function buildTradeDealerHtml({ subject, body, cta, link }) {
  return (
    `<div style="font-family:Arial,sans-serif;font-size:15px;color:#17202a;line-height:1.6">` +
    `<p style="margin:0 0 4px"><b>${subject}</b></p><p style="margin:0;white-space:pre-wrap">${body}</p>` +
    `<p style="margin:18px 0"><a href="${link}" style="background:#9A7209;color:#ffffff;padding:11px 24px;border-radius:8px;text-decoration:none;font-weight:700">${cta} →</a></p>` +
    `<p style="margin:0;color:#8a8a85;font-size:12.5px">Stonebooks Trade · Shevchenko Monuments</p></div>`
  )
}
// Send a (possibly staff-edited) dealer email draft.
export async function sendTradeDealerEmail({ to, subject, body, cta, link }) {
  if (!to || !String(to).trim()) return { ok: false, error: 'Enter the dealer email.' }
  return sendShopEmail({ to: String(to).trim(), subject, html: buildTradeDealerHtml({ subject, body, cta, link }), text: `${body}\n\n${cta}: ${link}` })
}

// draft:true returns the prepared email WITHOUT sending — the trade board's
// composer shows it for review first (Paul, 2026-07-14: every email previews).
export async function notifyTradeDealer(requestId, kind, { extra = '', draft = false } = {}) {
  try {
    const { data: r } = await supabase.from('vendor_requests')
      .select('id, family_name, dealer_order_number, rush_need_by, partner:partners(id, company_name, email, notification_prefs)')
      .eq('id', requestId).maybeSingle()
    const to = r?.partner?.email
    if (!to) return { ok: false, error: 'No company email on file' }
    // Respect the dealer's Settings toggles (false = muted; absent = on).
    const prefs = r?.partner?.notification_prefs || {}
    const muted = prefs[NOTIFY_PREF_KEY[kind] || kind] === false
    if (muted && !draft) return { ok: true, muted: true }
    const fam = r.family_name || 'your order'
    const num = r.dealer_order_number ? ` (${r.dealer_order_number})` : ''
    const link = `${window.location.origin}/trade?trade=${r.id}`
    const M = {
      placed:        { s: `Order received — ${fam}${num}`,         b: 'We got your order — it’s in our queue for review. You’ll hear from us when it’s accepted.', cta: 'See your order' },
      accepted:      { s: `Order accepted — ${fam}${num}`,        b: 'Your order was accepted and is locked in. We’ll take it from here.', cta: 'See your order' },
      rush_approved: { s: `Rush approved — ${fam}${num}`,          b: `Your rush is approved${r.rush_need_by ? ` — ${r.rush_need_by} is guaranteed` : ''}.`, cta: 'See your order' },
      rush_declined: { s: `Rush update — ${fam}${num}`,            b: 'We couldn’t guarantee the rush date on this one — the order continues on a standard timeline. Reach out and we’ll work out a date.', cta: 'See your order' },
      layout_ready:  { s: `Layout ready to review — ${fam}${num}`, b: 'Your layout is ready. Approve it or request changes with one tap.', cta: 'Review layout' },
      photo:         { s: `Finished stone — ${fam}${num}`,         b: 'A photo of the finished work was added to your order.', cta: 'See finished stone' },
      ready:         { s: `Ready for pickup — ${fam}${num}`,       b: 'Your stone is ready for pickup at the Perth Amboy shop.', cta: 'See your order' },
    }
    const m = M[kind]
    if (!m) return { ok: false, error: `Unknown notify kind ${kind}` }
    const body = `${m.b}${extra ? ` ${extra}` : ''}`
    if (draft) return { ok: true, muted, draft: { to, subject: m.s, body, cta: m.cta, link } }
    await sendShopEmail({ to, subject: m.s, html: buildTradeDealerHtml({ subject: m.s, body, cta: m.cta, link }), text: `${body}\n\n${m.cta}: ${link}` })
    return { ok: true }
  } catch (e) {
    console.warn('[trade] notifyTradeDealer:', e?.message)
    return { ok: false, error: e?.message }
  }
}

// Dealer-facing live tracker — sanitized production steps via the
// trade_tracker SECURITY DEFINER RPC (partners can't read jobs directly).
export async function getTradeTracker(requestId) {
  if (!requestId) return []
  const { data, error } = await supabase.rpc('trade_tracker', { req: requestId })
  if (error) { console.warn('[trade] trade_tracker:', error.message); return [] }
  return Array.isArray(data) ? data : []
}

// Rush decision — ANY staff. Approving guarantees the dealer-written date.
export async function decideTradeRush(requestId, approve, { actor = null } = {}) {
  const r = await updateTradeOrder(requestId, {
    rushStatus: approve ? 'approved' : 'declined',
    rushDecidedBy: actor, rushDecidedAt: new Date().toISOString(),
  })
  if (!r.ok) return r
  await logTradeEvent({ requestId, type: approve ? 'rush_approved' : 'rush_declined', actor,
    detail: approve ? 'Rush approved — date guaranteed' : 'Rush declined' })
  notifyTradeDealer(requestId, approve ? 'rush_approved' : 'rush_declined').catch(() => {})
  return r
}

// ── Portal issues (the Trade Fix tab — problems with the PORTAL, not stones) ─
export async function submitTradeIssue({ partnerId, description, page = null, createdBy = null }) {
  if (!partnerId || !description?.trim()) return { ok: false, error: 'Describe the problem.' }
  const { error } = await supabase.from('trade_issues')
    .insert({ partner_id: partnerId, description: description.trim(), page, created_by: createdBy })
  return error ? wrapErr(error) : { ok: true }
}
export async function listTradeIssues({ partnerId = null, openOnly = false } = {}) {
  let q = supabase.from('trade_issues')
    .select('*, partner:partners(id, company_name)')
    .order('created_at', { ascending: false })
  if (partnerId) q = q.eq('partner_id', partnerId)
  if (openOnly) q = q.eq('status', 'open')
  const { data, error } = await q
  if (error) { console.warn('[trade] listTradeIssues:', error.message); return [] }
  return data || []
}
export async function setTradeIssueStatus(id, status) {
  const { error } = await supabase.from('trade_issues').update({ status }).eq('id', id)
  return error ? wrapErr(error) : { ok: true }
}

// ── Updates feed (staff side) ────────────────────────────────────────────────
// The red badge counts unseen dealer EVENTS + unseen portal ISSUES.
export async function getTradeUpdatesCount() {
  const [{ count: ev, error: e1 }, { count: iss, error: e2 }] = await Promise.all([
    supabase.from('vendor_events').select('id', { count: 'exact', head: true })
      .eq('actor_role', 'partner').is('staff_seen_at', null),
    supabase.from('trade_issues').select('id', { count: 'exact', head: true })
      .is('staff_seen_at', null),
  ])
  if (e1) console.warn('[trade] getTradeUpdatesCount:', e1.message)
  if (e2 && !isMissing(e2.message)) console.warn('[trade] issue count:', e2.message)
  return (ev || 0) + (iss || 0)
}
export async function listTradeUpdates({ limit = 50, unseenOnly = false } = {}) {
  let q = supabase.from('vendor_events')
    .select('*, request:vendor_requests(id, family_name, dealer_order_number, rush, rush_status, rush_need_by, partner_id), partner:partners(id, company_name)')
    .eq('actor_role', 'partner')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (unseenOnly) q = q.is('staff_seen_at', null)
  const { data, error } = await q
  if (error) { console.warn('[trade] listTradeUpdates:', error.message); return [] }
  return data || []
}
export async function markTradeUpdatesSeen() {
  const now = new Date().toISOString()
  const { error } = await supabase.from('vendor_events')
    .update({ staff_seen_at: now })
    .eq('actor_role', 'partner').is('staff_seen_at', null)
  if (error) { console.warn('[trade] markTradeUpdatesSeen:', error.message); return { ok: false } }
  await supabase.from('trade_issues').update({ staff_seen_at: now }).is('staff_seen_at', null)
    .then(() => {}, () => {})
  return { ok: true }
}

// Hard delete (STAFF, archived orders only) — cascades items, attachments
// rows, and events via the V1 FKs. Storage files are left in place (cheap,
// and recoverable if a delete was a mistake).
export async function deleteTradeOrder(requestId) {
  if (!requestId) return { ok: false, error: 'Missing order id' }
  const { error } = await supabase.from('vendor_requests').delete().eq('id', requestId)
  if (error) return wrapErr(error)
  return { ok: true }
}

// ── Slice 5: layouts, signatures, receipts ───────────────────────────────────
// Layout versions V1..Vn via the trade_layouts SECURITY DEFINER RPC (partners
// are RLS-locked out of proof_versions; the RPC ownership-checks and returns
// sanitized rows).
export async function getTradeLayouts(requestId) {
  if (!requestId) return []
  const { data, error } = await supabase.rpc('trade_layouts', { req: requestId })
  if (error) { console.warn('[trade] trade_layouts:', error.message); return [] }
  return Array.isArray(data) ? data : []
}

// Signature PNG (canvas dataURL) → private vendor-files bucket under the
// partner prefix. No attachment row — signatures belong to their receipt /
// approval, not the files list. Returns the storage path.
export async function uploadTradeSignature(partnerId, requestId, dataUrl) {
  try {
    const blob = await (await fetch(dataUrl)).blob()
    const path = `${partnerId || 'unknown'}/${requestId || 'misc'}/sig_${uid()}.png`
    const { error } = await supabase.storage.from('vendor-files').upload(path, blob, { contentType: 'image/png' })
    if (error) return { ok: false, error: error.message }
    return { ok: true, path }
  } catch (e) {
    return { ok: false, error: e?.message || 'Signature upload failed' }
  }
}

// Approve a layout: stamps proof_versions + flips design_phase (one RPC
// transaction), then logs the shared event.
export async function approveTradeLayout(requestId, proofId, { partnerId = null, sigPath = null, approver = null, actorRole = 'partner' } = {}) {
  const { data, error } = await supabase.rpc('trade_approve_layout', {
    req: requestId, proof: proofId, sig_path: sigPath, approver: approver || null,
  })
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'Approval was not recorded — layout not found for this order.' }
  await logTradeEvent({ requestId, partnerId, type: 'layout_approved', actor: approver, actorRole, detail: 'Layout approved & signed' })
  return { ok: true }
}

// Dual-signature receipts (drop-off / pickup). Each call merges one party's
// signature into the receipt jsonb; side effects fire on FIRST signature:
// dropoff → stone arrived, pickup → order completed.
export async function signTradeReceipt(order, kind, { where = null, signerRole = 'staff', signerName = null, sigPath = null } = {}) {
  if (!order?.id || !['dropoff', 'pickup'].includes(kind)) return { ok: false, error: 'Bad receipt call' }
  const col = kind === 'dropoff' ? 'dropoff_receipt' : 'pickup_receipt'
  const existing = order[col] || null
  const receipt = {
    at: existing?.at || new Date().toISOString(),
    where: existing?.where || where || 'Shevchenko shop — Perth Amboy',
    signatures: [
      ...(existing?.signatures || []).filter(s => s.role !== signerRole),
      { role: signerRole, name: signerName || (signerRole === 'partner' ? 'Dealer' : 'Staff'), path: sigPath || null, at: new Date().toISOString() },
    ],
  }
  const first = !existing
  const patch = kind === 'dropoff'
    ? { dropoffReceipt: receipt, ...(first ? { stoneStatus: 'arrived', stoneArrivedAt: receipt.at, stoneDropLocation: receipt.where } : {}) }
    : { pickupReceipt: receipt, ...(first ? { status: 'completed' } : {}) }
  const r = await updateTradeOrder(order.id, patch)
  if (!r.ok) return r
  await logTradeEvent({
    requestId: order.id, partnerId: order.partner_id,
    type: first ? (kind === 'dropoff' ? 'stone_dropped_off' : 'picked_up') : `${kind}_countersigned`,
    detail: first
      ? (kind === 'dropoff' ? `Stone dropped off — ${receipt.where} (signed)` : 'Stone picked up (signed)')
      : `${kind === 'dropoff' ? 'Drop-off' : 'Pickup'} receipt countersigned`,
    actor: signerName, actorRole: signerRole,
  })
  return { ok: true }
}

// ── Slice 8: reusable invite links ───────────────────────────────────────────
// ONE link per company creates unlimited logins; revoke any time. Signup runs
// through the trade-signup Edge Function (service role).
export async function getOrCreatePartnerInvite(partnerId, { createdBy = null } = {}) {
  if (!partnerId) return { ok: false, error: 'Missing company' }
  const { data: existing } = await supabase.from('partner_invites')
    .select('*').eq('partner_id', partnerId).is('revoked_at', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (existing && (!existing.expires_at || new Date(existing.expires_at) > new Date())) {
    return { ok: true, invite: existing, url: `${window.location.origin}/trade?trade_invite=${existing.code}` }
  }
  const { data, error } = await supabase.from('partner_invites')
    .insert({ partner_id: partnerId, created_by: createdBy }).select().single()
  if (error) return wrapErr(error)
  return { ok: true, invite: data, url: `${window.location.origin}/trade?trade_invite=${data.code}` }
}
export async function revokePartnerInvite(inviteId) {
  const { error } = await supabase.from('partner_invites')
    .update({ revoked_at: new Date().toISOString() }).eq('id', inviteId)
  return error ? wrapErr(error) : { ok: true }
}
export async function tradeSignup({ code, email, password, name, phone = null }) {
  const FRIENDLY = {
    invalid_invite: 'This invite link is not valid — ask Shevchenko for a fresh one.',
    invite_revoked: 'This invite link was turned off — ask Shevchenko for a fresh one.',
    invite_expired: 'This invite link expired — ask Shevchenko for a fresh one.',
    email_in_use: 'That email already has a login — sign in instead, or use another email.',
    password_too_short: 'Password needs at least 8 characters.',
    missing_fields: 'Fill in your name, email, and password.',
  }
  try {
    const { data, error } = await supabase.functions.invoke('trade-signup', { body: { code, email, password, name, phone } })
    if (error) {
      // On a non-2xx, functions.invoke hides the body inside error.context —
      // pull the real error code out so the user sees English, not plumbing.
      let code2 = null
      try { const ctx = await error.context?.json?.(); code2 = ctx?.error || null } catch { /* ignore */ }
      return { ok: false, error: FRIENDLY[code2] || code2 || error.message || 'Signup failed.' }
    }
    if (data?.error) return { ok: false, error: FRIENDLY[data.error] || data.error }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || 'Signup failed.' }
  }
}

// ── Slice 7: invoicing ───────────────────────────────────────────────────────
// Total = sum of lines, always (no stored total — honest by construction).
// Dealers see invoices only once SENT (RLS hides drafts). Rush-approved orders
// auto-suggest a rush-fee line the staff can strike before sending.

export async function listTradeInvoices({ partnerId = null } = {}) {
  let q = supabase.from('vendor_invoices')
    .select('*, partner:partners(id, company_name, email), lines:vendor_invoice_lines(*)')
    .order('created_at', { ascending: false })
  if (partnerId) q = q.eq('partner_id', partnerId)
  const { data, error } = await q
  if (error) { console.warn('[trade] listTradeInvoices:', error.message); return [] }
  return (data || []).map(inv => ({
    ...inv,
    total: (inv.lines || []).reduce((s, l) => s + (Number(l.amount) || 0), 0),
  }))
}

// Which of a partner's orders are NOT yet on any non-void invoice.
export async function listUninvoicedTradeOrders(partnerId) {
  if (!partnerId) return []
  const [orders, invs] = await Promise.all([
    listTradeOrders({ partnerId, scope: 'all' }),
    listTradeInvoices({ partnerId }),
  ])
  const invoiced = new Set()
  for (const inv of invs) if (inv.status !== 'void') for (const l of (inv.lines || [])) if (l.request_id) invoiced.add(l.request_id)
  return orders.filter(o => !invoiced.has(o.id))
}

export async function nextTradeInvoiceNumber() {
  const year = new Date().getFullYear()
  const { count } = await supabase.from('vendor_invoices').select('id', { count: 'exact', head: true })
  return `TI-${year}-${String((count || 0) + 1).padStart(3, '0')}`
}

export async function createTradeInvoice({ partnerId, lines = [], notes = null, createdBy = null } = {}) {
  if (!partnerId) return { ok: false, error: 'Pick a company.' }
  const clean = lines.filter(l => l && (l.description || '').trim())
  if (!clean.length) return { ok: false, error: 'Add at least one line.' }
  const invoice_number = await nextTradeInvoiceNumber()
  const { data: inv, error } = await supabase.from('vendor_invoices')
    .insert({ partner_id: partnerId, invoice_number, status: 'draft', notes, created_by: createdBy })
    .select().single()
  if (error) return wrapErr(error)
  const lineRows = clean.map(l => ({
    invoice_id: inv.id, request_id: l.requestId || null,
    description: l.description.trim(), amount: Number(l.amount) || 0,
    is_rush_fee: !!l.isRushFee,
  }))
  const { error: lErr } = await supabase.from('vendor_invoice_lines').insert(lineRows)
  if (lErr) { await supabase.from('vendor_invoices').delete().eq('id', inv.id); return wrapErr(lErr) }
  return { ok: true, invoice: inv }
}

export async function deleteTradeInvoiceLine(lineId) {
  const { error } = await supabase.from('vendor_invoice_lines').delete().eq('id', lineId)
  return error ? wrapErr(error) : { ok: true }
}

// Send: stamp sent, log per-order events, email the dealer the full invoice
// with a deep-link button. Mark paid: stamp + note ("check #2211" / Zelle conf).
export async function setTradeInvoiceStatus(invoiceId, status, { paidNote = null, actor = null } = {}) {
  if (!['sent', 'paid', 'void', 'draft'].includes(status)) return { ok: false, error: 'Bad status' }
  const patch = { status, updated_at: new Date().toISOString() }
  if (status === 'sent') patch.sent_at = new Date().toISOString()
  if (status === 'paid') { patch.paid_at = new Date().toISOString(); patch.paid_note = paidNote }
  const { error } = await supabase.from('vendor_invoices').update(patch).eq('id', invoiceId)
  if (error) return wrapErr(error)

  const { data: inv } = await supabase.from('vendor_invoices')
    .select('*, partner:partners(id, company_name, email, notification_prefs), lines:vendor_invoice_lines(*)')
    .eq('id', invoiceId).maybeSingle()
  if (!inv) return { ok: true }
  const total = (inv.lines || []).reduce((s, l) => s + (Number(l.amount) || 0), 0)
  const evType = status === 'sent' ? 'invoice_sent' : status === 'paid' ? 'invoice_paid' : null
  if (evType) {
    for (const rid of [...new Set((inv.lines || []).map(l => l.request_id).filter(Boolean))]) {
      await logTradeEvent({ requestId: rid, partnerId: inv.partner_id, type: evType, actor, detail: `Invoice ${inv.invoice_number} ${status} — $${total.toLocaleString()}` })
    }
  }
  if (status === 'sent' && inv.partner?.email && (inv.partner?.notification_prefs || {}).invoice !== false) {
    const mail = buildTradeInvoiceEmail(inv)
    sendShopEmail({ to: mail.to, subject: mail.subject, html: mail.html, text: mail.text }).catch(() => {})
  }
  return { ok: true }
}

// The EXACT email a dealer receives for an invoice — one composer shared by
// the sender above and the preview modal (Paul 2026-07-21: a worker one-click
// sent an invoice she didn't mean to; every send now shows THIS first).
export function buildTradeInvoiceEmail(inv) {
  const total = (inv.lines || []).reduce((s, l) => s + (Number(l.amount) || 0), 0)
  // Same table grammar as the PDF: no row rules, every other row lightly shaded.
  const rowsHtml = (inv.lines || []).map((l, i) => {
    const bg = i % 2 === 1 ? 'background:#f2f2f2;' : ''
    return `<tr><td style="padding:6px 10px;${bg}">${l.description}${l.is_rush_fee ? ' <span style="color:#b3261e;font-weight:700">(rush)</span>' : ''}</td>` +
      `<td style="padding:6px 10px;${bg}text-align:right;white-space:nowrap">$${(Number(l.amount) || 0).toLocaleString()}</td></tr>`
  }).join('')
  const link = `${typeof window !== 'undefined' ? window.location.origin : 'https://stonebooks-beta.vercel.app'}/trade?payments=1`
  const html =
    `<div style="font-family:Arial,sans-serif;font-size:15px;color:#17202a;line-height:1.6">` +
    `<p style="margin:0 0 10px"><b>Invoice ${inv.invoice_number} — Shevchenko Monuments</b></p>` +
    `<table style="border-collapse:collapse;width:100%;max-width:520px;font-size:14px">${rowsHtml}` +
    `<tr><td style="padding:8px 10px;font-weight:800">TOTAL</td><td style="padding:8px 10px;text-align:right;font-weight:800">$${total.toLocaleString()}</td></tr></table>` +
    (inv.notes ? `<p style="margin:10px 0 0;color:#555">${inv.notes}</p>` : '') +
    `<p style="margin:14px 0 0;color:#555">Pay by check or Zelle (shevcoteam@gmail.com — memo ${inv.invoice_number}).</p>` +
    `<p style="margin:18px 0"><a href="${link}" style="background:#9A7209;color:#ffffff;padding:11px 24px;border-radius:8px;text-decoration:none;font-weight:700">View in your portal →</a></p>` +
    `<p style="margin:0;color:#8a8a85;font-size:12.5px">Stonebooks Trade · Shevchenko Monuments</p></div>`
  return {
    to: inv.partner?.email || '',
    subject: `Invoice ${inv.invoice_number} — $${total.toLocaleString()} — Shevchenko Monuments`,
    html,
    text: `Invoice ${inv.invoice_number} — total $${total.toLocaleString()}. View it in your portal: ${link}`,
    total,
  }
}

// Invoice as a downloadable PDF — works at ANY status, sent or not (Paul).
// Ink-light per the shop's print doctrine: no solid fills, hairlines only.
let _vjsPDF = null
function _loadJsPDF() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF)
  if (_vjsPDF) return _vjsPDF
  _vjsPDF = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
    s.onload = () => resolve(window.jspdf.jsPDF)
    s.onerror = () => reject(new Error('Could not load the PDF library.'))
    document.head.appendChild(s)
  })
  return _vjsPDF
}
export async function downloadTradeInvoicePdf(inv) {
  const JsPDF = await _loadJsPDF()
  const doc = new JsPDF({ unit: 'mm', format: 'letter' })
  const W = 215.9, M = 18
  const total = (inv.lines || []).reduce((s, l) => s + (Number(l.amount) || 0), 0)
  let y = 22
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(20, 20, 20)
  doc.text('SHEVCHENKO MONUMENTS, LLC.', M, y)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(90, 90, 90)
  y += 5.5; doc.text('329 S Florida Grove Rd, Perth Amboy, NJ 08861 · 732-442-1286 · shevcoteam@gmail.com', M, y)
  y += 4; doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.3); doc.line(M, y, W - M, y)
  y += 10
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(20, 20, 20)
  doc.text(`INVOICE ${inv.invoice_number}`, M, y)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(80, 80, 80)
  doc.text(new Date(inv.created_at || Date.now()).toLocaleDateString(), W - M, y, { align: 'right' })
  y += 7
  doc.text(`Bill to: ${inv.partner?.company_name || '—'}${inv.partner?.email ? ` · ${inv.partner.email}` : ''}`, M, y)
  if (inv.status && inv.status !== 'sent') { y += 5; doc.text(`Status: ${String(inv.status).toUpperCase()}`, M, y) }
  y += 9

  // Line items — the house table style (Paul 2026-07-22, the Hall Monuments
  // invoice): NO divider rules between rows (at this pitch they cut straight
  // through the next row's text) — every other row gets the same neutral-gray
  // wash the contract/estimate tables use, drawn UNDER the text. Simple black
  // and white; header repeats after a page break.
  const itemsHeader = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(90, 90, 90)
    doc.text('DESCRIPTION', M, y)
    doc.text('AMOUNT', W - M, y, { align: 'right' })
    y += 2
    doc.setDrawColor(120, 120, 120); doc.setLineWidth(0.35); doc.line(M, y, W - M, y)
    y += 5.6
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(20, 20, 20)
  }
  itemsHeader()
  let zebra = 0
  for (const l of (inv.lines || [])) {
    const desc = `${l.description}${l.is_rush_fee ? '  (RUSH)' : ''}`
    const lines = doc.splitTextToSize(desc, W - M * 2 - 32)
    const rowH = lines.length * 4.6 + 4.4
    if (y + rowH > 258) { doc.addPage('letter'); y = 22; itemsHeader(); zebra = 0 }
    if (zebra % 2 === 1) {
      doc.setFillColor(237, 237, 237)
      doc.rect(M - 2, y - 3.2, (W - M * 2) + 4, rowH, 'F')
    }
    zebra++
    doc.setTextColor(20, 20, 20)
    doc.text(lines, M, y)
    doc.text(`$${(Number(l.amount) || 0).toLocaleString()}`, W - M, y, { align: 'right' })
    y += rowH
  }
  y += 1.5
  doc.setDrawColor(120, 120, 120); doc.setLineWidth(0.5); doc.line(M, y, W - M, y)
  y += 6
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(20, 20, 20)
  doc.text('TOTAL', M, y)
  doc.text(`$${total.toLocaleString()}`, W - M, y, { align: 'right' })
  y += 9
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(90, 90, 90)
  if (inv.notes) { const nl = doc.splitTextToSize(inv.notes, W - M * 2); doc.text(nl, M, y); y += nl.length * 4.5 + 3 }
  doc.text(`Pay by check or Zelle (shevcoteam@gmail.com) — memo ${inv.invoice_number}.`, M, y)
  y += 5
  doc.text('Stonebooks Trade · Shevchenko Monuments', M, y)
  doc.save(`${inv.invoice_number}.pdf`)
  return true
}

// Per-order activity log — both sides read the same timeline.
export async function listTradeOrderEvents(requestId) {
  if (!requestId) return []
  const { data, error } = await supabase.from('vendor_events')
    .select('*').eq('request_id', requestId).order('created_at', { ascending: false })
  if (error) { console.warn('[trade] listTradeOrderEvents:', error.message); return [] }
  return data || []
}
