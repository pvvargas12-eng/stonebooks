// =============================================================================
// Permit Builder engine (PB-1, 2026-07-21)
// =============================================================================
// Cemetery permit forms are the most time-consuming paperwork in the shop
// (Paul). This module is the non-UI half of the builder:
//   - CRUD for permit_templates (one per cemetery form) + permit_docs (one per
//     built permit for an order)
//   - blank-form ingestion: image upload straight to Storage; PDFs rasterized
//     in the browser via CDN pdf.js first
//   - autofill: a registry of resolvable sources (customer / deceased / plot /
//     stone specs / dates / company block) evaluated against the full order row
//   - PDF export via CDN jsPDF: template page images as the background, text
//     boxes on top, the layout image clipped to its crop frame, dimension
//     arrows with labels, optional blank back page for the layout
// GEOMETRY CONTRACT: every x/y/w/h and font size is a FRACTION of the page
// image (sizePct = fraction of page WIDTH), so the editor canvas and the PDF
// resolve pixel-identically at any render size.
// =============================================================================
import { supabase } from './supabase'

const BUCKET = 'orders-attachments-public'

// Company letterhead constants — mirrors SalesMode's COMPANY_INFO (module-local
// there; keep in sync if the shop moves).
export const PERMIT_COMPANY = {
  name: 'Shevchenko Monuments LLC',
  address: '329 S Florida Grove Rd',
  city: 'Perth Amboy, NJ 08861',
  phone: '732-442-1286',
  fax: '732-697-0418',
  email: 'shevcoteam@gmail.com',
}

// ── CRUD — templates ────────────────────────────────────────────────────────

export async function listPermitTemplates({ includeArchived = false } = {}) {
  let q = supabase.from('permit_templates')
    .select('*, cemetery:cemeteries(id, name)')
    .order('updated_at', { ascending: false })
  if (!includeArchived) q = q.eq('archived', false)
  const { data, error } = await q
  if (error) { console.warn('[permit] listPermitTemplates:', error.message); return [] }
  return data || []
}

export async function getPermitTemplate(id) {
  if (!id) return null
  const { data, error } = await supabase.from('permit_templates')
    .select('*, cemetery:cemeteries(id, name)').eq('id', id).single()
  if (error) { console.warn('[permit] getPermitTemplate:', error.message); return null }
  return data
}

export async function createPermitTemplate({ cemeteryId = null, title }) {
  const t = (title || '').trim()
  if (!t) return { ok: false, error: 'Name the template.' }
  const { data, error } = await supabase.from('permit_templates')
    .insert({ cemetery_id: cemeteryId, title: t }).select().single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, template: data }
}

export async function updatePermitTemplate(id, patch) {
  if (!id) return { ok: false, error: 'Missing template id' }
  const row = { updated_at: new Date().toISOString() }
  if ('title' in patch)      row.title = (patch.title || '').trim() || 'Untitled permit'
  if ('cemeteryId' in patch) row.cemetery_id = patch.cemeteryId || null
  if ('pages' in patch)      row.pages = patch.pages || []
  if ('fields' in patch)     row.fields = patch.fields || []
  if ('layoutSlot' in patch) row.layout_slot = patch.layoutSlot || null
  if ('notes' in patch)      row.notes = patch.notes || null
  if ('archived' in patch)   row.archived = !!patch.archived
  const { error } = await supabase.from('permit_templates').update(row).eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ── CRUD — docs ─────────────────────────────────────────────────────────────

// Full order row — the doc editor's right rail shows EVERYTHING (Paul: "all
// the order information... attachments email traffic stone size layout").
const DOC_EMBED = '*, template:permit_templates(id, title, pages, fields, layout_slot), order:orders(*, customer:customers(*), cemetery:cemeteries(*))'

// Side context for the rail: attachments + recent email traffic. Fail-soft.
export async function getOrderContext(orderId, customerId) {
  const [att, em] = await Promise.all([
    orderId
      ? supabase.from('order_attachments')
          .select('id, category, file_url, filename, mime_type, created_at')
          .eq('order_id', orderId).order('created_at', { ascending: false }).limit(30)
      : Promise.resolve({ data: [] }),
    customerId
      ? supabase.from('order_emails')
          .select('id, direction, from_email, subject, snippet, sent_at, created_at')
          .eq('customer_id', customerId).order('created_at', { ascending: false }).limit(8)
      : Promise.resolve({ data: [] }),
  ])
  return { attachments: att?.data || [], emails: em?.data || [] }
}

// Attach the built permit PDF to its order (Paul 2026-07-22: "when you build it
// it will go in the attachment for that order"). Stable storage path per doc so
// a rebuilt permit REPLACES its attachment instead of stacking copies; the
// order_attachments row is upserted to match (storage feeds OrderDetail's list,
// the table feeds this tab's own Order info panel).
export async function attachPermitPdfToOrder(doc, pdfBlob, staffName = null) {
  const orderId = doc?.order_id || doc?.order?.id
  if (!orderId || !pdfBlob) return { ok: false, error: 'This permit has no order.' }
  const path = `attachments/${orderId}/permit-${doc.id}.pdf`
  const name = `Permit - ${(doc.title || 'permit').replace(/[^\w .()-]+/g, '').trim() || 'permit'}.pdf`
  const { error } = await supabase.storage.from('orders-attachments-public')
    .upload(path, pdfBlob, { upsert: true, contentType: 'application/pdf' })
  if (error) return { ok: false, error: error.message }
  const { data: pub } = supabase.storage.from('orders-attachments-public').getPublicUrl(path)
  const url = `${pub.publicUrl}?v=${Date.now()}`
  const { data: existing } = await supabase.from('order_attachments')
    .select('id').eq('order_id', orderId).eq('storage_path', path).maybeSingle()
  if (existing?.id) {
    await supabase.from('order_attachments')
      .update({ file_url: url, filename: name, size_bytes: pdfBlob.size ?? null })
      .eq('id', existing.id)
  } else {
    await supabase.from('order_attachments').insert({
      order_id: orderId, category: 'permit', storage_path: path,
      file_url: url, filename: name, mime_type: 'application/pdf',
      size_bytes: pdfBlob.size ?? null, uploaded_by: staffName,
    })
  }
  return { ok: true, url, name }
}

export async function listPermitDocs({ orderId = null, limit = 30 } = {}) {
  let q = supabase.from('permit_docs')
    .select(DOC_EMBED)
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (orderId) q = q.eq('order_id', orderId)
  const { data, error } = await q
  if (error) { console.warn('[permit] listPermitDocs:', error.message); return [] }
  return data || []
}

export async function getPermitDoc(id) {
  if (!id) return null
  const { data, error } = await supabase.from('permit_docs').select(DOC_EMBED).eq('id', id).single()
  if (error) { console.warn('[permit] getPermitDoc:', error.message); return null }
  return data
}

export async function createPermitDoc({ orderId, templateId, cemeteryId = null, title, data: docData }) {
  if (!orderId) return { ok: false, error: 'Missing order' }
  const { data, error } = await supabase.from('permit_docs')
    .insert({
      order_id: orderId, template_id: templateId || null, cemetery_id: cemeteryId,
      title: (title || '').trim() || null, data: docData || {},
    }).select().single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, doc: data }
}

export async function updatePermitDoc(id, docData, title) {
  if (!id) return { ok: false, error: 'Missing doc id' }
  const row = { data: docData || {}, updated_at: new Date().toISOString() }
  if (title !== undefined) row.title = (title || '').trim() || null
  const { error } = await supabase.from('permit_docs').update(row).eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function deletePermitDoc(id) {
  if (!id) return { ok: false, error: 'Missing doc id' }
  // The built PDF was attached to the order (attachPermitPdfToOrder's stable
  // path) — a deleted permit must not leave its ghost in the attachments list.
  // Best-effort: the doc delete itself is the operation that must succeed.
  try {
    const { data: doc } = await supabase.from('permit_docs').select('order_id').eq('id', id).maybeSingle()
    if (doc?.order_id) {
      const path = `attachments/${doc.order_id}/permit-${id}.pdf`
      await supabase.from('order_attachments').delete().eq('order_id', doc.order_id).eq('storage_path', path)
      await supabase.storage.from(BUCKET).remove([path])
    }
  } catch { /* attachment cleanup is best-effort */ }
  const { error } = await supabase.from('permit_docs').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ── Storage uploads ─────────────────────────────────────────────────────────

export async function uploadPermitAsset(prefix, blob, name) {
  const path = `${prefix}/${Date.now()}-${(name || 'page.png').replace(/[^\w.-]+/g, '_')}`
  const { error } = await supabase.storage.from(BUCKET)
    .upload(path, blob, { upsert: false, contentType: blob.type || 'image/png' })
  if (error) return { ok: false, error: error.message }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return { ok: true, url: data?.publicUrl, path }
}

// Read an image file/blob's natural size (for aspect-true placement).
export function readImageSize(url) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = url
  })
}

// ── pdf.js — rasterize an uploaded PDF's pages to PNG blobs ─────────────────
// CDN-loaded on first use, same pattern as jsPDF. ~200 DPI for letter scans.

let _pdfjsPromise = null
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib)
  if (_pdfjsPromise) return _pdfjsPromise
  _pdfjsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
    s.onload = () => {
      try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
        resolve(window.pdfjsLib)
      } catch (e) { reject(e) }
    }
    s.onerror = () => reject(new Error('Could not load the PDF reader.'))
    document.head.appendChild(s)
  })
  return _pdfjsPromise
}

// Near-blank detection: duplex scanners tack an empty back page onto almost
// every one-sided form (the 2026-07-22 audit found 13 of them in Paul's
// permit zips). Sample the render small; if under 0.2% of pixels carry any
// ink, the page is a scan back — skip it rather than shipping a blank page
// into the template.
function _canvasIsBlank(canvas) {
  try {
    const s = document.createElement('canvas')
    const sw = 120, sh = Math.max(1, Math.round(120 * canvas.height / canvas.width))
    s.width = sw; s.height = sh
    const ctx = s.getContext('2d')
    ctx.drawImage(canvas, 0, 0, sw, sh)
    const d = ctx.getImageData(0, 0, sw, sh).data
    let ink = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235) ink++
    }
    return ink / (sw * sh) < 0.002
  } catch { return false }   // when in doubt, keep the page
}

export async function rasterizePdfFile(file, { maxPages = 12, targetWidth = 1700, skipBlank = true } = {}) {
  const pdfjs = await loadPdfJs()
  const buf = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: buf }).promise
  const n = Math.min(pdf.numPages, maxPages)
  const out = []
  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i)
    const base = page.getViewport({ scale: 1 })
    const scale = targetWidth / base.width
    const vp = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(vp.width)
    canvas.height = Math.round(vp.height)
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
    if (skipBlank && n > 1 && _canvasIsBlank(canvas)) continue
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'))
    if (blob) out.push({ blob, w: canvas.width, h: canvas.height })
  }
  if (pdf.numPages > maxPages) out.truncatedFrom = pdf.numPages
  return out
}

// ── Autofill registry ───────────────────────────────────────────────────────
// Every source resolves best-effort against the FULL order row (customer +
// cemetery embedded). Missing data resolves to '' — the box stays editable.

const _dec = (order) => Array.isArray(order?.deceased) ? order.deceased : []
const _decName = (p) => [p?.firstName || p?.first_name, p?.lastName || p?.last_name].filter(Boolean).join(' ').trim()
// Trade notation — the way Paul writes stone sizes on every permit: 45" → 3-9
// (feet-inches), 4" → 0-4. Bronze plaques stay plain inches (24 x 12) via _dimsIn.
const _trade = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  return `${Math.floor(n / 12)}-${Math.round(n % 12)}`
}
const _dimParts = (c) => {
  if (!c) return []
  const w = c.width ?? c.w, h = c.height ?? c.h, d = c.depth ?? c.d
  return [w, h, d].filter(v => v !== null && v !== undefined && v !== '')
}
const _dims = (c) => _dimParts(c).map(_trade).join(' x ')
const _dimsIn = (c) => _dimParts(c).join(' x ')
const _custAddr = (c) => [c?.address || c?.address_line1 || c?.street, [c?.city, c?.state].filter(Boolean).join(', '), c?.zip || c?.zip_code].filter(Boolean).join(', ')
// Footprint (length x width) of whatever meets the foundation: the base when
// one exists, else the die itself (slants/markers set without a base).
const _footprint = (o, fmt) => {
  const pick = (c) => {
    if (!c) return ''
    const w = c.width ?? c.w, d = c.depth ?? c.d
    if (w == null || w === '' || d == null || d === '') return ''
    return `${fmt(w)} x ${fmt(d)}`
  }
  return pick(o?.base_config || o?.baseConfig) || pick(o?.die_config || o?.dieConfig)
}
const _todayUS = () => {
  const d = new Date()
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
}

export const AUTOFILL_FIELDS = [
  { key: 'customer_name',    label: 'Customer name',      resolve: (o) => [o?.customer?.first_name, o?.customer?.last_name].filter(Boolean).join(' ') || o?.primary_lastname || '' },
  { key: 'customer_phone',   label: 'Customer phone',     resolve: (o) => o?.customer?.phone_primary || o?.customer?.phone || '' },
  { key: 'customer_email',   label: 'Customer email',     resolve: (o) => o?.customer?.email || '' },
  { key: 'customer_address', label: 'Customer address',   resolve: (o) => _custAddr(o?.customer) },
  { key: 'deceased_name',    label: 'Deceased name',      resolve: (o) => _decName(_dec(o)[0]) || o?.primary_lastname || '' },
  { key: 'deceased_names',   label: 'All deceased names', resolve: (o) => _dec(o).map(_decName).filter(Boolean).join(' / ') },
  { key: 'family_lastname',  label: 'Family last name',   resolve: (o) => o?.primary_lastname || o?.customer?.last_name || '' },
  { key: 'cemetery_name',    label: 'Cemetery',           resolve: (o) => o?.cemetery?.name || '' },
  { key: 'cemetery_address', label: 'Cemetery address',   resolve: (o) => [o?.cemetery?.address, [o?.cemetery?.city, o?.cemetery?.state].filter(Boolean).join(', '), o?.cemetery?.zip].filter(Boolean).join(', ') },
  { key: 'plot_section',     label: 'Section',            resolve: (o) => o?.plot_section || '' },
  { key: 'plot_block',       label: 'Block',              resolve: (o) => o?.plot_block || '' },
  { key: 'plot_lot',         label: 'Lot',                resolve: (o) => o?.plot_lot || '' },
  { key: 'plot_row',         label: 'Row',                resolve: (o) => o?.plot_row || '' },
  { key: 'plot_grave',       label: 'Grave',              resolve: (o) => o?.plot_grave || o?.plot_space || '' },
  { key: 'grave_location',   label: 'Grave location (full)', resolve: (o) => o?.grave_location || [o?.plot_section && `Sec ${o.plot_section}`, o?.plot_block && `Blk ${o.plot_block}`, o?.plot_lot && `Lot ${o.plot_lot}`, o?.plot_grave && `Gr ${o.plot_grave}`].filter(Boolean).join(' · ') },
  { key: 'die_size',         label: 'Die size (3-9 x 1-4)',  resolve: (o) => _dims(o?.die_config || o?.dieConfig) },
  { key: 'base_size',        label: 'Base size (4-0 x 1-6)', resolve: (o) => _dims(o?.base_config || o?.baseConfig) },
  // Foundation footprint (Paul 2026-07-22): length x width OF THE BASE — and a
  // slant with no base sits straight on the foundation, so fall back to the
  // die's own footprint. Trade notation + a plain-inches variant.
  { key: 'foundation_size',    label: 'Foundation size (3-6 x 1-2)',    resolve: (o) => _footprint(o, _trade) },
  { key: 'foundation_size_in', label: 'Foundation size inches (42 x 14)', resolve: (o) => _footprint(o, (v) => v) },
  { key: 'die_size_in',      label: 'Die size in inches (24 x 12)', resolve: (o) => _dimsIn(o?.die_config || o?.dieConfig) },
  { key: 'die_shape',        label: 'Die size + shape',   resolve: (o) => [_dims(o?.die_config || o?.dieConfig), o?.shape].filter(Boolean).join(' ') },
  { key: 'base_line',        label: 'Base + size',        resolve: (o) => { const b = _dims(o?.base_config || o?.baseConfig); return b ? `Base ${b}` : '' } },
  { key: 'monument_full',    label: 'Monument description (full)', resolve: (o) => {
      const die = _dims(o?.die_config || o?.dieConfig), base = _dims(o?.base_config || o?.baseConfig)
      return [[o?.shape, o?.granite_color].filter(Boolean).join(', '), die && `die ${die}`, base && `base ${base}`].filter(Boolean).join(' — ')
    } },
  { key: 'deceased_grave',   label: 'Deceased + grave location', resolve: (o) => {
      const name = _decName(_dec(o)[0]) || o?.primary_lastname || ''
      const loc = o?.grave_location || [o?.plot_block && `Block ${o.plot_block}`, o?.plot_section && `Section ${o.plot_section}`, o?.plot_row && `Row ${o.plot_row}`, o?.plot_lot && `Lot ${o.plot_lot}`, o?.plot_grave && `Grave ${o.plot_grave}`].filter(Boolean).join(' ')
      return [name, loc].filter(Boolean).join(' - ')
    } },
  { key: 'monument_desc',    label: 'Monument (shape + color)', resolve: (o) => [o?.shape, o?.granite_color].filter(Boolean).join(', ') },
  { key: 'granite_color',    label: 'Granite color',      resolve: (o) => o?.granite_color || '' },
  { key: 'shape',            label: 'Shape / style',      resolve: (o) => o?.shape || '' },
  { key: 'order_number',     label: 'Order number',       resolve: (o) => o?.order_number || '' },
  { key: 'sales_rep',        label: 'Sales rep',          resolve: (o) => o?.sales_rep || o?.salesRep || '' },
  { key: 'today_date',       label: "Today's date",       resolve: () => _todayUS() },
  { key: 'company_name',     label: 'Company name',       resolve: () => PERMIT_COMPANY.name },
  { key: 'company_address',  label: 'Company address',    resolve: () => `${PERMIT_COMPANY.address}, ${PERMIT_COMPANY.city}` },
  { key: 'company_phone',    label: 'Company phone',      resolve: () => PERMIT_COMPANY.phone },
  { key: 'company_fax',      label: 'Company fax',        resolve: () => PERMIT_COMPANY.fax },
  { key: 'company_email',    label: 'Company email',      resolve: () => PERMIT_COMPANY.email },
  // Split single dimensions — forms like St. Gertrude ask Width / Thickness /
  // Height as separate boxes. Trade notation (45" → 3-9).
  { key: 'die_width',        label: 'Die width',          resolve: (o) => { const c = o?.die_config || o?.dieConfig; const v = c?.width ?? c?.w; return v != null && v !== '' ? _trade(v) : '' } },
  { key: 'die_height',       label: 'Die height',         resolve: (o) => { const c = o?.die_config || o?.dieConfig; const v = c?.height ?? c?.h; return v != null && v !== '' ? _trade(v) : '' } },
  { key: 'die_thickness',    label: 'Die thickness',      resolve: (o) => { const c = o?.die_config || o?.dieConfig; const v = c?.depth ?? c?.d; return v != null && v !== '' ? _trade(v) : '' } },
  { key: 'base_width',       label: 'Base width',         resolve: (o) => { const c = o?.base_config || o?.baseConfig; const v = c?.width ?? c?.w; return v != null && v !== '' ? _trade(v) : '' } },
  { key: 'base_height',      label: 'Base height',        resolve: (o) => { const c = o?.base_config || o?.baseConfig; const v = c?.height ?? c?.h; return v != null && v !== '' ? _trade(v) : '' } },
  { key: 'base_thickness',   label: 'Base thickness',     resolve: (o) => { const c = o?.base_config || o?.baseConfig; const v = c?.depth ?? c?.d; return v != null && v !== '' ? _trade(v) : '' } },
  { key: 'see_reverse',      label: '"See reverse" (fixed)', resolve: () => 'See reverse' },
  { key: 'bronze_mfr',       label: 'Bronze manufacturer',   resolve: () => 'Coldspring' },
  { key: 'bronze_mfr_addr',  label: 'Bronze mfr address',    resolve: () => 'Coldspring, MN' },
  { key: 'polish_level',     label: 'Finish / polish level', resolve: (o) => o?.polish_level || o?.polishLevel || '' },
  // Inch singles — Beth Israel's Foundation Order wants LENGTH/WIDTH/HEIGHT
  // "in inches" per piece (their LENGTH = our width, their WIDTH = thickness).
  { key: 'die_w_in',         label: 'Die length in inches',   resolve: (o) => { const c = o?.die_config || o?.dieConfig; const v = c?.width ?? c?.w; return v ?? '' } },
  { key: 'die_t_in',         label: 'Die width/thick inches', resolve: (o) => { const c = o?.die_config || o?.dieConfig; const v = c?.depth ?? c?.d; return v ?? '' } },
  { key: 'die_h_in',         label: 'Die height in inches',   resolve: (o) => { const c = o?.die_config || o?.dieConfig; const v = c?.height ?? c?.h; return v ?? '' } },
  { key: 'base_w_in',        label: 'Base length in inches',  resolve: (o) => { const c = o?.base_config || o?.baseConfig; const v = c?.width ?? c?.w; return v ?? '' } },
  { key: 'base_t_in',        label: 'Base width/thick inches', resolve: (o) => { const c = o?.base_config || o?.baseConfig; const v = c?.depth ?? c?.d; return v ?? '' } },
  { key: 'base_h_in',        label: 'Base height in inches',  resolve: (o) => { const c = o?.base_config || o?.baseConfig; const v = c?.height ?? c?.h; return v ?? '' } },
  { key: 'deceased_dod',     label: 'Date of death',      resolve: (o) => { const p = _dec(o)[0]; return p?.dateOfDeath || p?.date_of_death || p?.deathDate || '' } },
  { key: 'customer_street',  label: 'Customer street',    resolve: (o) => o?.customer?.address || o?.customer?.address_line1 || o?.customer?.street || '' },
  { key: 'customer_city',    label: 'Customer city',      resolve: (o) => o?.customer?.city || '' },
  { key: 'customer_state',   label: 'Customer state',     resolve: (o) => o?.customer?.state || '' },
  { key: 'customer_zip',     label: 'Customer zip',       resolve: (o) => o?.customer?.zip || o?.customer?.zip_code || '' },
  { key: 'custom',           label: 'Custom text',        resolve: () => '' },
]
const AUTOFILL_BY_KEY = new Map(AUTOFILL_FIELDS.map(f => [f.key, f]))
export function autofillValue(key, order) {
  const f = AUTOFILL_BY_KEY.get(key)
  if (!f) return ''
  try { return f.resolve(order) || '' } catch { return '' }
}

// Seed a fresh doc's data from a template + order. Field kinds (PB-3):
//   'text' (default) — autofill-resolved from the bound key
//   'fixed'          — the template's own typed text ("some things never
//                      change" — Paul), still editable per-permit
//   'check'          — a checkmark spot; click toggles it on the permit
export function seedDocData(template, order) {
  const values = {}
  for (const f of (template?.fields || [])) {
    if (f.kind === 'check')      values[f.id] = { on: !!f.on }
    else if (f.kind === 'fixed') values[f.id] = { text: f.text || '' }
    else                         values[f.id] = { text: autofillValue(f.key, order) }
  }
  return { values, extras: [], layout: null, dims: [] }
}

// Merge a template field with its instance override for render/export.
export function effectiveBox(field, override) {
  return {
    id: field.id, page: field.page,
    kind:    field.kind || 'text',
    mark:    override?.mark ?? field.mark ?? 'check',
    on:      override?.on !== undefined ? !!override.on : !!field.on,
    text:    override?.text !== undefined ? override.text : (field.kind === 'fixed' ? (field.text || '') : ''),
    x:       override?.x       ?? field.x,
    y:       override?.y       ?? field.y,
    w:       override?.w       ?? field.w,
    h:       override?.h       ?? field.h,
    sizePct: override?.sizePct ?? field.sizePct ?? 0.016,
    align:   override?.align   ?? field.align ?? 'left',
    bold:    override?.bold    ?? field.bold ?? false,
    hidden:  !!override?.hidden,
  }
}

// The "ask me for what you don't have" list (PB-3, Paul): template fields that
// are DATA-bound but resolved empty for this order. Company constants, dates,
// fixed text, checks, and custom boxes don't count — they're not order data.
const MISSING_EXEMPT = new Set(['custom', 'see_reverse', 'today_date',
  'company_name', 'company_address', 'company_phone', 'company_fax', 'company_email',
  'bronze_mfr', 'bronze_mfr_addr'])
export function missingAutofill(template, values) {
  const out = []
  for (const f of (template?.fields || [])) {
    if ((f.kind || 'text') !== 'text') continue
    if (MISSING_EXEMPT.has(f.key)) continue
    const text = values?.[f.id]?.text
    if (text === undefined || String(text).trim() !== '') continue
    if (out.some(m => m.key === f.key)) continue
    out.push({ id: f.id, key: f.key, label: AUTOFILL_BY_KEY.get(f.key)?.label || f.key })
  }
  return out
}
// Plot fields write BACK to the order when filled from the checklist, so the
// next permit (and the whole app) knows them.
export const MISSING_ORDER_WRITEBACK = {
  plot_section: 'plot_section', plot_block: 'plot_block', plot_lot: 'plot_lot',
  plot_row: 'plot_row', plot_grave: 'plot_grave', grave_location: 'grave_location',
}

// ── jsPDF export ────────────────────────────────────────────────────────────

let _jsPDFPromise = null
function loadJsPDF() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF)
  if (_jsPDFPromise) return _jsPDFPromise
  _jsPDFPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
    s.onload = () => resolve(window.jspdf.jsPDF)
    s.onerror = () => reject(new Error('Could not load the PDF library.'))
    document.head.appendChild(s)
  })
  return _jsPDFPromise
}

async function fetchAsDataUrl(url) {
  const res = await fetch(url)
  const blob = await res.blob()
  return await new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}
const _imgFmt = (dataUrl) => dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG'

const LETTER = { w: 215.9, h: 279.4 }   // mm, portrait
const MM_TO_PT = 72 / 25.4

// Page transform: CONTAIN the page image in the letter sheet (scans are letter
// forms, so this is full-bleed in practice), centered.
function pageTransform(pageMeta) {
  const pw = pageMeta?.w || 1700, ph = pageMeta?.h || 2200
  const s = Math.min(LETTER.w / pw, LETTER.h / ph)
  const w = pw * s, h = ph * s
  return { x: (LETTER.w - w) / 2, y: (LETTER.h - h) / 2, w, h }
}

function drawBox(doc, t, box) {
  if (box.hidden) return
  // Checkmark spots — vector-drawn (WinAnsi fonts have no U+2713 glyph).
  if (box.kind === 'check') {
    if (!box.on) return
    const cx = t.x + box.x * t.w
    const cy = t.y + box.y * t.h
    const s = Math.max(2.5, Math.min(box.w * t.w, box.h * t.h))
    doc.setDrawColor(20, 20, 20)
    doc.setLineWidth(0.55)
    if (box.mark === 'x') {
      doc.line(cx, cy, cx + s, cy + s)
      doc.line(cx + s, cy, cx, cy + s)
    } else {
      doc.line(cx, cy + s * 0.55, cx + s * 0.35, cy + s * 0.9)
      doc.line(cx + s * 0.35, cy + s * 0.9, cx + s, cy + s * 0.1)
    }
    return
  }
  if (!(box.text || '').trim()) return
  const x = t.x + box.x * t.w
  const y = t.y + box.y * t.h
  const wmm = Math.max(4, box.w * t.w)
  const pt = Math.max(5, box.sizePct * t.w * MM_TO_PT)
  doc.setFont('helvetica', box.bold ? 'bold' : 'normal')
  doc.setFontSize(pt)
  doc.setTextColor(20, 20, 20)
  const lines = doc.splitTextToSize(String(box.text), wmm)
  if (box.align === 'center') {
    doc.text(lines, x + wmm / 2, y, { baseline: 'top', align: 'center' })
  } else {
    doc.text(lines, x, y, { baseline: 'top' })
  }
}

function drawLayoutImage(doc, t, layout, dataUrl) {
  const f = layout.frame
  const fx = t.x + f.x * t.w, fy = t.y + f.y * t.h
  const fw = f.w * t.w, fh = f.h * t.h
  const scale = layout.img?.scale ?? 1
  const iw = fw * scale
  const ih = iw * ((layout.ih || 1) / (layout.iw || 1))
  const ix = fx + (layout.img?.ox ?? 0) * fw
  const iy = fy + (layout.img?.oy ?? 0) * fh
  doc.saveGraphicsState()
  doc.rect(fx, fy, fw, fh)
  doc.clip()
  doc.discardPath()
  doc.addImage(dataUrl, _imgFmt(dataUrl), ix, iy, iw, ih)
  doc.restoreGraphicsState()
}

function drawDim(doc, t, d) {
  const x1 = t.x + d.x1 * t.w, y1 = t.y + d.y1 * t.h
  const x2 = t.x + d.x2 * t.w, y2 = t.y + d.y2 * t.h
  const ang = Math.atan2(y2 - y1, x2 - x1)
  const AH = 2.6   // arrowhead length mm
  const AW = 1.1   // arrowhead half-width mm
  doc.setDrawColor(30, 30, 30)
  doc.setLineWidth(0.35)
  doc.line(x1, y1, x2, y2)
  const head = (x, y, a) => {
    const bx = x + AH * Math.cos(a), by = y + AH * Math.sin(a)
    const px = AW * Math.cos(a + Math.PI / 2), py = AW * Math.sin(a + Math.PI / 2)
    doc.setFillColor(30, 30, 30)
    doc.triangle(x, y, bx + px, by + py, bx - px, by - py, 'F')
  }
  head(x1, y1, ang)
  head(x2, y2, ang + Math.PI)
  const label = (d.label || '').trim()
  if (label) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    const wmm = doc.getTextWidth(label) + 2.4
    doc.setFillColor(255, 255, 255)
    doc.rect(mx - wmm / 2, my - 2.4, wmm, 4.8, 'F')
    doc.setTextColor(20, 20, 20)
    doc.text(label, mx, my, { align: 'center', baseline: 'middle' })
  }
}

// Export the built permit. template.pages drive the page count; layout mode
// 'back' appends a blank page carrying the layout + its dims.
export async function exportPermitPdf({ template, docData, filename = 'permit.pdf', returnDoc = false }) {
  const JsPDF = await loadJsPDF()
  const doc = new JsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  const pages = template?.pages || []
  const values = docData?.values || {}
  const extras = docData?.extras || []
  const layout = docData?.layout || null
  const dims = docData?.dims || []

  // Pre-fetch images (page backgrounds + layout) as data URLs.
  const pageData = []
  for (const p of pages) pageData.push(p?.url ? await fetchAsDataUrl(p.url) : null)
  const layoutData = layout?.src ? await fetchAsDataUrl(layout.src) : null

  const fieldsByPage = new Map()
  for (const f of (template?.fields || [])) {
    const box = effectiveBox(f, values[f.id])
    if (!fieldsByPage.has(f.page)) fieldsByPage.set(f.page, [])
    fieldsByPage.get(f.page).push(box)
  }
  for (const ex of extras) {
    if (ex.page === 'back') continue
    if (!fieldsByPage.has(ex.page)) fieldsByPage.set(ex.page, [])
    fieldsByPage.get(ex.page).push({ ...ex, hidden: false })
  }

  pages.forEach((p, i) => {
    if (i > 0) doc.addPage('letter', 'portrait')
    const t = pageTransform(p)
    if (pageData[i]) doc.addImage(pageData[i], _imgFmt(pageData[i]), t.x, t.y, t.w, t.h)
    for (const box of (fieldsByPage.get(i) || [])) drawBox(doc, t, box)
    if (layout && layoutData && layout.frame && layout.frame.page === i) drawLayoutImage(doc, t, layout, layoutData)
    for (const d of dims.filter(d => d.page === i)) drawDim(doc, t, d)
  })

  // Back page — blank letter sheet, ink-light header, the layout large.
  if (layout && layoutData && layout.frame && layout.frame.page === 'back') {
    doc.addPage('letter', 'portrait')
    const t = { x: 0, y: 0, w: LETTER.w, h: LETTER.h }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(60, 60, 60)
    doc.text('MONUMENT LAYOUT', LETTER.w / 2, 12, { align: 'center' })
    doc.setDrawColor(150, 150, 150)
    doc.setLineWidth(0.2)
    doc.line(20, 15, LETTER.w - 20, 15)
    drawLayoutImage(doc, t, layout, layoutData)
    for (const ex of extras.filter(e => e.page === 'back')) drawBox(doc, t, { ...ex, hidden: false })
    for (const d of dims.filter(d => d.page === 'back')) drawDim(doc, t, d)
  }

  if (returnDoc) return doc
  doc.save(filename)
  return true
}
