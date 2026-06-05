// =============================================================================
// 📚 Stonebooks — Vendors tab (internal staff). PHASE 2.
// =============================================================================
// Sub-nav: Work Queue | Batches | Partners | POs. The Work Queue is the main
// operating screen; New Request (internal) uses the SAME createVendorRequest as
// the future partner portal, so both land here. Item drawer = full edit + status
// + files/photos + request-info email + timeline. Batches group items + generate
// a simple PO. Partner-facing emails route through a reviewable composer.
// =============================================================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { fmtDate, getCurrentStaffName, sendOrderEmail } from './lib/stonebooksData'
import {
  listPartners, createPartner, updatePartner,
  listVendorItems, getVendorItem, createVendorRequest, updateVendorRequest, updateVendorItem,
  addVendorItem, deleteVendorItem, duplicateVendorItem,
  uploadVendorFile, listVendorAttachments, vendorFileSignedUrl, addVendorEvent, listVendorEvents,
  listVendorBatches, createVendorBatch, updateVendorBatch, setItemBatch,
  listVendorPOs, createVendorPO, updateVendorPO, nextPONumber,
  invitePartnerUser, listPartnerUsers,
} from './lib/vendorsData'
import VendorItemCard, { VENDOR_ITEM_CARD_CSS } from './components/VendorItemCard'

const SUBNAV = [
  { code: 'queue', label: 'Work Queue' },
  { code: 'batches', label: 'Batches' },
  { code: 'partners', label: 'Partners' },
  { code: 'pos', label: 'POs' },
]
const WORK_TYPES = ['design', 'blasting', 'setting', 'other']
const ITEM_STATUSES = ['submitted', 'waiting_on_info', 'ready_to_work', 'in_progress', 'design_uploaded', 'ready_for_pickup', 'completed', 'cancelled']
const statusLabel = (s) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
const STATUS_TONE = { submitted: '#6b6b66', waiting_on_info: '#b54040', ready_to_work: '#1d4ed8', in_progress: '#b8842a', design_uploaded: '#7c3aed', ready_for_pickup: '#0d9488', completed: '#2d7a4f', cancelled: '#a0a09a' }
const blankItem = () => ({ workType: 'design', vendorReference: '', stoneSize: '', baseSize: '', color: '', cemetery: '', deceasedFamilyName: '', itemNotes: '', _files: [] })

export default function VendorsTab() {
  const [sub, setSub] = useState('queue')
  const [partners, setPartners] = useState([])
  const [items, setItems] = useState(null)
  const [batches, setBatches] = useState([])
  const [pos, setPos] = useState([])
  const [drawerId, setDrawerId] = useState(null)
  const [newReqOpen, setNewReqOpen] = useState(false)
  const [poModal, setPoModal] = useState(null)   // { partnerId, items:[], batchId? }
  const [toast, setToast] = useState(null)

  const flash = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(t => t === msg ? null : t), 3000) }, [])

  const loadAll = useCallback(async () => {
    const [p, it, b, po] = await Promise.all([listPartners(), listVendorItems(), listVendorBatches(), listVendorPOs()])
    setPartners(p); setItems(it); setBatches(b); setPos(po)
  }, [])
  useEffect(() => {
    let c = false
    Promise.all([listPartners(), listVendorItems(), listVendorBatches(), listVendorPOs()])
      .then(([p, it, b, po]) => { if (!c) { setPartners(p); setItems(it); setBatches(b); setPos(po) } })
    return () => { c = true }
  }, [])

  return (
    <div className="sb-page sb-page-wide">
      <style>{VENDOR_ITEM_CARD_CSS}{VEND_CSS}</style>
      <div className="sb-page-head vend-head">
        <div><div className="sb-page-eyebrow">B2B</div><h1 className="sb-page-title">Vendors</h1></div>
        <button type="button" className="vend-primary" onClick={() => setNewReqOpen(true)}>+ New vendor request</button>
      </div>

      <div className="vend-subnav">
        {SUBNAV.map(s => <button key={s.code} type="button" className={`vend-subtab ${sub === s.code ? 'on' : ''}`} onClick={() => setSub(s.code)}>{s.label}</button>)}
      </div>

      {sub === 'queue' && <WorkQueue items={items} partners={partners} onOpen={setDrawerId} />}
      {sub === 'batches' && <BatchesView batches={batches} items={items || []} partners={partners} onReload={loadAll} onOpenItem={setDrawerId} onGeneratePO={(b) => setPoModal({ partnerId: b.partner_id, batchId: b.id, items: (items || []).filter(i => i.batch_id === b.id) })} flash={flash} />}
      {sub === 'partners' && <PartnersView partners={partners} onReload={loadAll} flash={flash} />}
      {sub === 'pos' && <POsView pos={pos} partners={partners} onNew={() => setPoModal({ partnerId: partners[0]?.id || null, items: [] })} onReload={loadAll} flash={flash} />}

      {newReqOpen && <NewRequestModal partners={partners} onClose={() => setNewReqOpen(false)} onSaved={() => { setNewReqOpen(false); setSub('queue'); loadAll(); flash('Request created — in the Work Queue.') }} />}
      {drawerId && <ItemDrawer itemId={drawerId} batches={batches} onClose={() => setDrawerId(null)} onChanged={loadAll} onGeneratePO={(it) => setPoModal({ partnerId: it.request?.partner_id, items: [it] })} flash={flash} />}
      {poModal && <POModal seed={poModal} partners={partners} onClose={() => setPoModal(null)} onSaved={() => { setPoModal(null); loadAll(); flash('PO saved.') }} />}

      {toast && <div className="vend-toast">{toast}</div>}
    </div>
  )
}

// ── Work Queue ───────────────────────────────────────────────────────────────
function WorkQueue({ items, partners, onOpen }) {
  const [fPartner, setFPartner] = useState('')
  const [fType, setFType] = useState('')
  const [fStatus, setFStatus] = useState('')
  const rows = useMemo(() => {
    if (!items) return null
    return items.filter(i =>
      (!fPartner || i.request?.partner_id === fPartner) &&
      (!fType || i.work_type === fType) &&
      (!fStatus || i.status === fStatus))
  }, [items, fPartner, fType, fStatus])

  return (
    <>
      <div className="vend-filters">
        <select value={fPartner} onChange={e => setFPartner(e.target.value)}><option value="">All partners</option>{partners.map(p => <option key={p.id} value={p.id}>{p.company_name}</option>)}</select>
        <select value={fType} onChange={e => setFType(e.target.value)}><option value="">All work types</option>{WORK_TYPES.map(t => <option key={t} value={t}>{statusLabel(t)}</option>)}</select>
        <select value={fStatus} onChange={e => setFStatus(e.target.value)}><option value="">All statuses</option>{ITEM_STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}</select>
      </div>
      <div className="vend-table">
        <div className="vend-row vend-row-head">
          <div>Partner</div><div>Work</div><div>Ref</div><div>Status</div><div>Needed by</div><div>Batch</div><div>Updated</div><div />
        </div>
        {rows === null ? <div className="vend-empty">Loading…</div>
          : rows.length === 0 ? <div className="vend-empty">No items. Use “+ New vendor request”. (If this stays empty, the 20260608 migration may need to be applied.)</div>
          : rows.map(i => (
            <div key={i.id} className="vend-row">
              <div className="vend-strong">{i.request?.partner?.company_name || '—'}</div>
              <div>{statusLabel(i.work_type)}</div>
              <div className="vend-mono">{i.vendor_reference || '—'}</div>
              <div><StatusChip status={i.status} /></div>
              <div>{i.request?.needed_by ? fmtDate(i.request.needed_by) : '—'}{i.request?.rush && <span className="vend-rush">RUSH</span>}</div>
              <div>{i.batch?.name || (i.batch_id ? 'Batched' : '—')}</div>
              <div className="vend-dim">{i.updated_at ? fmtDate(i.updated_at) : '—'}</div>
              <div><button type="button" className="vend-open" onClick={() => onOpen(i.id)}>Open</button></div>
            </div>
          ))}
      </div>
    </>
  )
}

function StatusChip({ status }) {
  return <span className="vend-chip" style={{ color: STATUS_TONE[status] || '#6b6b66', borderColor: STATUS_TONE[status] || '#ccc' }}>{statusLabel(status)}</span>
}

// ── New Request (internal) ───────────────────────────────────────────────────
function NewRequestModal({ partners, onClose, onSaved }) {
  const [partnerId, setPartnerId] = useState(partners[0]?.id || '')
  const [requestName, setRequestName] = useState('')
  const [neededBy, setNeededBy] = useState('')
  const [rush, setRush] = useState(false)
  const [generalNotes, setGeneralNotes] = useState('')
  const [items, setItems] = useState([blankItem()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const setItem = (idx, next) => setItems(arr => arr.map((it, i) => i === idx ? next : it))
  const dupItem = (idx) => setItems(arr => { const c = { ...arr[idx], _files: [] }; return [...arr.slice(0, idx + 1), c, ...arr.slice(idx + 1)] })
  const rmItem = (idx) => setItems(arr => arr.length > 1 ? arr.filter((_, i) => i !== idx) : arr)

  const submit = async () => {
    if (!partnerId) { setError('Pick a partner.'); return }
    setBusy(true); setError(null)
    const res = await createVendorRequest({ partnerId, requestName, neededBy, rush, generalNotes, source: 'internal', items })
    if (!res.ok) { setBusy(false); setError(res.error); return }
    // Upload each item's staged files against the created item.
    const created = res.items || []
    for (let i = 0; i < created.length; i++) {
      const files = items[i]?._files || []
      for (const f of files) await uploadVendorFile(f, { partnerId, requestId: res.request.id, itemId: created[i].id, uploaderRole: 'staff', kind: 'upload' }).catch(() => {})
    }
    setBusy(false)
    onSaved()
  }

  return (
    <div className="vend-backdrop" onClick={() => { if (!busy) onClose() }}>
      <div className="vend-modal vend-modal-lg" onClick={e => e.stopPropagation()}>
        <h3 className="vend-modal-title">New vendor request</h3>
        <div className="vend-grid2">
          <label className="vic-field"><span>Partner company</span>
            <select className="vic-input" value={partnerId} onChange={e => setPartnerId(e.target.value)}>
              <option value="">Select partner…</option>{partners.map(p => <option key={p.id} value={p.id}>{p.company_name}</option>)}
            </select>
          </label>
          <label className="vic-field"><span>Request / batch name</span><input className="vic-input" value={requestName} onChange={e => setRequestName(e.target.value)} placeholder="optional" /></label>
          <label className="vic-field"><span>Needed by</span><input className="vic-input" type="date" value={neededBy} onChange={e => setNeededBy(e.target.value)} /></label>
          <label className="vic-field vend-rush-field"><input type="checkbox" checked={rush} onChange={e => setRush(e.target.checked)} /> <span>Rush</span></label>
        </div>
        <label className="vic-field"><span>General notes</span><textarea className="vic-input" rows={2} value={generalNotes} onChange={e => setGeneralNotes(e.target.value)} placeholder="optional — applies to the whole request" /></label>

        <div className="vend-items">
          {items.map((it, i) => (
            <VendorItemCard key={i} item={it} index={i} onChange={(n) => setItem(i, n)} onDuplicate={() => dupItem(i)} onRemove={() => rmItem(i)} canRemove={items.length > 1} />
          ))}
        </div>
        <button type="button" className="vend-add-item" onClick={() => setItems(arr => [...arr, blankItem()])}>+ Add another stone / item</button>

        {error && <div className="vend-error">{error}</div>}
        <div className="vend-modal-actions">
          <button type="button" className="vend-cancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="vend-primary" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Create request'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Item drawer ──────────────────────────────────────────────────────────────
function ItemDrawer({ itemId, batches, onClose, onChanged, onGeneratePO, flash }) {
  const [item, setItem] = useState(null)
  const [atts, setAtts] = useState([])
  const [events, setEvents] = useState([])
  const [edit, setEdit] = useState(false)
  const [draft, setDraft] = useState({})
  const [email, setEmail] = useState(null)
  const [reqEdit, setReqEdit] = useState(false)
  const fileRef = useRef(null); const photoRef = useRef(null)

  const reload = useCallback(async () => {
    const it = await getVendorItem(itemId)
    setItem(it); setDraft(it || {})
    setAtts(await listVendorAttachments({ itemId }))
    setEvents(await listVendorEvents({ itemId, requestId: it?.request_id }))
  }, [itemId])
  useEffect(() => {
    let c = false
    ;(async () => {
      const it = await getVendorItem(itemId)
      if (c) return
      setItem(it); setDraft(it || {})
      const [a, ev] = await Promise.all([listVendorAttachments({ itemId }), listVendorEvents({ itemId, requestId: it?.request_id })])
      if (!c) { setAtts(a); setEvents(ev) }
    })()
    return () => { c = true }
  }, [itemId])

  if (!item) return <div className="vend-drawer-backdrop" onClick={onClose}><div className="vend-drawer" onClick={e => e.stopPropagation()}><div className="vend-empty">Loading…</div></div></div>

  const partner = item.request?.partner
  const setStatus = async (s) => { await updateVendorItem(item.id, { status: s }, { actor: await getCurrentStaffName().catch(() => 'Staff') }); await reload(); onChanged?.() }
  const saveEdits = async () => {
    const patch = {}
    for (const [k, col] of Object.entries({ workType: 'work_type', vendorReference: 'vendor_reference', stoneSize: 'stone_size', baseSize: 'base_size', color: 'color', cemetery: 'cemetery', deceasedFamilyName: 'deceased_family_name', itemNotes: 'item_notes', internalNotes: 'internal_notes', assignedTo: 'assigned_to' })) {
      if (draft[col] !== item[col]) patch[k] = draft[col]
    }
    if (Object.keys(patch).length) { await updateVendorItem(item.id, patch); }
    setEdit(false); await reload(); onChanged?.()
  }
  const doUpload = async (file, kind) => {
    if (!file) return
    await uploadVendorFile(file, { partnerId: item.request?.partner_id, requestId: item.request_id, itemId: item.id, uploaderRole: 'staff', kind })
    await reload(); onChanged?.()
    if (fileRef.current) fileRef.current.value = ''; if (photoRef.current) photoRef.current.value = ''
  }
  const openEmail = async (kind) => {
    const subjects = { info: `We need a bit more info — ${item.vendor_reference || 'your item'}`, design: `Your design is ready — ${item.vendor_reference || ''}`, pickup: `Ready for pickup — ${item.vendor_reference || ''}`, completed: `Completed — ${item.vendor_reference || ''}` }
    const bodies = {
      info: `Hi ${partner?.contact_person || partner?.company_name || ''},\n\nWe’re working on ${item.vendor_reference || 'your item'} and need a little more information to proceed. Could you send over the details when you get a chance?\n\nThanks,\nShevchenko Monuments`,
      design: `Hi ${partner?.contact_person || partner?.company_name || ''},\n\nThe design for ${item.vendor_reference || 'your item'} is ready — you can download it from your partner portal under Open Jobs.\n\nThanks,\nShevchenko Monuments`,
      pickup: `Hi ${partner?.contact_person || partner?.company_name || ''},\n\n${item.vendor_reference || 'Your item'} is ready for pickup. See it under Ready for Pickup in your portal.\n\nThanks,\nShevchenko Monuments`,
      completed: `Hi ${partner?.contact_person || partner?.company_name || ''},\n\n${item.vendor_reference || 'Your item'} is complete — the completion photo is in your portal.\n\nThanks,\nShevchenko Monuments`,
    }
    setEmail({ to: partner?.email || '', subject: subjects[kind] || '', body: bodies[kind] || '', kind })
  }

  const dupItem = async () => { await duplicateVendorItem(item.id); onChanged?.(); flash('Item duplicated.') }
  const rmItem = async () => { await deleteVendorItem(item.id); onChanged?.(); onClose() }
  const addSibling = async () => { await addVendorItem(item.request_id, { workType: 'design' }); onChanged?.(); flash('Item added to this request.') }
  const moveToBatch = async (batchId) => { await updateVendorItem(item.id, { batchId: batchId || null }); await reload(); onChanged?.() }
  const vendorFiles = atts.filter(a => a.kind === 'upload' && a.uploader_role === 'partner')
  const staffFiles = atts.filter(a => a.kind === 'upload' && a.uploader_role === 'staff')
  const photos = atts.filter(a => a.kind === 'completion_photo')

  return (
    <div className="vend-drawer-backdrop" onClick={onClose}>
      <div className="vend-drawer" onClick={e => e.stopPropagation()}>
        <div className="vend-drawer-head">
          <div>
            <div className="vend-drawer-sub">{partner?.company_name} · {statusLabel(item.work_type)}</div>
            <div className="vend-drawer-title">{item.vendor_reference || 'Item'}</div>
            <div className="vend-drawer-meta"><StatusChip status={item.status} />{item.request?.needed_by && <span>Needed {fmtDate(item.request.needed_by)}</span>}{item.request?.rush && <span className="vend-rush">RUSH</span>}</div>
          </div>
          <button type="button" className="vend-drawer-close" onClick={onClose}>Close ×</button>
        </div>

        {/* Actions */}
        <div className="vend-actions">
          <label className="vend-act-status">Status
            <select value={item.status} onChange={e => setStatus(e.target.value)}>{ITEM_STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}</select>
          </label>
          <button type="button" onClick={() => fileRef.current?.click()}>Upload file</button>
          <button type="button" onClick={() => photoRef.current?.click()}>Upload photo</button>
          <button type="button" onClick={() => openEmail('info')}>Request info</button>
          <button type="button" onClick={() => setStatus('ready_for_pickup')}>Ready for pickup</button>
          <button type="button" onClick={() => setStatus('completed')}>Mark completed</button>
          <button type="button" onClick={() => onGeneratePO(item)}>Generate PO</button>
          <button type="button" onClick={dupItem}>Duplicate</button>
          <button type="button" onClick={rmItem}>Remove</button>
          <button type="button" onClick={addSibling}>+ Item to request</button>
          <button type="button" onClick={() => setReqEdit(true)}>Edit request</button>
          <select className="vend-act-batch" value={item.batch_id || ''} onChange={e => moveToBatch(e.target.value)} title="Move to batch">
            <option value="">No batch</option>
            {batches.filter(b => !b.partner_id || b.partner_id === item.request?.partner_id).map(b => <option key={b.id} value={b.id}>{b.name || 'Batch'}</option>)}
          </select>
          <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={e => doUpload(e.target.files?.[0], 'upload')} />
          <input ref={photoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => doUpload(e.target.files?.[0], 'completion_photo')} />
        </div>

        {/* Details */}
        <div className="vend-drawer-section">
          <div className="vend-sec-head"><span>Details</span><button type="button" className="vend-sec-edit" onClick={() => edit ? saveEdits() : setEdit(true)}>{edit ? 'Save' : 'Edit'}</button></div>
          {edit ? (
            <div className="vend-detail-edit">
              <Field label="Work type"><select className="vic-input" value={draft.work_type} onChange={e => setDraft(d => ({ ...d, work_type: e.target.value }))}>{WORK_TYPES.map(t => <option key={t} value={t}>{statusLabel(t)}</option>)}</select></Field>
              {['vendor_reference', 'stone_size', 'base_size', 'color', 'cemetery', 'deceased_family_name', 'assigned_to'].map(col => (
                <Field key={col} label={statusLabel(col)}><input className="vic-input" value={draft[col] || ''} onChange={e => setDraft(d => ({ ...d, [col]: e.target.value }))} /></Field>
              ))}
              <Field label="Item notes" wide><textarea className="vic-input" rows={3} value={draft.item_notes || ''} onChange={e => setDraft(d => ({ ...d, item_notes: e.target.value }))} /></Field>
              <Field label="Internal notes" wide><textarea className="vic-input" rows={2} value={draft.internal_notes || ''} onChange={e => setDraft(d => ({ ...d, internal_notes: e.target.value }))} /></Field>
            </div>
          ) : (
            <div className="vend-detail">
              <Detail label="Partner" value={partner?.company_name} /><Detail label="Contact" value={partner?.contact_person || partner?.phone || partner?.email} />
              <Detail label="Work type" value={statusLabel(item.work_type)} /><Detail label="Vendor ref" value={item.vendor_reference} />
              <Detail label="Stone size" value={item.stone_size} /><Detail label="Base size" value={item.base_size} />
              <Detail label="Color" value={item.color} /><Detail label="Cemetery" value={item.cemetery} />
              <Detail label="Deceased / family" value={item.deceased_family_name} /><Detail label="Assigned to" value={item.assigned_to} />
              <Detail label="Item notes" value={item.item_notes} wide /><Detail label="Internal notes" value={item.internal_notes} wide />
            </div>
          )}
        </div>

        {/* Files */}
        <div className="vend-drawer-section">
          <div className="vend-sec-head"><span>Files</span></div>
          <FileGroup title="Vendor-uploaded" files={vendorFiles} />
          <FileGroup title="Shevchenko-uploaded" files={staffFiles} />
          <FileGroup title="Completion photos" files={photos} />
        </div>

        {/* Timeline */}
        <div className="vend-drawer-section">
          <div className="vend-sec-head"><span>Timeline</span></div>
          {events.length === 0 ? <div className="vend-dim">No events yet.</div> : (
            <div className="vend-timeline">
              {events.map(e => (
                <div key={e.id} className="vend-tl-row">
                  <span className="vend-tl-dot" />
                  <div><div className="vend-tl-detail">{e.detail || statusLabel(e.event_type)}</div><div className="vend-tl-meta">{e.actor || '—'} · {fmtDate(e.created_at)}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {email && <EmailComposer email={email} onClose={() => setEmail(null)} onSent={async () => { await addVendorEvent({ requestId: item.request_id, itemId: item.id, eventType: email.kind === 'info' ? 'info_requested' : 'email_sent', actor: 'Staff', detail: `Email: ${email.subject}` }); setEmail(null); await reload(); flash('Email sent.') }} />}
      {reqEdit && <RequestEditModal request={item.request} onClose={() => setReqEdit(false)} onSaved={async () => { setReqEdit(false); await reload(); onChanged?.(); flash('Request updated.') }} />}
    </div>
  )
}

// Edit the PARENT request fields (name / needed-by / rush / general notes) after
// submission — staff keep full control of the request, not just line items.
function RequestEditModal({ request, onClose, onSaved }) {
  const [f, setF] = useState({ requestName: request?.request_name || '', neededBy: request?.needed_by || '', rush: !!request?.rush, generalNotes: request?.general_notes || '', status: request?.status || 'submitted' })
  const [busy, setBusy] = useState(false); const [error, setError] = useState(null)
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const save = async () => {
    setBusy(true); setError(null)
    const res = await updateVendorRequest(request.id, { requestName: f.requestName, neededBy: f.neededBy || null, rush: f.rush, generalNotes: f.generalNotes, status: f.status })
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    onSaved()
  }
  return (
    <div className="vend-backdrop" onClick={() => { if (!busy) onClose() }}>
      <div className="vend-modal" onClick={e => e.stopPropagation()}>
        <h3 className="vend-modal-title">Edit request</h3>
        <div className="vend-grid2">
          <label className="vic-field"><span>Request name</span><input className="vic-input" value={f.requestName} onChange={e => set('requestName', e.target.value)} /></label>
          <label className="vic-field"><span>Needed by</span><input className="vic-input" type="date" value={f.neededBy || ''} onChange={e => set('neededBy', e.target.value)} /></label>
        </div>
        <label className="vend-rush-field"><input type="checkbox" checked={f.rush} onChange={e => set('rush', e.target.checked)} /> <span>Rush</span></label>
        <label className="vic-field"><span>General notes</span><textarea className="vic-input" rows={2} value={f.generalNotes} onChange={e => set('generalNotes', e.target.value)} /></label>
        {error && <div className="vend-error">{error}</div>}
        <div className="vend-modal-actions"><button type="button" className="vend-cancel" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="vend-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
      </div>
    </div>
  )
}

function Field({ label, children, wide }) { return <label className={`vic-field ${wide ? 'vend-wide' : ''}`}><span>{label}</span>{children}</label> }
function Detail({ label, value, wide }) { return <div className={`vend-detail-row ${wide ? 'vend-wide' : ''}`}><span className="vend-detail-label">{label}</span><span className="vend-detail-val">{value || '—'}</span></div> }

function FileGroup({ title, files }) {
  const open = async (path) => { const url = await vendorFileSignedUrl(path); if (url) window.open(url, '_blank') }
  return (
    <div className="vend-filegroup">
      <div className="vend-filegroup-title">{title}</div>
      {files.length === 0 ? <div className="vend-dim vend-filegroup-empty">None</div> : (
        <div className="vend-filegroup-list">{files.map(f => <button key={f.id} type="button" className="vend-file" onClick={() => open(f.file_path)}>{f.file_name || 'file'} ↗</button>)}</div>
      )}
    </div>
  )
}

// ── Reviewable email composer (human-in-loop; reuses gmail-send) ─────────────
function EmailComposer({ email, onClose, onSent }) {
  const [to, setTo] = useState(email.to || '')
  const [subject, setSubject] = useState(email.subject || '')
  const [body, setBody] = useState(email.body || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const send = async () => {
    if (!to.trim()) { setError('Enter a recipient.'); return }
    setBusy(true); setError(null)
    const res = await sendOrderEmail({ orderId: null, to: to.trim(), subject, body })
    setBusy(false)
    if (!res.ok) { setError(res.error || 'Send failed — check Gmail is connected.'); return }
    onSent()
  }
  return (
    <div className="vend-backdrop" onClick={() => { if (!busy) onClose() }}>
      <div className="vend-modal" onClick={e => e.stopPropagation()}>
        <h3 className="vend-modal-title">Review &amp; send</h3>
        <label className="vic-field"><span>To</span><input className="vic-input" value={to} onChange={e => setTo(e.target.value)} /></label>
        <label className="vic-field"><span>Subject</span><input className="vic-input" value={subject} onChange={e => setSubject(e.target.value)} /></label>
        <label className="vic-field"><span>Message</span><textarea className="vic-input" rows={8} value={body} onChange={e => setBody(e.target.value)} /></label>
        {error && <div className="vend-error">{error}</div>}
        <div className="vend-modal-actions"><button type="button" className="vend-cancel" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="vend-primary" onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send'}</button></div>
      </div>
    </div>
  )
}

// ── Partners ─────────────────────────────────────────────────────────────────
function PartnersView({ partners, onReload, flash }) {
  const [editing, setEditing] = useState(null)   // partner | 'new' | null
  return (
    <>
      <div className="vend-filters"><div style={{ flex: 1 }} /><button type="button" className="vend-primary" onClick={() => setEditing('new')}>+ Add partner</button></div>
      <div className="vend-table">
        <div className="vend-row vend-prow vend-row-head"><div>Company</div><div>Contact</div><div>Phone</div><div>Email</div><div>Terms</div><div>Active</div><div /></div>
        {partners.length === 0 ? <div className="vend-empty">No partners yet. Add one to start taking requests.</div>
          : partners.map(p => (
            <div key={p.id} className="vend-row vend-prow">
              <div className="vend-strong">{p.company_name}</div><div>{p.contact_person || '—'}</div><div>{p.phone || '—'}</div>
              <div className="vend-dim">{p.email || '—'}</div><div>{p.payment_terms || '—'}</div><div>{p.active ? 'Yes' : 'No'}</div>
              <div><button type="button" className="vend-open" onClick={() => setEditing(p)}>Edit</button></div>
            </div>
          ))}
      </div>
      {editing && <PartnerModal partner={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onReload(); flash('Partner saved.') }} />}
    </>
  )
}

function PartnerModal({ partner, onClose, onSaved }) {
  const [f, setF] = useState({
    companyName: partner?.company_name || '', contactPerson: partner?.contact_person || '', phone: partner?.phone || '',
    email: partner?.email || '', address: partner?.address || '', paymentTerms: partner?.payment_terms || '',
    notes: partner?.notes || '', active: partner ? !!partner.active : true,
  })
  const [busy, setBusy] = useState(false); const [error, setError] = useState(null)
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const save = async () => {
    if (!f.companyName.trim()) { setError('Enter a company name.'); return }
    setBusy(true); setError(null)
    const res = partner ? await updatePartner(partner.id, f) : await createPartner(f)
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    onSaved()
  }
  return (
    <div className="vend-backdrop" onClick={() => { if (!busy) onClose() }}>
      <div className="vend-modal" onClick={e => e.stopPropagation()}>
        <h3 className="vend-modal-title">{partner ? 'Edit partner' : 'Add partner'}</h3>
        <label className="vic-field"><span>Company name</span><input className="vic-input" value={f.companyName} onChange={e => set('companyName', e.target.value)} autoFocus /></label>
        <div className="vend-grid2">
          <label className="vic-field"><span>Contact person</span><input className="vic-input" value={f.contactPerson} onChange={e => set('contactPerson', e.target.value)} /></label>
          <label className="vic-field"><span>Phone</span><input className="vic-input" value={f.phone} onChange={e => set('phone', e.target.value)} /></label>
          <label className="vic-field"><span>Email</span><input className="vic-input" value={f.email} onChange={e => set('email', e.target.value)} /></label>
          <label className="vic-field"><span>Payment terms</span><input className="vic-input" value={f.paymentTerms} onChange={e => set('paymentTerms', e.target.value)} placeholder="e.g. Net 30" /></label>
        </div>
        <label className="vic-field"><span>Address</span><input className="vic-input" value={f.address} onChange={e => set('address', e.target.value)} /></label>
        <label className="vend-rush-field"><input type="checkbox" checked={f.active} onChange={e => set('active', e.target.checked)} /> <span>Active</span></label>
        {error && <div className="vend-error">{error}</div>}
        <div className="vend-modal-actions"><button type="button" className="vend-cancel" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="vend-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
        {partner && <PortalInvite partner={partner} defaultEmail={f.email} />}
      </div>
    </div>
  )
}

// Staff invites a partner contact to the external portal. The partner gets an
// email and SETS THEIR OWN password — staff never type partner credentials.
function PortalInvite({ partner, defaultEmail }) {
  const [email, setEmail] = useState(defaultEmail || '')
  const [users, setUsers] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  useEffect(() => {
    let cancelled = false
    listPartnerUsers(partner.id).then(u => { if (!cancelled) setUsers(u) })
    return () => { cancelled = true }
  }, [partner.id])
  const invite = async () => {
    setBusy(true); setMsg(null)
    const res = await invitePartnerUser({ partnerId: partner.id, email })
    setBusy(false)
    if (!res.ok) { setMsg({ kind: 'err', text: res.error }); return }
    setMsg({ kind: 'ok', text: `Invite sent to ${email}. They’ll set their own password.` })
    listPartnerUsers(partner.id).then(setUsers)
  }
  return (
    <div className="vend-invite">
      <div className="vend-invite-title">Portal access</div>
      <p className="vend-invite-sub">Invite this partner to log into the portal and submit their own work. They set their own password from the email.</p>
      <div className="vend-invite-row">
        <input className="vic-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="partner contact email" />
        <button type="button" className="vend-primary" onClick={invite} disabled={busy || !email.trim()}>{busy ? 'Sending…' : 'Send invite'}</button>
      </div>
      {msg && <div className={msg.kind === 'err' ? 'vend-error' : 'vend-invite-ok'}>{msg.text}</div>}
      {users.length > 0 && <div className="vend-invite-users">{users.length} portal user{users.length === 1 ? '' : 's'} linked</div>}
    </div>
  )
}

// ── Batches ──────────────────────────────────────────────────────────────────
function BatchesView({ batches, items, partners, onReload, onOpenItem, onGeneratePO, flash }) {
  const [newOpen, setNewOpen] = useState(false)
  const unbatched = items.filter(i => !i.batch_id)
  return (
    <>
      <div className="vend-filters"><div style={{ flex: 1 }} /><button type="button" className="vend-primary" onClick={() => setNewOpen(true)}>+ New batch</button></div>
      {batches.length === 0 ? <div className="vend-empty">No batches yet.</div> : (
        <div className="vend-batches">
          {batches.map(b => {
            const its = items.filter(i => i.batch_id === b.id)
            return (
              <div key={b.id} className="vend-batch">
                <div className="vend-batch-head">
                  <div><div className="vend-strong">{b.name || 'Batch'}</div><div className="vend-dim">{b.partner?.company_name || '—'} · {its.length} item{its.length === 1 ? '' : 's'}</div></div>
                  <div className="vend-batch-actions">
                    <select value={b.status} onChange={async e => { await updateVendorBatch(b.id, { status: e.target.value }); onReload() }}>{['open', 'in_progress', 'ready_for_pickup', 'completed', 'po_sent'].map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}</select>
                    <button type="button" onClick={() => onGeneratePO(b)}>Generate PO</button>
                  </div>
                </div>
                <div className="vend-batch-items">
                  {its.map(i => <button key={i.id} type="button" className="vend-batch-item" onClick={() => onOpenItem(i.id)}>{i.vendor_reference || statusLabel(i.work_type)} <span className="vend-mini-x" onClick={async (e) => { e.stopPropagation(); await setItemBatch(i.id, null); onReload() }}>remove</span></button>)}
                  <AddToBatch batchId={b.id} unbatched={unbatched.filter(i => !b.partner_id || i.request?.partner_id === b.partner_id)} onAdded={onReload} />
                </div>
              </div>
            )
          })}
        </div>
      )}
      {newOpen && <NewBatchModal partners={partners} onClose={() => setNewOpen(false)} onSaved={() => { setNewOpen(false); onReload(); flash('Batch created.') }} />}
    </>
  )
}
function AddToBatch({ batchId, unbatched, onAdded }) {
  const [v, setV] = useState('')
  return (
    <select className="vend-addbatch" value={v} onChange={async e => { if (e.target.value) { await setItemBatch(e.target.value, batchId); setV(''); onAdded() } }}>
      <option value="">+ Add item…</option>
      {unbatched.map(i => <option key={i.id} value={i.id}>{i.request?.partner?.company_name} · {i.vendor_reference || statusLabel(i.work_type)}</option>)}
    </select>
  )
}
function NewBatchModal({ partners, onClose, onSaved }) {
  const [partnerId, setPartnerId] = useState(partners[0]?.id || '')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false); const [error, setError] = useState(null)
  const save = async () => { setBusy(true); const res = await createVendorBatch({ partnerId: partnerId || null, name }); setBusy(false); if (!res.ok) { setError(res.error); return } onSaved() }
  return (
    <div className="vend-backdrop" onClick={() => { if (!busy) onClose() }}>
      <div className="vend-modal" onClick={e => e.stopPropagation()}>
        <h3 className="vend-modal-title">New batch</h3>
        <label className="vic-field"><span>Partner</span><select className="vic-input" value={partnerId} onChange={e => setPartnerId(e.target.value)}><option value="">Any</option>{partners.map(p => <option key={p.id} value={p.id}>{p.company_name}</option>)}</select></label>
        <label className="vic-field"><span>Batch name</span><input className="vic-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Week of Jun 9 setting trip" autoFocus /></label>
        {error && <div className="vend-error">{error}</div>}
        <div className="vend-modal-actions"><button type="button" className="vend-cancel" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="vend-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Create'}</button></div>
      </div>
    </div>
  )
}

// ── POs ──────────────────────────────────────────────────────────────────────
function POsView({ pos, partners, onNew, onReload, flash }) {
  return (
    <>
      <div className="vend-filters"><div style={{ flex: 1 }} /><button type="button" className="vend-primary" onClick={onNew} disabled={!partners.length}>+ New PO</button></div>
      <div className="vend-table">
        <div className="vend-row vend-porow vend-row-head"><div>PO #</div><div>Partner</div><div>Date</div><div>Items</div><div>Status</div><div /></div>
        {pos.length === 0 ? <div className="vend-empty">No POs yet — generate one from an item or a batch.</div>
          : pos.map(po => (
            <div key={po.id} className="vend-row vend-porow">
              <div className="vend-mono vend-strong">{po.po_number}</div><div>{po.partner?.company_name || '—'}</div><div>{po.po_date ? fmtDate(po.po_date) : '—'}</div>
              <div>{(po.po_items || []).length}</div><div><span className="vend-chip">{statusLabel(po.status)}</span></div>
              <div className="vend-po-actions">
                {po.status === 'draft' && <button type="button" onClick={async () => { await updateVendorPO(po.id, { status: 'sent' }); onReload(); flash('PO marked sent.') }}>Send</button>}
                <button type="button" onClick={() => downloadPOPdf(po)}>PDF</button>
              </div>
            </div>
          ))}
      </div>
    </>
  )
}

function POModal({ seed, partners, onClose, onSaved }) {
  const [partnerId, setPartnerId] = useState(seed.partnerId || partners[0]?.id || '')
  const [poNumber, setPoNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [customAmount, setCustomAmount] = useState('')
  const [busy, setBusy] = useState(false); const [error, setError] = useState(null)
  useEffect(() => { nextPONumber().then(setPoNumber) }, [])
  const poItems = (seed.items || []).map(it => ({ itemId: it.id, description: `${it.vendor_reference || ''} ${it.work_type ? '· ' + statusLabel(it.work_type) : ''}`.trim(), quantity: 1 }))
  const save = async (status) => {
    if (!partnerId) { setError('Pick a partner.'); return }
    setBusy(true); setError(null)
    const res = await createVendorPO({ partnerId, poNumber, batchId: seed.batchId || null, notes, customAmount, poItems, status })
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    onSaved()
  }
  return (
    <div className="vend-backdrop" onClick={() => { if (!busy) onClose() }}>
      <div className="vend-modal" onClick={e => e.stopPropagation()}>
        <h3 className="vend-modal-title">Generate PO</h3>
        <div className="vend-grid2">
          <label className="vic-field"><span>Partner</span><select className="vic-input" value={partnerId} onChange={e => setPartnerId(e.target.value)}><option value="">Select…</option>{partners.map(p => <option key={p.id} value={p.id}>{p.company_name}</option>)}</select></label>
          <label className="vic-field"><span>PO number</span><input className="vic-input" value={poNumber} onChange={e => setPoNumber(e.target.value)} /></label>
        </div>
        <div className="vend-po-lines">{poItems.length === 0 ? <div className="vend-dim">No line items (generated from an item or batch).</div> : poItems.map((pi, i) => <div key={i} className="vend-po-line">{pi.description || 'Item'}<span>×{pi.quantity}</span></div>)}</div>
        <div className="vend-grid2">
          <label className="vic-field"><span>Custom amount (optional)</span><input className="vic-input" type="number" value={customAmount} onChange={e => setCustomAmount(e.target.value)} placeholder="—" /></label>
        </div>
        <label className="vic-field"><span>Notes</span><textarea className="vic-input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></label>
        {error && <div className="vend-error">{error}</div>}
        <div className="vend-modal-actions">
          <button type="button" className="vend-cancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="vend-cancel" onClick={() => save('draft')} disabled={busy}>Save draft</button>
          <button type="button" className="vend-primary" onClick={() => save('sent')} disabled={busy}>Send PO</button>
        </div>
      </div>
    </div>
  )
}

// jsPDF is loaded from CDN (not an npm dep) — same loader pattern as SalesMode.
let _jsPDFPromise = null
function loadJsPDF() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF)
  if (_jsPDFPromise) return _jsPDFPromise
  _jsPDFPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
    s.async = true
    s.onload = () => window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('jsPDF global missing'))
    s.onerror = () => { _jsPDFPromise = null; reject(new Error('Failed to load jsPDF')) }
    document.head.appendChild(s)
  })
  return _jsPDFPromise
}

async function downloadPOPdf(po) {
  const jsPDF = await loadJsPDF()
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  let y = 20
  doc.setFontSize(18); doc.text('Shevchenko Monuments', 20, y); y += 7
  doc.setFontSize(11); doc.setTextColor(110); doc.text('Purchase Order', 20, y); doc.setTextColor(0); y += 12
  doc.setFontSize(12)
  doc.text(`PO #: ${po.po_number || '—'}`, 20, y); doc.text(`Date: ${po.po_date || '—'}`, 130, y); y += 7
  doc.text(`Partner: ${po.partner?.company_name || '—'}`, 20, y); y += 10
  doc.setFontSize(10); doc.setTextColor(110); doc.text('DESCRIPTION', 20, y); doc.text('QTY', 175, y); doc.setTextColor(0); y += 2
  doc.line(20, y, 195, y); y += 6
  for (const li of (po.po_items || [])) { doc.text(String(li.description || 'Item').slice(0, 90), 20, y); doc.text(String(li.quantity || 1), 178, y); y += 7 }
  y += 4
  if (po.custom_amount != null) { doc.setFontSize(12); doc.text(`Amount: $${Number(po.custom_amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 20, y); y += 8 }
  if (po.notes) { doc.setFontSize(10); doc.setTextColor(80); doc.text(doc.splitTextToSize(`Notes: ${po.notes}`, 175), 20, y) }
  doc.save(`${po.po_number || 'PO'}.pdf`)
}

const VEND_CSS = `
  .vend-head { display: flex; align-items: flex-start; justify-content: space-between; }
  .vend-primary { font: inherit; font-size: 13px; font-weight: 600; padding: 9px 16px; border: 0.5px solid transparent; border-radius: 8px; background: #9A7209; color: #fff; cursor: pointer; white-space: nowrap; }
  .vend-primary:hover:not(:disabled) { filter: brightness(0.95); } .vend-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .vend-subnav { display: inline-flex; gap: 4px; padding: 4px; background: #f0eeea; border-radius: 999px; margin-bottom: 16px; }
  .vend-subtab { font: inherit; font-size: 13px; padding: 7px 18px; border: none; background: transparent; color: #6b6b66; border-radius: 999px; cursor: pointer; }
  .vend-subtab.on { background: #fff; color: #1e2d3d; font-weight: 600; box-shadow: 0 1px 2px rgba(15,20,25,0.08); }
  .vend-filters { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
  .vend-filters select { font: inherit; font-size: 13px; padding: 7px 10px; border: 0.5px solid #e6e3dd; border-radius: 8px; background: #fff; }
  .vend-table { background: #fff; border: 0.5px solid #e6e3dd; border-radius: 12px; overflow: hidden; }
  .vend-row { display: grid; grid-template-columns: 1.3fr 90px 100px 130px 130px 100px 100px 70px; gap: 10px; align-items: center; padding: 11px 16px; border-bottom: 0.5px solid #f1efeb; font-size: 13px; }
  .vend-prow { grid-template-columns: 1.4fr 1fr 110px 1.3fr 110px 70px 70px; }
  .vend-porow { grid-template-columns: 130px 1.4fr 110px 70px 100px 120px; }
  .vend-row:last-child { border-bottom: none; }
  .vend-row-head { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #8a8a85; font-weight: 600; }
  .vend-strong { font-weight: 600; color: #1e2d3d; }
  .vend-mono { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #6b6b66; }
  .vend-dim { color: #a0a09a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .vend-rush { font-size: 9px; font-weight: 700; color: #fff; background: #b54040; padding: 1px 5px; border-radius: 999px; margin-left: 6px; }
  .vend-open { font: inherit; font-size: 12px; font-weight: 600; color: #9A7209; border: 0.5px solid #d8c89a; border-radius: 6px; padding: 4px 12px; background: #fdf8ec; cursor: pointer; }
  .vend-chip { font-size: 11px; font-weight: 600; border: 0.5px solid; border-radius: 999px; padding: 2px 9px; white-space: nowrap; }
  .vend-empty { padding: 28px 16px; text-align: center; color: #8a8a85; font-size: 14px; }

  .vend-backdrop { position: fixed; inset: 0; background: rgba(15,20,25,0.42); z-index: 1100; display: flex; align-items: flex-start; justify-content: center; padding: 24px; overflow-y: auto; }
  .vend-modal { background: #fff; border-radius: 12px; box-shadow: 0 16px 48px rgba(15,20,25,0.24); max-width: 560px; width: 100%; padding: 24px 26px; display: flex; flex-direction: column; gap: 12px; }
  .vend-modal-lg { max-width: 760px; }
  .vend-modal-title { font-size: 18px; font-weight: 600; color: #1e2d3d; margin: 0; }
  .vend-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .vend-rush-field { flex-direction: row !important; align-items: center; gap: 8px; }
  .vend-items { display: flex; flex-direction: column; gap: 14px; }
  .vend-add-item { font: inherit; font-size: 13px; font-weight: 600; color: #9A7209; background: #fdf8ec; border: 0.5px dashed #d8c89a; border-radius: 8px; padding: 10px; cursor: pointer; }
  .vend-error { color: #b54040; font-size: 13px; padding: 8px 10px; background: #fbe5e5; border-radius: 8px; }
  .vend-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
  .vend-cancel { font: inherit; font-size: 14px; font-weight: 500; padding: 9px 18px; border-radius: 8px; border: 0.5px solid #e6e3dd; background: #fff; color: #6b6b66; cursor: pointer; }
  .vend-invite { border-top: 0.5px solid #f1efeb; margin-top: 6px; padding-top: 14px; display: flex; flex-direction: column; gap: 6px; }
  .vend-invite-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #8a8a85; }
  .vend-invite-sub { font-size: 12px; color: #8a8a85; line-height: 1.5; margin: 0; }
  .vend-invite-row { display: flex; gap: 8px; align-items: center; }
  .vend-invite-row .vic-input { flex: 1; }
  .vend-invite-ok { color: #2d6a4f; font-size: 13px; padding: 8px 10px; background: #e8f5ee; border-radius: 8px; }
  .vend-invite-users { font-size: 12px; color: #6b6b66; }

  .vend-drawer-backdrop { position: fixed; inset: 0; background: rgba(15,20,25,0.42); z-index: 1100; display: flex; justify-content: flex-end; }
  .vend-drawer { background: #fff; width: min(620px, 100%); height: 100%; overflow-y: auto; padding: 22px 24px; display: flex; flex-direction: column; gap: 16px; box-shadow: -8px 0 32px rgba(15,20,25,0.16); }
  .vend-drawer-head { display: flex; align-items: flex-start; justify-content: space-between; }
  .vend-drawer-sub { font-size: 12px; color: #8a8a85; }
  .vend-drawer-title { font-size: 20px; font-weight: 700; color: #1e2d3d; margin: 2px 0; }
  .vend-drawer-meta { display: flex; align-items: center; gap: 10px; font-size: 12px; color: #6b6b66; }
  .vend-drawer-close { font: inherit; font-size: 14px; color: #6b6b66; background: none; border: none; cursor: pointer; }
  .vend-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .vend-actions button { font: inherit; font-size: 12px; padding: 6px 12px; border: 0.5px solid #e6e3dd; background: #fff; color: #1e2d3d; border-radius: 7px; cursor: pointer; }
  .vend-actions button:hover { background: #f4f2ee; }
  .vend-act-status { font-size: 12px; color: #6b6b66; display: inline-flex; align-items: center; gap: 6px; }
  .vend-act-status select, .vend-batch-actions select, .vend-addbatch, .vend-act-batch { font: inherit; font-size: 12px; padding: 5px 8px; border: 0.5px solid #e6e3dd; border-radius: 7px; background: #fff; }
  .vend-drawer-section { border-top: 0.5px solid #f1efeb; padding-top: 14px; }
  .vend-sec-head { display: flex; align-items: center; justify-content: space-between; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #8a8a85; font-weight: 700; margin-bottom: 10px; }
  .vend-sec-edit { font: inherit; font-size: 12px; color: #9A7209; background: none; border: none; cursor: pointer; text-transform: none; letter-spacing: 0; font-weight: 600; }
  .vend-detail { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; }
  .vend-detail-row.vend-wide, .vend-detail-edit .vend-wide { grid-column: 1 / -1; }
  .vend-detail-row { display: flex; flex-direction: column; gap: 1px; }
  .vend-detail-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #a0a09a; }
  .vend-detail-val { font-size: 13.5px; color: #1e2d3d; white-space: pre-wrap; }
  .vend-detail-edit { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .vend-filegroup { margin-bottom: 12px; }
  .vend-filegroup-title { font-size: 12px; font-weight: 600; color: #4a4a45; margin-bottom: 5px; }
  .vend-filegroup-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .vend-file { font: inherit; font-size: 12px; color: #1d4ed8; background: #f4f7fd; border: 0.5px solid #d4e0f5; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
  .vend-filegroup-empty { font-size: 12px; }
  .vend-timeline { display: flex; flex-direction: column; gap: 10px; }
  .vend-tl-row { display: flex; gap: 10px; }
  .vend-tl-dot { width: 8px; height: 8px; border-radius: 50%; background: #9A7209; margin-top: 5px; flex: 0 0 auto; }
  .vend-tl-detail { font-size: 13px; color: #1e2d3d; }
  .vend-tl-meta { font-size: 11px; color: #a0a09a; }

  .vend-batches { display: flex; flex-direction: column; gap: 12px; }
  .vend-batch { background: #fff; border: 0.5px solid #e6e3dd; border-radius: 12px; padding: 14px 16px; }
  .vend-batch-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  .vend-batch-actions { display: flex; gap: 8px; align-items: center; }
  .vend-batch-actions button { font: inherit; font-size: 12px; padding: 5px 12px; border: 0.5px solid #d8c89a; background: #fdf8ec; color: #9A7209; border-radius: 7px; cursor: pointer; }
  .vend-batch-items { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .vend-batch-item { font: inherit; font-size: 12px; padding: 4px 10px; border: 0.5px solid #e6e3dd; background: #faf8f3; border-radius: 7px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; }
  .vend-mini-x { color: #b54040; font-size: 11px; }
  .vend-toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: #1e2d3d; color: #fff; font-size: 13px; padding: 10px 18px; border-radius: 8px; z-index: 1200; box-shadow: 0 8px 24px rgba(15,20,25,0.24); }
  .vend-po-lines { display: flex; flex-direction: column; gap: 4px; }
  .vend-po-line { display: flex; justify-content: space-between; font-size: 13px; color: #1e2d3d; padding: 4px 0; border-bottom: 0.5px solid #f1efeb; }
  .vend-po-actions, .vend-batch-actions { display: flex; gap: 6px; }
  .vend-po-actions button { font: inherit; font-size: 12px; padding: 4px 10px; border: 0.5px solid #e6e3dd; background: #fff; border-radius: 6px; cursor: pointer; }
  @media (max-width: 800px) { .vend-grid2 { grid-template-columns: 1fr; } .vend-detail { grid-template-columns: 1fr; } }
`
