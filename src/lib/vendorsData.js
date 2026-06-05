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
import { getCurrentStaffName } from './stonebooksData'

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
  const reqRow = {
    partner_id: input.partnerId,
    request_name: input.requestName?.trim() || null,
    needed_by: input.neededBy || null,
    rush: !!input.rush,
    general_notes: input.generalNotes?.trim() || null,
    status: 'submitted',
    source: input.source === 'partner' ? 'partner' : 'internal',
    created_by: createdBy || null,
  }
  const { data: req, error: reqErr } = await supabase.from('vendor_requests').insert(reqRow).select().single()
  if (reqErr) return wrapErr(reqErr)

  const itemRows = items.map(it => ({
    request_id: req.id,
    work_type: ['design', 'blasting', 'setting', 'other'].includes(it.workType) ? it.workType : 'other',
    vendor_reference: it.vendorReference?.trim() || null,
    stone_size: it.stoneSize?.trim() || null,
    base_size: it.baseSize?.trim() || null,
    color: it.color?.trim() || null,
    cemetery: it.cemetery?.trim() || null,
    deceased_family_name: it.deceasedFamilyName?.trim() || null,
    item_notes: it.itemNotes?.trim() || null,
    status: 'submitted',
  }))
  const { data: created, error: itemErr } = await supabase.from('vendor_items').insert(itemRows).select()
  if (itemErr) return { ok: false, error: `Request created but items failed: ${itemErr.message}`, request: req }

  await supabase.from('vendor_events').insert({
    request_id: req.id, event_type: 'submitted', actor: createdBy || (reqRow.source === 'partner' ? 'Partner' : 'Staff'),
    detail: `${itemRows.length} item${itemRows.length === 1 ? '' : 's'} submitted${reqRow.rush ? ' · RUSH' : ''}`,
  }).select().maybeSingle().then(() => {}, () => {})

  return { ok: true, request: req, items: created || [] }
}

// All items across partners, request + partner + batch joined (Work Queue).
export async function listVendorItems() {
  const { data, error } = await supabase
    .from('vendor_items')
    .select('*, request:vendor_requests(*, partner:partners(*)), batch:vendor_batches(*)')
    .order('updated_at', { ascending: false })
  if (error) { console.warn('[vendors] listVendorItems:', error.message); return [] }
  return data || []
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
    partner_id: input.partnerId, po_number: poNumber, po_date: input.poDate || new Date().toISOString().slice(0, 10),
    status: input.status === 'sent' ? 'sent' : 'draft', notes: input.notes?.trim() || null,
    custom_amount: input.customAmount != null && input.customAmount !== '' ? Number(input.customAmount) : null,
    batch_id: input.batchId || null,
  }).select().single()
  if (error) return wrapErr(error)
  const poItems = (input.poItems || []).filter(Boolean)
  if (poItems.length) {
    const rows = poItems.map(pi => ({ po_id: po.id, item_id: pi.itemId || null, description: pi.description || null, quantity: pi.quantity || 1 }))
    await supabase.from('vendor_po_items').insert(rows)
  }
  if (po.status === 'sent') await addVendorEvent({ requestId: null, itemId: null, eventType: 'email_sent', actor: 'Staff', detail: `PO ${poNumber} sent` })
  return { ok: true, po }
}
export async function updateVendorPO(id, patch = {}) {
  if (!id) return { ok: false, error: 'Missing id' }
  const row = {}
  if (patch.status !== undefined) row.status = patch.status
  if (patch.notes !== undefined) row.notes = patch.notes?.trim() || null
  if (patch.customAmount !== undefined) row.custom_amount = patch.customAmount === '' ? null : Number(patch.customAmount)
  const { error } = await supabase.from('vendor_pos').update(row).eq('id', id)
  if (error) return wrapErr(error)
  return { ok: true }
}
